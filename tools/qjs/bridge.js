// The harness's in-VM half (tools/qjs/harness.mjs evaluates this as the module
// "harness:bridge" before the sandbox prelude, so the mocks it imports are set
// up the way herdr's native built-ins are: before the prototypes freeze).
//
// It owns the mock controller, the view instance and the last live element
// tree. Node drives it through `dispatch(op, json)` (JSON in, JSON out) and
// `adopt(namespace)`; promise jobs are drained by Node between the *Begin and
// *End ops so every drain happens inside the right scope, as the shell does
// after an entry point (scheduler::drain_runtime_jobs).
//
// Nothing here is visible to a mod except what herdr also has: the mock
// `window` object, `console`, and `globalThis.__herdr` (the controller the mock
// "herdr" module forwards to).

import { createController, describe } from "mock:controller.js";
import { installMockWindow, beginRender, constructView, serialize, fire } from "mock:gpui-kit.js";
// Evaluate the remaining built-ins now (as native modules would be), so a
// mod's import graph is only its own files.
import "gpui-kit";
import "gpui";
import "gpui-base";
import "herdr";

let ctl = null;
let ViewClass = null;
let pending = null; // instance under construction (load / reload)
let instance = null;
let instanceGen = 0;
let tree = null;
let layoutOut = null;
let openFrame = null;
let closing = null;
let calls = [];
let consoleLines = [];
let errorsSeen = 0;
let notifiesSeen = 0;
let filesRev = 0;

const clone = (value) => {
  if (value === undefined) return null;
  try {
    const text = JSON.stringify(value);
    return text === undefined ? null : JSON.parse(text);
  } catch {
    return String(value);
  }
};

function format(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

function installConsole() {
  // `console.{debug,log,info,warn,error}` exist in herdr (qjs/standard/console.rs)
  // and go to the log; here they go to the harness's console buffer.
  const make = (level) => (...args) => {
    consoleLines.push({ level, text: args.map(format).join(" ") });
  };
  globalThis.console = {
    debug: make("debug"),
    log: make("info"),
    info: make("info"),
    warn: make("warn"),
    error: make("error"),
  };
}

function trackFiles() {
  // Bump a revision whenever the in-memory disk changes, so Node only copies
  // the file map when something was written.
  const files = ctl.files;
  const dirs = ctl.dirs;
  const set = files.set.bind(files);
  const del = files.delete.bind(files);
  const add = dirs.add.bind(dirs);
  files.set = (k, v) => {
    filesRev += 1;
    return set(k, v);
  };
  files.delete = (k) => {
    filesRev += 1;
    return del(k);
  };
  dirs.add = (k) => {
    if (!dirs.has(k)) filesRev += 1;
    return add(k);
  };
}

function recordCalls() {
  // Every herdr call with its (copied) arguments and outcome: host.callsTo(fn).
  const hostCall = ctl.hostCall.bind(ctl);
  ctl.hostCall = (name, args) => {
    const entry = { fn: name, args: clone(Array.from(args)), t: ctl.t, phase: ctl.scope ? ctl.scope.phase : "none" };
    calls.push(entry);
    let result;
    try {
      result = hostCall(name, args);
    } catch (e) {
      entry.error = e && e.message !== undefined ? String(e.message) : String(e);
      throw e;
    }
    if (result instanceof Promise) {
      entry.async = true;
      entry.settled = false;
      result.then(
        (value) => {
          entry.settled = true;
          entry.result = clone(value);
        },
        (e) => {
          entry.settled = true;
          entry.error = e && e.message !== undefined ? String(e.message) : String(e);
        },
      );
    } else {
      entry.result = clone(result);
    }
    return result;
  };
}

function exitOpen() {
  if (openFrame) {
    ctl.exit(openFrame);
    openFrame = null;
  }
}

function guard(fn) {
  try {
    return fn();
  } catch (e) {
    exitOpen();
    throw e;
  }
}

const ops = {
  setup(scenario, carried) {
    installConsole();
    ctl = createController(scenario);
    if (carried) {
      for (const dir of carried.dirs) ctl.mkdir(dir);
      for (const [path, text] of carried.files) ctl.externalWrite(path, text);
      if (carried.shared) ctl.shared = new Map(carried.shared);
      if (typeof carried.now === "number") ctl.setNow(carried.now);
    }
    trackFiles();
    recordCalls();
    if (scenario.patchDate !== false) ctl.patchDate();
    installMockWindow({ appearance: ctl._dark() ? "dark" : "light" });
    return { generation: ctl.generation, now: ctl.t };
  },

  generation() {
    return ctl.generation;
  },
  newGeneration() {
    return ctl.newGeneration();
  },
  cancelGeneration(g) {
    ctl.cancelGeneration(g);
  },

  construct(gen) {
    if (!ViewClass) throw new Error("harness: no view class adopted");
    pending = ctl.within("event", null, () => constructView(ViewClass), { gen });
    return { hasInit: typeof pending.init === "function", hasClose: typeof pending.close === "function" };
  },
  initBegin(gen) {
    // instantiate_for_view: init(undefined, asyncCx) in an Event scope where
    // the initializing instance counts as the running view.
    const { cx, frame } = ctl.enter("event", pending, { cx: "ambient", gen, initializing: pending });
    openFrame = frame;
    guard(() => {
      if (typeof pending.init === "function") pending.init(undefined, cx);
    });
  },
  initEnd() {
    exitOpen();
  },
  commit(gen) {
    instance = pending;
    pending = null;
    instanceGen = gen;
    tree = null;
    layoutOut = null;
  },
  abandon() {
    pending = null;
  },

  render() {
    if (!instance) throw new Error("harness: no view instance; call load() first");
    beginRender();
    tree = null;
    layoutOut = null;
    tree = ctl.within("render", instance, (cx) => instance.render(cx), { gen: instanceGen });
  },
  layout() {
    // Lazy lists render their items during layout (the render budget applies).
    layoutOut = ctl.within("layout", instance, (cx) => serialize(tree, { cx }), { gen: instanceGen });
  },
  takeTree() {
    return layoutOut;
  },

  fireBegin(id, event, payload) {
    if (!tree) throw new Error("harness: nothing rendered yet; call render() before fire()");
    const before = ctl.notifies.length;
    const { cx, frame } = ctl.enter("event", instance, { gen: instanceGen });
    openFrame = frame;
    return guard(() => {
      const result = fire(tree, id, event, payload === null ? undefined : payload, cx);
      return { before, returned: result instanceof Promise ? "promise" : clone(result) };
    });
  },
  fireEnd(before) {
    const stopped = !!(openFrame && openFrame.stopped);
    exitOpen();
    return { stopped, notified: ctl.notifies.length > before };
  },

  drainBegin() {
    const { frame } = ctl.enter("task", null, { gen: instanceGen });
    openFrame = frame;
  },
  drainEnd() {
    exitOpen();
  },

  now() {
    return ctl.t;
  },
  stepBegin(target) {
    return ctl.beginStep(target === null ? Infinity : target);
  },
  stepEnd() {
    ctl.endStep();
  },
  setClock(target) {
    if (target > ctl.t) ctl.t = target;
    return ctl.t;
  },

  closeBegin() {
    // lifecycle.rs start_close: a Task scope owned by the view; close(cx) gets
    // an async cx; errors are logged ("error in View.close"), not thrown.
    closing = { called: false, promise: false, settled: true };
    if (!instance || typeof instance.close !== "function") return closing;
    const { cx, frame } = ctl.enter("task", instance, { cx: "ambient", gen: instanceGen });
    openFrame = frame;
    closing.called = true;
    try {
      const result = instance.close(cx);
      if (result instanceof Promise) {
        closing.promise = true;
        closing.settled = false;
        result.then(
          () => {
            closing.settled = true;
          },
          (e) => {
            closing.settled = true;
            ctl._error(`error in View.close: ${describe(e)}`, e);
          },
        );
      }
    } catch (e) {
      ctl._error(`error in View.close: ${describe(e)}`, e);
    }
    return closing;
  },
  closeEnd() {
    exitOpen();
    return closing;
  },
  closeState() {
    return closing;
  },
  releaseAll() {
    // The VM is going away: every generation is released. Writes already
    // started still land (the write thread runs on), unanswered.
    for (let g = 1; g <= ctl.generation; g++) ctl.cancelGeneration(g);
    let steps = 0;
    while (ctl.beginStep(Infinity)) {
      ctl.endStep();
      if (++steps > 100000) throw new Error("harness: tasks kept firing after every generation was released");
    }
    instance = null;
    tree = null;
  },

  recover() {
    // After an interrupt nothing on the script stack ran its finally blocks.
    openFrame = null;
    if (ctl) ctl.scope = null;
  },

  pull() {
    const errors = ctl.errors.slice(errorsSeen).map((e) => ({ t: e.t, message: e.message }));
    errorsSeen = ctl.errors.length;
    const out = { calls, console: consoleLines, errors, filesRev, notifies: ctl.notifies.length - notifiesSeen };
    notifiesSeen = ctl.notifies.length;
    calls = [];
    consoleLines = [];
    return out;
  },
  disk() {
    return { files: [...ctl.files], dirs: [...ctl.dirs], shared: [...ctl.shared], now: ctl.t, rev: filesRev };
  },
  writeFile(path, text) {
    ctl.externalWrite(path, text);
  },
  pendingTasks() {
    return ctl.pendingTasks();
  },
};

export function dispatch(op, json) {
  const fn = ops[op];
  if (!fn) throw new Error(`harness: unknown bridge op ${op}`);
  const args = json === undefined ? [] : JSON.parse(json);
  const result = fn(...args);
  return result === undefined ? undefined : JSON.stringify(result);
}

/** Takes the entry module's namespace: herdr's load_source_with_lease check. */
export function adopt(namespace) {
  const value = namespace.default;
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    throw new Error("main.js must `export default` a class that extends View");
  }
  ViewClass = value;
}

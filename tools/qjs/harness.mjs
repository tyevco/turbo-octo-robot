// QuickJS-ng (wasm) host for one mod, faithful to herdr-app 0.1.18's script
// runtime (ARCHITECTURE A9). Paths below are relative to herdr-src.
//
//   sandbox        vendor/gpui-kit/crates/shell/src/engine/quickjs/sandbox.rs -> tools/qjs/sandbox.js
//   resolution     vendor/gpui-kit/crates/shell/src/engine/quickjs/mod.rs:5494-5745 (AppModules)
//   loader order   mod.rs:1824-1845 (built-ins first, the application's files last)
//   budgets        sandbox.rs:426-521; docs/research/mod-lifecycle.md §2
//   default export mod.rs:2423-2448
//   reload         vendor/gpui-kit/crates/shell/src/watch.rs:521-588
//   close          vendor/gpui-kit/crates/shell/src/engine/quickjs/lifecycle.rs:44-115
//
// Built-in modules are the mocks in tools/mock: "gpui-kit" and "gpui" expose
// only the real gpui-kit names (a mod importing a mock helper fails to link),
// "gpui-base" and "herdr" are the mock files themselves. The mocks' own
// relative imports resolve inside tools/mock under internal "mock:" names that
// a mod cannot reach.
//
//   const host = await createHost({ modRoot, scenario });
//   await host.load();                 // { ms: { moduleGraph, constructor, init } }
//   const { tree, ms } = host.render();
//   host.fire(id, "on_click", payload); host.advance(ms);
//   await host.reload();               // new ?v=N generation, same globalThis
//   host.restartVm();                  // close(cx) ≤ 250 ms, fresh VM, same disk
//   host.evalInVm(code, { module });   host.callsTo("writeTextFile");
//   host.dispose();

import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-ng-wasmfile-release-sync";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REAL_EXPORTS } from "../mock/gpui-kit.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOCK_DIR = path.join(HERE, "..", "mock");

/** sandbox.rs memory_limit_bytes. */
export const MEMORY_LIMIT = 256 * 1024 * 1024;
/**
 * sandbox.rs max_stack_size_bytes is 1 MiB. Under Node the wasm interpreter's
 * frames live on V8's native stack, which overflows (a host RangeError that
 * corrupts the VM) before QuickJS reaches 512 KiB, so the harness keeps
 * QuickJS's own default of 256 KiB: deep recursion fails earlier here than in
 * herdr, never later.
 */
export const MAX_STACK = 256 * 1024;
/** mod.rs MAX_MODULE_BYTES. */
export const MAX_MODULE_BYTES = 8 * 1024 * 1024;

/**
 * Per-phase budgets in ms (ARCHITECTURE A9, sandbox.rs Budgets). herdr gives
 * each scope its own clock: module evaluation runs in a Task scope, the
 * constructor and init in an Event scope, render and layout get the render
 * budget, each handler / timer callback (with the promise jobs drained in its
 * scope) the event budget. `detached` is for harness-internal calls.
 */
export const BUDGETS = Object.freeze({
  moduleGraph: 500,
  constructor: 500,
  init: 500,
  render: 50,
  layout: 50,
  event: 500,
  timer: 500,
  drain: 500,
  close: 250,
  detached: 5000,
});

/** What herdr's resolver error lists as built-ins (mod.rs builtin_specifiers). */
const REAL_BUILTIN_LIST = ["gpui-kit", "gpui", "gpui-base", "gpui-shell", "gpui-fps", "gpui-component"]
  .map((s) => `\`${s}\``)
  .join(", ");

/** Built-ins herdr has that this harness does not provide (A2 forbids them). */
const UNPROVIDED = new Set([
  "gpui-shell", "gpui-fps", "gpui-component",
  // qjs/standard/mod.rs:29-64
  "buffer", "console", "crypto", "fs/promises", "net", "os", "path", "process", "url", "websocket", "zlib",
]);

const BUILTINS = new Set(["gpui-kit", "gpui", "gpui-base", "herdr"]);
const INTERNAL_PREFIX = "mock:";
const BRIDGE_NAME = "harness:bridge";
// Resolution failures are reported through the loader (the normalizer cannot
// carry a message); the name never collides with a real one.
const ERROR_PREFIX = "harness:error/";

/** Globals quickjs-ng has that herdr's runtime is assumed not to (quickjs-runtime.md §5, A2 rule 4). */
const UNVERIFIED_GLOBALS = ["queueMicrotask", "structuredClone", "TextEncoder", "TextDecoder", "Intl"];

let modulePromise = null;
const sourceCache = new Map();

function quickjs() {
  modulePromise ??= newQuickJSWASMModuleFromVariant(variant);
  return modulePromise;
}

function mockSource(file) {
  if (!sourceCache.has(file)) sourceCache.set(file, readFileSync(path.join(MOCK_DIR, file), "utf8"));
  return sourceCache.get(file);
}

function harnessSource(file) {
  const key = `qjs/${file}`;
  if (!sourceCache.has(key)) sourceCache.set(key, readFileSync(path.join(HERE, file), "utf8"));
  return sourceCache.get(key);
}

const FACADE = `export { ${REAL_EXPORTS.join(", ")} } from "${INTERNAL_PREFIX}gpui-kit.js";\n`;

// ---------------------------------------------------------------------------
// Errors

/** A phase ran over its budget (interrupted, or finished late). */
export class BudgetError extends Error {
  constructor(phase, budget, ms, interrupted, cause) {
    super(
      interrupted
        ? `${phase} exceeded its ${budget} ms budget: interrupted after ${ms.toFixed(1)} ms`
        : `${phase} exceeded its ${budget} ms budget: took ${ms.toFixed(1)} ms`,
    );
    this.name = "BudgetError";
    this.phase = phase;
    this.budget = budget;
    this.ms = ms;
    this.interrupted = interrupted;
    if (cause) this.cause = cause;
  }
}

const ERROR_TYPES = { TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError };

/** A script error carried out of the VM: same class name and message, VM stack on `vmStack`. */
function vmError(dumped) {
  if (dumped instanceof Error) return dumped;
  const isObj = dumped && typeof dumped === "object";
  const name = isObj && typeof dumped.name === "string" ? dumped.name : "Error";
  const message = isObj ? String(dumped.message ?? JSON.stringify(dumped)) : String(dumped);
  const Ctor = ERROR_TYPES[name] ?? Error;
  const error = new Ctor(message);
  if (!ERROR_TYPES[name] && name !== "Error") error.name = name;
  error.vm = true;
  error.vmStack = isObj && typeof dumped.stack === "string" ? dumped.stack : "";
  if (isObj && dumped.stack) error.stack = `${error.name}: ${message}\n${dumped.stack}`;
  return error;
}

// ---------------------------------------------------------------------------
// Rust std::path helpers used by the resolver

function withExtensionJs(p) {
  // Path::with_extension("js"): replace the extension of the last component, or
  // add one; a name with no stem (".." / "/") is left unchanged.
  const dir = path.dirname(p);
  const base = path.basename(p);
  if (base === "" || base === ".." || base === ".") return p;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return path.join(dir, `${stem}.js`);
}

function startsWithPath(p, root) {
  return p === root || p.startsWith(root.endsWith("/") ? root : `${root}/`);
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function untag(name) {
  const i = name.indexOf("?v=");
  return i < 0 ? name : name.slice(0, i);
}

function generationOf(name) {
  const i = name.lastIndexOf("?v=");
  if (i < 0) return null;
  const n = Number(name.slice(i + 3));
  return Number.isInteger(n) ? n : null;
}

const IO_MESSAGES = {
  ENOENT: "No such file or directory (os error 2)",
  EACCES: "Permission denied (os error 13)",
  EISDIR: "Is a directory (os error 21)",
};

// ---------------------------------------------------------------------------
// The host

/**
 * @param {object} options
 * @param {string} options.modRoot   the mod folder (holds main.js)
 * @param {object} [options.scenario] mock herdr scenario (A7); JSON-able
 * @param {string} [options.entry]   entry file (default "main.js")
 * @param {object} [options.budgets] overrides for BUDGETS (tests)
 * @param {boolean} [options.enforceBudgets] default true
 * @param {boolean} [options.withholdUnverified] delete UNVERIFIED_GLOBALS (default true)
 * @param {object} [options.policy]  sandbox policy { development, strictBuiltins }
 */
export async function createHost(options) {
  const QJS = await quickjs();
  return new Host(QJS, options);
}

class Host {
  constructor(QJS, options = {}) {
    if (!options.modRoot) throw new TypeError("createHost({ modRoot }) needs the mod folder");
    this.QJS = QJS;
    this.root = realpathSync(options.modRoot);
    this.entry = options.entry ?? "main.js";
    this.scenario = JSON.parse(JSON.stringify(options.scenario ?? {}));
    this.policy = options.policy ?? {};
    // Host results follow the frozen-prototype rules only when the sandbox freezes (sandbox.rs install).
    if (this.scenario.frozenBuiltins === undefined) {
      this.scenario.frozenBuiltins = !this.policy.development && this.policy.strictBuiltins !== false;
    }
    this.budgets = { ...BUDGETS, ...(options.budgets ?? {}) };
    this.enforce = options.enforceBudgets !== false;
    this.withholdUnverified = options.withholdUnverified !== false;
    this.calls = [];
    this.console = [];
    this.errors = [];
    this.phases = [];
    this.files = new Map();
    this.dirs = [];
    this.shared = [];
    this.vmCount = 0;
    this.loaded = false;
    this._boot(null);
  }

  // -------------------------------------------------------------------------
  // VM lifetime

  _boot(carried) {
    this.vmCount += 1;
    this.applications = new Map(); // generation -> root (AppModules registrations)
    this.pendingCalls = new Map(); // async herdr calls of this VM still waiting to settle
    this.loadErrors = new Map();
    this.errorSeq = 0;
    this.deadline = null;
    this.interrupted = false;
    this.filesRev = -1;
    this.generation = 0;

    const rt = this.QJS.newRuntime();
    this.rt = rt;
    rt.setMemoryLimit(MEMORY_LIMIT);
    rt.setMaxStackSize(MAX_STACK);
    rt.setInterruptHandler(() => {
      if (this.deadline !== null && performance.now() > this.deadline) {
        this.interrupted = true;
        return true;
      }
      return false;
    });
    rt.setModuleLoader(
      (name) => this._load(name),
      (base, name) => this._resolve(base, name),
    );
    this.vm = rt.newContext();

    // 1. the bridge (and through it the mock built-ins, the controller, window)
    this._phase("detached", "boot", () => {
      const ns = this._evalModule(harnessSource("bridge.js"), BRIDGE_NAME);
      this.dispatchFn = this.vm.getProp(ns, "dispatch");
      this.adoptFn = this.vm.getProp(ns, "adopt");
      ns.dispose();
      const setup = this._call("setup", this.scenario, carried);
      this.generation = setup.generation;
      // 2. harness policy: globals quickjs-ng has but herdr is assumed not to.
      if (this.withholdUnverified) {
        this._evalGlobal(`for (const n of ${JSON.stringify(UNVERIFIED_GLOBALS)}) delete globalThis[n];`, "harness:unverified");
      }
      // 3. sandbox.rs install(), last.
      const install = this._evalGlobalHandle(harnessSource("sandbox.js"), "harness:sandbox");
      const policy = this._toHandle(this.policy);
      try {
        this._unwrap(this.vm.callFunction(install, this.vm.undefined, policy)).dispose();
      } finally {
        policy.dispose();
        install.dispose();
      }
    });
    this._pull();
  }

  _disposeVm() {
    for (const h of [this.dispatchFn, this.adoptFn]) if (h?.alive) h.dispose();
    this.dispatchFn = this.adoptFn = null;
    try {
      this.vm.dispose();
      this.rt.dispose();
    } catch (e) {
      // A leaked VM object aborts the shared wasm instance; later hosts get a
      // fresh one instead of inheriting the wreck.
      modulePromise = null;
      throw new Error(`harness: the QuickJS runtime could not be freed cleanly (${e.message})`);
    } finally {
      this.vm = this.rt = null;
    }
  }

  dispose() {
    if (this.vm) this._disposeVm();
  }

  // -------------------------------------------------------------------------
  // Module resolution (mod.rs AppModules + the built-in chain)

  _fail(message) {
    const key = `${ERROR_PREFIX}${++this.errorSeq}`;
    this.loadErrors.set(key, message);
    return key;
  }

  _isInternal(base) {
    return base === BRIDGE_NAME || BUILTINS.has(base) || base.startsWith(INTERNAL_PREFIX);
  }

  _resolve(base, name) {
    // runtime modules first: a host cannot take a built-in from under a script
    if (BUILTINS.has(name)) return name;
    if (UNPROVIDED.has(name)) {
      return this._fail(
        `harness: \`${name}\` is a herdr built-in the QuickJS harness does not provide ` +
          "(ARCHITECTURE A2: a mod imports only gpui-kit, gpui-base, herdr and its own files)",
      );
    }
    if (this._isInternal(base)) {
      if (name.startsWith(INTERNAL_PREFIX)) return name;
      if (name.startsWith("./")) {
        const from = base.startsWith(INTERNAL_PREFIX) ? path.posix.dirname(base.slice(INTERNAL_PREFIX.length)) : ".";
        const file = path.posix.normalize(path.posix.join(from, name));
        if (file.startsWith("..")) return this._fail(`harness: mock import \`${name}\` escapes tools/mock`);
        return INTERNAL_PREFIX + file;
      }
      return this._fail(`harness: cannot resolve \`${name}\` from built-in \`${base}\``);
    }

    // AppModules::resolve
    const generation = generationOf(base);
    const basePath = untag(base);
    const root = generation === null ? undefined : this.applications.get(generation);
    if (root === undefined || !startsWithPath(basePath, root)) {
      return this._fail(`cannot identify the application importing \`${name}\` from \`${base}\``);
    }
    // AppModules::candidate (no git dependencies in a herdr mod)
    const joined = name.startsWith(".") ? path.join(path.dirname(basePath), name) : path.resolve(root, name);
    let found = null;
    for (const candidate of [joined, withExtensionJs(joined)]) {
      if (isFile(candidate)) {
        try {
          found = realpathSync(candidate);
        } catch {
          found = null;
        }
        break;
      }
    }
    if (found === null) {
      if (!name.startsWith(".") && !name.includes("/")) {
        return this._fail(
          `cannot resolve module \`${name}\`: this runtime's built-in modules are ${REAL_BUILTIN_LIST}, ` +
            "and an application may otherwise import only its own files. If the script expects a module " +
            "this runtime does not have, the two are different versions.",
        );
      }
      return this._fail(`cannot resolve module \`${name}\` from \`${base}\``);
    }
    if (!startsWithPath(found, root)) {
      return this._fail(`module \`${name}\` resolves outside the application directory \`${root}\``);
    }
    return `${found}?v=${generation}`;
  }

  _load(name) {
    if (name.startsWith(ERROR_PREFIX)) {
      const message = this.loadErrors.get(name) ?? "harness: unknown resolution failure";
      return { error: new Error(message) };
    }
    if (name === "gpui-kit" || name === "gpui") return FACADE;
    if (name === "gpui-base") return mockSource("gpui-base.js");
    if (name === "herdr") return mockSource("herdr.js");
    if (name.startsWith(INTERNAL_PREFIX)) {
      try {
        return mockSource(name.slice(INTERNAL_PREFIX.length));
      } catch (e) {
        return { error: new Error(`harness: cannot read tools/mock/${name.slice(INTERNAL_PREFIX.length)}: ${e.message}`) };
      }
    }
    try {
      return this._readModule(untag(name));
    } catch (e) {
      return { error: new Error(e.message) };
    }
  }

  /** mod.rs read_module_source: 8 MiB limit, anyhow-style messages. */
  _readModule(file) {
    let size;
    try {
      size = statSync(file).size;
    } catch (e) {
      throw new Error(`reading module ${file}: ${IO_MESSAGES[e.code] ?? e.message}`);
    }
    if (size > MAX_MODULE_BYTES) {
      throw new Error(`module \`${file}\` is ${size} bytes, over the ${MAX_MODULE_BYTES}-byte limit`);
    }
    try {
      return readFileSync(file, "utf8");
    } catch (e) {
      throw new Error(`reading module ${file}: ${IO_MESSAGES[e.code] ?? e.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // VM plumbing

  _unwrap(result) {
    if (result.error) {
      const dumped = this._dump(result.error);
      result.error.dispose();
      throw vmError(dumped);
    }
    return result.value;
  }

  _dump(handle) {
    try {
      return this.vm.dump(handle);
    } catch (e) {
      return { name: "Error", message: `harness: could not read the VM value (${e.message})` };
    }
  }

  _toHandle(value) {
    const json = this.vm.newString(JSON.stringify(value ?? null));
    try {
      const parse = this._evalGlobalHandle("JSON.parse", "harness:json");
      try {
        return this._unwrap(this.vm.callFunction(parse, this.vm.undefined, json));
      } finally {
        parse.dispose();
      }
    } finally {
      json.dispose();
    }
  }

  _evalGlobalHandle(code, filename) {
    return this._unwrap(this.vm.evalCode(code, filename, { type: "global" }));
  }

  _evalGlobal(code, filename) {
    const h = this._evalGlobalHandle(code, filename);
    const value = this._dump(h);
    h.dispose();
    return value;
  }

  /** Runs promise jobs until none are left (inside whatever scope is open). */
  _drainJobs() {
    for (;;) {
      const result = this.rt.executePendingJobs(-1);
      if (result.error) {
        const dumped = this._dump(result.error);
        result.error.dispose();
        throw vmError(dumped);
      }
      if (result.value === 0) return;
    }
  }

  /** Evaluates module source under `name`, settles it (TLA), returns the namespace handle. */
  _evalModule(source, name) {
    const promise = this._unwrap(this.vm.evalCode(source, name, { type: "module" }));
    try {
      if (this.vm.typeof(promise) !== "object") return promise.dup();
      let state = this.vm.getPromiseState(promise);
      if (state.type === "pending") {
        this._drainJobs();
        state = this.vm.getPromiseState(promise);
      }
      if (state.type === "pending") throw new Error(`module ${name} did not finish evaluating (top-level await never settled)`);
      if (state.type === "rejected") {
        const dumped = this._dump(state.error);
        state.error.dispose();
        throw vmError(dumped);
      }
      // quickjs-ng may hand back the namespace itself rather than a promise
      if (state.notAPromise) return promise.dup();
      return state.value;
    } finally {
      promise.dispose();
    }
  }

  _call(op, ...args) {
    const vm = this.vm;
    const opHandle = vm.newString(op);
    const json = vm.newString(JSON.stringify(args));
    let out;
    try {
      out = this._unwrap(vm.callFunction(this.dispatchFn, vm.undefined, opHandle, json));
    } finally {
      opHandle.dispose();
      json.dispose();
    }
    try {
      if (vm.typeof(out) === "undefined") return undefined;
      return JSON.parse(vm.getString(out));
    } finally {
      out.dispose();
    }
  }

  /**
   * Runs fn under a deadline: the interrupt handler cuts the VM off at the
   * budget (an interrupt cannot be caught by script). Overruns throw a
   * BudgetError; the ms is recorded in host.phases.
   */
  _phase(kind, label, fn, { enforce = this.enforce, budget = this.budgets[kind] } = {}) {
    if (this.deadline !== null) throw new Error(`harness: ${label} started inside another phase`);
    const start = performance.now();
    this.deadline = start + budget;
    this.interrupted = false;
    let result;
    let error = null;
    try {
      result = fn();
    } catch (e) {
      error = e;
    }
    const ms = performance.now() - start;
    this.deadline = null;
    const interrupted = this.interrupted;
    this.interrupted = false;
    this.phases.push({ phase: kind, label, ms, budget, vm: this.vmCount });
    if (this.phases.length > 10000) this.phases.shift();
    if (interrupted) {
      this._recover();
      if (enforce) throw new BudgetError(label, budget, ms, true, error);
      return { result: undefined, ms, interrupted: true, error };
    }
    if (error) {
      this._recover();
      throw error;
    }
    if (enforce && ms > budget) throw new BudgetError(label, budget, ms, false);
    return { result, ms, interrupted: false };
  }

  _recover() {
    try {
      this._call("recover");
    } catch {
      // the VM is unusable; the next call will say so
    }
  }

  _pull() {
    const out = this._call("pull");
    for (const c of out.calls) {
      c.vm = this.vmCount;
      this.calls.push(c);
      if (c.async) this.pendingCalls.set(c.id, c);
    }
    for (const u of out.callUpdates) {
      const c = this.pendingCalls.get(u.id);
      if (!c) continue;
      this.pendingCalls.delete(u.id);
      c.settled = true;
      c.settledAt = u.t;
      if ("error" in u) c.error = u.error;
      else c.result = u.result;
    }
    for (const l of out.console) this.console.push(l);
    for (const e of out.errors) this.errors.push(e);
    if (out.filesRev !== this.filesRev) this._syncDisk();
    return out;
  }

  _syncDisk() {
    const disk = this._call("disk");
    this.files = new Map(disk.files);
    this.dirs = disk.dirs;
    this.shared = disk.shared;
    this.now = disk.now;
    this.filesRev = disk.rev;
    return disk;
  }

  // -------------------------------------------------------------------------
  // Lifecycle

  /**
   * Evaluates the graph, constructs and inits one generation. A first load
   * (plugin.rs try_load -> instantiate_view_with_policy) gives the constructor
   * and init a scope (and so a budget) each; a reload (watch.rs reload ->
   * instantiate_for_view) runs both inside ONE Event scope, so they share one
   * 500 ms budget.
   */
  _loadGeneration(gen, { reload = false } = {}) {
    this.applications.set(gen, this.root);
    const entryPath = path.join(this.root, this.entry);
    const entryName = `${entryPath}?v=${gen}`;
    const ms = {};
    try {
      ms.moduleGraph = this._phase("moduleGraph", "module graph", () => {
        const source = this._readModule(entryPath);
        const ns = this._evalModule(source, entryName);
        try {
          this._unwrap(this.vm.callFunction(this.adoptFn, this.vm.undefined, ns)).dispose();
        } finally {
          ns.dispose();
        }
      }).ms;
      const init = () => {
        this._call("initBegin", gen);
        try {
          this._drainJobs();
        } finally {
          this._call("initEnd");
        }
      };
      if (reload) {
        let split = 0;
        const both = this._phase("init", "constructor + init (one reload scope)", () => {
          const start = performance.now();
          this._call("construct", gen);
          split = performance.now() - start;
          init();
        });
        ms.constructor = split;
        ms.init = both.ms - split;
        ms.instantiate = both.ms;
      } else {
        ms.constructor = this._phase("constructor", "constructor", () => this._call("construct", gen)).ms;
        ms.init = this._phase("init", "init", init).ms;
      }
    } catch (e) {
      this.applications.delete(gen);
      try {
        this._call("abandon");
      } catch {
        // VM unusable
      }
      this._pull();
      throw e;
    }
    this._call("commit", gen);
    this._pull();
    return ms;
  }

  /** Evaluates the module graph, constructs the view and runs init. */
  async load() {
    return this._loadSync();
  }

  _loadSync() {
    if (this.loaded) throw new Error("harness: already loaded; use reload() or restartVm()");
    const gen = this._call("generation");
    const ms = this._loadGeneration(gen);
    this.generation = gen;
    this.loaded = true;
    return { ms, generation: gen };
  }

  /**
   * watch.rs reload: same VM and globalThis; the graph is evaluated again under
   * a new `?v=N` specifier; a new instance is constructed and init runs; only
   * then is the old generation released (its timers stop, its promises never
   * settle). If any step fails the old instance keeps running.
   */
  async reload() {
    if (!this.loaded) throw new Error("harness: load() first");
    const oldGen = this.generation;
    const newGen = this._call("newGeneration");
    let ms;
    try {
      ms = this._loadGeneration(newGen, { reload: true });
    } catch (e) {
      this._call("cancelGeneration", newGen);
      this._pull();
      throw e;
    }
    this._call("cancelGeneration", oldGen);
    this.applications.delete(oldGen);
    this.generation = newGen;
    this._pull();
    return { ms, generation: newGen, released: oldGen };
  }

  /**
   * VM restart (src/window.rs restart_mods): close(cx) gets 250 ms (real time,
   * and the virtual clock may move 250 ms while its awaits are pumped), every
   * generation is released (started writes still land), the VM is disposed and
   * a fresh one loads the same mod with the same disk. globalThis starts empty.
   */
  restartVm() {
    const close = { called: false, settled: true, interrupted: false, ms: 0 };
    if (this.loaded) {
      const budget = this.budgets.close;
      const start = performance.now();
      const virtualDeadline = this._call("now") + budget;
      const run = this._phase(
        "close",
        "close",
        () => {
          let state = this._call("closeBegin");
          try {
            this._drainJobs();
          } finally {
            state = this._call("closeEnd");
          }
          while (!state.settled && performance.now() - start < budget) {
            if (!this._call("stepBegin", virtualDeadline)) break;
            try {
              this._drainJobs();
            } finally {
              this._call("stepEnd");
            }
            state = this._call("closeState");
          }
          return state;
        },
        { enforce: false },
      );
      close.ms = run.ms;
      close.interrupted = run.interrupted;
      if (run.result) {
        close.called = run.result.called;
        close.settled = run.result.settled;
      } else {
        close.called = true;
        close.settled = false;
      }
      this._phase("detached", "release", () => this._call("releaseAll"));
    }
    this._pull();
    const disk = this._syncDisk();
    const carried = { files: disk.files, dirs: disk.dirs, shared: disk.shared, now: disk.now };
    this._disposeVm();
    this.loaded = false;
    this._boot(carried);
    const load = this._loadSync();
    return { close, ...load };
  }

  // -------------------------------------------------------------------------
  // Driving the view

  /** Runs render (50 ms) and layout (50 ms); returns the JSON tree and timings. */
  render() {
    const render = this._phase("render", "render", () => this._call("render"));
    const layout = this._phase("layout", "layout", () => this._call("layout"));
    const { result: tree } = this._phase("detached", "serialize", () => this._call("takeTree"));
    this._pull();
    return { tree, ms: render.ms, layoutMs: layout.ms };
  }

  /**
   * Invokes the handler recorded for `event` on the element `id` of the last
   * render, in an Event scope, then drains promise jobs in that scope; one
   * event budget covers both.
   */
  fire(id, event, payload) {
    let begin;
    let end;
    const run = this._phase("event", `${event} on ${id}`, () => {
      begin = this._call("fireBegin", String(id), String(event), payload === undefined ? null : payload);
      try {
        this._drainJobs();
      } finally {
        end = this._call("fireEnd", begin?.before ?? 0);
      }
    });
    this._pull();
    return { returned: begin.returned, stopped: end.stopped, notified: end.notified, ms: run.ms };
  }

  /**
   * Moves the virtual clock by ms: drains pending jobs (own budget), then every
   * host settlement and timer due by then, in order, each with its promise jobs
   * drained in its task scope (one timer budget per step).
   */
  advance(ms = 0) {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new TypeError(`advance(ms) expects a finite non-negative number, got ${ms}`);
    }
    const target = this._call("now") + ms;
    const drain = this._phase("drain", "promise drain", () => {
      this._call("drainBegin");
      try {
        this._drainJobs();
      } finally {
        this._call("drainEnd");
      }
    });
    const steps = [];
    for (;;) {
      let fired = false;
      const step = this._phase("timer", "timer / task step", () => {
        fired = this._call("stepBegin", target);
        if (!fired) return;
        try {
          this._drainJobs();
        } finally {
          this._call("stepEnd");
        }
      });
      if (!fired) break;
      steps.push(step.ms);
      if (steps.length > 1000000) throw new Error("harness: more than 1000000 steps in one advance()");
    }
    const now = this._call("setClock", target);
    const pulled = this._pull();
    return { now, steps: steps.length, stepMs: steps, drainMs: drain.ms, errors: pulled.errors };
  }

  // -------------------------------------------------------------------------
  // Inspection

  /**
   * Evaluates code in the VM (after the sandbox; 5 s budget). Global code by
   * default (sloppy, like a REPL); `{ module: true }` evaluates module code
   * (strict, can import built-ins) and returns its exports. Returns the value
   * as JSON-ish data; VM errors are thrown with their class and message.
   */
  evalInVm(code, { module = false, name } = {}) {
    const { result } = this._phase("detached", "evalInVm", () => {
      if (module) {
        const ns = this._evalModule(code, name ?? `harness:eval-${++this.errorSeq}`);
        const value = this._dump(ns);
        ns.dispose();
        return value;
      }
      return this._evalGlobal(code, name ?? "harness:eval");
    });
    this._pull();
    return result;
  }

  /**
   * Recorded herdr calls to `fn`, across VM restarts:
   * { fn, args, t, phase, vm, result | error } and, for async calls,
   * { async: true, settled, settledAt } (a call of a released generation never settles).
   */
  callsTo(fn) {
    this._pull();
    return this.calls.filter((c) => c.fn === fn);
  }

  /** Outstanding mock scheduler tasks (timers, sleeps, host calls). */
  pendingTasks() {
    return this._call("pendingTasks");
  }

  /** The text of a file on the mock disk, or null. */
  readFile(p) {
    this._pull();
    return this.files.get(p) ?? null;
  }

  /** Someone else writes a file (null deletes it). */
  writeFile(p, text) {
    this._call("writeFile", p, text);
    this._pull();
  }

  /** Last ms recorded for each phase kind. */
  lastMs() {
    const out = {};
    for (const p of this.phases) if (p.vm === this.vmCount) out[p.phase] = p.ms;
    return out;
  }
}

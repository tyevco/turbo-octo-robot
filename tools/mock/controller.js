// Mock herdr host: scenario state, a virtual clock, the `cx` factory and a file
// system with herdr's compare-and-swap writes. `createController(scenario)`
// installs the controller at `globalThis.__herdr`; `tools/mock/herdr.js` (the
// "herdr" module mods import) forwards every call to it.
//
// Faithful to herdr-app 0.1.18 (paths relative to herdr-src):
//   herdr module          src/mods.rs:1115-1371
//   argument bridge       vendor/gpui-kit/crates/shell/src/engine/quickjs/host_modules.rs:79-463
//   host errors           "`herdr.<fn>`: <message>" (host_modules.rs:148,157,358)
//   scheduler / timers    vendor/gpui-kit/crates/shell/src/engine/quickjs/scheduler.rs
//   cx members            vendor/gpui-kit/crates/shell/src/engine/quickjs/mod.rs:7033-7090,10017-10140
//   scope phases          vendor/gpui-kit/crates/shell/src/scope.rs:37-62,405-421
//   text files            src/mod_files.rs
//   commands              src/commands.rs, src/window.rs:3076-3125 (see commands.js)
//   theme / settings      src/settings.rs (see theme-resolve.js)
//
// Time is virtual. Host async calls (readTextFile, writeTextFile, nextCommand)
// never settle synchronously: they settle when the clock is stepped
// (`advance(ms)`, `flush()`), in creation order with due timers, like the real
// foreground executor. Each step opens a "task" scope; in Node the promise jobs
// it unblocks are drained inside that scope before the next step.
//
// Plain ES module (no Node APIs at import time): it also runs inside the
// QuickJS harness, which drives it with beginStep()/endStep() and its own job
// drain instead of advance().

import * as commands from "./commands.js";
import { resolveNamed, allThemes, isLight, PALETTES } from "./theme-resolve.js";

// ---------------------------------------------------------------------------
// Constants and exact message texts
// ---------------------------------------------------------------------------

export const FILE_LIMIT = 1024 * 1024; // src/mod_files.rs:8
const MAX_TASKS = 1024; // scheduler.rs MAX_OUTSTANDING_TASKS_PER_RUNTIME
const MAX_DEPTH = 16; // host_modules.rs:79
const MAX_ARRAY = 10000; // host_modules.rs:86
const ASYNC_API = "a HostModule's async function";
export const DEFAULT_NOW = 1767258000000; // 2026-01-01T09:00:00Z

export const MESSAGES = {
  stale:
    "cx is no longer valid: it was captured during an earlier call and used later. " +
    "Use cx.spawn or take cx from the callback arguments instead.",
  ended: "this cx belongs to a build of the script that was reloaded or closed; its tasks have to stop",
  noHostCall:
    "this cx has no host call to speak for. An async cx works inside the task that owns it — " +
    "from a handler the scheduler resumed — not from a bare promise callback or after the task was cancelled.",
  focusInRender:
    "cx.focus_handle() cannot run during render; a handle created there would be a new one every frame, " +
    "so the focus it tracks would be dropped by the next repaint. Create it in init() or in an event " +
    "handler and keep it on the view",
  ownerType: "opts.owner must be a view instance, or null for a task that outlives every view",
  ownerOther:
    "opts.owner must be the view that is running, or null; a task cannot yet be owned by another view",
  entity: "cx.notify(entity) expects an Entity",
  bindKeys: "cx.bind_keys(bindings) expects an array of { keystroke, action, context? }",
  callback: "a host function cannot be passed a callback; host calls take and return plain data only",
  depth: `a host argument may not nest more than ${MAX_DEPTH} levels deep`,
  unsupported:
    "unsupported host argument; expected null, a boolean, a number, a string, an array or a plain object",
  tooBig: "Text file exceeds 1 MiB",
  badUtf8: "stream did not contain valid UTF-8",
  notRegular: "Not a regular file",
  notDir: "Not a directory (os error 20)",
  exists: "File exists (os error 17)",
  isDir: "Is a directory (os error 21)",
  noParent: "File needs a parent directory",
  changedOutside: "The file changed outside Herdr. Reload before saving; your draft is still here.",
  changedWhileSaving: "The file changed while saving. Reload before saving.",
  shuttingDown: "herdr-app is shutting down",
  overlaySpec: 'openOverlay needs { mod: "<folder>" } or { layout: {...} }',
};

export const notifyPhaseMessage = (api, phase) =>
  `${api} is not allowed during the \`${phase}\` phase; request a re-render from an event handler instead`;
export const outsideHostCallMessage = (api) =>
  `${api} was called with no host call in progress. It needs the window and app of a live call, ` +
  "so call it from render, from an event handler, or from a task the scheduler resumed — not from a bare promise callback.";
export const durationMessage = (api, ms) => `${api} expects a non-negative number of milliseconds, got ${rustF64(ms)}`;
export const durationRangeMessage = (api) => `${api} milliseconds are outside the supported duration range`;
export const taskLimitMessage = (api) =>
  `${api} exceeded the per-runtime outstanding host task limit of ${MAX_TASKS}`;

/** A `HostError`: becomes "`herdr.<fn>`: <message>" at the call site. */
class HostError extends Error {}

/** Rust's `Display` for an f64, for the messages that print one. */
function rustF64(n) {
  if (Number.isNaN(n)) return "NaN";
  if (n === Infinity) return "inf";
  if (n === -Infinity) return "-inf";
  if (Number.isInteger(n)) {
    if (Object.is(n, -0)) return "-0";
    return Math.abs(n) < 1e21 ? String(n) : BigInt(n).toString();
  }
  return String(n);
}

/** rquickjs's name for a value's type, for argument conversion errors. */
function jsType(v) {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  if (typeof v === "string") return "string";
  if (typeof v === "symbol") return "symbol";
  if (typeof v === "bigint") return "bigint";
  if (typeof v === "function") return "function";
  if (Array.isArray(v)) return "array";
  if (v instanceof Promise) return "promise";
  if (v instanceof Error) return "exception";
  return "object";
}
const conversion = (v, to) => new TypeError(`Error converting from js '${jsType(v)}' into type '${to}'`);

/** How the scheduler logs a thrown value (scheduler.rs describe_value). */
export function describe(value) {
  if (value instanceof Error) {
    const message = value.message || "error";
    return value.stack ? `${message}\n${value.stack}` : message;
  }
  if (typeof value === "string") return value;
  try {
    const text = JSON.stringify(value);
    if (text !== undefined) return text;
  } catch {
    // fall through
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// The argument bridge (JS <-> HostValue <-> serde_json)
// ---------------------------------------------------------------------------

/** Sets a data key without ever reaching a setter (a key may be "__proto__"). */
function put(obj, key, value) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

/** JS argument -> HostValue (host_modules.rs from_js). Throws the bridge's TypeErrors. */
export function bridgeIn(v, depth = 0) {
  if (depth > MAX_DEPTH) throw new TypeError(MESSAGES.depth);
  if (v === null || v === undefined) return null;
  const t = typeof v;
  if (t === "boolean" || t === "number" || t === "string") return v;
  if (Array.isArray(v)) {
    if (v.length > MAX_ARRAY) {
      throw new RangeError(`array has ${v.length} items, over the ${MAX_ARRAY}-item bridge limit`);
    }
    const out = [];
    for (let i = 0; i < v.length; i++) out.push(bridgeIn(v[i], depth + 1));
    return out;
  }
  if (t === "function") throw new TypeError(MESSAGES.callback);
  if (t === "object") {
    const out = {};
    for (const key of Object.keys(v)) put(out, key, bridgeIn(v[key], depth + 1));
    return out;
  }
  throw new TypeError(MESSAGES.unsupported);
}

/** HostValue -> serde_json::Value (src/mods.rs from_host): NaN and ±Infinity become null. */
export function toSerde(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) return v.map(toSerde);
  if (typeof v === "object") {
    const out = {};
    for (const key of Object.keys(v)) put(out, key, toSerde(v[key]));
    return out;
  }
  return v;
}

/**
 * A fresh copy handed back to script (host values are never shared objects).
 *
 * host_modules.rs `into_js` builds objects with rquickjs `Object::set`, i.e.
 * `JS_SetProperty` with `JS_PROP_THROW`: ordinary assignment, not a data
 * definition. Under herdr's frozen `Object.prototype` (sandbox.rs
 * FREEZE_BUILTINS) that means a key naming one of its data properties
 * (`constructor`, `toString`, `hasOwnProperty`, …) throws
 * "'<key>' is read-only" at the call site, and a `__proto__` key goes through
 * the accessor (an object or null value becomes the prototype; anything else
 * is dropped). `frozen` (default true, herdr's policy) applies that rule even
 * where the running realm's prototypes are not frozen (Node).
 */
export function bridgeOut(v, frozen = true) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map((item) => bridgeOut(item, frozen));
  if (typeof v === "object") {
    const out = {};
    for (const key of Object.keys(v)) {
      const value = bridgeOut(v[key], frozen);
      if (key === "__proto__") {
        if (value === null || typeof value === "object") Object.setPrototypeOf(out, value);
      } else if (frozen && Object.hasOwn(Object.prototype, key) && !Object.hasOwn(out, key)) {
        throw new TypeError(`'${key}' is read-only`);
      } else {
        put(out, key, value);
      }
    }
    return out;
  }
  return v;
}

const describeHost = (v) =>
  v === null ? "null"
    : typeof v === "boolean" ? "a boolean"
    : typeof v === "number" ? "a number"
    : typeof v === "string" ? "a string"
    : Array.isArray(v) ? "an array"
    : "an object";

/** `HostArguments`: positional access with the registry's messages. */
class Args {
  constructor(values) {
    this.values = values;
  }
  get(i) {
    return i < this.values.length ? this.values[i] : undefined;
  }
  value(i) {
    if (i >= this.values.length) {
      throw new HostError(`argument ${i + 1} is missing; ${this.values.length} were passed`);
    }
    return this.values[i];
  }
  string(i) {
    const v = this.value(i);
    if (typeof v !== "string") throw new HostError(`argument ${i + 1} must be a string, got ${describeHost(v)}`);
    return v;
  }
}

const optStr = (v, key) =>
  v !== null && typeof v === "object" && !Array.isArray(v) && typeof v[key] === "string" ? v[key] : null;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Structural equality of serde values (object key order does not matter). */
function sameValue(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && sameValue(a[k], b[k]));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Text sizes (no TextEncoder in the sandbox)
// ---------------------------------------------------------------------------

/**
 * UTF-8 byte length of a JS string (a lone surrogate counts as U+FFFD, 3
 * bytes). The string's length plus the extra bytes of each non-ASCII
 * character, found by the regex engine: herdr measures a file natively, off
 * the script's task step, and in the QuickJS harness this mock runs inside the
 * VM, so a character loop over a 500 KiB save would add hundreds of ms to the
 * step it settles in (the budget the harness measures).
 */
export function utf8Length(s) {
  let n = s.length;
  const wide = /[\u0080-\u07ff]|[\ud800-\udbff][\udc00-\udfff]|[\u0800-\uffff]/g;
  for (let m = wide.exec(s); m !== null; m = wide.exec(s)) {
    // 2 bytes for one unit (+1); a pair is 4 bytes for two units (+2); 3 bytes for one unit (+2)
    n += m[0].length === 2 || m[0].charCodeAt(0) >= 0x800 ? 2 : 1;
  }
  return n;
}

/** Whether a character boundary falls exactly `bytes` into the UTF-8 encoding. */
function boundaryAt(s, bytes) {
  let n = 0;
  for (let i = 0; i < s.length && n < bytes; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n === bytes;
}

// ---------------------------------------------------------------------------
// Scenario defaults
// ---------------------------------------------------------------------------

export const DEFAULT_PROGRAM = Object.freeze({
  key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: false,
  tile: "#1c1d21", color: "#ffffff", shell: false, agent: true,
});

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const rollup = (list) => list.reduce((best, s) => (s && (!best || RANK[s] > RANK[best]) ? s : best), null);

/** One agents() entry with every field, in herdr.d.ts order. */
export function normalizeAgent(a, i = 0) {
  const n = i + 1;
  return {
    address: a.address ?? `t${n}`,
    pane: a.pane ?? `p${n}`,
    space: a.space ?? "s1",
    space_name: a.space_name ?? "~",
    tab: a.tab ?? "c1",
    tab_index: a.tab_index ?? 1,
    tab_name: a.tab_name ?? String(a.tab_index ?? 1),
    status: a.status ?? "idle",
    app: a.app ?? null,
    program: { ...DEFAULT_PROGRAM, ...(a.program ?? {}) },
    title: a.title ?? "",
    pane_name: a.pane_name ?? null,
    seq: a.seq ?? n,
    pinned: a.pinned ?? false,
    focused: a.focused ?? false,
  };
}

/** One terminals() entry: the fields the core and herdr add, then the scenario's own. */
export function normalizeTerminal(t, i = 0) {
  const status = t.status ?? null;
  const base = {
    address: t.address ?? `t${i + 1}`,
    state: "live",
    status,
    report: status === null ? null : { state: status },
    parent: null,
    turn: 0,
    title: "",
    name: null,
    labels: {},
    created_ms: DEFAULT_NOW,
    program: { ...DEFAULT_PROGRAM, ...(t.program ?? {}) },
    keep: false,
    selection: null,
  };
  const out = {};
  for (const k of Object.keys(base)) put(out, k, base[k]);
  for (const k of Object.keys(t)) if (k !== "program") put(out, k, t[k]);
  return out;
}

// ---------------------------------------------------------------------------
// The controller
// ---------------------------------------------------------------------------

let NEXT_FRAME = 1;

class Frame {
  constructor(phase, owner, gen, extra = {}) {
    this.id = NEXT_FRAME++;
    this.phase = phase;
    this.owner = owner ?? null;
    this.gen = gen;
    this.live = true;
    this.stopped = false;
    this.initializing = extra.initializing ?? null;
    // The copy's application generation (herdr: one per loaded copy); null outside any copy.
    this.app = extra.app ?? null;
    this.prev = null;
  }
}

const PHASES = ["render", "event", "task", "layout"];

export class Controller {
  constructor(scenario = {}) {
    const sc = scenario ?? {};
    this.scenario = sc;
    this.strict = sc.strict ?? true;
    // sandbox.rs FREEZE_BUILTINS (herdr's policy; the QuickJS harness sets it from its sandbox policy).
    this.frozenBuiltins = sc.frozenBuiltins ?? true;
    this.strictRun = sc.strictRun ?? false;
    this.modName = sc.mod ?? null;
    this.latency = { read: 0, write: 0, command: 0, ...(sc.latency ?? {}) };
    this.maxSteps = sc.maxSteps ?? 1000000;

    // clock and scheduler
    this.t = sc.now ?? DEFAULT_NOW;
    this.seq = 0;
    this.generation = 1;
    this.deadGens = new Set();
    this.deadOwners = new Set();
    // herdr gives every loaded copy its own ApplicationGeneration
    // (quickjs/mod.rs load_app); every task records the one current when it
    // was made, whatever its owner (scheduler.rs TaskState::new).
    this.apps = new WeakMap();
    this.nextApp = 1;
    this.deadApps = new Set();
    this.tasks = new Map();
    this.nextTask = 1;
    this.scope = null;
    this.drain = defaultDrain;
    this._dateNow = null;

    // live data
    this.revisions = Object.create(null);
    this.listeners = [];
    this.checkingMode = !!sc.checking;
    this.homeDir = sc.home ?? "/home/player";
    this.appHomeDir = sc.appHome ?? `${this.homeDir}/.config/herdr-app`;
    this.windowState = sc.window === null ? null : { ...(sc.window ?? {}) };
    this.zoom = sc.zoom ?? 1;
    this.themeName = sc.theme ?? "graphite";
    // r5-01: the window appearance, apart from the theme. null: in step with the
    // theme (what the app.theme picker writes, a light/dark pair). "light" /
    // "dark": a single-name theme ("theme": "paper") on that appearance, so
    // settings().dark can disagree with the theme showing (settings.rs compose,
    // layout.rs ThemeChoice::pick gives the one name for both appearances).
    this.appearance = sc.appearance === "light" || sc.appearance === "dark" ? sc.appearance : null;
    this.colors = { ...(sc.colors ?? {}) };
    this.settingsOverrides = { ...(sc.settings ?? {}) };
    this.propsValue = sc.props === undefined ? null : bridgeIn(sc.props);
    this.agentsList = (sc.agents ?? []).map(normalizeAgent);
    this.terminalsList = (sc.terminals ?? []).map(normalizeTerminal);
    this.explicit = {
      spaces: sc.spaces ?? null,
      panes: sc.panes ?? null,
      focused: sc.focused,
    };
    // The shown layout tree (herdr's chrome as layout() returns it). A copy, so
    // layout.* runs (applied here, as the window does) never change the caller's object.
    this.layoutValue = sc.layout === undefined || sc.layout === null ? null : JSON.parse(JSON.stringify(sc.layout));
    this.layoutNames = sc.layouts ?? ["main"];
    this.keyList = sc.keys ?? [];
    this.fontList = sc.fonts ?? ["Geist", "Geist Mono", "JetBrains Mono"];
    this.placementValue = sc.placement ?? null;

    // state the mod changes, and what it did
    this.shared = new Map(Object.entries(sc.shared ?? {}).map(([k, v]) => [k, toSerde(bridgeIn(v))]));
    this.overlaySeq = 0;
    this.overlays = new Map();
    // herdr makes one command channel per loaded copy (src/mods.rs:1125-1129) and
    // send_command puts a command into every shown copy's channel (mods.rs:785-799):
    // app generation (null: a scope outside any copy) -> { app, gen, queue }.
    this.channels = new Map();
    this.shuttingDown = false;
    this.clipboard = undefined;
    this.focusedHandle = null;
    this.nextHandle = 1;
    this.log = [];
    this.runs = [];
    this.notifications = [];
    this.toasts = [];
    this.errors = [];
    this.notifies = [];
    this.writes = [];
    this.recorded = { playSound: [], setBadge: [], setWindowTitle: [], setAgentOrder: [] };
    this.counts = Object.create(null);
    this.calls = [];
    this.callLogLimit = sc.callLogLimit ?? 5000;

    // files
    this.files = new Map();
    this.dirs = new Set(["/"]);
    this.cwd = sc.cwd ?? "/";
    this.relativeWarned = new Set();
    this._mkdirAll(this.homeDir);
    this._mkdirAll(this.appHomeDir);
    for (const [path, text] of Object.entries(sc.files ?? {})) this.externalWrite(path, text);
    this.failQueue = [];
    this.raceQueue = [];

    // localStorage: herdr gives each copy its own store, keyed by its props
    // (src/mods.rs mod_policy: store-<hash(props)>.json). Opt-in
    // (`localStorage: true`, or { [JSON props]: { key: value } } to start
    // from stores a previous run left): installed at globalThis.localStorage.
    this.propsByApp = new Map();
    this.localStores = null;
    this._savedLocalStorage = undefined;
    if (sc.localStorage) this.installLocalStorage(sc.localStorage === true ? {} : sc.localStorage);

    if (sc.patchDate) this.patchDate();
  }

  /** The store key of the copy running now: its props as JSON ("null" outside any copy). */
  _storeKey() {
    const app = this.scope ? this.scope.app : null;
    const props = app != null && this.propsByApp.has(app) ? this.propsByApp.get(app) : null;
    return JSON.stringify(props ?? null);
  }

  /** Installs a per-copy localStorage (see the constructor); `initial` = { [JSON props]: { key: value } }. */
  installLocalStorage(initial = {}) {
    this.localStores = new Map(Object.entries(initial).map(([k, v]) => [k, new Map(Object.entries(v ?? {}).map(([a, b]) => [a, String(b)]))]));
    const ctl = this;
    const store = () => {
      const k = ctl._storeKey();
      if (!ctl.localStores.has(k)) ctl.localStores.set(k, new Map());
      return ctl.localStores.get(k);
    };
    const ls = {
      getItem: (k) => (store().has(String(k)) ? store().get(String(k)) : null),
      setItem: (k, v) => void store().set(String(k), String(v)),
      removeItem: (k) => void store().delete(String(k)),
      clear: () => store().clear(),
      key: (i) => [...store().keys()][i] ?? null,
      get length() {
        return store().size;
      },
    };
    if (this._savedLocalStorage === undefined) this._savedLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage") ?? null;
    Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true, writable: true, enumerable: false });
  }

  /** Every copy's store as plain data: { [JSON props]: { key: value } } (pass it as a later scenario's `localStorage`). */
  localStorageDump() {
    const out = {};
    if (!this.localStores) return out;
    for (const [k, m] of this.localStores) out[k] = Object.fromEntries(m);
    return out;
  }

  _uninstallLocalStorage() {
    if (this._savedLocalStorage === undefined) return;
    if (this._savedLocalStorage) Object.defineProperty(globalThis, "localStorage", this._savedLocalStorage);
    else delete globalThis.localStorage;
    this._savedLocalStorage = undefined;
  }

  // -------------------------------------------------------------------------
  // Clock
  // -------------------------------------------------------------------------

  now() {
    return this.t;
  }

  /** Moves the clock without running anything (forward or back; for set-up only). */
  setNow(t) {
    this.t = t;
  }

  /** Makes `Date.now()` read the virtual clock (glue's clock.js uses it). */
  patchDate() {
    if (this._dateNow) return;
    this._dateNow = Date.now;
    Date.now = () => this.t;
  }

  unpatchDate() {
    if (!this._dateNow) return;
    Date.now = this._dateNow;
    this._dateNow = null;
  }

  /**
   * Runs everything due up to now + ms in time order (host settlements and timers
   * interleaved by due time, then creation order), draining promise jobs after each
   * inside its task scope; then sets the clock to now + ms.
   */
  async advance(ms = 0) {
    if (typeof ms !== "number" || !(ms >= 0) || !Number.isFinite(ms)) {
      throw new TypeError(`advance(ms) expects a finite non-negative number, got ${ms}`);
    }
    if (this.scope) throw new Error("mock: advance() inside an open scope; finish the call first");
    const target = this.t + ms;
    await this._drainIn(new Frame("task", null, this.generation));
    let steps = 0;
    while (this.beginStep(target)) {
      try {
        await this.drain();
      } finally {
        this.endStep();
      }
      if (++steps > this.maxSteps) throw new Error(`mock: more than ${this.maxSteps} steps in one advance()`);
    }
    if (target > this.t) this.t = target;
    return this.t;
  }

  /** Settles whatever is ready now (advance(0)). */
  flush() {
    return this.advance(0);
  }

  /** advance() for a host that drains promise jobs itself, synchronously (QuickJS). */
  advanceSync(ms, drainJobs) {
    const target = this.t + ms;
    let steps = 0;
    while (this.beginStep(target)) {
      try {
        drainJobs();
      } finally {
        this.endStep();
      }
      if (++steps > this.maxSteps) throw new Error(`mock: more than ${this.maxSteps} steps in one advance()`);
    }
    if (target > this.t) this.t = target;
    return this.t;
  }

  async _drainIn(frame) {
    frame.prev = this.scope;
    this.scope = frame;
    try {
      await this.drain();
    } finally {
      frame.live = false;
      this.scope = frame.prev;
    }
  }

  /** The next event due at or before `target`, or null. */
  _next(target) {
    let best = null;
    for (const t of this.tasks.values()) {
      if (t.due === undefined || t.due > target) continue;
      if (t.ready && !t.ready()) continue;
      if (!best || t.due < best.due || (t.due === best.due && t.seq < best.seq)) best = t;
    }
    return best;
  }

  /** When the next event is due (null if nothing is scheduled or waiting). */
  nextDue() {
    let due = null;
    for (const t of this.tasks.values()) {
      if (t.due === undefined || (t.ready && !t.ready())) continue;
      if (due === null || t.due < due) due = t.due;
    }
    return due;
  }

  /**
   * Fires the next event due by `target` and leaves its task scope open so the
   * caller can drain promise jobs in it; close it with endStep(). False if none.
   */
  beginStep(target = this.t) {
    if (this.scope) throw new Error("mock: beginStep() inside an open scope");
    const ev = this._next(target);
    if (!ev) return false;
    if (ev.due > this.t) this.t = ev.due;
    const frame = new Frame("task", ev.owner, ev.gen, { app: ev.app });
    frame.prev = null;
    this.scope = frame;
    try {
      this._fire(ev);
    } catch (e) {
      this.endStep();
      throw e;
    }
    return true;
  }

  endStep() {
    if (this.scope) this.scope.live = false;
    this.scope = null;
  }

  _fire(task) {
    if (task.kind === "host") {
      let outcome;
      try {
        outcome = { ok: true, value: task.work() };
      } catch (e) {
        if (!(e instanceof HostError)) throw e;
        outcome = { ok: false, message: e.message };
      }
      const settle = task.settle !== false;
      this._finish(task);
      if (!settle) return;
      if (outcome.ok) {
        let value;
        try {
          value = bridgeOut(outcome.value, this.frozenBuiltins);
        } catch (e) {
          // Converting the answer threw in the settling task: the promise never settles.
          this._error(`error settling ${task.fn}: ${describe(e)}`, e);
          return;
        }
        task.resolve(value);
      }
      else task.reject(new Error(`\`herdr.${task.fn}\`: ${outcome.message}`));
      return;
    }
    if (task.kind === "sleep") {
      this._finish(task);
      task.resolve(undefined);
      return;
    }
    // timer
    const cx = this._taskCx(task);
    if (task.repeat) {
      task.due = this.t + task.ms; // measured from the end of this callback
      task.seq = ++this.seq;
    } else {
      this._finish(task);
    }
    try {
      task.fn(cx);
    } catch (e) {
      this._error(`error in script task: ${describe(e)}`, e);
    }
  }

  // -------------------------------------------------------------------------
  // Generations and owners (hot reload, closing a copy)
  // -------------------------------------------------------------------------

  /** Starts a new build generation (a reload); returns its number. */
  newGeneration() {
    this.generation += 1;
    return this.generation;
  }

  /**
   * Ends a build generation (watch.rs after a reload): its timers stop, its sleeps
   * and host calls never settle, and its async cx members throw. Writes already
   * started still land on disk (the write thread runs on), unanswered.
   */
  cancelGeneration(g) {
    this.deadGens.add(g);
    this._drop((t) => t.gen === g);
  }

  /**
   * A copy went away (lifecycle.rs close → release_application_generation):
   * tasks it owns stop, like OwnerGone, and so does every task made in its
   * application generation, owner: null ones too (scheduler.rs
   * cancel_application_generation). Their promises never settle; writes
   * already started still land on disk, unanswered.
   */
  closeOwner(owner) {
    if (owner === null || owner === undefined) return;
    this.deadOwners.add(owner);
    const app = this.appOf(owner, false);
    if (app !== null) this.deadApps.add(app);
    this._drop((t) => t.owner === owner || (app !== null && t.app === app));
  }

  /**
   * Closes a copy the way the shell does (lifecycle.rs ShellRuntime::close):
   * view.close(cx) runs in a task scope of the copy; its returned promise is
   * given until `deadlineMs` of virtual time (herdr: 250 ms), then the copy's
   * application generation is released (closeOwner). Resolves with whether the
   * promise settled in time.
   */
  async closeView(view, { deadlineMs = 250, step = 5 } = {}) {
    if (this.scope) throw new Error("mock: closeView() inside an open scope");
    let settled = true;
    let task = null;
    if (view && typeof view.close === "function") {
      // close gets a task cx bound to the copy (lifecycle.rs ContextBinding::Task):
      // it stays usable after the call, until the copy's generation is released.
      const app = this.appOf(view);
      const { frame } = this.enter("task", view, { app });
      task = this._register("View.close", { kind: "close", owner: view, gen: frame.gen, app });
      const cx = this._taskCx(task);
      let result;
      try {
        result = view.close(cx);
        await this.drain();
      } catch (e) {
        this._error(`error in View.close: ${describe(e)}`, e);
      } finally {
        this.exit(frame);
      }
      if (result && typeof result.then === "function") {
        settled = false;
        result.then(() => (settled = true), () => (settled = true));
        await this.drain();
        const end = this.t + deadlineMs;
        while (!settled && this.t < end) {
          await this.advance(Math.min(step, end - this.t));
          await this.drain();
        }
      }
    }
    this.closeOwner(view);
    if (task) this._finish(task);
    return settled;
  }

  /** The application generation of copy `owner` (made on first use when `make`), or null. */
  appOf(owner, make = true) {
    if (owner === null || (typeof owner !== "object" && typeof owner !== "function")) return null;
    let app = this.apps.get(owner);
    if (app === undefined) {
      if (!make) return null;
      app = this.nextApp++;
      this.apps.set(owner, app);
    }
    return app;
  }

  isApplicationLive(app) {
    return app === null || !this.deadApps.has(app);
  }

  _drop(match) {
    for (const t of [...this.tasks.values()]) {
      if (!match(t)) continue;
      t.cancelled = true;
      if (t.kind === "host" && t.always) t.settle = false;
      else this._finish(t);
    }
  }

  isGenerationLive(g) {
    return !this.deadGens.has(g);
  }

  // -------------------------------------------------------------------------
  // Scopes and cx
  // -------------------------------------------------------------------------

  /**
   * Opens a host-call scope (render / event / task / layout) for `owner` (the view
   * instance) and returns its cx. Close it with exit(frame). `opts.cx`: "call"
   * (default; stale after exit) or "ambient" (what init gets). `opts.gen` tags
   * the tasks created in it (default: the current generation). `opts.initializing`:
   * the instance whose init is running (accepted as opts.owner).
   */
  enter(phase, owner = null, opts = {}) {
    if (!PHASES.includes(phase)) throw new TypeError(`mock: unknown phase ${phase}`);
    const frame = new Frame(phase, owner, opts.gen ?? this.generation, { ...opts, app: this._frameApp(owner, opts) });
    // A copy's props are fixed when it is made: its localStorage follows them.
    if (opts.initializing && frame.app != null && !this.propsByApp.has(frame.app)) this.propsByApp.set(frame.app, this.propsValue);
    // Loading a copy opens its command channel: commands sent before its loop first awaits are kept.
    if (opts.initializing && frame.app != null) this._channel(frame.app, frame.gen);
    frame.prev = this.scope;
    this.scope = frame;
    const cx = opts.cx === "ambient" ? this._ambientCx() : this._callCx(frame);
    return { cx, frame };
  }

  exit(frame) {
    frame.live = false;
    if (this.scope === frame) this.scope = frame.prev;
  }

  /** Runs fn(cx, frame) in a scope and closes it (promise jobs it queues drain later). */
  within(phase, owner, fn, opts = {}) {
    const { cx, frame } = this.enter(phase, owner, opts);
    try {
      return fn(cx, frame);
    } finally {
      this.exit(frame);
    }
  }

  /**
   * Like within(), then drains promise jobs inside the same scope, as the shell does
   * after an entry point (click, init). Resolves with fn's result; read
   * `frame.stopped` (second argument of fn) for stop_propagation().
   */
  async dispatch(phase, owner, fn, opts = {}) {
    if (this.scope) throw new Error("mock: dispatch() inside an open scope");
    const { cx, frame } = this.enter(phase, owner, opts);
    try {
      const result = fn(cx, frame);
      await this.drain();
      return result;
    } finally {
      this.exit(frame);
    }
  }

  /**
   * A call-scoped cx for `phase` that is not tied to an open scope: each member
   * runs inside its own frame (when no scope is open). Valid until endCx(cx).
   */
  makeCx(phase, owner = null, opts = {}) {
    if (!PHASES.includes(phase)) throw new TypeError(`mock: unknown phase ${phase}`);
    const frame = new Frame(phase, owner, opts.gen ?? this.generation, { ...opts, app: this._frameApp(owner, opts) });
    const cx = this._callCx(frame);
    this._cxFrames.set(cx, frame);
    return cx;
  }

  /** The application generation a scope for `owner` runs under (opts.app overrides). */
  _frameApp(owner, opts) {
    if (opts && opts.app !== undefined) return opts.app;
    return this.appOf(owner ?? (opts && opts.initializing) ?? null);
  }

  get _cxFrames() {
    if (!this.__cxFrames) this.__cxFrames = new WeakMap();
    return this.__cxFrames;
  }

  endCx(cx) {
    const frame = this._cxFrames.get(cx);
    if (frame) frame.live = false;
  }

  /** The frame behind a makeCx() cx (e.g. to read `stopped` after a handler). */
  frameOf(cx) {
    return this._cxFrames.get(cx) ?? null;
  }

  _callCx(frame) {
    const enter = () => {
      if (!frame.live) throw new TypeError(MESSAGES.stale);
      return this.scope ?? frame;
    };
    const run = (body) => {
      const scope = enter();
      if (this.scope) return body(scope);
      frame.prev = null;
      this.scope = frame;
      try {
        return body(frame);
      } finally {
        this.scope = null;
      }
    };
    return this._cxObject(run, () => (frame.live ? (this.scope ?? frame).phase : this.scope?.phase ?? "none"), () => frame.owner);
  }

  _ambientCx() {
    const run = (body) => {
      if (!this.scope) throw new TypeError(MESSAGES.noHostCall);
      return body(this.scope);
    };
    return this._cxObject(run, () => this.scope?.phase ?? "none", () => this.scope?.owner ?? null);
  }

  /** The async cx a spawn body or timer callback gets: bound to the task's build and owner. */
  _taskCx(task) {
    const run = (body) => {
      if (this.deadGens.has(task.gen) || (task.app != null && this.deadApps.has(task.app))) throw new TypeError(MESSAGES.ended);
      if (this.scope) return body(this.scope);
      if (this.strict) throw new TypeError(MESSAGES.noHostCall);
      const frame = new Frame("task", task.owner, task.gen, { app: task.app });
      this.scope = frame;
      try {
        return body(frame);
      } finally {
        this.scope = null;
      }
    };
    return this._cxObject(run, () => this.scope?.phase ?? "none", () => task.owner ?? this.scope?.owner ?? null);
  }

  _cxObject(run, phase, view) {
    const ctl = this;
    return {
      notify(target) {
        const api = target !== undefined ? "cx.notify(entity)" : "cx.notify()";
        return run((scope) => {
          if (scope.phase !== "event" && scope.phase !== "task") {
            throw new TypeError(notifyPhaseMessage(api, scope.phase));
          }
          if (target !== undefined) {
            if (target === null || typeof target !== "object" || target.__entity !== true || typeof target.__handle !== "number") {
              throw new TypeError(MESSAGES.entity);
            }
          }
          ctl._notified(view(), target ?? null, scope);
        });
      },
      stop_propagation() {
        return run((scope) => {
          scope.stopped = true;
        });
      },
      propagate() {
        return run((scope) => {
          scope.stopped = false;
        });
      },
      phase() {
        return phase();
      },
      theme() {
        return run(() => ctl._cxTheme());
      },
      open_url(url) {
        return run(() => {
          ctl._record("open_url", { url: String(url) });
        });
      },
      read_from_clipboard() {
        return run(() => ctl.clipboard);
      },
      write_to_clipboard(text) {
        return run(() => {
          ctl.clipboard = String(text);
        });
      },
      focus_handle() {
        return run((scope) => {
          if (scope.phase === "render" || scope.phase === "layout") throw new TypeError(MESSAGES.focusInRender);
          return ctl._focusHandle();
        });
      },
      bind_keys(bindings) {
        return run(() => {
          if (!Array.isArray(bindings)) throw new TypeError(MESSAGES.bindKeys);
          ctl._record("bind_keys", { bindings: bridgeIn(bindings) });
          return bindings.length;
        });
      },
      new() {
        return run(() => {
          throw new Error("mock: not implemented (cx.new)");
        });
      },
      spawn(body, opts) {
        return run((scope) => ctl._spawn(scope, body, opts));
      },
      sleep(ms) {
        return run((scope) => ctl._sleep(scope, ms));
      },
      timer: {
        after(ms, handler, opts) {
          return run((scope) => ctl._schedule(scope, "cx.timer.after(ms, fn)", ms, handler, opts, false));
        },
        every(ms, handler, opts) {
          return run((scope) => ctl._schedule(scope, "cx.timer.every(ms, fn)", ms, handler, opts, true));
        },
      },
    };
  }

  _cxTheme() {
    const g = (k) => this._theme()[k] ?? "";
    const colors = Object.freeze({
      background: g("background"), foreground: g("foreground"),
      surface: g("surface"), surface_foreground: g("foreground"),
      primary: g("accent"), primary_foreground: g("accent_foreground"),
      secondary: g("raised"), secondary_foreground: g("foreground"),
      muted: g("raised"), muted_foreground: g("muted"),
      accent: g("hover"), accent_foreground: g("foreground"),
      destructive: g("blocked"), destructive_foreground: g("background"),
      border: g("border"), input: g("input"), ring: g("ring"),
      selection: g("selection"),
    });
    return Object.freeze({ appearance: this._dark() ? "dark" : "light", colors });
  }

  /** entity_api.rs focus handles: focus() refused in render/layout; both calls need a live call; released is final. */
  _focusHandle() {
    const handle = this.nextHandle++;
    let released = false;
    const ctl = this;
    const alive = () => {
      if (released) throw new TypeError("this focus handle has been released");
    };
    const needsCall = (what) => {
      if (!ctl.scope && ctl.strict) {
        throw new TypeError(`${what} needs a live host call; call it from render or an event handler`);
      }
    };
    return {
      __handle: handle,
      focus() {
        const phase = ctl.scope?.phase;
        if (phase === "render" || phase === "layout") {
          throw new TypeError("FocusHandle.focus() cannot run during render or layout; mutate state from an event handler or task");
        }
        alive();
        needsCall("focus()");
        ctl.focusedHandle = handle;
      },
      is_focused() {
        alive();
        needsCall("is_focused()");
        return ctl.focusedHandle === handle;
      },
      release() {
        const was = !released;
        released = true;
        if (ctl.focusedHandle === handle) ctl.focusedHandle = null;
        return was;
      },
    };
  }

  _notified(owner, target, scope) {
    const entry = { t: this.t, owner, target, phase: scope.phase };
    this.notifies.push(entry);
    if (this.notifies.length > this.callLogLimit) this.notifies.shift();
    this._emit("notify", entry);
  }

  // -------------------------------------------------------------------------
  // Tasks: spawn, sleep, timers
  // -------------------------------------------------------------------------

  _register(api, task) {
    if (this.tasks.size >= MAX_TASKS) throw new RangeError(taskLimitMessage(api));
    task.id = this.nextTask++;
    task.api = api;
    task.seq = ++this.seq;
    task.cancelled = false;
    task.done = false;
    // made in a copy's scope: cancelled with that copy (closeOwner), whatever its owner
    if (task.app === undefined) task.app = this.scope ? this.scope.app ?? null : null;
    this.tasks.set(task.id, task);
    return task;
  }

  _finish(task) {
    task.done = true;
    this.tasks.delete(task.id);
  }

  _handle(task) {
    const ctl = this;
    return {
      cancel() {
        if (!ctl.tasks.has(task.id)) return;
        task.cancelled = true;
        ctl._finish(task);
      },
      is_done() {
        return !ctl.tasks.has(task.id) || task.done;
      },
    };
  }

  _owner(scope, opts) {
    const current = scope.owner ?? null;
    if (opts === null || typeof opts !== "object") return current;
    const owner = opts.owner;
    if (owner === undefined) return current;
    if (owner === null) return null;
    if (typeof owner !== "object" && typeof owner !== "function") throw new TypeError(MESSAGES.ownerType);
    if ((current !== null && owner === current) || (scope.initializing !== null && owner === scope.initializing)) {
      return current;
    }
    throw new TypeError(MESSAGES.ownerOther);
  }

  _duration(api, ms) {
    if (!Number.isFinite(ms) || ms < 0) throw new TypeError(durationMessage(api, ms));
    if (ms / 1000 > 18446744073709551615) throw new RangeError(durationRangeMessage(api));
    return ms;
  }

  _spawn(scope, body, opts) {
    if (typeof body !== "function") throw conversion(body, "function");
    const owner = this._owner(scope, opts);
    const task = this._register("cx.spawn(fn)", { kind: "spawn", owner, gen: scope.gen });
    let value;
    try {
      value = body(this._taskCx(task));
    } catch (e) {
      this._error(`error in gpui.spawn: ${describe(e)}`, e);
      this._finish(task);
      return this._handle(task);
    }
    if (value instanceof Promise) {
      value.then(
        () => this._finish(task),
        (e) => {
          if (!task.cancelled) this._error(`unhandled rejection in gpui.spawn: ${describe(e)}`, e);
          this._finish(task);
        },
      );
    } else {
      this._finish(task);
    }
    return this._handle(task);
  }

  _sleep(scope, ms) {
    const api = "cx.sleep(ms)";
    if (ms !== undefined && typeof ms !== "number") throw conversion(ms, "f64");
    const delay = this._duration(api, ms ?? 0);
    let resolve;
    const promise = new Promise((r) => {
      resolve = r;
    });
    this._register(api, { kind: "sleep", owner: scope.owner ?? null, gen: scope.gen, due: this.t + delay, resolve });
    return promise;
  }

  _schedule(scope, api, ms, handler, opts, repeat) {
    if (typeof ms !== "number") throw conversion(ms, "f64");
    if (typeof handler !== "function") throw conversion(handler, "function");
    const delay = this._duration(api, ms);
    const owner = this._owner(scope, opts);
    const task = this._register(api, { kind: "timer", repeat, ms: delay, fn: handler, owner, gen: scope.gen, due: this.t + delay });
    return this._handle(task);
  }

  /** Lists outstanding tasks (diagnostics, leak checks). */
  pendingTasks() {
    return [...this.tasks.values()].map((t) => ({ id: t.id, api: t.api, kind: t.kind, fn: t.fn && typeof t.fn === "string" ? t.fn : undefined, due: t.due, gen: t.gen, app: t.app }));
  }

  // -------------------------------------------------------------------------
  // Host calls (herdr.js forwards here)
  // -------------------------------------------------------------------------

  /** Calls herdr.<name>(...rawArgs) the way the shell does. */
  hostCall(name, rawArgs) {
    const fn = HOST[name];
    if (!fn) throw new Error(`mock: herdr has no function ${name}`);
    const values = rawArgs.map((v) => bridgeIn(v, 0));
    this.counts[name] = (this.counts[name] ?? 0) + 1;
    this.calls.push({ fn: name, t: this.t, phase: this.scope?.phase ?? "none" });
    if (this.calls.length > this.callLogLimit) this.calls.shift();
    try {
      const result = fn.call(this, new Args(values));
      return result instanceof Promise ? result : bridgeOut(result, this.frozenBuiltins);
    } catch (e) {
      if (e instanceof HostError) throw new Error(`\`herdr.${name}\`: ${e.message}`);
      throw e;
    }
  }

  /** How many times each herdr function was called since the last resetCounts(). */
  resetCounts() {
    this.counts = Object.create(null);
    this.calls = [];
  }

  _async(fn, work, opts = {}) {
    if (!this.scope) {
      if (this.strict) throw new TypeError(outsideHostCallMessage(ASYNC_API));
    }
    const scope = this.scope ?? new Frame("task", null, this.generation);
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this._register(ASYNC_API, {
      kind: "host", fn, work, resolve, reject,
      owner: scope.owner ?? null, gen: scope.gen,
      due: this.t + (opts.latency ?? 0),
      ready: opts.ready ?? null,
      always: !!opts.always,
    });
    return promise;
  }

  _notImplemented(name) {
    throw new Error(`mock: not implemented (herdr.${name})`);
  }

  _record(type, data) {
    const entry = { type, t: this.t, ...data };
    this.log.push(entry);
    this._emit("log", entry);
    return entry;
  }

  _error(message, error) {
    this.errors.push({ t: this.t, message, error });
    this._emit("error", { message, error });
  }

  _newOverlayId() {
    this.overlaySeq += 1;
    return `o${this.overlaySeq}`;
  }

  // -------------------------------------------------------------------------
  // Live data
  // -------------------------------------------------------------------------

  /** Subscribes to changes: fn(kind, detail). kind: a live key, "notify", "log", "error", "shared". */
  onChange(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  _emit(kind, detail) {
    for (const l of this.listeners) l(kind, detail);
  }

  _bump(key) {
    this.revisions[key] = (this.revisions[key] ?? 0) + 1;
    this._emit(key, this.revisions[key]);
  }

  revision(key) {
    return this.revisions[key] ?? 0;
  }

  setAgents(list) {
    const before = this._liveSnapshot();
    this.agentsList = list.map(normalizeAgent);
    this._bumpChanged(before);
  }

  setTerminals(list) {
    const before = { terminals: JSON.stringify(this.terminalsList) };
    this.terminalsList = list.map(normalizeTerminal);
    if (JSON.stringify(this.terminalsList) !== before.terminals) this._bump("terminals");
  }

  /** Replaces explicit spaces / panes / focused (undefined: derive from agents again). */
  setLayoutState({ spaces, panes, focused } = {}) {
    const before = this._liveSnapshot();
    if (spaces !== undefined) this.explicit.spaces = spaces;
    if (panes !== undefined) this.explicit.panes = panes;
    if (focused !== undefined) this.explicit.focused = focused;
    this._bumpChanged(before);
  }

  setWindow(partial) {
    const before = JSON.stringify(this._window());
    this.windowState = partial === null ? null : { ...(this.windowState ?? {}), ...partial };
    if (JSON.stringify(this._window()) !== before) this._bump("window");
  }

  setChecking(on) {
    this.checkingMode = !!on;
    this._bump("window");
  }

  setTheme(name, colors) {
    this.themeName = name;
    if (colors !== undefined) this.colors = { ...colors };
    this._themeCache = null;
    this._bump("theme");
  }

  /** r5-01: set the window appearance ("light" / "dark") apart from the theme, or null to follow it. */
  setAppearance(appearance) {
    this.appearance = appearance === "light" || appearance === "dark" ? appearance : null;
    this._bump("theme");
  }

  setZoom(zoom) {
    this.zoom = zoom;
    this._bump("theme");
  }

  setProps(props) {
    this.propsValue = bridgeIn(props ?? null);
  }

  _liveSnapshot() {
    return {
      agents: JSON.stringify(this.agentsList),
      spaces: JSON.stringify(this._spaces()),
      panes: JSON.stringify(this._panes()),
      focused: JSON.stringify(this._focused()),
    };
  }

  _bumpChanged(before) {
    const after = this._liveSnapshot();
    for (const k of Object.keys(after)) if (after[k] !== before[k]) this._bump(k);
  }

  _spaces() {
    if (this.explicit.spaces) return this.explicit.spaces;
    const spaces = [];
    const byId = new Map();
    const focusedAgent = this.agentsList.find((a) => a.focused) ?? null;
    for (const a of this.agentsList) {
      let s = byId.get(a.space);
      if (!s) {
        s = { id: a.space, index: spaces.length + 1, name: a.space_name, named: false, folder: "", machine: null, branch: null, active: false, status: null, tabs: [], _tabs: new Map() };
        byId.set(a.space, s);
        spaces.push(s);
      }
      let tab = s._tabs.get(a.tab);
      if (!tab) {
        tab = { id: a.tab, index: a.tab_index, name: a.tab_name, named: false, active: false, status: null, panes: 0, zoomed: false, settled: false, settled_at: null, changed_at: null, working_since: null };
        s._tabs.set(a.tab, tab);
        s.tabs.push(tab);
      }
      tab.panes += 1;
      tab.status = rollup([tab.status, a.status]);
      s.status = rollup([s.status, a.status]);
    }
    const activeSpace = focusedAgent ? focusedAgent.space : spaces[0]?.id;
    for (const s of spaces) {
      s.active = s.id === activeSpace;
      const activeTab = focusedAgent && focusedAgent.space === s.id ? focusedAgent.tab : s.tabs[0]?.id;
      for (const t of s.tabs) t.active = t.id === activeTab;
      delete s._tabs;
    }
    return spaces;
  }

  _panes() {
    if (this.explicit.panes) return this.explicit.panes;
    const perTab = new Map();
    for (const a of this.agentsList) perTab.set(a.tab, (perTab.get(a.tab) ?? 0) + 1);
    return this.agentsList.map((a) => ({
      pane: a.pane, terminal: a.address, tab: a.tab, title: a.title, name: a.pane_name,
      cwd: null, branch: null, status: a.status, app: a.app, program: a.program,
      focused: a.focused, zoomed: false, movable: perTab.get(a.tab) > 1, scroll: null,
    }));
  }

  _focused() {
    if (this.explicit.focused !== undefined) return this.explicit.focused;
    const a = this.agentsList.find((x) => x.focused);
    if (!a) return null;
    return { space: a.space, tab: a.tab, pane: a.pane, terminal: a.address, shown: null, agent: null, cwd: null, selection: null };
  }

  _window() {
    if (this.checkingMode || this.windowState === null) return null;
    const w = this.windowState;
    return {
      platform: w.platform ?? "linux",
      titlebar: w.titlebar ?? "system",
      buttons: w.buttons ?? false,
      maximized: w.maximized ?? false,
      fullscreen: w.fullscreen ?? false,
      active: w.active ?? true,
      visible: w.visible ?? true,
    };
  }

  _theme() {
    if (!this._themeCache) this._themeCache = resolveNamed(this.themeName, this.colors);
    return this._themeCache;
  }

  /** settings().dark: the appearance when one is set, else the theme's own lightness. */
  _dark() {
    if (this.appearance) return this.appearance === "dark";
    const p = PALETTES[this.themeName] ?? PALETTES.graphite;
    return !isLight(p.background);
  }

  _settings() {
    const dark = this._dark();
    const base = {
      font_family: "JetBrains Mono",
      font_size: 14,
      font_weight: 500,
      font_weight_bold: 700,
      font_ligatures: false,
      terminal_line_height: 1,
      terminal_cell_width: 1,
      terminal_scroll_speed: 1,
      ui_font_family: "Geist",
      ui_font_size: 13,
      zoom: this.zoom,
      theme: this.themeName,
      // A single-name theme gives the same name for both appearances.
      theme_light: this.appearance ? this.themeName : dark ? "paper" : this.themeName,
      theme_dark: this.appearance ? this.themeName : dark ? this.themeName : "graphite",
      dark,
      colors: { ...this.colors },
      pane_scrollbars: true,
      terminal_padding: [10, 6],
      terminal_opacity: 1,
      clipboard_write: true,
      copy_on_select: true,
      minimum_contrast: 1,
      option_as_alt: "auto",
      sounds: this.scenario.sounds ?? { enabled: true },
    };
    for (const k of Object.keys(this.settingsOverrides)) put(base, k, this.settingsOverrides[k]);
    return base;
  }

  // -------------------------------------------------------------------------
  // Commands (run, nextCommand)
  // -------------------------------------------------------------------------

  /** What the window answers for a run() it processes later (window.rs run_as). */
  _runAs(rawName, args) {
    const name = commands.current(rawName);
    const colon = name.indexOf(":");
    if (colon >= 0) {
      const n = name.slice(0, colon);
      const c = commands.find(n);
      if (c) {
        const error = commands.validateArgs(c, args);
        if (error) return { error };
        if (c.args.length === 0) return { error: `${n}: unexpected shorthand argument; valid arguments: none` };
        let short = commands.shorthand(c, name.slice(colon + 1));
        if (isObj(short) && isObj(args)) short = { ...short, ...args };
        return this._runAs(n, short);
      }
    }
    const c = commands.find(name);
    if (!c) {
      const dot = name.indexOf(".");
      if (dot >= 0 && this._sendCommand(name.slice(0, dot), name.slice(dot + 1))) return { ok: true };
      return { error: commands.unknownCommand(name) };
    }
    const invalid = commands.validateArgs(c, args);
    if (invalid) return { error: invalid };
    const arg = commands.missing(c, args);
    if (arg) return { error: `${name} needs ${arg}` };
    const a = isObj(args) ? args : {};
    const live = (t) => this.terminalsList.some((x) => x.address === t) || this.agentsList.some((x) => x.address === t);
    const noTerminal = (t) => ({ error: `no running terminal ${commands.debugString(t)}` });
    switch (name) {
      case "terminal.pin":
        if (typeof a.pinned !== "boolean") return { error: "terminal.pin pinned is true or false" };
        if (!live(a.terminal ?? "")) return noTerminal(a.terminal ?? "");
        break;
      case "terminal.kill":
      case "terminal.peek":
      case "agent.focus":
        if (!live(a.terminal ?? "")) return noTerminal(a.terminal ?? "");
        break;
      case "layout.toggle":
      case "layout.show":
      case "layout.hide":
      case "layout.resize":
        return this._applyLayout(name, a);
      case "pane.focus": {
        const panes = this._panes();
        const pane = a.pane ?? (typeof a.terminal === "string" ? panes.find((p) => p.terminal === a.terminal)?.pane : undefined);
        if (!pane || !panes.some((p) => p.pane === pane)) return { error: "no such pane" };
        break;
      }
      default:
        break;
    }
    return { ok: true };
  }

  /**
   * layout.toggle / show / hide / resize, as the window applies them to the shown
   * layout (src/window.rs:3640-3656): a missing node fails, a weight or px is
   * stored as f32, and the new tree is published (the "layout" revision).
   */
  _applyLayout(name, args) {
    if (this.layoutValue === null || typeof this.layoutValue !== "object") return { error: commands.noNodeError(name, args) };
    const tree = JSON.parse(JSON.stringify(this.layoutValue));
    const error = commands.applyLayoutCommand(tree, name, args);
    if (error) return { error };
    if (JSON.stringify(tree) !== JSON.stringify(this.layoutValue)) {
      this.layoutValue = tree;
      this._bump("layout");
    }
    return { ok: true };
  }

  /** The command channel of copy `app` (a reloaded copy gets a new one, like a new module). */
  _channel(app, gen) {
    let ch = this.channels.get(app);
    if (!ch || (!this._channelOpen(ch) && this.isGenerationLive(gen) && this.isApplicationLive(app))) {
      ch = { app, gen, queue: [] };
      this.channels.set(app, ch);
    }
    return ch;
  }

  /** A channel closes when its copy goes away (closed, or its build reloaded). */
  _channelOpen(ch) {
    return this.isGenerationLive(ch.gen) && this.isApplicationLive(ch.app);
  }

  /**
   * Whether copy `app` is on screen (window.rs publish_shown_copies): its
   * {mod, props} block is among the shown layout's visible blocks. A copy no
   * block of the layout describes (an overlay, a tab, a scenario without a
   * modelled layout or with content-less nodes) counts as shown.
   */
  _copyShown(app) {
    if (this.scenario.shown === false) return false;
    if (app === null || !this.propsByApp.has(app)) return true;
    return commands.layoutShowsCopy(this.layoutValue, this.modName, this.propsByApp.get(app));
  }

  /** `mods::send_command`: `command` into every open, shown copy's channel; how many got it. */
  _deliver(command) {
    let n = 0;
    for (const [app, ch] of [...this.channels]) {
      if (!this._channelOpen(ch)) {
        this.channels.delete(app); // herdr: retain(|tx| !tx.is_closed())
        continue;
      }
      if (!this._copyShown(app)) continue;
      ch.queue.push(command);
      n += 1;
    }
    return n;
  }

  /** `mods::send_command` for run("<mod>.<command>"): false when no shown copy listens. */
  _sendCommand(mod, command) {
    if (this.modName !== null && mod !== this.modName) return false;
    const copies = this._deliver(command);
    if (copies === 0) return false;
    this._record("command", { mod, command, copies });
    return true;
  }

  /**
   * A key press bound to "<mod>.<command>": herdr's run_as → send_command, so
   * every shown copy gets `command` once. Returns how many copies got it.
   */
  sendCommand(command) {
    const copies = this._deliver(command);
    this._record("command", { mod: this.modName, command, copies });
    return copies;
  }

  /** The commands waiting in copy `owner`'s channel (a copy of the list; [] if it has none). */
  pendingCommands(owner = null) {
    const ch = this.channels.get(this.appOf(owner, false));
    return ch && this._channelOpen(ch) ? ch.queue.slice() : [];
  }

  /**
   * The person runs `name` (a key, click or palette entry): window.rs run_as,
   * outside any mod. Returns { ok } or { error } (herdr would toast the error).
   */
  runAsPerson(name, args = null) {
    return this._runAs(name, args);
  }

  /** The app is quitting: pending and later nextCommand() calls reject. */
  shutdown() {
    this.shuttingDown = true;
  }

  /** Errors the window would toast for run() calls so far. */
  runErrors() {
    return this.runs.filter((r) => r.error).map((r) => ({ name: r.name, error: r.error }));
  }

  // -------------------------------------------------------------------------
  // Files (src/mod_files.rs)
  // -------------------------------------------------------------------------

  /**
   * The path the OS would open, lexically: relative paths are resolved
   * against the process's working directory (`scenario.cwd`, default "/";
   * herdr does not resolve them against anything of the mod's), and "." /
   * ".." / repeated slashes are folded. "" stays "" (it has no parent).
   */
  _norm(path) {
    const raw = String(path);
    if (raw === "") return "";
    let p = raw;
    if (!p.startsWith("/")) {
      if (!this.relativeWarned.has(raw)) {
        this.relativeWarned.add(raw);
        this._record("warn", { message: `relative path \`${raw}\` resolves against herdr's working directory (${this.cwd}), not the mod` });
      }
      p = `${this.cwd}/${p}`;
    }
    const parts = [];
    for (const segment of p.split("/")) {
      if (segment === "" || segment === ".") continue;
      if (segment === "..") parts.pop();
      else parts.push(segment);
    }
    return "/" + parts.join("/");
  }

  /** A path written as a directory ("…/" or "…/."): the OS refuses to treat it as a file. */
  _dirSyntax(path) {
    const raw = String(path);
    return raw.length > 1 && (raw.endsWith("/") || raw.endsWith("/."));
  }

  /** Rust `Path::parent` of a normalised path: null for "" and "/". */
  _parent(p) {
    if (p === "/" || p === "") return null;
    const i = p.lastIndexOf("/");
    if (i < 0) return "";
    if (i === 0) return "/";
    return p.slice(0, i);
  }

  _ancestors(p) {
    const out = [];
    for (let q = this._parent(p); q !== null && q !== ""; q = this._parent(q)) out.push(q);
    return out;
  }

  _mkdirAll(dir) {
    if (dir === "" || dir === null) return;
    const d = this._norm(dir);
    for (const q of [d, ...this._ancestors(d)]) this.dirs.add(q);
  }

  /** `mod_files::read`: text, null when absent, or a HostError. */
  _read(path) {
    const p = this._norm(path);
    if (this._ancestors(p).some((q) => this.files.has(q))) throw new HostError(MESSAGES.notDir);
    if (this.dirs.has(p)) throw new HostError(MESSAGES.notRegular);
    if (this._dirSyntax(path) && this.files.has(p)) throw new HostError(MESSAGES.notDir);
    if (!this.files.has(p)) return null;
    const text = this.files.get(p);
    if (utf8Length(text) > FILE_LIMIT) {
      throw new HostError(boundaryAt(text, FILE_LIMIT + 1) ? MESSAGES.tooBig : MESSAGES.badUtf8);
    }
    return text;
  }

  /** `mod_files::write`: compare-and-swap, create_new for null, atomic replace. */
  _write(path, text, expected) {
    if (utf8Length(text) > FILE_LIMIT) throw new HostError(MESSAGES.tooBig);
    if (this._read(path) !== expected) throw new HostError(MESSAGES.changedOutside);
    const p = this._norm(path);
    const parent = this._parent(p);
    if (parent === null) throw new HostError(MESSAGES.noParent);
    this._mkdirAll(parent);
    if (expected === null) {
      if (this.files.has(p)) throw new HostError(MESSAGES.exists);
      if (this._dirSyntax(path)) throw new HostError(MESSAGES.isDir);
      this.files.set(p, text);
      return;
    }
    // Written beside the target, re-checked, renamed over it.
    const race = this.raceQueue.findIndex((r) => r.path === null || this._norm(r.path) === p);
    if (race >= 0) {
      const [r] = this.raceQueue.splice(race, 1);
      this.externalWrite(r.path ?? p, r.text);
    }
    if (this._read(p) !== expected) throw new HostError(MESSAGES.changedWhileSaving);
    this.files.set(p, text);
  }

  /** Someone else changes a file now (another window, an editor). null deletes it. */
  externalWrite(path, text) {
    const p = this._norm(path);
    if (text === null || text === undefined) {
      this.files.delete(p);
      return;
    }
    this._mkdirAll(this._parent(p));
    this.files.set(p, String(text));
  }

  /** The file's text now, or null. */
  readFile(path) {
    return this.files.get(this._norm(path)) ?? null;
  }

  /** Makes a directory (e.g. to test "Not a regular file"). */
  mkdir(path) {
    this._mkdirAll(path);
  }

  /** The next writeTextFile (to `path`, or any) rejects with `message` and changes nothing. */
  failNextWrite(message, path = null) {
    this.failQueue.push({ message: String(message), path });
  }

  /** During the next replacing write (to `path`, or any) the file changes between check and rename. */
  raceNextWrite(text, path = null) {
    this.raceQueue.push({ text, path });
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  dispose() {
    this.unpatchDate();
    this._uninstallLocalStorage();
    for (const t of [...this.tasks.values()]) this._finish(t);
    if (globalThis.__herdr === this) delete globalThis.__herdr;
  }
}

/** Drains promise jobs: in Node, everything queued before the next macrotask. */
function defaultDrain() {
  if (typeof setImmediate === "function") return new Promise((r) => setImmediate(r));
  return (async () => {
    for (let i = 0; i < 64; i++) await null;
  })();
}

// ---------------------------------------------------------------------------
// The herdr functions (src/mods.rs:1129-1370), `this` = the controller
// ---------------------------------------------------------------------------

const HOST = {
  // async ----------------------------------------------------------------
  exec() {
    this._notImplemented("exec");
  },
  hc() {
    this._notImplemented("hc");
  },
  readTextFile(a) {
    const path = a.string(0);
    const on = optStr(a.get(1), "on");
    return this._async("readTextFile", () => {
      if (on !== null) throw new HostError("mock: reading on another machine is not implemented");
      const text = this._read(path);
      this._record("read", { path, found: text !== null });
      return text;
    }, { latency: this.latency.read });
  },
  writeTextFile(a) {
    const third = a.get(2);
    const expected = typeof third === "string" ? third : null;
    const path = a.string(0);
    const text = a.string(1);
    if (this.checkingMode) this._record("warn", { message: `check: mod wrote \`${path}\`; the write lands for real` });
    return this._async("writeTextFile", () => {
      const fail = this.failQueue.findIndex((f) => f.path === null || this._norm(f.path) === this._norm(path));
      if (fail >= 0) {
        const [f] = this.failQueue.splice(fail, 1);
        this.writes.push({ t: this.t, path, ok: false, error: f.message, injected: true });
        throw new HostError(f.message);
      }
      try {
        this._write(path, text, expected);
      } catch (e) {
        if (e instanceof HostError) this.writes.push({ t: this.t, path, ok: false, error: e.message });
        throw e;
      }
      this.writes.push({ t: this.t, path, ok: true, bytes: utf8Length(text), create: expected === null });
      this._record("write", { path, create: expected === null });
      return null;
    }, { latency: this.latency.write, always: true });
  },
  knownAgents() {
    this._notImplemented("knownAgents");
  },
  pickFolder() {
    this._notImplemented("pickFolder");
  },
  pickFiles() {
    // scenario.pickFiles: the paths the person picks (an array), null for a
    // cancel; left out, the picker is not mocked.
    if (!Object.hasOwn(this.scenario, "pickFiles")) this._notImplemented("pickFiles");
    const pick = this.scenario.pickFiles;
    return this._async("pickFiles", () => {
      this._record("pickFiles", { picked: Array.isArray(pick) ? pick.length : 0 });
      return Array.isArray(pick) ? pick.slice() : null;
    });
  },
  feedbackPickImages() {
    this._notImplemented("feedbackPickImages");
  },
  sendFeedback() {
    this._notImplemented("sendFeedback");
  },
  watchFolder() {
    this._notImplemented("watchFolder");
  },
  nextCommand() {
    // Reads the calling copy's own channel (mods.rs:1125-1129), not a shared queue.
    const scope = this.scope;
    let ch = null;
    const promise = this._async("nextCommand", () => {
      if (ch.queue.length > 0) return ch.queue.shift();
      throw new HostError(MESSAGES.shuttingDown);
    }, { latency: this.latency.command, ready: () => ch.queue.length > 0 || this.shuttingDown });
    ch = this._channel(scope ? scope.app ?? null : null, scope ? scope.gen : this.generation);
    return promise;
  },

  // sync -----------------------------------------------------------------
  checking() {
    return this.checkingMode;
  },
  home() {
    return this.homeDir;
  },
  appHome() {
    return this.appHomeDir;
  },
  fonts() {
    return this.fontList;
  },
  updates() {
    return {
      app: { version: "0.1.18", ready: null, updates: false },
      notes: [],
      core: { version: null, managed: null, ready: null, updating: false, error: null },
      checked: null,
      checks: false,
      checking: false,
    };
  },
  presentUpdateNotes() {
    this._notImplemented("presentUpdateNotes");
  },
  telemetry() {
    return null;
  },
  feedbackPreview() {
    this._notImplemented("feedbackPreview");
  },
  feedbackPasteImage() {
    this._notImplemented("feedbackPasteImage");
  },
  feedbackAttachImages() {
    this._notImplemented("feedbackAttachImages");
  },
  feedbackClearImages() {
    this._notImplemented("feedbackClearImages");
  },
  themes() {
    return allThemes();
  },
  playSound(a) {
    const sound = a.string(0);
    this.recorded.playSound.push(sound);
    this._record("playSound", { sound });
    return null;
  },
  run(a) {
    const name = a.string(0);
    const args = toSerde(a.get(1) ?? null);
    const c = commands.find(name);
    if (c) {
      const error = commands.validateArgs(c, args);
      if (error) throw new HostError(error);
    }
    const entry = { t: this.t, name, args };
    this.runs.push(entry);
    this._record("run", { name, args });
    const outcome = this._runAs(name, args);
    if (outcome.error) {
      entry.error = outcome.error;
      const id = this._newOverlayId();
      this.toasts.push({ id, title: `${name} failed`, body: outcome.error, level: "error" });
      if (this.strictRun) throw new Error(`mock: run("${name}") would fail in the window: ${outcome.error}`);
    }
    return null;
  },
  spaces() {
    return this._spaces();
  },
  machines() {
    return [{ name: null, layout: "ready" }];
  },
  agents() {
    return this.agentsList;
  },
  panes() {
    return this._panes();
  },
  setAgentOrder(a) {
    const v = a.get(0);
    const list = Array.isArray(v) ? v.filter((s) => typeof s === "string") : [];
    this.recorded.setAgentOrder.push(list);
    this._record("setAgentOrder", { addresses: list });
    return null;
  },
  setWindowTitle(a) {
    const v = a.get(0);
    const title = v === undefined || v === null ? null : a.string(0);
    this.recorded.setWindowTitle.push(title);
    this._record("setWindowTitle", { title });
    return null;
  },
  setBadge(a) {
    const v = a.get(0);
    const text = v === undefined || v === null ? null : a.string(0);
    this.recorded.setBadge.push(text);
    this._record("setBadge", { text });
    return null;
  },
  terminals() {
    return this.terminalsList;
  },
  focused() {
    return this._focused();
  },
  layout() {
    return this.layoutValue;
  },
  layouts() {
    return this.layoutNames;
  },
  commands() {
    return commands.listing();
  },
  window() {
    return this._window();
  },
  theme() {
    return this._theme();
  },
  settings() {
    return this._settings();
  },
  keys() {
    return this.keyList;
  },
  openOverlay(a) {
    const spec = toSerde(a.value(0));
    if (isObj(spec) && spec.mod === undefined && spec.piece !== undefined) put(spec, "mod", spec.piece);
    if (!(isObj(spec) && typeof spec.mod === "string") && !(isObj(spec) && isObj(spec.layout))) {
      throw new HostError(MESSAGES.overlaySpec);
    }
    const id = this._newOverlayId();
    this.overlays.set(id, spec);
    this._record("openOverlay", { id, spec });
    return id;
  },
  closeOverlay(a) {
    const id = a.string(0);
    this.overlays.delete(id);
    this._record("closeOverlay", { id });
    return null;
  },
  notify(a) {
    const id = this._newOverlayId();
    const n = toSerde(a.value(0));
    this.notifications.push({ id, t: this.t, notification: n });
    this._record("notify", { id, notification: n });
    return id;
  },
  placement() {
    const p = this.propsValue;
    return isObj(p) && typeof p.float === "string" ? this.placementValue : null;
  },
  props() {
    return this.propsValue;
  },
  shared(a) {
    const k = a.string(0);
    return this.shared.has(k) ? this.shared.get(k) : null;
  },
  setShared(a) {
    const k = a.string(0);
    const v = toSerde(a.value(1));
    if (this.shared.has(k) && sameValue(this.shared.get(k), v)) return null;
    this.shared.set(k, v);
    this._record("setShared", { key: k, value: v });
    this._emit("shared", { key: k, value: v });
    return null;
  },
};

/** Every function the mock "herdr" module exports (the d.ts names). */
export const HERDR_FUNCTIONS = Object.freeze(Object.keys(HOST));

/** Builds a controller from a scenario and installs it at globalThis.__herdr. */
export function createController(scenario = {}) {
  const ctl = new Controller(scenario);
  globalThis.__herdr = ctl;
  return ctl;
}

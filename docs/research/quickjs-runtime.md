# QuickJS-ng runtime inside herdr's gpui-shell: limits and surface

Source: herdr-app v0.1.18 (commit a2e8e3f), read-only clone. Every path below is relative to the
herdr-src root. **[V]** = verified in source at the cited lines. **[I]** = inferred (reasoned from
code or from QuickJS-ng / ECMAScript behaviour that is not vendored here); test these in our
QuickJS-ng wasm harness before relying on them.

Shell paths are abbreviated: `shell/` = `vendor/gpui-kit/crates/shell/src/`, `qjs/` = `shell/engine/quickjs/`.

---

## 1. Engine and crate

| Fact | Status | Cite |
|---|---|---|
| Bindings crate is `quickjs-jit` 0.12.11 (Longbridge fork of rquickjs), git rev `96593cd7a54440ac060a391b8baea7e9a3cf1393`, features `macro`, `loader`, `jit-abi`; renamed to `rquickjs` in the shell | V | `vendor/gpui-kit/crates/shell/Cargo.toml:50-56`, `Cargo.lock:6443-6449` |
| The C engine is "QuickJS / quickjs-ng (embedded by quickjs-jit-sys)" from `longbridge/quickjs-jit@96593cd…/sys/quickjs` | V | `licenses/inventory.json:55-56` |
| Exact quickjs-ng release number is **not** recorded anywhere in the clone (the `-sys` crate and its C source are not vendored) | V (absence) | `Cargo.lock:6515-6520` |
| herdr routes every `rquickjs` dependency (incl. LLRT) to the compat facade | V | `Cargo.toml:83`, `vendor/gpui-kit/crates/shell/rquickjs-compat/Cargo.toml:1-14` |
| Stdlib facade `quickjs-jit-stdlib` 0.12.7 (rev `605da48…`) wraps LLRT `buffer`, `crypto`, `path`, `url`, `zlib` | V | `shell/../Cargo.toml:58`, `Cargo.lock:6502-6512`, `qjs/standard/mod.rs:1-10` |
| herdr runs the **plain interpreter, not the JIT** (`JitRuntime::builder().build_interpreter()`), because JIT upkeep froze long-lived windows | V | `qjs/mod.rs:1787-1803` |
| Context is `JsContext::full(&js_runtime)` (all intrinsics incl. `Eval`; eval is then removed in JS) | V | `qjs/mod.rs:1816`, `qjs/sandbox.rs:41-53` |
| **One VM per herdr process**: `ShellRuntime::new(cx)` refuses a second default runtime; herdr's single `AppWindow` creates it. All mods (and overlay windows) share one VM, one `globalThis`, one 256 MiB heap | V | `qjs/mod.rs:1717-1729`, `src/window.rs:518`, `src/main.rs:257` |

---

## 2. Time budgets (interrupt handler)

Installed right after runtime creation:

```rust
js_runtime.set_memory_limit(sandbox::memory_limit_bytes());
js_runtime.set_max_stack_size(sandbox::max_stack_size_bytes());
js_runtime.set_interrupt_handler(Some(Box::new(sandbox::interrupt_handler())));
```
`qjs/mod.rs:1851-1853` [V]

Constants (`qjs/sandbox.rs:425-444`) [V]:

```rust
render: Duration::from_millis(50),
event: Duration::from_millis(500),
detached: Duration::from_secs(5),
```

Selection logic (`qjs/sandbox.rs:493-521`) [V]:

* If the application is closing and `close_deadline` has passed → interrupt immediately (`:498-503`).
* Budget is chosen from `scope::current_phase()`: `Render | Layout` → 50 ms; `Event | Task` → 500 ms; no scope → 5 s (`:513-517`).
* The clock restarts whenever the innermost scope **generation** changes (each host entry pushes a frame with a fresh generation, `shell/scope.rs:235,265,321-328`), or, with no scope, whenever `begin_host_execution()` bumps the detached epoch (called at the start of every `with_js`, `qjs/mod.rs:5286`; `qjs/sandbox.rs:476-485`).
* An interrupt **cannot be caught** by `try/catch` (test `an_interrupt_cannot_be_swallowed_by_a_catch_block`, `qjs/sandbox.rs:813-826`) [V].

### Which budget each herdr entry point gets

| Entry point | Scope phase | Budget | Cite |
|---|---|---|---|
| `render(cx)` (snapshot build) | Render | **50 ms** | `qjs/mod.rs:3310`, `qjs/sandbox.rs:514` |
| Virtual list item renderers | Layout | **50 ms** | `shell/scope.rs:44-45`, `qjs/sandbox.rs:514` |
| Module load: `main.js` and every static import, evaluated inside `load_view_with_policy`'s scope | **Task** | **500 ms total for the whole import graph** (one generation) | `shell/plugin.rs:1243-1248`, `shell/plugin.rs:1328-1346` (herdr calls `try_load`, `src/window.rs:1879`) |
| Hot reload: re-evaluation of the module graph | Task | 500 ms | `shell/watch.rs:547-558` |
| Constructor (`new View(...)`) | Event (own scope) | 500 ms | `qjs/mod.rs:2515-2533` |
| `init(props, cx)` | Event (own scope) | 500 ms | `qjs/mod.rs:2537-2546`, `qjs/mod.rs:3237-3257` |
| Event handlers (`on_click`, keys, size change, …) | Event | 500 ms | e.g. `qjs/mod.rs:3980-4008` |
| `cx.timer.after/every` callback, each resumed `cx.spawn` continuation, `cx.sleep` resolution, host-promise settlement | Task (fresh scope per resumption) | 500 ms each | `qjs/scheduler.rs:822-864` |
| Promise jobs queued by a render | Task (deferred drain, own scope) | 500 ms | `qjs/scheduler.rs:287-342` |
| `close(cx)` | Task + hard deadline | herdr deadline 250 ms (shared on quit) | `qjs/lifecycle.rs:44-78`, `src/window.rs:1429`, `defaults/AGENTS.md:1085-1086` |
| Link handler `handleLink` | Event | 500 ms of JS; herdr waits ≤30 s overall | `qjs/mod.rs:1632-1635`, `src/mods.rs:1489-1497` |
| Detached evaluation (prelude, no scope) | none | 5 s | `qjs/sandbox.rs:516` |

Notes [V]: the first synchronous slice of a `cx.spawn` body runs **inside the caller's scope** (it is called immediately, `qjs/scheduler.rs:600`), so it spends the caller's budget (e.g. init's 500 ms). Promise jobs drained at the end of an entry point run inside that same scope (`qjs/scheduler.rs:854-858`, `qjs/mod.rs:4008`), so they share its budget.

[I] Time spent in a single native call (huge `JSON.stringify`, `Array.prototype.sort` with a native comparator) is only checked when QuickJS next polls the handler; the kernel time of fs syscalls is invisible to the budget but those run off-thread anyway (`qjs/host.rs:20-29`).

### What happens on overrun / any thrown error

| Where | Outcome | Visible to user? | Cite |
|---|---|---|---|
| render | `build_snapshot` returns `Err`; `ScriptView.error` set; the **last good snapshot stays on screen with an error banner** over it (or a full error overlay if it never rendered) | Yes, banner in the mod's block | `shell/view.rs:243-263`, `shell/view.rs:312-331` |
| event handler | `tracing::error!("error in click handler: {error}")` (one string per handler kind); then jobs drained. **JS state mutated before the throw is kept** | Log only | `qjs/mod.rs:4005-4008`, list at `grep "error in .* handler"` e.g. `:4632`, `:4272` |
| timer / task resumption | `tracing::error!("error in script task: {error}")`; a `timer.every` **keeps ticking** after an error | Log only | `qjs/scheduler.rs:854-856`, loop `:686-716` |
| `cx.spawn` body throws synchronously | `tracing::error!("error in gpui.spawn: {}")` | Log only | `qjs/scheduler.rs:608-611` |
| `cx.spawn` promise rejects | `tracing::error!("unhandled rejection in gpui.spawn: {}")` (suppressed if cancelled) | Log only | `qjs/scheduler.rs:735-751` |
| Rejection in a bare promise chain (not adopted by `cx.spawn`) | **Silent**: no host rejection tracker is installed anywhere in the shell | No | V by absence (`grep rejection_tracker\|promise_rejection` → nothing in `shell/`) |
| A promise job throws during a drain | `tracing::error!("error in a promise continuation: {message}")`, drain continues | Log only | `qjs/scheduler.rs:186-196` |
| Module load / constructor / init fails on first load | `copy.error = format!("{e:#}")`; listed by `herdr-app status` as `"mod <name>: <error>"` | `herdr-app status` | `src/window.rs:1886-1888`, `src/window.rs:4222-4229` |
| Reload fails | Old build keeps running; error stored on the copy (status) | `herdr-app status` | `shell/watch.rs:566-569`, `src/window.rs:4410-4418`, `defaults/AGENTS.md:945-947` |
| Load fails with OOM or heap ≥ 75 % | herdr restarts **all mods on a fresh VM** (`restart_mods` / `recover_mods`) | Log `warn` | `src/window.rs:302-311`, `:1889-1898`, `:4395-4404`, `:4442-4450` |

Log destination [V]: `tracing_subscriber::fmt()` to stderr, filter from `HERDR_APP_LOG`, default `"warn,herdr_app=info,gpui_shell=info"` (`src/main.rs:140-145`). Script `console.*` goes to target `gpui_shell::script` (`qjs/host.rs:952-992`). No toast is raised for handler/timer errors; only the shell's own watcher posts a "Reload failed" toast (`shell/watch.rs:483-509`), and herdr does not use that watcher when it has file events (`src/window.rs:1881-1883`).

[I] The interrupt surfaces as QuickJS-ng's uncatchable `InternalError: interrupted`; the exact text is in the non-vendored C source.

---

## 3. Memory and stack

| Limit | Value | Cite | Status |
|---|---|---|---|
| Heap ceiling per VM (shared by **all** mods in the window) | `256 * 1024 * 1024` bytes | `qjs/sandbox.rs:406-409` | V |
| Interpreter stack | `1024 * 1024` bytes (QuickJS default is 256 KiB) | `qjs/sandbox.rs:416-419` | V |
| herdr restarts the VM at heap share ≥ `0.75` on a mod edit or failed load | `const RESTART_MODS_AT: f64 = 0.75;` | `src/window.rs:302-304`, `qjs/mod.rs:2163-2166` | V |
| Evaluated modules are **never freed** until the context dies; every reload leaks one module generation | | `qjs/mod.rs:2157-2162`, `qjs/mod.rs:5496-5499`, `src/window.rs:4392-4394` | V |
| OOM detection strings herdr looks for | `"out of memory"`, `"Allocation failed while creating object"` | `src/window.rs:306-311` | V |
| Module source file size | `MAX_MODULE_BYTES = 8 * 1024 * 1024`; error ``module `…` is N bytes, over the 8388608-byte limit`` | `qjs/mod.rs:57`, `:5775-5783` | V |
| Live retained entities | `MAX_LIVE_ENTITIES = 10_000` | `shell/entities.rs:54` | V |
| Outstanding host tasks per VM (timers + sleeps + spawns + pending fs/host promises, **all mods together**) | `MAX_OUTSTANDING_TASKS_PER_RUNTIME = 1024`; RangeError `"{api} exceeded the per-runtime outstanding host task limit of 1024"` | `qjs/scheduler.rs:1557-1578`, `:1389-1408`, `:1240-1262` | V |
| Promise jobs per drain | `MAX_JOBS_PER_DRAIN = 100_000` (rest run next entry, error logged) | `qjs/scheduler.rs:491-493`, `:138-141` | V |
| Transactional drain (nested view init) | `MAX_TRANSACTIONAL_JOBS = 10_000`; exceeding **disables the whole runtime**: `"the QuickJS job queue exceeded gpui-shell's transactional limit; the script runtime was disabled so pending work cannot cross view authority"` | `qjs/scheduler.rs:494-496`, `qjs/mod.rs:2321-2331` | V |
| Host-module argument depth / array size (applies to values passed to `herdr` functions such as `setShared`) | `MAX_DEPTH = 16` (`"a host argument may not nest more than 16 levels deep"`), `MAX_BRIDGE_ARRAY_ITEMS = 10_000` | `qjs/host_modules.rs:73-86`, `:377-380`, `:106-110` | V |
| Component data passed to components | depth 16, 4096 nodes, 1 MiB strings, 1024 keys | `qjs/mod.rs:9546-9549` | V |

[I] Stack overflow surfaces as QuickJS's `RangeError: Maximum call stack size exceeded` (catchable).

---

## 4. Sandbox: frozen intrinsics and withheld code paths

Order matters: `sandbox::install` runs **last** in `install_globals` (`qjs/mod.rs:8171-8180`; rationale `qjs/sandbox.rs:5-14`). herdr never calls `set_development_mode` or `set_strict_builtins` (grep finds no caller in `src/`; only the standalone `gpui-shell --dev` binary does, `shell/host.rs:237,345`), so both defaults apply: dev mode off, strict builtins **on** (`qjs/sandbox.rs:97-98`, `:77-91`) [V].

### Exactly what is frozen [V] (`qjs/sandbox.rs:199-215`)

```js
for (const proto of [
  Object.prototype, Array.prototype, Function.prototype,
  String.prototype, Number.prototype,
]) { Object.freeze(proto); }
```

Not frozen [V by omission]: `globalThis`, `Object`/`Array`/`Date`/`Math`/`JSON` constructors and namespaces, `Date.prototype`, `Map/Set/WeakMap.prototype`, `Promise.prototype`, `RegExp.prototype`, `Error.prototype`, `Symbol.prototype`, `Boolean.prototype`, `BigInt.prototype`, typed-array prototypes. herdr's own test overwrites `Date.now` (`src/mods/render_tests.rs:351-355`), proving `Date` is writable. The prelude also freezes the theme object it hands out (`qjs/mod.rs:7015-7018`).

### Dynamic code withheld [V] (`qjs/sandbox.rs:168-197`)

* `delete globalThis.eval` → `eval(...)` is a `ReferenceError`.
* `Function`, and the constructors reachable from `function(){}`, `async function(){}`, `function*(){}`, `async function*(){}` all throw `TypeError: the Function constructor is disabled: the shell sandbox withholds dynamic code; run the host with --dev to allow it` (label varies: `the AsyncFunction constructor`, etc.). `instanceof Function`, `.call/.apply/.bind` keep working (`:609-622`).
* Consequence: libraries using `Function("return this")()` break; use `globalThis`.

### Absent-global stubs [V] (`qjs/sandbox.rs:228-261`)

Calling these throws ``TypeError: `NAME` is not available in the shell: HINT``:

| Name | Hint |
|---|---|
| `setTimeout` | `use cx.timer.after(ms, callback)` |
| `setInterval` | `use cx.timer.every(ms, callback)` |
| `clearTimeout` | `cancel the handle returned by cx.timer.after` |
| `clearInterval` | `cancel the handle returned by cx.timer.every` |
| `require` | ``this runtime uses ES modules; use `import` `` |

`window`, `document` are deliberately *not* stubbed (`:223-227`), but note the shell does install its own `globalThis.window` object (overlay API) (`qjs/mod.rs:6942-6999`), so `typeof window !== "undefined"` here. `std`/`os` (quickjs-libc) are not compiled in (`:744-755`).

### Consequences of the freeze (why null-prototype maps)

Application code is module code, so it is strict; a write to a frozen prototype is a thrown `TypeError` (`qjs/sandbox.rs:629-632`) [V]. Below is ECMAScript semantics applied to that freeze [I — confirm in the wasm harness]:

| Code with a plain `{}` keyed by an arbitrary string `k` | Result here |
|---|---|
| `m[k] = v` with `k` ∈ `toString`, `valueOf`, `constructor`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`, `__defineGetter__`, … | **TypeError** ("override mistake": inherited non-writable data property blocks `[[Set]]`) |
| `m["__proto__"] = v` | Calls the `__proto__` setter: changes `m`'s prototype (or ignores a primitive), no key stored |
| `m[k]` lookup for an unset `k` = `"constructor"` / `"toString"` | Returns the inherited function, i.e. a truthy false-positive |
| `Object.assign({}, src)` where `src` has those keys | TypeError (uses `[[Set]]`) |
| `{ ...src }`, object literals, class fields, `JSON.parse` | Fine (define semantics) |
| `arr.foo = …` where `foo` is an `Array.prototype` method name, `fn.toString = …` | TypeError |

Therefore: any map keyed by agent ids, terminal addresses, names, user text or saved-file keys must be `Object.create(null)` (or a `Map`), and key tests must use `k in m` on a null-prototype object or `Object.hasOwn(m, k)`. When loading JSON into a working map, copy into a fresh `Object.create(null)`; never `Object.assign` onto `{}`. Also: no polyfills that patch builtins (they fail at import with a TypeError, `qjs/sandbox.rs:105-116`), and do not monkey-patch `Date`/`Math` (writable, but shared by every mod in the VM).

---

## 5. Globals and built-ins

| Global | Present? | Notes | Status / cite |
|---|---|---|---|
| `Date`, `Date.now()` | Yes, real wall clock | Shipped mods depend on it (`defaults/mods/agents/main.js:232`, `defaults/mods/files/main.js:100`). Constructor writable (not frozen) | V (usage) |
| `Math.random()` | Yes, real, unseeded from script | Used by shipped `win98` mods (`defaults/mods/win98/sol.js:27`) | V (usage) |
| `performance.now()` | Yes | `Performance` intrinsic is part of `Context::full` (`qjs/sandbox.rs:44-46`) | V (doc comment) / I (exact semantics) |
| `WeakRef`, `BigInt`, `Proxy`, `Reflect`, `Symbol`, `Map/Set/WeakMap`, typed arrays, `DataView` | Yes | Listed as supported Test262 features of this engine | V `vendor/quickjs-jit-runtime/src/correctness/mod.rs:538-551` |
| `Intl` (incl. `Intl.Segmenter`, `NumberFormat`) | **No** | Listed as unsupported (`"Intl"`, `feature.starts_with("Intl")`) | V `…/correctness/mod.rs:552-559`, `:592-597` |
| `Atomics`, `Temporal`, `ShadowRealm` | No | same list | V same |
| `toLocaleString`/`toLocaleDateString(locale, opts)` | Exists | Used by `defaults/mods/win98/taskbar.js:45`; without Intl, locale/options are [I] likely ignored → don't use for formatting | I |
| `String.prototype.normalize` | Yes | `defaults/mods/worktree/main.js:31` uses `normalize("NFC")` at runtime | V (usage) |
| Unicode property escapes `/\p{L}/u` | Yes | `defaults/mods/worktree/main.js:32` | V (usage); `\p{Extended_Pictographic}` I |
| `console.{debug,log,info,warn,error}` | Yes (global + `"console"` module) | → `tracing` target `gpui_shell::script`; `log` = info | V `qjs/standard/console.rs:6-9`, `qjs/host.rs:952-992`, `shell/typings.rs:3947-3962` |
| `fetch(url, {method, headers, body})` → `{status, ok, url, text(), json()}` | Yes | 30 s timeout, 8 MiB body, 10 redirects; herdr grants unrestricted network | V `qjs/standard/fetch.rs:10-15`, `shell/typings.rs:4027-4045`, `src/mods.rs:1416` |
| `process` global: `run`, `nextTick`, `exit`, `platform`, `arch` | Yes | Use herdr `exec` instead of `process.run` (`defaults/AGENTS.md:1239-1240`). `nextTick(cb, ...args)` enqueues a QuickJS job | V `qjs/sandbox.rs:322-328`, `:345-392` |
| `queueMicrotask` | Unknown | Not installed by the shell; depends on the quickjs-ng build | I — test; prefer `Promise.resolve().then` |
| `structuredClone` | Unknown, assume **absent** | Not installed by the shell or LLRT subset | I — use JSON round-trip |
| `TextEncoder`/`TextDecoder` | Unknown, assume absent | LLRT `encoding` crate is pure Rust here (no rquickjs dep) | I (`Cargo.lock` llrt_encoding deps) |
| `Buffer`, `URL`, `URLSearchParams`, `crypto` | Via **imports** `"buffer"`, `"url"`, `"crypto"` (`createHash`, `randomBytes`, `randomUUID`, `webcrypto`); global availability unverified | | V `shell/typings.rs:3915-3940`, `shell/tests/standard_runtime.rs:7-31`; global I |
| `localStorage`, `sessionStorage` | Yes (globals, and `window.localStorage`) | §7 | V `qjs/mod.rs:7001-7002` |
| `window` | Yes — the shell's overlay/window API object, not a DOM | | V `qjs/mod.rs:6942-7002`, `shell/typings.rs:4053-4078` |
| `eval`, `Function(...)` | No (see §4) | | V |
| `setTimeout` family, `require` | Throwing stubs | | V |

---

## 6. The `cx` object

Built by `context_object` (`qjs/mod.rs:10017-10143`) from the prelude's `contextMembers` (`qjs/mod.rs:7029-7091`). Typed in `shell/typings.rs:961-1093` and `:4080-4096`. Every member first calls `check()` (the binding gate, `qjs/mod.rs:9807-9833`).

| Member | Signature (typings) | Behaviour / errors | Cite |
|---|---|---|---|
| `notify` | `notify(target?: Entity): void` | Allowed only in Event or Task phase (`ScopePhase::allows_notify`); in render throws ``cx.notify() is not allowed during the `render` phase; request a re-render from an event handler instead``. A Task cx redraws the task **owner** | `qjs/mod.rs:10037-10112`, `shell/scope.rs:58-61` |
| `stop_propagation` | `(): void` | `App::stop_propagation` | `qjs/mod.rs:10114-10124` |
| `propagate` | `(): void` | undo of the above | `qjs/mod.rs:10125-10130` |
| `phase` | `(): "render"\|"event"\|"task"\|"layout"\|"none"` | | `qjs/mod.rs:10132-10140`, `shell/typings.rs:2041-2051` |
| `theme` | `(): Theme` | frozen gpui-base theme projection (herdr mods normally use `theme()` from `"herdr"`) | `qjs/mod.rs:7034-7037` |
| `open_url` | `(url: string): void` | absolute http(s) only: `"cx.open_url(url) expects an absolute HTTP(S) URL with a host"` | `qjs/host.rs:113-121` |
| `read_from_clipboard` / `write_to_clipboard` | `(): string\|undefined` / `(text: string): void` | herdr grants both | `qjs/mod.rs:7042-7049`, `src/mods.rs:1418-1419` |
| `focus_handle` | `(): FocusHandle` | call in `init`/handlers, never in render | `qjs/mod.rs:7050-7053`, `shell/typings.rs:1032-1044` |
| `bind_keys` | `(bindings: KeyBinding[]): number` | app-wide keymap; illegal in render | `qjs/mod.rs:7057-7065` |
| `new` | `(Class: ViewClass, props?: Props): Entity` | nested retained view; illegal in render | `qjs/mod.rs:7066-7072` |
| `spawn` | `(body: (cx: AsyncContext) => unknown, opts?: { owner?: View \| null }): Task` | Calls `body` **synchronously now**, adopts the returned promise; errors logged (§2) | `qjs/scheduler.rs:583-615` |
| `sleep` | `(ms?: number): Promise<void>` | default 0; cancelled → never settles | `qjs/scheduler.rs:512-571` |
| `timer.after` | `(ms: number, handler: (cx: AsyncContext) => void, opts?: TaskOptions): Task` | one-shot | `qjs/scheduler.rs:617-632` |
| `timer.every` | same | interval measured from the **end** of the previous callback; keeps running while hidden; survives handler errors | `qjs/scheduler.rs:634-654`, `:686-716`, `shell/typings.rs:4087-4095` |
| `Task` handle | `{ cancel(): void; is_done(): boolean }` | cancel → promise never settles; a running spawn chain continues to its next host await | `qjs/scheduler.rs:724-732`, `:1598-1622` |

* `ms` validation: non-finite or negative → `TypeError: "{api} expects a non-negative number of milliseconds, got {ms}"`; too large → `RangeError: "{api} milliseconds are outside the supported duration range"` (`qjs/scheduler.rs:1682-1695`). No minimum interval.
* `opts.owner`: default = running view (during init, the view being set up, also on reload); `null` = outlives every view; anything else → `TypeError: "opts.owner must be the view that is running, or null; a task cannot yet be owned by another view"` (`qjs/scheduler.rs:1628-1680`, `shell/typings.rs:2081-2085`).
* Three bindings (`qjs/mod.rs:9767-9805`): handler/render `cx` = `Call(generation)` (stale after return); `init` gets `__async_cx()` = `Ambient` (`qjs/mod.rs:6839-6841`, `:10011-10015`); spawn/timer callbacks get `Task` cx tied to the owner and the build. Errors: stale/`"this cx has no host call to speak for. …"`, and after reload `"this cx belongs to a build of the script that was reloaded or closed; its tasks have to stop"` (`qjs/mod.rs:9818-9830`).
* Calling scheduling APIs with no host call in progress: `"{api} was called with no host call in progress. It needs the window and app of a live call, so call it from render, from an event handler, or from a task the scheduler resumed — not from a bare promise callback."` (`qjs/scheduler.rs:1697-1706`).
* View lifecycle [V]: `init(props, cx)` once (`qjs/mod.rs:6839-6841`), `render(cx)` only when dirty (`cx.notify()`, herdr data change, theme change; `shell/view.rs:288-299`, `defaults/AGENTS.md:1063-1066`), optional `update(props)` for nested views (`qjs/mod.rs:3259-3274`), optional `async close(cx)` with a Task cx (`qjs/lifecycle.rs:60-71`). `close` is **not** called on hot reload (`shell/watch.rs:521-588` never calls it).

---

## 7. `localStorage`

| Aspect | Fact | Cite | Status |
|---|---|---|---|
| API | `length` (getter), `key(i)`, `getItem(k)`, `setItem(k, v)`, `removeItem(k)`, `clear()`, plus `flush(): Promise<void>`. Keys and values coerced with `String(...)`. **Bracket access (`localStorage.x`) is not storage** (plain object, no Proxy) | `qjs/mod.rs:6912-6928`, `shell/typings.rs:3868-3911` | V |
| Sync/async | Reads and writes hit an in-memory cache synchronously; persistence is a background write queue (one write in flight, revision-numbered). `flush()` is a barrier that resolves when the current revision is on disk and **rejects** if that write failed | `shell/storage.rs:10-35`, `qjs/host.rs:551-639` | V |
| Failure visibility | A background write failure is only `tracing::error!("the store could not be written: …")`; it is surfaced to script only through a pending/next `flush()` | `shell/storage.rs:285-298`, `qjs/host.rs:578-580` | V |
| File (herdr) | `<appHome>/data/<mod-name>/store.json` when the copy's props are null; otherwise `store-<16 hex>.json`, hash = Rust `DefaultHasher` of the props JSON text. Directory is created on load | `src/mods.rs:1454-1475` | V |
| appHome | `$HERDR_APP_HOME`, else `$XDG_CONFIG_HOME/herdr-app`, else `~/.config/herdr-app` | `src/mods.rs:62-65` | V |
| Scoping | Same mod + same props ⇒ same file ⇒ **same in-memory store object** (thread-local `SHARED_STORES` keyed by path, weak refs). Link handler shares the null-props store | `shell/policy.rs:59-63`, `:171-183`, `defaults/AGENTS.md:1002`, `:1069-1070` | V |
| Load | File read once when the first policy for that path is created; never re-read while any copy holds it. A missing file = empty store | `shell/policy.rs:164-169`, `shell/storage.rs:140-225` | V |
| Corrupt file | Every call throws ``"`<path>` is not a valid store file: <serde error>"`` — no auto-recovery | `shell/storage.rs:211-216`, `qjs/host.rs:657-661` | V |
| Atomicity | temp file `<path>.tmp.<pid>.<n>`, then rename, then parent-dir fsync (Unix); `MoveFileExW(REPLACE_EXISTING\|WRITE_THROUGH)` on Windows. Written as pretty JSON | `shell/storage.rs:400-470`, `:354-362` | V |
| Limits | `MAX_STORE_BYTES = 8 MiB` (pretty-printed size), `MAX_STORE_KEYS = 4096`, `MAX_STORE_VALUE_BYTES = 1 MiB` (JSON-encoded string, so escapes count), `MAX_FLUSH_WAITERS = 1024`. Over-limit `setItem` **throws synchronously**, e.g. ``"store value `k` is N bytes, over the 1048576-byte per-value limit"`` | `shell/storage.rs:41-44`, `:163-180`, `:365-391`, `:318-321` | V |
| Non-string legacy values | returned as their JSON text | `qjs/host.rs:752-762` | V |
| `sessionStorage` | in-memory per policy (per copy), never persisted, `flush()` resolves at once | `shell/storage.rs:130-138`, `qjs/host.rs:764-780` | V |
| Cross-process | [I] A second herdr process has its own cache; last writer wins on `store.json` with no merge or reload | inferred from `shell/policy.rs:164-183` | I |
| VM restart | [I] `restart_mods` drops old policies; the next load re-reads the file, so writes not yet on disk at that instant are lost unless flushed | inferred | I |

---

## 8. `fs/promises`

Exports (also as `default`): `readFile`, `writeFile`, `readdir`, `exists`, `unlink`, `rmdir`, `mkdir` — nothing else (**no `rename`, `stat`, `appendFile`, `copyFile`**) (`qjs/standard/fs.rs:7-42`) [V]. Bare `"fs"` and `"node:*"` do not resolve (`shell/tests/standard_runtime.rs:71-92`).

| Function | Signature | Semantics | Cite |
|---|---|---|---|
| `readFile` | `(path) => Promise<Uint8Array>`; `(path, "utf8" \| {encoding:"utf8"}) => Promise<string>` | ≤ 64 MiB; non-UTF-8 → reject ``cannot decode `…` as UTF-8`` | `qjs/host.rs:135-181`, `:441` |
| `writeFile` | `(path, string \| Uint8Array) => Promise<void>` | ≤ 8 MiB (RangeError at call). cap-std `Dir::write` = create/truncate + write, **not atomic** [V: no temp/rename] | `qjs/host.rs:183-224`, `:442` |
| `readdir` | `(path) => string[]`; `(path, {withFileTypes:true}) => {name, isDirectory()}[]` | sorted by name; ≤ 10 000 entries / 1 MiB names | `qjs/host.rs:226-246`, `:461-520` |
| `exists` | `(path) => Promise<boolean>` | denied path **throws** rather than `false` | `qjs/host.rs:326-336` |
| `unlink` / `rmdir` | `(path) => Promise<void>` | `rmdir` only removes an **empty** dir | `qjs/host.rs:338-366` |
| `mkdir` | `(path, {recursive?: boolean}) => Promise<void>` | unknown option keys throw | `qjs/host.rs:368-433` |

Path policy [V]:
* herdr grants read roots `[home]` (+ `appHome/mods` only for `frame-palette`), write roots `[appHome]`, execute/network unrestricted, storage on, clipboard on (`src/mods.rs:1403-1420`).
* Capability checks happen synchronously on the calling thread (denial is a thrown `TypeError`); the syscall runs on the background executor (`qjs/host.rs:123-133`).
* Resolution (`shell/capability.rs:282-351`): absolute paths must lie inside a root; **relative paths are joined to each root in order** (so a relative read resolves under `home`, a relative write under `appHome`); `..` escaping the root is refused lexically; symlinks out of a root are refused (cap-std). A missing write root is created.
* Denial text: ``"`<path>` is outside every granted <read|write> root; add its directory to capabilities.fs.<read|write> in the manifest"`` (`shell/capability.rs:386-391`, `qjs/host.rs:531-542`).
* [I] If `HERDR_APP_HOME` points outside `$HOME`, `fs.readFile` of our own save under appHome is **denied** (appHome is a write root only). herdr's `readTextFile` is the safer reader.
* Pending fs promises belong to the current view; if the view/build is cancelled, the background work still completes but the promise is never settled (`qjs/scheduler.rs:1389-1444`).

For our save, prefer herdr's `writeTextFile(path, text, expected)`: "Writes UTF-8 text only if it still matches expected (null creates a new file). Rejects on a stale snapshot; existing files are replaced atomically." and `readTextFile(path)` (≤ 1 MiB, `null` if absent) (`defaults/herdr.d.ts:27-32`; impl `src/mods.rs:1137-1160`, covered by the herdr-API research).

---

## 9. Module resolution

Loader chain order: registered component module → standard runtime → built-ins → host modules (`herdr`) → the application's own files (`qjs/mod.rs:1824-1845`) [V].

| Specifier | Resolves? | Cite |
|---|---|---|
| `gpui-kit`, `gpui` (alias), `gpui-base`, `gpui-shell` (types only; runtime exports nothing), `gpui-fps` | Yes | `qjs/mod.rs:1302-1308`, `:1224` |
| `gpui-component` | Reserved; resolves only when a component catalog is registered (herdr uses the default registry) | `shell/component_registry.rs:142`, `qjs/mod.rs:5456-5491` (I for herdr) |
| `buffer`, `console`, `crypto`, `fs/promises`, `net`, `os`, `path`, `process`, `url`, `websocket`, `zlib` | Yes | `qjs/standard/mod.rs:29-64`, `shell/host_modules.rs:785-805` |
| `herdr` | Yes (host module per copy) | `src/mods.rs:1130`, `:1474` |
| `"./x.js"`, `"../lib/x.js"` (relative) | Yes, if the canonical path stays inside the mod folder; else ``"module `…` resolves outside the application directory `…`"`` | `qjs/mod.rs:5625-5629`, `:5704-5712` |
| `"lib/x.js"` (bare, contains `/`) | Resolves **relative to the mod root** | `qjs/mod.rs:5649` |
| Any other bare name | ``"cannot resolve module `name`: this runtime's built-in modules are …"`` | `qjs/mod.rs:5686-5697` |
| Extension | Tries the exact path, then `path.with_extension("js")` — note `with_extension` **replaces** an existing extension (`./a.b` → `./a.js`) | `qjs/mod.rs:5652-5661` |
| JSON import / import attributes | No JSON loader; attributes ignored; a `.json` file would be parsed as JS [I → fails] | `qjs/mod.rs:5722-5742` |
| `.mjs`, `.ts`, `node_modules` | No special handling | `qjs/mod.rs:5652` |
| Dynamic `import()` | Allowed, same confinement, returns a promise | `qjs/sandbox.rs:24-28`, `:757-764` |
| Top-level `await` | Module evaluation ends with `promise.finish::<()>()`, which only pumps QuickJS jobs; awaiting host work cannot complete there [I: errors]. AGENTS forbids it | `qjs/mod.rs:2430-2434`, `defaults/AGENTS.md:1074-1075` |

Module identity: resolved names are tagged `?v=<generation>`; each source revision is a new generation; module scope is shared by all copies of the same revision and survives after they close (`qjs/mod.rs:5494-5538`, `qjs/mod.rs:1662-1666`, `defaults/AGENTS.md:1067-1070`). Editor-only files (`jsconfig.json`, `.d.ts`, hidden, `node_modules`) do not trigger reload (`defaults/AGENTS.md:942-944`).

---

## 10. Hot reload mechanics (runtime view)

[V] `shell/watch.rs:521-588`: inside a Task scope the module graph is re-evaluated (new generation), a **new instance** is constructed and its `init` runs **while the old build's timers/tasks are still alive**; only after success is the old application generation released (cancelling its tasks; stranded ones logged: `"a reload stranded script tasks that will never settle (…); re-register background work from init()"`, `qjs/scheduler.rs:398-424`) and the view's object swapped. The old instance gets no `close()` and no handle to the new one. Any old `cx` then throws the "reloaded or closed" error. On failure the old build keeps running.

Hand-over channels available to the new `init` [V/I]: the shared synchronous `localStorage` cache (same path ⇒ same object, `shell/policy.rs:171-183`) and `globalThis` (shared by the whole VM; AGENTS warns against module-top-level `globalThis` side effects, `defaults/AGENTS.md:945-947`). Neither survives `restart_mods` (new VM) except what is already on disk.

---

## Implications for our game

**Do**
1. Keep every synchronous slice tiny: `render` ≤ a few ms (hard kill at 50 ms, layout items too); handlers, timer ticks, each `cx.spawn` continuation ≤ ~50 ms (hard kill at 500 ms). Module evaluation of the *whole* import graph + nothing else must fit 500 ms: no top-level computation, no balance-table generation at import time.
2. Do engine catch-up (offline 8 h) in chunks across `cx.spawn` + `await cx.sleep(0)` slices, or closed-form math; never one big loop.
3. Use `Object.create(null)` (or `Map`) for every map keyed by agent addresses, terminal ids, names or saved keys; rebuild such maps from parsed JSON into fresh null-prototype objects; test keys with `Object.hasOwn`. Include `"__proto__"`, `"constructor"`, `"toString"` in engine fuzz tests.
4. Wrap every entry point body in `try/catch` and route errors to an in-game error state + `notify`/status — handler and timer errors are otherwise log-only, and bare promise rejections are silent. Always start async work with `cx.spawn` (adopted, logged) and `.catch` inside.
5. Persist through herdr `writeTextFile` (atomic, compare-and-swap) for `save.json` and its backup; use `localStorage` only for small, per-copy UI state and as the hot-reload hand-off, and `await localStorage.flush()` where loss matters (it is the only way to see write failures).
6. Build all file paths as absolute paths from `appHome()`; never relative (relative reads resolve under `$HOME`).
7. Re-register timers in `init`; use one `cx.timer.every` (≥ 1 s for data, never for animation) and native `.frames/.loop/.transition` for motion. Count outstanding tasks: the 1024 limit is shared with every other mod.
8. Grapheme-safe truncation without `Intl.Segmenter`: iterate code points (`for…of`) and keep ZWJ (`U+200D`), variation selectors (`U+FE0E/F`), skin tones (`U+1F3FB–1F3FF`), combining marks and regional-indicator pairs attached to their base; prefer the native `.truncate()` style for display.
9. Format numbers ourselves (suffix tables) — no `Intl.NumberFormat`, and `toLocaleString` options are unreliable.
10. Keep the engine free of `Date.now`/`Math.random`; the glue passes wall-clock ms (`Date.now()`, real) and a seeded PRNG state in. Use `performance.now()` only for frame-time diagnostics.
11. Keep the save JSON < 1 MiB (also `readTextFile`'s 1 MiB cap) and any value passed to `setShared` ≤ 16 levels deep and arrays ≤ 10 000 items.

**Don't**
1. Don't call `cx.notify()` in `render`; don't create focus handles, entities or timers in `render`.
2. Don't keep a `cx` past its callback; don't rely on a task continuing after reload.
3. Don't use `setTimeout`, `eval`, `new Function`, `require`, `structuredClone`, `TextEncoder`, `Intl`, `queueMicrotask` (unverified), JSON imports, top-level `await`, or bare package imports.
4. Don't patch or extend `Object/Array/Function/String/Number.prototype` (TypeError), and don't monkey-patch `Date`/`Math`/`globalThis` (shared VM).
5. Don't write the save with `fs.writeFile` (non-atomic, no rename available); don't use `localStorage` bracket syntax; don't assume `localStorage` sees another process's writes.
6. Don't let module-level state be the only copy of game state (VM restarts on memory pressure; module generations leak on every reload, so keep module-scope allocations small).
7. Don't throw from timers expecting them to stop — `every` keeps firing; cancel explicitly.

---

## Open questions

1. Exact quickjs-ng version inside `quickjs-jit-sys@96593cd` (not vendored). Needed to pin our wasm harness (QuickJS-ng release with matching semantics).
2. Whether `queueMicrotask`, `structuredClone`, `TextEncoder/TextDecoder`, global `URL`/`Buffer`/`crypto` exist after `quickjs_jit_stdlib::init` (`qjs/standard/mod.rs:69`; source not vendored). Treat as absent.
3. Exact text of the interrupt error (expected `InternalError: interrupted`) and of stack overflow.
4. Whether `toLocaleString(locale, options)` ignores its arguments in this build.
5. Whether `\p{Extended_Pictographic}` and the RegExp `v` flag are supported (helps grapheme handling).
6. Behaviour of top-level `await` on a host promise during `promise.finish()` (error vs. hang) — moot if we never use it.
7. Whether two herdr *processes* can run against one appHome at once (affects "two windows share one save"); in-process overlay windows share one VM and one `localStorage` cache.
8. Precise ordering on `restart_mods`: are old policies dropped (store weak-ref released) before new copies load, i.e. is unflushed `localStorage` lost? (`src/window.rs:4442-4460`, `shell/policy.rs:171-183`).

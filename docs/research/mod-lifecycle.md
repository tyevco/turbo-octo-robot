# Mod lifecycle, hot reload, multi-copy and multi-window behaviour

Source: herdr-app v0.1.18, commit `a2e8e3f` (read-only clone). All paths are relative to the
herdr-src root. **[V]** = verified in source (cited). **[I]** = inferred from the cited code but
not exercised by a test or stated in docs.

---

## 1. Hot reload: what happens when a file in `mods/<name>/` is saved

### 1.1 Trigger path

| Step | What happens | Cite |
|---|---|---|
| OS watcher | One recursive `notify` watcher on the app home; events are filtered by `watched()`. | src/files.rs:77-102, src/files.rs:123-131 |
| Which files count | Under `mods/<name>/`: every path except components starting with `.`, ending in `~`, named `node_modules`, a root-level `jsconfig.json`, or any `gpui-kit.d.ts`. **Any extension counts** (`.json`, `.md`, `.png`, …), not just `.js`. | src/files.rs:137-142, vendor/gpui-kit/crates/shell/src/watch.rs:61-66, test src/files.rs:639-654 |
| Not watched | `data/…`, `shared.json`, `view.json` (only `mods`, `layouts`, `themes`, `settings.json`, `keys.json`, `programs.json`). | src/files.rs:121-131, test src/files.rs:628-636 |
| Batching | After the first event the window waits **80 ms** and drains further events into one batch. | src/window.rs:674-683 |
| No-op filter | `mod_stamp` (size + mtime of every counted file, ≤4096 entries, depth ≤8) is compared to the previous stamp; unchanged → no reload. | src/window.rs:4370-4376, src/files.rs:462-484 |
| Fallback | Only when the OS watcher could not start does herdr use gpui-shell's polling `Watcher` (`js`/`mjs` only, 200 ms debounce). | src/window.rs:1881-1883, vendor/gpui-kit/crates/shell/src/watch.rs:71, :84 |

Consequence **[V]**: writing any non-hidden file into `mods/<name>/` (e.g. a save file) reloads every
copy of the mod. Writing under `data/<name>/` never does.

### 1.2 The reload itself (`files_changed` → `ShellRuntime::reload_now` → `watch::reload`)

For every **loaded** copy of an edited mod (hidden copies included — the filter is on
`c.root.is_some()`, not visibility) herdr calls `runtime.reload_now(root, …)` synchronously, one copy
after another, on the UI thread (src/window.rs:4407-4419). `reload` does, in order
(vendor/gpui-kit/crates/shell/src/watch.rs:521-586):

1. Refuses if called during a render/layout phase ("a reload was requested during the {} phase; …") (:529-538).
2. Keeps the **same `Policy`** (`let policy = view.read(cx).policy();` :539) → same `herdr` host module
   instance (same `props()`, same copy id, same `nextCommand` channel), same `localStorage` store.
3. `load_app` → module evaluated (or taken from the code cache) (:550-553).
4. `instantiate_for_view` → **new instance** via `new Class()` then `init(undefined, asyncCx)`
   (:554-557; vendor/gpui-kit/crates/shell/src/engine/quickjs/mod.rs:3131-3167, :6839-6841).
5. On any error in 3/4: return `Err`, **old instance keeps running untouched** (:561-564).
6. On success: `release_application_generation(&previous)` — retires the old generation (:571-579).
7. `view.replace_object(object)` — the `ScriptView` entity (window, focus, element ids) is kept; only
   the script object is swapped; view marked dirty and re-rendered (:581-585; vendor/gpui-kit/crates/shell/src/view.rs:164-173).

| Question | Answer | Cite |
|---|---|---|
| Is the old instance dropped? | Yes, replaced in the view (`self.object = object`). JS GC frees it unless something (e.g. `globalThis`) still references it. | view.rs:170-173 **[V]**; GC part **[I]** |
| Is `close()` called on reload? | **No.** `reload` never calls `start_close`; it goes straight to `release_application_generation`. | watch.rs:521-586 vs engine/quickjs/lifecycle.rs:44-78 **[V]**; also test name `reload_releases_a_pending_tcp_read_without_a_close_hook` src/mods/lifecycle_tests.rs:833 |
| Does the new instance get `init(props)` fresh? | A brand-new object is constructed and `init` runs **with `props === undefined`** (top-level views never get init props; herdr mods read props via `props()` from `"herdr"`, which is unchanged). Instance fields from the old build are **not** carried over. | engine/quickjs/mod.rs:3158, :2546, :6839-6841; src/mods.rs:1353 **[V]** |
| When are timers/tasks cancelled? | **After** the new `init` succeeded (step 6). The new init runs while the old generation is still alive (but single-threaded, so old callbacks cannot interleave synchronously). `cancel_application_generation` marks the generation retired and removes every task of that generation. Pending promises are **never settled** (no rejection); host futures are dropped (a pending TCP read is closed). Old click/timer callbacks are rejected ("belongs to a retired application", debug log). | engine/quickjs/mod.rs:2266-2278, :1083-1085; engine/quickjs/scheduler.rs:399-424, :49, :552-554, :954-963; engine/quickjs/mod.rs:3968; tests src/mods/lifecycle_tests.rs:833-889, vendor/gpui-kit/crates/shell/src/tests/reload_tasks.rs:119-128 **[V]** |
| A loop `for(;;){ await x; … }` in the old build? | It stops: its next awaited promise never resumes ("a loop ends at its next `cx` use"). If tasks were stranded, a warning is logged: "a reload stranded script tasks that will never settle (…); re-register background work from init()". | defaults/AGENTS.md:944-945; engine/quickjs/scheduler.rs:415-418 **[V]** |
| `cx.spawn(…, { owner: this })` in the new `init`? | Allowed: the initializing instance counts as the running view. | engine/quickjs/scheduler.rs:1663-1672; test src/tests/reload_tasks.rs:175-192 **[V]** |
| First `nextCommand` after reload | Reaches the new build (old pending receive is cancelled and dropped, not consuming the message). | engine/quickjs/scheduler.rs:1251-1253; test src/tests/reload_tasks.rs:195-228 **[V]** |
| Is `localStorage` preserved? | Yes. The store belongs to the policy, which reload reuses; in-memory cache and write queue continue. | watch.rs:539; vendor/gpui-kit/crates/shell/src/policy.rs:171-183 **[V]** |
| Does module top-level code re-run? | Yes, **once per source revision** (shared by all copies). The code cache is keyed by `fingerprint(root, entry, dependencies, revision)`; a new revision re-evaluates the module under a new specifier `…?v=<lease generation>`. Copies of the same revision reuse the evaluated class. | engine/quickjs/mod.rs:2338-2396; defaults/AGENTS.md:1067-1070 **[V]** |
| Is `globalThis` preserved? | Yes, within the same VM: one QuickJS context hosts **every mod of the window**; a reload re-evaluates into that same context. Tests rely on `globalThis.trace ??= []` surviving reloads. | engine/quickjs/mod.rs:1816; engine/quickjs/sandbox.rs:110-114 ("One VM hosts several plugins"); src/tests/reload_tasks.rs:91-99, :119-128 **[V]** |
| Old module memory | Never freed: QuickJS frees evaluated modules only with the whole context. | src/window.rs:4392-4395; engine/quickjs/mod.rs:2157-2166 **[V]** |

### 1.3 VM restart (the reload you do not control)

Heap ceiling per VM: `256 * 1024 * 1024` bytes (engine/quickjs/sandbox.rs:407-409).
`RESTART_MODS_AT = 0.75` (src/window.rs:304). When an edit arrives and `memory_share() >= 0.75`, or a
(re)load fails with out-of-memory, herdr calls `restart_mods` (src/window.rs:4396-4405, :4420-4422,
:1890-1901), rate-limited to once per 60 s (`load_recovery`, src/window.rs:4398, :4426-4428):

- Every copy is closed on the old VM via `remove_copy` → **`close(cx)` IS called** with a 250 ms
  deadline (src/window.rs:4467-4470, :1425-1431).
- Toasts are closed; overlays (dialogs, popups, windows) are reloaded; shown layout copies load fresh
  in a **new VM** (`ShellRuntime::replace_default`) — **`globalThis` is empty**, module top level runs
  again, `init` runs fresh (src/window.rs:4442-4494).
- `localStorage`: the new copy's policy is built by `prepare_load` → `with_shared_storage_path`; while
  the closing copy still holds the store `Rc`, the new copy shares that live store, otherwise the
  file is re-read from disk (src/mods.rs:1448-1477; policy.rs:172-183). **[I]** for the timing overlap.

Each reload grows the heap, so a long editing session (or a mod that allocates a lot) eventually
takes this path. **[V]** (src/window.rs:6510-6528 test comments: "256 MiB ceiling fails a reload within twenty edits unless…").

### 1.4 Broken save

| Kind of breakage | Result | Cite |
|---|---|---|
| Syntax error / import error / top-level throw / missing `export default` class | `load_app` fails; old build keeps running; `copy.error = Some(msg)`; `tracing::warn!("mod reload failed: {e}")`. Top-level code **before** a throw has already run. Failed results are cached per revision when cacheable (copies of the same broken revision are not re-evaluated). | src/window.rs:4410-4418; engine/quickjs/mod.rs:2381-2395; defaults/AGENTS.md:945-947 |
| `init` throws in the new build | New generation released; old instance keeps running. | engine/quickjs/mod.rs:3158-3164; watch.rs:561-564 |
| Where it shows | **Not in the UI**: the block keeps rendering the old root (the `render_slot` arm matches `root: Some` before looking at `error`). Visible only in `herdr-app status` (`"mod <name>: <error>"`) and the log. gpui-shell's "Reload failed" toast is only pushed when the window root is a `ShellRoot` (gpui-shell's own binary / polling fallback), not in herdr's `AppWindow`. | src/window.rs:4750-4751, :4220-4229; watch.rs:483-506 **[V]**; "no toast in herdr" **[I]** (AppWindow is not a ShellRoot) |
| Retry | Next save of that mod re-runs the reload; a failed *initial* load is retried when its folder changes. | src/window.rs:4380-4384, :4509-4513 |
| Half-written file | The 80 ms batch is the only debounce in the OS-watcher path; an editor that writes in bursts >80 ms apart can trigger a reload of a partial file → error until the final write's event reloads again. | src/window.rs:676-679 **[I]** |

---

## 2. Initial load, failure display, error surfaces

- `load()` → `mods::prepare_load(inst)` (new policy, new copy number) → `runtime.try_load(dir)`
  (src/window.rs:1871-1903). Entry is `main.js` unless a gpui-kit manifest names another
  (vendor/gpui-kit/crates/shell/src/plugin.rs:1328-1345).
- Load runs inside a `ScopePhase::Task` scope; `instantiate` opens its own `Event` scope
  (plugin.rs:1243-1248; engine/quickjs/mod.rs:2537-2546). Budgets: render/layout **50 ms**,
  event/task **500 ms**, detached (no scope) **5 s**; the clock restarts per scope generation, so
  module evaluation and `init` each get 500 ms (engine/quickjs/sandbox.rs:435-443, :497-520). **[V]**
- Failed initial load: the slot renders, in the theme's `blocked` colour,
  `"{name} did not load:\n\n{error}\n\nFix the files; Herdr retries on save."` (src/window.rs:4781-4789);
  floats: `"{name} did not load: {e}"` (src/window/floats.rs:147).
- Missing folder: `"no mod folder ~/.config/herdr-app/mods/{name}"` (src/window.rs:1874).
- Render throws: a banner over the last good UI (`error_banner`), or `error_overlay` when nothing was
  ever built (vendor/gpui-kit/crates/shell/src/view.rs:318-327, runtime.rs:505-514).
- Exceptions in jobs/timers: reported to the log, the drain continues (engine/quickjs/scheduler.rs:130).
- `.error` files exist only for `settings`, `keys`, `layout`, `programs` — **never for mods**
  (src/window.rs:933, :1079, :4222-4224; defaults/AGENTS.md:55-57).
- `herdr-app status` aggregates: those `.error` files + every copy's `error` + `mod.json` manifest
  errors + `link.js` errors + layout document errors (src/window.rs:4220-4229).
- Link handler errors show a toast (defaults/AGENTS.md:1006-1008).
- Consequence: **a mod's own runtime problems (e.g. save failures) are invisible unless the mod shows
  them** — via its UI, `notify()` toast, or both.

---

## 3. Copies of a mod

### 3.1 Where copies come from

| Source | Slot key | Props seen by the copy | Cite |
|---|---|---|---|
| Layout block `{ "mod": name, "props"? }` | block id | as written (`null` if absent) | src/window.rs:1285-1287; src/layout.rs:14-19 |
| Stack header mod | `<stack id>#header` | as written | src/window.rs:1291-1296 |
| Pane header mod | `<pane id>#frame` | given props + `pane`, `terminal` | src/window.rs:5464-5469 |
| Pane mod in a tab (`tab.new {mod, props}`) | node id | as given | defaults/AGENTS.md:137-139 |
| Overlay (`openOverlay`, `mod.open`) | `overlay:<id>` | given props (object) **+ `overlay: "o<N>"`** | src/window.rs:4012-4020; src/mods.rs:818-824 |
| Float block | `float:<id>` | as written | src/window.rs:1641-1646 |
| Link handler (`link.js`) | none (no view) | — shares store with **null-props** views | src/mods.rs:1479-1486; defaults/AGENTS.md:1001-1002 |

There is no limit on the number of copies **[I]** (no cap found in `sync`, src/window.rs:1629-1648).
Each copy has its own instance, tasks and `herdr` module (own `props()`, own command channel)
(src/mods.rs:1454-1477; defaults/AGENTS.md:1069). All copies of all mods in a window share **one
QuickJS VM and one `globalThis`** (§1.2).

### 3.2 Copy life

- Starts the first time its slot is shown; stays alive while the slot is in the layout, shown or not
  (hidden column, inactive stack child, pane in another tab); timers keep running while hidden.
  A different layout starts its layout mods fresh (pane mods and overlays stay). A block given
  another mod or other props starts over (defaults/AGENTS.md:948-953; src/window.rs:1629-1648, :1414-1423).
- `<mod>.<command>` keys reach **shown** copies only (src/mods.rs:784-799, :814-816).

### 3.3 `localStorage` sharing (`data/<name>/store*.json`)

`mod_policy` (src/mods.rs:1454-1477):

```rust
let dir = app_dir().join("data").join(&inst.name);
let _ = std::fs::create_dir_all(&dir);
let file = if inst.props.is_null() { "store.json".to_owned() } else {
    /* DefaultHasher over inst.props.to_string() */
    format!("store-{:016x}.json", h.finish())
};
… .with_shared_storage_path(dir.join(file))
```

- Copies with the **same name and same props** share one live in-memory store and write queue
  (`SHARED_STORES`, a thread-local `BTreeMap<PathBuf, Weak<LocalStore>>`) (policy.rs:62, :171-183).
- Overlay copies always differ (their props carry a fresh `overlay` id), so **every overlay opening
  gets its own `store-<hash>.json`**; these files accumulate. **[V]** for the props, **[I]** for accumulation.
- `DefaultHasher` output is not guaranteed stable across Rust releases, so `store-<hash>.json` names
  for non-null props may change after a herdr update **[I]**. Null-props `store.json` is stable.
- Limits: 8 MiB file, 4096 keys, 1 MiB per value; values are strings; a malformed store file makes
  every `localStorage` call throw ``"`<path>` is not a valid store file: …"`` — **no automatic
  recovery** (vendor/gpui-kit/crates/shell/src/storage.rs:41-43, :188-227, :362-389).
- Writes are cached and persisted asynchronously (temp + rename + parent fsync) one at a time;
  `await localStorage.flush()` resolves when the revision is on disk (storage.rs:395-420;
  engine/quickjs/host.rs:557-639).
- The store is read once when the first policy for that path is created; another **process** writing
  the same file is never seen, and each process overwrites the whole file **[I]** (policy.rs:162-168).

---

## 4. Multiple windows / processes; "two windows share one save"

| Fact | Cite |
|---|---|
| App home = `$HERDR_APP_HOME`, else `$XDG_CONFIG_HOME/herdr-app`, else `~/.config/herdr-app` (empty values ignored). | src/mods.rs:60-65 |
| **One herdr per home.** A bare launch first connects to `<home>/herdr-app.sock`; if a server answers (or merely accepts), it sends `{"raise":true}` and exits. | src/main.rs:125-127; src/control.rs:56-69 |
| A second process that gets past that (race) does not serve the socket: log "another Herdr is serving {}; `herdr-app do` goes there". | src/control.rs:19-25 |
| **One OS window per process**: `open_main` opens exactly one `AppWindow`. | src/main.rs:235-259 |
| `windows.json` is **not** OS windows: it stores mod overlay windows (`kind: "window"`) — dropped spots by key and kept windows per layout. `window.json` is the main window's size/position. | src/window/movable.rs:24-40; defaults/AGENTS.md:91 |
| `shared.json` is per process: loaded lazily once, mutated in memory, written by a background thread with `persist::write_atomic` (latest snapshot wins), joined at quit after mod close handlers. Invalid file → renamed to `shared.json.corrupt-<time>` and started empty. Another process's writes are never re-read. | src/mods.rs:484-582, src/window.rs:212-218; defaults/AGENTS.md:93-96 |
| `setShared` → re-renders every mod in the window (`Request::Refresh` → `refresh_mods`). | src/mods.rs:488-493; src/window.rs:4196, :1905-1923 |
| macOS: closing the window hides the app (mods keep running); Cmd+Q quits. | src/window.rs:633-639 |

So in herdr v0.1.18 **two windows can only coexist as two processes with different app homes**
(different `HERDR_APP_HOME`/`XDG_CONFIG_HOME`), which means different `data/`, `shared.json` and
`mods/` folders. Nothing in herdr shares state between them. The realistic "two views of one save"
cases are therefore:

1. **Several copies in one window** (layout block + overlay + pane): same VM, same `globalThis`,
   possibly different `localStorage` files (§3.3). Coordinate in memory.
2. **Two processes with different homes** pointing the game at **one absolute save path** (e.g. via a
   setting) — only `writeTextFile`'s compare-and-swap protects them (§6), and its cross-process
   window is not closed (§6.3).
3. **`herdr-app check` running while the window is live** — a separate process that runs `init()`
   for real (§5).

---

## 5. `herdr-app check`, `checking()`, `window()`

- `herdr-app check <dir>` → `mods::install_check_policy()` (sets `CHECKING = true`; `shared` in memory,
  `writable: false`) → gpui-shell `check` → `try_load` (module eval + **`init()` for real**) → one
  `build_snapshot` + eager materialization in a hidden window → exit. No layout, no deferred rows, no
  later async states (src/main.rs:101-119; src/mods.rs:1425-1430; vendor/gpui-kit/crates/shell/src/host.rs:453-530, plugin.rs:1347-1380; defaults/AGENTS.md:58-61, :1010-1023).
- During a check `exec`, `hc`, `writeTextFile` **really run** and log warnings
  ("check: mod wrote `{path}`; the write lands for real") (src/mods.rs:1135, :1152, :1157).
  `readTextFile` reads real files.
- `checking()` → `true` throughout a check, `false` in a live window (src/mods.rs:41-47, :1159;
  tests src/mods/lifecycle_tests.rs:689-738).
- `window()` → `null` during a check (Snapshot default `window: Value::Null`, src/mods.rs:626-630);
  live value `{platform, titlebar, buttons, maximized, fullscreen, active, visible}` where
  `visible = window.is_visible()` (src/window/titlebar.rs:76-98). Platform meaning of `visible`:
  defaults/herdr.d.ts:302-308. Re-published on visibility change so mods re-render
  (src/window.rs:625-630). Timers keep running while hidden (defaults/AGENTS.md:1101-1105).
- `localStorage` during a check goes to gpui-shell's own data dir
  (`$XDG_DATA_HOME|~/.local/share/gpui-shell/apps/<dir>-<hash>/store.json` on Linux), not herdr's
  `data/<name>/` **[I]** (host.rs:603-628, lib.rs:236-244, runtime.rs:30-33, :89-110).

---

## 6. `readTextFile` / `writeTextFile` (src/mod_files.rs)

Signatures (defaults/herdr.d.ts:27-32):

```ts
export function readTextFile(path: string, options?: { on?: string | null }): Promise<string | null>;
export function writeTextFile(path: string, text: string, expected: string | null): Promise<null>;
```

### 6.1 `readTextFile`

- `LIMIT = 1024 * 1024` bytes (src/mod_files.rs:8). Larger → `"Text file exceeds 1 MiB"` (:42-44).
- Missing file → `null` (:35). Not a regular file (dir, FIFO, symlink to FIFO) → `"Not a regular file"`
  (:16-30; test :164-180). Opened `O_NONBLOCK` on Unix (:21-26).
- Non-UTF-8 → the io error text from `read_to_string` **[I]** (:38-41).
- Runs on a fresh OS thread; concurrent reads of the same `(machine, path)` share one result
  (:101-122; test :182-198). `on` reads on a remote machine (src/mods.rs:1139-1143).

### 6.2 `writeTextFile` — exact algorithm (src/mod_files.rs:48-98, :124-140; src/mods.rs:1149-1154)

```rust
let expected = a.get(2).and_then(|v| match v { HostValue::Str(s) => Some(s.clone()), _ => None });
```
→ `null`, `undefined`, omitted, or any non-string `expected` all mean **"file must not exist"**.

1. Take process-wide `static WRITES: Mutex<()>` (:9, :49).
2. `text.len() > LIMIT` → `"Text file exceeds 1 MiB"` (:50-52).
3. `read(path)?` compared with `expected`; mismatch →
   **`"The file changed outside Herdr. Reload before saving; your draft is still here."`** (:53-58).
   (A read error such as "Not a regular file" or "Text file exceeds 1 MiB" is returned as is.)
4. `path.parent()` missing → `"File needs a parent directory"`; **`create_dir_all(parent)`** — parents
   are created (:59-60).
5. `expected == None`: `OpenOptions::new().write(true).create_new(true)` then `write_all` — **not
   atomic, no temp file**; if the file appeared meanwhile the OS error text is returned (e.g.
   "File exists (os error 17)" **[I]**) (:61-68).
6. Otherwise: resolve symlinks (`persist::resolve_target`, ≤40 hops, "Too many symlinks")
   (src/persist.rs:8-22); temp file in the target's directory named
   `.herdr-app-write-<unix nanos>` (create_new); copy the target's permissions; `write_all`;
   **re-read the target** and compare with `expected` again → mismatch:
   **`"The file changed while saving. Reload before saving."`**; `rename(temp, target)`; always
   `remove_file(temp)` afterwards (:69-97).
7. Promise resolves `null`; failures reject with an error carrying the message (HostError)
   (:133-139). **[I]** that the JS value is an `Error` whose `message` is that text
   (engine/quickjs/scheduler.rs:1216-1220 pattern).

### 6.3 Guarantees and gaps

| Property | Status |
|---|---|
| Atomic replace vs readers | Yes for updates (rename in same dir). **No** for creation (step 5): a reader or crash can see a partial new file. |
| Durability | **No `fsync`** of file or directory in `mod_files::write` (contrast `storage::persist`, which syncs the parent). Power loss can lose the last write **[I]**. |
| CAS within one process | Serialized by `WRITES` mutex: exact. |
| CAS across processes | Not locked: another process can write between step 6's re-read and the rename → lost update **[I]**. |
| Path restrictions | **None.** No capability check in the herdr host function; `Path::new(path)` is used directly, so relative paths resolve against the **process cwd**, `~` is not expanded. Use absolute paths built from `appHome()`. (The `write_roots([app])` capability applies to gpui-kit's `fs/promises`, not to these host functions.) (src/mods.rs:1149-1154, :1407-1422) |
| Comparison | Exact full-text string equality. `expected = ""` on a missing file fails (missing ≠ `""`). |
| Files > 1 MiB | Can never be replaced through `writeTextFile` (the pre-read fails). |
| Leftovers | A crash between steps leaves hidden `.herdr-app-write-*` files in the directory. |

---

## 7. `close(cx)` semantics and the 250 ms budget

Declared: "The exported View may implement async close(cx) for bounded final cleanup."
(defaults/herdr.d.ts:492). Rules: defaults/AGENTS.md:1080-1089.

| When | Call | Deadline | Cite |
|---|---|---|---|
| Slot removed (block gone/changed, pane/tab closed, overlay closed, layout switch drops layout copies), VM restart | `runtime.close(root, now + 250 ms)` detached; polled every 5 ms | 250 ms per removal | src/window.rs:1414-1431, :4467-4470; lifecycle.rs:82-100 |
| Window close (Linux/Windows), titlebar close, app quit | `close_now(root, deadline)` for **every** copy with one shared deadline (`now + 250 ms`), in sequence; native awaits are pumped synchronously | 250 ms shared by all copies of all mods | src/window.rs:640-643, :1433-1440; src/window/titlebar.rs:213; src/main.rs:195-211; lifecycle.rs:104-114 |
| Hot reload (same VM) | **not called** | — | watch.rs:521-586 |
| `herdr-app check` | not called (process exits) **[I]** | — | host.rs:521-527 |

Mechanics (engine/quickjs/lifecycle.rs):
- Called **at most once** per generation (`close_deadline` set; second call returns immediately)
  (:52-55; test src/mods/lifecycle_tests.rs:741-772).
- If the deadline has already passed when this copy's turn comes, **`close` is not invoked at all**
  (:60, `if Instant::now() < deadline`). On quit, a slow earlier mod can starve ours.
- A synchronous loop in `close` is interrupted at the deadline (sandbox.rs:498-502; test lifecycle_tests.rs:1025-1040).
- After the promise settles or the deadline passes, the generation is released (tasks cancelled) (:97, :113).
- In `close_now`, host async calls (`exec`, `writeTextFile`, …) started in `close` run on their own
  thread and are pumped until done or deadline (engine/quickjs/scheduler.rs:1268-1296;
  test lifecycle_tests.rs:969-998).
- On quit, `exec(...)` and `run("terminal.kill", …)` are delivered before the loop stops; other
  `run` commands may not (src/mods.rs:458-470, :1263-1280; defaults/AGENTS.md:1086-1088).
- `setShared` in `close` reaches disk on quit: `finish_shared()` runs after the close handlers and
  joins the writer (src/main.rs:203-208; src/mods.rs:499-507).
- `localStorage` persistence uses `detached_on` (foreground-executor spawn), which is **not** pumped
  by `close_now`'s synchronous loop, so a final `localStorage` write or `await localStorage.flush()`
  at quit may not land **[I]** (engine/quickjs/host.rs:557-603, scheduler.rs:1030-1043).

---

## 8. The `data/` directory

- Created by herdr for **every copy load**: `app_dir()/data/<inst.name>/` (`create_dir_all`,
  error ignored) and used for that mod's `localStorage` files (`store.json`, `store-<hash>.json`)
  (src/mods.rs:1459-1460). Verified by test: `data/viewer/store.json` (src/window.rs:7938).
- Documented as "mod state … written by Herdr" (defaults/AGENTS.md:91).
- The only other herdr use: `data/frame-feedback/` for feedback screenshots (src/feedback.rs:35).
- Not watched (no reload, no re-render on change) (src/files.rs:121-131).
- No API names it: there is no `dataDir()`; build it as `appHome() + "/data/<name>"`
  (`appHome` = src/mods.rs:1161). Nothing in herdr deletes `data/<name>/` **[I]** (no
  `remove_dir_all` on it in src/).
- Free for mods in practice: `writeTextFile` may write there (no restriction) and herdr's only files
  there are `store*.json` **[I]**. `mod.clone` copies the mod folder only; a clone gets its own
  `data/<clone>/` **[I]** (src/mods.rs:227-282).
- Mod folder names accepted by clone: `[A-Za-z0-9_-]+` (src/mods.rs:219-221).

---

## Implications for our game

**Hot reload / handover**
- DO keep all game state in one plain-data object owned by the pure engine, and register **all**
  timers/tasks in `init` (they are cancelled on reload and never resumed).
- DO implement handover through a namespaced `globalThis` slot, e.g.
  `globalThis[Symbol.for("<name>/live")]`, holding `{ state, rev, writer }` (a null-prototype object).
  On `init`, adopt it if present (same-VM reload: no rollback); else load from disk. Set the slot
  **only from `init`/tasks**, never at module top level (a broken build's top level still runs).
- DO assume `close()` is **not** called on reload and that `init` gets `props === undefined`; read
  props with `props()`.
- DO also survive the VM-restart path: `globalThis` is gone, `close()` gets ≤250 ms. Therefore save
  to disk continuously (debounced, e.g. every 5–15 s and on important events), not only in `close`.
- DON'T write anything inside `mods/<name>/` at run time — any non-hidden file there reloads every copy.
- DON'T keep a `cx`; DON'T expect old promises to reject — they just never settle.

**Copies**
- DO elect one writer per process via the `globalThis` slot (e.g. the first live copy; re-elect
  when its `close` runs or its heartbeat stops). Other copies (overlay, pane) read the shared live
  state and send intents to it.
- DON'T use `localStorage` for the save: overlays get a different store file per opening, a
  malformed store throws on every call, other processes' writes are invisible, and quit-time writes
  may be lost. Use it at most for per-copy UI conveniences (null-props copy only).

**Save files**
- DO write `appHome() + "/data/<name>/save.json"` with absolute paths only; never relative paths.
- DO always pass the exact text last read/written as `expected`; on
  `"The file changed outside Herdr…"` / `"The file changed while saving…"` re-read, merge
  (engine-level merge by monotonic `rev`/`savedAt`), and retry a bounded number of times.
- DO create the file with `expected = null` only after `readTextFile` returned `null`; creation is not
  atomic, so validate on load (checksum/`rev`) and fall back to the backup.
- DO keep a backup (`save.bak.json`, written with its own CAS) and a damaged-file path: on parse/
  validation failure keep the bad text aside (`save.corrupt-<n>.json`), load the backup, and tell the
  player.
- DO keep save text well under 1 MiB (cap history arrays; 30+ helpers must still fit).
- DO surface every save error in the game UI (status chip) and, rate-limited, with `notify()` — herdr
  shows nothing for mod runtime errors except in `herdr-app status`.
- DO NOT rely on fsync: there is none; keep the previous good file (backup) so a torn/lost write is recoverable.

**Check / close / visibility**
- DO `if (checking()) return;` at the top of `init`'s side-effect section: no `writeTextFile`, no
  `exec`, no timers in a check; render a static preview instead. `window()` is null there — use `?.`.
- DO make `close` start the final `writeTextFile` immediately (no awaiting earlier work); expect it
  may not be called at all on quit if other mods used the shared 250 ms.
- DO pause gathering timers when `window()?.visible === false` and settle elapsed time from the
  saved timestamp on return (the same path as offline progress).
- DON'T call `setShared` per tick: each change re-renders every mod in the window and rewrites
  `shared.json`.

**Two windows**
- One herdr process per app home and one window per process: two windows means two homes. If we
  support "two windows share one save", it must be via an explicit absolute save path shared by
  both homes, protected by CAS + merge-by-rev; document that the cross-process race window exists.

## Open questions

1. Exact JS error shape on `writeTextFile` rejection (is it `Error` with `message` equal to the
   herdr string?) — the host-module async path was not traced end to end; test it in our QuickJS harness/mock.
2. Whether `localStorage` writes and `flush()` complete during `close_now` at quit (foreground
   executor not pumped) — not covered by a test.
3. Whether `close()` is called for copies that are alive but hidden at quit: `close_mods_now`
   iterates every copy with a root (src/window.rs:1436-1438), while defaults/AGENTS.md:1082 says it
   "is not called for a hidden copy or an inactive tab" (likely meaning hiding itself is not a close).
4. Whether any herdr update/migration ever prunes `data/<name>/` or stale `store-<hash>.json` files.
5. Cross-process race between two `raise_running()` checks at the same instant (both processes could
   start); behaviour of the second window's mods with the same home was not traced.
6. `DefaultHasher`-based `store-<hash>.json` names across herdr releases (irrelevant if we do not use
   props-scoped `localStorage`).

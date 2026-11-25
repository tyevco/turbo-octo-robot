# Architecture contract

This is the contract every builder works to. Part A (platform, tooling, save and
handover) does not depend on the game's content. Part B (engine and game API)
is filled in from `docs/DESIGN.md`. Where this file and the research notes
disagree, the research notes' citations into herdr-app 0.1.18 win; fix this
file.

`<mod>` below is the game's mod folder (lower-case, hyphens) and `<Name>` its
layout stem. Tooling never hard-codes them: it reads them from
`tools/game.json` (`{ "mod": "<mod>", "layout": "<Name>" }`).

---

## Part A — platform, tooling, save, handover

### A1. Repository layout

```
layouts/<Name>.json            the layout (whole window), shipped
mods/<mod>/                    the mod, shipped (everything herdr needs)
  mod.json                     {"place":"none", ...}; valid JSON or herdr docks it at the right
  main.js                      default-exports the View; thin; wires glue + ui
  engine/*.js                  PURE game engine: no imports outside engine/, no herdr, no gpui
  glue/*.js                    herdr glue: the only files that import "herdr"
  ui/*.js                      element builders: import "gpui-kit"/"gpui-base" only, never "herdr"
  art/*.svg, art/*.png         flat vector art; art/layout-preview.png for Settings
keys.json                      keys the package expects (layout:<Name> section only)
RECIPE.md  preview.png  README.md  LICENSE
docs/                          DESIGN.md BALANCE.md ARCHITECTURE.md research/
tools/
  game.json                    {"mod","layout"}
  mock/                        mocks that run in BOTH Node and QuickJS (plain ES modules)
    gpui-kit.js gpui-base.js   element recorder (validates against the real method list)
    herdr.js                   mock "herdr" module, driven by the controller
    controller.js              scenario state, virtual clock, cx factory, fs with CAS
    gpui-methods.json          allowlist extracted from docs/research/gpui-kit.d.ts
    themes.json                graphite + paper colours exactly as src/settings.rs resolves them
  node/register.mjs            Node module hooks: "herdr", "gpui-kit", "gpui", "gpui-base" -> tools/mock/*
                               (bare "gpui-kit"/"gpui" -> node/gpui-kit-public.mjs: the real exports only)
  node/frozen.mjs              opt-in: freezes the five prototypes like the sandbox (npm run test:frozen)
  qjs/harness.mjs              QuickJS-ng (wasm) host faithful to herdr's sandbox and budgets
  render/html.mjs              element tree -> HTML/CSS for screenshots
  render/window.mjs            whole-window frame: a layout JSON + mock sidebar/tabs/terminals + mod blocks
  shots/shoot.mjs              Playwright: every view and whole windows, light + dark -> tools/out/shots
  sim/pacing.mjs               pacing simulator; reads targets from docs/BALANCE.md
  art/                         SVG generator / checker scripts (if any)
test/*.test.mjs                node:test suites
package.json                   devDependencies only; scripts: test, test:qjs, shots, sim, check
```

Only `layouts/`, `mods/`, `keys.json`, `RECIPE.md`, `preview.png` are the share package.
Everything else is development tooling.

### A2. Module rules (all of `mods/<mod>/`)

Verified constraints (see `docs/research/quickjs-runtime.md`, `mod-lifecycle.md`):

1. ES modules only. Relative imports with explicit `.js` (`./engine/state.js`). Allowed bare
   specifiers: `gpui-kit`, `gpui-base`, `herdr` (glue only). No `fs/promises`, no `fetch`, no `exec`/`hc`.
2. **No top-level side effects**: module scope may only declare constants, pure functions and classes.
   No herdr calls, no `globalThis` writes, no table generation loops at import time. The whole import
   graph must evaluate in well under 500 ms in the QuickJS harness (target < 50 ms).
3. Frozen prototypes: `Object/Array/Function/String/Number.prototype` are frozen. Every map keyed by
   data (agent addresses, helper ids, item ids from disk) is `Object.create(null)` or a `Map`.
   Never `Object.assign({}, x)` with data keys; never patch built-ins; never assign `obj.toString`.
   Key tests use `Object.hasOwn` or `in` on null-prototype objects.
4. Absent: `setTimeout/setInterval` (use `cx.timer`), `eval`, `Function(...)`, `Intl`,
   `structuredClone`, `TextEncoder`, `queueMicrotask`. Clone with JSON. Format numbers ourselves.
5. Hex colours only (`#rgb`, `#rrggbb`, `#rrggbbaa`). Theme colours from herdr's `theme()` may be
   8-digit: use `withAlpha(c, a)` from `ui/color.js`, which normalises first. Validate every colour
   given to `Background` ourselves (bad ones fail silently there).
6. Budgets: `render` ≤ 50 ms hard (target ≤ 8 ms with 64 helpers in the QuickJS harness);
   handlers / timer ticks / each `cx.spawn` slice ≤ 500 ms hard (target ≤ 30 ms); module load ≤ 500 ms.
   Heavy work (offline catch-up, merges) is closed-form or chunked across `await cx.sleep(0)`.
7. Never keep a `cx`. `cx.notify()` never in render. Focus handles, timers, `InputState` only in
   `init` or handlers.
8. Text: never cut a string inside a grapheme. All JS-side truncation goes through
   `engine/text.js` `clip(str, maxGraphemes)` (code-point iteration keeping ZWJ sequences, VS15/16,
   skin tones, combining marks, keycaps, tag sequences and regional-indicator pairs together).
   Native `.truncate()` is allowed only on strings already clipped by `clip`.
9. Animation only natively: `.loop`, `.transition`, `.spring`, `.frames`, `svg().spin`.
   One data timer per copy (`cx.timer.every`, ≥ 1000 ms while visible, ≥ 5000 ms while
   `window()?.visible === false`). No timer-driven animation.
10. Use `props()` from `"herdr"`, never `init`'s argument (it is `undefined` for layout views).
11. `if (checking()) { …static preview…; return; }` before any side effect in `init`.
12. No `setAgentOrder`, `setWindowTitle`, `setBadge`, `playSound`, `setShared` per tick.
13. Never write files under `mods/<mod>/` at run time (it hot-reloads the mod).

### A3. Layering

```
main.js (View) ──> glue/session.js ──> engine/*  (pure)
      │                 │
      └──> ui/*  <──────┘  (ui receives a plain view-model + callbacks; never calls herdr)
```

* `engine/` exports pure functions over a plain JSON-able `GameState`. Inputs are explicit: wall
  clock `now` (ms since epoch) and observations are passed in; randomness comes from a seeded PRNG
  stored in the state. No `Date`, no `Math.random`, no herdr, no gpui. Deterministic: same inputs ⇒
  same outputs, byte-identical `serialize()`.
* `glue/` owns everything impure: reading herdr live data into plain observations, the clock,
  the save file, the handover slot, notifications, `run()` commands.
* `ui/` turns a view-model into elements. Builders are pure functions of
  `(vm, palette, handlers)`; they may read `settings().zoom` only via the vm.

### A4. Save files

Paths (absolute, from `appHome()`):

```
<appHome>/data/<mod>/save.json        current save
<appHome>/data/<mod>/save.bak.json    previous good save (rotated, see below)
<appHome>/data/<mod>/save.damaged-<n>.json   damaged files kept aside (n = 1..5, oldest replaced)
```

Written only with herdr `writeTextFile(path, text, expected)` (CAS + atomic rename for existing
files); read with `readTextFile` (≤ 1 MiB, null if absent). Save text stays < 256 KiB at 64 helpers
(asserted by a test with 500 historical helpers).

Format: one JSON object `{ "format": "<mod>-save", "version": N, "check": "<hash>", "state": {...} }`.
`check` is a 32-bit FNV-1a hex of the canonical `state` JSON; a mismatch, a parse error, an unknown
`format`, a newer `version` than the code knows, or a failed validation = **damaged**.

Load order: `save.json` → if damaged, keep it aside as `save.damaged-<n>.json`, try `save.bak.json`
→ if damaged too, keep aside, start new. Every non-clean outcome sets a visible save notice
(banner in the game with what happened and what was kept) — never silent.

Write protocol (one writer per process, see A6):

1. Serialise the live state → `text`.
2. If the last confirmed disk text `baseText` is non-null, first rotate the backup:
   `writeTextFile(bak, baseText, lastBakText)` (create with `null` if absent). Backup is rotated
   at most every 5 minutes so it trails the main save.
3. `writeTextFile(save, text, baseText)`.
4. On success: `baseText = text`, drop the confirmed actions from `pending` (A5), status `ok`.
5. On a CAS rejection (`"The file changed outside Herdr…"`, `"The file changed while saving…"`,
   or the OS "exists" error on create): re-read, **merge** (A5) and retry, at most 3 times per
   cycle; then status `conflict` (shown) and retry next cycle.
6. Any other rejection (permissions, disk full, > 1 MiB): status `error` with the message, shown in
   the banner; retried with back-off (10 s, 30 s, 60 s, then every 5 min). Never silent.

Cadence: debounced 2 s after a purchase / prestige / settings change; otherwise every 15 s while
anything changed; on `close(cx)` start one final write immediately.

### A5. Actions, merge and idempotence (two windows share one save)

Every player intent is an **action** `{ w: writerId, s: seq, t: at, type, ... }`. `writerId` is a
random id made by the glue once per process (kept across hot reloads in the handover slot); `seq`
increases by one per action. The engine records `state.applied[writerId] = lastSeq`
(null-prototype map; writers unseen for 30 days are pruned).

* `engine.apply(state, action)` ignores an action whose `seq <= state.applied[w]` (idempotent).
* Time advances with `engine.advance(state, now)`, which only moves forward from `state.clock`;
  production over `(clock, now]` is closed-form per segment, so whichever writer advanced the
  clock owns that interval and a merged writer never re-counts it.
* Live state = `replay(parse(baseText), pending)` then `advance(now)`.
* Merge on conflict: `disk = parse(read())`; `live = replay(disk, pending)` (already-applied
  actions are skipped by `applied`); `advance(now)`; write with `expected = diskText`.
* Agent observations are actions too (`type: "observe"`); rewards from finished tasks are keyed
  by `(helperId, turn)` so two windows observing the same finish create one drop.

Within one process every copy of the mod (layout block, overlay window, pane) shares one live
game through the handover slot (A6); they never write the file independently.

### A6. Handover slot and writer election (hot reload without rollback)

`globalThis` survives hot reload (same VM) but not a VM restart; `close()` is not called on reload.
The glue keeps **plain data only** (never functions or class instances from an old code
generation) at `globalThis[Symbol.for("<mod>/live")]`:

```js
{ v: 1, writerId, seq, baseText, bakText, bakAt, pending: [...actions],
  state: <GameState plain object>, notice: {...}|null, inflight: { text, upto } | null,
  copies: { [copyId]: lastHeartbeatMs },   // null-prototype
  ticker: copyId | null }
```

* On `init`, a copy adopts the slot if present (same VM: no disk read, no rollback; the newer code
  may `engine.migrate` the state), else loads from disk (A4) and creates it.
* An old generation's in-flight write never settles after reload. The slot's `inflight` records
  `{ text, upto }`; the new glue re-reads disk: if disk === inflight.text the write landed
  (adopt it as base, drop actions ≤ upto); else proceed as a conflict merge. `applied` makes both
  cases safe.
* Every copy runs one `cx.timer.every`. Each tick writes its heartbeat; the copy named in
  `ticker` (or, if that copy's heartbeat is older than 5 s, the first live copy, which claims it)
  advances the engine and drives saving. Others only re-render from the slot.
* State is also mirrored to the slot synchronously after every action, so a reload in the middle
  of play loses nothing.
* VM restart (memory pressure): `close(cx)` gets ≤ 250 ms; the final write starts at once; the
  next load re-reads disk. At most the last ≤ 15 s of unsaved clicks can be lost in that path
  (documented in Watch out).

### A7. Mock herdr (tools/mock)

Plain ES modules usable from Node and from the QuickJS harness. `controller.js` exports
`createController(scenario)` and installs itself at `globalThis.__herdr` (the mock modules read it).

Scenario shape:
```js
{ appHome, home, checking: false, window: {visible, active, platform}, zoom: 1,
  theme: "graphite" | "paper", props: {...} | null,
  agents: [ { address, pane, space, space_name, tab, tab_index, tab_name, status, app, title,
              pane_name, seq, pinned, focused, program: {key,name,icon,tint,tile,color,shell,agent} } ],
  terminals: [ { address, state: "live", status, report, parent, turn, title, name, labels,
                 created_ms, program, keep } ],
  files: { "<abs path>": "<text>" }, keys: [...], layouts: [...] }
```
It provides: every function in `defaults/herdr.d.ts` (unimplemented ones throw "mock: not
implemented"); `run(name, args)` validating names and argument names against a table copied from
`src/commands.rs` for the commands we use (throws the real error text) and logging calls;
`notify` logging; `readTextFile`/`writeTextFile` with the exact `src/mod_files.rs` semantics and
error strings (1 MiB limit, CAS, create_new, parent creation; relative paths resolve against
`scenario.cwd`, default "/", with a logged warning); host results converted like rquickjs `Object::set`
under frozen prototypes (a `constructor`/`toString`/… key throws "'<key>' is read-only", `__proto__`
sets the prototype); fault injection
(`failNextWrite(message)`, `externalWrite(path, text)`); a virtual clock (`now`, `advance(ms)`
running due `cx.timer` callbacks and settling host promises in order); `cx` factory with phase
checks (`cx.notify()` in render throws the real message). `Date.now()` in glue reads the virtual
clock only inside the harnesses (glue imports `now()` from `glue/clock.js`, which uses
`Date.now()`; the harness swaps the global `Date.now`).

### A8. Mock gpui (tools/mock)

`gpui-kit.js` exports `View, div, svg, image, list, uniform_list, PathBuilder, Background`;
`gpui-base.js` exports at least `h_flex, v_flex, Button, Switch, Checkbox, Scrollbar,
ScrollHandle, v_virtual_list, VirtualListScrollHandle, TextView`; `globalThis.window.paint_path`.
Every builder returns an element recording `{ kind, args, styles: [[method, ...args]], children,
id, handlers, hover, transitions, loops, frames, spin }`. Rules mirrored from the shell:
* Any method not in `gpui-methods.json` throws `TypeError("unknown style method `x`")`.
* Colour arguments validated with the real rules and messages; lengths validated
  (`rounded("50%")`, `p("auto")` throw); `frames` interval ≥ 16, `loop` period ≥ 100, `spin` ≥ 100,
  `loop/transition` properties ∈ {opacity,width,height,left,top}.
* Behaviour arguments checked as the shell does at the call site (`id` string, `tooltip`, `role`,
  `tab_index`, `href`, `value`, counts); handlers take the function first (`on_action`/`on_mouse_*`
  take a name/button first); a lazy list's item renderer (Layout phase) cannot register handlers or
  build lists; `ScrollHandle`/`VirtualListScrollHandle.new()` and `FocusHandle.focus()` are refused
  in render/layout.
* A child element can be consumed once (reuse throws). `.when(c, f)`, `.map(f)` behave as in
  gpui. `hover(f)`/`active(f)` record styles from a detached collector.
* `toJSON()` gives a serialisable tree (handlers become `{handler: "<event>"}` with a stable path)
  so the QuickJS harness can ship trees to Node; handlers are invoked by element id + event name.

### A9. QuickJS-ng harness (tools/qjs/harness.mjs)

Uses `quickjs-emscripten-core` + `@jitl/quickjs-ng-wasmfile-release-sync` (wasm; nothing native).
Faithful to `qjs/sandbox.rs`: freezes the five prototypes after setup, deletes `eval`, replaces
the `Function`/`AsyncFunction`/`GeneratorFunction`/`AsyncGeneratorFunction` constructors with
throwers, installs throwing `setTimeout/setInterval/clearTimeout/clearInterval/require` stubs.
Module loader follows `qjs/mod.rs` resolution: built-ins `gpui-kit`/`gpui`/`gpui-base`/`herdr`
map to `tools/mock/*`; relative and bare-with-slash specifiers resolve inside the mod root;
`with_extension("js")` fallback; anything escaping the root is refused with the real message.
Budgets via the interrupt handler: module graph load 500 ms, constructor 500, `init` 500, each
render 50, each handler / timer callback / promise drain 500; overruns fail the test. On `reload()`
the constructor and `init` share ONE 500 ms budget (watch.rs → `instantiate_for_view` opens one
Event scope for both). `render()` must return a live element, an Entity or a string.
API:
```js
const host = await createHost({ modRoot, scenario });
await host.load();                // evaluate graph, construct, init — reports ms per phase
const { tree, ms } = host.render();
host.fire(id, "on_click", payload); host.advance(ms);
await host.reload();              // new generation, same globalThis, new instance + init,
                                  // then cancel old generation tasks (like watch.rs)
host.restartVm();                 // fresh VM, fresh globalThis, close() with 250 ms first
host.dispose();
```

### A10. Screenshots (tools/shots/shoot.mjs)

Renders through the same mocks (Node), `render/html.mjs` maps the recorded tree to HTML/CSS
(GPUI defaults: `div` = block; `flex`, `flex_col`, ramps in rem = 4 px multiples; `h_flex` = row
+ items-center; numbers = px × zoom; absolute/relative; truncate; `paint_path` → inline SVG path;
`svg()` → mask tinted with text colour; `image()` → `<img>`; loops shown at their `to` value).
Views listed in `mods/<mod>/glue/views.js` (a pure table of named scenarios) × {dark, light};
whole windows render `layouts/<Name>.json` with mock shipped chrome at 1440×900 and 1100×700.
Output: `tools/out/shots/<view>-<theme>.png`, `window-<size>-<theme>.png`, and a contact sheet.
`preview.png` and `mods/<mod>/art/layout-preview.png` are produced from the whole-window shot.
Every screenshot is looked at by a person/agent before a round is called clean.

### A11. Pacing simulator (tools/sim/pacing.mjs)

Drives the engine only (no glue) with player profiles from `docs/BALANCE.md`: sessions per day,
active minutes, clicks per minute split across central object / nodes / pickups, buy policy
(cheapest-payback-first), agent schedule (n agents, working hours, tasks per hour, needs-you
events, sub-agents), sleep gaps (offline cap 8 h). Simulated in fixed steps through the real
`engine.advance` / `engine.apply` so it measures the shipped numbers. Reports milestone times;
`test/pacing.test.mjs` parses the milestone table in `docs/BALANCE.md` and asserts each target
within its tolerance, plus the invariants listed there.

### A12. Tests (node:test)

`npm test` = `node --import ./tools/node/register.mjs --test --test-concurrency=1 "test/*.test.mjs" "test/tooling/*.test.mjs"`
(globs: Node 22's `--test` does not take a directory); `npm run test:frozen` runs the same suites with
`tools/node/frozen.mjs` first (frozen prototypes as in herdr; the Playwright suites skip there). Suites: engine (determinism,
formulas vs DESIGN tables, idempotent apply, merge, offline cap, prestige), text clipping (emoji
corpus incl. ZWJ, flags, keycaps, skin tones, tags), save codec (damaged inputs:
`"{{{not json"`, `"null"`, `"42"`, `'"old shape"'`, `"[]"`, truncated file, bad check, newer
version), store (CAS conflict, external write, fail injection, backup rotation, banner),
handover (reload mid-write, two copies, ticker election), observation mapping (agents +
paneless sub-agents, error→blocked, turn deltas, 64 agents, `__proto__`/`constructor` addresses),
UI (every view renders in both themes; every clickable has an id; render read counts), layout and
keys validation (fields from `src/layout.rs`, ids unique, main ids kept, actions valid, chords not
in defaults), QuickJS (`npm run test:qjs`: load, render budgets with 64 agents, reload handover,
VM restart, frozen-prototype safety).

---

## Part B — engine and game API

Filled in from `docs/DESIGN.md` once the design is final.

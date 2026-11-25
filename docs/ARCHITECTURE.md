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
(GPUI defaults: `div` = block; `flex`, `flex_col`, ramps in rem, where herdr's rem = ui_font_size (13) × zoom, so `p_1` = 3.25 px × zoom (src/window.rs:5645, settings.rs:835); our UI uses numeric px only; `h_flex` = row
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

## Part B — Creaseworks engine and game API

`<mod>` = `creaseworks`, `<Name>` = `Creaseworks` (`tools/game.json`). `docs/DESIGN.md` is the
source of every rule and number; this part fixes **names, shapes and ownership** so that the
engine, glue, UI, art, simulator and tests can be built in parallel and fit together. If a
builder needs something this part does not define, it adds it here (in its own subsection) and
says so in its report — it never invents a private variant.

### B1. Files and owners

```
mods/creaseworks/
  main.js                 View: routes props().role → panel | ribbon (glue/session.js does the work)
  mod.json                DESIGN §2.5 verbatim
  engine/
    content.js            ALL tables: workshops, tiers, upgrades, charms, curios, automations,
                          perks, species, hues-by-index names, name syllables, envelope types,
                          spawn constants. Frozen plain data. Item ids are kebab-case (B3).
    prng.js               mulberry32: next(state) → [0,1); state is a uint32 in state.rng
    hash.js               fnv1a32(str) → 8-char lower hex; fnv1a32n(str) → uint32
    state.js              newGame(opts) and state shape helpers; MAP fields list
    economy.js            rates(state) → {G, Rw, Hs0, Hs, Rp, hand, echo, V}; costs; buy; payback
    clicking.js           hand hits, rhythm, combo, In step, afterglow, figures, chains, scraps,
                          cranes, boats, ream, spawn clocks (active time)
    helpers.js            observe reconciliation, identity, production b_i, rest/warm/thanks,
                          fledglings, Album, Elsewhere
    envelopes.js          turn deltas → units, stacking, overflow, open, boosts
    away.js               away segments, cap sharing, pot, collect, clock-back rebase
    prestige.js           cranes(L), wish gate, gain, perks, garlands, reset
    automations.js        Mail Sorter, Thrifty Fox, Boost Keeper, Crease Helper
    engine.js             PUBLIC API (B2): apply, advance, replay, rates, view, newGame, migrate
    view.js               view(state, now, opts) → ViewModel (B5)
    format.js             formatCount(n, style), formatRate, formatDuration(ms)
    text.js               clip(str, maxGraphemes), graphemes(str)
    save-codec.js         serialize(state) → text; parseSave(text) → {ok, state|null, reason};
                          canonical JSON; FNV check; MAP field rebuild to null-prototype
    index.js              re-exports engine.js + format + text + save-codec (the ONLY engine
                          import path used by glue, ui, sim and tests)
  glue/
    clock.js              now() = Date.now(); localDay(ms) → "YYYY-MM-DD" via getTimezoneOffset
    live.js               the handover slot (A6): adopt/create, writerId, seq, dispatch, rev,
                          heartbeats, ticker election, vm cache per role
    store.js              A4 load/save/backup/damaged/notices/shared path (location.json)
    observe.js            buildObservation(agents(), terminals()) (pure, exported) + change diff
    commands.js           nextCommand loop: fold, answer, envelope; openHelper(helperId) with
                          liveness check → pane.focus / terminal.peek; layout.show/resize
    notify.js             opt-in notifications, ≤ 3 per local day via the save
    session.js            per-copy controller used by main.js (B6)
    views.js              screenshot scenarios (A10, DESIGN §15.3)
  ui/
    palette.js            frozen S tokens light/dark + Hue light/dark (DESIGN §13.2)
    color.js              hex6, withAlpha, mix, contrast, statusColor(T, status, surface)
    art.js                FACETS constant, sprite(name, size, color) helpers (svg paths)
    widgets.js            button, switch, radio, chip, bar, tooltip-wrapped icon, pop
    panel.js              panel frame: header, banner slot, mat slot, boost bar, tabs, content, footer
    mat.js  flock.js  shop.js  string.js  settings.js  away.js  banner.js  rail.js  ribbon.js
  art/ …                  generated by tools/art/generate.mjs (DESIGN §13.3)
```

Dependency rule: `engine/*` imports only `engine/*`. `ui/*` imports `gpui-kit`, `gpui-base`,
`ui/*` and `engine/index.js` (for `clip`, `formatCount`) — never `herdr`, never `glue/*`.
`glue/*` imports `herdr`, `engine/index.js` and `glue/*`. `main.js` imports `glue/session.js`
and `gpui-kit`. Every `import` statement is on one line.

### B2. Engine public API (`engine/index.js`)

All functions are pure in the sense of A3: deterministic, no ambient time or randomness. They
**mutate the state passed in** (for speed in QuickJS) and return values; callers that need the
old state clone it with `cloneState` first.

```js
newGame({ seed, now, day }) → GameState            // seed: uint32 from the glue (Math.random in glue only)
apply(state, action) → Event[]                     // A5 idempotent; advances to max(clock, action.t) first
advance(state, now) → Event[]                      // closed form per segment; away segments when gap > 60 s
replay(state, actions) → Event[]                   // apply each in order
rates(state) → { G, Rw, Hs0, Hs, Rp, hand, echo, V, crowd, nWorking }
view(state, now, opts) → ViewModel                 // B5; opts = { role, width, dense, style }
cloneState(state) → GameState                      // JSON round trip + MAP rebuild
migrate(state) → GameState                         // older versions → current; throws on newer
serialize(state) → string                          // the full save file text (A4 envelope)
parseSave(text) → { ok: true, state } | { ok: false, reason: "parse"|"format"|"check"|"newer"|"shape" }
VERSION                                            // integer save version
clip, graphemes, formatCount, formatRate, formatDuration
CONTENT                                            // the frozen tables from content.js
```

`Event` is a plain object the UI and simulator may use and must not require:
`{ kind: "earn", source, amount }` (sources: `sheet`, `mini`, `node`, `scrap`, `crane`, `ream`,
`boat`, `helpers`, `env`, `workshops`, `away`, `overflow`), `{ kind: "figure", species }`,
`{ kind: "spawn", what, id }`, `{ kind: "chain", result: "done"|"torn" }`,
`{ kind: "crane", outcome }`, `{ kind: "envelope", helperId, units }`,
`{ kind: "boost", type, ms }`, `{ kind: "buy", item, count }`, `{ kind: "wish", gain }`,
`{ kind: "away", seconds, credited, capped }`, `{ kind: "notice", notice }`,
`{ kind: "ignored", reason }`. The engine also accumulates `state.stats.bySource[source]`
(lifetime and per run) so the simulator can compute income shares without events.

### B3. Item ids (content.js; also the simulator's `buy:<id>` keys)

Workshops: `paper-stack bone-folder scissor-stand glue-pot fold-bench washi-vat flower-press
crane-loft kite-tower`. Tiers: `<workshop>-t1|t2|t3`. Tools: `crisp-corners bone-tip-nail
valley-fold mountain-fold squash-fold petal-fold thousandth-fold echo-1 … echo-5 steady-rhythm
long-streak endless-streak`. Folk: `rice-treats soft-brushes snug-bench paper-hats gold-leaf-hats
shared-rhythm deep-rest dreamy-rest warm-hands fledgling-wings flight-school night-shift
night-owl`. Charms: `wax-seal ribbon-tie long-ribbon longer-ribbon brisk-charm gale-charm`.
Curios: `long-crease grand-crease quick-creases scrap-basket crane-bait crane-song slow-wings
harbour-ribbon`. Automations: `mail-sorter thrifty-fox boost-keeper crease-helper`.
Envelope types: `bundle rush storm chorus`. Boost kinds: `rush storm chorus song tailwind`.
Species (index order): `crane frog fox koi rabbit turtle butterfly whale owl boat mouse snail`.
Shop segments: `works tools folk charms curios auto`.

### B4. GameState (plain JSON; `MAP` fields are null-prototype objects in memory)

```js
{
  version, seed, rng,                       // rng: uint32
  clock,                                    // ms; last advanced wall time
  created, day,                             // ms; "YYYY-MM-DD" of the last observe
  applied: MAP<writerId, seq>, writersSeen: MAP<writerId, ms>,
  bank, runFolds, lifetime,                 // L = lifetime
  wishes, wishCount,
  owned: MAP<workshopId, n>, bought: MAP<itemId, true>,   // upgrades/tiers/automations
  auto: MAP<automationId, boolean>,         // switches
  settings: { calm, gather, nodes, pops, notify: { master, full, pile, save },
              order: "urgency"|"workspace", density: "auto"|"always"|"never", style: "short"|"sci" },
  presence: { visible, active, matShown, lastHandAt },    // from observe actions
  hand: { lastHitAt, r, frame, figures: [species…≤12], afterglowMs },
  spawn: { activeMs, nextChainAt, nextScrapAt, nextCraneAt, nextBoatAt, cranesSeen,
           chain: null | { id, k, next, nodes: [{ i, slot, bornActiveMs }], torn },
           chain2: null | same (storm only),
           scraps: [{ id, slot, bornActiveMs }], crane: null | { id, slot, bornActiveMs, outcome? },
           boat: null | { id, bornActiveMs }, ream: null | { id, day } , reamDay },
  boosts: { rush, storm, chorus, song, tailwind },        // remaining live ms; tailwind = opens left
  helpers: MAP<helperId, HelperRecord>,                   // DESIGN §5.1 record
  envelopes: MAP<helperId, { type, units, landedAt }>,
  away: { pot: null | AwayReport, capUsedMs, lastLiveAt, lastSegmentEnd },
  notices: [ { kind, at, text?, data? } ],                // save notices are glue-owned (B6)
  notify: { day, sent, firedFull, pileSince, pileDay, saveEpisode },
  garlands: [ { wish, day, stripes: [[colourKey, weight]…], wishes } ],
  stats: { bySource: MAP<source, number>, runBySource: MAP<source, number>, tasks, hits },
  ui: { hints: { fold, crane }, narrowHintDay }
}
```

`HelperRecord` = DESIGN §5.1 exactly, plus `missingSince` (ms or null) and `group`
(`needs|finished|working|resting|elsewhere|album`, derived and cached by `observe`).

### B5. Actions (all carry `w`, `s`, `t`; A5)

DESIGN §15.1, with these exact shapes:

```js
{ type: "click", target: "sheet"|"mini"|"node"|"scrap"|"crane"|"boat"|"ream", id?, x?, y? }
{ type: "open", helperId }                // opens that helper's envelope
{ type: "buy", item, count }              // count: 1 | 10 | "max" (workshops); 1 otherwise
{ type: "switch", id, on }                // automations
{ type: "setting", key, value }           // dotted key into settings, e.g. "notify.master"
{ type: "wish" }  { type: "collect" }  { type: "rebase" }
{ type: "observe", helpers: Observation[] | null, visible, active, matShown, day }
{ type: "dismiss", notice }  { type: "notified", event, day }
{ type: "hint", key }                     // first-run hints seen
```

`Observation` (from `glue/observe.js buildObservation`): `{ addr, created, status
("working"|"blocked"|"done"|"idle"), raw, turn, parent (helper addr or null), pane (string|null),
title, paneName, space, tab, kind: "pane"|"kid" }`. `status` is already mapped
(`error → blocked`; paneless kid `done → idle`).

### B6. ViewModel (`view(state, now, opts)`; plain, pre-formatted, cheap to render)

```js
{
  rev,                                     // state-derived change counter (for render caching)
  header: { folds: "12,480", rate: "+86.2/s", wishes: 12, counts: { needs, finished, working, resting } },
  sheet: { frame, ticks: 0..8, firstRunHint: bool, short: bool },
  mat: { chips: [{ helperId, name, pulse }], more, shelf: [species…],
         nodes: [{ id, i, x, y, due, fading }], scraps: [{ id, x, y }],
         crane: null|{ id, x, y, x1, msLeft }, boat: null|{ id, x, x1, msLeft },
         ream: null|{ id, x, y }, storm: bool, creaseLine: null|[[x,y]…] },
  tray: { envelopes: [{ helperId, type, units, bob }], more },
  streak: { fill: 0..1, label: "×1.4", inStep: bool, afterglow: "12m" | null },
  boosts: [{ type, label, msLeft, msTotal }],
  helpers: { groups: [{ key, title, count, folded, tiles: [Tile] }], dense, legend: bool, empty: bool,
             elsewhere: [Tile], album: [{ helperId, name, species, hue, leftAgo, folds }] },
  shop: { segments: { works: [Row], tools: [Row], folk: [Row], charms: [Row], curios: [Row], auto: [Row] } },
  string: { cranes, of, nextIn, lifetime, gain, can, perks: [{ at, text, have }], garlands: [...] },
  settings: { …current values, notifySentToday, automations: [{ id, name, owned, on }] },
  away: null | { kind: "away"|"busy", duration, capped, folds, split, envelopes, needs: [...],
                 rested, best, affordable: [...], collectable: bool },
  notices: [{ kind, text, actions }],      // engine notices (clock); save notices merged in by glue
  ribbon: { marks: [Mark], level: "A"|"B"|"C", tallies: [...] }, // computed for opts.width
  rail: { pips: [Mark] }
}
Tile = { helperId, name, species, hue, status, statusWord, envelope: bool, pips: [...],
         rest: 0..1|null, pulse, spin, dashed, opacity, tooltip, pane, addr, kind }
Mark = { helperId, status, hue, envelope, dashed, opacity, tooltip }
Row  = { id, name, owned, cost: "31.2K", affordable, best, eta: "in 2m 10s"|null, effect, icon,
         tier: bool, revealed: bool, sub: [Row] }
```

Positions in `mat` are logical px inside the mat (304×232 or the short variant); `pulse`/`spin`/
`bob` flags already respect the loop budget (DESIGN §13.5) and calm mode, so the UI only obeys
them. Strings are already clipped with `clip()`.

### B7. Glue per copy (`glue/session.js`)

```js
export class Session {
  constructor(role)                         // "panel" | "ribbon"
  init(cx)                                  // checking() → static demo state, no timers/writes/run
                                            // else: live.adopt() or store.load(); timers; command loop
  vm()                                      // cached ViewModel for this role/width (recomputed when rev/width changes)
  dispatch(action, cx)                      // live.dispatch + cx.notify()
  onSize(size, cx)                          // width from on_size_change ÷ settings().zoom
  openHelper(helperId)                      // DESIGN §5.6
  close(cx)                                 // final write if ticker
  ui                                        // per-copy UI state: tab, selected tile, folded, pops, confirm
}
```

The data tick (every 1000 ms visible / 5000 ms hidden, per copy): heartbeat; if ticker: observe
(only on change), `advance(now)`, automation and notification checks, save cadence; every copy:
re-render (`cx.notify()`) when `slot.rev` or the formatted clock bucket changed (5 s buckets in
calm mode).

Save notices (`recovered fresh conflict merged error newer`) live in the slot (`slot.notice`),
not in the engine state; `view()` receives them via `opts.saveNotice` so the vm is complete.

### B8. Simulator contract (`tools/sim/pacing.mjs`)

Imports only `mods/creaseworks/engine/index.js`. Exposes `runProfile(profileId, seed, opts) →
{ milestones: { [key]: playClockSeconds }, shares, dayShares, sessionRatios, purchases,
finalState }` and a CLI `node tools/sim/pacing.mjs [--profile P1] [--seeds 1-20] [--assert]`.
Milestone keys are the sim keys in BALANCE.md (`buy:<id>`, `own:workshops>=10`, `spawn:crane#1`,
`run:1e6`, `wish:available`, `wish2:available`). Profiles and windows are parsed from
`docs/BALANCE.md` tables; the pass rule is BALANCE §2.

### B9. Engine as built (engine builder's additions; B2–B5 still hold)

Everything below is exported from `engine/index.js`; the glue, view, simulator and tests use
these instead of private variants.

**Signatures.** `advance(state, now, writerId?)` and `rates(state, writerId?)`: the glue passes
its `writerId` so helpers another window stopped observing fall back to the away rate after 60 s
(§10.2; nothing after 8 h). Without a writer (simulator, tests) every helper counts as seen.
`apply` uses the action's `w`. Extra read-only helpers: `effects(state)` (every bought effect as
numbers: `G hand echo gapMs comboMax folk stepIn stepMult glowMult restFullMs restMax kidBonus
awayF envMult durMult rushMult stormMult chainK chainEveryMs scrapMult craneLo craneLifeMs
nodeLifeMs scrapLifeMs boatLifeMs boat envCap life gather Rw`), `itemInfo(state, item, count)`
(`{kind, id, count, cost, unlocked, have, ok}`), `workshopCost`, `maxAffordable`, `tierOf`,
`estimate(state, item, {activeFrac, cps})` (BALANCE §3.1 Δ, for the best-buy dot and the sim),
`eff`, `crowd`, `cranes`, `lifetimeFor`, `wishInfo` (`{cranes, total, gain, needed, can}`),
`stringInfo` (`{cranes, of, nextIn, lifetime, gain, needed, can}` for the String tab),
`groupFor(h, writerId)`, `helperId`, `lookOf`, `nodeId(chain, i)`, `slotXY(slot)` (mat px of a
slot centre), `lifeLeft(state, E, what, item)`, `rhythmAt(state, E, now)`, `inStep`, `combo`,
`hitBoost(state, E, t)`, `stackFactor`, `envelopeDef`, `isOn(state, automationId)`,
`fnv1a32`, `fnv1a32n`, `canonicalState`, `validateState`, `CLICK_SOURCES`, `MAP_FIELDS`.
`engine/view.js` is a placeholder that throws until the view builder replaces it.

**State additions to B4.**
* `rev` (+1 per apply / advance), `autoAt: { fox }`, `presence.handBy` (writer of the latest hand
  input), `stats.units: { created, opened, converted }` (BALANCE inv. 9).
* `boosts`: `rush`/`storm` are remaining ms for display; their truth is `rushEnd`/`stormEnd`
  (wall ms on the hand-input timeline, moved by the gap of an away segment, so a hit merged in
  late gets the boost it had in its window). `tailwind` = opens left, `tailwindMs` = its 10-min
  window (live time).
* `spawn`: `shownMs` (mat-shown live ms: lives run on it), `activeMs` (spawn clocks run on it),
  `syncedTo` (wall ms the spawn clocks have reached), `seq` (item ids `c<n> s<n> g<n> b<n> r<n>`),
  `lastChain: { result: "done"|"torn", slots, at }` (crease line / fade). Items carry `born`
  (a `spawn.shownMs` value) instead of `bornActiveMs`: chain `{ id, k, next, born, nodes: [{ i,
  slot, done }] }`, scrap `{ id, slot, born }`, crane `{ id, slot, born, outcome }`, boat
  `{ id, born }`, ream `{ id, day, slot: 0 }`. At most 3 scraps live.
* `away`: `pot` = `{ seconds, gap, capped, folds, split: { workshops, helpers }, envelopes,
  needs: [helperId], rested, best, affordable: [itemId ≤ 3], at, liveMs }`; `last` (latest
  credited away, for the footer); `busy` accumulator `{ since, folds, tasks }`.
* `notices` kinds the engine writes: `clock` (banner, until dismissed), `overflow`
  (`data: { helperId, name, amount }`, 60 s), `away` (`data: { seconds, folds }`, 60 s),
  `busy` (the "While you were busy" card, `data: { seconds, folds, tasks, envelopes }`, 30 min).
* Envelope `{ type, units, landedAt, lastAt }`. Garland stripes are `[colourKey, weight, label]`
  with `colourKey` `hue:<0-7>` | `hands` | `workshops` | `rest`.
* HelperRecord adds `gone`, `stats.run` (this run's folds, for garlands), `stats.kidsPast`,
  `stats.kidsFolds`, and for present helpers `title pane paneName space tab` (titles clipped to
  80 graphemes). **Album records are compact**: only `id kind parent species hue name joined
  status lastTurn rest env stats missingSince gone` (folds rounded to 6 digits); the rest comes
  back when the agent returns (the id is the hash of `addr#created`, so it finds its record).
  Use `groupFor(h, writerId)`, never `h.group`, which Album records do not carry. `parent` of a
  fledgling is the **pane helper at the root** of its parent chain.

**Actions added to B5.** `{ type: "checkin", helperId }` (a click on a needs-you cue, §5.6).
`observe` with `helpers: null` updates presence and day only and refreshes `lastSeen` of that
writer's helpers. `dismiss` with `notice: "away"` collects the pot. A refused purchase returns
`{ kind: "ignored", reason: "afford"|"locked"|"owned"|"unknown", item, cost? }` (the `merged`
banner lists refunds from these).

**Merge-safety decisions (A5), measured by `test/engine/merge.test.mjs`** (two writers within
0.75 % of one writer over 3 h for 12 seeds):
* Every roll is a *keyed* draw: mulberry32 seeded by `fnv1a32n(key) ^ seed`, with keys such as
  `env:<helperId>:<turn>`, `fig:<hits>`, `slot:<seq>:<j>`, `crane:<seq>`, so merged lineages roll
  the same envelope types, figures and spawns whatever the order. `state.rng` stays in the save
  (`next()` is still exported) but the engine's rules no longer step it.
* Spawn clocks belong to the window being played (`presence.handBy`). Other writers advancing
  the shared clock leave the mat alone; the owner's actions merged in late first run the spawn
  clocks up to their own time (`spawn.syncedTo`). A background window's `observe` does not
  overwrite the presence flags of a window with a hand input in the last 30 s.
* The stored rhythm `r` is not reset by ticks (a late hit must keep its streak); read it through
  `rhythmAt(state, E, now)`. A stale observation (older than the helper's `lastSeen`, or than
  its `missingSince` for the Album) is skipped for that helper.

**Other decisions.** Spawn slots: DESIGN §3.2 says "minus six slots"; the geometry puts twelve
slot centres on the Sheet (cols 3–6 × rows 1–3), so `content.js FREE_SLOTS` leaves out those
twelve plus the ream slot (37 slots). The Crease Helper completes the whole chain at 80 % of its
life, paying half of `V` (no combo or boost) per remaining node and for the finish. The first
wish's gain is `floor(cranes/100) − W` (exactly 10 at L = 6e9). The notification counter counts
each `notified` action of the current day and keeps the later day (`max`). Spawn catch-up is
skipped for lags over 120 s (`K.spawnCatchUpMs`).

### B10. View as built (view builder's additions; B6 still holds)

`engine/view.js` implements B6 with the field names and value kinds of
`test/fixtures/vm-fixtures.mjs` (checked by `test/engine/view.test.mjs`). Extra fields are
additive; the UI may ignore them. `engine/index.js` also exports `ribbonLevel(n, W)`,
`workStart(h)`, `slotPos(slot, short)`, `LOOP_BUDGET`, `RIBBON`.

**opts.** `{ role, width, dense, style }` as B2, plus `writer` (the glue's writerId: Elsewhere
grouping and stale-helper rates; always pass it), `tab` (`"flock"` default | `"shop"` |
`"string"` | `"settings"`: needs-you pulses go on Flock tiles when it is `"flock"`, else on the
mat chips; spins only on Flock tiles), `short` (mat 304×184), `matShown` (override; default from
`presence`), `buyCount` (`1 | 10 | "max"`, the Works toggle) and `saveNotice` (the slot's
notice: `{ kind, text?, message?, retryMs?, at? }`). A panel with `width < 140` is the rail (no
mat, no loops). The glue's vm cache must key on `rev`, `width`, `tab`, `buyCount`,
`saveNotice` and the clock bucket.

**Statuses.** `Tile.status`, `Mark.status`, tile `pips` and ribbon tallies use herdr's words
`working blocked done idle` (as the fixtures do); group keys are `needs finished working resting`.
Tiles are pane helpers; a fledgling is a status word in its parent's `pips` (all of them; the UI
draws 4 and `+n`), and one whose parent is not present gets its own tile (`kind: "kid"`).
Counts, chips, marks and pips count tiles only, so a blocked fledgling never lifts its parent.

**Order.** Needs you: longest waiting first (`blockedAt`) in the Flock and the mat chips; every
other group, and every group in the ribbon and rail, in join order. Workspace order sorts by
space, tab, pane (natural order: "tab 2" before "tab 10"); its one group is
`{ key: "all", title: "Workspace order" }` (the UI hides the header for `"all"`). Elsewhere
tiles/marks come last with opacity 0.5.

**Loop budget.** Computed once per call in priority order with a total of 12 (ribbon and calm:
0): pulses (≤ 6 most recent waits, < 10 s), crane bob (`mat.crane.bob`), storm stripes
(`mat.storm`, also false in calm), the newest *drawn* tray envelope (< 10 s since `lastAt`),
In step spins (first ≤ 6 working tiles) or new-work spins (≤ 4 latest starts, < 20 s), and the
first-run hint (`sheet.hintBob`; `sheet.firstRunHint` stays true in calm, static).
The record has no "started working at" field, so `workStart(h)` uses `h.workingSince` when the
engine adds one, else the latest of `joined`, `warmUntil − 20 min`, `thanksUntil − 5 min` (each
is set only when work starts, so it never invents a start; a Needs-you → Working change after
more than 5 min with no rest is the one start it misses).

**Mat coordinates.** Nodes, scraps, the ream and the crease line are slot **centres**; the crane
(48×36) and boat (48×32) are the **left/top** of their hit box, gliding by `left` from `x` to
`x1` (crane: towards the far side; boat: 8 → 248; calm: `x1 === x`). `nodes[].i` is the
**1-based number drawn** on the node; `nodes[].id` is the engine click id (`nodeId`, 0-based).
Short variant: y is scaled into 28–152 and the middle four columns of the top and bottom rows
move beside the 96 px Sheet, so nothing overlaps it.

**Shop.** Every item of a segment is a row in table order (workshops: all nine); `revealed`
false rows are the "???" silhouettes (`name` is still the real name: the UI must not print it),
owned upgrades stay in their segment with `owned: 1` (the UI collapses them into "Owned (n)").
Upgrade reveal: owned, or unlocked and (`cost ≤ 3 × max(bank, runFolds)` or its predecessor is
owned); workshops: the previous one is owned. Tier sub-rows: unlocked and not bought (the
engine requires the previous tier). `eta` uses `Rp` (`formatEta`, rounded up); `best` marks the
one affordable row (any segment, tiers included, by `estimate`'s Δ) with the shortest payback and
gives it `tooltip`. Extra: `count` (workshops), `locked`, `on` (automations).
`icon`: the workshop id for workshops and tiers, else the ui icon `hand paw ribbon curio cog`.

**Other parts.** `boosts[].msTotal` is the type's remaining-time cap (no start is stored).
`string.garlands` is the engine's list as is (`stripes: [[colourKey, weight, label]]`).
`away.split` is `{ workshops, helpers }` (formatted), `away.best` `{ helperId, name, species,
tasks }`, plus ready lines (`capText splitText envelopesText needsText restedText bestText
affordableText`); the `busy` card comes from the engine's `busy` notice. `notices` puts the save
notice first, then engine notices newest first, each with `place` (`banner` | `footer`); `busy`
is not listed (it is `away`). Album `leftAgo` is a duration ("3 d"). Tiles carry `detail
{ title, where, line, rest }` for the Flock detail card; the ribbon carries `folds rate
envelopes save pill empty width`, the rail `count rate needs envelopes crane save`.

### B11. UI render contract (the build plan's "B9 UI render contract"; B6/B10 still hold)

(B9 was already taken by "Engine as built", so this contract is numbered B11.) Every `ui/`
module that draws a part of a copy exports **one pure render function** with the same signature:

```js
renderPanel(vm, ui, ctx)     ui/panel.js     whole panel copy (role "panel"); ctx.width < 140 → the rail
renderRail(vm, ui, ctx)      ui/rail.js      64 × H rail (§3.9)
renderRibbon(vm, ui, ctx)    ui/ribbon.js    30 px × work width (§3.10)
renderMat(vm, ui, ctx)       ui/mat.js       mat 304×232 / short 304×184 (§3.2), incl. first-run hint and pops
renderBanner(vm, ui, ctx)    ui/banner.js    save/clock banner (§3.8) → element | null (no banner notice)
renderAway(vm, ui, ctx)      ui/away.js      away / busy card (§3.7) → element | null (vm.away null)
renderFlock(vm, ui, ctx)     ui/flock.js     tab content (§3.3)
renderShop(vm, ui, ctx)      ui/shop.js      tab content (§3.4)
renderString(vm, ui, ctx)    ui/string.js    tab content (§3.5)
renderSettings(vm, ui, ctx)  ui/settings.js  tab content (§3.6)
```

**Pure.** A render function reads only its three arguments (and imports: `gpui-kit`, `gpui-base`,
`ui/*`, `engine/index.js`). It never calls herdr, never keeps a `cx`, never calls `cx.notify()`,
never creates timers, scroll or focus handles, never mutates `vm`, `ui` or `ctx`. Same arguments
⇒ the same tree. Strings in the vm are already clipped (B6); any further cut uses `clip()` first.

**`vm`** is the B6/B10 ViewModel of this copy (role and width already applied by `view()`).
Animation flags (`pulse`, `spin`, `bob`, `hintBob`, `storm`, crane `x1`) are obeyed as given:
the UI never adds a `.loop`/`.spin`/`.frames` the vm did not ask for (§13.5 loop budget), and
with `ctx.calm` it adds none at all (transitions only).

**`ui`** is the copy's UI state (B7 `Session.ui`), a plain object; every field is optional and
renderers default it:

```js
{ tab: "flock"|"shop"|"string"|"settings",  // default "flock"
  back: "flock"|"shop"|"string",            // tab the "← Back" of Settings returns to (default "flock")
  segment: "works"|"tools"|"folk"|"charms"|"curios"|"auto",   // Shop segment (default "works")
  selected: helperId | null,                // Flock detail card
  confirm: false | true | "wish" | "reset" | "restore",  // two-step confirms (true = "wish")
  armedAt: ms | null,  now: ms | null,      // confirm arming (1.5 s); renderers compare, never read a clock
  details: bool,                            // banner "Details ▸" expanded
  folded: { [groupKey]: bool },             // Flock group folds (null-prototype)
  scrollTo: groupKey | null,                // Flock: counts chip ● / ◗ asked for this group
  pops: [{ id, label, x, y, risen }]        // floating numbers (≤ 5, mat px), owned by the glue
}
```

**`ctx`** is built by the glue once per render:

```js
{ T,            // herdr theme() as is (keys may be 8-digit; ui/color.js normalises)
  S,            // palette.pickScene(dark): scene tokens (§13.2)
  hues,         // palette.pickHues(dark): Hue[0..7]
  dark,         // settings().dark (optional; S/hues already reflect it)
  zoom,         // settings().zoom (loop px are multiplied by it; numeric lengths are not)
  calm,         // vm settings calm (no loops, no spins, no pops)
  width,        // this copy's logical width (panel Wp, rail 64, ribbon work width W)
  height,       // logical height (panel H; ribbon 30), optional
  panelShown,   // ribbon only: panel copy visible and unfolded (hides the ribbon mini Sheet)
  save,         // optional, from the slot: { state: "saved"|"saving"|"problem", text: "Saved 12 s ago",
                //   path, lastGood, backup, damaged: [names] } (footer glyph, banner Details, Settings)
  narrowHint,   // ribbon only, optional: true shows "Narrow window: fold Creaseworks to a rail?" (§2.3)
  handlers }    // below; every one is optional to the caller of a renderer (tests pass stubs)
```

**Handlers.** Each takes `cx` last; it dispatches the B5 action (or changes `Session.ui`) and
calls `cx.notify()` itself. Renderers call them from element handlers and call
`cx.stop_propagation()` first whenever the element sits over another clickable.

| handler | from | does |
|---|---|---|
| `click(target, id, event, cx)` | mat pieces, rail/ribbon mini Sheet, rail crane | B5 `click`; `target` ∈ `sheet mini node scrap crane boat ream`, `id` the vm item id (node: `nodes[].id`), `event` `{ x, y }` in mat px (pop position) or null |
| `open(helperId, cx)` | tray envelope, tile/ribbon envelope marker, ✉ buttons | B5 `open` |
| `openHelper(helperId, cx)` | needs-you chips, needs/finished marks and pips, away "Open ›"; counts chip ▲/✓ and rail ▲ pass the group key `"needs"` / `"finished"` instead (glue picks the longest-waiting / oldest and cycles on repeat) | §5.6 focus the pane (+ `checkin`) |
| `buy(item, count, cx)` | Shop rows, tier sub-rows | B5 `buy` |
| `setting(key, value, cx)` | Settings, Works ×1/×10/Max (`"buyCount"`, ui-only) | B5 `setting` (dotted key) |
| `switchAuto(id, on, cx)` | Auto rows, Settings automations | B5 `switch` |
| `wish(cx)` | String confirm card "Make the wish" | B5 `wish` |
| `collect(cx)` | away card Collect | B5 `collect` |
| `dismiss(notice, cx)` | banner Dismiss, away/busy ✕, ribbon narrow hint "Not now" (`"narrow"`) | B5 `dismiss` with the notice `kind` (`"away"`, `"busy"`, `"clock"`; save kinds and `"narrow"` are glue-only) |
| `fold(cx)` | header fold icon, rail chevron, ribbon `[⇔]` | `creaseworks.fold` (panel ↔ rail) |
| `show(cx)` | ribbon save chip, "Welcome back" pill | unfold / show the panel (no-op when shown) |
| `tab(name, cx)` | tabs row, gear (`"settings"`), "← Back" (`ui.back`) | sets `ui.tab` (and `ui.back` when leaving for Settings) |
| `segment(name, cx)` | Shop segment control | sets `ui.segment` |
| `select(helperId, cx)` | Flock tiles, rail/ribbon working/resting marks | sets `ui.selected` (null clears), `ui.tab = "flock"`; from rail/ribbon also unfolds/shows the panel |
| `toggleGroup(key, cx)` | Flock group headers, Album, Elsewhere, "Owned (n)" (`"owned:<segment>"`) | flips `ui.folded[key]` |
| `showGroup(key, cx)` | counts chip ● / ◗ | `ui.tab = "flock"`, unfolds the group, `ui.scrollTo = key` |
| `details(on, cx)` | banner Details ▸ | sets `ui.details` |
| `confirm(kind, cx)` | first click of a two-step action (`"wish" "reset" "restore"`) | sets `ui.confirm = kind`, `ui.armedAt = now` |
| `cancel(cx)` | "Keep folding", confirm cancel | clears `ui.confirm` |
| `retrySave(cx)` `checkSave(cx)` `restoreBackup(cx)` | banner Retry now, Settings save rows | glue store calls |
| `sharePath(path, cx)` | Settings "Share a save…" | glue `location.json` |

**Ids.** Every clickable has an `.id()` that is unique in the copy's tree and stable across
renders (built from vm ids, never from list positions when an id exists). Prefixes: `cw-hdr-*`
`cw-tab-*` `cw-boostbar-*` `cw-foot-*` (panel frame), DESIGN §3.2 names for the mat (`cw-sheet`,
`cw-node-<id>`, `cw-scrap-<id>`, `cw-ream`, `cw-crane`, `cw-boat`, `cw-env-<helperId>`,
`cw-chip-<helperId>`, `cw-hint`), `cw-banner-*`, `cw-away-*`, `cw-rail-*`, `cw-rib-*`,
`cw-flock-*`, `cw-shop-*`, `cw-string-*`, `cw-set-*`. Scroll containers carry ids too.

**Layout split.** `renderPanel` owns the frame (header 44, banner 28, mat, boost bar 26, tabs 32,
footer 22) and wraps the active tab's element in `div#cw-content` (`flex_1 min_h(0)
overflow_y_scrollbar`, full width, no padding). A tab renderer returns one element sized to its
content at full width (`w_full`, its own 8 px side padding), never a fixed height and never its
own outer scroll. The away card is an absolute overlay positioned by the panel over the mat.

**As built (frame builder).** `ui/panel.js` also exports `activeTab(ui)`, `FRAME`, `RAIL_BELOW`;
`ui/mat.js` `matGeometry(vm, ctx)` (drawn mat `ctx.width − 16` × 184 narrow-or-short / 232 /
260 wide; vm positions are mapped piecewise around the Sheet and every hit box is pushed off it:
the engine's slot centres in the rows above and below the Sheet put a 28 px hit area 1.2 px over
its edge) and `isCalm(vm, ctx)` (`ctx.calm || vm.calm || vm.settings.calm`); `ui/banner.js`
`bannerLayout` (the banner's drawn height, so the panel can place the away card),
`bannerNotices`, `saveProblem`, `middleClip`; `ui/away.js` `awayLines`; `ui/ribbon.js`
`pipArea(W)`, `densityLevel(n, w)`. The crane and boat glide by easing `left` over each 1 s data
tick to the vm's new `x` (the §17 R2 fallback), not one long transition, because a pure render
cannot tell its first frame. Flags missing from a vm default as follows: crane `bob` true, sheet
`hintBob` = `firstRunHint` (both off in calm). Each module exports its grapheme limits
(`MAT_CLIP`, `BANNER_CLIP`, `AWAY_CLIP`, `RAIL_CLIP`, `RIBBON_CLIP`, `PANEL_CLIP`).

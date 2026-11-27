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
<appHome>/data/<mod>/save.damaged-<n>.json   damaged files kept aside (n = 1..5, newest highest, oldest replaced)
```

Written only with herdr `writeTextFile(path, text, expected)` (CAS + atomic rename for existing
files); read with `readTextFile` (≤ 1 MiB, null if absent). Save text stays < 256 KiB at 64 helpers
(asserted by a test with 500 historical helpers) and ≤ `K.saveBudget` (896 KiB) with 4,000 present
helpers over a full Album (format 5, below).

Format: one JSON object `{ "format": "<mod>-save", "version": N, "check": "<hash>", "state": {...} }`.
`check` (format 3, `engine/save-codec.js` `saveCheck(state)`) is a 32-bit FNV-1a hex over the
state JSON with `helpers` replaced by a marker, a newline, and the FNV-1a digests of the helpers
map cut into chunks of about 64 (a chunk ends after an id whose last two hex digits are a multiple
of 64). A writer caches each chunk's digest by its text (plain data under the registry symbol
`creaseworks/save-digests`, non-enumerable, replaced across hot reloads), so a save cycle hashes
only what changed. Formats 1–2 (FNV-1a of the whole state text) still load. A mismatch, a parse
error, an unknown `format` or a failed validation = **damaged**; a higher format or state
`version` than the code knows = **newer** (read-only; from format 3 on it is tested before the
check, DESIGN §12.1). Format 4 (current `SAVE_VERSION`) keeps format 3's check rule. A compact
Album record is written as `[name|0, folds, tasks, minuteLeft, (kidsPast, kidsFolds), key]`: 4 or
6 items, or 5 or 7 with a trailing 16-bit terminal key `albumKey(addr, created)` (DESIGN R6, review
r3-18). A newcomer rejoins a gone record only when its key matches; otherwise it takes a salted
id. The helpers map may also hold archive entries with id `past-<n>` (n = floor(leftMs / 30 d),
never 8 hex digits): each is a gone pane record with `archive` (how many helpers it holds), their
summed stats, `missingSince` (the newest left) and `from` (the oldest left). `prune` never
compacts them, Album counts add up `archive`, and fledglings whose parent's record was archived
fold into them. A format-3 build reads format 4 as newer (read-only). Live records carry `unitAt`
and `kidUnitAt` (the envelope-unit budgets, DESIGN §6.1).

**Format 5** (current `SAVE_VERSION`, DESIGN R13 "present helpers", §12.1) packs the present
helpers and the envelopes; a format-4 build reads it as newer (read-only), and formats 1–4 still
load (a present record of an older build is brought to this build's shape, `normalizePresent`, and
written packed at the next save; one handed over in memory by a hot reload from such a build, at
its next observation). A present helper is written as `[1, S, X, P]` (full), `[1, S, X]` (lean: no
place strings), `[2, S]` or `[2, S, blockedAt']` (slim), or `[3, name, kp, status, seenBy,
lastSeen, lastTurn]` (+ `blockedAt'` when it waits: a stub) with `S = [addr, name, kp, status,
seenBy, lastSeen, lastTurn, created', joined', env, [tasks, folds, run|null, envelopes,
checkIns(, kidsPast, kidsFolds)]]`, `X = [rest, warm, warmUntil', thanksUntil', lastFinishAt',
unitAt', kidUnitAt', blockedAt']` and `P = [title, pane, paneName, space, tab]`: `name` 0 = the
id's base name, k = "<base> k", else the name; `kp` 0 = pane, 1 = fledgling without a parent,
else the parent's id; `status` an index into `STATUSES` (working, blocked, done, idle); `seenBy`
the index of its writer among the `writersSeen` keys (its id when absent); `t'` = t − lastSeen
(null for 0 / null); species, hue, `missingSince`, `gone` and `group` (a cache nothing reads)
follow on load. A record that is not exactly an engine record (an extra field, a non-hex id, a
time that is no exact delta) is written whole, as before. An envelope is `[typeIndex, units,
landedAt, lastAt − landedAt]` (`typeIndex` into `ENVELOPES`; both orders are part of the format).
An offset that is not finite once added back (a damaged file) is damaged. Tiers (`helpers.js`
`presentPlan`, which gives `serialize` each packed text): all full when the save fits
`K.saveBudget` (896 KiB); otherwise each one's stub is reserved (slim for a salted id), then in
one order (live within a minute of the state's clock first, unseen ones most recently seen first,
holding an envelope first, then id: the same in every window, no window or status favoured) every
helper that fits goes slim, then lean, then full; if even the stubs pass the budget, the last in
that order are left out with their envelopes and away-pot entries. A slim record loads with
`slim: true` (budgets empty at lastSeen, no warmth, thanks or rest, its wait's start kept), a stub
with `stub: true` (no totals; address and created_ms set again by the observation that finds it by
its id), and each stays so until observed again, so a reload or a merge writes the same text (the
order uses only what every tier keeps, and a degraded record writes the same at any tier it can
take). `saveBytes` is the plan's byte count: the present helpers, their envelopes and pot entries
exactly, the rest by `K.saveBytes*`; `prune` counts each present helper at an upper bound of its
lean form (its numbers at the widest text they can take before the next observation) before the
Album's compact records. 4,000 present helpers (1,000 agents with 3 sub-agents, long CJK titles,
an envelope per agent) save at ≈ 880 KiB with all their game state; every agent is a saved helper
up to about 10,000–13,000 present at once; past that the last are left out and the save is still
written. store.js `oversize` stays the last resort for what the plan does not bound (records
written whole). **Writing in steps:** `serializeSteps(state)` (exported by `engine/index.js`) is
`serialize` as a generator: its first step copies what the later ones read, then it plans and
encodes in slices of 1,500 helpers, so its text is the state at that first step; the store's
`serializeIn` drives it with a task yield between steps for any state of 1,000 helpers or more
(`STEP_SAVE_HELPERS`; r8-06: at the old 3,000 one step just under it took 260-340 ms in the wasm
harness, 999 helpers take about 90-130 ms, one stepped slice) on every write path, and takes the log position (`upto`), writer progress and
`rev` the write confirms at that first step (12,500 present helpers: 19 steps, the slowest
≈ 80–110 ms in the wasm harness). Large saves are parsed across task steps: `parseSaveSteps(text)` (exported
by `engine/index.js`) yields after the JSON parse and after every 1,500 helpers, and the store's
`parseIn` drives it with a task yield between steps for any save of 64 KiB or more
(`STEP_PARSE_CHARS`) on the load, merge, overwrite, check, restore and share paths (a two-year
save: about 31 steps, the slowest about 60 ms in the wasm QuickJS harness). The yield is the
task's `cx.sleep(0)`, which every caller passes in its env (`sleep`): without it `pause` is a
microtask and the whole parse runs in one task step (r3-01: the load passed none, so a two-year
save took 314-512 ms in one step and a larger or damaged one was interrupted for good;
`test/qjs/load-steps.test.mjs`). The load also yields between the recovery and backup parses and
after keeping a damaged file aside.

Load order: `save.json` → if damaged, keep it aside as `save.damaged-<n>.json`, try `save.bak.json`
→ if damaged too, keep aside, start new. Every non-clean outcome sets a visible save notice
(banner in the game with what happened and what was kept) — never silent. A load that stops (its
task interrupted by herdr's budget, or cancelled with a closed view: neither settles) is started
again by the session's watchdog once it has made no progress for `LOAD_STALL_MS` (15 s) or its
copy has gone. A stall counts as a try: the placeholder says so ("Opening the save stopped partway;
trying again…") and, once loaded, a `recovered` load notice does (r3-01). A load whose copy simply
closed (another copy stays open) is no save problem: the next copy's tick takes it over quietly,
with no try counted, the plain placeholder and no notice (`Session.loadStop`: `stalled` / `gone`).

Write protocol (one writer per process, see A6):

1. Serialise the live state → `text` (in steps with a task yield between them for a state of
   1,000 helpers or more, `serializeIn`: the text, and the actions the write confirms, are those
   of its first step; DESIGN R13).
2. If the last confirmed disk text `baseText` is non-null, first rotate the backup:
   `writeTextFile(bak, baseText, lastBakText)` (create with `null` if absent). Backup is rotated
   at most every 5 minutes so it trails the main save. The serialisation of step 1 starts in a
   task step of its own, after a task yield (also after this rotation).
3. `writeTextFile(save, text, baseText)`.
4. On success: `baseText = text`, drop the confirmed actions from `pending` (A5), status `ok`.
5. On a CAS rejection (`"The file changed outside Herdr…"`, `"The file changed while saving…"`,
   or the OS "exists" error on create): re-read, **merge** (A5) and retry, at most 3 times per
   cycle; then status `conflict` (shown) and retry next cycle.
6. Any other rejection (permissions, disk full, > 1 MiB): status `error` with the message, shown in
   the banner; retried with back-off (10 s, 30 s, 60 s, then every 5 min). Never silent.

Cadence: debounced 2 s after a purchase / prestige / settings change; otherwise every 15 s while
anything changed; on `close(cx)` start one final write immediately. That final cycle (`env.final`)
leaves the backup rotation to the next one, and a cycle of a closed copy that holds the claim but
has not sent its `save.json` write yet (`inflight` null: rotating the backup, serialising in steps,
merging) is released first (`store.releaseClosing`): herdr cancels it with its copy, so it would
never send it (r8-04: the final write was skipped and the progress since the last save lost).

Keeping aside (`keepAside`): two windows keeping a file aside at the same moment pick the same
free `save.damaged-<n>.json`; the second create fails with "File exists" (a CAS rejection), so the
kept files are read again and the choice made again (the text found already kept, or the next
free n), up to `KEEP_TRIES` (4) times (r8-08). After Reset / Restore (`overwrite`) the replacing
write keeps aside not only the file the tool replaced but also a save another window lands before
that write (`overwriteBase`, reason `reset`/`restore`, said with `lateSaveText`; r8-01). A window
that finds its saved progress missing from `save.json` (another window replaced it) names the kept
copy holding its last save, or keeps that save aside itself ("this window's save") and names it,
never claiming the other window kept it (`replacedText`; r8-07).

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

Commands and layout.* as herdr runs them (r4-02). Every loaded copy has its own command channel,
opened when the copy loads (`src/mods.rs:1125-1129`); `run("<mod>.<cmd>")` and a key press
(`ctl.sendCommand(cmd)`, which returns how many copies got it) put the command into the channel of
every open, shown copy (`mods::send_command`, `src/mods.rs:785-799`), and `nextCommand()` reads the
calling copy's own channel. A copy is shown when its `{mod, props}` block is among the shown
layout's visible blocks (hidden nodes, a stack's other children and their floats are not); a copy
no block describes (an overlay, a tab, a layout without contents) counts as shown; `scenario.shown:
false` shows none. A closed copy (`closeOwner`) or a reloaded build's copies get nothing; with no
listening copy, `run("<mod>.<cmd>")` fails with herdr's `unknown command …`.
`ctl.pendingCommands(view)` lists a copy's waiting commands. `layout.toggle|show|hide|resize` are
applied to the shown layout (`layoutValue`, copied from the scenario, replaced on each change, never
changed in place) with `tools/mock/commands.js` `applyLayoutCommand`, as `src/window.rs:3640-3656`
does: a missing node fails (`no node "<id>"` for resize, `no node "<id>" in the shown layout` for
the others; with no layout modelled every id is missing), `px` wins over `weight`, both stored as
f32 (`Math.fround`), and the `"layout"` revision is bumped. `ctl.runAsPerson(name, args)` runs a
command as the person (a key, click or palette entry) and returns `{ok}` or `{error}`.

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
*As built (integration):* every view in all six themes of `themes.json` and at zoom 1 and 1.5
(`<view>-<theme>[-z1.5].png`), grey / deuteranopia / protanopia captures of `flock-34`,
`flock-64-dense`, `ribbon-64-1440` and `rail-64` in graphite and paper
(`<view>-<theme>-<grey|deuteranopia|protanopia>.png`), and whole windows at 1440×900 and 1100×700,
at zoom 1 and 1.5, in four layout states (`window-<w>x<h>[-folded|-hidden|-files]-<theme>[-z1.5].png`;
"folded" is the rail weight the fold command sets), plus 1920×1080 expanded only (the panel Wide
at 456 px, B15). A
window's game blocks run as copies of the View sharing ONE mock herdr window (one handover slot,
as in herdr), each sized by its root's `on_size_change` with the content box herdr would give it
(`render/window.mjs` `layoutBoxes`, a port of herdr's `pane_size::shares` / `block_bounds`, in
zoomed px; B15). The renderer gives weight nodes herdr's normalised grow (weight ÷ the shown
siblings' total weight). `svg()` masks are inlined as `data:` URIs (a `file://` page cannot
fetch a `file://` CSS mask: masks are CORS requests). Sheets: `contact-sheet.png` (graphite +
paper), `contact-sheet-zoom.png`, `contact-sheet-vision.png`, `contact-sheet-<theme>.png`.
`--preview` writes `preview.png` at 1600×1000 (the 1440×900 window at 10/9) and
`art/layout-preview.png` at 216×124 (DESIGN §1, §13.3). Options: `--themes`, `--zooms`,
`--no-vision`, `--only`, `--no-windows`, `--no-sheet`.

### A11. Pacing simulator (tools/sim/pacing.mjs)

Drives the engine only (no glue) with player profiles from `docs/BALANCE.md`: sessions per day,
active minutes, clicks per minute split across central object / nodes / pickups, buy policy
(cheapest-payback-first), agent schedule (n agents, working hours, tasks per hour, needs-you
events, sub-agents), sleep gaps (offline cap 8 h). Simulated in fixed steps through the real
`engine.advance` / `engine.apply` so it measures the shipped numbers. Reports milestone times;
`test/pacing/*.test.mjs` parse the milestone table in `docs/BALANCE.md` and assert each target
within its tolerance, plus the invariants listed there.

### A12. Tests (node:test)

`npm test` = `node --import ./tools/node/register.mjs --test --test-concurrency=1 "test/*.test.mjs" "test/!(qjs)/*.test.mjs"`
(globs: Node 22's `--test` does not take a directory; every suite folder but `test/qjs`, which
`npm run test:qjs` runs without the Node hooks); `npm run test:frozen` runs the same suites with
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
serializeSteps(state) → Generator<void, string>    // serialize in steps; its text is the state at its first step (A4)
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
  tray: { envelopes: [{ helperId, type, units, bob, label: "×2.8"|null, tooltip }], more },
                                           // label: the stack count when units ≥ 2, one decimal below 10
                                           //   ("×2", "×2.8", "×12"), never floored (r5-15); tooltip: what
                                           //   opening it gives now ("Rush ×3 for 1m 30s · …")
  streak: { fill: 0..1, label: "×1.4", inStep: bool, afterglow: "12m" | null,
            afterglowText: "Afterglow ×1.25 · 12m" | null },  // the footer chip and streak tooltip (r5-14)
  boosts: [{ type, label, msLeft, msTotal }],
  helpers: { groups: [{ key, title, count, folded, tiles: [Tile] }], dense, legend: bool, empty: bool,
             elsewhere: [Tile], elsewhereCount,
             album: [{ helperId, name, species, hue, leftAgo, folds }] },
                                           // tiles and elsewhere are built only for the panel's Flock tab
                                           //   (empty in the ribbon, rail and other tabs; counts and
                                           //   elsewhereCount are always filled; review r8-09)
  shop: { segments: { works: [Row], tools: [Row], folk: [Row], charms: [Row], curios: [Row], auto: [Row] } },
  string: { cranes, of, nextIn, lifetime, gain, can, needed, perks: [{ at, text, have }], garlands: [...],
            strands: [0..1 ×20], title, next, at, button,
            gate,                                // shown cranes at which the wish opens (≤ of)
            gateStrand: 1..19 | null,            // the strand the gate mark sits before when the gate
                                                 //   is inside the String (W 10–39), else null (r5-12)
            potNote: "First collects your +28.0K folds from while you were away." | null, // r5-13
            wishMoment: null | { phase: "rise"|"settle", strands } },
  settings: { …current values, notifySentToday, automations: [{ id, name, owned, on }] },
  away: null | { kind: "away"|"busy", duration, capped, folds, split, envelopes, needs: [...],
                 rested, best, affordable: [...], collectable: bool },
  notices: [{ kind, text, actions }],      // engine notices (clock); save notices merged in by glue
  ribbon: { marks: [Mark], level: "A"|"B"|"C", tallies: [...] }, // computed for opts.width; ui/ribbon.js may draw a denser level once lead chips (hint, save chip, welcome pill) take their width
  rail: { pips: [Mark], tallies: [...] }    // at most RAIL_PIPS (240) pips, needs-you then finished first;
                                           //   the rest counted in tallies by status, "elsewhere" for
                                           //   another window's helpers (review r8-10)
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
calm mode). Time alone moving the counters (`advance` bumping `state.rev`) does not touch the
slot: the bucket decides those re-renders, so calm mode really re-renders every 5 s; a player
action, a roster change, a notice or a flash touches the slot and re-renders at once, and so does
an `advance` whose events are more than earnings (a node or pickup appearing, an automation
buying or opening an envelope) (r3-12). The bumps time alone makes are counted in `slot.timeRev`
and left out of the vm key, so a render herdr runs for its own live data (agents, terminals, focus,
theme) between buckets reads the cached vm and shows the same counters.

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
(§10.2; nothing after 8 h, and nothing for one last seen waiting for input, review r6-05). Without a writer (simulator, tests) every helper counts as seen.
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
`hitBoost(state, E, t)`, `giftFolds(state, E, rates, t)` (the Crane's Gift, DESIGN §4.5), `stackFactor`, `envelopeDef`, `isOn(state, automationId)`,
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
  `env:<helperId>:<turn>`, `fig:<hits>`, `slot:<seq>:<j>`, `crane:<cranesSeen>` (outcome),
  `crane-gap:<cranesSeen>:<activeMs>`, `boat:<activeMs>`, so merged lineages roll the same
  envelope types, figures and spawns whatever the order. Crane and boat rolls are not keyed by
  `seq` (which counts every spawn, including unclicked pieces whose number calm mode's longer
  lives changes), so calm mode rolls the same cranes (BALANCE inv. 12). `state.rng` stays in the
  save (`next()` is still exported) but the engine's rules no longer step it.
* Spawn clocks belong to the window being played (`presence.handBy`). Other writers advancing
  the shared clock leave the mat alone; the owner's actions merged in late first run the spawn
  clocks up to their own time (`spawn.syncedTo`). On a hand-over merged in late (the first click
  of a new owner, older than `syncedTo`, while the old owner's lineage was idle: no hand input in
  the 30 s before it), `syncedTo` moves back to that click, so the new owner's spawn clocks restart
  where its own lineage started them and its merged node clicks find their chains (without this,
  every session start of a two-window game lost up to one save interval of spawns and clicks:
  P1 two-window days were 1.5–4 % short). A background window's `observe` does not
  overwrite the presence flags of a window with a hand input in the last 30 s.
* The stored rhythm `r` is not reset by ticks (a late hit must keep its streak); read it through
  `rhythmAt(state, E, now)`. A pause past the rhythm gap but no longer than `K.slipMs` (4 s)
  costs `K.slipBeats` (10) beats of the streak, at least 1 kept; a longer one ends it (review
  r8-03). Crane's Gift reads the same `rhythmAt`. A stale observation (older than the helper's `lastSeen`, or than
  its `missingSince` for the Album) is skipped for that helper.

**Other decisions.** Spawn slots: DESIGN §3.2 says "minus six slots"; the geometry puts twelve
slot centres on the Sheet (cols 3–6 × rows 1–3), so `content.js FREE_SLOTS` leaves out those
twelve plus the ream slot (37 slots). The Crease Helper completes the whole chain at 80 % of its
life, paying half of `V` (no combo or boost) per remaining node and for the finish. The first
wish's gain is `floor(cranes/100) − W` (exactly 10 at L = 6e9). Crane outcomes (review r6,
originality) are `gift`, `storm` (shown as Confetti) and `song`, rolled 40 / 35 / 25 % from
`crane:<cranesSeen>`; a saved crane whose outcome is anything else (an older build's `lucky`)
pays the Gift, so no save migration is needed. `cranes(L)` is
`floor(firstCranes · (L / Lw)^stringExp)` (1,000, 6e9, 0.4) corrected to the largest `c` with
`lifetimeFor(c) = Lw · (c / 1000)^(1 / 0.4) ≤ L`, so `cranes(lifetimeFor(c)) === c` for every `c`
and L = 6e9 gives exactly 1,000. The notification counter counts
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
Counts, chips, marks and pips include waiting fledglings (r2-17): a blocked fledgling lifts the
counts chip ▲, the rail, the mat chips and the ribbon tally, and `header.kidsWaiting` counts them.
`helpers.needsGroup` names the group a "needs" request should scroll to: `"needs"` while Needs you
holds a tile, `"all"` in workspace order, else the group holding the longest-waiting fledgling's
parent (or `"elsewhere"`), null when nobody waits.

**Order.** Needs you: longest waiting first (`blockedAt`) in the Flock and the mat chips; every
other group, and every group in the ribbon and rail, in join order. Workspace order sorts by
space, tab, pane (natural order: "tab 2" before "tab 10"); its one group is
`{ key: "all", title: "Workspace order" }` (the UI hides the header for `"all"`). Elsewhere
tiles/marks come last with opacity 0.5.

**Loop budget.** Computed once per call in priority order with a total of 12 (ribbon and calm:
0): pulses (≤ 6 most recent waits, < 10 s), crane bob (`mat.crane.bob`), confetti flecks
(`mat.storm`, also false in calm), the newest *drawn* tray envelope (< 10 s since `lastAt`),
In step spins (first ≤ 6 working tiles) or new-work spins (≤ 4 latest starts, < 20 s), and the
first-run hint (`sheet.hintBob`; `sheet.firstRunHint` stays true in calm, static).
The record has no "started working at" field, so `workStart(h)` uses `h.workingSince` when the
engine adds one, else the latest of `joined`, `warmUntil − 20 min`, `thanksUntil − 5 min` (each
is set only when work starts, so it never invents a start; a Needs-you → Working change after
more than 5 min with no rest is the one start it misses).

**Mat coordinates.** Nodes, scraps, the ream and the crease line are slot **centres**; the crane
(48×36) and boat (48×30) are the **left/top** of their hit box, gliding by `left` from `x` to
`x1` (crane: towards the far side; boat: 8 → 248; calm: `x1 === x`). The boat's vm has no `y`:
the mat puts it in its own lane above the bottom band and paints it right after the Sheet, under
the play pieces of the bottom slot row it shares (`ui/mat.js` boatBox, review r6-06). `nodes[].i` is the
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
  scrollTo: groupKey | null,                // Flock: counts chip ● / ◗ asked for this group (cleared once consumed)
  pops: [{ id, label, x, y, risen }]        // floating numbers (≤ 5, mat px), owned by the glue
}
```

**`ctx`** is built by the glue once per render:

```js
{ T,            // herdr theme() as is (keys may be 8-digit; ui/color.js normalises)
  S,            // palette.pickScene(dark): scene tokens (§13.2)
  hues,         // palette.pickHues(dark): Hue[0..7]
  dark,         // the art for the theme SHOWING (r5-01): palette.artDark(T, appearanceDark),
                //   remembered per theme surface (Session.artDarkFor); not settings().dark,
                //   since a single-name theme shows the same theme in both appearances
  appearanceDark, // settings().dark, the window appearance: artDark's fallback only
  zoom,         // settings().zoom (loop px are multiplied by it; numeric lengths are not)
  calm,         // vm settings calm (no loops, no spins, no pops)
  width,        // this copy's logical width (panel Wp, rail 64, ribbon work width W)
  height,       // logical height (panel H; ribbon 30), optional
  panelShown,   // ribbon only: panel copy visible and unfolded (hides the ribbon mini Sheet)
  panelFull,    // ribbon only: that panel is full width (it shows the away card, so the ribbon's
                //   Welcome pill hides; a tight rail has no away card, r3-14)
  save,         // optional, from the slot: { state: "saved"|"saving"|"problem", text: "Saved 12 s ago",
                //   path, lastGood, backup, damaged: [names] } (footer glyph, banner Details, Settings)
  narrowHint,   // ribbon only, optional: true shows "Terminals are narrow: fold Creaseworks?" (§2.3)
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

**As built (tabs builder).** One handler is added to the table: `resetGame(cx)` (Settings
"Reset game…" confirm card, after `confirm("reset")` armed): a glue store call that keeps the old
save as `save.damaged-<n>.json` with reason `"reset"` and starts a fresh state. `toggleGroup(key,
cx)` must store `ui.folded[key] = !isFolded(vm, ui, key)` (`ui/flock.js` export), not a blind
flip, because some keys start folded without a stored value: Elsewhere, Album, the legend (unless
`vm.helpers.legend`), every `owned:<segment>`, and a group the vm marks `folded` (Resting above
12). `ui.scrollTo` unfolds its group. Shop reads the Works count from `vm.shop.buyCount` (else
`ui.buyCount`, else 1) and calls `buy(id, count)` with it for workshop rows and with 1 for tier
sub-rows and upgrades. The two-step confirms (wish, restore, reset) are armed when `ui.now −
ui.armedAt ≥ 1500` (`ui/string.js` `isArmed`, `ARM_MS`); without both numbers they stay disarmed,
so the glue must re-render with a fresh `ui.now` (its 1 s data tick does). Exports besides the
renderers: `ui/flock.js` `isFolded allTiles selectedTile flockHeadline tileLook tileElement TILE
VIRTUAL_ABOVE TILE_BUDGET TILE_BUDGET_BAND tileCost virtualGroups KID_FLAG_LEFT VLIST FLOCK_CLIP`
(the glue passes `virtualGroups` to the Session, which keeps the last panel render's lists in
`ui.flockLists` for the next one, r3-16); `ui/shop.js` `activeSegment buyCount rowIconPath SEGMENTS
BUY_COUNTS SILHOUETTES SHOP_CLIP`; `ui/string.js` `isArmed wishConfirming strandShares
strandSize strandFill stringLines STRAND ARM_MS CLEARS KEEPS STRING_CLIP`; `ui/settings.js` `CHOICES SETTINGS_CLIP`.
Ids: tiles `cw-flock-tile-<helperId>` (badge `-badge-`, envelope marker `-env-`, rest bar
`-rest-`), group headers `cw-flock-grp-<key>`, virtual lists `cw-flock-vl-<key>`, shop rows
`cw-shop-row-<id>` / buttons `cw-shop-buy-<id>` / silhouettes `cw-shop-unknown-<id>`, settings
controls `cw-set-<dotted key with - for .>`. The §3.5 wish moment is drawn from
`vm.string.wishMoment` (`"rise"` then `"settle"`, from `ui.lastWish`): the strand lift declares
its `top`/`opacity` transitions on every frame (0 ms outside the rise, 900 ms on it, a 300 ms
fade only in calm mode, 0 ms on settle), because gpui animates only a later change of a
transition that already exists. The phase (`clock.js wishPhase`) is in the glue's vm key and the
tick re-renders when it changes, so each phase is built and drawn whatever the re-render bucket:
calm mode's 5 s bucket otherwise passed over the 2 s settle, and the faded strands came back at
full opacity, then shrank (r8-11). Round-1 vm fields: `helpers.albumCount` (always, cheap) next to
`helpers.album` (rows only with view option `album: true`, which the glue passes while the
Flock's Album section is unfolded, and keys its vm cache on); `tile.kids` and `tile.pips` (waiting
fledglings first, longest wait first; a clickable "+N" opens the first waiting one past the
fourth pip); `mat.crane.hint` (the first crane only, until one is caught); `away.highWater` and
`away.skipLeft` (DESIGN §10.1); the away pot's `tasks0` (best helper since the last visit). The
save info in `ctx.save` carries `shared` (true only while sharing), and the share card's
"Choose save.json…" uses the `pickSharePath` handler (herdr `pickFiles`).

### B12. Simulator as built (simulator builder's additions; A11/B8 still hold)

`tools/sim/pacing.mjs` exports `runProfile(profileId, seed, opts)` (B8; opts `idleStep` 1–60 s,
`stopAt` `"wish"|"wish2"` (P1 defaults to `wish2` and makes the first wish at once), `days`,
`wish`, `windows`, `buys`, `keepState`, `trace`, `onStep`), `runAll(ids, seeds, { workers })`
(worker threads), `evaluate(runs)` (every BALANCE row → `{ rows, pass }`), `report`, `bestBuy`,
`playerBuys`, `Player`, `agentObservation(profileId, sec)`, `cadence`, `median`, `parseSeeds`,
`SHARE_BUCKETS`, `T0`. `tools/sim/profiles.mjs` holds the P1–P12 parameters as code and
`parseBalance()` (§3 profile list, §3.1 activeFrac, §4, §5 incl. extras and monotonicity, §6.1–6.3,
§7 numbers, §8 knob values); a BALANCE cell it cannot read throws.
* **Time.** Play-clock p (s) maps to wall `T0 + d·24 h + (p − 8 h·d)` on day d; nights are a
  16 h wall jump the engine credits as an away segment. Steps: 1 s during sessions (hand hits on
  their exact ms), `idleStep` (default 10 s) outside them, and every agent/fledgling change on its
  second. Results do not depend on the idle step (`test/pacing/step.test.mjs`: 1 s vs 10 s within
  1 %; only tick-driven automations move by a few seconds).
* **Agents.** Agent i = 1…n (addr `a<i−1>`, fledgling `k<i−1>`), offset `(997·i) mod 3600` s;
  `turn` = 1000 + 3 per hour cycle + finished blocks. Observations are sent only on change.
* **Player draws** (crane catch 80 %, chain success 95 % and the tear point) are keyed by the
  crane ordinal and the active clock at a chain's first sighting, not by item ids, so P12 (calm)
  and two-window runs make the same choices.
* **Shares.** `helpers` includes `overflow` (a helper's overflow is helper income).
* **Two windows (inv. 11).** `windows: [{ w, agents, sessions }]` runs writers on one save text
  with the A4/A5 merge every 15 s (offset 7 s); `buys: run.purchases` replays a one-writer run's
  purchases (at every step; an unaffordable one waits; one refused on merge is re-queued). The
  test compares each day's lifetime, workshops, away, tasks and units with that one-writer run.

### B13. Glue as built (glue builder's additions; A4–A6 and B7 still hold)

`mods/creaseworks/main.js` + `glue/{clock,live,store,observe,commands,notify,session,views}.js`;
tests `test/glue/*.test.mjs` (mock herdr, virtual clock; also run by `npm run test:frozen`).

**main.js.** `export default class Creaseworks extends View` with `init/render/close`. It imports
`gpui-kit`, `glue/session.js` and the `ui/` renderers (plus `ui/palette.js` for `S`/`hues` and
`ui/flock.js` `isFolded`, `sectionIndex` and a `newFlockScroll()` ScrollHandle, which it hands to the
session, B16); only `glue/*` imports `herdr`. `render`
returns `div#root` (`size_full`, `on_size_change` → `Session.onSize`) around `renderRibbon` (role
`"ribbon"`) or `renderPanel` (which draws the rail when folded or under 200 px); while the save loads it draws a
one-line placeholder.

**Session (B7).** `new Session(role = null, { isFolded, sectionIndex, virtualGroups, scroll })`:
a null role is read from `props().role` in `init`. Extra members: `ctx()` (the B11 ctx minus
`S`/`hues`: `T` = `theme()`, `dark`/`zoom` from `settings()`, `calm`, `width`, `height`, `save`,
`handlers`, and for the ribbon `panelShown`, `panelFull`, `narrowHint`), `uiForRender(vm)` (the
copy's `ui` with `ui.now` set and, on the panel's Flock tab, `ui.flockLists` = the lists the last
render drew), `loading()`,
`changed(cx)` (builds the vm in the tick / handler, then `cx.notify()`, so render only reads the
cache; the load task calls it once the game is loaded, so the first render after a load reads a
built vm too: r3-03), `dispatch(action, cx)`, `openHelper(idOrGroup, cx)`, `loadingText()` (the
placeholder's text; it says when a load is being started again). `ui` also carries `buyCount` (the
Works toggle; `handlers.setting("buyCount", v)`). Handlers add `resetGame` (B11 tabs builder).
The vm cache key is exactly what `view()` reads: `state object | state.rev − slot.timeRev |
writerId | width | tab | buyCount | notice kind@at@retry@text@message | clock bucket (1 s, 5 s
calm) | short | Album open | flash`; `short` = panel height < 640. Not `state.rev` itself (advance
bumps it every second) and not `slot.rev` (a save landing or a notice-free touch changes no vm):
either rebuilt the whole vm inside render between buckets (r3-12 review: 18-39 ms of 50 at 1-2
years). `state object` is a per-copy number for each state object (a load or merge puts a new
one in the slot). Render (`vm()` with no time) builds for the time of this copy's last tick or
handler while it is within one data tick (`vmTime`), so a render between a bucket's start and the
copy's next tick reads the cache too; handlers build for the time now.

**Slot (A6) fields beyond the A6 list** (all plain data): `home` (a slot from another app home is
never adopted), `rev` (glue change counter: re-renders, not the vm key), `timeRev` (the `state.rev` bumps time alone made), `paths` (`save bak location dir shared`),
`loading` (load generation), `readOnly` (newer save), `save` (`status baseOk gen writing savedAt
dirtyAt urgentAt writtenRev confirmed errors retryAt damaged[] problemSince`), `notices {load,
write}` (`notice` is the one on show: error > conflict > newer > fresh > recovered > merged),
`flash {text, until}` (3 s messages: "Nobody needs you", "That agent has gone", Settings tool
results; shown as the ribbon `pill` and a footer notice), `obs {sig, presence}`, `live` / `panes`
(null-prototype maps from the latest `terminals()` / `agents()` read), `widths {panel,
panelHeight, ribbon, lastPanel, lastWeight}`, `loadAt` / `loadBy` / `loadGen` / `loadTries` (the
load under way: its last progress, the copy and code generation that started it, how many times
it was started again; Session `watchLoad`), `layout` (`layoutInfo(layout())`), `presence {visible, active,
panelShown}`, `request` (a ribbon/rail `select` / `showGroup` for the panel copy's `ui`),
`notify {claim, rescued}`, `narrow {filesEpoch, filesWas, dismissed}`, `cycle` (▲/✓ cycling).
Copy ids are `"<role>:<random>"`; a new `init` takes over older copies of its role (their timers
died with their generation), so the ticker passes on at once after a hot reload. A ticker is
stale after `max(5 s, 2.5 × its tick interval)` (a hidden window beats every 5 s).

**Store (A4).** `load` reads `location.json` first (a damaged pointer falls back to the local
save, with a notice). Damaged copies: the newest is always the highest `n` of 1..5 (the next `n`
after the highest in use); when 5 is in use the kept files move down to close any gap, and only
when all five hold a copy is 1, the oldest, replaced (r3-08: filling a gap first made the next
shift drop a newer copy). Text already kept in one of them is not kept again (r3-01: a damaged
`save.json` read on every reload filled all five). Names listed in Details move with their files. An unreadable `save.json`
(> 1 MiB, not a file) is an `error` notice with back-off. A merge shows `merged` only when
another writer's `applied` grew (a hot reload's own late write is not "another window"; a
`save.json` found missing says so instead, `MISSING_TEXT`, and one damaged by another writer says
that: r3-09);
refused purchases are named in it. `checkSave`, `restoreBackup`, `resetGame` (old file kept as
`save.damaged-<n>.json`, listed as "(restore)"/"(reset)") and `sharePath(path)` (validated:
absolute, `.json`, absent or a Creaseworks save; writes only `location.json`; this window's
pending actions are replayed onto the shared save; `""` stops sharing) are exported.
`ctx.save` = `saveInfo(slot, now)` (adds `shared`, and `backup: "damaged"` for a damaged backup).
Round-1 additions (DESIGN §12.1): an unreadable `save.json` writes `save.recovery.json` (load
takes the newer of it and the backup by state clock); Reset/Restore set `save.overwrite`, so the
next write replaces the file; the other window notices its own `applied` count dropped below
`save.ownApplied` and names the kept copy. The pending log (`glue/live.js`) coalesces title-only
roster observations past `COALESCE_AT` (512) actions or `COALESCE_HELPERS` logged helper entries (r5-09), and is given up past `PENDING_MAX` (20,000)
(`save.logLost`: the next write keeps the other file aside); merges replay it in slices
(`replayPending`, which finishes a given-up log before the new one). A save claim
(`save.writingBy`/`writingGen`) is released on adoption only when it was made by an older code
generation (`codeGeneration()`, a token renewed each time herdr evaluates `live.js` again; a
Settings tool's claim, Check, Reset, Restore or a share cut off before its pointer write, is said
in a `recovered` notice, since that tool may not have taken effect: r3-07), or
after `WRITE_STALL_MS` (60 s) without progress; a second panel in the same generation never
drops a live claim. Save timers are rebased when the wall clock moves back, and backup rotation
failures get their own notice and back-off.
Round-5 additions (DESIGN §12): `recoveryWrite` merges another window's recovery game every round
(`mergeRecovery`; `save.recOwn` is `applied[writerId]` in this window's last recovery write, and
`save.overwriteRec` marks a Reset/Restore that has landed in the recovery file, which counts as
landed on the way back). On the way back to `save.json` it first takes in `save.recovery.json`
(`back = true`). Writers the engine pruned (`writerPruneMs`) do not count as fresh progress in a
stale recovery file. Recovery notices are flashed while the unreadable `error` notice is up
(`recNotice`) and dropped on the way back (`dropRecNotice`). The recovery loop pauses between
CAS attempts (`test/qjs/store-merge.test.mjs` times it for 365- and 600-day saves).

**Notifications (§11.2).** A notification is claimed first: the ticker dispatches `notified`,
saves at once, and calls `notify()` only when that save is confirmed and the merged counter for
the day is still ≤ 3, so two windows racing for the last slot send one. The `save` event (a save
error / fresh notice lasting 5 min, once per episode) is sent on the local counter. "Quiet" = the
panel copy is alive, not hidden and not folded, and `window()?.active`. The toast's click action
is `creaseworks.show` (every shown copy gets it; the one acting on commands runs `show()`, which
shows and unfolds the panel or flashes why it can't): a toast sent while the window is active
finds the panel folded, and `layout.show` only clears the hidden flag (r3-06). With the ribbon and
the panel both hidden no copy takes a command, so the action is `layout.show {id: "cw-panel"}`.

**Commands (§2.6).** The ribbon copy acts unless `layout()` reports `cw-ribbon` hidden; the panel
acts only when it does (or, with an unreadable `layout()`, when no ribbon copy is alive).
The commands are `fold`, `show` (the notification click), `answer` and `envelope`.
`layout()` is read tolerantly (a tree of `{id, hidden, size, children}`; a node missing from a
known tree counts as hidden). `fold`: hidden panel → `layout.show` + `layout.resize` to the last
weight; rail (< 140) → last weight; else remember the width (slot + `localStorage`
`creaseworks.panelWidth`) and the panel's `{weight}` from `layout()` as a share of main's weight
(slot `widths.lastWeight` + `localStorage` `creaseworks.panelWeight`, try/catch). herdr gives each
copy its own `localStorage` (keyed by its props), and the panel copy measures while keys, the
palette and ribbon marks unfold from the ribbon copy: each copy's data tick copies the slot's
widths into its own store (`syncStore`), the copy that remembers a weight always writes its own
store, and `init` restores `lastWeight` as well as `lastPanel` (r3-05). Then it resizes to the
rail, `{weight: 0.001}` (`RAIL_WEIGHT`), held at cw-panel's `min: 64`. Fold and unfold are always
`{weight}`, never `{px}` (B15); unfold is the remembered share × main's current weight, else 0.39.
`layoutInfo` also reports `mainWeight`, `filesWeight`, `filesMin`, `filesMax`; its `filesPx` is the
Files column's px, else 368 (`FILES_PX_FALLBACK`), and `filesEstimate(info, Wp)` gives a weight
Files column's real width from the panel's measured width (B15). Group keys `"needs"` / `"finished"` pick
the longest-waiting / oldest tile and cycle on repeats within 30 s; a `"needs"` scroll resolves
through `vm.helpers.needsGroup` (so a waiting fledgling scrolls to its parent's group). Fold,
show and select follow the B16 panel-state rules.

**views.js (A10).** Every entry is a real game: `scenario` is a getter (agents, terminals, a
fixed-seed save, its own app home `/shots/<name>/herdr-app`, `patchDate: true` so the glue clock
reads the virtual clock; reading it also forgets a slot this view's previous run left in the
rig's process) and `setup` plays it into shape through the session (clicks, buys, turn deltas,
wishes, another writer's observation, `failNextWrite` / `raceNextWrite` / `externalWrite` for the
banners, a wall-clock step back for `clock`). Where luck or hours decide a state, setup moves the
one engine field that decides it (spawn clock due, a storm's end time, banked folds) and lets the
engine do the rest. Panel-width views follow the shipped layout (B15): `narrow` 226×584 (1100×700),
`narrow-files` 152×584 (1100×700 with Files open), `wide` 440×784, `wide-2560` 636×1324 (2560×1440).
Ribbon views are `ribbon-<n>-<1100|1440>`; `flock-12` (block `cw-panel`) and
`ribbon-window` (block `cw-ribbon`) fill the whole-window shots; `windowScenario` gives the
chrome the same 12 agents. `garlands` is 320×1160 (`GARLANDS_SIZE`): at 784 the String tab ends at
the Perks heading and the garland stripes it is named for were below the fold (review r1-29;
`test/glue/views.test.mjs` lays it out in chromium and checks every stripe is in view).

### B14. Integration as built (integration round; A2–A12 and B1–B13 still hold)

* **Tests.** `npm test` runs every folder under `test/` except `test/qjs` (glob
  `test/!(qjs)/*.test.mjs`), and `npm run test:frozen` the same set under frozen prototypes (the
  QuickJS and Playwright suites skip there). `test/qjs/creaseworks.test.mjs` loads the REAL mod in
  the harness with 0, 4, 34 and 64 agents (panel, rail, ribbon): module graph / constructor /
  init < 500 ms, every render < 50 ms (p50 and max reported), every timer tick < 500 ms, clicks
  through `fire()`, hot reload mid-play and mid-write (both outcomes), VM restart from disk, and
  hostile addresses (`__proto__`, `constructor`, `toString`, …) under frozen prototypes.
* **Engine index** also exports `formatEta`, `formatInt`, `graphemeCount` and `cleanTitle`.
* **Render hot path.** `ui/color.js` memoises `contrast`, `over` and `statusColor` in bounded
  module-level tables (filled lazily at call time, never at import: A2 rule 2 holds). The mock
  gpui recorder (`tools/mock/gpui-core.js`) takes fast paths with the same outcome for numeric
  lengths and for colour strings that already parsed, and no longer allocates rest arguments per
  style call, so harness render timings measure the mod rather than the recorder.
* **Footer save line** (`store.saveInfo`): a `conflict` notice reads "Merging another window's
  save…" and a `fresh` one "Started fresh · saved …", so the problem glyph never sits next to a
  bare "Saved".
* **Palette entries outside the layout (r2-27).** herdr's palette adds every mod's `mod.json`
  `palette` entries in every layout (defaults/frame/palette/main.js `modPalettes`, `entries`) and
  cannot scope them. Outside Creaseworks the mod has no shown copy (`place: "none"`), so the three
  `creaseworks.*` entries return `unknown command …` (src/window.rs `run_as`, src/mods.rs
  `send_command` delivers only to shown copies) and `layout.toggle {id: "cw-panel"}` returns
  `no node "cw-panel" in the shown layout`; herdr toasts each as "<name> failed". Nothing else
  happens. The entries stay (the toggle is the only way to hide the panel, DESIGN §2.2); RECIPE's
  Watch out and README's Keys say so (`test/layout` checks both). A notification toast clicked
  after switching to another layout is the same case: its `creaseworks.show` action (r3-06)
  reaches no copy and herdr toasts "creaseworks.show failed"; nothing else happens.
* **A herdr read that throws (r4-01).** herdr's host bridge throws when a result holds a key named
  like an `Object.prototype` member (a terminal label `constructor`, say). The ticker guards
  `layout()`, `agents()`, `terminals()` and `buildObservation` separately: a throw keeps the last
  good observation or layout, and advancing, notifications and save writes run as usual. The first
  throw of a spell flashes `READ_FAIL_TEXT` (glue/session.js: "Agent list unreadable: …" or
  "Layout unreadable: …", the words before the colon fit a narrow rail) for 12 s; later throws only
  count (`slot.readFail`), and a good read ends the spell, so the next failure says so again.
* **Narrow windows and zoom.** Superseded by B15 (the panel used to be `{px: 320}` and was
  pushed off-screen at 1100 px with Files open and at zoom 1.5).

### B15. Panel sizing in herdr's geometry (reviews r1-32, r2)

* **What herdr does.** `sized()` (src/window.rs) makes a `{px}` node `flex_none` at px × zoom;
  `min` / `max` only add `min_w` / `max_w` (× zoom, settings::z). A `{weight}` node grows from a 0
  basis by weight ÷ the shown siblings' total weight, shrinks to its `min`, and a too-narrow row
  is clipped at its end. So with `cw-panel` `{px: 320}` and Files `{px: 368}`, only `main` could
  give way and, with `main`'s `min: 360`, the last node (the game) was pushed off-screen.
* **The layout now** (`tools/layout/build.mjs`). `cw-panel` is `{"weight": 0.39}`, `min: 64`, no
  `max`; herdr's Files column (`panel`) is `{"weight": 0.66}` with **`min: 160`** (`FILES_MIN`;
  herdr ships 280, review r6-07; herdr's `max: 900` dropped, r7-01; every other field kept); `main` is herdr's
  weight 1 with **`min: 80`** (`MAIN_MIN`; was 360).
  `work-body` is **`main | cw-panel | panel`**: the game sits right after the terminals and the
  optional Files column ends the row (r2-15, below), so herdr clips Files first.
* **Why main's min is 80.** herdr's own `main` has no min; the 360 was ours, and it was what
  pushed the game off-screen at zoom 1.5 with Files open (1100×700: the rail at x = 1400, none of
  it on screen, Files 133 of 420 px; 1440×900: 41 of the rail's 96 px). The tightest window we
  support, 1100×700 at zoom 1.5 with Files open, has 649 px for main + Files (280 × 1.5) + the
  rail (64 × 1.5), so main gets 133 px (88 design px; herdr's own layout gives it about 108 there). Any
  min above 88 makes main hold it and clip the game; 80 leaves slack. **Since r6-07** Files' min
  is 160, not 280: a min is held as min × zoom (src/window.rs sized()), so at zoom 1.5 the 280 held
  420 px of a 1100 px window and left the terminals 1 to 2 columns a pane. With 160 Files gives way
  by its weight like the game: main gets 294 px (196 design px), Files 240, the game 115 (76
  design px, the rail), and any main min above 208 would cut something there. At zoom 1 the terminals
  never come near it (≥ 360 in every state from 1100 px up, `test/layout`); the min now only
  stops a drag (drag_to clamps to the left node's min). Cost: at 1100×700 zoom 1.5 with Files
  closed, the terminals get 475 px (was 540) and the game 185 (124 design px, drawn as the rail).
* **Widths** (terminals / Files / game, screen px; DESIGN §2.4 state in brackets):

  | Window | Files closed | Files open | Folded, Files open |
  |---|---|---|---|
  | 1100×700 | 581 / – / 226 (Narrow) | 390 / 257 / 152 (drawn as the rail: below 200) | 443 / 292 / 64 |
  | 1440×900 | 825 / – / 322 (Standard) | 556 / 367 / 217 (Narrow) | 648 / 427 / 64 |
  | 1920×1080 | 1171 / – / 456 (Wide) | 790 / 521 / 308 (Standard) | 937 / 618 / 64 |
  | 2560×1440 | 1631 / – / 636 (Wide) | 1102 / 727 / 430 (Wide) | 1322 / 873 / 64 |
  | 1100×700 zoom 1.5 | 475 / – / 185 (124 design px: rail) | 294 / 240 / 115 (76: rail) | 313 / 240 / 96 |
  | 1440×900 zoom 1.5 | 720 / – / 281 (187: Narrow) | 482 / 318 / 188 (125: rail) | 538 / 355 / 96 |

  Every node is on screen in every row (no clipping, no empty strip); the envelope is zoom ≤ 1.5
  (zoom 1.5 with Files open needs 604 × 1.5 + 1 = 907 px since r6-07; with the 280 min it was
  724 × 1.5 + 1 = 1087). Past it, see the next point. **This changes the default
  look:** the designed panel was 320 px everywhere (DESIGN §2.1–§2.2); now the 1100×700 default
  is the **Narrow** state (mat at full width, Flock dense, Shop icons only) and so is 1440×900
  with Files open; big windows are Wide with no cap (the old max was 560; 2560 gives 636). The
  terminals gain what the game gives up (1100×700: 581 instead of 488). Shots: `narrow` 226,
  `narrow-files` 152 (146 before r6-07), `wide-2560` 636 and `window-1920x1080-*` (456) cover these widths.
* **Past zoom 1.5: Files is clipped, never the game (r2-15).** herdr's zoom runs 0.5–3.0 in 0.1
  steps (settings.rs), `render_node` makes every container `overflow_hidden` (src/window.rs
  ~4624) and a row never wraps, so once the mins do not fit, the row's END is cut. With Files
  open the row needs 268z (sidebar) + 1 + 16z (padding) + 16z (gaps) + (80 + 280 + 64)z =
  724z + 1 px with the 280 min: 1100 px from zoom 1.6, 1280 from 1.8, 1440 from 2.0 (since r6-07,
  with Files' min 160, 604z + 1: 1100 px from zoom 1.83, 1440 from 2.4). With `cw-panel` last (as built
  until r2-15) that cut the game: 1100×700 zoom 1.6 lost 47 of the rail's 102 px, zoom 2 put all of
  it off-screen, and so did 1440×900 zoom 2.5. B15 used to say "every node is on screen" without
  naming its zoom ≤ 1.5 envelope. Now `cw-panel` comes before Files, so the same windows cut Files
  (1100×700 zoom 1.6: Files 401 of 448 px; zoom 2: 226 of 560; zoom 2.5: 8 of 700) and keep the
  terminals and the game whole as long as `work-body`'s content box holds (80 + 8 + 64) × zoom.
  The only windows short of that are zoom 3 below about 1300 px, where herdr's own px sidebar
  (804 px) leaves `work-body` less than that; there the game loses part of the rail too, but only
  after Files is gone. The ribbon (outside `work-body`, the full work column) keeps every helper's
  mark, the counts and save problems on screen in all of these. **main's min stays 80**: any min
  above 88 cuts Files at 1100×700 zoom 1.5 (inside the envelope), and where everything fits the min
  does not change main's width; past the envelope a higher min would only trade Files px for main
  px. `test/layout` "past zoom 1.5" checks zooms 1.6–3.0 at 1100–2560 px in every state.
* **No `max` on a weight node.** herdr keeps grow factors normalised to the original siblings
  after a node freezes at its max (`pane_size::shares`; taffy, CSS flexbox 9.7 step 4b), so a
  capped weight node leaves the rest of its share empty: `{weight: 1, max: 320}` would leave a
  254 px empty strip right of the panel at 1440×900. **This covers Files too (r7-01):** the build
  kept herdr's `max: 900` when it made Files a weight, so on wide or zoomed-out windows Files froze
  at 900 × zoom and the rest of its share was left empty at the end of `work-body` (folded with
  Files open: 2560×1440 zoom 0.8 152 px, 2880×1800 62, 3440×1440 285, 3840×2160 444, 5120 954;
  1920×1080 zoom 0.5 222; herdr's own px Files leaves none). The build now deletes it, and
  `build()` refuses any `{weight}` node with a `max` (`cappedWeightNodes`). Files keeps growing
  with the row instead (3840 folded: about 1400 px beside 2100 of terminals). `test/layout`
  checks there is no strip at 1100–5120 px (2880, 3000, 3440, 3840 and 5120 wide added in r7-01)
  and zoom 0.5–0.9, 1 and 1.5, in every state. Owned elsewhere: `glue/commands.js` `FILES_MAX`
  (900) is still `layoutInfo().filesMax`'s fallback when Files has no max, so `filesEstimate` and
  `railMainEstimate` cap Files at 900 from about 2640 px folded (3100 open) at zoom 1; with no max it should be `Infinity`
  (and `test/glue/commands.test.mjs` then expects that, not 900).
* **Commands: both sides are weights.** herdr's `drag_to` (src/window.rs ~4890) keeps a `{px}`
  side of a dragged divider as px, so a `{px: 64}` rail dragged open would stay px and never give
  way again. Fold is therefore `layout.resize {id: "cw-panel", weight: 0.001}` (`RAIL_WEIGHT`, so
  small that the 64 px min always wins, up to a 64 000 px row); unfold and show are
  `layout.resize {id, weight}` with the remembered share of main's weight × main's weight now (a
  drag between main and the panel changes both weights), else 0.39 (`DEFAULT_PANEL_WEIGHT`, equal
  to `PANEL_WEIGHT`). A dragged-open rail is two weights, so `keepWeight` remembers it. A panel
  left `{px}` by an older state file becomes a weight at its next fold or unfold; until then a
  drag keeps it px.
* **The narrow hint.** It is offered only while the panel is unfolded (B16 `panelState` "full" or
  "tight", measured wider than 72 px) and either `mainEst < 600` or the panel is tight (under 200
  px, drawn as a rail in its whole column, r2-14); in those states folding always widens the
  terminals (`test/layout` "folding gives the terminals room"). It reads "Terminals are narrow:
  fold Creaseworks?". Where the panel is folded or within `FOLD_GAIN_MIN` (24) of its 64 px rail
  (zoom 1.5 with Files open), folding changes nothing; since r6-07 the chip then offers "Terminals
  are narrow: hide Creaseworks?" while `railMainEstimate` gives the terminals under `HIDE_BELOW`
  (360 design px), and Hide runs `layout.hide {id: "cw-panel"}`. Fold, Hide and Not now all answer
  the chip (`answerNarrow`: once per Files opening, else per day), so the chip's Fold never turns
  straight into the Hide offer.
  `session.js` still computes `mainEst` with `layoutInfo().filesPx`, which for the weight Files
  column is the 368 fallback; the real Files width is 280 at 1100 px (so `mainEst` is about 88 px
  low there; the hint shows either way, real main is 373) and 367 at 1440. `filesEstimate(info,
  Wp)` gives the exact width; `session.js` `narrowHint` should use it (owned elsewhere).
* **Tools.** `tools/render/window.mjs` exports `shares` and `layoutBoxes` (herdr's geometry,
  screen px, with `inner` content boxes and `visible` clip rects); `tools/shots/shoot.mjs`
  `blockSizes` uses them, so whole-window copies measure what herdr would give them at each zoom;
  `tools/mock/commands.js` `applyLayoutCommand` applies `layout.toggle|show|hide|resize` and
  `applyDrag` a divider drag (port of `drag_to`) to a tree as the window does; the mock controller
  runs every `layout.*` a copy runs through `applyLayoutCommand` itself (A7, r4-02), so a bad id
  is a run error and the copies read back the tree they changed. Tests:
  `test/layout/layout.test.mjs` (every state at 1100–5120 px, zoom 0.5–0.9, 1 and 1.5, none skipped;
  no `{weight}` node with a `max`;
  zooms 1.6–3.0 clip Files before the game; folding helps; the designed widths above; RECIPE.md
  written from the built files), `test/glue/commands.test.mjs` (the commands' own runs
  applied and laid out with Files open at zoom 1 and 1.5; dragging the rail open), and
  `test/tooling/window.test.mjs` (geometry against hand-worked numbers, Files clipped before the
  rail at 1000 px zoom 1.5, zoom 1.5 window shots).
* **DESIGN to follow** (owned elsewhere): §2.1's diagram ("320 (64 … 560)", "main … min 360"),
  §2.2's table and its "(3) main has min 360", §2.3 ("mainEst 112", "folding gives the terminals
  368 px", `filesPx`), §2.4 (which windows give which state by default; past zoom 1.5 Files, not
  the panel, is what gets clipped), §2.5's layout block (with `cw-panel` between `main` and `panel`,
  r2-15; §2.1's diagram should put the game left of Files too) and
  §2.6's "`layout.resize` to 64 or to the last unfolded width, default 320". §2.5 now shows
  `layouts/Creaseworks.json` as built (`test/layout` "is exactly the layout in DESIGN §2.5").
* **Dragging the game | Files divider (r2-15 side effect).** herdr's `drag_to` clamps only the
  LEFT child's min and max. With Files now right of the game, dragging that divider right takes
  weight from Files below its min (280 then, 160 since r6-07), which herdr then holds by shrinking `main`
  (1440×900 with Files open, a 250 px drag: the game 217 → 392, `main` 556 → 467). `main` never
  goes below its 80 min, and the stored weights mean the game is wider (524 instead of 405) once
  Files closes; Fold and Unfold reset the game's weight. RECIPE's Watch out names it.

### B16. Verification round 2 as built (A4–A6, B13–B15 still hold)

* **Panel states** (`glue/commands.js` `panelState`): **folded** when the layout's panel weight is
  at most `FOLDED_SHARE` (0.01) of main's, or (no weight) its px ≤ 64, or the panel measures at
  most `RAIL_LOOK` (72 px; a drag stores 0.025–0.07 with no min, so a dragged rail is still
  "folded"), except right after this copy's own resize, before the new width is measured
  (`slot.layout.resized`); **tight** when unfolded and under `FULL_BELOW` (200: drawn as a rail
  in its column); else **full**. `ctx.folded` comes from this, never from a width threshold.
* **Remembered weight.** `keepWeight` and `fold()` remember the panel's share of main's weight
  (and `lastPanel`) only when the panel measures ≥ 200 px, so a drag-made tight panel never
  becomes the weight to restore. `canGrow()`: the share is under `lastWeight − 0.001`, or the
  panel is px-sized. `show()` (ribbon chips and pills, rail pips, `select`, `showGroup`) on a
  folded or tight panel that can grow unfolds to `lastWeight` (else 0.39) and returns
  `"unfolded"`; one already at its weight flashes `TIGHT_TEXT` ("Too narrow: drag the panel's
  edge or widen the window") or, with Files open, `TIGHT_FILES_TEXT`, and resizes nothing. A
  fold on a folded panel already at its weight (a tiny window) flashes the same text.
* **Rail feedback** (`ui/rail.js`): `railFlash(text, width)` shows the whole flash at ≥ 120 px,
  below that the words before the colon ("Too narrow"; `TIGHT_PREFIX`); while such a flash shows
  the chevron gets a 1 px `T.accent` ring. The chevron tooltip names folding to give the
  terminals room, dragging the edge and widening the window.
* **Flock scroll** (r2-19): `main.js` builds every copy's Session with `{ isFolded, sectionIndex,
  scroll: newFlockScroll() }` (B13); a ribbon copy releases its handle at init
  (`releaseScroll()`, also on close). The panel's `#cw-content` holds `flockParts` and tracks
  `ctx.scroll`; `ui.scrollTo` is consumed (`consumeScroll`) and always cleared, and a `"needs"`
  request scrolls to `vm.helpers.needsGroup`. ctx gains `folded` and `scroll`.
* **Pops** (r2-20, `session.js addPop`): at most 5 alive (`POP_CAP`); a pop past its transition
  (`POP_DONE_MS`, 716) is dropped, one still rising never is; while 5 are alive a click's amount
  is carried into the next pop that fits (the carry is dropped after 1 s without clicks). The
  rise is a 16 ms timer; the prune is one `after(≤ 800)`, due when the oldest pop finishes.
* **Save claims** (`glue/store.js`). Each claim records its purpose in `save.writingFor`
  (`cycle`, `resolve`, `check`, `reset`, `restore`, `share`). A claim whose copy has been missing
  from `slot.copies` for `ORPHAN_MS` (15 s; herdr cancels every task of a closed copy, `owner:
  null` ones too, and the mock does the same) or that made no progress for `WRITE_STALL_MS` is
  released by `releaseAbandoned(slot, t)` (called from `due()` and from `session.close` before the
  final write); `session.close` also releases at once, with `releaseClosing`, a plain cycle of a
  closed copy that has not sent its write (r8-04). A plain claim (`cycle`, `resolve`) is released quietly (a stall flashes "A save
  step stalled; saving again.") and the save is made again at once; a Settings tool's claim gets
  the lasting notice that the tool may not have taken effect. `cycle()` yields before it claims
  (and again after a share settle or recovery write), so no claim is held across that first hop.
  `settleShare` reads the new file's backup first, then switches paths, base, backup,
  `ownApplied` and clears `sharing` in one step.
* **Pending log.** Given up past `PENDING_MAX` (20,000) actions or `LOG_HELPERS_MAX` (64,000)
  helper entries held by roster observations (`slot.logHelpers`, kept by `confirmLog` /
  `clearLog`), so a persistent save failure cannot reach QuickJS's 256 MiB limit.
* **Load.** Every load marks the game dirty, so it is saved within the 2 s debounce: on a VM
  restart the old VM's `close()` write may land just after the new VM's read, and that first
  save's compare-and-swap merges it back in. The writer ids this window's VMs used are kept in
  herdr's shared map under `creaseworks.writers` (`WRITERS_KEY`, last 8; shared.json is per herdr
  home and herdr runs one process per home), so that write is not "another window" (r2-09). A
  `location.json` pointing at a missing shared file loads this window's own save with a notice and
  creates nothing at that path (r2-07); joined to another load notice it uses the short form
  "Shared save not found; using this window's own." so the whole notice fits the banner's 140
  graphemes (`NOTICE_MAX`, `goneJoined`). Shared paths may be Unix, drive-letter or UNC paths
  (`isAbsolutePath`, r2-10). Damaged copies are renumbered on a shift, reason suffixes kept (r2-11).
* **Album memo** (`engine/view.js`), like the helper index and the digest cache: registry symbols
  (`creaseworks/album-memo`, `creaseworks/album-count`), non-enumerable, each entry tagged with the
  module generation (a memo from another generation is rebuilt), and the first set drops an older
  build's per-generation symbols, so a hot reload never leaves a memo behind on the state.

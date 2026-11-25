# herdr host API for a game mod — verified against source

Source: herdr-app v0.1.18, commit `a2e8e3f` (read-only clone). Every path below is
relative to the herdr-src root. **V** = verified in source (the cited lines do it).
**I** = inferred (reasoned from the cited code, not directly exercised). **D** = stated
only in docs (`defaults/AGENTS.md`, `defaults/herdr.d.ts`), no implementing code found.

`defaults/herdr.d.ts` is compiled into the binary and written to the app home on every
start (`src/mods.rs:863` `DECLARATIONS = include_str!("../defaults/herdr.d.ts")`,
`src/mods.rs:83`), so it is the version-matched contract, but several of its comments
disagree with the code (see "Doc/code discrepancies").

---

## 1. Where the `herdr` module is built

- One `HostModule::new("herdr")` per mod copy: `src/mods.rs:1115-1371` (`fn module(inst, copy)`). **V**
- Each copy gets its own policy: `src/mods.rs:1454-1476`. localStorage file is
  `<appHome>/data/<inst.name>/store.json` when props are null, else
  `store-<DefaultHasher(props JSON)>.json`; the directory is created on load
  (`src/mods.rs:1459-1468`). **V**
- Capabilities: read roots = home; write roots = app home; exec + network unrestricted;
  storage + clipboard on (`src/mods.rs:1407-1421`). **V**
- `appHome()` = `$HERDR_APP_HOME`, else `$XDG_CONFIG_HOME/herdr-app`, else
  `~/.config/herdr-app` (`src/mods.rs:60-63`). **V**
- Sync host functions throw a JS exception on `HostError`; async ones reject. Argument
  conversion: `undefined`→`null`; functions throw `"a host function cannot be passed a
  callback; host calls take and return plain data only"`; nesting > 16 throws `"a host
  argument may not nest more than 16 levels deep"`; arrays > 10 000 items throw `"array has
  N items, over the 10000-item bridge limit"`
  (`vendor/gpui-kit/crates/shell/src/engine/quickjs/host_modules.rs:79,86,103-111,376-430`). **V**
- Numbers going host-side: integral & `|n| < 9e15` → i64; other finite → f64; **NaN/±Infinity
  → `null`** (`src/mods.rs:849-860`). **V** (matters for `setShared`).
- Objects returned to JS are fresh ordinary objects/arrays
  (`.../host_modules.rs:441-463`). **V**

### Complete function table (registration lines)

| JS name | sync/async | Line | Notes |
|---|---|---|---|
| `exec(cmd, args?, {cwd,on,timeout})` | async | `src/mods.rs:1132` | default 30 s (`EXEC_LIMIT`, :871), cap 600 s (:872), 8 MiB output (:873); bad timeout → `"timeout must be a positive number of milliseconds"` (:880) |
| `readTextFile(path,{on})` | async | `:1137` | 1 MiB limit `src/mod_files.rs:8`; null if absent |
| `writeTextFile(path,text,expected)` | async | `:1149` | compare-and-swap, see §9 |
| `hc(args)` | async | `:1155` | |
| `checking()` `home()` `appHome()` `fonts()` `updates()` `telemetry()` `themes()` | sync | `:1159-1168,1255` | |
| `playSound(s)` | sync | `:1259` | `src/sound.rs:30-50`; **not** gated by `sounds.enabled` |
| `run(name,args)` | sync | `:1263-1278` | see §6 |
| `spaces() machines() agents() panes()` | sync, tracked | `:1279-1282` | live-read tracked (§10) |
| `setAgentOrder(list)` | sync | `:1283` | global, last call wins |
| `setWindowTitle(t)` / `setBadge(t)` | sync | `:1287,1295` | global, last call wins; badge macOS only `src/badge.rs:1-24` |
| `terminals() focused() layout()` | sync, tracked | `:1303-1305` | |
| `layouts()` | sync | `:1306` | `src/window.rs:187-197` |
| `commands()` | sync | `:1307` | app commands only |
| `window()` | sync, tracked | `:1317` | |
| `theme()` `settings()` | sync, **not** tracked | `:1318-1319` | refresh via theme change path (§10) |
| `keys()` | sync | `:1320` | `src/keys.rs:84-104` |
| `openOverlay(spec)` / `closeOverlay(id)` | sync | `:1324,1338` | |
| `notify(n)` | sync | `:1342-1347` | see §7 |
| `placement()` | sync, tracked (`floats`) | `:1348-1352` | null unless props has `float` |
| `props()` | sync | `:1353` | |
| `shared(k)` / `setShared(k,v)` | sync | `:1354,1358` | §10 |
| `watchFolder(dir)` | cancellable async | `:1362` | |
| `nextCommand()` | async | `:1366-1369` | rejects `"herdr-app is shutting down"` |

---

## 2. `agents()` — exact shape (V: `src/window.rs:1972-1981`)

Built in `publish()` by walking **model panes only**: `for pr in &m.spaces / for ctx in pr.tabs
/ for p in ctx.root.panes()`, skipping mod panes, and pushing an entry only when
`m.status(addr)` is `Some` (`src/window.rs:1950-1982`).

| Field | Type | Source |
|---|---|---|
| `address` | string (`"t7"` local, `"<machine>/t7"` remote) | pane's terminal |
| `pane` | string pane id (remote ids are `<machine>/`-prefixed, `herdr.d.ts:104`) | |
| `space`, `space_name` | string | `m.space_name(pr, &home)` |
| `tab`, `tab_index` (1-based), `tab_name` | string, number, string | `ci + 1`, `Model::tab_name` |
| `pane_name` | string \| null | pane `title` (pane.rename) |
| `status` | `"working"\|"blocked"\|"done"\|"idle"` | `Model::status`, §4 |
| `app` | string \| null | 7501 report `app` |
| `program` | `Program` object | `program_of(report, running_argv)` `src/window.rs:5587-5591` |
| `title` | string | TerminalView title, else core title (spinner glyph prefix stripped, `src/terminal.rs:1357-1367`) |
| `seq` | number | bumped on every word change `src/model.rs:545-547` |
| `pinned` | bool | label `herdr.pinned` non-empty |
| `focused` | bool | focused pane in the active space |

Consequences (V unless marked):
- Order is model order: space → tab → pane, across **all** spaces and machines (`src/window.rs:1950-1952`).
- A terminal that never sent an OSC 7501 word is **not** an agent (`status()` returns None when `word` is None, `src/model.rs:598-600`).
- **Paneless sub-agents are NOT in `agents()`** (only model panes are walked). A sub-agent given a pane (`terminal.keep`) **is** (comment confirming: `defaults/mods/agents/main.js:54-56`).
- Terminals shown only in a layout `{terminal}` block or an overlay window are not in `agents()` (not model panes) — I.
- `Program` fields: `key, name, icon, tint, tile, color, shell, agent` (`defaults/herdr.d.ts:163-175`). D (built by `crate::programs::of`).

## 3. `terminals()` — exact shape

Pipeline: core event stream → `EventLines` (`src/hc.rs:33-196`) → `live_for()` keeps only
`state == "live"` (`src/hc.rs:75-78`) and rewrites `parent` (`src/hc.rs:82-104`) →
`terminals_listed()` rewrites each record (`src/window.rs:2301-2327`) → `publish_terminals`
adds `selection` (`src/mods.rs:673-682`).

| Field | Type | Status |
|---|---|---|
| `address` | string, `"t7"` or `"<machine>/t7"` | V (used everywhere; remote e.g. `peer.test/t7` `src/terminal.rs:2897`) |
| `state` | always `"live"` here | V `src/hc.rs:76` |
| `status` | **raw 7501 word** string (`working`, `blocked`, `idle`, `done`, `error`, ...) or `null` — NOT the derived status | V `src/window.rs:2306-2308` (`report.state`, or the report itself if it was a string) |
| `report` | the core's original status object, e.g. `{state, app, ...}` or null | V `src/window.rs:2306,2310`; shape `{"state":"working"}` `src/hc.rs:615` |
| `program` | `Program` | V `src/window.rs:2309` |
| `title` | string, spinner prefix stripped | V `src/window.rs:2312-2314` |
| `parent` | string \| null/absent | V; see below |
| `labels` | object: `herdr.space`, `herdr.tab`, `herdr.seen` (string number), `herdr.pinned`, `herdr.right-click`, `where` (`"<space> / <tab>"`) | V `src/window.rs:2349-2350,2431-2447,2018-2079`; `docs/labels.md` |
| `turn` | number: core counter, +1 each time the terminal **stops working** | V read at `src/window.rs:2349`; meaning `docs/labels.md:18` |
| `keep` | bool | V `src/window.rs:2458` |
| `cols`, `rows` | numbers | V `src/hc.rs:184`, `src/window.rs:1600-1601` |
| `foreground` | `{cwd, argv, ...}` (removed when finished) | V `src/window.rs:2529-2531,5572-5574` |
| `pid` | number \| null | V `src/window.rs:2363` |
| `cwd`, `argv`, `name` | string / array / string | V read at `src/window.rs:2493,5573,2880,2389` |
| `template` | string | D (`herdr.d.ts:253`; used by `defaults/mods/agents/main.js:206`) |
| `records`, `reported` | from `status` events | V `src/hc.rs:179` (meaning unknown) |
| `created_ms` | number | V `src/window.rs:138` |
| `selection` | `{start:{row,col}, end:{row,col}}` \| null | V `src/mods.rs:673-693` |

**Parent address format** (V `src/hc.rs:82-104`, doc `defaults/AGENTS.md:164-167`):
- prefix equals this core's id/name → bare id (`"t3"`);
- prefix matches a known machine `name`/`id`, or exactly one machine `host` → `"<name>/t3"`;
- otherwise left as the core reported it (`"<host>/t3"`), which will not match any `address`.

**What is in `terminals()`**: every live core terminal the local stream describes — including
terminals of other apps and paneless sub-agents (`herdr.d.ts:253`, `defaults/AGENTS.md:1203`).
Herdr only places terminals carrying `herdr.space` (`src/window.rs:2431-2447`). I: to find a
game helper's sub-agents, walk `parent` links from addresses in `agents()`.

## 4. How status is derived; when `done` becomes `idle`

Raw word per terminal: `report.state` (`src/window.rs:2340`). Model rules (V `src/model.rs`):

```rust
// src/model.rs:598-606
pub fn status(&self, address: &str) -> Option<&'static str> {
    let a = self.agents.get(address)?;
    Some(match a.word.as_deref()? {
        "working" => "working",
        "blocked" | "error" => "blocked",
        _ if a.seen_turn.map_or(!a.seen, |s| a.turn > s) => "done",
        _ => "idle",
    })
}
```

- `set_word` (`src/model.rs:531-549`): new entries start `seen: true`; entering
  `working`/`blocked` sets `seen = true`; leaving a busy word sets `seen = looking`.
  So an agent first observed idle is `idle`, not `done`.
- `looking` = address in `visible_addresses()` **and** the OS window is active
  (`src/window.rs:2342`, `1477-1486`). Visible = drawn panes of the shown tab, layout terminal
  blocks, overlay terminals, and the agent block's agent.
- If label `herdr.seen` exists, it decides: `done` iff `turn > herdr.seen`
  (`src/window.rs:2349-2351`, `src/model.rs:590-595`). Herdr writes `herdr.seen=<turn>` for
  every visible agent once per turn while the window is active (`src/window.rs:1717-1749`).
- Any other client looking turns `done` → `idle` everywhere; "mark unread" (`turn-1`) turns it
  back to `done` (`docs/labels.md:16-49`, test `src/model.rs:1063-1080`).
- **Watching an agent finish goes straight `working → idle`** (test `src/model.rs:1056-1059`).
- Priority/rollup: blocked 4 > done 3 > working 2 > idle 1 (`src/model.rs:97-106`).
- Latency: core events are drained every **500 ms** (`src/window.rs:811`); `poll()` runs every
  **400 ms** (`src/window.rs:665-671`).
- Herdr's own alert (sound if `settings.sounds.enabled`, toast unless looking) fires on
  blocked/finished for terminals **with a pane, not sub-agents** (`src/model.rs:553-573`,
  `src/window.rs:2379-2414`). Its toast: title `"<name> needs you"` (level `error`) or
  `"<name> finished"` (level `info`), body `"<space> / <tab>"`, action
  `{name:"agent.focus", args:{terminal}}` (`src/window.rs:2405-2413`).

**Robust "task finished" signal (I):** `terminals()[i].turn` increases exactly when the
terminal stops working, regardless of whether anyone looked. Reward = `turn` delta per
address; dedupe by storing the last credited `turn` per address in the save.

## 5. Sub-agents

- Defined by core `parent` (`defaults/AGENTS.md:164-169`). V: alerts skip them
  (`src/model.rs:568-573`, `src/window.rs:2344`).
- Not in `agents()` unless kept (§2). Their raw word is in `terminals()[i].status`; the shipped
  list maps `error→blocked`, `done→idle` for paneless kids (`defaults/mods/agents/main.js:57-61`).
- Herdr labels each with `where = "<space> / <tab>"` of its nearest placed ancestor
  (`src/window.rs:2030-2044`, max 32 hops).
- Display name used by the shipped list: `k.name || k.template || k.program?.name || k.address`
  (`defaults/mods/agents/main.js:206`).
- Root of a chain: `root_agent` follows `parent` while the parent is live, up to 32 hops
  (`src/window.rs:1498-1508`).

## 6. Commands for "open this agent"

`run()` from a mod (V `src/mods.rs:1263-1278`): if the name is an app command, args are
validated **synchronously** (`src/commands.rs:133-151`) and a failure **throws** in JS, e.g.
`"pane.focus: unknown argument(s): term; valid arguments: pane, terminal"` or
`"<cmd>: argument terminal must be a string (or null to omit it)"`. Otherwise the request is
queued (`src/mods.rs:588-591`) and run later with `person = true`; any later error becomes a
toast titled `"<name> failed"`, level `error` (`src/window.rs:3062-3072`). `run` returns `null`;
results never come back to the mod.

| Command | Args (`src/commands.rs`) | Behaviour (V) |
|---|---|---|
| `pane.focus` | `pane?`, `terminal?` (:61) | If no `pane` and a **visible layout terminal block** shows that terminal, focuses that block. Else resolves `pane` or `pane_of(terminal)`; fails `"no such pane"`; `focus_pane` → `select_tab` → selects the tab **and its space** and unsettles it (`src/window.rs:3349-3371`, `src/model.rs:463-469,509-514`). |
| `agent.focus` | `terminal` (req, :76) | Fails `"no running terminal \"tX\""` if not live. `focus_agent`: if the terminal has a pane → `focus_pane` (same as above) and sets the shown agent; a **paneless** sub-agent only becomes the agent shown by an `{ "agent": "focused" }` block — nothing visible otherwise (`src/window.rs:3544-3550,1488-1495`). Herdr's own toasts use this. |
| `terminal.peek` | `terminal` (req, :65) | Fails `"no running terminal \"tX\""` if not live. Closes any previous peek and opens overlay id `"terminal-peek"`: **dialog**, 0.8 × 0.8 of the window, column of `peek` mod (34 px, props `{terminal}`) + terminal block (`src/window.rs:3473-3479,4105-4119`). Dialogs take the keyboard (`src/window.rs:333-337`). |
| `terminal.keep` | `terminal`, `place?` | gives a paneless terminal a pane (:45) |
| `space.select` / `tab.select` | `index`/`id` | not needed: `pane.focus` already selects both |

Recommendation (V by the shipped list, `defaults/mods/agents/main.js:169-171,202,320,364`):
agent with a pane → `run("pane.focus", { pane: a.pane })` (or `{terminal}`); paneless
sub-agent → `run("terminal.peek", { terminal })`.

Also: with a layout **terminal block** focused, implicit pane commands fail with
`"a terminal layout block is focused, not a pane; focus a pane or pass an explicit pane id"`
(`src/window.rs:3107-3113,5405-5412`). `pane.focus` is not affected.

## 7. `notify()`

- Implementation (V `src/mods.rs:1342-1347`): new id `"o<N>"` (`src/mods.rs:818-823`), queues
  `OpenOverlay {kind:"toast", notification: n}`. **No validation, no rate limit, no sound.**
- `open_overlay` (V `src/window.rs:3989-4103`):
  - drawn by the layout root's `"toast"` mod if it has a view, else `toast` (`:3974-3982`);
  - props = the notification object + `overlay: id` (+ `fitHeight` for the bundled toast) (`:4012-4024`);
  - size 340 px wide; height fits content (≤ 0.85) for the bundled toast, else `height`/72 (`:4028`);
  - **default timeout 5000 ms; 8000 ms for `level` `"error"` or `"warning"`** (`:4043-4046`);
    `timeout` is ms as f64; 0/negative/NaN → expires at once (`timeout as u64`, `:4071`),
    closed by `poll()` (≤ 400 ms, `src/window.rs:4323-4326`). There is no "sticky" value.
  - toasts stack bottom-right in a scrollable column, unbounded count (`src/window.rs:5027-5064`).
- Bundled toast mod (V `defaults/mods/toast/main.js`): `icon` → `image(p.icon)` 18×18 full colour
  (path relative to app home), else an 8 px dot coloured by level
  (`error→blocked, warning→working, success→done, info→accent`, :9,34); title one line
  truncated, body first line (unless `fitHeight`); **click anywhere runs
  `run(action.name, action.args ?? {})` then closes** (:30-33).
- Sound: only `alert()` (Herdr's agent alerts) and `playSound` play sound
  (`src/window.rs:2380-2382`, `src/sound.rs:30`). `notify` never does.

## 8. `theme()` and `settings()`

`theme()` = `serde_json(settings::theme())`, a `BTreeMap<String,String>` (V `src/mods.rs:1318`,
`src/settings.rs:301,696-700`). Keys produced by `resolve()` (V `src/settings.rs:306-363`):

`background, terminal_foreground, foreground, surface, canvas, chrome, popover, raised, hover,
selected, border, input, muted, dim, accent, accent_foreground, solid, solid_foreground, ring,
selection, cursor, working, blocked, done, idle, unknown, ansi0 … ansi15`, plus any override
key from layout/settings `colors` (`:359-361`).

- Values are `#rrggbb` except dark/light `hover, selected, border, input` which are
  **`#rrggbbaa`** (e.g. dark `"#ffffff0e"`, light `"#0000000c"`) (`:315-326`). Overrides may also
  be 8-digit. So `t.x + "26"` is only safe for colours known to be 6-digit.
- `working/blocked/done` default to ansi 3/1/4 (`:310`); `idle`/`unknown` = mix(bg,fg,0.38).
- Mod colour arguments accept only `#rgb`, `#rrggbb`, `#rrggbbaa`; names are rejected with
  ``"`accent` is not a color value; pass a color from `cx.theme().colors` or a #rgb, #rrggbb, or #rrggbbaa literal"``
  (V `vendor/gpui-kit/crates/shell/src/value.rs:83-131`). Layout JSON, unlike JS, accepts theme names.

`settings()` = `Settings` (V `src/settings.rs:490-531`): `font_family, font_size, font_weight,
font_weight_bold, font_ligatures, terminal_line_height, terminal_cell_width,
terminal_scroll_speed, ui_font_family, ui_font_size, zoom, theme, theme_light, theme_dark,
dark (bool: window dark now), colors, pane_scrollbars, terminal_padding, terminal_opacity,
clipboard_write, copy_on_select, minimum_contrast, option_as_alt, sounds {enabled, done?, blocked?}`.

## 9. Files: `writeTextFile` / `readTextFile` (save file)

V `src/mod_files.rs:47-98`:
- Text > 1 MiB → `"Text file exceeds 1 MiB"`.
- `expected` must equal the current content (absent = `null`), else
  `"The file changed outside Herdr. Reload before saving; your draft is still here."`
- `expected === null`: `create_new` (fails if the file exists, OS error text) — **not atomic**
  (a crash mid-write can leave a partial file).
- `expected` string: writes `.herdr-app-write-<nanos>` beside the target, re-checks, then
  `rename` — atomic replace; re-check failure: `"The file changed while saving. Reload before saving."`
- Serialised only by an **in-process** mutex (`WRITES`, `:9`); no cross-process lock. I: the
  re-check before rename narrows but does not close a race between two processes.
- No path restriction in `writeTextFile` itself (the `fs/promises` write root is the app home,
  `src/mods.rs:1414`). `readTextFile` returns `null` when absent, rejects non-regular files.
- One herdr-app process per app home: a second launch raises the running window
  (`src/main.rs:126-127`, `src/control.rs:59-70`). I: "two windows" sharing one save means two
  app homes (or two copies of the mod in one window); only the latter shares the in-process mutex.

## 10. Re-render rules, `shared`, `setShared`

- Tracked live data: `layout, spaces, machines, agents, panes, terminals, focused, floats
  (placement), window` (`src/mods.rs:612-622`). Each `publish_*` bumps a per-key revision only
  when the JSON value changed (`src/mods.rs:635-641`).
- A copy records every key it **ever read** (render, callbacks, child views) and is refreshed
  when any of those revisions moved (`src/mods.rs:728-782`; comment `:775`). Reading
  `terminals()` once subscribes the copy to every terminal-list change for its lifetime.
- `terminals` changes on any core terminal event: created, removed, status, turn, title,
  labels, keep, size, foreground (`src/hc.rs:153-189`), plus selection (`src/mods.rs:684-693`).
  Output alone does not change it (`src/mods.rs:683`).
- `agents/spaces/panes/focused/...` are republished on `publish()` (`src/window.rs:1932-2011`):
  after listings, focus changes, title changes (`src/window.rs:1605`), etc.
- `panes` also bumps on scroll-state transitions (`src/mods.rs:659-661`, `src/window.rs:1606-1609`).
- `window` republished when active/visibility changes (`src/window.rs:4328-4340,624-630`).
- Theme/look change → `mods::apply_theme` + **refresh of all copies** (`src/window.rs:963-969`).
  Appearance flip re-applies the look (`src/window.rs:4343-4346`).
- `setShared(k, v)`: no-op if equal; else stores, sends the whole map to a background writer
  (atomic write of `shared.json`, newest snapshot wins) and **refreshes every mod copy**
  (`src/mods.rs:489-493,544-556,568-581`, `src/window.rs:4196`). `shared.json` is loaded once
  per process (`src/mods.rs:495-497`); corrupt → renamed `shared.json.corrupt-<time>`
  (`src/mods.rs:516-531`). Update-status changes also refresh all mods (`src/window.rs:4303-4307`).
- `cx.notify()` re-renders only that copy (`defaults/AGENTS.md:1300-1301`). D.

## 11. Keys: `keys.json` → `nextCommand()`

- Sections: `global`, `terminal`, `layout:<name>`, `mod:<name>`; anything else is an error
  `"unknown section ..."` (V `src/keys.rs:112-126`). `layout:<name>` matches the layout file
  stem **exactly** (KeyContext `layout = <layout_name>`, `src/window.rs:5695`); `mod:<name>`
  applies while focus is inside that mod's element (`src/window.rs:4754`).
- String action validity (V `src/keys.rs:151-157`): an app command (`name` or `name:value`),
  `terminal`, `send:...`, or `<mod>.<command>` (non-empty both sides).
  **`"<mod>:<command>"` is invalid** (no dot before the colon).
- Object bindings must name an **app** command (`src/keys.rs:66-81`) — mod commands only as strings.
- A `<mod>.<cmd>` whose mod folder is missing is silently dropped (`src/keys.rs:141-147,210-212`).
- Dispatch: `run_as` → not an app command → `split_once('.')` → `mods::send_command(mod, rest)`
  (V `src/window.rs:3096-3105`). `"game.buy:3"` therefore delivers the string `"buy:3"`. I.
- `send_command` delivers to **every shown copy** of that mod; a hidden-but-alive copy gets
  nothing (V `src/mods.rs:785-799,600-605`). If none is shown the command fails with
  `"unknown command \"<name>\": see \`herdr-app commands\`; a mod's are <mod>.<command> and need the mod loaded"`
  → toast `"<name> failed"`.
- Each copy has an **unbounded** queue (`src/mods.rs:1124-1128`): commands sent while the mod
  is not awaiting `nextCommand()` are buffered, not lost. I.
- `"focusable": true` copies receive `"focus"` via `send_command_to` (`src/window.rs:3866`).
- Global bindings beat the terminal unless the `terminal` section rebinds the key (`src/keys.rs:106-126`).
  Errors in keys.json go to `keys.error` (`defaults/AGENTS.md:55-57`); escape hatch
  `ctrl-alt-shift-escape` is reserved (`src/keys.rs:25,214-217`).

## 12. `mod.json` — every field the code reads

| Field | Read by | Semantics |
|---|---|---|
| `place` | `src/mods.rs:351-352`, `src/window.rs:4520-4529,5497-5516` | First sighting docks one copy: `left/top` first, `right/bottom` last, wraps root if axis differs. **Absent ⇒ `"right"`.** Skipped while a shipped layout is shown (without marking seen); `"none"` never docks. Seen list in `seen.json`. V |
| `size` | `src/mods.rs:353-354`, `src/window.rs:4527` | px, default 320. V |
| `focusable` | `src/mods.rs:355-357`, `src/window.rs:3879` | `pane.go` may focus it. V |
| `link_handlers` | `src/mods.rs:359-375,407-420` | rules; requires `link.js`. V |
| `overlay` | `src/window.rs:5439-5442,3683-3695,3968` | object merged into the overlay spec for `mod.open {name}` (id `"mod-<name>"`, toggles) and terminal menus. V |
| `palette` | `defaults/frame/palette/main.js:82-110,114-140` | `[{title, command, args?, group?, words?}]`; mod commands must be `<this-mod>.<cmd>` with no args; group defaults `"Mod"` (`"Recent"` reserved). V |
| `cloned_from` | written by `mod.clone` `src/mods.rs:266-272` | |
| `title` | present in shipped `mod.json` files; **no reader found** in `src/`, shell or frame mods (grep). I: unused. |

Invalid JSON in `mod.json` is ignored for hints (`src/mods.rs:410`) unless the mod handles links.

## 13. What people see: names in Keys overlay, Settings, palette, toasts, errors

| Surface | Shows | Source |
|---|---|---|
| Keys overlay (`app.help`, dialog 640×520, mod `help`) | `keys` + `"  (<section>)"` when not global, e.g. `alt-g  (layout:Name)`; label = action with `.` and `_` → spaces (`"my-game.collect"` → `"my-game collect"`); mod commands land in the catch-all group `window` | `src/window.rs:3753-3761`, `defaults/mods/help/main.js:8-22,83-84` |
| Settings → Look layout cards | raw layout file stem (`LOOKS[name] ?? name`), 124 px card; picture = root `"preview"` path (relative to app home) else a generic frame | `defaults/frame/settings/main.js:18,85-96,277,298,307-318` |
| Command palette | `"Layout: " + first letter upper-cased + rest` (`Name`), words `"look <name>"`; mod palette entries searchable by mod folder name | `defaults/frame/palette/main.js:154-158,137` |
| Layout list order | `main` first, then alphabetical; layouts whose mods are missing are hidden | `src/window.rs:187-197` |
| Startup with missing mods | toast `"<Name> needs mods that aren't here"`, body `"Showing Herdr instead. Missing: <mods>. Your <Name> layout file is still there."`, 12 s | `src/window.rs:650-663` |
| Invalid layout | `layout.error`: `"layouts/<Name>.json was not applied: <msg>"` | `src/window.rs:1076-1080` |
| Mod fails to load | in its block: `"<mod> did not load:\n\n<error>\n\nFix the files; Herdr retries on save."` (blocked colour); `herdr-app status`: `"mod <mod>: <error>"` | `src/window.rs:4781-4788,4225` |
| Hot reload fails | old view keeps running; error only in `copy.error` → `herdr-app status` (no toast) | `src/window.rs:4407-4417,4751-4752` |
| Failed command | toast `"<command> failed"` + error, level error | `src/window.rs:3069-3072` |
| Link handler error | toast `"Link handler <mod> failed"` | `src/window.rs:2281` |
| Layout switch name check | `valid_name`: ASCII letters, digits, `-`, `_` (upper case allowed) | `src/mods.rs:219-221`, `src/window.rs:1086` |
| Mod data dir | `data/<mod folder>/` | `src/mods.rs:1459` |

## 14. Other verified behaviours relevant to the game

- **Top-level view `init(props, cx)` receives `undefined` as props** (first load and hot
  reload call `initialize(&object, None)`) — always read `props()` from `"herdr"`
  (`vendor/gpui-kit/crates/shell/src/engine/quickjs/mod.rs:2546,3158,3237-3251`). V
- Hot reload constructs a **new** instance and runs `init` again; the old object is replaced
  (`vendor/gpui-kit/crates/shell/src/watch.rs:521-584`, `view.rs:170-173`). I: old instance
  fields are lost; `close()` is not called on reload (not seen in this path).
- Script budgets: render/layout **50 ms**, event/task **500 ms**, detached (outside a scope)
  **5 s** (`vendor/gpui-kit/crates/shell/src/engine/quickjs/sandbox.rs:435-444,513-519`). V
- Window VM is restarted when memory use ≥ 75 % (`RESTART_MODS_AT`, `src/window.rs:304,4395`);
  toasts close, copies reload fresh (`src/window.rs:4440-4470`). V
- Overlay `kind`: unknown → dialog; dialog/popup take the keyboard; window does not
  (`src/window.rs:3990-3995,333-337`). Default dialog size 420 × 0.85 (`:4032`).
- `openOverlay` without `mod` string or `layout` object throws
  `"openOverlay needs { mod: \"<folder>\" } or { layout: {...} }"` (`src/mods.rs:1331-1333`).
- Overlay copies get `props.overlay = id` before load, so their localStorage file depends on
  the overlay id (`src/window.rs:4020`, `src/mods.rs:1461-1467`). I.

---

## Doc/code discrepancies

1. `herdr.d.ts:502` says keys bind `"<mod>:<command>"`; code requires `"<mod>.<command>"` (`src/keys.rs:151-157`). Use the dot.
2. `herdr.d.ts:86` "agent.focus {terminal} (sub-agents too)": for a paneless sub-agent it only changes an `agent` block; use `terminal.peek`.
3. `mod.json` `place` default is `"right"` (`src/window.rs:4520`), not documented.
4. `theme()` doc list omits `terminal_foreground`, `cursor`, `ring` (present `src/settings.rs:329,345,347`).
5. `defaults/AGENTS.md:1063` shows `init(props, cx)`; for top-level views props is `undefined`.
6. Module evaluation budget is 5 s when detached (`sandbox.rs:441`); the project rule of 500 ms is stricter — keep it.

## Implications for our game

**Do**
- Name the mod folder in lower-case-hyphen (`valid_name`, `data/<mod>/`, `mod:<mod>`, error texts) and the layout `layouts/<Name>.json` (shown raw in Settings, `"Layout: <Name>"` in the palette, `layout:<Name>` in keys, `"<Name> needs mods…"` toast).
- Put `"place": "none"` in `mod.json`, or Herdr docks a copy at the right edge of the person's own layout the first time it sees the folder.
- Give the layout root `"preview": "layouts/<Name>.png"` (or .svg) so Settings shows a picture.
- Read helpers from `agents()` (pane agents, derived status) **and** `terminals()` (paneless sub-agents via `parent`, raw word, `turn`). Treat `error` as blocked; never show `done` for paneless sub-agents (match the shipped list).
- Detect "task finished" via `turn` increases per address (store last credited turn in the save); don't rely on seeing `done`, which skips to `idle` when the person is watching.
- Key every helper by `address` (string, may contain `/`); store maps keyed by address in null-prototype objects.
- "Needs you" click: `run("pane.focus", { pane })` for agents; `run("terminal.peek", { terminal })` for paneless sub-agents. Check `terminals()` liveness first; failures show a toast, not an exception.
- Validate `run` args statically (only listed names, target ids as strings) — wrong args throw synchronously.
- Use `notify({title, body, level:"info"|"success", timeout, action})` sparingly; we must implement the 3/day cap ourselves (Herdr has none). Never call `playSound`.
- Keyboard: bind `"<mod>.<cmd>"` strings under `layout:<Name>` (not `global`) so other layouts and terminals keep their keys; parameters may ride as `"<mod>.<cmd>:<value>"`.
- Save with `writeTextFile(path, text, expectedPreviousText)` (atomic rename + compare-and-swap); handle the two documented rejection strings by re-reading and merging; write `.bak` separately. Use `readTextFile` (null = absent). Keep files < 1 MiB.
- Use `props()` (not `init`'s argument); make `init` idempotent and restore state from storage on every load (hot reload runs `init` on a fresh instance).
- Use 6-digit hex literals for our palette; when tinting theme colours check the length before appending alpha.

**Don't**
- Don't expect paneless sub-agents in `agents()`, or derived `done/idle` in `terminals().status`.
- Don't call `setAgentOrder`, `setWindowTitle`, `setBadge` (global, last caller wins; would fight the shipped agents list / other mods).
- Don't put per-tick state in `setShared` (re-renders every mod + rewrites `shared.json`).
- Don't read `terminals()` in render more than needed: it subscribes the copy to every terminal event (titles, sizes, foreground).
- Don't rely on localStorage for the save (per mod+props file; overlay copies get a different file per overlay id).
- Don't depend on a hidden copy receiving key commands; don't start two tickers when two copies exist (layout block + overlay): elect one.
- Don't use theme names in JS colour calls; don't use `"<mod>:<command>"` keys.

## Open questions

1. Full core terminal record schema (herdr-core is not in this repo): `template`, `name`, `argv`, `records`, `reported` meanings are only known from use sites/d.ts.
2. Does `turn` survive a core restart / "restarted" event (record replaced, same address, `src/hc.rs:157-168`)? A reset would need guarding (e.g. also key by `created_ms`).
3. Is `close()` called on the old instance during hot reload? Not found in `reload()`; assumed no.
4. Which scope phase applies to module evaluation in herdr's `try_load` (5 s detached vs 500 ms event)?
5. Remote machines' terminals in `terminals()`: are terminals not started by Herdr on remote cores forwarded by the local stream? (`src/window.rs:756` comment only says doc events are.)
6. Cross-process save sharing: two app homes means two `data/` folders; sharing needs an agreed absolute path and accepts a residual race in `writeTextFile`.
7. `DefaultHasher` for `store-<hash>.json` is not stable across Rust versions (`src/mods.rs:1464-1467`); a herdr update could orphan props-keyed localStorage.

# Patterns from herdr's shipped mods and JS tests

Source: herdr-app v0.1.18, commit a2e8e3f, read-only clone. Every `path:line` is relative to the herdr-src root.
Nothing was built or run. "Verified" means read in source. "Inferred" means a conclusion drawn from source that was not run.

Scope: `defaults/mods/{agents,workspace-status,terminals-bar,peek,toast,workspace-chrome,win98}`, `defaults/mods/win98/art/*.ts`, `scripts/*.test.ts`. Where it helps, this also covers the sibling mods `tabs`, `pane`, `picker` and `changes` and the shell and host code behind the idioms.

---

## 1. How the mods are put together

| Fact | Evidence |
|---|---|
| Each mod has a `main.js` that default-exports a class extending `View`, plus a `mod.json`. Every mod in scope uses `"place": "none"`, and some add a `title`. | `defaults/mods/agents/mod.json` = `{ "place": "none", "title": "Agents" }`; `terminals-bar/mod.json` = `{ "place": "none", "title": "Terminals tabs" }`; `peek/mod.json` = `{ "place": "none", "title": "Peek" }`; `toast`, `workspace-status`, `workspace-chrome` and `win98` use `{ "place": "none" }` |
| Imports come from three modules: `gpui-kit` (`View, div, svg, image`, plus `PathBuilder, Background`), `gpui-base` (`h_flex, v_flex, ScrollHandle, Scrollbar, v_virtual_list`) and `herdr`. | `defaults/mods/agents/main.js:3-5`, `defaults/mods/win98/kit.js:8-10`, `defaults/mods/changes/main.js:2` |
| **Every import statement is on a single line.** The test harness depends on this, because it strips imports with `/^import .*;\n/gm`. | `scripts/agents.test.ts:5`, `scripts/mod-storage.test.ts:6` |
| **One mod, many roles.** win98 is a single mod. Its layout gives each copy `props.role`, and `main.js` sends each role to a plain class (not a `View`) that has `init`/`render`. | `defaults/mods/win98/main.js:23` `const ROLES = { taskbar: Taskbar, desktop: Desktop, window: PaneWindow, menu: Menu, dialog: Dialog, mines: Mines, sol: Sol, clippy: Clippy };`, `:26-35`; layout props at `defaults/layouts/win98.json:13-16,31-34,65-68,79-82` |
| A single mod can also branch on a prop to draw itself as a popup. | `agents/main.js:86` `if (props()?.sortMenu) return;` and `:224`; the popup is opened by `openOverlay({ mod: "agents", kind: "popup", width: 200, height: 140, props: { sortMenu: true } })` at `:446` |
| Helpers shared between roles live in a plain ES module (`kit.js`) that the role files import with relative paths. | `win98/main.js:13-21` (`import Taskbar from "./taskbar.js";` …), `win98/kit.js` |
| Mods reuse each other's icons by app-root path. | `agents/main.js:164,214` `svg("mods/workspace-chrome/spinner.svg")`; `tabs/main.js:122`; `picker/main.js:129` |
| Asset paths resolve against the app root, not against the calling file. | `vendor/gpui-kit/crates/shell/src/typings.rs:2121-2129`; `win98/kit.js:36` `export const ASSETS = "mods/win98";` |

## 2. Status to colour and icon mapping

Statuses are `export type Status = "working" | "blocked" | "done" | "idle";` (`defaults/herdr.d.ts:101`). `done` "means it finished while you weren't looking; it becomes "idle" once you look" (`defaults/herdr.d.ts:185-186`). Each status has a theme key of the same name: `working`, `blocked`, `done`, `idle` and `unknown` (`src/settings.rs:347-351`). When a palette does not set its own status colours they default to `[ansi3, ansi1, ansi4]`, i.e. working = yellow, blocked = red, done = blue (`src/settings.rs:310`). `idle` and `unknown` are `mix(bg, fg, 0.38)` (`src/settings.rs:350-351`).

### 2.1 What each mod draws (verified)

| Mod | working | blocked | done | idle | Source |
|---|---|---|---|---|---|
| agents (row) | `svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900)` | Pill: `div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26")…text_color(t.blocked)…child("Needs you")` | Filled 7px dot, `bg(color)` | Ring: `div().size(7)…rounded(4).border(1.5).border_color(t.idle ?? t.dim)` | `agents/main.js:212-220` |
| agents (compact: under a "Needs you" header, or in the rail) | same | 14px square with `"!"`, `bg(t.blocked + "26")` | dot | ring | `agents/main.js:211,215` |
| agents (section header) | label in `t[g.status]` | `SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" }` | | | `agents/main.js:67-68,411` |
| pane header | spinner `.spin(900)` | the same "Needs you" pill | `div().size(7).rounded(4).bg(t.done)` | nothing | `pane/main.js:84-86` |
| tabs | spinner | `div().size(6).rounded(3).bg(t[c.status])` | same dot | nothing | `tabs/main.js:122-123` |
| picker | spinner | glyph `"●"` in `t.blocked`, plus the text `"needs you"` | `"●"` + `"finished"` in `t.done` | `"○"` | `picker/main.js:128-131,230-231` |
| peek bar | `.frames(SPIN, 90)` braille spinner | `"●"` + `WORDS.blocked = "needs you"` | `"●"` + `"finished"` | `"○"` + `"idle"` | `peek/main.js:11,17,75,85,88` |
| terminals-bar tile | 11px corner dot `bg(t[p.status])` on any status except idle | same | same | no dot | `terminals-bar/main.js:34,50-51` |
| workspace-status | (total count) | `` `· ${needs} ${needs === 1 ? "needs" : "need"} you` `` in `t.blocked` | | | `workspace-status/main.js:21,26-27` |
| toast | `level` → theme key: `const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };` | | | | `toast/main.js:9,34` |
| win98 tray | `hourglass` badge | `warn-badge` badge, blinking `.loop("opacity", { from: 0, to: 1, period: 900 })` | `check-badge` | none | `win98/taskbar.js:404,420` |
| win98 desktop (space folders) | `hourglass` | `warn-badge`, blinking at 900 ms | `check-badge` | none | `win98/desktop.js:56,76` |

### 2.2 Ranking and aggregation (verified)

- `const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };` (`agents/main.js:53`). Priority sort is urgency first, then most recent change, then `seq`: `list.sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq)` (`agents/main.js:245`).
- A parent agent ranks at the maximum of its own status and its sub-agents' statuses. A sub-agent's `done` counts as `idle` for this, so it does not lift a working parent: `kidRank` (`agents/main.js:242-243`). This is tested in `scripts/agents.test.ts:270-274`.
- Sub-agents without a pane are not in `agents()`. Their status is the raw terminal word, with `error` mapped to `blocked` and `done` mapped to `idle` (`agents/main.js:54-61`):
  ```js
  const kidStatus = (k, listed) => {
    if (listed.has(k.address)) return listed.get(k.address);
    const s = k.status;
    return s === "error" ? "blocked" : s === "done" ? "idle" : s;
  };
  ```
  Tested in `scripts/agents.test.ts:276-283`.
- A folded group shows the colour of its most urgent member, taken with a `reduce` over `RANK` (`agents/main.js:259-261,272,394`).
- Every 30 s the agents mod re-renders to refresh its "how long ago" labels, `cx.timer.every(30000, (cx) => cx.notify())` (`agents/main.js:95`), shown with `duration(ms)` → `"<1m" | "Nm" | "Nh" | "Nd"` (`agents/main.js:70-76`). It stores per-agent change times in `localStorage` under `"changed"` and prunes entries older than 30 days that are no longer listed (`agents/main.js:100-113`).

### 2.3 Translucent tints from theme colours

`t.blocked + "26"` appends an alpha byte (0x26 ≈ 15%) to a theme colour (`agents/main.js:215-216`, `pane/main.js:85`). This is only safe because the status colours are always 6-digit: the host writes them with `fn hex(c: u32) -> String { format!("#{c:06x}") }` (`src/settings.rs:289-291,347-351`). **Some theme keys are already 8-digit**: `hover`, `selected`, `border` and `input` (light: `"#0000000c"`, `"#00000012"`, `"#00000017"`, `"#00000026"`; dark: `"#ffffff0e"`, `"#ffffff17"`, `"#ffffff18"`, `"#ffffff24"`, `src/settings.rs:313,316-322`). Layout `colors` overrides may replace any key with `#rrggbb` or `#rrggbbaa` (`src/settings.rs:300,358-360`). Appending alpha to one of those keys gives an invalid 11-character colour. That last step is inferred: `parse_hex` was not traced, but a colour that fails to parse paints magenta, "magenta if missing, so mistakes show" (`src/settings.rs:702-705`).

## 3. Names, truncation and emoji

| Fact | Evidence |
|---|---|
| Shipped mods **never cut names in JS**. They rely on native `.truncate()`, usually with `max_w(n)`/`min_w(0)`/`flex_1()`. | `agents/main.js:207,372-373,411`; `terminals-bar/main.js:130-132,159`; `peek/main.js:87,89`; `toast/main.js:19,42`; `win98/kit.js:268-275`; `tabs/main.js:121`; `pane/main.js:82-83` |
| `.truncate()` is `self.overflow_hidden().whitespace_nowrap().text_ellipsis()`. | `vendor/gpui-pre/src/styled.rs:139-141` (gpui-pre is patched to this vendor copy at `Cargo.toml:78-80`) |
| GPUI's end truncation walks **`char_indices()` (Unicode scalars), not grapheme clusters**, then slices `line[..truncate_ix]` and trims trailing whitespace and ASCII punctuation. | `vendor/gpui-pre/src/text_system/line_wrapper.rs:221-232,337-340` |
| ⇒ Inferred: native truncation can split a ZWJ sequence (`👨‍💻` → `👨…`), a flag (`🇰🇷` → `🇰…`) or a skin-tone modifier. No shipped code protects against this. | Inferred from the two rows above |
| JS-side cleaning of agent titles is emoji-aware. It removes a leading status glyph or spinner but keeps a user's leading emoji, using Unicode property escapes with the `u` flag. | `agents/main.js:28-32` (verbatim below); `tabs/main.js:14` uses the same logic |
| Unicode property escapes (`\p{L}`, `\p{N}`, `\p{Ps}`, `\p{Pi}`, `\p{Emoji}`, `\p{Emoji_Presentation}`) are used in shipped mod code, so QuickJS-ng supports them. Inferred: the code is shipped, but it was not run. | `agents/main.js:32,49` |
| Tests pin emoji behaviour: 15 emoji, including flags, skin tones, ZWJ, VS16 and keycaps, survive `clean`. | `scripts/agents.test.ts:330-346` (`for (const e of ["🔴", "🟦", "✅", "❌", "⭐", "🚀", "🧠", "⚪", "🇰🇷", "👍🏽", "👨‍💻", "❤️", "⚙️", "#️⃣", "✋🏽"])`) |
| A toast keeps only the first line of a body: `value.split("\n", 1)[0]`, then `.truncate()`. | `toast/main.js:17-19` |
| Counter-example: `changes` cuts long diff lines by UTF-16 code units, `line.slice(0, 4000) + "… (line truncated)"`, which can split a surrogate pair. That is acceptable for diff text but not for names. | `changes/main.js:248` |
| Every agent row has a label fallback chain: `k.name \|\| k.template \|\| k.program?.name \|\| k.address`. | `agents/main.js:207`, `peek/main.js:87` |

```js
// defaults/mods/agents/main.js:32
const clean = (s) => (s ?? "").replace(/^(?:\[ [!.] \] |[✋⏳]️?(?=\s)|(?!(?:\p{Emoji}️|[#*]⃣))[^\p{L}\p{N}\p{Ps}\p{Pi}\p{Emoji_Presentation}])+/u, "").trim();
```

## 4. Handling 30+ rows

| Technique | Where | Notes |
|---|---|---|
| **No virtualisation in the agents list.** Every row is a child of `v_flex().id("ag-list").flex_1().min_h(0)…overflow_y_scrollbar().mode("always")`. | `agents/main.js:455` | Rows have a fixed `h(30)` (agent), `h(26)` (sub-agent or rail) and `h(30)` (header) with `flex_none()` (`:350-352,195-196,309-315,399-400`). |
| Tested at 64 agents. The render must call `panes()` **once** per render. | `scripts/agents.test.ts:150-176` (`Array.from({ length: 64 }, …)`, `expect(reads).toBe(1)`) | The reason is given in a comment: "Read the pane snapshot once: every host read copies the whole list into JS." (`agents/main.js:287`) |
| Read each host list once per render and index it with a `Map`. | `agents/main.js:227-229,288-289` (`this.listed = new Map(list.map(...))`, `const tabs = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, tab]))`) | |
| Folding: per-group and per-parent folds are kept in `this.folded = new Set()`, in memory only. | `agents/main.js:87,254,263-281,392-416` | A folded group shows a count and the most urgent status. |
| Narrow rail mode: with the sidebar under 160px, each row is an index number plus a status icon. | `agents/main.js:17,308-323` | |
| Hard cap: the win98 tray shows `agents().slice(0, 10)`. | `win98/taskbar.js:401` | It drops agents silently, which is **not acceptable** for our game. |
| Real virtualisation: `v_virtual_list(id, count, rowHeight, keyFn, rangeRenderer)` plus `Scrollbar.vertical(id)`. | `changes/main.js:322-324` | Typings: `vendor/gpui-kit/crates/shell/src/typings.rs:3080-3086` (`v_virtual_list`), `:2192-2197` (`list`), `:2216-2221` (`uniform_list`) |
| Virtual-list rows **cannot carry handlers**: "a handler registered inside the item renderer throws". Use `on_item_click(handler: (key, cx) => void)` on the list. | `vendor/gpui-kit/crates/shell/src/typings.rs:1555-1571`, `:2160-2161` ("no handlers and no retained state inside it, and `cx.notify()` is refused there") | |
| Lazy lists need a definite height: "a `flex_1()` chain with no explicit `h(n)` anywhere lays out at zero and draws nothing." | `defaults/AGENTS.md:1132-1137` | |
| `ScrollHandle.new()` + `.track_scroll()` + `scroll_to_item(i)` keeps the active item in view. | `tabs/main.js:33,99,110,147-148`; `defaults/AGENTS.md:1118-1131` | |

## 5. Opening an agent's pane on click

| Action | Code | Evidence |
|---|---|---|
| Agent row (has a pane) | `.on_click(() => run("pane.focus", { pane: a.pane }))` | `agents/main.js:320,364` |
| Kept sub-agent (in `agents()`) | `run("pane.focus", { terminal: k.address })` | `agents/main.js:202`; test `scripts/agents.test.ts:250-251` |
| Sub-agent without a pane | `run("terminal.peek", { terminal: addr })` | `agents/main.js:169-171,202` |
| Any agent by address, sub-agents included | `run("agent.focus", { terminal: a.address })` | `win98/taskbar.js:411`, `win98/clippy.js:52` |
| Peek bar "↗ go to / keep" | `run(home ? "pane.focus" : "terminal.keep", { terminal }); closeOverlay(overlay);` | `peek/main.js:91-98` |

Command signatures (verified, `src/commands.rs`):
- `cmd("pane.focus", &[opt("pane"), opt("terminal")], "Focus a pane (or the pane showing a terminal).")` (`:61`)
- `cmd("terminal.peek", &[req("terminal")], "Peek at a running terminal over the tab, with keep-as-tab and close controls.")` (`:65`)
- `cmd("agent.focus", &[req("terminal")], "Show an agent (sub-agents too).")` (`:76`)

Failure strings: `agent.focus` and `terminal.peek` on a terminal that is not live give `format!("no running terminal {t:?}")` (`src/window.rs:3547,3476`). `agent.focus` focuses the pane if there is one and always sets the shown agent (`src/window.rs:1489-1495`). Herdr's own notifications use `"action": { "name": "agent.focus", "args": { "terminal": addr } }` (`src/window.rs:2411`).

Ordering: the agents mod calls `setAgentOrder(list.map((a) => a.address))` on every render (`agents/main.js:249`). The doc says "Call when rendering the list. The last order stays in memory until another call or app restart." (`defaults/herdr.d.ts:247-251`). `agent.next`/`agent.prev`/`agent.select` use it (`src/window.rs:3551-3575`). Inferred: **a second mod that also calls `setAgentOrder` would overwrite the sidebar's order.**

Click hygiene (verified):
- Nested clickables call `cx.stop_propagation()` so the row's click does not also fire (`agents/main.js:275-276,336-337,366-367`).
- After an action moves the row away from under the pointer, clear hover state manually: "The row moves away from under the pointer, and no hover-out comes." (`agents/main.js:339-341`).
- In draggable bars (`window_drag`), controls stop left and right mouse-down so the window does not drag or open the system menu (`terminals-bar/main.js:55-59`, `workspace-chrome/main.js:30`, `win98/kit.js:139-142`).

## 6. Theming for light and dark

| Pattern | Evidence |
|---|---|
| Call `const t = theme()` at the top of `render` and use only named keys (`t.chrome`, `t.foreground`, `t.muted`, `t.dim`, `t.hover`, `t.selected`, `t.border`, `t.popover`, `t.raised`, `t.input`, `t.surface`, `t.accent`, status keys). | `agents/main.js:223`, `workspace-status/main.js:18`, `toast/main.js:13`, `peek/main.js:67`, `workspace-chrome/main.js:28,33` |
| Doc rule: "Use `theme()` colors so the mod follows the user's theme." The type doc says "Light and dark themes name the same colors, so a mod that uses them follows both." | `defaults/AGENTS.md:1091`; `defaults/herdr.d.ts:341-346` (it lists every key) |
| Layout `colors` overrides apply to both appearances, so the doc says to "name theme colors (`chrome`, `canvas`) rather than writing hex when a layout should work light and dark." | `defaults/AGENTS.md:349-351` |
| The theme object is frozen (`Object.freeze(cachedTheme.colors)` …) and re-parsed only when the revision changes. | `vendor/gpui-kit/crates/shell/src/engine/quickjs/mod.rs:7007-7021` |
| A missing key falls back explicitly: `t[a.status] ?? t.dim`, `t.idle ?? t.dim`. | `agents/main.js:213,218,272,411`, `peek/main.js:85,88` |
| Exception 1: **terminals-bar hard-codes a dark hex palette** (`const C = { tray: "#1d1f22", tab: "#34373c", … }`). Its layout pins `"theme": "graphite"`. | `terminals-bar/main.js:7-17`; `defaults/layouts/terminals.json:6` |
| Exception 2: **win98 ignores `theme()` entirely.** It uses a hex palette `C` in `kit.js` and its layout pins `"theme": "win98"`. | `win98/kit.js:12-32`; `defaults/layouts/win98.json:91` |
| Mods mix theme keys and hex. Transparent colours are written as 8-digit hex, e.g. `"#00000000"` (transparent), `"#ffffff14"`, `"#00008060"`. | `terminals-bar/main.js:42,120`; `win98/desktop.js:48,67` |
| Every colour literal in scope is hex (`#rgb`/`#rrggbb`/`#rrggbbaa`). None uses `rgb()`/`hsl()`. | grep over `defaults/mods/{agents,…,win98}`; the host format is `#rrggbb`/`#rrggbbaa` (`src/settings.rs:300`) |

## 7. win98: how the games draw, click, animate, persist and play sound

### 7.1 Drawing

| Topic | Mines (`win98/mines.js`) | Solitaire (`win98/sol.js`) |
|---|---|---|
| Board | Flex grid: `v_flex` of rows, each `h_flex` of 16×16 `div` cells (`:191`) | Absolute positioning on a fixed `W = 596, H = 355` table: `div().id("sol-table").relative().w(u(W)).h(u(H))…overflow_hidden()` (`:6,184`) |
| Tiles/cards | A cell is a `div` with bevel borders drawn as border colours (`:159-161`). Content is an `image(...mines-*.svg)` for flag, mine and face (`:11-13,153-155`), or text for numbers (`:157`) | Each card is one SVG per card, `image(\`mods/win98/img/sol-${file}.svg\`)` with `file = up ? \`${selected ? "select-" : ""}${suit(c)}-${rank(c)}\` : \`back-${this.deck}\`` (`:141-144`). There are 52 faces, 52 "selected" faces and 2 backs (`img/sol-*.svg`) |
| Placement | Flex | `.absolute().left(u(x)).top(u(y))` per card (`:205,223-224`). Drag position comes from `e.position - e.bounds` divided by `scale()` (`:101-104`) |
| 7-segment counters | 7 absolutely positioned `div` rectangles per digit, lit `#ff0000` / unlit `#650000` (`:8-9,15-22`) | n/a |
| Pixel units | `u = unit()` → `n * (scale / zoom)` keeps 1px bevels crisp at any zoom (`win98/kit.js:4-6,40-51`) | same |
| Gradients/dither | `window.paint_path(RECT(), Background.linear_gradient(angle, from, to))` and `Background.checkerboard` (`win98/kit.js:190-200`); typings `vendor/gpui-kit/crates/shell/src/typings.rs:2248-2250,2341-2350` | |

### 7.2 Clicks and input (verified)

- Mines: on `on_mouse_down("left")` the cell is held (the face shows "ooh"). `on_click` reveals, and `e.click_count >= 2` chords. `on_mouse_down("right")` cycles flag/?. Middle down/up chords. `on_hover(false)` releases a held cell (`win98/mines.js:162-177`). `on_mouse_down_out` clears the held state (`:193-194`).
- Sol: press, then drag with a 4px threshold (`Math.abs(dx)+Math.abs(dy) > 4`) via `on_mouse_move`, then `on_mouse_up` hit-tests with `target(x, y)` (`win98/sol.js:186-199,105-109`). A double-click (`e.click_count >= 2`) sends the card to a foundation (`:207`).
- Event fields: `ClickEvent { click_count, modifiers }` (`typings.rs:1120-1123`) and `MouseButtonEvent { button, click_count, position, local_position?, bounds? , modifiers }`. `local_position` and `bounds` "are absent when the element has not been painted yet" (`typings.rs:1166-1182`). Sol guards this with `e.local_position?.x ?? 0` (`win98/sol.js:98`).
- Element ids are unique and deterministic per cell or card, e.g. `` `mine-${i}` `` and `` `sol-${loc.type}-${loc.i}-${loc.n}` `` (`mines.js:162`, `sol.js:205`).

### 7.3 Animation (verified)

| Kind | Code | Evidence |
|---|---|---|
| Native spinner | `svg(...spinner.svg).spin(900)` | `agents/main.js:214`; `spin` needs `ms` ≥ 100 and runs at ~30 fps, only while drawn (`typings.rs:1938-1942`) |
| Text frames | `.frames(["⠋","⠙",…], 90)` | `peek/main.js:11,85`; `ms` ≥ 16, one shared clock (`typings.rs:1927-1932`) |
| Pulse | `.loop("opacity", { from: 0, to: 1, period: 900 })`, `.loop("top", { from: 0, to: u(-5), period: 800 })` | `win98/desktop.js:56`, `win98/clippy.js:75`, `win98/taskbar.js:305,420`; `MotionProperty = "opacity" \| "width" \| "height" \| "left" \| "top"`, `LoopPolicy.period` "default 1000, at least 100" (`typings.rs:2087-2103`) |
| Timer animation (exception) | Sol's victory cascade uses `cx.timer.every(33, …)` with physics state, `this.trails` capped at 300, a 5200-frame cap and `cx.notify()` per tick | `win98/sol.js:110-128` |
| Game clocks | `cx.timer.every(1000, …)`; the handle is cancelled with `.cancel()` | `win98/mines.js:33,64-68`, `win98/sol.js:35-47` |
| Clock aligned to the minute | `cx.timer.after(60000 - (Date.now() % 60000) + 50, …)` then `every(60000)` | `win98/taskbar.js:77-80` |

Doc rule: "**Animate natively, never with a timer.** Every redraw of a mod redraws the whole window … Timers are for data … and only as often as what they show changes." (`defaults/AGENTS.md:1092-1104`). Sol's 33 ms cascade breaks this rule, but only briefly.

**Non-determinism inside game logic:** Mines places mines with `Math.random()` (`win98/mines.js:57`) and times with `Date.now()` (`:63,65,94`). Sol shuffles with `Math.random()` (`win98/sol.js:27,118`) and builds request stamps with `Date.now()` (`:10`). Neither game has a separate engine, and neither can be tested headless. **Our game should not copy this.**

### 7.4 Persistence and coordination between copies (verified)

- Options and best times are stored with `shared()`/`setShared()`, not files: `this.options = { level: "beginner", …, best: {}, ...(shared("win98.mines") ?? {}) }`, `save() { setShared("win98.mines", this.options); }` (`win98/mines.js:26,32`). Sol uses `win98.sol.draw|scoring|deck` (`win98/sol.js:18-20,162,171-173`). `shared` is "a value every mod can see (persisted)", and `setShared` makes "every mod re-render" (`defaults/herdr.d.ts:495-499`).
- **Game state itself is not persisted.** The board lives in instance fields and resets on reload (`win98/mines.js:34-42`, `win98/sol.js:23-34`).
- **Command bus through shared state:** a menu item writes `{ cmd, t: Date.now() }` to `win98.<game>.req` (`win98/mines.js:131`, `win98/sol.js:10`). Each copy keeps the last `t` it handled and only acts on a newer one. `init` records the current `t` so a copy that starts later skips stale requests: "A request from before this copy started was already handled." (`win98/sol.js:16-17,169-170`; `win98/mines.js:28,181-182`).
- Which windows are open is tracked in `shared("win98.apps")` (`win98/kit.js:417-427`). The taskbar opens and closes one keyed window overlay per game from `render` with `openOverlay({ mod: "win98", kind: "window", frame: "none", key: k, props: { role: k } })`, so "each comes back where it was dragged last" (`win98/taskbar.js:178-192`).
- Validated recovery from `localStorage` (agents/tabs/spaces): use `try { JSON.parse(...) } catch { default }`, then a shape check (`agents/main.js:89-93`; tested against `"{{{not json"`, `"null"`, `"42"`, `'"old shape"'`, `"[]"`/`"{}"` in `scripts/mod-storage.test.ts:20-51`).
- Writes that must not be lost stay pending until the host confirms them. Legacy pins stay in `localStorage` "until core echoes the label so a failed write doesn't erase the old pin" (`agents/main.js:115-133`; tested `scripts/agents.test.ts:20-50`).
- `localStorage` is per mod and per props: "Views with the same mod and props share live `localStorage` values." (`defaults/AGENTS.md:1069-1070`). The shell exposes it as `globalThis.localStorage = globalThis.window.localStorage` (`vendor/gpui-kit/crates/shell/src/engine/quickjs/mod.rs:7000`).
- For a file-backed save, the host's compare-and-swap write is `export function writeTextFile(path: string, text: string, expected: string | null): Promise<null>;`, which "Writes UTF-8 text only if it still matches expected (null creates a new file). Rejects on a stale snapshot; existing files are replaced atomically." (`defaults/herdr.d.ts:30-32`). Reads are capped: "Reads UTF-8 text (up to 1 MiB), or null if absent." (`:27-29`). The Settings test mocks the CAS as `if (expected !== disk.raw) throw new Error("changed since read");` (`scripts/settings.test.ts:15-20`).

### 7.5 Sound (verified)

```js
// defaults/mods/win98/kit.js:407-413
export function sfx(name) {
  if (settings()?.sounds?.enabled === false) return;
  if (shared("win98.mute") === true) return;
  try {
    playSound(`${ASSETS}/sounds/${name}.mp3`);
  } catch {}
}
```
It checks the global sound setting first, then the mod's own mute, and swallows errors. `playSound(sound)` takes `"done"`/`"blocked"` or an MP3 path that is absolute or relative to `~/.config/herdr-app` (`defaults/herdr.d.ts:51-53`). Games gate sound on their own option too: `if (this.options.sound) sfx("mines-boom")` (`win98/mines.js:80,102`).

### 7.6 How the art is generated (verified)

- `art/generate.ts` (Bun) is a tiny rasteriser. `class Pix` stores a grid of palette letters (`P` maps letters to hex, `:8`) and provides `dot/rect/line/poly/ellipse/ascii`. `svg()` run-length-encodes each row into `<rect … height="1">` with `shape-rendering="crispEdges"`, and `svg(true)` emits `currentColor` so the result can be tinted with `svg()` (`win98/art/generate.ts:9-19`).
- Icons are drawn twice, at 16 and 32 px, on their own grids ("not a nearest-neighbor upscale"), with a 32px drop shadow (`:38-40,94-99`). The output names are `name.svg`, `name-sm.svg` and `name-xs.svg` (`:101-103`). `kit.icon()` picks a size: `size >= 24 ? name : size >= 12 ? \`${name}-sm\` : \`${name}-xs\`` (`win98/kit.js:204-208`).
- Raster images (banner, about, splash, clouds, monitor) use ImageMagick `magick` through `spawnSync`. Clouds come from a seeded `plasma:fractal` ("no downloaded artwork") (`win98/art/generate.ts:114-124`).
- `art/sheet.ts` builds a contact sheet of every icon at 1× and 2× on grey and teal with `magick montage` (`win98/art/sheet.ts:6-18`), so the art can be reviewed at a glance.
- `art/sounds.ts` synthesises every sound from math expressions with `ffmpeg -f lavfi aevalsrc=…`: decaying sines, chords, filtered noise, `alimiter`, 96k mono MP3 (`win98/art/sounds.ts:6-21`).
- How to run them is in the README: `bun defaults/mods/win98/art/generate.ts /var/tmp/herdr98` (`defaults/mods/win98/README.md:19-31`).
- **Not every shipped asset has a generator in the repo.** `mines-*.svg` and `img/sol-*.svg` are not in generate.ts's `names` list (`win98/art/generate.ts:101`), and a grep for `sol-select` or `mines-face` in `*.ts|*.py|*.js|*.rs` finds only `mines.js`. The card SVGs contain `<text font-family="DejaVu Serif">` (`defaults/mods/win98/img/sol-0-1.svg`), so they depend on that font being present. Inferred: there are no rendering checks for this.

## 8. How herdr tests mod code outside the app

All tests are **Bun** tests (`import { test, expect } from "bun:test"`, e.g. `scripts/agents.test.ts:1`) that run mod source in Bun's own JS engine, not in QuickJS. CI runs only `bun test scripts/docs.test.ts` (`.github/workflows/ci.yml:131-133`). Inferred: the mod tests are run locally.

### 8.1 The `new Function` harness

1. Read the source and strip imports and exports:
   ```ts
   // scripts/agents.test.ts:4-5
   const source = (await readFile(new URL("../defaults/mods/agents/main.js", import.meta.url), "utf8"))
     .replace(/^import .*;\n/gm, "").replace("export default class Agents", "class Agents");
   ```
   Generic form: `.replace(/export default class (\w+)/, "class $1").replace(/^export /gm, "")` (`scripts/mod-storage.test.ts:6`).
2. Inject every imported name as a parameter, and return the class plus any module-level helpers to test:
   ```ts
   // scripts/agents.test.ts:11-14
   const Agents = new Function("View", "localStorage", "props", "run", ...Object.keys(globals), `${source}; return Agents;`)(
     class {}, storage, () => ({}), (...args: unknown[]) => writes.push(args),
     ...Object.values(globals),
   );
   ```
   Module helpers are extracted the same way: `` new Function("View", `${source}; return title;`)(class {}) `` (`scripts/agents.test.ts:62`), `return kidStatus` (`:277`), `return clean` (`:310`), and `return { Palette, modPalettes, keyOf }` (`scripts/palette.test.ts:58`).
3. Auto-wire the names from the import line: `const names = [...source.matchAll(/^import \{([^}]*)\}/gm)].flatMap(m => m[1].split(",").map(n => n.trim()));` with `values[name] ?? (() => undefined)` (`scripts/settings.test.ts:23-25`).
4. Stubs:
   - `View: class {}` and storage as a `Map` behind `getItem/setItem/removeItem` (`scripts/agents.test.ts:8-10`, `scripts/mod-storage.test.ts:8-11`).
   - `run` records `[name, args]` into `writes`, and the test asserts `expect(writes).toEqual([["terminal.pin", { terminal: "t1", pinned: true }]])` (`scripts/agents.test.ts:9,27`).
   - `cx` stubs: `{ timer: { every() {} } }` (`scripts/agents.test.ts:16`); `{ focus_handle: () => ({ focus() {} }), spawn: (run) => { task = run({ notify() {} }); } }`, after which the test awaits `task` (`scripts/agents.test.ts:139-140`).
   - `ScrollHandle: { new: () => ({ scroll_to_item() {} }) }` (`scripts/tabs.test.ts:35`).
   - Host file APIs are fakes over an in-memory "disk" (`scripts/settings.test.ts:7-21`, `scripts/palette.test.ts:39-52`).
5. **Proxy element builder**: every chained method returns the proxy. `child`/`children` record nodes, `when(cond, f)` runs `f` only when `cond` is truthy, and `id`/`on_click`/`bg` are captured. The test then walks the tree for ids, text and click handlers:
   ```ts
   // scripts/agents.test.ts:101-116 (abridged)
   const el: any = new Proxy(node, { get: (_, method) => {
     if (method === "node") return node;
     return (...args: any[]) => {
       if (method === "id") node.id = args[0];
       if (method === "on_click") (node as any).click = args[0];
       if (method === "bg") (node as any).bg = args[0];
       if (method === "child") node.children.push(args[0]?.node ?? args[0]);
       if (method === "children") node.children.push(...args[0].map((child: any) => child?.node ?? child));
       if (method === "when" && args[0]) args[1](el);
       return el;
     };
   } });
   ```
   A class-based variant records every call's arguments in `calls[key]` and provides `findById` (`scripts/tabs.test.ts:6-28`, `scripts/palette.test.ts:5-19`). Tests then call captured handlers directly, e.g. `(view.render() as Element).calls.on_scroll_wheel[0]` (`scripts/tabs.test.ts:48`) or `clicks.get("sub-t3")!()` (`scripts/agents.test.ts:250`).
   - Caveat: the proxy does not run `.hover(fn)` or `.map(fn)` callbacks, so whatever those would build is never checked. Inferred from the proxy only handling `when`.
6. Time: `setSystemTime(new Date(now))` drives `Date.now()` inside the mod, and `afterAll(() => setSystemTime())` restores it because "Bun runs every test file in one process" (`scripts/tabs.test.ts:1,51,56-57`). The changes test injects `Date` and `globalThis` as parameters instead (`scripts/changes.test.ts:30`).
7. Recovery tests loop over damaged inputs: `for (const raw of ["{{{not json", "null", "42", '"old shape"', "[]"])` (`scripts/mod-storage.test.ts:20-31`).
8. Scale test: 64 agents, with an assertion on how many host reads one render makes (`scripts/agents.test.ts:150-176`).

### 8.2 Why it cannot run inside the app runtime

The QuickJS sandbox **withholds dynamic code**: `delete globalThis.eval;`, and the `Function`, `AsyncFunction`, `GeneratorFunction` and `AsyncGeneratorFunction` constructors are replaced with throwers. The message is `` `${label} is disabled: ${hint}` `` with `hint = "the shell sandbox withholds dynamic code; run the host with --dev to allow it"` (`vendor/gpui-kit/crates/shell/src/engine/quickjs/sandbox.rs:168-197`). So `new Function` only works in the Node/Bun harness. In the app (and in our QuickJS-ng wasm harness, if it copies the sandbox), modules must be real ES modules.

## 9. Null-prototype maps and frozen built-ins

- **No shipped mod uses `Object.create(null)`.** A grep over `defaults/mods` and `scripts/*.ts` finds none. They use `Map`/`Set` (`agents/main.js:35,87,228,238,288-296`) or plain `{}` whose keys cannot collide with prototype names by construction: `seen[\`${a.space_name}\u0000${…}\`]` always contains `\u0000` (`agents/main.js:297-301`); `marks[\`${root}/${…}\`]` keys are absolute paths (`files/main.js:182,196`); `this.changed[a.address]` keys are terminal addresses (`agents/main.js:105`).
- The sandbox **freezes `Object.prototype`, `Array.prototype`, `Function.prototype`, `String.prototype` and `Number.prototype`** (`sandbox.rs:203-215`, `Object.freeze(proto)` at `:212`) unless the host is in development mode or `STRICT_BUILTINS` is off. `STRICT_BUILTINS` is `AtomicBool::new(true)` (`sandbox.rs:97`), and the freeze is applied at `sandbox.rs:80-87`.
- Inferred (standard JS semantics, not run here): in module (strict) code, assigning an own property whose name matches a frozen inherited non-writable property, such as `obj.toString = …` or `obj["constructor"] = …` on a `{}`, throws a `TypeError` (the "override mistake"). Reading `{}["constructor"]` returns `Object`, not `undefined`, so a `counts[k] ?? 0` on an untrusted key gives the wrong answer. **Use `Object.create(null)` or `Map` for any map keyed by agent names, titles, ids from disk or save-file keys.**
- `Map.prototype`/`Set.prototype` are not in the freeze list, but extending them is still a bad idea because "one VM hosts several plugins" (`sandbox.rs:110-113`).
- Missing timer globals throw with hints: `("setTimeout", "use cx.timer.after(ms, callback)")`, `("setInterval", "use cx.timer.every(ms, callback)")`, `("require", "this runtime uses ES modules; use \`import\`")` (`sandbox.rs:228-241`).

## 10. Smaller idioms worth copying

| Idiom | Evidence |
|---|---|
| Show the palette key as it is actually bound rather than hard-coding it: `keys().find((k) => k.section === "global" && k.action === "app.palette")`, mapped to platform glyphs. | `workspace-status/main.js:8-15` |
| A toast click runs `p.action` and then closes: `if (p.action?.name) run(p.action.name, p.action.args ?? {}); closeOverlay(p.overlay);` | `toast/main.js:30-33` |
| Fit-to-content mode for toasts via `p.fitHeight`. | `toast/main.js:17-23` |
| An agent on another machine shows its machine name (`address.split("/")[0]`). | `agents/main.js:306-307,374` |
| A dismissed set keyed by `` `${address}:${status}` `` is garbage-collected once the agent moves on. Clippy uses this so it does not nag. | `win98/clippy.js:25,32,53,64-68` |
| An empty-state message when no agents report a status. | `agents/main.js:452-454` |
| `herdr-app check <mod folder>` loads the mod once, including "virtual lists and motion". | `defaults/AGENTS.md:58-62` |

---

## Implications for our game

**Do**
1. Map helper status to cues the same way the sidebar does, so players can read them without learning anything new. Use the `working`/`blocked`/`done`/`idle` theme keys. Draw working as a `spin(900)` spinner, blocked as a `t.blocked`-tinted "Needs you" pill (`bg(t.blocked + "26")`), done as a filled dot and idle as a ring (§2.1). Rank them `blocked 4 > done 3 > working 2 > idle 1`.
2. Roll sub-agents up into their parent with the `kidStatus` rules: paneless `error → blocked`, `done → idle`, and a kid's `done` never raises the parent (§2.2). Source sub-agents from `terminals()` with `parent === addr && state === "live"` (`agents/main.js:175`).
3. When a "needs you" cue is clicked, use `run("pane.focus", { pane: a.pane })` for listed agents. Use `run("terminal.peek", { terminal })` for paneless sub-agents, or `run("agent.focus", { terminal })` for both. Call `cx.stop_propagation()` on nested targets.
4. Read `agents()`, `terminals()`, `panes()` and `spaces()` **once per render**, then index them with `Map`. Test this with a call counter at 30–64 agents, as `scripts/agents.test.ts:150-176` does.
5. For 30+ helpers, use fixed-height rows inside `overflow_y_scrollbar()`, plus fold or group headers. If rows get heavy, switch to `v_virtual_list`/`uniform_list` with **`on_item_click` on the list** (no per-row handlers) and a definite container height (§4).
6. Let names truncate natively (`.truncate()` + `min_w(0)` + `max_w`). Because GPUI truncates by scalar and not by grapheme (§3), any **JS-side cut must be grapheme-safe**. Write a small splitter that keeps ZWJ sequences, VS16, skin-tone modifiers, keycaps and regional-indicator pairs together, and test it with the 15-emoji list in `scripts/agents.test.ts:333`. Reuse `clean()` semantics if we display agent titles.
7. Use only named `theme()` keys for chrome and text. Write game-art colours as `#rrggbb`/`#rrggbbaa` literals chosen to read on both a light (`paper`) and a dark (`graphite`) background. Append alpha only to the 6-digit status keys, or normalise to 6 digits first (§2.3).
8. Animate with `.spin`/`.frames`/`.loop`/`.transition` (MotionProperty: opacity, width, height, left, top). Use timers only for data such as the game tick or a save, and as slowly as possible. Check `window()?.visible` in timers (`defaults/AGENTS.md:1092-1104`).
9. Lay out clickables (central object, nodes, pickups) with `relative()` + `absolute().left().top()`, as Solitaire does, each with a stable, unique `.id()`.
10. Gate sound behind `settings()?.sounds?.enabled !== false` **and** our own setting, wrapped in `try {}`. Our spec says "no sound", so we may skip `playSound` entirely.
11. Follow win98's art pipeline: commit a Bun/Node generator script that emits flat SVGs (`currentColor` variants for tintable icons) and a contact sheet for review. Avoid `<text>` in SVGs, because fonts may be missing.
12. Make the game's JS testable with the herdr harness: put **each import on one line**, use `export default class X`, keep module-level pure helpers and avoid side effects at top level. Our engine module needs no `herdr` import, so it can be imported directly.
13. For a command bus between windows or copies, consider win98's `{ cmd, t }` request pattern through `setShared`, with "last handled `t`" captured in `init` (§7.4). For the save file, use `writeTextFile(path, text, expected)` CAS and retry on reject.
14. Validate everything read from `localStorage`/disk with `try/catch` and a shape check, and test it against `["{{{not json", "null", "42", '"old shape"', "[]"]` (§7.4, §8.1).

**Don't**
1. Don't call `setAgentOrder` from the game mod. It would overwrite the sidebar's `agent.next/prev/select` order (§5).
2. Don't cap the helper list with `slice(0, N)` as the win98 tray does (`win98/taskbar.js:401`). Every agent must be shown and saved.
3. Don't copy `Math.random()`/`Date.now()` inside game rules, as Mines and Solitaire do (§7.3). Inject seed and time into the pure engine.
4. Don't key plain `{}` objects with agent names, titles or loaded JSON keys. Use `Object.create(null)` or `Map`, because built-in prototypes are frozen (§9).
5. Don't drive animation with `cx.timer.every(≤100)` + `cx.notify()` for decoration (the Solitaire cascade is the exception, not the pattern).
6. Don't JS-slice names with `.slice(0, n)` on UTF-16 code units (`changes/main.js:248` is the counter-example).
7. Don't hard-code a dark palette as terminals-bar does unless the layout pins a theme. Our layout should work in both themes.
8. Don't rely on `new Function`/`eval` at runtime. They exist only in the Bun/Node test harness (§8.2).
9. Don't put handlers inside a virtual-list item renderer. They throw there (§4).

---

## Open questions

1. **`Intl.Segmenter` in QuickJS-ng**: it is not found in the vendored shell sources, and the QuickJS C sources are not vendored here (`vendor/quickjs-jit-runtime` has only `Cargo.toml`, `build.rs`, `src`, `LICENSE`). Assume it is absent and write our own grapheme-safe splitter. Our wasm harness should confirm this.
2. **Exact `TypeError` text** for the override mistake on frozen `Object.prototype` in QuickJS-ng. It has not been checked by running. Our wasm harness should assert the behaviour, not the message.
3. **What happens to `"#rrggbbaa" + "26"`**: `parse_hex` was not traced. The magenta fallback is documented for missing names (`src/settings.rs:702-705`). Whether an invalid literal in a mod's `.bg()` also paints magenta, or throws, is unverified.
4. **Whether `localStorage` survives hot reload and is shared across windows**: the doc says it is shared by mod and props (`defaults/AGENTS.md:1069-1070,1282`). How it is persisted across two app windows sharing one config dir was not traced in this pass; see the host-api and mod-lifecycle research.
5. **The origin of `mines-*.svg` and `img/sol-*.svg`**: they are hand-authored or made by an unshipped script. There is no generator in the repo.
6. **`shared()` persistence scope** (per app, per window, or on disk): the doc says only "persisted" (`defaults/herdr.d.ts:495`). It affects whether shared keys can carry game state between two windows.

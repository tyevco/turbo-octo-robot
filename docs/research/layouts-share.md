# Layouts, keys.json and the herdr.dev share package

Scope: how a herdr-app layout file is parsed and applied, how `keys.json` sections and actions work, how the Keys overlay, Settings and the palette show layout and mod names, and how a shared layout+mod package is laid out. It ends with four working layouts that keep the shipped main window and add the game.

Source: herdr-app v0.1.18 (`Cargo.toml:13`), commit `a2e8e3f`. All paths are relative to the herdr-src root. **[V]** means verified in source. **[I]** means inferred (reasoned from source, not tested). Nothing was built or run.

In the examples, `my-game` stands for our mod folder and `MyGame` for our layout name. Replace both once the game's name is chosen.

---

## 1. Where layouts live and how they load

| Fact | Status | Cite |
|---|---|---|
| A layout is `layouts/<name>.json` in the app home. One file is one whole window. | V | `src/window.rs:179-181` (`layout_path` → `file(&format!("layouts/{name}.json"))`), `defaults/AGENTS.md:182-184` |
| Herdr ships three layouts and embeds them: `main`, `terminals`, `win98`. | V | `src/window.rs:147-152` (`const LAYOUTS`) |
| Shipped layouts are rewritten on every start. If you edited one, your file is moved to `<name>-edited.json` (or `-edited-2` and so on) along with its clicks, Herdr's version is put back, and a toast is shown. **A personal file named `main.json`, `terminals.json` or `win98.json` gets replaced.** | V | `src/mods.rs:149-188`, `src/mods.rs:105-108` (`edited_name`), `defaults/AGENTS.md:221-225` |
| A layout name must match `valid_name`: non-empty, and only ASCII letters, digits, `-` and `_`. Upper case is allowed. `layout.switch {name}` rejects any other name and logs `no layout {n:?} in layouts/`. | V | `src/mods.rs:219-221`, `src/window.rs:1084-1090` |
| `layout_names()` lists every `layouts/*.json` stem, **except layouts whose mods are missing**. `main` comes first, then the rest in byte order (`sort_by_key(\|n\| (n != "main", n.clone()))`). This list feeds `layouts()`, the `ctrl-shift-l` cycle, Settings and the palette. | V | `src/window.rs:185-197`, `src/mods.rs:1306` |
| `missing_mods(name)` walks the **whole JSON** and collects every string value under a key called `"mod"`, props included. It keeps only names that do not start with `frame-` and have no matching directory under `mods/`. | V | `src/window.rs:232-251` |
| At startup, if the saved layout (`shared("layout")`) has missing mods, the window opens on `main`. | V | `src/window.rs:651-655` |
| A file that is missing, or that fails to parse, is replaced on screen by `default_layout(name)`. For a name Herdr does not ship, that is **`main`** (`unwrap_or(&LAYOUTS[0])`). The parse error goes to `layout.error` as `layouts/{name}.json was not applied: {message}`, and clicks are not written until the file is fixed. | V | `src/window.rs:161-168`, `src/window.rs:1026-1080` |
| The file is reloaded live: on file events under `layouts/`, and on a poll every 25 ticks. `check_layout_file` re-parses it and applies it if the text changed. A field the file now sets on purpose overrides an earlier click on that field. | V | `src/window.rs:4313-4320`, `src/window.rs:4363-4364`, `src/window.rs:1123-1165` |
| A node without an `id` gets `node-N`, and **the file is rewritten**, formatted by `text_of`. | V | `src/window.rs:1259-1277`, `src/layout_sync.rs:308-312` |
| Unknown JSON fields are ignored silently, because `layout.rs` has no `deny_unknown_fields`. A typo such as `"hiden"` does nothing and raises no error. | V (attribute absent) / I (serde default behaviour) | `src/layout.rs` (0 matches for `deny_unknown`) |
| Clicks (sizes, hidden, a stack's active child, float edge/align/hidden, theme pick, background, font_size, pane header height and border/focus) are saved in `layouts/.state/<name>.json`, not in the layout file. | V | `src/layout_sync.rs:10-47`, `src/layout_sync.rs:81-89`, `defaults/AGENTS.md:227-232` |
| A personal layout's file **is rewritten** when its tree changes for some reason other than a click, for example a mod docking into it or `layout.set`. | V | `src/window.rs:1196-1205` (`save_layout`; skipped if the file changed on disk meanwhile), `src/window.rs:3618-3630` |

## 2. Node schema (`src/layout.rs`)

### 2.1 Node fields

The type is set by `#[serde(tag = "type", rename_all = "lowercase")]` and must be one of `block`, `row`, `column` or `stack` (`src/layout.rs:312-331`).

| Field | Type / values | Default | Notes | Cite |
|---|---|---|---|---|
| `id` | string | `""`, auto-filled as `node-N` and written back | Must be unique. Commands and keys address nodes by id. | `src/layout.rs:357-358` |
| `type` | `block` \| `row` \| `column` \| `stack` | required | | `src/layout.rs:312-331` |
| `content` | block only, see 2.2 | required for a block | | `src/layout.rs:315-317` |
| `children` | `Node[]` | required for containers | | `src/layout.rs:318-325` |
| `active` | stack only, a child id | first visible child | A hidden child falls back to the next visible one. | `src/layout.rs:326-327`, `src/layout.rs:704-707` |
| `header` | stack only, `{content, reveal?, height?, position?}` | none | `content` is the string `"tabs"` (built-in strip) or `{mod, props}`. `reveal` is `always` (default) or `hover`. `height` defaults to `HEADER_HEIGHT = 30.0`. `position` is `top` (default) or `bottom`. The built-in strip labels each child with its `title`, else its 1-based index. | `src/layout.rs:245-280`, `src/window.rs:32`, `src/window.rs:4795-4814` |
| `size` | `{"px": n}` \| `{"weight": n}` | weight 1 | Px is fixed and multiplied by zoom (`settings::z`). A weight is a share of the space the fixed siblings leave. | `src/layout.rs:79-84`, `src/window.rs:5517-5541`, `src/window/pane_size.rs:31-37` |
| `min` / `max` | px (f32) | none | Applied as CSS `min_*`/`max_*` at render. While dragging a divider, only the **first** (left or top) child's min/max is clamped, and the drag always keeps at least 24 px for each side. | `src/window.rs:5535-5540`, `src/window.rs:4912-4921` |
| `hidden` | bool | false | Hides the node and its floats. Toggled by `layout.toggle/show/hide`. | `src/layout.rs:369-370`, `src/window.rs:3639-3647` |
| `title` | string | none | "A name for people: tab captions use it". Used by the built-in stack header and for pane names. **It is not a display name for the layout.** | `src/layout.rs:371-373`, `src/window.rs:4811` |
| `background` | colour string \| `{gradient:[a,b], angle=180}` \| `{image, fit:"cover"\|"contain"}` | none | | `src/layout.rs:122-151` |
| `border` | `{width=1, color="border"}` | none | | `src/layout.rs:86-92` |
| `radius` | f32 | none | | `src/layout.rs:378-379` |
| `shadow` | `sm` \| `md` \| `lg` | none | | `src/layout.rs:380-382` |
| `padding` | `n` or `[vertical, horizontal]` | none | | `src/layout.rs:153-169` |
| `focus` | `{border?, background?}` | none | Used while the focused block is inside. | `src/layout.rs:236-243` |
| `gap` | f32, rows and columns | 0 | Space between children. | `src/layout.rs:390-392`, `src/window/pane_size.rs:23-24` |
| `divider` | `{width=1, color="border", hover?, active?}` | none | `active` falls back to `hover`. | `src/layout.rs:94-113` |
| `movable` / `closable` / `resizable` | bool | true | `resizable` applies to that row or column's own boundaries only. `movable` is inherited. | `src/layout.rs:396-401`, `src/layout.rs:526-532`, `defaults/AGENTS.md:255-267` |
| `floating` | `Float[]`, see 2.3 | `[]` | Allowed on any node, blocks included. | `src/layout.rs:402-404`, `src/window.rs:4685` |
| `window_drag` | bool | false | Dragging the node moves the window. | `src/layout.rs:424-426` |
| `cloned_from` | `{name, version}` | none | Written by `layout.clone`. | `src/layout.rs:349-353`, `src/window.rs:262-268` |
| Look fields, flattened: `theme`, `colors`, `font`, `font_size`, `font_weight`, `font_weight_bold`, `terminal_line_height` (0.8..2), `terminal_cell_width` (0.8..2), `terminal_scroll_speed` (0.1..5), `ui_font`, `terminal_padding [x,y]`, `terminal_opacity` (0..1) | | unset, so settings.json applies | **Only the root's look applies today.** | `src/layout.rs:171-210`, `src/settings.rs:582-612`, `defaults/AGENTS.md:389` |

**Root-only fields** (`src/layout.rs:405-430`):

| Field | Meaning | Cite |
|---|---|---|
| `titlebar` | `"system"` (default) or `"none"`. With `none` the layout draws its own title bar using `window_drag` blocks. `main` uses `none`. | `src/layout.rs:337-347`, `defaults/layouts/main.json:4` |
| `traffic_lights` | `[x, y]` px, macOS with `titlebar: none`. `main` uses `[12, 16]`. | `src/layout.rs:408-410`, `defaults/layouts/main.json:5-8` |
| `preview` | `"a picture of the layout for the settings screen (svg or png, relative to the app's folder: layouts/<name>.svg)"`. See section 5. | `src/layout.rs:411-414` |
| `terminal_menu` | The mod for terminal right-clicks. Default `menu`. An unknown name logs a warning and falls back. | `src/layout.rs:415-417`, `defaults/AGENTS.md:288-291` |
| `link_handlers` | Mods that handle terminal Ctrl/Cmd-clicks, in order. | `src/layout.rs:418-420` |
| `toast` | The mod that shows notifications. Default `toast`. | `src/layout.rs:421-423`, `defaults/AGENTS.md:295-301` |
| `window_blur` | bool | `src/layout.rs:427-430` |

### 2.2 Block `content` kinds (`#[serde(untagged)]`, tried in this order)

| Shape | Meaning | Cite |
|---|---|---|
| `{"terminal": "t7"}` | A specific terminal. It is not a tab pane. | `src/layout.rs:13` |
| `{"mod": "<folder>", "props": {...}}` | A mod copy. `props` defaults to null. | `src/layout.rs:14-19` |
| `{"tab": "active", "pane": PaneFrame?}` (alias `context`) | The shown tab's panes, each framed by `pane`. | `src/layout.rs:20-28`, `src/layout.rs:282-310` |
| `{"agent": "focused"}` | One agent's terminal at full size. | `src/layout.rs:29-30` |

`PaneFrame` fields: `header` (a mod drawn per pane), `background`, `shadow`, `border`, `focus`, `veil` (0..1), `radius`, `gap`, and `lone` (frame a single pane as well) (`src/layout.rs:282-310`). The frame used is the one on the first **visible** tab block (`src/window.rs:4571-4578`).

### 2.3 Floating blocks (`Float`, `src/layout.rs:61-77`, `src/window/floats.rs`)

| Field | Values | Default | Cite |
|---|---|---|---|
| `id` | string, **required** (no serde default, so leaving it out is a parse error) | none | `src/layout.rs:64-65` |
| `content` | same kinds as a block. Terminals render 560×320. | required | `src/layout.rs:66`, `src/window/floats.rs:134-136` |
| `edge` | `top` \| `right` \| `bottom` \| `left` | `right` | `src/layout.rs:33-43` |
| `align` | `start` \| `center` \| `end` | `center` | `src/layout.rs:51-59` |
| `peek` | px, side edges only. The float becomes a drawer. | none | `src/layout.rs:71-74`, `src/window/floats.rs:161` |
| `hidden` | bool | false | `src/layout.rs:75-76` |

Constants: `MARGIN = 12.0` (px from the edge), `DRAG_START = 4.0`, `SNAP_MS = 360.0`, `FRAME_PAD = 5.0` (above and below the content), `REVEAL_MS = 220.0` (drawer slide), and `LEAVE_MS = 280` (hover grace) (`src/window/floats.rs:13-24`).

- A float is sized to its content: the copy is mounted with `set_fit_content(true)` (`src/window.rs:1641-1646`). Its frame (popover background, border, 12 px radius, `shadow_lg`) is skipped when the content measures under 1 px, so rendering nothing hides it (`src/window/floats.rs:186-201`).
- Floats occlude: clicks never reach what is underneath (`src/window/floats.rs:202`).
- The float's mod gets `props.float = <float id>` added to its props (`src/window.rs:5457-5461`). It reads `placement()`: `{edge, align, vertical, hovered, dragging}` (`defaults/herdr.d.ts:330-339`).
- **No command shows or hides a float.** `layout.toggle/show/hide` only find nodes (`self.chrome.find_mut(id)`, `src/window.rs:3639-3647`). A float's `hidden` changes only through the file, `layout.set` or the saved click state (`src/layout_sync.rs:81-89`). To collapse a float, the mod renders smaller or renders nothing.
- A float shows only while its owner node is visible (`visible_nodes`, `src/window.rs:1310-1317`, `src/window.rs:5472-5490`).

## 3. keys.json (`src/keys.rs`)

### 3.1 Sections

`tab(section)` maps a section to a GPUI key-context predicate (`src/keys.rs:119-131`):

| Section | Predicate | Applies while | Cite |
|---|---|---|---|
| `global` | `Identifier("Herdr")` | always, in the window | `src/keys.rs:122` |
| `terminal` | `Identifier("Terminal")` | a terminal has focus | `src/keys.rs:123`, `src/terminal.rs:2507` |
| `layout:<name>` | `Equal("layout", <name>)` | `layouts/<name>.json` is shown. Set on the root div as `key_context(key_context("Herdr", "layout", &self.layout_name))`. **Case-sensitive exact match.** | `src/keys.rs:127`, `src/window.rs:5695` |
| `mod:<name>` | `Equal("mod", <name>)` | focus is **inside** an element of a copy of mod folder `<name>`. Each mod slot is wrapped in `key_context(key_context("Mod", "mod", &inst.name))`, and floats are wrapped too. | `src/keys.rs:125`, `src/window.rs:4754`, `src/window/floats.rs:137` |
| anything else | error: `unknown section {s:?}: use "global", "terminal", "layout:<name>" or "mod:<name>"` | | `src/keys.rs:128` |

Precedence: "The more specific section wins: `layout:terminals` over `global`, `terminal` over both" (`defaults/AGENTS.md:550-552`, `src/keys.rs:115-118`). Key context values are built with `KeyContext::set` rather than parsed, so names containing `.` work (`src/window.rs:170-177`, tested at `src/window.rs:8104-8109`).

### 3.2 Actions

`valid_action` (`src/keys.rs:159-165`) accepts:

| Form | Meaning | Cite |
|---|---|---|
| `"<command>"` or `"<command>:<value>"` | An app command. The value fills the command's **first** argument (`commands::shorthand`). Example: `"layout.toggle:game-strip"` becomes `{id:"game-strip"}`. | `src/keys.rs:12-17`, `src/window.rs:3080-3095`, `src/commands.rs:84` |
| `{"command": "...", "args": {...}}` | Named, typed arguments. Any key other than `command` and `args` fails with `unknown key binding field {key:?}; use command and args`. `args` must be an object (`{name}: key binding args must be an object`). Errors are raised when the key is pressed (as a toast), not at load. | `src/keys.rs:60-83`, `src/keys.rs:388-407` |
| `"send:<text>"` | Types text into the focused terminal. | `src/keys.rs:163` |
| `"terminal"` | The key goes to the program: the binding is switched off for this section (`NoAction`). In `global` it is simply not bound. | `src/keys.rs:224-229` |
| `"<mod>.<command>"` | Any `name.split_once('.')` where both sides are non-empty. It is delivered to that mod's `nextCommand()`. | `src/keys.rs:164`, `src/window.rs:3097-3104` |

How `<mod>.<command>` is resolved:

- When run, if the name is not an app command, `name.split_once('.')` gives `(m, c)` and `mods::send_command(m, c)` is called. That sends `c` to **every shown copy** of mod `m` through an unbounded channel (`src/window.rs:3097-3101`, `src/mods.rs:785-797`, `src/mods.rs:1125`, `src/mods.rs:1366-1369`).
- **"Shown" means visible**: copies in hidden nodes or in a stack's inactive child are not in `SHOWN_COPIES` (`src/window.rs:4122-4125`, `src/window.rs:1282-1310`). With no shown copy the command fails with `unknown command {name:?}: see \`herdr-app commands\`; a mod's are <mod>.<command> and need the mod loaded` (`src/window.rs:3103-3104`). From a key, that appears as a toast titled `"{name} failed"` (`src/window.rs:3062-3072`).
- [I] `"<mod>.<cmd>:<value>"`: `commands::find("<mod>")` fails, so the colon is not split off, and `nextCommand()` receives `"<cmd>:<value>"` (`src/window.rs:3081-3101`).
- **Doc conflict:** `defaults/herdr.d.ts:502` says `"alt-s": "<mod>:<command>"`. That is wrong. A colon form has no `.` in its name part, so `valid_action` rejects it (`src/keys.rs:159-165`). Use `<mod>.<command>` as `defaults/AGENTS.md:555` says.
- `gone_mod` silently drops `<m>.<c>` bindings whose `mods/<m>/` directory does not exist, unless `m` starts with `frame-`. They are dropped both when binding and in the Keys listing (`src/keys.rs:152-157`, `src/keys.rs:99`, `src/keys.rs:210-212`).
- Legacy rewrites: `project.` becomes `space.`, `context.` becomes `tab.`, and `mod.open:start` becomes `tab.new` (`src/keys.rs:135-150`).

### 3.3 Load and failure behaviour (important for merging our keys.json)

- **One bad entry rejects the whole file.** `parse` collects every problem and returns `Err(problems.join("; "))` when there is at least one (`src/keys.rs:192-246`). Example problem strings: `{section}.{keys}: unknown action {action:?}` (`src/keys.rs:214`), `ctrl-alt-shift-escape is reserved for resetting Herdr` (`src/keys.rs:219`), and `{section}.{keys}: {e}` for a bad chord (`src/keys.rs:241`).
- On `Err`, the error is reported to `keys.error`. If keys had already loaded this session, the old bindings stay. **On the very first load, `install(vec![])` runs and the person has no keys.json bindings at all**, only the UI kit's keys and the reserved ones (`src/window.rs:988-1003`, `src/keys.rs:254-266`).
- The file is reloaded live when its mtime changes (`src/window.rs:988-1004`).
- `ESCAPE_HATCH = "ctrl-alt-shift-escape"` is reserved (`app.reset`) (`src/keys.rs:25`, `src/keys.rs:107`).
- Migration: an untouched shipped keys.json is upgraded to the current defaults. Any edit, even whitespace, makes the file the person's own (`src/keys.rs:176-190`, `defaults/AGENTS.md:537-539`).
- Default chords taken on Linux/Windows: `ctrl-shift-{b,n,t,k,p,o,e,w,x,z,l,/,?,tab,pagedown,pageup}`, `ctrl-{1..9,+,-,=,0,?,tab,pageup,pagedown,","}`, `alt-{1..9,h,j,k,l,left,right,up,down,[,]}`, `alt-shift-{h,j,k,l}`, `f2`, and `shift-f2`. Terminal section: `ctrl-shift-{c,v,f}`, `ctrl-{backspace,left,right,v,insert}` and `shift-insert` (`defaults/keys.json:1-74`). macOS uses `cmd-*` chords instead (`defaults/keys.macos.json`).
- Plain ctrl+letter chords belong to programs. Do not choose ctrl+c/d/l/r/w/a/e/u/k/z/[ yourself (`defaults/AGENTS.md:566-571`).

## 4. How names are displayed

| Place | What it shows | Status | Cite |
|---|---|---|---|
| **Keys overlay** (`app.help` opens the `help` mod as a 640×520 dialog) | Each row is `keys + (section !== "global" ? "  (" + section + ")" : "")` followed by `label(action)`. So a `mod:my-game` binding shows `(mod:my-game)`: **the folder name**. A `layout:MyGame` binding shows `(layout:MyGame)`: **the file stem**. | V | `src/window.rs:3753-3759`, `defaults/mods/help/main.js:83` |
| Keys overlay label | `label()` strips `send:`, then splits on `:`, replaces `.` and `_` with spaces and appends the argument. `"my-game.collect"` becomes `my-game collect`, and `"layout.toggle:game-strip"` becomes `layout toggle game-strip`. **Object bindings** are listed as raw JSON text and display badly. | V | `defaults/mods/help/main.js:17-22`, `src/keys.rs:103` |
| Keys overlay grouping | Groups match the action prefix: `space.`, `tab.`, `pane.`, `agent.`, `terminal.`/`send:`, and everything else under "window". Our `<mod>.*` and `layout.*` keys appear under **window**. | V | `defaults/mods/help/main.js:8-15` |
| Keys listing source | `keys()` returns `keys::listing()`, which reads the person's keys.json and falls back to defaults if it does not parse. Bindings for missing mods are dropped, and the escape hatch is always appended. | V | `src/mods.rs:1320-1323`, `src/keys.rs:90-109` |
| **Settings → Look → Layout picker** | The card label is `LOOKS[name] ?? name`, where `LOOKS = { main: "Herdr", terminals: "Terminals", win98: "Herdr 98" }`. **Our layout shows its raw file stem** (`MyGame`). There is no title field. | V | `defaults/frame/settings/main.js:18`, `defaults/frame/settings/main.js:316` |
| Settings order | Shipped layouts first in `LOOKS` order, then the rest by `localeCompare`. | V | `defaults/frame/settings/main.js:272-277` |
| Settings card | 124 px wide, `p(6)`, `border_2`. The picture is `image(preview).w_full().h(62)`, about 108×62 px. Without a preview it draws a generic "plain frame". Clicking runs `layout.switch {name}`. | V | `defaults/frame/settings/main.js:286-310`, `defaults/frame/settings/main.js:268-270` |
| **Palette** | `Layout: <t>`, where `t` is the shipped title or `l.charAt(0).toUpperCase() + l.slice(1)`. `MyGame` shows as `Layout: MyGame`. The search words are `look <name>`. | V | `defaults/frame/palette/main.js:154-158` |
| Palette key hints | Shows only `global` bindings whose action string exactly matches the entry, so `layout:` and `mod:` keys are not hinted there. | V | `defaults/frame/palette/main.js:186-210` |
| Mod load errors | A floating mod shows `"{name} did not load: {e}"` using the folder name. `herdr-app status` lists `mod {name}: …`. | V | `src/window/floats.rs:139-147`, `src/window.rs:4222-4229` |
| `shared("layout")` | The shown layout's file stem. | V | `src/window.rs:1073` |
| Node `title` | Only used for stack tab captions and pane names. Not used for the layout's name. | V | `src/window.rs:4811`, `src/window.rs:1959-1976` |

## 5. The `preview` field

- Root only. Settings reads it with `JSON.parse(await readTextFile(\`${appHome()}/layouts/${name}.json\`)).preview` and uses it when it is a non-empty string (`defaults/frame/settings/main.js:85-99`). It is drawn with `image(path)` (`defaults/frame/settings/main.js:307-309`).
- `image()` paths resolve against the app home through `AppAssets::new(mods::app_dir())` (`src/main.rs:186`). `..` is refused with `` `{path}` is outside the application directory `` (`vendor/gpui-kit/crates/shell/src/assets.rs:73-83`, `:114-116`). Assets are limited to `MAX_ASSET_BYTES = 16 * 1024 * 1024` (`vendor/gpui-kit/crates/shell/src/assets.rs:27`).
- Shipped example: `"preview": "layouts/win98.svg"`. Herdr writes `win98.svg` next to the file on every start (`defaults/layouts/win98.json:105`, `src/window.rs:155`, `src/window.rs:253-260`). `main.json` has **no** preview; Settings draws main and terminals in code (`defaults/frame/settings/main.js:249-266`).
- **Share-format catch:** step 2 of adding a shared layout says "Copy the layout file to `layouts/` and each mod folder to `mods/`. Leave the recipe and preview out." (`defaults/AGENTS.md:494-497`). The repo-root `preview.png` is therefore never copied, and a `layouts/MyGame.png` beside the JSON is not one of the copied files either. [I] Put the Settings picture **inside the mod folder** (for example `mods/my-game/art/layout-preview.png`) and point `"preview"` at that path, so it travels with the copied folder.

## 6. Theme `{light, dark}` and colours

- `theme` is either a single name or `{ "light": "...", "dark": "..." }` (`ThemeChoice`, `src/layout.rs:212-234`). The pair is picked by the person's `appearance`, falling back to the system's (`src/settings.rs:587-595`).
- Presets: `PRESETS = ["graphite", "ink", "moss", "paper"]`, with `DEFAULT_DARK = "graphite"` and `DEFAULT_LIGHT = "paper"` (`src/settings.rs:80-84`). Files in `themes/<name>.json` also count (`defaults/AGENTS.md:352-358`).
- Precedence: the layout's `theme` first, then the person's, then the defaults (`src/settings.rs:592-595`). The theme picker writes the shown layout's root theme as a click (`src/layout_sync.rs:16-17`, `defaults/AGENTS.md:387-388`). `main` sets no theme, so the person's choice wins there (`defaults/AGENTS.md:202-204`).
- A layout's `colors` **extend the person's colours in both appearances** (`colors.extend(look.colors…)`, `src/settings.rs:585-586`). Hard-coding hex values in a layout's `colors` therefore breaks one of the two appearances. Use theme token names in the layout (`chrome`, `canvas`, `border`, `accent`, …) (`defaults/AGENTS.md:348-351`).
- Layout colour fields take a theme name or `#rrggbb[aa]` (`defaults/AGENTS.md:302`).
- A theme file named after a layout (`themes/MyGame.json`) belongs to that layout, and Settings and the palette offer it only there (`defaults/AGENTS.md:356-358`, `defaults/frame/palette/main.js:161-165`).

## 7. How a layout references mods, and first-seen docking

- `{"mod": "<folder>"}` names a directory under `mods/` (or `frame-<x>` for frame mods) (`src/mods.rs:388-392`, `src/mods.rs:394-423`). A folder counts as a mod only if it has `main.js`, `link.js` or `mod.json` (`src/mods.rs:404-409`). Names starting with `.` are skipped (`src/mods.rs:400-402`).
- **First-seen docking:** the first time Herdr sees a mod folder with a view, while a non-shipped layout is showing that does not already contain it, it docks a block of `mod.json`'s `size` (default **320**) at `place` (default **`"right"`**) and rewrites that layout file. `"none"` means it is never docked (`src/window.rs:4516-4531`, `src/window.rs:5496-5516`, `defaults/AGENTS.md:940-942`). While a shipped layout shows, the mod is neither docked nor marked as seen, so docking happens later on the first personal layout shown (`src/window.rs:4518-4523`).
- `mod.json` is read as `Hint {place, size, focusable}`. **A malformed `mod.json` falls back to the defaults**, so `place` becomes `"right"` (`src/mods.rs:349-357`, `src/mods.rs:410-411`).
- Copies: every block, float, stack header and pane header that names the mod is its **own copy** with its own `props` (`src/window.rs:1355-1372`). A copy lives while its block is in the layout, shown or not. Switching to another layout starts its mods fresh (`defaults/AGENTS.md:948-953`).
- `role`-style props are the shipped pattern for one mod with several pieces (`win98`: `{"role": "desktop"|"window"|"clippy"|"taskbar"}`, `defaults/layouts/win98.json:13-16,31-34,65-68,79-82`).
- `tab.new {mod, props}` and `pane.split {mod, props}` put a mod **inside a tab** as a pane. That works in any layout, including `main`, and the pane belongs to the tab (`src/commands.rs:37-38`, `src/commands.rs:42`, `defaults/AGENTS.md:952`).

## 8. herdr.dev share format (`defaults/AGENTS.md:480-533`)

```
<repo>/
  layouts/MyGame.json        the layout (whole window)
  mods/my-game/              every mod the layout needs (main.js, mod.json, art, ...)
  keys.json                  keys the package expects (merged, never overwritten)
  RECIPE.md                  the brief to rebuild it from scratch
  preview.png                a screenshot (herdr.dev card; NOT copied on install)
  README.md, LICENSE         ours (not part of Herdr's format)
```

- "a layout has `layouts/<name>.json` and the `mods/<name>/` it needs … Both have a `RECIPE.md` … and a `preview.png`" (`defaults/AGENTS.md:483-487`). The doc mentions `keys.json` for a **mod** share ("maybe a `keys.json` with the keys it expects"). [I] For a layout share it is merged the same way (step 4).
- How an agent adds one (`defaults/AGENTS.md:491-506`): (1) read the recipe and every file first, and tell the person if the mod reaches the network, runs programs (`exec`, `hc`) or reads files outside its own folder; (2) copy the layout and mod folders, never overwriting, and on a name clash rename the file or folder, the `mod` names in the layout and the mod's own `mods/<name>/` paths; (3) adapt only where needed; (4) **merge keys.json, asking before replacing a key the person already uses**; (5) `herdr-app check` each mod, then `layout.switch {name}`.
- Publishing: a public GitHub repo with the topic `herdr-layout` (or `herdr-mod`). It is listed on herdr.dev/layouts "within the hour" (`defaults/AGENTS.md:508-512`).
- **RECIPE.md order** (`defaults/AGENTS.md:514-533`):
  1. `# Name`, one paragraph on what the person sees, then `![Name](preview.png)`.
  2. **What you see:** regions top to bottom or left to right; their sizes, colours and type; what each one shows.
  3. **How it behaves:** every agent status (working, blocked, done, idle) and how it looks; what clicks, keys and hovers do; what moves.
  4. **Built from:** node tree and blocks, each mod and its `props` roles, the shipped mods used, the `herdr` functions and commands called, programs run, and art.
  5. **Watch out:** what tripped the build up; limits (sizes, counts); controls that do nothing yet; assumptions about the setup.
  6. **Done when:** checks that prove a build works.

  The person and what they see come first; code goes only in Built from and Watch out. Prefer exact values (`#ab7748`, 29px, `agent.focus`) and describe nothing the build does not do.

## 9. The shipped main window: ids other mods depend on

`defaults/layouts/main.json` is a `row` root with `titlebar:"none"`, `traffic_lights:[12,16]`, `background:"canvas"` and `terminal_padding:[14,12]`, and two children:

- `sidebar` (column, px 268, min 44, max 480, `resizable:false`, contains `brand` (px 46, `workspace-chrome`), `sidebar-lists` (`spaces` and `agents`, weight 1 each, min 90) and `sidebar-footer` (px 69, `workspace-chrome {footer:true}`))
- `work` (column, `resizable:false`, contains `tabs` (px 42, `tabs` mod, `window_drag`), `work-body` (row, padding 8, gap 8, contains `main` (`{"tab":"active"}` framed: gap 8, radius 10, `lone`, `pane` header 30) and `panel` (column, hidden, px 368, min 280, max 900, contains stack `panel-body` with `files` and `changes`)) and `status` (px 28, `workspace-status`))

(`defaults/layouts/main.json:1-183`). The shipped mods look nodes up **by id**, so keep these ids:

| Id | Used by | Cite |
|---|---|---|
| `sidebar` | `spaces`, `agents` and `workspace-chrome` (rail below 160 px; fold resizes to 44, or 76 on macOS) and `tabs` (traffic-light padding) | `defaults/mods/spaces/main.js:20`, `defaults/mods/agents/main.js:17-25`, `defaults/mods/workspace-chrome/main.js:15-23`, `defaults/mods/tabs/main.js:126-129` |
| `panel`, `panel-body` (children `files`, `changes`) | The `tabs` mod's Files/Changes buttons, plus its per-space panel memory, which **hides `panel` when the active child is not in `shared("workspace.panels") ?? ["files","changes"]`** | `defaults/mods/tabs/main.js:62-88`, `defaults/mods/tabs/main.js:131-142` |
| `main` (a tab block) | Window tests and `shows_tab()` | `src/window.rs:8325-8328`, `src/window.rs:1442-1444` |

The `ctrl-shift-b` default is `layout.toggle:sidebar` (`defaults/keys.json:48`).

**Do not add the game as a third child of `panel-body`.** The tabs mod would hide it whenever the space changes (`defaults/mods/tabs/main.js:64-77`). Give the game its own node id.

## 10. Four worked layouts: main window plus the game

All four keep every node of `main.json` with the same ids and root fields, and add `"preview": "mods/my-game/art/layout-preview.png"`. Each was generated from `defaults/layouts/main.json` by script and checked for JSON syntax, unique ids and the required main ids. [I] They were not parsed by herdr itself, but every field used appears in `src/layout.rs`. The game mod should use `"place": "none"` in its `mod.json` (section 7).

### Placement trade-offs

| | (a) Bottom strip | (b) Right panel | (c) Own pane (stack) | (d) Floating drawer |
|---|---|---|---|---|
| Terminal space lost | 112 px of height (72–260) | 320 px of width (260–560), more when Files is also open | none while terminals show; **all** while the game shows | none for layout; 52 px peek **over** terminal text plus 12 px margin |
| Always visible at a glance | yes | yes | no (one or the other) | yes (peek strip) |
| Resizable by drag | yes (new `work-split` column) | yes (`work-body` row boundary) | n/a | no (content-sized; dragged between edges and thirds) |
| Show/hide with a key | `layout.toggle:game-strip` | `layout.toggle:game-panel` | object binding `layout.select` | **no command**; the mod collapses itself via `my-game.<cmd>` |
| Room for 30+ agents | a row of chips scrolls horizontally | best: a vertical list with room for names | best: full canvas | poor: narrow vertical, peek shows only icons |
| Clicking keeps terminals usable | yes | yes | user must switch back | the drawer occludes the terminal area under it (`src/window/floats.rs:202`) |
| Mod commands reach it | while not hidden | while not hidden | only while the game child is active | while the owner is visible |
| Risk | squeezes short windows; the `work` column has `resizable:false`, hence the wrapper | conflicts with the Files/Changes panel on narrow screens | the tabs bar keeps changing tabs behind a hidden tab block [I] | covers the right columns of each terminal; no resize |

### (a) Bottom strip: complete `layouts/MyGame.json`

`work-body` and the new strip are wrapped in a `work-split` column. That column is resizable by default, while the outer `work` column stays `resizable:false` (`src/layout.rs:530-532`, `src/window.rs:4894`), so only the strip's top edge can be dragged. The divider is transparent and lights `accent` on hover (`src/layout.rs:107-113`). `work-body` gets `min: 200`, which the drag clamps to because it is the first child (`src/window.rs:4915-4917`).

```json
{
  "id": "root",
  "type": "row",
  "titlebar": "none",
  "traffic_lights": [12, 16],
  "background": "canvas",
  "terminal_padding": [14, 12],
  "divider": {"width": 1, "color": "border"},
  "children": [
    {
      "id": "sidebar",
      "type": "column",
      "size": {"px": 268},
      "min": 44,
      "max": 480,
      "background": "chrome",
      "resizable": false,
      "children": [
        {
          "id": "brand",
          "type": "block",
          "size": {"px": 46},
          "window_drag": true,
          "content": {"mod": "workspace-chrome"}
        },
        {
          "id": "sidebar-lists",
          "type": "column",
          "children": [
            {
              "id": "spaces",
              "type": "block",
              "size": {"weight": 1},
              "min": 90,
              "content": {"mod": "spaces"}
            },
            {
              "id": "agents",
              "type": "block",
              "size": {"weight": 1},
              "min": 90,
              "content": {"mod": "agents"}
            }
          ]
        },
        {
          "id": "sidebar-footer",
          "type": "block",
          "size": {"px": 69},
          "content": {"mod": "workspace-chrome", "props": {"footer": true}}
        }
      ]
    },
    {
      "id": "work",
      "type": "column",
      "resizable": false,
      "children": [
        {
          "id": "tabs",
          "type": "block",
          "size": {"px": 42},
          "window_drag": true,
          "content": {"mod": "tabs"}
        },
        {
          "id": "work-split",
          "type": "column",
          "divider": {"width": 1, "color": "#00000000", "hover": "accent"},
          "children": [
            {
              "id": "work-body",
              "type": "row",
              "padding": 8,
              "gap": 8,
              "children": [
                {
                  "id": "main",
                  "type": "block",
                  "content": {
                    "tab": "active",
                    "pane": {
                      "gap": 8,
                      "radius": 10,
                      "background": "background",
                      "lone": true,
                      "border": {"width": 1, "color": "border"},
                      "focus": {"width": 1, "color": "accent"},
                      "header": {
                        "content": {"mod": "pane"},
                        "height": 30,
                        "position": "top",
                        "reveal": "always"
                      }
                    }
                  }
                },
                {
                  "id": "panel",
                  "type": "column",
                  "hidden": true,
                  "size": {"px": 368},
                  "min": 280,
                  "max": 900,
                  "children": [
                    {
                      "id": "panel-body",
                      "type": "stack",
                      "active": "files",
                      "children": [
                        {"id": "files", "type": "block", "content": {"mod": "files"}},
                        {"id": "changes", "type": "block", "content": {"mod": "changes"}}
                      ]
                    }
                  ]
                }
              ],
              "min": 200
            },
            {
              "id": "game-strip",
              "type": "block",
              "size": {"px": 112},
              "min": 72,
              "max": 260,
              "background": "chrome",
              "content": {"mod": "my-game", "props": {"role": "strip"}}
            }
          ]
        },
        {
          "id": "status",
          "type": "block",
          "size": {"px": 28},
          "content": {"mod": "workspace-status"}
        }
      ]
    }
  ],
  "preview": "mods/my-game/art/layout-preview.png"
}
```

### (b) Right-side panel

`game-panel` is the last child of `work-body`, after the hidden Files/Changes `panel`. `main` gets `min: 320`, which is clamped while dragging because `main` is the left child (`src/window.rs:4915-4917`).

<details><summary>Complete layouts/MyGame.json (right panel)</summary>

```json
{
  "id": "root",
  "type": "row",
  "titlebar": "none",
  "traffic_lights": [12, 16],
  "background": "canvas",
  "terminal_padding": [14, 12],
  "divider": {"width": 1, "color": "border"},
  "children": [
    {
      "id": "sidebar",
      "type": "column",
      "size": {"px": 268},
      "min": 44,
      "max": 480,
      "background": "chrome",
      "resizable": false,
      "children": [
        {
          "id": "brand",
          "type": "block",
          "size": {"px": 46},
          "window_drag": true,
          "content": {"mod": "workspace-chrome"}
        },
        {
          "id": "sidebar-lists",
          "type": "column",
          "children": [
            {
              "id": "spaces",
              "type": "block",
              "size": {"weight": 1},
              "min": 90,
              "content": {"mod": "spaces"}
            },
            {
              "id": "agents",
              "type": "block",
              "size": {"weight": 1},
              "min": 90,
              "content": {"mod": "agents"}
            }
          ]
        },
        {
          "id": "sidebar-footer",
          "type": "block",
          "size": {"px": 69},
          "content": {"mod": "workspace-chrome", "props": {"footer": true}}
        }
      ]
    },
    {
      "id": "work",
      "type": "column",
      "resizable": false,
      "children": [
        {
          "id": "tabs",
          "type": "block",
          "size": {"px": 42},
          "window_drag": true,
          "content": {"mod": "tabs"}
        },
        {
          "id": "work-body",
          "type": "row",
          "padding": 8,
          "gap": 8,
          "children": [
            {
              "id": "main",
              "type": "block",
              "content": {
                "tab": "active",
                "pane": {
                  "gap": 8,
                  "radius": 10,
                  "background": "background",
                  "lone": true,
                  "border": {"width": 1, "color": "border"},
                  "focus": {"width": 1, "color": "accent"},
                  "header": {"content": {"mod": "pane"}, "height": 30, "position": "top", "reveal": "always"}
                }
              },
              "min": 320
            },
            {
              "id": "panel",
              "type": "column",
              "hidden": true,
              "size": {"px": 368},
              "min": 280,
              "max": 900,
              "children": [
                {
                  "id": "panel-body",
                  "type": "stack",
                  "active": "files",
                  "children": [
                    {"id": "files", "type": "block", "content": {"mod": "files"}},
                    {"id": "changes", "type": "block", "content": {"mod": "changes"}}
                  ]
                }
              ]
            },
            {
              "id": "game-panel",
              "type": "block",
              "size": {"px": 320},
              "min": 260,
              "max": 560,
              "radius": 10,
              "border": {"width": 1, "color": "border"},
              "background": "chrome",
              "content": {"mod": "my-game", "props": {"role": "panel"}}
            }
          ]
        },
        {
          "id": "status",
          "type": "block",
          "size": {"px": 28},
          "content": {"mod": "workspace-status"}
        }
      ]
    }
  ],
  "preview": "mods/my-game/art/layout-preview.png"
}
```
</details>

### (c) Its own pane: a stack beside the tab

`main` and a full-size `game-home` block sit in a stack called `center`. This exact "home page in a stack beside the tab" pattern is tested: `layout.select` switches between them, and showing the tab again gives its pane the keyboard (`src/window.rs:6920-6948`). When the stack is not showing the tab block, `shows_tab()` is false and the pane frame is not drawn (`src/window.rs:1442-1444`, `src/window.rs:4571-4578`). A copy in the inactive child is **not shown**, so `my-game.*` commands do not reach it (`src/window.rs:4122-4125`). The switch key must therefore be an app command.

<details><summary>Complete layouts/MyGame.json (own pane)</summary>

```json
{
  "id": "root",
  "type": "row",
  "titlebar": "none",
  "traffic_lights": [12, 16],
  "background": "canvas",
  "terminal_padding": [14, 12],
  "divider": {"width": 1, "color": "border"},
  "children": [
    {
      "id": "sidebar",
      "type": "column",
      "size": {"px": 268},
      "min": 44,
      "max": 480,
      "background": "chrome",
      "resizable": false,
      "children": [
        {
          "id": "brand",
          "type": "block",
          "size": {"px": 46},
          "window_drag": true,
          "content": {"mod": "workspace-chrome"}
        },
        {
          "id": "sidebar-lists",
          "type": "column",
          "children": [
            {
              "id": "spaces",
              "type": "block",
              "size": {"weight": 1},
              "min": 90,
              "content": {"mod": "spaces"}
            },
            {
              "id": "agents",
              "type": "block",
              "size": {"weight": 1},
              "min": 90,
              "content": {"mod": "agents"}
            }
          ]
        },
        {
          "id": "sidebar-footer",
          "type": "block",
          "size": {"px": 69},
          "content": {"mod": "workspace-chrome", "props": {"footer": true}}
        }
      ]
    },
    {
      "id": "work",
      "type": "column",
      "resizable": false,
      "children": [
        {
          "id": "tabs",
          "type": "block",
          "size": {"px": 42},
          "window_drag": true,
          "content": {"mod": "tabs"}
        },
        {
          "id": "work-body",
          "type": "row",
          "padding": 8,
          "gap": 8,
          "children": [
            {
              "id": "center",
              "type": "stack",
              "active": "main",
              "children": [
                {
                  "id": "main",
                  "type": "block",
                  "content": {
                    "tab": "active",
                    "pane": {
                      "gap": 8,
                      "radius": 10,
                      "background": "background",
                      "lone": true,
                      "border": {"width": 1, "color": "border"},
                      "focus": {"width": 1, "color": "accent"},
                      "header": {
                        "content": {"mod": "pane"},
                        "height": 30,
                        "position": "top",
                        "reveal": "always"
                      }
                    }
                  },
                  "title": "Terminals"
                },
                {
                  "id": "game-home",
                  "type": "block",
                  "title": "Game",
                  "radius": 10,
                  "border": {"width": 1, "color": "border"},
                  "background": "chrome",
                  "content": {"mod": "my-game", "props": {"role": "home"}}
                }
              ]
            },
            {
              "id": "panel",
              "type": "column",
              "hidden": true,
              "size": {"px": 368},
              "min": 280,
              "max": 900,
              "children": [
                {
                  "id": "panel-body",
                  "type": "stack",
                  "active": "files",
                  "children": [
                    {"id": "files", "type": "block", "content": {"mod": "files"}},
                    {"id": "changes", "type": "block", "content": {"mod": "changes"}}
                  ]
                }
              ]
            }
          ]
        },
        {
          "id": "status",
          "type": "block",
          "size": {"px": 28},
          "content": {"mod": "workspace-status"}
        }
      ]
    }
  ],
  "preview": "mods/my-game/art/layout-preview.png"
}
```
</details>

Alternative with no layout change: `tab.new {"mod":"my-game","props":{"role":"tab"},"name":"Game"}` makes a real Herdr tab whose only pane is the game. It works in any layout, including `main`, but it lives in a single space (`src/commands.rs:37-38`).

### (d) Floating drawer

The float sits on `main`, so it stays over the terminal area and moves left when the Files panel opens. Floats render inside their owner node, which clips with `overflow_hidden` (`src/window.rs:4624`, `src/window.rs:4685`). `peek: 52` shows 52 px until hovered; then it slides open over 220 ms and closes 280 ms after the pointer leaves (`src/window/floats.rs:22-24`). The mod must draw one fixed-size layout with status icons on the edge side (`defaults/AGENTS.md:442-454`), and must mirror its rows on the right edge.

<details><summary>Complete layouts/MyGame.json (floating drawer)</summary>

```json
{
  "id": "root",
  "type": "row",
  "titlebar": "none",
  "traffic_lights": [12, 16],
  "background": "canvas",
  "terminal_padding": [14, 12],
  "divider": {"width": 1, "color": "border"},
  "children": [
    {
      "id": "sidebar",
      "type": "column",
      "size": {"px": 268},
      "min": 44,
      "max": 480,
      "background": "chrome",
      "resizable": false,
      "children": [
        {
          "id": "brand",
          "type": "block",
          "size": {"px": 46},
          "window_drag": true,
          "content": {"mod": "workspace-chrome"}
        },
        {
          "id": "sidebar-lists",
          "type": "column",
          "children": [
            {
              "id": "spaces",
              "type": "block",
              "size": {"weight": 1},
              "min": 90,
              "content": {"mod": "spaces"}
            },
            {
              "id": "agents",
              "type": "block",
              "size": {"weight": 1},
              "min": 90,
              "content": {"mod": "agents"}
            }
          ]
        },
        {
          "id": "sidebar-footer",
          "type": "block",
          "size": {"px": 69},
          "content": {"mod": "workspace-chrome", "props": {"footer": true}}
        }
      ]
    },
    {
      "id": "work",
      "type": "column",
      "resizable": false,
      "children": [
        {
          "id": "tabs",
          "type": "block",
          "size": {"px": 42},
          "window_drag": true,
          "content": {"mod": "tabs"}
        },
        {
          "id": "work-body",
          "type": "row",
          "padding": 8,
          "gap": 8,
          "children": [
            {
              "id": "main",
              "type": "block",
              "content": {
                "tab": "active",
                "pane": {
                  "gap": 8,
                  "radius": 10,
                  "background": "background",
                  "lone": true,
                  "border": {"width": 1, "color": "border"},
                  "focus": {"width": 1, "color": "accent"},
                  "header": {"content": {"mod": "pane"}, "height": 30, "position": "top", "reveal": "always"}
                }
              },
              "floating": [
                {
                  "id": "game-drawer",
                  "content": {"mod": "my-game", "props": {"role": "drawer"}},
                  "edge": "right",
                  "align": "center",
                  "peek": 52
                }
              ]
            },
            {
              "id": "panel",
              "type": "column",
              "hidden": true,
              "size": {"px": 368},
              "min": 280,
              "max": 900,
              "children": [
                {
                  "id": "panel-body",
                  "type": "stack",
                  "active": "files",
                  "children": [
                    {"id": "files", "type": "block", "content": {"mod": "files"}},
                    {"id": "changes", "type": "block", "content": {"mod": "changes"}}
                  ]
                }
              ]
            }
          ]
        },
        {
          "id": "status",
          "type": "block",
          "size": {"px": 28},
          "content": {"mod": "workspace-status"}
        }
      ]
    }
  ],
  "preview": "mods/my-game/art/layout-preview.png"
}
```
</details>

### Matching keys.json (merged into the person's file)

```json
{
  "layout:MyGame": {
    "ctrl-shift-g": "layout.toggle:game-strip",
    "ctrl-shift-j": "my-game.collect"
  }
}
```

- `layout:MyGame` scopes the keys to our layout, so they do nothing elsewhere and cannot raise "no node" toasts in other layouts (`src/window.rs:3641`). The section name must match the file stem exactly.
- `ctrl-shift-g` and `ctrl-shift-j` are not bound by `defaults/keys.json` or by the `cmd-*` chords in `keys.macos.json`. [I] A `terminal` binding of the same chord would beat `layout:` (`defaults/AGENTS.md:551-552`), and none exists by default.
- For (c), the switch needs two arguments, so use an object binding: `{"command":"layout.select","args":{"stack":"center","child":"game-home"}}`. It shows as raw JSON in the Keys overlay (section 4). A `mod.json` `palette` entry with the same command and args gives it a readable name (`defaults/AGENTS.md:931-938`).
- For (d), use `my-game.<cmd>` to collapse or expand, because no app command toggles floats.

## Implications for our game (do / don't)

**Do**
1. Name the layout `layouts/<Name>.json` with `<Name>` matching `^[A-Za-z0-9_-]+$` (`src/mods.rs:219-221`). The file stem appears as is in Settings and the Keys overlay (`(layout:<Name>)`), and with a capitalised first letter in the palette. Pick a stem that reads well as is, such as `Lanternfold`, and never use `main`, `terminals` or `win98`.
2. Name the mod folder in lower case with hyphens, never starting with `.` or `frame-`, and never containing `.`, because `<mod>.<command>` splits at the first dot (`src/keys.rs:164`, `src/window.rs:3099`). The Keys overlay shows it as `(mod:<folder>)`.
3. Ship `mods/<name>/mod.json` with `"place": "none"` and make sure it is valid JSON. An invalid file falls back to docking at `"right"` with 320 px into whatever personal layout the person has (`src/mods.rs:410-411`, `src/window.rs:4518-4531`).
4. Keep every id from `main.json` (`sidebar`, `panel`, `panel-body`, `files`, `changes`, `main`, `tabs`, `status`, and the rest). Give every node and float an explicit, unique id; a missing node id makes herdr rewrite our file, and a missing float id is a parse error.
5. Put the Settings preview inside the mod folder and point the root `preview` at it. Draw it at about 1.75:1 (shown at roughly 108×62). Also ship `preview.png` at the repo root for herdr.dev.
6. Use theme token names in the layout (`chrome`, `canvas`, `border`, `accent`), not hex, and leave `theme` and `colors` unset, as `main` does, so the person's light/dark choice applies. Inside the mod, draw with hex from a palette chosen by `settings().dark` or `theme()`.
7. Use `props.role` to tell copies apart (strip, panel, home, drawer). Remember every block is its own copy running its own timers, so the save file must be shared or locked across copies and across windows.
8. Bind keys in a `layout:<Name>` section using string actions (`cmd:value`), which display well. Use `<mod>.<command>` only for copies that are visible.
9. Make our keys.json flawless and free of conflicts: one bad entry disables the whole file, and on first load that leaves the person with none of their keys (`src/keys.rs:245`, `src/window.rs:995-1000`). Check every action against `commands()` or `<mod>.<cmd>`, and every chord against both default key files.
10. Prefer layout (a) or (b) as the main design. They keep terminals live and visible, resize by drag and toggle with one key. If we use (d), give the mod its own collapse command.

**Don't**
1. Don't add the game under `panel-body`: the tabs mod hides that panel when the space changes.
2. Don't write `"<mod>:<command>"` (the herdr.d.ts comment is wrong). It makes the whole keys.json invalid.
3. Don't put a string value under a key named `"mod"` anywhere in props. `missing_mods` would treat it as a required mod and could hide the layout (`src/window.rs:233-249`).
4. Don't rely on `title` to name the layout. Nothing reads it for that purpose.
5. Don't expect `layout.toggle` to hide a float, or `my-game.*` commands to reach a hidden or inactive-stack copy.
6. Don't rely on unknown or misspelled layout fields producing errors. They are silently ignored, so validate the JSON in our own tooling against the field list in section 2.
7. Don't set a block-level `theme` or `font`. Only the root look applies today.
8. Don't reference `preview.png` from the repo root in the layout's `preview`, because install leaves it out.

## Open questions

1. Does `"layout:<Name>"` with an upper-case name behave identically on case-insensitive filesystems (macOS) if a person also has `<name>.json` in lower case? `layout_names()` would list both, since it reads directory entries, but the two files would be the same file on disk. Not resolved.
2. [I] What `nextCommand()` receives for `"<mod>.<cmd>:<value>"` was reasoned from `src/window.rs:3081-3101`, not seen in a test.
3. Is `keys.json` officially part of a **layout** share, or only of a mod share? The doc mentions it only for mods (`defaults/AGENTS.md:485-486`). The user's brief requires it, and the install steps would merge it either way.
4. How the herdr.dev site itself renders `RECIPE.md`/`preview.png`, and whether it shows the file stem or the repo name, is not in this source tree.
5. Where a `tab.new {mod}` pane persists across restarts and machines (the view or the core document), and whether it survives a layout switch, was not traced beyond `defaults/AGENTS.md:952`.
6. Is the precedence of a `layout:` binding over a key that an unfocused mod or a terminal program would otherwise receive exactly what AGENTS.md describes? This relies on GPUI context depth ordering (`src/keys.rs:115-118`) and was not tested here.
7. Multi-window: `shared("layout")` is one value, so each window's own layout choice was not traced in this topic.

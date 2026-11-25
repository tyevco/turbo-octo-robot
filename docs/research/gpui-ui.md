# gpui-kit / gpui-base UI surface available to herdr mods

Source: herdr-app v0.1.18 (commit a2e8e3f), read-only clone. All paths below are
relative to the herdr-src root. "Verified" = read in source at the cited line.
"Inferred" = a conclusion drawn from source but not directly stated or not
exercised (nothing was built or run).

Companion files:

- `docs/research/gpui-kit.d.ts`: the reconstructed `gpui-kit.d.ts` (22 384 lines,
  797 752 bytes, sha256 `572c2b39e0303a840cc47bc0df646d539abd2aa7006509e6ea6cb8629606799e`).
- `docs/research/tools/gen-gpui-kit-dts.py`: the script that rebuilt it from the
  Rust sources (reads files only).

---

## 1. How herdr writes `gpui-kit.d.ts`, and how it was reconstructed

### 1.1 Who writes it, when, where (verified)

| Fact | Source |
|---|---|
| `mods::write_workspace()` writes `<app_dir>/gpui-kit.d.ts` from `gpui_shell::type_declarations(&gpui_shell::FrozenComponentRegistry::default())`, only if changed | src/mods.rs:84-86 |
| `type_declarations` is `typings::declarations_with_components(components)` | vendor/gpui-kit/crates/shell/src/lib.rs:146-148 |
| `write_workspace()` runs at startup **before** `mods::install_policy()` registers the `herdr` host module | src/main.rs:180 vs src/main.rs:223, src/mods.rs:1432-1437 |
| The default policy starts with an empty `HostModules` | vendor/gpui-kit/crates/shell/src/policy.rs:123-127, :251 |
| So the app-dir copy has **no** `declare module "herdr"` block (host_modules() emits nothing) | typings.rs:457-503 + the two rows above (inferred from ordering) |
| The shell **also** writes `gpui-kit.d.ts` (and `jsconfig.json` if neither `jsconfig.json` nor `tsconfig.json` exists) into every application root / directory whose `.js`/`.mjs` imports a built-in specifier, on code load (cache miss) | engine/quickjs/mod.rs:2357-2362, typings.rs:512-554, :158-172, :622-650 |
| AGENTS.md confirms the app writes `jsconfig.json` and `.d.ts` into mod folders and that those writes do not trigger a reload | defaults/AGENTS.md:942-944 |
| A per-mod copy written at load time is generated while the `herdr` module is registered, so it will additionally contain `declare module "herdr" { … }` (herdr.d.ts re-indented) before the `window` global block | typings.rs:286-288, :457-469; src/mods.rs:1130-1131 (`.declarations(DECLARATIONS)`) — **inferred** |
| Refuses to replace a symlinked `gpui-kit.d.ts` | typings.rs:656-662 |

### 1.2 How the text is built (verified)

`declarations_with_components` (typings.rs:184-354) concatenates, in order:

1. `PREAMBLE` with `{version}` → `gpui_shell` crate version `0.7.1`
   (typings.rs:895-924; plugin.rs:56 `env!("CARGO_PKG_VERSION")`; vendor/gpui-kit/crates/shell/Cargo.toml:4).
2. `declare module "gpui-kit" {` + `VALUE_TYPES` (typings.rs:926-959) + `color_types()` (:751-760) +
   `role_type()` (:775-792, from the `roles!` list in a11y.rs:54-73) + `anchor_type()` (:794-813, from
   `ANCHOR_NAMES` materialize.rs:3345-3354) + `CONTEXT_AND_VIEW` (:961-1283).
3. `Element` type = `NativeElement` plus one `| import("gpui-component").XElement` per registered component
   descriptor (:202-210). The default registry is empty (component_registry.rs:2321-2330 `#[derive(Default)]`),
   so it is just `export type Element = NativeElement;`.
4. `interface NativeElement {` + `ELEMENT_METHODS` (:1292-2035) + 3 inline-token methods (:214) +
   `parametric_styles` (:822-838) + `nullary_styles` (:840-857).
5. `ELEMENTS` (:2117-2271), `WINDOW` (:2290-2438), `CAPABILITIES` (:3868-3912), `SCHEDULING` (:4080-4096).
6. `declare module "gpui"` alias; `"gpui-base"` (BASE_IMPORTS, ColorToken union from theme_tokens.rs:87-106,
   BASE_SHARED_TYPES, INLINE_TOKEN_TYPES, BASE :2460-3816); `"gpui-component"` (import line +
   INLINE_TOKEN_TYPES only, registry empty); `"gpui-shell"` (`shell_types()` :2037-2054 + `SHELL_TYPES`);
   `"gpui-fps"`; `STANDARD_RUNTIME`; `host_modules()`; `WINDOW_GLOBAL`.

The style method list is **generated from reflection**, not a literal:

- `style::known_names()` = sorted, deduped union of reflected nullary methods + `EXTRA_NULLARY` (9 font
  weights) + `PARAM_STYLES` (59 names) (style.rs:552-563, :224-234, :86-213).
- Reflected nullary methods come from `gpui_base::styled_ext_reflection_methods` then
  `gpui::styled_reflection::methods` (style.rs:242-268), produced by the proc-macro
  `derive_inspector_reflection` from gpui-pre-macros 0.3.8, which **expands** the nine style macros
  (`style_helpers!`, `margin_style_methods!`, …) before reflecting (crate source, `derive_inspector_reflection.rs`
  `try_expand_macro`), and keeps only `fn name(self|mut self) -> Self` with exactly one parameter.
- Parametric argument types are probed (`argument_of`, typings.rs:727-749): Color if `"#ff0000"` is accepted,
  else Length if `"auto"`, else DefiniteLength if `"50%"`, else AbsoluteLength if `"12px"`, else number;
  `font_family` → string, `font_weight` → number.
- Doc comments: `style::documentation` (style.rs:339-356) → `doc_comment` (typings.rs:867-893).

### 1.3 Reconstruction method and confidence

- The gpui-pre-macros 0.3.8 crate was fetched from crates.io only to **read** `styles.rs` and
  `derive_inspector_reflection.rs`; its sha256 `d2ad26ca…a9f4` matches Cargo.lock:3242-3245. Nothing was compiled or run.
- `gen-gpui-kit-dts.py` extracts every raw-string constant verbatim from typings.rs, re-implements the macro
  generators (box/corner/border prefixes × suffixes, `_neg` variants, docs `"{prefix}\n\n{suffix}"`), parses the
  hand-written `Styled` (vendor/gpui-pre/src/styled.rs:22-904) and `StyledExt` (vendor/gpui-kit/crates/base/src/styled.rs:78-203)
  traits, and applies `doc_comment` exactly.
- Release build assumed: `debug()` and `debug_below()` are `#[cfg(debug_assertions)]` (vendor/gpui-pre/src/styled.rs:892-903)
  and are omitted. A debug build would have 3148 nullary methods instead of 3146.
- Self-checks against the in-tree unit tests (typings.rs `a_reflected_style_is_declared_with_no_arguments`,
  `a_parametric_style_is_declared_with_the_type_the_runtime_enforces`, `colors_require_concrete_values…`,
  `every_element_method_is_accounted_for`): all anchors present; style count 3205 = 3146 nullary + 59 parametric.
  (The last test would see one extra non-style method, `on_size_change`, a HERDR addition missing from
  `NON_STYLE_METHODS` — a stale upstream test, not a reconstruction error.)
- Confidence: high for structure and names; byte-exactness of reflected doc text depends on my re-implementation
  of `quote!`'s `///` → `#[doc = " …"]` conversion (leading space stripped by `extract_doc_comment`).

---

## 2. Module exports (what can actually be imported) — verified

engine/quickjs/mod.rs:1117-1225, wired by `builtin_modules!` at :1302-1308.

| Specifier | Exports |
|---|---|
| `"gpui-kit"` (alias `"gpui"`) | `View`, `div`, `svg`, `image`, `list`, `uniform_list`, `PathBuilder`, `Background` |
| `"gpui-base"` | `h_flex`, `v_flex`, `Button`, `Link`, `Checkbox`, `Switch`, `Tabs`, `Tab`, `Progress`, `ProgressTrack`, `ProgressIndicator`, `Avatar`, `AvatarImage`, `AvatarFallback`, `Pagination`, `pagination_items`, `CalendarState`, `Accordion*` (5), `Radio`, `Toggle`, `RadioGroup`, `ToggleGroup`, `Table*` (7), `h_resizable`, `v_resizable`, `resizable_panel`, `Collapsible`, `Popover`, `HoverCard`, `Popup`, `Select`, `Combobox`, `DatePicker`, `Scrollbar`, `v_virtual_list`, `h_virtual_list`, `VirtualListScrollHandle`, `ScrollHandle`, `Input`, `InputState`, `NumberInput`, `Editor`, `EditorState`, `Textarea`, `TextView`, `TextareaState`, `SliderState`, `Slider`, `SliderTrack`, `SliderIndicator`, `SliderThumb`, `OtpState`, `OtpInput`, `DockArea`, `dock_area`, `dock_content`, `set_theme` |
| `"gpui-fps"` | `fps_monitor`, `show_fps_monitor`, `hide_fps_monitor`, `fps_monitor_visible` |
| `"gpui-shell"` | nothing (types only) |
| global | `window` (`paint_path`, dialogs, sheets, toasts, measurements), `localStorage`, `sessionStorage`, `console`, `fetch`, `process` (typings.rs:4053-4078, :4045-4050) |

**Not available** (verified absent from the export lists above): `text()`, `img()`, `canvas()`, `anchored`,
`deferred`, any z-index, `rotate`/`transform` style, `shadow(list)`, `cursor(enum)`, `line_clamp(n)`,
`text_align(enum)`, `aspect_ratio(n)`, `grid_cols(n)`. A string or number child *is* text
(prelude `childId`, engine/quickjs/mod.rs:5874-5900; typings.rs:1299-1311). The `text(...)` in some doc
examples (typings.rs `v_virtual_list` example) is not an export.

---

## 3. Element constructors

| Constructor | Signature (typings) | Notes (verified unless marked) |
|---|---|---|
| `div()` | `div(): NativeElement` typings.rs:2119 | plain block; becomes stateful when it needs identity (§6) |
| `h_flex()` / `v_flex()` | typings.rs:2461-2463 | from `"gpui-base"`. `h_flex` = flex row **+ items_center**; `v_flex` = flex col (stretch) — base/src/styled.rs:84-114. Also available as nullary styles `.h_flex()` / `.v_flex()` on any element |
| `svg(path)` | typings.rs:2129 | monochrome, always tinted with the inherited/own `text_color` (materialize.rs:1474-1491: `image.style().text.color = Some(inherited)`). Rendered as an alpha mask at element size (crisp). No handlers/hover/tooltip wired on it |
| `image(path)` | typings.rs:2138 | full colour; PNG/JPEG/GIF/WebP/SVG. Gets `.id(element_id(...))` for animated frame state (materialize.rs:1527-1536). SVG via `image()` is rasterised **once at 2× its intrinsic size** (gpui-pre/src/elements/img.rs:774-776 `render_single_frame(&bytes, 1.0)`; svg_renderer.rs:81 `SMOOTH_SVG_SCALE_FACTOR: f32 = 2.`, :203-206) → blurry if drawn larger than 2× its `width`/`height` |
| `list(id, item_count, get_key, render)` | typings.rs:2192-2197 | variable heights, host entered once per visible item per frame; needs definite height; no handlers inside `render` |
| `uniform_list(id, item_count, get_key, render)` | typings.rs:2216-2221 | first row measured; one call per frame |
| `v_virtual_list` / `h_virtual_list(id, count, sizes, get_key, render)` | typings.rs:3080-3094 | `"gpui-base"`; sizes number or array of exactly `item_count`; use `on_item_click(key)`; `track_scroll(VirtualListScrollHandle)` |
| `window.paint_path(path, background)` | typings.rs:2350 | the **only** runtime vector drawing; see §8 |
| `TextView.markdown(id, md)` / `.html(id, html)` | typings.rs:2511-2514 | rich text; `.selectable()`, `.scrollable()`, `.raw_html(false)`, `.on_link_click`, `.on_selection_change`, `.highlight_range(start,end,Color)` (HERDR) |
| `Button.new(id)`, `Checkbox.new(id)`, `Switch.new(id)`, `Toggle.new(id)`, `Radio.new(id)` | typings.rs:2466-2472 etc.; prelude mod.rs:7202-7206, :7248-7249 | **unstyled**: no visuals at all (AGENTS.md:1161-1162). `Checkbox`/`Switch`/`Radio`: `.checked(bool)` + `.on_change((checked,cx)=>…)` (typings.rs:1593-1600); `Toggle`: `.pressed(bool)` |
| `InputState.new({placeholder?, value?})` + `Input.new(state)` | typings.rs:3215-3220 | state only in `init`/handlers, never `render` |
| `Progress.new(id)` + `ProgressTrack.new()` + `ProgressIndicator.new()` | typings.rs:2522-2545 | Progress itself draws nothing; size the indicator yourself |
| `Popover`, `HoverCard`, `Popup.new(id, trigger)` | typings.rs:2876, :2885, :2910 | content painted "in a layer above the rest of the window" (typings.rs:1317-1321, :2892) |
| `Scrollbar.vertical(id)` | typings.rs:3014-3021 | pairs by id with an `overflow_*_scroll` area or list |
| `fps_monitor()` | `"gpui-fps"` | debugging |

Asset path resolution (verified):

- Root is the **application root of the asset source**, which herdr sets to `mods::app_dir()`
  (`~/.config/herdr-app`): src/main.rs:186 `.with_assets(gpui_shell::AppAssets::new(mods::app_dir()).following_links())`.
  So paths are `mods/<name>/art/x.svg`, **not** relative to the module file (assets.rs:1-15; AGENTS.md:954-957).
- `..` anywhere → refused (`"`{path}` is outside the application directory"`, assets.rs:113-116); leading `/` and
  `.` components are dropped (assets.rs:74-84), so `"/mods/x.svg"` == `"mods/x.svg"`.
- Links out of the folder are followed in herdr (`following_links`, assets.rs:44-51).
- Max asset size `MAX_ASSET_BYTES: u64 = 16 * 1024 * 1024` (assets.rs:27); larger → error
  `"asset `{path}` is {size} bytes, over the {MAX_ASSET_BYTES}-byte limit"`.
- Missing asset: draws nothing, warns once per path:
  `"asset `{requested}` was not found at {}; asset paths resolve against the application directory, not against the file that asked for them"` (assets.rs:230-242).
- `image()` strings that parse as a URL (`url::Url::from_str`) become `Resource::Uri` and are fetched through
  GPUI's HTTP client (gpui-pre/src/elements/img.rs:54-82, :661-680). `svg()` has no such path. **Inferred**:
  `data:` URIs parse as URLs but an HTTP client cannot serve them, so inline/data SVG is not a usable route.
- Saving an asset under `mods/` refreshes every mod showing it (AGENTS.md:956-957) — but saving any file in the
  mod folder also **reloads the mod** (AGENTS.md:942-944). **Inferred**: runtime-generated SVG files must not be
  written into `mods/<name>/`.

Inline / runtime SVG: **not supported** by `svg()`/`image()` (they take a path string only; prelude
mod.rs:7159-7160, `text_constructor` mod.rs:9195-9207 performs no other interpretation). Runtime vector art
must use `PathBuilder` + `window.paint_path` (§8).

---

## 4. Style methods

### 4.1 Parametric (59, hand-bound) — verified style.rs:86-213, :412-524; types probed (typings.rs:727-749)

| Group | Methods | Arg type | Accepts |
|---|---|---|---|
| Size | `w h size min_w min_h min_size max_w max_h max_size` | `Length` | number px, `"Npx"`, `"Nrem"`, `"N%"`, `"auto"` |
| Padding | `p px py pt pb pl pr` | `DefiniteLength` | no `"auto"` |
| Margin | `m mx my mt mb ml mr` | `Length` | |
| Position | `inset top bottom left right` | `Length` | |
| Flex | `gap gap_x gap_y` (DefiniteLength), `flex_grow flex_shrink` (number), `flex_basis` (Length) | | |
| Paint | `bg text_color text_bg border_color` | `Color` | hex string only |
| Text | `text_size` (AbsoluteLength), `font_family` (string), `font_weight` (number 100..=900), `line_height` (DefiniteLength; bare number = **multiplier**) | | |
| Opacity | `opacity` | number | "element and everything in it, from 0 to 1" |
| Border | `border border_t border_b border_l border_r border_x border_y` | `AbsoluteLength` | no `%`/`auto` |
| Radius | `rounded rounded_t rounded_b rounded_l rounded_r rounded_tl rounded_tr rounded_bl rounded_br` | `AbsoluteLength` | `rounded("50%")` throws |

- Numbers are px **times herdr's zoom** (`scaled_px`, value.rs:12-27; set from settings.rs:782). `rem` uses
  `rems(value)`; `px`-suffixed strings also go through `scaled_px` (style.rs:597-603).
- Exact errors (style.rs): `"`{method}` expects a length: a number of pixels, or a string like \"50%\", \"12px\", \"1rem\" or \"auto\"; got \"{text}\""` (:605-608);
  `"`{method}` cannot be \"auto\"; it expects a definite length such as 12 or \"50%\""` (:652-654);
  `"`{method}` expects an absolute length such as 8 or \"0.5rem\"; percentages and \"auto\" are not allowed here"` (:661-664);
  `"`{method}` expects a finite number between 100 and 900; got {value}"` (:642-644);
  `"`{method}` expects at least {} argument(s), got {}"` (value.rs:136-143);
  unknown: `"unknown style method `{name}` (did you mean: {candidate}?)"` (style.rs:565-570).
- Validated **eagerly at the call site** and thrown as a `TypeError` during `render` (engine/quickjs/mod.rs:8250-8255).
- Passing an object (e.g. a `Background`) to `bg` throws `"unsupported argument type; expected null, boolean, number, string or function"`
  (mod.rs:10252-10266). **There is no gradient `bg`.**

### 4.2 Nullary (3146 in a release build) — generated, see `gpui-kit.d.ts` lines 1486-20675

| Family | Pattern / members | Source |
|---|---|---|
| Spacing ramps | `{w,h,size,min_size,min_w,min_h,max_size,max_w,max_h}_{0,0p5,1,1p5,2,2p5,3,3p5,4,5,6,7,8,9,10,11,12,16,20,24,32,40,48,56,64,72,80,96,112,128,auto,px,full,1_2,1_3,2_3,1_4,2_4,3_4,1_5,2_5,3_5,4_5,1_6,5_6,1_12}` + `_neg_` variants (no `neg_auto`); `gap`, `gap_x`, `gap_y` same minus `auto` | macros styles.rs `box_prefixes`, `box_style_suffixes` |
| Margin / padding / inset ramps | `m mt mb my mx ml mr`, `p pt pb px py pl pr` (no `auto`), `inset top bottom left right` — same suffixes and `_neg_` | `margin_box_style_prefixes`, `padding_…`, `position_…` |
| Position | `relative`, `absolute` | `position_style_methods` |
| Radius presets | `rounded{,_t,_b,_r,_l,_tl,_tr,_bl,_br}_{none,xs,sm,md,lg,xl,2xl,3xl,full}` (`full` = 9999px) | `corner_prefixes/suffixes` |
| Border presets | `border{,_t,_b,_r,_l,_x,_y}_{0,1,2,3,4,5,6,7,8,9,10,11,12,16,20,24,32}`, `border_dashed` | `border_prefixes/suffixes`; gpui styled.rs:500 |
| Shadow presets | `shadow_none shadow_2xs shadow_xs shadow_sm shadow_md shadow_lg shadow_xl shadow_2xl` (black 5-25% alpha) | `box_shadow_style_methods` |
| Overflow | `overflow_hidden overflow_x_hidden overflow_y_hidden` (+ element methods `overflow_{,x_,y_}scroll`, `overflow_{,x_,y_}scrollbar`) | macros; typings.rs:1807-1817 |
| Visibility / display | `visible invisible block flex grid hidden` | |
| Cursor (23) | `cursor_default pointer text move not_allowed context_menu crosshair vertical_text alias copy no_drop grab grabbing ew_resize ns_resize nesw_resize nwse_resize col_resize row_resize n_resize e_resize s_resize w_resize` (prefixed `cursor_`) | `cursor_style_methods` |
| Flex | `flex_col flex_col_reverse flex_row flex_row_reverse flex_1 flex_auto flex_initial flex_none flex_grow_0/1 flex_shrink_0/1 flex_wrap flex_wrap_reverse flex_nowrap items_* self_* justify_* content_*` | gpui styled.rs:153-470 |
| Grid | `col_start_auto col_end_auto col_span_full row_start_auto row_end_auto row_span_full` (the numeric `grid_cols(n)` etc. take arguments and are **not** exposed) | styled.rs:752-890 |
| Text | `text_xs text_sm text_base text_lg text_xl text_2xl text_3xl`, `text_left text_center text_right`, `italic not_italic underline line_through text_decoration_{none,solid,wavy,0,1,2,4,8}`, `whitespace_normal whitespace_nowrap`, `truncate text_ellipsis text_ellipsis_start text_ellipsis_middle` | styled.rs:75-700 |
| Font weight | `font_thin font_extralight font_light font_normal font_medium font_semibold font_bold font_extrabold font_black` | style.rs:224-234 (`EXTRA_NULLARY`) |
| Misc | `aspect_square`, `h_flex`, `v_flex`, `debug_red/blue/yellow/green/pink` (no-ops in release: base/src/styled.rs:139-177) | |

Notes:
- Ramp sizes are **rem-based** (`rems(0.25)` etc.), not `scaled_px`. **Inferred**: whether herdr zoom affects
  rems depends on `Window::rem_size` (open question).
- `opacity` applies to the whole subtree. There is **no z-index, rotate, scale, translate or transform** style
  anywhere in the surface (verified: no such names in `known_names()`; gpui `Styled` has none).
- Overflow clipping is a **rectangle** even with rounded corners: `ContentMask` holds only `bounds`
  (gpui-pre/src/window.rs:2191-2194; style.rs:638-680).
- `line_clamp(n)` is a GPUI method with a parameter, not in `PARAM_STYLES` → unavailable.

### 4.3 State styles (verified)

`hover(declare)`, `active(declare)`, `focus(declare)`: `declare` receives a detached element collecting
styles; its return value is ignored (typings.rs:1987-1996; prelude `state` mod.rs:5969-5978).
`hover` is applied with GPUI `.hover()` without needing an id (materialize.rs:1694-1702); `active`/`focus`
make the element stateful (materialize.rs:304-306). State styles apply only on `div`/`h_flex`/`v_flex`
and components that route them; `svg`/`image`/`paint_path` branches never read `states`
(materialize.rs:1474-1551).

---

## 5. Colours (verified)

- Type: `` export type Color = `#${string}`; `` — "A concrete `#rgb`, `#rrggbb`, or `#rrggbbaa` color value. Read
  semantic colors from `cx.theme().colors`; bare token names are intentionally not accepted." (typings.rs:751-760).
- Parser `Bridged::as_color` (value.rs:84-101) + `parse_hex` (value.rs:113-133): accepts `#` + 3, 6 or 8 hex digits
  (`#rgb` expands each digit ×17, alpha `ff`; `#rrggbbaa` carries alpha). No `rgb()`, `rgba()`, `hsl()`, named
  colours, `transparent`, or 4-digit `#rgba`.
- Errors (thrown at the call site, `TypeError`):
  - no `#`: `` "`{text}` is not a color value; pass a color from `cx.theme().colors` or a #rgb, #rrggbb, or #rrggbbaa literal" ``
  - bad hex/length: `` "`{text}` is not a valid color literal (expected #rgb, #rrggbb or #rrggbbaa)" ``
  - non-string (e.g. number): `` "expected a string, got number (1)" `` (value.rs:69-77, :103-110).
- Quirk: length is counted in **bytes** and `u32::from_str_radix` accepts a leading `+`, so `"#+fffff"` parses
  (value.rs:119-130) — never rely on it.
- `cx.theme()` colours are serialised `#rrggbb` (alpha dropped): theme_api.rs:375-379. So `` `${c}80` `` makes a
  valid 8-digit colour from a `cx.theme()` value. herdr's own `theme()` returns `Record<string,string>`
  (defaults/herdr.d.ts:346); **inferred**: check length before appending alpha.
- **Exception — silent failure:** colours inside a `Background` for `paint_path` are **not validated eagerly**.
  The constructor only checks presence (mod.rs:7710-7735); at paint time `NativePath::background()` returns
  `None` on a bad colour (path.rs:87-115) and the path is simply **not painted**, with no error.

---

## 6. Identity: `.id()` (verified)

- `id(name)` sets `behavior.key` (materialize.rs:3544-3549).
- A plain `div`/`h_flex`/`v_flex` becomes stateful automatically when it has a key, `active`/`focus` state
  styles, any pointer/keyboard handler, `on_click`, `on_size_change`, `on_hover`, tooltip, role, tab stop,
  scroll, etc. (materialize.rs:2236-2259, :604-626). Without `.id()` the identity is
  `ElementId::NamedInteger("gpui-shell", spec_id)` — the node's position in the description (materialize.rs:2566-2571).
- So **no method hard-requires `.id()`**, but positional identity shifts when a conditional sibling appears,
  "taking the pressed state, the focus and anything else keyed by identity with it" (typings.rs:1794-1805).
- Methods where a stable `.id()` matters (verified docs/code): `on_size_change` ("Use a stable id", typings.rs:1422-1424),
  `transition`/`spring` (motion identity = key or position, materialize.rs:2579-2610), `hover`+`active`/pressed
  feedback, `overflow_*_scroll` + `Scrollbar` pairing by id (typings.rs:3004-3008), `image()` animation state
  (materialize.rs:1528-1533), tooltips. Components created with `X.new(id)` already have identity and ignore `.id()`.
- Duplicate ids are not checked by the shell (no such check found) — **inferred**: siblings sharing an id share
  GPUI element state.

---

## 7. Events (verified)

| Method | Payload | Where wired |
|---|---|---|
| `on_click(h)` | `ClickEvent { click_count: number; modifiers: Modifiers }` — **no position** (typings.rs:1119-1123; built in `dispatch_click` mod.rs:3989-3997) | div/h_flex/v_flex (materialize.rs:2272-2279) and controls; skipped when `disabled(true)` |
| `on_mouse_down(button, h)` / `on_mouse_up(button, h)` | `MouseButtonEvent { button, click_count, position, local_position?, bounds?, modifiers }` (typings.rs:1165-1182; `mouse_button_payload` mod.rs:9944-9966) | div/h_flex/v_flex + listed controls; others log `` "`{method}` is not wired on a {}: … Wrap it and write `{method}` on the wrapper" `` (materialize.rs:2109-2137) |
| `on_mouse_move(h)` | `MouseMoveEvent { position, local_position, bounds, modifiers, pressed_button? }` — only while hovered (typings.rs:1154-1163, :1414) | |
| `on_window_mouse_move(h)`, `on_window_mouse_up(button, h)` | same shapes, anywhere in the window, passive (typings.rs:1415-1421, :1472-1480) | div/h_flex/v_flex |
| `on_mouse_down_out(h)` | press outside, capture phase | |
| `on_hover(h)` | `(hovered: boolean, cx)` entry and exit (typings.rs:1426) | |
| `on_scroll_wheel(h)` | `{ delta, delta_lines?, touch_phase, position, local_position?, bounds?, modifiers }` (typings.rs:1214-1225) | |
| `on_pinch(h)` | `{ delta, touch_phase, position, … }` | |
| `on_size_change(h)` | `{ width, height }` logical px after layout | div/h_flex/v_flex |
| `on_key_down/up`, `on_action`, `key_context` | need `track_focus(handle)` | |
| `tooltip(text)` | string only; shows after ~0.5 s; themed label | div/h_flex/v_flex and `Button` only (typings.rs:1643-1665; materialize.rs:2302, :1239) |
| `on_item_click(key)` | virtual lists only; handlers inside item renderers throw (typings.rs:1546-1571) | |

- `MouseButton = "left" | "right" | "middle" | "back" | "forward"` (typings.rs:810).
- Geometry: `position` is window px; `local_position = position - bounds.origin`; `bounds` `{x,y,width,height}`;
  absent before first paint (`set_pointer_geometry`, mod.rs:9978-10007). These are **window pixels including
  zoom**: "divide them by `settings().zoom` before mixing" (AGENTS.md:1130-1131).
- Hit testing: every hitbox under the pointer is "hovered" until one with `HitboxBehavior::BlockMouse`
  (gpui-pre/src/window.rs:1120-1141). Script elements cannot `occlude()` (no such method exposed; only the
  shell's own root uses it, root.rs:671/707/756). **Inferred**: overlapping clickable elements (a pickup over the
  central object) both receive the click unless the top one calls `cx.stop_propagation()` (typings.rs:994-1002).
- `cx.stop_propagation()` / `cx.propagate()` are on `Context` (typings.rs:994-1007).

---

## 8. Vector drawing: `PathBuilder` + `Background` + `window.paint_path` (verified)

- `PathBuilder.fill()` / `PathBuilder.stroke(width)` (prelude mod.rs:7161-7164; width must be finite > 0).
  Commands: `move_to`, `line_to`, `curve_to(to_x,to_y,ctrl_x,ctrl_y)`, `cubic_bezier_to(...)`,
  `arc_to(rx, ry, rotation, large_arc, sweep, to_x, to_y)`, `add_polygon(points, closed=true)`, `close()`,
  `dash_array(values)` (stroke only), `build()` (mod.rs:6320-6367; typings.rs:2224-2240).
- Coordinates: finite number = px (× zoom via `scaled_px`) offset from the element's top-left, or a string
  matching `/^-?(?:\d+(?:\.\d*)?|\.\d+)%$/` = percentage of the painted bounds (mod.rs:6294-6298; path.rs:13-38).
  So a path is resolution- and size-independent when written in `%`.
- Quirk: `arc_to`'s `rotation` is read with `as_pixels()` (scaled by zoom) (path.rs:146-152).
- `window.paint_path(path, background | Color)` returns an ordinary element (size it with `w/h/size_full`,
  position it with `absolute().inset_0()`); styles apply (mod.rs:6370-6384; path.rs:117-160). One path and one
  paint per element; layer several elements for multi-colour art.
- `Background.solid(color)`, `Background.linear_gradient(angle, from, to)` with `from/to` = colour or
  `Background.stop(color, fraction)` (fraction 0..1, defaults 0 and 1; angle degrees, 0 = to top, clockwise —
  gpui-pre/src/color.rs:858-898), `Background.pattern_slash(color, width, interval)`,
  `Background.checkerboard(color, size)`; `.opacity(f)`, `.color_space("srgb"|"oklab")` (mod.rs:6300-6318, :7165-7193).
- Pattern sizes are raw GPUI units, not zoom-scaled: the shipped win98 mod multiplies by zoom itself
  (defaults/mods/win98/kit.js:197-200). Gradient fill of a rectangle is the shipped way to get gradient
  backgrounds (defaults/mods/win98/kit.js:190-195).

---

## 9. Animation (all HERDR additions; verified)

| Method | Properties | Limits / defaults | Runtime behaviour |
|---|---|---|---|
| `.transition(prop, ms \| {duration, delay?, easing?})` | `opacity width height left top` | durations finite, ≥0, ≤ 86 400 000 ms (`finiteDuration`, mod.rs:6248-6252); easing `linear ease-in ease-out ease-in-out`, default `ease-out` (mod.rs:6072-6097) | animates **later target changes** natively. Width/height/left/top animate only when the target is an absolute pixel length (`animate_length`, materialize.rs:3189-3200); `%`/`auto` jump |
| `.spring(prop, {response=250, damping=1, epsilon=0.001})` | same 5 | mod.rs:6099-6118 | native spring on target changes |
| `.frames(list, ms=100)` | element text | non-empty string array; `ms ≥ 16` else `RangeError("frames interval must be at least 16 milliseconds")` (mod.rs:6124-6132) | replaces the element's **children** with `list[i]` (materialize.rs:798, :822-823); shared clock |
| `.loop(prop, {from, to, period=1000, easing="ease-in-out"})` | same 5 | `period ≥ 100` else `RangeError("loop period must be at least 100 milliseconds")` (mod.rs:6134-6155) | triangle wave there-and-back; opacity clamped 0..1; width/height/left/top set as **raw `px(value)` — not zoom-scaled** (materialize.rs:3097-3116); wakes the **whole view** ~every 33 ms (`1000.0 / 30.0`, :3114-3117) |
| `.spin(ms=1000)` | rotation of an `svg` | `ms ≥ 100` else `RangeError("spin period must be at least 100 milliseconds")` (mod.rs:6159-6164) | only on `svg()` (materialize.rs:1483-1498). Steps at ~10 fps (`wake_view_after(Duration::from_millis(100)…)`, :1496-1497, :3041). Hosted spinners are painted above the view by ShellRoot (materialize.rs:2911-2921) |

- Unknown property: `TypeError("loop(property, policy) supports opacity, width, height, left or top; got …")`
  (same pattern for transition/spring).
- All loops share one monotonic clock (`loop_clock_ms`, materialize.rs:2900-2904) and run "only while drawn";
  they never re-enter JS (typings.rs:1927-1942; AGENTS.md:1092-1104).
- No keyframes, no `animation_with_duration`, no per-frame JS callback, no `transform` animation (verified: none
  in exports or behaviour list).

---

## 10. Text truncation and Unicode

- `truncate()` = `overflow_hidden().whitespace_nowrap().text_ellipsis()` (gpui-pre/src/styled.rs:137-142).
  `text_ellipsis_start()` / `text_ellipsis_middle()` also exist (:87-109). Affix is `"…"` (:13).
- GPUI truncation walks `char_indices()` (Unicode scalar values), **not grapheme clusters**
  (gpui-pre/src/text_system/line_wrapper.rs:192-232, :329-341). **Inferred**: it can cut a ZWJ emoji sequence,
  a flag pair, or an emoji + variation selector / skin-tone modifier in half. It never splits inside a UTF-8 char.
- There is no `line_clamp` for scripts (§4.2). Multi-line clamping must be done by the script.

---

## 11. Implications for our game (do / don't)

**Do**
1. Import from the right module: `div, svg, image, PathBuilder, Background, View, list, uniform_list` from
   `"gpui-kit"`; `h_flex, v_flex, Button, Switch, Checkbox, TextView, Scrollbar, v_virtual_list, ScrollHandle`
   from `"gpui-base"`. Write text as string children.
2. Reference art as `mods/<game-name>/art/<file>.svg` (app-dir relative). Ship one-colour icons for `svg()`
   (tinted via `text_color`, works in light and dark) and multi-colour sprites for `image()`. Give every SVG used
   with `image()` explicit `width`/`height` attributes at ≥ half the largest on-screen size (it rasterises at 2×).
3. Draw dynamic shapes (progress rings, node bursts, frenzy bars, gradient backdrops) with
   `window.paint_path(PathBuilder…build(), Background…)` in `%` coordinates inside an `absolute().inset_0()` layer.
4. Use only hex colours. Derive palette from `cx.theme().colors` / herdr `theme()` and add alpha by appending two
   hex digits only after checking the value is 7 chars. Validate every `Background` colour in our own code (bad
   colours there fail silently).
5. Put `.id("stable-name")` on every clickable, hoverable, transitioned or size-observed element (central object,
   nodes by node id, pickups by pickup id, helper cards by agent id).
6. Use `on_mouse_down("left", …)` when we need the click position (floating "+N" text, particles);
   `on_click` has only `click_count` and `modifiers`. Convert positions with `settings().zoom`.
7. When clickables overlap (pickup over the central object), call `cx.stop_propagation()` in the top handler.
8. Animate with `.loop("opacity"|"top", …)` (pulse, bob), `.frames([...], ms)` (status glyphs), `.svg(...).spin(ms)`
   (working spinner) and `.transition(…)` on absolute-px widths (meters). Multiply `loop` px values by zoom
   ourselves. Keep the number of looping elements small: each looping view re-materialises ~30×/s.
9. Truncate helper/agent names ourselves, grapheme-safely, before handing strings to `.truncate()`.
10. Use `v_virtual_list`/`uniform_list` (with `on_item_click`) or a plain `overflow_y_scrollbar()` column for
    30+ helpers; give lazy lists a definite height.
11. Commit a `jsconfig.json` in the mod folder (or `.gitignore` the generated `jsconfig.json` and
    `gpui-kit.d.ts`), since herdr writes both there on load.

**Don't**
1. Don't call `text()`, `img()`, `canvas()`, `.z_index()`, `.rotate()`, `.shadow([...])`, `.cursor("pointer")`,
   `.line_clamp(n)`, `.text_align("center")` — they don't exist (use `cursor_pointer()`, `text_center()`).
2. Don't pass named colours, `rgb()`, or `Background` objects to `bg`/`text_color`/`border_color`.
3. Don't use `rounded("50%")`; use `rounded_full()` or `rounded(size / 2)`.
4. Don't rely on `overflow_hidden()` to clip to rounded corners.
5. Don't put handlers, hover or tooltip on `svg()`/`image()`/`paint_path` elements — wrap them in a `div`.
6. Don't drive animation with `cx.timer` + `cx.notify()` (AGENTS.md:1092-1095).
7. Don't write generated assets into `mods/<name>/` at runtime (reloads the mod).
8. Don't depend on `image("https://…")` or `data:` URIs.
9. Don't depend on z-order beyond "later sibling paints on top"; Popover/Popup are the only above-layer surfaces.

---

## 12. Open questions

1. Does herdr's zoom (`set_pixel_scale`) also change `Window::rem_size`, i.e. do rem-based ramps (`w_4`, `text_sm`)
   zoom with numeric lengths? Not traced.
2. Is a real HTTP client installed for GPUI in production (only a test installs `FakeHttpClient`, src/window.rs:6021)?
   Irrelevant if we ship local assets only.
3. Exact content of the per-mod `gpui-kit.d.ts` written at load: inferred to include `declare module "herdr"` (the
   load-time scope's policy) — not verified by running.
4. GIF/WebP animation via `image()`: the loader decodes one frame then attaches the bytes for animation
   (img.rs:700-771); whether frames advance in herdr was not traced.
5. Behaviour with duplicate `.id()` values among siblings (no shell check found).
6. Whether `svg()`/`image()` caches refresh when a file outside `mods/` (e.g. under `data/<name>/`) is rewritten.
7. Byte-exactness of reflected doc text in the reconstructed `.d.ts` cannot be proven without running herdr; names,
   signatures, counts and hand-written blocks are exact.

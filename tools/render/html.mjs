// Element tree (tools/mock gpui recorder) -> HTML/CSS, for screenshots.
//
// Faithful to how herdr 0.1.18 lays out and paints a mod view:
//   * gpui Style::default (vendor/gpui-pre/src/style.rs:771-822): display block,
//     position relative, flex-direction row, no wrap, grow 0, shrink 1, basis
//     auto, overflow visible, everything zero/auto. Taffy sizes are border-box.
//   * Units (value.rs, style.rs): a script number and an "Npx" string are
//     pixels x herdr's zoom (`scaled_px`); "Nrem" and the rem ramps (`p_4`,
//     `text_sm`, `rounded_md`, ...) are rems; herdr sets the window rem to
//     `ui_font_size * zoom` (src/window.rs:5645, settings.rs:835-837, default
//     ui_font_size 13). Macro presets written as `px(n)` (border_N, `_px`
//     suffix, `rounded_full`, shadows) are raw pixels, not zoomed.
//   * ShellRoot (shell/src/root.rs:845-884) sets the base text size to the
//     theme's typography md (16px, not zoomed: base/src/theme_tokens.rs:182)
//     and the text colour to the theme foreground; line height is gpui's
//     default phi = 1.618 (gpui-pre/src/style.rs:494, geometry.rs:3722).
//   * A string child is its own text element (block-level in block layout, a
//     flex item in flex layout); text style (colour, size, weight, white
//     space, ellipsis, text background) inherits as in gpui.
//   * svg(path) is a mask filled with the current text colour; image(path) is
//     an <img> (object-fit contain); window.paint_path is an inline <svg>
//     whose geometry is resolved against the element's box (percentages of
//     the bounds, pixels x zoom) and whose gradient follows gpui's shader
//     (gpui-pre-wgpu/src/shaders.wgsl: 0deg = to top, clockwise, measured on
//     the path's bounding box with the short side expanded).
//   * Animation is shown at rest: `loop` at its `to` value (width/height/
//     left/top as raw px: materialize.rs:3097-3116), `frames` at the first
//     frame, `spin` unrotated, transitions at their target.
// Anything the renderer does not know throws, so tests catch unsupported use.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { lengthOf, parseColor, serialize, tryParseColor } from "../mock/gpui-core.js";

const PHI = 1.618034;

// ---------------------------------------------------------------------------
// Small helpers

function num(value) {
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function esc(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cssColor(value) {
  const { r, g, b, a } = typeof value === "object" ? value : parseColor(value);
  const hex = (n) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}${a === 255 ? "" : hex(a)}`;
}

function unsupported(what) {
  return new Error(`render/html: unsupported ${what}`);
}

// ---------------------------------------------------------------------------
// The nullary style families (gpui-pre-macros styles.rs, gpui styled.rs,
// gpui-base styled.rs)

const RAMP = {
  0: { raw: 0 }, "0p5": { rem: 0.125 }, 1: { rem: 0.25 }, "1p5": { rem: 0.375 }, 2: { rem: 0.5 },
  "2p5": { rem: 0.625 }, 3: { rem: 0.75 }, "3p5": { rem: 0.875 }, 4: { rem: 1 }, 5: { rem: 1.25 },
  6: { rem: 1.5 }, 7: { rem: 1.75 }, 8: { rem: 2 }, 9: { rem: 2.25 }, 10: { rem: 2.5 }, 11: { rem: 2.75 },
  12: { rem: 3 }, 16: { rem: 4 }, 20: { rem: 5 }, 24: { rem: 6 }, 32: { rem: 8 }, 40: { rem: 10 },
  48: { rem: 12 }, 56: { rem: 14 }, 64: { rem: 16 }, 72: { rem: 18 }, 80: { rem: 20 }, 96: { rem: 24 },
  112: { rem: 28 }, 128: { rem: 32 }, auto: { auto: true }, px: { raw: 1 }, full: { frac: 1 },
  "1_2": { frac: 1 / 2 }, "1_3": { frac: 1 / 3 }, "2_3": { frac: 2 / 3 }, "1_4": { frac: 1 / 4 },
  "2_4": { frac: 2 / 4 }, "3_4": { frac: 3 / 4 }, "1_5": { frac: 1 / 5 }, "2_5": { frac: 2 / 5 },
  "3_5": { frac: 3 / 5 }, "4_5": { frac: 4 / 5 }, "1_6": { frac: 1 / 6 }, "5_6": { frac: 5 / 6 },
  "1_12": { frac: 1 / 12 },
};

const EDGES4 = ["top", "right", "bottom", "left"];
const BOX = {
  m: ["margin", EDGES4], mt: ["margin", ["top"]], mb: ["margin", ["bottom"]], my: ["margin", ["top", "bottom"]],
  mx: ["margin", ["left", "right"]], ml: ["margin", ["left"]], mr: ["margin", ["right"]],
  p: ["padding", EDGES4], pt: ["padding", ["top"]], pb: ["padding", ["bottom"]], py: ["padding", ["top", "bottom"]],
  px: ["padding", ["left", "right"]], pl: ["padding", ["left"]], pr: ["padding", ["right"]],
  inset: ["inset", EDGES4], top: ["inset", ["top"]], bottom: ["inset", ["bottom"]], left: ["inset", ["left"]],
  right: ["inset", ["right"]],
  w: ["size", ["width"]], h: ["size", ["height"]], size: ["size", ["width", "height"]],
  min_w: ["min", ["width"]], min_h: ["min", ["height"]], min_size: ["min", ["width", "height"]],
  max_w: ["max", ["width"]], max_h: ["max", ["height"]], max_size: ["max", ["width", "height"]],
  gap: ["gap", ["column", "row"]], gap_x: ["gap", ["column"]], gap_y: ["gap", ["row"]],
};

const CORNER_FIELDS = {
  rounded: ["tl", "tr", "br", "bl"], rounded_t: ["tl", "tr"], rounded_b: ["bl", "br"], rounded_r: ["tr", "br"],
  rounded_l: ["tl", "bl"], rounded_tl: ["tl"], rounded_tr: ["tr"], rounded_bl: ["bl"], rounded_br: ["br"],
};
const CORNER_SUFFIX = {
  none: { raw: 0 }, xs: { rem: 0.125 }, sm: { rem: 0.25 }, md: { rem: 0.375 }, lg: { rem: 0.5 },
  xl: { rem: 0.75 }, "2xl": { rem: 1 }, "3xl": { rem: 1.5 }, full: { raw: 9999 },
};

const BORDER_FIELDS = {
  border: EDGES4, border_t: ["top"], border_b: ["bottom"], border_r: ["right"], border_l: ["left"],
  border_x: ["left", "right"], border_y: ["top", "bottom"],
};
const BORDER_SUFFIX = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "16", "20", "24", "32"]);

const SHADOWS = {
  shadow_none: [],
  shadow_2xs: [[0, 1, 0, 0, 0.05]],
  shadow_xs: [[0, 1, 2, 0, 0.05]],
  shadow_sm: [[0, 1, 3, 0, 0.1], [0, 1, 2, -1, 0.1]],
  shadow_md: [[0, 4, 6, -1, 0.1], [0, 2, 4, -2, 0.1]],
  shadow_lg: [[0, 10, 15, -3, 0.1], [0, 4, 6, -4, 0.1]],
  shadow_xl: [[0, 20, 25, -5, 0.1], [0, 8, 10, -6, 0.1]],
  shadow_2xl: [[0, 25, 50, -12, 0.25]],
};

const FONT_WEIGHTS = {
  font_thin: 100, font_extralight: 200, font_light: 300, font_normal: 400, font_medium: 500,
  font_semibold: 600, font_bold: 700, font_extrabold: 800, font_black: 900,
};

const TEXT_SIZES = {
  text_xs: 0.75, text_sm: 0.875, text_base: 1, text_lg: 1.125, text_xl: 1.25, text_2xl: 1.5, text_3xl: 1.875,
};

const ALIGN_ITEMS = { start: "flex-start", end: "flex-end", center: "center", baseline: "baseline", stretch: "stretch" };
const ALIGN_SELF = {
  start: "start", end: "end", flex_start: "flex-start", flex_end: "flex-end", center: "center",
  baseline: "baseline", stretch: "stretch",
};
const JUSTIFY = {
  start: "start", end: "end", center: "center", between: "space-between", around: "space-around",
  evenly: "space-evenly",
};
const ALIGN_CONTENT = {
  normal: null, center: "center", start: "flex-start", end: "flex-end", between: "space-between",
  around: "space-around", evenly: "space-evenly", stretch: "stretch",
};
const CURSORS = {
  default: "default", pointer: "pointer", text: "text", move: "move", not_allowed: "not-allowed",
  context_menu: "context-menu", crosshair: "crosshair", vertical_text: "vertical-text", alias: "alias",
  copy: "copy", no_drop: "no-drop", grab: "grab", grabbing: "grabbing", ew_resize: "ew-resize",
  ns_resize: "ns-resize", nesw_resize: "nesw-resize", nwse_resize: "nwse-resize", col_resize: "col-resize",
  row_resize: "row-resize", n_resize: "n-resize", e_resize: "e-resize", s_resize: "s-resize", w_resize: "w-resize",
};

// Element methods recorded among the styles that do not change what is drawn.
const INERT_BEHAVIORS = new Set([
  "id", "disabled", "selected", "checked", "pressed", "indeterminate", "value", "tooltip", "key_context",
  "aria_level", "aria_selected", "aria_active_descendant", "accessibility_label", "role", "keep_mounted",
  "track_focus", "track_scroll", "content_focus_handle", "tab_index", "tab_stop", "href", "mode",
  "scroll_size", "axis", "row_count", "column_count", "open", "default_open", "overlay_closable", "anchor",
  "frame_budget", "mouse_button", "open_delay", "close_delay", "start", "size_range", "set_position",
  "with_item_to_measure_index", "viewport_from_layout", "controls_right", "drag_paths", "select_tab",
  "close_panel", "toggle_zoom", "drag_tab", "drop_tab", "toggle_dock", "resize_dock",
  // TextViewElement
  "selectable", "scrollable", "raw_html", "highlight_range",
  // gpui-base StyledExt debug helpers are no-ops in release builds
  "debug_red", "debug_blue", "debug_yellow", "debug_green", "debug_pink",
]);

// ---------------------------------------------------------------------------
// Style state: a StyleRefinement, refined call by call (last write wins)

function newState() {
  return {
    display: null, visibility: null, position: null,
    overflow: { x: null, y: null }, scrollbar: { x: false, y: false },
    inset: {}, margin: {}, padding: {}, border: {}, size: {}, min: {}, max: {}, gap: {}, radius: {},
    borderColor: null, borderStyle: null,
    flexDirection: null, flexWrap: null, flexGrow: null, flexShrink: null, flexBasis: null,
    alignItems: null, alignSelf: null, alignContent: undefined, justifyContent: null,
    aspectRatio: null, background: null, shadows: null, opacity: null, cursor: null,
    grid: {},
    text: {},
  };
}

function setFields(state, group, fields, value) {
  for (const field of fields) state[group][field] = value;
}

function negate(v) {
  if (v.auto) return v;
  const key = Object.keys(v)[0];
  return { [key]: -v[key] };
}

/** Applies one nullary style; false when the name is no known family. */
function applyNullary(state, name) {
  switch (name) {
    case "block": state.display = "block"; return true;
    case "flex": state.display = "flex"; return true;
    case "grid": state.display = "grid"; return true;
    case "hidden": state.display = "none"; return true;
    case "visible": state.visibility = "visible"; return true;
    case "invisible": state.visibility = "hidden"; return true;
    case "relative": state.position = "relative"; return true;
    case "absolute": state.position = "absolute"; return true;
    case "overflow_hidden": state.overflow.x = state.overflow.y = "hidden"; return true;
    case "overflow_x_hidden": state.overflow.x = "hidden"; return true;
    case "overflow_y_hidden": state.overflow.y = "hidden"; return true;
    case "flex_col": state.flexDirection = "column"; return true;
    case "flex_col_reverse": state.flexDirection = "column-reverse"; return true;
    case "flex_row": state.flexDirection = "row"; return true;
    case "flex_row_reverse": state.flexDirection = "row-reverse"; return true;
    case "flex_1": Object.assign(state, { flexGrow: 1, flexShrink: 1, flexBasis: { frac: 0 } }); return true;
    case "flex_auto": Object.assign(state, { flexGrow: 1, flexShrink: 1, flexBasis: { auto: true } }); return true;
    case "flex_initial": Object.assign(state, { flexGrow: 0, flexShrink: 1, flexBasis: { auto: true } }); return true;
    case "flex_none": Object.assign(state, { flexGrow: 0, flexShrink: 0, flexBasis: { auto: true } }); return true;
    case "flex_grow_0": state.flexGrow = 0; return true;
    case "flex_grow_1": state.flexGrow = 1; return true;
    case "flex_shrink_0": state.flexShrink = 0; return true;
    case "flex_shrink_1": state.flexShrink = 1; return true;
    case "flex_wrap": state.flexWrap = "wrap"; return true;
    case "flex_wrap_reverse": state.flexWrap = "wrap-reverse"; return true;
    case "flex_nowrap": state.flexWrap = "nowrap"; return true;
    case "h_flex": state.display = "flex"; state.flexDirection = "row"; state.alignItems = "center"; return true;
    case "v_flex": state.display = "flex"; state.flexDirection = "column"; return true;
    case "aspect_square": state.aspectRatio = 1; return true;
    case "border_dashed": state.borderStyle = "dashed"; return true;
    case "whitespace_normal": state.text.whiteSpace = "normal"; return true;
    case "whitespace_nowrap": state.text.whiteSpace = "nowrap"; return true;
    case "text_ellipsis": state.text.overflow = "end"; return true;
    case "text_ellipsis_start": state.text.overflow = "start"; return true;
    case "text_ellipsis_middle": state.text.overflow = "middle"; return true;
    case "truncate":
      state.overflow.x = state.overflow.y = "hidden";
      state.text.whiteSpace = "nowrap";
      state.text.overflow = "end";
      return true;
    case "text_left": state.text.align = "left"; return true;
    case "text_center": state.text.align = "center"; return true;
    case "text_right": state.text.align = "right"; return true;
    case "italic": state.text.fontStyle = "italic"; return true;
    case "not_italic": state.text.fontStyle = "normal"; return true;
    case "underline": state.text.underline = { thickness: 1, wavy: false }; return true;
    case "line_through": state.text.strikethrough = true; return true;
    case "text_decoration_none": state.text.underline = null; return true;
    case "text_decoration_solid": state.text.underline = { ...(state.text.underline ?? { thickness: 0 }), wavy: false }; return true;
    case "text_decoration_wavy": state.text.underline = { ...(state.text.underline ?? { thickness: 0 }), wavy: true }; return true;
    case "col_start_auto": state.grid.colStart = "auto"; return true;
    case "col_end_auto": state.grid.colEnd = "auto"; return true;
    case "col_span_full": state.grid.col = "1 / -1"; return true;
    case "row_start_auto": state.grid.rowStart = "auto"; return true;
    case "row_end_auto": state.grid.rowEnd = "auto"; return true;
    case "row_span_full": state.grid.row = "1 / -1"; return true;
    default: break;
  }
  if (name in FONT_WEIGHTS) { state.text.fontWeight = FONT_WEIGHTS[name]; return true; }
  if (name in TEXT_SIZES) { state.text.fontSize = { rem: TEXT_SIZES[name] }; return true; }
  if (name in SHADOWS) { state.shadows = SHADOWS[name]; return true; }
  let match = /^text_decoration_(\d+)$/.exec(name);
  if (match) { state.text.underline = { ...(state.text.underline ?? { wavy: false }), thickness: Number(match[1]) }; return true; }
  match = /^items_(\w+)$/.exec(name);
  if (match && match[1] in ALIGN_ITEMS) { state.alignItems = ALIGN_ITEMS[match[1]]; return true; }
  match = /^self_(\w+)$/.exec(name);
  if (match && match[1] in ALIGN_SELF) { state.alignSelf = ALIGN_SELF[match[1]]; return true; }
  match = /^justify_(\w+)$/.exec(name);
  if (match && match[1] in JUSTIFY) { state.justifyContent = JUSTIFY[match[1]]; return true; }
  match = /^content_(\w+)$/.exec(name);
  if (match && match[1] in ALIGN_CONTENT) { state.alignContent = ALIGN_CONTENT[match[1]]; return true; }
  match = /^cursor_(\w+)$/.exec(name);
  if (match && match[1] in CURSORS) { state.cursor = CURSORS[match[1]]; return true; }
  // rounded{,_t,...}_{none,xs,...}
  for (const prefix of Object.keys(CORNER_FIELDS)) {
    if (!name.startsWith(prefix + "_")) continue;
    const suffix = name.slice(prefix.length + 1);
    if (suffix in CORNER_SUFFIX) { setFields(state, "radius", CORNER_FIELDS[prefix], CORNER_SUFFIX[suffix]); return true; }
  }
  // border{,_t,...}_N
  for (const prefix of Object.keys(BORDER_FIELDS)) {
    if (!name.startsWith(prefix + "_")) continue;
    const suffix = name.slice(prefix.length + 1);
    if (BORDER_SUFFIX.has(suffix)) { setFields(state, "border", BORDER_FIELDS[prefix], { raw: Number(suffix) }); return true; }
  }
  // box ramps: <prefix>[_neg]_<suffix>
  for (const prefix of Object.keys(BOX)) {
    if (!name.startsWith(prefix + "_")) continue;
    let suffix = name.slice(prefix.length + 1);
    const negative = suffix.startsWith("neg_");
    if (negative) suffix = suffix.slice(4);
    if (!(suffix in RAMP)) continue;
    let value = RAMP[suffix];
    if (negative) {
      if (value.auto) continue;
      value = negate(value);
    }
    const [group, fields] = BOX[prefix];
    setFields(state, group, fields, value);
    return true;
  }
  return false;
}

function paramLength(value, method) {
  return lengthOf(value, method);
}

/** Applies one parametric style (already validated by the recorder). */
function applyParam(state, name, value) {
  if (name in BOX) {
    const [group, fields] = BOX[name];
    setFields(state, group, fields, paramLength(value, name));
    return true;
  }
  if (name in CORNER_FIELDS) { setFields(state, "radius", CORNER_FIELDS[name], paramLength(value, name)); return true; }
  if (name in BORDER_FIELDS) { setFields(state, "border", BORDER_FIELDS[name], paramLength(value, name)); return true; }
  switch (name) {
    case "flex_grow": state.flexGrow = value; return true;
    case "flex_shrink": state.flexShrink = value; return true;
    case "flex_basis": state.flexBasis = paramLength(value, name); return true;
    case "bg": state.background = parseColor(value); return true;
    case "border_color": state.borderColor = parseColor(value); return true;
    case "text_color": state.text.color = parseColor(value); return true;
    case "text_bg": state.text.background = parseColor(value); return true;
    case "text_size": state.text.fontSize = paramLength(value, name); return true;
    case "font_family": state.text.fontFamily = value; return true;
    case "font_weight": state.text.fontWeight = value; return true;
    case "line_height":
      if (typeof value === "number") state.text.lineHeight = { mult: value };
      else {
        const length = paramLength(value, name);
        state.text.lineHeight = "frac" in length ? { mult: length.frac } : length;
      }
      return true;
    case "opacity": state.opacity = value; return true;
    default: return false;
  }
}

function applyBehavior(state, name) {
  switch (name) {
    case "overflow_scroll": state.overflow.x = state.overflow.y = "scroll"; return true;
    case "overflow_x_scroll": state.overflow.x = "scroll"; return true;
    case "overflow_y_scroll": state.overflow.y = "scroll"; return true;
    case "overflow_scrollbar":
      state.overflow.x = state.overflow.y = "scroll";
      state.scrollbar.x = state.scrollbar.y = true;
      return true;
    case "overflow_x_scrollbar": state.overflow.x = "scroll"; state.scrollbar.x = true; return true;
    case "overflow_y_scrollbar": state.overflow.y = "scroll"; state.scrollbar.y = true; return true;
    default: return INERT_BEHAVIORS.has(name);
  }
}

/** Defaults a component draws with before the script's own styles refine it. */
const COMPONENT_DEFAULTS = {
  div: [],
  h_flex: [["h_flex"]],
  v_flex: [["v_flex"]],
  // gpui-base button.rs: flex, items_center, justify_center, line_height(relative(1.))
  Button: [["flex"], ["items_center"], ["justify_center"], ["line_height", 1]],
  Link: [],
  Checkbox: [],
  Switch: [],
  Scrollbar: [],
  TextView: [],
  svg: [],
  image: [],
  path: [],
  list: [["overflow_hidden"]],
  uniform_list: [["overflow_hidden"]],
  v_virtual_list: [["overflow_hidden"]],
  h_virtual_list: [["overflow_hidden"]],
};

function buildState(node) {
  const defaults = COMPONENT_DEFAULTS[node.kind];
  if (!defaults) throw unsupported(`element kind \`${node.kind}\``);
  const state = newState();
  for (const [name, ...args] of [...defaults, ...(node.styles ?? [])]) {
    if (args.length === 0 && applyNullary(state, name)) continue;
    if (args.length >= 1 && applyParam(state, name, args[0])) continue;
    if (applyBehavior(state, name)) continue;
    throw unsupported(`method \`${name}\` on ${node.kind}${node.id ? ` "${node.id}"` : ""}`);
  }
  // Animations at rest: a loop holds its `to` value (raw px for lengths).
  for (const loop of node.loops ?? []) {
    if (loop.property === "opacity") state.opacity = Math.min(1, Math.max(0, loop.to));
    else if (loop.property === "width") state.size.width = { raw: loop.to };
    else if (loop.property === "height") state.size.height = { raw: loop.to };
    else if (loop.property === "left") state.inset.left = { raw: loop.to };
    else if (loop.property === "top") state.inset.top = { raw: loop.to };
  }
  return state;
}

// ---------------------------------------------------------------------------
// State -> CSS

function makeContext(options) {
  const zoom = options.zoom ?? 1;
  const uiFontSize = options.uiFontSize ?? 13;
  return {
    zoom,
    rem: options.remSize ?? uiFontSize * zoom,
    fontSize: options.fontSize ?? 16,
    assetRoot: options.assetRoot ?? process.cwd(),
    checkAssets: options.checkAssets ?? true,
    warnings: options.warnings ?? null,
    cx: options.cx,
  };
}

function len(v, ctx) {
  if (v.auto) return "auto";
  if ("frac" in v) return num(v.frac * 100) + "%";
  if ("rem" in v) return num(v.rem * ctx.rem) + "px";
  if ("raw" in v) return num(v.raw) + "px";
  return num(v.px * ctx.zoom) + "px";
}

/** A length in CSS px when it is absolute, else null. */
function absPx(v, ctx) {
  if (!v || v.auto || "frac" in v) return null;
  if ("rem" in v) return v.rem * ctx.rem;
  if ("raw" in v) return v.raw;
  return v.px * ctx.zoom;
}

function stateCss(state, ctx, { paintable = true } = {}) {
  const css = [];
  const push = (prop, value) => css.push(`${prop}:${value}`);
  if (state.display && state.display !== "block") push("display", state.display);
  if (state.visibility === "hidden") push("visibility", "hidden");
  if (state.position === "absolute") push("position", "absolute");
  for (const edge of EDGES4) if (state.inset[edge]) push(edge, len(state.inset[edge], ctx));
  if (state.size.width) push("width", len(state.size.width, ctx));
  if (state.size.height) push("height", len(state.size.height, ctx));
  if (state.min.width) push("min-width", len(state.min.width, ctx));
  if (state.min.height) push("min-height", len(state.min.height, ctx));
  if (state.max.width && !state.max.width.auto) push("max-width", len(state.max.width, ctx));
  if (state.max.height && !state.max.height.auto) push("max-height", len(state.max.height, ctx));
  if (state.aspectRatio !== null) push("aspect-ratio", num(state.aspectRatio));
  for (const edge of EDGES4) if (state.margin[edge]) push(`margin-${edge}`, len(state.margin[edge], ctx));
  for (const edge of EDGES4) if (state.padding[edge]) push(`padding-${edge}`, len(state.padding[edge], ctx));
  for (const edge of EDGES4) if (state.border[edge]) push(`border-${edge}-width`, len(state.border[edge], ctx));
  if (state.flexDirection) push("flex-direction", state.flexDirection);
  if (state.flexWrap) push("flex-wrap", state.flexWrap);
  if (state.flexGrow !== null) push("flex-grow", num(state.flexGrow));
  if (state.flexShrink !== null) push("flex-shrink", num(state.flexShrink));
  if (state.flexBasis) push("flex-basis", len(state.flexBasis, ctx));
  if (state.alignItems) push("align-items", state.alignItems);
  if (state.alignSelf) push("align-self", state.alignSelf);
  if (state.alignContent) push("align-content", state.alignContent);
  if (state.justifyContent) push("justify-content", state.justifyContent);
  if (state.gap.row) push("row-gap", len(state.gap.row, ctx));
  if (state.gap.column) push("column-gap", len(state.gap.column, ctx));
  if (state.grid.col) push("grid-column", state.grid.col);
  if (state.grid.colStart) push("grid-column-start", state.grid.colStart);
  if (state.grid.colEnd) push("grid-column-end", state.grid.colEnd);
  if (state.grid.row) push("grid-row", state.grid.row);
  if (state.grid.rowStart) push("grid-row-start", state.grid.rowStart);
  if (state.grid.rowEnd) push("grid-row-end", state.grid.rowEnd);
  const { x, y } = state.overflow;
  if (x || y) {
    push("overflow-x", x ? "hidden" : "visible");
    push("overflow-y", y ? "hidden" : "visible");
    if (state.scrollbar.x || state.scrollbar.y) {
      if (state.scrollbar.x) push("overflow-x", "auto");
      if (state.scrollbar.y) push("overflow-y", "auto");
      push("scrollbar-width", "thin");
    } else push("scrollbar-width", "none");
  }
  if (state.cursor) push("cursor", state.cursor);
  if (paintable) {
    if (state.borderStyle === "dashed") push("border-style", "dashed");
    if (state.borderColor) push("border-color", cssColor(state.borderColor));
    if (state.background) push("background-color", cssColor(state.background));
    const radius = state.radius;
    for (const [corner, prop] of [["tl", "top-left"], ["tr", "top-right"], ["br", "bottom-right"], ["bl", "bottom-left"]]) {
      if (radius[corner]) push(`border-${prop}-radius`, len(radius[corner], ctx));
    }
    if (state.shadows) {
      push(
        "box-shadow",
        state.shadows.length
          ? state.shadows.map(([ox, oy, blur, spread, a]) => `${ox}px ${oy}px ${blur}px ${spread}px rgba(0,0,0,${a})`).join(",")
          : "none",
      );
    }
    if (state.opacity !== null) push("opacity", num(Math.min(1, Math.max(0, state.opacity))));
  }
  // Text style: inherited by every text element below.
  const t = state.text;
  if (t.color) push("color", cssColor(t.color));
  if (t.fontSize) push("font-size", len(t.fontSize, ctx));
  if (t.fontFamily) push("font-family", `'${String(t.fontFamily).replace(/['\\]/g, "\\$&")}'`);
  if (t.fontWeight) push("font-weight", num(t.fontWeight));
  if (t.fontStyle) push("font-style", t.fontStyle);
  if (t.lineHeight) push("line-height", "mult" in t.lineHeight ? num(t.lineHeight.mult) : len(t.lineHeight, ctx));
  if (t.whiteSpace) push("white-space", t.whiteSpace === "nowrap" ? "pre" : "pre-wrap");
  if (t.align) push("text-align", t.align);
  // gpui truncates the text element itself; CSS needs the text box to clip
  // and to be allowed to shrink. Start/middle ellipses have no CSS form and
  // are shown at the end.
  if (t.overflow) push("--g-to", "ellipsis;--g-tov:hidden;--g-tmin:0");
  if (t.background) push("--g-tbg", cssColor(t.background));
  const decorations = [];
  if (t.underline && t.underline.thickness > 0) decorations.push("underline");
  if (t.strikethrough) decorations.push("line-through");
  if (decorations.length) {
    push("text-decoration-line", decorations.join(" "));
    if (t.underline?.wavy) push("text-decoration-style", "wavy");
    if (t.underline?.thickness) push("text-decoration-thickness", `${t.underline.thickness}px`);
  }
  return css.join(";");
}

// ---------------------------------------------------------------------------
// Assets

function assetUrl(path, ctx) {
  const parts = String(path).split(/[\\/]+/).filter((part) => part && part !== ".");
  if (parts.includes("..")) throw new Error(`\`${path}\` is outside the application directory`);
  const root = isAbsolute(ctx.assetRoot) ? ctx.assetRoot : resolve(ctx.assetRoot);
  const file = join(root, ...parts);
  const exists = !ctx.checkAssets || existsSync(file);
  if (!exists && ctx.warnings) {
    ctx.warnings.push(
      `asset \`${path}\` was not found at ${file}; asset paths resolve against the application directory, not against the file that asked for them`,
    );
  }
  return { url: pathToFileURL(file).href, exists, file };
}

// CSS masks are fetched in CORS mode, which a file:// page (origin "null")
// fails for file:// images: the sprite would silently draw nothing. svg()
// masks are therefore inlined as data: URIs.
const maskCache = new Map();
function maskUrl(asset) {
  if (!asset.exists || !existsSync(asset.file)) return asset.url;
  let uri = maskCache.get(asset.file);
  if (!uri) {
    const data = readFileSync(asset.file);
    const type = asset.file.endsWith(".svg") ? "image/svg+xml" : asset.file.endsWith(".png") ? "image/png" : "application/octet-stream";
    uri = `data:${type};base64,${data.toString("base64")}`;
    maskCache.set(asset.file, uri);
  }
  return uri;
}

// ---------------------------------------------------------------------------
// Paths (window.paint_path)

/**
 * SVG path data for recorded PathBuilder commands in a `w` x `h` box (CSS px).
 * Pure and self-contained: it is also embedded in the document's script.
 */
export function gpuiPathData(path, w, h, zoom) {
  const x = (v) => (typeof v === "string" ? (parseFloat(v) / 100) * w : v * zoom);
  const y = (v) => (typeof v === "string" ? (parseFloat(v) / 100) * h : v * zoom);
  const n = (v) => String(Math.round(v * 1000) / 1000);
  const out = [];
  const points = [];
  const pt = (px, py) => {
    points.push([px, py]);
    return n(px) + " " + n(py);
  };
  for (const command of path.commands) {
    const [name, ...a] = command;
    if (name === "move_to") out.push("M" + pt(x(a[0]), y(a[1])));
    else if (name === "line_to") out.push("L" + pt(x(a[0]), y(a[1])));
    else if (name === "curve_to") out.push("Q" + pt(x(a[2]), y(a[3])) + " " + pt(x(a[0]), y(a[1])));
    else if (name === "cubic_bezier_to") {
      out.push("C" + pt(x(a[2]), y(a[3])) + " " + pt(x(a[4]), y(a[5])) + " " + pt(x(a[0]), y(a[1])));
    } else if (name === "arc_to") {
      const rx = Math.abs(x(a[0]));
      const ry = Math.abs(y(a[1]));
      out.push(
        "A" + n(rx) + " " + n(ry) + " " + n(a[2] * zoom) + " " + (a[3] ? 1 : 0) + " " + (a[4] ? 1 : 0) + " " +
          pt(x(a[5]), y(a[6])),
      );
    } else if (name === "close") out.push("Z");
  }
  let bbox = null;
  if (points.length) {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const half = path.fill ? 0 : (path.width * zoom) / 2;
    const x0 = Math.min(...xs) - half;
    const y0 = Math.min(...ys) - half;
    bbox = { x: x0, y: y0, width: Math.max(...xs) + half - x0, height: Math.max(...ys) + half - y0 };
  }
  return { d: out.join(" "), bbox };
}

/**
 * gpui's linear gradient as an SVG gradient line over `bbox` (shaders.wgsl
 * case 1u): direction (cos, sin) of (angle - 90), the short side expanded,
 * t measured along it over the longer extent, then rescaled to the stops.
 */
export function gpuiGradientLine(angle, from, to, bbox) {
  const radians = (((angle % 360) - 90) * Math.PI) / 180;
  let dx = Math.cos(radians);
  let dy = Math.sin(radians);
  if (bbox.width > bbox.height) dy *= bbox.height / bbox.width;
  else if (bbox.height > 0) dx *= bbox.width / bbox.height;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const extent = Math.abs(dx) > Math.abs(dy) ? bbox.width : bbox.height;
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const at = (t) => [cx + ux * extent * (t - 0.5), cy + uy * extent * (t - 0.5)];
  const [x1, y1] = at(from);
  const [x2, y2] = at(to);
  return { x1, y1, x2, y2 };
}

/** Client-side pass: resolves every path against its laid-out box. */
function gpuiPaintAll() {
  for (const box of document.querySelectorAll("[data-gpui-path]")) {
    const spec = JSON.parse(box.getAttribute("data-gpui-path"));
    const svgEl = box.querySelector("svg");
    const pathEl = svgEl.querySelector(":scope > path");
    if (!pathEl) continue;
    const geometry = gpuiPathData(spec.path, box.clientWidth, box.clientHeight, spec.zoom);
    pathEl.setAttribute("d", geometry.d);
    const gradient = svgEl.querySelector("linearGradient");
    const pattern = svgEl.querySelector("pattern");
    if (!gradient && !pattern) continue;
    let bbox = geometry.bbox;
    try {
      const b = pathEl.getBBox();
      const half = spec.path.fill ? 0 : (spec.path.width * spec.zoom) / 2;
      bbox = { x: b.x - half, y: b.y - half, width: b.width + 2 * half, height: b.height + 2 * half };
    } catch {}
    if (!bbox) continue;
    if (gradient) {
      const line = gpuiGradientLine(spec.angle, spec.from, spec.to, bbox);
      for (const key of ["x1", "y1", "x2", "y2"]) gradient.setAttribute(key, String(line[key]));
    }
    if (pattern) {
      pattern.setAttribute("x", String(bbox.x));
      pattern.setAttribute("y", String(bbox.y));
    }
  }
}

/** The script a document needs so paths resolve against their laid-out boxes. */
export const PATH_SCRIPT =
  `${gpuiPathData.toString()}\n${gpuiGradientLine.toString()}\n${gpuiPaintAll.toString()}\n` +
  "if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', gpuiPaintAll); else gpuiPaintAll();";

let pathCounter = 0;

function stopColor(color, opacity) {
  const { r, g, b, a } = color;
  return `stop-color="rgb(${r},${g},${b})" stop-opacity="${num((a / 255) * opacity)}"`;
}

function renderPath(node, state, ctx) {
  const [path, bg] = node.args;
  // A path element paints only its geometry; its own box takes layout styles.
  // Element opacity still applies (styles apply to a paint_path element:
  // research gpui-ui.md §8, mod.rs:6370-6384), and so does a loop on it.
  let css = stateCss(state, ctx, { paintable: false });
  if (state.opacity !== null) css = [css, `opacity:${num(Math.min(1, Math.max(0, state.opacity)))}`].filter(Boolean).join(";");
  const w = absPx(state.size.width, ctx) ?? 0;
  const h = absPx(state.size.height, ctx) ?? 0;
  const geometry = gpuiPathData(path, w, h, ctx.zoom);
  const id = `gpui-paint-${++pathCounter}`;
  const opacity = bg.opacity ?? 1;
  let defs = "";
  let paint = null;
  const spec = { path, zoom: ctx.zoom };
  if (bg.kind === "solid") {
    const c = tryParseColor(bg.values[0]);
    if (c) paint = `rgb(${c.r},${c.g},${c.b})" ${path.fill ? "fill" : "stroke"}-opacity="${num((c.a / 255) * opacity)}`;
  } else if (bg.kind === "linear-gradient") {
    const [angle, fromColor, fromAt, toColor, toAt] = bg.values;
    const c0 = tryParseColor(fromColor);
    const c1 = tryParseColor(toColor);
    if (c0 && c1) {
      Object.assign(spec, { angle: Number(angle), from: Number(fromAt), to: Number(toAt) });
      const line = geometry.bbox
        ? gpuiGradientLine(spec.angle, spec.from, spec.to, geometry.bbox)
        : { x1: 0, y1: 0, x2: 0, y2: 0 };
      defs =
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(line.x1)}" y1="${num(line.y1)}" x2="${num(line.x2)}" y2="${num(line.y2)}"` +
        `${bg.colorSpace === "oklab" ? ' data-color-space="oklab"' : ""}>` +
        `<stop offset="0" ${stopColor(c0, opacity)}/><stop offset="1" ${stopColor(c1, opacity)}/></linearGradient>`;
      paint = `url(#${id})`;
    }
  } else if (bg.kind === "pattern-slash") {
    const c = tryParseColor(bg.values[0]);
    const width = Number(bg.values[1]);
    const period = width + Number(bg.values[2]);
    if (c) {
      const at = geometry.bbox ?? { x: 0, y: 0 };
      // shaders.wgsl case 2u: mat2x2 takes columns, so the rotated x is
      // (x + y) / sqrt(2): stripes run along x + y = k * (width + interval),
      // `width` wide measured along x — a "/" slash.
      const band = (o) =>
        `M${num(o - width / 2)} 0L${num(o + width / 2)} 0L${num(o + width / 2 - period)} ${num(period)}L${num(o - width / 2 - period)} ${num(period)}Z`;
      defs =
        `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${num(at.x)}" y="${num(at.y)}" width="${num(period)}" height="${num(period)}">` +
        `<path d="${band(0)} ${band(period)} ${band(2 * period)}" fill="${cssColor(c)}" fill-opacity="${num(opacity)}"/></pattern>`;
      paint = `url(#${id})`;
    }
  } else if (bg.kind === "checkerboard") {
    const c = tryParseColor(bg.values[0]);
    const size = Number(bg.values[1]);
    if (c) {
      const at = geometry.bbox ?? { x: 0, y: 0 };
      defs =
        `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${num(at.x)}" y="${num(at.y)}" width="${num(2 * size)}" height="${num(2 * size)}">` +
        `<g fill="${cssColor(c)}" fill-opacity="${num(opacity)}"><rect x="${num(size)}" y="0" width="${num(size)}" height="${num(size)}"/>` +
        `<rect x="0" y="${num(size)}" width="${num(size)}" height="${num(size)}"/></g></pattern>`;
      paint = `url(#${id})`;
    }
  } else {
    throw unsupported(`background kind \`${bg.kind}\``);
  }
  // A background with a bad colour paints nothing, silently (path.rs:87-115).
  let shape = "";
  if (paint) {
    const dash = path.commands.find((c) => c[0] === "dash_array");
    const attrs = path.fill
      ? `fill="${paint}" fill-rule="evenodd" stroke="none"`
      : `fill="none" stroke="${paint}" stroke-width="${num(path.width * ctx.zoom)}" stroke-linejoin="miter" stroke-miterlimit="4" stroke-linecap="butt"` +
        (dash ? ` stroke-dasharray="${dash.slice(1).map((v) => num(v * ctx.zoom)).join(" ")}"` : "");
    shape = `<path d="${geometry.d}" ${attrs}/>`;
  }
  return (
    `<div class="g" data-kind="path"${node.id !== null && node.id !== undefined ? ` data-id="${esc(node.id)}"` : ""}` +
    ` data-gpui-path="${esc(JSON.stringify(spec))}"${css ? ` style="${esc(css)}"` : ""}>` +
    `<svg class="gp" xmlns="http://www.w3.org/2000/svg">${defs ? `<defs>${defs}</defs>` : ""}${shape}</svg></div>`
  );
}

// ---------------------------------------------------------------------------
// Markdown for TextView (a small, honest subset)

function inlineMarkdown(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function markdownToHtml(source) {
  const out = [];
  let list = null;
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) out.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const line of String(source).split("\n")) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (heading) {
      flush();
      out.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`);
    } else if (bullet || ordered) {
      const kind = bullet ? "ul" : "ol";
      if (paragraph.length) {
        out.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
        paragraph = [];
      }
      if (list !== kind) {
        if (list) out.push(`</${list}>`);
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inlineMarkdown((bullet ?? ordered)[1])}</li>`);
    } else paragraph.push(line.trim());
  }
  flush();
  return out.join("");
}

// ---------------------------------------------------------------------------
// Tree -> HTML

function renderText(text) {
  return `<div class="gt"><span class="gtb">${esc(text)}</span></div>`;
}

function renderChildren(node, ctx) {
  if (node.frames && node.frames.list?.length) return renderText(node.frames.list[0]);
  return (node.children ?? []).map((child) => renderNode(child, ctx)).join("");
}

function renderNode(node, ctx) {
  if (node.kind === "text") return renderText(node.text);
  if (node.kind === "child_view") throw unsupported("child view entity (render nested views separately)");
  const state = buildState(node);
  if (node.kind === "path") return renderPath(node, state, ctx);
  const css = stateCss(state, ctx);
  const attrs = [`class="g"`, `data-kind="${esc(node.kind)}"`];
  if (node.id !== null && node.id !== undefined) attrs.push(`data-id="${esc(node.id)}"`);
  const open = (extraCss = "", extraAttrs = []) => {
    const style = [css, extraCss].filter(Boolean).join(";");
    return `<div ${[...attrs, ...extraAttrs].join(" ")}${style ? ` style="${esc(style)}"` : ""}>`;
  };
  switch (node.kind) {
    case "svg": {
      const asset = assetUrl(node.args[0], ctx);
      if (!asset.exists) return open() + "</div>";
      const mask = `url('${maskUrl(asset).replace(/'/g, "%27")}') center / 100% 100% no-repeat`;
      return open(`background-color:currentColor;-webkit-mask:${mask};mask:${mask}`) + "</div>";
    }
    case "image": {
      const asset = assetUrl(node.args[0], ctx);
      const style = [css, "display:block;object-fit:contain"].filter(Boolean).join(";");
      return `<img ${attrs.join(" ")} src="${esc(asset.url)}" alt="" style="${esc(style)}">`;
    }
    case "TextView": {
      const [, text, format] = node.args;
      const body = format === "markdown" ? markdownToHtml(text) : String(text);
      return open("white-space:normal", [`data-format="${esc(format)}"`]) + `<div class="gtv">${body}</div></div>`;
    }
    case "v_virtual_list":
    case "h_virtual_list": {
      const vertical = node.kind === "v_virtual_list";
      const sizes = node.args[2];
      const items = (node.children ?? []).map((child, index) => {
        const size = Array.isArray(sizes) ? sizes[index] : sizes;
        const extent = typeof size === "number" ? `${vertical ? "height" : "width"}:${num(size * ctx.zoom)}px;` : "";
        return `<div class="g" style="${extent}flex-shrink:0">${renderNode(child, ctx)}</div>`;
      });
      return open(`display:flex;flex-direction:${vertical ? "column" : "row"}`) + items.join("") + "</div>";
    }
    case "list":
    case "uniform_list":
      return open("display:flex;flex-direction:column") +
        (node.children ?? []).map((child) => `<div class="g" style="flex-shrink:0">${renderNode(child, ctx)}</div>`).join("") +
        "</div>";
    default:
      return open() + renderChildren(node, ctx) + "</div>";
  }
}

const BASE_CSS =
  ".gpui-root,.gpui-root *{box-sizing:border-box}" +
  ".gpui-root .g{position:relative;display:block;margin:0;padding:0;border:0 solid transparent}" +
  ".gpui-root .gt{display:block;overflow:var(--g-tov,visible);text-overflow:var(--g-to,clip);min-width:var(--g-tmin,auto)}" +
  ".gpui-root .gtb{background-color:var(--g-tbg,transparent)}" +
  ".gpui-root .gp{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;display:block}" +
  ".gpui-root .gtv p,.gpui-root .gtv h1,.gpui-root .gtv h2,.gpui-root .gtv h3,.gpui-root .gtv h4,.gpui-root .gtv ul," +
  ".gpui-root .gtv ol{margin:0 0 0.5em 0}.gpui-root .gtv ul,.gpui-root .gtv ol{padding-left:1.4em}";

function themeForeground(theme) {
  if (!theme) return null;
  if (typeof theme === "string") return theme;
  return theme.foreground ?? theme.colors?.foreground ?? theme.fg ?? theme.text ?? null;
}

/**
 * Renders an element tree (live mock element or its JSON) to an HTML
 * fragment. Options: `zoom` (1), `theme` ({ foreground } or { colors:
 * { foreground } }), `uiFontSize` (13; the window rem is uiFontSize x zoom),
 * `remSize`, `fontSize` (ShellRoot's 16px), `fontFamily`, `assetRoot`
 * (directory app-relative asset paths resolve against; default cwd), `cx`
 * (for lazy list renderers), `warnings` (array collecting asset warnings),
 * `root` (false: no ShellRoot wrapper).
 */
export function renderToHtml(tree, options = {}) {
  const ctx = makeContext(options);
  const json = tree && tree.__r ? serialize(tree, { cx: options.cx }) : tree;
  const body = renderNode(json, ctx);
  if (options.root === false) return body;
  const foreground = themeForeground(options.theme);
  const rootStyle = [
    "position:relative",
    "width:100%",
    "height:100%",
    `font-size:${num(ctx.fontSize)}px`,
    `line-height:${PHI}`,
    "white-space:pre-wrap",
    "font-weight:400",
    `font-family:${options.fontFamily ?? 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'}`,
    foreground ? `color:${cssColor(foreground)}` : "",
  ].filter(Boolean).join(";");
  return (
    `<div class="gpui-root" style="${esc(rootStyle)}"><style>${BASE_CSS}</style>` +
    `<div class="g" style="width:100%;height:100%">${body}</div></div>`
  );
}

/** A complete HTML document of `width` x `height` CSS px showing the tree. */
export function renderDocument(tree, options = {}) {
  const width = options.width ?? 800;
  const height = options.height ?? 600;
  const background = options.background ? cssColor(options.background) : "transparent";
  const fragment = renderToHtml(tree, options);
  return (
    "<!doctype html><html><head><meta charset=\"utf-8\">" +
    `<meta name="viewport" content="width=${width}, initial-scale=1">` +
    `<style>html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;background:${background}}</style>` +
    `</head><body>${fragment}<script>${PATH_SCRIPT}</script></body></html>`
  );
}

export { BASE_CSS };

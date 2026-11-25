// Strict checks for the files herdr reads from the share package, mirroring
// herdr-app 0.1.18 (paths relative to its source):
//   layout files   src/layout.rs  (serde structs Node, Kind, Content, ...)
//   missing mods   src/window.rs  missing_mods (every string under a "mod" key)
//   keys.json      src/keys.rs    tab, valid_action, gone_mod, ESCAPE_HATCH
//   chords         vendor/gpui-pre/src/platform/keystroke.rs Keystroke::parse,
//                  vendor/gpui-pre/src/keymap/binding.rs KeyBinding::load
//   mod palette    defaults/frame/palette/main.js modPalettes, modEntry
//
// herdr's serde structs do not deny unknown fields: a misspelt field is
// silently ignored. These checks flag every field the structs do not know, so
// a typo fails here instead of quietly doing nothing in the app.
// Plain ES module with no imports.

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string";
const isBool = (v) => typeof v === "boolean";

// ---------------------------------------------------------------- layout

/** Node fields that are not part of `Kind` (src/layout.rs `Node`, `Look`). */
const NODE_COMMON = [
  "id", "cloned_from", "type", "size", "min", "max", "hidden", "title", "background", "border",
  "radius", "shadow", "padding", "focus",
  // Look (flattened)
  "theme", "colors", "font", "font_size", "font_weight", "font_weight_bold",
  "terminal_line_height", "terminal_cell_width", "terminal_scroll_speed", "ui_font",
  "terminal_padding", "terminal_opacity",
  "gap", "divider", "movable", "closable", "resizable", "floating",
  "titlebar", "traffic_lights", "preview", "terminal_menu", "link_handlers", "toast",
  "window_drag", "window_blur",
];

/** Fields documented "Root only" in src/layout.rs: ignored anywhere else. */
export const ROOT_ONLY = ["titlebar", "traffic_lights", "preview", "terminal_menu", "link_handlers", "toast", "window_blur"];

/** `Kind` (internally tagged by "type", lowercase). */
const KIND_FIELDS = {
  block: ["content"],
  row: ["children"],
  column: ["children"],
  stack: ["children", "active", "header"],
};

export const NODE_TYPES = Object.keys(KIND_FIELDS);

class Errors {
  constructor() { this.list = []; }
  add(path, msg) { this.list.push(`${path}: ${msg}`); }
  unknown(path, v, known) {
    for (const k of Object.keys(v)) if (!known.includes(k)) this.add(path, `unknown field "${k}" (known: ${known.join(", ")})`);
  }
}

// Option<T>: null or absent is None.
const opt = (v) => v === undefined || v === null;

function checkNum(e, path, v, { optional = true } = {}) {
  if (optional && opt(v)) return;
  if (!isNum(v)) e.add(path, `must be a number`);
}
function checkStr(e, path, v, { optional = true, values } = {}) {
  if (optional && opt(v)) return;
  if (!isStr(v)) return e.add(path, `must be a string`);
  if (values && !values.includes(v)) e.add(path, `must be one of ${values.map((x) => JSON.stringify(x)).join(", ")}`);
}
// A non-Option bool with #[serde(default)]: absent is false, null is a parse error.
function checkBool(e, path, v, { optional = false } = {}) {
  if (v === undefined || (optional && v === null)) return;
  if (!isBool(v)) e.add(path, `must be true or false`);
}
function checkPair(e, path, v, isItem, what) {
  if (opt(v)) return;
  if (!Array.isArray(v) || v.length !== 2 || !v.every(isItem)) e.add(path, `must be [${what}, ${what}]`);
}

/** `Line` {width = 1, color = "border"}. */
function checkLine(e, path, v) {
  if (opt(v)) return;
  if (!isObj(v)) return e.add(path, "must be an object {width, color}");
  e.unknown(path, v, ["width", "color"]);
  if (v.width !== undefined) checkNum(e, `${path}.width`, v.width, { optional: false });
  if (v.color !== undefined) checkStr(e, `${path}.color`, v.color, { optional: false });
}

/** `Divider` {width, color, hover?, active?}. */
function checkDivider(e, path, v) {
  if (opt(v)) return;
  if (!isObj(v)) return e.add(path, "must be an object {width, color, hover, active}");
  e.unknown(path, v, ["width", "color", "hover", "active"]);
  if (v.width !== undefined) checkNum(e, `${path}.width`, v.width, { optional: false });
  if (v.color !== undefined) checkStr(e, `${path}.color`, v.color, { optional: false });
  checkStr(e, `${path}.hover`, v.hover);
  checkStr(e, `${path}.active`, v.active);
}

/** `Background` (untagged): a colour string, {gradient, angle?} or {image, fit?}. */
function checkBackground(e, path, v) {
  if (opt(v) || isStr(v)) return;
  if (!isObj(v)) return e.add(path, "must be a colour string, {gradient, angle} or {image, fit}");
  if ("gradient" in v) {
    e.unknown(path, v, ["gradient", "angle"]);
    checkPair(e, `${path}.gradient`, v.gradient, isStr, "colour");
    if (v.gradient === null) e.add(`${path}.gradient`, "must be [colour, colour]");
    if (v.angle !== undefined) checkNum(e, `${path}.angle`, v.angle, { optional: false });
  } else if ("image" in v) {
    e.unknown(path, v, ["image", "fit"]);
    checkStr(e, `${path}.image`, v.image, { optional: false });
    if (v.fit !== undefined) checkStr(e, `${path}.fit`, v.fit, { optional: false, values: ["cover", "contain"] });
  } else {
    e.add(path, "an object background needs gradient or image");
  }
}

/** `Size` (untagged): {px} or {weight}. */
function checkSize(e, path, v) {
  if (opt(v)) return;
  if (!isObj(v)) return e.add(path, "must be {px} or {weight}");
  const keys = Object.keys(v);
  if (keys.length !== 1 || !["px", "weight"].includes(keys[0])) return e.add(path, `must be exactly {px} or {weight}, got {${keys.join(", ")}}`);
  checkNum(e, `${path}.${keys[0]}`, v[keys[0]], { optional: false });
  if (isNum(v[keys[0]]) && v[keys[0]] < 0) e.add(`${path}.${keys[0]}`, "must not be negative");
}

/** `Padding` (untagged): a number or [vertical, horizontal]. */
function checkPadding(e, path, v) {
  if (opt(v) || isNum(v)) return;
  checkPair(e, path, v, isNum, "number");
}

/** `FocusLook` {border?: Line, background?: String}. */
function checkFocusLook(e, path, v) {
  if (opt(v)) return;
  if (!isObj(v)) return e.add(path, "must be an object {border, background}");
  e.unknown(path, v, ["border", "background"]);
  checkLine(e, `${path}.border`, v.border);
  checkStr(e, `${path}.background`, v.background);
}

/** `HeaderContent` (untagged): a built-in name ("tabs") or {mod, props}. */
function checkHeaderContent(e, path, v) {
  if (isStr(v)) return;
  if (!isObj(v)) return e.add(path, `must be "tabs" or {mod, props}`);
  e.unknown(path, v, ["mod", "props"]);
  checkStr(e, `${path}.mod`, v.mod, { optional: false });
}

/** `Header` {content, reveal?, height?, position?}. */
function checkHeader(e, path, v) {
  if (opt(v)) return;
  if (!isObj(v)) return e.add(path, "must be an object {content, reveal, height, position}");
  e.unknown(path, v, ["content", "reveal", "height", "position"]);
  if (!("content" in v)) e.add(path, `missing field "content"`);
  else checkHeaderContent(e, `${path}.content`, v.content);
  checkStr(e, `${path}.reveal`, v.reveal, { values: ["always", "hover"] });
  checkNum(e, `${path}.height`, v.height);
  checkStr(e, `${path}.position`, v.position, { values: ["top", "bottom"] });
}

const SHADOWS = ["sm", "md", "lg"];

/** `PaneFrame`. */
function checkPaneFrame(e, path, v) {
  if (opt(v)) return;
  if (!isObj(v)) return e.add(path, "must be an object");
  e.unknown(path, v, ["header", "background", "shadow", "border", "focus", "veil", "radius", "gap", "lone"]);
  checkHeader(e, `${path}.header`, v.header);
  checkBackground(e, `${path}.background`, v.background);
  checkStr(e, `${path}.shadow`, v.shadow, { values: SHADOWS });
  checkLine(e, `${path}.border`, v.border);
  checkLine(e, `${path}.focus`, v.focus);
  checkNum(e, `${path}.veil`, v.veil);
  checkNum(e, `${path}.radius`, v.radius);
  checkNum(e, `${path}.gap`, v.gap);
  checkBool(e, `${path}.lone`, v.lone);
}

/**
 * `Content` (untagged, tried in order): {terminal}, {mod, props}, {tab|context, pane}, {agent}.
 * Strict: exactly one variant's key and nothing else.
 */
function checkContent(e, path, v) {
  if (!isObj(v)) return e.add(path, "must be an object: {terminal}, {mod, props}, {tab, pane} or {agent}");
  const variants = [
    ["terminal", ["terminal"]],
    ["mod", ["mod", "props"]],
    ["tab", ["tab", "pane"]],
    ["context", ["context", "pane"]],
    ["agent", ["agent"]],
  ].filter(([k]) => k in v);
  if (variants.length !== 1) {
    return e.add(path, variants.length ? `names more than one kind of content (${variants.map(([k]) => k).join(", ")})` : "needs terminal, mod, tab or agent");
  }
  const [key, fields] = variants[0];
  e.unknown(path, v, fields);
  checkStr(e, `${path}.${key}`, v[key], { optional: false });
  if (key === "tab" || key === "context") checkPaneFrame(e, `${path}.pane`, v.pane);
}

/** `Float` {id, content, edge?, align?, peek?, hidden?}. */
function checkFloat(e, path, v) {
  if (!isObj(v)) return e.add(path, "must be an object");
  e.unknown(path, v, ["id", "content", "edge", "align", "peek", "hidden"]);
  checkStr(e, `${path}.id`, v.id, { optional: false });
  if (!("content" in v)) e.add(path, `missing field "content"`);
  else checkContent(e, `${path}.content`, v.content);
  if (v.edge !== undefined) checkStr(e, `${path}.edge`, v.edge, { optional: false, values: ["top", "right", "bottom", "left"] });
  if (v.align !== undefined) checkStr(e, `${path}.align`, v.align, { optional: false, values: ["start", "center", "end"] });
  checkNum(e, `${path}.peek`, v.peek);
  checkBool(e, `${path}.hidden`, v.hidden);
}

function checkLook(e, path, v) {
  if (!opt(v.theme) && !isStr(v.theme)) {
    if (!isObj(v.theme)) e.add(`${path}.theme`, "must be a name or {light, dark}");
    else {
      e.unknown(`${path}.theme`, v.theme, ["light", "dark"]);
      checkStr(e, `${path}.theme.light`, v.theme.light, { optional: false });
      checkStr(e, `${path}.theme.dark`, v.theme.dark, { optional: false });
    }
  }
  if (!opt(v.colors)) {
    if (!isObj(v.colors)) e.add(`${path}.colors`, "must be an object of colour names");
    else for (const [k, c] of Object.entries(v.colors)) checkStr(e, `${path}.colors.${k}`, c, { optional: false });
  }
  checkStr(e, `${path}.font`, v.font);
  checkNum(e, `${path}.font_size`, v.font_size);
  for (const k of ["font_weight", "font_weight_bold"]) {
    if (!opt(v[k]) && !(Number.isInteger(v[k]) && v[k] >= 0 && v[k] <= 65535)) e.add(`${path}.${k}`, "must be a whole number (100 to 900)");
  }
  for (const k of ["terminal_line_height", "terminal_cell_width", "terminal_scroll_speed", "terminal_opacity"]) checkNum(e, `${path}.${k}`, v[k]);
  checkStr(e, `${path}.ui_font`, v.ui_font);
  checkPair(e, `${path}.terminal_padding`, v.terminal_padding, isNum, "number");
}

function checkNode(e, path, v, root) {
  if (!isObj(v)) return e.add(path, "must be an object");
  const here = `${path}${isStr(v.id) && v.id ? `(${v.id})` : ""}`;
  if (!("type" in v)) return e.add(here, `missing field "type"`);
  if (!NODE_TYPES.includes(v.type)) return e.add(here, `unknown type ${JSON.stringify(v.type)} (known: ${NODE_TYPES.join(", ")})`);
  const kindFields = KIND_FIELDS[v.type];
  e.unknown(here, v, [...NODE_COMMON, ...kindFields]);
  if (v.id !== undefined) checkStr(e, `${here}.id`, v.id, { optional: false });
  if (!opt(v.cloned_from)) {
    if (!isObj(v.cloned_from)) e.add(`${here}.cloned_from`, "must be {name, version}");
    else {
      e.unknown(`${here}.cloned_from`, v.cloned_from, ["name", "version"]);
      checkStr(e, `${here}.cloned_from.name`, v.cloned_from.name, { optional: false });
      checkStr(e, `${here}.cloned_from.version`, v.cloned_from.version, { optional: false });
    }
  }
  checkSize(e, `${here}.size`, v.size);
  checkNum(e, `${here}.min`, v.min);
  checkNum(e, `${here}.max`, v.max);
  if (isNum(v.min) && isNum(v.max) && v.min > v.max) e.add(here, `min ${v.min} is above max ${v.max}`);
  checkBool(e, `${here}.hidden`, v.hidden);
  checkStr(e, `${here}.title`, v.title);
  checkBackground(e, `${here}.background`, v.background);
  checkLine(e, `${here}.border`, v.border);
  checkNum(e, `${here}.radius`, v.radius);
  checkStr(e, `${here}.shadow`, v.shadow, { values: SHADOWS });
  checkPadding(e, `${here}.padding`, v.padding);
  checkFocusLook(e, `${here}.focus`, v.focus);
  checkLook(e, here, v);
  checkNum(e, `${here}.gap`, v.gap);
  checkDivider(e, `${here}.divider`, v.divider);
  for (const k of ["movable", "closable", "resizable"]) checkBool(e, `${here}.${k}`, v[k], { optional: true });
  if (v.floating !== undefined) {
    if (!Array.isArray(v.floating)) e.add(`${here}.floating`, "must be a list");
    else v.floating.forEach((f, i) => checkFloat(e, `${here}.floating[${i}]`, f));
  }
  checkStr(e, `${here}.titlebar`, v.titlebar, { values: ["system", "none"] });
  checkPair(e, `${here}.traffic_lights`, v.traffic_lights, isNum, "number");
  checkStr(e, `${here}.preview`, v.preview);
  checkStr(e, `${here}.terminal_menu`, v.terminal_menu);
  if (v.link_handlers !== undefined && !(Array.isArray(v.link_handlers) && v.link_handlers.every(isStr))) {
    e.add(`${here}.link_handlers`, "must be a list of mod names");
  }
  checkStr(e, `${here}.toast`, v.toast);
  checkBool(e, `${here}.window_drag`, v.window_drag);
  checkBool(e, `${here}.window_blur`, v.window_blur);
  if (!root) for (const k of ROOT_ONLY) if (k in v) e.add(here, `"${k}" is read on the root only`);

  if (v.type === "block") {
    if (!("content" in v)) e.add(here, `missing field "content"`);
    else checkContent(e, `${here}.content`, v.content);
  } else {
    if (!Array.isArray(v.children)) return e.add(here, `"children" must be a list`);
    v.children.forEach((c, i) => checkNode(e, `${here}.children[${i}]`, c, false));
    if (v.type === "stack") {
      checkStr(e, `${here}.active`, v.active);
      if (isStr(v.active) && !v.children.some((c) => isObj(c) && c.id === v.active)) e.add(`${here}.active`, `names no child: ${JSON.stringify(v.active)}`);
      checkHeader(e, `${here}.header`, v.header);
    }
  }
}

/** Every node of a layout tree, depth first (floats not included). */
export function walkNodes(node, parent = null, out = []) {
  if (!isObj(node)) return out;
  out.push({ node, parent });
  if (Array.isArray(node.children)) for (const c of node.children) walkNodes(c, node, out);
  return out;
}

/** Every node and float id in tree order. */
export function layoutIds(root) {
  const ids = [];
  for (const { node } of walkNodes(root)) {
    if (isStr(node.id)) ids.push(node.id);
    if (Array.isArray(node.floating)) for (const f of node.floating) if (isObj(f) && isStr(f.id)) ids.push(f.id);
  }
  return ids;
}

/** The ids from the root down to `id` (src/layout.rs path_to), or null. */
export function pathTo(root, id) {
  if (!isObj(root)) return null;
  if (root.id === id) return [root.id];
  for (const c of Array.isArray(root.children) ? root.children : []) {
    const p = pathTo(c, id);
    if (p) return [root.id, ...p];
  }
  return null;
}

/** `missing_mods`' walk (src/window.rs): every string value under a key named "mod", anywhere. */
export function modStrings(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => modStrings(v, out));
  else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === "mod" && isStr(v)) out.push(v);
      else modStrings(v, out);
    }
  }
  return out;
}

/** Every props value in a layout tree (block, float, stack and pane headers), with a path. */
export function propsValues(value, path = "$", out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => propsValues(v, `${path}[${i}]`, out));
  else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === "props") out.push({ path: `${path}.props`, value: v });
      else propsValues(v, `${path}.${k}`, out);
    }
  }
  return out;
}

/** Mod names a layout needs: every "mod" string plus the root's toast, terminal_menu and link_handlers. */
export function referencedMods(root) {
  const names = new Set(modStrings(root));
  if (isObj(root)) {
    if (isStr(root.toast)) names.add(root.toast);
    if (isStr(root.terminal_menu)) names.add(root.terminal_menu);
    if (Array.isArray(root.link_handlers)) root.link_handlers.filter(isStr).forEach((n) => names.add(n));
  }
  return [...names].filter((n) => !n.startsWith("frame-")).sort();
}

/**
 * Checks a parsed layout file against src/layout.rs (strictly: unknown fields
 * are errors) plus the tree rules herdr relies on (unique ids, stack `active`).
 * Returns a list of problems; empty means valid.
 */
export function validateLayout(root) {
  const e = new Errors();
  checkNode(e, "$", root, true);
  const seen = new Set();
  for (const id of layoutIds(root)) {
    if (id === "") continue;
    if (seen.has(id)) e.add("$", `duplicate id ${JSON.stringify(id)}`);
    seen.add(id);
  }
  return e.list;
}

// ---------------------------------------------------------------- keys

/** src/keys.rs ESCAPE_HATCH. */
export const ESCAPE_HATCH = "ctrl-alt-shift-escape";

/** `keys::tab`: null when the section name is valid, else herdr's error text. */
export function sectionError(section) {
  if (section === "global" || section === "terminal") return null;
  const mod = section.startsWith("mod:") ? section.slice(4) : null;
  const layout = section.startsWith("layout:") ? section.slice(7) : null;
  if (mod) return null;
  if (layout) return null;
  return `unknown section ${JSON.stringify(section)}: use "global", "terminal", "layout:<name>" or "mod:<name>"`;
}

/** Splits a string action into its command name (before the first colon). */
export const actionName = (action) => (action.includes(":") ? action.slice(0, action.indexOf(":")) : action);

/**
 * `keys::valid_action`. `find(name)` is `commands::find` (tools/mock/commands.js).
 */
export function validAction(action, find) {
  const name = actionName(action);
  if (find(name)) return true;
  if (action === "terminal" || action.startsWith("send:")) return true;
  const dot = name.indexOf(".");
  return dot > 0 && dot < name.length - 1;
}

/**
 * `keys::gone_mod`: a `<mod>.<cmd>` action whose mods/<mod>/ folder is missing
 * is silently dropped. `modDirExists(name)` answers for mods/<name>.
 */
export function goneMod(action, find, modDirExists) {
  const name = actionName(action);
  if (find(name)) return false;
  const dot = name.indexOf(".");
  if (dot < 0) return false;
  const m = name.slice(0, dot);
  return !m.startsWith("frame-") && !modDirExists(m);
}

/**
 * gpui `Keystroke::parse` (non-macOS): {modifiers, key} or throws.
 * modifiers: {control, alt, shift, platform, function}.
 */
export function parseKeystroke(source) {
  const modifiers = { control: false, alt: false, shift: false, platform: false, function: false };
  let key = null;
  const parts = source.split("-");
  for (let i = 0; i < parts.length; i++) {
    const component = parts[i];
    const lower = component.toLowerCase();
    if (lower === "ctrl") { modifiers.control = true; continue; }
    if (lower === "alt") { modifiers.alt = true; continue; }
    if (lower === "shift") { modifiers.shift = true; continue; }
    if (lower === "fn") { modifiers.function = true; continue; }
    if (lower === "secondary") { modifiers.control = true; continue; }
    if (lower === "cmd" || lower === "super" || lower === "win") { modifiers.platform = true; continue; }
    if (i + 1 < parts.length) {
      const next = parts[i + 1];
      if (next === "" && source.endsWith("-")) { key = "-"; break; }
      if (next.length > 1 && next.startsWith(">")) { key = component; i++; continue; }
      throw new Error(`invalid keystroke ${JSON.stringify(source)}`);
    }
    key = component.length === 1 && /[A-Z]/.test(component) ? (modifiers.shift = true, component.toLowerCase()) : lower;
  }
  if (key === null) {
    for (const [m, name] of [["shift", "shift"], ["control", "control"], ["alt", "alt"], ["platform", "platform"], ["function", "function"]]) {
      if (modifiers[m]) { modifiers[m] = false; key = name; break; }
    }
  }
  if (key === null) throw new Error(`invalid keystroke ${JSON.stringify(source)}`);
  return { modifiers, key };
}

/**
 * `KeyBinding::load`'s split: one or more whitespace-separated keystrokes.
 * Stricter than gpui: a blank chord or an empty key (gpui accepts both and
 * binds something no key press can match) is an error here.
 */
export function parseChord(keys) {
  const strokes = keys.split(/\s+/).filter(Boolean);
  if (!strokes.length) throw new Error(`no keystroke in ${JSON.stringify(keys)}`);
  return strokes.map((s) => {
    const k = parseKeystroke(s);
    if (!k.key) throw new Error(`no key in ${JSON.stringify(s)}`);
    return k;
  });
}

/** A canonical spelling of a parsed chord, for comparing chords written differently. */
export function chordId(keys) {
  return parseChord(keys).map(({ modifiers: m, key }) =>
    [m.control && "ctrl", m.alt && "alt", m.shift && "shift", m.platform && "cmd", m.function && "fn", key].filter(Boolean).join("-"),
  ).join(" ");
}

// ---------------------------------------------------------------- mod.json palette

const TARGET_ARGS = new Set(["id", "pane", "space", "terminal", "target"]);

/**
 * `modEntry` in defaults/frame/palette/main.js: the reason an entry of
 * mods/<mod>/mod.json `palette` would be dropped, or null when it is kept.
 * `find(name)` is `commands::find` ({name, args:[{name, required}]} or null).
 */
export function paletteEntryError(p, mod, find) {
  if (!isObj(p)) return "not an object";
  if (typeof p.title !== "string" || !p.title.trim()) return "needs a title";
  if (typeof p.command !== "string") return "needs a command";
  const args = p.args ?? {};
  if (!isObj(args)) return "args must be an object";
  const c = find(p.command);
  if (c) {
    const names = c.args.map((a) => a.name);
    for (const [k, v] of Object.entries(args)) {
      if (!names.includes(k)) return `${p.command} takes no argument "${k}"`;
      if (TARGET_ARGS.has(k) && v != null && typeof v !== "string") return `${p.command}: ${k} must be a string`;
    }
    for (const { name, required } of c.args) {
      if (!required || (name === "name" && p.command.endsWith(".rename") && args.name == null)) continue;
      if (args[name] == null || (typeof args[name] === "string" && !args[name].trim())) return `${p.command} needs ${name}`;
    }
  } else {
    const at = p.command.indexOf(".");
    if (at < 1 || p.command.slice(0, at) !== mod) return `not an app command and not ${mod}.<command>`;
    if (!p.command.slice(at + 1).trim()) return "empty mod command";
    if (Object.keys(args).length) return "a mod command takes no args";
  }
  return null;
}

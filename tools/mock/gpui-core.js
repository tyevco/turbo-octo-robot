// The gpui mock's implementation, shared by the mock "gpui-kit" and
// "gpui-base" modules: an element recorder faithful to herdr 0.1.18's
// gpui-shell. Mods never import this file; they import "gpui-kit" and
// "gpui-base", which re-export only the names the real modules have (plus, for
// "gpui-kit", the documented test helpers).
//
// Plain ES module with no imports outside this folder and no top-level side
// effects, so it runs unchanged in Node and in the QuickJS harness.
//
// Every builder returns an element whose calls are recorded (ARCHITECTURE A8):
//   { kind, args, styles: [[method, ...args]], children, id, handlers, hover,
//     transitions, loops, frames, spin }
// The rules are mirrored from the shell (vendor/gpui-kit/crates/shell/src):
//   value.rs   colours, numbers, strings and their error messages
//   style.rs   the length grammar, font weight, unknown-method diagnostics
//   engine/quickjs/mod.rs (the JS prelude)   transition/spring/frames/loop/spin,
//              lists, PathBuilder, Background, paint_path, slots, state styles
//   spec.rs    single-use elements (already parented / claimed / expired)
// Messages are copied verbatim; all are thrown as TypeError (the shell uses
// `Exception::throw_type`) except the prelude's explicit RangeErrors.

import METHODS from "./gpui-methods.js";

// ---------------------------------------------------------------------------
// Bridged values (value.rs)

/** Rust `{}` for an f64. */
function fmtF64(n) {
  if (Number.isNaN(n)) return "NaN";
  if (n === Infinity) return "inf";
  if (n === -Infinity) return "-inf";
  if (Object.is(n, -0)) return "-0";
  const text = String(n);
  if (!/e/i.test(text)) return text;
  return expandExponent(text);
}

/** Rust `{}` for an f32: the shortest decimal that round-trips through f32. */
function fmtF32(value) {
  const f = Math.fround(value);
  if (!Number.isFinite(f) || Object.is(f, -0) || f === 0) return fmtF64(f);
  for (let digits = 1; digits <= 9; digits++) {
    const text = f.toPrecision(digits);
    if (Math.fround(Number(text)) === f) return expandExponent(String(Number(text)));
  }
  return fmtF64(f);
}

function expandExponent(text) {
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(text);
  if (!match) return text;
  const [, sign, int, frac = "", expText] = match;
  const exp = Number(expText);
  const digits = int + frac;
  const point = int.length + exp;
  if (point <= 0) return sign + "0." + "0".repeat(-point) + digits.replace(/0+$/, "");
  if (point >= digits.length) return sign + digits + "0".repeat(point - digits.length);
  return sign + digits.slice(0, point) + "." + digits.slice(point);
}

const UNSUPPORTED = "unsupported argument type; expected null, boolean, number, string or function";

/** A script value after crossing the bridge: nil | bool | number | string. Functions are handlers. */
function bridge(value) {
  if (value === null || value === undefined) return { t: "nil" };
  if (typeof value === "boolean") return { t: "bool", v: value };
  if (typeof value === "number") return { t: "num", v: value };
  if (typeof value === "string") return { t: "str", v: value };
  if (typeof value === "function") return { t: "fn", v: value };
  throw new TypeError(UNSUPPORTED);
}

function describe(b) {
  switch (b.t) {
    case "nil": return "nil";
    case "bool": return `boolean (${b.v})`;
    case "num": return `number (${fmtF64(b.v)})`;
    case "str": return `string ("${b.v}")`;
    default: return "function";
  }
}

function asNumber(b) {
  if (b.t === "num") return b.v;
  throw new TypeError(`expected a number, got ${describe(b)}`);
}

function asString(b) {
  if (b.t === "str") return b.v;
  throw new TypeError(`expected a string, got ${describe(b)}`);
}

function utf8Length(text) {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** `parse_hex` (value.rs): 3, 6 or 8 bytes; `u32::from_str_radix` accepts a leading `+`. */
function parseHex(hex) {
  const length = utf8Length(hex);
  if (length === 3) {
    if (!/^[0-9a-fA-F]{3}$/.test(hex)) return null;
    const [r, g, b] = [...hex].map((c) => parseInt(c, 16) * 17);
    return { r, g, b, a: 255 };
  }
  if (length === 6 || length === 8) {
    if (!/^\+?[0-9a-fA-F]+$/.test(hex)) return null;
    let value = parseInt(hex.replace(/^\+/, ""), 16);
    if (length === 6) value = value * 256 + 0xff;
    return {
      r: Math.floor(value / 0x1000000) & 0xff,
      g: (value >>> 16) & 0xff,
      b: (value >>> 8) & 0xff,
      a: value & 0xff,
    };
  }
  return null;
}

/** `Bridged::as_color` (value.rs). Returns `{r,g,b,a}` (0..255) or throws. */
export function parseColor(value) {
  return colorFromBridged(bridge(value));
}

function colorFromBridged(b) {
  const text = asString(b);
  if (!text.startsWith("#")) {
    throw new TypeError(
      `\`${text}\` is not a color value; pass a color from \`cx.theme().colors\` or a #rgb, #rrggbb, or #rrggbbaa literal`,
    );
  }
  const rgba = parseHex(text.slice(1));
  if (!rgba) {
    throw new TypeError(`\`${text}\` is not a valid color literal (expected #rgb, #rrggbb or #rrggbbaa)`);
  }
  return rgba;
}

/** The colour if valid, else null (how `Background` colours fail: silently). */
export function tryParseColor(value) {
  try {
    return parseColor(value);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Length grammar (style.rs)

const RUST_FLOAT = /^[+-]?(?:inf|infinity|nan|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/i;

// Rust's `str::trim` strips the Unicode White_Space property, which is not
// JavaScript's `String.prototype.trim` set: Rust also strips U+0085 (NEL) and
// does not strip U+FEFF (BOM). `p("\uFEFF12px")` is an error in herdr.
const RUST_WS = "[\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const RUST_TRIM = new RegExp(`^${RUST_WS}+|${RUST_WS}+$`, "g");

/** Rust `str::trim`. */
export function rustTrim(text) {
  return text.replace(RUST_TRIM, "");
}

function parseNumber(number, text, method) {
  const trimmed = rustTrim(number);
  if (!RUST_FLOAT.test(trimmed)) {
    throw new TypeError(`\`${method}\` could not read a number in the length "${text}"`);
  }
  const lower = trimmed.toLowerCase().replace(/^\+/, "");
  if (lower === "inf" || lower === "infinity") return Infinity;
  if (lower === "-inf" || lower === "-infinity") return -Infinity;
  if (lower.endsWith("nan")) return NaN;
  return Number(trimmed);
}

/**
 * A length literal: `{ px }` (script pixels, before zoom), `{ rem }`,
 * `{ frac }` (a percentage as a fraction) or `{ auto: true }`.
 */
function parseLength(b, method) {
  if (b.t === "str") {
    const text = rustTrim(b.v);
    if (text === "auto") return { auto: true };
    if (text.endsWith("%")) return { frac: parseNumber(text.slice(0, -1), text, method) / 100 };
    if (text.endsWith("rem")) return { rem: parseNumber(text.slice(0, -3), text, method) };
    if (text.endsWith("px")) return { px: parseNumber(text.slice(0, -2), text, method) };
    throw new TypeError(
      `\`${method}\` expects a length: a number of pixels, or a string like "50%", "12px", "1rem" or "auto"; got "${text}"`,
    );
  }
  return { px: asNumber(b) };
}

/**
 * The length a style argument denotes, for renderers: `{ px }` (script
 * pixels, zoom not applied), `{ rem }`, `{ frac }` or `{ auto: true }`.
 * Throws the shell's message for anything the grammar refuses.
 */
export function lengthOf(value, method = "length") {
  return parseLength(bridge(value), method);
}

function definiteLength(b, method) {
  const length = parseLength(b, method);
  if (length.auto) {
    throw new TypeError(`\`${method}\` cannot be "auto"; it expects a definite length such as 12 or "50%"`);
  }
  return length;
}

function absoluteLength(b, method) {
  const length = parseLength(b, method);
  if (length.auto || "frac" in length) {
    throw new TypeError(
      `\`${method}\` expects an absolute length such as 8 or "0.5rem"; percentages and "auto" are not allowed here`,
    );
  }
  return length;
}

/** Validates one parametric style argument exactly as `style::apply_param` does. */
// Fast paths with the same outcome as the full checks below: any number is a
// valid Length / DefiniteLength / AbsoluteLength / number argument (it bridges
// to `{ px }`), and a colour string that parsed once parses again. They keep
// the mock's own cost per style call low, so the QuickJS harness's render
// timings measure the mod rather than the recorder.
const NUMERIC_KINDS = new Set(["Length", "DefiniteLength", "AbsoluteLength", "number"]);
const GOOD_COLORS = new Set();

function checkParam(name, kind, args) {
  if (args.length === 0 || args[0] === undefined) {
    throw new TypeError(`\`${name}\` expects at least 1 argument(s), got 0`);
  }
  const v = args[0];
  if (typeof v === "number" && name !== "font_weight" && (name === "line_height" || NUMERIC_KINDS.has(kind))) return;
  if (kind === "Color" && typeof v === "string" && GOOD_COLORS.has(v)) return;
  if (kind === "Color" && typeof v === "string") {
    colorFromBridged(bridge(v));
    if (GOOD_COLORS.size > 4096) GOOD_COLORS.clear();
    GOOD_COLORS.add(v);
    return;
  }
  const b = bridge(v);
  if (b.t === "fn") throw new TypeError(`\`${name}\` does not take a function`);
  if (name === "line_height") {
    if (b.t !== "num") definiteLength(b, name);
    return;
  }
  if (name === "font_weight") {
    const weight = Math.fround(asNumber(b));
    if (!(Number.isFinite(weight) && weight >= 100 && weight <= 900)) {
      throw new TypeError(`\`${name}\` expects a finite number between 100 and 900; got ${fmtF32(weight)}`);
    }
    return;
  }
  switch (kind) {
    case "Color": colorFromBridged(b); return;
    case "Length": parseLength(b, name); return;
    case "DefiniteLength": definiteLength(b, name); return;
    case "AbsoluteLength": absoluteLength(b, name); return;
    case "number": asNumber(b); return;
    case "string": asString(b); return;
    default: throw new TypeError(`mock: unknown argument kind ${kind} for \`${name}\``);
  }
}

// ---------------------------------------------------------------------------
// Unknown methods (style.rs `suggest` / `unknown_message`)

let knownStyleNames = null;

function styleNames() {
  if (!knownStyleNames) knownStyleNames = [...METHODS.nullary, ...Object.keys(METHODS.param)].sort();
  return knownStyleNames;
}

/**
 * Levenshtein distance over code points, as style.rs computes it; gives up
 * (returns `limit + 1`) once every cell of a row exceeds `limit`.
 */
function editDistance(left, right, limit = Infinity) {
  const a = [...left];
  const b = [...right];
  let previous = new Array(b.length + 1);
  let current = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;
  for (let i = 0; i < a.length; i++) {
    current[0] = i + 1;
    let rowMin = current[0];
    for (let j = 0; j < b.length; j++) {
      const substitution = previous[j] + (a[i] === b[j] ? 0 : 1);
      const value = Math.min(substitution, previous[j + 1] + 1, current[j] + 1);
      current[j + 1] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > limit) return limit + 1;
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[b.length];
}

/** The closest known style name within the shell's budget, or null. */
export function suggest(name) {
  const budget = Math.max(2, Math.floor([...name].length / 3));
  let best = null;
  const length = [...name].length;
  for (const candidate of styleNames()) {
    // The distance is at least the difference in length: skip the hopeless.
    if (Math.abs(candidate.length - length) > budget) continue;
    const distance = editDistance(name, candidate, best ? Math.min(budget, best[0] - 1) : budget);
    if (distance > budget) continue;
    if (!best || distance < best[0]) best = [distance, candidate];
  }
  return best ? best[1] : null;
}

export function unknownMethodMessage(name) {
  const candidate = suggest(name);
  return candidate
    ? `unknown style method \`${name}\` (did you mean: ${candidate}?)`
    : `unknown style method \`${name}\``;
}

// ---------------------------------------------------------------------------
// Element lifetime (spec.rs SpecError)

const EXPIRED =
  "this element belongs to a previous render pass; elements are single-use values and must be rebuilt each time render runs";
const CLAIMED =
  "this element was given to a method that takes one — a state style's declarations, or a named slot such as content — and cannot also be added to the tree";
const SELF_PARENT = "an element cannot be added to itself";

let renderEpoch = 0;
let nextUid = 1;
let nextHandle = 1;

/**
 * Starts a new render pass: elements built before it become expired (using
 * one then throws, as in the shell). Harnesses call this before each render.
 */
export function beginRender() {
  renderEpoch += 1;
  return renderEpoch;
}

/** A fresh handle number for the `{ __handle }` wrappers (scroll handles, …). */
export function allocateHandle() {
  return nextHandle++;
}

function displayName(r) {
  if (r.kind === "path") return r.args[0].fill ? "path fill" : "path stroke";
  return r.kind;
}

function checkLive(r) {
  if (r.epoch !== renderEpoch) throw new TypeError(EXPIRED);
  if (r.parented) {
    throw new TypeError(`element \`${displayName(r)}\` was already added to a parent; elements are single-use values`);
  }
}

/** The record of an element (throws when `value` is not one). */
function rec(value) {
  const r = value?.__r;
  if (!r) throw new TypeError("mock: not a gpui element");
  return r;
}

function live(element) {
  const r = rec(element);
  checkLive(r);
  return r;
}

function isElement(value) {
  return Boolean(value && typeof value === "object" && value.__r && value.__r.uid);
}

// ---------------------------------------------------------------------------
// The element prototype

const PASSTHROUGH = new Set(["then", "toJSON", "constructor"]);

function makeFallback() {
  const target = {};
  return new Proxy(target, {
    get(t, name, receiver) {
      if (typeof name !== "string" || name.startsWith("__") || PASSTHROUGH.has(name) || name in Object.prototype) {
        return Reflect.get(t, name, receiver);
      }
      return function unknownMethod() {
        throw new TypeError(unknownMethodMessage(name));
      };
    },
  });
}

let proto = null;
const EMPTY_ARGS = Object.freeze([]);

function elementProto() {
  if (proto) return proto;
  const p = Object.create(makeFallback());
  for (const name of METHODS.nullary) {
    p[name] = function () {
      live(this).styles.push([name]);
      return this;
    };
  }
  for (const [name, kind] of Object.entries(METHODS.param)) {
    // Only the first argument is read (style.rs apply_param); a one-element
    // array keeps checkParam's signature without a rest-args allocation.
    p[name] = function (a) {
      const r = live(this);
      checkParam(name, kind, a === undefined ? EMPTY_ARGS : [a]);
      r.styles.push([name, a]);
      return this;
    };
  }
  for (const name of METHODS.behaviors) {
    p[name] = BEHAVIORS[name] ?? (name.startsWith("on_") || name === "token" ? handlerMethod(name) : genericMethod(name));
  }
  p.toJSON = function () {
    return serialize(this);
  };
  proto = p;
  return p;
}

function newElement(kind, args = [], id = null, extra = null) {
  const element = Object.create(elementProto());
  const r = {
    kind,
    args,
    id: id === null || id === undefined ? null : String(id),
    styles: [],
    children: [],
    handlers: Object.create(null),
    hover: null,
    active: null,
    focus: null,
    states: null,
    transitions: [],
    loops: [],
    frames: null,
    spin: null,
    slots: null,
    items: null,
    list: null,
    uid: nextUid++,
    epoch: renderEpoch,
    parented: false,
    claimed: false,
    componentId: id !== null && id !== undefined,
  };
  if (extra) Object.assign(r, extra);
  Object.defineProperty(element, "__r", { value: r, enumerable: false });
  return element;
}

// Behaviour checks the shell makes at the call site (engine/quickjs/mod.rs
// `ShellRuntime::apply`, the "disabled | selectable | … | id" arm). A value the
// shell would drop or refuse is refused here with the same message.

/** `gpui::Role` variants in accesskit order (vendor/gpui-kit/crates/shell/src/a11y.rs). */
const ROLE_VARIANTS = (
  "Unknown TextRun Cell Label Image Link Row ListItem ListMarker TreeItem ListBoxOption MenuItem " +
  "MenuListOption Paragraph CheckBox RadioButton TextInput Button DefaultButton Pane RowHeader ColumnHeader " +
  "RowGroup List Table LayoutTableCell LayoutTableRow LayoutTable Switch Menu MultilineTextInput SearchInput " +
  "DateInput DateTimeInput WeekInput MonthInput TimeInput EmailInput NumberInput PasswordInput " +
  "PhoneNumberInput UrlInput Abbr Alert AlertDialog Application Article Audio Banner Blockquote Canvas " +
  "Caption Caret Code ColorWell ComboBox EditableComboBox Complementary Comment ContentDeletion " +
  "ContentInsertion ContentInfo Definition DescriptionList Details Dialog DisclosureTriangle Document " +
  "EmbeddedObject Emphasis Feed FigureCaption Figure Footer Form Grid GridCell Group Header Heading Iframe " +
  "IframePresentational ImeCandidate Keyboard Legend LineBreak ListBox Log Main Mark Marquee Math MenuBar " +
  "MenuItemCheckBox MenuItemRadio MenuListPopup Meter Navigation Note PluginObject ProgressIndicator " +
  "RadioGroup Region RootWebArea Ruby RubyAnnotation ScrollBar ScrollView Search Section SectionFooter " +
  "SectionHeader Slider SpinButton Splitter Status Strong Suggestion SvgRoot Tab TabList TabPanel Term Time " +
  "Timer TitleBar Toolbar Tooltip Tree TreeGrid Video WebView Window PdfActionableHighlight PdfRoot " +
  "GraphicsDocument GraphicsObject GraphicsSymbol DocAbstract DocAcknowledgements DocAfterword DocAppendix " +
  "DocBackLink DocBiblioEntry DocBibliography DocBiblioRef DocChapter DocColophon DocConclusion DocCover " +
  "DocCredit DocCredits DocDedication DocEndnote DocEndnotes DocEpigraph DocEpilogue DocErrata DocExample " +
  "DocFootnote DocForeword DocGlossary DocGlossRef DocIndex DocIntroduction DocNoteRef DocNotice " +
  "DocPageBreak DocPageFooter DocPageHeader DocPageList DocPart DocPreface DocPrologue DocPullquote DocQna " +
  "DocSubtitle DocTip DocToc ListGrid Terminal"
).split(" ");
const ROLE_SET = new Set(ROLE_VARIANTS);

/** a11y.rs `role_from_name`: no ASCII capitals, then `pascal_case` must name a variant. */
export function isRoleName(name) {
  if (/[A-Z]/.test(name)) return false;
  let out = "";
  let capitalize = true;
  for (const ch of name) {
    if (ch === "_") {
      capitalize = true;
      continue;
    }
    out += capitalize ? ch.toUpperCase() : ch;
    capitalize = false;
  }
  return ROLE_SET.has(out);
}

/** capability.rs `is_openable_url`: an absolute http(s) URL with a host. */
function isOpenableUrl(text) {
  if (typeof URL === "function") {
    try {
      const url = new URL(text);
      return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
    } catch {
      return false;
    }
  }
  // QuickJS has no URL: a conservative reading of the WHATWG grammar.
  return /^[\t\n\r ]*https?:[\\/]*[^\s\\/?#@:]+(?::\d*)?(?:[\\/?#][^\s]*)?[\t\n\r ]*$/i.test(text);
}

const asF32 = (b) => (b && b.t === "num" ? Math.fround(b.v) : null);
const finiteF32 = (b) => {
  const n = asF32(b);
  return n !== null && Number.isFinite(n) ? n : null;
};
const wholeF32 = (b) => {
  const n = finiteF32(b);
  return n !== null && Number.isInteger(n) ? n : null;
};
const USIZE_MAX_F32 = Math.fround(2 ** 64);

function checkBehavior(name, bridged) {
  const first = bridged[0];
  switch (name) {
    case "id":
      if (!first || first.t !== "str") {
        throw new TypeError(
          "id(name) expects a string; it is the element's stable identity, so it must not change between renders",
        );
      }
      return;
    case "tooltip":
      if (!first || first.t !== "str") {
        throw new TypeError("tooltip(text) expects a string; a tooltip built from an element is not bound yet");
      }
      return;
    case "value":
      if (finiteF32(first) === null) throw new TypeError("value(percent) expects a number between 0 and 100");
      return;
    case "set_position": {
      const position = wholeF32(first);
      const size = wholeF32(bridged[1]);
      if (!(position !== null && size !== null && position >= 1 && size >= position && size <= USIZE_MAX_F32)) {
        throw new TypeError("set_position(position, size) expects whole finite numbers with 1 <= position <= size");
      }
      return;
    }
    case "size_range": {
      const min = finiteF32(first);
      if (min === null) throw new RangeError("size_range minimum does not fit the native pixel range");
      if (bridged.length > 1) {
        const max = finiteF32(bridged[1]);
        if (max === null) throw new RangeError("size_range maximum does not fit the native pixel range");
        if (max < min) throw new RangeError("size_range maximum must be greater than or equal to its minimum");
      }
      return;
    }
    case "row_count":
    case "column_count": {
      const count = wholeF32(first);
      if (!(count !== null && count >= 0 && count <= USIZE_MAX_F32)) {
        throw new TypeError(`${name}(count) expects a non-negative whole finite number`);
      }
      return;
    }
    case "role": {
      if (!first || first.t !== "str") {
        throw new TypeError("role(name) expects a string; see the Role type in gpui-kit.d.ts");
      }
      if (first.v === "generic_container") {
        throw new TypeError(
          'role("generic_container") announces nothing: GPUI filters that role out of the accessibility tree. ' +
            "Leave the role off instead, or name the role the element really has",
        );
      }
      if (!isRoleName(first.v)) {
        throw new TypeError(
          `unknown accessibility role \`${first.v}\`; the names mirror gpui::Role in snake_case — see the Role type in gpui-kit.d.ts`,
        );
      }
      return;
    }
    case "tab_index": {
      const index = asF32(first);
      if (index === null || !Number.isInteger(index)) throw new TypeError("tab_index(index) expects a whole number");
      return;
    }
    case "href":
      if (!first || first.t !== "str") throw new TypeError("href(url) expects a string");
      if (!isOpenableUrl(first.v)) throw new TypeError("href(url) expects an absolute HTTP(S) URL with a host");
      return;
    default:
  }
}

/** Records a generic behaviour call: arguments are bridged (objects refused), then checked as the shell does. */
function genericMethod(name) {
  return function (...args) {
    const r = live(this);
    const bridged = args.map((arg) => {
      const b = bridge(arg);
      if (b.t === "fn") throw new TypeError(`\`${name}\` does not take a function`);
      return b;
    });
    checkBehavior(name, bridged);
    if (name === "id") {
      if (!r.componentId) r.id = args[0];
    }
    r.styles.push([name, ...args]);
    return this;
  };
}

// While a lazy list's item renderer runs (the shell's Layout phase), handlers
// and nested lists are refused (mod.rs ShellRuntime::apply, guard_lazy_list).
let itemRendererDepth = 0;

/**
 * Clears the render guards a host's interrupt can leave set: an interrupt
 * unwinds the script stack without running its `finally` blocks, so the item
 * renderer depth (and `constructView`'s deferred-init flag) would otherwise
 * stay raised and refuse every later handler. The QuickJS harness calls this
 * from its recover op.
 */
export function resetRenderGuards() {
  itemRendererDepth = 0;
  deferInit = false;
}

/**
 * The shell's current scope phase as far as the mocks can tell: "layout"
 * inside a lazy list's item renderer, else the mock herdr controller's open
 * scope (render / event / task / layout), else null (no host call known).
 */
export function currentPhase() {
  if (itemRendererDepth > 0) return "layout";
  return globalThis.__herdr?.scope?.phase ?? null;
}

const MOUSE_BUTTONS = ["left", "right", "middle", "back", "forward"];

function refuseInItemRenderer(name, tail) {
  if (itemRendererDepth > 0) {
    throw new TypeError(
      `\`${name}\` cannot be registered from a virtual list's item renderer: the rows are rebuilt every frame, ` +
        "so a handler registered there would pile up for as long as the view stood" + tail,
    );
  }
}

/**
 * `on_*` / `token`: the handler is the FIRST argument (mod.rs `first_handler`);
 * `on_action(name, handler)` and `on_mouse_down/up`, `on_window_mouse_up`
 * `(button, handler)` take a string first. Registration from inside a lazy
 * list's item renderer is refused, as in the shell.
 */
function handlerMethod(name) {
  if (name === "on_action") {
    return function (action, handler) {
      const r = live(this);
      refuseInItemRenderer(name, "");
      if (typeof action !== "string" || action === "") {
        throw new TypeError("on_action(action, handler) expects the action's name first, as a non-empty string");
      }
      if (typeof handler !== "function") throw new TypeError("on_action(action, handler) expects a function second");
      r.handlers[`${name}:${action}`] = handler;
      return this;
    };
  }
  if (name === "on_mouse_down" || name === "on_mouse_up" || name === "on_window_mouse_up") {
    return function (button, handler) {
      const r = live(this);
      refuseInItemRenderer(name, "");
      if (typeof button !== "string") {
        throw new TypeError(
          `${name}(button, handler) expects a button first: "left", "right", "middle", "back" or "forward"`,
        );
      }
      if (typeof handler !== "function") throw new TypeError(`${name}(button, handler) expects a function second`);
      if (!MOUSE_BUTTONS.includes(button)) {
        throw new TypeError(
          `\`${button}\` is not a mouse button; expected "left", "right", "middle", "back" or "forward"`,
        );
      }
      r.handlers[`${name}:${button}`] = handler;
      return this;
    };
  }
  return function (handler) {
    const r = live(this);
    refuseInItemRenderer(
      name,
      ". Use `on_item_click((key, cx) => ...)` or `on_item_secondary_click((key, event, cx) => ...)` on the list " +
        "itself, and read the row out of your own data with the stable key it gives you",
    );
    if (typeof handler !== "function") throw new TypeError(`${name}(handler) expects a function`);
    r.handlers[name] = handler;
    return this;
  };
}

/**
 * What the shell accepts as a view's render() result (engine/quickjs/mod.rs
 * `element_id`): a live element, an Entity, or a string (a text element).
 * Anything else — a number, undefined, an array, a plain object — is refused.
 */
export function renderRoot(value) {
  if (typeof value === "string") return { kind: "text", text: value };
  if (isElement(value)) {
    checkLive(value.__r);
    return value;
  }
  if (value && typeof value === "object" && value.__entity === true) return { kind: "child_view", entity: value };
  throw new TypeError("render(cx) must return an element, an Entity, or a string");
}

function childNode(child) {
  if (isElement(child)) return child;
  const kind = typeof child;
  if (kind === "string" || kind === "number" || kind === "boolean") return { kind: "text", text: String(child) };
  if (child?.__entity) return { kind: "child_view", entity: child };
  throw new TypeError("child(value) expects an element, a string, or an entity from cx.new(Class, props)");
}

function attach(parent, child) {
  const pr = rec(parent);
  checkLive(pr);
  const node = childNode(child);
  if (isElement(node)) {
    const cr = node.__r;
    checkLive(cr);
    if (cr.claimed) throw new TypeError(CLAIMED);
    if (cr === pr) throw new TypeError(SELF_PARENT);
    cr.parented = true;
  }
  pr.children.push(node);
}

const MOTION = ["opacity", "width", "height", "left", "top"];
const EASINGS = ["linear", "ease-in", "ease-out", "ease-in-out"];

function finiteNonNegative(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(name + " must be a finite non-negative number");
  }
  return value;
}

function finitePositive(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(name + " must be a finite positive number");
  }
  return value;
}

function finiteDuration(value, name) {
  value = finiteNonNegative(value, name);
  if (value > 86400000) throw new RangeError(name + " must not exceed 86400000 milliseconds");
  return value;
}

function slot(name) {
  return function (element) {
    const r = live(this);
    if (!isElement(element)) throw new TypeError(`${name}(element) expects an element`);
    const er = element.__r;
    checkLive(er);
    if (er.claimed) throw new TypeError(CLAIMED);
    er.claimed = true;
    (r.slots ??= Object.create(null))[name] = element;
    return this;
  };
}

function stateStyle(name) {
  return function (declare) {
    const r = live(this);
    const target = newElement("div");
    target.__r.claimed = true;
    declare(target);
    const styles = target.__r.styles;
    if (name === "hover" || name === "active" || name === "focus") {
      r[name] = (r[name] ?? []).concat(styles);
    } else {
      r.states ??= Object.create(null);
      r.states[name] = (r.states[name] ?? []).concat(styles);
    }
    return this;
  };
}

function handleMethod(name, message) {
  return function (handle) {
    const r = live(this);
    if (typeof handle?.__handle !== "number") throw new TypeError(message);
    r.styles.push([name, handle.__handle]);
    return this;
  };
}

function oneOf(name, allowed, message) {
  return function (value) {
    const r = live(this);
    value = String(value);
    if (!allowed().includes(value)) throw new TypeError(message(value));
    r.styles.push([name, value]);
    return this;
  };
}

function motionProperty(api, property) {
  property = String(property);
  if (!MOTION.includes(property)) {
    throw new TypeError(
      `${api}(property, policy) supports opacity, width, height, left or top; got ` + JSON.stringify(property),
    );
  }
  return property;
}

const BEHAVIORS = {
  map(transform) {
    return transform(this);
  },
  when(condition, branch) {
    if (!condition) return this;
    const produced = branch(this);
    if (produced === undefined || produced === null) throw new Error("when(...) must return the element");
    return produced;
  },
  child(child) {
    attach(this, child);
    return this;
  },
  children(list) {
    for (const child of list) attach(this, child);
    return this;
  },
  content: slot("content"),
  trigger: slot("trigger"),
  input: slot("input"),
  decrement_button: slot("decrement_button"),
  increment_button: slot("increment_button"),
  image: slot("image"),
  fallback: slot("fallback"),
  header: slot("header"),
  footer: slot("footer"),
  panel: slot("panel"),
  track_focus: handleMethod(
    "track_focus",
    "track_focus(handle) expects a FocusHandle from cx.focus_handle(), not a name or an element",
  ),
  track_scroll: handleMethod("track_scroll", "track_scroll(handle) expects a ScrollHandle or VirtualListScrollHandle"),
  content_focus_handle: handleMethod(
    "content_focus_handle",
    "content_focus_handle(handle) expects a FocusHandle from cx.focus_handle(), not a name or an element",
  ),
  hover: stateStyle("hover"),
  active: stateStyle("active"),
  focus: stateStyle("focus"),
  range_style: stateStyle("range_style"),
  cell_style: stateStyle("cell_style"),
  cell_active_style: stateStyle("cell_active_style"),
  caret_style: stateStyle("caret_style"),
  transition(property, options) {
    const r = live(this);
    property = motionProperty("transition", property);
    const policy = typeof options === "number" ? { duration: options } : (options ?? {});
    const duration = finiteDuration(policy.duration ?? 0, "transition duration");
    const delay = finiteDuration(policy.delay ?? 0, "transition delay");
    const easing = policy.easing ?? "ease-out";
    if (!EASINGS.includes(easing)) {
      throw new TypeError(
        "transition easing must be linear, ease-in, ease-out or ease-in-out; got " + JSON.stringify(easing),
      );
    }
    r.transitions.push({ kind: "transition", property, duration, delay, easing });
    return this;
  },
  spring(property, options) {
    const r = live(this);
    property = motionProperty("spring", property);
    const policy = options ?? {};
    const response = finiteDuration(policy.response ?? 250, "spring response");
    const damping = finiteNonNegative(policy.damping ?? 1, "spring damping");
    const epsilon = finitePositive(policy.epsilon ?? 0.001, "spring epsilon");
    r.transitions.push({ kind: "spring", property, response, damping, epsilon });
    return this;
  },
  frames(list, ms) {
    const r = live(this);
    if (!Array.isArray(list) || list.length === 0 || !list.every((s) => typeof s === "string")) {
      throw new TypeError("frames(list, ms) expects a non-empty array of strings");
    }
    const step = finiteDuration(ms ?? 100, "frames interval");
    if (step < 16) throw new RangeError("frames interval must be at least 16 milliseconds");
    r.frames = { list: list.slice(), ms: step };
    return this;
  },
  loop(property, options) {
    const r = live(this);
    property = motionProperty("loop", property);
    const policy = options ?? {};
    if (typeof policy.from !== "number" || typeof policy.to !== "number") {
      throw new TypeError("loop(property, policy) needs numbers for from and to");
    }
    const period = finiteDuration(policy.period ?? 1000, "loop period");
    if (period < 100) throw new RangeError("loop period must be at least 100 milliseconds");
    const easing = policy.easing ?? "ease-in-out";
    if (!EASINGS.includes(easing)) {
      throw new TypeError("loop easing must be linear, ease-in, ease-out or ease-in-out; got " + JSON.stringify(easing));
    }
    r.loops.push({ property, from: policy.from, to: policy.to, period, easing });
    return this;
  },
  spin(ms) {
    const r = live(this);
    const period = finiteDuration(ms ?? 1000, "spin period");
    if (period < 100) throw new RangeError("spin period must be at least 100 milliseconds");
    r.spin = period;
    return this;
  },
  axis: oneOf(
    "axis",
    () => ["horizontal", "vertical"],
    (v) => "axis(value) must be horizontal or vertical; got " + JSON.stringify(v),
  ),
  mode: oneOf(
    "mode",
    () => ["scrolling", "hover", "always"],
    (v) => "mode(value) must be scrolling, hover or always; got " + JSON.stringify(v),
  ),
  anchor: oneOf(
    "anchor",
    () => METHODS.anchors,
    (v) => "anchor(value) must be one of " + METHODS.anchors.join(", ") + "; got " + JSON.stringify(v),
  ),
  mouse_button: oneOf(
    "mouse_button",
    () => ["left", "right", "middle", "back", "forward"],
    (v) => "mouse_button(value) must be left, right, middle, back or forward; got " + JSON.stringify(v),
  ),
  scroll_size(width, height) {
    const r = live(this);
    r.styles.push([
      "scroll_size",
      finiteNonNegative(width, "scroll_size width"),
      finiteNonNegative(height, "scroll_size height"),
    ]);
    return this;
  },
  frame_budget(milliseconds) {
    const r = live(this);
    r.styles.push(["frame_budget", finitePositive(milliseconds, "frame_budget")]);
    return this;
  },
  open_delay(ms) {
    const r = live(this);
    r.styles.push(["open_delay", finiteDuration(ms, "open_delay")]);
    return this;
  },
  close_delay(ms) {
    const r = live(this);
    r.styles.push(["close_delay", finiteDuration(ms, "close_delay")]);
    return this;
  },
  size_range(min, max) {
    const r = live(this);
    const args = [finiteNonNegative(min, "size_range min")];
    if (max !== undefined && max !== null) args.push(finiteNonNegative(max, "size_range max"));
    checkBehavior("size_range", args.map(bridge)); // the shell's own checks after the prelude's
    r.styles.push(["size_range", ...args]);
    return this;
  },
  drag_paths(paths, options = {}) {
    const r = live(this);
    if (!Array.isArray(paths) || paths.length === 0 || paths.some((p) => typeof p !== "string" || !p || p.includes("\0"))) {
      throw new TypeError("drag_paths(paths, options) expects non-empty paths without NUL characters");
    }
    const on = options.on ?? null;
    if (on !== null && (typeof on !== "string" || !on)) {
      throw new TypeError("drag_paths options.on must be a machine name or null");
    }
    r.styles.push(["drag_paths", JSON.stringify({ paths, on })]);
    return this;
  },
};

// ---------------------------------------------------------------------------
// Builders ("gpui-kit")

export function div() {
  return newElement("div");
}

export function svg(path) {
  return newElement("svg", [String(path)]);
}

export function image(path) {
  return newElement("image", [String(path)]);
}

/** For gpui-base: a bare element of `kind` (no default styles). */
export function createElement(kind, args = [], id = null) {
  return newElement(kind, args, id);
}

/** `TextView.html/markdown`: an element with TextViewElement's own methods. */
export function createTextView(id, text, format) {
  const element = newElement("TextView", [String(id), String(text), format], String(id));
  for (const name of METHODS.components.TextView) {
    let method;
    if (name.startsWith("on_")) method = handlerMethod(name);
    else if (name === "highlight_range") {
      method = function (start, end, color) {
        const r = live(this);
        parseColor(color);
        r.styles.push(["highlight_range", Number(start), Number(end), color]);
        return this;
      };
    } else method = genericMethod(name);
    Object.defineProperty(element, name, { value: method, enumerable: false, writable: true, configurable: true });
  }
  return element;
}

function checkListArgs(shape, itemCount, getKey, render, renderHint) {
  if (!Number.isInteger(itemCount) || itemCount < 0) {
    throw new TypeError(shape + " needs a whole, non-negative item_count");
  }
  if (typeof getKey !== "function") {
    throw new TypeError(shape + " needs get_key(index) to return each item's stable string key");
  }
  if (typeof render !== "function") {
    throw new TypeError(shape + " needs a render function; it is called " + renderHint);
  }
}

const RANGE_HINT = "once per visible range, not once per item";

/** Shared by `list`, `uniform_list`, `v_virtual_list`, `h_virtual_list`. */
export function lazyList(kind, id, itemCount, sizes, getKey, render) {
  if (itemRendererDepth > 0) {
    throw new TypeError(
      "a list cannot be built from inside another list's item renderer: its own renderer would belong to no " +
        "render pass and would never be called. Describe the nested list from the view's render() instead",
    );
  }
  const virtual = kind === "v_virtual_list" || kind === "h_virtual_list";
  const shape = virtual
    ? kind + "(id, item_count, item_sizes, get_key, render)"
    : kind + "(id, item_count, get_key, render)";
  checkListArgs(shape, itemCount, getKey, render, kind === "list" ? "once per item on screen, with the item's index" : RANGE_HINT);
  if (virtual && Array.isArray(sizes) && sizes.length !== itemCount) {
    throw new TypeError(
      shape + " was given " + sizes.length + " item sizes for " + itemCount +
        " items; pass one number for a uniform extent, or one per item",
    );
  }
  const args = virtual ? [String(id), itemCount, Array.isArray(sizes) ? sizes.slice() : sizes] : [String(id), itemCount];
  return newElement(kind, args, String(id), { list: { getKey, render, perItem: kind === "list" } });
}

export function list(id, item_count, get_key, render) {
  return lazyList("list", id, item_count, undefined, get_key, render);
}

export function uniform_list(id, item_count, get_key, render) {
  return lazyList("uniform_list", id, item_count, undefined, get_key, render);
}

// ---------------------------------------------------------------------------
// PathBuilder / Background / window.paint_path (prelude, verbatim rules)

function coordinate(value, name) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?(?:\d+(?:\.\d*)?|\.\d+)%$/.test(value)) return value;
  throw new TypeError(name + " must be a finite pixel number or percentage string");
}

function background(kind, values, opacityFactor = 1, colorSpace = "srgb") {
  return Object.freeze({
    __background: true,
    kind,
    values: Object.freeze(values),
    opacityFactor,
    colorSpace,
    opacity(factor) {
      return background(kind, values, finiteNonNegative(factor, "background opacity"), colorSpace);
    },
    color_space(space) {
      space = String(space).toLowerCase();
      if (!["srgb", "oklab"].includes(space)) throw new TypeError("background color_space must be srgb or oklab");
      return background(kind, values, opacityFactor, space);
    },
  });
}

function asBackground(value) {
  return value?.__background ? value : background("solid", [String(value)]);
}

function pathBuilder(fill, width) {
  const commands = [];
  const builder = {};
  const command = (name, arity, coordinateCount = arity) => (...args) => {
    if (args.length < arity) throw new TypeError(name + " expects at least " + arity + " argument(s)");
    for (let index = 0; index < coordinateCount; index++) coordinate(args[index], name + " coordinate");
    commands.push(Object.freeze([name, ...args]));
    return builder;
  };
  builder.move_to = command("move_to", 2);
  builder.line_to = command("line_to", 2);
  builder.curve_to = command("curve_to", 4);
  builder.cubic_bezier_to = command("cubic_bezier_to", 6);
  builder.arc_to = (...args) => {
    if (args.length < 7) throw new TypeError("arc_to expects at least 7 argument(s)");
    coordinate(args[0], "arc x radius");
    coordinate(args[1], "arc y radius");
    if (typeof args[2] !== "number" || !Number.isFinite(args[2])) throw new TypeError("arc rotation must be finite");
    coordinate(args[5], "arc destination x");
    coordinate(args[6], "arc destination y");
    commands.push(Object.freeze(["arc_to", ...args]));
    return builder;
  };
  builder.close = () => {
    commands.push(Object.freeze(["close"]));
    return builder;
  };
  builder.dash_array = (values) => {
    if (fill) throw new TypeError("dash_array is only available on stroke paths");
    if (
      !Array.isArray(values) ||
      values.some((value) => typeof value !== "number" || !Number.isFinite(value) || Math.fround(value) <= 0)
    ) {
      throw new TypeError("dash_array(values) expects positive finite pixel numbers");
    }
    commands.push(Object.freeze(["dash_array", ...values]));
    return builder;
  };
  builder.add_polygon = (points, closed = true) => {
    if (!Array.isArray(points) || points.length === 0) throw new TypeError("add_polygon(points) expects a non-empty array");
    points.forEach((point, index) => {
      if (!Array.isArray(point) || point.length < 2) throw new TypeError("each polygon point must be [x, y]");
      command(index === 0 ? "move_to" : "line_to", 2)(point[0], point[1]);
    });
    if (closed) builder.close();
    return builder;
  };
  builder.build = () =>
    Object.freeze({
      __path: true,
      fill,
      width,
      commands: Object.freeze(commands.slice()),
    });
  return builder;
}

export const PathBuilder = Object.freeze({
  fill: () => pathBuilder(true, 0),
  stroke: (width) => pathBuilder(false, finitePositive(width, "stroke width")),
});

export const Background = Object.freeze({
  solid: (color) => background("solid", [String(color)]),
  stop: (color, percentage) => {
    if (typeof percentage !== "number" || !Number.isFinite(percentage)) {
      throw new TypeError("background stop percentage must be finite");
    }
    return Object.freeze({ __backgroundStop: true, color: String(color), percentage });
  },
  linear_gradient: (angle, from, to) => {
    angle = Number(angle);
    if (!Number.isFinite(angle)) throw new TypeError("linear gradient angle must be finite");
    const stop = (value, fallback, name) => {
      if (typeof value === "string") return [value, fallback];
      if (!value?.__backgroundStop) throw new TypeError(name + " must be a color or Background.stop(color, percentage)");
      return [value.color, value.percentage];
    };
    const a = stop(from, 0, "gradient from stop");
    const b = stop(to, 1, "gradient to stop");
    return background("linear-gradient", [String(angle), a[0], String(a[1]), b[0], String(b[1])]);
  },
  pattern_slash: (color, width, interval) =>
    background("pattern-slash", [
      String(color),
      String(finitePositive(width, "pattern width")),
      String(finitePositive(interval, "pattern interval")),
    ]),
  checkerboard: (color, size) =>
    background("checkerboard", [String(color), String(finitePositive(size, "checkerboard size"))]),
});

/** `window.paint_path(path, background | Color)`. */
export function paint_path(pathValue, paintValue) {
  if (!pathValue?.__path) throw new TypeError("window.paint_path(path, background) expects a Path built by PathBuilder");
  const paint = asBackground(paintValue);
  const path = { fill: pathValue.fill, width: pathValue.width, commands: pathValue.commands.map((c) => c.slice()) };
  const bg = {
    kind: paint.kind,
    values: paint.values.map(String),
    opacity: paint.opacityFactor,
    colorSpace: paint.colorSpace,
  };
  return newElement("path", [path, bg]);
}

/** The mock `window` global. Only what tooling needs; the rest throws. */
export function createMockWindow(options = {}) {
  const notImplemented = (name) => () => {
    throw new Error(`mock: window.${name} is not implemented`);
  };
  return {
    paint_path,
    rem_size: () => options.remSize ?? 16,
    appearance: () => options.appearance ?? "dark",
    viewport_size: () => ({ width: options.width ?? 1440, height: options.height ?? 900 }),
    open_dialog: notImplemented("open_dialog"),
    push_toast: notImplemented("push_toast"),
  };
}

/** Installs `globalThis.window` (with `paint_path`) unless one already exists. */
export function installMockWindow(options) {
  if (globalThis.window === undefined) globalThis.window = createMockWindow(options);
  return globalThis.window;
}

// ---------------------------------------------------------------------------
// View

let deferInit = false;
let asyncContextFactory = () => undefined;

/** Sets what `new View()` hands to `init` when a script constructs a view itself. */
export function setAsyncContextFactory(factory) {
  asyncContextFactory = factory;
}

export class View {
  constructor(props) {
    if (!deferInit && typeof this.init === "function") this.init(props, asyncContextFactory());
  }
}

/** The host's `__construct`: `new Class()` without running `init` (the host calls it). */
export function constructView(Class) {
  deferInit = true;
  try {
    return new Class();
  } finally {
    deferInit = false;
  }
}

// ---------------------------------------------------------------------------
// Serialisation, lookup and events

function jsonSafe(value) {
  if (value === undefined || typeof value === "function") return null;
  if (value && typeof value === "object") {
    if (Array.isArray(value)) return value.map(jsonSafe);
    if (value.__handle !== undefined) return { handle: value.__handle };
    const out = {};
    for (const [key, item] of Object.entries(value)) if (!key.startsWith("__")) out[key] = jsonSafe(item);
    return out;
  }
  return value;
}

// The mock never scrolls, so a lazy list shows its first screenful. A list
// with no definite extent of its own is taken to fill the window; a list with
// no item sizes (`list`, `uniform_list`) is taken to have rows one rem high,
// which over- rather than under-states the rows the shell would ask for.
const LIST_VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const LIST_REM = 16;
const LIST_FALLBACK_ITEM = 16;

function listLengthPx(value, whole) {
  let length;
  try {
    length = lengthOf(value);
  } catch {
    return null;
  }
  if ("px" in length) return length.px;
  if ("rem" in length) return length.rem * LIST_REM;
  if ("frac" in length) return length.frac * whole;
  return null;
}

/**
 * The extent (script pixels) a lazy list shows along its axis: its last
 * `h` / `size` (`w` / `size` across), capped by `max_h` (`max_w`), else
 * the window's.
 */
function listExtent(r, viewport) {
  const across = r.kind === "h_virtual_list";
  const whole = across ? viewport.width : viewport.height;
  let definite = null;
  let cap = null;
  for (const [name, ...args] of r.styles) {
    if (name === (across ? "w" : "h") || name === "size") {
      definite = listLengthPx(args[0], whole);
    } else if (name === (across ? "w_full" : "h_full") || name === "size_full") {
      definite = whole;
    } else if (name === (across ? "max_w" : "max_h")) {
      cap = listLengthPx(args[0], whole);
    }
  }
  let extent = definite ?? whole;
  if (cap !== null && cap < extent) extent = cap;
  return Math.max(0, extent);
}

/**
 * base's visible_range (gpui-kit crates/base/src/virtual_list.rs) at scroll
 * offset 0: the items that end inside the extent, the one crossing its edge
 * and one more of overdraw, never past the end (nor past `maxItems`).
 */
function visibleListRange(r, options = {}) {
  const count = Math.min(r.args[1], options.maxItems ?? 500);
  const extent = listExtent(r, { ...LIST_VIEWPORT, ...(options.viewport ?? {}) });
  const sizes = r.args[2];
  const sizeOf = (index) => {
    const size = Array.isArray(sizes) ? sizes[index] : sizes;
    return typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : LIST_FALLBACK_ITEM;
  };
  let end = 0;
  let edge = 0;
  while (end < count && edge + sizeOf(end) <= extent) edge += sizeOf(end++);
  return { start: 0, end: end === count ? count : Math.min(end + 2, count) };
}

/** Renders the rows of a lazy list the shell would ask for on its first frame (see visibleListRange). */
function materializeList(r, cx, options) {
  const { end: count } = visibleListRange(r, options);
  const { getKey, render, perItem } = r.list;
  let items;
  itemRendererDepth += 1;
  try {
    if (perItem) {
      items = [];
      for (let index = 0; index < count; index++) items.push(render(index, cx));
    } else {
      items = render({ start: 0, end: count }, cx);
    }
  } finally {
    itemRendererDepth -= 1;
  }
  if (!perItem) {
    if (!Array.isArray(items)) {
      throw new TypeError(
        "a virtual list's item renderer must return an array of elements, one per                      item in the range it was given",
      );
    }
  }
  const keys = [];
  const unique = new Set();
  for (let index = 0; index < count; index++) {
    const key = String(getKey(index));
    if (!perItem && unique.has(key)) {
      throw new TypeError(`virtual list get_key returned duplicate key \`${key}\` in one visible range`);
    }
    unique.add(key);
    keys.push(key);
  }
  const nodes = items.map((item) => {
    const node = childNode(item);
    if (isElement(node)) node.__r.parented = true;
    return node;
  });
  r.items = nodes;
  r.keys = keys;
  return nodes;
}

/**
 * A JSON-able tree (ARCHITECTURE A8). Handlers become
 * `{ handler: "<event>", path: "<index path>" }`. Lazy lists are expanded with
 * `options.cx` into `children` (the rows in view at scroll offset 0 — see
 * visibleListRange; `options.viewport` = { width, height } stands in for the
 * window, `options.maxItems`, default 500, caps the rows), with their item
 * keys in `keys`.
 */
export function serialize(node, options = {}, path = "0") {
  if (!isElement(node)) {
    if (node?.kind === "text") return { kind: "text", text: node.text };
    if (node?.kind === "child_view") return { kind: "child_view" };
    return jsonSafe(node);
  }
  const r = node.__r;
  let kids = r.children;
  let keys;
  if (r.list) {
    kids = r.items ?? materializeList(r, options.cx, options);
    keys = r.keys;
  }
  const handlers = {};
  for (const event of Object.keys(r.handlers)) handlers[event] = { handler: event, path };
  const out = {
    kind: r.kind,
    args: jsonSafe(r.args),
    id: r.id,
    styles: jsonSafe(r.styles),
    children: kids.map((child, index) => serialize(child, options, `${path}.${index}`)),
    handlers,
    hover: r.hover ? jsonSafe(r.hover) : null,
    transitions: jsonSafe(r.transitions),
    loops: jsonSafe(r.loops),
    frames: r.frames ? jsonSafe(r.frames) : null,
    spin: r.spin,
  };
  if (r.active) out.active = jsonSafe(r.active);
  if (r.focus) out.focus = jsonSafe(r.focus);
  if (r.states) out.states = jsonSafe(r.states);
  if (keys) out.keys = keys.slice();
  if (r.slots) {
    out.slots = {};
    for (const [name, element] of Object.entries(r.slots)) out.slots[name] = serialize(element, options, `${path}.${name}`);
  }
  return out;
}

/** Alias kept for callers that think in terms of `toJSON`. */
export const toJSON = serialize;

function nodeChildren(node) {
  if (isElement(node)) {
    const r = node.__r;
    const kids = r.list ? (r.items ?? []) : r.children;
    return r.slots ? kids.concat(Object.values(r.slots)) : kids;
  }
  if (node && typeof node === "object") {
    const kids = Array.isArray(node.children) ? node.children : [];
    return node.slots ? kids.concat(Object.values(node.slots)) : kids;
  }
  return [];
}

/** Depth-first search by id; works on live elements and on serialised trees. */
export function findById(tree, id) {
  const wanted = String(id);
  const stack = [tree];
  while (stack.length) {
    const node = stack.shift();
    const nodeId = isElement(node) ? node.__r.id : node?.id;
    if (nodeId === wanted) return node;
    stack.unshift(...nodeChildren(node));
  }
  return null;
}

/** Every element (live or serialised) in document order. */
export function walk(tree, visit) {
  const stack = [tree];
  while (stack.length) {
    const node = stack.shift();
    if (node && typeof node === "object" && node.kind !== "text") visit(node);
    stack.unshift(...nodeChildren(node));
  }
}

/**
 * Invokes the handler recorded for `event` on the element with `id` in a live
 * tree. `event` is the method name (`"on_click"`), or with its leading
 * arguments (`"on_mouse_down:left"`, `"on_action:copy"`); a bare name also
 * matches a single keyed registration. Returns the handler's result.
 */
export function fire(tree, id, event, payload, cx) {
  const node = findById(tree, id);
  if (!node) throw new Error(`fire: no element with id "${id}"`);
  if (!isElement(node)) throw new Error("fire: needs the live element tree, not a serialised one");
  const handlers = node.__r.handlers;
  let key = event;
  if (!(key in handlers)) {
    const matches = Object.keys(handlers).filter((k) => k.startsWith(event + ":"));
    if (matches.length !== 1) {
      throw new Error(`fire: element "${id}" has no ${event} handler (has: ${Object.keys(handlers).join(", ") || "none"})`);
    }
    key = matches[0];
  }
  const handler = handlers[key];
  if (key === "on_item_secondary_click" && Array.isArray(payload)) return handler(payload[0], payload[1], cx);
  return handler(payload, cx);
}

/** The recorded handlers of an element, by event key (live trees only). */
export function handlersOf(element) {
  return { ...rec(element).handlers };
}

export const methods = METHODS;

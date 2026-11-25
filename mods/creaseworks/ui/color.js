// Colour helpers (DESIGN §5.2, §13.2; ARCHITECTURE A2 rule 5). Pure functions
// over hex strings only (`#rgb`, `#rrggbb`, `#rrggbbaa`, what gpui accepts).
// Theme colours from herdr may be 8-digit (hover, selected, border, input), so
// alpha is only ever appended through `withAlpha()`, after `hex6()`.

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const ALPHA2 = /^[0-9a-fA-F]{2}$/;

/** WCAG 2.x minimum for graphics and large text; the status guard's threshold. */
export const GUARD_MIN = 3;

/** True for a string gpui accepts as a colour: `#rgb`, `#rrggbb` or `#rrggbbaa`. */
export function isHex(c) {
  return typeof c === "string" && HEX.test(c);
}

function bad(c, what) {
  const shown = typeof c === "string" ? `"${c}"` : String(c);
  return new TypeError(`${what}: ${shown} is not a #rgb, #rrggbb or #rrggbbaa colour`);
}

/** Lower-case `#rrggbbaa` (alpha `ff` when absent). Throws on anything else. */
function hex8(c, what = "colour") {
  if (!isHex(c)) throw bad(c, what);
  const s = c.toLowerCase();
  if (s.length === 4) return "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3] + "ff";
  if (s.length === 7) return s + "ff";
  return s;
}

/**
 * Normalise to lower-case `#rrggbb`: `#rgb` is expanded, the alpha of
 * `#rrggbbaa` is dropped. Throws a TypeError on anything else.
 */
export function hex6(c) {
  return hex8(c, "hex6").slice(0, 7);
}

/** `{ r, g, b, a }` with r/g/b 0..255 and a 0..1. */
export function rgba(c) {
  const s = hex8(c, "rgba");
  return {
    r: parseInt(s.slice(1, 3), 16),
    g: parseInt(s.slice(3, 5), 16),
    b: parseInt(s.slice(5, 7), 16),
    a: parseInt(s.slice(7, 9), 16) / 255,
  };
}

function byte(n) {
  const v = Math.max(0, Math.min(255, Math.round(n)));
  return (v < 16 ? "0" : "") + v.toString(16);
}

/** Alpha of a colour as a 0..1 number (`#rrggbb` → 1). */
export function alphaOf(c) {
  return rgba(c).a;
}

/**
 * `#rrggbbaa` from any colour and an alpha given as a number 0..1 (`0.12`) or
 * as two hex digits (`"1f"`). The colour's own alpha is replaced, not
 * multiplied (DESIGN §3.8: `withAlpha(T.working, "1f")`).
 */
export function withAlpha(c, a) {
  const base = hex6(c);
  if (typeof a === "number") {
    if (!(a >= 0 && a <= 1)) throw new TypeError(`withAlpha: alpha ${a} is not between 0 and 1`);
    return base + byte(a * 255);
  }
  if (typeof a === "string" && ALPHA2.test(a)) return base + a.toLowerCase();
  throw new TypeError(`withAlpha: alpha ${typeof a === "string" ? `"${a}"` : String(a)} is not 0..1 or two hex digits`);
}

/**
 * Linear blend in sRGB of two colours: `t` 0 gives `a`, 1 gives `b`. Alphas
 * are ignored; the result is `#rrggbb`. `t` is clamped to 0..1.
 */
export function mix(a, b, t) {
  const x = rgba(a);
  const y = rgba(b);
  const k = typeof t === "number" && t === t ? Math.max(0, Math.min(1, t)) : 0;
  return "#" + byte(x.r + (y.r - x.r) * k) + byte(x.g + (y.g - x.g) * k) + byte(x.b + (y.b - x.b) * k);
}

/** `fg` composited over an opaque `bg` (its own alpha ignored), as `#rrggbb`. */
export function over(fg, bg) {
  const key = typeof fg === "string" && typeof bg === "string" ? fg + bg : null;
  if (key !== null) {
    const hit = OVER.get(key);
    if (hit !== undefined) return hit;
  }
  const a = alphaOf(fg);
  const out = a >= 1 ? hex6(fg) : mix(hex6(bg), hex6(fg), a);
  if (key !== null) remember(OVER, key, out);
  return out;
}

function channel(v) {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance (0..1) of the colour's RGB (alpha ignored). */
export function luminance(c) {
  const { r, g, b } = rgba(c);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG 2.x contrast ratio (1..21) of `a` drawn on `b`. A translucent `a` is
 * first composited over `b`; `b` is taken as opaque (its alpha is ignored).
 */
export function contrast(a, b) {
  const key = typeof a === "string" && typeof b === "string" ? a + b : null;
  if (key !== null) {
    const hit = CONTRAST.get(key);
    if (hit !== undefined) return hit;
  }
  const fg = over(a, b);
  const x = luminance(fg);
  const y = luminance(b);
  const out = (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  if (key !== null) remember(CONTRAST, key, out);
  return out;
}

// Render-time memo tables (A2 rule 6: a 64-helper render calls the guards
// hundreds of times with a handful of distinct colours). Filled lazily, never
// at import; bounded so a theme switch cannot grow them without end.
const CONTRAST = new Map();
const GUARDED = new Map();
const OVER = new Map();
const MEMO_MAX = 512;

function remember(map, key, value) {
  if (map.size >= MEMO_MAX) map.clear();
  map.set(key, value);
}

/** Herdr status for a game status word or group key (`needs` → `blocked`, …). */
const STATUS_KEY = Object.freeze({
  working: "working",
  blocked: "blocked",
  error: "blocked",
  needs: "blocked",
  done: "done",
  finished: "done",
  idle: "idle",
  resting: "idle",
  unknown: "unknown",
});

/** The theme key a status word maps to (`"needs"` → `"blocked"`), or null. */
export function statusKey(status) {
  return typeof status === "string" && Object.hasOwn(STATUS_KEY, status) ? STATUS_KEY[status] : null;
}

/**
 * The colour to draw a status glyph in, guarded against the surface it sits
 * on (DESIGN §5.2): the theme's status colour when it reaches 3:1 on
 * `surface`, else `T.muted` when that does, else `T.foreground`, else black
 * or white (whichever contrasts more; only for broken themes). `surface` is a
 * theme key (`"popover"`, `"chrome"`, `"raised"`) or a hex colour. Status
 * words: herdr's (`working blocked done idle`), `error`, or the game's
 * (`needs finished resting`). Always returns `#rrggbb`.
 */
export function statusColor(T, status, surface) {
  const bg = surfaceColor(T, surface);
  const key = statusKey(status);
  const first = key && T ? T[key] : undefined;
  const muted = T && T.muted;
  const fg = T && T.foreground;
  const memo = `${first}|${muted}|${fg}|${bg}`;
  const hit = GUARDED.get(memo);
  if (hit !== undefined) return hit;
  let out = null;
  for (const c of [first, muted, fg]) {
    if (isHex(c) && contrast(c, bg) >= GUARD_MIN) {
      out = hex6(c);
      break;
    }
  }
  if (out === null) out = contrast("#000000", bg) >= contrast("#ffffff", bg) ? "#000000" : "#ffffff";
  remember(GUARDED, memo, out);
  return out;
}

/** A surface given as a theme key or a colour, as `#rrggbb` (white when unusable). */
export function surfaceColor(T, surface) {
  const c = isHex(surface) ? surface : T && typeof surface === "string" && Object.hasOwn(T, surface) ? T[surface] : null;
  return isHex(c) ? hex6(c) : "#ffffff";
}

/**
 * The check our code makes before a colour reaches a `Background` (a bad one
 * there is not painted and raises no error, gpui §5). Returns the colour
 * normalised to lower-case `#rrggbb` / `#rrggbbaa`; throws a TypeError naming
 * the bad value otherwise.
 */
export function validateBackgroundColor(c) {
  if (!isHex(c)) throw bad(c, "Background colour");
  const s = hex8(c);
  return s.endsWith("ff") ? s.slice(0, 7) : s;
}

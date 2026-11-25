// Number and time formatting (DESIGN §3.1, §3.4, §3.7; ARCHITECTURE A2 rule 4).
// No Intl, no toLocaleString, no toFixed: every digit is built here from
// integers, so Node and QuickJS print the same text.
//
//   formatCount(12480)            "12.5K"     formatCount(9999.9)      "9,999"
//   formatCount(999950)           "1.00M"     formatCount(1.234e36)    "1.23e36"
//   formatCount(12480, "sci")     "1.25e4"
//   formatRate(86.24)             "+86.2/s"   formatRate(86.24, "short", { compact: true })  "+86/s"
//   formatDuration(130000)        "2m 10s"    formatDuration(27720000, "spaced")             "7 h 42 m"
//   formatEta(129200)             "in 2m 10s" (never optimistic: rounds up)
//
// Module scope holds constants and functions only (A2 rule 2).

/** Suffix per power of 1000 (index 1 = K = 1e3 ... 11 = Dc = 1e33). */
const SUFFIXES = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
/** First exponent printed as `1.23e36` in the short style. */
const SCI_FROM = 3 * SUFFIXES.length;
const MINUS = "-";

const pow10 = (e) => Number("1e" + e);

/** Non-negative integer below 2^53 with thousands commas: 12480 -> "12,480". */
function grouped(int) {
  const s = String(int);
  if (s.length <= 3) return s;
  let i = s.length % 3 || 3;
  let out = s.slice(0, i);
  for (; i < s.length; i += 3) out += "," + s.slice(i, i + 3);
  return out;
}

function num(n) {
  return typeof n === "number" ? n : Number(n);
}

/**
 * `a` (finite, >= 1) as three significant digits: { digits: 100..999, exp }
 * with a ≈ digits × 10^(exp − 2), rounded half up. 999.5 → { 100, 3 }.
 */
function threeDigits(a) {
  let exp = Math.floor(Math.log10(a));
  if (pow10(exp) > a) exp -= 1;
  else if (pow10(exp + 1) <= a) exp += 1;
  // Divide (or multiply) by an exactly parsed power of ten to keep halves exact.
  const shift = exp - 2;
  let digits = Math.round(shift >= 0 ? a / pow10(shift) : a * pow10(-shift));
  if (digits >= 1000) {
    digits = 100;
    exp += 1;
  }
  return { digits, exp };
}

/** "1.24e4" from three digits. */
function sci(digits, exp) {
  const s = String(digits);
  return s[0] + "." + s.slice(1) + "e" + exp;
}

/** `a` >= 10,000 (finite) in the given style, rounded to three significant digits. */
function large(a, style) {
  const { digits, exp } = threeDigits(a);
  if (style === "sci" || exp >= SCI_FROM) return sci(digits, exp);
  const tier = Math.floor(exp / 3);
  const whole = exp - 3 * tier + 1; // digits before the point: 1, 2 or 3
  const s = String(digits);
  return (whole < 3 ? s.slice(0, whole) + "." + s.slice(whole) : s) + SUFFIXES[tier];
}

/** "∞" with its sign, for the guards. */
function infinity(n) {
  return n < 0 ? MINUS + "∞" : "∞";
}

/**
 * A count of folds (or a cost). Below 10,000: whole units, rounded toward
 * zero ("you have 999" until you have 1,000), with thousands commas. From
 * 10,000: three significant digits rounded half up, with K M B T Qa Qi Sx Sp
 * Oc No Dc ("12.5K", "100K", "1.00M"), then "1.23e36". `style` "sci" prints
 * every value from 10,000 as "1.24e4". Negative values get a leading "-";
 * NaN and non-numbers print "0", ±Infinity "∞" / "-∞".
 */
export function formatCount(n, style = "short") {
  const v = num(n);
  if (v !== v) return "0";
  if (v === Infinity || v === -Infinity) return infinity(v);
  const a = Math.abs(v);
  if (a < 10000) {
    const int = Math.floor(a);
    return (int > 0 && v < 0 ? MINUS : "") + grouped(int);
  }
  return (v < 0 ? MINUS : "") + large(a, style);
}

/**
 * A rate per second, signed: "+0.25/s", "+4.3/s", "+86.2/s", "+187/s",
 * "+1,234/s", then like formatCount ("+12.5K/s", "+1.25e4/s" in "sci").
 * Below 1: two decimals; below 100: one decimal; then whole numbers. Rounded
 * half up; a value that rounds across a threshold uses the next format
 * (99.96 → "+100/s"). Zero (or a value that rounds to zero) is "0/s".
 * Options: `sign: false` drops the "+" (a "-" stays); `compact: true` uses
 * one decimal only below 10 and whole numbers from there ("+86/s").
 * NaN prints "0/s"; ±Infinity "+∞/s" / "-∞/s".
 */
export function formatRate(n, style = "short", opts = undefined) {
  const sign = !(opts && opts.sign === false);
  const compact = !!(opts && opts.compact);
  const v = num(n);
  if (v !== v) return "0/s";
  const plus = sign ? "+" : "";
  if (v === Infinity || v === -Infinity) return (v > 0 ? plus : "") + infinity(v) + "/s";
  const a = Math.abs(v);
  let body = null;
  if (!compact && a < 1) {
    const cents = Math.round(a * 100);
    if (cents < 100) body = cents === 0 ? "0" : "0." + (cents < 10 ? "0" : "") + cents;
  }
  if (body === null && a < (compact ? 10 : 100)) {
    const tenths = Math.round(a * 10);
    if (tenths < (compact ? 100 : 1000)) body = tenths === 0 ? "0" : Math.floor(tenths / 10) + "." + (tenths % 10);
  }
  if (body === null && a < 10000) {
    const int = Math.round(a);
    if (int < 10000) body = grouped(int);
  }
  if (body === null) body = large(a, style);
  if (body === "0") return "0/s";
  return (v < 0 ? MINUS : plus) + body + "/s";
}

const UNITS = [
  { ms: 86400000, label: "d" },
  { ms: 3600000, label: "h" },
  { ms: 60000, label: "m" },
  { ms: 1000, label: "s" },
];

function durationOptions(opts) {
  if (typeof opts === "string") return { spaced: opts === "spaced", parts: 2 };
  const spaced = !!(opts && (opts.spaced || opts.style === "spaced"));
  const parts = opts && opts.parts === 1 ? 1 : 2;
  return { spaced, parts };
}

/**
 * Whole units in `ms` (finite, >= 0): the largest unit that is at least 1
 * and, with parts 2, the next smaller one when it is not zero.
 * `up` rounds up to the last unit shown (ETAs), otherwise down (elapsed).
 */
function durationText(ms, spaced, parts, up) {
  let u = 0;
  // A rounded-up value can carry into a larger unit (59.5 s → 1m): retry.
  for (let pass = 0; pass < 4; pass++) {
    u = 0;
    while (u < UNITS.length - 1 && ms < UNITS[u].ms) u++;
    const last = Math.min(u + parts - 1, UNITS.length - 1);
    const step = UNITS[last].ms;
    const rounded = (up ? Math.ceil(ms / step) : Math.floor(ms / step)) * step;
    if (rounded === ms) break;
    ms = rounded;
  }
  const first = Math.floor(ms / UNITS[u].ms);
  const gap = spaced ? " " : "";
  let out = first + gap + UNITS[u].label;
  if (parts === 2 && u < UNITS.length - 1) {
    const second = Math.floor((ms - first * UNITS[u].ms) / UNITS[u + 1].ms);
    if (second > 0) out += " " + second + gap + UNITS[u + 1].label;
  }
  return out;
}

/**
 * An elapsed time, rounded down: "45s", "2m 10s", "7h 42m", "3d 4h"; with
 * `"spaced"` (or `{ spaced: true }`) "7 h 42 m", "12 s". At most two units,
 * adjacent ones only, and a zero second unit is left out ("3m", "1d").
 * `{ parts: 1 }` keeps the largest unit only ("14 m"). Below one second, 0,
 * negatives and NaN print "0s"; Infinity prints "∞".
 */
export function formatDuration(ms, opts = undefined) {
  const { spaced, parts } = durationOptions(opts);
  const v = num(ms);
  if (v === Infinity) return "∞";
  if (!(v > 0)) return "0" + (spaced ? " " : "") + "s";
  return durationText(v, spaced, parts, false);
}

/**
 * Time until something, rounded up to the last unit shown so it is never
 * optimistic: "in 2m 10s", "in 1s" for 300 ms, "in 1h" for 59m 59.5s.
 * `ms` <= 0 is "now". NaN, Infinity and non-numbers give null (never
 * reachable: Row.eta is null). Same options as formatDuration.
 */
export function formatEta(ms, opts = undefined) {
  const v = num(ms);
  if (v !== v || v === Infinity || v === -Infinity) return null;
  if (v <= 0) return "now";
  const { spaced, parts } = durationOptions(opts);
  return "in " + durationText(v, spaced, parts, true);
}

/** Whole number with thousands commas ("12,480"), rounded half away from zero. */
export function formatInt(n) {
  const v = num(n);
  if (v !== v) return "0";
  if (v === Infinity || v === -Infinity) return infinity(v);
  const int = Math.round(Math.abs(v));
  if (int >= 9007199254740992) return (v < 0 ? MINUS : "") + large(Math.abs(v), "sci");
  return (int > 0 && v < 0 ? MINUS : "") + grouped(int);
}

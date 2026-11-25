// Text helpers for every string the mod shows (ARCHITECTURE A2 rule 8).
//
// herdr's QuickJS has no Intl, so grapheme clusters are found here by walking
// code points and applying the extended grapheme cluster rules of UAX #29
// (GB3-GB13, including GB9c Indic conjuncts) with small range checks and three
// Unicode property regexes (\p{M}, \p{Cf}, \p{Extended_Pictographic}), all of
// which QuickJS-ng supports (test/text/qjs.test.mjs runs the corpus there).
//
// Kept together: CR LF; ZWJ sequences; VS15/VS16 and every combining mark;
// emoji modifiers (skin tones); keycaps (digit/#/* FE0F 20E3); tag sequences
// (subdivision flags); regional-indicator pairs; Hangul syllables built from
// L/V/T jamo; prepended concatenation marks; Indic conjuncts.
//
// Lone surrogates never come out of this module: each one becomes U+FFFD (a
// grapheme of its own) in graphemes(), clip() and cleanTitle().
//
// Module scope holds constants and functions only (A2 rule 2).

const RE_MARK = /\p{M}/u;
const RE_SPACING = /\p{Mc}/u;
const RE_FORMAT = /\p{Cf}/u;
const RE_PICT = /\p{Extended_Pictographic}/u;
const RE_SPACE_ONLY = /^\s+$/u;
const RE_LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// Grapheme_Cluster_Break values used by the rules below.
const OTHER = 0;
const CR = 1;
const LF = 2;
const CONTROL = 3;
const EXTEND = 4;
const ZWJ = 5;
const RI = 6;
const PREPEND = 7;
const SPACING = 8;
const L = 9;
const V = 10;
const T = 11;
const LV = 12;
const LVT = 13;

// Tables below are Unicode 17.0 (GraphemeBreakProperty.txt and the InCB values
// in DerivedCoreProperties.txt), as [first, last] pairs in code point order.

// Indic_Conjunct_Break = Consonant.
const CONSONANTS = [
  0x0915, 0x0939, 0x0958, 0x095f, 0x0978, 0x097f, 0x0995, 0x09a8, 0x09aa, 0x09b0, 0x09b2, 0x09b2,
  0x09b6, 0x09b9, 0x09dc, 0x09dd, 0x09df, 0x09df, 0x09f0, 0x09f1, 0x0a95, 0x0aa8, 0x0aaa, 0x0ab0,
  0x0ab2, 0x0ab3, 0x0ab5, 0x0ab9, 0x0af9, 0x0af9, 0x0b15, 0x0b28, 0x0b2a, 0x0b30, 0x0b32, 0x0b33,
  0x0b35, 0x0b39, 0x0b5c, 0x0b5d, 0x0b5f, 0x0b5f, 0x0b71, 0x0b71, 0x0c15, 0x0c28, 0x0c2a, 0x0c39,
  0x0c58, 0x0c5a, 0x0d15, 0x0d3a, 0x1000, 0x102a, 0x103f, 0x103f, 0x1050, 0x1055, 0x105a, 0x105d,
  0x1061, 0x1061, 0x1065, 0x1066, 0x106e, 0x1070, 0x1075, 0x1081, 0x108e, 0x108e, 0x1780, 0x17b3,
  0x1a20, 0x1a54, 0x1b0b, 0x1b0c, 0x1b13, 0x1b33, 0x1b45, 0x1b4c, 0x1b83, 0x1ba0, 0x1bae, 0x1baf,
  0x1bbb, 0x1bbd, 0xa989, 0xa98b, 0xa98f, 0xa9b2, 0xa9e0, 0xa9e4, 0xa9e7, 0xa9ef, 0xa9fa, 0xa9fe,
  0xaa60, 0xaa6f, 0xaa71, 0xaa73, 0xaa7a, 0xaa7a, 0xaa7e, 0xaa7f, 0xaae0, 0xaaea, 0xabc0, 0xabda,
  0x10a00, 0x10a00, 0x10a10, 0x10a13, 0x10a15, 0x10a17, 0x10a19, 0x10a35, 0x11103, 0x11126,
  0x11144, 0x11144, 0x11147, 0x11147, 0x11380, 0x11389, 0x1138b, 0x1138b, 0x1138e, 0x1138e,
  0x11390, 0x113b5, 0x11900, 0x11906, 0x11909, 0x11909, 0x1190c, 0x11913, 0x11915, 0x11916,
  0x11918, 0x1192f, 0x11a00, 0x11a00, 0x11a0b, 0x11a32, 0x11a50, 0x11a50, 0x11a5c, 0x11a83,
  0x11f04, 0x11f10, 0x11f12, 0x11f33,
];

// Indic_Conjunct_Break = Linker (viramas and their kin).
const LINKERS = [
  0x094d, 0x094d, 0x09cd, 0x09cd, 0x0acd, 0x0acd, 0x0b4d, 0x0b4d, 0x0c4d, 0x0c4d, 0x0d4d, 0x0d4d,
  0x1039, 0x1039, 0x17d2, 0x17d2, 0x1a60, 0x1a60, 0x1b44, 0x1b44, 0x1bab, 0x1bab, 0xa9c0, 0xa9c0,
  0xaaf6, 0xaaf6, 0x10a3f, 0x10a3f, 0x11133, 0x11133, 0x113d0, 0x113d0, 0x1193e, 0x1193e,
  0x11a47, 0x11a47, 0x11a99, 0x11a99, 0x11f42, 0x11f42,
];

// Grapheme_Cluster_Break = Prepend.
const PREPENDS = [
  0x0600, 0x0605, 0x06dd, 0x06dd, 0x070f, 0x070f, 0x0890, 0x0891, 0x08e2, 0x08e2, 0x0d4e, 0x0d4e,
  0x110bd, 0x110bd, 0x110cd, 0x110cd, 0x111c2, 0x111c3, 0x113d1, 0x113d1, 0x1193f, 0x1193f,
  0x11941, 0x11941, 0x11a84, 0x11a89, 0x11d46, 0x11d46, 0x11f02, 0x11f02,
];

// Spacing marks (gc = Mc) that Unicode 16 moved to Grapheme_Cluster_Break = Other.
const MC_OTHER = [
  0x102b, 0x102c, 0x1038, 0x1038, 0x1062, 0x1064, 0x1067, 0x106d, 0x1083, 0x1083, 0x1087, 0x108c,
  0x108f, 0x108f, 0x109a, 0x109c, 0x1a61, 0x1a61, 0x1a63, 0x1a64, 0xaa7b, 0xaa7b, 0xaa7d, 0xaa7d,
  0x11720, 0x11721,
];

function inPairs(table, cp) {
  if (cp < table[0] || cp > table[table.length - 1]) return false;
  for (let i = 0; i < table.length; i += 2) {
    if (cp < table[i]) return false;
    if (cp <= table[i + 1]) return true;
  }
  return false;
}

/** Grapheme_Cluster_Break of one code point (never a surrogate: see wellFormed). */
function gcb(cp, ch) {
  if (cp < 0x7f) {
    if (cp >= 0x20) return OTHER;
    if (cp === 0x0d) return CR;
    if (cp === 0x0a) return LF;
    return CONTROL;
  }
  if (cp < 0xa0) return CONTROL;
  if (cp < 0x300) return cp === 0xad ? CONTROL : OTHER;
  if (cp >= 0x1100 && cp <= 0x11ff) return cp < 0x1160 ? L : cp < 0x11a8 ? V : T;
  if (cp >= 0xac00 && cp <= 0xd7a3) return (cp - 0xac00) % 28 === 0 ? LV : LVT;
  if (cp >= 0xa960 && cp <= 0xa97c) return L;
  if (cp >= 0xd7b0 && cp <= 0xd7c6) return V;
  if (cp >= 0xd7cb && cp <= 0xd7fb) return T;
  if (cp === 0x200d) return ZWJ;
  if (cp === 0x200c) return EXTEND;
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return RI;
  if (cp >= 0x1f3fb && cp <= 0x1f3ff) return EXTEND; // emoji modifiers
  if (cp >= 0xe0020 && cp <= 0xe007f) return EXTEND; // tags
  if (cp === 0xff9e || cp === 0xff9f) return EXTEND; // halfwidth sound marks
  if (cp === 0x0e33 || cp === 0x0eb3) return SPACING; // Thai / Lao sara am
  if (cp === 0x16d63 || (cp >= 0x16d67 && cp <= 0x16d6a)) return V; // Kirat Rai vowel signs
  if (cp === 0x2028 || cp === 0x2029 || cp === 0x2065 || (cp >= 0xfff0 && cp <= 0xfff8)) return CONTROL;
  if (RE_MARK.test(ch)) {
    if (!RE_SPACING.test(ch) || inPairs(LINKERS, cp)) return EXTEND;
    return inPairs(MC_OTHER, cp) ? OTHER : SPACING;
  }
  if (inPairs(PREPENDS, cp)) return PREPEND;
  if (RE_FORMAT.test(ch)) return CONTROL;
  if (cp >= 0xe0000 && cp <= 0xe0fff) return CONTROL; // unassigned default-ignorables
  return OTHER;
}

/** The string with every lone surrogate replaced by U+FFFD (the same string when none). */
function wellFormed(str) {
  if (!RE_LONE.test(str)) return str;
  let out = "";
  let from = 0;
  const n = str.length;
  for (let i = 0; i < n; i++) {
    const c = str.charCodeAt(i);
    if (c < 0xd800 || c > 0xdfff) continue;
    if (c <= 0xdbff && i + 1 < n) {
      const d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        i++;
        continue;
      }
    }
    out += str.slice(from, i) + "�";
    from = i + 1;
  }
  return out + str.slice(from);
}

function toText(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Offsets (UTF-16) where the first `limit` grapheme clusters of the
 * well-formed string `s` end. Stops early once `limit` clusters are found.
 */
function boundaries(s, limit) {
  const ends = [];
  const n = s.length;
  if (n === 0 || limit <= 0) return ends;

  let prev = -1; // GCB of the previous code point; -1 at the start
  let ri = 0; // regional indicators in a row before this code point
  let pict = 0; // GB11: 1 = ExtPict Extend*, 2 = ... ZWJ
  let conj = 0; // GB9c: 1 = Consonant [Extend|Linker]*, 2 = ... with a Linker seen
  let ascii = false; // the previous code point was printable ASCII
  let i = 0;
  while (i < n) {
    let cp = s.charCodeAt(i);
    // Printable ASCII after printable ASCII always breaks (GB999), and the
    // rule state after it stays as the slow path left it (OTHER, no runs).
    if (ascii && cp >= 0x20 && cp < 0x7f) {
      ends.push(i);
      if (ends.length === limit) return ends;
      i++;
      continue;
    }
    let size = 1;
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < n) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        cp = (cp - 0xd800) * 0x400 + (d - 0xdc00) + 0x10000;
        size = 2;
      }
    }
    const ch = size === 1 ? s[i] : s.slice(i, i + 2);
    const cls = gcb(cp, ch);
    const isPict = cp >= 0xa9 && cls === OTHER && RE_PICT.test(ch);
    const consonant = cp >= 0x0915 && cls === OTHER && inPairs(CONSONANTS, cp);
    const linker = cls === EXTEND && cp >= 0x094d && inPairs(LINKERS, cp);

    if (prev !== -1 && breaks(prev, cls, ri, pict, isPict, conj, consonant)) {
      ends.push(i);
      if (ends.length === limit) return ends;
    }

    ri = cls === RI ? ri + 1 : 0;
    if (isPict) pict = 1;
    else if (pict === 1 && cls === EXTEND) pict = 1;
    else if (pict === 1 && cls === ZWJ) pict = 2;
    else pict = 0;
    if (consonant) conj = 1;
    else if (conj !== 0 && linker) conj = 2;
    else if (cls !== EXTEND && cls !== ZWJ) conj = 0;
    prev = cls;
    ascii = cp >= 0x20 && cp < 0x7f;
    i += size;
  }
  ends.push(n);
  return ends;
}

/** UAX #29 GB3-GB999: is there a boundary between `a` and `b`? */
function breaks(a, b, ri, pict, isPict, conj, consonant) {
  if (a === CR && b === LF) return false; // GB3
  if (a === CR || a === LF || a === CONTROL) return true; // GB4
  if (b === CR || b === LF || b === CONTROL) return true; // GB5
  if (a === L && (b === L || b === V || b === LV || b === LVT)) return false; // GB6
  if ((a === LV || a === V) && (b === V || b === T)) return false; // GB7
  if ((a === LVT || a === T) && b === T) return false; // GB8
  if (b === EXTEND || b === ZWJ) return false; // GB9
  if (b === SPACING) return false; // GB9a
  if (a === PREPEND) return false; // GB9b
  if (conj === 2 && consonant) return false; // GB9c
  if (pict === 2 && isPict) return false; // GB11
  if (a === RI && b === RI) return ri % 2 === 0; // GB12, GB13
  return true; // GB999
}

/** The grapheme clusters of `str` (lone surrogates become U+FFFD). */
export function graphemes(str) {
  const s = wellFormed(toText(str));
  const ends = boundaries(s, Infinity);
  const out = new Array(ends.length);
  let from = 0;
  for (let k = 0; k < ends.length; k++) {
    out[k] = s.slice(from, ends[k]);
    from = ends[k];
  }
  return out;
}

/** Number of grapheme clusters in `str`. */
export function graphemeCount(str) {
  return boundaries(wellFormed(toText(str)), Infinity).length;
}

/**
 * `str` cut to at most `maxGraphemes` grapheme clusters, the ellipsis
 * included. Never cuts inside a cluster and never returns a lone surrogate.
 * Whitespace-only clusters before the ellipsis are dropped ("fix the…", not
 * "fix the …"). When the limit leaves no room for the ellipsis next to text,
 * the text is cut without one ("A" for a limit of 1, not "…").
 * `maxGraphemes` below 0 or NaN counts as 0; Infinity means no limit.
 */
export function clip(str, maxGraphemes, ellipsis = "\u2026") {
  const s = wellFormed(toText(str));
  let max = Number(maxGraphemes);
  if (!(max > 0)) return "";
  if (max === Infinity) return s;
  max = Math.floor(max);
  if (max <= 0) return "";
  // Each cluster holds at least one UTF-16 unit.
  if (s.length <= max) return s;
  const ends = boundaries(s, max + 1);
  if (ends.length <= max) return s;

  const tail = wellFormed(toText(ellipsis));
  const tailCount = tail === "" ? 0 : boundaries(tail, Infinity).length;
  if (max <= tailCount) return s.slice(0, ends[max - 1]);

  let keep = max - tailCount;
  while (keep > 0 && RE_SPACE_ONLY.test(s.slice(keep > 1 ? ends[keep - 2] : 0, ends[keep - 1]))) keep--;
  return (keep > 0 ? s.slice(0, ends[keep - 1]) : "") + tail;
}

/**
 * Display cells of one grapheme cluster: 2 for emoji (any Extended_Pictographic
 * code point, VS16, a keycap or a flag) and East Asian wide or fullwidth
 * characters, else 1. Errs wide: a text-style pictograph counts 2 as well.
 */
export function clusterCells(g) {
  const s = String(g);
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i);
    if (cp > 0xffff) i++;
    if (cp === 0xfe0f || cp === 0x20e3 || (cp >= 0x1f1e6 && cp <= 0x1f1ff)) return 2;
    if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) || (cp >= 0xac00 && cp <= 0xd7a3)
      || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60)
      || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd)) return 2;
    if (cp >= 0xa9 && RE_PICT.test(String.fromCodePoint(cp))) return 2;
  }
  return 1;
}

/** Display cells of `str` (the sum of its clusters' clusterCells). */
export function cellWidth(str) {
  const s = wellFormed(toText(str));
  const ends = boundaries(s, Infinity);
  let n = 0;
  let from = 0;
  for (let k = 0; k < ends.length; k++) {
    n += clusterCells(s.slice(from, ends[k]));
    from = ends[k];
  }
  return n;
}

/**
 * `str` cut to at most `maxCells` display cells (clusterCells: emoji and wide
 * characters count 2), the ellipsis included; the same rules as clip(): never
 * inside a cluster, no whitespace before the ellipsis. For text whose box is
 * known in px, so gpui's own truncation (which cuts by code point, inside
 * emoji) never has to engage.
 */
export function clipCells(str, maxCells, ellipsis = "…") {
  const s = wellFormed(toText(str));
  let max = Number(maxCells);
  if (!(max > 0)) return "";
  if (max === Infinity) return s;
  max = Math.floor(max);
  if (s.length <= max && !/[^\x20-\x7e]/.test(s)) return s; // ASCII fast path
  const ends = boundaries(s, Infinity);
  const cells = new Array(ends.length);
  let total = 0;
  let from = 0;
  for (let k = 0; k < ends.length; k++) {
    cells[k] = clusterCells(s.slice(from, ends[k]));
    total += cells[k];
    from = ends[k];
  }
  if (total <= max) return s;
  const tail = wellFormed(toText(ellipsis));
  const tailCells = tail === "" ? 0 : cellWidth(tail);
  let room = max - tailCells;
  const useTail = room > 0;
  if (!useTail) room = max;
  let keep = 0;
  let used = 0;
  while (keep < ends.length && used + cells[keep] <= room) used += cells[keep++];
  if (useTail) while (keep > 0 && RE_SPACE_ONLY.test(s.slice(keep > 1 ? ends[keep - 2] : 0, ends[keep - 1]))) keep--;
  const head = keep > 0 ? s.slice(0, ends[keep - 1]) : "";
  return useTail && head !== "" ? head + tail : useTail ? tail : head;
}

// C0 and C1 controls, DEL, line/paragraph separators and the bidi embedding,
// override and isolate controls; terminal escape sequences go first (CSI,
// OSC/DCS/APC/PM/SOS strings, then any other two-byte ESC sequence).
const RE_ESCAPES = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b[\]PX^_][^\u0007\u001b]*(?:\u0007|\u001b\\|$)|\u001b[ -~]?/g;
const RE_CONTROLS = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const RE_SPACES = /\s+/gu;
// Anything cleanTitle would change: a control, a whitespace other than one
// inner space, or whitespace at either end.
const RE_UNCLEAN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]|[^\S ]|\s\s|^\s|\s$/;

/**
 * A title fit to show: terminal escape sequences and control characters
 * removed (tabs and line breaks become spaces), runs of whitespace collapsed
 * to one space, ends trimmed, lone surrogates replaced by U+FFFD.
 * Emoji joiners, variation selectors and tags are kept.
 */
export function cleanTitle(str) {
  const s = wellFormed(toText(str));
  if (!RE_UNCLEAN.test(s)) return s;
  return s
    .replace(RE_ESCAPES, "")
    .replace(RE_CONTROLS, "")
    .replace(RE_SPACES, " ")
    .trim();
}

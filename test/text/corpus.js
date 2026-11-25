// Shared data and checks for test/text/*.test.mjs. Plain ES module with no
// imports and no Node APIs: the QuickJS-ng test copies it next to the engine
// files and runs the same checks inside the VM.

const ZWJ = "\u200d";

/** The 15 emoji from herdr-src/scripts/agents.test.ts:333 (each is one grapheme). */
export const HERDR_EMOJI = ["🔴", "🟦", "✅", "❌", "⭐", "🚀", "🧠", "⚪", "🇰🇷", "👍🏽", "👨\u200d💻", "❤️", "⚙️", "#️⃣", "✋🏽"];

/** [name, text, expected clusters]. */
export const CORPUS = [
  // herdr's emoji, alone and as a title prefix
  ...HERDR_EMOJI.map((e) => ["herdr " + e, e, [e]]),
  ...HERDR_EMOJI.map((e) => ["herdr title " + e, `${e} login`, [e, " ", "l", "o", "g", "i", "n"]]),
  ["herdr all 15 in a row", HERDR_EMOJI.join(""), HERDR_EMOJI],

  // ZWJ sequences: families, professions, flags made with ZWJ
  ["family of four", "👨\u200d👩\u200d👧\u200d👦", ["👨\u200d👩\u200d👧\u200d👦"]],
  ["family two mothers", "👩\u200d👩\u200d👧", ["👩\u200d👩\u200d👧"]],
  ["two families", "👨\u200d👩\u200d👧\u200d👦👩\u200d👩\u200d👧", ["👨\u200d👩\u200d👧\u200d👦", "👩\u200d👩\u200d👧"]],
  ["people holding hands with two tones", "🧑🏽\u200d🤝\u200d🧑🏿", ["🧑🏽\u200d🤝\u200d🧑🏿"]],
  ["kiss with tones", "👩🏻\u200d❤️\u200d💋\u200d👨🏾", ["👩🏻\u200d❤️\u200d💋\u200d👨🏾"]],
  ["technologist light tone", "👨🏻\u200d💻x", ["👨🏻\u200d💻", "x"]],
  ["rainbow flag", "🏳️\u200d🌈", ["🏳️\u200d🌈"]],
  ["pirate flag", "🏴\u200d☠️", ["🏴\u200d☠️"]],
  ["heart on fire", "❤️\u200d🔥", ["❤️\u200d🔥"]],
  ["man with beard", "🧔\u200d♂️", ["🧔\u200d♂️"]],
  ["eye in speech bubble", "👁️\u200d🗨️", ["👁️\u200d🗨️"]],
  ["dangling ZWJ after emoji", "😀" + ZWJ + "a", ["😀" + ZWJ, "a"]],
  ["ZWJ between letters", "a" + ZWJ + "b", ["a" + ZWJ, "b"]],
  ["ZWJ then emoji after a letter", "a" + ZWJ + "😀", ["a" + ZWJ, "😀"]],
  ["leading ZWJ", ZWJ + "😀", [ZWJ, "😀"]],

  // Regional-indicator flags
  ["two flags", "🇯🇵🇺🇸", ["🇯🇵", "🇺🇸"]],
  ["three indicators", "🇦🇦🇦", ["🇦🇦", "🇦"]],
  ["odd indicators between letters", "a🇦🇧🇨b", ["a", "🇦🇧", "🇨", "b"]],
  ["indicator after a letter", "x🇫🇷", ["x", "🇫🇷"]],
  ["indicator with a mark", "🇦́🇧", ["🇦́", "🇧"]],

  // Keycaps
  ["keycaps", "1️⃣2️⃣*️⃣#️⃣", ["1️⃣", "2️⃣", "*️⃣", "#️⃣"]],
  ["keycap without VS16", "1⃣", ["1⃣"]],
  ["keycap ten", "🔟", ["🔟"]],

  // Skin tones
  ["five tones", "👋🏻👋🏼👋🏽👋🏾👋🏿", ["👋🏻", "👋🏼", "👋🏽", "👋🏾", "👋🏿"]],
  ["lone tone", "🏽", ["🏽"]],
  ["tone after a letter", "a🏽", ["a🏽"]],

  // Tag sequences
  ["England", "🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}", ["🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}"]],
  ["Scotland and Wales", "🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}🏴\u{e0067}\u{e0062}\u{e0077}\u{e006c}\u{e0073}\u{e007f}", ["🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}", "🏴\u{e0067}\u{e0062}\u{e0077}\u{e006c}\u{e0073}\u{e007f}"]],
  ["England then text", "🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f} fans", ["🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}", " ", "f", "a", "n", "s"]],

  // Variation selectors
  ["VS15 text style", "☺\ufe0e!", ["☺\ufe0e", "!"]],
  ["VS16 emoji style", "⚠️!", ["⚠️", "!"]],
  ["VS16 on a letter", "a️", ["a️"]],
  ["ideographic variation selector", "葛\u{e0100}x", ["葛\u{e0100}", "x"]],

  // CJK and Japanese marks
  ["CJK", "日本語のテキスト", ["日", "本", "語", "の", "テ", "キ", "ス", "ト"]],
  ["Chinese", "中文标题", ["中", "文", "标", "题"]],
  ["combining dakuten", "が", ["が"]],
  ["halfwidth katakana voiced", "ｶﾞﾊﾟ", ["ｶﾞ", "ﾊﾟ"]],
  ["fullwidth letters", "ＡＢ", ["Ａ", "Ｂ"]],
  ["astral CJK", "𠀋𡈽", ["𠀋", "𡈽"]],

  // Combining marks
  ["e acute decomposed", "é", ["é"]],
  ["stacked marks", "ǟb", ["ǟ", "b"]],
  ["zalgo", "Z͑ͫ̓ͪ̂o", ["Z͑ͫ̓ͪ̂", "o"]],
  ["naive decomposed", "naïve", ["n", "a", "ï", "v", "e"]],
  ["leading mark", "́a", ["́", "a"]],
  ["enclosing circle", "A⃝", ["A⃝"]],
  ["emoji with enclosing keycap", "😀⃣", ["😀⃣"]],
  ["Hebrew points", "שָׁ", ["שָׁ"]],
  ["Arabic with harakat", "كَتَبَ", ["كَ", "تَ", "بَ"]],

  // Hangul
  ["precomposed Hangul", "한국어", ["한", "국", "어"]],
  ["L V T jamo", "각", ["각"]],
  ["L L V jamo", "ᄀ가", ["ᄀ가"]],
  ["LV + T", "각", ["각"]],
  ["LVT + T", "각ᆨ", ["각ᆨ"]],
  ["LVT + V breaks", "각ᅡ", ["각", "ᅡ"]],
  ["T then L breaks", "ᆨᄀ", ["ᆨ", "ᄀ"]],
  ["extended jamo", "ꥠힰퟋ", ["ꥠힰퟋ"]],

  // Indic, Thai, prepend
  ["Devanagari conjunct", "क्षि", ["क्षि"]],
  ["namaste", "नमस्ते", ["न", "म", "स्ते"]],
  ["virama then vowel letter breaks", "क्अ", ["क्", "अ"]],
  ["Khmer coeng", "ក្ស", ["ក្ស"]],
  ["Thai sara am", "กำ", ["กำ"]],
  ["Arabic number sign prepends", "؀١٢", ["؀١", "٢"]],
  ["prepend before newline", "؀\n", ["؀", "\n"]],

  // Line breaks and controls
  ["CR LF", "a\r\nb", ["a", "\r\n", "b"]],
  ["LF CR", "\n\r", ["\n", "\r"]],
  ["CR CR LF", "\r\r\n", ["\r", "\r\n"]],
  ["mark after a control", "a\u0000́", ["a", "\u0000", "́"]],
  ["mark after LF", "\ń", ["\n", "́"]],
  ["tab", "a\tb", ["a", "\t", "b"]],
  ["soft hyphen", "a\u00adb", ["a", "\u00ad", "b"]],
  ["zero width space", "a\u200bb", ["a", "\u200b", "b"]],
  ["ZWNJ extends", "a\u200cb", ["a\u200c", "b"]],

  // Lone surrogates become U+FFFD
  ["lone high at end", "a\ud83d", ["a", "�"]],
  ["lone low at start", "\ude00x", ["�", "x"]],
  ["reversed pair", "\ude00\ud83d", ["�", "�"]],
  ["lone high before a mark", "\ud83d́", ["�́"]],
  ["pair after a lone high", "\ud83d😀", ["�", "😀"]],

  // Plain
  ["empty", "", []],
  ["ascii", "fix flaky test", ["f", "i", "x", " ", "f", "l", "a", "k", "y", " ", "t", "e", "s", "t"]],
];

/** mulberry32: deterministic [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Atoms for fuzzing: whole corpus texts plus single code points that drive
// the rules (marks, joiners, indicators, jamo, tags, controls, surrogates).
const SINGLES = [
  "a", "Z", " ", "  ", "\t", "\r", "\n", "\u0000", "\u007f", "\u0085", "\u00ad",
  "́", "̈", "⃣", "⃝", "\ufe0e", "️", ZWJ, "\u200c", "\u200b",
  "🇦", "🇧", "🇺", "🇸", "🏻", "🏿", "\u{e0067}", "\u{e0062}", "\u{e007f}", "🏴", "😀", "❤", "👩", "👨",
  "ᄀ", "ᅡ", "ᆨ", "가", "각", "ꥠ", "ힰ", "ퟋ",
  "क", "्", "ष", "ि", "ำ", "؀", "ក", "្",
  "日", "か", "゙", "ﾞ", "…", "�",
  "\ud83d", "\ude00", "\udbff", "\udc00", // lone surrogates
];

/** A random string from corpus pieces, single atoms and random code points. */
export function fuzzString(next) {
  const parts = 1 + Math.floor(next() * 10);
  let s = "";
  for (let p = 0; p < parts; p++) {
    const r = next();
    if (r < 0.3) s += CORPUS[Math.floor(next() * CORPUS.length)][1];
    else if (r < 0.85) s += SINGLES[Math.floor(next() * SINGLES.length)];
    else if (r < 0.95) s += String.fromCodePoint(Math.floor(next() * 0x3000));
    else {
      const cp = Math.floor(next() * 0x110000);
      s += cp >= 0xd800 && cp <= 0xdfff ? String.fromCharCode(cp) : String.fromCodePoint(cp);
    }
  }
  return s;
}

export const hasLoneSurrogate = (s) => /[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/.test(s);

/** The string with lone surrogates replaced, written independently of text.js. */
export function fixSurrogates(s) {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    out += c >= 0xd800 && c <= 0xdfff ? "�" : ch;
  }
  return out;
}

/**
 * The properties every graphemes()/clip() result must have, as a list of
 * problems (empty when fine). `mod` holds graphemes and clip.
 */
export function checkText(mod, s, max, ellipsis = "…") {
  const problems = [];
  const fixed = fixSurrogates(s);
  const g = mod.graphemes(s);
  if (g.join("") !== fixed) problems.push("graphemes do not rebuild the string");
  for (const c of g) {
    if (c === "") problems.push("empty cluster");
    if (hasLoneSurrogate(c)) problems.push("lone surrogate in a cluster");
  }

  const r = mod.clip(s, max, ellipsis);
  if (hasLoneSurrogate(r)) problems.push("lone surrogate in clip()");
  const rg = mod.graphemes(r);
  if (rg.length > max) problems.push(`clip() gave ${rg.length} graphemes for max ${max}`);
  const tail = fixSurrogates(ellipsis);
  const tailCount = mod.graphemes(tail).length;
  if (g.length <= max) {
    if (r !== fixed) problems.push("clip() changed a string that fits");
  } else if (max <= tailCount) {
    if (r !== g.slice(0, max).join("")) problems.push("clip() with no room for the ellipsis is not the plain prefix");
  } else {
    if (!r.endsWith(tail)) problems.push("clip() lost the ellipsis");
    const head = r.slice(0, r.length - tail.length);
    let keep = max - tailCount;
    while (keep > 0 && /^\s+$/u.test(g[keep - 1])) keep--;
    if (head !== g.slice(0, keep).join("")) problems.push("clip() head is not the whole-grapheme prefix");
    if (!fixed.startsWith(head)) problems.push("clip() head is not a prefix");
  }
  return problems;
}

/** [function name, args, expected] rows for format.js. */
export const FORMAT_CASES = [
  // formatCount: below 10,000 whole units (toward zero) with commas
  ["formatCount", [0], "0"],
  ["formatCount", [-0], "0"],
  ["formatCount", [1], "1"],
  ["formatCount", [0.999], "0"],
  ["formatCount", [12.7], "12"],
  ["formatCount", [999], "999"],
  ["formatCount", [999.99], "999"],
  ["formatCount", [1000], "1,000"],
  ["formatCount", [1234], "1,234"],
  ["formatCount", [9999], "9,999"],
  ["formatCount", [9999.999], "9,999"],
  ["formatCount", [-0.5], "0"],
  ["formatCount", [-1], "-1"],
  ["formatCount", [-1234.9], "-1,234"],
  ["formatCount", [-9999.9], "-9,999"],
  // from 10,000: three significant digits, half up, suffixes
  ["formatCount", [10000], "10.0K"],
  ["formatCount", [10049], "10.0K"],
  ["formatCount", [10050], "10.1K"],
  ["formatCount", [12345], "12.3K"],
  ["formatCount", [12400], "12.4K"],
  ["formatCount", [12449], "12.4K"],
  ["formatCount", [12450], "12.5K"],
  ["formatCount", [12480], "12.5K"],
  ["formatCount", [99949], "99.9K"],
  ["formatCount", [99950], "100K"],
  ["formatCount", [100000], "100K"],
  ["formatCount", [123456], "123K"],
  ["formatCount", [999499], "999K"],
  ["formatCount", [999500], "1.00M"],
  ["formatCount", [999950], "1.00M"],
  ["formatCount", [999999.99], "1.00M"],
  ["formatCount", [1e6], "1.00M"],
  ["formatCount", [1005000], "1.01M"],
  ["formatCount", [4.26e9], "4.26B"],
  ["formatCount", [23.1e6], "23.1M"],
  ["formatCount", [999.5e6], "1.00B"],
  ["formatCount", [1e12], "1.00T"],
  ["formatCount", [1e15], "1.00Qa"],
  ["formatCount", [1e18], "1.00Qi"],
  ["formatCount", [1e21], "1.00Sx"],
  ["formatCount", [1e24], "1.00Sp"],
  ["formatCount", [1e27], "1.00Oc"],
  ["formatCount", [1e30], "1.00No"],
  ["formatCount", [1e33], "1.00Dc"],
  ["formatCount", [12.3e33], "12.3Dc"],
  ["formatCount", [999e33], "999Dc"],
  ["formatCount", [999.4e33], "999Dc"],
  ["formatCount", [999.5e33], "1.00e36"],
  ["formatCount", [1e36], "1.00e36"],
  ["formatCount", [1.234e36], "1.23e36"],
  ["formatCount", [1.235e36], "1.24e36"],
  ["formatCount", [5.5e99], "5.50e99"],
  ["formatCount", [9.999e99], "1.00e100"],
  ["formatCount", [1.7976931348623157e308], "1.80e308"],
  ["formatCount", [-12480], "-12.5K"],
  ["formatCount", [-999950], "-1.00M"],
  ["formatCount", [-1e40], "-1.00e40"],
  // style "sci"
  ["formatCount", [9999, "sci"], "9,999"],
  ["formatCount", [10000, "sci"], "1.00e4"],
  ["formatCount", [12400, "sci"], "1.24e4"],
  ["formatCount", [12450, "sci"], "1.25e4"],
  ["formatCount", [99950, "sci"], "1.00e5"],
  ["formatCount", [999950, "sci"], "1.00e6"],
  ["formatCount", [4.26e9, "sci"], "4.26e9"],
  ["formatCount", [1.234e36, "sci"], "1.23e36"],
  ["formatCount", [-12400, "sci"], "-1.24e4"],
  ["formatCount", [5, "short"], "5"],
  // guards
  ["formatCount", [NaN], "0"],
  ["formatCount", [undefined], "0"],
  ["formatCount", [null], "0"],
  ["formatCount", ["abc"], "0"],
  ["formatCount", ["12480"], "12.5K"],
  ["formatCount", [Infinity], "∞"],
  ["formatCount", [-Infinity], "-∞"],

  // formatRate
  ["formatRate", [0], "0/s"],
  ["formatRate", [-0], "0/s"],
  ["formatRate", [0.004], "0/s"],
  ["formatRate", [0.005], "+0.01/s"],
  ["formatRate", [0.05], "+0.05/s"],
  ["formatRate", [0.125], "+0.13/s"],
  ["formatRate", [0.25], "+0.25/s"],
  ["formatRate", [0.994], "+0.99/s"],
  ["formatRate", [0.995], "+1.0/s"],
  ["formatRate", [1], "+1.0/s"],
  ["formatRate", [4.3], "+4.3/s"],
  ["formatRate", [86.2], "+86.2/s"],
  ["formatRate", [86.24], "+86.2/s"],
  ["formatRate", [86.25], "+86.3/s"],
  ["formatRate", [99.94], "+99.9/s"],
  ["formatRate", [99.95], "+100/s"],
  ["formatRate", [100], "+100/s"],
  ["formatRate", [187], "+187/s"],
  ["formatRate", [187.5], "+188/s"],
  ["formatRate", [1234.4], "+1,234/s"],
  ["formatRate", [9999.4], "+9,999/s"],
  ["formatRate", [9999.5], "+10.0K/s"],
  ["formatRate", [12480], "+12.5K/s"],
  ["formatRate", [999950], "+1.00M/s"],
  ["formatRate", [1.234e36], "+1.23e36/s"],
  ["formatRate", [12400, "sci"], "+1.24e4/s"],
  ["formatRate", [86.2, "sci"], "+86.2/s"],
  ["formatRate", [-86.2], "-86.2/s"],
  ["formatRate", [-0.25], "-0.25/s"],
  ["formatRate", [-12480], "-12.5K/s"],
  ["formatRate", [-0.001], "0/s"],
  ["formatRate", [187, "short", { sign: false }], "187/s"],
  ["formatRate", [-187, "short", { sign: false }], "-187/s"],
  ["formatRate", [11, "short", { sign: false, compact: true }], "11/s"],
  ["formatRate", [86.2, "short", { compact: true }], "+86/s"],
  ["formatRate", [86.5, "short", { compact: true }], "+87/s"],
  ["formatRate", [9.94, "short", { compact: true }], "+9.9/s"],
  ["formatRate", [9.95, "short", { compact: true }], "+10/s"],
  ["formatRate", [0.25, "short", { compact: true }], "+0.3/s"],
  ["formatRate", [0.04, "short", { compact: true }], "0/s"],
  ["formatRate", [NaN], "0/s"],
  ["formatRate", [undefined], "0/s"],
  ["formatRate", [Infinity], "+∞/s"],
  ["formatRate", [-Infinity], "-∞/s"],

  // formatDuration: rounded down, two adjacent units, zero second unit dropped
  ["formatDuration", [0], "0s"],
  ["formatDuration", [999], "0s"],
  ["formatDuration", [1000], "1s"],
  ["formatDuration", [12000], "12s"],
  ["formatDuration", [59999], "59s"],
  ["formatDuration", [60000], "1m"],
  ["formatDuration", [61000], "1m 1s"],
  ["formatDuration", [130000], "2m 10s"],
  ["formatDuration", [130999], "2m 10s"],
  ["formatDuration", [180000], "3m"],
  ["formatDuration", [3599999], "59m 59s"],
  ["formatDuration", [3600000], "1h"],
  ["formatDuration", [3660000], "1h 1m"],
  ["formatDuration", [3601000], "1h"],
  ["formatDuration", [27720000], "7h 42m"],
  ["formatDuration", [27779999], "7h 42m"],
  ["formatDuration", [28800000], "8h"],
  ["formatDuration", [40800000], "11h 20m"],
  ["formatDuration", [86400000], "1d"],
  ["formatDuration", [86400000 + 300000], "1d"],
  ["formatDuration", [3 * 86400000 + 4 * 3600000], "3d 4h"],
  ["formatDuration", [400 * 86400000], "400d"],
  ["formatDuration", [27720000, "spaced"], "7 h 42 m"],
  ["formatDuration", [40800000, "spaced"], "11 h 20 m"],
  ["formatDuration", [12000, "spaced"], "12 s"],
  ["formatDuration", [0, "spaced"], "0 s"],
  ["formatDuration", [180000, { spaced: true }], "3 m"],
  ["formatDuration", [840000 + 59000, { spaced: true, parts: 1 }], "14 m"],
  ["formatDuration", [3 * 86400000 + 5 * 3600000, { spaced: true, parts: 1 }], "3 d"],
  ["formatDuration", [130000, { parts: 1 }], "2m"],
  ["formatDuration", [130000, "compact"], "2m 10s"],
  ["formatDuration", [-5000], "0s"],
  ["formatDuration", [NaN], "0s"],
  ["formatDuration", [undefined], "0s"],
  ["formatDuration", [Infinity], "∞"],
  ["formatDuration", [-Infinity], "0s"],

  // formatEta: rounded up to the last unit shown
  ["formatEta", [130000], "in 2m 10s"],
  ["formatEta", [129001], "in 2m 10s"],
  ["formatEta", [1], "in 1s"],
  ["formatEta", [300], "in 1s"],
  ["formatEta", [1000], "in 1s"],
  ["formatEta", [1001], "in 2s"],
  ["formatEta", [59001], "in 1m"],
  ["formatEta", [60000], "in 1m"],
  ["formatEta", [60001], "in 1m 1s"],
  ["formatEta", [3599001], "in 1h"],
  ["formatEta", [3600001], "in 1h 1m"],
  ["formatEta", [27720000], "in 7h 42m"],
  ["formatEta", [27720001], "in 7h 43m"],
  ["formatEta", [86399999], "in 1d"],
  ["formatEta", [130000, "spaced"], "in 2 m 10 s"],
  ["formatEta", [130000, { parts: 1 }], "in 3m"],
  ["formatEta", [0], "now"],
  ["formatEta", [-1], "now"],
  ["formatEta", [NaN], null],
  ["formatEta", [Infinity], null],
  ["formatEta", [-Infinity], null],
  ["formatEta", [undefined], null],

  // formatInt
  ["formatInt", [0], "0"],
  ["formatInt", [12480], "12,480"],
  ["formatInt", [1234567.5], "1,234,568"],
  ["formatInt", [-0.4], "0"],
  ["formatInt", [-1000], "-1,000"],
  ["formatInt", [1e20], "1.00e20"],
  ["formatInt", [1e300], "1.00e300"],
  ["formatInt", [NaN], "0"],
];

/** Runs FORMAT_CASES against `mod`; returns the failing rows. */
export function checkFormat(mod) {
  const failures = [];
  for (const [fn, args, want] of FORMAT_CASES) {
    let got;
    try {
      got = mod[fn](...args);
    } catch (e) {
      got = "threw " + e;
    }
    if (got !== want) failures.push({ fn, args: args.map(String), want, got });
  }
  return failures;
}

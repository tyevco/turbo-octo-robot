// engine/text.js: graphemes, clip, cleanTitle (ARCHITECTURE A2 rule 8).
// Run: node --test test/text/
import { test } from "node:test";
import assert from "node:assert/strict";

import * as text from "../../mods/creaseworks/engine/text.js";
import { CORPUS, HERDR_EMOJI, checkText, fuzzString, rng, fixSurrogates, hasLoneSurrogate } from "./corpus.js";

const { graphemes, graphemeCount, clip, cleanTitle } = text;
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const oracle = (s) => Array.from(segmenter.segment(s), (x) => x.segment);
const hex = (s) => Array.from(s, (c) => c.codePointAt(0).toString(16)).join(" ");

test("the corpus splits as written", () => {
  for (const [name, input, want] of CORPUS) {
    assert.deepEqual(graphemes(input), want, `${name}: ${hex(input)}`);
    assert.equal(graphemeCount(input), want.length, name);
  }
});

test("the corpus agrees with Intl.Segmenter (Node's ICU) where the input is well formed", () => {
  for (const [name, input] of CORPUS) {
    if (hasLoneSurrogate(input)) continue;
    assert.deepEqual(graphemes(input), oracle(input), name);
  }
});

test("herdr's 15 title emoji each stay whole when clipped", () => {
  for (const e of HERDR_EMOJI) {
    assert.equal(clip(`${e} login`, 1), e);
    assert.equal(clip(`${e} login`, 2), e + "…");
    assert.equal(clip(`${e} login`, 3), e + "…"); // the space before the ellipsis goes
    assert.equal(clip(`${e} login`, 4), `${e} l…`);
    assert.equal(clip(`${e} login`, 7), `${e} login`);
    assert.equal(clip(e + e + e, 2), e + "…");
  }
});

test("every code point, in five contexts, splits like Intl.Segmenter", () => {
  const contexts = [
    (c) => "a" + c + "b",
    (c) => c + "́",
    (c) => "क्" + c,
    (c) => "ᄀ" + c,
    (c) => c + "ᅡ",
    (c) => c + "a",
    (c) => "क" + c + "क",
    (c) => "😀\u200d" + c,
  ];
  const bad = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    // Planes 4-13 and 15-16 are unassigned or private use; sample them.
    if (cp >= 0x40000 && cp < 0xe0000 && (cp & 0xfff) !== 0) continue;
    if (cp >= 0xf0000 && (cp & 0xfff) !== 0) continue;
    const ch = String.fromCodePoint(cp);
    for (const make of contexts) {
      const s = make(ch);
      const a = graphemes(s);
      const b = oracle(s);
      if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
        bad.push(`${cp.toString(16)} in ${hex(s)}`);
        break;
      }
    }
  }
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} mismatches`);
});

test("fuzz: random strings rebuild exactly, match Intl.Segmenter, and clip to whole-grapheme prefixes", () => {
  const next = rng(0xc0ffee);
  let checked = 0;
  for (let i = 0; i < 6000; i++) {
    const s = fuzzString(next);
    const fixed = fixSurrogates(s);
    assert.deepEqual(graphemes(s), oracle(fixed), `oracle: ${hex(s)}`);
    for (const max of [0, 1, 2, 3, 5, 8, 13, 60]) {
      const problems = checkText(text, s, max);
      assert.deepEqual(problems, [], `clip(${hex(s)}, ${max})`);
      checked++;
    }
    const problems = checkText(text, s, 1 + Math.floor(next() * 12), next() < 0.5 ? "..." : "");
    assert.deepEqual(problems, [], `clip(${hex(s)}) with another ellipsis`);
  }
  assert.ok(checked >= 48000);
});

test("clip: limits, ellipsis, whitespace before it, odd arguments", () => {
  assert.equal(clip("fix flaky test", 60), "fix flaky test");
  assert.equal(clip("fix flaky test", 14), "fix flaky test");
  assert.equal(clip("fix flaky test", 13), "fix flaky te…");
  assert.equal(clip("fix flaky test", 5), "fix…"); // "fix " drops its space
  assert.equal(clip("fix   test", 6), "fix…");
  assert.equal(clip("     x", 3), "…");
  assert.equal(clip("abc", 1), "a");
  assert.equal(clip("abc", 0), "");
  assert.equal(clip("abc", -3), "");
  assert.equal(clip("abc", NaN), "");
  assert.equal(clip("abc", 2.9), "a…");
  assert.equal(clip("abc", Infinity), "abc");
  assert.equal(clip("abcdef", 4, "..."), "a...");
  assert.equal(clip("abcdef", 3, "..."), "abc");
  assert.equal(clip("abcdef", 3, ""), "abc");
  assert.equal(clip("abcdef", 3, "……"), "a……");
  assert.equal(clip(null, 5), "");
  assert.equal(clip(undefined, 5), "");
  assert.equal(clip(12345678, 4), "123…");
  assert.equal(clip("a\ud83d", 5), "a�");
  assert.equal(clip("ab😀\ud83d", 3), "ab…");
  // never a half surrogate pair, never half a cluster
  assert.equal(clip("😀😀😀", 2), "😀…");
  assert.equal(clip("👨\u200d👩\u200d👧\u200d👦👨\u200d👩\u200d👧\u200d👦", 1), "👨\u200d👩\u200d👧\u200d👦");
  assert.equal(clip("🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}", 2), "🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}…");
  assert.equal(clip("🇯🇵🇺🇸🇰🇷", 2), "🇯🇵…");
  assert.equal(clip("ééé", 2), "é…");
  assert.equal(clip("日本語のテキスト", 4), "日本語…");
  assert.equal(clip("각각ᄀ", 2), "각…");
  assert.equal(clip("a\r\nb\r\nc", 3), "a…"); // CR LF is whitespace: dropped before the ellipsis
  // DESIGN §3.4: names at 8, titles at 60
  assert.equal(clip("Bartholomew", 8), "Barthol…");
  assert.equal(clip("x".repeat(80), 60), "x".repeat(59) + "…");
});

test("graphemes and graphemeCount coerce odd input", () => {
  assert.deepEqual(graphemes(null), []);
  assert.deepEqual(graphemes(undefined), []);
  assert.deepEqual(graphemes(42), ["4", "2"]);
  assert.equal(graphemeCount("👨\u200d👩\u200d👧\u200d👦a"), 2);
  assert.equal(graphemeCount(""), 0);
});

test("cleanTitle strips controls and escapes, collapses whitespace, keeps emoji whole", () => {
  assert.equal(cleanTitle("  fix\tflaky\n\ntest  "), "fix flaky test");
  assert.equal(cleanTitle("a\r\nb"), "a b");
  assert.equal(cleanTitle("bell\u0007 and nul\u0000 and del\u007f"), "bell and nul and del");
  assert.equal(cleanTitle("c1\u0085\u009b controls"), "c1 controls");
  assert.equal(cleanTitle("\u001b[1;31mred\u001b[0m text"), "red text");
  assert.equal(cleanTitle("\u001b]0;window title\u0007shown"), "shown");
  assert.equal(cleanTitle("\u001b]2;t\u001b\\after"), "after");
  assert.equal(cleanTitle("esc\u001bc reset"), "esc reset");
  assert.equal(cleanTitle("\u202eevil\u202c \u2066iso\u2069"), "evil iso");
  assert.equal(cleanTitle("line\u2028sep\u2029para"), "line sep para");
  assert.equal(cleanTitle("nb 　space"), "nb space");
  assert.equal(cleanTitle("lone \ud83d end"), "lone � end");
  assert.equal(cleanTitle(null), "");
  assert.equal(cleanTitle(undefined), "");
  assert.equal(cleanTitle(7), "7");
  for (const e of HERDR_EMOJI) assert.equal(cleanTitle(`  ${e}   login `), `${e} login`);
  for (const s of ["👨\u200d👩\u200d👧\u200d👦", "🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}", "1️⃣", "☺\ufe0e", "a\u200cb", "é"]) assert.equal(cleanTitle(s), s);
});

test("cleanTitle fuzz: no controls, no lone surrogates, no double spaces, no edges", () => {
  const next = rng(77);
  for (let i = 0; i < 4000; i++) {
    const s = fuzzString(next);
    const t = cleanTitle(s);
    assert.ok(!hasLoneSurrogate(t), hex(s));
    assert.ok(!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(t), hex(s));
    assert.ok(!/\s\s/u.test(t) && t === t.trim(), hex(s));
    assert.equal(cleanTitle(t), t, "idempotent");
  }
});

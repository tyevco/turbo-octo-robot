// engine/format.js: counts, rates, durations, ETAs (DESIGN §3.1, §3.4, §3.7).
// Run: node --test test/text/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as format from "../../mods/creaseworks/engine/format.js";
import { FORMAT_CASES, checkFormat, rng } from "./corpus.js";

const { formatCount, formatRate, formatDuration, formatEta } = format;
const SUFFIX = { "": 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12, Qa: 1e15, Qi: 1e18, Sx: 1e21, Sp: 1e24, Oc: 1e27, No: 1e30, Dc: 1e33 };

/** Reads a formatCount string back to a number (the test's own parser). */
function parseCount(s) {
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  let m = /^(\d)\.(\d\d)e(\d+)$/.exec(body);
  let v;
  if (m) v = Number(`${m[1]}.${m[2]}e${m[3]}`);
  else if ((m = /^(\d{1,3}(?:,\d{3})*)$/.exec(body))) v = Number(m[1].replaceAll(",", ""));
  else if ((m = /^(\d+(?:\.\d+)?)(K|M|B|T|Qa|Qi|Sx|Sp|Oc|No|Dc)$/.exec(body))) v = Number(m[1]) * SUFFIX[m[2]];
  else throw new Error(`unparseable count "${s}"`);
  return neg ? -v : v;
}

test("every row of the format table", () => {
  assert.deepEqual(checkFormat(format), []);
  assert.ok(FORMAT_CASES.length > 150);
});

test("DESIGN examples", () => {
  assert.equal(formatCount(12480), "12.5K"); // header "12.4K folds" shows a value in 12,350..12,449
  assert.equal(formatCount(12400), "12.4K");
  assert.equal(formatCount(12400, "sci"), "1.24e4"); // Settings: Short (12.4K) | Scientific (1.24e4)
  assert.equal(formatCount(9999), "9,999");
  assert.equal(formatCount(1.23e36), "1.23e36");
  assert.equal(formatCount(31200), "31.2K"); // shop cost
  assert.equal(formatCount(23.1e6), "23.1M"); // "Next crane in 23.1M folds"
  assert.equal(formatCount(4.26e9), "4.26B"); // "lifetime 4.26B"
  assert.equal(formatCount(4.81e6), "4.81M"); // "+4.81M while away"
  assert.equal(formatCount(1.3e6), "1.30M"); // detail card "1.3M folds" is the same value at 3 digits
  assert.equal(formatRate(86.2), "+86.2/s");
  assert.equal(formatRate(86.2, "short", { compact: true }), "+86/s");
  assert.equal(formatRate(11, "short", { sign: false }), "11.0/s");
  assert.equal(formatRate(187, "short", { sign: false }), "187/s");
  assert.equal(formatDuration(130000), "2m 10s");
  assert.equal(formatEta(130000), "in 2m 10s");
  assert.equal(formatDuration(7 * 3600000 + 42 * 60000, "spaced"), "7 h 42 m");
  assert.equal(formatDuration(11 * 3600000 + 20 * 60000, "spaced"), "11 h 20 m");
  assert.equal(formatDuration(12000, "spaced"), "12 s");
  assert.equal(formatDuration(3 * 60000, { spaced: true, parts: 1 }), "3 m");
  assert.equal(formatDuration(14 * 60000 + 30000, { spaced: true, parts: 1 }), "14 m");
  assert.equal(formatDuration(3 * 86400000, { spaced: true, parts: 1 }), "3 d");
  assert.equal(formatDuration(52000, "spaced"), "52 s");
});

test("formatCount: within half a unit of the last digit, sign-symmetric, monotone", () => {
  const next = rng(1234);
  const values = [];
  for (let e = 0; e <= 308; e++) {
    for (let k = 0; k < 40; k++) values.push((1 + next() * 9) * Math.pow(10, e));
    values.push(Math.pow(10, e), 9.995 * Math.pow(10, e), 9.994999 * Math.pow(10, e), 9.9949 * Math.pow(10, e));
  }
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    for (const style of ["short", "sci"]) {
      const s = formatCount(v, style);
      const back = parseCount(s);
      if (v < 10000) {
        assert.equal(back, Math.floor(v), `${v} -> ${s}`);
      } else {
        // three significant digits: |back - v| <= half a unit in the third digit
        const exp = Math.floor(Math.log10(back));
        const unit = Math.pow(10, exp - 2);
        assert.ok(Math.abs(back - v) <= unit * 0.5 * (1 + 1e-9), `${style} ${v} -> ${s}`);
        assert.ok(!/^1000|\D1000[A-Za-z]|^\d{4}[A-Z]/.test(s), `${v} -> ${s} has four digits`);
        assert.match(s, style === "sci" || back >= 1e36 ? /^\d\.\d\de\d+$/ : /^(\d\.\d\d|\d\d\.\d|\d\d\d)(K|M|B|T|Qa|Qi|Sx|Sp|Oc|No|Dc)$/);
      }
      assert.equal(formatCount(-v, style), v < 1 ? "0" : "-" + s);
    }
  }
  // monotone: sorted inputs give sorted parsed outputs
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  let prev = -Infinity;
  for (const v of sorted) {
    const back = parseCount(formatCount(v));
    assert.ok(back >= prev, `not monotone at ${v}`);
    prev = back;
  }
});

test("formatCount: every rounding boundary for three digits and every suffix", () => {
  for (let tier = 1; tier <= 11; tier++) {
    const base = Math.pow(10, 3 * tier);
    if (tier > 1) {
      // 999.5 of the tier below rounds up into this tier, never "1000<suffix>"
      assert.match(formatCount(999.5 * (base / 1000) * 1.0000001), /^1\.00(K|M|B|T|Qa|Qi|Sx|Sp|Oc|No|Dc)$/);
    }
    if (tier >= 2) {
      assert.match(formatCount(base * 9.9951), /^10\.0[A-Z]/);
      assert.match(formatCount(base * 9.9949), /^9\.99[A-Z]/);
    }
    assert.match(formatCount(base * 99.951), /^100[A-Z]/);
    assert.match(formatCount(base * 99.949), /^99\.9[A-Z]/);
    if (tier >= 2) assert.match(formatCount((base / 1000) * 999.449), /^999[A-Z]/);
  }
});

test("formatRate: thresholds and monotone over a sweep", () => {
  let prev = -Infinity;
  for (let i = 0; i <= 200000; i++) {
    const v = i * 0.05;
    const s = formatRate(v);
    assert.match(s, /^(0|\+(\d\.\d\d|\d{1,2}\.\d|\d{1,3}(,\d{3})?|\d+(\.\d+)?[KM]))\/s$/, `${v} -> ${s}`);
    const body = s === "0/s" ? "0" : s.slice(1, -2);
    const back = /[KM]$/.test(body) ? parseCount(body) : Number(body.replaceAll(",", ""));
    assert.ok(back >= prev, `not monotone at ${v}: ${s}`);
    const decimals = /\.(\d+)$/.exec(body);
    const half = /[KM]$/.test(body) ? back * 0.005 : decimals ? 0.5 * Math.pow(10, -decimals[1].length) : 0.5;
    assert.ok(Math.abs(back - v) <= half + 1e-9, `${v} -> ${s}`);
    prev = back;
    assert.equal(formatRate(-v), s === "0/s" ? "0/s" : "-" + s.slice(1));
  }
});

test("formatDuration / formatEta: floor vs ceil, never more than two adjacent units", () => {
  const next = rng(99);
  for (let i = 0; i < 20000; i++) {
    const ms = Math.floor(Math.pow(10, next() * 10));
    for (const opts of [undefined, "spaced", { parts: 1 }]) {
      const d = formatDuration(ms, opts);
      const eta = formatEta(ms, opts);
      const re = opts === "spaced" ? /^\d+ [dhms]( \d+ [hms])?$/ : /^\d+[dhms]( \d+[hms])?$/;
      assert.match(d, re, `${ms}`);
      assert.match(eta.slice(3), re, `${ms}`);
      const total = (s) => {
        let t = 0;
        for (const m of s.matchAll(/(\d+) ?([dhms])/g)) t += Number(m[1]) * { d: 86400000, h: 3600000, m: 60000, s: 1000 }[m[2]];
        return t;
      };
      assert.ok(total(d) <= ms, `duration ${ms} -> ${d} overstates`);
      assert.ok(total(eta.slice(3)) >= ms, `eta ${ms} -> ${eta} understates`);
      const units = [...d.matchAll(/[dhms]/g)].map((m) => "dhms".indexOf(m[0]));
      if (units.length === 2) assert.equal(units[1], units[0] + 1, d);
      if (opts && opts.parts === 1) assert.equal(units.length, 1);
    }
  }
});

test("format.js uses no Intl, toLocaleString or toFixed", () => {
  const src = readFileSync(new URL("../../mods/creaseworks/engine/format.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(src, /\bIntl\b|toLocaleString|toFixed|toPrecision|\bDate\b/);
  const src2 = readFileSync(new URL("../../mods/creaseworks/engine/text.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(src2, /\bIntl\b|Segmenter|\bimport\b/);
});

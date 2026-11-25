// UI foundation: palette literals and every contrast claim of DESIGN §13.2 /
// §14 / §3 / §5.2 recomputed against tools/mock/themes.json; colour helpers;
// the status contrast guard; sprite paths; widget builders; and the B6
// ViewModel fixtures used until engine view() exists.
//
//   node --import ./tools/node/register.mjs --test test/ui/foundation.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { walk } from "../../tools/mock/gpui-kit.js";
import { createHost } from "../../tools/qjs/harness.mjs";
import * as P from "../../mods/creaseworks/ui/palette.js";
import * as C from "../../mods/creaseworks/ui/color.js";
import * as A from "../../mods/creaseworks/ui/art.js";
import * as W from "../../mods/creaseworks/ui/widgets.js";
import * as F from "../fixtures/vm-fixtures.mjs";
import { CONTENT } from "../../mods/creaseworks/engine/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const THEMES = JSON.parse(readFileSync(join(root, "tools/mock/themes.json"), "utf8"));
const LIGHT = ["paper", "win98"];
const DARK = ["graphite", "ink", "moss", "atom-one-dark"];
const ALL = [...DARK, ...LIGHT];
const isDark = (name) => DARK.includes(name);
const FIVE = ["graphite", "paper", "ink", "moss", "atom-one-dark"]; // §13.2's "across" list (win98 left to the guard)

const r2 = (x) => Math.round(x * 100) / 100;
const minOf = (xs) => Math.min(...xs);
const maxOf = (xs) => Math.max(...xs);

// ---------------------------------------------------------------------------
// Palette

test("themes.json has the six shipped themes", () => {
  assert.deepEqual(Object.keys(THEMES).sort(), [...ALL].sort());
});

test("palette: every literal is #rrggbb or #rrggbbaa, lower-case, and the tables are frozen", () => {
  const hex = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/;
  const literals = [
    ...Object.values(P.S_LIGHT), ...Object.values(P.S_DARK), ...P.HUE_LIGHT, ...P.HUE_DARK, ...Object.values(P.NOTIFY_ICON),
  ];
  assert.equal(literals.length, 13 * 2 + 8 * 2 + 2);
  for (const c of literals) {
    assert.match(c, hex, c);
    assert.ok(C.isHex(c), c);
  }
  for (const t of [P.S, P.S_LIGHT, P.S_DARK, P.Hue, P.HUE_LIGHT, P.HUE_DARK, P.HUE_NAMES, P.NOTIFY_ICON]) {
    assert.ok(Object.isFrozen(t));
  }
  assert.deepEqual(Object.keys(P.S_LIGHT), Object.keys(P.S_DARK));
  assert.deepEqual(Object.keys(P.S_LIGHT), [
    "mat", "matEdge", "grid", "gridMajor", "sheet", "sheetShade", "crease", "ink", "onMat", "node", "gold", "goldShade", "goldInk",
  ]);
  // Only the decorative grid lines carry alpha.
  for (const [k, v] of Object.entries(P.S_LIGHT)) assert.equal(v.length === 9, k === "grid" || k === "gridMajor", k);
  assert.deepEqual([...P.HUE_NAMES], [...CONTENT.HUES]);
  assert.equal(P.S.light, P.S_LIGHT);
  assert.equal(P.S.dark, P.S_DARK);
  assert.equal(P.pickScene(true), P.S_DARK);
  assert.equal(P.pickScene(false), P.S_LIGHT);
  assert.equal(P.pickHues(true), P.HUE_DARK);
  assert.equal(P.pickHues(false), P.HUE_LIGHT);
  assert.equal(P.hueOf(P.HUE_DARK, 9), P.HUE_DARK[1]);
  assert.equal(P.hueOf(P.HUE_DARK, -1), P.HUE_DARK[7]);
  assert.equal(P.hueOf(P.HUE_DARK, "x"), P.HUE_DARK[0]);
});

test("palette: DESIGN §13.2 tables are transcribed exactly", () => {
  const design = readFileSync(join(root, "docs/DESIGN.md"), "utf8");
  for (const [k, v] of Object.entries(P.S_LIGHT)) {
    const re = new RegExp("\\| `" + k + "` \\| `(#[0-9a-f]+)` \\| `(#[0-9a-f]+)` \\|");
    const m = re.exec(design);
    assert.ok(m, `row for ${k}`);
    assert.equal(m[1], v, `${k} light`);
    assert.equal(m[2], P.S_DARK[k], `${k} dark`);
  }
  P.HUE_NAMES.forEach((name, i) => {
    const m = new RegExp("\\| " + i + " \\| " + name + " \\| `(#[0-9a-f]+)` \\| `(#[0-9a-f]+)` \\|").exec(design);
    assert.ok(m, `hue row ${i}`);
    assert.equal(m[1], P.HUE_LIGHT[i]);
    assert.equal(m[2], P.HUE_DARK[i]);
  });
  // The notify icon's two literals (§13.3) match the art generator and the file.
  const icon = readFileSync(join(root, "mods/creaseworks/art/notify-icon.svg"), "utf8");
  assert.ok(icon.includes(P.NOTIFY_ICON.crane) && icon.includes(P.NOTIFY_ICON.mat));
  assert.equal(P.NOTIFY_ICON.crane, P.S_LIGHT.sheet);
  assert.equal(P.NOTIFY_ICON.mat, P.S_LIGHT.mat);
});

// ---------------------------------------------------------------------------
// Colour helpers

test("color: isHex / hex6 / rgba / withAlpha / mix / over", () => {
  for (const ok of ["#fff", "#FFFFFF", "#12345678", "#abc"]) assert.ok(C.isHex(ok), ok);
  for (const bad of ["fff", "#ff", "#ffff", "#fffff", "#ggg", "#+fffff", "", null, undefined, 3, "red", "#1234567", "#123456789"]) {
    assert.equal(C.isHex(bad), false, String(bad));
  }
  assert.equal(C.hex6("#ABC"), "#aabbcc");
  assert.equal(C.hex6("#123456"), "#123456");
  assert.equal(C.hex6("#ffffff18"), "#ffffff");
  assert.throws(() => C.hex6("#12"), TypeError);
  assert.throws(() => C.hex6(null), TypeError);
  assert.deepEqual(C.rgba("#11223380"), { r: 0x11, g: 0x22, b: 0x33, a: 0x80 / 255 });

  assert.equal(C.withAlpha("#c93c2c", "1f"), "#c93c2c1f");
  assert.equal(C.withAlpha("#ffffff18", "1F"), "#ffffff1f", "8-digit theme colour normalised first, alpha replaced");
  assert.equal(C.withAlpha("#abc", 0.5), "#aabbcc80");
  assert.equal(C.withAlpha("#abc", 0), "#aabbcc00");
  assert.equal(C.withAlpha("#abc", 1), "#aabbccff");
  for (const bad of [1.5, -0.1, NaN, "0x1f", "1", "fff", null]) assert.throws(() => C.withAlpha("#abc", bad), TypeError, String(bad));
  assert.throws(() => C.withAlpha("white", 0.5), TypeError);

  assert.equal(C.mix("#000000", "#ffffff", 0), "#000000");
  assert.equal(C.mix("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(C.mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(C.mix("#000000", "#ffffff", 7), "#ffffff", "clamped");
  assert.equal(C.mix("#ff000080", "#0000ff", 0.25), "#bf0040", "alpha ignored");

  assert.equal(C.over("#ffffff00", "#123456"), "#123456");
  assert.equal(C.over("#000000", "#123456"), "#000000");
  assert.equal(C.over("#ffffff80", "#000000"), "#808080");
});

test("color: luminance and WCAG contrast", () => {
  assert.equal(C.luminance("#000"), 0);
  assert.equal(C.luminance("#fff"), 1);
  assert.equal(r2(C.contrast("#000", "#fff")), 21);
  assert.equal(C.contrast("#777", "#777"), 1);
  assert.equal(C.contrast("#123", "#fed"), C.contrast("#fed", "#123"), "symmetric for opaque colours");
  // Reference value: #767676 on white is the classic 4.54:1.
  assert.equal(r2(C.contrast("#767676", "#ffffff")), 4.54);
  // Translucent foreground is composited first: a 0x18 white border on graphite raised is barely visible.
  assert.equal(r2(C.contrast(THEMES.graphite.border, THEMES.graphite.raised)), 1.35);
});

test("color: validateBackgroundColor normalises good colours and throws on bad ones (gpui §5)", () => {
  assert.equal(C.validateBackgroundColor("#ABC"), "#aabbcc");
  assert.equal(C.validateBackgroundColor("#ffffff1f"), "#ffffff1f");
  assert.equal(C.validateBackgroundColor("#123456ff"), "#123456");
  for (const bad of ["#12", "red", "", null, 0x123456, "#+fffff"]) {
    assert.throws(() => C.validateBackgroundColor(bad), (e) => e instanceof TypeError && /Background colour/.test(e.message), String(bad));
  }
});

test("color: statusColor guard falls back status → T.muted → T.foreground (§5.2)", () => {
  const T = { working: "#777777", muted: "#888888", foreground: "#000000", popover: "#ffffff", raised: "#f6f6f6", blocked: "#c93c2c" };
  assert.equal(C.statusColor(T, "blocked", "popover"), "#c93c2c");
  assert.equal(C.statusColor(T, "needs", "popover"), "#c93c2c", "game word");
  assert.equal(C.statusColor(T, "error", "#ffffff"), "#c93c2c", "raw error, hex surface");
  // #777 on white is 4.48 → kept; on #999 it is 1.5 → muted #888 is 1.2 → foreground.
  assert.equal(C.statusColor(T, "working", "#ffffff"), "#777777");
  assert.equal(C.statusColor(T, "working", "#999999"), "#000000");
  // muted reached when it passes.
  assert.equal(C.statusColor({ ...T, working: "#eeeeee", muted: "#555555" }, "working", "popover"), "#555555");
  // Broken theme: nothing passes or nothing is a colour → black/white by surface.
  assert.equal(C.statusColor({}, "working", "#ffffff"), "#000000");
  assert.equal(C.statusColor({}, "working", "#000000"), "#ffffff");
  assert.equal(C.statusColor({ working: "nope", muted: "#ffffff", foreground: "#000000" }, "working", "#ffffff"), "#000000");
  assert.equal(C.statusColor(T, "nonsense", "popover"), "#888888", "unknown status: straight to the muted fallback");
  // 8-digit theme colours come back as #rrggbb.
  assert.equal(C.statusColor({ ...T, blocked: "#c93c2cff" }, "blocked", "popover"), "#c93c2c");
});

test("color: the guard holds on every shipped theme and surface (graphics ≥ 3:1)", () => {
  for (const name of ALL) {
    const T = THEMES[name];
    for (const surface of ["popover", "chrome", "raised"]) {
      for (const status of ["working", "blocked", "done", "idle"]) {
        const c = C.statusColor(T, status, surface);
        assert.ok(C.contrast(c, T[surface]) >= 3, `${name} ${status} on ${surface}: ${c}`);
        const direct = C.contrast(T[status], T[surface]) >= 3;
        assert.equal(c === T[status], direct, `${name} ${status} on ${surface} uses the theme colour iff it passes`);
      }
    }
  }
  // Called out in §5.2: idle falls back on raised everywhere; win98 working on popover falls back.
  for (const name of ALL) assert.notEqual(C.statusColor(THEMES[name], "idle", "raised"), THEMES[name].idle, name);
  assert.equal(C.statusColor(THEMES.win98, "working", "popover"), THEMES.win98.muted);
});

// ---------------------------------------------------------------------------
// Contrast claims (DESIGN §13.2, §14, §3.1, §3.2, §3.4, §5.2)

const SL = P.S_LIGHT;
const SD = P.S_DARK;
const cr = (a, b) => C.contrast(a, b);
const across = (names, f) => names.map((n) => f(THEMES[n], n));

/** Each claim: [where, text, value(s) recomputed, check]. Values are WCAG 2.x ratios. */
const CLAIMS = [
  ["§13.2", "sheet vs mat 5.93 (L)", () => cr(SL.sheet, SL.mat), (v) => r2(v) === 5.93],
  ["§13.2", "sheet vs mat 8.12 (D)", () => cr(SD.sheet, SD.mat), (v) => r2(v) === 8.12],
  ["§13.2", "ink vs sheet 12.86 (L)", () => cr(SL.ink, SL.sheet), (v) => r2(v) === 12.86],
  ["§13.2", "ink vs sheet 10.11 (D)", () => cr(SD.ink, SD.sheet), (v) => r2(v) === 10.11],
  ["§13.2", "onMat on mat 6.34 (L)", () => cr(SL.onMat, SL.mat), (v) => r2(v) === 6.34],
  ["§13.2", "onMat on mat 10.93 (D)", () => cr(SD.onMat, SD.mat), (v) => r2(v) === 10.93],
  ["§13.2", "node vs mat 3.35 (L)", () => cr(SL.node, SL.mat), (v) => r2(v) === 3.35],
  ["§13.2", "node vs mat 6.74 (D)", () => cr(SD.node, SD.mat), (v) => r2(v) === 6.74],
  ["§13.2", "ink on node 7.28 (L)", () => cr(SL.ink, SL.node), (v) => r2(v) === 7.28],
  ["§13.2", "ink on node 8.39 (D)", () => cr(SD.ink, SD.node), (v) => r2(v) === 8.39],
  ["§13.2", "gold vs mat 3.78 (L)", () => cr(SL.gold, SL.mat), (v) => r2(v) === 3.78],
  ["§13.2", "gold vs mat 6.74 (D)", () => cr(SD.gold, SD.mat), (v) => r2(v) === 6.74],
  ["§13.2", "goldInk vs gold 6.96 (L)", () => cr(SL.goldInk, SL.gold), (v) => r2(v) === 6.96],
  ["§13.2", "goldInk vs gold 7.36 (D)", () => cr(SD.goldInk, SD.gold), (v) => r2(v) === 7.36],
  ["§13.2", "central clickable boundary ≥ 3:1 both themes", () => [cr(SL.sheet, SL.mat), cr(SD.sheet, SD.mat)], (v) => minOf(v) >= 3],
  ["§13.2", "light hues ≥ 4.0 vs raised and chrome of paper and win98",
    () => LIGHT.flatMap((n) => P.HUE_LIGHT.flatMap((h) => [cr(h, THEMES[n].raised), cr(h, THEMES[n].chrome)])), (v) => minOf(v) >= 4.0],
  ["§13.2", "dark hues ≥ 4.0 vs raised and chrome of graphite, ink, moss, atom-one-dark",
    () => DARK.flatMap((n) => P.HUE_DARK.flatMap((h) => [cr(h, THEMES[n].raised), cr(h, THEMES[n].chrome)])), (v) => minOf(v) >= 4.0],
  ["§13.2", "on paper raised every light hue ≥ 4.94", () => P.HUE_LIGHT.map((h) => cr(h, THEMES.paper.raised)), (v) => r2(minOf(v)) >= 4.94],
  ["§13.2", "working vs raised 4.50–8.15 (five themes)", () => across(FIVE, (T) => cr(T.working, T.raised)), (v) => r2(minOf(v)) === 4.5 && r2(maxOf(v)) === 8.15],
  ["§13.2", "blocked vs raised 3.64–4.82 (five themes)", () => across(FIVE, (T) => cr(T.blocked, T.raised)), (v) => r2(minOf(v)) === 3.64 && r2(maxOf(v)) === 4.82],
  ["§13.2", "done vs raised 4.30–5.91 (five themes)", () => across(FIVE, (T) => cr(T.done, T.raised)), (v) => r2(minOf(v)) === 4.3 && r2(maxOf(v)) === 5.91],
  ["§13.2", "idle vs raised 2.20–2.55 (five themes)", () => across(FIVE, (T) => cr(T.idle, T.raised)), (v) => r2(minOf(v)) === 2.2 && r2(maxOf(v)) === 2.55],
  ["§13.2", "idle → muted vs raised 4.33–5.07 (five themes)", () => across(FIVE, (T) => cr(T.muted, T.raised)), (v) => r2(minOf(v)) === 4.33 && r2(maxOf(v)) === 5.07],
  ["§3.1/§14", "muted on chrome ≥ 4.84 in every shipped theme", () => across(ALL, (T) => cr(T.muted, T.chrome)), (v) => r2(minOf(v)) >= 4.84],
  ["§3.4/§14", "accent_foreground on accent ≥ 5.65 in every shipped theme", () => across(ALL, (T) => cr(T.accent_foreground, T.accent)), (v) => r2(minOf(v)) >= 5.65],
  ["§14", "ink on sheet ≥ 10.11", () => [cr(SL.ink, SL.sheet), cr(SD.ink, SD.sheet)], (v) => r2(minOf(v)) >= 10.11],
  ["§14", "onMat on mat ≥ 6.34", () => [cr(SL.onMat, SL.mat), cr(SD.onMat, SD.mat)], (v) => r2(minOf(v)) >= 6.34],
  ["§5.2", "idle 2.10–3.61 on popover/chrome/raised (all six)",
    () => ALL.flatMap((n) => ["popover", "chrome", "raised"].map((s) => cr(THEMES[n].idle, THEMES[n][s]))), (v) => r2(minOf(v)) === 2.1 && r2(maxOf(v)) === 3.61],
  ["§5.2", "paper idle on chrome 2.10", () => cr(THEMES.paper.idle, THEMES.paper.chrome), (v) => r2(v) === 2.1],
  ["§5.2", "graphite idle on raised 2.52", () => cr(THEMES.graphite.idle, THEMES.graphite.raised), (v) => r2(v) === 2.52],
  ["§5.2", "muted 4.33–9.16 on popover/chrome/raised (all six)",
    () => ALL.flatMap((n) => ["popover", "chrome", "raised"].map((s) => cr(THEMES[n].muted, THEMES[n][s]))), (v) => r2(minOf(v)) === 4.33 && r2(maxOf(v)) === 9.16],
  ["§5.2", "win98 working on popover 2.31 (falls back)", () => cr(THEMES.win98.working, THEMES.win98.popover), (v) => r2(v) === 2.31],
  ["§5.2", "status colours on the light mat are unusable (< 3:1) in light themes",
    () => LIGHT.flatMap((n) => ["working", "blocked", "done", "idle"].map((s) => cr(THEMES[n][s], SL.mat))), (v) => maxOf(v) < 3],
  ["§3.2", "popover vs mat in dark themes is low (< 1.3) — the reason chips carry a 1 px S.sheet ring",
    () => DARK.map((n) => cr(THEMES[n].popover, SD.mat)), (v) => maxOf(v) < 1.3],
  ["§3.2", "the 1 px S.sheet chip ring is ≥ 3:1 against the dark mat and against popover in every theme",
    () => [cr(SD.sheet, SD.mat), cr(SL.sheet, SL.mat), ...DARK.map((n) => cr(SD.sheet, THEMES[n].popover))], (v) => minOf(v) >= 3],
];

for (const [where, text, value, check] of CLAIMS) {
  test(`contrast claim ${where}: ${text}`, () => {
    const v = value();
    const shown = Array.isArray(v) ? `${r2(minOf(v))}–${r2(maxOf(v))}` : String(r2(v));
    assert.ok(check(v), `${where} "${text}" is false: measured ${shown}`);
  });
}

// Claims that hold only as rounded or for one theme: pinned to their measured values so a change is noticed.
test("contrast notes: claims that are imprecise as written (reported, values pinned)", () => {
  // §3.2 "in dark themes, where popover vs mat is 1.21:1": true for graphite only.
  const pm = Object.fromEntries(DARK.map((n) => [n, r2(cr(THEMES[n].popover, SD.mat))]));
  assert.deepEqual(pm, { graphite: 1.21, ink: 1.25, moss: 1.19, "atom-one-dark": 1.05 });
  // §14 "onMat on mat ≥ 6.34": the light value is 6.337, which rounds to 6.34 but is below it.
  const om = cr(SL.onMat, SL.mat);
  assert.ok(om < 6.34 && om > 6.33, String(om));
  // §13.2 "≥ 4.0:1 … win98": the tightest light hue (saffron on win98 raised) is 4.007.
  assert.equal(r2(cr(P.HUE_LIGHT[1], THEMES.win98.raised)), 4.01);
  // §5.2 guard edge: win98 blocked on raised is 3.0004, so it passes the guard by a hair.
  const wb = cr(THEMES.win98.blocked, THEMES.win98.raised);
  assert.ok(wb >= 3 && wb < 3.001, String(wb));
  // §5.2 "idle usually falls back": on chrome (ribbon, rail) idle passes in the four dark themes.
  const idleChromeDark = DARK.map((n) => cr(THEMES[n].idle, THEMES[n].chrome));
  assert.ok(minOf(idleChromeDark) >= 3.45);
});

// ---------------------------------------------------------------------------
// Art

test("art: FACETS default, root, and every listed asset exists on disk", () => {
  assert.equal(A.FACETS, "alpha");
  assert.equal(A.ART_ROOT, "mods/creaseworks/art");
  let n = 0;
  for (const [folder, names] of Object.entries(A.ASSETS)) {
    for (const name of names) {
      const p = A.spritePath(folder, name);
      assert.equal(p, `mods/creaseworks/art/${folder}/${name}.svg`);
      assert.ok(existsSync(join(root, p)), p);
      n += 1;
    }
  }
  assert.equal(n, 12 + 16 + 8 + 13 + 9 + 24);
  for (const species of A.ASSETS.folk) {
    for (const p of A.splitPaths(A.spritePath("folk", species))) assert.ok(existsSync(join(root, p)), p);
  }
  assert.deepEqual([...A.ASSETS.folk], [...CONTENT.SPECIES]);
});

test("art: spritePath aliases and refusals", () => {
  assert.equal(A.spritePath("species", "koi"), "mods/creaseworks/art/folk/koi.svg");
  assert.equal(A.spritePath("seal", "rush"), "mods/creaseworks/art/scene/seal-rush.svg");
  assert.equal(A.spritePath("seal", "seal-storm"), "mods/creaseworks/art/scene/seal-storm.svg");
  assert.equal(A.spritePath("status", "working"), "mods/creaseworks/art/status/working-arc.svg");
  assert.equal(A.spritePath("status", "needs"), "mods/creaseworks/art/status/needs.svg");
  assert.equal(A.spritePath("icon", "gear"), "mods/creaseworks/art/ui/gear.svg");
  for (const w of CONTENT.WORKSHOPS) {
    assert.ok(existsSync(join(root, A.spritePath("workshop", w.id))), w.id);
    assert.ok(existsSync(join(root, A.spritePath("workshop", w.icon))), w.icon);
  }
  assert.throws(() => A.spritePath("folk", "dragon"), TypeError);
  assert.throws(() => A.spritePath("nope", "crane"), TypeError);
  assert.throws(() => A.spritePath("ui", "__proto__"), TypeError);
  assert.throws(() => A.spritePath("constructor", "x"), TypeError);
  assert.equal(A.statusGlyphPath("done"), "mods/creaseworks/art/status/done-check.svg");
  assert.equal(A.statusGlyphPath("idle"), "mods/creaseworks/art/status/rest.svg");
  assert.equal(A.statusGlyphPath("envelope"), "mods/creaseworks/art/status/envelope.svg");
  assert.equal(A.statusGlyphPath("garbage"), "mods/creaseworks/art/status/rest.svg");
  assert.equal(A.pipPath("working"), "mods/creaseworks/art/status/pip-work.svg");
  assert.equal(A.pipPath("blocked"), "mods/creaseworks/art/status/pip-needs.svg");
  assert.deepEqual(A.sheetPaths(3), { base: "mods/creaseworks/art/sheet/3-base.svg", shade: "mods/creaseworks/art/sheet/3-shade.svg" });
  assert.deepEqual(A.sheetPaths(99).base, "mods/creaseworks/art/sheet/7-base.svg");
  assert.ok(A.isSplittable("mods/creaseworks/art/folk/crane.svg"));
  assert.ok(!A.isSplittable("mods/creaseworks/art/folk/crane-a.svg"));
  assert.ok(!A.isSplittable("mods/creaseworks/art/ui/gear.svg"));
});

test("art: sprite() is svg(path) with w/h/text_color; split mode layers -a/-b/-c with mixed tints", () => {
  const s = A.sprite(A.spritePath("folk", "crane"), 28, "#b8432a").toJSON();
  assert.equal(s.kind, "svg");
  assert.deepEqual(s.args, ["mods/creaseworks/art/folk/crane.svg"]);
  assert.deepEqual(s.styles.find((x) => x[0] === "w"), ["w", 28]);
  assert.deepEqual(s.styles.find((x) => x[0] === "h"), ["h", 28]);
  assert.deepEqual(s.styles.find((x) => x[0] === "text_color"), ["text_color", "#b8432a"]);
  const r = A.sprite(A.spritePath("scene", "envelope-body"), [28, 20], "#fbf7ee").toJSON();
  assert.deepEqual([r.styles.find((x) => x[0] === "w")[1], r.styles.find((x) => x[0] === "h")[1]], [28, 20]);

  const split = A.sprite(A.spritePath("folk", "crane"), 28, "#b8432a", { facets: "split", surface: "#f6f6f6" }).toJSON();
  assert.equal(split.kind, "div");
  assert.deepEqual(split.children.map((c) => c.args[0]), A.splitPaths("mods/creaseworks/art/folk/crane.svg"));
  const tints = split.children.map((c) => c.styles.find((x) => x[0] === "text_color")[1]);
  assert.deepEqual(tints, ["#b8432a", C.mix("#b8432a", "#f6f6f6", 0.22), C.mix("#b8432a", "#f6f6f6", 0.44)]);
  // Non-faceted sprites ignore split mode.
  assert.equal(A.sprite(A.spritePath("ui", "gear"), 16, "#000000", { facets: "split" }).toJSON().kind, "svg");
});

// ---------------------------------------------------------------------------
// Widgets

const CLICK_EVENTS = ["on_click", "on_change", "on_mouse_down", "on_mouse_up"];

function check(tree, label) {
  const json = tree.toJSON ? tree.toJSON() : tree;
  walk(json, (node) => {
    const events = Object.keys(node.handlers || {});
    if (events.some((e) => CLICK_EVENTS.some((c) => e === c || e.startsWith(c + ":")))) {
      assert.ok(node.id, `${label}: a clickable ${node.kind} has no id`);
    }
    for (const s of node.styles || []) {
      if (s[0] === "text_size") assert.ok(s[1] >= 11, `${label}: text_size ${s[1]} < 11`);
      if (s[0] === "bg" || s[0] === "text_color" || s[0] === "border_color") assert.ok(C.isHex(s[1]), `${label}: ${s[0]} ${s[1]}`);
    }
  });
  return json;
}

function sampleWidgets(T, S) {
  const k = W.kit(T, S);
  const noop = () => {};
  return {
    primary: k.button("cw-buy-glue-pot", "31.2K", { variant: "primary", w: 72, onClick: noop }),
    muted: k.button("cw-buy-kite", "6.50B", { variant: "muted", w: 72, onClick: noop }),
    secondary: k.button("cw-keep", "Keep folding", { onClick: noop, tooltip: "Close" }),
    disabled: k.button("cw-wish", "Make the wish", { variant: "primary", disabled: true, onClick: noop }),
    ghost: k.button("cw-ghost", "Not now", { variant: "ghost", onClick: noop }),
    icon: k.iconButton("cw-gear", "gear", "Settings", { size: 24, onClick: noop }),
    toggleOn: k.toggle("cw-calm", true, { onChange: noop }),
    toggleOff: k.toggle("cw-auto-mail-sorter", false, { onChange: noop }),
    radios: k.radioGroup("cw-style", [{ value: "short", label: "Short" }, { value: "sci", label: "Scientific" }], "short", { onSelect: noop }),
    checkbox: k.checkbox("cw-notify-full", true, "Tray full", { onChange: noop }),
    chip: k.chip("cw-chip-abc", "Mina", { status: "blocked", onClick: noop, stop: true, pulse: true }),
    staticChip: k.chip(null, "Rush ×3", { icon: "clock" }),
    bar: k.progressBar("cw-streak", 0.4, { width: 96 }),
    countdown: k.countdownBar("cw-boost-rush", 30000, 90000),
    header: k.sectionHeader("cw-group-needs", "needs", "Needs you", 2, { onToggle: noop }),
    folded: k.sectionHeader("cw-group-resting", "resting", "Resting", 18, { folded: true, onToggle: noop }),
    badges: ["working", "blocked", "done", "idle", "envelope"].map((s) => k.glyph(s, { spin: s === "working", pulse: s === "blocked" })),
    pips: ["working", "idle", "blocked"].map((s) => k.pip(s, 6, "#b8432a", T.raised)),
    statusGlyphs: ["working", "blocked", "done", "idle"].map((s) => k.statusGlyph(s, 12, "chrome")),
    pop: k.pop("cw-pop-3", "+1.2K", 120, 80, false),
    row: k.settingRow("cw-row-calm", "Calm mode", "No motion, no pops", k.toggle("cw-calm-2", false, {})),
    text: k.text("hello", { size: 13, weight: 600 }),
    divider: k.divider(),
  };
}

test("widgets: every builder renders in all six themes; clickables have ids; text ≥ 11; colours valid", () => {
  for (const name of ALL) {
    const T = THEMES[name];
    const S = P.pickScene(isDark(name));
    for (const [label, el] of Object.entries(sampleWidgets(T, S))) {
      for (const one of Array.isArray(el) ? el : [el]) check(one, `${name}/${label}`);
    }
  }
});

test("widgets: ids are required for clickables, tooltips for icon buttons, text ≥ 11 px", () => {
  const T = THEMES.paper;
  const S = P.S_LIGHT;
  for (const bad of [undefined, null, "", 7]) {
    assert.throws(() => W.button(bad, "x", {}, T, S), TypeError);
    assert.throws(() => W.toggle(bad, true, {}, T, S), TypeError);
    assert.throws(() => W.radio(bad, true, "x", {}, T, S), TypeError);
    assert.throws(() => W.checkbox(bad, true, "x", {}, T, S), TypeError);
    assert.throws(() => W.iconButton(bad, "gear", "Settings", {}, T, S), TypeError);
    assert.throws(() => W.chip(bad, "x", { onClick() {} }, T, S), TypeError);
    assert.throws(() => W.progressBar(bad, 0.5, { width: 10 }, T, S), TypeError);
    assert.throws(() => W.sectionHeader(bad, "needs", "Needs you", 1, { onToggle() {} }, T, S), TypeError);
    assert.throws(() => W.glyph("working", { id: bad, onClick() {} }, T, S), TypeError);
    assert.throws(() => W.pop(bad, "+1", 0, 0, false, T, S), TypeError);
  }
  assert.throws(() => W.iconButton("cw-x", "gear", "", {}, T, S), TypeError);
  assert.throws(() => W.text("tiny", { size: 10 }, T, S), RangeError);
  assert.throws(() => W.progressBar("cw-p", 0.5, {}, T, S), TypeError, "width required");
  // Non-clickable chips and headers need no id.
  W.chip(null, "x", {}, T, S);
  W.sectionHeader(null, "working", "Working", 3, {}, T, S);
});

test("widgets: button variants follow §3.4 (accent / raised + muted) and disabled blocks activation", () => {
  for (const name of ALL) {
    const T = THEMES[name];
    const w = sampleWidgets(T, P.pickScene(isDark(name)));
    const style = (el, k) => el.toJSON().styles.find((s) => s[0] === k)?.[1];
    assert.equal(style(w.primary, "bg"), T.accent);
    assert.equal(style(w.primary, "text_color"), T.accent_foreground);
    assert.ok(C.contrast(T.accent_foreground, T.accent) >= 4.5, name);
    assert.equal(style(w.muted, "bg"), T.raised);
    assert.equal(style(w.muted, "text_color"), T.muted);
    assert.equal(style(w.disabled, "disabled"), true);
    assert.deepEqual(Object.keys(w.disabled.toJSON().handlers), [], "no handler on a disabled button");
    assert.equal(w.primary.toJSON().kind, "Button");
    assert.equal(w.primary.toJSON().id, "cw-buy-glue-pot");
  }
});

test("widgets: switch is Switch.new(id) with a 32×18 track and a knob that transitions left 120 ms", () => {
  const T = THEMES.graphite;
  const on = W.toggle("cw-calm", true, { onChange() {} }, T, P.S_DARK).toJSON();
  assert.equal(on.kind, "Switch");
  assert.equal(on.id, "cw-calm");
  assert.deepEqual(on.styles[0], ["checked", true]);
  assert.ok("on_change" in on.handlers);
  const row = on.children[0];
  const track = row.children[0];
  const st = (n, k) => n.styles.find((s) => s[0] === k)?.[1];
  assert.equal(st(track, "w"), 32);
  assert.equal(st(track, "h"), 18);
  assert.equal(st(track, "bg"), T.accent);
  const knob = track.children[0];
  assert.equal(knob.id, "cw-calm-knob");
  assert.equal(st(knob, "left"), 16);
  assert.equal(st(knob, "w"), 14);
  // on the accent track the knob is whichever of foreground / accent_foreground stands out more
  assert.equal(st(knob, "bg"), W.knobOn(T));
  for (const t of Object.values(THEMES)) assert.ok(C.contrast(W.knobOn(t), t.accent) >= 2.5, `knob on accent ${t.accent}`);
  assert.deepEqual(knob.transitions, [{ kind: "transition", property: "left", duration: 120, delay: 0, easing: "ease-out" }]);
  assert.equal(row.children[1].children[0].text, "On");
  const off = W.toggle("cw-calm", false, {}, T, P.S_DARK).toJSON();
  assert.equal(st(off.children[0].children[0], "bg"), T.input);
  assert.equal(st(off.children[0].children[0].children[0], "left"), 2);
  assert.equal(off.children[0].children[1].children[0].text, "Off");
});

test("widgets: radio fires onSelect only when not chosen; group ids are id-value", () => {
  const T = THEMES.paper;
  const picked = [];
  const group = W.radioGroup("cw-order", [{ value: "urgency", label: "Urgency groups" }, { value: "workspace", label: "Workspace order" }], "urgency", { onSelect: (v) => picked.push(v) }, T, P.S_LIGHT);
  const json = group.toJSON();
  assert.deepEqual(json.children.map((c) => c.id), ["cw-order-urgency", "cw-order-workspace"]);
  // Chosen one has the dot.
  assert.equal(json.children[0].children[0].children.length, 1);
  assert.equal(json.children[1].children[0].children.length, 0);
  const live = group;
  const kids = [];
  walk(live, (n) => { if (n.__r && n.__r.id && n.__r.id.startsWith("cw-order-")) kids.push(n); });
  for (const k of kids) k.__r.handlers.on_click({ click_count: 1 }, { stop_propagation() {} });
  assert.deepEqual(picked, ["workspace"]);
});

test("widgets: chip keeps a 28 px clickable target and stops propagation when asked", () => {
  const T = THEMES.graphite;
  let stopped = 0;
  let clicked = 0;
  const el = W.chip("cw-chip-x", "Mina", { status: "blocked", onClick: () => { clicked += 1; }, stop: true }, T, P.S_DARK);
  const json = el.toJSON();
  assert.equal(json.id, "cw-chip-x");
  assert.equal(json.styles.find((s) => s[0] === "h")[1], 28);
  const pill = json.children[0];
  assert.equal(pill.styles.find((s) => s[0] === "h")[1], 22);
  assert.equal(pill.styles.find((s) => s[0] === "border_color")[1], P.S_DARK.sheet);
  const glyphColor = pill.children[0].styles.find((s) => s[0] === "text_color")[1];
  assert.equal(glyphColor, C.statusColor(T, "blocked", T.popover));
  el.__r.handlers.on_click({ click_count: 1 }, { stop_propagation: () => { stopped += 1; } });
  assert.equal(clicked, 1);
  assert.equal(stopped, 1);
});

test("widgets: glyph badges use the guarded colour on T.popover; envelope marker is ink on sheet", () => {
  for (const name of ALL) {
    const T = THEMES[name];
    const S = P.pickScene(isDark(name));
    for (const status of ["working", "blocked", "done", "idle"]) {
      const b = W.glyph(status, {}, T, S).toJSON();
      assert.equal(b.styles.find((s) => s[0] === "bg")[1], T.popover);
      const c = b.children[0].styles.find((s) => s[0] === "text_color")[1];
      assert.ok(C.contrast(c, T.popover) >= 3, `${name} ${status}`);
      assert.equal(b.styles.find((s) => s[0] === "w")[1], 18);
    }
    const env = W.glyph("envelope", {}, T, S).toJSON();
    assert.equal(env.styles.find((s) => s[0] === "bg")[1], S.sheet);
    assert.equal(env.children[0].styles.find((s) => s[0] === "text_color")[1], S.ink);
  }
  const spun = W.glyph("working", { spin: true, pulse: true }, THEMES.paper, P.S_LIGHT).toJSON();
  assert.equal(spun.children[0].spin, 1200);
  assert.equal(spun.loops.length, 0, "pulse is for needs-you only");
  const pulsed = W.glyph("blocked", { pulse: true }, THEMES.paper, P.S_LIGHT).toJSON();
  assert.deepEqual(pulsed.loops, [{ property: "opacity", from: 0.55, to: 1, period: 1200, easing: "ease-in-out" }]);
  assert.equal(W.glyph("idle", { spin: true }, THEMES.paper, P.S_LIGHT).toJSON().children[0].spin, null, "only working spins");
});

test("widgets: progress bar fill transitions width on absolute px; calm snaps long transitions", () => {
  const T = THEMES.paper;
  const bar = W.progressBar("cw-rest", 0.8, { width: 40, height: 2, ms: 600, fill: T.muted }, T, P.S_LIGHT).toJSON();
  const fill = bar.children[0];
  assert.equal(fill.id, "cw-rest-fill");
  assert.equal(fill.styles.find((s) => s[0] === "w")[1], 32);
  assert.equal(fill.transitions[0].property, "width");
  assert.equal(fill.transitions[0].duration, 600);
  const calm = W.progressBar("cw-rest", 0.8, { width: 40, ms: 600, calm: true }, T, P.S_LIGHT).toJSON();
  assert.equal(calm.children[0].transitions.length, 0);
  const calmShort = W.progressBar("cw-streak", 2, { width: 96, calm: true }, T, P.S_LIGHT).toJSON();
  assert.equal(calmShort.children[0].transitions[0].duration, 150, "≤ 150 ms stays in calm mode");
  assert.equal(calmShort.children[0].styles.find((s) => s[0] === "w")[1], 96, "fraction clamped");
  const cd = W.countdownBar("cw-boost", 30000, 90000, {}, T, P.S_LIGHT).toJSON();
  assert.equal(cd.children[0].styles.find((s) => s[0] === "w")[1], 16);
  assert.deepEqual(cd.children[0].transitions[0], { kind: "transition", property: "width", duration: 1000, delay: 0, easing: "linear" });
  const native = W.countdownBar("cw-boost", 30000, 90000, { native: true }, T, P.S_LIGHT).toJSON();
  assert.equal(native.children[0].styles.find((s) => s[0] === "w")[1], 0);
  assert.equal(native.children[0].transitions[0].duration, 30000);
});

test("widgets: iconButton is a 28 px div#id carrying tooltip and handler around the svg", () => {
  const T = THEMES.ink;
  const json = W.iconButton("cw-gear", "gear", "Settings", { size: 24, onClick() {} }, T, P.S_DARK).toJSON();
  assert.equal(json.id, "cw-gear");
  assert.ok(json.styles.some((s) => s[0] === "tooltip" && s[1] === "Settings"));
  assert.ok(json.styles.some((s) => s[0] === "h" && s[1] === 28));
  assert.ok("on_click" in json.handlers);
  assert.equal(json.children[0].kind, "svg");
  assert.deepEqual(Object.keys(json.children[0].handlers), []);
});

// ---------------------------------------------------------------------------
// ViewModel fixtures (ARCHITECTURE B6)

const VM_KEYS = ["rev", "header", "sheet", "mat", "tray", "streak", "boosts", "helpers", "shop", "string", "settings", "away", "notices", "ribbon", "rail"];
const TILE_KEYS = ["helperId", "name", "species", "hue", "status", "statusWord", "envelope", "pips", "rest", "pulse", "spin", "dashed", "opacity", "tooltip", "pane", "addr", "kind"];
const MARK_KEYS = ["helperId", "status", "hue", "envelope", "dashed", "opacity", "tooltip"];
const ROW_KEYS = ["id", "name", "owned", "cost", "affordable", "best", "eta", "effect", "icon", "tier", "revealed", "sub"];
const keys = (o) => Object.keys(o).sort();
const same = (o, list, where) => assert.deepEqual(keys(o), [...list].sort(), where);
const STATUSES = ["working", "blocked", "done", "idle"];

function checkTile(t, where) {
  same(t, TILE_KEYS, where);
  assert.match(t.helperId, /^[0-9a-f]{8}$/, where);
  assert.ok(CONTENT.SPECIES.includes(t.species), where);
  assert.ok(Number.isInteger(t.hue) && t.hue >= 0 && t.hue < 8, where);
  assert.ok(STATUSES.includes(t.status), where);
  assert.match(t.name, /^[\x20-\x7e]+$/, "helper names are ASCII");
  assert.ok(t.rest === null || (t.rest >= 0 && t.rest <= 1), where);
  assert.equal(t.rest !== null, t.status === "idle", where);
  assert.equal(t.dashed, t.status === "blocked", where);
  assert.ok(Array.isArray(t.pips) && t.pips.every((p) => STATUSES.includes(p)), where);
  assert.ok(t.kind === "pane" || t.kind === "kid", where);
  for (const k of ["name", "statusWord", "tooltip", "pane", "addr"]) assert.equal(typeof t[k], "string", `${where}.${k}`);
  for (const k of ["envelope", "pulse", "spin", "dashed"]) assert.equal(typeof t[k], "boolean", `${where}.${k}`);
}

function checkMark(m, where) {
  same(m, MARK_KEYS, where);
  assert.ok(STATUSES.includes(m.status), where);
  assert.ok(m.opacity === 1 || m.opacity === 0.5, where);
}

function checkRow(r, where) {
  same(r, ROW_KEYS, where);
  assert.equal(typeof r.cost, "string", where);
  assert.ok(r.eta === null || /^in \d/.test(r.eta), `${where} eta ${r.eta}`);
  assert.equal(r.eta === null, r.affordable || r.eta === null, where);
  assert.doesNotThrow(() => A.spritePath(r.tier || CONTENT.WORKSHOPS.some((w) => w.id === r.icon) ? "workshop" : "ui", r.icon), `${where} icon ${r.icon}`);
  for (const s of r.sub) checkRow(s, `${where}.sub`);
}

function checkVm(vm, where) {
  same(vm, VM_KEYS, where);
  assert.equal(typeof vm.rev, "number");
  same(vm.header, ["folds", "rate", "wishes", "counts"], `${where}.header`);
  same(vm.header.counts, ["needs", "finished", "working", "resting"], `${where}.header.counts`);
  same(vm.sheet, ["frame", "ticks", "firstRunHint", "short"], `${where}.sheet`);
  assert.ok(vm.sheet.frame >= 0 && vm.sheet.frame <= 7 && vm.sheet.ticks >= 0 && vm.sheet.ticks <= 8);
  same(vm.mat, ["chips", "more", "shelf", "nodes", "scraps", "crane", "boat", "ream", "storm", "creaseLine"], `${where}.mat`);
  for (const c of vm.mat.chips) same(c, ["helperId", "name", "pulse"], `${where}.mat.chips`);
  assert.ok(vm.mat.chips.length <= 4);
  assert.ok(vm.mat.shelf.length <= 12 && vm.mat.shelf.every((s) => CONTENT.SPECIES.includes(s)));
  const H = vm.sheet.short ? 184 : 232;
  for (const n of vm.mat.nodes) {
    same(n, ["id", "i", "x", "y", "due", "fading"], `${where}.mat.nodes`);
    assert.ok(n.x > 0 && n.x < 304 && n.y >= 28 && n.y <= H - 32, `${where} node at ${n.x},${n.y}`);
  }
  assert.ok(vm.mat.nodes.filter((n) => n.due).length <= 2, "at most one due node per chain (two chains in a storm)");
  for (const s of vm.mat.scraps) same(s, ["id", "x", "y"], `${where}.mat.scraps`);
  if (vm.mat.crane) same(vm.mat.crane, ["id", "x", "y", "x1", "msLeft"], `${where}.mat.crane`);
  if (vm.mat.boat) same(vm.mat.boat, ["id", "x", "x1", "msLeft"], `${where}.mat.boat`);
  if (vm.mat.ream) same(vm.mat.ream, ["id", "x", "y"], `${where}.mat.ream`);
  if (vm.mat.creaseLine) assert.ok(vm.mat.creaseLine.every((p) => Array.isArray(p) && p.length === 2));
  same(vm.tray, ["envelopes", "more"], `${where}.tray`);
  assert.ok(vm.tray.envelopes.length <= 6);
  for (const e of vm.tray.envelopes) {
    same(e, ["helperId", "type", "units", "bob"], `${where}.tray.envelopes`);
    assert.ok(["bundle", "rush", "storm", "chorus"].includes(e.type));
    assert.ok(e.units > 0 && e.units <= 9);
    assert.doesNotThrow(() => A.spritePath("seal", e.type));
  }
  same(vm.streak, ["fill", "label", "inStep", "afterglow"], `${where}.streak`);
  for (const b of vm.boosts) same(b, ["type", "label", "msLeft", "msTotal"], `${where}.boosts`);
  same(vm.helpers, ["groups", "dense", "legend", "empty", "elsewhere", "album"], `${where}.helpers`);
  for (const g of vm.helpers.groups) {
    same(g, ["key", "title", "count", "folded", "tiles"], `${where}.helpers.groups`);
    assert.equal(g.count, g.tiles.length);
    g.tiles.forEach((t, i) => checkTile(t, `${where}.${g.key}[${i}]`));
  }
  vm.helpers.elsewhere.forEach((t, i) => checkTile(t, `${where}.elsewhere[${i}]`));
  for (const a of vm.helpers.album) same(a, ["helperId", "name", "species", "hue", "leftAgo", "folds"], `${where}.album`);
  same(vm.shop, ["segments"], `${where}.shop`);
  same(vm.shop.segments, ["works", "tools", "folk", "charms", "curios", "auto"], `${where}.shop.segments`);
  for (const [seg, rows] of Object.entries(vm.shop.segments)) rows.forEach((r) => checkRow(r, `${where}.shop.${seg}`));
  assert.ok(vm.shop.segments.works.filter((r) => r.best).length <= 1);
  same(vm.string, ["cranes", "of", "nextIn", "lifetime", "gain", "can", "perks", "garlands"], `${where}.string`);
  for (const p of vm.string.perks) same(p, ["at", "text", "have"], `${where}.string.perks`);
  for (const g of vm.string.garlands) {
    same(g, ["wish", "day", "stripes", "wishes"], `${where}.string.garlands`);
    assert.ok(g.stripes.length <= 20);
    for (const s of g.stripes) assert.ok(/^(hue:[0-7]|hands|workshops|rest)$/.test(s[0]) && s[1] > 0 && typeof s[2] === "string");
  }
  same(vm.settings, ["calm", "gather", "nodes", "pops", "notify", "order", "density", "style", "notifySentToday", "automations"], `${where}.settings`);
  same(vm.settings.notify, ["master", "full", "pile", "save"]);
  for (const a of vm.settings.automations) same(a, ["id", "name", "owned", "on"], `${where}.settings.automations`);
  if (vm.away) {
    same(vm.away, ["kind", "duration", "capped", "folds", "split", "envelopes", "needs", "rested", "best", "affordable", "collectable"], `${where}.away`);
    assert.ok(vm.away.kind === "away" || vm.away.kind === "busy");
  }
  for (const n of vm.notices) {
    same(n, ["kind", "text", "actions"], `${where}.notices`);
    assert.ok(F.BANNER_KINDS.includes(n.kind));
  }
  same(vm.ribbon, ["marks", "level", "tallies"], `${where}.ribbon`);
  assert.ok(["A", "B", "C"].includes(vm.ribbon.level));
  vm.ribbon.marks.forEach((m, i) => checkMark(m, `${where}.ribbon[${i}]`));
  same(vm.rail, ["pips"], `${where}.rail`);
  vm.rail.pips.forEach((m, i) => checkMark(m, `${where}.rail[${i}]`));
}

test("fixtures: VIEW_NAMES covers every DESIGN §15.3 view", () => {
  const design = readFileSync(join(root, "docs/DESIGN.md"), "utf8");
  const line = design.slice(design.indexOf("views listed in `glue/views.js`"), design.indexOf("each in **all six shipped themes**"));
  const listed = [];
  for (const m of line.matchAll(/`([a-z0-9-]+)(?:-\{([a-z0-9,]+)\})?`/g)) {
    if (m[1] === "glue") continue;
    if (m[2]) for (const s of m[2].split(",")) listed.push(`${m[1]}-${s}`);
    else listed.push(m[1]);
  }
  assert.ok(listed.length >= 45, `parsed ${listed.length} names`);
  assert.deepEqual([...listed].sort(), [...F.VIEW_NAMES].sort());
});

test("fixtures: every scenario builds a ViewModel in exactly the B6 shape", () => {
  const all = F.allScenarios();
  assert.equal(all.length, F.VIEW_NAMES.length + F.RIBBON_COUNTS.length);
  for (const s of all) {
    assert.ok(["panel", "ribbon"].includes(s.role), s.name);
    assert.ok(s.width > 0 && s.height > 0);
    same(s.ui, ["tab", "segment", "selected", "confirm", "details"], `${s.name}.ui`);
    checkVm(s.vm, s.name);
    JSON.parse(JSON.stringify(s.vm)); // plain JSON
  }
  assert.throws(() => F.scenario("nope"), /unknown view/);
});

test("fixtures: deterministic (same bytes on every call)", () => {
  for (const name of F.VIEW_NAMES) {
    assert.equal(JSON.stringify(F.scenario(name)), JSON.stringify(F.scenario(name)), name);
  }
  const v = F.viewModel("flock-64-dense");
  const ids = v.helpers.groups.flatMap((g) => g.tiles.map((t) => t.helperId));
  assert.equal(new Set(ids).size, 64, "distinct identities");
  const names = v.helpers.groups.flatMap((g) => g.tiles.map((t) => t.name));
  assert.equal(new Set(names).size, 64, "clashing names get a numeric suffix");
});

test("fixtures: views show what they are named for", () => {
  const vm = (n, o) => F.viewModel(n, o);
  const count = (v) => v.helpers.groups.reduce((a, g) => a + g.count, 0);
  assert.equal(vm("empty").helpers.empty, true);
  assert.equal(vm("empty").helpers.legend, true);
  assert.equal(vm("empty").ribbon.marks.length, 0);
  assert.equal(vm("first-run").sheet.firstRunHint, true);
  assert.equal(count(vm("standard-4")), 4);
  assert.equal(vm("needs-you-3").header.counts.needs, 3);
  assert.equal(vm("needs-you-3").mat.chips.length, 3);
  assert.equal(vm("finished-2").header.counts.finished, 2);
  assert.equal(vm("tray-full").tray.envelopes.length, 6);
  assert.ok(vm("tray-full").tray.more > 0);
  assert.equal(vm("storm").mat.storm, true);
  assert.ok(vm("storm").boosts.some((b) => b.type === "storm"));
  assert.ok(vm("crane").mat.crane);
  assert.ok(vm("boat").mat.boat);
  assert.equal(vm("chain-7").mat.nodes.length, 5, "nodes 3..7 of a 7-node chain left");
  assert.equal(vm("chain-7").mat.nodes.at(-1).i, 7);
  assert.equal(vm("in-step").streak.inStep, true);
  assert.equal(count(vm("flock-12")), 12);
  assert.equal(vm("flock-12").helpers.dense, false);
  assert.equal(count(vm("flock-34")), 34);
  assert.equal(vm("flock-34").helpers.dense, true);
  assert.equal(vm("flock-34").helpers.groups.find((g) => g.key === "resting").folded, true, "resting folds above 12");
  assert.equal(count(vm("flock-64-dense")), 64);
  assert.ok(vm("flock-elsewhere").helpers.elsewhere.length > 0);
  assert.ok(vm("album").helpers.album.length > 0);
  for (const seg of F.SHOP_SEGMENTS) assert.equal(F.scenario(`shop-${seg}`).ui.segment, seg);
  assert.equal(vm("string-locked").string.can, false);
  assert.equal(vm("string-ready").string.can, true);
  assert.equal(F.scenario("string-confirm").ui.confirm, true);
  assert.ok(vm("garlands").string.garlands.length > 0);
  assert.equal(F.scenario("settings").ui.tab, "settings");
  assert.equal(vm("away").away.kind, "away");
  assert.equal(vm("busy").away.kind, "busy");
  for (const k of F.BANNER_KINDS) assert.deepEqual(vm(`banner-${k}`).notices.map((n) => n.kind), [k]);
  assert.equal(F.scenario("rail").width, 64);
  assert.equal(vm("rail-64").rail.pips.length, 64);
  assert.equal(vm("rail-banner").notices.length, 1);
  assert.ok(F.scenario("narrow").width >= 140 && F.scenario("narrow").width < 280);
  assert.ok(F.scenario("wide").width >= 400);
  assert.equal(vm("short").sheet.short, true);
  assert.equal(vm("calm").settings.calm, true);
});

test("fixtures: ribbon density follows §3.10 (64 agents individual at both widths; tallies only above B)", () => {
  const expect = { 0: ["A", "A"], 4: ["A", "A"], 34: ["B", "A"], 64: ["B", "B"], 130: ["C", "B"] };
  for (const n of F.RIBBON_COUNTS) {
    const [at1100, at1440] = expect[n];
    const a = F.viewModel(`ribbon-${n}`, { window: 1100 }).ribbon;
    const b = F.viewModel(`ribbon-${n}`, { window: 1440 }).ribbon;
    assert.equal(a.level, at1100, `${n}@1100`);
    assert.equal(b.level, at1440, `${n}@1440`);
    for (const r of [a, b]) {
      if (r.level === "C") {
        assert.ok(r.marks.every((m) => m.status === "blocked" || m.status === "done"));
        assert.equal(r.marks.length + r.tallies.reduce((s, t) => s + t.count, 0), n);
      } else {
        assert.equal(r.marks.length, n);
        assert.deepEqual(r.tallies, []);
      }
    }
  }
  // Group order: needs, finished, working, resting.
  const order = F.viewModel("ribbon-34").ribbon.marks.map((m) => ["blocked", "done", "working", "idle"].indexOf(m.status));
  assert.deepEqual(order, [...order].sort((x, y) => x - y));
  assert.equal(F.scenario("ribbon-34", { window: 1100 }).width, 832);
  assert.equal(F.scenario("ribbon-34", { window: 1440 }).width, 1172);
});

test("fixtures: motion flags respect the loop budget (§13.5): steady and calm views have none", () => {
  for (const s of F.allScenarios()) {
    const tiles = s.vm.helpers.groups.flatMap((g) => g.tiles);
    const pulses = tiles.filter((t) => t.pulse).length + s.vm.mat.chips.filter((c) => c.pulse).length;
    const spins = tiles.filter((t) => t.spin).length;
    const bobs = s.vm.tray.envelopes.filter((e) => e.bob).length;
    assert.ok(pulses <= 6, `${s.name} pulses ${pulses}`);
    assert.ok(spins <= 6, `${s.name} spins ${spins}`);
    assert.ok(bobs <= 1, `${s.name} bobs ${bobs}`);
    assert.ok(pulses + spins + bobs <= 12, s.name);
    const base = s.name.split("@")[0];
    if (F.STEADY_VIEWS.includes(base)) assert.equal(pulses + spins + bobs, 0, `${s.name} is a steady-state view`);
    for (const t of tiles) {
      if (t.pulse) assert.equal(t.status, "blocked");
      if (t.spin) assert.equal(t.status, "working");
    }
  }
  assert.ok(F.viewModel("in-step").helpers.groups.flatMap((g) => g.tiles).filter((t) => t.spin).length > 0);
  assert.ok(F.viewModel("needs-you-3").helpers.groups.flatMap((g) => g.tiles).filter((t) => t.pulse).length === 3);
});

test("fixtures: header counts match the roster; groups in fixed order; join order inside a group", () => {
  for (const s of F.allScenarios()) {
    const v = s.vm;
    const by = Object.fromEntries(v.helpers.groups.map((g) => [g.key, g.count]));
    for (const k of ["needs", "finished", "working", "resting"]) assert.equal(v.header.counts[k], by[k] ?? 0, `${s.name} ${k}`);
    const keysSeen = v.helpers.groups.map((g) => g.key);
    assert.deepEqual(keysSeen, ["needs", "finished", "working", "resting"].filter((k) => keysSeen.includes(k)));
    for (const g of v.helpers.groups) {
      const panes = g.tiles.map((t) => Number(t.pane.slice(2)));
      assert.deepEqual(panes, [...panes].sort((a, b) => a - b), `${s.name} ${g.key} join order`);
    }
    assert.equal(v.helpers.dense, v.helpers.groups.reduce((a, g) => a + g.count, 0) >= 21 || s.name === "narrow", s.name);
  }
});

// ---------------------------------------------------------------------------
// QuickJS-ng (herdr's runtime): the ui modules load and render in the sandbox

const FROZEN_REALM = Object.isFrozen(Object.prototype);

test("qjs: palette/color/art/widgets load under frozen prototypes and render every widget", {
  skip: FROZEN_REALM && "quickjs-emscripten does not load with frozen prototypes",
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), "cw-ui-"));
  try {
    mkdirSync(join(dir, "ui"));
    for (const f of ["palette.js", "color.js", "art.js", "widgets.js"]) {
      copyFileSync(join(root, "mods/creaseworks/ui", f), join(dir, "ui", f));
    }
    const T = JSON.stringify(THEMES.win98);
    writeFileSync(join(dir, "main.js"), [
      'import { View } from "gpui-kit";',
      'import { v_flex } from "gpui-base";',
      'import { pickScene, pickHues } from "./ui/palette.js";',
      'import { statusColor } from "./ui/color.js";',
      'import { speciesSprite } from "./ui/art.js";',
      'import { kit } from "./ui/widgets.js";',
      `const T = ${T};`,
      "export default class M extends View {",
      "  render() {",
      "    const k = kit(T, pickScene(false));",
      "    const noop = () => {};",
      '    return v_flex().id("m")',
      '      .child(k.button("b", "Buy", { variant: "primary", onClick: noop }))',
      '      .child(k.toggle("s", true, { onChange: noop }))',
      '      .child(k.radioGroup("r", [{ value: "a", label: "A" }, { value: "b", label: "B" }], "a", { onSelect: noop }))',
      '      .child(k.checkbox("c", false, "C", { onChange: noop }))',
      '      .child(k.chip("ch", "Mina", { status: "blocked", onClick: noop }))',
      '      .child(k.progressBar("p", 0.5, { width: 96 }))',
      '      .child(k.iconButton("i", "gear", "Settings", { onClick: noop }))',
      '      .child(k.sectionHeader("h", "needs", "Needs you", 2, { onToggle: noop }))',
      '      .child(k.glyph("working", { spin: true }))',
      '      .child(k.glyph("envelope"))',
      '      .child(speciesSprite("koi", 28, pickHues(false)[3]))',
      '      .child(k.text(statusColor(T, "working", "popover")));',
      "  }",
      "}",
      "",
    ].join("\n"));
    const host = await createHost({ modRoot: dir, scenario: {} });
    try {
      await host.load();
      const { tree } = host.render();
      assert.equal(tree.id, "m");
      const ids = [];
      walk(tree, (n) => { if (n.id) ids.push(n.id); });
      for (const id of ["b", "s", "s-knob", "r-a", "r-b", "c", "ch", "p", "p-fill", "i", "h"]) assert.ok(ids.includes(id), id);
      // win98 working on popover (2.31:1) falls back to muted inside the VM too.
      let last = null;
      walk(tree, (n) => { if (n.kind === "div" && n.children?.[0]?.kind === "text") last = n.children[0].text; });
      assert.equal(last, THEMES.win98.muted);
      assert.deepEqual(host.errors, []);
    } finally {
      host.dispose();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

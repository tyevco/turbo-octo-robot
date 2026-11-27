// The Pattern book's UI (DESIGN §4.7; ARCHITECTURE B17 "UI", "Tests"): the
// crease field on the mat (nine 28 px dots on the Sheet, one press is one
// action at either Sheet size and zoom, every dot state its own shape on a
// paper disc), the trace and result lines, the result chip and the
// first-field hint, the fold piece and its shelf icon, the boost bar's hint
// and the Steady / Wind-up chips, the Book tab (its row fits at 226 and 200
// px with a three-digit Flock count; Book as its icon in Narrow; the accent
// dot; Settings' back), the Book tab's cards in 2 / 3 / 4 columns, grapheme
// clipping with the emoji corpus, and the loop budget (0 in steady state and
// in calm, with a field and a fold piece up).
//
//   node --import ./tools/node/register.mjs --test test/ui/book.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { installMockWindow, walk, fire, findById } from "../../tools/mock/gpui-kit.js";
import * as F from "../fixtures/vm-fixtures.mjs";
import { graphemes, CONTENT } from "../../mods/creaseworks/engine/index.js";
import { pickScene, pickHues, S_LIGHT, S_DARK } from "../../mods/creaseworks/ui/palette.js";
import { contrast } from "../../mods/creaseworks/ui/color.js";
import { renderPanel, TAB_ROW, bookOpen } from "../../mods/creaseworks/ui/panel.js";
import { renderMat, matGeometry, fieldBoxes, fieldChipBox, resultChipBox, clearOf, dotCentre, DOT_LOOK, FIELD, MAT_CLIP, MAT_BANDS } from "../../mods/creaseworks/ui/mat.js";
import { renderBook, BOOK_CLIP, BOOK_HELP, CARD, PIPS_W, bookColumns, cardWidth, cardLines, cardHeight, drawSize } from "../../mods/creaseworks/ui/book.js";
import { foldPaths, spritePath } from "../../mods/creaseworks/ui/art.js";
import { CORPUS, hasLoneSurrogate } from "../text/corpus.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const THEMES = JSON.parse(readFileSync(join(root, "tools/mock/themes.json"), "utf8"));
const THEME_NAMES = ["graphite", "paper"];
const isDark = (name) => name !== "paper" && name !== "win98";

installMockWindow();

function makeCtx(themeName, s, over = {}) {
  const dark = isDark(themeName);
  const calls = [];
  const handlers = {};
  for (const n of ["click", "open", "openHelper", "tab", "fold", "setting"]) handlers[n] = (...args) => calls.push([n, ...args.slice(0, -1)]);
  return {
    T: THEMES[themeName], S: pickScene(dark), hues: pickHues(dark), dark, zoom: 1, calm: false,
    width: s.width, height: s.height, panelShown: true, handlers, calls, ...over,
  };
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const style = (node, name) => (node.styles || []).find((s) => s[0] === name);
const styleVal = (node, name) => style(node, name)?.[1];
const fakeCx = () => {
  const cx = { stopped: 0, stop_propagation() { cx.stopped++; }, notify() {} };
  return cx;
};

function texts(json) {
  const out = [];
  const visit = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.kind === "text") out.push(n.text);
    for (const c of n.children || []) visit(c);
  };
  visit(json);
  return out;
}

function countLoops(json) {
  let n = 0;
  walk(json, (node) => {
    n += (node.loops ? node.loops.length : 0) + (node.spin ? 1 : 0) + (node.frames ? 1 : 0);
  });
  return n;
}

function transitions(json) {
  const out = [];
  walk(json, (node) => {
    for (const t of node.transitions || []) out.push({ id: node.id, ...t });
  });
  return out;
}

/** A vm for a Sheet of either size: the "field" fixture at 226 (short, 96 px) or moved to 320 (112 px). */
function fieldScenario(width) {
  const s = F.scenario("field");
  if (width === 226) return s;
  const out = clone(s);
  out.width = width;
  out.height = 784;
  out.vm.sheet.short = false;
  return out;
}

// ---------------------------------------------------------------------------
// The field on the mat

test("the field: nine 28 px dots on the Sheet at sheet · (2c + 1) / 6, none overlapping, ids cw-dot-<field>-<i>", () => {
  for (const width of [226, 320, 440]) {
    const s = fieldScenario(width);
    const ctx = makeCtx("graphite", s);
    const g = matGeometry(s.vm, ctx);
    assert.equal(g.sheet, width === 226 ? 96 : 112);
    const boxes = fieldBoxes(s.vm.sheet.field, g);
    assert.equal(boxes.length, 9);
    const want = g.sheet === 96 ? [16, 48, 80] : [18.7, 56, 93.3];
    assert.deepEqual([0, 1, 2].map((c) => dotCentre(g.sheet, c)), want);
    for (const b of boxes) {
      assert.equal(b.w, FIELD.hit);
      assert.equal(b.h, FIELD.hit);
      assert.ok(b.x >= g.sx && b.x + b.w <= g.sx + g.sheet + 1e-9 && b.y >= g.sy && b.y + b.h <= g.sy + g.sheet + 1e-9, `${width}: ${JSON.stringify(b)} on the Sheet`);
    }
    for (let a = 0; a < 9; a++) {
      for (let b = a + 1; b < 9; b++) {
        const A = boxes[a];
        const B = boxes[b];
        const apart = A.x + A.w <= B.x || B.x + B.w <= A.x || A.y + A.h <= B.y || B.y + B.h <= A.y;
        assert.ok(apart, `${width}: dots ${a} and ${b} overlap`);
      }
    }
    const json = renderMat(s.vm, null, ctx).toJSON();
    for (const b of boxes) {
      const el = findById(json, `cw-dot-${b.id}`);
      assert.ok(el, b.id);
      assert.equal(styleVal(el, "left"), b.x);
      assert.equal(styleVal(el, "top"), b.y);
      assert.equal(styleVal(el, "w"), 28);
      assert.equal(styleVal(el, "h"), 28);
      assert.ok("on_mouse_down:left" in el.handlers, "the Sheet's own press");
    }
  }
});

/**
 * The press model gpui uses for mouse-down listeners: every element whose
 * box holds the point, topmost (last painted) first, until one stops
 * propagation. The mat's pieces are its absolute children.
 */
function press(live, json, x, y, zoom) {
  const kids = json.children || [];
  const hits = [];
  for (const k of kids) {
    if (!k.id || !k.handlers || !("on_mouse_down:left" in k.handlers)) continue;
    const l = styleVal(k, "left");
    const t = styleVal(k, "top");
    const w = styleVal(k, "w");
    const h = styleVal(k, "h");
    if (x >= l && x < l + w && y >= t && y < t + h) hits.push({ id: k.id, l, t });
  }
  const cx = fakeCx();
  let fired = 0;
  for (const hit of hits.reverse()) {
    fire(live, hit.id, "on_mouse_down:left", { local_position: { x: (x - hit.l) * zoom, y: (y - hit.t) * zoom } }, cx);
    fired++;
    if (cx.stopped) break;
  }
  return fired;
}

test("one press is one action: each dot centre is a dot click (and only that), each gap between dots a Sheet click (96 and 112 px Sheets, zoom 1 and 1.5)", () => {
  for (const width of [226, 320]) {
    for (const zoom of [1, 1.5]) {
      const s = fieldScenario(width);
      const ctx = makeCtx("paper", s, { zoom });
      const g = matGeometry(s.vm, ctx);
      const live = renderMat(s.vm, null, ctx);
      const json = live.toJSON();
      const boxes = fieldBoxes(s.vm.sheet.field, g);
      for (const b of boxes) {
        ctx.calls.length = 0;
        const x = b.x + b.w / 2;
        const y = b.y + b.h / 2;
        press(live, json, x, y, zoom);
        assert.equal(ctx.calls.length, 1, `${width}@${zoom} dot ${b.id}: one action`);
        const [name, target, id, pos] = ctx.calls[0];
        assert.deepEqual([name, target, id], ["click", "dot", b.id]);
        assert.ok(Math.abs(pos.x - x) < 0.11 && Math.abs(pos.y - y) < 0.11, `${width}@${zoom}: the press point in mat px ${JSON.stringify(pos)}`);
      }
      // the gaps: between two dots across and down, and the Sheet's corners
      const c = [0, 1, 2].map((k) => dotCentre(g.sheet, k));
      const mid = (a, b) => (a + b) / 2;
      const gaps = [
        [g.sx + mid(c[0], c[1]), g.sy + c[0]], [g.sx + mid(c[1], c[2]), g.sy + c[2]],
        [g.sx + c[1], g.sy + mid(c[0], c[1])], [g.sx + c[2], g.sy + mid(c[1], c[2])],
        [g.sx + 1, g.sy + 1], [g.sx + g.sheet - 1, g.sy + g.sheet - 1],
      ];
      for (const [x, y] of gaps) {
        ctx.calls.length = 0;
        press(live, json, x, y, zoom);
        assert.equal(ctx.calls.length, 1, `${width}@${zoom} gap at ${x},${y}: one action`);
        assert.deepEqual(ctx.calls[0].slice(0, 3), ["click", "sheet", null], `${width}@${zoom} gap at ${x},${y}: a Sheet fold`);
      }
    }
  }
});

test("dot states are told apart by shape on a paper disc; the paper reads on the mat in both scene halves", () => {
  const sizes = Object.entries(DOT_LOOK).map(([k, v]) => [k, v.ring, v.dot ?? 0, v.edge]);
  // ring sizes and fills differ for every pair of states (shape, not colour)
  for (let a = 0; a < sizes.length; a++) {
    for (let b = a + 1; b < sizes.length; b++) {
      assert.notDeepEqual(sizes[a].slice(1), sizes[b].slice(1), `${sizes[a][0]} vs ${sizes[b][0]}`);
    }
  }
  assert.equal(DOT_LOOK.free.ring, 12);
  assert.equal(DOT_LOOK.centre.ring, 8);
  assert.equal(DOT_LOOK.next.ring, 20);
  assert.equal(DOT_LOOK.used.dot, 10);
  for (const S of [S_LIGHT, S_DARK]) {
    assert.ok(contrast(S.sheet, S.mat) >= 3, "paper disc on the mat");
    assert.ok(contrast(S.ink, S.sheet) >= 4.5, "ink on the paper disc");
    assert.ok(contrast(S.ink, S.sheetShade) >= 4.5, "ink on the shade facets");
    assert.ok(contrast(S.node, S.mat) >= 3, "the last dot's node ring on the mat");
    assert.ok(contrast(S.goldInk, S.node) >= 4.5, "a mastered line on its node edge");
  }
  const s = F.scenario("field");
  for (const th of THEME_NAMES) {
    const ctx = makeCtx(th, s);
    const json = renderMat(s.vm, null, ctx).toJSON();
    for (const d of s.vm.sheet.field.dots) {
      const el = findById(json, `cw-dot-${s.vm.sheet.field.id}-${d.i}`);
      const mark = el.children[0];
      const look = DOT_LOOK[d.state];
      assert.equal(styleVal(mark, "w"), look.ring, `${d.state} ring`);
      assert.equal(styleVal(mark, "bg"), look.node ? ctx.S.ink : ctx.S.sheet, `${d.state}: on paper`);
      if (d.tip) assert.equal(styleVal(el, "tooltip"), d.tip);
    }
  }
});

test("the trace line and the result line: an edge under the line, each style; the fade only when not calm", () => {
  const base = F.scenario("field");
  const g = matGeometry(base.vm, makeCtx("paper", base));
  for (const [style, edge] of [["found", true], ["learned", true], ["mastered", true], ["loose", true]]) {
    const s = clone(base);
    s.vm.sheet.field = null;
    s.vm.sheet.fieldResult = { line: [[0, 0], [1, 0], [1, 1], [0, 1]], closed: true, style, text: "Napkin" };
    const ctx = makeCtx("paper", s);
    const json = renderMat(s.vm, null, ctx).toJSON();
    const line = findById(json, "cw-field-line");
    assert.ok(line, style);
    assert.equal(Boolean(findById(json, "cw-field-edge")), edge, `${style}: edge`);
    assert.equal(styleVal(line, "left"), g.sx);
    assert.equal(styleVal(line, "w"), g.sheet);
    const chip = findById(json, "cw-field-chip");
    assert.ok(chip && texts(chip).includes("Napkin"), `${style}: the chip names it`);
    // the edge is never dashed (a continuous ground); only the ink is, while found or loose
    const dashed = (el) => el.args[0].commands.some((c) => c[0] === "dash_array");
    assert.equal(dashed(findById(json, "cw-field-edge")), false, `${style}: a solid edge`);
    assert.equal(dashed(line), style === "found" || style === "loose", `${style}: the ink's dash`);
  }
  // the live trace is drawn; the dots fade only when not calm
  for (const calm of [false, true]) {
    const s = clone(base);
    s.vm.sheet.field.fading = true;
    const json = renderMat(s.vm, null, makeCtx("graphite", s, { calm })).toJSON();
    assert.ok(findById(json, "cw-field-line"));
    const dot = findById(json, `cw-dot-${s.vm.sheet.field.id}-0`);
    assert.equal(styleVal(dot, "opacity"), 0.4);
    const ts = transitions(json).filter((t) => t.id && t.id.startsWith("cw-dot-"));
    if (calm) assert.equal(ts.length, 0, "calm: a static 0.4");
    else assert.ok(ts.length === 9 && ts.every((t) => t.duration === 2000));
  }
});

test("the result chip sits over the Sheet's top edge, clear of the top band and the top row's rings; the first-field hint wraps and shows only before a result", () => {
  for (const width of [226, 320, 440]) {
    const s = fieldScenario(width);
    const g = matGeometry(s.vm, makeCtx("paper", s));
    for (const text of ["Loose crease", "Switchback · mastered", "Loose · Switchback needs 4 more"]) {
      const b = fieldChipBox(text, g);
      assert.equal(b.lines, 1, `${width} "${text}": one line`);
      assert.ok(b.y >= 28, `${width}: below the top band`);
      // the top row's largest ring (20 px, the next step) starts sheet/6 − 10 into the Sheet
      assert.ok(b.y + b.h <= g.sy + g.sheet / 6 - DOT_LOOK.next.ring / 2 + 0.5, `${width}: clear of the top row (${b.y + b.h} vs ${g.sy})`);
      assert.ok(b.x >= 4 && b.x + b.w <= g.w - 4);
    }
    const hint = fieldChipBox(s.vm.sheet.field.hint, g, true);
    assert.ok(hint.lines >= 2 && hint.y >= MAT_BANDS.top && hint.x >= 4 && hint.x + hint.w <= g.w - 4, `${width}: ${JSON.stringify(hint)}`);
    // the short mat has no room for two lines under the top band: the one-line form, still under it
    assert.equal(hint.over, g.short, `${width}: over the top band only on the short mat`);
    if (g.short) {
      const one = fieldChipBox(s.vm.sheet.field.hintShort, g, false);
      assert.ok(one.lines === 1 && one.y >= MAT_BANDS.top && one.w <= g.w - 8, `${width}: ${JSON.stringify(one)}`);
    }
  }
  // At 1100 × 700 with agents needing you: the hint never covers the top band's chips
  const s = F.scenario("field");
  assert.ok(s.vm.mat.chips.length >= 2, "needs-you chips in the top band");
  const json = renderMat(s.vm, null, makeCtx("paper", s)).toJSON();
  const hint = findById(json, "cw-field-hint");
  assert.ok(hint && texts(hint).join("") === s.vm.sheet.field.hintShort, "the one-line form on the short mat");
  assert.ok(styleVal(hint, "top") >= MAT_BANDS.top, "under the top band");
  assert.equal(json.children.at(-1).id, "cw-field-hint", "painted last");
  // the wrapped hint where there is room (Standard)
  const std = fieldScenario(320);
  const sj = renderMat(std.vm, null, makeCtx("paper", std)).toJSON();
  assert.equal(texts(findById(sj, "cw-field-hint")).join(""), std.vm.sheet.field.hint);
  // a result showing: the result chip (under the pieces), no hint
  const r = clone(s);
  r.vm.sheet.fieldResult = { line: [[0, 0], [1, 0]], closed: false, style: "loose", text: "Loose crease" };
  const rj = renderMat(r.vm, null, makeCtx("paper", r)).toJSON();
  assert.ok(findById(rj, "cw-field-chip") && !findById(rj, "cw-field-hint"));
  const order = rj.children.map((c) => c.id);
  assert.ok(order.indexOf("cw-field-chip") < order.indexOf("cw-mat-top"), "under the bands and pieces");
});

test("the fold piece: a 28 px div#cw-fold-<id> with the diagram's two layers, its click stops propagation; shelf p: entries draw the fold's base", () => {
  const s = F.scenario("fold");
  for (const th of THEME_NAMES) {
    const ctx = makeCtx(th, s);
    const live = renderMat(s.vm, null, ctx);
    const json = live.toJSON();
    const el = findById(json, "cw-fold-f4");
    assert.ok(el);
    assert.equal(styleVal(el, "w"), 28);
    assert.equal(styleVal(el, "tooltip"), s.vm.mat.fold.tooltip);
    const svgs = [];
    walk(el, (n) => n.kind === "svg" && svgs.push(n));
    const { base, shade } = foldPaths("gull");
    assert.deepEqual(svgs.map((n) => n.args[0]), [base, shade]);
    assert.deepEqual(svgs.map((n) => styleVal(n, "text_color")), [ctx.S.sheet, ctx.S.sheetShade]);
    const cx = fakeCx();
    fire(live, "cw-fold-f4", "on_click", {}, cx);
    assert.equal(cx.stopped, 1);
    assert.deepEqual(ctx.calls[0].slice(0, 3), ["click", "fold", "f4"]);
    const shelf = findById(json, "cw-mat-top");
    const paths = [];
    walk(shelf, (n) => n.kind === "svg" && paths.push(n.args[0]));
    assert.ok(paths.includes(foldPaths("ridge").base), "p:ridge on the shelf");
  }
  // a fading fold piece: 0.4, its 2 s transition only when not calm; an unknown diagram draws nothing
  for (const calm of [false, true]) {
    const f = clone(s);
    f.vm.mat.fold.fading = true;
    const json = renderMat(f.vm, null, makeCtx("paper", f, { calm })).toJSON();
    const el = findById(json, "cw-fold-f4");
    assert.equal(styleVal(el, "opacity"), 0.4);
    assert.equal((el.transitions || []).length, calm ? 0 : 1);
  }
  // never over the result chip: a piece landing on it is pushed off by the shortest move (off the Sheet too)
  for (const width of [226, 320]) {
    const f = clone(s);
    if (width === 320) { f.width = 320; f.height = 784; f.vm.sheet.short = false; }
    const g = matGeometry(f.vm, makeCtx("paper", f));
    const chipB = resultChipBox(f.vm, g);
    assert.ok(chipB, "a result chip shows");
    // put the piece's centre right on the chip's right end
    for (const [cx0, cy0] of [[chipB.x + chipB.w - 4, chipB.y + chipB.h / 2], [chipB.x + 6, chipB.y + 2]]) {
      const [bx, by] = clearOf(g, cx0 - 14, cy0 - 14, 28, 28, chipB);
      const over = (r) => Math.min(bx + 28, r.x + r.w) - Math.max(bx, r.x) > 0 && Math.min(by + 28, r.y + r.h) - Math.max(by, r.y) > 0;
      assert.ok(!over(chipB), `${width}: off the chip`);
      assert.ok(!over({ x: g.sx, y: g.sy, w: g.sheet, h: g.sheet }), `${width}: off the Sheet`);
      assert.ok(bx >= 0 && bx + 28 <= g.w && by >= 0 && by + 28 <= g.h, `${width}: on the mat`);
    }
  }
  // as drawn: the fold view's piece (slot 21, by the Sheet's top-left) is clear of its chip
  {
    const g = matGeometry(s.vm, makeCtx("paper", s));
    const chipB = resultChipBox(s.vm, g);
    const el = findById(renderMat(s.vm, null, makeCtx("paper", s)).toJSON(), "cw-fold-f4");
    const bx = styleVal(el, "left");
    const by = styleVal(el, "top");
    assert.ok(!(Math.min(bx + 28, chipB.x + chipB.w) - Math.max(bx, chipB.x) > 0 && Math.min(by + 28, chipB.y + chipB.h) - Math.max(by, chipB.y) > 0), "drawn clear of the chip");
  }
  const u = clone(s);
  u.vm.mat.fold.kind = "origami-x";
  u.vm.mat.shelf = ["p:origami-x", "fox"];
  const json = renderMat(u.vm, null, makeCtx("paper", u)).toJSON();
  assert.equal(findById(json, "cw-fold-f4"), null);
});

test("every fold piece's art: both layers exist, base and shade read on the mat in both scene halves (shapes and shade-on-base: test/art/silhouette.test.mjs)", async () => {
  const { buildAssets } = await import("../../tools/art/generate.mjs");
  const assets = new Map(buildAssets().map((a) => [a.path, a]));
  for (const p of CONTENT.PATTERNS) {
    const { base, shade } = foldPaths(p.id);
    for (const path of [base, shade]) assert.ok(assets.has(path.replace("mods/creaseworks/art/", "")), path);
    assert.throws(() => foldPaths(`${p.id}x`), TypeError);
  }
  for (const S of [S_LIGHT, S_DARK]) {
    assert.ok(contrast(S.sheet, S.mat) >= 3, "base on the mat");
    assert.ok(contrast(S.sheetShade, S.mat) >= 3, "shade on the mat");
  }
});

// ---------------------------------------------------------------------------
// The boost bar

test("the boost bar: the field's words when no chip shows; Ridge's charge is a static chip, Coil's ×2 counts down; both named after their diagram", () => {
  const s = F.scenario("field");
  const json = renderPanel(s.vm, s.ui, makeCtx("paper", s)).toJSON();
  const hint = findById(json, "cw-boostbar-hint");
  assert.deepEqual(texts(hint), ["Crease field · next to find: Ridge"]);
  const f = F.scenario("fold");
  f.vm.boosts.push({ type: "coil", label: "Coil ×2", msLeft: 6000, msTotal: 10000 });
  for (const calm of [false, true]) {
    const j = renderPanel(f.vm, f.ui, makeCtx("graphite", f, { calm })).toJSON();
    const steady = findById(j, "cw-boostbar-steady");
    assert.ok(steady && texts(steady).includes("Ridge · steady"));
    assert.equal(findById(j, "cw-boostbar-steady-bar"), null, "no countdown");
    assert.equal(styleVal(steady, "tooltip"), "Ridge: your next pause of up to 4 s keeps your rhythm");
    const coil = findById(j, "cw-boostbar-coil");
    assert.ok(texts(coil).includes("Coil ×2"));
    assert.equal(styleVal(coil, "tooltip"), "Coil: hand hits ×2 · 6 s left");
    assert.ok(findById(coil, "cw-boostbar-coil-bar"));
    const icons = [];
    walk(steady, (n) => n.kind === "svg" && icons.push(n.args[0]));
    walk(coil, (n) => n.kind === "svg" && icons.push(n.args[0]));
    assert.deepEqual(icons, [foldPaths("ridge").base, foldPaths("coil").base]);
  }
});

// ---------------------------------------------------------------------------
// The tab row

function withCount(s, total) {
  const out = clone(s);
  out.vm.header.counts = { needs: Math.floor(total / 4), finished: Math.floor(total / 4), working: Math.floor(total / 4), resting: total - 3 * Math.floor(total / 4) };
  out.vm.header.kidsWaiting = 0;
  return out;
}

const tabIds = (json) => (findById(json, "cw-tabs").children || []).map((c) => c.id);

test("the Book tab: shown once the book is open, after String; Narrow (< 280) pads every tab 6 and draws Book as its icon; below 220 the Flock tab drops its count", () => {
  const closed = F.scenario("standard-4");
  assert.equal(bookOpen(closed.vm), false);
  assert.deepEqual(tabIds(renderPanel(closed.vm, closed.ui, makeCtx("paper", closed)).toJSON()), ["cw-tab-flock", "cw-tab-shop", "cw-tab-string"]);
  for (const width of [320, 279, 226, 219, 200]) {
    const s = withCount(F.scenario("fold"), 128);
    s.width = width;
    const json = renderPanel(s.vm, s.ui, makeCtx("paper", s)).toJSON();
    assert.deepEqual(tabIds(json), ["cw-tab-flock", "cw-tab-shop", "cw-tab-string", "cw-tab-book"], `${width}`);
    const book = findById(json, "cw-tab-book");
    const flock = findById(json, "cw-tab-flock");
    const narrow = width < 280;
    for (const id of ["cw-tab-flock", "cw-tab-shop", "cw-tab-string", "cw-tab-book"]) {
      assert.equal(styleVal(findById(json, id), "px"), narrow ? TAB_ROW.tightPad : TAB_ROW.pad, `${width} ${id}`);
    }
    const svgs = [];
    walk(book, (n) => n.kind === "svg" && svgs.push(n.args[0]));
    assert.deepEqual(svgs, narrow ? [spritePath("ui", "book")] : [], `${width}: Book as its icon`);
    assert.deepEqual(texts(book), narrow ? [] : ["Book"]);
    assert.deepEqual(texts(flock), [width < TAB_ROW.countBelow ? "Flock" : "Flock 128"], `${width}`);
    // the accent dot: new marks, not on the Book tab
    assert.ok(findById(book, "cw-tab-book-dot"));
    assert.equal(styleVal(book, "tooltip"), "Pattern book · new");
  }
  const seen = F.scenario("book");
  const json = renderPanel(seen.vm, seen.ui, makeCtx("graphite", seen)).toJSON();
  assert.equal(findById(json, "cw-tab-book-dot"), null);
  assert.equal(styleVal(findById(json, "cw-tab-book"), "tooltip"), "Pattern book");
  assert.ok(style(findById(json, "cw-tab-book"), "border_b"), "selected");
  assert.equal(findById(json, "cw-content").children[0].id, "cw-book");
  // a stale Book tab with the book closed shows the Flock
  const stale = clone(seen);
  stale.vm.book.open = false;
  const sj = renderPanel(stale.vm, stale.ui, makeCtx("graphite", stale)).toJSON();
  assert.equal(findById(sj, "cw-tab-book"), null);
  assert.equal(findById(sj, "cw-book"), null);
  // Settings' back returns to the Book
  const set = clone(seen);
  set.ui = { ...set.ui, tab: "settings", back: "book" };
  const ctx = makeCtx("graphite", set);
  const live = renderPanel(set.vm, set.ui, ctx);
  fire(live, "cw-tab-back", "on_click", {}, fakeCx());
  assert.deepEqual(ctx.calls.at(-1), ["tab", "book"]);
});

let playwright = null;
try {
  const { loadPlaywright } = await import("../../tools/art/sheet.mjs");
  playwright = loadPlaywright();
} catch {
  playwright = null;
}

test("the tab row fits at 226 and 200 px with a three-digit Flock count (measured in Chromium)", { skip: !playwright && "playwright is not installed" }, async () => {
  const { renderDocument } = await import("../../tools/render/html.mjs");
  const browser = await playwright.chromium.launch();
  const dir = mkdtempSync(join(tmpdir(), "cw-book-tabs-"));
  try {
    for (const width of [226, 200]) {
      for (const tab of ["flock", "book"]) {
        const s = withCount(F.scenario("fold"), 999);
        s.width = width;
        s.ui = { ...s.ui, tab };
        const ctx = makeCtx("paper", s);
        const tree = renderPanel(s.vm, s.ui, ctx);
        const file = join(dir, `${width}-${tab}.html`);
        writeFileSync(file, renderDocument(tree, { width, height: 584, background: ctx.T.background, theme: ctx.T, assetRoot: root }));
        const page = await browser.newPage({ viewport: { width, height: 584 } });
        try {
          await page.goto(pathToFileURL(file).href);
          const m = await page.evaluate(() => {
            const row = document.querySelector('[data-id="cw-tabs"]').getBoundingClientRect();
            const tabs = [...document.querySelectorAll('[data-id^="cw-tab-"]')].filter((e) => !/-dot$/.test(e.dataset.id)).map((e) => ({ id: e.dataset.id, ...e.getBoundingClientRect().toJSON() }));
            return { row: row.toJSON(), tabs };
          });
          assert.equal(m.tabs.length, 4, `${width} ${tab}`);
          const last = m.tabs.at(-1);
          assert.ok(last.right <= m.row.right - 4 + 0.5, `${width} ${tab}: the Book tab ends at ${last.right.toFixed(1)} of ${m.row.right}`);
          const used = last.right - m.row.left;
          console.log(`# tab row at ${width} px (${tab}): ${used.toFixed(1)} px used`);
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The Book tab

test("Book cards: at every panel width 280-460 the column beside the drawing holds the pips; the drawing gives way, the card height never does", () => {
  const s = F.scenario("book");
  for (let width = 280; width <= 460; width++) {
    const w = cardWidth(width);
    const draw = drawSize(w);
    const side = w - 2 * CARD.pad - draw - 4;
    assert.ok(side >= PIPS_W, `${width}: side ${side} < ${PIPS_W}`);
    assert.ok(side >= CARD.tile, `${width}: the fold tile fits`);
    assert.ok(draw <= CARD.draw && draw >= 36, `${width}: drawing ${draw}`);
    if (w - 2 * CARD.pad - 4 - CARD.draw >= PIPS_W) assert.equal(draw, CARD.draw, `${width}: full size where it fits`);
  }
  for (const width of [280, 320, 331, 400, 439, 440]) {
    const json = renderBook(s.vm, s.ui, makeCtx("paper", { ...s, width })).toJSON();
    for (const c of s.vm.book.cards) {
      const el = findById(json, `cw-book-${c.id}`);
      assert.equal(styleVal(findById(el, `cw-book-${c.id}-draw`), "w"), drawSize(cardWidth(width)));
      assert.equal(styleVal(findById(el, `cw-book-${c.id}-side`), "min_w"), PIPS_W);
      assert.ok(styleVal(el, "h") >= cardHeight(cardLines(c, width < 280)), `${width} ${c.id}: as tall as at full size`);
      // under 96 px a found card shows the short label, never a three-line effect cut short
      if (c.state === "found") {
        const t = texts(el);
        if (cardWidth(width) < 96) assert.ok(t.includes(c.short) && !t.includes(c.effect), `${width} ${c.id}: the short label`);
        else assert.ok(t.includes(c.effect), `${width} ${c.id}: the effect`);
      }
    }
  }
});

test("Book cards: the pips, the fold tile and the count never cross the drawing's right edge, 280-460 px (measured in Chromium)", { skip: !playwright && "playwright is not installed" }, async () => {
  const { renderDocument } = await import("../../tools/render/html.mjs");
  const browser = await playwright.chromium.launch();
  const dir = mkdtempSync(join(tmpdir(), "cw-book-side-"));
  try {
    const page = await browser.newPage({ viewport: { width: 460, height: 900 } });
    for (let width = 280; width <= 460; width += 3) {
      const s = F.scenario("book");
      const ctx = makeCtx("paper", { ...s, width });
      const tree = renderBook(s.vm, s.ui, ctx);
      const file = join(dir, `${width}.html`);
      writeFileSync(file, renderDocument(tree, { width, height: 900, background: ctx.T.background, theme: ctx.T, assetRoot: root }));
      await page.setViewportSize({ width, height: 900 });
      await page.goto(pathToFileURL(file).href);
      const bad = await page.evaluate(() => {
        const out = [];
        for (const d of document.querySelectorAll('[data-id$="-draw"]')) {
          const id = d.dataset.id.replace(/-draw$/, "");
          const right = d.getBoundingClientRect().right;
          const side = document.querySelector(`[data-id="${id}-side"]`);
          if (!side) continue;
          // the card's content box ends 6 px (its padding) inside its right edge
          const edge = document.querySelector(`[data-id="${id}"]`).getBoundingClientRect().right - 6;
          for (const k of side.querySelectorAll("*")) {
            const r = k.getBoundingClientRect();
            if (r.width > 0 && r.left < right - 0.5) out.push(`${id}: ${k.tagName} at ${r.left.toFixed(1)} < ${right.toFixed(1)}`);
            if (r.width > 0 && r.right > edge + 0.5) out.push(`${id}: ${k.tagName} ends at ${r.right.toFixed(1)} > ${edge.toFixed(1)} (clipped)`);
          }
        }
        return out;
      });
      assert.deepEqual(bad, [], `${width} px`);
    }
    await page.close();
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the Book tab renders in both themes: header, line, help until 3 are found (then the info tooltip), nine cards in 2 / 3 / 4 columns", () => {
  for (const name of ["book", "book-narrow"]) {
    for (const th of THEME_NAMES) {
      const s = F.scenario(name);
      for (const width of [s.width, 320, 440]) {
        const ctx = makeCtx(th, { ...s, width });
        const json = renderBook(s.vm, s.ui, ctx).toJSON();
        assert.equal(json.id, "cw-book");
        assert.ok(style(json, "w_full") && !style(json, "h"), "full width, content height");
        const cards = s.vm.book.cards.map((c) => findById(json, `cw-book-${c.id}`));
        assert.ok(cards.every(Boolean), `${name} ${width}: nine cards`);
        const cols = bookColumns(width);
        assert.equal(cols, width < 280 ? 2 : width >= 400 ? 4 : 3);
        const w = cardWidth(width);
        assert.ok(cols * w + (cols - 1) * CARD.gap <= width - 16, `${width}: ${cols} × ${w} fit`);
        for (const c of cards) assert.equal(styleVal(c, "w"), w);
        const rows = findById(json, "cw-book-cards").children;
        assert.equal(rows.length, Math.ceil(9 / cols));
        for (const row of rows) {
          const hs = row.children.map((c) => styleVal(c, "h"));
          assert.ok(hs.every((h) => h === hs[0]), "a row's cards are as tall as each other");
        }
        const all = texts(json);
        const help = s.vm.book.help;
        if (help) {
          assert.ok(all.includes(help));
          assert.equal(findById(json, "cw-book-info"), null);
        } else {
          assert.equal(styleVal(findById(json, "cw-book-info"), "tooltip"), BOOK_HELP);
        }
        assert.ok(all.includes("Pattern book"));
        assert.ok(all.includes(width < 280 ? `${s.vm.book.found} / 9` : s.vm.book.count));
        assert.equal(countLoops(json), 0);
        assert.equal(transitions(json).length, 0, "nothing moves in the book");
      }
    }
  }
});

test("Book cards: found cards name the diagram, status and effect (the short label at Narrow); next shows its shape at 0.6 and hint; hidden show ???, dots and hint", () => {
  const s = F.scenario("book");
  for (const narrow of [false, true]) {
    const width = narrow ? 226 : 320;
    const ctx = makeCtx("paper", { ...s, width });
    const json = renderBook(s.vm, s.ui, ctx).toJSON();
    for (const c of s.vm.book.cards) {
      const el = findById(json, `cw-book-${c.id}`);
      const t = texts(el);
      const draw = findById(el, `cw-book-${c.id}-draw`);
      assert.ok(draw && styleVal(draw, "w") === drawSize(cardWidth(width)) && styleVal(draw, "bg") === ctx.S.sheet, `${c.id}: the paper square`);
      const paths = [];
      walk(draw, (n) => n.kind === "path" && paths.push(n));
      if (c.state === "found") {
        assert.ok(t.includes(c.name) && t.includes(c.status) && t.includes(c.count), `${c.id}: ${t}`);
        assert.ok(t.includes(narrow ? c.short : c.effect), `${c.id} ${narrow}`);
        assert.ok(findById(el, `cw-book-${c.id}-fold`), "the fold on its mat tile");
        const pips = [];
        walk(el, (n) => n.kind === "svg" && /pip-/.test(n.args[0]) && pips.push(n.args[0].includes("pip-work")));
        assert.deepEqual(pips, c.pips);
        assert.equal(paths.length, 2, "dots and line: two paint_paths");
      } else if (c.state === "next") {
        assert.ok(t.includes(c.name) && t.includes(c.sub) && t.includes(c.short) && t.includes(c.hint), `${c.id}: ${t}`);
        // the clue is set apart from the short effect above it (italic), never one run-on sentence
        const clueEl = findById(el, `cw-book-${c.id}-clue`);
        let italic = false;
        walk(clueEl, (n) => { if ((n.styles || []).some((x) => x[0] === "italic")) italic = true; });
        assert.ok(clueEl && italic, `${c.id}: an italic clue`);
        assert.equal(styleVal(draw, "opacity"), 0.6);
        assert.equal(paths.length, 2);
      } else {
        assert.ok(t.includes("???") && t.includes(c.sub) && t.includes(c.hint), `${c.id}: ${t}`);
        assert.equal(paths.length, 1, "the nine dots only");
      }
      assert.ok(styleVal(el, "h") >= cardHeight(cardLines(c, narrow)));
    }
  }
});

test("Book cards are drawn from PATTERNS.dots: the stroke follows the diagram, closed shapes closed, the start ringed", () => {
  const s = F.scenario("book");
  const json = renderBook(s.vm, s.ui, makeCtx("graphite", s)).toJSON();
  const pct = (c) => `${Math.round(((2 * c + 1) / 6) * 1000) / 10}%`;
  for (const p of CONTENT.PATTERNS) {
    const card = s.vm.book.cards.find((c) => c.id === p.id);
    if (card.state === "hidden") continue;
    const draw = findById(json, `cw-book-${p.id}-draw`);
    const paths = [];
    walk(draw, (n) => n.kind === "path" && paths.push(n));
    const stroke = paths.find((n) => n.args[0].fill === false);
    assert.ok(stroke, `${p.id}: a stroke path`);
    const cmds = stroke.args[0].commands.filter((c) => c[0] === "move_to" || c[0] === "line_to");
    const line = cmds.slice(0, p.n + (p.closed ? 1 : 0));
    assert.deepEqual(line.map((c) => [c[1], c[2]]), [...p.dots, ...(p.closed ? [p.dots[0]] : [])].map(([c, r]) => [pct(c), pct(r)]), p.id);
  }
});

test("every book and field string goes through clip(): inflated strings with the emoji corpus never break a grapheme or pass their limits", () => {
  const corpus = CORPUS.map((e) => e[1]).filter((t) => typeof t === "string" && t);
  const long = (k) => corpus[k % corpus.length].repeat(30);
  const s = F.scenario("book");
  const v = clone(s.vm);
  v.book.line = long(1);
  v.book.count = long(2);
  v.book.help = long(3);
  v.book.cards.forEach((c, k) => {
    for (const key of ["name", "sub", "status", "effect", "short", "hint", "tooltip", "fold", "count"]) if (c[key] !== null) c[key] = long(k + key.length);
  });
  const book = renderBook(v, s.ui, makeCtx("paper", s)).toJSON();
  const f = F.scenario("field");
  const fv = clone(f.vm);
  fv.sheet.field.hint = long(4);
  fv.sheet.field.barHint = long(5);
  fv.sheet.field.dots.forEach((d, k) => {
    if (d.tip) d.tip = long(k);
  });
  const mat = renderPanel(fv, f.ui, makeCtx("paper", f)).toJSON();
  const r = clone(f.vm);
  r.sheet.fieldResult = { line: [[0, 0], [1, 0]], closed: false, style: "loose", text: long(6) };
  const res = renderMat(r, null, makeCtx("paper", f)).toJSON();
  const max = Math.max(...Object.values(BOOK_CLIP), MAT_CLIP.fieldHint, 160);
  for (const json of [book, mat, res]) {
    for (const t of texts(json)) {
      assert.ok(!hasLoneSurrogate(t), `a cut surrogate: ${JSON.stringify(t.slice(-4))}`);
      assert.ok(graphemes(t).length <= max, `${graphemes(t).length} graphemes`);
    }
    walk(json, (n) => {
      const tip = styleVal(n, "tooltip");
      if (typeof tip === "string") assert.ok(!hasLoneSurrogate(tip) && graphemes(tip).length <= 160, `tooltip ${graphemes(tip).length}`);
    });
  }
  assert.ok(graphemes(texts(res).find((t) => t.length > 10)).length <= MAT_CLIP.fieldChip);
});

// ---------------------------------------------------------------------------
// The loop budget (DESIGN §13.5): fields, fold pieces and the book add none

test("loop budget: 0 loops with a field, a result and a fold piece up, in steady state and in calm; calm has no transition over 150 ms", () => {
  for (const name of F.BOOK_VIEWS) {
    for (const calm of [false, true]) {
      const s = F.scenario(name);
      const v = clone(s.vm);
      if (name === "field") v.sheet.fieldResult = null;
      v.mat.fold = v.mat.fold || { id: "f9", kind: "hem", x: 40, y: 60, tooltip: "Hem fold", fading: false };
      v.sheet.field = v.sheet.field || F.viewModel("field").sheet.field;
      v.sheet.field.fading = true;
      v.mat.fold.fading = true;
      if (calm) v.settings.calm = true;
      for (const th of THEME_NAMES) {
        const json = renderPanel(v, s.ui, makeCtx(th, s, { calm })).toJSON();
        assert.equal(countLoops(json), 0, `${name} calm=${calm} ${th}`);
        if (calm) {
          const long = transitions(json).filter((t) => t.duration > 150);
          assert.deepEqual(long, [], `${name}: calm`);
        }
      }
    }
  }
});

test("every BOOK_VIEWS fixture renders the whole panel in both themes (ids unique, clickables with ids)", () => {
  for (const name of F.BOOK_VIEWS) {
    for (const th of THEME_NAMES) {
      const s = F.scenario(name);
      const json = renderPanel(s.vm, s.ui, makeCtx(th, s)).toJSON();
      const seen = new Set();
      walk(json, (n) => {
        if (!n.id) return;
        assert.ok(!seen.has(n.id), `${name}: duplicate id ${n.id}`);
        seen.add(n.id);
      });
      walk(json, (n) => {
        const hs = Object.keys(n.handlers || {});
        if (hs.some((h) => /^on_(click|mouse_down)/.test(h))) assert.ok(n.id, `${name}: a clickable without an id`);
      });
    }
  }
});

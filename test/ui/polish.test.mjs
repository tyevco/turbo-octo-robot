// Round-2 polish fixes on the mat, the Shop and the String (ARCHITECTURE B11),
// each with the defect it guards against:
//   r2-22  the first gilded crane's hint chip never covers the Sheet
//   r2-24  shop names/effects and perks are not cut to one line with the
//          condition lost: effects and perks wrap, and a row whose text was
//          shortened or wrapped carries the whole of it in a tooltip
// (r2-23, the garlands and banner-fresh shot states, is in test/glue/views.test.mjs.)
//
//   node --import ./tools/node/register.mjs --test test/ui/polish.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { installMockWindow, findById } from "../../tools/mock/gpui-kit.js";
import { engine, seeded, T0 } from "../engine/_util.mjs";
import { graphemes } from "../../mods/creaseworks/engine/index.js";
import { FREE_SLOTS, PERKS, AUTOMATIONS } from "../../mods/creaseworks/engine/content.js";
import { pickScene, pickHues } from "../../mods/creaseworks/ui/palette.js";
import { renderMat, matGeometry, craneHintBox } from "../../mods/creaseworks/ui/mat.js";
import { renderShop, rowText, rowTextWidth, SHOP_CLIP } from "../../mods/creaseworks/ui/shop.js";
import { renderString } from "../../mods/creaseworks/ui/string.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const THEMES = JSON.parse(readFileSync(join(root, "tools/mock/themes.json"), "utf8"));

installMockWindow();

function makeCtx(over = {}) {
  const handlers = new Proxy({}, { get: () => () => undefined });
  return { T: THEMES.graphite, S: pickScene(true), hues: pickHues(true), dark: true, zoom: 1, calm: false, width: 320, height: 784, handlers, ...over };
}

const style = (node, name) => (node.styles || []).find((s) => s[0] === name);
const styleVal = (node, name) => style(node, name)?.[1];

function texts(json) {
  const out = [];
  const visit = (n) => {
    if (n && n.kind === "text") out.push(n.text);
    for (const k of (n && n.children) || []) if (k && typeof k === "object") visit(k);
  };
  visit(json);
  return out;
}

/** The nearest element (not a text node) that holds `want` as a text child. */
function holderOf(json, want) {
  let found = null;
  const visit = (n) => {
    if (found || !n || typeof n !== "object") return;
    if ((n.children || []).some((c) => c && c.kind === "text" && c.text === want)) found = n;
    for (const c of n.children || []) visit(c);
  };
  visit(json);
  return found;
}

const overlap = (a, b) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

// ---------------------------------------------------------------------------
// r2-22

test("r2-22: the first crane's hint chip stays off the Sheet and the crane, inside the play field, wherever the crane is", () => {
  let margin = 0;
  for (const width of [240, 320, 420]) {
    for (const slot of FREE_SLOTS) {
      for (const age of [0, 4000, 9000, 12500]) {
        for (const calm of [false, true]) {
          const s = seeded(11);
          s.ui.hints.fold = true;
          s.stats.hits = 10;
          s.settings.calm = calm;
          s.spawn.crane = { id: "gX", slot, born: s.spawn.shownMs - age, outcome: "lucky" };
          const vm = engine.view(s, T0, { role: "panel", width });
          if (!vm.mat.crane) continue;
          const ctx = makeCtx({ width, calm });
          const json = renderMat(vm, { tab: "flock" }, ctx).toJSON();
          const chip = findById(json, "cw-crane-hint");
          const at = `width ${width}, slot ${slot}, age ${age}${calm ? ", calm" : ""}`;
          assert.ok(chip, `${at}: the chip is drawn`);
          assert.ok(texts(chip).includes("A gilded crane! Click it before it flies off."), `${at}: whole line, not cut`);
          const box = { x: styleVal(chip, "left"), y: styleVal(chip, "top"), w: styleVal(chip, "w"), h: styleVal(chip, "h") };
          const crane = findById(json, "cw-crane");
          const cbox = { x: styleVal(crane, "left"), y: styleVal(crane, "top"), w: 48, h: 36 };
          const g = matGeometry(vm, ctx);
          const sheet = { x: g.sx, y: g.sy, w: g.sheet, h: g.sheet };
          assert.ok(box.y >= 28 && box.y + box.h <= g.h - 32 && box.x >= 0 && box.x + box.w <= g.w, `${at}: inside the field ${JSON.stringify(box)}`);
          assert.equal(overlap(box, cbox), 0, `${at}: not over the crane ${JSON.stringify(box)} ${JSON.stringify(cbox)}`);
          if (width >= 280) {
            assert.equal(overlap(box, sheet), 0, `${at}: not over the Sheet ${JSON.stringify(box)} ${JSON.stringify(sheet)}`);
            if (box.w < 176) margin++;
          } else {
            // 56 px margins and 14 px strips hold no chip: at most an edge of the Sheet, never its middle.
            const rows = Math.min(box.y + box.h, sheet.y + sheet.h) - Math.max(box.y, sheet.y);
            assert.ok(rows <= sheet.h / 4, `${at}: only the Sheet's edge (${rows} px) ${JSON.stringify(box)}`);
          }
          // Its height is what the text needs: 14 px lines of a two-line-or-more wrap.
          const b = craneHintBox(vm.mat.crane, g);
          assert.deepEqual([b.x, b.y, b.w, b.h], [box.x, box.y, box.w, box.h]);
          assert.ok(b.lines >= 2 && b.h === b.lines * 14 + 6, `${at}: ${b.lines} lines in ${b.h}`);
          assert.equal(styleVal(chip.children[0], "line_height"), "127%");
          // Clicks still reach the mat and the crane.
          assert.deepEqual(Object.keys(chip.handlers || {}), [], `${at}: it takes no clicks`);
        }
      }
    }
  }
  assert.ok(margin > 0, "at 320 the chip moves into a side margin");
});

test("r2-22: the chip only glides with the crane when it sits over or under it", () => {
  const s = seeded(11);
  s.ui.hints.fold = true;
  s.stats.hits = 10;
  s.spawn.crane = { id: "gX", slot: 1, born: s.spawn.shownMs - 3000, outcome: "lucky" };
  const motion = (width) => {
    const vm = engine.view(s, T0, { role: "panel", width });
    const g = matGeometry(vm, { width });
    const chip = findById(renderMat(vm, { tab: "flock" }, makeCtx({ width })).toJSON(), "cw-crane-hint");
    return { follow: craneHintBox(vm.mat.crane, g).follow, transitions: (chip.styles || []).filter((x) => x[0] === "transition").length };
  };
  const narrow = motion(320);
  assert.equal(narrow.follow, false, "at 320 it waits in a margin");
  assert.equal(narrow.transitions, 0, "a margin chip never slides across the Sheet");
});

// ---------------------------------------------------------------------------
// r2-24

/** A real late game: every automation and upgrade revealed. */
function richVm(width = 320) {
  const s = seeded(3);
  s.ui.hints.fold = true;
  s.stats.hits = 10;
  s.bank = 1e13;
  s.runFolds = 1e13;
  s.lifetime = 1e13;
  return engine.view(s, T0, { role: "panel", width });
}

test("r2-24: Thrifty Fox keeps 'at 4× its cost' on screen: the effect wraps, never a one-line truncate", () => {
  const fox = AUTOMATIONS.find((a) => a.name === "Thrifty Fox");
  assert.ok(fox && /at 4× its cost$/.test(fox.text));
  for (const width of [320, 420]) {
    const vm = richVm(width);
    const json = renderShop(vm, { tab: "shop", segment: "auto" }, makeCtx({ width })).toJSON();
    const row = findById(json, `cw-shop-row-${fox.id}`);
    assert.ok(row, "the row is drawn");
    assert.ok(texts(row).includes(fox.text), `${width}: the whole effect is drawn: ${texts(row).join(" | ")}`);
    const effect = holderOf(row, fox.text);
    assert.equal(style(effect, "truncate"), undefined, "the effect is not truncated to one line");
    assert.ok(style(effect, "whitespace_normal"), "it wraps");
    assert.equal(styleVal(effect, "max_h"), 28, "to two 14 px lines, inside the 52 px row");
    const col = findById(row, `cw-shop-text-${fox.id}`);
    assert.equal(styleVal(col, "tooltip"), `Thrifty Fox: ${fox.text}`, "the whole text is a hover away");
  }
});

test("r2-24: every shop row's text is either drawn whole or carried whole in its tooltip (240, 320, 420)", () => {
  for (const width of [240, 320, 420]) {
    const vm = richVm(width);
    for (const seg of ["works", "tools", "folk", "charms", "curios", "auto"]) {
      const rows = [...vm.shop.segments[seg]];
      for (const r of vm.shop.segments[seg]) for (const sub of r.sub || []) rows.push({ ...sub, _sub: true });
      const json = renderShop(vm, { tab: "shop", segment: seg, folded: {} }, makeCtx({ width })).toJSON();
      for (const r of rows) {
        const el = findById(json, `cw-shop-row-${r.id}`);
        if (!el) continue; // silhouettes and folded owned rows
        const col = findById(el, `cw-shop-text-${r.id}`);
        assert.ok(col, `${seg} ${r.id}: its text column`);
        const shown = texts(col);
        const whole = shown.includes(String(r.name)) && (!r.effect || shown.includes(String(r.effect)));
        const tip = styleVal(col, "tooltip");
        if (!whole) {
          assert.ok(tip, `${width} ${seg} ${r.id}: shortened (${shown.join(" | ")}) and no tooltip`);
          assert.ok(tip.includes(String(r.name)) && (!r.effect || tip.includes(String(r.effect))), `${width} ${seg} ${r.id}: the tooltip has it all: ${tip}`);
        }
        if (tip) assert.ok(graphemes(tip).length <= SHOP_CLIP.tooltip);
        // gpui's own truncate (which cuts inside emoji) never has work to do on the effect.
        for (const t of shown) {
          const h = holderOf(col, t);
          if (t !== shown[0]) assert.equal(style(h, "truncate"), undefined, `${seg} ${r.id}: "${t}" truncates`);
        }
      }
    }
  }
});

test("r2-24: tier sub-rows keep 'Bone Folder: Neat Edges' whole at 320", () => {
  const fit = rowText("Bone Folder: Neat Edges", "×2 Bone Folder output", rowTextWidth(320, true), true);
  assert.equal(fit.name, "Bone Folder: Neat Edges");
  const long = rowText("Flower Press: Master's Touch", "", rowTextWidth(240, true), true);
  assert.notEqual(long.name, "Flower Press: Master's Touch", "cut at 240 by estimate");
  assert.equal(long.tip, "Flower Press: Master's Touch", "and whole in the tooltip");
});

test("r2-24: perks wrap instead of losing their ends (§3.5 lists them in full)", () => {
  const s = seeded(4);
  s.ui.hints.fold = true;
  const vm = engine.view(s, T0, { role: "panel", width: 320 });
  const json = renderString(vm, { tab: "string" }, makeCtx()).toJSON();
  const box = findById(json, "cw-string-perks");
  assert.ok(box, "the perks list is drawn");
  const shown = texts(box);
  for (const p of PERKS) {
    assert.ok(shown.includes(p.text), `perk drawn whole: ${p.text}`);
    const el = holderOf(box, p.text);
    assert.equal(style(el, "truncate"), undefined, `not truncated: ${p.text}`);
    assert.ok(style(el, "whitespace_normal"), `wraps: ${p.text}`);
  }
  assert.ok(shown.includes("Keep Crisp Corners and Mail Sorter between runs"));
  assert.ok(shown.includes("Start each run with 10 Paper Stacks and 5 Bone Folders"));
});

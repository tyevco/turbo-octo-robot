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
import { slotPos } from "../../mods/creaseworks/engine/view.js";
import { renderMat, matGeometry, craneHintBox, boatBox, confettiFlecks, MAT_BANDS } from "../../mods/creaseworks/ui/mat.js";
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
          s.spawn.crane = { id: "gX", slot, born: s.spawn.shownMs - age, outcome: "gift" };
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
  s.spawn.crane = { id: "gX", slot: 1, born: s.spawn.shownMs - 3000, outcome: "gift" };
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
  assert.ok(shown.includes("Keep a tenth of your three cheapest workshops between runs"));
});

// ---------------------------------------------------------------------------
// r5-12, r5-13, r5-14, r5-15

test("r5-15: the tray draws the vm's stack count (fractional units), not a floored one; none below 2", async () => {
  const s = seeded(11);
  const ids = ["aaaa0001", "aaaa0002", "aaaa0003", "aaaa0004", "aaaa0005"];
  const units = [1.5, 1.97, 2, 2.75, 8.98];
  ids.forEach((id, i) => { s.envelopes[id] = { type: i % 2 ? "rush" : "bundle", units: units[i], landedAt: T0 - 60000 + i, lastAt: T0 - 60000 + i }; });
  const vm = engine.view(s, T0, { role: "panel", width: 420 });
  const json = renderMat(vm, { tab: "flock" }, makeCtx({ width: 420 })).toJSON();
  const shown = ids.map((id) => texts(findById(json, `cw-env-${id}-art`)));
  assert.deepEqual(shown, [[], [], ["×2"], ["×2.8"], ["×9"]]);
  assert.deepEqual(vm.tray.envelopes.map((e) => e.label), [null, null, "×2", "×2.8", "×9"]);
  // a longer count sits under a smaller seal, inside the 28 px envelope, at 11 px
  const art = findById(json, `cw-env-${ids[3]}-art`);
  const holder = holderOf(art, "×2.8");
  assert.equal(styleVal(holder, "w"), 28);
  assert.equal(styleVal(holder, "text_size"), 11);
  assert.equal(styleVal(holderOf(findById(json, `cw-env-${ids[2]}-art`), "×2"), "text_size"), 11);
  // a vm without labels (older fixtures) still counts from units, unfloored
  const { stackLabel } = await import("../../mods/creaseworks/ui/mat.js");
  assert.equal(stackLabel({ units: 2.5 }), "×2.5");
  assert.equal(stackLabel({ units: 12.4 }), "×12");
  assert.equal(stackLabel({ units: 1.99 }), null);
});

test("r5-14: banked afterglow shows as a static footer chip and in the streak tooltip; In step replaces it", async () => {
  const { renderPanel } = await import("../../mods/creaseworks/ui/panel.js");
  const s = seeded(11);
  s.hand.afterglowMs = 12 * 60000;
  for (const calm of [false, true]) {
    s.settings.calm = calm;
    const vm = engine.view(s, T0, { role: "panel", width: 320 });
    const json = renderPanel(vm, { tab: "flock" }, makeCtx({ calm })).toJSON();
    const chip = findById(json, "cw-foot-glow");
    assert.ok(chip, `calm ${calm}`);
    assert.deepEqual(texts(chip), ["Afterglow ×1.25 · 12m"]);
    assert.ok(!(chip.styles || []).some((st) => st[0] === "loop" || st[0] === "transition"), "static");
    assert.match(styleVal(findById(json, "cw-streak"), "tooltip"), / · Afterglow ×1\.25 · 12m$/);
  }
  s.settings.calm = false;
  s.hand.r = 40;
  s.hand.lastHitAt = T0 - 100;
  const vm = engine.view(s, T0, { role: "panel", width: 320 });
  assert.equal(vm.streak.inStep, true);
  const json = renderPanel(vm, { tab: "flock" }, makeCtx()).toJSON();
  assert.equal(findById(json, "cw-foot-glow"), null);
  assert.ok(findById(json, "cw-foot-instep"));
  s.hand.afterglowMs = 0;
  s.hand.r = 0;
  assert.equal(findById(renderPanel(engine.view(s, T0, { role: "panel", width: 320 }), { tab: "flock" }, makeCtx()).toJSON(), "cw-foot-glow"), null);
});

test("r5-12: a gate inside the String is marked in the gap before its strand; a full-String gate draws no mark", () => {
  const s = seeded(11);
  s.wishes = 10;
  s.wishCount = 1;
  s.lifetime = engine.lifetimeFor(1300);
  const vm = engine.view(s, T0, { role: "panel", width: 320, tab: "string" });
  const json = renderString(vm, { tab: "string" }, makeCtx()).toJSON();
  const gate = findById(json, "cw-string-gate");
  assert.ok(gate);
  assert.equal(styleVal(gate, "tooltip"), "The wish opens at 500 cranes");
  // 304 px card, 20 × 12 px strands, gap 3: the row starts at 3.5; gap before strand 10 is centred at 3.5 + 150 − 1.5
  const line = gate.children.find((c) => c && typeof c === "object" && c.kind !== "text");
  close1(styleVal(gate, "left") + styleVal(line, "left") + styleVal(line, "w") / 2, 3.5 + 10 * 15 - 1.5);
  assert.ok(texts(json).includes("At 500: +5 Wishes · at 1,000: +10"));
  const btn = findById(json, "cw-string-wish");
  assert.equal(styleVal(btn, "tooltip"), "Reach 500 cranes to make the wish");
  s.wishes = 0;
  s.wishCount = 0;
  s.lifetime = engine.lifetimeFor(800);
  assert.equal(findById(renderString(engine.view(s, T0, { role: "panel", width: 320, tab: "string" }), { tab: "string" }, makeCtx()).toJSON(), "cw-string-gate"), null);
});

test("r5-13: the confirm card says an uncollected away pot is collected first", () => {
  const s = seeded(11);
  s.lifetime = engine.lifetimeFor(1000);
  s.away.pot = { folds: 28036.8, seconds: 28800, liveMs: 0, needs: [], rested: 0, tasks0: [] };
  const vm = engine.view(s, T0, { role: "panel", width: 320, tab: "string" });
  const json = renderString(vm, { tab: "string", confirm: "wish", armedAt: 0, now: 2000 }, makeCtx()).toJSON();
  const card = findById(json, "cw-string-confirm");
  assert.ok(texts(card).some((x) => /^First collects your \+28\.0K folds from while you were away\.$/.test(x)), texts(card).join(" | "));
  s.away.pot = null;
  const none = renderString(engine.view(s, T0, { role: "panel", width: 320, tab: "string" }), { tab: "string", confirm: "wish", armedAt: 0, now: 2000 }, makeCtx()).toJSON();
  assert.ok(!texts(findById(none, "cw-string-confirm")).some((x) => /while you were away/.test(x)));
});

// ---------------------------------------------------------------------------
// r6-06

test("r6-06: the Paper Boat glides in its own lane above the bottom band (under it only in the short mat's dip, with the band on top), never on the Sheet", () => {
  let dips = 0;
  for (const width of [240, 320, 420]) {
    for (const calm of [false, true]) {
      for (const age of [0, 2500, 5000, 7500, 10000, 12500, 15000, 19500]) {
        const s = seeded(11);
        s.ui.hints.fold = true;
        s.stats.hits = 10;
        s.settings.calm = calm;
        for (let i = 0; i < 10; i++) {
          s.envelopes[`bbbb000${i}`] = { type: ["bundle", "rush", "storm", "chorus"][i % 4], units: 1 + (i % 3), landedAt: T0 - 60000 + i, lastAt: T0 - 60000 + i };
        }
        s.spawn.boat = { id: "b7", born: s.spawn.shownMs - age };
        const vm = engine.view(s, T0, { role: "panel", width });
        if (!vm.mat.boat) continue;
        const ctx = makeCtx({ width, calm });
        const json = renderMat(vm, { tab: "flock" }, ctx).toJSON();
        const at = `width ${width}, age ${age}${calm ? ", calm" : ""}`;
        const el = findById(json, "cw-boat");
        assert.ok(el, `${at}: the boat is drawn`);
        const box = { x: styleVal(el, "left"), y: styleVal(el, "top"), w: styleVal(el, "w"), h: styleVal(el, "h") };
        const g = matGeometry(vm, ctx);
        assert.deepEqual(boatBox(vm.mat.boat, g), [box.x, box.y]);
        const sheet = { x: g.sx, y: g.sy, w: g.sheet, h: g.sheet };
        const band = { x: 0, y: g.h - 32, w: g.w, h: 32 };
        assert.equal(overlap(box, sheet), 0, `${at}: not on the Sheet ${JSON.stringify(box)}`);
        assert.ok(box.x >= 0 && box.x + box.w <= g.w && box.y >= 28 && box.y + box.h <= g.h, `${at}: inside the mat ${JSON.stringify(box)}`);
        const crossing = box.x < g.sx + g.sheet && box.x + box.w > g.sx;
        if (!crossing || !g.short) {
          assert.equal(overlap(box, band), 0, `${at}: above the tray and the streak meter ${JSON.stringify(box)}`);
          assert.equal(box.y + box.h, g.h - 32, `${at}: on the band's top edge`);
        } else {
          dips++;
        }
        // painted after the Sheet and under the band: the envelopes and the label stay whole
        const order = json.children.map((c) => c && c.id);
        assert.ok(order.indexOf("cw-boat") > order.indexOf("cw-sheet"), `${at}: the boat paints over the mat`);
        assert.ok(order.indexOf("cw-boat") < order.indexOf("cw-mat-bottom"), `${at}: the band paints over the boat`);
        assert.ok(findById(json, "cw-tray").children.length >= 2, `${at}: the tray is full`);
        if (calm) assert.equal(box.x, g.w - 48 - 8, `${at}: calm parks it at the lane's far end`);
      }
    }
  }
  assert.ok(dips > 0, "on the short mat it dips below the Sheet while crossing its columns");
});

test("r6-06: the boat's lane is the bottom slot row, so every play piece there paints over the boat and keeps its clicks", () => {
  for (const width of [240, 320, 420]) {
    for (const calm of [false, true]) {
      for (const age of [0, 6000, 12000, 19000]) {
        const s = seeded(11);
        s.ui.hints.fold = true;
        s.stats.hits = 10;
        s.settings.calm = calm;
        s.spawn.boat = { id: "b7", born: s.spawn.shownMs - age };
        const vm = engine.view(s, T0, { role: "panel", width });
        const short = Boolean(vm.sheet && vm.sheet.short);
        // a scrap in every bottom-row slot, a node and the ream there too
        vm.mat.scraps = [40, 41, 42, 43, 44, 45, 46, 47, 48].map((sl) => ({ id: `s${sl}`, ...slotPos(sl, short) }));
        vm.mat.nodes = [{ id: "n49", i: 1, due: true, ...slotPos(49, short) }];
        const ctx = makeCtx({ width, calm });
        const json = renderMat(vm, { tab: "flock" }, ctx).toJSON();
        const at = `width ${width}, age ${age}${calm ? ", calm" : ""}`;
        const order = json.children.map((c) => c && c.id);
        const boatAt = order.indexOf("cw-boat");
        assert.ok(boatAt > 0, `${at}: the boat is drawn`);
        const boat = json.children[boatAt];
        const bb = { x: styleVal(boat, "left"), y: styleVal(boat, "top"), w: styleVal(boat, "w"), h: styleVal(boat, "h") };
        let under = 0;
        json.children.forEach((c, i) => {
          if (!c || !/^cw-(scrap|node)-/.test(c.id || "")) return;
          const r = { x: styleVal(c, "left"), y: styleVal(c, "top"), w: styleVal(c, "w"), h: styleVal(c, "h") };
          if (overlap(r, bb) > 0) under++;
          assert.ok(i > boatAt, `${at}: ${c.id} paints over the boat`);
        });
        assert.ok(under > 0, `${at}: the lane does cross the bottom slot row`);
        // the boat is still caught around them: some of its box is not under a piece
        const free = [];
        for (let x = bb.x + 1; x < bb.x + bb.w; x += 2) {
          for (let y = bb.y + 1; y < bb.y + bb.h; y += 2) {
            const hit = json.children.some((c, i) => i > boatAt && c && /^cw-(scrap|node)-/.test(c.id || "") &&
              x >= styleVal(c, "left") && x < styleVal(c, "left") + styleVal(c, "w") && y >= styleVal(c, "top") && y < styleVal(c, "top") + styleVal(c, "h"));
            if (!hit) free.push([x, y]);
          }
        }
        assert.ok(free.length > 0, `${at}: part of the boat is clear of every piece`);
      }
    }
  }
});

test("r6-06: on the short mat the gliding boat's eased box never touches the Sheet, and its dip eases with it", () => {
  for (const width of [240, 260]) {
    const s = seeded(11);
    s.ui.hints.fold = true;
    s.stats.hits = 10;
    const boxes = [];
    for (let age = 0; age <= 20000; age += 1000) {
      s.spawn.boat = { id: "b7", born: s.spawn.shownMs - age };
      const vm = engine.view(s, T0, { role: "panel", width });
      if (!vm.mat.boat) continue;
      const moving = vm.mat.boat.x !== vm.mat.boat.x1;
      const ctx = makeCtx({ width });
      const g = matGeometry(vm, ctx);
      assert.ok(g.short, `width ${width}: the short mat`);
      const el = findById(renderMat(vm, { tab: "flock" }, ctx).toJSON(), "cw-boat");
      const props = (el.transitions || []).filter((t) => t.kind === "transition" && t.duration === 1000 && t.easing === "linear").map((t) => t.property);
      if (moving) assert.ok(props.includes("left") && props.includes("top"), `width ${width}, age ${age}: left and top ease over the tick`);
      boxes.push({ g, box: boatBox(vm.mat.boat, g) });
    }
    assert.ok(boxes.length >= 15, `width ${width}: the boat glides`);
    for (let i = 1; i < boxes.length; i++) {
      const { g } = boxes[i];
      const [x0, y0] = boxes[i - 1].box;
      const [x1, y1] = boxes[i].box;
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const b = { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, w: 48, h: 30 };
        assert.equal(overlap(b, { x: g.sx, y: g.sy, w: g.sheet, h: g.sheet }), 0, `width ${width}, tick ${i}, t ${t.toFixed(2)}: ${JSON.stringify(b)} clear of the Sheet`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// r6-09

test("r6-09: Confetti looks like confetti: multi-hue flecks on the mat (no storm stripes) and a fleck seal (no lightning bolt)", () => {
  const s = seeded(11);
  s.ui.hints.fold = true;
  s.stats.hits = 10;
  s.boosts.storm = 12000;
  s.boosts.stormEnd = T0 + 12000;
  const vm = engine.view(s, T0, { role: "panel", width: 320 });
  assert.equal(vm.mat.storm, true);
  for (const dark of [true, false]) {
    const ctx = makeCtx({ S: pickScene(dark), dark });
    const json = renderMat(vm, { tab: "flock" }, ctx).toJSON();
    const box = json.children.find((c) => c && c.id === "cw-storm");
    assert.ok(box, "the confetti layer is drawn");
    assert.ok(json.children.indexOf(box) < json.children.findIndex((c) => c && c.id === "cw-sheet"), "under the play pieces");
    assert.deepEqual([box.loops[0].property, box.loops[0].period], ["opacity", 1200]);
    const paths = box.children.filter((c) => c && c.kind === "path");
    assert.equal(paths.length, 4, "four hues, one Background each");
    for (const p of paths) assert.equal(p.args[1].kind, "solid", "flecks, not a slash pattern");
    const colours = new Set(paths.map((p) => p.args[1].values[0]));
    assert.equal(colours.size, 4, `four distinct hues: ${[...colours].join(", ")}`);
    for (const c of colours) assert.match(c, /^#[0-9a-f]{6}$/);
    // calm: none
    assert.equal(renderMat(vm, { tab: "flock" }, makeCtx({ S: pickScene(dark), dark, calm: true })).toJSON().children.find((c) => c && c.id === "cw-storm"), undefined);
  }
  // sparse, inside the mat, the same every frame
  for (const [w, h] of [[304, 232], [224, 184], [620, 260]]) {
    const a = confettiFlecks(w, h);
    assert.deepEqual(confettiFlecks(w, h), a);
    assert.ok(a.length >= (w * h) / 2000 && a.length <= (w * h) / 600, `${w}×${h}: ${a.length} flecks`);
    for (const f of a) for (const [x, y] of f.pts) assert.ok(x >= 0 && x <= w && y >= 0 && y <= h);
    assert.deepEqual([...new Set(a.map((f) => f.hue))].sort(), [0, 1, 2, 3]);
  }
  // the seal: several flecks and dots in one colour, not the old one-polygon bolt
  const seal = readFileSync(join(root, "mods/creaseworks/art/scene/seal-storm.svg"), "utf8");
  assert.ok(!seal.includes("7,0.5 10.5,0.5 8,4.5 11,4.5 4,11.5 5.5,6.5 2,6.5"), "not the lightning bolt");
  assert.ok((seal.match(/<(polygon|circle)\b/g) || []).length >= 5, "flecks and dots");
  assert.deepEqual([...new Set(seal.match(/fill="#[0-9a-f]{3,6}"/g))], ['fill="#000"'], "flat, one colour (tinted S.ink)");
});

function close1(a, b) {
  assert.ok(Math.abs(a - b) < 0.11, `${a} ≈ ${b}`);
}

// ---------------------------------------------------------------------------
// r7-12

test("r7-12: no confetti fleck reaches the bottom band (the streak meter's ×N label, the tray, the 4 px edge strip)", () => {
  assert.deepEqual([MAT_BANDS.bottom, MAT_BANDS.edge], [32, 4]);
  // every mat size the panel, the narrow panel, the short mat and a wide pane draw
  for (const width of [200, 240, 279, 280, 320, 399, 400, 636]) {
    for (const short of [false, true]) {
      const g = matGeometry({ sheet: { short } }, { width });
      const floor = g.h - MAT_BANDS.bottom;
      const a = confettiFlecks(g.w, g.h);
      assert.ok(a.length >= (g.w * floor) / 2000, `${g.w}×${g.h}: still confetti (${a.length} flecks)`);
      for (const f of a) {
        for (const [x, y] of f.pts) {
          assert.ok(x >= 0 && x <= g.w && y >= 0, `${g.w}×${g.h}: [${x}, ${y}] inside the mat`);
          assert.ok(y <= floor, `${g.w}×${g.h}: [${x}, ${y}] stays above the bottom band (y ${floor})`);
        }
      }
    }
  }
  // the drawn paths too, against the band's own top (percent coordinates)
  const s = seeded(11);
  s.ui.hints.fold = true;
  s.stats.hits = 10;
  s.boosts.storm = 12000;
  s.boosts.stormEnd = T0 + 12000;
  for (const [width, short] of [[320, false], [320, true], [240, false]]) {
    const vm = engine.view(s, T0, { role: "panel", width });
    vm.sheet = { ...vm.sheet, short };
    const g = matGeometry(vm, { width });
    const json = renderMat(vm, { tab: "flock" }, makeCtx({ width })).toJSON();
    const band = json.children.find((c) => c && c.id === "cw-mat-bottom");
    const bandTop = styleVal(band, "top");
    assert.equal(bandTop, g.h - MAT_BANDS.bottom);
    const box = json.children.find((c) => c && c.id === "cw-storm");
    assert.ok(box, `${width}${short ? " short" : ""}: confetti is drawn`);
    let n = 0;
    for (const p of box.children.filter((c) => c && c.kind === "path")) {
      for (const cmd of p.args[0].commands) {
        if (cmd[0] !== "move_to" && cmd[0] !== "line_to") continue;
        const y = (parseFloat(cmd[2]) / 100) * g.h;
        assert.ok(y <= bandTop + 0.25, `${width}${short ? " short" : ""}: fleck corner y ${y.toFixed(2)} clear of the band at ${bandTop}`);
        n++;
      }
    }
    assert.ok(n > 0);
  }
});

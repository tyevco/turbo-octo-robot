// Review fixes on the panel tabs and the mat (ARCHITECTURE B11), each with
// the defect it guards against:
//   r1-04  no string reaches gpui's own .truncate() in the Flock detail card
//          (it cuts by code point, inside emoji)
//   r1-14  a fledgling's needs-you pip opens that fledgling (terminal.peek)
//   r1-16  "Share a save…" opens a share card and never sends this window's path
//   r1-17  clicking a needs-you tile (or list row) opens the agent
//   r1-18  the wish moment: strands rise and fade, then settle without motion
//   r1-19  the first gilded crane's one-time callout chip
//   r1-26  the wish confirm card's buttons sit at its top
//   r1-28  the rest bar has a track and stops short of the envelope marker
//
//   node --import ./tools/node/register.mjs --test test/ui/panel-tabs-fixes.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { installMockWindow, walk, fire, findById } from "../../tools/mock/gpui-kit.js";
import * as F from "../fixtures/vm-fixtures.mjs";
import { engine, seeded, writer, agent, kid, observeAction, T0 } from "../engine/_util.mjs";
import { graphemes, cellWidth } from "../../mods/creaseworks/engine/index.js";
import { pickScene, pickHues } from "../../mods/creaseworks/ui/palette.js";
import { renderFlock, TILE, VIRTUAL_ABOVE, restBar, cellsFor, detailTextPx, PIP_HIT } from "../../mods/creaseworks/ui/flock.js";
import { renderString, WISH_RISE, KEEPS, CLEARS } from "../../mods/creaseworks/ui/string.js";
import { renderSettings } from "../../mods/creaseworks/ui/settings.js";
import { renderMat } from "../../mods/creaseworks/ui/mat.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const THEMES = JSON.parse(readFileSync(join(root, "tools/mock/themes.json"), "utf8"));

installMockWindow();

const HANDLERS = [
  "click", "open", "openHelper", "buy", "setting", "switchAuto", "wish", "collect", "dismiss", "fold", "show", "tab",
  "segment", "select", "toggleGroup", "showGroup", "details", "confirm", "cancel", "retrySave", "checkSave",
  "restoreBackup", "sharePath", "resetGame",
];

function makeCtx(theme = "graphite", over = {}) {
  const dark = theme !== "paper";
  const calls = [];
  const handlers = {};
  for (const n of HANDLERS) handlers[n] = (...args) => calls.push([n, ...args.slice(0, -1)]);
  return { T: THEMES[theme], S: pickScene(dark), hues: pickHues(dark), dark, zoom: 1, calm: false, width: 320, height: 784, handlers, calls, ...over };
}

const fakeCx = () => {
  const cx = { stopped: 0, stop_propagation() { cx.stopped++; }, notify() {} };
  return cx;
};

function texts(json) {
  const out = [];
  const visit = (n) => {
    if (n && n.kind === "text") out.push(n.text);
    for (const k of (n && n.children) || []) if (k && typeof k === "object") visit(k);
  };
  visit(json);
  return out;
}

const style = (node, name) => (node.styles || []).find((s) => s[0] === name);
const styleVal = (node, name) => style(node, name)?.[1];

/** A real engine vm: agent 1 working with a working and a waiting paneless fledgling, agent 2 waiting, agent 3 resting. */
function flockVm(extra = {}) {
  const s = seeded(5);
  const me = writer(s, "wA");
  me.act(observeAction(T0, [agent(1, "working", 0, extra[1] || {}), kid(20, 1, "working"), kid(21, 1, "blocked"), agent(2, "blocked"), agent(3, "idle")]));
  s.ui.hints.fold = true;
  s.stats.hits = 10;
  s.helpers[engine.helperId("t3", 1003)].rest = 0.03;
  return { s, vm: engine.view(s, T0 + 60000, { role: "panel", width: 320, writer: "wA" }) };
}

const tileId = (i) => engine.helperId(`t${i}`, 1000 + i);

// ---------------------------------------------------------------------------
// r1-14 / r1-17

test("r1-14: a waiting fledgling's pip opens that fledgling (and stops the click there)", () => {
  const { vm } = flockVm();
  const ctx = makeCtx();
  const tree = renderFlock(vm, {}, ctx);
  const kidId = engine.helperId("t21", 1021);
  const pip = findById(tree.toJSON(), `cw-flock-kid-${kidId}`);
  assert.ok(pip, "the needs-you pip is its own target");
  assert.equal(styleVal(pip, "w"), TILE.normal.pip + 2 * PIP_HIT);
  assert.match(styleVal(pip, "tooltip"), /click to open it/);
  assert.equal(findById(tree.toJSON(), `cw-flock-kid-${engine.helperId("t20", 1020)}`), null, "a working pip stays a plain mark");
  const cx = fakeCx();
  fire(tree, `cw-flock-kid-${kidId}`, "on_click", {}, cx);
  assert.deepEqual(ctx.calls, [["openHelper", kidId]]);
  assert.equal(cx.stopped, 1);
});

test("r1-14: the parent's detail card offers an open button per waiting fledgling", () => {
  const { vm } = flockVm();
  const ctx = makeCtx();
  const kidId = engine.helperId("t21", 1021);
  const tree = renderFlock(vm, { selected: tileId(1) }, ctx);
  fire(tree, `cw-flock-detail-kid-${kidId}`, "on_click", {}, fakeCx());
  assert.deepEqual(ctx.calls, [["openHelper", kidId]]);
  assert.ok(texts(tree.toJSON()).some((w) => w.startsWith("Open ") && w.includes("fledgling")));
});

test("r1-17: clicking a needs-you tile opens its agent; other tiles select", () => {
  const { vm } = flockVm();
  const ctx = makeCtx();
  const tree = renderFlock(vm, {}, ctx);
  fire(tree, `cw-flock-tile-${tileId(2)}`, "on_click", {}, fakeCx());
  fire(tree, `cw-flock-tile-${tileId(1)}`, "on_click", {}, fakeCx());
  assert.deepEqual(ctx.calls, [["openHelper", tileId(2)], ["select", tileId(1)]]);
});

test("r1-17: in the virtual list, a needs-you row opens its agent; other rows select", () => {
  const vm = F.viewModel("flock-64-dense");
  const g = vm.helpers.groups[0];
  // Make one group big enough for the virtual list, with a needs-you row in it.
  const base = g.tiles;
  const many = Array.from({ length: VIRTUAL_ABOVE + 1 }, (_, i) => ({ ...base[i % base.length], helperId: (0x10000000 + i).toString(16) }));
  many[0] = { ...many[0], status: "blocked", dashed: true };
  many[1] = { ...many[1], status: "working", dashed: false };
  vm.helpers.groups = [{ ...g, key: "working", count: many.length, tiles: many, folded: false }];
  const ctx = makeCtx();
  const tree = renderFlock(vm, {}, ctx);
  fire(tree, "cw-flock-vl-working", "on_item_click", many[0].helperId, fakeCx());
  fire(tree, "cw-flock-vl-working", "on_item_click", many[1].helperId, fakeCx());
  assert.deepEqual(ctx.calls, [["openHelper", many[0].helperId], ["select", many[1].helperId]]);
});

// ---------------------------------------------------------------------------
// r1-04

/** Every text the detail card draws with truncate on. */
function truncatedTexts(json) {
  const card = findById(json, "cw-flock-detail");
  const out = [];
  walk(card, (n) => {
    if ((n.styles || []).some((s) => s[0] === "truncate")) for (const c of n.children || []) if (c.kind === "text") out.push(c.text);
  });
  return out;
}

test("r1-04: detail-card lines fit their column, so gpui never truncates inside a ZWJ emoji (240 and 320 px)", () => {
  for (const width of [240, 320]) {
    const col = detailTextPx(width);
    for (let pad = 0; pad < 40; pad++) {
      const title = `${"x".repeat(pad)}fix 👨‍💻 the 🇯🇵 flaky tests 👩🏽‍🔬 in the uploader`;
      const { vm } = flockVm({ 1: { title, space: "api", tab: "uploader-work" } });
      const json = renderFlock(vm, { selected: tileId(1) }, makeCtx("graphite", { width })).toJSON();
      const lines = truncatedTexts(json);
      assert.ok(lines.length >= 3, `${width}: ${lines.join(" | ")}`);
      for (const line of lines) {
        // Fits: at most the cells the column holds at 11 px (the head is 12/600).
        assert.ok(cellWidth(line) <= cellsFor(col, 11, false) || cellWidth(line) <= cellsFor(col, 12, true), `${width}/${pad}: "${line}"`);
        // Whole clusters only: the text before any ellipsis is a cluster prefix of a line we built.
        const head = line.endsWith("…") ? line.slice(0, -1) : line;
        const gs = graphemes(head);
        assert.equal(gs.join(""), head);
        assert.ok(!/‍$/.test(head) && !/[\ud800-\udbff]$/.test(head), `${width}/${pad}: cut inside a cluster: "${line}"`);
      }
      const titleLine = lines.find((l) => l.includes("fix") || l.startsWith("x"));
      if (titleLine && titleLine.endsWith("…")) {
        const full = graphemes(`${title}   api / uploader-work`);
        const kept = graphemes(titleLine.slice(0, -1));
        assert.deepEqual(kept, full.slice(0, kept.length), `${width}/${pad}`);
      }
    }
  }
});

test("r1-04: the column budget errs wide (a 60-grapheme line no longer reaches native truncation)", () => {
  assert.equal(detailTextPx(320), 194);
  assert.ok(cellsFor(detailTextPx(320), 11, false) * 0.64 * 11 <= detailTextPx(320));
  assert.ok(cellsFor(detailTextPx(240), 11, false) < 60, "the old 60-grapheme clip was wider than the box");
});

// ---------------------------------------------------------------------------
// r1-28

test("r1-28: the rest bar draws on a T.border track and stops short of the envelope marker", () => {
  for (const [g, dense] of [[TILE.normal, false], [TILE.dense, true]]) {
    const plain = restBar(g, false);
    assert.equal(plain.w, g.rest);
    const env = restBar(g, true);
    const off = dense ? 4 : 9;
    const discLeft = g.w + off - g.envHit + (g.envHit - g.env) / 2;
    assert.ok(env.left + env.w <= discLeft - 2, `${dense ? "dense" : "normal"}: bar ends at ${env.left + env.w}, disc at ${discLeft}`);
    assert.ok(env.w >= 12);
  }
  const { vm } = flockVm();
  const ctx = makeCtx();
  const json = renderFlock(vm, {}, ctx).toJSON();
  const id = tileId(3);
  const track = findById(json, `cw-flock-rest-track-${id}`);
  const fill = findById(json, `cw-flock-rest-${id}`);
  assert.ok(track && fill);
  assert.equal(styleVal(track, "bg"), ctx.T.border);
  assert.equal(styleVal(track, "w"), TILE.normal.rest);
  assert.ok(styleVal(fill, "w") <= 2, "a 3 % store is still a short fill");
  // With an envelope waiting, the bar is shortened.
  const vm2 = JSON.parse(JSON.stringify(vm));
  for (const g of vm2.helpers.groups) for (const t of g.tiles) if (t.helperId === id) t.envelope = true;
  const json2 = renderFlock(vm2, {}, ctx).toJSON();
  assert.equal(styleVal(findById(json2, `cw-flock-rest-track-${id}`), "w"), restBar(TILE.normal, true).w);
});

// ---------------------------------------------------------------------------
// r1-16

test("r1-16: Share a save… opens a share card; the card picks a file or stops sharing, never sends this save's own path", () => {
  const s = F.scenario("settings");
  const save = { state: "saved", text: "Saved", path: "/home/me/.herdr/data/creaseworks/save.json", backup: "3 m ago" };
  const ctx = makeCtx("graphite", { save });
  fire(renderSettings(s.vm, s.ui, ctx), "cw-set-share", "on_click", {}, fakeCx());
  assert.deepEqual(ctx.calls, [["confirm", "share"]]);
  // The card: without the glue's picker the pick button is disabled.
  const ui = { ...s.ui, confirm: "share" };
  let tree = renderSettings(s.vm, ui, ctx);
  let json = tree.toJSON();
  assert.ok(findById(json, "cw-set-share-card"));
  assert.ok(styleVal(findById(json, "cw-set-share-pick"), "disabled") === true || (findById(json, "cw-set-share-pick").handlers || {}).on_click === undefined);
  ctx.calls.length = 0;
  fire(tree, "cw-set-share-stop", "on_click", {}, fakeCx());
  fire(tree, "cw-set-share-cancel", "on_click", {}, fakeCx());
  fire(tree, "cw-set-share", "on_click", {}, fakeCx()); // the button closes the open card
  assert.deepEqual(ctx.calls, [["sharePath", ""], ["cancel"], ["cancel"]]);
  // With the picker handler the pick button asks for a file.
  const calls = [];
  const ctx2 = makeCtx("graphite", { save: { ...save, shared: false } });
  ctx2.handlers.pickSharePath = (cx) => calls.push(["pickSharePath"]);
  tree = renderSettings(s.vm, ui, ctx2);
  json = tree.toJSON();
  fire(tree, "cw-set-share-pick", "on_click", {}, fakeCx());
  assert.deepEqual(calls, [["pickSharePath"]]);
  assert.equal(findById(json, "cw-set-share-stop"), null, "nothing to stop when this window is not sharing");
  assert.ok(!ctx.calls.concat(ctx2.calls).some((c) => c[0] === "sharePath" && c[1] === save.path));
});

// ---------------------------------------------------------------------------
// r1-18

function lifts(json) {
  const out = [];
  for (let i = 0; i < 20; i++) out.push({ lift: findById(json, `cw-string-lift-${i}`), fill: findById(json, `cw-string-strand-${i}`) });
  return out;
}

test("r1-18: the wish moment: strands rise 30 px and fade (900 ms), then settle with no motion", () => {
  const s = F.scenario("string-ready");
  const full = new Array(20).fill(1);
  const after = new Array(20).fill(0);
  const at = (wishMoment, calm = false) => {
    const vm = JSON.parse(JSON.stringify(s.vm));
    vm.string.wishMoment = wishMoment;
    vm.string.strands = after;
    vm.calm = calm;
    return lifts(renderString(vm, s.ui, makeCtx("graphite", { calm })).toJSON());
  };
  const rise = at({ phase: "rise", strands: full });
  for (const { lift, fill } of rise) {
    assert.equal(styleVal(lift, "top"), WISH_RISE.dy);
    assert.equal(styleVal(lift, "opacity"), 0);
    assert.deepEqual(lift.transitions.map((x) => [x.property, x.duration]).sort(), [["opacity", 900], ["top", 900]]);
    assert.equal(styleVal(fill, "h"), 200, "the String as it was wished away");
    assert.deepEqual(fill.transitions, [], "no height motion during the moment");
  }
  const calm = at({ phase: "rise", strands: full }, true);
  for (const { lift } of calm) {
    assert.equal(styleVal(lift, "top"), 0, "calm: in place");
    assert.deepEqual(lift.transitions.map((x) => [x.property, x.duration]), [["opacity", 300]]);
  }
  const settle = at({ phase: "settle", strands: full });
  for (const { lift, fill } of settle) {
    assert.equal(styleVal(lift, "top"), 0);
    assert.equal(styleVal(lift, "opacity"), 1);
    assert.deepEqual(lift.transitions, []);
    assert.deepEqual(fill.transitions, [], "nothing slides back into view");
    assert.equal(styleVal(fill, "h"), 0);
  }
  const normal = at(null);
  for (const { lift, fill } of normal) {
    assert.deepEqual(lift.transitions, []);
    assert.deepEqual(fill.transitions.map((x) => x.property), ["height"]);
  }
});

// ---------------------------------------------------------------------------
// r1-19

test("r1-19: the first gilded crane shows its one-time callout chip; none once caught", () => {
  const s = seeded(11);
  s.ui.hints.fold = true;
  s.stats.hits = 10;
  s.spawn.crane = { id: "gX", slot: 12, born: s.spawn.shownMs, outcome: "lucky" };
  const ctx = makeCtx();
  const ui = { tab: "flock" };
  const json = renderMat(engine.view(s, T0, { role: "panel", width: 320 }), ui, ctx).toJSON();
  const chip = findById(json, "cw-crane-hint");
  assert.ok(chip, "the callout is drawn");
  assert.ok(texts(chip).includes("A gilded crane! Click it before it flies off."));
  assert.deepEqual(Object.keys(chip.handlers || {}), [], "it takes no clicks");
  const crane = findById(json, "cw-crane");
  const top = styleVal(chip, "top");
  assert.ok(top + styleVal(chip, "h") <= styleVal(crane, "top") || top >= styleVal(crane, "top") + 36, "beside the crane, not over it");
  s.ui.hints.crane = true;
  assert.equal(findById(renderMat(engine.view(s, T0, { role: "panel", width: 320 }), ui, ctx).toJSON(), "cw-crane-hint"), null);
});

// ---------------------------------------------------------------------------
// r1-26

test("r1-26: the wish confirm card puts its buttons right under the question", () => {
  const s = F.scenario("string-confirm");
  const json = renderString(s.vm, s.ui, makeCtx("graphite")).toJSON();
  const card = findById(json, "cw-string-confirm");
  const order = card.children.map((c) => (c.id === "cw-string-confirm-actions" ? "actions" : texts(c)[0]));
  const k = order.indexOf("actions");
  assert.equal(k, 2, order.join(" | "));
  assert.ok(order.indexOf(CLEARS) > k && order.indexOf(KEEPS) > k);
  // ≈ 12 padding + 17 title + 4 + 16 gain line + 4 + 4: the buttons start within ~60 px of the card top,
  // where the wish button was (the card's end may be below the fold at 320 × 784).
  assert.ok(findById(card, "cw-string-make") && findById(card, "cw-string-keep"));
});

test("r1-17: a needs-you tile another window sees still selects (its agent is not in this window)", () => {
  const vm = F.viewModel("flock-elsewhere");
  assert.ok(vm.helpers.elsewhere.length > 0);
  const t = vm.helpers.elsewhere[0];
  t.status = "blocked";
  t.dashed = true;
  const ctx = makeCtx();
  const tree = renderFlock(vm, { folded: { elsewhere: false } }, ctx);
  fire(tree, `cw-flock-tile-${t.helperId}`, "on_click", {}, fakeCx());
  assert.deepEqual(ctx.calls, [["select", t.helperId]]);
});

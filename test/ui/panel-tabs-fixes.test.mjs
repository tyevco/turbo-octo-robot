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
//   r3-16  the Flock's tile grids never cost more than TILE_BUDGET across
//          groups, with hysteresis at the edge
//   r3-17  a waiting fledgling gives its parent a badge-size needs-you flag
//          (tiles; clear of the left neighbour's badge) or a dashed,
//          opening row (virtual list)
//   r3-21  win98's tile badges keep needs-you red (a disc where it reads)
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
import { renderFlock, TILE, VIRTUAL_ABOVE, TILE_BUDGET, TILE_BUDGET_BAND, KID_FLAG_LEFT, tileLayout, tileCost, restBar, cellsFor, detailTextPx, PIP_HIT, virtualGroups, waitingKids, foldedWaiting } from "../../mods/creaseworks/ui/flock.js";
import { statusColor, statusDisc, contrast } from "../../mods/creaseworks/ui/color.js";
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
/** A box's width: `w`, or `size` for a square one (the Flock sets both at once). */
const widthOf = (node) => styleVal(node, "w") ?? styleVal(node, "size");

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
  assert.equal(widthOf(pip), TILE.normal.pip + 2 * PIP_HIT);
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

test("r1-14: with 5+ waiting fledglings, '+N' opens the first one past the 4 pips", () => {
  const { vm } = flockVm();
  const t = vm.helpers.groups.flatMap((g) => g.tiles).find((x) => x.helperId === tileId(1));
  const kids = Array.from({ length: 6 }, (_, i) => ({ helperId: `k${i}`, status: "blocked", name: `kid ${i}`, pane: null, tooltip: `kid ${i} (fledgling) · Needs you: click to open it` }));
  t.kids = kids;
  t.pips = kids.map((k) => k.status);
  const ctx = makeCtx();
  const tree = renderFlock(vm, {}, ctx);
  const json = tree.toJSON();
  for (let i = 0; i < 4; i++) assert.ok(findById(json, `cw-flock-kid-k${i}`));
  assert.equal(findById(json, "cw-flock-kid-k4"), null);
  const more = findById(json, "cw-flock-kid-more-k4");
  assert.ok(more, "'+2' is its own target");
  assert.ok(texts(more).includes("+2"));
  const cx = fakeCx();
  fire(tree, "cw-flock-kid-more-k4", "on_click", {}, cx);
  assert.deepEqual(ctx.calls, [["openHelper", "k4"]]);
  assert.equal(cx.stopped, 1);
  // Past the 4th pip with nobody waiting: plain text.
  t.kids = kids.map((k, i) => (i < 4 ? k : { ...k, status: "working" }));
  t.pips = t.kids.map((k) => k.status);
  const json2 = renderFlock(vm, {}, makeCtx()).toJSON();
  assert.equal(findById(json2, "cw-flock-kid-more-k4"), null);
  assert.ok(texts(json2).includes("+2"));
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
  // saveInfo without `shared`: this window is not known to share, so no Stop.
  assert.equal(findById(json, "cw-set-share-stop"), null, "Stop sharing only when ctx.save.shared === true");
  ctx.calls.length = 0;
  fire(tree, "cw-set-share-cancel", "on_click", {}, fakeCx());
  fire(tree, "cw-set-share", "on_click", {}, fakeCx()); // the button closes the open card
  assert.deepEqual(ctx.calls, [["cancel"], ["cancel"]]);
  // While sharing, Stop goes back to this window's own save.
  const ctxS = makeCtx("graphite", { save: { ...save, shared: true } });
  tree = renderSettings(s.vm, ui, ctxS);
  fire(tree, "cw-set-share-stop", "on_click", {}, fakeCx());
  assert.deepEqual(ctxS.calls, [["sharePath", ""]]);
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
  // gpui samples a motion only while it is declared, and adopts the first
  // declared target without animating: every frame must declare the same
  // channels on the same ids, with 0 ms wherever nothing should move.
  const motion = (el) => el.transitions.map((x) => [x.property, x.duration]).sort();
  const rise = at({ phase: "rise", strands: full });
  for (const { lift, fill } of rise) {
    assert.equal(styleVal(lift, "top"), WISH_RISE.dy);
    assert.equal(styleVal(lift, "opacity"), 0);
    assert.deepEqual(motion(lift), [["opacity", 900], ["top", 900]]);
    assert.equal(styleVal(fill, "h"), 200, "the String as it was wished away");
    assert.deepEqual(motion(fill), [["height", 0]], "no height motion during the moment");
  }
  const calm = at({ phase: "rise", strands: full }, true);
  for (const { lift } of calm) {
    assert.equal(styleVal(lift, "top"), 0, "calm: in place");
    assert.deepEqual(motion(lift), [["opacity", 300], ["top", 0]]);
  }
  const settle = at({ phase: "settle", strands: full });
  for (const { lift, fill } of settle) {
    assert.equal(styleVal(lift, "top"), 0);
    assert.equal(styleVal(lift, "opacity"), 1);
    assert.deepEqual(motion(lift), [["opacity", 0], ["top", 0]], "settle snaps back, still declared");
    assert.deepEqual(motion(fill), [["height", 0]], "nothing slides back into view");
    assert.equal(styleVal(fill, "h"), 0);
  }
  for (const calmMode of [false, true]) {
    const normal = at(null, calmMode);
    for (const { lift, fill } of normal) {
      assert.deepEqual(motion(lift), [["opacity", 0], ["top", 0]], "the lift's motion state exists before the wish");
      assert.deepEqual(motion(fill), [["height", calmMode ? 150 : 600]]);
    }
  }
});

// ---------------------------------------------------------------------------
// r1-19

test("r1-19: the first gilded crane shows its one-time callout chip; none once caught", () => {
  const s = seeded(11);
  s.ui.hints.fold = true;
  s.stats.hits = 10;
  s.spawn.crane = { id: "gX", slot: 12, born: s.spawn.shownMs, outcome: "gift" };
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

// ---------------------------------------------------------------------------
// r3-16 / r3-17 / r3-21

/** A flock-64-dense vm with `per[key]` tiles in each status group (copies of its tiles, fresh ids). */
function sizedFlock(per) {
  const vm = F.viewModel("flock-64-dense");
  const all = vm.helpers.groups.flatMap((g) => g.tiles);
  let id = 0;
  vm.helpers.groups = Object.entries(per).map(([key, n]) => {
    const st = { needs: "blocked", finished: "done", working: "working", resting: "idle" }[key];
    const tiles = Array.from({ length: n }, (_, i) => ({ ...all[i % all.length], helperId: (0x20000000 + id++).toString(16), status: st, dashed: st === "blocked", pips: [], kids: [] }));
    return { key, title: key, count: n, tiles, folded: false };
  });
  return vm;
}

function tileCount(json) {
  let n = 0;
  walk(json, (node) => {
    if (typeof node.id === "string" && node.id.startsWith("cw-flock-tile-")) n++;
  });
  return n;
}

/** What the drawn tile grids cost (tileCost of every tile drawn as a tile). */
function drawnCost(vm, json) {
  const drawn = new Set();
  walk(json, (node) => {
    if (typeof node.id === "string" && node.id.startsWith("cw-flock-tile-")) drawn.add(node.id.slice("cw-flock-tile-".length));
  });
  let c = 0;
  for (const g of vm.helpers.groups) for (const t of g.tiles) if (drawn.has(t.helperId)) c += tileCost(t, Boolean(vm.helpers.dense), false);
  return c;
}

const keysOf = (v) => Object.keys(v).sort();

test("r3-16: tileCost counts what a tile builds; four groups of 79 stay within TILE_BUDGET, the biggest groups become lists", () => {
  const plain = { helperId: "a", status: "working", pips: [], kids: [] };
  assert.equal(tileCost(plain, true, false), 6);
  assert.equal(tileCost(plain, false, false), 7);
  assert.equal(tileCost({ ...plain, pips: ["working", "idle"] }, true, false), 6 + 1 + 2, "a pip row and two pips");
  assert.equal(tileCost({ ...plain, pips: ["blocked"], kids: [{ helperId: "k", status: "blocked" }] }, true, false), 6 + 1 + 5 + 4, "a waiting pip's target and the flag");
  assert.equal(tileCost({ ...plain, pips: ["blocked"], kids: [{ helperId: "k", status: "blocked" }] }, true, true), 6 + 1 + 5, "no flag Elsewhere");
  assert.equal(tileCost({ ...plain, status: "idle", rest: 0.5, envelope: true }, true, false), 6 + 2 + 5);
  assert.equal(tileCost(null, true, false), 0);

  const vm = sizedFlock({ needs: 79, finished: 79, working: 79, resting: 79 });
  const v = virtualGroups(vm, {});
  assert.equal(Object.getPrototypeOf(v), null);
  assert.deepEqual(keysOf(v), ["finished", "resting", "working"], "needs-you keeps its tiles (ties switch the later group)");
  const json = renderFlock(vm, {}, makeCtx()).toJSON();
  assert.ok(drawnCost(vm, json) <= TILE_BUDGET, `${drawnCost(vm, json)} > ${TILE_BUDGET}`);
  assert.equal(tileCount(json), 79);
  for (const k of ["finished", "working", "resting"]) assert.ok(findById(json, `cw-flock-vl-${k}`), `${k} is a virtual list`);
  assert.ok(findById(json, "cw-flock-grid-needs"));
  // 150 agents in realistic groups: the working group goes, the rest stay tiles.
  const r = sizedFlock({ needs: 12, finished: 8, working: 80, resting: 50 });
  assert.deepEqual(keysOf(virtualGroups(r, {})), ["working"]);
  assert.ok(drawnCost(r, renderFlock(r, {}, makeCtx()).toJSON()) <= TILE_BUDGET);
  // A folded group costs nothing; within the budget nothing changes; one group over 80 is always a list.
  assert.deepEqual(keysOf(virtualGroups(r, { folded: { working: true } })), []);
  assert.deepEqual(keysOf(virtualGroups(sizedFlock({ needs: 5, working: 60, resting: 45 }), {})), [], "110 plain tiles stay tiles");
  assert.deepEqual(keysOf(virtualGroups(sizedFlock({ working: VIRTUAL_ABOVE + 1 }), {})), ["working"]);
  // Needs-you is switched last, even when it is the biggest group.
  assert.deepEqual(keysOf(virtualGroups(sizedFlock({ needs: 70, working: 50 }), {})), ["working"]);
  // Fledgling pips cost: 70 working tiles with 4 pips each and 10 needs-you tiles are past the budget.
  const kids = sizedFlock({ needs: 10, working: 70 });
  assert.deepEqual(keysOf(virtualGroups(kids, {})), []);
  for (const t of kids.helpers.groups[1].tiles) t.pips = ["working", "idle", "working", "idle"];
  assert.deepEqual(keysOf(virtualGroups(kids, {})), ["working"]);
  // One group of 80 whose tiles each carry a waiting fledgling (pip target + flag) is a list even alone.
  const heavy = sizedFlock({ working: VIRTUAL_ABOVE });
  for (const t of heavy.helpers.groups[0].tiles) {
    t.pips = ["blocked"];
    t.kids = [{ helperId: `k${t.helperId}`, status: "blocked" }];
  }
  assert.deepEqual(keysOf(virtualGroups(heavy, {})), ["working"]);
  for (const t of heavy.helpers.groups[0].tiles) t.pips = ["working"];
  assert.deepEqual(keysOf(virtualGroups(heavy, {})), [], "plain pips: 80 tiles stay a grid");
});

test("r3-16: the 64-dense Flock with 80 working tiles (and their fledgling pips) beside needs-you and finished stays tiles", () => {
  const s = F.scenario("flock-64-dense");
  const vm = structuredClone(s.vm);
  const working = vm.helpers.groups.find((g) => g.key === "working");
  const base = working.tiles.slice();
  while (working.tiles.length < VIRTUAL_ABOVE) {
    const k = working.tiles.length;
    working.tiles.push({ ...base[k % base.length], helperId: `v${k.toString(16).padStart(7, "0")}` });
  }
  // Resting folded (by the player: the fixture's resting parents have waiting
  // fledglings, so it no longer folds by itself, r4-12).
  const ui = { ...s.ui, folded: { resting: true } };
  assert.deepEqual(keysOf(virtualGroups(vm, ui)), [], "the rule of §5.5 item 8: 80 in a group stay tiles");
  const json = renderFlock(vm, ui, makeCtx()).toJSON();
  assert.ok(findById(json, "cw-flock-grid-working"));
  assert.ok(drawnCost(vm, json) <= TILE_BUDGET);
  // Unfolding resting (26 more, fledgling-heavy) is past the budget: working, the biggest, goes.
  assert.deepEqual(keysOf(virtualGroups(vm, { ...s.ui, folded: { resting: false } })), ["working"]);
});

test("r3-16: hysteresis: a group the last render listed goes back to tiles only well inside the budget", () => {
  // Plain dense tiles cost 6: 74 working + 60 resting = 804 > 800.
  const plainDense = (vm) => {
    vm.helpers.dense = true;
    for (const g of vm.helpers.groups) for (const t of g.tiles) Object.assign(t, { envelope: false, rest: undefined });
    return vm;
  };
  const over = plainDense(sizedFlock({ working: 74, resting: 60 }));
  const cost = (vm) => vm.helpers.groups.reduce((c, g) => c + g.tiles.reduce((d, t) => d + tileCost(t, true, false), 0), 0);
  assert.ok(cost(over) > TILE_BUDGET, `${cost(over)}`);
  const first = virtualGroups(over, {});
  assert.deepEqual(keysOf(first), ["working"]);
  // One agent finishes: just under the budget. Without memory both are tiles;
  // with the last render's lists the working group stays a list.
  const under = structuredClone(over);
  under.helpers.groups[0].tiles.pop();
  assert.ok(cost(under) <= TILE_BUDGET && cost(under) > TILE_BUDGET - TILE_BUDGET_BAND);
  assert.deepEqual(keysOf(virtualGroups(under, {})), []);
  assert.deepEqual(keysOf(virtualGroups(under, {}, first)), ["working"], "no flip at the edge");
  // The glue's ui.flockLists feeds renderFlock the same memory.
  const ui = { flockLists: first };
  assert.ok(findById(renderFlock(under, ui, makeCtx()).toJSON(), "cw-flock-vl-working"));
  // A group that changes size does not trade places with the listed one: resting grows past working.
  const swap = structuredClone(under);
  for (let i = 0; i < 16; i++) swap.helpers.groups[1].tiles.push({ ...swap.helpers.groups[1].tiles[0], helperId: `r${i}` });
  swap.helpers.groups[0].tiles.splice(0, 16);
  assert.ok(swap.helpers.groups[1].tiles.length > swap.helpers.groups[0].tiles.length);
  assert.deepEqual(keysOf(virtualGroups(swap, {}, first)), ["working"], "the listed group stays the list");
  // Well inside the budget the list goes back to tiles.
  const small = plainDense(sizedFlock({ working: 40, resting: 60 }));
  assert.ok(cost(small) <= TILE_BUDGET - TILE_BUDGET_BAND);
  assert.deepEqual(keysOf(virtualGroups(small, {}, first)), []);
  // The per-group rule has no memory: 80 tiles are a grid again whatever was listed.
  assert.deepEqual(keysOf(virtualGroups(sizedFlock({ working: VIRTUAL_ABOVE }), {}, { working: true })), []);
  // Junk memory is ignored.
  for (const junk of [null, 7, "working", { working: 1 }]) assert.deepEqual(keysOf(virtualGroups(under, {}, junk)), []);
});

test("r3-17: a parent whose fledgling waits gets a badge-size needs-you flag that opens the fledgling, dense or not", () => {
  const { vm } = flockVm();
  const kidId = engine.helperId("t21", 1021);
  const parent = vm.helpers.groups.flatMap((g) => g.tiles).find((x) => x.helperId === tileId(1));
  assert.equal(waitingKids(parent).length, 1);
  for (const dense of [false, true]) {
    vm.helpers.dense = dense;
    const g = dense ? TILE.dense : TILE.normal;
    const ctx = makeCtx();
    const tree = renderFlock(vm, {}, ctx);
    const flag = findById(tree.toJSON(), `cw-flock-kidflag-${tileId(1)}`);
    assert.ok(flag, `dense ${dense}: the flag`);
    assert.equal(widthOf(flag), g.badge, "as big as the status badge");
    assert.equal(styleVal(flag, "border_color"), statusColor(ctx.T, "blocked", "raised"), "ringed in needs-you (guarded for the tile)");
    assert.match(styleVal(flag, "tooltip"), /click to open it/);
    // Inside its own tile, clear of the left neighbour's status badge (which
    // pokes out past that tile's right edge across the grid gap), so it never
    // reads as the neighbour's and its click target takes none of that badge.
    const badge = findById(tree.toJSON(), `cw-flock-badge-${tileId(1)}`);
    const poke = -styleVal(badge, "right");
    assert.equal(styleVal(flag, "left"), KID_FLAG_LEFT);
    assert.equal(styleVal(flag, "top"), styleVal(badge, "top"), "level with the badge");
    const clear = g.gap + styleVal(flag, "left") - poke;
    assert.ok(clear >= 2, `dense ${dense}: ${clear} px from the neighbour's badge`);
    assert.ok(styleVal(flag, "left") + g.badge + 2 <= g.w - poke - g.badge, "clear of its own badge");
    const cx = fakeCx();
    fire(tree, `cw-flock-kidflag-${tileId(1)}`, "on_click", {}, cx);
    assert.deepEqual(ctx.calls, [["openHelper", kidId]]);
    assert.equal(cx.stopped, 1, "the tile itself does not also select");
  }
  // Helpers with no waiting fledgling have no flag.
  const json = renderFlock(vm, {}, makeCtx()).toJSON();
  assert.equal(findById(json, `cw-flock-kidflag-${tileId(3)}`), null);
  assert.equal(findById(json, `cw-flock-kidflag-${tileId(2)}`), null);
});

test("r4-12: every waiting helper has a visible needs-you cue in the Flock tab, folded groups included", () => {
  const s = seeded(9);
  const me = writer(s, "wA");
  // 13 resting (Resting would fold), 2 working, 1 waiting; one fledgling waits under resting 5, one under working 13.
  const list = Array.from({ length: 16 }, (_, i) => agent(i, i < 13 ? "idle" : i < 15 ? "working" : "blocked"));
  me.act(observeAction(T0, [...list, kid(40, 5, "working"), kid(41, 13, "working")]));
  me.act(observeAction(T0 + 5000, [...list, kid(40, 5, "blocked"), kid(41, 13, "blocked")]));
  const vm = engine.view(s, T0 + 6000, { role: "panel", width: 320, writer: "wA" });
  assert.equal(vm.header.counts.needs, 3);
  const cues = (json) => {
    let n = 0;
    walk(json, (node) => {
      const id = typeof node.id === "string" ? node.id : "";
      const tm = id.match(/^cw-flock-tile-(.+)$/);
      if (tm) {
        const t = vm.helpers.groups.flatMap((g) => g.tiles).find((x) => x.helperId === tm[1]);
        if (t && t.status === "blocked") n++;
      }
      const fm = id.match(/^cw-flock-kidflag-(.+)$/);
      if (fm) n += waitingKids(vm.helpers.groups.flatMap((g) => g.tiles).find((x) => x.helperId === fm[1])).length;
      if (/^cw-flock-grp-.+-waiting$/.test(id)) n += Number(texts(node).find((w) => /^\d+$/.test(w)));
    });
    return n;
  };
  // Default: Resting stays open (the engine does not fold over a waiting fledgling).
  assert.equal(vm.helpers.groups.find((g) => g.key === "resting").folded, false);
  assert.equal(cues(renderFlock(vm, {}, makeCtx()).toJSON()), 3);
  // Folded by the player: the header carries the cue, and its flag opens the fledgling.
  const kidId = engine.helperId("t40", 1040);
  for (const theme of ["graphite", "paper", "win98"]) {
    const ctx = makeCtx(theme);
    const tree = renderFlock(vm, { folded: { resting: true, working: true } }, ctx);
    const json = tree.toJSON();
    assert.equal(cues(json), 3, `${theme}: folded headers count their waiting fledglings`);
    const flag = findById(json, "cw-flock-grp-resting-waiting");
    assert.ok(flag, `${theme}: Resting's header flag`);
    assert.match(styleVal(flag, "tooltip"), /fledgling in here needs you/);
    assert.equal(styleVal(flag, "border_color"), statusColor(ctx.T, "blocked", "chrome"));
    assert.ok(contrast(styleVal(flag, "border_color"), ctx.T.chrome) >= 3, `${theme}: the ring reads on chrome`);
    const cx = fakeCx();
    fire(tree, "cw-flock-grp-resting-waiting", "on_click", {}, cx);
    assert.deepEqual(ctx.calls, [["openHelper", kidId]]);
    assert.equal(cx.stopped, 1, "the header does not also unfold");
  }
  // An open group, or a folded one with nobody waiting, has no header flag.
  assert.equal(findById(renderFlock(vm, {}, makeCtx()).toJSON(), "cw-flock-grp-resting-waiting"), null);
  assert.equal(foldedWaiting(vm.helpers.groups.find((g) => g.key === "needs").tiles), null);
  assert.equal(foldedWaiting([]), null);
  const two = foldedWaiting(vm.helpers.groups.flatMap((g) => g.tiles));
  assert.equal(two.count, 2);
  assert.match(two.tip, /^2 fledglings in here need you/);
});

test("r4-14: the needs-you flag never covers the species figure; the name and pips step clear, dense or not", () => {
  const { vm } = flockVm();
  const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  for (const dense of [false, true]) {
    vm.helpers.dense = dense;
    const g = dense ? TILE.dense : TILE.normal;
    const json = renderFlock(vm, {}, makeCtx()).toJSON();
    for (const [i, flagged] of [[1, true], [2, false], [3, false]]) {
      const tile = findById(json, `cw-flock-tile-${tileId(i)}`);
      const figure = tile.children[0];
      const lay = tileLayout(g, flagged);
      assert.equal(styleVal(figure, "top"), lay.figureTop, `dense ${dense} tile ${i}: figure top`);
      assert.equal(styleVal(figure, "left"), lay.figureLeft, `dense ${dense} tile ${i}: figure left`);
      if (!flagged) {
        assert.equal(lay.figureTop, dense ? 4 : 6, "unflagged tiles keep the §3.3 layout");
        continue;
      }
      const flag = findById(json, `cw-flock-kidflag-${tileId(i)}`);
      const fx = styleVal(flag, "left");
      const fy = styleVal(flag, "top");
      const fBox = { x0: fx, x1: fx + widthOf(flag), y0: fy, y1: fy + (styleVal(flag, "h") ?? styleVal(flag, "size")) };
      assert.ok(Number.isFinite(fBox.x1) && Number.isFinite(fBox.y1), "the flag has a size");
      const gBox = { x0: lay.figureLeft, x1: lay.figureLeft + g.glyph, y0: lay.figureTop, y1: lay.figureTop + g.glyph };
      assert.ok(!overlap(fBox, gBox), `dense ${dense}: flag ${JSON.stringify(fBox)} clear of figure ${JSON.stringify(gBox)}`);
      const pipsTop = g.h - lay.pipsBottom - g.pip;
      assert.ok(gBox.y1 <= pipsTop, `dense ${dense}: figure clear of the pips`);
      assert.ok(pipsTop + g.pip <= g.h - 1 - 2, `dense ${dense}: pips clear of the rest bar (bottom 1, 2 px)`);
      if (!dense) {
        // The 11 px name in its 120 % line box: text clear of the figure, box above the pips.
        assert.ok(lay.nameTop + 1.1 >= gBox.y1, "name text below the figure");
        assert.ok(lay.nameTop + 13.2 <= pipsTop, "name above the pips");
      }
    }
  }
});

test("r3-17: in a virtual list, a row whose fledgling waits is dashed, shows the count, and opens that fledgling", () => {
  const vm = F.viewModel("flock-64-dense");
  const base = vm.helpers.groups[0].tiles;
  const many = Array.from({ length: VIRTUAL_ABOVE + 1 }, (_, i) => ({ ...base[i % base.length], helperId: (0x30000000 + i).toString(16), status: "working", dashed: false, pips: [], kids: [] }));
  many[0] = { ...many[0], pips: ["blocked", "blocked", "working"], kids: [
    { helperId: "kidA", status: "blocked", name: "kid A", pane: null, tooltip: "kid A (fledgling) · Needs you: click to open it" },
    { helperId: "kidB", status: "blocked", name: "kid B", pane: null, tooltip: "kid B" },
    { helperId: "kidC", status: "working", name: "kid C", pane: null, tooltip: "kid C" },
  ] };
  vm.helpers.groups = [{ key: "working", title: "Working", count: many.length, tiles: many, folded: false }];
  const ctx = makeCtx();
  const tree = renderFlock(vm, {}, ctx);
  const list = findById(tree.toJSON(), "cw-flock-vl-working");
  const rows = list.children;
  assert.ok(rows[0].styles.some((x) => x[0] === "border_dashed"), "the parent's row is a needs-you mark");
  assert.ok(texts(rows[0]).includes("2"), "two fledglings wait");
  assert.ok(!rows[1].styles.some((x) => x[0] === "border_dashed"));
  fire(tree, "cw-flock-vl-working", "on_item_click", many[0].helperId, fakeCx());
  fire(tree, "cw-flock-vl-working", "on_item_click", many[1].helperId, fakeCx());
  assert.deepEqual(ctx.calls, [["openHelper", "kidA"], ["select", many[1].helperId]]);
});

test("r3-21: win98 tile badges sit on a disc where all four status colours pass 3:1 (needs-you stays red)", () => {
  const T = THEMES.win98;
  const disc = statusDisc(T);
  const { vm } = flockVm();
  const json = renderFlock(vm, {}, makeCtx("win98")).toJSON();
  const want = { [tileId(1)]: T.working, [tileId(2)]: T.blocked, [tileId(3)]: T.idle };
  for (const [id, colour] of Object.entries(want)) {
    const badge = findById(json, `cw-flock-badge-${id}`);
    assert.equal(styleVal(badge, "bg"), disc);
    assert.equal(styleVal(badge.children[0], "text_color"), colour.toLowerCase(), `${id}: its own status colour`);
    assert.ok(contrast(colour, disc) >= 3);
  }
  // Themes where needs-you already reads on T.popover keep it.
  for (const name of ["graphite", "paper"]) {
    const j = renderFlock(vm, {}, makeCtx(name)).toJSON();
    assert.equal(styleVal(findById(j, `cw-flock-badge-${tileId(2)}`), "bg"), THEMES[name].popover);
  }
});

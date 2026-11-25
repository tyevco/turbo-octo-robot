// main.js (ARCHITECTURE B7, B11): the View routes props().role to the panel,
// the rail (< 140 px) or the ribbon; the root element is #root with
// on_size_change (÷ zoom); render reads the cached ViewModel (one view() per
// rev / width / tab / bucket, no host data reads); the B11 ctx; and render
// time at 64 helpers in Node (target ≤ 8 ms; the QuickJS harness is the
// budget of record, see the report).

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { findById, walk } from "../../tools/mock/gpui-kit.js";
import { win, flockScenario, median } from "./_util.mjs";

let w;
afterEach(() => w && w.dispose());

const size = (w, v, width, height) => w.ctl.within("event", v, (cx) => findById(w.render(v).el, "root").__r.handlers.on_size_change({ width, height }, cx));

test("root #root with on_size_change; panel, rail below 140 px, ribbon", async () => {
  w = win({ ...flockScenario(6, 2), zoom: 1.5 });
  const panel = await w.copy("panel");
  const ribbon = await w.copy("ribbon");
  const loading = w.render(panel).tree;
  assert.equal(loading.id, "root");
  await w.advance(2000);
  const { tree } = w.render(panel);
  assert.equal(tree.id, "root");
  assert.ok(tree.handlers.on_size_change, "the root measures the copy");
  assert.ok(findById(tree, "cw-panel"));
  size(w, panel, 96, 1176); // 64 × 784 logical at zoom 1.5
  assert.equal(panel.session.width, 64);
  assert.equal(w.slot.widths.panel, 64);
  const rail = w.render(panel).tree;
  assert.equal(findById(rail, "cw-panel"), null);
  assert.ok(JSON.stringify(rail).includes("cw-rail"), "the rail draws below 140 px");
  size(w, ribbon, 1758, 45);
  assert.equal(ribbon.session.width, 1172);
  const rt = w.render(ribbon).tree;
  assert.ok(findById(rt, "cw-ribbon"));
  // Every clickable has an id, unique in the copy.
  for (const t of [tree, rt]) {
    const ids = [];
    walk(t, (n) => {
      if (n.id) ids.push(n.id);
    });
    assert.equal(new Set(ids).size, ids.length, "ids unique");
  }
});

test("render reads the cached vm: no view() rebuild and no host data reads between ticks", async () => {
  w = win(flockScenario(12, 4));
  const panel = await w.copy("panel");
  await w.advance(2000);
  w.render(panel);
  const vm1 = panel.session.vm();
  w.ctl.resetCounts();
  for (let i = 0; i < 5; i++) w.render(panel);
  assert.equal(panel.session.vm(), vm1, "same vm object within the clock bucket");
  const c = w.ctl.counts;
  for (const k of ["agents", "terminals", "panes", "layout", "readTextFile", "writeTextFile"]) assert.equal(c[k] ?? 0, 0, `${k}() in render`);
  await w.handler(panel, "click", "sheet", null, { x: 150, y: 110 });
  assert.notEqual(panel.session.vm(), vm1, "a new rev builds a new vm");
  await w.handler(panel, "tab", "shop");
  assert.equal(panel.session.ui.tab, "shop");
  assert.ok(findById(w.render(panel).tree, "cw-content"));
});

test("ctx follows B11: theme, scene, hues, zoom, calm, width, save, handlers", async () => {
  w = win({ theme: "paper" });
  const panel = await w.copy("panel");
  const ribbon = await w.copy("ribbon");
  await w.advance(2000);
  const ctx = panel.session.ctx();
  assert.equal(ctx.dark, false);
  assert.equal(typeof ctx.T.chrome, "string");
  assert.equal(ctx.width, 320);
  assert.equal(ctx.save.state, "saved");
  assert.match(ctx.save.path, /data\/creaseworks\/save\.json$/);
  for (const h of ["click", "open", "openHelper", "buy", "setting", "switchAuto", "wish", "collect", "dismiss", "fold", "show", "tab",
    "segment", "select", "toggleGroup", "showGroup", "details", "confirm", "cancel", "retrySave", "checkSave", "restoreBackup", "sharePath", "resetGame"]) {
    assert.equal(typeof ctx.handlers[h], "function", h);
  }
  const rctx = ribbon.session.ctx();
  assert.equal(rctx.height, 30);
  assert.equal(typeof rctx.panelShown, "boolean");
  // A two-step confirm arms after 1.5 s through ui.now.
  await w.handler(panel, "confirm", "reset");
  assert.equal(panel.session.ui.confirm, "reset");
  await w.advance(1600);
  const ui = panel.session.uiForRender();
  assert.ok(ui.now - ui.armedAt >= 1500);
  // Pops: a Sheet hit with a position adds one (≤ 5, gone after 1.2 s).
  for (let i = 0; i < 7; i++) {
    await w.handler(panel, "click", "sheet", null, { x: 150, y: 116 });
    await w.advance(100);
  }
  assert.ok(panel.session.ui.pops.length <= 5 && panel.session.ui.pops.length > 0);
  await w.advance(2000);
  assert.equal(panel.session.ui.pops.length, 0);
});

test("render at 64 helpers: ≤ 8 ms median in Node (panel, rail, ribbon)", async () => {
  w = win(flockScenario(64, 24));
  const panel = await w.copy("panel");
  const ribbon = await w.copy("ribbon");
  await w.advance(3000);
  size(w, ribbon, 1172, 30);
  const out = {};
  for (const [name, v, width] of [["panel", panel, 320], ["rail", panel, 64], ["ribbon", ribbon, 832]]) {
    size(w, v, width, name === "ribbon" ? 30 : 784);
    for (let i = 0; i < 10; i++) w.render(v); // warm up
    const cached = [];
    for (let i = 0; i < 25; i++) cached.push(w.render(v).ms);
    const fresh = [];
    for (let i = 0; i < 15; i++) {
      v.session.cache = null; // a tick: view() rebuilt inside render
      fresh.push(w.render(v).ms);
    }
    out[name] = { cached: median(cached), fresh: median(fresh) };
    assert.ok(median(cached) <= 8, `${name}: ${median(cached).toFixed(2)} ms`);
    assert.ok(median(fresh) <= 8, `${name} with view(): ${median(fresh).toFixed(2)} ms`);
  }
  console.log(`# render ms at 64 helpers + 24 fledglings (Node): ${JSON.stringify(out, (k, v) => (typeof v === "number" ? Number(v.toFixed(2)) : v))}`);
});

// r3-03: the load task builds the ViewModel (the first render after a load
// used to run the whole view() inside render: 25-40 ms of 50 at two years).
test("r3-03: the first render after the load reads a vm the load task built", async () => {
  const { saveText, freshState, SAVE } = await import("./_util.mjs");
  const s = freshState(4);
  s.bank = 1234;
  w = win({ ...flockScenario(12, 4), files: { [SAVE]: saveText(s) } });
  const panel = await w.copy("panel");
  assert.equal(panel.session.vm(), null, "loading: the placeholder");
  await w.flush(); // the load task's steps (no tick: the clock has not moved)
  assert.ok(w.slot.state, "loaded");
  assert.ok(panel.session.cache, "the vm was built in the load task");
  const built = panel.session.cache.vm;
  let views = 0;
  const vm = panel.session.vm.bind(panel.session);
  panel.session.vm = (t) => {
    const before = panel.session.cache;
    const out = vm(t);
    if (panel.session.cache !== before) views++;
    return out;
  };
  w.render(panel);
  assert.equal(views, 0, "render built no vm");
  assert.equal(panel.session.cache.vm, built);
});

// r3-12: calm mode re-renders counters every 5 s (DESIGN §11.1 item 6): time
// moving the counters does not touch the slot; a 5 s bucket or an act does.
test("r3-12: calm mode re-renders every 5 s, not every second; an act still re-renders at once", async () => {
  w = win(flockScenario(6, 0, () => "working"));
  const panel = await w.copy("panel");
  await w.advance(2000);
  let changes = 0;
  const changed = panel.session.changed.bind(panel.session);
  panel.session.changed = (cx, t) => {
    changes++;
    return changed(cx, t);
  };
  await w.advance(10000);
  assert.ok(changes >= 9, `every second normally (${changes} in 10 s)`);
  await w.handler(panel, "setting", "calm", true);
  assert.equal(w.slot.state.settings.calm, true);
  await w.advance(1000);
  changes = 0;
  const notifies = w.ctl.notifies.length;
  await w.advance(10000);
  assert.ok(changes <= 3, `calm: at most one per 5 s bucket (${changes} in 10 s)`);
  assert.ok(w.ctl.notifies.length - notifies <= 3, `calm: cx.notify() at most per bucket (${w.ctl.notifies.length - notifies})`);
  changes = 0;
  await w.handler(panel, "click", "sheet", null, null);
  assert.ok(changes >= 1, "a click re-renders at once");
});

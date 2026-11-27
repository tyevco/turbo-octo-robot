// view(state, now, opts) → ViewModel (ARCHITECTURE B6, B10): grouping and
// order, density, ribbon levels, rail pips, the loop budget (DESIGN §13.5),
// shop reveal / eta / best buy, String, Settings, away cards, notices, mat
// positions, clipping, purity, shape parity with test/fixtures/vm-fixtures.mjs
// and the 3 ms budget. States are built by hand (observe actions, then the
// timing fields set directly) so each rule is checked in isolation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { engine, seeded, writer, agent, kid, observeAction, T0 } from "./_util.mjs";
import { viewModel, VIEW_NAMES } from "../fixtures/vm-fixtures.mjs";
import { RAIL_PIPS } from "../../mods/creaseworks/engine/view.js";

const id = (i, created = 1000 + i) => engine.helperId(`t${i}`, created);

/** A state with the given agents observed at T0 (statuses by index). */
function withAgents(statuses, extra = {}) {
  const s = seeded(3);
  const me = writer(s, "wA");
  me.act(observeAction(T0, statuses.map((st, i) => agent(i, st, 0, extra[i] || {}))));
  // Join order = index order; everything older than every budget window.
  statuses.forEach((st, i) => {
    const h = s.helpers[id(i)];
    h.joined = T0 - 3600000 + i * 1000;
    if (h.blockedAt !== null) h.blockedAt = T0 - 600000;
  });
  s.ui.hints.fold = true;
  s.stats.hits = 10;
  return { s, me };
}

const v = (s, t = T0, o = {}) => engine.view(s, t, { role: "panel", width: 320, writer: "wA", ...o });
const loopCount = (vm) => {
  let n = 0;
  for (const g of vm.helpers.groups) for (const x of g.tiles) n += (x.pulse ? 1 : 0) + (x.spin ? 1 : 0);
  for (const c of vm.mat.chips) n += c.pulse ? 1 : 0;
  for (const e of vm.tray.envelopes) n += e.bob ? 1 : 0;
  n += vm.mat.crane && vm.mat.crane.bob ? 1 : 0;
  n += vm.mat.storm ? 1 : 0;
  n += vm.sheet.hintBob ? 1 : 0;
  return n;
};
const tiles = (vm) => vm.helpers.groups.flatMap((g) => g.tiles);

// ---------------------------------------------------------------------------
// Grouping and order

test("urgency groups: fixed order, longest waiting first in Needs you, join order elsewhere (§3.3)", () => {
  const { s } = withAgents(["idle", "working", "blocked", "done", "working", "blocked", "idle", "blocked"]);
  // Waits: 7 began first, then 2, then 5.
  s.helpers[id(7)].blockedAt = T0 - 900000;
  s.helpers[id(2)].blockedAt = T0 - 800000;
  s.helpers[id(5)].blockedAt = T0 - 700000;
  // Join order inside Working: 4 joined before 1.
  s.helpers[id(4)].joined = T0 - 7200000;
  const vm = v(s);
  assert.deepEqual(vm.helpers.groups.map((g) => [g.key, g.title, g.count]), [
    ["needs", "Needs you", 3], ["finished", "Finished", 1], ["working", "Working", 2], ["resting", "Resting", 2],
  ]);
  assert.deepEqual(vm.helpers.groups[0].tiles.map((x) => x.helperId), [id(7), id(2), id(5)]);
  assert.deepEqual(vm.helpers.groups[2].tiles.map((x) => x.helperId), [id(4), id(1)]);
  assert.deepEqual(vm.helpers.groups[3].tiles.map((x) => x.helperId), [id(0), id(6)]);
  assert.deepEqual(vm.header.counts, { needs: 3, finished: 1, working: 2, resting: 2 });
  // A tile moves only when its group changes: a later observation of the same statuses keeps the order.
  assert.deepEqual(tiles(v(s, T0 + 5000)).map((x) => x.helperId), tiles(vm).map((x) => x.helperId));
  // Tile cues (§3.3, §5.2).
  const needs = vm.helpers.groups[0].tiles[0];
  assert.equal(needs.status, "blocked");
  assert.equal(needs.statusWord, "Needs you");
  assert.equal(needs.dashed, true);
  const rest = vm.helpers.groups[3].tiles[0];
  assert.equal(rest.opacity, 0.8);
  assert.equal(typeof rest.rest, "number");
  assert.equal(vm.helpers.groups[2].tiles[0].rest, null);
});

test("Resting folds by default above 12 members; empty groups are left out", () => {
  const { s } = withAgents(Array.from({ length: 13 }, () => "idle"));
  const vm = v(s);
  assert.deepEqual(vm.helpers.groups.map((g) => [g.key, g.folded]), [["resting", true]]);
  const { s: s12 } = withAgents(Array.from({ length: 12 }, () => "idle"));
  assert.equal(v(s12).helpers.groups[0].folded, false);
});

test("r4-12: Resting does not auto-fold while a resting parent's fledgling waits (its flag stays in sight)", () => {
  const s = seeded(3);
  const me = writer(s, "wA");
  const agents = Array.from({ length: 13 }, (_, i) => agent(i, "idle"));
  me.act(observeAction(T0, [...agents, kid(40, 5, "working")]));
  assert.equal(v(s, T0 + 1000).helpers.groups.find((g) => g.key === "resting").folded, true, "a working fledgling does not stop the fold");
  me.act(observeAction(T0 + 5000, [...agents, kid(40, 5, "blocked")]));
  const vm = v(s, T0 + 6000);
  const rest = vm.helpers.groups.find((g) => g.key === "resting");
  assert.equal(rest.count, 13);
  assert.equal(rest.folded, false, "the waiting fledgling's parent is drawn");
  assert.ok(rest.tiles.find((x) => x.helperId === id(5)).pips.includes("blocked"));
  assert.equal(vm.header.counts.needs, 1);
  // Back to work: the group folds again.
  me.act(observeAction(T0 + 10000, [...agents, kid(40, 5, "working")]));
  assert.equal(v(s, T0 + 11000).helpers.groups.find((g) => g.key === "resting").folded, true);
});

test("workspace order: one list by space → tab → pane (natural), no status groups (§3.3)", () => {
  const extra = {
    0: { space: "web", tab: "tab 2", pane: "p1" },
    1: { space: "api", tab: "tab 10", pane: "p1" },
    2: { space: "api", tab: "tab 2", pane: "p9" },
    3: { space: "api", tab: "tab 2", pane: "p10" },
  };
  const { s } = withAgents(["blocked", "working", "idle", "done"], extra);
  s.settings.order = "workspace";
  const vm = v(s);
  assert.equal(vm.helpers.groups.length, 1);
  assert.equal(vm.helpers.groups[0].key, "all");
  assert.deepEqual(vm.helpers.groups[0].tiles.map((x) => x.helperId), [id(2), id(3), id(1), id(0)]);
  // The ribbon and rail follow the same order.
  assert.deepEqual(vm.ribbon.marks.map((m) => m.helperId), [id(2), id(3), id(1), id(0)]);
  assert.deepEqual(vm.rail.pips.map((m) => m.helperId), [id(2), id(3), id(1), id(0)]);
});

test("fledglings are pips on their parent; a parentless fledgling gets its own tile", () => {
  const s = seeded(3);
  const me = writer(s, "wA");
  me.act(observeAction(T0, [agent(1, "working"), kid(2, 1, "working"), kid(3, 1, "blocked"), kid(4, 99, "idle")]));
  const vm = v(s);
  const all = tiles(vm);
  assert.deepEqual(all.map((x) => x.helperId).sort(), [id(1), id(4)].sort());
  const parent = all.find((x) => x.helperId === id(1));
  assert.deepEqual(parent.pips, ["blocked", "working"], "waiting fledglings first (r1-14)");
  assert.equal(all.find((x) => x.helperId === id(4)).kind, "kid");
  // A blocked fledgling does not lift its parent's tile (§5.2), but it needs
  // you: it counts in Needs you and gets its own needs-you mark (r2-17).
  assert.equal(parent.status, "working");
  assert.equal(vm.header.counts.needs, 1);
  assert.equal(vm.header.kidsWaiting, 1);
  assert.deepEqual(vm.rail.pips.map((m) => [m.helperId, m.status]), [[id(3), "blocked"], [id(1), "working"], [id(4), "idle"]]);
});

test("r2-17: a waiting fledgling reaches every needs-you surface: counts, rail, mat chips, ribbon marks", () => {
  const s = seeded(3);
  const me = writer(s, "wA");
  me.act(observeAction(T0, [agent(1, "working"), agent(2, "blocked"), kid(3, 1, "working")]));
  me.act(observeAction(T0 + 5000, [agent(1, "working"), agent(2, "blocked"), kid(3, 1, "blocked")]));
  const k = id(3);
  for (const o of [{ width: 400 }, { width: 50 }, { role: "ribbon", width: 1172 }]) {
    const vm = engine.view(s, T0 + 6000, { role: "panel", writer: "wA", ...o });
    const where = JSON.stringify(o);
    assert.equal(vm.header.counts.needs, 2, `${where}: counts`);
    assert.equal(vm.rail.needs, 2, `${where}: rail button`);
    assert.deepEqual(vm.mat.chips.map((c) => c.helperId), [id(2), k], `${where}: mat chips, longest waiting first`);
    const m = vm.ribbon.marks.find((x) => x.helperId === k);
    assert.ok(m, `${where}: a ribbon mark`);
    assert.equal(m.status, "blocked");
    assert.match(m.tooltip, /fledgling of .* Needs you/);
    assert.deepEqual(vm.rail.pips.filter((x) => x.status === "blocked").map((x) => x.helperId), [id(2), k], `${where}: rail pips`);
  }
  // The Flock tiles stay per tile: the parent is Working with a blocked pip; the tab total counts tiles.
  const vm = engine.view(s, T0 + 6000, { role: "panel", width: 320, writer: "wA" });
  assert.deepEqual(tiles(vm).map((x) => x.helperId).sort(), [id(1), id(2)].sort());
  assert.deepEqual(vm.helpers.groups.find((g) => g.key === "needs").tiles.map((x) => x.helperId), [id(2)]);
  assert.deepEqual(tiles(vm).find((x) => x.helperId === id(1)).pips, ["blocked"]);
  // Workspace order: the fledgling's mark follows its parent.
  s.settings.order = "workspace";
  const ws = engine.view(s, T0 + 6000, { role: "ribbon", width: 1172, writer: "wA" });
  const ids = ws.ribbon.marks.map((x) => x.helperId);
  assert.equal(ids.indexOf(k), ids.indexOf(id(1)) + 1);
  assert.equal(ids.length, 3);
});

test("needsGroup: the Flock section a needs tally scrolls to, the parent's group when only fledglings wait", () => {
  const s = seeded(3);
  const me = writer(s, "wA");
  me.act(observeAction(T0, [agent(1, "working"), agent(2, "idle"), kid(3, 1, "working")]));
  assert.equal(v(s, T0 + 1000).helpers.needsGroup, null, "nobody needs you");
  me.act(observeAction(T0 + 5000, [agent(1, "working"), agent(2, "idle"), kid(3, 1, "blocked")]));
  let vm = v(s, T0 + 6000);
  assert.equal(vm.header.counts.needs, 1);
  assert.equal(vm.helpers.groups.some((g) => g.key === "needs"), false, "no Needs you section");
  assert.equal(vm.helpers.needsGroup, "working", "the parent's tile, which carries the waiting pip");
  me.act(observeAction(T0 + 7000, [agent(1, "working"), agent(2, "blocked"), kid(3, 1, "blocked")]));
  vm = v(s, T0 + 8000);
  assert.equal(vm.helpers.needsGroup, "needs", "Needs you holds a tile");
  s.settings.order = "workspace";
  assert.equal(v(s, T0 + 8000).helpers.needsGroup, "all");
});

test("r2-17: a waiting fledgling another window sees is not counted here", () => {
  const s = seeded(3);
  const me = writer(s, "wA");
  me.act(observeAction(T0, [agent(1, "working"), kid(3, 1, "blocked")]));
  s.helpers[id(3)].seenBy = "wB";
  const vm = engine.view(s, T0 + 1000, { role: "panel", width: 320, writer: "wA" });
  assert.equal(vm.header.counts.needs, 0);
  assert.equal(vm.header.kidsWaiting, 0);
});

test("Elsewhere: helpers another window last saw; 50 % marks, last in the ribbon (§12.5)", () => {
  const { s } = withAgents(["working", "idle"]);
  const other = writer(s, "wB");
  other.act(observeAction(T0 + 1000, [agent(7, "blocked"), agent(8, "working")]));
  const vm = v(s, T0 + 2000);
  assert.deepEqual(vm.helpers.elsewhere.map((x) => x.helperId), [id(7), id(8)]);
  assert.ok(vm.helpers.elsewhere.every((x) => x.opacity === 0.5 && !x.pulse && !x.spin));
  assert.equal(vm.header.counts.needs, 0);
  assert.deepEqual(vm.ribbon.marks.slice(-2).map((m) => [m.helperId, m.opacity]), [[id(7), 0.5], [id(8), 0.5]]);
  assert.ok(vm.helpers.elsewhere[0].tooltip.includes("another window"));
  // Seen from wB, it is the other way round.
  const vb = engine.view(s, T0 + 2000, { role: "panel", writer: "wB" });
  assert.deepEqual(vb.helpers.elsewhere.map((x) => x.helperId).sort(), [id(0), id(1)].sort());
});

test("Album: compact records, most recent first, left-ago and lifetime folds", () => {
  const { s, me } = withAgents(["working", "working", "idle"]);
  s.helpers[id(0)].stats.folds = 1.3e6;
  me.act(observeAction(T0 + 1000, [agent(2, "idle")]));
  me.act(observeAction(T0 + 3600000, []));
  const vm = v(s, T0 + 3 * 86400000);
  assert.deepEqual(vm.helpers.album.map((a) => a.helperId), [id(2), id(0), id(1)]);
  const a0 = vm.helpers.album.find((a) => a.helperId === id(0));
  assert.equal(a0.folds, engine.formatCount(1.3e6));
  assert.equal(a0.leftAgo, "2 d");
  assert.deepEqual(Object.keys(a0).sort(), ["folds", "helperId", "hue", "leftAgo", "name", "species"]);
  assert.equal(vm.helpers.empty, true);
  assert.equal(vm.helpers.legend, true);
});

test("density: auto is dense from 21 tiles; always / never / opts.dense override", () => {
  const { s: s20 } = withAgents(Array.from({ length: 20 }, () => "working"));
  const { s: s21 } = withAgents(Array.from({ length: 21 }, () => "working"));
  assert.equal(v(s20).helpers.dense, false);
  assert.equal(v(s21).helpers.dense, true);
  s21.settings.density = "never";
  assert.equal(v(s21).helpers.dense, false);
  s20.settings.density = "always";
  assert.equal(v(s20).helpers.dense, true);
  assert.equal(v(s20, T0, { dense: false }).helpers.dense, false);
});

test("r3-19: density auto is dense in the narrow panel (200-279 px) whatever the count", () => {
  const { s } = withAgents(Array.from({ length: 6 }, () => "working"));
  assert.equal(v(s, T0, { width: 320 }).helpers.dense, false);
  assert.equal(v(s, T0, { width: 280 }).helpers.dense, false);
  assert.equal(v(s, T0, { width: 279 }).helpers.dense, true);
  assert.equal(v(s, T0, { width: 226 }).helpers.dense, true);
  assert.equal(v(s, T0, { width: 200 }).helpers.dense, true);
  s.settings.density = "never";
  assert.equal(v(s, T0, { width: 226 }).helpers.dense, false, "Never wins over narrow");
  s.settings.density = "auto";
  assert.equal(v(s, T0, { width: 226, dense: false }).helpers.dense, false, "opts.dense overrides");
});

// ---------------------------------------------------------------------------
// Ribbon and rail

test("ribbon levels A/B/C follow the §3.10 formula at 1100 and 1440", () => {
  // 1440: W = 1172, w = 922 → A ≤ 41, B ≤ 130. 1100: W = 832, w = 582 → A ≤ 26, B ≤ 82.
  assert.equal(engine.ribbonLevel(41, 1172), "A");
  assert.equal(engine.ribbonLevel(42, 1172), "B");
  assert.equal(engine.ribbonLevel(130, 1172), "B");
  assert.equal(engine.ribbonLevel(131, 1172), "C");
  assert.equal(engine.ribbonLevel(26, 832), "A");
  assert.equal(engine.ribbonLevel(27, 832), "B");
  assert.equal(engine.ribbonLevel(82, 832), "B");
  assert.equal(engine.ribbonLevel(83, 832), "C");
  assert.equal(engine.ribbonLevel(0, 832), "A");
});

test("r8-09: Flock tiles are built only where the Flock grid is drawn; every copy keeps the groups and counts", () => {
  const statuses = Array.from({ length: 30 }, (_, i) => ["working", "idle", "blocked", "done"][i % 4]);
  const { s } = withAgents(statuses);
  writer(s, "wB").act(observeAction(T0 + 500, [agent(90, "working"), agent(91, "blocked")]));
  const flockVm = v(s, T0 + 1000);
  const shape = (vm) => vm.helpers.groups.map((g) => [g.key, g.count, g.folded]);
  assert.equal(tiles(flockVm).length, 30);
  assert.equal(flockVm.helpers.elsewhere.length, 2);
  assert.equal(flockVm.helpers.elsewhereCount, 2);
  for (const [where, vm] of [
    ["shop tab", v(s, T0 + 1000, { tab: "shop" })],
    ["settings tab", v(s, T0 + 1000, { tab: "settings" })],
    ["rail", v(s, T0 + 1000, { width: 64 })],
    ["ribbon", engine.view(s, T0 + 1000, { role: "ribbon", width: 1172, writer: "wA" })],
  ]) {
    assert.equal(tiles(vm).length, 0, `${where}: no tiles built`);
    assert.deepEqual(vm.helpers.elsewhere, [], where);
    assert.equal(vm.helpers.elsewhereCount, 2, where);
    assert.deepEqual(shape(vm), shape(flockVm), `${where}: same groups and counts`);
    assert.equal(vm.helpers.needsGroup, flockVm.helpers.needsGroup, where);
    assert.deepEqual(vm.header.counts, flockVm.header.counts, where);
    // the ribbon and rail marks do not depend on the tab
    assert.deepEqual(vm.rail.pips, flockVm.rail.pips, where);
  }
});

test("r8-10: the rail draws every helper up to RAIL_PIPS; past it needs-you and finished pips stay, the rest are tallies, every helper counted", () => {
  assert.equal(RAIL_PIPS, 240);
  const counted = (rail) => rail.pips.length + rail.tallies.reduce((a, x) => a + x.count, 0);
  // 240 helpers: all pips, no tallies
  {
    const { s } = withAgents(Array.from({ length: RAIL_PIPS }, (_, i) => ["working", "idle", "blocked", "done"][i % 4]));
    const rail = v(s, T0, { width: 64 }).rail;
    assert.equal(rail.pips.length, RAIL_PIPS);
    assert.deepEqual(rail.tallies, []);
  }
  // 600 local + 40 in another window: 150 needs-you and 150 finished pips (needs first), tallies for the rest
  {
    const { s } = withAgents(Array.from({ length: 600 }, (_, i) => ["working", "idle", "blocked", "done"][i % 4]));
    writer(s, "wB").act(observeAction(T0 + 500, Array.from({ length: 40 }, (_, i) => agent(1000 + i, i % 2 ? "blocked" : "working"))));
    const all = engine.view(s, T0 + 1000, { role: "ribbon", width: 99999, writer: "wA" }).ribbon.marks;
    assert.equal(all.length, 640, "a very wide ribbon still draws every mark");
    const rail = v(s, T0 + 1000, { width: 64 }).rail;
    assert.equal(rail.pips.length, RAIL_PIPS);
    assert.ok(rail.pips.every((m) => m.opacity === 1 && (m.status === "blocked" || m.status === "done")));
    assert.equal(rail.pips.filter((m) => m.status === "blocked").length, 150);
    assert.equal(rail.pips.filter((m) => m.status === "done").length, 90);
    // in mark order (needs-you first), each with its full tooltip
    const order = all.filter((m) => rail.pips.some((p) => p.helperId === m.helperId)).map((m) => m.helperId);
    assert.deepEqual(rail.pips.map((m) => m.helperId), order);
    for (const m of rail.pips) assert.deepEqual(m, all.find((x) => x.helperId === m.helperId));
    assert.deepEqual(rail.tallies.map((x) => [x.status, x.count, x.label]), [["done", 60, "+60"], ["working", 150, "150"], ["idle", 150, "150"], ["elsewhere", 40, "40"]]);
    assert.equal(rail.tallies[0].tooltip, "60 more finished");
    assert.equal(rail.tallies.at(-1).tooltip, "40 in another window");
    assert.equal(counted(rail), 640);
  }
  // needs-you alone over the budget: the longest-joined 240 are pips, then "+60 need you"; all finished in one tally
  {
    const { s } = withAgents(Array.from({ length: 360 }, (_, i) => (i < 300 ? "blocked" : "done")));
    const rail = v(s, T0, { width: 64 }).rail;
    assert.equal(rail.pips.length, RAIL_PIPS);
    assert.deepEqual(rail.tallies.map((x) => [x.status, x.count, x.label, x.tooltip]), [["blocked", 60, "+60", "60 more need you"], ["done", 60, "60", "60 finished"]]);
    assert.equal(counted(rail), 360);
  }
});

test("ribbon C: needs-you and finished stay individual, the rest become tallies; 64 stay individual", () => {
  const statuses = Array.from({ length: 90 }, (_, i) => ["working", "idle", "blocked", "working", "done", "idle"][i % 6]);
  const { s } = withAgents(statuses);
  const at1100 = engine.view(s, T0, { role: "ribbon", width: 832, writer: "wA" });
  assert.equal(at1100.ribbon.level, "C");
  assert.ok(at1100.ribbon.marks.every((m) => m.status === "blocked" || m.status === "done"));
  assert.equal(at1100.ribbon.marks.length, 30);
  assert.deepEqual(at1100.ribbon.tallies.map((x) => [x.status, x.count]), [["working", 30], ["idle", 30]]);
  const at1440 = engine.view(s, T0, { role: "ribbon", width: 1172, writer: "wA" });
  assert.equal(at1440.ribbon.level, "B");
  assert.equal(at1440.ribbon.marks.length, 90);
  assert.equal(at1440.ribbon.tallies.length, 0);
  // Group order, join order inside (needs first, then finished, working, resting).
  const rank = { blocked: 0, done: 1, working: 2, idle: 3 };
  const ranks = at1440.ribbon.marks.map((m) => rank[m.status]);
  assert.deepEqual(ranks, ranks.slice().sort((a, b) => a - b));
  // The rail keeps every helper individually (up to RAIL_PIPS, r8-10).
  assert.equal(at1100.rail.pips.length, 90);
  assert.deepEqual(at1100.rail.tallies, []);
  const { s: s64 } = withAgents(statuses.slice(0, 64));
  for (const W of [832, 1172]) assert.notEqual(engine.view(s64, T0, { role: "ribbon", width: W }).ribbon.level, "C");
});

test("r4-07: ribbon C fits the width: finished past the edge become '+N', then needs-you; every helper counted", () => {
  // Pips 14 px a column of two; tallies 34 + label (digits 7.2 px, '+' 6.4) and a 4 px gap.
  const tallyPx = (label) => 34 + Math.ceil([...String(label)].reduce((a, c) => a + (/[0-9A-Z]/.test(c) ? 7.2 : 6.4), 0));
  const need = (r) => Math.ceil(r.marks.length / 2) * 14 + r.tallies.reduce((a, t) => a + 4 + tallyPx(t.label), 0);
  const mix = (nb, nd, nw, ni) => Array.from({ length: nb + nd + nw + ni }, (_, i) => (i < nb ? "blocked" : i < nb + nd ? "done" : i < nb + nd + nw ? "working" : "idle"));
  // The finding: 130 agents, 10 need you, 90 finished (herdr's unseen "done"), at the 1100 window (W 832).
  const { s } = withAgents(mix(10, 90, 20, 10));
  const r = engine.view(s, T0, { role: "ribbon", width: 832, writer: "wA" }).ribbon;
  assert.equal(r.level, "C");
  assert.ok(need(r) <= r.width, `${need(r)} px in ${r.width}`);
  assert.ok(r.width - need(r) < 28 + tallyPx("+99"), "the pips fill what the tallies leave");
  assert.equal(r.marks.filter((m) => m.status === "blocked").length, 10, "every needs-you helper keeps its pip");
  const done = r.marks.filter((m) => m.status === "done").length;
  assert.ok(done > 0 && done < 90);
  assert.deepEqual(r.tallies.map((t) => [t.status, t.count, t.label]), [["done", 90 - done, `+${90 - done}`], ["working", 20, "20"], ["idle", 10, "10"]]);
  assert.equal(r.tallies[0].tooltip, `${90 - done} more finished`);
  // Marks keep group order (needs first).
  assert.ok(r.marks.slice(0, 10).every((m) => m.status === "blocked"));
  // Needs-you alone overflowing: all finished fold, the needs-you past the edge become "+N".
  const { s: s2 } = withAgents(mix(110, 10, 6, 4));
  const r2 = engine.view(s2, T0, { role: "ribbon", width: 832, writer: "wA" }).ribbon;
  assert.ok(need(r2) <= r2.width);
  assert.ok(r2.marks.length > 0 && r2.marks.every((m) => m.status === "blocked"));
  assert.deepEqual(r2.tallies.map((t) => [t.status, t.count]), [["blocked", 110 - r2.marks.length], ["done", 10], ["working", 6], ["idle", 4]]);
  assert.equal(r2.tallies[0].label, `+${110 - r2.marks.length}`);
  assert.match(r2.tallies[0].tooltip, /more need you$/);
  // Every mix and width: everyone a pip or counted, and never past the width.
  for (const m of [[0, 200, 0, 0], [200, 0, 0, 0], [5, 5, 100, 100], [40, 60, 20, 10]]) {
    const { s: sm } = withAgents(mix(...m));
    for (const W of [600, 832, 1172]) {
      const rm = engine.view(sm, T0, { role: "ribbon", width: W, writer: "wA" }).ribbon;
      const n = m.reduce((a, b) => a + b, 0);
      assert.equal(rm.marks.length + rm.tallies.reduce((a, t) => a + t.count, 0), n, `${m} @ ${W}`);
      if (rm.level === "C") assert.ok(need(rm) <= rm.width, `${m} @ ${W}: ${need(rm)} > ${rm.width}`);
      assert.ok(rm.tallies.every((t) => t.count > 0), `${m} @ ${W}: no empty tally`);
    }
  }
});

test("marks: status, hue, envelope, dashed needs-you, tooltip with the wait", () => {
  const { s } = withAgents(["blocked", "working"], { 0: { title: "claude · fix flaky test", space: "api", tab: "tab 2" } });
  s.helpers[id(0)].blockedAt = T0 - 240000;
  s.envelopes[id(0)] = { type: "rush", units: 1, landedAt: T0 - 60000, lastAt: T0 - 60000 };
  const m = engine.view(s, T0, { role: "ribbon", width: 832, writer: "wA" }).ribbon.marks[0];
  assert.deepEqual(Object.keys(m).sort(), ["dashed", "envelope", "helperId", "hue", "opacity", "status", "tooltip"]);
  assert.equal(m.status, "blocked");
  assert.equal(m.envelope, true);
  assert.equal(m.dashed, true);
  assert.equal(m.tooltip, `${s.helpers[id(0)].name} — claude · api / tab 2 — Needs you · 4 m`);
});

// ---------------------------------------------------------------------------
// Loop budget (§13.5)

test("steady state: no loop flags at all", () => {
  const { s } = withAgents(Array.from({ length: 30 }, (_, i) => ["working", "idle", "blocked"][i % 3]));
  for (let i = 0; i < 12; i++) s.envelopes[id(i)] = { type: "bundle", units: 1, landedAt: T0 - 600000 + i, lastAt: T0 - 600000 + i };
  for (const tab of ["flock", "shop"]) assert.equal(loopCount(v(s, T0, { tab })), 0);
});

test("needs-you pulse: the ≤ 6 most recent waits within 10 s; tiles on Flock, else the mat chips", () => {
  const { s } = withAgents(Array.from({ length: 9 }, () => "blocked"));
  for (let i = 0; i < 9; i++) s.helpers[id(i)].blockedAt = T0 - 1000 * (i + 1); // 0 is the most recent
  s.helpers[id(8)].blockedAt = T0 - 11000; // outside 10 s
  const vm = v(s);
  const pulsing = tiles(vm).filter((x) => x.pulse).map((x) => x.helperId);
  assert.deepEqual(pulsing.sort(), [0, 1, 2, 3, 4, 5].map((i) => id(i)).sort());
  assert.ok(vm.mat.chips.every((c) => !c.pulse), "one mark per helper per copy");
  // Mat chips: longest waiting first, 4 drawn, +n; only drawn chips pulse.
  const shop = v(s, T0, { tab: "shop" });
  assert.deepEqual(shop.mat.chips.map((c) => c.helperId), [id(8), id(7), id(6), id(5)]);
  assert.equal(shop.mat.more, 5);
  assert.deepEqual(shop.mat.chips.map((c) => c.pulse), [false, true, true, true]); // 8 waited 11 s
  assert.ok(tiles(shop).every((x) => !x.pulse));
  // After 10 s nothing pulses.
  assert.equal(loopCount(v(s, T0 + 11000)), 0);
});

test("new-work spin: ≤ 4 latest starts within 20 s; In step: ≤ 6 working badges instead", () => {
  const { s, me } = withAgents(Array.from({ length: 8 }, () => "idle"));
  // Six go to work at different times (rest > 0 → warm, which marks the start).
  for (let i = 0; i < 6; i++) s.helpers[id(i)].rest = 0.5;
  me.act(observeAction(T0 + 1000, Array.from({ length: 8 }, (_, i) => agent(i, i < 6 ? "working" : "idle"))));
  for (let i = 0; i < 6; i++) s.helpers[id(i)].warmUntil = T0 + 1000 * (i + 1) + 20 * 60000;
  const at = T0 + 10000;
  assert.equal(engine.workStart(s.helpers[id(5)]), T0 + 6000);
  const spun = tiles(v(s, at)).filter((x) => x.spin).map((x) => x.helperId);
  assert.deepEqual(spun.sort(), [2, 3, 4, 5].map((i) => id(i)).sort());
  assert.equal(tiles(v(s, T0 + 30000)).filter((x) => x.spin).length, 0, "20 s after the start: static");
  assert.equal(tiles(v(s, at, { tab: "shop" })).filter((x) => x.spin).length, 0, "panel Flock tiles only");
  // In step: the first 6 working badges in display order spin.
  s.hand.r = 30;
  s.hand.lastHitAt = at - 100;
  s.presence.lastHandAt = at - 100;
  const step = v(s, at);
  assert.equal(step.streak.inStep, true);
  assert.deepEqual(step.helpers.groups.find((g) => g.key === "working").tiles.map((x) => x.spin), [true, true, true, true, true, true]);
  // The ribbon copy has no loops.
  assert.equal(loopCount(engine.view(s, at, { role: "ribbon", width: 832 })), 0);
});

test("r3-15: envelope tooltips say when to open: Chorus while helpers work, Rush and Storm when ready to click", () => {
  const { s } = withAgents(["working", "working", "working"]);
  s.envelopes[id(0)] = { type: "chorus", units: 1, landedAt: T0 - 50000, lastAt: T0 - 50000 };
  s.envelopes[id(1)] = { type: "rush", units: 1, landedAt: T0 - 40000, lastAt: T0 - 40000 };
  s.envelopes[id(2)] = { type: "storm", units: 1, landedAt: T0 - 30000, lastAt: T0 - 30000 };
  const tips = v(s).tray.envelopes.map((e) => e.tooltip);
  assert.match(tips[0], /^Chorus ×2 for .* · open while your helpers are working$/);
  assert.doesNotMatch(tips[0], /click/);
  assert.match(tips[1], /^Rush ×3 for .* · open when you're ready to click$/);
  assert.match(tips[2], / · open when you're ready to click$/);
});

test("r8-02: a fresh boost's tooltip says the capped time opening it gives, marked (max) at the cap", () => {
  // Read each tooltip's duration, then open the envelope for real and compare.
  const secs = (txt) => {
    const m = /for ((?:\d+m)?\s?(?:\d+s)?) /.exec(txt);
    assert.ok(m, txt);
    let n = 0;
    for (const [, k, unit] of m[1].matchAll(/(\d+)([ms])/g)) n += Number(k) * (unit === "m" ? 60 : 1);
    return n;
  };
  const granted = { rush: (s, t) => s.boosts.rushEnd - t, storm: (s, t) => s.boosts.stormEnd - t, chorus: (s) => s.boosts.chorus };
  const cases = [
    // [ribbons, type, units, seconds shown, (max)?]
    [[], "rush", 1, 30, false],
    [[], "rush", 9, 90, true], // exactly the cap
    [[], "storm", 7, 30, true], // 12 · 2.5 = 30 s: exactly the cap
    [[], "storm", 8, 30, true], // 33 s raw
    [[], "chorus", 6, 240, true], // 270 s raw
    [["long-ribbon", "longer-ribbon"], "rush", 9, 90, true], // 180 s raw
    [["long-ribbon", "longer-ribbon"], "storm", 9, 30, true], // 72 s raw
    [["long-ribbon", "longer-ribbon"], "chorus", 9, 240, true], // 720 s raw
    [["long-ribbon"], "chorus", 1, 180, false],
  ];
  for (const [ribbons, type, units, shown, max] of cases) {
    const { s, me } = withAgents(["working", "working", "working"]);
    for (const r of ribbons) s.bought[r] = true;
    s.envelopes[id(0)] = { type, units, landedAt: T0 - 50000, lastAt: T0 - 50000 };
    const tip = v(s).tray.envelopes[0].tooltip;
    const label = `${ribbons.join("+") || "no ribbon"} ${type} ×${units}: ${tip}`;
    assert.equal(secs(tip), shown, label);
    assert.equal(/ \(max\) · /.test(tip), max, label);
    me.act({ t: T0, type: "open", helperId: id(0) });
    assert.equal(s.envelopes[id(0)], undefined, label);
    assert.equal(Math.round(granted[type](s, T0) / 1000), shown, `${label}: opening grants what it says`);
  }
});

test("envelope bob: the newest drawn envelope for 10 s after it lands", () => {
  const { s } = withAgents(["working", "working", "working"]);
  s.envelopes[id(0)] = { type: "bundle", units: 1, landedAt: T0 - 50000, lastAt: T0 - 50000 };
  s.envelopes[id(1)] = { type: "rush", units: 2.25, landedAt: T0 - 4000, lastAt: T0 - 4000 };
  const vm = v(s);
  assert.deepEqual(vm.tray.envelopes.map((e) => [e.helperId, e.bob]), [[id(0), false], [id(1), true]]);
  assert.equal(vm.tray.envelopes[1].label, "×2.3"); // one decimal below 10 (r5-15: fits the envelope at 11 px)
  assert.match(vm.tray.envelopes[1].tooltip, /^Rush ×3 for .* open when you're ready to click$/);
  assert.equal(v(s, T0 + 7000).tray.envelopes[1].bob, false);
  assert.equal(v(s, T0, { matShown: false }).tray.envelopes[1].bob, false);
  // Oldest first, 6 drawn, then +n.
  for (let i = 2; i < 3; i++) s.envelopes[id(i)] = { type: "bundle", units: 1, landedAt: T0 - 1000, lastAt: T0 - 1000 };
  for (let i = 10; i < 16; i++) s.envelopes[`x${i}`] = { type: "bundle", units: 1, landedAt: T0 - 100000 + i, lastAt: T0 - 100000 + i };
  const full = v(s);
  assert.equal(full.tray.envelopes.length, 6);
  assert.equal(full.tray.more, 3);
  assert.ok(full.tray.envelopes.every((e) => !e.bob), "the newest is not drawn, so nothing bobs");
});

test("calm mode: every loop flag is false; the crane and boat sit still", () => {
  const { s } = withAgents(["blocked", "working", "working"]);
  s.helpers[id(0)].blockedAt = T0 - 1000;
  s.helpers[id(1)].joined = T0 - 2000;
  s.envelopes[id(2)] = { type: "bundle", units: 1, landedAt: T0 - 1000, lastAt: T0 - 1000 };
  s.spawn.crane = { id: "g9", slot: 9, born: s.spawn.shownMs - 4000, outcome: "gift" };
  s.spawn.boat = { id: "b9", born: s.spawn.shownMs - 4000 };
  s.boosts.stormEnd = T0 + 5000;
  s.ui.hints.fold = false;
  s.stats.hits = 0;
  assert.ok(loopCount(v(s)) >= 5);
  s.settings.calm = true;
  const vm = v(s);
  assert.equal(loopCount(vm), 0);
  assert.equal(vm.mat.storm, false);
  assert.equal(vm.mat.crane.x1, vm.mat.crane.x);
  assert.equal(vm.mat.boat.x1, vm.mat.boat.x);
  assert.equal(vm.sheet.firstRunHint, true, "the hint stays, static");
  assert.equal(vm.settings.pops, false);
  assert.equal(vm.settings.popsDisabled, true);
});

test("priority: needs-you > crane > storm > envelope > In step > new work > hint, ≤ 12 per copy", () => {
  const statuses = Array.from({ length: 6 }, () => "blocked").concat(Array.from({ length: 8 }, () => "working"));
  const { s } = withAgents(statuses);
  for (let i = 0; i < 6; i++) s.helpers[id(i)].blockedAt = T0 - 500 * (i + 1);
  s.envelopes[id(6)] = { type: "bundle", units: 1, landedAt: T0 - 1000, lastAt: T0 - 1000 };
  s.spawn.crane = { id: "g9", slot: 9, born: s.spawn.shownMs, outcome: "gift" };
  s.boosts.stormEnd = T0 + 10000;
  s.ui.hints.fold = false;
  s.stats.hits = 1;
  s.hand.r = 30;
  s.hand.lastHitAt = T0 - 100;
  const vm = v(s);
  assert.equal(tiles(vm).filter((x) => x.pulse).length, 6);
  assert.equal(vm.mat.crane.bob, true);
  assert.equal(vm.mat.storm, true);
  assert.equal(vm.tray.envelopes[0].bob, true);
  assert.equal(tiles(vm).filter((x) => x.spin).length, 3, "In step spins get what is left of 12");
  assert.equal(vm.sheet.hintBob, false, "the first-run hint drops first");
  assert.equal(loopCount(vm), 12);
  // Without the storm and the crane the spins get two more, and still no hint.
  s.spawn.crane = null;
  s.boosts.stormEnd = 0;
  const vm2 = v(s);
  assert.equal(tiles(vm2).filter((x) => x.spin).length, 5);
  assert.equal(vm2.sheet.hintBob, false);
  assert.equal(loopCount(vm2), 12);
});

// ---------------------------------------------------------------------------
// Header, streak, boosts

test("header, streak and boost bar are pre-formatted", () => {
  const { s } = withAgents(["working"]);
  s.bank = 12480;
  s.wishes = 12;
  s.hand.r = 16;
  s.hand.lastHitAt = T0 - 200;
  s.hand.afterglowMs = 12 * 60000;
  s.boosts.rushEnd = T0 + 52000;
  s.boosts.chorus = 90000;
  const vm = v(s);
  assert.equal(vm.header.folds, "12.5K");
  assert.match(vm.header.rate, /^\+[\d.,]+\/s$/);
  assert.equal(vm.header.wishes, 12);
  assert.equal(vm.streak.label, "×1.2");
  assert.equal(vm.streak.fill, 0.4);
  assert.equal(vm.streak.afterglow, "12m");
  // r5-14: what the bank does, for the footer chip
  assert.equal(vm.streak.afterglowText, "Afterglow ×1.25 · 12m");
  s.bought["shared-rhythm"] = true;
  assert.equal(v(s).streak.afterglowText, "Afterglow ×1.5 · 12m");
  delete s.bought["shared-rhythm"];
  // A lapsed rhythm reads as 0 (the stored r is kept, B9).
  assert.equal(v(s, T0 + 5000).streak.label, "×1.0");
  assert.deepEqual(vm.boosts.map((b) => [b.type, b.label, b.msLeft, b.msTotal]), [
    ["rush", "Rush ×3", 52000, 90000], ["chorus", "Chorus ×2", 90000, 240000],
  ]);
  // Confetti (internal id "storm", review r6) hand hits ×6, ×9 with Gale Charm.
  s.boosts.stormEnd = T0 + 10000;
  assert.deepEqual(v(s).boosts.find((b) => b.type === "storm").label, "Confetti ×6");
  s.bought["gale-charm"] = true;
  assert.deepEqual(v(s).boosts.find((b) => b.type === "storm").label, "Confetti ×9");
  delete s.bought["gale-charm"];
  s.boosts.stormEnd = 0;
  assert.equal(v(s, T0, { style: "sci" }).header.folds, "1.25e4");
});

// ---------------------------------------------------------------------------
// Shop

test("shop: reveal rules, eta at the passive rate, tier sub-rows, best buy = shortest payback", () => {
  const { s } = withAgents(["working"]);
  s.bank = 1000;
  s.owned["paper-stack"] = 10;
  let vm = v(s);
  const works = vm.shop.segments.works;
  assert.equal(works.length, 9);
  assert.deepEqual(works.map((r) => r.revealed), [true, true, false, false, false, false, false, false, false]);
  assert.equal(works[0].sub.length, 1);
  assert.equal(works[0].sub[0].id, "paper-stack-t1");
  assert.equal(works[0].sub[0].tier, true);
  assert.equal(works[0].owned, 10);
  assert.equal(works[1].owned, 0);
  // Upgrades: cost ≤ 3 × bank (3,000) reveals; Echo II only after Echo I.
  const tools = vm.shop.segments.tools;
  const row = (seg, item) => vm.shop.segments[seg].find((r) => r.id === item);
  assert.equal(row("tools", "crisp-corners").revealed, true);
  assert.equal(row("tools", "bone-tip-nail").revealed, true);
  assert.equal(row("tools", "echo-1").revealed, true);
  assert.equal(row("tools", "steady-rhythm").revealed, false);
  assert.equal(row("tools", "echo-2").revealed, false);
  assert.equal(tools.length, engine.CONTENT.UPGRADES.filter((u) => u.seg === "tools").length);
  // Unaffordable: eta at the passive rate; affordable: none.
  const Rp = engine.rates(s, "wA").Rp;
  assert.equal(row("tools", "crisp-corners").affordable, true);
  assert.equal(row("tools", "crisp-corners").eta, null);
  const secs = Math.ceil((1500 - 1000) / Rp);
  assert.equal(row("tools", "bone-tip-nail").eta, `in ${Math.floor(secs / 60)}m ${secs % 60}s`);
  // Exactly one best buy, and it is affordable.
  const all = Object.values(vm.shop.segments).flat().flatMap((r) => [r, ...r.sub]);
  const best = all.filter((r) => r.best);
  assert.equal(best.length, 1);
  assert.equal(best[0].affordable, true);
  assert.match(best[0].tooltip, /^Best buy: pays back in /);
  // Owned upgrades stay in the segment with owned 1; a predecessor reveals its successor.
  s.bought["echo-1"] = true;
  vm = v(s);
  assert.equal(row("tools", "echo-1").owned, 1);
  assert.equal(row("tools", "echo-2").revealed, true);
  // Auto rows carry the switch state.
  s.bought["mail-sorter"] = true;
  s.auto["mail-sorter"] = false;
  vm = v(s);
  assert.equal(row("auto", "mail-sorter").on, false);
  assert.deepEqual(vm.settings.automations.find((a) => a.id === "mail-sorter"), { id: "mail-sorter", name: "Mail Sorter", owned: true, on: false });
  // ×10 and Max toggles price the workshop row accordingly.
  s.bank = 1e6;
  const ten = v(s, T0, { buyCount: 10 }).shop.segments.works[0];
  assert.equal(ten.count, 10);
  assert.equal(ten.cost, engine.formatCount(engine.workshopCost("paper-stack", 10, 10)));
  const max = v(s, T0, { buyCount: "max" }).shop.segments.works[0];
  assert.equal(max.count, engine.maxAffordable(s, "paper-stack"));
});

test("eta is null without a passive rate", () => {
  const s = seeded(3);
  const vm = v(s);
  assert.ok(Object.values(vm.shop.segments).flat().every((r) => r.eta === null));
});

// ---------------------------------------------------------------------------
// String, settings, away, notices

test("String tab: cranes of the gate, perks held, garlands", () => {
  const s = seeded(3);
  s.lifetime = 6e9;
  s.wishes = 0;
  let vm = v(s);
  assert.equal(vm.string.cranes, 1000);
  assert.equal(vm.string.of, 1000);
  assert.equal(vm.string.can, true);
  assert.equal(vm.string.gain, 10);
  assert.equal(vm.string.lifetime, "6.00B");
  assert.equal(vm.string.strands.length, 20);
  assert.ok(vm.string.strands.every((x) => x === 1));
  assert.equal(vm.string.button, "Make the wish (+10 Wishes)");
  s.wishes = 25;
  s.wishCount = 2;
  s.garlands = [{ wish: 1, day: "2026-11-03", stripes: [["hue:3", 0.4, "Mina"], ["hands", 0.6, "your hands"]], wishes: 10 }];
  vm = v(s);
  assert.deepEqual(vm.string.perks.map((p) => p.have), [true, true, false, false, false]);
  assert.deepEqual(vm.string.garlands, s.garlands);
});

test("settings vm: current values, sent today, automations", () => {
  const s = seeded(3);
  s.notify.sent = 2;
  s.settings.notify.master = true;
  const vm = v(s);
  assert.equal(vm.settings.notifySentToday, 2);
  assert.equal(vm.settings.notifyText, "2 of 3 sent today");
  assert.equal(vm.settings.notify.master, true);
  assert.deepEqual(vm.settings.automations.map((a) => a.id), engine.CONTENT.AUTOMATIONS.map((a) => a.id));
  s.notify.day = "2026-11-24"; // another day: nothing sent today
  assert.equal(v(s).settings.notifySentToday, 0);
});

test("away card from the pot (Collect), busy card from the notice, footer notices", () => {
  const { s, me } = withAgents(["working", "blocked", "idle"]);
  s.owned["paper-stack"] = 5;
  s.envelopes[id(0)] = { type: "bundle", units: 1, landedAt: T0, lastAt: T0 };
  const t1 = T0 + (7 * 60 + 42) * 60000;
  engine.advance(s, t1, "wA");
  let vm = v(s, t1);
  assert.equal(vm.away.kind, "away");
  assert.equal(vm.away.duration, "7 h 42 m");
  assert.equal(vm.away.capped, false);
  assert.equal(vm.away.collectable, true);
  assert.match(vm.away.folds, /^\+/);
  assert.deepEqual(Object.keys(vm.away.split), ["workshops", "helpers"]);
  assert.equal(vm.away.envelopes, 1);
  assert.deepEqual(vm.away.needs.map((x) => x.helperId), [id(1)]);
  assert.equal(vm.ribbon.pill, `Welcome back ${vm.away.folds}`);
  me.act({ t: t1 + 1000, type: "collect" });
  vm = v(s, t1 + 1000);
  assert.equal(vm.away, null);
  // A capped segment says so.
  engine.advance(s, t1 + 1000 + 11 * 3600000, "wA");
  vm = v(s, t1 + 1000 + 11 * 3600000);
  assert.equal(vm.away.capped, true);
  assert.match(vm.away.capText, /^You were away 11 h; helpers fold for at most 8 h/);
  // Busy: the notice the engine writes after a live absence of 30 min.
  const s2 = seeded(3);
  s2.notices.push({ kind: "busy", at: T0, data: { seconds: 42 * 60, folds: 212400, tasks: 3, envelopes: 3 } });
  s2.notices.push({ kind: "overflow", at: T0 - 5, data: { helperId: "x", name: "Pib", amount: 3200 } });
  s2.notices.push({ kind: "clock", at: T0 - 9 });
  vm = v(s2);
  assert.equal(vm.away.kind, "busy");
  assert.equal(vm.away.duration, "42 m");
  assert.equal(vm.away.folds, "+212K");
  assert.equal(vm.away.collectable, false);
  assert.deepEqual(vm.notices.map((n) => [n.kind, n.place]), [["overflow", "footer"], ["clock", "banner"]]);
  assert.equal(vm.notices[0].text, "+3,200 from a full envelope (Pib)");
  assert.deepEqual(vm.notices[1].actions, ["dismiss"]);
});

test("notices: the save notice is merged first, with the §3.8 text and actions", () => {
  const s = seeded(3);
  s.notices.push({ kind: "clock", at: T0 });
  const message = "EACCES: permission denied, open '/home/me/.config/herdr-app/data/creaseworks/save.json.tmp'";
  const vm = v(s, T0, { saveNotice: { kind: "error", message, retryMs: 30000 } });
  assert.deepEqual(vm.notices.map((n) => n.kind), ["error", "clock"]);
  assert.equal(vm.notices[0].text, `Can't save: ${engine.clip(message, 60)}. Retrying in 30 s. Your progress is safe in memory.`);
  assert.deepEqual(vm.notices[0].actions, ["retry", "details"]);
  assert.equal(vm.ribbon.save, "Save problem");
  assert.ok(vm.rail.save);
  const given = v(s, T0, { saveNotice: { kind: "recovered", text: "Save was damaged. Loaded the backup from 14:02. Damaged copy kept." } });
  assert.equal(given.notices[0].text, "Save was damaged. Loaded the backup from 14:02. Damaged copy kept.");
  assert.deepEqual(given.notices[0].actions, ["details", "dismiss"]);
  assert.equal(v(s).notices.length, 1);
});

// ---------------------------------------------------------------------------
// Mat

test("mat: nodes at slot centres (due, fading), scraps, ream, crane glide, boat, crease line", () => {
  const s = seeded(3);
  const sp = s.spawn;
  sp.shownMs = 100000;
  sp.chain = { id: "c4", k: 3, next: 1, born: 100000 - 8500, nodes: [{ i: 0, slot: 11, done: true }, { i: 1, slot: 21, done: false }, { i: 2, slot: 38, done: false }] };
  sp.scraps = [{ id: "s5", slot: 42, born: 100000 }];
  sp.ream = { id: "r6", day: s.day, slot: 0 };
  sp.crane = { id: "g7", slot: 9, born: 100000 - 5500, outcome: "gift" };
  sp.lastChain = { result: "done", slots: [8, 18, 29], at: T0 - 1000 };
  const vm = v(s);
  const at = (slot) => {
    const p = engine.slotXY(slot);
    return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
  };
  assert.deepEqual(vm.mat.nodes, [
    { id: "c4-1", i: 2, ...at(21), due: true, fading: true },
    { id: "c4-2", i: 3, ...at(38), due: false, fading: true },
  ]);
  assert.deepEqual(vm.mat.scraps, [{ id: "s5", ...at(42) }]);
  assert.deepEqual(vm.mat.ream, { id: "r6", ...at(0) });
  assert.deepEqual(vm.mat.creaseLine, [8, 18, 29].map((x) => [at(x).x, at(x).y]));
  assert.equal(v(s, T0 + 2500).mat.creaseLine, null);
  // Crane at slot 9 (right edge): hit box left/top, flying to the far side, half its 11 s life gone.
  const c = vm.mat.crane;
  assert.equal(c.msLeft, 5500);
  assert.equal(c.x1, 8);
  assert.equal(c.y, Math.round((at(9).y - 18) * 10) / 10);
  assert.ok(c.x < 248 && c.x > 8);
  assert.equal(c.bob, true);
  // Nothing overlaps the Sheet in the short variant either.
  for (const slot of engine.CONTENT.FREE_SLOTS) {
    const p = engine.slotPos(slot, true);
    const overlaps = p.x + 14 > 104 && p.x - 14 < 200 && p.y + 14 > 42 && p.y - 14 < 138;
    assert.ok(!overlaps, `slot ${slot} at ${p.x},${p.y}`);
  }
  assert.equal(v(s, T0, { short: true }).sheet.short, true);
});

test("B17 a crane born under Fair wind glides over its whole 1.5× life (lifeOf), as the engine counts it", () => {
  const s = seeded(3);
  const sp = s.spawn;
  const life = engine.CONTENT.K.craneLifeMs * engine.CONTENT.K.windLife;
  sp.shownMs = 100000;
  sp.crane = { id: "g7", slot: 9, born: 100000, outcome: "gift", wind: true };
  const born = v(s).mat.crane;
  assert.equal(born.msLeft, life);
  sp.shownMs = 100000 + life / 3; // a third gone: a third of the way, not still at x0
  const third = v(s).mat.crane;
  assert.ok(Math.abs((born.x - third.x) - (born.x - born.x1) / 3) < 0.2, `${born.x} → ${third.x} of ${born.x1}`);
  sp.shownMs = 100000 + life - 1;
  const end = v(s).mat.crane;
  assert.ok(Math.abs(end.x - end.x1) < 0.2, "at x1 only at the end of its life");
});

// ---------------------------------------------------------------------------
// Strings, purity, shape parity, performance

test("titles are grapheme-clipped in tooltips (60) and detail", () => {
  const long = "claude · " + "👩‍💻 review 🇯🇵 ".repeat(10);
  const { s } = withAgents(["working"], { 0: { title: long } });
  const x = tiles(v(s))[0];
  const title = engine.clip(s.helpers[id(0)].title, 60);
  assert.equal(x.detail.title, title);
  assert.ok(x.tooltip.includes(title));
  assert.equal(engine.graphemes(title).length, 60);
  assert.ok(!/[\ud800-\udbff]$/.test(title));
});

test("view() does not change the state", () => {
  const { s } = withAgents(["working", "blocked", "idle", "done"]);
  s.envelopes[id(0)] = { type: "bundle", units: 1, landedAt: T0, lastAt: T0 };
  const before = engine.serialize(s);
  v(s, T0 + 5000);
  engine.view(s, T0 + 5000, { role: "ribbon", width: 832 });
  assert.equal(engine.serialize(s), before);
});

/** Every key of the fixture value exists in ours with the same JSON kind (null matches anything nullable). */
function sameShape(ours, fixture, path, out) {
  const kind = (x) => (x === null ? "null" : Array.isArray(x) ? "array" : typeof x);
  if (fixture === null || ours === null) return;
  if (kind(ours) !== kind(fixture)) {
    out.push(`${path}: ${kind(ours)} vs fixture ${kind(fixture)}`);
    return;
  }
  if (kind(fixture) === "array") {
    if (ours.length && fixture.length) sameShape(ours[0], fixture[0], `${path}[0]`, out);
  } else if (kind(fixture) === "object") {
    for (const k of Object.keys(fixture)) {
      if (!(k in ours)) out.push(`${path}.${k} missing`);
      else sameShape(ours[k], fixture[k], `${path}.${k}`, out);
    }
  }
}

test("shape parity with the UI fixtures (test/fixtures/vm-fixtures.mjs)", () => {
  // A rich state: every part of the vm populated.
  const statuses = ["working", "idle", "blocked", "working", "done", "idle", "working", "blocked"];
  const { s, me } = withAgents(statuses);
  me.act(observeAction(T0 + 500, statuses.map((st, i) => agent(i, st)).concat([kid(20, 1, "working")])));
  const other = writer(s, "wB");
  other.act(observeAction(T0 + 600, [agent(30, "working")]));
  me.act(observeAction(T0 + 700, statuses.map((st, i) => agent(i, st)).concat([kid(20, 1, "working")]).slice(0, 7)));
  s.bank = 5e4;
  s.owned["paper-stack"] = 12;
  s.envelopes[id(0)] = { type: "rush", units: 2, landedAt: T0, lastAt: T0 };
  const sp = s.spawn;
  sp.chain = { id: "c4", k: 3, next: 0, born: sp.shownMs, nodes: [{ i: 0, slot: 11, done: false }, { i: 1, slot: 21, done: false }, { i: 2, slot: 38, done: false }] };
  sp.scraps = [{ id: "s5", slot: 42, born: sp.shownMs }];
  sp.crane = { id: "g7", slot: 9, born: sp.shownMs, outcome: "gift" };
  sp.boat = { id: "b8", born: sp.shownMs };
  sp.ream = { id: "r6", day: s.day, slot: 0 };
  sp.lastChain = { result: "done", slots: [8, 18, 29], at: T0 + 500 };
  s.boosts.rushEnd = T0 + 30000;
  s.hand.afterglowMs = 60000;
  s.garlands = [{ wish: 1, day: "2026-11-03", stripes: [["hue:3", 0.4, "Mina"]], wishes: 10 }];
  s.notices.push({ kind: "clock", at: T0 });
  s.away.pot = {
    seconds: 3600, gap: 3600000, capped: false, folds: 4.81e6, split: { workshops: 3.1e6, helpers: 1.71e6 },
    envelopes: 1, needs: [id(2)], rested: 2, best: id(0), affordable: ["bone-folder"], at: T0, liveMs: 0,
  };
  s.helpers[id(0)].stats.tasks = 31;
  const ours = engine.view(s, T0 + 1000, { role: "panel", width: 320, writer: "wA" });
  const ribbon = engine.view(s, T0 + 1000, { role: "ribbon", width: 832, writer: "wA" });
  const problems = [];
  for (const name of VIEW_NAMES) {
    const fx = viewModel(name);
    sameShape(name.startsWith("ribbon-") ? ribbon : ours, fx, name, problems);
  }
  assert.deepEqual([...new Set(problems)], []);
  // Every top-level B6 key is there.
  for (const k of ["rev", "header", "sheet", "mat", "tray", "streak", "boosts", "helpers", "shop", "string", "settings", "away", "notices", "ribbon", "rail"]) {
    assert.ok(k in ours, k);
  }
});

test("view() with 64 helpers and 500 in the Album takes < 3 ms (median)", () => {
  const s = seeded(17);
  const me = writer(s, "w-perf");
  let t = T0;
  for (let batch = 0; batch < 10; batch++) {
    me.act(observeAction((t += 1000), Array.from({ length: 50 }, (_, i) => agent(5000 + batch * 50 + i, "working", 0))));
    me.act(observeAction((t += 1000), []));
  }
  const list = [
    ...Array.from({ length: 64 }, (_, i) => agent(i, ["working", "working", "idle", "blocked", "done"][i % 5], 0, { title: `claude · task ${i} 👩‍💻 with a long description of the work` })),
    ...Array.from({ length: 24 }, (_, i) => kid(100 + i, i, "working", 0)),
  ];
  me.act(observeAction((t += 1000), list));
  s.bank = 1e9;
  for (const w of engine.CONTENT.WORKSHOPS) me.act({ t, type: "buy", item: w.id, count: 10 });
  for (let i = 0; i < 40; i++) me.act({ t: (t += 400), type: "click", target: "sheet" });
  for (let i = 0; i < 20; i++) s.envelopes[id(i)] = { type: "bundle", units: 1, landedAt: t - i, lastAt: t - i };
  assert.equal(Object.values(s.helpers).filter((h) => h.gone).length, 500);
  const times = [];
  for (let k = 0; k < 200; k++) {
    const a = performance.now();
    engine.view(s, t + k * 10, { role: "panel", width: 320, writer: "w-perf" });
    times.push(performance.now() - a);
  }
  times.sort((a, b) => a - b);
  const m = times.slice(50)[Math.floor(times.length / 2) - 25];
  console.log(`# view 64 + 500 album: median ${m.toFixed(3)} ms`);
  assert.ok(m < 3, `median ${m.toFixed(3)} ms`);
});

// ---------------------------------------------------------------------------
// Review fixes r1-03 (Album cost), r1-14 (fledgling ids on the pips)

/** A state with `n` Album helpers (left in batches of 50, one minute apart) and `live` present agents. */
function withAlbum(n, live = 34) {
  const s = seeded(21);
  const me = writer(s, "wA");
  let t = T0;
  for (let batch = 0; batch < n / 50; batch++) {
    me.act(observeAction((t += 60000), Array.from({ length: 50 }, (_, i) => agent(9000 + batch * 50 + i, "working", 0))));
    me.act(observeAction((t += 1000), []));
  }
  me.act(observeAction((t += 1000), Array.from({ length: live }, (_, i) => agent(i, ["working", "idle", "blocked", "done"][i % 4], 0))));
  return { s, me, t };
}

test("r1-03: Album rows are memoised and always equal a fresh build", () => {
  const { s, me, t } = withAlbum(300);
  const times = [t, t + 10, t + 999, t + 1000, t + 59000, t + 61000, t + 3600000, t + 86400000 + 5, t + 5000, t];
  for (const at of times) {
    const ours = v(s, at).helpers.album;
    const fresh = v(engine.cloneState(s), at).helpers.album;
    assert.deepEqual(ours, fresh, `at +${at - t}`);
    assert.equal(ours.length, 300);
  }
  // Unchanged Album, same text: the very same (frozen) array comes back.
  const a = v(s, t + 86400000 + 10).helpers.album;
  assert.equal(v(s, t + 86400000 + 20).helpers.album, a);
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a[0]));
  // Number style is part of the key.
  assert.deepEqual(v(s, t + 86400000 + 30, { style: "sci" }).helpers.album, v(engine.cloneState(s), t + 86400000 + 30, { style: "sci" }).helpers.album);
  // A helper leaving changes the roster: it is first in the Album at once.
  const gone = engine.helperId("t0", 1000);
  me.act(observeAction(t + 2000, Array.from({ length: 33 }, (_, i) => agent(i + 1, "working", 0))));
  const after = v(s, t + 2000).helpers.album;
  assert.equal(after.length, 301);
  assert.equal(after[0].helperId, gone);
  assert.equal(after[0].leftAgo, "0 s");
  // Only the panel's Flock tab draws the Album.
  assert.deepEqual(v(s, t + 2000, { tab: "shop" }).helpers.album, []);
  assert.deepEqual(engine.view(s, t + 2000, { role: "ribbon", width: 832, writer: "wA" }).helpers.album, []);
  assert.deepEqual(v(s, t + 2000, { width: 100 }).helpers.album, [], "the rail");
});

test("r3-02: a roster change with the Album open rebuilds only what moved: unmoved rows are the same objects, the order a fresh sort's", () => {
  const { s, me, t } = withAlbum(600);
  const a = v(s, t + 1000).helpers.album;
  // one agent leaves, a gone one returns (rejoins), another leaves: the Album changes
  const back = engine.helperId(`t${9000 + 123}`, 1000 + 9000 + 123);
  me.act(observeAction(t + 1200, [...Array.from({ length: 33 }, (_, i) => agent(i + 1, "working", 0)), agent(9000 + 123, "working", 0)]));
  const b = v(s, t + 1300).helpers.album;
  assert.notEqual(b, a);
  assert.deepEqual(b, v(engine.cloneState(s), t + 1300).helpers.album, "the same rows as a fresh build");
  assert.equal(b.length, 600, "one left, one came back");
  assert.equal(b[0].helperId, engine.helperId("t0", 1000));
  assert.ok(!b.some((r) => r.helperId === back), "the returning helper left the Album");
  const before = new Map(a.map((r) => [r.helperId, r]));
  let same = 0;
  for (const r of b) if (before.get(r.helperId) === r) same++;
  // all but the new leaver and the record compaction just rounded (the 201st most recent, R13)
  assert.equal(same, 598, "every unmoved row is reused, not formatted again");
  // a different number style formats every row again (and still equals a fresh build)
  assert.deepEqual(v(s, t + 1400, { style: "sci" }).helpers.album, v(engine.cloneState(s), t + 1400, { style: "sci" }).helpers.album);
  // the Album folded meanwhile (no rows built), then opened after more changes: still a fresh build's rows
  me.act(observeAction(t + 1500, Array.from({ length: 20 }, (_, i) => agent(i + 1, "working", 0))));
  assert.deepEqual(v(s, t + 1600, { album: false }).helpers.album, []);
  me.act(observeAction(t + 1700, Array.from({ length: 10 }, (_, i) => agent(i + 1, "working", 0))));
  const c = v(s, t + 1800).helpers.album;
  assert.deepEqual(c, v(engine.cloneState(s), t + 1800).helpers.album);
  assert.equal(c.length, 600 + 24); // t0, t11-t33 left (the returning one left again)
});

test("r3-02: the bucketed Album sort orders like the comparator (ties by join time, then id; unknown leaving times last)", () => {
  const { s, t } = withAlbum(300);
  const recs = Object.values(s.helpers).filter((h) => h.gone && h.kind === "pane");
  // ties across batches, and records with no usable leaving time
  recs[5].missingSince = recs[200].missingSince;
  recs[6].missingSince = null;
  recs[7].missingSince = "x";
  recs[8].joined = recs[9].joined;
  const rows = v(engine.cloneState(s), t + 5000).helpers.album.map((r) => r.helperId);
  const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const want = recs.slice().sort((a, b) => num(b.missingSince) - num(a.missingSince) || a.joined - b.joined || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((h) => h.id);
  assert.deepEqual(rows, want);
});

test("r1-03: an agent status change (a new roster index) keeps the Album rows; changed records rebuild", () => {
  const { s, me, t } = withAlbum(300);
  const a = v(s, t + 1000).helpers.album;
  // Every observe with a helper list rebuilds the helper index (rosterChanged).
  me.act(observeAction(t + 1200, Array.from({ length: 34 }, (_, i) => agent(i, ["idle", "working", "done", "blocked"][i % 4], 0))));
  assert.equal(v(s, t + 1300).helpers.album, a, "same Album: no sort, no format, the same array");
  // A record changed in place (folds; leaving time, as compaction rounds it)
  // is noticed at the next index rebuild.
  const recs = Object.values(s.helpers).filter((h) => h.gone && h.kind === "pane");
  recs[7].stats.folds += 1e6;
  me.act(observeAction(t + 1400, Array.from({ length: 34 }, (_, i) => agent(i, "working", 0))));
  const b = v(s, t + 1500).helpers.album;
  assert.notEqual(b, a);
  assert.deepEqual(b, v(engine.cloneState(s), t + 1500).helpers.album);
  recs[3].missingSince -= 3 * 3600000;
  me.act(observeAction(t + 1600, Array.from({ length: 34 }, (_, i) => agent(i, "idle", 0))));
  const c = v(s, t + 1700).helpers.album;
  assert.notEqual(c, b);
  assert.deepEqual(c, v(engine.cloneState(s), t + 1700).helpers.album);
  assert.equal(c[c.length - 1].helperId, recs[3].id, "re-sorted: it left longest ago");
});

test("r1-03: view() cost does not grow with the Album (2,500 helpers, warm median < 3 ms)", () => {
  const { s, t } = withAlbum(2500);
  assert.equal(Object.values(s.helpers).filter((h) => h.gone).length, 2500);
  const run = (state) => {
    const times = [];
    for (let k = 0; k < 120; k++) {
      const a = performance.now();
      engine.view(state, t + 1000 + k * 1000, { role: "panel", width: 320, writer: "wA" });
      times.push(performance.now() - a);
    }
    times.sort((x, y) => x - y);
    return times[Math.floor(times.length / 2)];
  };
  const m = run(s);
  console.log(`# view 34 + 2500 album (1 s ticks): median ${m.toFixed(3)} ms`);
  assert.ok(m < 3, `median ${m.toFixed(3)} ms`);
});

test("r1-14: a tile's fledglings carry their helper ids, in pip order, with a needs-you tooltip", () => {
  const s = seeded(5);
  const me = writer(s, "wA");
  me.act(observeAction(T0, [agent(1, "working"), kid(20, 1, "working"), kid(21, 1, "blocked")]));
  s.ui.hints.fold = true;
  s.stats.hits = 10;
  const vm = v(s, T0 + 60000);
  const parent = tiles(vm).find((x) => x.helperId === id(1, 1001));
  assert.equal(tiles(vm).length, 1, "fledglings with a present parent are pips, not tiles");
  assert.deepEqual(parent.pips, ["blocked", "working"]);
  assert.deepEqual(parent.kids.map((k) => [k.helperId, k.status, k.pane]), [
    [engine.helperId("t21", 1021), "blocked", null],
    [engine.helperId("t20", 1020), "working", null],
  ]);
  assert.match(parent.kids[0].tooltip, /fledgling.*Needs you 1 m: click to open it$/);
  assert.match(parent.kids[1].name, /^[\x20-\x7e]+$/);
});

test("r1-14: waiting fledglings come first in a tile's pips and kids, so the first 4 pips always include them", () => {
  const s = seeded(5);
  const me = writer(s, "wA");
  me.act(observeAction(T0, [agent(1, "blocked"), kid(20, 1), kid(21, 1), kid(22, 1), kid(23, 1), kid(24, 1, "idle")]));
  me.act(observeAction(T0 + 1000, [agent(1, "blocked"), kid(20, 1), kid(21, 1), kid(22, 1), kid(23, 1), kid(24, 1, "idle"), kid(25, 1, "blocked")]));
  me.act(observeAction(T0 + 2000, [agent(1, "blocked"), kid(20, 1), kid(21, 1, "blocked"), kid(22, 1), kid(23, 1), kid(24, 1, "idle"), kid(25, 1, "blocked")]));
  s.ui.hints.fold = true;
  s.stats.hits = 10;
  const parent = tiles(v(s, T0 + 60000)).find((x) => x.helperId === id(1, 1001));
  assert.deepEqual(parent.pips.slice(0, 2), ["blocked", "blocked"]);
  assert.deepEqual(parent.pips.slice(2).sort(), ["idle", "working", "working", "working"]);
  assert.deepEqual(parent.kids.map((k) => k.status), parent.pips, "kids in pip order");
  assert.deepEqual(parent.kids.slice(0, 2).map((k) => k.helperId), [
    engine.helperId("t25", 1025), // waiting since +1 s: longest wait first
    engine.helperId("t21", 1021),
  ]);
});

test("r1-03: opts.album false (the Album folded) builds no rows; albumCount always counts", () => {
  const { s, t } = withAlbum(100);
  const folded = v(s, t, { album: false });
  assert.deepEqual(folded.helpers.album, []);
  assert.equal(folded.helpers.albumCount, 100);
  assert.equal(v(s, t).helpers.album.length, 100);
  assert.equal(engine.view(s, t, { role: "ribbon", width: 832 }).helpers.albumCount, 100);
});

// Integration r2-01 follow-up: the Album memo rides on the live state, which
// the slot hands to the next code generation (B9). Registry symbols, tagged
// per generation: a reload's view replaces the memo, never leaves the old one.
test("r2-01: the Album memo is one non-enumerable entry per key across code generations; an older build's orphan is dropped", async () => {
  const gen2 = await import("../../mods/creaseworks/engine/view.js?generation-2");
  assert.notEqual(gen2.view, engine.view, "a second module instance");
  const { s, t } = withAlbum(100);
  s[Symbol("creaseworks/album-memo")] = { idx: null, count: 0 }; // an older build's per-generation symbol
  s[Symbol("creaseworks/album-count")] = { idx: null, n: 0 };
  const o = { role: "panel", width: 320, writer: "wA" };
  const a = engine.view(s, t + 1000, o).helpers.album;
  const b = gen2.view(s, t + 1000, o).helpers.album;
  assert.deepEqual(b, a);
  assert.notEqual(b, a, "another generation's memo is rebuilt, never trusted");
  assert.deepEqual(engine.view(s, t + 2000, o).helpers.album, v(engine.cloneState(s), t + 2000).helpers.album);
  const keys = Object.getOwnPropertySymbols(s).map((k) => Symbol.keyFor(k));
  assert.ok(keys.every((k) => typeof k === "string"), "no per-generation symbols left");
  assert.equal(keys.filter((k) => k === "creaseworks/album-memo").length, 1);
  assert.ok(keys.filter((k) => k === "creaseworks/album-count").length <= 1);
  for (const k of Object.getOwnPropertySymbols(s)) assert.equal(Object.getOwnPropertyDescriptor(s, k).enumerable, false);
});

// Review r5-16: gone fledglings are in the Album for their 30 days (DESIGN
// §5.1), then counted in the record they fold into; the header counts every
// helper and a folded record's row carries its fledglings' folds.
test("r5-16: gone fledglings are Album rows and counted; folded into a gone parent they stay counted, folds included", () => {
  const s = seeded();
  const me = writer(s, "wA");
  me.act(observeAction(T0, [agent(1, "working", 0), kid(2, 1, "working", 0), kid(3, 1, "working", 0)]));
  const pid = engine.helperId("t1", 1001);
  const k2 = engine.helperId("t2", 1002);
  const k3 = engine.helperId("t3", 1003);
  s.helpers[k2].stats.folds = 100;
  s.helpers[k3].stats.folds = 20;
  me.act(observeAction(T0 + 1000, [agent(1, "working", 0)]));
  let t = T0 + 2000;
  const check = (where) => {
    const vm = v(s, t);
    assert.deepEqual(vm.helpers.album, v(engine.cloneState(s), t).helpers.album, `${where}: memo equals a fresh build`);
    assert.equal(v(s, t, { album: false }).helpers.albumCount, vm.helpers.albumCount, `${where}: folded count`);
    return vm.helpers;
  };
  let h = check("kids gone");
  assert.equal(h.albumCount, 2);
  assert.deepEqual(h.album.map((r) => r.helperId).sort(), [k2, k3].sort());
  assert.equal(h.album.find((r) => r.helperId === k2).folds, "100");
  // the parent leaves too
  s.helpers[pid].stats.folds = 1000;
  me.act(observeAction((t = T0 + 3000), []));
  h = check("parent gone");
  assert.equal(h.albumCount, 3);
  assert.equal(h.album.length, 3);
  // 31 days on, the fledglings fold into their parent's record: still 3 helpers
  me.act(observeAction((t = T0 + 31 * 86400000), [], { day: "2026-12-26" }));
  assert.equal(s.helpers[k2], undefined);
  assert.equal(s.helpers[pid].stats.kidsPast, 2);
  h = check("folded");
  assert.equal(h.albumCount, 3);
  assert.deepEqual(h.album.map((r) => [r.helperId, r.folds]), [[pid, "1,120"]]);
});

// Review r7-09: a fledgling folded into a present parent has no Album row, but
// it is still a helper who has left: the header counts it (it used to drop out,
// so the count shrank as fledglings folded and jumped when the parent left),
// and the parent's detail card says how many.
test("r7-09: fledglings that fold into a present parent stay counted in the Album header, and its card says so", () => {
  const s = seeded();
  const me = writer(s, "wA");
  me.act(observeAction(T0, [agent(1, "working", 0), kid(2, 1, "working", 0)]));
  me.act(observeAction(T0 + 1000, [agent(1, "working", 0)]));
  assert.equal(v(s, T0 + 1000).helpers.albumCount, 1);
  let t = T0 + 31 * 86400000;
  me.act(observeAction(t, [agent(1, "working", 0)], { day: "2026-12-26" }));
  const pid = engine.helperId("t1", 1001);
  assert.equal(s.helpers[pid].stats.kidsPast, 1);
  let vm = v(s, t);
  assert.equal(vm.helpers.albumCount, 1, "folded into its present parent: still counted");
  assert.deepEqual(vm.helpers.album, [], "no row of its own");
  assert.equal(v(s, t, { album: false }).helpers.albumCount, 1);
  const card = () => v(s, t).helpers.groups.flatMap((g) => g.tiles).find((x) => x.helperId === pid).detail.line;
  assert.match(card(), / · 1 fledgling left · /);
  // the parent leaves: one more, never a jump
  me.act(observeAction((t += 1000), []));
  vm = v(s, t);
  assert.equal(vm.helpers.albumCount, 2);
  assert.equal(v(s, t, { album: false }).helpers.albumCount, 2);
  // it returns: back to the one fledgling
  me.act(observeAction((t += 1000), [agent(1, "working", 0)]));
  assert.equal(v(s, t).helpers.albumCount, 1);
  assert.equal(v(s, t, { album: false }).helpers.albumCount, 1);
});

test("r7-09: 250 short sub-agents of one long-lived agent: the Album count never shrinks, before or after 30 days", () => {
  const s = seeded();
  const me = writer(s, "wA");
  const pid = engine.helperId("t1", 1001);
  let t = T0;
  const counts = (where, n) => {
    const open = v(s, t).helpers;
    assert.equal(open.albumCount, n, `${where}: open`);
    assert.equal(v(s, t, { album: false }).helpers.albumCount, n, `${where}: folded`);
    assert.equal(v(engine.cloneState(s), t, { album: false }).helpers.albumCount, n, `${where}: fresh`);
    // every helper who has left: each gone record's own helpers (archive or 1) and
    // its folded fledglings, and the fledglings folded into each present record
    let sum = 0;
    for (const h of Object.values(s.helpers)) sum += (h.gone ? (h.archive > 0 ? h.archive : 1) : 0) + (h.stats.kidsPast || 0);
    assert.equal(sum, n, `${where}: the records hold them all`);
  };
  for (let i = 0; i < 250; i++) {
    me.act(observeAction((t += 60000), [agent(1, "working", 0), kid(1000 + i, 1, "working", 0)]));
    me.act(observeAction((t += 60000), [agent(1, "working", 0)]));
    if (i % 50 === 49) counts(`after ${i + 1}`, i + 1);
  }
  assert.ok(s.helpers[pid].stats.kidsPast >= 50, "past K.kidAlbumKeep, fledglings fold into the present parent");
  assert.match(v(s, t).helpers.groups.flatMap((g) => g.tiles).find((x) => x.helperId === pid).detail.line, / · 50 fledglings left · /);
  me.act(observeAction((t += 32 * 86400000), [agent(1, "working", 0)], { day: "2026-12-27" }));
  assert.equal(s.helpers[pid].stats.kidsPast, 250);
  counts("32 days on", 250);
  me.act(observeAction((t += 1000), []));
  counts("the parent leaves", 251);
});

// ---------------------------------------------------------------------------
// Pattern book (ARCHITECTURE B17 view-model additions)

function bookState() {
  const s = seeded(8);
  const me = writer(s, "wA");
  me.act({ t: T0 + 1, type: "click", target: "sheet" });
  s.bought["long-crease"] = true;
  s.bought["grand-crease"] = true;
  s.bank = 1e8;
  me.act({ t: T0 + 2, type: "buy", item: "crease-field", count: 1 });
  s.spawn.nextChainAt = s.spawn.activeMs + 100;
  me.act({ t: T0 + 600, type: "click", target: "sheet" });
  return { s, me, fid: s.spawn.field.id };
}

test("B17 sheet.field: nine dots as grid col / row with shape states and tips; the line; the first-field hint and the boost-bar line", () => {
  const { s, me, fid } = bookState();
  let vm = engine.view(s, T0 + 600);
  const f = vm.sheet.field;
  assert.equal(f.id, fid);
  assert.equal(f.dots.length, 9);
  assert.deepEqual(f.dots.map((d) => [d.col, d.row]), [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]]);
  assert.deepEqual(f.dots.map((d) => d.state), ["free", "free", "free", "free", "centre", "free", "free", "free", "free"]);
  assert.equal(f.dots[4].tip, "Start on any other dot");
  assert.equal(f.dots[0].tip, "Crease field");
  assert.deepEqual(f.line, []);
  assert.equal(f.fading, false);
  assert.equal(f.hint, "Join neighbouring dots. Click the last one again to set.");
  assert.equal(f.barHint, "Crease field · next to find: Ridge");
  for (const [k, i] of [[0, 0], [1, 1], [2, 4]]) me.act({ t: T0 + 900 + 300 * k, type: "click", target: "dot", id: `${fid}-${i}` });
  vm = engine.view(s, T0 + 1500);
  const st = vm.sheet.field.dots.map((d) => d.state);
  assert.equal(st[0], "close", "the first dot can close (3 dots, next to the last)");
  assert.equal(st[1], "used");
  assert.equal(st[4], "last");
  assert.equal(vm.sheet.field.dots[4].tip, "Click again to set");
  assert.deepEqual([st[3], st[5], st[6], st[7], st[8], st[2]], ["next", "next", "next", "next", "next", "next"]);
  assert.deepEqual(vm.sheet.field.line, [[0, 0], [1, 0], [1, 1]]);
  // in its last 2 s the field fades
  assert.equal(engine.view(s, s.clock + 0).sheet.field.fading, false);
  engine.advance(s, T0 + 600 + engine.CONTENT.K.fieldLifeMs - 1500);
  assert.equal(engine.view(s, s.clock).sheet.field.fading, true);
  // the rail and the ribbon draw no field (they read only the frame)
  assert.equal(typeof engine.view(s, s.clock, { role: "ribbon" }).sheet.frame, "number");
});

test("B17 sheet.fieldResult: 3 s in the tier style with the chip's words; mat.fold; the shelf's p: entries; the Coil and Ridge chips", () => {
  const { s, me, fid } = bookState();
  let t = T0 + 900;
  for (const i of [0, 1, 2, 2]) me.act({ t: (t += 300), type: "click", target: "dot", id: `${fid}-${i}` });
  let vm = engine.view(s, t + 100);
  assert.deepEqual(vm.sheet.fieldResult, { line: [[0, 0], [1, 0], [2, 0]], closed: false, style: "found", text: "Ridge · new diagram" });
  assert.equal(vm.sheet.field, null);
  assert.equal(engine.view(s, t + engine.CONTENT.K.fieldResultMs).sheet.fieldResult, null, "gone after 3 s");
  const fold = vm.mat.fold;
  assert.equal(fold.kind, "ridge");
  assert.equal(fold.tooltip, "Ridge pleat · one pause of up to 4\u00a0s keeps your rhythm", "the fold piece's one name, as on its book card");
  const pos = engine.slotPos(s.spawn.fold.slot, false);
  assert.deepEqual([fold.x, fold.y], [pos.x, pos.y]);
  assert.equal(engine.view(s, t + 100, { short: true }).mat.fold.y, engine.slotPos(s.spawn.fold.slot, true).y);
  me.act({ t: (t += 300), type: "click", target: "fold", id: fold.id });
  vm = engine.view(s, t);
  assert.equal(vm.mat.fold, null);
  assert.equal(vm.mat.shelf[vm.mat.shelf.length - 1], "p:ridge");
  // chips named after the diagram that gave them, as every other chip is
  assert.deepEqual(vm.boosts.find((b) => b.type === "steady"), { type: "steady", label: "Ridge · steady", msLeft: null, msTotal: null });
  s.boosts.coilEnd = t + 10000;
  assert.deepEqual(engine.view(s, t + 4000).boosts.find((b) => b.type === "coil"), { type: "coil", label: "Coil ×2", msLeft: 6000, msTotal: 10000 });
  s.boosts.rushEnd = t + 30000;
  assert.equal(engine.view(s, t + 4000).boosts.find((b) => b.type === "coil"), undefined, "no Coil chip while Rush runs");
  // the learned / mastered words and styles
  s.book.found.ridge.n = 3;
  s.spawn.field = { id: "p88", born: s.spawn.shownMs, path: [] };
  for (const i of [6, 7, 8, 8]) me.act({ t: (t += 300), type: "click", target: "dot", id: `p88-${i}` });
  assert.deepEqual([engine.view(s, t).sheet.fieldResult.style, engine.view(s, t).sheet.fieldResult.text], ["learned", "Ridge · learned"]);
  s.book.found.ridge.n = 11;
  s.spawn.field = { id: "p89", born: s.spawn.shownMs, path: [] };
  for (const i of [6, 7, 8, 8]) me.act({ t: (t += 300), type: "click", target: "dot", id: `p89-${i}` });
  assert.deepEqual([engine.view(s, t).sheet.fieldResult.style, engine.view(s, t).sheet.fieldResult.text], ["mastered", "Ridge · mastered"]);
});

test("B17 vm.book: counts and marks, the tab dot, the line, the help; cards only on the Book tab, found / next / hidden", () => {
  const { s } = bookState();
  let b = engine.view(s, s.clock).book;
  assert.equal(b.open, true);
  assert.deepEqual(b.cards, [], "no cards off the Book tab");
  assert.equal(b.count, "0 / 9 · 0 / 27 marks");
  assert.equal(b.line, "A field is on the Sheet · next to find: Ridge");
  assert.ok(b.help.startsWith("Join neighbouring dots"));
  assert.equal(b.newMarks, false);
  s.book.found.ridge = { n: 4, at: T0, ready: 0 };
  s.book.found.napkin = { n: 1, at: T0, ready: s.spawn.activeMs + 100000 };
  s.spawn.field = null;
  s.spawn.fieldIn = 3;
  b = engine.view(s, s.clock, { tab: "book" }).book;
  assert.equal(b.count, "2 / 9 · 3 / 27 marks");
  assert.equal(b.newMarks, true, "marks earned since the tab was last opened");
  assert.equal(b.line, "Next field in 3 chains · next to find: Gull");
  assert.equal(b.cards.length, 9);
  const card = (id) => b.cards.find((c) => c.id === id);
  assert.deepEqual([card("ridge").state, card("ridge").tier, card("ridge").pips, card("ridge").count, card("ridge").status], ["found", 2, [true, true, false], "×4", "ready"]);
  assert.equal(card("napkin").status, "rests 1:40");
  assert.equal(card("ridge").fold, "Fold piece: Ridge pleat");
  // the tooltip says the tier counts are thresholds, beside the player's own count
  assert.equal(card("ridge").tooltip, "One pause of up to 4\u00a0s keeps your rhythm · traced 4 · learned at 4, mastered at 12");
  assert.equal(card("gull").state, "next");
  assert.deepEqual(card("gull").dots, [[0, 0], [1, 1], [2, 0]]);
  assert.equal(card("gull").hint, "Down, then up: a bird far off");
  assert.equal(card("sail").state, "hidden");
  assert.equal(card("sail").name, "???");
  assert.equal(card("sail").dots, null, "a hidden diagram is never drawn");
  assert.equal(card("sail").sub, "6 dots · closed");
  assert.equal(card("sail").effect, null);
  assert.equal(card("ridge").hint, null);
  // the hint action clears the dot
  writer(s, "wH").act({ t: s.clock + 1, type: "hint", key: "book", n: b.marks });
  assert.equal(engine.view(s, s.clock).book.newMarks, false);
  // all nine found: the mastery line; no help past 3
  for (const p of engine.CONTENT.PATTERNS) if (!s.book.found[p.id]) s.book.found[p.id] = { n: 2, at: T0, ready: 0 };
  s.book.found.hem.n = 9;
  b = engine.view(s, s.clock, { tab: "book" }).book;
  assert.equal(b.line, "All nine found · next mastery: Hem 9 / 12");
  assert.equal(b.help, null);
  // the curio not owned this run (after a wish): the Buy line, all nine found or not
  s.spawn.fieldIn = null;
  assert.equal(engine.view(s, s.clock, { tab: "book" }).book.line, "Buy Crease Field (Curios) to bring fields back this run");
  s.spawn.fieldIn = 3;
  // a fold piece on the mat
  s.spawn.fold = { id: "f1", kind: "coil", slot: 1, born: s.spawn.shownMs };
  assert.equal(engine.view(s, s.clock, { tab: "book" }).book.cards.find((c) => c.id === "coil").status, "fold on the mat");
  // every string is pre-clipped and the view is pure
  const before = engine.serialize(s);
  const vm = engine.view(s, s.clock, { tab: "book" });
  assert.equal(engine.serialize(s), before);
  for (const c of vm.book.cards) for (const k of ["name", "effect", "short", "hint", "tooltip", "sub"]) if (c[k] !== null) assert.equal(engine.clip(c[k], 200), c[k]);
  // a game before the book: closed, nothing new
  const fresh = engine.view(seeded(1), T0, { tab: "book" }).book;
  assert.deepEqual([fresh.open, fresh.newMarks, fresh.found, fresh.marks], [false, false, 0, 0]);
  assert.equal(fresh.cards.length, 9);
});

test("B17 the view with a field, a result and a fold piece up stays within the view budget", () => {
  const { s, me, fid } = bookState();
  let t = T0 + 900;
  for (const i of [0, 1, 4, 3]) me.act({ t: (t += 300), type: "click", target: "dot", id: `${fid}-${i}` });
  s.spawn.fold = { id: "f9", kind: "gull", slot: 3, born: s.spawn.shownMs };
  s.spawn.lastField = { pattern: null, path: [0, 1, 2], closed: false, tier: 0, first: false, near: null, more: 0, rest: null, at: t };
  engine.view(s, t, { tab: "book" });
  const t0 = performance.now();
  for (let i = 0; i < 50; i++) engine.view(s, t, { tab: i % 2 ? "book" : "flock" });
  const ms = (performance.now() - t0) / 50;
  assert.ok(ms < 3, `${ms.toFixed(2)} ms a view`);
});

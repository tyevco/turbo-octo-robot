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
  assert.deepEqual(parent.pips, ["working", "blocked"]);
  assert.equal(all.find((x) => x.helperId === id(4)).kind, "kid");
  // Counts and marks are per tile: a blocked fledgling does not lift its parent (§5.2).
  assert.equal(vm.header.counts.needs, 0);
  assert.equal(vm.rail.pips.length, 2);
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
  // The rail keeps every helper individually.
  assert.equal(at1100.rail.pips.length, 90);
  const { s: s64 } = withAgents(statuses.slice(0, 64));
  for (const W of [832, 1172]) assert.notEqual(engine.view(s64, T0, { role: "ribbon", width: W }).ribbon.level, "C");
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

test("envelope bob: the newest drawn envelope for 10 s after it lands", () => {
  const { s } = withAgents(["working", "working", "working"]);
  s.envelopes[id(0)] = { type: "bundle", units: 1, landedAt: T0 - 50000, lastAt: T0 - 50000 };
  s.envelopes[id(1)] = { type: "rush", units: 2.25, landedAt: T0 - 4000, lastAt: T0 - 4000 };
  const vm = v(s);
  assert.deepEqual(vm.tray.envelopes.map((e) => [e.helperId, e.bob]), [[id(0), false], [id(1), true]]);
  assert.equal(vm.tray.envelopes[1].label, "×2.25");
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
  s.spawn.crane = { id: "g9", slot: 9, born: s.spawn.shownMs - 4000, outcome: "lucky" };
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
  s.spawn.crane = { id: "g9", slot: 9, born: s.spawn.shownMs, outcome: "lucky" };
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
  // A lapsed rhythm reads as 0 (the stored r is kept, B9).
  assert.equal(v(s, T0 + 5000).streak.label, "×1.0");
  assert.deepEqual(vm.boosts.map((b) => [b.type, b.label, b.msLeft, b.msTotal]), [
    ["rush", "Rush ×3", 52000, 90000], ["chorus", "Chorus ×2", 90000, 240000],
  ]);
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
  sp.crane = { id: "g7", slot: 9, born: 100000 - 6500, outcome: "lucky" };
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
  // Crane at slot 9 (right edge): hit box left/top, flying to the far side, half its 13 s life gone.
  const c = vm.mat.crane;
  assert.equal(c.msLeft, 6500);
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
  sp.crane = { id: "g7", slot: 9, born: sp.shownMs, outcome: "lucky" };
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

// Automations, scraps, the Paper Boat, calm lives, settings and fledgling folding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { engine, seeded, writer, agent, kid, observeAction, close, T0 } from "./_util.mjs";

test("Thrifty Fox buys the best-payback workshop at 4× its cost, at most once per 10 s", () => {
  const s = seeded();
  const me = writer(s);
  s.bought["thrifty-fox"] = true;
  s.owned["paper-stack"] = 1;
  s.bank = 4 * 180 - 1;
  engine.advance(s, T0 + 1000);
  // payback: paper stack 17.4 / 0.05 = 348 s, bone folder 180 / 0.3 = 600 s → paper stack
  assert.equal(s.owned["paper-stack"], 2);
  engine.advance(s, T0 + 5000);
  assert.equal(s.owned["paper-stack"], 2); // < 10 s since the last buy
  engine.advance(s, T0 + 11000);
  assert.equal(s.owned["paper-stack"], 3);
  s.bank = 10;
  engine.advance(s, T0 + 30000);
  assert.equal(s.owned["paper-stack"], 3); // bank < 4 × cost
  me.act({ t: T0 + 30001, type: "switch", id: "thrifty-fox", on: false });
  s.bank = 1e6;
  engine.advance(s, T0 + 60000);
  assert.equal(s.owned["paper-stack"], 3);
});

test("Crease Helper finishes a chain at 80 % of its life at half value, without rhythm", () => {
  const s = seeded(14);
  const me = writer(s);
  s.bought["crease-helper"] = true;
  let t = T0;
  while (!s.spawn.chain) {
    t += 1000;
    me.act({ t, type: "click", target: "sheet" });
  }
  const c = s.spawn.chain;
  const hits = s.stats.hits;
  const r = s.hand.r;
  const before = s.stats.bySource.node || 0;
  const V = engine.rates(s).V;
  const evs = [];
  for (let k = 1; k <= 9; k++) evs.push(...engine.advance(s, t + k * 1000));
  assert.equal(s.spawn.chain, null);
  assert.equal(evs.find((e) => e.kind === "chain").result, "done");
  close((s.stats.bySource.node || 0) - before, 0.5 * V * (2 * c.k + 3 * c.k), 1e-3);
  assert.equal(s.stats.hits, hits);
  assert.equal(s.hand.r, r);
});

test("scraps every 45 active s pay max(30·Rp, 50·V) · scrapMult", () => {
  const s = seeded(15);
  s.bought["scrap-basket"] = true;
  s.owned["paper-stack"] = 40;
  const me = writer(s);
  let t = T0;
  let sp = null;
  for (let k = 0; k < 60 && !sp; k++) {
    t += 1000;
    const ev = me.act({ t, type: "click", target: "sheet" });
    sp = ev.find((e) => e.kind === "spawn" && e.what === "scrap");
  }
  assert.ok(sp);
  assert.ok(Math.abs(s.spawn.activeMs - 45000) <= 1000);
  const r = engine.rates(s);
  const ev = me.act({ t: t + 500, type: "click", target: "scrap", id: sp.id });
  close(ev.find((e) => e.source === "scrap").amount, Math.max(30 * r.Rp, 50 * r.V) * 2, 1e-6);
});

test("the Paper Boat (Harbour Ribbon): Tailwind doubles the next 3 envelopes and pays 120·Rp", () => {
  const s = seeded(16);
  const me = writer(s);
  s.owned["paper-stack"] = 20;
  s.bank = 2e6;
  me.act({ t: T0, type: "buy", item: "harbour-ribbon", count: 1 });
  assert.ok(s.spawn.nextBoatAt >= 1800000 && s.spawn.nextBoatAt <= 2700000);
  s.spawn.nextBoatAt = 5000;
  let t = T0;
  let boat = null;
  while (!boat && t < T0 + 20000) {
    t += 1000;
    boat = me.act({ t, type: "click", target: "sheet" }).find((e) => e.kind === "spawn" && e.what === "boat");
  }
  assert.ok(boat);
  const Rp = engine.rates(s).Rp;
  const ev = me.act({ t: t + 100, type: "click", target: "boat", id: boat.id });
  close(ev.find((e) => e.source === "boat").amount, 120 * Rp, 1e-6);
  assert.equal(s.boosts.tailwind, 3);
  for (const id of ["a", "b", "c", "d"]) s.envelopes[id] = { type: "rush", units: 1, landedAt: t, lastAt: t };
  me.act({ t: t + 200, type: "open", helperId: "a" });
  assert.equal(s.boosts.rush, 60000);
  assert.equal(s.boosts.tailwind, 2);
  engine.advance(s, t + 11 * 60000); // an away segment: Tailwind's window is frozen
  assert.equal(s.boosts.tailwind, 2);
  for (let k = 1; k <= 22; k++) engine.advance(s, t + 11 * 60000 + k * 30000);
  assert.equal(s.boosts.tailwind, 0); // 10 min of live time ran out
});

test("calm mode doubles lives and changes no value", () => {
  const s = seeded();
  const a = engine.effects(s);
  s.settings.calm = true;
  const b = engine.effects(s);
  assert.equal(b.nodeLifeMs, 2 * a.nodeLifeMs);
  assert.equal(b.scrapLifeMs, 2 * a.scrapLifeMs);
  assert.equal(b.craneLifeMs, 2 * a.craneLifeMs);
  assert.equal(b.boatLifeMs, 2 * a.boatLifeMs);
  for (const k of ["G", "hand", "echo", "folk", "envMult", "durMult", "chainK", "chainEveryMs"]) assert.equal(b[k], a[k], k);
});

test("settings: dotted keys, validated values", () => {
  const s = seeded();
  const me = writer(s);
  me.act({ t: T0, type: "setting", key: "notify.master", value: true });
  me.act({ t: T0, type: "setting", key: "style", value: "sci" });
  assert.equal(s.settings.notify.master, true);
  assert.equal(s.settings.style, "sci");
  assert.equal(me.act({ t: T0, type: "setting", key: "style", value: "fancy" }).at(-1).reason, "value");
  assert.equal(me.act({ t: T0, type: "setting", key: "__proto__", value: true }).at(-1).reason, "setting");
  assert.equal(me.act({ t: T0, type: "setting", key: "toString", value: true }).at(-1).reason, "setting");
  assert.equal(me.act({ t: T0, type: "hint", key: "crane" }).length, 0);
  assert.equal(s.ui.hints.crane, true);
});

test("fledglings in the Album for 30 days fold into their parent", () => {
  const s = seeded();
  const me = writer(s);
  me.act(observeAction(T0, [agent(1, "working", 0), kid(2, 1, "working", 0)]));
  const kidId = engine.helperId("t2", 1002);
  s.helpers[kidId].stats.folds = 123;
  me.act(observeAction(T0 + 1000, [agent(1, "working", 0)]));
  assert.equal(s.helpers[kidId].gone, true);
  me.act(observeAction(T0 + 29 * 86400000, [agent(1, "working", 0)], { day: "2026-12-24" }));
  assert.ok(s.helpers[kidId]);
  me.act(observeAction(T0 + 31 * 86400000, [agent(1, "working", 0)], { day: "2026-12-26" }));
  assert.equal(s.helpers[kidId], undefined);
  const p = s.helpers[engine.helperId("t1", 1001)];
  assert.equal(p.stats.kidsPast, 1);
  assert.equal(p.stats.kidsFolds, 123);
});

test("checkin counts a visit; dismiss removes notices; unknown actions are ignored", () => {
  const s = seeded();
  const me = writer(s);
  me.act(observeAction(T0, [agent(1, "blocked", 0)]));
  const id = engine.helperId("t1", 1001);
  me.act({ t: T0 + 1, type: "checkin", helperId: id });
  assert.equal(s.helpers[id].stats.checkIns, 1);
  assert.equal(me.act({ t: T0 + 2, type: "teleport" }).at(-1).reason, "type");
  assert.equal(engine.apply(s, null)[0].reason, "shape");
  assert.equal(engine.apply(s, { w: 3, s: 1, type: "click" })[0].reason, "shape");
});

// Clicking (§4): click cap, rhythm, figures, chains, spawns on active time, boosts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { engine, seeded, writer, close, T0 } from "./_util.mjs";

test("click cap: a scripted 100 hits/s earns exactly the value of 12.5 hits/s (BALANCE inv. 5)", () => {
  const run = (stepMs) => {
    const s = seeded(3);
    const me = writer(s);
    for (let t = 0; t < 2000; t += stepMs) me.act({ t: T0 + 1 + t, type: "click", target: "sheet" });
    engine.advance(s, T0 + 2001);
    return s;
  };
  const fast = run(10);
  const capped = run(80);
  assert.equal(fast.stats.hits, 25);
  assert.equal(capped.stats.hits, 25);
  assert.equal(fast.bank, capped.bank);
  assert.equal(engine.serialize(fast).length > 0, true);
});

test("rhythm, combo and figures (§4.2)", () => {
  const s = seeded();
  const me = writer(s);
  const pays = [];
  for (let i = 0; i < 48; i++) {
    const ev = me.act({ t: T0 + 1 + i * 900, type: "click", target: "sheet" });
    pays.push(ev.filter((e) => e.kind === "earn").reduce((a, e) => a + e.amount, 0));
  }
  assert.equal(s.hand.r, 40);
  assert.equal(s.hand.frame, 0);
  assert.equal(s.hand.figures.length, 6);
  // Hit 1 pays V·combo(1) = 1·(1 + 0.5/40); the 8th wraps the frame and pays 5·Vc.
  close(pays[0], 1 + 0.5 / 40);
  close(pays[7], 5 * (1 + 0.5 * 8 / 40));
  close(pays[47], 5 * 1.5);
  // A gap > 1 s resets the rhythm on the next hit.
  me.act({ t: T0 + 1 + 47 * 900 + 1100, type: "click", target: "sheet" });
  assert.equal(s.hand.r, 1);
  // ... and reads as 0 once the gap has passed (rhythmAt), without a hit.
  for (let i = 0; i < 30; i++) me.act({ t: T0 + 60000 + i * 500, type: "click", target: "sheet" });
  const E = engine.effects(s);
  assert.equal(engine.rhythmAt(s, E, s.clock), 30);
  engine.advance(s, T0 + 60000 + 29 * 500 + 1500);
  assert.equal(engine.rhythmAt(s, E, s.clock), 0);
  assert.equal(engine.inStep(s, E, s.clock), false);
});

test("In step banks 6 s of afterglow per hit up to 20 min; afterglow drains in live time", () => {
  const s = seeded();
  const me = writer(s);
  for (let i = 0; i < 30; i++) me.act({ t: T0 + 1 + i * 500, type: "click", target: "sheet" });
  // r reaches 25 on the 25th hit: hits 25..30 bank 6 s each.
  assert.equal(s.hand.afterglowMs, 6 * 6000 - (30 - 25) * 500 + 0);
  const g = s.hand.afterglowMs;
  engine.advance(s, s.clock + 10000);
  assert.equal(s.hand.afterglowMs, g - 10000);
});

function playUntil(s, me, pred, t, limit = 3600000) {
  for (let i = 0; i < limit / 1000; i++) {
    t += 1000;
    me.act({ t, type: "click", target: "sheet" });
    if (pred()) return t;
  }
  throw new Error("never happened");
}

test("chains: k = 7 in order pays 2·Vc per node and 21·Vc on the finish (35·Vc in all)", () => {
  const s = seeded(5);
  s.bought["long-crease"] = true;
  s.bought["grand-crease"] = true;
  const me = writer(s);
  let t = playUntil(s, me, () => s.spawn.chain !== null, T0);
  const c = s.spawn.chain;
  assert.equal(c.k, 7);
  assert.equal(new Set(c.nodes.map((n) => n.slot)).size, 7);
  for (const n of c.nodes) assert.ok(engine.CONTENT.FREE_SLOTS.includes(n.slot));
  // the chain spawned at 20 s of active time
  assert.ok(s.spawn.activeMs >= 20000 && s.spawn.activeMs < 21000 + 1000);
  for (let i = 0; i < 7; i++) {
    t += 100;
    const ev = me.act({ t, type: "click", target: "node", id: engine.nodeId(c, i) });
    const earns = ev.filter((e) => e.kind === "earn" && e.source === "node").map((e) => e.amount);
    if (i < 6) assert.equal(earns.length, 1);
    else {
      assert.equal(earns.length, 2);
      close(earns[1] / earns[0], 21 / 2);
    }
  }
  assert.equal(s.spawn.chain, null);
  assert.equal(s.spawn.lastChain.result, "done");
});

test("chains: out of order pays 1·Vc and tears; unknown ids are ignored", () => {
  const s = seeded(6);
  const me = writer(s);
  let t = playUntil(s, me, () => s.spawn.chain !== null, T0);
  const c = s.spawn.chain;
  t += 100;
  const ev = me.act({ t, type: "click", target: "node", id: engine.nodeId(c, 2) });
  assert.equal(ev.find((e) => e.kind === "chain").result, "torn");
  assert.equal(s.spawn.chain, null);
  t += 100;
  assert.equal(me.act({ t, type: "click", target: "node", id: engine.nodeId(c, 0) }).at(-1).reason, "gone");
  assert.equal(me.act({ t: t + 100, type: "click", target: "node", id: "__proto__-1" }).at(-1).reason, "gone");
});

test("nodes live 10 s of mat-shown time; spawns only advance in active time", () => {
  const s = seeded(7);
  const me = writer(s);
  const t = playUntil(s, me, () => s.spawn.chain !== null, T0);
  const born = s.spawn.chain.born;
  // Mat hidden: the node's clock pauses.
  me.act({ t: t + 1, type: "observe", helpers: null, visible: true, active: true, matShown: false });
  const shown = s.spawn.shownMs;
  engine.advance(s, t + 30000);
  assert.ok(s.spawn.chain);
  assert.equal(s.spawn.shownMs, shown);
  assert.ok(shown - born < 10000);
  me.act({ t: t + 30001, type: "observe", helpers: null, visible: true, active: true, matShown: true });
  engine.advance(s, t + 45000);
  assert.equal(s.spawn.chain, null);
  // No hand input for 30 s: active time stops, nothing more spawns.
  const a = s.spawn.activeMs;
  for (let k = 1; k <= 50; k++) engine.advance(s, t + 45000 + k * 60000 / 2);
  assert.equal(s.spawn.activeMs, a);
  assert.equal(s.spawn.chain, null);
});

test("the first gilded crane spawns at exactly 390 active seconds (M5)", () => {
  const s = seeded(9);
  const me = writer(s);
  let t = T0;
  me.act({ t, type: "click", target: "sheet" });
  let spawned = null;
  for (let i = 1; i <= 400 && !spawned; i++) {
    t = T0 + i * 1000;
    const ev = me.act({ t, type: "click", target: "sheet" });
    const e = ev.find((x) => x.kind === "spawn" && x.what === "crane");
    if (e) spawned = { e, active: s.spawn.activeMs, i };
  }
  assert.ok(spawned);
  assert.equal(spawned.i, 390);
  assert.equal(spawned.e.n, 1);
  assert.ok(["lucky", "storm", "song"].includes(s.spawn.crane.outcome));
  assert.equal(engine.lifeLeft(s, engine.effects(s), "crane", s.spawn.crane), 13000);
});

test("crane outcomes: Lucky Fold, Paper Storm (chains every 4 s), Flock Song", () => {
  const s = seeded(11);
  const me = writer(s);
  s.bank = 1000;
  s.spawn.crane = { id: "gX", slot: 1, born: 0, outcome: "lucky" };
  let ev = me.act({ t: T0 + 10, type: "click", target: "crane", id: "gX" });
  const r = engine.rates(s);
  close(ev.find((e) => e.kind === "earn").amount, Math.min(900 * r.Rp, 150) + 13 * r.V);
  s.spawn.crane = { id: "gY", slot: 1, born: 0, outcome: "storm" };
  ev = me.act({ t: T0 + 20, type: "click", target: "crane", id: "gY" });
  assert.equal(s.boosts.storm, 15000);
  assert.ok(s.spawn.nextChainAt <= s.spawn.activeMs + 4000);
  // Storm multiplies hand hits ×7.
  const before = s.bank;
  me.act({ t: T0 + 200, type: "click", target: "sheet" });
  close(s.bank - before, 7 * (1 + 0.5 / 40));
  s.spawn.crane = { id: "gZ", slot: 1, born: 0, outcome: "song" };
  me.act({ t: T0 + 300, type: "click", target: "crane" });
  assert.equal(s.boosts.song, 60000);
});

test("Fresh Ream: from the second day, once a day, gone when the day ends", () => {
  const s = seeded(12);
  const me = writer(s);
  me.act({ t: T0 + 1, type: "click", target: "sheet" });
  engine.advance(s, T0 + 5000);
  assert.equal(s.spawn.ream, null);
  me.act({ t: T0 + 86400000, type: "observe", helpers: null, visible: true, active: true, matShown: true, day: "2026-11-26" });
  me.act({ t: T0 + 86400000 + 10, type: "click", target: "sheet" });
  engine.advance(s, T0 + 86400000 + 1000);
  assert.ok(s.spawn.ream);
  const ev = me.act({ t: T0 + 86400000 + 2000, type: "click", target: "ream" });
  assert.ok(ev.some((e) => e.kind === "earn" && e.source === "ream"));
  engine.advance(s, T0 + 86400000 + 9000);
  assert.equal(s.spawn.ream, null);
});

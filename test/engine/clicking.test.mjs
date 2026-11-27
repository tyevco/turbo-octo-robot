// Clicking (§4): click cap, rhythm, figures, chains, spawns on active time, boosts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { engine, seeded, writer, close, T0 } from "./_util.mjs";
import { craneOutcome } from "../../mods/creaseworks/engine/clicking.js";
import { K } from "../../mods/creaseworks/engine/content.js";

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
  // A gap > 4 s resets the rhythm on the next hit.
  me.act({ t: T0 + 1 + 47 * 900 + 4100, type: "click", target: "sheet" });
  assert.equal(s.hand.r, 1);
  // ... and reads as 0 once the gap has passed (rhythmAt), without a hit.
  for (let i = 0; i < 30; i++) me.act({ t: T0 + 60000 + i * 500, type: "click", target: "sheet" });
  const E = engine.effects(s);
  assert.equal(engine.rhythmAt(s, E, s.clock), 30);
  engine.advance(s, T0 + 60000 + 29 * 500 + 4500);
  assert.equal(engine.rhythmAt(s, E, s.clock), 0);
  assert.equal(engine.inStep(s, E, s.clock), false);
});

test("r8-03: a short pause (over the rhythm gap, ≤ 4 s) costs 10 beats, not the streak; a longer one ends it (§4.2)", () => {
  assert.equal(K.slipMs, 4000);
  assert.equal(K.slipBeats, 10);
  const streak = (n, iv = 800) => {
    const s = seeded();
    const me = writer(s);
    let t = T0 + 1;
    for (let i = 0; i < n; i++, t += iv) me.act({ t, type: "click", target: "sheet" });
    return { s, me, last: t - iv, E: engine.effects(s) };
  };
  // A purchase's 1.5 s pause from a full streak: 30 and back In step on the next hit.
  {
    const { s, me, last, E } = streak(45);
    assert.equal(s.hand.r, 40);
    assert.equal(engine.inStep(s, E, last + 1000), true);
    // during the pause: out of step at once, and the meter shows what the next hit keeps
    assert.equal(engine.inStep(s, E, last + 1001), false);
    assert.equal(engine.rhythmAt(s, E, last + 1500), 30);
    assert.equal(engine.rhythmAt(s, E, last + 4000), 30);
    assert.equal(engine.rhythmAt(s, E, last + 4001), 0);
    me.act({ t: last + 1500, type: "click", target: "sheet" });
    assert.equal(s.hand.r, 30);
    assert.equal(engine.inStep(s, E, last + 1500), true);
    const glow = s.hand.afterglowMs;
    me.act({ t: last + 2300, type: "click", target: "sheet" });
    assert.equal(s.hand.r, 31);
    assert.ok(s.hand.afterglowMs > glow, "afterglow keeps building through the stumble");
  }
  // Two stumbles in a row drop out of step (20), and a short streak never goes under 1.
  {
    const { s, me, last } = streak(45);
    me.act({ t: last + 2000, type: "click", target: "sheet" });
    me.act({ t: last + 4000, type: "click", target: "sheet" });
    assert.equal(s.hand.r, 20);
    const short = streak(4);
    short.me.act({ t: short.last + 3999, type: "click", target: "sheet" });
    assert.equal(short.s.hand.r, 1);
  }
  // Over 4 s: the streak ends, as before.
  {
    const { s, me, last } = streak(45);
    me.act({ t: last + 4001, type: "click", target: "sheet" });
    assert.equal(s.hand.r, 1);
  }
  // Steady Rhythm's 1.4 s gap still counts a 1.3 s pause as in time.
  {
    const { s, me, last } = streak(45);
    s.bought["steady-rhythm"] = true;
    me.act({ t: last + 1300, type: "click", target: "sheet" });
    assert.equal(s.hand.r, 40);
  }
  // A 1.5 s pause every 30 hits on an 800 ms beat (review r8-03's repro) stays In step once a
  // full streak is built, where it used to start again from 1 each time (r 20 → 40 by hit 50).
  {
    const s = seeded();
    const me = writer(s);
    let t = T0 + 1;
    let inStepHits = 0;
    for (let i = 0; i < 300; i++) {
      t += i > 0 && i % 30 === 0 ? 1500 : 800;
      me.act({ t, type: "click", target: "sheet" });
      if (i >= 60 && s.hand.r >= K.stepIn) inStepHits++;
    }
    assert.equal(inStepHits, 240);
  }
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
  assert.ok(["gift", "storm", "song"].includes(s.spawn.crane.outcome));
  assert.equal(engine.lifeLeft(s, engine.effects(s), "crane", s.spawn.crane), 11000);
});

test("crane outcomes: Crane's Gift (rhythm and folk at work, not the bank), Confetti (chains every 4 s), Flock Song", () => {
  const s = seeded(11);
  const me = writer(s);
  s.bank = 1e9; // the Gift never looks at the bank
  // No rhythm yet: the Gift pays its floor of giftMinBeats beats.
  s.spawn.crane = { id: "gX", slot: 1, born: 0, outcome: "gift" };
  let ev = me.act({ t: T0 + 10, type: "click", target: "crane", id: "gX" });
  let r = engine.rates(s);
  assert.equal(engine.CONTENT.K.giftMinBeats, 4);
  close(ev.find((e) => e.kind === "earn").amount, 25 * 4 * r.V + 90 * r.Hs0);
  // In rhythm: 25·V per beat, so a full rhythm of 40 is a thousand hand folds.
  let t = T0 + 1000;
  for (let k = 0; k < 45; k++, t += 500) me.act({ t, type: "click", target: "sheet" });
  assert.equal(s.hand.r, 40);
  r = engine.rates(s);
  s.spawn.crane = { id: "gW", slot: 1, born: s.spawn.shownMs, outcome: "gift" };
  ev = me.act({ t: t + 100, type: "click", target: "crane", id: "gW" });
  close(ev.find((e) => e.kind === "earn").amount, 1000 * r.V + 90 * r.Hs0);
  // A crane saved before the redesign as "lucky" pays the Gift too.
  t += 5000;
  s.spawn.crane = { id: "gL", slot: 1, born: s.spawn.shownMs, outcome: "lucky" };
  ev = me.act({ t, type: "click", target: "crane", id: "gL" });
  r = engine.rates(s);
  close(ev.find((e) => e.kind === "earn").amount, 100 * r.V + 90 * r.Hs0);
  t += 1000;
  s.spawn.crane = { id: "gY", slot: 1, born: s.spawn.shownMs, outcome: "storm" };
  ev = me.act({ t, type: "click", target: "crane", id: "gY" });
  assert.equal(s.boosts.storm, 15000);
  assert.ok(s.spawn.nextChainAt <= s.spawn.activeMs + 4000);
  // Confetti multiplies hand hits ×6.
  const before = s.bank;
  me.act({ t: t + 200, type: "click", target: "sheet" });
  close(s.bank - before, 6 * (1 + 0.5 / 40), 1e-6);
  s.spawn.crane = { id: "gZ", slot: 1, born: s.spawn.shownMs, outcome: "song" };
  me.act({ t: t + 300, type: "click", target: "crane" });
  assert.equal(s.boosts.song, 60000);
});

test("Crane's Gift grows with the folk at work and drops their part while Helpers gather is off", () => {
  const E = { gather: true };
  const state = { hand: { r: 0, lastHitAt: 0 } };
  const r = { V: 2, Hs0: 10 };
  close(engine.giftFolds(state, { ...E, gapMs: 1000 }, r, 5000), 25 * 4 * 2 + 90 * 10);
  close(engine.giftFolds(state, { gather: false, gapMs: 1000 }, r, 5000), 25 * 4 * 2);
  const inBeat = { hand: { r: 30, lastHitAt: 4500 } };
  close(engine.giftFolds(inBeat, { ...E, gapMs: 1000 }, r, 5000), 25 * 30 * 2 + 90 * 10);
  // a short pause: the streak the player sees, 10 beats lower (r8-03)
  close(engine.giftFolds(inBeat, { ...E, gapMs: 1000 }, r, 6000), 25 * 20 * 2 + 90 * 10, 1e-9, "a short pause");
  close(engine.giftFolds(inBeat, { ...E, gapMs: 1000 }, r, 8501), 25 * 4 * 2 + 90 * 10, 1e-9, "the rhythm lapsed");
});

test("gilded crane gaps: craneLo · (1 + 0.5·u) active s, 340-510 s (Crane Bait 240-360, Crane Song 170-255); each crane holds its keyed outcome", () => {
  const s = seeded(21);
  const me = writer(s);
  let t = T0;
  const gaps = [];
  const outcomes = { gift: 0, storm: 0, song: 0 };
  let last = null;
  s.settings.nodes = false;
  for (let i = 0; i < 40000 && gaps.length < 60; i++) {
    t += 1000;
    const ev = me.act({ t, type: "click", target: "sheet" });
    const e = ev.find((x) => x.kind === "spawn" && x.what === "crane");
    if (!e) continue;
    outcomes[s.spawn.crane.outcome]++;
    assert.equal(s.spawn.crane.outcome, craneOutcome(s, e.n - 1), "the spawned crane holds the keyed roll for its number");
    if (last !== null) gaps.push(s.spawn.activeMs - last);
    last = s.spawn.activeMs;
    s.spawn.crane = null; // gone, so the next one is never blocked
  }
  assert.ok(gaps.length >= 50);
  for (const g of gaps) assert.ok(g >= 339000 && g <= 511000, `gap ${g}`);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) > 100000, "the gaps spread over the range");
  const n = outcomes.gift + outcomes.storm + outcomes.song;
  assert.ok(outcomes.gift > 0 && outcomes.storm > 0 && outcomes.song > 0, JSON.stringify(outcomes));
  // 60 cranes pin only the wiring loosely; the shares are pinned tightly in
  // the craneOutcome test below (review r6-14).
  for (const [k, p] of [["gift", 0.4], ["storm", 0.35], ["song", 0.25]]) {
    assert.ok(Math.abs(outcomes[k] / n - p) < 0.15, `${k} share ${JSON.stringify(outcomes)}`);
  }
  const E = engine.effects(s);
  assert.equal(E.craneLo, 340);
  s.bought["crane-bait"] = true;
  assert.equal(engine.effects(s).craneLo, 240);
  s.bought["crane-song"] = true;
  assert.equal(engine.effects(s).craneLo, 170);
});

// Review r6-14: the outcome shares themselves (DESIGN §4.5: Crane's Gift
// 40 %, Confetti 35 %, Flock Song 25 %). 4,000 keyed rolls per seed put the
// sampling error near 0.8 points, so a 2.5-point band catches swapped odds
// (5 points off) or any share drifting.
test("gilded crane outcomes: Crane's Gift 40 %, Confetti ('storm') 35 %, Flock Song 25 % of keyed rolls", () => {
  assert.equal(K.craneGiftOdds, 0.4);
  assert.equal(K.craneConfettiOdds, 0.35);
  const want = { gift: 0.4, storm: 0.35, song: 0.25 };
  for (const seed of [1, 7, 21, 99]) {
    const s = seeded(seed);
    const o = { gift: 0, storm: 0, song: 0 };
    const N = 4000;
    for (let i = 0; i < N; i++) o[craneOutcome(s, i)]++;
    assert.equal(o.gift + o.storm + o.song, N, "every roll is one of the three outcomes");
    for (const k of Object.keys(want)) {
      assert.ok(Math.abs(o[k] / N - want[k]) < 0.025, `seed ${seed}: ${k} ${o[k]}/${N} ${JSON.stringify(o)}`);
    }
    assert.equal(craneOutcome(s, 5), craneOutcome(seeded(seed), 5), "the roll is keyed: same seed and number, same outcome");
  }
  // Seed 21 pinned exactly, so any change to the roll shows here.
  const s = seeded(21);
  const o = { gift: 0, storm: 0, song: 0 };
  for (let i = 0; i < 4000; i++) o[craneOutcome(s, i)]++;
  assert.deepEqual(o, { gift: 1569, storm: 1483, song: 948 });
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

test("r1-19: the first gilded crane carries its one-time line until a crane is caught", () => {
  const s = seeded(11);
  const me = writer(s);
  s.ui.hints.fold = true;
  s.spawn.crane = { id: "gX", slot: 1, born: s.spawn.shownMs, outcome: "gift" };
  const vm = engine.view(s, T0, { role: "panel", width: 320 });
  assert.equal(vm.mat.crane.hint, "A gilded crane! Click it before it flies off.");
  me.act({ t: T0 + 10, type: "click", target: "crane", id: "gX" });
  assert.equal(s.ui.hints.crane, true);
  s.spawn.crane = { id: "gY", slot: 1, born: s.spawn.shownMs, outcome: "song" };
  assert.equal(engine.view(s, T0 + 20, { role: "panel", width: 320 }).mat.crane.hint, null, "once: never again after the first catch");
});

test("r1-19: a missed first crane does not bring the line back on later cranes", () => {
  const s = seeded(11);
  s.ui.hints.fold = true;
  // The first crane as the spawn clock makes it (cranesSeen counts it in).
  s.spawn.cranesSeen = 1;
  s.spawn.crane = { id: "g1", slot: 1, born: s.spawn.shownMs, outcome: "gift" };
  assert.equal(engine.view(s, T0, { role: "panel", width: 320 }).mat.crane.hint, "A gilded crane! Click it before it flies off.");
  // It flies off uncaught; the second crane appears.
  s.spawn.cranesSeen = 2;
  s.spawn.crane = { id: "g2", slot: 1, born: s.spawn.shownMs, outcome: "gift" };
  assert.equal(s.ui.hints.crane, false);
  assert.equal(engine.view(s, T0 + 20, { role: "panel", width: 320 }).mat.crane.hint, null);
});

// ---------------------------------------------------------------------------
// Crease fields, fold pieces and the Pattern book (DESIGN §4.7, ARCHITECTURE B17)

const PAT = (id) => engine.CONTENT.PATTERNS.find((p) => p.id === id);
const dotsOf = (id) => PAT(id).dots.map(([c, r]) => r * 3 + c);
const earned = (ev, src) => ev.filter((e) => e.kind === "earn" && e.source === src).reduce((a, e) => a + e.amount, 0);

/** A game with Crease Field bought and a crease field up (a click at `t` brought it in). */
function withField(seed = 5, { calm = false } = {}) {
  const s = seeded(seed);
  const me = writer(s);
  if (calm) me.act({ t: T0, type: "setting", key: "calm", value: true });
  me.act({ t: T0 + 1, type: "click", target: "sheet" });
  s.bought["long-crease"] = true;
  s.bought["grand-crease"] = true;
  s.bank += 1e8;
  const ev = me.act({ t: T0 + 2, type: "buy", item: "crease-field", count: 1 });
  assert.equal(ev[0].kind, "buy");
  s.spawn.nextChainAt = s.spawn.activeMs + 100;
  const t = T0 + 600;
  const ev2 = me.act({ t, type: "click", target: "sheet" });
  assert.ok(s.spawn.field, "the next chain is a field");
  assert.ok(ev2.some((e) => e.kind === "spawn" && e.what === "field"));
  return { s, me, t };
}

/** Click dot i of the live field (or of `fieldId`) at t. */
const dot = (s, me, i, t, fieldId) => me.act({ t, type: "click", target: "dot", id: `${fieldId || s.spawn.field.id}-${i}` });

/** Trace `dots` from t, 300 ms apart, then the setting click; returns { ev of the last click, t }. */
function trace(s, me, dots, t, finish) {
  const id = s.spawn.field.id;
  let ev = [];
  for (const i of dots) { t += 300; ev = dot(s, me, i, t, id); }
  if (finish !== undefined) { t += 300; ev = dot(s, me, finish, t, id); }
  return { ev, t };
}

test("§4.7 Crease Field: needs Grand Crease; opens the book; the next chain is a field; no estimate, so never the best buy", () => {
  const s = seeded(2);
  const me = writer(s);
  s.bank = 1e9;
  assert.equal(me.act({ t: T0 + 1, type: "buy", item: "crease-field", count: 1 })[0].reason, "locked");
  s.bought["long-crease"] = true;
  s.bought["grand-crease"] = true;
  assert.equal(engine.estimate(s, "crease-field"), 0);
  assert.equal(s.book.open, false);
  assert.equal(s.spawn.fieldIn, null);
  me.act({ t: T0 + 2, type: "buy", item: "crease-field", count: 1 });
  assert.equal(s.book.open, true);
  assert.equal(s.spawn.fieldIn, 1);
  assert.equal(engine.view(s, T0 + 2, { tab: "shop" }).shop.segments.curios.find((r) => r.id === "crease-field").best, false);
  assert.equal(engine.effects(s).field, true);
});

test("§4.7 a dot click is exactly a Sheet fold, then a trace step; the centre never starts", () => {
  const { s, me, t } = withField();
  const twin = engine.cloneState(s);
  const tw = writer(twin);
  // the same writer seq on both copies
  for (let k = 0; k < me.seq; k++) tw.make({});
  const a = dot(s, me, 4, t + 300);
  const b = tw.act({ t: t + 300, type: "click", target: "sheet" });
  assert.deepEqual(a.filter((e) => e.kind === "earn"), b.filter((e) => e.kind === "earn"), "the centre: only its fold");
  assert.equal(s.bank, twin.bank);
  assert.equal(s.hand.frame, twin.hand.frame);
  assert.equal(s.stats.hits, twin.stats.hits);
  assert.deepEqual(s.spawn.field.path, [], "the centre never starts a trace");
  const c = dot(s, me, 0, t + 600);
  const d = tw.act({ t: t + 600, type: "click", target: "sheet" });
  assert.deepEqual(c.filter((e) => e.kind === "earn"), d.filter((e) => e.kind === "earn"), "a start pays its fold and nothing else");
  assert.deepEqual(s.spawn.field.path, [0]);
  assert.ok(c.some((e) => e.kind === "trace" && e.result === "start"));
  // a dot that is not a step is only its fold
  dot(s, me, 8, t + 900);
  assert.deepEqual(s.spawn.field.path, [0]);
  // a click too fast is ignored outright: no fold, no step
  const fast = dot(s, me, 1, t + 920);
  assert.equal(fast[0].reason, "fast");
  assert.deepEqual(s.spawn.field.path, [0]);
});

test("§4.7 a match pays matchPerNode·chainK·Vc whatever the diagram (+ firstFindPerDot·n·Vc the first time), counts in the book, drops a fold piece and ends the field", () => {
  const { s, me, t } = withField();
  const { ev } = trace(s, me, dotsOf("ridge"), t, dotsOf("ridge")[2]);
  const m = ev.find((e) => e.kind === "trace" && e.result === "match");
  assert.deepEqual([m.pattern, m.first, m.tier], ["ridge", true, 1]);
  // the setting click's own fold pays Vc (5·Vc on a figure), so the match is a multiple of it
  const fig = ev.some((e) => e.kind === "figure");
  const vc = earned(ev, "sheet") / (fig ? K.figureMult : 1);
  const k = engine.effects(s).chainK;
  assert.equal(k, 7);
  close(earned(ev, "pattern"), (K.matchPerNode * k + K.firstFindPerDot * 3) * vc);
  assert.equal(s.spawn.field, null, "a match ends the field");
  assert.equal(s.book.found.ridge.n, 1);
  assert.equal(s.book.found.ridge.ready, 0);
  assert.equal(s.ui.hints.field, true);
  assert.ok(s.spawn.fold && s.spawn.fold.kind === "ridge", "a fold piece landed");
  assert.ok(engine.CONTENT.FREE_SLOTS.includes(s.spawn.fold.slot));
  assert.equal(s.spawn.lastField.pattern, "ridge");
  // a second Ridge pays without the first-find part
  s.spawn.field = { id: "p999", born: s.spawn.shownMs, path: [] };
  const r2 = trace(s, me, [6, 4, 2], t + 3000, 2);
  const vc2 = earned(r2.ev, "sheet") / (r2.ev.some((e) => e.kind === "figure") ? K.figureMult : 1);
  close(earned(r2.ev, "pattern"), K.matchPerNode * k * vc2);
  assert.equal(s.book.found.ridge.n, 2);
  assert.ok(r2.ev.every((e) => !(e.kind === "spawn" && e.what === "fold")), "one fold piece at a time");
  // the same pay for the 9-dot Coil (found before, so no first-find part): the field, not the size, is scarce
  s.book.found.coil = { n: 1, at: T0, ready: 0 };
  s.spawn.field = { id: "p998", born: s.spawn.shownMs, path: [] };
  const r3 = trace(s, me, dotsOf("coil"), r2.t + 3000, dotsOf("coil")[8]);
  assert.ok(r3.ev.some((e) => e.kind === "trace" && e.result === "match" && e.pattern === "coil"));
  const vc3 = earned(r3.ev, "sheet") / (r3.ev.some((e) => e.kind === "figure") ? K.figureMult : 1);
  close(earned(r3.ev, "pattern"), K.matchPerNode * k * vc3);
});

test("§4.7 a trace set by the field's life end pays at the rhythm the player sees then, not the stored streak", () => {
  const { s, me, t } = withField(7);
  s.hand.r = K.rMax;
  s.hand.lastHitAt = t;
  const { t: t1 } = trace(s, me, dotsOf("ridge"), t);
  assert.equal(s.spawn.field.path.length, 3);
  assert.equal(s.hand.r, K.rMax, "the streak held while tracing");
  // hands off: the field runs out long after the rhythm has ended
  const end = s.spawn.field.born + K.fieldLifeMs - s.spawn.shownMs + t1;
  assert.ok(end - t1 > K.slipMs, "the rhythm is over by the field's end");
  const ev = engine.advance(s, end + 500);
  assert.ok(ev.some((e) => e.kind === "trace" && e.result === "match" && e.pattern === "ridge"));
  const V = engine.rates(s, s.clock).V;
  close(earned(ev, "pattern"), (K.matchPerNode * engine.effects(s).chainK + K.firstFindPerDot * 3) * V);
});

test("§4.7 the four ways to set: last dot again, close on the first, a dead end, the field's life end (it pays)", () => {
  // close: a Napkin
  {
    const { s, me, t } = withField(7);
    const { ev } = trace(s, me, [0, 1, 4, 3], t, 0);
    assert.equal(ev.find((e) => e.kind === "trace" && e.result === "match").pattern, "napkin");
  }
  // a dead end sets at once, open: all nine round the grid, ending away from the first
  {
    const { s, me, t } = withField(7);
    const { ev } = trace(s, me, [0, 3, 6, 7, 4, 1, 2, 5, 8], t);
    const set = ev.find((e) => e.kind === "trace" && (e.result === "match" || e.result === "loose"));
    assert.ok(set, "the step onto 8 set the trace");
    assert.equal(set.result, "loose", "a 9-dot S is no diagram");
    assert.deepEqual(s.spawn.field.path, [], "loose: the trace clears and the field stays");
  }
  // life end with 3+ dots: sets open and pays at that moment's Vc
  {
    const { s, me, t } = withField(7);
    trace(s, me, dotsOf("stair"), t);
    assert.equal(s.spawn.field.path.length, 5);
    const ev = engine.advance(s, t + 1500 + K.fieldLifeMs);
    assert.ok(ev.some((e) => e.kind === "trace" && e.result === "match" && e.pattern === "stair"));
    assert.ok(ev.some((e) => e.kind === "trace" && e.result === "expired"));
    assert.ok(earned(ev, "pattern") > 0);
    assert.equal(s.spawn.field, null);
  }
  // life end with fewer than 3 dots: nothing set, the field just goes
  {
    const { s, me, t } = withField(7);
    trace(s, me, [0, 1], t);
    const ev = engine.advance(s, t + 1500 + K.fieldLifeMs);
    assert.ok(ev.some((e) => e.kind === "trace" && e.result === "expired"));
    assert.ok(!ev.some((e) => e.kind === "trace" && (e.result === "match" || e.result === "loose")));
    assert.equal(s.book.found.stair, undefined);
  }
});

test("§4.7 a loose crease pays nothing more, keeps the field and clears the trace; its near miss names only found or next diagrams", () => {
  const { s, me, t } = withField(9);
  const { ev } = trace(s, me, [0, 1, 4], t, 4);
  assert.ok(ev.some((e) => e.kind === "trace" && e.result === "loose"));
  assert.equal(earned(ev, "pattern"), 0);
  assert.ok(s.spawn.field, "the field stays up");
  assert.deepEqual(s.spawn.field.path, []);
  // the next to find is Ridge: an L is not its start, and Napkin is hidden, so nothing is named
  assert.equal(s.spawn.lastField.near, null);
  const vm = engine.view(s, t + 1300);
  assert.equal(vm.sheet.fieldResult.text, "Loose crease");
  assert.equal(vm.sheet.fieldResult.style, "loose");
  // once Napkin is found, the same L is "Napkin needs 1 more"
  s.book.found.napkin = { n: 1, at: T0, ready: 0 };
  trace(s, me, [0, 1, 4], t + 1500, 4);
  assert.equal(s.spawn.lastField.near, "napkin");
  assert.equal(engine.view(s, t + 2900).sheet.fieldResult.text, "Loose · Napkin needs 1 more");
});

test("§4.7 a dot click on a field that has gone is a plain Sheet fold", () => {
  const { s, me, t } = withField(11);
  const id = s.spawn.field.id;
  engine.advance(s, t + K.fieldLifeMs + 100);
  assert.equal(s.spawn.field, null);
  const ev = dot(s, me, 0, t + K.fieldLifeMs + 200, id);
  assert.ok(ev.some((e) => e.kind === "earn" && e.source === "sheet"));
  assert.ok(!ev.some((e) => e.kind === "ignored"));
  assert.ok(!ev.some((e) => e.kind === "trace"));
});

test("§4.7 a chain due under a field waits a second at a time and comes when the field ends; then every 5th primary chain is a field", () => {
  const { s, me, t } = withField(13);
  assert.equal(s.spawn.fieldIn, K.fieldEvery);
  const sp = s.spawn;
  sp.nextChainAt = sp.activeMs + 50;
  let tt = t + 300;
  me.act({ t: tt, type: "click", target: "sheet" });
  assert.equal(sp.chain, null, "no numbered chain shares the mat with a field");
  assert.ok(sp.nextChainAt - sp.activeMs <= K.fieldWaitMs && sp.nextChainAt > sp.activeMs);
  // finish the field: the chain comes within a second
  trace(s, me, dotsOf("ridge"), tt, dotsOf("ridge")[2]);
  tt += 1200;
  assert.equal(sp.field, null);
  tt += 1100;
  me.act({ t: tt, type: "click", target: "sheet" });
  assert.ok(sp.chain, "the waiting chain came");
  assert.equal(sp.fieldIn, K.fieldEvery - 1);
  // count primary chains down to the next field
  const kinds = [];
  for (let n = 0; n < 5; n++) {
    sp.chain = null;
    sp.field = null;
    sp.nextChainAt = sp.activeMs + 50;
    tt += 300;
    const ev = me.act({ t: tt, type: "click", target: "sheet" });
    kinds.push(ev.filter((e) => e.kind === "spawn").map((e) => e.what).join(""));
  }
  assert.deepEqual(kinds, ["chain", "chain", "chain", "field", "chain"]);
});

test("§4.7 Confetti chains are always numbered and never count down; 'Crease nodes appear' off turns fields off", () => {
  const { s, me, t } = withField(15);
  const sp = s.spawn;
  sp.field = null;
  sp.fieldIn = 1;
  s.boosts.stormEnd = t + 60000;
  s.boosts.storm = 60000;
  sp.nextChainAt = sp.activeMs + 50;
  me.act({ t: t + 300, type: "click", target: "sheet" });
  assert.ok(sp.chain, "a numbered chain during Confetti");
  assert.equal(sp.field, null);
  assert.equal(sp.fieldIn, 1, "Confetti never counts down");
  s.boosts.stormEnd = 0;
  s.boosts.storm = 0;
  sp.chain = null;
  me.act({ t: t + 400, type: "setting", key: "nodes", value: false });
  sp.nextChainAt = sp.activeMs + 50;
  me.act({ t: t + 700, type: "click", target: "sheet" });
  assert.equal(sp.field, null);
  assert.equal(sp.chain, null);
});

test("§4.7 the Crease Helper never touches a field", () => {
  const { s, me, t } = withField(17);
  s.bought["crease-helper"] = true;
  s.auto["crease-helper"] = true;
  trace(s, me, [0, 1], t);
  const ev = engine.advance(s, t + 1000 + K.fieldLifeMs);
  assert.ok(!ev.some((e) => e.kind === "earn" && (e.source === "node" || e.source === "pattern")));
  assert.equal(Object.keys(s.book.found).length, 0);
  assert.equal(engine.view(s, s.clock, { tab: "shop" }).shop.segments.auto.find((r) => r.id === "crease-helper").note, "Only your own hands fill the book");
});

test("§4.7 each fold piece's effect; it pays 1·Vc to `fold`, rests its diagram 3 active minutes and hops onto the shelf", () => {
  for (const p of engine.CONTENT.PATTERNS) {
    const { s, me, t } = withField(19);
    const sp = s.spawn;
    sp.field = null;
    s.book.found[p.id] = { n: 1, at: T0, ready: 0 };
    sp.fold = { id: "f77", kind: p.id, slot: 1, born: sp.shownMs };
    const before = { r: s.hand.r, frame: s.hand.frame, glow: s.hand.afterglowMs, crane: sp.nextCraneAt, chain: sp.nextChainAt };
    const ev = me.act({ t: t + 300, type: "click", target: "fold", id: "f77" });
    assert.ok(earned(ev, "fold") > 0, p.id);
    assert.deepEqual(ev.find((e) => e.kind === "fold"), { kind: "fold", pattern: p.id, fx: p.fx });
    assert.equal(sp.fold, null);
    assert.equal(s.book.found[p.id].ready, sp.activeMs + K.patternRestMs, `${p.id} rests`);
    assert.equal(s.hand.figures[s.hand.figures.length - 1], `p:${p.id}`);
    switch (p.fx) {
      case "steady": assert.equal(s.hand.steady, 1); break;
      case "pull":
        assert.equal(sp.nextCraneAt, Math.max(sp.activeMs + K.gullMinMs, before.crane - K.gullPullMs));
        assert.equal(sp.gullFor, sp.cranesSeen);
        break;
      case "glow": assert.equal(s.hand.afterglowMs, Math.min(K.glowMaxMs, before.glow + K.napkinGlowMs)); break;
      case "finish": assert.equal(s.hand.frame, K.lozengeFrame); break;
      case "lift": assert.equal(s.hand.r, Math.min(K.rMax, before.r + 1 + K.stairBeats)); break;
      case "wind": assert.equal(sp.windUntil, sp.activeMs + K.windMs); break;
      case "hurry":
        assert.equal(sp.nextChainAt, Math.min(before.chain, sp.activeMs + K.hurryMs));
        assert.equal(sp.hurry, 1);
        break;
      case "margin": assert.equal(sp.fieldIn, 1); break;
      case "windup": assert.equal(s.boosts.coilEnd, t + 300 + K.coilMs); break;
      default: assert.fail(p.fx);
    }
    // a gone fold is ignored
    assert.equal(me.act({ t: t + 600, type: "click", target: "fold", id: "f77" })[0].reason, "gone");
  }
});

test("§4.7 Hurry with a chain still live: the next chain comes within a second of that chain ending, never a full interval later", () => {
  const { s, me, t } = withField(19);
  const sp = s.spawn;
  sp.field = null;
  sp.fieldIn = 3;
  sp.nextChainAt = sp.activeMs + 50;
  let tt = t + 300;
  me.act({ t: tt, type: "click", target: "sheet" });
  assert.ok(sp.chain, "a numbered chain is live");
  const live = sp.chain;
  s.book.found.switchback = { n: 1, at: T0, ready: 0 };
  sp.fold = { id: "f88", kind: "switchback", slot: 1, born: sp.shownMs };
  tt += 3000;
  me.act({ t: tt, type: "click", target: "fold", id: "f88" });
  assert.equal(sp.hurry, 1);
  assert.ok(sp.nextChainAt - sp.activeMs <= K.hurryMs);
  // keep the hand on the mat (active time) and leave the chain alone until it runs out
  const ends = live.born + K.nodeLifeMs - sp.shownMs + tt;
  let spawned = null;
  while (!spawned && tt < ends + 5000) {
    tt += 250;
    const ev = me.act({ t: tt, type: "click", target: "sheet" });
    if (sp.chain && sp.chain !== live) spawned = tt;
    if (sp.chain === live) assert.ok(sp.nextChainAt - sp.activeMs <= K.hurryMs, "while it is live the next chain stays due within 2 s");
    void ev;
  }
  assert.ok(spawned, "the hurried chain came");
  assert.ok(spawned - ends <= K.fieldWaitMs + 250, `within a second of the live chain ending (${spawned - ends} ms)`);
  assert.equal(sp.hurry, 0, "spent");
  assert.ok(sp.nextChainAt - sp.activeMs > K.hurryMs, "then the usual interval");
});

test("§4.7 Gull: no fold piece while this crane gap is already pulled; a Gull fold that pulls nothing starts no rest", () => {
  const { s, me, t } = withField(25);
  const sp = s.spawn;
  sp.gullFor = sp.cranesSeen;
  s.book.found.gull = { n: 1, at: T0, ready: 0 };
  const r = trace(s, me, dotsOf("gull"), t, dotsOf("gull")[2]);
  assert.ok(r.ev.some((e) => e.kind === "trace" && e.result === "match" && e.pattern === "gull"));
  assert.equal(sp.fold, null, "nothing to pull: no fold piece");
  assert.equal(engine.view(s, r.t + 10).sheet.fieldResult.text, "Gull · pull used");
  assert.equal(engine.view(s, r.t + 10, { tab: "book" }).book.cards.find((c) => c.id === "gull").status, "pull used");
  // a Gull fold already on the mat when its pull is spent: the click pays its fold but starts no rest
  sp.fold = { id: "f90", kind: "gull", slot: 1, born: sp.shownMs };
  const before = sp.nextCraneAt;
  me.act({ t: r.t + 300, type: "click", target: "fold", id: "f90" });
  assert.equal(sp.nextCraneAt, before);
  assert.equal(s.book.found.gull.ready, 0, "no rest");
});

test("§4.7 rests and fold pieces: a resting diagram's match drops nothing (\"rests 1:40\"); an unclicked fold piece starts no rest", () => {
  const { s, me, t } = withField(21);
  trace(s, me, dotsOf("gull"), t, dotsOf("gull")[2]);
  const fold = s.spawn.fold;
  assert.equal(fold.kind, "gull");
  // it expires unclicked: no rest
  engine.advance(s, t + 2000 + K.foldLifeMs);
  assert.equal(s.spawn.fold, null);
  assert.equal(s.book.found.gull.ready, 0);
  // the next Gull drops one again; clicking it rests Gull
  s.spawn.field = { id: "p500", born: s.spawn.shownMs, path: [] };
  let tt = t + 3000 + K.foldLifeMs;
  me.act({ t: tt, type: "click", target: "sheet" });
  ({ t: tt } = trace(s, me, dotsOf("gull"), tt, dotsOf("gull")[2]));
  assert.equal(s.spawn.fold.kind, "gull");
  tt += 300;
  me.act({ t: tt, type: "click", target: "fold", id: s.spawn.fold.id });
  const ready = s.book.found.gull.ready;
  assert.equal(ready, s.spawn.activeMs + K.patternRestMs);
  s.spawn.field = { id: "p501", born: s.spawn.shownMs, path: [] };
  const r = trace(s, me, dotsOf("gull"), tt, dotsOf("gull")[2]);
  assert.ok(r.ev.some((e) => e.kind === "trace" && e.result === "match"));
  assert.equal(s.spawn.fold, null, "a resting diagram drops nothing");
  assert.ok(s.spawn.lastField.rest > 0);
  assert.match(engine.view(s, r.t + 10).sheet.fieldResult.text, /^Gull · rests \d:\d\d$/);
  const card = engine.view(s, r.t + 10, { tab: "book" }).book.cards.find((c) => c.id === "gull");
  assert.match(card.status, /^rests \d:\d\d$/);
});

test("§4.7 Steady keeps the streak through one short pause; Wind-up doubles hand hits only without Rush or Confetti; Fair wind lengthens scrap and crane lives", () => {
  const s = seeded(23);
  const me = writer(s);
  let t = T0 + 1;
  for (let i = 0; i < 45; i++, t += 800) me.act({ t, type: "click", target: "sheet" });
  assert.equal(s.hand.r, 40);
  s.hand.steady = 1;
  const E = engine.effects(s);
  assert.equal(engine.rhythmAt(s, E, t + 1500), 40, "the meter keeps it during the pause");
  me.act({ t: t + 1500, type: "click", target: "sheet" });
  assert.equal(s.hand.r, 40, "no beats lost");
  assert.equal(s.hand.steady, 0, "the charge is used");
  me.act({ t: t + 3500, type: "click", target: "sheet" });
  assert.equal(s.hand.r, 30, "the next pause costs as usual");
  // Wind-up
  s.boosts.coilEnd = t + 20000;
  assert.equal(engine.hitBoost(s, E, t + 5000), K.coilMult);
  s.boosts.rushEnd = t + 10000;
  assert.equal(engine.hitBoost(s, E, t + 5000), E.rushMult, "Rush takes over; no stacking");
  s.boosts.stormEnd = t + 10000;
  assert.equal(engine.hitBoost(s, E, t + 5000), E.stormMult);
  assert.equal(engine.hitBoost(s, E, t + 30000), 1);
  // Fair wind: lifeOf is the one source of lives; calm doubles every one
  assert.equal(engine.lifeOf(s, E, "scrap", { wind: true }), K.scrapLifeMs * K.windLife);
  assert.equal(engine.lifeOf(s, E, "crane", { wind: true }), K.craneLifeMs * K.windLife);
  assert.equal(engine.lifeOf(s, E, "field", {}), K.fieldLifeMs);
  assert.equal(engine.lifeOf(s, E, "fold", {}), K.foldLifeMs);
  me.act({ t: t + 40000, type: "setting", key: "calm", value: true });
  const Ec = engine.effects(s);
  for (const what of ["chain", "scrap", "crane", "boat", "field", "fold"]) assert.equal(engine.lifeOf(s, Ec, what, {}), 2 * engine.lifeOf(s, E, what, {}), what);
  // a scrap spawned under Fair wind carries the flag (a hand input first: spawns run on active time)
  me.act({ t: t + 40100, type: "click", target: "sheet" });
  s.spawn.windUntil = s.spawn.activeMs + 60000;
  s.spawn.nextScrapAt = s.spawn.activeMs + 50;
  me.act({ t: t + 40300, type: "click", target: "sheet" });
  assert.equal(s.spawn.scraps[s.spawn.scraps.length - 1].wind, true);
  assert.equal(engine.lifeLeft(s, Ec, "scrap", s.spawn.scraps[0]), 2 * K.scrapLifeMs * K.windLife - (s.spawn.shownMs - s.spawn.scraps[0].born));
});

test("§4.7 a wish keeps the book and clears Crease Field, the field, the fold piece, Steady and Wind-up", () => {
  const { s, me, t } = withField(25);
  trace(s, me, dotsOf("ridge"), t, dotsOf("ridge")[2]);
  s.hand.steady = 1;
  s.boosts.coilEnd = t + 1e6;
  s.spawn.field = { id: "p42", born: s.spawn.shownMs, path: [0] };
  s.lifetime = engine.lifetimeFor(1000);
  const book = JSON.stringify(s.book);
  const ev = me.act({ t: t + 5000, type: "wish" });
  assert.ok(ev.some((e) => e.kind === "wish"));
  assert.equal(JSON.stringify(s.book), book, "the book is kept");
  assert.equal(s.book.open, true);
  assert.equal(s.bought["crease-field"], undefined);
  assert.deepEqual([s.spawn.fieldIn, s.spawn.field, s.spawn.fold, s.spawn.gullFor, s.spawn.windUntil], [null, null, null, -1, 0]);
  assert.equal(s.hand.steady, 0);
  assert.equal(s.boosts.coilEnd, 0);
  assert.equal(engine.view(s, t + 5000).book.line, "Buy Crease Field (Curios) to bring fields back this run");
  // a rebuy brings a field at the next chain
  s.bought["long-crease"] = true;
  s.bought["grand-crease"] = true;
  s.bank = 1e8;
  me.act({ t: t + 6000, type: "buy", item: "crease-field", count: 1 });
  assert.equal(s.spawn.fieldIn, 1);
});

test("§4.7 determinism: the same seed and inputs, fields traced, give byte-identical saves; fields use no draw", () => {
  const play = () => {
    const { s, me, t } = withField(27);
    let tt = t;
    ({ t: tt } = trace(s, me, dotsOf("coil"), tt, dotsOf("coil")[8]));
    if (s.spawn.fold) me.act({ t: tt + 300, type: "click", target: "fold", id: s.spawn.fold.id });
    for (let i = 0; i < 200; i++) me.act({ t: tt + 600 + i * 700, type: "click", target: "sheet" });
    engine.advance(s, tt + 600 + 200 * 700 + 5000);
    return s;
  };
  const a = play();
  const b = play();
  assert.equal(engine.serialize(a), engine.serialize(b));
  assert.equal(a.rng, a.seed, "no stream draw (every roll is keyed)");
  assert.equal(a.book.found.coil.n, 1);
});

test("§4.7 the book hint merges as the larger number of marks seen; a bad one is ignored", () => {
  const s = seeded(29);
  const me = writer(s);
  me.act({ t: T0, type: "hint", key: "book", n: 5 });
  me.act({ t: T0 + 1, type: "hint", key: "book", n: 3 });
  assert.equal(s.ui.hints.book, 5);
  assert.equal(me.act({ t: T0 + 2, type: "hint", key: "book", n: 99 })[0].reason, "hint");
  assert.equal(me.act({ t: T0 + 3, type: "hint", key: "book", n: "7" })[0].reason, "hint");
  assert.equal(s.ui.hints.book, 5);
});

test("§4.7 a closed diagram traced in full but set open names it with 'end on the first dot' (Napkin; the Hem ring names Hem, not Coil)", () => {
  const { s, me, t } = withField(9);
  s.book.found.napkin = { n: 1, at: T0, ready: 0 };
  // the Napkin square, its last dot clicked again: loose, but one closing click from Napkin
  const r = trace(s, me, [0, 1, 4, 3], t, 3);
  assert.ok(r.ev.some((e) => e.kind === "trace" && e.result === "loose"));
  assert.equal(s.spawn.lastField.near, "napkin");
  assert.equal(s.spawn.lastField.close, true);
  assert.equal(s.spawn.lastField.more, 0);
  const text = engine.view(s, r.t + 10).sheet.fieldResult.text;
  assert.equal(text, "Loose · Napkin: end on the first dot");
  assert.ok(engine.graphemeCount(text) <= 40);
  // the full Hem ring set open: Hem (its closing click), never "Coil needs 1 more"
  s.book.found.hem = { n: 1, at: T0, ready: 0 };
  s.book.found.coil = { n: 1, at: T0, ready: 0 };
  const ring = dotsOf("hem");
  const r2 = trace(s, me, ring, r.t + 400, ring[ring.length - 1]);
  assert.equal(s.spawn.lastField.near, "hem");
  assert.equal(engine.view(s, r2.t + 10).sheet.fieldResult.text, "Loose · Hem: end on the first dot");
  // a hidden closed diagram is never named this way
  assert.deepEqual(engine.nearMiss([1, 5, 7, 3], ["ridge"]), null);
  assert.deepEqual(engine.nearMiss([1, 5, 7, 3], ["lozenge"]), { id: "lozenge", more: 0, close: true });
  // a closed set is matched or loose on its own: no "end on the first dot" for it
  assert.equal(engine.nearMiss([0, 1, 4, 3], ["napkin"], true), null);
});

test("§4.7 Wind-up clicked under Confetti or Rush waits for it to end, then runs its 10 s; its chip says it waits", () => {
  const { s, me, t } = withField(19);
  const E = engine.effects(s);
  const sp = s.spawn;
  sp.field = null;
  s.book.found.coil = { n: 1, at: T0, ready: 0 };
  s.boosts.stormEnd = t + 20000;
  sp.fold = { id: "f81", kind: "coil", slot: 1, born: sp.shownMs };
  me.act({ t: t + 300, type: "click", target: "fold", id: "f81" });
  assert.equal(s.boosts.coilEnd, t + 20000 + K.coilMs, "the 10 s start when Confetti ends");
  assert.equal(engine.hitBoost(s, E, t + 1000), E.stormMult);
  assert.equal(engine.hitBoost(s, E, t + 20000 + 5000), K.coilMult, "×2 once Confetti is over");
  assert.equal(engine.hitBoost(s, E, t + 20000 + K.coilMs), 1);
  const chip = engine.view(s, t + 1000).boosts.find((b) => b.type === "coil");
  assert.deepEqual([chip.label, chip.msLeft, chip.after], ["Coil ×2 · waits", null, "Confetti"]);
  const timed = engine.view(s, t + 22000).boosts.find((b) => b.type === "coil");
  assert.equal(timed.msLeft, K.coilMs - 2000);
  // under Rush the same, the later of the two ends first
  s.boosts.stormEnd = 0;
  s.boosts.rushEnd = t + 400000;
  s.book.found.coil.ready = 0;
  sp.fold = { id: "f82", kind: "coil", slot: 1, born: sp.shownMs };
  me.act({ t: t + 1300, type: "click", target: "fold", id: "f82" });
  assert.equal(s.boosts.coilEnd, t + 400000 + K.coilMs);
  assert.equal(engine.view(s, t + 1400).boosts.find((b) => b.type === "coil").after, "Rush");
});

test("§4.3/§4.7 Wind-up's end moves with a clock-back and an away segment, like Rush and Confetti", () => {
  // clock-back: the ×2 never stretches over the hour the clock went back
  const { s, me, t } = withField(19);
  const E = engine.effects(s);
  s.spawn.field = null;
  s.boosts.coilEnd = s.clock + K.coilMs;
  const back = s.clock - 3600000;
  engine.advance(s, back);
  assert.equal(s.clock, back);
  assert.ok(s.boosts.coilEnd - s.clock <= K.coilMs);
  const chip = engine.view(s, back + 1).boosts.find((b) => b.type === "coil");
  assert.ok(chip && chip.msLeft <= K.coilMs);
  assert.equal(engine.hitBoost(s, E, back + K.coilMs + 1), 1, "×1 once the 10 s are over on the rebased clock");
  // away: the time left is kept, not used up
  const a = withField(21);
  a.s.spawn.field = null;
  const left = 7000;
  a.s.boosts.coilEnd = a.s.clock + left;
  const c0 = a.s.clock;
  const away = 10 * 60000;
  engine.advance(a.s, c0 + away);
  assert.equal(a.s.boosts.coilEnd - a.s.clock, left, "the coil time left is kept over an absence");
  void me; void t;
});

test("§4.7 calm: a field left alone holds the waiting chain no longer than in normal mode (K.fieldLifeMs)", () => {
  const out = {};
  for (const calm of [false, true]) {
    const { s, me, t } = withField(13, { calm });
    const sp = s.spawn;
    const born = sp.field.born;
    sp.nextChainAt = sp.activeMs + 50;
    let tt = t;
    let came = null;
    for (let n = 0; n < 40 && came === null; n++) {
      tt += 1000;
      me.act({ t: tt, type: "click", target: "sheet" });
      if (sp.chain) came = sp.shownMs - born;
    }
    out[calm] = { came, field: !!sp.field };
  }
  assert.ok(out.false.came !== null && out.true.came !== null);
  assert.ok(Math.abs(out.true.came - out.false.came) <= 1000, JSON.stringify(out));
  assert.ok(out.true.came <= K.fieldLifeMs + 2000);
  assert.equal(out.true.field, true, "in calm the field is still up beside the chain");
  assert.equal(out.false.field, false);
});

test("§4.7 with 'Crease nodes appear' off the Book says no fields come", () => {
  const { s, me, t } = withField(13);
  me.act({ t: t + 100, type: "setting", key: "nodes", value: false });
  const line = engine.view(s, t + 200, { tab: "book" }).book.line;
  assert.equal(line, "Crease nodes are off (Settings → Play): no fields come");
});

// BALANCE §7 invariants at simulator scale: on states the P1/P7 profiles
// actually reach (agents, fledglings, upgrades, boosts), not only on the
// synthetic states of test/engine/. Invariants 1, 2, 9, 12, 13 and 14 are also
// rows of the full run (test/pacing/pacing.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as engine from "../../mods/creaseworks/engine/index.js";
import { runProfile, agentObservation } from "../../tools/sim/pacing.mjs";
import { parseBalance } from "../../tools/sim/profiles.mjs";

const I = parseBalance().invariants;
const HOUR = 3600000;
const K = engine.CONTENT.K;

// P1 seed 1 at the close of day 2 (17:00, play-clock 16:00): 4 agents, 4 fledglings, ~40 purchases
const day2 = runProfile("P1", 1, { days: 2, wish: false });
const fresh = () => engine.cloneState(day2.finalState);
const P2_SEC = 16 * 3600;

let seq = 0;
const act = (s, a, w = "w-test") => engine.apply(s, { w, s: ++seq, ...a });
const observeAt = (t, helpers, day) => ({ t, type: "observe", helpers, visible: true, active: true, matShown: true, day });
const awayOf = (ev) => ev.filter((e) => e.kind === "away");

/** DESIGN §10.2 away rate per second at `s` (every present pane helper counts as seen). */
function awayRate(s, awayF) {
  const E = engine.effects(s);
  const panes = Object.values(s.helpers).filter((h) => !h.gone && h.kind === "pane");
  const N = panes.length;
  const base = (K.helperFlat * E.G + K.helperRw * E.Rw) * E.folk;
  return (awayF ?? E.awayF) * (E.Rw + (E.gather ? engine.crowd(N) * N * base : 0));
}

test("inv. 1/3: every P1 night is a 16 h gap credited exactly the 8 h cap", () => {
  assert.equal(day2.nights.length, 1);
  for (const n of day2.nights) {
    assert.equal(n.seconds, 8 * 3600);
    assert.equal(n.capped, true);
  }
});

test("inv. 3: a 20 h gap credits exactly the 8 h formula of DESIGN §10.2", () => {
  const s = fresh();
  const want = awayRate(s) * 8 * 3600;
  const ev = awayOf(engine.advance(s, s.clock + 20 * HOUR));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].seconds, 8 * 3600);
  assert.equal(ev[0].capped, true);
  assert.ok(Math.abs(ev[0].credited - want) <= 1e-9 * want, `${ev[0].credited} vs ${want}`);
  // into the pot until collected
  const before = s.lifetime;
  act(s, { t: s.clock, type: "collect" });
  assert.ok(Math.abs(s.lifetime - before - want) <= 1e-9 * want);
});

test("inv. 3: a gap of 59 s is caught up live; one of 61 s is an away segment", () => {
  const a = fresh();
  assert.deepEqual(awayOf(engine.advance(a, a.clock + 59000)), []);
  const b = fresh();
  const ev = awayOf(engine.advance(b, b.clock + 61000));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].seconds, 61);
});

test("inv. 3: two gaps less than 5 min of live time apart share one 8 h cap", () => {
  const s = fresh();
  const one = awayOf(engine.advance(s, s.clock + 6 * HOUR))[0];
  assert.equal(one.seconds, 6 * 3600);
  for (let i = 0; i < 4; i++) engine.advance(s, s.clock + 30000); // 2 min live
  const two = awayOf(engine.advance(s, s.clock + 6 * HOUR))[0];
  assert.equal(two.seconds, 2 * 3600);
  assert.equal(two.capped, true);
  // more than 5 min of live time resets the cap
  for (let i = 0; i < 11; i++) engine.advance(s, s.clock + 30000);
  const three = awayOf(engine.advance(s, s.clock + 6 * HOUR))[0];
  assert.equal(three.seconds, 6 * 3600);
});

test("inv. 3: a clock that moves back credits 0 and rebases", () => {
  const s = fresh();
  const L = s.lifetime;
  const back = s.clock - HOUR;
  const ev = engine.advance(s, back);
  assert.equal(s.lifetime, L);
  assert.equal(s.clock, back);
  assert.ok(ev.some((e) => e.kind === "notice" && e.notice === "clock"));
  assert.ok(s.notices.some((n) => n.kind === "clock"));
});

test("inv. 4: one away second never credits more than the bound with the top away factor; boosts and afterglow are frozen", () => {
  for (const st of [fresh(), runProfile("P7", 1, { days: 1, wish: false }).finalState]) {
    const s = engine.cloneState(st);
    const bound = awayRate(s, I.awayF);
    const t0 = s.clock;
    s.boosts.rushEnd = t0 + 20000;
    s.boosts.chorus = 50000;
    s.boosts.song = 30000;
    s.hand.afterglowMs = 120000;
    const ev = awayOf(engine.advance(s, t0 + 3 * HOUR))[0];
    assert.ok(ev.credited / ev.seconds <= bound * (1 + 1e-12), `${ev.credited / ev.seconds} > ${bound}`);
    assert.equal(s.boosts.rushEnd - s.clock, 20000);
    assert.equal(s.boosts.chorus, 50000);
    assert.equal(s.boosts.song, 30000);
    assert.equal(s.hand.afterglowMs, 120000);
  }
});

test("inv. 5: a scripted 100 hits/s earns exactly the value of 12.5 hits/s", () => {
  const a = fresh();
  const b = fresh();
  const t0 = a.clock + 1000;
  const sheet0 = a.stats.bySource.sheet;
  for (let ms = 0; ms < 20000; ms += 10) act(a, { t: t0 + ms, type: "click", target: "sheet" });
  for (let ms = 0; ms < 20000; ms += 80) act(b, { t: t0 + ms, type: "click", target: "sheet" });
  engine.advance(a, t0 + 20000);
  engine.advance(b, t0 + 20000);
  assert.equal(a.stats.hits, b.stats.hits);
  assert.ok(a.stats.bySource.sheet > sheet0);
  assert.equal(a.stats.bySource.sheet, b.stats.bySource.sheet);
  // (only the summation order of the other sources differs: 8× more apply calls)
  assert.ok(Math.abs(a.lifetime - b.lifetime) <= 1e-12 * b.lifetime);
});

const extraAgents = (n) => Array.from({ length: n }, (_, i) => ({
  addr: `x${i}`, created: 9000 + i, status: "working", raw: "working", turn: 0, parent: null,
  pane: `px${i}`, title: `extra ${i}`, paneName: `pane x${i}`, space: "main", tab: "1", kind: "pane",
}));

/** Hs0 as agents join one by one, on top of the `base` observation. */
function hsCurve(s, base, upTo) {
  let t = s.clock;
  const out = [engine.rates(s).Hs0];
  for (let n = 1; n <= upTo; n++) {
    act(s, observeAt((t += 1000), [...base, ...extraAgents(n)], s.day));
    out.push(engine.rates(s).Hs0);
  }
  return out;
}

test("inv. 6: eff(n) is strictly increasing; adding a working agent to a bench of equal helpers never lowers Hs0", () => {
  for (let n = 1; n <= 200; n++) assert.ok(engine.eff(n) > engine.eff(n - 1), `eff(${n})`);
  // P1's day-2 shop (G, Rw, folk, kids upgrades), a bench of fresh agents only
  const s = engine.newGame({ seed: 1, now: day2.finalState.clock, day: day2.finalState.day });
  s.owned = Object.assign(Object.create(null), day2.finalState.owned);
  s.bought = Object.assign(Object.create(null), day2.finalState.bought);
  const hs = hsCurve(s, [], 70);
  for (let n = 1; n < hs.length; n++) assert.ok(hs[n] > hs[n - 1], `n=${n}: Hs0 ${hs[n]} ≤ ${hs[n - 1]}`);
});

// Known defect (reported, not fixed here): with unequal helpers, crowd(n) applied
// to the whole sum lets a newcomer lower Hs0. At P1 seed 1's day-2 close, agent a2
// works with warm ×3 and thanks ×1.5 (b = 4.5 × base); four fresh agents raise Hs0
// to 21,463, the fifth (n = 5, crowd 0.83) lowers it to 20,714, and it keeps
// falling to 19,750 at n = 9. DESIGN §5.3 "every working agent adds output" holds
// only for equal b_i.
test("inv. 6 at simulator scale: adding a fresh working agent to P1's day-2 bench never lowers Hs0", {
  todo: "DESIGN §5.3 applies crowd(n) to the whole sum; with unequal b_i a newcomer can lower Hs0",
}, () => {
  const hs = hsCurve(fresh(), agentObservation("P1", P2_SEC), 70);
  for (let n = 1; n < hs.length; n++) assert.ok(hs[n] >= hs[n - 1], `n=${n}: Hs0 ${hs[n]} < ${hs[n - 1]}`);
});

test("inv. 7 and 9: after the P7 run the save holds 64 pane helpers and their fledglings; with 500 Album helpers it is < 256 KiB", (ctx) => {
  const r = runProfile("P7", 1, {});
  const s = engine.cloneState(r.finalState);
  const present = (kind) => Object.values(s.helpers).filter((h) => !h.gone && h.kind === kind).length;
  assert.equal(present("pane"), 64);
  assert.equal(present("kid"), 64);
  const u = r.units;
  assert.equal(u.created, u.opened + u.converted + u.waiting);
  // 500 more helpers that came and went, each with a finished task (realistic titles)
  const base = agentObservation("P7", Math.floor(r.m15) + 1);
  let t = s.clock;
  for (let batch = 0; batch < I.albumExtra / 50; batch++) {
    const list = Array.from({ length: 50 }, (_, i) => ({
      addr: `w${i % 9}:t${10000 + batch * 50 + i}`, created: t - 86400000 + i * 997, status: "working", raw: "working", turn: 0,
      parent: null, pane: `p${batch}-${i}`, title: "claude · refactor the payment module 👩🏽‍💻 and add tests for the edge cases",
      paneName: `pane ${i}`, space: "main", tab: "1", kind: "pane",
    }));
    act(s, observeAt((t += 1000), [...base, ...list], s.day));
    act(s, observeAt((t += 61000), [...base, ...list.map((o) => ({ ...o, turn: 1, status: "idle", raw: "idle" }))], s.day));
    act(s, observeAt((t += 1000), base, s.day));
  }
  engine.advance(s, t + 30000);
  assert.equal(Object.values(s.helpers).filter((h) => h.gone).length, I.albumExtra);
  assert.equal(present("pane"), 64);
  assert.equal(present("kid"), 64);
  const text = engine.serialize(s);
  assert.ok(text.length < I.saveKiB * 1024, `${text.length} bytes`);
  ctx.diagnostic(`save text with 64 + 64 present and 500 in the Album: ${(text.length / 1024).toFixed(1)} KiB`);
  const back = engine.parseSave(text);
  assert.equal(back.ok, true);
  assert.equal(engine.serialize(back.state), text);
  const v = s.stats.units;
  const waiting = Object.values(s.envelopes).reduce((a, e) => a + e.units, 0);
  assert.ok(Math.abs(v.created - (v.opened + v.converted + waiting)) < 1e-9);
});

test("inv. 8: drops are idempotent; turn < lastTurn and a first sighting give no reward", () => {
  const s = fresh();
  const list = agentObservation("P1", P2_SEC);
  const a1 = list.find((o) => o.addr === "a1");
  const t = s.clock + 1000;
  const units = () => s.stats.units.created;
  // a1 goes back to work and finishes one more task
  act(s, observeAt(t, list.map((o) => (o === a1 ? { ...o, status: "working", raw: "working" } : o)), s.day));
  const finish = { w: "w-test", s: ++seq, ...observeAt(t + 120000, list.map((o) => (o === a1 ? { ...o, turn: o.turn + 1 } : o)), s.day) };
  const u0 = units();
  engine.apply(s, finish);
  const u1 = units();
  assert.ok(u1 > u0, "a finished task drops envelope units");
  // the same action again, and the same observation from a second writer: nothing new
  assert.equal(engine.apply(s, finish)[0].reason, "applied");
  act(s, { ...observeAt(t + 121000, finish.helpers, s.day) }, "w-other");
  assert.equal(units(), u1);
  // a lower turn (the agent restarted), then a first sighting of an agent with many turns done: no reward
  const older = finish.helpers.map((o) => (o.addr === "a1" ? { ...o, turn: o.turn - 5 } : o));
  act(s, observeAt(t + 122000, older, s.day));
  assert.equal(units(), u1);
  act(s, observeAt(t + 123000, [...older, { ...a1, addr: "new", created: 77, turn: 999, status: "idle", raw: "idle" }], s.day));
  assert.equal(units(), u1);
  const v = s.stats.units;
  assert.ok(Math.abs(v.created - (v.opened + v.converted + Object.values(s.envelopes).reduce((a, e) => a + e.units, 0))) < 1e-9);
});

test("inv. 10: two runs with the same seed and inputs give byte-identical serialize()", () => {
  for (const [id, seed] of [["P1", 4], ["P7", 2]]) {
    const a = engine.serialize(runProfile(id, seed, { days: 1, wish: false }).finalState);
    const b = engine.serialize(runProfile(id, seed, { days: 1, wish: false }).finalState);
    assert.equal(a, b, id);
  }
  const c = engine.serialize(runProfile("P1", 5, { days: 1, wish: false }).finalState);
  assert.notEqual(c, engine.serialize(runProfile("P1", 4, { days: 1, wish: false }).finalState));
});

for (const seed of [1, 2, 3]) {
  test(`inv. 11: two windows sharing one save end every day within 1 % of one writer with the combined input (seed ${seed})`, () => {
    const one = runProfile("P1", seed, { days: 3, wish: false, keepState: false });
    // each window observes 2 of the 4 agents and plays every other session; the player's
    // purchases are the single writer's, in order (a purchase waits until the save affords it)
    const two = runProfile("P1", seed, {
      days: 3, wish: false, buys: one.purchases,
      windows: [
        { w: "wA", agents: [0, 1], sessions: (k) => k % 2 === 0 },
        { w: "wB", agents: [2, 3], sessions: (k) => k % 2 === 1 },
      ],
    });
    const rel = (x, y) => Math.abs(x - y) / Math.max(Math.abs(y), 1);
    for (let d = 0; d < 3; d++) {
      const a = one.dayEnd[d];
      const b = two.dayEnd[d];
      assert.equal(b.clock, a.clock);
      assert.ok(rel(b.lifetime, a.lifetime) < I.twoWindowRel, `day ${d + 1}: lifetime ${b.lifetime} vs ${a.lifetime}`);
      // no interval credited twice: workshops (a constant rate between purchases) and away agree
      assert.ok(rel(b.bySource.workshops, a.bySource.workshops) < I.twoWindowRel, `day ${d + 1}: workshops`);
      assert.ok(rel(b.bySource.away || 0, a.bySource.away || 0) < I.twoWindowRel, `day ${d + 1}: away`);
      // every finish dropped once, every task counted once
      assert.equal(b.tasks, a.tasks);
      assert.equal(b.units.created, a.units.created);
    }
    // each window kept its own helpers; none went to the Album
    const hs = Object.values(two.finalState.helpers);
    assert.equal(hs.length, 8);
    for (const h of hs) {
      assert.equal(h.gone, false, h.addr);
      assert.equal(h.seenBy, Number(h.addr.slice(1)) <= 1 ? "wA" : "wB", h.addr);
    }
  });
}

test("inv. 13: the first wish gives exactly 10 Wishes and G becomes 1.5", () => {
  const r = runProfile("P1", 1, {});
  assert.equal(r.wishGain, I.firstWishGain);
  assert.equal(r.wishEvent.gain, I.firstWishGain);
  assert.equal(r.wishEvent.G, 1.5);
  assert.ok(r.milestones["wish2:available"] > r.milestones["wish:available"]);
});

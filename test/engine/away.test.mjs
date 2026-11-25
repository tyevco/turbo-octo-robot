// Away segments (§10; BALANCE invariants 3 and 4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { engine, seeded, writer, agent, observeAction, close, T0 } from "./_util.mjs";

const H = 3600000;

/** A state with workshops, four agents (2 working, 1 resting, 1 waiting) and a running boost. */
function setup(seed = 1) {
  const s = seeded(seed);
  s.owned["paper-stack"] = 30;
  s.owned["bone-folder"] = 12;
  s.owned["scissor-stand"] = 3;
  s.bought["rice-treats"] = true;
  const me = writer(s);
  me.act(observeAction(T0, [agent(1, "working"), agent(2, "working"), agent(3, "idle"), agent(4, "blocked")]));
  return { s, me };
}

/** The §10.2 rate per credited second: f · (Rw + crowd(N) · Σ_present (0.3·G + 0.04·Rw) · folk). */
function awayRate(s, f = 0.25) {
  const r = engine.rates(s);
  const N = 4;
  return f * (r.Rw + engine.crowd(N) * N * (0.3 * r.G + 0.04 * r.Rw) * 1.5);
}

test("a 20 h gap credits exactly the 8 h formula, into the pot (inv. 3)", () => {
  const { s, me } = setup();
  const rate = awayRate(s);
  const ev = engine.advance(s, T0 + 20 * H);
  const away = ev.find((e) => e.kind === "away");
  assert.equal(away.seconds, 28800);
  assert.equal(away.capped, true);
  close(away.credited, rate * 28800);
  close(s.away.pot.folds, rate * 28800);
  assert.equal(s.bank, 0); // waits for Collect
  assert.deepEqual(s.away.pot.needs, [engine.helperId("t4", 1004)]);
  assert.equal(s.away.pot.rested, 1);
  const L = s.lifetime;
  me.act({ t: T0 + 20 * H + 1000, type: "collect" });
  // the pot plus one second of live production
  assert.ok(s.bank >= rate * 28800 && s.bank - rate * 28800 < 2 * engine.rates(s).Rp);
  close(s.lifetime - L, s.bank, 1e-9);
  assert.equal(s.away.pot, null);
  assert.ok(s.stats.bySource.away > 0);
});

test("59 s is caught up live; 61 s is an away segment (inv. 3)", () => {
  const a = setup().s;
  const ev59 = engine.advance(a, T0 + 59000);
  assert.equal(ev59.some((e) => e.kind === "away"), false);
  assert.ok(ev59.some((e) => e.kind === "earn" && e.source === "workshops"));
  const b = setup().s;
  const rate = awayRate(b);
  const ev61 = engine.advance(b, T0 + 61000);
  const away = ev61.find((e) => e.kind === "away");
  assert.equal(away.seconds, 61);
  close(away.credited, rate * 61);
  // under 5 min: credited at once with the footer note, no pot
  assert.equal(b.away.pot, null);
  close(b.bank, rate * 61);
  assert.ok(b.notices.some((n) => n.kind === "away"));
});

test("two away segments less than 5 min of live time apart share one 8 h cap (inv. 3)", () => {
  const { s } = setup();
  engine.advance(s, T0 + 6 * H);
  assert.equal(s.away.capUsedMs, 6 * H);
  let t = T0 + 6 * H;
  for (let k = 0; k < 4; k++) { t += 50000; engine.advance(s, t); } // 200 s live
  const ev = engine.advance(s, t + 6 * H);
  const away = ev.find((e) => e.kind === "away");
  assert.equal(away.seconds, 2 * 3600);
  assert.equal(away.capped, true);
  // after 5 min of live time the cap is fresh again
  t += 6 * H;
  for (let k = 0; k < 7; k++) { t += 50000; engine.advance(s, t); } // 350 s live
  const ev2 = engine.advance(s, t + 6 * H);
  assert.equal(ev2.find((e) => e.kind === "away").seconds, 6 * 3600);
});

test("a clock that moves back credits 0 and rebases with the clock notice (inv. 3)", () => {
  const { s } = setup();
  engine.advance(s, T0 + 30000);
  const bank = s.bank;
  const L = s.lifetime;
  const ev = engine.advance(s, T0 - 2 * H);
  assert.deepEqual(ev, [{ kind: "notice", notice: "clock" }]);
  assert.equal(s.clock, T0 - 2 * H);
  assert.equal(s.bank, bank);
  assert.equal(s.lifetime, L);
  assert.equal(s.notices.filter((n) => n.kind === "clock").length, 1);
  // small jitter (≤ 5 s back) is ignored, never re-credited
  engine.advance(s, T0 - 2 * H + 10000);
  const b2 = s.bank;
  assert.deepEqual(engine.advance(s, T0 - 2 * H + 6000), []);
  assert.equal(s.bank, b2);
  // the explicit rebase action does the same
  const me = writer(s, "wR");
  me.act({ t: T0 - 3 * H, type: "rebase" });
  assert.equal(s.clock, T0 - 3 * H);
  me.act({ t: s.clock, type: "dismiss", notice: "clock" });
  assert.equal(s.notices.some((n) => n.kind === "clock"), false);
});

test("away rate bound, boosts and afterglow frozen across an away segment (inv. 4)", () => {
  const { s, me } = setup();
  s.bought["night-shift"] = true;
  s.bought["night-owl"] = true;
  for (let i = 0; i < 30; i++) me.act({ t: T0 + 1 + i * 400, type: "click", target: "sheet" });
  s.envelopes.q = { type: "chorus", units: 1, landedAt: T0, lastAt: T0 };
  s.envelopes.r = { type: "rush", units: 1, landedAt: T0, lastAt: T0 };
  me.act({ t: T0 + 12000, type: "open", helperId: "q" });
  me.act({ t: T0 + 12000, type: "open", helperId: "r" });
  const left = () => ({ rush: s.boosts.rush, storm: s.boosts.storm, chorus: s.boosts.chorus, song: s.boosts.song, tailwind: s.boosts.tailwind });
  const boosts = left();
  const glow = s.hand.afterglowMs;
  assert.ok(glow > 0 && boosts.chorus > 0 && boosts.rush > 0);
  const bound = awayRate(s, 0.45);
  const ev = engine.advance(s, T0 + 12000 + 3 * H);
  const away = ev.find((e) => e.kind === "away");
  assert.ok(away.credited / away.seconds <= bound * (1 + 1e-12));
  close(away.credited / away.seconds, bound);
  assert.deepEqual(left(), boosts);
  assert.equal(s.hand.afterglowMs, glow);
  // and they resume on return: a hit right after still gets Rush ×3
  const before = s.bank;
  me.act({ t: s.clock, type: "click", target: "sheet" });
  assert.ok(s.bank - before > 2.9 * engine.rates(s).V);
  engine.advance(s, s.clock + 1000);
  assert.equal(s.boosts.rush, boosts.rush - 1000);
});

test("the pot is auto-credited after 10 min of live time; a second segment adds to it", () => {
  const { s } = setup();
  engine.advance(s, T0 + 2 * H);
  const pot = s.away.pot.folds;
  let t = T0 + 2 * H;
  for (let k = 0; k < 9; k++) { t += 60000; engine.advance(s, t); }
  assert.ok(s.away.pot);
  engine.advance(s, t + 30 * 60000);
  assert.ok(s.away.pot.folds > pot); // merged, timer restarted
  t += 30 * 60000;
  for (let k = 0; k < 11; k++) { t += 60000; engine.advance(s, t); }
  assert.equal(s.away.pot, null);
  assert.ok(s.notices.some((n) => n.kind === "away"));
});

test("a live absence of 30 min yields the busy card on the next player action", () => {
  const { s, me } = setup();
  let t = T0;
  me.act({ t: t + 1, type: "click", target: "sheet" });
  for (let k = 0; k < 40; k++) { t += 60000; engine.advance(s, t); }
  me.act({ t: t + 10, type: "click", target: "sheet" });
  const busy = s.notices.find((n) => n.kind === "busy");
  assert.ok(busy);
  assert.ok(busy.data.folds > 0);
  assert.ok(busy.data.seconds >= 40 * 60 - 1);
});

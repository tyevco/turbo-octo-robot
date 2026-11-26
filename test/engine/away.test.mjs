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

/**
 * The §10.2 rate per credited second: f · (Rw + crowd(N) · Σ_present (0.3·G + 0.04·Rw) · folk),
 * "present" being the pane helpers not waiting on the player: agent 4 waits
 * ("Needs you") and stops helping while away too (review r6-05), so N = 3.
 */
function awayRate(s, f = 0.25) {
  const r = engine.rates(s);
  const N = 3;
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

// ---------------------------------------------------------------------------
// Review fixes r1-20 (best helper since the last visit) and r1-33 (clock-back
// high-water mark).

test("r1-20: the away card's best helper counts tasks since the absence began, not lifetime", () => {
  const { s, me } = setup();
  const id1 = engine.helperId("t1", 1001);
  s.helpers[id1].stats.tasks = 57; // earlier play
  engine.advance(s, T0 + 20 * H);
  assert.ok(Array.isArray(s.away.pot.tasks0) && s.away.pot.tasks0.length === 4, "the pot snapshots every pane helper");
  let vm = engine.view(s, T0 + 20 * H, { role: "panel", width: 320 });
  assert.equal(vm.away.kind, "away");
  assert.equal(vm.away.best, null, "nothing finished while away: no best helper");
  assert.equal(vm.away.bestText, null);
  // On return, agent 2 turns out to have finished a task while away.
  me.act(observeAction(T0 + 20 * H + 1000, [agent(1, "working"), agent(2, "done", 1), agent(3, "idle"), agent(4, "blocked")]));
  vm = engine.view(s, T0 + 20 * H + 1000, { role: "panel", width: 320 });
  assert.equal(vm.away.best.helperId, engine.helperId("t2", 1002));
  assert.equal(vm.away.best.tasks, 1);
  assert.match(vm.away.bestText, /, 1 task$/);
  assert.ok(!vm.away.bestText.includes("57"));
});

test("r1-20: an older pot without a snapshot shows no best-helper line", () => {
  const { s } = setup();
  engine.advance(s, T0 + 20 * H);
  delete s.away.pot.tasks0;
  s.helpers[engine.helperId("t1", 1001)].stats.tasks = 57;
  const vm = engine.view(s, T0 + 20 * H, { role: "panel", width: 320 });
  assert.equal(vm.away.best, null);
});

test("r1-33: a clock that moves back and then returns credits nothing for time already counted", () => {
  const { s } = setup();
  engine.advance(s, T0 + 30000);
  const L = s.lifetime;
  engine.advance(s, T0 + 30000 - 10 * 60000); // 10 min back: rebase + notice
  assert.equal(s.notices.filter((n) => n.kind === "clock").length, 1);
  const ev = engine.advance(s, T0 + 31000); // the clock is put right again, 1 s later
  assert.equal(ev.some((e) => e.kind === "away"), false, "no away segment");
  assert.equal(s.away.pot, null, "no away pot");
  const r = engine.rates(s);
  assert.ok(s.lifetime - L <= (r.Rw + r.Hs) * 1.001 + 1e-9, `at most the one live second (${s.lifetime - L})`);
  assert.equal(s.clock, T0 + 31000);
  assert.equal(s.notices.filter((n) => n.kind === "clock").length, 1, "the clock notice stays until dismissed");
  assert.equal(s.away.highWater, T0 + 31000);
});

test("r1-33: a clock wrong forward, then corrected, costs at most 8 h of absence, and never silently", () => {
  const { s, me } = setup();
  const D = 24 * H;
  engine.advance(s, T0 + 30000);
  engine.advance(s, T0 + 30 * D); // a bogus jump (credited: it cannot be told from a real one)
  engine.advance(s, T0 + 31000); // corrected: rebase
  s.notices.length = 0; // the player dismisses the clock notice
  let t = T0 + 31000;
  const L0 = s.lifetime;
  for (let i = 0; i < 60; i++) engine.advance(s, (t += 1000));
  assert.ok(s.lifetime > L0, "live play below the mark is credited");
  const nights = [];
  for (let k = 0; k < 3; k++) {
    if (s.away.pot) me.act({ t, type: "collect" });
    s.notices.length = 0;
    // 6 min of live play between nights, so each night gets its own 8 h cap (§10.1).
    for (let i = 0; i < 360; i++) engine.advance(s, (t += 1000));
    const ev = engine.advance(s, (t += 8 * H));
    nights.push({ away: ev.find((e) => e.kind === "away"), clock: s.notices.some((n) => n.kind === "clock") });
  }
  assert.equal(nights[0].away, undefined, "the first absence pays back the stretch already counted");
  assert.equal(nights[0].clock, true, "…and says so: the clock notice is raised again");
  for (const k of [1, 2]) {
    assert.equal(nights[k].away && nights[k].away.seconds, 8 * 3600, `night ${k} is an ordinary away segment`);
    assert.equal(nights[k].clock, false, `night ${k}: no clock notice`);
  }
  // The mark stays ahead (only a jump onto it would be skipped), but nothing
  // is left to skip from real-looking absences.
  assert.equal(s.away.skipLeft, 0);
});

test("r1-33: during a clock-back, a hidden window's 5 s ticks (even late) are credited", () => {
  const s = seeded(2);
  s.owned["paper-stack"] = 30;
  engine.advance(s, T0 + 30000);
  engine.advance(s, T0 + 30000 - 600000);
  const r = engine.rates(s);
  let t = T0 + 30000 - 600000;
  const L = s.lifetime;
  for (let i = 0; i < 60; i++) engine.advance(s, (t += 5010));
  close(s.lifetime - L, r.Rw * 60 * 5.01);
  assert.equal(s.away.highWater, T0 + 30000 + 60 * 5010, "the mark moved on with the credited ticks");
});

test("r1-33: a partial clock restore cannot be farmed either", () => {
  const { s } = setup();
  let t = T0 + 30000;
  engine.advance(s, t);
  for (let k = 0; k < 3; k++) {
    engine.advance(s, t - 8 * H);
    const ev = engine.advance(s, t - 5 * 60000); // put right only to 5 min short of the mark
    assert.equal(ev.some((e) => e.kind === "away"), false, `round ${k}`);
    assert.equal(s.away.pot, null, `round ${k}`);
    t -= 5 * 60000;
  }
});

test("r1-33: an absence during a 2-day clock-back is skipped, then credited once when the clock is put right", () => {
  const { s } = setup();
  const D = 24 * H;
  let real = T0 + 30000;
  engine.advance(s, real);
  engine.advance(s, real - 2 * D); // the clock goes 2 days back
  assert.equal(s.away.skipLeft, 8 * H, "what an absence may skip is capped at the away cap");
  const ev1 = engine.advance(s, real - 2 * D + 6 * H); // a real 6 h absence on the wrong clock
  real += 6 * H;
  assert.equal(ev1.some((e) => e.kind === "away"), false, "below the mark: skipped");
  assert.equal(s.away.skipLeft, 2 * H);
  const ev2 = engine.advance(s, real); // the clock is put right
  const away = ev2.find((e) => e.kind === "away");
  assert.equal(away && away.seconds, 6 * 3600, "the real 6 h, credited once");
  assert.equal(s.away.skipLeft, 0);
  assert.equal(s.away.highWater, real);
});

test("r1-33: older saves get skipLeft 0", () => {
  const { s } = setup();
  engine.advance(s, T0 + 30000);
  delete s.away.skipLeft;
  const back = engine.parseSave(engine.serialize(s));
  assert.ok(back.ok);
  assert.equal(back.state.away.skipLeft, 0);
});

test("r1-33: the clock put right after the notice was dismissed raises it again", () => {
  const { s, me } = setup();
  engine.advance(s, T0 + 30000);
  engine.advance(s, T0 + 30000 - 10 * 60000);
  me.act({ t: T0 + 30000 - 10 * 60000, type: "dismiss", notice: "clock" });
  assert.equal(s.notices.some((n) => n.kind === "clock"), false);
  const ev = engine.advance(s, T0 + 31000);
  assert.equal(ev.some((e) => e.kind === "away"), false);
  assert.equal(s.notices.filter((n) => n.kind === "clock").length, 1);
});

test("r1-33: an 8 h clock-back round trip cannot be farmed for a fresh away cap", () => {
  const { s } = setup();
  let t = T0 + 30000;
  engine.advance(s, t);
  for (let k = 0; k < 3; k++) {
    engine.advance(s, t - 8 * H);
    t += 1000;
    const ev = engine.advance(s, t);
    assert.equal(ev.some((e) => e.kind === "away"), false, `round ${k}`);
    assert.equal(s.away.pot, null, `round ${k}`);
  }
});

test("r1-33: live play during a clock-back raises the mark; a real absence after it is still credited", () => {
  const { s } = setup();
  engine.advance(s, T0 + 30000);
  const back = T0 + 30000 - 10 * 60000;
  engine.advance(s, back);
  // 3 min of live play on the set-back clock: credited, and the mark moves on with it.
  let t = back;
  for (let k = 0; k < 180; k++) engine.advance(s, (t += 1000));
  assert.equal(s.away.highWater, T0 + 30000 + 180000);
  // The clock is corrected: real time is now 3 min after the clock-back.
  const ev = engine.advance(s, T0 + 30000 + 180000);
  assert.equal(ev.some((e) => e.kind === "away"), false);
  // Then a real 2 h absence is an ordinary away segment.
  const ev2 = engine.advance(s, T0 + 30000 + 180000 + 2 * H);
  assert.equal(ev2.find((e) => e.kind === "away").seconds, 7200);
});

test("r1-33: older saves get the high-water mark at their clock; a rebase keeps it", () => {
  const { s } = setup();
  engine.advance(s, T0 + 30000);
  delete s.away.highWater;
  const back = engine.parseSave(engine.serialize(s));
  assert.ok(back.ok);
  assert.equal(back.state.away.highWater, back.state.clock);
  engine.advance(back.state, T0 - H);
  assert.equal(back.state.away.highWater, T0 + 30000);
});

test("r4-06: helpers another window stopped seeing earn the away rate for 8 h in all, live stale credit and away segment together", () => {
  // wA sees 4 working agents and closes at T0; wB stays open (seeing none of
  // them) for `open` hours, then every window is closed; one reopens at T0 + 16 h.
  const run = (openH, reopenBy) => {
    const s = seeded(7);
    const A = writer(s, "wA");
    const B = writer(s, "wB");
    A.act(observeAction(T0, [1, 2, 3, 4].map((i) => agent(i, "working", 0))));
    B.act(observeAction(T0 + 1000, []));
    let t = T0 + 1000;
    engine.advance(s, (t = T0 + 61000), "wB"); // the first 60 s are live (full rate)
    const from = s.stats.bySource.helpers || 0;
    const end = T0 + openH * H;
    while (t < end) { t = Math.min(end, t + 30000); engine.advance(s, t, "wB"); }
    const live = (s.stats.bySource.helpers || 0) - from;
    engine.advance(s, T0 + 16 * H, reopenBy);
    const away = s.away.pot.split.helpers;
    const r = engine.rates(s);
    const perMs = (0.25 * engine.crowd(4) * 4 * 0.3 * r.G) / 1000; // 4 helpers at the away rate (no workshops)
    return { live: live / perMs, away: away / perMs, folds: s.helpers[engine.helperId("t1", 1001)].stats.folds };
  };
  for (const openH of [4, 8, 12]) {
    for (const by of ["wA", "wB"]) {
      const { live, away } = run(openH, by);
      // from 60 s after lastSeen to 8 h after it (plus the 60 s the window
      // gave live): never more than one 8-h allowance per absence
      assert.ok(live + away <= 8 * H + 1000, `B open ${openH} h, ${by} reopens: ${(live + away) / H} h`);
      assert.ok(live + away >= 8 * H - 62000, `B open ${openH} h, ${by} reopens: ${(live + away) / H} h`);
      close(live, Math.min(openH * H, 8 * H) - 61000, 1e-6);
    }
  }
  // B open only a moment: the away segment still pays (almost) the full 8 h
  const short = run(0.02, "wA");
  assert.ok(short.away > 7.9 * H && short.away <= 8 * H);
});

test("r6-05: a helper waiting for input adds nothing to an away segment, its folds or the crowd; it still shows under Needs you", () => {
  const { s } = setup();
  const id4 = engine.helperId("t4", 1004);
  const f4 = s.helpers[id4].stats.folds;
  engine.advance(s, T0 + 20 * H);
  assert.equal(s.helpers[id4].stats.folds, f4, "the waiting agent earned nothing while away");
  assert.deepEqual(s.away.pot.needs, [id4]);
  // had agent 4 been working it would have earned its share
  const b = setup().s;
  b.helpers[id4].status = "working";
  engine.advance(b, T0 + 20 * H);
  assert.ok(b.away.pot.split.helpers > s.away.pot.split.helpers, "a working agent earns the away rate");
  // the same absence with agent 4 not there at all pays exactly the same
  const c = seeded(1);
  c.owned["paper-stack"] = 30; c.owned["bone-folder"] = 12; c.owned["scissor-stand"] = 3; c.bought["rice-treats"] = true;
  writer(c).act(observeAction(T0, [agent(1, "working"), agent(2, "working"), agent(3, "idle")]));
  engine.advance(c, T0 + 20 * H);
  close(s.away.pot.split.helpers, c.away.pot.split.helpers, 1e-12);
  close(s.away.pot.folds, c.away.pot.folds, 1e-12);
});

test("r6-05: a helper nobody can see that waits for input adds nothing to the stale credit (Hstale) or its crowd", () => {
  // wA saw three agents (one waiting) and stopped 2 min ago; wB is open and sees none of them.
  const mk = (st3) => {
    const s = seeded(9);
    const A = writer(s, "wA");
    const B = writer(s, "wB");
    A.act(observeAction(T0, [agent(1, "working", 0), agent(2, "idle", 0), agent(3, st3, 0)]));
    B.act(observeAction(T0 + 1000, []));
    engine.advance(s, T0 + 120000, "wB");
    return s;
  };
  const s = mk("blocked");
  const r = engine.rates(s, "wB");
  const base = 0.3 * r.G; // no workshops, folk 1
  close(r.Hstale, 0.25 * engine.crowd(2) * base * 2, 1e-12);
  const all = engine.rates(mk("working"), "wB");
  close(all.Hstale, 0.25 * engine.crowd(3) * base * 3, 1e-12);
  // and over live time the waiting agent's record gains nothing
  const id3 = engine.helperId("t3", 1003);
  const g = s.helpers[id3].stats.folds;
  engine.advance(s, T0 + 150000, "wB");
  engine.advance(s, T0 + 180000, "wB");
  assert.equal(s.helpers[id3].stats.folds, g);
  assert.ok(s.helpers[engine.helperId("t2", 1002)].stats.folds > 0, "an idle agent nobody sees still earns the away rate");
});

test("r4-06: with one window, a helper seen at the close earns the whole cap; one last seen 6 h before it earns 2 h", () => {
  const s = seeded(8);
  const A = writer(s, "wA");
  A.act(observeAction(T0, [agent(1, "working", 0), agent(2, "working", 0)]));
  // wB saw agent 2 last, 6 h ago, and nobody has seen it since
  const id2 = engine.helperId("t2", 1002);
  s.helpers[id2].seenBy = "wB";
  s.helpers[id2].lastSeen = T0 - 6 * H;
  s.writersSeen.wB = T0 - 6 * H;
  const f0 = s.helpers[engine.helperId("t1", 1001)].stats.folds;
  const g0 = s.helpers[id2].stats.folds;
  engine.advance(s, T0 + 20 * H, "wA");
  const r = engine.rates(s);
  const base = 0.3 * r.G; // no workshops, folk 1
  const spent = 6 * H - 60000; // unseen since 60 s after its lastSeen
  const d2 = 8 * H - spent;
  // two earn until d2, then one alone (crowd(1)) until the cap
  const one = (0.25 * engine.crowd(2) * base * d2 + 0.25 * engine.crowd(1) * base * (8 * H - d2)) / 1000;
  close(s.helpers[engine.helperId("t1", 1001)].stats.folds - f0, one, 1e-9);
  close(s.helpers[id2].stats.folds - g0, (0.25 * engine.crowd(2) * base * d2) / 1000, 1e-9);
  close(s.away.pot.split.helpers, one + (0.25 * engine.crowd(2) * base * d2) / 1000, 1e-9);
});

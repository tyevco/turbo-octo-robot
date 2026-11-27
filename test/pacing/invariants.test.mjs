// BALANCE §7 invariants at simulator scale: on states the P1/P7 profiles
// actually reach (agents, fledglings, upgrades, boosts), not only on the
// synthetic states of test/engine/. Invariants 1, 2, 9, 12, 13 and 14 are also
// rows of the full run (test/pacing/pacing.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as engine from "../../mods/creaseworks/engine/index.js";
import { runProfile, agentObservation } from "../../tools/sim/pacing.mjs";
import { parseBalance } from "../../tools/sim/profiles.mjs";
import { unpackAlbum, rosterChanged, saveBytes } from "../../mods/creaseworks/engine/helpers.js";

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
  // A helper waiting on the player earns nothing away (review r6-05, DESIGN §10.2).
  const panes = Object.values(s.helpers).filter((h) => !h.gone && h.kind === "pane" && h.status !== "blocked");
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
  // Thrifty Fox buys on the first action that finds the bank ≥ 4× a cost, so
  // 8× more apply calls can buy up to 80 ms sooner; switch automations off so
  // only the click cap is compared.
  for (const s of [a, b]) for (const id of Object.keys(s.auto)) s.auto[id] = false;
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

/**
 * Hs0 with 0, 1, … `upTo` fresh agents on top of the `base` observation, each
 * bench observed at the same instant (so no warm or thanks timer ends between
 * two of them: only the added agents differ).
 */
function hsCurve(s, base, upTo) {
  const t = s.clock + 1000;
  const out = [];
  for (let n = 0; n <= upTo; n++) {
    const c = engine.cloneState(s);
    act(c, observeAt(t, [...base, ...extraAgents(n)], c.day));
    out.push(engine.rates(c).Hs0);
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

// With unequal helpers (warm, fledglings, thanks) a crowd(n) applied to the whole
// sum let a newcomer lower Hs0 (P1 seed 1's day-2 close: n = 5 fell from 21,463 to
// 20,714). The marginal pace (DESIGN §5.3) must hold on the benches the sim reaches.
for (const [id, label] of [["P1", "P1's day-2 bench"], ["P7", "P7's day-2 bench"]]) {
  const st = id === "P1" ? day2.finalState : runProfile(id, 1, { days: 2, wish: false }).finalState;
  const base = agentObservation(id, P2_SEC);

  test(`inv. 6 at simulator scale: adding a fresh working agent to ${label} never lowers Hs0`, () => {
    const hs = hsCurve(engine.cloneState(st), base, 70);
    for (let n = 1; n < hs.length; n++) assert.ok(hs[n] >= hs[n - 1], `n=${n}: Hs0 ${hs[n]} < ${hs[n - 1]}`);
  });

  test(`inv. 6 at simulator scale: a working agent of ${label} that stops working never raises Hs0`, () => {
    const s0 = engine.cloneState(st);
    act(s0, observeAt(s0.clock + 1000, base, s0.day));
    const before = engine.rates(s0).Hs0;
    let checked = 0;
    for (let i = 0; i < base.length; i++) {
      if (base[i].kind !== "pane" || base[i].status !== "working") continue;
      for (const status of ["blocked", "idle"]) {
        const s = engine.cloneState(s0);
        act(s, observeAt(s.clock + 1000, base.map((o, k) => (k === i ? { ...o, status, raw: status } : o)), s.day));
        const after = engine.rates(s).Hs0;
        assert.ok(after <= before, `agent ${base[i].addr} ${status}: Hs0 ${after} > ${before}`);
        checked++;
      }
    }
    assert.ok(checked > 0, "no working agent on the bench");
  });
}

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

test("inv. 7 (R13): a year of agents coming and going keeps every pane agent saved and the save under its bound", () => {
  const s = engine.newGame({ seed: 7, now: day2.finalState.clock, day: day2.finalState.day });
  // Mail Sorter opens the Bundles; every timed boost is left on the tray until
  // the year ends (review r2-02: they piled up for ever, ≈ 3,000 of them, and
  // opening them then un-compacted their Album records past 1 MiB).
  s.bought["mail-sorter"] = true;
  const T = s.clock;
  const ag = (i, extra = {}) => ({
    addr: `w1:t${i}`, created: T + i * 997, status: "working", raw: "working", turn: 0, parent: null,
    pane: `p${i}`, title: "claude · refactor the payment module", paneName: "", space: "main", tab: "1", kind: "pane", ...extra,
  });
  let t = T;
  let n = 0;
  for (let d = 0; d < 365; d++) {
    const list = [];
    for (let k = 0; k < I.churnPerDay; k++) {
      const i = n++;
      list.push(ag(i));
      for (let j = 0; j < I.churnKids; j++) list.push(ag(1e6 + i * I.churnKids + j, { kind: "kid", pane: null, parent: `w1:t${i}` }));
    }
    act(s, observeAt((t += 1000), list, s.day));
    act(s, observeAt((t += HOUR), list.map((o) => ({ ...o, turn: 2, status: "idle", raw: "idle" })), s.day));
    act(s, observeAt((t += 1000), [], s.day));
    t = T + (d + 1) * 24 * HOUR;
    engine.advance(s, t);
  }
  assert.equal(Object.values(s.helpers).filter((h) => h.kind === "pane" && h.gone).length, n);
  const K = engine.CONTENT.K;
  // no envelope waits under a compacted helper: the tray is bounded by the full Album
  const waitingIds = Object.keys(s.envelopes);
  assert.ok(waitingIds.length <= K.albumKeep, `${waitingIds.length} envelopes waiting`);
  for (const id of waitingIds) assert.notEqual(s.helpers[id].compact, true, id);
  assert.ok(engine.serialize(s).length < I.churnKiB * 1024);
  // opening the rest keeps every compacted helper packed (nothing un-compacts)
  for (const id of waitingIds) act(s, { t: (t += 100), type: "open", helperId: id });
  act(s, observeAt((t += 1000), [], s.day));
  const text = engine.serialize(s);
  assert.ok(text.length < I.churnKiB * 1024, `${(text.length / 1024).toFixed(0)} KiB`);
  assert.equal(Object.values(JSON.parse(text).state.helpers).filter(Array.isArray).length, n - K.albumKeep);
  const v = s.stats.units;
  const waiting = Object.values(s.envelopes).reduce((a, e) => a + e.units, 0);
  assert.ok(Math.abs(v.created - (v.opened + v.converted + waiting)) < 1e-9, "inv. 9 holds with envelopes cashed in");
  const back = engine.parseSave(text);
  assert.equal(back.ok, true);
  assert.equal(engine.serialize(back.state), text);
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
    // purchases are the single writer's, in order (a purchase waits until the save affords it),
    // and so is the hand: the same beat and the same pauses (review r8-03)
    assert.ok(one.pauses.length > 0);
    const two = runProfile("P1", seed, {
      days: 3, wish: false, buys: one.purchases, pauses: one.pauses,
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

test("inv. 7 (R13, r3-04): 100 new agents a day for 300 days: every helper still counted, the save bounded far under 1 MiB", (ctx) => {
  const s = engine.newGame({ seed: 11, now: day2.finalState.clock, day: day2.finalState.day });
  s.bought["mail-sorter"] = true;
  const T = s.clock;
  const ag = (i, extra = {}) => ({
    addr: `w1:t${i}`, created: T + i * 997, status: "working", raw: "working", turn: 0, parent: null,
    pane: `p${i}`, title: "claude · refactor the payment module", paneName: "", space: "main", tab: "1", kind: "pane", ...extra,
  });
  let t = T;
  let n = 0;
  const per = I.heavyPerDay / 5;
  const sizes = [];
  let maxBytes = 0;
  for (let d = 0; d < I.heavyDays; d++) {
    // five waves a day of per new agents: each works, finishes, and its terminal closes
    for (let w = 0; w < 5; w++) {
      const list = [];
      for (let k = 0; k < per; k++) list.push(ag(n++));
      act(s, observeAt((t += 1000), list, s.day));
      act(s, observeAt((t += 15 * 60000), list.map((o) => ({ ...o, turn: 1, status: "idle", raw: "idle" })), s.day));
      act(s, observeAt((t += 1000), [], s.day));
    }
    t = T + (d + 1) * 24 * HOUR;
    engine.advance(s, t);
    // every day, not every 50 (review r5-07): the bound is on the largest save
    const bytes = Buffer.byteLength(engine.serialize(s), "utf8");
    sizes.push(bytes);
    if (bytes > maxBytes) maxBytes = bytes;
  }
  assert.ok(maxBytes < I.heavyKiB * 1024, `largest save ${(maxBytes / 1024).toFixed(0)} KiB`);
  ctx.diagnostic(`largest save on any day: ${(maxBytes / 1024).toFixed(1)} KiB (day ${sizes.indexOf(maxBytes) + 1})`);
  assert.equal(n, I.heavyPerDay * I.heavyDays);
  // every pane agent is a saved helper: one record each, or counted in an archive entry
  const recs = Object.values(s.helpers).filter((h) => h.kind === "pane" && h.gone);
  const archives = recs.filter((h) => h.archive > 0);
  assert.ok(archives.length > 0);
  assert.equal(recs.reduce((a, h) => a + (h.archive > 0 ? h.archive : 1), 0), n);
  assert.equal(engine.view(s, t, { role: "panel", width: 320, album: false }).helpers.albumCount, n);
  assert.ok(recs.filter((h) => h.compact).length <= K.albumCompactKeep + K.albumArchiveBatch);
  for (const a of archives) assert.match(a.id, /^past-\d+$/);
  // the open Album lists each archive entry as one row named by its helper count, oldest last
  const rows = engine.view(s, t, { role: "panel", width: 320 }).helpers.album;
  assert.equal(rows.length, recs.length);
  const arch = rows.filter((r) => /^past-/.test(r.helperId));
  assert.equal(arch.length, archives.length);
  for (const r of arch) assert.equal(r.name, `${engine.formatInt(s.helpers[r.helperId].archive)} helpers`.slice(0, 16));
  // and says when its helpers left as a range, newest to oldest ("34–63 d"), not the newest alone
  const fmt = (ms) => engine.formatDuration(ms, { spaced: true, parts: 1 });
  for (const r of arch) {
    const a = s.helpers[r.helperId];
    const newest = fmt(t - a.missingSince);
    const oldest = fmt(t - a.from);
    assert.ok(a.from < a.missingSince, r.helperId);
    if (newest === oldest) assert.equal(r.leftAgo, newest);
    else assert.equal(r.leftAgo, `${newest.split(" ")[0]}–${oldest}`, r.helperId);
  }
  assert.ok(/^past-/.test(rows.at(-1).helperId), "archives hold the helpers who left longest ago");
  const text = engine.serialize(s);
  assert.ok(text.length < I.heavyKiB * 1024, `${(text.length / 1024).toFixed(0)} KiB`);
  // it stops growing: the last 150 days add at most a few archive entries
  assert.ok(sizes.at(-1) - sizes[149] < 16 * 1024, sizes.filter((x, i) => (i + 1) % 50 === 0).map((x) => (x / 1024).toFixed(0)).join(" → "));
  assert.ok(saveBytes(s) >= Buffer.byteLength(text, "utf8"), "the save estimate (r5-07) is an upper bound here");
  const back = engine.parseSave(text);
  assert.equal(back.ok, true);
  assert.equal(engine.serialize(back.state), text);
  const v = s.stats.units;
  const waiting = Object.values(s.envelopes).reduce((a, e) => a + e.units, 0);
  assert.ok(Math.abs(v.created - (v.opened + v.converted + waiting)) < 1e-9, "inv. 9 holds");
});

test("inv. 7 (R13, r5-07): 130 agents with 4 sub-agents each over a full Album: the whole save stays under its budget, far under 1 MiB", (ctx) => {
  // Before: only the Album was bounded, so a large roster (≈ 600 B a present
  // helper) over a full Album passed herdr's 1 MiB write limit (1.1 MB here)
  // and every save cycle failed.
  const MiB = 1024 * 1024;
  const s = engine.newGame({ seed: 13, now: day2.finalState.clock, day: day2.finalState.day });
  const T = s.clock;
  const sig4 = (x) => Number(x.toPrecision(4));
  // a peak Album: K.albumCompactKeep + K.albumArchiveBatch packed records with fledgling
  // totals and terminal keys (one short of an archive pass by count), left over the last year
  const nCompact = K.albumCompactKeep + K.albumArchiveBatch;
  for (let i = 0; i < nCompact; i++) {
    const id = engine.helperId(`w2:t${i}`, 1700000000000 + i * 997);
    const m = Math.floor((T - 2 * 86400000 - (nCompact - i) * 2860000) / 60000);
    const rec = unpackAlbum(id, [0, sig4(1.2345e7 + i * 98765.4321), 30 + (i % 70), m, 3 + (i % 3), sig4(3.21e6 + i * 4321.123), (i * 7919) & 0xffff]);
    assert.ok(rec, id);
    s.helpers[id] = rec;
  }
  rosterChanged(s);
  // and a full Album of whole records: agents with a fledgling each that finished a task and left
  const ag = (i, extra = {}) => ({
    addr: `w1:t${i}`, created: T + i * 997, status: "working", raw: "working", turn: 0, parent: null,
    pane: `p${i}`, title: "claude · refactor the payment reconciliation service and fix flaky tests", paneName: "",
    space: "payments", tab: "integration", kind: "pane", ...extra,
  });
  let t = T;
  for (let b = 0; b < K.albumKeep / 50; b++) {
    const list = [];
    for (let k = 0; k < 50; k++) {
      const i = b * 50 + k;
      list.push(ag(i), ag(1e6 + i, { kind: "kid", pane: null, parent: `w1:t${i}` }));
    }
    act(s, observeAt((t += 1000), list, s.day));
    act(s, observeAt((t += 15 * 60000), list.map((o) => ({ ...o, turn: 1, status: "idle", raw: "idle" })), s.day));
    act(s, observeAt((t += 1000), [], s.day));
  }
  const counted = () => Object.values(s.helpers).reduce((a, h) => a + (h.archive > 0 ? h.archive : 1) + (h.stats.kidsPast || 0), 0);
  const before = counted();
  const peak = Buffer.byteLength(engine.serialize(s), "utf8");
  assert.ok(peak > 640 * 1024, `a peak Album save: ${(peak / 1024).toFixed(0)} KiB`);
  // 130 agents open at once, each running 4 sub-agents, with long CJK titles and places
  const title = "codex · 支払い照合サービスをリファクタリングして不安定な統合テストを修正する作業を続けています";
  const roster = [];
  for (let i = 0; i < 130; i++) {
    const p = ag(5e6 + i, { title, space: "支払いチーム", tab: "統合テスト" });
    roster.push(p);
    for (let k = 0; k < 4; k++) roster.push(ag(6e6 + i * 10 + k, { kind: "kid", pane: null, parent: p.addr, title, space: "支払いチーム", tab: "統合テスト" }));
  }
  const sizes = [];
  for (let k = 0; k < 4; k++) {
    act(s, observeAt((t += 2000), roster.map((o) => ({ ...o, turn: k, status: k % 2 ? "idle" : "working", raw: k % 2 ? "idle" : "working" })), s.day));
    const text = engine.serialize(s);
    const bytes = Buffer.byteLength(text, "utf8");
    sizes.push(bytes);
    assert.ok(bytes < MiB, `${bytes} bytes with 650 agents present`);
    assert.ok(bytes <= saveBytes(s), "the estimate is an upper bound");
    assert.ok(saveBytes(s) <= K.saveBudget, `estimate ${saveBytes(s)} over the budget`);
  }
  ctx.diagnostic(`peak Album ${(peak / 1024).toFixed(0)} KiB; with 650 present: ${sizes.map((x) => (x / 1024).toFixed(0)).join(", ")} KiB`);
  // nobody was dropped: the archives hold the older Album helpers, still counted
  assert.equal(counted(), before + roster.length);
  // and the Album header counts every helper who has left: every record's helpers
  // and folded fledglings, less the present ones (r7-09: fledglings folded into a
  // present parent are counted too)
  const albumCount = () => engine.view(s, t, { role: "panel", width: 320, album: false }).helpers.albumCount;
  assert.equal(albumCount(), counted() - Object.values(s.helpers).filter((h) => !h.gone).length);
  assert.equal(Object.values(s.helpers).filter((h) => !h.gone).length, roster.length);
  assert.ok(Object.values(s.helpers).some((h) => h.archive > 0));
  // the roster leaves (whole Album records, then compacted): still bounded and counted
  act(s, observeAt((t += 2000), [], s.day));
  engine.advance(s, (t += 60000));
  const text = engine.serialize(s);
  assert.ok(Buffer.byteLength(text, "utf8") < MiB);
  assert.ok(saveBytes(s) <= K.saveBudget);
  assert.equal(counted(), before + roster.length);
  assert.equal(albumCount(), counted());
  const back = engine.parseSave(text);
  assert.equal(back.ok, true);
  assert.equal(engine.serialize(back.state), text);
});

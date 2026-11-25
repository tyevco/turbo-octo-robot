// docs/BALANCE.md parses into the targets the simulator asserts, the profiles
// in code match its §3 tables, and the §8 knob values match engine/content.js
// (ARCHITECTURE A11, B8; DESIGN and BALANCE change together).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as engine from "../../mods/creaseworks/engine/index.js";
import { PROFILES, PROFILE_IDS, activeFrac, parseBalance, parseWindow, parseClock, fmtClock } from "../../tools/sim/profiles.mjs";
import { SHARE_BUCKETS } from "../../tools/sim/pacing.mjs";

const bal = parseBalance();
const C = engine.CONTENT;

test("time cells parse: h:mm, h:mm:ss, windows, M15-relative and active-second rows", () => {
  assert.equal(parseClock("0:00:30"), 30);
  assert.equal(parseClock("1:20"), 4800);
  assert.equal(parseClock("20:30"), 73800);
  assert.deepEqual(parseWindow("0:40 – 2:00"), { lo: 2400, hi: 7200 });
  assert.deepEqual(parseWindow("≤ 0:01:00"), { lo: -Infinity, hi: 60 });
  assert.deepEqual(parseWindow("**≥ 12:00** and ≤ 18:00"), { lo: 43200, hi: 64800 });
  assert.deepEqual(parseWindow("16:00 – 24:00 (always day 3)"), { lo: 57600, hi: 86400 });
  assert.deepEqual(parseWindow("M15 + 9:00 – M15 + 22:00"), { rel: "M15", lo: 32400, hi: 79200 });
  assert.equal(parseWindow("exactly 390 active s").active, 390);
  assert.equal(parseWindow("exactly 10").value, 10);
  assert.throws(() => parseWindow("about an hour"));
  assert.equal(fmtClock(73800), "20:30");
  assert.equal(fmtClock(66), "0:01:06");
});

test("§3 profiles: every profile in the tables is defined in code and vice versa", () => {
  assert.deepEqual(bal.profilesListed, [...PROFILE_IDS]);
  for (const id of PROFILE_IDS) assert.equal(PROFILES[id].id, id);
  // §3.1 activeFrac for P1, and the agent cycles are exactly one hour
  assert.equal(activeFrac(PROFILES.P1), bal.p1ActiveFrac);
  for (const id of PROFILE_IDS) {
    const c = PROFILES[id].cycle;
    assert.equal(c.blocks * (c.work + c.needs) + c.rest, 60, id);
  }
  assert.deepEqual([PROFILES.P1.agents, PROFILES.P3.agents, PROFILES.P4.agents, PROFILES.P5.agents, PROFILES.P6.agents, PROFILES.P7.agents], [4, 0, 1, 8, 30, 64]);
  assert.equal(PROFILES.P8.sessionSec, 300);
  assert.equal(PROFILES.P9.sessionsPerDay, 4);
  assert.equal(PROFILES.P11.cps, 3);
  assert.equal(PROFILES.P12.calm, true);
  assert.equal(PROFILES.P2.hands, false);
});

test("§4 milestones: every row has a known sim key and the median window lies inside the every-seed window", () => {
  const ids = new Set([...C.WORKSHOPS.map((w) => w.id), ...C.UPGRADES.map((u) => u.id), ...C.AUTOMATIONS.map((a) => a.id)]);
  for (const w of C.WORKSHOPS) for (const t of C.TIERS) ids.add(`${w.id}-t${t.n}`);
  const special = new Set(["own:workshops>=10", "spawn:crane#1", "run:1e6", "run:1e8", "run:1e9", "wish:available", "wish2:available", "wish:gain"]);
  assert.equal(bal.milestones.length, 17);
  bal.milestones.forEach((m, i) => {
    assert.equal(m.id, `M${i + 1}`);
    if (m.key.startsWith("buy:")) assert.ok(ids.has(m.key.slice(4)), `${m.id}: unknown item ${m.key}`);
    else assert.ok(special.has(m.key), `${m.id}: unknown key ${m.key}`);
    assert.ok(m.median.lo <= m.median.hi, m.id);
    assert.ok(m.every.lo <= m.median.lo && m.median.hi <= m.every.hi, `${m.id}: median window outside every-seed window`);
  });
  assert.equal(bal.milestones.find((m) => m.id === "M15").key, "wish:available");
  assert.equal(bal.milestones.find((m) => m.id === "M17").provisional, true);
});

test("§5 first wish: one row per profile, every extra assertion understood, monotonic chain listed", () => {
  assert.deepEqual(bal.firstWish.map((r) => r.id), [...PROFILE_IDS]);
  for (const r of bal.firstWish) {
    if (r.sameSeed) {
      assert.equal(r.id, "P12");
      assert.equal(r.sameSeed.of, "P1");
      assert.equal(r.sameSeed.rel, bal.invariants.calmRel);
      continue;
    }
    assert.ok(r.every.lo <= r.median.lo && r.median.hi <= r.every.hi, r.id);
  }
  // P1's §5 row is M15
  const m15 = bal.milestones.find((m) => m.id === "M15");
  assert.deepEqual(bal.firstWish[0].median, m15.median);
  assert.deepEqual(bal.monotonic, ["P3", "P4", "P1", "P5", "P6", "P7"]);
  // extras evaluate against medians
  const P2 = bal.firstWish.find((r) => r.id === "P2").extra[0];
  assert.equal(P2.check({ P1: 10, P2: 10 + 7200 }), true);
  assert.equal(P2.check({ P1: 10, P2: 10 + 7199 }), false);
});

test("r3-24: P13 short turns: 12 short tasks an hour with a new sub-agent each block, held to P1's day-3 bound and click floors", () => {
  const P13 = PROFILES.P13;
  assert.deepEqual({ ...P13.cycle }, { work: 3, needs: 1, blocks: 12, rest: 12 });
  assert.equal(P13.freshKids, true);
  // the same 36 working minutes an hour as P1, four times the finished tasks
  assert.equal(P13.cycle.work * P13.cycle.blocks, PROFILES.P1.cycle.work * PROFILES.P1.cycle.blocks);
  const row = bal.firstWish.find((r) => r.id === "P13");
  assert.ok(row.every.lo >= parseClock("16:00") && row.every.hi <= parseClock("24:00"), "first wish always on day 3");
  assert.deepEqual(row.extra.map((e) => e.text), ["median ≥ P1 median − 1:30"]);
  assert.deepEqual(bal.dayShares.find((r) => r.id === "P13").mins, bal.dayShares.find((r) => r.id === "P1").mins);
});

test("§6 shares: the four buckets cover every income source the engine credits, once", () => {
  assert.deepEqual(bal.shares.map((r) => r.keys.length > 0), [true, true, true, true]);
  const all = Object.values(SHARE_BUCKETS).flat();
  assert.equal(new Set(all).size, all.length);
  for (const src of ["sheet", "mini", "node", "scrap", "crane", "ream", "boat", "helpers", "env", "workshops", "away", "overflow"]) {
    assert.ok(all.includes(src), src);
  }
  for (const k of engine.CLICK_SOURCES) assert.ok(SHARE_BUCKETS.click.includes(k), k);
  // each §6.1 row's keys are in the bucket the evaluator uses for it
  for (const row of bal.shares) {
    const b = Object.keys(SHARE_BUCKETS).find((x) => row.keys.every((k) => SHARE_BUCKETS[x].includes(k)));
    assert.ok(b, row.label);
  }
  assert.ok(bal.dayShares.length >= 9);
  // every profile that clicks has a §6.2 row (P2 never clicks; P12 equals P1): P9 has its own floor
  const rowed = new Set(bal.dayShares.map((r) => r.id));
  for (const id of ["P1", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "P13"]) assert.ok(rowed.has(id), `§6.2 has no row for ${id}`);
  assert.deepEqual(bal.dayShares.find((r) => r.id === "P9").mins, [0.008, 0.008, 0.03]);
  assert.ok(bal.sessions.p1Min > bal.sessions.handsMin);
});

test("§7 invariant numbers parse", () => {
  const I = bal.invariants;
  assert.deepEqual(
    [I.cadenceP1Min, I.cadenceHandsMin, I.cadenceP2Hours, I.awayF, I.saveKiB, I.albumExtra, I.churnPerDay, I.churnKids, I.churnKiB, I.twoWindowRel, I.calmRel, I.firstWishGain, I.deadWallHours],
    [10, 15, 3, 0.45, 256, 500, 20, 3, 512, 0.01, 0.03, 10, 24],
  );
  assert.deepEqual([I.heavyPerDay, I.heavyDays, I.heavyKiB], [100, 300, 640]);
});

test("§8 knobs: the current values in BALANCE.md are the constants in engine/content.js", () => {
  const K = C.K;
  const echo = ["echo-1", "echo-2", "echo-3", "echo-4", "echo-5"].map((id) => C.UPGRADES.find((u) => u.id === id).v);
  const away = ["night-shift", "night-owl"].map((id) => C.UPGRADES.find((u) => u.id === id).v);
  const want = {
    1: [C.PRESTIGE.Lw],
    2: [K.crowdExp, K.knee],
    3: [K.echoBase, ...echo],
    4: [K.nodePay, K.chainFinishPerNode],
    5: [K.awayF, ...away],
    6: [C.GROWTH],
    7: [C.PRESTIGE.minGain, C.PRESTIGE.gateShare],
  };
  assert.deepEqual(bal.knobs.map((k) => k.order), [1, 2, 3, 4, 5, 6, 7]);
  for (const k of bal.knobs) assert.deepEqual(k.values, want[k.order], `knob ${k.order} (${k.knob}): "${k.text}"`);
  // inv. 4's bound uses the top away factor
  assert.equal(bal.invariants.awayF, Math.max(...want[5]));
});

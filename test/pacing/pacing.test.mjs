// The pacing targets (ARCHITECTURE A11, B8; docs/BALANCE.md §2-§7): every
// profile P1-P13 with seeds 1-20 through the real engine, then one test per
// BALANCE row. A row passes when the median lies in its pass window and every
// seed in its every-seed window (BALANCE §2); provisional rows (M17) report as
// TODO when they miss. PACING_SEEDS=1-5 runs fewer seeds (a quicker look; the
// windows are written for 20).
import { test } from "node:test";
import assert from "node:assert/strict";
import { availableParallelism } from "node:os";
import { runAll, evaluate, report, parseSeeds, median } from "../../tools/sim/pacing.mjs";
import { PROFILE_IDS, parseBalance, fmtClock } from "../../tools/sim/profiles.mjs";

const seeds = parseSeeds(process.env.PACING_SEEDS || "1-20");
const bal = parseBalance();
const t0 = Date.now();
const runs = await runAll(PROFILE_IDS, seeds, { workers: Math.max(1, Math.min(8, availableParallelism())) });
const secs = (Date.now() - t0) / 1000;
const ev = evaluate(runs, bal);

test(`all ${PROFILE_IDS.length} profiles × ${seeds.length} seeds ran to their first wish (${secs.toFixed(1)} s)`, (t) => {
  for (const id of PROFILE_IDS) {
    assert.equal(runs[id].length, seeds.length, id);
    for (const r of runs[id]) assert.ok(Number.isFinite(r.m15), `${id} seed ${r.seed} never reached the first wish`);
  }
  assert.ok(Number.isFinite(median(runs.P1.map((r) => r.milestones["wish2:available"]))), "P1 never reached the second wish");
  t.diagnostic(`\n${report(runs, ev)}`);
});

test("every BALANCE row is evaluated", () => {
  const ids = new Set(ev.rows.map((r) => `${r.section} ${r.id}`));
  for (const m of bal.milestones) assert.ok(ids.has(`§4 ${m.id}`), m.id);
  for (const r of bal.firstWish) assert.ok(ids.has(`§5 ${r.id}`), r.id);
  assert.ok(ids.has("§5 mono"));
  for (const b of ["click", "helpers", "workshops", "away"]) assert.ok(ids.has(`§6.1 ${b}`), b);
  for (const r of bal.dayShares) assert.ok(ids.has(`§6.2 ${r.id}`), r.id);
  for (const id of PROFILE_IDS) {
    if (id !== "P2") assert.ok(ids.has(`§6.3 ${id}`), `§6.3 ${id}`);
    assert.ok(ids.has(`§7 inv2 ${id}`), `inv2 ${id}`);
  }
  for (const k of ["inv1", "inv9", "inv13", "inv14"]) assert.ok(ids.has(`§7 ${k}`), k);
});

// Review r5-21: a "folds this run" milestone the night pot alone carries over its target says
// nothing about the live curve. M13 counts live income (BALANCE §4), so no P1 seed reaches it
// at the moment an away segment is credited; the run total still is (recorded, never asserted).
test("§4 M13 is reached on live income, never by a night pot", () => {
  for (const r of runs.P1) {
    assert.ok(Number.isFinite(r.milestones["live:1e9"]), `seed ${r.seed}`);
    assert.notEqual(r.byAway["live:1e9"], true, `seed ${r.seed}`);
    assert.ok(r.milestones["live:1e9"] >= r.milestones["run:1e9"], `seed ${r.seed}: live before the run total`);
  }
  const m13 = ev.rows.find((x) => x.section === "§4" && x.id === "M13");
  assert.equal(m13.key, "live:1e9");
  assert.equal(m13.byAway, 0);
});

// Review r6-12: the first wish (M15) is checked after the step's away flag was cleared, so a
// first wish that only the night pot collected at a day open made available was never noted.
// A first wish exactly on a day open (play-clock a multiple of the 8 h open day) is that case:
// the sim must flag it on that seed and nowhere else, and carry the count into §4 M15 and §5.
test("a first wish reached by a night pot is noted on §4 M15 and the §5 rows", () => {
  const DAY = 8 * 3600;
  for (const id of PROFILE_IDS) {
    const rs = runs[id];
    let snaps = 0;
    for (const r of rs) {
      const atOpen = r.m15 > 0 && r.m15 % DAY === 0;
      if (atOpen) snaps++;
      assert.equal(r.byAway["wish:available"] === true, atOpen, `${id} seed ${r.seed}: M15 ${fmtClock(r.m15)}`);
    }
    const row = ev.rows.find((x) => x.section === "§5" && x.id === id);
    if (!row) continue;
    assert.equal(row.byAway, snaps, `§5 ${id}`);
    if (snaps) assert.match(row.note, new RegExp(`reached by a night pot on ${snaps} of ${rs.length} seeds`), `§5 ${id}`);
  }
  const m15 = ev.rows.find((x) => x.section === "§4" && x.id === "M15");
  assert.equal(m15.byAway, runs.P1.filter((r) => r.byAway["wish:available"]).length);
  // the profiles that sit at a day open in BALANCE §5 (P4 32:00 on every seed) really are snaps
  if (seeds.length >= 5) assert.ok(runs.P4.some((r) => r.byAway["wish:available"]), "P4 never flagged");
});

const show = (r) => {
  if (r.unit === "text") return r.note;
  const f = r.unit === "pct" ? (x) => `${(x * 100).toFixed(1)} %` : r.unit === "clock" || r.unit === "M15+" ? fmtClock : String;
  const per = r.vals ? `; per seed ${r.vals.map(f).join(" ")}` : "";
  return `median ${f(r.median)} (min ${f(r.min)}, max ${f(r.max)})${per}${r.note ? `; ${r.note}` : ""}${r.extras ? `; ${r.extras.map((e) => `${e.text}: ${e.ok}`).join("; ")}` : ""}`;
};

for (const r of ev.rows) {
  const opts = r.provisional && !r.pass ? { todo: "provisional (BALANCE §4 M17: retune the later-wish gate)" } : {};
  test(`${r.section} ${r.id}: ${r.what}`, opts, () => {
    assert.ok(r.pass, show(r));
  });
}

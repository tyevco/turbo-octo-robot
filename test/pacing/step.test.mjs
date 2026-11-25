// The simulator's results do not depend on its step size outside sessions
// (ARCHITECTURE A11): 1 s and 10 s steps give the same milestones within 1 %.
// Sessions always run in 1 s steps; outside them the engine's advance is
// closed form per segment, and agent changes land on their exact second.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runProfile } from "../../tools/sim/pacing.mjs";
import { fmtClock } from "../../tools/sim/profiles.mjs";

const REL = 0.01;

function compare(id, seed) {
  const fine = runProfile(id, seed, { idleStep: 1, keepState: false });
  const coarse = runProfile(id, seed, { idleStep: 10, keepState: false });
  // every milestone either run reached before the other stopped
  const stop = Math.min(fine.milestones[id === "P1" ? "wish2:available" : "wish:available"], coarse.milestones[id === "P1" ? "wish2:available" : "wish:available"]);
  const keys = new Set([...Object.keys(fine.milestones), ...Object.keys(coarse.milestones)]);
  const bad = [];
  let n = 0;
  for (const k of keys) {
    const a = fine.milestones[k];
    const b = coarse.milestones[k];
    if ((a ?? Infinity) > stop && (b ?? Infinity) > stop) continue;
    n++;
    if (a === undefined || b === undefined) { bad.push(`${k}: ${fmtClock(a)} vs ${fmtClock(b)}`); continue; }
    if (Math.abs(a - b) > REL * Math.max(a, 1)) bad.push(`${k}: ${fmtClock(a)} (1 s) vs ${fmtClock(b)} (10 s)`);
  }
  assert.ok(n > 10, `${id}: only ${n} milestones compared`);
  assert.deepEqual(bad, [], `${id} seed ${seed}`);
  assert.ok(Math.abs(fine.m15 - coarse.m15) <= REL * fine.m15);
  assert.equal(fine.wishGain, coarse.wishGain);
}

test("P1 (to the second wish): 1 s and 10 s idle steps give the same milestones within 1 %", () => compare("P1", 1));
test("P2 (never clicks, buys every 5 min of open time): same milestones within 1 %", () => compare("P2", 3));
test("P7 (64 agents and their fledglings): same milestones within 1 %", () => compare("P7", 2));

test("idle steps above 60 s are refused (a longer step would be an away segment)", () => {
  assert.throws(() => runProfile("P3", 1, { idleStep: 61 }), /idleStep/);
});

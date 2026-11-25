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

test("r3-24: P13's agents give 48 sub-minute turns and 192 new sub-agents an hour each, one working at a time, and earn units by time", async () => {
  const { agentObservation } = await import("../../tools/sim/pacing.mjs");
  const { seeded, writer, observeAction, T0 } = await import("../engine/_util.mjs");
  const s = seeded();
  const me = writer(s);
  const turns = new Map();
  const kids = new Map(); // address → finished
  let maxWorking = 0;
  const start = 7200; // a whole cycle of every agent, from the second hour
  for (let sec = start; sec < start + 3600; sec++) {
    const list = agentObservation("P13", sec);
    const working = new Map();
    for (const o of list) {
      if (o.kind === "pane") {
        if (!turns.has(o.addr)) turns.set(o.addr, [o.turn, o.turn]);
        turns.get(o.addr)[1] = o.turn;
      } else {
        if (o.status === "working") working.set(o.parent, (working.get(o.parent) || 0) + 1);
        kids.set(o.addr, (kids.get(o.addr) || false) || o.turn === 1);
      }
    }
    for (const v of working.values()) maxWorking = Math.max(maxWorking, v);
    me.act(observeAction(T0 + sec * 1000, list));
  }
  assert.equal(turns.size, 4);
  for (const [a, [t0, t1]] of turns) assert.equal(t1 - t0, 48, a);
  const done = [...kids.values()].filter(Boolean).length;
  // 192 an hour each, give or take the blocks cut by the hour's two ends
  assert.ok(Math.abs(done - 4 * 192) <= 16, `${done} sub-agents finished`);
  assert.equal(maxWorking, 1, "one fledgling works at a time, as in P1");
  // the unit budgets' bound over the hour: per agent 1 + 60/12 (pane) and
  // 0.5 · (1 + 60/12) (its fledglings), whatever the number of finishes
  const u = s.stats.units.created;
  assert.ok(u <= 4 * (6 + 3), `${u} units from ${4 * 48} turns and ${done} fledgling finishes`);
  assert.ok(u >= 4 * 5, `${u}`);
});

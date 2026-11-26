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

// Review r7-13: buy: rows were never noted as "reached by a night pot". The sim takes away
// credit as spent last: a purchase is pot-paid when its cost is more than the bank held
// without the pot money still in it.
test("r7-13: potAttribution flags a purchase only the night pot's money could pay", async () => {
  const { potAttribution } = await import("../../tools/sim/pacing.mjs");
  const pot = { kind: "earn", source: "away", amount: 500 };
  // bank 200 before the pot; 500 credited; a 600 buy needs the pot, the leftover 100 is pot money
  let r = potAttribution([pot, { kind: "buy", item: "x", count: 1, cost: 600 }], 100, 0);
  assert.deepEqual(r.byPot, [false, true]);
  assert.equal(r.potLeft, 100);
  // the same pot, a 150 buy the 200 already banked covers: not the pot's
  r = potAttribution([pot, { kind: "buy", item: "x", count: 1, cost: 150 }], 550, 0);
  assert.deepEqual(r.byPot, [false, false]);
  assert.equal(r.potLeft, 500);
  // a later call: pot money still in the bank pays for a buy the live bank cannot
  r = potAttribution([{ kind: "buy", item: "y", count: 1, cost: 300 }], 250, 500);
  assert.deepEqual(r.byPot, [true]);
  assert.equal(r.potLeft, 250);
  // live income since refilled the bank: the same buy is paid without the pot
  r = potAttribution([{ kind: "earn", source: "helpers", amount: 400 }, { kind: "buy", item: "y", count: 1, cost: 300 }], 950, 500);
  assert.deepEqual(r.byPot, [false, false]);
  assert.equal(r.potLeft, 500);
  // no pot, nothing flagged; a bank emptied (a wish) leaves no pot money behind
  r = potAttribution([{ kind: "buy", item: "z", count: 1, cost: 10 }], 0, 0);
  assert.deepEqual(r.byPot, [false]);
  assert.equal(potAttribution([{ kind: "wish", gain: 10 }], 0, 800).potLeft, 0);
});

test("r7-13: P1's first Crane Loft (BALANCE §4 M14) is bought from the day-3 night pot and noted so", () => {
  const trace = [];
  const r = runProfile("P1", 1, { stopAt: "wish", keepState: false, trace: (p, e, s) => trace.push({ p, e, bank: s.bank }) });
  const at = trace.findIndex((x) => x.e.kind === "buy" && x.e.item === "crane-loft");
  assert.ok(at >= 0, "no Crane Loft");
  const buy = trace[at];
  // the pot collected at that play-clock, the bank just before it, and what the buys between
  // the pot and the Crane Loft spent: the Loft was affordable without the pot if that covers it
  const from = trace.findIndex((x) => x.p === buy.p && x.e.kind === "earn" && x.e.source === "away");
  const own = from < 0 ? Infinity : trace[from].bank - trace[from].e.amount
    - trace.slice(from, at).reduce((a, x) => a + (x.e.kind === "buy" ? x.e.cost : 0), 0);
  assert.equal(r.byAway["buy:crane-loft"] === true, own < buy.e.cost,
    `bank without the pot ${own.toExponential(2)}, cost ${buy.e.cost.toExponential(2)}`);
  // today it needs the pot (BALANCE §4: bought at the day-3 open from the night pot)
  assert.equal(r.byAway["buy:crane-loft"], true);
  // a spawn runs on active time only: never noted
  assert.notEqual(r.byAway["spawn:crane#1"], true);
});

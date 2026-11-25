// Idempotent apply, determinism and the two-writer merge (A5; BALANCE
// invariants 8, 9, 10 and 11 at small scale).
import { test } from "node:test";
import assert from "node:assert/strict";
import { engine, writer, agent, observeAction, T0, DAY } from "./_util.mjs";

const MIN = 60000;

/** Agent i's status and turn at time t: a 30 min cycle offset 7·i min (12 working, 2 waiting, 12 working, 4 resting). */
function agentAt(i, t) {
  const cycle = 30 * MIN;
  const x = t - T0 + 7 * i * MIN;
  const n = Math.floor(x / cycle);
  const p = x - n * cycle;
  let status = "working";
  let turn = 2 * n;
  if (p >= 12 * MIN && p < 14 * MIN) { status = "blocked"; turn += 1; }
  else if (p >= 14 * MIN && p < 26 * MIN) { status = "working"; turn += 1; }
  else if (p >= 26 * MIN) { status = "idle"; turn += 2; }
  return agent(i, status, turn);
}

function obsKey(list) {
  return list.map((o) => `${o.addr}:${o.status}:${o.turn}`).join("|");
}

/**
 * Drive one world for `hours`: `windows` = [{ w, agents: [i…], sessions: (k) => bool }].
 * One window = a single writer; two = two writers sharing a save through the A4/A5 protocol.
 */
function world(windows, hours, seed = 11) {
  const disk = { text: engine.serialize(engine.newGame({ seed, now: T0, day: DAY })) };
  const wins = windows.map((spec, k) => ({
    ...spec, seq: 0, base: disk.text, pending: [], state: engine.parseSave(disk.text).state,
    lastObs: "", saveAt: T0 + 15000 + k * 7000, conflicts: 0,
  }));
  const act = (win, a) => {
    const action = { w: win.w, s: ++win.seq, ...a };
    engine.apply(win.state, action);
    win.pending.push(action);
  };
  const save = (win, now) => {
    let text = engine.serialize(win.state);
    if (disk.text !== win.base) {
      win.conflicts++;
      const back = engine.parseSave(disk.text);
      assert.equal(back.ok, true);
      engine.replay(back.state, win.pending);
      engine.advance(back.state, now, win.w);
      win.state = back.state;
      text = engine.serialize(win.state);
    }
    disk.text = text;
    win.base = text;
    win.pending = [];
  };
  const end = T0 + hours * 3600000;
  for (let t = T0 + 1000; t <= end; t += 1000) {
    for (const win of wins) {
      const list = win.agents.map((i) => agentAt(i, t));
      const key = obsKey(list);
      if (key !== win.lastObs) {
        win.lastObs = key;
        act(win, observeAction(t, list));
      }
      const minute = Math.floor((t - T0) / MIN);
      const inSession = (t - T0) % (20 * MIN) < 150000 && win.sessions(Math.floor(minute / 20));
      if (inSession) {
        if ((t - T0) % (20 * MIN) === 1000) {
          for (const i of win.opens ? win.opens(Math.floor(minute / 20)) : win.agents) {
            const id = engine.helperId(`t${i}`, 1000 + i);
            if (win.state.envelopes[id]) act(win, { t, type: "open", helperId: id });
          }
          for (const item of ["crisp-corners", "paper-stack", "paper-stack", "bone-folder", "paper-stack"]) {
            if (engine.itemInfo(win.state, item, 1).ok) act(win, { t, type: "buy", item, count: 1 });
          }
        }
        act(win, { t, type: "click", target: "sheet" });
        const c = win.state.spawn.chain;
        if (c) act(win, { t: t + 200, type: "click", target: "node", id: engine.nodeId(c, c.next) });
        act(win, { t: t + 500, type: "click", target: "sheet" });
      }
      engine.advance(win.state, t + 1, win.w);
      if (wins.length > 1 && t >= win.saveAt) {
        save(win, t + 1);
        win.saveAt += 15000;
      }
    }
  }
  if (wins.length > 1) for (const win of wins) save(win, end + 2);
  return { state: wins.length > 1 ? engine.parseSave(disk.text).state : wins[0].state, wins };
}

test("apply is idempotent by (w, s): replaying the same actions changes nothing (inv. 8)", () => {
  const s = engine.newGame({ seed: 5, now: T0, day: DAY });
  const me = writer(s);
  const actions = [];
  for (let i = 0; i < 40; i++) actions.push(me.make({ t: T0 + 1000 + i * 700, type: "click", target: "sheet" }));
  actions.push(me.make(observeAction(T0 + 40000, [agent(1, "working", 0), agent(2, "idle", 3)])));
  actions.push(me.make(observeAction(T0 + 50000, [agent(1, "idle", 1), agent(2, "idle", 4)])));
  actions.push(me.make({ t: T0 + 50001, type: "buy", item: "paper-stack", count: 1 }));
  engine.replay(s, actions);
  const once = engine.serialize(s);
  const ev = engine.replay(s, actions);
  assert.ok(ev.every((e) => e.kind === "ignored" && e.reason === "applied"));
  assert.equal(engine.serialize(s), once);
  const u = s.stats.units;
  assert.equal(u.created, 2);
  assert.equal(u.created, u.opened + u.converted + Object.values(s.envelopes).reduce((a, e) => a + e.units, 0));
});

test("determinism: same seed and inputs give a byte-identical serialize() (inv. 10)", () => {
  const run = () => world([{ w: "wS", agents: [1, 2, 3, 4], sessions: () => true }], 0.75, 3).state;
  const a = engine.serialize(run());
  const b = engine.serialize(run());
  assert.equal(a, b);
  const c = engine.serialize(world([{ w: "wS", agents: [1, 2, 3, 4], sessions: () => true }], 0.75, 4).state);
  assert.notEqual(a, c);
});

test("cloneState round trip is exact and keeps maps null-prototype", () => {
  const { state } = world([{ w: "wS", agents: [1, 2, 3, 4], sessions: () => true }], 0.5);
  const copy = engine.cloneState(state);
  assert.equal(engine.serialize(copy), engine.serialize(state));
  for (const path of engine.MAP_FIELDS) {
    const v = path.split(".").reduce((o, k) => o[k], copy);
    assert.equal(Object.getPrototypeOf(v), null, path);
  }
});

for (const seed of [7, 10, 11]) test(`two writers sharing a save end within 1 % of one writer with the combined input (inv. 11, seed ${seed})`, () => {
  // The single writer gets the combined input: every session, opening the
  // envelopes of the agents whose window ran that session.
  const single = world([{ w: "wS", agents: [1, 2, 3, 4], sessions: () => true, opens: (k) => (k % 2 === 0 ? [1, 2] : [3, 4]) }], 3, seed).state;
  const pair = world([
    { w: "wA", agents: [1, 2], sessions: (k) => k % 2 === 0 },
    { w: "wB", agents: [3, 4], sessions: (k) => k % 2 === 1 },
  ], 3, seed);
  const merged = pair.state;
  assert.ok(pair.wins.every((w) => w.conflicts > 100));
  const rel = (a, b) => Math.abs(a - b) / b;
  assert.ok(rel(merged.lifetime, single.lifetime) < 0.01, `lifetime ${merged.lifetime} vs ${single.lifetime}`);
  assert.ok(rel(merged.stats.bySource.helpers, single.stats.bySource.helpers) < 0.01, "helpers");
  assert.ok(rel(merged.stats.bySource.workshops, single.stats.bySource.workshops) < 0.01, "workshops");
  // every finish dropped once: same tasks and units as the single writer
  assert.equal(merged.stats.tasks, single.stats.tasks);
  assert.equal(merged.stats.units.created, single.stats.units.created);
  const u = merged.stats.units;
  const waiting = Object.values(merged.envelopes).reduce((a, e) => a + e.units, 0);
  assert.equal(u.created, u.opened + u.converted + waiting);
  // no helper went to the Album, and each window still owns its helpers
  for (const h of Object.values(merged.helpers)) {
    assert.equal(h.gone, false);
    assert.equal(h.seenBy, Number(h.addr.slice(1)) <= 2 ? "wA" : "wB");
  }
});

test("no interval of time is credited twice across merges", () => {
  const disk = { text: null };
  const s0 = engine.newGame({ seed: 1, now: T0, day: DAY });
  s0.owned["paper-stack"] = 10;
  s0.owned["bone-folder"] = 10;
  disk.text = engine.serialize(s0);
  const wins = ["wA", "wB"].map((w) => ({ w, base: disk.text, state: engine.parseSave(disk.text).state }));
  let t = T0;
  for (let k = 0; k < 400; k++) {
    t += 3000 + (k % 7) * 1000;
    const win = wins[k % 2];
    engine.advance(win.state, t, win.w);
    if (disk.text !== win.base) {
      const back = engine.parseSave(disk.text).state;
      engine.advance(back, t, win.w);
      win.state = back;
    }
    disk.text = engine.serialize(win.state);
    win.base = disk.text;
  }
  const final = engine.parseSave(disk.text).state;
  const Rw = 10 * 0.05 + 10 * 0.3;
  const expect = Rw * (final.clock - T0) / 1000;
  assert.ok(Math.abs(final.stats.bySource.workshops - expect) < 1e-6 * expect, `${final.stats.bySource.workshops} vs ${expect}`);
});

test("notification counter: per-day count across writers, day merged by max", () => {
  const s = engine.newGame({ seed: 1, now: T0, day: DAY });
  const a = writer(s, "wA");
  const b = writer(s, "wB");
  a.act({ t: T0, type: "notified", event: "full", day: DAY });
  b.act({ t: T0 + 1, type: "notified", event: "pile", day: DAY });
  assert.equal(s.notify.sent, 2);
  assert.equal(s.notify.firedFull, true);
  b.act({ t: T0 + 2, type: "notified", event: "pile", day: "2026-11-26" });
  assert.equal(s.notify.day, "2026-11-26");
  assert.equal(s.notify.sent, 1);
  a.act({ t: T0 + 3, type: "notified", event: "save", day: DAY }); // an older day: ignored
  assert.equal(s.notify.day, "2026-11-26");
  assert.equal(s.notify.sent, 1);
});

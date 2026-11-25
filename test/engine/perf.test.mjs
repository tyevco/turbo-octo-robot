// Budgets (task brief, A2.6): advance over 1 s with 64 helpers < 2 ms in Node;
// a replay of 200 actions < 20 ms. Medians of repeated runs, after a warm-up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { engine, seeded, writer, agent, kid, observeAction, T0 } from "./_util.mjs";

function big() {
  const s = seeded(17);
  const me = writer(s, "w-perf");
  let t = T0;
  for (let batch = 0; batch < 10; batch++) {
    const gone = Array.from({ length: 50 }, (_, i) => agent(5000 + batch * 50 + i, "working", 0));
    me.act(observeAction((t += 1000), gone));
    me.act(observeAction((t += 1000), []));
  }
  const list = [
    ...Array.from({ length: 64 }, (_, i) => agent(i, ["working", "working", "idle", "blocked", "done"][i % 5], 0)),
    ...Array.from({ length: 24 }, (_, i) => kid(100 + i, i, "working", 0)),
  ];
  me.act(observeAction((t += 1000), list));
  s.bank = 1e12;
  for (const w of engine.CONTENT.WORKSHOPS) me.act({ t, type: "buy", item: w.id, count: 10 });
  for (const item of ["rice-treats", "fledgling-wings", "deep-rest", "mail-sorter", "crease-helper", "long-crease"]) me.act({ t, type: "buy", item, count: 1 });
  for (let i = 0; i < 40; i++) me.act({ t: (t += 400), type: "click", target: "sheet" });
  s.envelopes[engine.helperId("t1", 1001)] = { type: "chorus", units: 2, landedAt: t, lastAt: t };
  me.act({ t, type: "open", helperId: engine.helperId("t1", 1001) });
  return { s, me, t, list };
}

function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

test("advance over 1 s with 64 helpers (and 500 in the Album) takes < 2 ms", () => {
  const { s, me, t } = big();
  let now = t;
  const times = [];
  for (let k = 0; k < 400; k++) {
    if (k % 3 === 0) me.act({ t: now + 10, type: "click", target: "sheet" });
    now += 1000;
    const a = performance.now();
    engine.advance(s, now, "w-perf");
    times.push(performance.now() - a);
  }
  const m = median(times.slice(100));
  console.log(`# advance 1 s: median ${m.toFixed(3)} ms`);
  assert.ok(m < 2, `median ${m.toFixed(3)} ms`);
});

test("replay of 200 actions takes < 20 ms", () => {
  const { s, t, list } = big();
  const base = engine.serialize(s);
  const w = writer(engine.newGame({ seed: 1, now: T0, day: "2026-11-25" }), "w-other");
  const actions = [];
  let now = t;
  for (let i = 0; i < 200; i++) {
    now += 400;
    if (i % 25 === 0) actions.push(w.make(observeAction(now, list.map((o, j) => (j === i % 64 ? { ...o, turn: 1 + i, status: "idle" } : o)))));
    else if (i % 17 === 0) actions.push(w.make({ t: now, type: "buy", item: "paper-stack", count: 1 }));
    else actions.push(w.make({ t: now, type: "click", target: "sheet" }));
  }
  const times = [];
  for (let k = 0; k < 7; k++) {
    const st = engine.parseSave(base).state;
    const a = performance.now();
    engine.replay(st, actions);
    times.push(performance.now() - a);
  }
  const m = median(times);
  console.log(`# replay 200: median ${m.toFixed(2)} ms`);
  assert.ok(m < 20, `median ${m.toFixed(2)} ms`);
});

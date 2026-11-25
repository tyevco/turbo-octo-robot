// Observation mapping (DESIGN §5.1, §5.2; ARCHITECTURE B5): agents() joined
// with terminals() by address, error → blocked, paneless fledglings done →
// idle, parent chains (through wordless terminals, ≤ 32 hops), kept
// fledglings, hostile addresses, 64 agents, and "observe only on change".

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildObservation, signature, kidStatus, paneStatus } from "../../mods/creaseworks/glue/observe.js";
import { normalizeAgent, normalizeTerminal, bridgeOut } from "../../tools/mock/controller.js";
import { win, agent, term, flockScenario, engine } from "./_util.mjs";

let w;
afterEach(() => w && w.dispose());

/** agents()/terminals() exactly as the host hands them to script (bridged under frozen prototypes). */
const host = (agents, terminals) => [bridgeOut(agents.map(normalizeAgent)), bridgeOut(terminals.map(normalizeTerminal))];
const by = (list) => new Map(list.map((o) => [o.addr, o]));

test("pane agents: joined by address; created_ms and turn from terminals(); missing created_ms is 0", () => {
  const [a, t] = host([agent(1), agent(2, "done")], [term(1, "working", { turn: 7, created_ms: 55 }), { address: "t2", status: "idle", turn: 2, created_ms: undefined }]);
  delete t[1].created_ms;
  const { list } = buildObservation(a, t);
  const m = by(list);
  assert.deepEqual(Object.keys(m.get("t1")).sort(), ["addr", "created", "kind", "pane", "paneName", "parent", "raw", "space", "status", "tab", "title", "turn"].sort());
  assert.equal(m.get("t1").created, 55);
  assert.equal(m.get("t1").turn, 7);
  assert.equal(m.get("t1").pane, "p1");
  assert.equal(m.get("t1").kind, "pane");
  assert.equal(m.get("t1").parent, null);
  assert.equal(m.get("t2").created, 0);
  assert.equal(m.get("t2").status, "done", "a pane agent's done is shown as herdr reports it");
});

test("error → blocked (pane agents and fledglings); paneless done → idle", () => {
  assert.equal(paneStatus("blocked", "error"), "blocked");
  assert.equal(paneStatus("working", "error"), "blocked");
  assert.equal(kidStatus("error"), "blocked");
  assert.equal(kidStatus("done"), "idle");
  assert.equal(kidStatus("idle"), "idle");
  assert.equal(kidStatus("working"), "working");
  assert.equal(kidStatus("thinking"), "idle");
  const [a, t] = host([agent(1, "blocked")], [
    term(1, "error"),
    { address: "k1", status: "done", parent: "t1", created_ms: 9 },
    { address: "k2", status: "error", parent: "t1" },
    { address: "k3", status: "working", parent: "t1" },
  ]);
  const m = by(buildObservation(a, t).list);
  assert.equal(m.get("t1").status, "blocked");
  assert.equal(m.get("t1").raw, "error");
  assert.equal(m.get("k1").status, "idle");
  assert.equal(m.get("k1").raw, "done");
  assert.equal(m.get("k1").kind, "kid");
  assert.equal(m.get("k1").pane, null);
  assert.equal(m.get("k2").status, "blocked");
  assert.equal(m.get("k3").status, "working");
});

test("parent chains: kids of kids, wordless links, 32 hops, cycles, strangers", () => {
  const terms = [term(1), { address: "k1", status: "working", parent: "t1" }, { address: "k2", status: "idle", parent: "k1" },
    { address: "shell", status: null, parent: "k2" }, { address: "k3", status: "working", parent: "shell" },
    { address: "orphan", status: "working", parent: "nobody" }, { address: "loopA", status: "working", parent: "loopB" },
    { address: "loopB", status: "working", parent: "loopA" }, { address: "lone", status: "working" }];
  // a chain of 40 kids: only the first 32 hops reach t1
  for (let i = 1; i <= 40; i++) terms.push({ address: `c${i}`, status: "working", parent: i === 1 ? "t1" : `c${i - 1}` });
  const [a, t] = host([agent(1)], terms);
  const m = by(buildObservation(a, t).list);
  assert.equal(m.get("k1").parent, "t1");
  assert.equal(m.get("k2").parent, "k1");
  assert.equal(m.has("shell"), false, "a terminal that never reported a word is not an agent");
  assert.equal(m.get("k3").parent, "k2", "the nearest observed ancestor");
  for (const x of ["orphan", "loopA", "loopB", "lone"]) assert.equal(m.has(x), false, x);
  assert.ok(m.has("c32"));
  assert.equal(m.has("c33"), false, "beyond 32 hops");
});

test("a kept fledgling (pane in agents()) is a kid of its parent and keeps its pane", () => {
  const [a, t] = host([agent(1), agent(2)], [term(1), term(2, "working", { parent: "t1" })]);
  const m = by(buildObservation(a, t).list);
  assert.equal(m.get("t2").kind, "kid");
  assert.equal(m.get("t2").parent, "t1");
  assert.equal(m.get("t2").pane, "p2");
});

// Review r2-18: when the parent's pane closes, the kept fledgling is reported
// as a pane helper (its chain no longer reaches an observed agent), and the
// engine must follow: it gathers, and its finished task fills its own envelope.
test("a kept fledgling whose parent's pane closes is observed as a pane helper, and the engine counts it (§5.2, r2-18)", () => {
  const T = Date.UTC(2026, 10, 25, 9);
  const s = engine.newGame({ seed: 18, now: T, day: "2026-11-25" });
  let seq = 0;
  const observe = (t, agents, terms) => {
    const [a, tt] = host(agents, terms);
    engine.apply(s, { w: "wA", s: ++seq, t, type: "observe", helpers: buildObservation(a, tt).list, visible: true, active: true, matShown: true, day: "2026-11-25" });
  };
  const id1 = engine.helperId("t1", 1001);
  const id2 = engine.helperId("t2", 1002);
  observe(T + 1000, [agent(1), agent(2)], [term(1), term(2, "working", { parent: "t1" })]);
  assert.equal(s.helpers[id2].kind, "kid");
  assert.equal(s.helpers[id2].parent, id1);
  // t1's pane closes; its terminal record stays (the sub-agent still names it as parent)
  const [a, t] = host([agent(2)], [term(1, "idle"), term(2, "working", { parent: "t1" })]);
  const o = by(buildObservation(a, t).list).get("t2");
  assert.equal(o.kind, "pane");
  assert.equal(o.parent, null);
  observe(T + 2000, [agent(2)], [term(1, "idle"), term(2, "working", { parent: "t1" })]);
  assert.equal(s.helpers[id1].gone, true);
  assert.equal(s.helpers[id2].kind, "pane");
  const r = engine.rates(s, "wA");
  assert.equal(r.nWorking, 1);
  assert.ok(r.Hs0 > 0);
  observe(T + 70000, [agent(2, "idle")], [term(1, "idle"), term(2, "idle", { parent: "t1", turn: 1 })]);
  assert.equal(s.envelopes[id1], undefined);
  assert.ok(s.envelopes[id2].units > 0);
});

test("hostile addresses: __proto__, constructor, toString, t1/../x, peer/t7", () => {
  const names = ["__proto__", "constructor", "toString", "t1/../x", "peer/t7", "hasOwnProperty"];
  const agents = names.map((n, i) => ({ address: n, pane: `p${i}`, status: i % 2 ? "blocked" : "working", title: "🧑🏽‍💻 x" }));
  const terms = names.map((n, i) => ({ address: n, status: "working", turn: i, created_ms: 100 + i }));
  terms.push({ address: "valueOf", status: "done", parent: "__proto__" });
  const [a, t] = host(agents, terms);
  const obs = buildObservation(a, t);
  const m = by(obs.list);
  for (const n of names) assert.ok(m.has(n), n);
  assert.equal(m.get("valueOf").parent, "__proto__");
  assert.ok(obs.live.has("__proto__"));
  // Through the engine: one helper each.
  const s = engine.newGame({ seed: 1, now: 1000, day: "2026-01-01" });
  engine.apply(s, { w: "w", s: 1, t: 2000, type: "observe", helpers: obs.list, visible: true, active: true, matShown: true, day: "2026-01-01" });
  assert.equal(Object.keys(s.helpers).length, names.length + 1);
  assert.equal(Object.getPrototypeOf(s.helpers), null);
});

test("64 agents and fledglings: built quickly, signature stable, changes detected", () => {
  const sc = flockScenario(64, 24);
  const [a, t] = host(sc.agents, sc.terminals);
  const t0 = performance.now();
  let obs;
  for (let i = 0; i < 50; i++) obs = buildObservation(a, t);
  const ms = (performance.now() - t0) / 50;
  assert.ok(ms < 2, `${ms.toFixed(3)} ms per build`);
  assert.equal(obs.list.length, 64 + 24);
  assert.equal(signature(obs.list), signature(buildObservation(a, t).list));
  t[5].turn += 1;
  assert.notEqual(signature(buildObservation(a, t).list), signature(obs.list));
});

test("the ticker observes on change only, and the engine gets the mapped statuses", async () => {
  w = win({
    agents: [agent(1, "blocked"), agent(2)],
    terminals: [term(1, "error"), term(2), { address: "k9", status: "done", parent: "t2", created_ms: 5 }],
  });
  await w.copy("panel");
  await w.advance(5000);
  const observes = () => w.slot.state.applied[w.slot.writerId];
  const hs = Object.values(w.slot.state.helpers);
  assert.equal(hs.length, 3);
  assert.equal(hs.find((h) => h.addr === "t1").status, "blocked");
  assert.equal(hs.find((h) => h.addr === "k9").status, "idle");
  assert.equal(hs.find((h) => h.addr === "k9").kind, "kid");
  const n = observes();
  await w.advance(5000);
  assert.equal(observes(), n, "nothing changed: no observe action");
  w.ctl.setTerminals([term(1, "error"), term(2, "working", { turn: 1 }), { address: "k9", status: "done", parent: "t2", created_ms: 5 }]);
  await w.advance(1000);
  assert.equal(observes(), n + 1, "a turn change: one observe");
});

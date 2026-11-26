// Observation mapping (DESIGN §5.1, §5.2; ARCHITECTURE B5): agents() joined
// with terminals() by address, error → blocked, paneless fledglings done →
// idle, parent chains (through wordless terminals, ≤ 32 hops), kept
// fledglings, hostile addresses, 64 agents, and "observe only on change".

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildObservation, observeFromAgents, signature, kidStatus, paneStatus } from "../../mods/creaseworks/glue/observe.js";
import { normalizeAgent, normalizeTerminal, bridgeOut } from "../../tools/mock/controller.js";
import { win, agent, term, flockScenario, engine, SAVE } from "./_util.mjs";
import { READ_FAIL_TEXT, READ_FAIL_MS } from "../../mods/creaseworks/glue/session.js";
import { railFlash } from "../../mods/creaseworks/ui/rail.js";

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

// r6-01: herdr's agents() comes from its pane model without a liveness check
// (restored words at startup before the first terminals listing, a remote
// machine's terminals not live, an exit not yet confirmed), so it can list a
// pane agent terminals() does not. Such an agent used to be observed with
// created 0: helper id addr#0, a phantom that joined the Flock, while the real
// helper was sent to the Album, and the Album filled on every restart.
test("r6-01: a pane agent with no live terminals() entry waits: no phantom helper, nothing sent to the Album", () => {
  const agents = [agent(1, "working"), agent(2, "blocked"), agent(3, "idle")];
  const terms = [term(1, "working", { created_ms: 101 }), term(2, "blocked", { created_ms: 102 }), term(3, "idle", { created_ms: 103 })];
  const [a0, t0] = host(agents, []);
  const first = buildObservation(a0, t0);
  assert.deepEqual(first.list, [], "nothing to observe until terminals() lists them");
  assert.deepEqual([...first.live.keys()], [], "and they are not live (opening one reports it gone)");
  assert.equal(first.panes.get("t1"), "p1", "pane ids still read");
  // A terminals() entry that is not live counts as none.
  const [a1, t1] = host([agent(1)], [term(1, "working", { state: "exited", created_ms: 101 })]);
  assert.deepEqual(buildObservation(a1, t1).list, []);
  // Through the engine: the restart timing, then the listing.
  const s = engine.newGame({ seed: 61, now: 1000, day: "2026-11-25" });
  let seq = 0;
  const observe = (t, obs) => engine.apply(s, { w: "wA", s: ++seq, t, type: "observe", helpers: obs.list, visible: true, active: true, matShown: true, day: "2026-11-25" });
  observe(2000, first);
  const [a2, t2] = host(agents, terms);
  observe(3000, buildObservation(a2, t2));
  observe(4000, buildObservation(a2, t2));
  const records = Object.values(s.helpers);
  assert.equal(records.length, 3, "three agents, three saved helpers");
  assert.deepEqual(records.filter((h) => h.gone).map((h) => h.name), [], "an empty Album");
  for (const [addr, created] of [["t1", 101], ["t2", 102], ["t3", 103]]) {
    assert.ok(s.helpers[engine.helperId(addr, created)], `${addr} keyed on its own created_ms`);
    assert.equal(s.helpers[engine.helperId(addr, 0)], undefined, `no ${addr}#0 phantom`);
  }
  // The skew again mid-run (terminals no longer live, panes remain): no phantom joins.
  observe(5000, buildObservation(...host(agents, [])));
  assert.equal(Object.keys(s.helpers).length, 3, "no phantom while the terminals are not listed");
  observe(6000, buildObservation(a2, t2));
  assert.equal(Object.keys(s.helpers).length, 3);
  assert.equal(Object.values(s.helpers).filter((h) => h.gone).length, 0, "the real helpers rejoin under their own ids");
});

test("r6-01: a fledgling whose pane agent has no terminals() entry waits with it; a kept fledgling then stands alone", () => {
  const [a, t] = host([agent(1), agent(2)], [
    term(2, "working", { parent: "t1", created_ms: 2 }),
    { address: "k1", status: "working", parent: "t1", created_ms: 9 },
    { address: "k2", status: "working", parent: "k1", created_ms: 10 },
  ]);
  const obs = buildObservation(a, t);
  const m = by(obs.list);
  assert.equal(m.has("t1"), false);
  assert.equal(m.has("k1"), false, "its parent is not observed: it does not point at an unknown helper");
  assert.equal(m.has("k2"), false);
  assert.equal(m.get("t2").kind, "pane");
  assert.equal(m.get("t2").parent, null);
  assert.equal(m.get("t2").created, 2);
  assert.equal(obs.live.has("t1"), false);
});

test("r6-01: the mock at herdr's start (agents() restored before terminals() publishes): one helper, an empty Album", async () => {
  w = win({ agents: [agent(1, "working")], terminals: [term(1, "working", { created_ms: 4242 })], terminalsPending: true });
  const panel = await w.copy("panel");
  await w.advance(3000);
  assert.equal(Object.keys(w.slot.state.helpers).length, 0, "no helper before its created_ms is known");
  assert.equal("t1" in w.slot.live, false, "not live yet");
  w.ctl.setTerminals([term(1, "working", { created_ms: 4242 })]);
  await w.advance(3000);
  const id = engine.helperId("t1", 4242);
  assert.deepEqual(Object.keys(w.slot.state.helpers), [id], "one helper, under its own id");
  assert.equal(w.slot.state.helpers[id].gone, false);
  // The terminals stop being live while the pane remains (a remote machine): no phantom gathers.
  w.ctl.setTerminals([]);
  await w.advance(3000);
  assert.deepEqual(Object.keys(w.slot.state.helpers), [id], "no addr#0 phantom");
  assert.equal(panel.session.vm().header.counts.working, 0, "nothing gathers without a live terminal");
  w.ctl.setTerminals([term(1, "working", { created_ms: 4242 })]);
  await w.advance(3000);
  assert.deepEqual(Object.keys(w.slot.state.helpers), [id]);
  assert.equal(w.slot.state.helpers[id].gone, false, "the real helper is back");
  assert.equal(w.ctl.runErrors().length, 0);
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

// r4-01: herdr builds a host result by assignment under the frozen
// Object.prototype (ARCHITECTURE A7), so a terminal label (or report field)
// named like one of its members makes terminals() itself throw. Every tick
// used to throw before advance, notifications and the save cadence: nothing
// was observed, earned or saved, and nothing said so.

for (const key of ["constructor", "toString", "valueOf"]) {
  test(`r4-01: a terminal label named ${key} from the start: the game still saves, says so once, and observes once it reads again`, async () => {
    w = win({ agents: [agent(1)], terminals: [term(1, "working", { labels: { [key]: "x" } })] });
    const v = await w.copy("panel");
    await w.advance(63000);
    assert.equal(w.ctl.runErrors().length, 0, "no tick throws");
    assert.equal(w.ctl.errors.length, 0, "no script task error");
    assert.ok(w.ctl.writes.filter((x) => x.path === SAVE && x.ok !== false).length > 0, "the save cadence ran");
    assert.ok(w.ctl.readFile(SAVE) !== null, "save.json is there");
    assert.ok(w.slot.readFail.terminals, "the failure spell is recorded");
    assert.ok(w.slot.readFail.terminals.count >= 60, "one per tick");
    assert.equal(w.slot.readFail.agents, undefined, "agents() itself reads");
    assert.equal(Object.keys(w.slot.state.helpers).length, 0, "no terminals() reading yet: no helper ids to give (created_ms)");
    // The one-time notice: shown at the first throw for READ_FAIL_MS, not re-flashed every tick.
    assert.equal(w.slot.flash, null, "the notice has run its time");
    w.dispose();
    w = win({ agents: [agent(1)], terminals: [term(1, "working", { labels: { [key]: "x" } })] });
    const v2 = await w.copy("panel");
    await w.advance(2000);
    assert.equal(w.slot.flash && w.slot.flash.text, READ_FAIL_TEXT.terminals, "said once, at once");
    const until = w.slot.flash.until;
    await w.advance(5000);
    assert.equal(w.slot.flash.until, until, "not flashed again each tick");
    const tree = JSON.stringify(w.render(v2).tree);
    assert.ok(tree.includes("Agent details unreadable"), "the panel shows it");
    // The label goes: observing resumes, the spell ends.
    w.ctl.setTerminals([term(1, "working", { labels: { where: "main / 1" } })]);
    await w.advance(2000);
    assert.equal(Object.keys(w.slot.state.helpers).length, 1, "observed again");
    assert.equal(w.slot.readFail.terminals, undefined, "the spell is over");
    assert.ok(v);
  });
}

test("r4-01/r5-11: a label appearing mid-run: pane agents still observed from agents(); folds keep coming, saves land", async () => {
  w = win({ agents: [agent(1), agent(2, "blocked")], terminals: [term(1, "working"), term(2, "blocked")] });
  await w.copy("panel");
  await w.copy("ribbon");
  await w.advance(5000);
  const st = w.slot.state;
  const before = Object.values(st.helpers).map((h) => `${h.addr}:${h.status}`).sort();
  assert.deepEqual(before, ["t1:working", "t2:blocked"]);
  const ids = Object.keys(st.helpers).sort();
  w.ctl.setTerminals([term(1, "working", { labels: { toString: "y" } }), term(2, "blocked")]);
  const writes = w.ctl.writes.length;
  const bank = st.lifetime;
  await w.advance(1000);
  assert.equal(w.slot.flash && w.slot.flash.text, READ_FAIL_TEXT.terminals);
  assert.ok(READ_FAIL_MS >= 5000, "long enough to read");
  await w.advance(60000);
  assert.equal(w.ctl.runErrors().length, 0);
  assert.equal(w.ctl.errors.length, 0);
  assert.deepEqual(Object.values(w.slot.state.helpers).map((h) => `${h.addr}:${h.status}`).sort(), before, "nothing changed: same helpers");
  assert.deepEqual(Object.keys(w.slot.state.helpers).sort(), ids, "same helper ids (created_ms carried over)");
  assert.deepEqual(Object.keys(w.slot.live).sort(), ["t1", "t2"], "liveness from agents()");
  assert.deepEqual({ ...w.slot.panes }, { t1: "p1", t2: "p2" }, "pane ids from agents()");
  assert.ok(w.slot.state.lifetime > bank, "advance still runs: the working helper earns");
  assert.ok(w.ctl.writes.length > writes, "the save cadence still runs");
  assert.ok(w.ctl.readFile(SAVE) !== null);
});

// r5-11: while terminals() keeps throwing, agents() still gives every pane
// agent's status. Observing used to freeze: a waiting agent kept earning and
// never showed needs-you, and the notice ran out after READ_FAIL_MS.
test("r5-11: terminals() throwing: an agent that becomes blocked stops earning and shows needs-you; a finish pays once it reads", async () => {
  w = win({
    agents: [agent(1), agent(2)],
    terminals: [term(1), term(2), { address: "k9", status: "working", parent: "t2", created_ms: 9 }],
  });
  const panel = await w.copy("panel");
  await w.advance(5000);
  const st = w.slot.state;
  const h = (addr) => Object.values(st.helpers).find((x) => x.addr === addr && !x.gone);
  assert.equal(h("t2").status, "working");
  assert.equal(h("k9").kind, "kid");
  const ids = Object.keys(st.helpers).sort();
  // A prototype-named label makes every terminals() throw; t2 then waits for input (agents() says so).
  w.ctl.setTerminals([term(1, "working", { labels: { toString: "y" } }), term(2, "blocked"), { address: "k9", status: "idle", parent: "t2", created_ms: 9 }]);
  w.ctl.setAgents([agent(1), agent(2, "blocked")]);
  await w.advance(2000);
  assert.equal(w.slot.readFail.terminals && w.slot.readFail.terminals.count > 0, true, "terminals() throws");
  assert.equal(h("t2").status, "blocked", "needs-you from agents()");
  assert.equal(h("t1").status, "working");
  assert.equal(h("k9").status, "working", "fledglings keep their last state");
  assert.deepEqual(Object.keys(st.helpers).sort(), ids, "same helpers, same ids");
  // Earning follows: one working pane agent (t1) plus the frozen fledgling, not two.
  await w.advance(READ_FAIL_MS + 1000);
  assert.equal(w.slot.flash, null, "the notice has run its time");
  assert.equal(h("t2").status, "blocked", "still shown as needing you after the notice");
  await w.advance(1000);
  assert.equal(panel.session.vm().header.counts.needs, 1, "the Needs you count shows it");
  assert.equal(panel.session.vm().header.counts.working, 1, "only t1 works (plus its frozen fledgling on t2)");
  const l0 = st.lifetime;
  await w.advance(10000);
  assert.ok(st.lifetime > l0, "t1 still earns");
  // t2 is answered and t1 finishes a turn (agents() done): the turn counter is terminals()' own,
  // so the reward waits for it and is paid exactly once when it reads again.
  w.ctl.setAgents([agent(1, "done"), agent(2)]);
  w.ctl.setTerminals([term(1, "idle", { turn: 1, labels: { toString: "y" } }), term(2, "working"), { address: "k9", status: "idle", parent: "t2", created_ms: 9 }]);
  await w.advance(2000);
  assert.equal(h("t1").status, "done", "done from agents()");
  assert.equal(h("t2").status, "working");
  assert.equal(h("t1").lastTurn, 0, "no turn read yet: no finish paid");
  const tasks = h("t1").stats.tasks;
  // A new agent appears while terminals() throws: it waits (no created_ms, so no id of its own yet).
  w.ctl.setAgents([agent(1, "done"), agent(2), agent(3)]);
  await w.advance(2000);
  assert.equal(h("t3"), undefined, "a new agent waits for terminals()");
  assert.ok("t3" in w.slot.live, "but it is live (agents())");
  // The label goes: the finish is paid once, the new agent joins, the fledgling updates.
  w.ctl.setTerminals([term(1, "idle", { turn: 1 }), term(2, "working"), term(3), { address: "k9", status: "idle", parent: "t2", created_ms: 9 }]);
  await w.advance(2000);
  assert.equal(w.slot.readFail.terminals, undefined, "the spell is over");
  assert.equal(h("t1").lastTurn, 1);
  assert.equal(h("t1").stats.tasks, tasks + 1, "paid once");
  await w.advance(3000);
  assert.equal(h("t1").stats.tasks, tasks + 1, "never twice");
  assert.ok(h("t3"), "the new agent joined");
  assert.equal(h("k9").status, "idle");
  assert.equal(w.ctl.runErrors().length, 0);
});

test("r5-11: observeFromAgents: agents()' statuses, carried terminal fields, frozen fledglings, waiting newcomers", () => {
  const [a, t] = host(
    [agent(1, "working"), agent(2, "blocked"), agent(4)],
    [term(1, "error", { turn: 3, created_ms: 11 }), term(2, "working", { turn: 5, created_ms: 22 }), term(3, "working", { created_ms: 33 }),
      { address: "k9", status: "working", parent: "t2", created_ms: 9 }, { address: "k8", status: "working", parent: "t3", created_ms: 8 }],
  );
  assert.equal(observeFromAgents(a, null), null, "nothing to carry over");
  const obs = observeFromAgents(a, t);
  const m = by(obs.list);
  assert.equal(m.get("t1").status, "working", "a stale error word does not hold it blocked");
  assert.equal(m.get("t1").created, 11);
  assert.equal(m.get("t1").turn, 3, "turn as last read");
  assert.equal(m.get("t2").status, "blocked", "agents()' status");
  assert.equal(m.get("t2").created, 22);
  assert.equal(m.get("k9").status, "working", "fledgling frozen");
  assert.equal(m.get("k9").parent, "t2");
  assert.equal(m.has("t3"), false, "a pane agent gone from agents() leaves");
  assert.equal(m.has("k8"), false, "and so does its fledgling");
  assert.equal(m.has("t4"), false, "a newcomer without created_ms waits");
  assert.deepEqual([...obs.live.keys()].sort(), ["k9", "t1", "t2", "t4"]);
  assert.equal(obs.panes.get("t4"), "p4");
  // Hostile addresses stay data.
  const [a2, t2] = host([agent(1, "blocked", { address: "__proto__" })], [{ address: "__proto__", status: "working", created_ms: 1 }]);
  const o2 = observeFromAgents(a2, t2);
  assert.equal(o2.list[0].addr, "__proto__");
  assert.equal(o2.list[0].status, "blocked");
});

test("r4-01: a layout() that throws keeps the last good layout; the tick and keys still act", async () => {
  const LAYOUT = (bad) => ({
    id: "root", type: "row", children: [
      { id: "work", type: "column", children: [
        { id: "work-body", type: "row", children: [
          { id: "main", type: "block" },
          { id: "cw-panel", type: "block", size: { weight: 0.39 }, ...(bad ? { constructor: 1 } : {}) },
        ] },
        { id: "cw-ribbon", type: "block", size: { px: 30 }, hidden: true },
      ] },
    ],
  });
  w = win({ agents: [agent(1)], terminals: [term(1)], layout: LAYOUT(false) });
  const panel = await w.copy("panel");
  await w.advance(3000);
  const good = w.slot.layout;
  assert.equal(good.known, true);
  w.ctl.layoutValue = LAYOUT(true);
  const writes = w.ctl.writes.length;
  await w.advance(40000);
  assert.equal(w.ctl.runErrors().length, 0);
  assert.equal(w.ctl.errors.length, 0);
  assert.deepEqual(w.slot.layout, good, "the last good layout");
  assert.ok(w.slot.readFail.layout, "noted");
  assert.ok(w.ctl.writes.length > writes, "saves go on");
  // A key: onCommand used to throw at layout() (and the command loop swallowed it).
  const runs = w.ctl.runs.length;
  w.ctl.within("event", panel, (cx) => panel.session.onCommand("fold", cx));
  assert.ok(w.ctl.runs.slice(runs).some((r) => r.name === "layout.resize"), "fold still acts");
  w.ctl.layoutValue = LAYOUT(false);
  await w.advance(1000);
  assert.equal(w.slot.readFail.layout, undefined, "reads again: the spell is over");
});

test("r4-01: the read-failure notices keep their key words on a narrow rail", () => {
  assert.equal(railFlash(READ_FAIL_TEXT.agents, 64), "Agent list unreadable");
  assert.equal(railFlash(READ_FAIL_TEXT.layout, 64), "Layout unreadable");
  assert.equal(railFlash(READ_FAIL_TEXT.terminals, 64), "Agent details unreadable");
  for (const t of Object.values(READ_FAIL_TEXT)) assert.equal(railFlash(t, 200), t, "whole on a wide rail");
});

// r7-02: herdr's rule for a hidden window is "check window()?.visible in the
// timer and stop when false; read it in render and restart when true". Only
// the tick retimed, so for up to 5 s after the window showed again the 5 s
// timer stayed: nothing advanced, and an agent that started waiting kept its
// old state (no needs-you cue).
test("r7-02: a window shown again restarts the 1 s tick from render: a needs-you agent reads at once", async () => {
  w = win({ agents: [agent(1), agent(2)], terminals: [term(1), term(2)] });
  const panel = await w.copy("panel");
  await w.advance(3000);
  const s = panel.session;
  const timers = () => w.ctl.pendingTasks().filter((t) => t.kind === "timer");
  const h = (addr) => Object.values(w.slot.state.helpers).find((x) => x.addr === addr && !x.gone);
  assert.equal(s.interval, 1000);
  w.ctl.setWindow({ visible: false });
  await w.advance(1000);
  assert.equal(s.interval, 5000, "hidden: the 5 s timer");
  // Rendered while hidden: nothing restarts, and render reads window() (so herdr renders again on show).
  w.ctl.resetCounts();
  w.render(panel);
  assert.ok((w.ctl.counts.window ?? 0) >= 1, "render reads window()");
  await w.advance(10);
  assert.equal(s.interval, 5000, "still hidden: still 5 s");
  // t2 starts waiting for input while the window is hidden, just after a hidden tick.
  w.ctl.setAgents([agent(1), agent(2, "blocked")]);
  w.ctl.setTerminals([term(1), term(2, "blocked")]);
  await w.advance(200);
  assert.equal(h("t2").status, "working", "not observed yet (the next hidden tick is seconds away)");
  w.ctl.setWindow({ visible: true });
  const before = timers().length;
  const spawns0 = w.ctl.pendingTasks().filter((t) => t.kind === "spawn").length;
  w.render(panel);
  w.render(panel);
  assert.equal(timers().length, before, "no timer is set during render (A2 rule 7)");
  assert.equal(w.ctl.pendingTasks().filter((t) => t.kind === "spawn").length - spawns0, 1, "one wake task, however many renders");
  await w.advance(1);
  assert.equal(s.interval, 1000, "the 1 s timer is back within a scheduler turn");
  assert.equal(timers().length, 1, "still one data timer per copy");
  assert.ok(timers()[0].due - Date.now() <= 1000);
  assert.equal(h("t2").status, "blocked", "observed at once: needs-you shows");
  await w.advance(1000);
  assert.equal(s.vm().header.counts.needs, 1, "the Needs you count shows it");
  // A visible window's render starts nothing.
  const spawns = w.ctl.pendingTasks().length;
  w.render(panel);
  assert.equal(w.ctl.pendingTasks().length, spawns);
});

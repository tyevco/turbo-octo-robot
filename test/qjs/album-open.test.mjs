// The Album opened on a year-size save, in QuickJS (review r2-25). The Album
// is a v_virtual_list of every helper who has left; herdr asks its item
// renderer only for the rows in view, during layout, on the render budget. The
// harness used to render up to 500 rows there, so this state could not be
// checked against the budget; it now renders the visible range, and this test
// holds render and layout under 50 ms with 7300 Album helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MOD = join(repo, "mods", "creaseworks");
const HOME = "/home/player/.config/herdr-app";
const SAVE = `${HOME}/data/creaseworks/save.json`;
const DAYS = 365;
const PER_DAY = 20;

/** The save after DAYS days of PER_DAY agents a day, each run once and closed. */
async function yearSave() {
  const engine = await import("../../mods/creaseworks/engine/index.js");
  const T0 = Date.UTC(2026, 10, 25, 9);
  const s = engine.newGame({ seed: 5, now: T0, day: "2026-11-25" });
  let seq = 0;
  const act = (a) => engine.apply(s, { w: "w-albumopen01", s: ++seq, ...a });
  const obs = (t, helpers) => act({ t, type: "observe", helpers, visible: true, active: true, matShown: true, day: "2026-11-25" });
  const ag = (i) => ({
    addr: `w1:t${i}`, created: T0 + i * 997, status: "working", raw: "working", turn: 0, parent: null,
    pane: `p${i}`, title: "claude · tidy the release notes", paneName: "", space: "main", tab: "1", kind: "pane",
  });
  let t = T0;
  let n = 0;
  for (let d = 0; d < DAYS; d++) {
    const list = [];
    for (let k = 0; k < PER_DAY; k++) list.push(ag(n++));
    obs((t += 1000), list);
    obs((t += 3600000), list.map((o) => ({ ...o, turn: 2, status: "idle" })));
    for (const id of Object.keys(s.envelopes)) act({ t, type: "open", helperId: id });
    obs((t += 1000), []);
    t = T0 + (d + 1) * 86400000;
    engine.advance(s, t);
  }
  return { text: engine.serialize(s), clock: s.clock, n };
}

function find(tree, id) {
  if (!tree || typeof tree !== "object") return null;
  if (tree.id === id) return tree;
  for (const c of tree.children ?? []) {
    const hit = find(c, id);
    if (hit) return hit;
  }
  return null;
}

function roster(n) {
  const agents = [];
  const terminals = [];
  for (let i = 1; i <= n; i++) {
    const status = ["working", "blocked", "done", "idle"][i % 4];
    agents.push({ address: `t${i}`, pane: `q${i}`, status, title: `agent ${i} · fix the flaky test`, space_name: "api", tab_name: "tab 1", tab_index: 1, focused: i === 1 });
    terminals.push({ address: `t${i}`, status: status === "done" ? "idle" : status, turn: status === "done" ? 1 : 0, created_ms: 1000 + i * 997 });
  }
  return { agents, terminals };
}

test("the Album opened on a year-size save renders and lays out within the 50 ms render budget", { timeout: 180000 }, async () => {
  const { text, clock, n } = await yearSave();
  assert.equal(n, DAYS * PER_DAY);
  // A fresh wasm instance: the outcome does not depend on what other files left in the shared heap.
  const { createHost, BUDGETS } = await import("../../tools/qjs/harness.mjs?album-open");
  const host = await createHost({
    modRoot: MOD,
    scenario: {
      appHome: HOME,
      home: "/home/player",
      props: { role: "panel" },
      window: { visible: true, active: true, platform: "linux" },
      theme: "graphite",
      ...roster(30),
      now: clock + 1000,
      files: { [SAVE]: text },
    },
  });
  try {
    await host.load();
    host.advance(0);
    host.render();
    host.fire("root", "on_size_change", { width: 320, height: 784 });
    host.advance(1000);
    let { tree } = host.render();
    const header = find(tree, "cw-flock-grp-album");
    assert.ok(header, "the Album header is in the flock panel");
    assert.equal(find(tree, "cw-flock-vl-album"), null, "the Album starts folded");

    host.fire("cw-flock-grp-album", "on_click");
    host.advance(1000);
    const times = [];
    for (let i = 0; i < 5; i++) {
      const out = host.render(); // enforces both budgets: an overrun throws a BudgetError
      tree = out.tree;
      times.push([out.ms, out.layoutMs]);
    }
    const list = find(tree, "cw-flock-vl-album");
    assert.ok(list, "the Album opened as a virtual list");
    assert.ok(list.args[1] >= n - 50, `${list.args[1]} Album rows`);
    // only the rows in view were asked for: its 280 px shows ten 28 px rows (+ base's overdraw)
    assert.ok(list.children.length > 0 && list.children.length <= 12, `${list.children.length} rows rendered`);
    for (const [ms, layoutMs] of times) {
      assert.ok(ms < BUDGETS.render, `render ${ms.toFixed(1)} ms`);
      assert.ok(layoutMs < BUDGETS.layout, `layout ${layoutMs.toFixed(1)} ms`);
    }
    assert.deepEqual(host.errors, [], JSON.stringify(host.errors));
  } finally {
    try {
      host.dispose();
    } catch {
      // DESIGN R13 open risk: this wasm build can fail JS_FreeRuntime after a
      // large save; creaseworks.test.mjs reports it. Not this test's subject.
    }
  }
});

// ---------------------------------------------------------------------------
// Review r3-02: with the Album open, every roster change (an agent leaving or
// returning) used to re-sort and re-format every Album row inside the tick:
// 430-510 ms at 20,000 Album helpers in this harness, over the 500 ms
// callback budget, and opening the Album took 330-590 ms. Rows are now
// rebuilt from the last built ones (only moved records are sorted and
// formatted) and the Album keeps at most K.albumCompactKeep compact records
// before archiving the oldest (R13, r3-04).

const T00 = Date.UTC(2026, 10, 25, 9);

/** The save after `days` days of `perDay` agents a day (each run once and closed), and the state. */
async function churned(days, perDay) {
  const engine = await import("../../mods/creaseworks/engine/index.js");
  const s = engine.newGame({ seed: 5, now: T00, day: "2026-11-25" });
  let seq = 0;
  const act = (a) => engine.apply(s, { w: "w-albumroster1", s: ++seq, ...a });
  const ag = (i) => ({
    addr: `w1:t${i}`, created: T00 + i * 997, status: "working", raw: "working", turn: 0, parent: null,
    pane: `p${i}`, title: "claude · task", paneName: "", space: "main", tab: "1", kind: "pane",
  });
  let t = T00;
  let n = 0;
  for (let d = 0; d < days; d++) {
    const list = [];
    for (let k = 0; k < perDay; k++) list.push(ag(n++));
    act({ t: (t += 1000), type: "observe", helpers: list, day: "2026-11-25" });
    act({ t: (t += 1000), type: "observe", helpers: [], day: "2026-11-25" });
    t = T00 + (d + 1) * 86400000;
  }
  engine.advance(s, t);
  return { engine, s, n };
}

function liveRoster(n, off) {
  const agents = [];
  const terminals = [];
  for (let i = 1 + off; i <= n + off; i++) {
    const status = ["working", "blocked", "done", "idle"][i % 4];
    agents.push({ address: `t${i}`, pane: `q${i}`, status, title: `agent ${i}`, space_name: "api", tab_name: "tab 1", tab_index: 1, focused: false });
    terminals.push({ address: `t${i}`, status: status === "done" ? "idle" : status, turn: status === "done" ? 1 : 0, created_ms: 1000 + i * 997 });
  }
  return { agents, terminals };
}

/** Opens the Album on `text` with 64 live agents, then swaps one agent per tick; returns the timings. */
async function albumRoster(text, clock, tag) {
  const { createHost, BUDGETS } = await import(`../../tools/qjs/harness.mjs?${tag}`);
  const host = await createHost({
    modRoot: MOD,
    scenario: {
      appHome: HOME, home: "/home/player", props: { role: "panel" },
      window: { visible: true, active: true, platform: "linux" }, theme: "graphite",
      ...liveRoster(64, 0), now: clock + 1000, files: { [SAVE]: text },
    },
  });
  try {
    await host.load();
    for (let i = 0; i < 20; i++) host.advance(500); // the stepped load, then the first observations
    host.render();
    host.fire("root", "on_size_change", { width: 320, height: 784 });
    host.advance(1000);
    host.render();
    const click = host.fire("cw-flock-grp-album", "on_click");
    const opened = host.advance(1000);
    const { tree } = host.render();
    const list = find(tree, "cw-flock-vl-album");
    assert.ok(list, "the Album opened as a virtual list");
    const steps = [];
    for (let k = 1; k <= 8; k++) {
      const r = liveRoster(64, k); // one agent leaves, one new one joins
      host.evalInVm(`globalThis.__herdr.setAgents(${JSON.stringify(r.agents)}); globalThis.__herdr.setTerminals(${JSON.stringify(r.terminals)})`);
      const a = host.advance(1000); // throws a BudgetError past 500 ms
      steps.push(Math.max(...a.stepMs));
      const out = host.render();
      assert.ok(out.ms < BUDGETS.render && out.layoutMs < BUDGETS.layout, `render ${out.ms.toFixed(1)} / layout ${out.layoutMs.toFixed(1)} ms`);
    }
    assert.deepEqual(host.errors, [], JSON.stringify(host.errors));
    return { click: click.ms, open: Math.max(...opened.stepMs), steps, rows: list.args[1] };
  } finally {
    try {
      host.dispose();
    } catch {
      // DESIGN R13 open risk (see the first test)
    }
  }
}

// Well under the 500 ms budget, so a return of the old full rebuild (≈ 430+ ms at this size) fails here.
const ROSTER_MS = 300;

test("r3-02: about 1000 days (20,000 Album helpers): opening the Album and agents coming and going with it open stay in budget", { timeout: 300000 }, async () => {
  const { engine, s, n } = await churned(1000, 20);
  assert.equal(n, 20000);
  const K = engine.CONTENT.K;
  // every helper is still in the Album (r3-04 archives keep counting them)
  const recs = Object.values(s.helpers).filter((h) => h.gone && h.kind === "pane");
  assert.equal(recs.reduce((a, h) => a + (h.archive > 0 ? h.archive : 1), 0), n);
  assert.ok(recs.length <= K.albumCompactKeep + K.albumArchiveBatch + K.albumKeep + 64, `${recs.length} Album records`);
  const r = await albumRoster(engine.serialize(s), s.clock, "album-roster-1000");
  console.log(`# r3-02 1000 days: click ${r.click.toFixed(0)} ms, open step ${r.open.toFixed(0)} ms, roster-change steps ${r.steps.map((x) => x.toFixed(0)).join(",")} ms, ${r.rows} rows`);
  assert.ok(r.rows >= recs.length, `${r.rows} rows`);
  assert.ok(r.click + r.open < ROSTER_MS * 2, `open: click ${r.click.toFixed(0)} + step ${r.open.toFixed(0)} ms`);
  for (const ms of r.steps) assert.ok(ms < ROSTER_MS, `roster change with the Album open: ${ms.toFixed(0)} ms`);
});

test("r3-02/r3-04: a save from before archiving with 25,000 compact Album records archives on load and stays in budget with the Album open", { timeout: 300000 }, async () => {
  const { engine, s } = await churned(400, 20);
  const K = engine.CONTENT.K;
  // An older build's save: every archive entry written back out as the compact
  // records it stands for (fresh hex ids), so 25,000 gone pane records in all (near 1 MiB).
  const hs = s.helpers;
  for (const id of Object.keys(hs)) {
    const h = hs[id];
    if (!(h.archive > 0)) continue;
    delete hs[id];
    for (let k = 0; k < h.archive; k++) {
      const nid = engine.fnv1a32(`legacy#${id}#${k}`);
      if (hs[nid]) continue;
      hs[nid] = unpackedLike(engine, nid, h.missingSince - k * 60000);
    }
  }
  let have = Object.values(hs).filter((h) => h.gone && h.kind === "pane").length;
  for (let i = 0; have < 25000; i++) {
    const nid = engine.fnv1a32(`legacy-extra#${i}`);
    if (hs[nid]) continue;
    hs[nid] = unpackedLike(engine, nid, T00 - i * 60000);
    have++;
  }
  const before = Object.values(hs).filter((h) => h.gone && h.kind === "pane").length;
  assert.equal(before, 25000);
  const text = engine.serialize(s);
  assert.ok(text.length < 1024 * 1024, `${(text.length / 1024).toFixed(0)} KiB`);
  const r = await albumRoster(text, s.clock, "album-roster-legacy");
  console.log(`# r3-02 legacy 25,000: click ${r.click.toFixed(0)} ms, open step ${r.open.toFixed(0)} ms, roster-change steps ${r.steps.map((x) => x.toFixed(0)).join(",")} ms, ${r.rows} rows`);
  assert.ok(r.rows < before, `archived on load: ${r.rows} rows for ${before} records`);
  assert.ok(r.rows <= K.albumCompactKeep + K.albumKeep + 200, `${r.rows} rows`);
  for (const ms of r.steps) assert.ok(ms < ROSTER_MS, `roster change with the Album open: ${ms.toFixed(0)} ms`);
});

/** A compact Album record as unpackAlbum makes it (an older build's packed entry). */
function unpackedLike(engine, id, missingSince) {
  const look = engine.lookOf(id);
  return {
    id, kind: "pane", parent: null, species: look.species, hue: look.hue, name: look.name,
    joined: 0, status: "idle", lastTurn: 0, rest: 0, env: 0,
    stats: { tasks: 1, folds: 1234.5, run: 0, envelopes: 0, checkIns: 0 },
    missingSince: Math.floor(missingSince / 60000) * 60000, gone: true, compact: true,
  };
}

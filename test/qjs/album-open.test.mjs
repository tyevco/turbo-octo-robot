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

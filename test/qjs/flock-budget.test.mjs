// The Flock at big agent counts, in QuickJS (review r3-16). The per-group
// virtual-list switch (above 80 tiles in one group) let several groups just
// under 80 draw 300+ tiles a frame: 316 agents split 79 per status, or 130
// agents with 3 fledglings each, ran the panel render past herdr's 50 ms
// budget in the wasm harness. The Flock's tile grids now cost at most
// TILE_BUDGET across its groups (ui/flock.js tileCost; the biggest groups
// become virtual lists); these cases hold the render under the budget with
// the tile count bounded.
//
// Timing in a wasm interpreter under Node is noisy: one render in a few
// hundred can take twice its usual time when the host is busy (a GC pause, a
// descheduled thread). So each case gets up to ATTEMPTS runs of RENDERS
// renders with the 50 ms budget enforced, and passes on the first clean run
// with its p50 well inside the budget. A real overrun fails every run.
//
//   node --test test/qjs/flock-budget.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createHost } from "../../tools/qjs/harness.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MOD = join(repo, "mods", "creaseworks");
const HOME = "/home/player/.config/herdr-app";
const RENDERS = 24;
const ATTEMPTS = 3;
// Read from the module's source (this suite runs without the gpui import hook).
const TILE_BUDGET = Number(/export const TILE_BUDGET = (\d+);/.exec(readFileSync(join(MOD, "ui", "flock.js"), "utf8"))?.[1]);
assert.ok(TILE_BUDGET > 0 && TILE_BUDGET <= 1000, "ui/flock.js exports TILE_BUDGET");
// The cheapest tile (a plain dense one) costs 6.
const MAX_TILES = Math.floor(TILE_BUDGET / 6);

const EVEN = ["working", "idle", "blocked", "done"];
const MIXED = ["working", "idle", "blocked", "done", "working", "idle", "working"];

/** n pane agents cycling `statuses`, and kidsPer × n paneless fledglings spread over them. */
function roster(n, kidsPer, statuses, kidStatus) {
  const agents = [];
  const terminals = [];
  for (let i = 1; i <= n; i++) {
    const status = statuses[i % statuses.length];
    agents.push({
      address: `t${i}`, pane: `p${i}`, status, title: `agent ${i} · fix the flaky test`, space_name: ["api", "web", "docs"][i % 3],
      tab_name: `tab ${1 + (i % 4)}`, tab_index: 1 + (i % 4), focused: i === 1,
    });
    terminals.push({ address: `t${i}`, status: status === "done" ? "idle" : status, turn: status === "done" ? 1 : 0, created_ms: 1000 + i * 997 });
  }
  for (let j = 1; j <= Math.ceil(n * kidsPer); j++) {
    const parent = kidStatus ? `t${1 + (j % n)}` : `t${1 + ((j * 3) % n)}`;
    terminals.push({ address: `k${j}`, status: kidStatus ?? ["working", "done", "blocked", "idle"][j % 4], turn: 0, parent, created_ms: 5000 + j });
  }
  return { agents, terminals };
}

function count(tree, prefix) {
  let n = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.id === "string" && node.id.startsWith(prefix)) n++;
    for (const c of node.children ?? []) visit(c);
  };
  visit(tree);
  return n;
}

const CASES = [
  { name: "316 agents, 79 per status", n: 316, kids: 0.25, statuses: EVEN },
  { name: "130 agents, 3 fledglings each", n: 130, kids: 3, statuses: MIXED },
  { name: "130 agents, 3 fledglings each, even split", n: 130, kids: 3, statuses: EVEN },
  { name: "200 agents", n: 200, kids: 0.25, statuses: MIXED },
  { name: "80 working agents, each with a waiting fledgling", n: 80, kids: 1, statuses: ["working"], kidStatus: "blocked" },
  { name: "110 agents, 80 working", n: 110, kids: 0.25, statuses: [...Array(8).fill("working"), "blocked", "done", "idle"] },
];

/** One run: a fresh host, RENDERS renders at `size`; returns the timings, tile count and host errors. */
async function run(c, size) {
  const host = await createHost({
    modRoot: MOD,
    scenario: {
      appHome: HOME, home: "/home/player", props: { role: "panel" }, window: { visible: true, active: true, platform: "linux" },
      theme: "graphite", ...roster(c.n, c.kids, c.statuses, c.kidStatus),
    },
  });
  try {
    await host.load();
    host.advance(0);
    host.render();
    host.fire("root", "on_size_change", size);
    host.advance(1000);
    const ms = [];
    const overruns = [];
    let tiles = 0;
    for (let i = 0; i < RENDERS; i++) {
      if (i % 4 === 0) host.advance(1000);
      let r;
      try {
        r = host.render();
      } catch (error) {
        if (error && error.name === "BudgetError") {
          ms.push(error.ms);
          overruns.push(error);
          continue;
        }
        throw error;
      }
      ms.push(r.ms);
      tiles = Math.max(tiles, count(r.tree, "cw-flock-tile-"));
    }
    ms.sort((a, b) => a - b);
    return { tiles, errors: [...overruns, ...host.errors], p50: ms[Math.floor(ms.length / 2)], max: ms[ms.length - 1] };
  } finally {
    host.dispose();
  }
}

for (const c of CASES) {
  test(`${c.name}: the Flock's tile grids stay within TILE_BUDGET and render within the 50 ms budget (320 and 640 px)`, { timeout: 240000 }, async () => {
    for (const size of [{ width: 320, height: 784 }, { width: 640, height: 1400 }]) {
      const runs = [];
      let clean = null;
      for (let k = 0; k < ATTEMPTS && !clean; k++) {
        const r = await run(c, size);
        runs.push(r);
        // The tile bound is deterministic: it holds on every run.
        if (!c.kidStatus) assert.ok(r.tiles > 0, "the Flock still draws tiles");
        assert.ok(r.tiles <= MAX_TILES, `${r.tiles} tiles > ${MAX_TILES}`);
        assert.ok(r.p50 < 35, `render p50 ${r.p50.toFixed(1)} ms leaves under 15 ms of headroom`);
        if (r.errors.length === 0 && r.max < 50) clean = r;
      }
      const said = runs.map((r) => `p50 ${r.p50.toFixed(1)} max ${r.max.toFixed(1)}${r.errors.length ? ` (${r.errors.length} host errors)` : ""}`).join("; ");
      console.log(`# qjs flock ${c.name} @${size.width}: ${runs[0].tiles} tiles, render ${said}`);
      assert.ok(clean, `no run of ${ATTEMPTS} stayed within the 50 ms budget: ${said}; ${runs.at(-1).errors.map(String).join("; ")}`);
    }
  });
}

// The Flock at big agent counts, in QuickJS (review r3-16). The per-group
// virtual-list switch (above 80 tiles in one group) let several groups just
// under 80 draw 300+ tiles a frame: 316 agents split 79 per status, or 130
// agents with 3 fledglings each, ran the panel render past herdr's 50 ms
// budget in the wasm harness. The Flock now draws at most TILE_BUDGET tiles
// across its groups (the biggest groups become virtual lists); these cases
// hold the render under the budget with the tile count bounded.
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
// Read from the module's source (this suite runs without the gpui import hook).
const TILE_BUDGET = Number(/export const TILE_BUDGET = (\d+);/.exec(readFileSync(join(MOD, "ui", "flock.js"), "utf8"))?.[1]);
assert.ok(TILE_BUDGET > 0 && TILE_BUDGET <= 80, "ui/flock.js exports TILE_BUDGET");

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
];

for (const c of CASES) {
  test(`${c.name}: the Flock draws at most TILE_BUDGET tiles and renders within the 50 ms budget (320 and 640 px)`, { timeout: 120000 }, async () => {
    for (const size of [{ width: 320, height: 784 }, { width: 640, height: 1400 }]) {
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
        let tiles = 0;
        for (let i = 0; i < RENDERS; i++) {
          if (i % 4 === 0) host.advance(1000);
          const r = host.render();
          ms.push(r.ms);
          tiles = Math.max(tiles, count(r.tree, "cw-flock-tile-"));
        }
        assert.deepEqual(host.errors, [], "no BudgetError and no thrown render");
        ms.sort((a, b) => a - b);
        const p50 = ms[Math.floor(ms.length / 2)];
        const max = ms[ms.length - 1];
        console.log(`# qjs flock ${c.name} @${size.width}: ${tiles} tiles, render p50 ${p50.toFixed(1)} max ${max.toFixed(1)} ms`);
        if (!c.kidStatus) assert.ok(tiles > 0, "the Flock still draws tiles");
        assert.ok(tiles <= TILE_BUDGET, `${tiles} tiles > ${TILE_BUDGET}`);
        assert.ok(max < 50, `render max ${max.toFixed(1)} ms`);
        assert.ok(p50 < 35, `render p50 ${p50.toFixed(1)} ms leaves under 15 ms of headroom`);
      } finally {
        host.dispose();
      }
    }
  });
}

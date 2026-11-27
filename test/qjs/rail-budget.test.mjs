// The rail (the folded panel, DESIGN §3.9) at big agent counts, in QuickJS
// (review r8-10). Its pip grid drew one element per helper (id, tooltip,
// on_click and an svg child each), with no budget like the Flock's
// TILE_BUDGET or the ribbon's level-C tallies: in the wasm harness its render
// took ≈ 20 ms at 300 agents, ≈ 46 ms at 700 (some renders cut off) and every
// render was cut off at 1,000, so herdr would have frozen the rail under an
// error banner. The view now sends at most RAIL_PIPS pips (needs-you and
// finished first) and tallies for the rest, and the rail draws at most
// RAIL_PIP_MAX; these cases hold its render inside the 50 ms budget at the
// 64 px rail and the tight 146 px one (1100×700 with Files open).
//
// Timing in a wasm interpreter is noisy, so each case gets up to ATTEMPTS
// runs (as test/qjs/flock-budget.test.mjs).
//
//   node --test test/qjs/rail-budget.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createHost, RuntimeFreeError } from "../../tools/qjs/harness.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MOD = join(repo, "mods", "creaseworks");
const HOME = "/home/player/.config/herdr-app";
const RENDERS = 16;
const ATTEMPTS = 3;
// Read from the sources (this suite runs without the gpui import hook).
const RAIL_PIP_MAX = Number(/export const RAIL_PIP_MAX = (\d+);/.exec(readFileSync(join(MOD, "ui", "rail.js"), "utf8"))?.[1]);
const RAIL_PIPS = Number(/export const RAIL_PIPS = (\d+);/.exec(readFileSync(join(MOD, "engine", "view.js"), "utf8"))?.[1]);
assert.ok(RAIL_PIP_MAX > 0 && RAIL_PIP_MAX <= 300, "ui/rail.js exports RAIL_PIP_MAX");
assert.equal(RAIL_PIPS, RAIL_PIP_MAX, "the view's pip budget is the rail's");

const MIXED = ["working", "idle", "blocked", "done", "working", "idle", "working"];

/** n pane agents cycling `statuses`, and kidsPer × n paneless fledglings spread over them. */
function roster(n, kidsPer, statuses) {
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
    terminals.push({ address: `k${j}`, status: ["working", "done", "blocked", "idle"][j % 4], turn: 0, parent: `t${1 + ((j * 3) % n)}`, created_ms: 5000 + j });
  }
  return { agents, terminals };
}

function ids(tree, prefix) {
  const out = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.id === "string" && node.id.startsWith(prefix)) out.push(node);
    for (const c of node.children ?? []) visit(c);
  };
  visit(tree);
  return out;
}

const CASES = [
  { name: "130 agents (every helper a pip)", n: 130, kids: 0, tallies: false },
  { name: "300 agents", n: 300, kids: 0.25, tallies: true },
  { name: "700 agents", n: 700, kids: 0, tallies: true },
  { name: "1,000 agents with 500 fledglings", n: 1000, kids: 0.5, tallies: true },
];

/**
 * Teardown: clean, or exactly this wasm build's JS_FreeRuntime leak check (the
 * engine collector-timing fault of DESIGN R13 / test/qjs/creaseworks.test.mjs,
 * which large rosters can hit); anything else fails. The strict replay below
 * holds the collector back and must free cleanly.
 */
function disposeHost(host, strict) {
  try {
    host.dispose();
  } catch (e) {
    if (strict || e?.name !== RuntimeFreeError.name || e.gcObjList !== true) throw e;
  }
}

async function run(c, size, { gcHeadroom = 0 } = {}) {
  const host = await createHost({
    modRoot: MOD,
    scenario: {
      appHome: HOME, home: "/home/player", props: { role: "panel" }, window: { visible: true, active: true, platform: "linux" },
      theme: "graphite", ...roster(c.n, c.kids, MIXED),
    },
    gcHeadroom,
    enforceBudgets: gcHeadroom === 0,
  });
  let ok = false;
  try {
    await host.load();
    host.advance(0);
    host.render();
    host.fire("root", "on_size_change", size);
    host.advance(1000);
    const ms = [];
    const overruns = [];
    let pips = 0;
    let tallies = [];
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
      assert.equal(ids(r.tree, "cw-rail").length > 0, true, "the rail is drawn");
      pips = Math.max(pips, ids(r.tree, "cw-rail-pip-").length);
      tallies = ids(r.tree, "cw-rail-tally-").map((x) => x.id.slice("cw-rail-tally-".length));
    }
    ms.sort((a, b) => a - b);
    ok = true;
    return { pips, tallies, errors: [...overruns, ...host.errors], p50: ms[Math.floor(ms.length / 2)], max: ms[ms.length - 1] };
  } finally {
    if (ok) disposeHost(host, gcHeadroom > 0);
    else {
      try {
        host.dispose();
      } catch {
        // the failure above is the one to report
      }
    }
  }
}

for (const c of CASES) {
  test(`${c.name}: the rail draws at most RAIL_PIP_MAX pips and renders within the 50 ms budget (64 and 146 px)`, { timeout: 240000 }, async () => {
    const helpers = c.n + Math.ceil(c.n * c.kids);
    for (const size of [{ width: 64, height: 700 }, { width: 146, height: 700 }]) {
      const runs = [];
      let clean = null;
      for (let k = 0; k < ATTEMPTS && !clean; k++) {
        const r = await run(c, size);
        runs.push(r);
        assert.ok(r.pips > 0 && r.pips <= RAIL_PIP_MAX, `${r.pips} pips`);
        if (!c.tallies) {
          assert.equal(r.tallies.length, 0, "under the budget every helper is its own pip");
        } else {
          assert.ok(helpers > RAIL_PIP_MAX);
          assert.ok(r.tallies.includes("working") && r.tallies.includes("idle"), `tallies ${r.tallies}`);
        }
        assert.ok(r.p50 < 35, `render p50 ${r.p50.toFixed(1)} ms leaves under 15 ms of headroom`);
        if (r.errors.length === 0 && r.max < 50) clean = r;
      }
      const said = runs.map((r) => `p50 ${r.p50.toFixed(1)} max ${r.max.toFixed(1)}${r.errors.length ? ` (${r.errors.length} host errors)` : ""}`).join("; ");
      console.log(`# qjs rail ${c.name} @${size.width}: ${runs[0].pips} pips, tallies ${runs[0].tallies.join(",") || "none"}, render ${said}`);
      assert.ok(clean, `no run of ${ATTEMPTS} stayed within the 50 ms budget: ${said}; ${runs.at(-1).errors.map(String).join("; ")}`);
    }
  });
}

test("1,000 agents with 500 fledglings, the collector held back: the rail's VM frees cleanly (no handle kept alive)", { timeout: 120000 }, async () => {
  const r = await run(CASES.at(-1), { width: 64, height: 700 }, { gcHeadroom: 96 * 1024 * 1024 });
  assert.ok(r.pips > 0 && r.pips <= RAIL_PIP_MAX);
});


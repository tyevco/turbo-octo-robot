// A 15-minute save backlog in the QuickJS-ng harness (review r1-05;
// ARCHITECTURE A5; DESIGN §12.2, §12.5): every write fails for 15 virtual
// minutes while the player clicks (5 a second, 4500 actions) with 30 agents
// whose roster keeps changing; then the disk recovers and another window's
// save is found on it. The merge replays the whole backlog onto that file in
// cx.sleep(0) slices, so no task step reaches herdr's 500 ms budget, nothing
// is lost or counted twice, and saving goes on. The roster observations in
// the unconfirmed log coalesce, so it stays small.
//
// Run with: npm run test:qjs (about 30 s).

import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createHost } from "../../tools/qjs/harness.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MOD = join(repo, "mods", "creaseworks");
const HOME = "/home/player/.config/herdr-app";
const SAVE = `${HOME}/data/creaseworks/save.json`;
const SLOT = "globalThis[Symbol.for('creaseworks/live')]";
const STATUSES = ["working", "idle", "blocked", "done", "working", "idle", "working"];

/** 30 pane agents; `turn` bumps their turn counters and shifts their statuses (a roster change). */
function roster(n, turn = 0) {
  const agents = [];
  const terminals = [];
  for (let i = 1; i <= n; i++) {
    const status = STATUSES[(i + turn) % STATUSES.length];
    agents.push({ address: `t${i}`, pane: `p${i}`, status, title: `agent ${i}`, space_name: "api", tab_name: "tab 1", tab_index: 1, focused: i === 1 });
    terminals.push({ address: `t${i}`, status: status === "done" ? "idle" : status, turn, created_ms: 1000 + i * 997 });
  }
  return { agents, terminals };
}

test("a 15-minute backlog of failed saves merges within the 500 ms task budget", { timeout: 600000 }, async () => {
  const host = await createHost({
    modRoot: MOD,
    scenario: { appHome: HOME, home: "/home/player", props: { role: "panel" }, window: { visible: true, active: true, platform: "linux" }, theme: "graphite", ...roster(30) },
  });
  try {
    await host.load();
    host.advance(0);
    host.render();
    host.fire("root", "on_size_change", { width: 320, height: 784 });
    host.advance(1000);
    host.advance(20000);
    assert.ok(host.readFile(SAVE) !== null, "saved before the outage");
    // Every write fails for the next 15 minutes ("No space left on device"). The back-off
    // (10 s, 30 s, 60 s, then 5 min) tries about 6 times; 60 queued failures cover it.
    // (A queue of tens of thousands makes the wasm runtime fail to free on dispose.)
    host.evalInVm(`for (let i = 0; i < 60; i++) globalThis.__herdr.failNextWrite("No space left on device (os error 28)")`);
    host.render();
    let maxStep = 0;
    let maxPending = 0;
    let turn = 0;
    for (let s = 0; s < 900; s++) {
      for (let k = 0; k < 5; k++) host.fire("cw-sheet", "on_mouse_down", { local_position: { x: 56, y: 56 } });
      if (s % 20 === 0) {
        // the roster changes every 20 s: an observation of all 30 agents each time
        turn += 1;
        const r = roster(30, turn);
        host.evalInVm(`globalThis.__herdr.setAgents(${JSON.stringify(r.agents)}); globalThis.__herdr.setTerminals(${JSON.stringify(r.terminals)})`);
      }
      const r = host.advance(1000);
      for (const m of r.stepMs) maxStep = Math.max(maxStep, m);
      if (s % 100 === 0) maxPending = Math.max(maxPending, host.evalInVm(`${SLOT}.pending.length`));
    }
    const pending = host.evalInVm(`${SLOT}.pending.length`);
    const rosters = host.evalInVm(`${SLOT}.pending.filter((a) => a.type === "observe" && Array.isArray(a.helpers)).length`);
    console.log(`# backlog: ${pending} unconfirmed actions (${rosters} roster observations), status ${host.evalInVm(`${SLOT}.save.status`)}, max step ${maxStep.toFixed(1)} ms`);
    assert.equal(host.evalInVm(`${SLOT}.save.status`), "error", "the outage is shown");
    assert.ok(pending >= 4500, "every click waits for a save");
    // 45 roster changes: those before the log reached COALESCE_AT (512) stay, later ones replace each other.
    assert.ok(turn === 45 && rosters <= 8, `roster observations coalesce (${rosters} of ${turn})`);
    const seq = host.evalInVm(`${SLOT}.seq`);
    const writer = host.evalInVm(`${SLOT}.writerId`);

    // The disk recovers, and another window's save (a different text) is on it.
    host.evalInVm("globalThis.__herdr.failQueue.length = 0");
    const before = JSON.parse(host.readFile(SAVE));
    host.writeFile(SAVE, JSON.stringify(before, null, 1));
    host.evalInVm(`${SLOT}.save.retryAt = 0`);
    let mergeMax = 0;
    for (let k = 0; k < 30; k++) {
      const r = host.advance(1000);
      for (const m of r.stepMs) mergeMax = Math.max(mergeMax, m);
    }
    console.log(`# merge of the backlog: max task step ${mergeMax.toFixed(1)} ms`);
    assert.deepEqual(host.errors, [], "no budget error, no task error");
    assert.ok(mergeMax < 250, `every slice well inside 500 ms (${mergeMax.toFixed(1)} ms)`);
    assert.equal(host.evalInVm(`${SLOT}.save.status`), "ok");
    assert.equal(host.evalInVm(`${SLOT}.save.writing`), null);
    assert.equal(host.evalInVm(`${SLOT}.pending.length`), 0);
    const disk = JSON.parse(host.readFile(SAVE));
    assert.ok(disk.state.applied[writer] >= seq, "the whole backlog reached the disk");
    assert.ok(maxPending <= 4600, `bounded log (${maxPending})`);
  } finally {
    host.dispose();
  }
});

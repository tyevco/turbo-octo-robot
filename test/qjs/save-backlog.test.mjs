// A 15-minute save backlog in the QuickJS-ng harness (review r1-05;
// ARCHITECTURE A5; DESIGN §12.2, §12.5): every write fails for 15 virtual
// minutes while the player clicks (5 a second, 4500 actions) with 30 agents
// whose roster keeps changing; then the disk recovers and another window's
// save is found on it. The merge replays the whole backlog onto that file in
// cx.sleep(0) slices, so no task step reaches herdr's 500 ms budget, nothing
// is lost or counted twice (every finished task and reward unit of the live
// game is in the merged one), and saving goes on. Observations that change
// only titles coalesce in the unconfirmed log; every one that moves a turn
// counter stays (the engine pays one finish per observation).
//
// Every teardown is judged (r4-17, DESIGN R13): see backlog() below.
//
// Run with: npm run test:qjs (about 60 s: the run again with the collector held back).
// The last test times a save write step at 900 KiB-1 MiB (r6-16).

import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createHost, RuntimeFreeError } from "../../tools/qjs/harness.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MOD = join(repo, "mods", "creaseworks");
const HOME = "/home/player/.config/herdr-app";
const SAVE = `${HOME}/data/creaseworks/save.json`;
const SLOT = "globalThis[Symbol.for('creaseworks/live')]";
const STATUSES = ["working", "idle", "blocked", "done", "working", "idle", "working"];

/** 30 pane agents; `turn` bumps their turn counters and shifts their statuses (a roster change); `tag` changes only titles. */
function roster(n, turn = 0, tag = 0) {
  const agents = [];
  const terminals = [];
  for (let i = 1; i <= n; i++) {
    const status = STATUSES[(i + turn) % STATUSES.length];
    agents.push({ address: `t${i}`, pane: `p${i}`, status, title: `agent ${i} · ${tag}`, space_name: "api", tab_name: "tab 1", tab_index: 1, focused: i === 1 });
    terminals.push({ address: `t${i}`, status: status === "done" ? "idle" : status, turn, created_ms: 1000 + i * 997 });
  }
  return { agents, terminals };
}

// Teardown (DESIGN R13, review r4-17): this wasm build's JS_FreeRuntime leak
// check fires both for a leaked VM handle and for an engine fault that depends
// only on when the collector runs. The run as the engine runs must free
// cleanly or fail with exactly that check (nothing else); the same run with
// the collector held back (gcHeadroom: only WHEN garbage is collected
// changes) must free cleanly, which a leaked handle cannot.
const HEADROOM = 96 * 1024 * 1024;

/** The outage, the backlog and the merge; returns the dispose error (null when freed cleanly). */
async function backlog(gcHeadroom = 0) {
  const host = await createHost({
    modRoot: MOD,
    scenario: { appHome: HOME, home: "/home/player", props: { role: "panel" }, window: { visible: true, active: true, platform: "linux" }, theme: "graphite", ...roster(30) },
    gcHeadroom,
  });
  let leak = null;
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
    let titles = 0;
    for (let s = 0; s < 900; s++) {
      for (let k = 0; k < 5; k++) host.fire("cw-sheet", "on_mouse_down", { local_position: { x: 56, y: 56 } });
      if (s % 5 === 0) {
        // the roster changes every 20 s (every agent finishes a turn); in between titles change every 5 s
        if (s % 20 === 0) turn += 1;
        else titles += 1;
        const r = roster(30, turn, s);
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
    // 45 turn changes all stay; of the 135 title-only changes about one per 20 s stays.
    assert.equal(turn, 45);
    assert.ok(rosters >= turn && rosters <= 2 * turn + 25, `title-only observations coalesce, turn changes stay (${rosters} of ${turn + titles + 1})`);
    const seq = host.evalInVm(`${SLOT}.seq`);
    const writer = host.evalInVm(`${SLOT}.writerId`);
    const rewards = (st) => JSON.stringify({ tasks: st.stats.tasks, units: st.stats.units });
    const live = host.evalInVm(`JSON.stringify({ tasks: ${SLOT}.state.stats.tasks, units: ${SLOT}.state.stats.units })`);
    assert.ok(JSON.parse(live).tasks >= 30 * 40, `the agents finished tasks (${live})`);

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
    assert.equal(rewards(disk.state), live, "every finished task and reward unit of the live game is in the merged save");
    assert.equal(host.evalInVm(`JSON.stringify({ tasks: ${SLOT}.state.stats.tasks, units: ${SLOT}.state.stats.units })`), live, "and in memory: no rollback");
    assert.ok(maxPending <= 4500 + 2 * turn + 25, `bounded log (${maxPending})`);
  } finally {
    // Never swallowed (r4-17): a failure above propagates as it is; a clean run returns its teardown.
    try {
      host.dispose();
    } catch (e) {
      leak = e;
    }
  }
  return { leak, headroom: host.headroom };
}

test("a 15-minute backlog of failed saves merges within the 500 ms task budget", { timeout: 600000 }, async () => {
  const { leak } = await backlog();
  if (leak === null) return console.log("# backlog teardown as the engine runs: freed cleanly");
  assert.ok(leak instanceof RuntimeFreeError, `dispose failed in another way: ${leak?.stack ?? leak}`);
  assert.equal(leak.gcObjList, true, `not the JS_FreeRuntime leak check: ${leak.message}`);
  console.log("# backlog teardown as the engine runs: JS_FreeRuntime leak check (engine collector timing; the held-back replay decides)");
});

test("the backlog run frees the QuickJS runtime cleanly with the engine's collector held back (R13, r4-17)", { timeout: 600000 }, async () => {
  const { leak, headroom } = await backlog(HEADROOM);
  assert.equal(headroom.length, 1, "one VM booted with the headroom");
  assert.ok(headroom[0].peak >= HEADROOM, "the headroom was reached");
  if (leak) throw leak;
});

// r6-16: the work of one save write at the biggest saves herdr can take, in
// QuickJS-ng. A save cycle's write step serialises the state and measures it
// (store.js oversize) before writeTextFile, all in one task step of its own;
// here that step's work runs on rosters that make an 893 KiB save (1,300
// helpers present with long CJK titles) and a 1,036 KiB one (300 agents with
// 4 fledglings each), which oversize stops before herdr is asked. Both stay
// inside herdr's 500 ms budget (the first serialisation after an observation,
// about 200-250 ms here, is the engine's share; the measure adds about 15 ms),
// and the measure agrees with Node's UTF-8 byte count.
test("r6-16: serialising and measuring a 900 KiB-1 MiB save stays inside the 500 ms task budget", { timeout: 120000 }, async () => {
  const host = await createHost({
    modRoot: MOD,
    scenario: { appHome: HOME, home: "/home/player", props: { role: "ribbon" }, window: { visible: true, active: true, platform: "linux" }, theme: "graphite" },
    gcHeadroom: HEADROOM,
  });
  try {
    await host.load();
    const title = "codex · 支払い照合サービスをリファクタリングして不安定な統合テストを修正する作業を続けています";
    for (const [n, kids, minKiB] of [[1300, 0, 850], [300, 4, 1025]]) {
      // The state, built in the VM by the engine (untimed): one observation with every helper present.
      host.evalInVm(
        `import { newGame, apply } from "./engine/index.js";
        const s = newGame({ seed: 13, now: 1767441600000, day: "2026-01-03" });
        const roster = [];
        for (let i = 0; i < ${n}; i++) {
          const p = { addr: "w1:t" + i, created: s.clock + i, status: "working", raw: "working", turn: 0, parent: null, pane: "p" + i, title: ${JSON.stringify(title)}, paneName: "", space: "支払いチーム", tab: "統合テスト", kind: "pane" };
          roster.push(p);
          for (let k = 0; k < ${kids}; k++) roster.push({ ...p, addr: "w1:k" + i + "_" + k, pane: null, parent: p.addr, kind: "kid" });
        }
        apply(s, { w: "w", s: 1, t: s.clock + 1000, type: "observe", helpers: roster, visible: true, active: true, matShown: true, day: s.day });
        globalThis.__big = s;
        export const ok = true;`,
        { module: true, name: `${MOD}/r6-16-state-${n}.js?v=1` },
      );
      // Each write step as the store runs it: serialise, then measure (timed apart, 3 times;
      // the first serialisation after an observation is the slowest: the engine's caches are cold).
      let worstSer = 0;
      let worstMeasure = 0;
      let big = null;
      for (let k = 0; k < 3; k++) {
        host.evalInVm(`import { serialize } from "./engine/index.js"; globalThis.__text = serialize(globalThis.__big); export const ok = true;`, { module: true, name: `${MOD}/r6-16-ser-${n}-${k}.js?v=1` });
        worstSer = Math.max(worstSer, host.lastMs().detached);
        big = host.evalInVm(`import { oversize } from "./glue/store.js"; export const big = oversize(globalThis.__text);`, { module: true, name: `${MOD}/r6-16-measure-${n}-${k}.js?v=1` }).big;
        worstMeasure = Math.max(worstMeasure, host.lastMs().detached);
      }
      const bytes = Buffer.byteLength(host.evalInVm("globalThis.__text"), "utf8");
      console.log(`# r6-16: ${n} agents × ${kids + 1}: ${(bytes / 1024).toFixed(0)} KiB, serialise ${worstSer.toFixed(1)} ms + measure ${worstMeasure.toFixed(1)} ms (worst of 3)`);
      assert.ok(bytes >= minKiB * 1024, `a save of that size (${bytes} bytes)`);
      assert.equal(big, bytes > 1024 * 1024 ? bytes : 0, "the measure is the UTF-8 byte count");
      assert.ok(worstMeasure < 60, `the size check adds little to the write step (${worstMeasure.toFixed(1)} ms)`);
      assert.ok(worstSer + worstMeasure < 400, `the write step's work stays inside 500 ms (${(worstSer + worstMeasure).toFixed(1)} ms)`);
    }
    host.evalInVm("delete globalThis.__big; delete globalThis.__text");
  } finally {
    host.dispose();
  }
});

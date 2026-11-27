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

// r6-16: the work of one save write at the biggest saves the engine writes,
// in QuickJS-ng. Since save format 5 (DESIGN R13) present helpers are packed,
// so the biggest save (just under K.saveBudget, about 880 KiB) holds far more
// helpers than before: 2,500 agents with 4 sub-agents each with long CJK
// titles here (12,500 present helpers), whose one-step serialisation passes
// herdr's 500 ms budget. The store serialises such a state in steps
// (engine serializeSteps, store.js serializeIn), and measures the text in the
// last one (store.js oversize) before writeTextFile: every step, and the
// write step (the last step and the measure), stay far inside the budget,
// and the measure agrees with Node's UTF-8 byte count.
test("r6-16: serialising and measuring the biggest save the engine writes stays inside the 500 ms task budget, step by step", { timeout: 120000 }, async () => {
  const host = await createHost({
    modRoot: MOD,
    scenario: { appHome: HOME, home: "/home/player", props: { role: "ribbon" }, window: { visible: true, active: true, platform: "linux" }, theme: "graphite" },
    gcHeadroom: HEADROOM,
  });
  try {
    await host.load();
    const title = "codex · 支払い照合サービスをリファクタリングして不安定な統合テストを修正する作業を続けています";
    for (const [n, kids, minKiB] of [[2500, 4, 850]]) {
      // The state, built in the VM by the engine (untimed): one observation with every helper present.
      host.evalInVm(
        `import { newGame, apply } from "./engine/index.js";
        const s = newGame({ seed: 13, now: 1767441600000, day: "2026-01-03" });
        const roster = [];
        for (let i = 0; i < ${n}; i++) {
          const p = { addr: "w1:t" + i, created: s.clock + i, status: "working", raw: "working", turn: 0, parent: null, pane: "p" + i, title: ${JSON.stringify(title)} + i, paneName: "", space: "支払いチーム", tab: "統合テスト", kind: "pane" };
          roster.push(p);
          for (let k = 0; k < ${kids}; k++) roster.push({ ...p, addr: "w1:k" + i + "_" + k, pane: null, parent: p.addr, kind: "kid", title: p.title + "/" + k });
        }
        apply(s, { w: "w", s: 1, t: s.clock + 1000, type: "observe", helpers: roster, visible: true, active: true, matShown: true, day: s.day });
        globalThis.__big = s;
        export const ok = true;`,
        { module: true, name: `${MOD}/r6-16-state-${n}.js?v=1` },
      );
      // Each write as the store runs it: the serialisation's steps, then the measure in the last (3 times).
      let worstStep = 0;
      let worstWrite = 0;
      let big = null;
      for (let k = 0; k < 3; k++) {
        host.evalInVm(`import { serializeSteps } from "./engine/index.js"; globalThis.__it = serializeSteps(globalThis.__big); export const ok = true;`, { module: true, name: `${MOD}/r6-16-ser-${n}-${k}.js?v=1` });
        let last = 0;
        for (let j = 0; ; j++) {
          const done = host.evalInVm(`globalThis.__r = globalThis.__it.next(); if (globalThis.__r.done) globalThis.__text = globalThis.__r.value; export const done = globalThis.__r.done;`, { module: true, name: `${MOD}/r6-16-step-${n}-${k}-${j}.js?v=1` }).done;
          last = host.lastMs().detached;
          worstStep = Math.max(worstStep, last);
          if (done) break;
        }
        big = host.evalInVm(`import { oversize } from "./glue/store.js"; export const big = oversize(globalThis.__text);`, { module: true, name: `${MOD}/r6-16-measure-${n}-${k}.js?v=1` }).big;
        worstWrite = Math.max(worstWrite, last + host.lastMs().detached);
      }
      const bytes = Buffer.byteLength(host.evalInVm("globalThis.__text"), "utf8");
      console.log(`# r6-16: ${n} agents × ${kids + 1}: ${(bytes / 1024).toFixed(0)} KiB, slowest serialise step ${worstStep.toFixed(1)} ms, write step ${worstWrite.toFixed(1)} ms (worst of 3)`);
      assert.ok(bytes >= minKiB * 1024, `a save of that size (${bytes} bytes)`);
      assert.equal(big, bytes > 1024 * 1024 ? bytes : 0, "the measure is the UTF-8 byte count");
      assert.ok(worstStep < 400, `every step of the write stays inside 500 ms (${worstStep.toFixed(1)} ms)`);
      assert.ok(worstWrite < 400, `the write step's work stays inside 500 ms (${worstWrite.toFixed(1)} ms)`);
    }
    // A save over the limit in UTF-16 units alone (2,000+ helpers) is measured
    // exactly too, so the KiB said is its real size: the measure of a text of
    // 2.1 million units (about 3.2 MiB, a third of it CJK titles) still adds
    // little to the step (about 55 ms here).
    host.evalInVm(`globalThis.__text = "x".repeat(1400000) + ${JSON.stringify(title)}.repeat(14000); export const ok = true;`, { module: true, name: `${MOD}/r6-16-long.js?v=1` });
    const long = host.evalInVm("globalThis.__text");
    let worst = 0;
    let got = null;
    for (let k = 0; k < 3; k++) {
      got = host.evalInVm(`import { oversize } from "./glue/store.js"; export const big = oversize(globalThis.__text);`, { module: true, name: `${MOD}/r6-16-long-measure-${k}.js?v=1` }).big;
      worst = Math.max(worst, host.lastMs().detached);
    }
    console.log(`# r6-16: ${long.length} units, ${(Buffer.byteLength(long, "utf8") / 1024).toFixed(0)} KiB: measure ${worst.toFixed(1)} ms (worst of 3)`);
    assert.ok(long.length > 1024 * 1024);
    assert.equal(got, Buffer.byteLength(long, "utf8"), "the exact UTF-8 byte count, not the length");
    assert.ok(worst < 100, `measuring a 3 MiB save stays small (${worst.toFixed(1)} ms)`);
    host.evalInVm("delete globalThis.__big; delete globalThis.__text; delete globalThis.__it; delete globalThis.__r");
  } finally {
    host.dispose();
  }
});

// r8-06: a state just under store.js STEP_SAVE_HELPERS is serialised in one
// task step (serializeIn), with the size check after it. That step must be no
// larger than a stepped write's: at the old threshold (3,000) one such step
// took 260-340 ms in this harness, most of herdr's 500 ms budget. Long CJK
// titles, 3 sub-agents per agent, a fresh state each time (nothing cached).
test("r8-06: the one-step serialisation just under STEP_SAVE_HELPERS stays well inside the 500 ms task budget", { timeout: 180000 }, async () => {
  const host = await createHost({
    modRoot: MOD,
    scenario: { appHome: HOME, home: "/home/player", props: { role: "ribbon" }, window: { visible: true, active: true, platform: "linux" }, theme: "graphite" },
    gcHeadroom: HEADROOM,
  });
  try {
    await host.load();
    const title = "codex · 支払い照合サービスをリファクタリングして不安定な統合テストを修正する作業を続けています";
    const STEP = host.evalInVm(`import { STEP_SAVE_HELPERS } from "./glue/store.js"; export const n = STEP_SAVE_HELPERS;`, { module: true, name: `${MOD}/r8-06-k.js?v=1` }).n;
    let worst = 0;
    for (let k = 0; k < 3; k++) {
      const n = host.evalInVm(
        `import { newGame, apply } from "./engine/index.js";
        const s = newGame({ seed: 13 + ${k}, now: 1767441600000, day: "2026-01-03" });
        const roster = [];
        for (let i = 0; roster.length < ${STEP - 1}; i++) {
          const p = { addr: "w1:t" + i, created: s.clock + i, status: "working", raw: "working", turn: 0, parent: null, pane: "p" + i, title: ${JSON.stringify(title)} + i + "·${k}", paneName: "", space: "支払いチーム", tab: "統合テスト", kind: "pane" };
          roster.push(p);
          for (let j = 0; j < 3 && roster.length < ${STEP - 1}; j++) roster.push({ ...p, addr: "w1:k" + i + "_" + j, pane: null, parent: p.addr, kind: "kid", title: p.title + "/" + j });
        }
        apply(s, { w: "w", s: 1, t: s.clock + 1000, type: "observe", helpers: roster, visible: true, active: true, matShown: true, day: s.day });
        globalThis.__one = s;
        export const n = Object.keys(s.helpers).length;`,
        { module: true, name: `${MOD}/r8-06-state-${k}.js?v=1` },
      ).n;
      assert.equal(n, STEP - 1, "just under the threshold: serialised in one step");
      host.evalInVm(`import { serialize } from "./engine/index.js"; import { oversize } from "./glue/store.js"; export const big = oversize(serialize(globalThis.__one));`, { module: true, name: `${MOD}/r8-06-ser-${k}.js?v=1` });
      worst = Math.max(worst, host.lastMs().detached);
    }
    console.log(`# r8-06: ${STEP - 1} helpers serialised and measured in one step: ${worst.toFixed(1)} ms (worst of 3)`);
    assert.ok(worst < 250, `the one-step write stays at most half the 500 ms budget (${worst.toFixed(1)} ms)`);
    host.evalInVm("delete globalThis.__one");
  } finally {
    host.dispose();
  }
});

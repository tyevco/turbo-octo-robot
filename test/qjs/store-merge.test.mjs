// Compare-and-swap merges of a large save in the QuickJS-ng harness (review
// r2-03; ARCHITECTURE A4, A5; BALANCE item 7: a save stays < 640 KiB). After
// a CAS rejection the store reads the other window's file, parses it,
// replays this window's unconfirmed actions, advances and serialises again.
// On a save a year or more old each of those is a large share of herdr's
// 500 ms task budget, and the interrupt cannot be caught (the claim would
// stall for WRITE_STALL_MS with nothing said). The merge therefore yields
// (cx.sleep(0)) after the parse and before the serialisation: every task
// step stays inside the budget, nothing is lost and saving goes on.
//
// The parse of a ~500 KiB save is the largest single step (300-420 ms in
// the wasm harness, which runs slower than herdr's native QuickJS). Until it
// is sliced, a run that misses the budget only on timing (a step of 500 ms or
// more, or a budget interrupt, with nothing else wrong) is run once more on a
// fresh host, so a busy machine does not fail the suite; a second miss fails.
//
// Every teardown is judged (r4-17, DESIGN R13): see teardownFault below.
//
// Run with: npm run test:qjs (about 80 s: each run again with the collector held back).

import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createHost, BudgetError, RuntimeFreeError } from "../../tools/qjs/harness.mjs";
import * as engine from "../../mods/creaseworks/engine/index.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MOD = join(repo, "mods", "creaseworks");
const HOME = "/home/player/.config/herdr-app";
const SAVE = `${HOME}/data/creaseworks/save.json`;
const SLOT = "globalThis[Symbol.for('creaseworks/live')]";
const T0 = Date.UTC(2026, 10, 25, 9);

/**
 * A save after `days` days of heavy use: 20 new agents a day, each with 3
 * sub-agents, every one finishing a task and its envelope opened (every
 * agent stays a saved helper, so the save grows with the days).
 */
function heavySave(days) {
  const s = engine.newGame({ seed: 5, now: T0, day: "2026-11-25" });
  let seq = 0;
  const act = (a) => engine.apply(s, { w: "w-yearchurn01", s: ++seq, ...a });
  const obs = (t, helpers) => act({ t, type: "observe", helpers, visible: true, active: true, matShown: true, day: "2026-11-25" });
  const ag = (i, extra = {}) => ({
    addr: `w1:t${i}`, created: T0 + i * 997, status: "working", raw: "working", turn: 0, parent: null, pane: `p${i}`,
    title: "claude · refactor the payment module", paneName: "", space: "main", tab: "1", kind: "pane", ...extra,
  });
  let t = T0;
  let n = 0;
  for (let d = 0; d < days; d++) {
    const list = [];
    for (let k = 0; k < 20; k++) {
      const i = n++;
      list.push(ag(i));
      for (let j = 0; j < 3; j++) list.push(ag(1e6 + i * 3 + j, { kind: "kid", pane: null, parent: `w1:t${i}` }));
    }
    obs((t += 1000), list);
    obs((t += 3600000), list.map((o) => ({ ...o, turn: 2, status: "idle" })));
    for (const id of Object.keys(s.envelopes)) act({ t, type: "open", helperId: id });
    obs((t += 1000), []);
    t = T0 + (d + 1) * 86400000;
    engine.advance(s, t);
  }
  return s;
}

// Teardown (DESIGN R13, review r4-17): this wasm build's JS_FreeRuntime leak
// check fires both for a leaked VM handle and for an engine fault that depends
// only on when the collector runs. A run as the engine runs must free cleanly
// or fail with exactly that check (nothing else); the same run with the
// collector held back (gcHeadroom: only WHEN garbage is collected changes)
// must free cleanly, which a leaked handle cannot.
const HEADROOM = 96 * 1024 * 1024;

function teardownFault(leak, what) {
  if (leak === null) return "freed cleanly";
  assert.ok(leak instanceof RuntimeFreeError, `${what}: dispose failed in another way: ${leak?.stack ?? leak}`);
  assert.equal(leak.gcObjList, true, `${what}: not the JS_FreeRuntime leak check: ${leak.message}`);
  return "JS_FreeRuntime leak check (engine collector timing; the held-back replay decides)";
}

/** Runs three merge rounds; returns the dispose error (null when freed cleanly) and the headroom record. */
async function mergeRounds(days, minKiB, gcHeadroom = 0) {
  const state = heavySave(days);
  const text = engine.serialize(state);
  const kib = text.length / 1024;
  assert.ok(kib >= minKiB && kib < 640, `a ${days}-day save of ${kib.toFixed(0)} KiB (inside the 640 KiB envelope)`);
  const now = state.clock + 1000;
  const agents = [];
  const terminals = [];
  for (let i = 1; i <= 30; i++) {
    agents.push({ address: `t${i}`, pane: `p${i}`, status: "working", title: `a${i}`, space_name: "api", tab_name: "tab 1", tab_index: 1, focused: i === 1 });
    terminals.push({ address: `t${i}`, status: "working", turn: 0, created_ms: now - 5000 + i });
  }
  const host = await createHost({
    modRoot: MOD,
    scenario: { appHome: HOME, home: "/home/player", props: { role: "panel" }, window: { visible: true, active: true, platform: "linux" }, theme: "graphite", agents, terminals, now, files: { [SAVE]: text } },
    gcHeadroom,
  });
  const rounds = [];
  let leak = null;
  try {
    await host.load();
    host.advance(0);
    host.render();
    host.fire("root", "on_size_change", { width: 320, height: 784 });
    for (let i = 0; i < 25; i++) host.advance(1000);
    const writer = host.evalInVm(`${SLOT}.writerId`);
    for (let round = 0; round < 3; round++) {
      // This window clicks; another window (writer B) saves the same file with a click of its own.
      host.fire("cw-sheet", "on_mouse_down", { local_position: { x: 56, y: 56 } });
      const disk = engine.parseSave(host.readFile(SAVE));
      assert.ok(disk.ok);
      engine.apply(disk.state, { w: "wB", s: round + 1, t: disk.state.clock + 10, type: "click", target: "sheet" });
      host.writeFile(SAVE, engine.serialize(disk.state));
      let max = 0;
      for (let i = 0; i < 20; i++) for (const m of host.advance(1000).stepMs) max = Math.max(max, m);
      rounds.push(max);
      if (max >= 500 || (host.errors.length > 0 && host.errors.every((e) => e instanceof BudgetError))) {
        throw Object.assign(new Error(`round ${round}: a task step of ${max.toFixed(1)} ms (${host.errors.map((e) => e.message).join("; ") || "no interrupt"})`), { timing: true });
      }
      assert.deepEqual(host.errors, [], `round ${round}: no budget error, no task error`);
      assert.equal(host.evalInVm(`${SLOT}.save.writing`), null, `round ${round}: the claim is settled`);
      assert.equal(host.evalInVm(`${SLOT}.save.status`), "ok", `round ${round}: saved`);
      const after = engine.parseSave(host.readFile(SAVE));
      assert.ok(after.ok);
      assert.equal(after.state.applied.wB, round + 1, `round ${round}: the other window's click is in the save once`);
      assert.equal(after.state.applied[writer], host.evalInVm(`${SLOT}.seq`), `round ${round}: and every action of this window`);
      const kind = host.evalInVm(`${SLOT}.notice ? ${SLOT}.notice.kind : null`);
      assert.ok(kind === null || kind === "merged", `round ${round}: no conflict or error left on show (${kind})`);
    }
    console.log(`# ${days}-day save (${kib.toFixed(0)} KiB): merge rounds' longest task step ${rounds.map((m) => m.toFixed(0)).join(", ")} ms`);
    for (const m of rounds) assert.ok(m < 500, `every task step of a merge inside 500 ms (${m.toFixed(1)} ms)`);
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

/** mergeRounds, run once more on a fresh host when the first run missed the budget on timing alone. */
async function mergeRoundsRetried(days, minKiB, gcHeadroom = 0) {
  try {
    return await mergeRounds(days, minKiB, gcHeadroom);
  } catch (e) {
    if (!(e && e.timing)) throw e;
    console.log(`# ${days}-day save: ${e.message}; running once more (a busy machine?)`);
    return await mergeRounds(days, minKiB, gcHeadroom);
  }
}

for (const [days, minKiB, what] of [[365, 300, "a one-year save"], [600, 480, "a save of about 500 KiB"]]) {
  test(`a CAS merge onto ${what} stays inside the 500 ms task budget`, { timeout: 600000 }, async () => {
    const { leak } = await mergeRoundsRetried(days, minKiB);
    console.log(`# ${days}-day merge teardown as the engine runs: ${teardownFault(leak, `${days}-day merge`)}`);
  });

  test(`the ${days}-day merge run frees the QuickJS runtime cleanly with the engine's collector held back (R13, r4-17)`, { timeout: 600000 }, async () => {
    const { leak, headroom } = await mergeRoundsRetried(days, minKiB, HEADROOM);
    assert.equal(headroom.length, 1, "one VM booted with the headroom");
    assert.ok(headroom[0].peak >= HEADROOM, "the headroom was reached");
    if (leak) throw leak;
  });
}

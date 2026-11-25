// The load of a large save in the QuickJS-ng harness (review r3-01;
// ARCHITECTURE A4; DESIGN R13). The session hands the store its load task's
// cx.sleep, so every parse step of a save of 64 KiB or more, and each of the
// two parses of a recovery (the backup beside a damaged save.json, or the
// recovery file and the backup beside an unreadable one), runs in a task step
// of its own. Before, the whole parse ran in one step: 314-512 ms for a
// two-year save, and past 500 ms herdr's uncatchable interrupt left the game
// on "Opening the workshop…" for good, with no notice.
//
// Run with: npm run test:qjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MOD = join(repo, "mods", "creaseworks");
const HOME = "/home/player/.config/herdr-app";
const DIR = `${HOME}/data/creaseworks`;
const SAVE = `${DIR}/save.json`;
const BAK = `${DIR}/save.bak.json`;
const RECOVERY = `${DIR}/save.recovery.json`;
const SLOT = "globalThis[Symbol.for('creaseworks/live')]";
const T0 = Date.UTC(2026, 10, 25, 9);
/** A load step this long is a large share of herdr's 500 ms task budget (the whole parse in one step took 314-512 ms). */
const STEP_MAX = 250;

/** `days` days of 20 agents a day, each with 3 sub-agents, every one run once and gone. */
async function heavySave(days) {
  const engine = await import("../../mods/creaseworks/engine/index.js");
  const s = engine.newGame({ seed: 5, now: T0, day: "2026-11-25" });
  let seq = 0;
  const act = (a) => engine.apply(s, { w: "w-loadsteps01", s: ++seq, ...a });
  const obs = (t, helpers) => act({ t, type: "observe", helpers, visible: true, active: true, matShown: true, day: "2026-11-25" });
  const ag = (i, extra = {}) => ({
    addr: `w1:t${i}`, created: T0 + i * 997, status: "working", raw: "working", turn: 0, parent: null,
    pane: `p${i}`, title: "claude · refactor the payment module", paneName: "", space: "main", tab: "1", kind: "pane", ...extra,
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
  return { text: engine.serialize(s), clock: s.clock };
}

/**
 * Loads `files` in a fresh host and runs the load's task steps only
 * (advance(0): every load step is due now; the first tick, and with it the
 * first save, is 1 s away). Returns the step times and what the slot holds.
 */
async function loadIn(files, clock, before = null) {
  const { createHost } = await import("../../tools/qjs/harness.mjs?load-steps");
  const host = await createHost({
    modRoot: MOD,
    scenario: {
      appHome: HOME, home: "/home/player", props: { role: "panel" }, window: { visible: true, active: true, platform: "linux" },
      theme: "graphite", agents: [], terminals: [], now: clock + 1000, files,
    },
  });
  try {
    await host.load();
    if (before) before(host);
    const r = host.advance(0); // an overrun throws a BudgetError
    const slot = host.evalInVm(`JSON.stringify({ loading: ${SLOT}.loading, loaded: !!${SLOT}.state, notice: ${SLOT}.notice, damaged: ${SLOT}.save.damaged })`);
    const first = host.render(); // the first render after the load (r3-03: it reads the vm the load task built)
    return { steps: r.stepMs, max: Math.max(...r.stepMs), slot: JSON.parse(slot), renderMs: first.ms, errors: host.errors };
  } finally {
    try {
      host.dispose();
    } catch (e) {
      // The wasm runtime sometimes cannot free a heap this size (a harness limit, not the mod's;
      // the same JS_FreeRuntime TODO as test/qjs/harness.test.mjs and save-backlog.test.mjs).
      if (!/could not be freed cleanly/.test(String(e && e.message))) throw e;
    }
  }
}

test("a large save loads across many task steps, none near the 500 ms budget", { timeout: 300000 }, async () => {
  const { text, clock } = await heavySave(450);
  assert.ok(text.length >= 300 * 1024, `${Math.round(text.length / 1024)} KiB`);
  const r = await loadIn({ [SAVE]: text }, clock);
  console.log(`# ${Math.round(text.length / 1024)} KiB: ${r.steps.length} load steps, max ${r.max.toFixed(1)} ms; first render ${r.renderMs.toFixed(1)} ms`);
  assert.deepEqual(r.errors, []);
  assert.equal(r.slot.loaded, true);
  assert.equal(r.slot.loading, 0);
  assert.equal(r.slot.notice, null);
  assert.ok(r.steps.length >= 20, `the parse yields between its steps (${r.steps.length} steps)`);
  assert.ok(r.max < STEP_MAX, `every load step well inside 500 ms (${r.max.toFixed(1)} ms)`);
});

test("a damaged save beside a good backup: kept aside once, the backup parsed in steps of its own", { timeout: 300000 }, async () => {
  const { text, clock } = await heavySave(450);
  const broken = text.replace(/"check":"[0-9a-f]+"/, '"check":"00000000"');
  assert.notEqual(broken, text);
  const r = await loadIn({ [SAVE]: broken, [BAK]: text, [`${DIR}/save.damaged-1.json`]: broken }, clock);
  console.log(`# damaged ${Math.round(text.length / 1024)} KiB: ${r.steps.length} load steps, max ${r.max.toFixed(1)} ms`);
  assert.deepEqual(r.errors, []);
  assert.equal(r.slot.loaded, true);
  assert.equal(r.slot.notice.kind, "recovered");
  assert.match(r.slot.notice.text, /Loaded the backup/);
  assert.deepEqual(r.slot.damaged, ["save.damaged-1.json"], "already kept (an earlier load): not kept again");
  assert.ok(r.steps.length >= 30, `both parses yield (${r.steps.length} steps)`);
  assert.ok(r.max < STEP_MAX, `every load step well inside 500 ms (${r.max.toFixed(1)} ms)`);
});

test("an unreadable save.json: the recovery file and the backup each parse in steps", { timeout: 300000 }, async () => {
  const { text, clock } = await heavySave(300);
  const r = await loadIn({ [BAK]: text, [RECOVERY]: text }, clock, (host) => {
    // save.json is a directory: it can't be read (the recovery path; DESIGN §12.2)
    host.evalInVm(`globalThis.__herdr.mkdir(${JSON.stringify(SAVE)})`);
  });
  console.log(`# unreadable, ${Math.round(text.length / 1024)} KiB recovery + backup: ${r.steps.length} load steps, max ${r.max.toFixed(1)} ms`);
  assert.deepEqual(r.errors, []);
  assert.equal(r.slot.loaded, true);
  assert.equal(r.slot.notice.kind, "error", "the banner says save.json can't be read");
  assert.ok(r.steps.length >= 30, `both parses yield (${r.steps.length} steps)`);
  assert.ok(r.max < STEP_MAX, `every load step well inside 500 ms (${r.max.toFixed(1)} ms)`);
});

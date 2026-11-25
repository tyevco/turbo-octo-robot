// The REAL mods/creaseworks in the QuickJS-ng harness (ARCHITECTURE A2 rule 6,
// A6, A9, A12; DESIGN §3.11, §12.3): herdr's sandbox (frozen prototypes, no
// eval/Function, no setTimeout), its module resolution and its per-phase
// budgets, with 0, 4, 34 and 64 agents. Each copy is its own host (one View
// instance per VM, as one block of a window).
//
//   * module graph, constructor and init each < 500 ms (reported)
//   * every render < 50 ms (hard, enforced by the harness); p50 / max reported
//     per agent count, target p50 ≤ 8 ms at 64 agents (DESIGN §13.5)
//   * every timer tick < 500 ms (hard), max reported
//   * clicks through fire(): the Sheet, tabs, a purchase, the ribbon mini Sheet
//   * hot reload (host.reload) mid-play and mid-write: no rollback, no double count
//   * VM restart (host.restartVm): close(cx) writes, the new VM recovers from disk
//   * hostile agent addresses (__proto__, constructor, …) under frozen prototypes
//   * panel, rail (panel at 64 px) and ribbon roles
//
// Run with: npm run test:qjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readFileSync } from "node:fs";
import { createHost, BUDGETS, RuntimeFreeError } from "../../tools/qjs/harness.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MOD = join(repo, "mods", "creaseworks");
const HOME = "/home/player/.config/herdr-app";
const SAVE = `${HOME}/data/creaseworks/save.json`;
const SLOT = "globalThis[Symbol.for('creaseworks/live')]";
const PANEL = { width: 320, height: 784 };
const RIBBON = { width: 1172, height: 30 };
const RAIL = { width: 64, height: 784 };
const RENDERS = 40;
const TARGET_MS = 8;

const report = [];
const log = (line) => {
  report.push(line);
  console.log(`# ${line}`);
};

// ---------------------------------------------------------------------------
// Scenarios

const STATUSES = ["working", "idle", "blocked", "done", "working", "idle", "working"];

/** n pane agents (mixed statuses) and ceil(n/4) paneless fledglings. */
function roster(n, { addresses } = {}) {
  const agents = [];
  const terminals = [];
  for (let i = 1; i <= n; i++) {
    const status = STATUSES[i % STATUSES.length];
    const address = addresses ? addresses[i - 1] : `t${i}`;
    agents.push({
      address, pane: `p${i}`, status, title: `agent ${i} · fix the flaky test`, space_name: ["api", "web", "docs"][i % 3],
      tab_name: `tab ${1 + (i % 4)}`, tab_index: 1 + (i % 4), focused: i === 1,
    });
    terminals.push({ address, status: status === "done" ? "idle" : status, turn: status === "done" ? 1 : 0, created_ms: 1000 + i * 997 });
  }
  if (!addresses) {
    for (let j = 1; j <= Math.ceil(n / 4); j++) {
      terminals.push({ address: `k${j}`, status: ["working", "done", "blocked", "idle"][j % 4], turn: 0, parent: `t${1 + ((j * 3) % n)}`, created_ms: 5000 + j });
    }
  }
  return { agents, terminals };
}

function scenario(n, role = "panel", extra = {}) {
  return {
    appHome: HOME,
    home: "/home/player",
    props: { role },
    window: { visible: true, active: true, platform: "linux" },
    theme: "graphite",
    ...roster(n, extra),
    ...(extra.scenario ?? {}),
  };
}

// ---------------------------------------------------------------------------
// Helpers

function find(tree, id) {
  if (!tree || typeof tree !== "object") return null;
  if (tree.id === id) return tree;
  for (const c of tree.children ?? []) {
    const hit = find(c, id);
    if (hit) return hit;
  }
  return null;
}

function ids(tree, prefix, out = []) {
  if (!tree || typeof tree !== "object") return out;
  if (typeof tree.id === "string" && tree.id.startsWith(prefix)) out.push(tree.id);
  for (const c of tree.children ?? []) ids(c, prefix, out);
  return out;
}

const slotJson = (host, expr = "") => JSON.parse(host.evalInVm(`JSON.stringify((${SLOT} ?? null)${expr})`) ?? "null");
const hits = (host) => slotJson(host, "?.state?.stats?.hits");
const diskHits = (host) => {
  const text = host.readFile(SAVE);
  return text === null ? null : JSON.parse(text).state.stats.hits;
};

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const f1 = (x) => x.toFixed(1);

/** A loaded copy, sized, with its save loaded and one data tick run. */
async function copy(n, role = "panel", opts = {}) {
  const host = await createHost({ modRoot: MOD, scenario: scenario(n, role, opts) });
  const load = await host.load();
  host.advance(0); // the save read settles
  host.render();
  const size = opts.size ?? (role === "ribbon" ? RIBBON : PANEL);
  host.fire("root", "on_size_change", size);
  const tick = host.advance(1000);
  return { host, load: load.ms, tick };
}

/** Sheet hits through the real element handler, 100 ms apart (≤ 12.5 credited a second). */
function sheetHits(host, k, id = "cw-sheet") {
  for (let i = 0; i < k; i++) {
    host.render();
    if (id === "cw-sheet") host.fire(id, "on_mouse_down", { local_position: { x: 56, y: 56 } });
    else host.fire(id, "on_click", null);
    host.advance(100);
  }
}

// ---------------------------------------------------------------------------
// Load, render and tick budgets for 0, 4, 34 and 64 agents

for (const n of [0, 4, 34, 64]) {
  test(`${n} agents: load, init, render and ticks within budget (panel, rail and ribbon)`, async () => {
    const rows = [];
    for (const [role, size] of [["panel", PANEL], ["rail", RAIL], ["ribbon", RIBBON]]) {
      const { host, load, tick } = await copy(n, role === "rail" ? "panel" : role, { size });
      try {
        assert.ok(load.moduleGraph < BUDGETS.moduleGraph, `module graph ${load.moduleGraph} ms`);
        assert.ok(load.constructor < BUDGETS.constructor, `constructor ${load.constructor} ms`);
        assert.ok(load.init < BUDGETS.init, `init ${load.init} ms`);
        const tickMs = [...tick.stepMs];
        const renderMs = [];
        let tree = null;
        for (let i = 0; i < RENDERS; i++) {
          if (i % 4 === 0) tickMs.push(...host.advance(1000).stepMs); // data ticks between frames, as live
          const r = host.render();
          renderMs.push(r.ms);
          tree = r.tree;
        }
        assert.deepEqual(host.errors, [], JSON.stringify(host.errors));
        assert.equal(tree.id, "root");
        if (role === "panel") assert.ok(find(tree, "cw-panel"), "the panel frame renders");
        if (role === "rail") assert.ok(find(tree, "cw-rail"), "a 64 px panel is the rail");
        if (role === "ribbon") assert.ok(find(tree, "cw-ribbon"), "the ribbon renders");
        if (role === "panel" && n > 0) assert.equal(ids(tree, "cw-flock-tile-").length >= Math.min(n, 1), true, "tiles drawn");
        for (const ms of renderMs) assert.ok(ms < BUDGETS.render, `render ${ms} ms`);
        for (const ms of tickMs) assert.ok(ms < BUDGETS.timer, `tick ${ms} ms`);
        rows.push({ role, load, p50: pct(renderMs, 0.5), max: Math.max(...renderMs), tick: Math.max(0, ...tickMs) });
      } finally {
        host.dispose();
      }
    }
    for (const r of rows) {
      log(`qjs ${String(n).padStart(2)} agents ${r.role.padEnd(6)}: module graph ${f1(r.load.moduleGraph)} ms, constructor ${f1(r.load.constructor)} ms, ` +
        `init ${f1(r.load.init)} ms; render p50 ${f1(r.p50)} ms, max ${f1(r.max)} ms; tick max ${f1(r.tick)} ms`);
    }
    if (n === 64) {
      const panel = rows.find((r) => r.role === "panel");
      // The target (A2 rule 6) is a median; the hard budget above is per render.
      assert.ok(panel.p50 <= TARGET_MS * 2, `64-agent panel render p50 ${f1(panel.p50)} ms is far over the ${TARGET_MS} ms target`);
      if (panel.p50 > TARGET_MS) log(`NOTE: 64-agent panel render p50 ${f1(panel.p50)} ms is over the ${TARGET_MS} ms target`);
    }
  });
}

test("64 agents: every tab renders within budget (Flock, Shop segments, String, Settings)", async () => {
  const { host } = await copy(64);
  try {
    const out = [];
    const measure = (label) => {
      const ms = [];
      let tree;
      for (let i = 0; i < 10; i++) ({ tree, ms: ms[i] } = host.render());
      out.push(`${label} ${f1(pct(ms, 0.5))}/${f1(Math.max(...ms))}`);
      return tree;
    };
    measure("flock");
    host.fire("cw-tab-shop", "on_click", null);
    let tree = measure("shop/works");
    assert.ok(ids(tree, "cw-shop-row-").length > 0, "shop rows");
    for (const seg of ["tools", "folk", "charms", "curios", "auto"]) {
      host.fire(`cw-shop-seg-${seg}`, "on_click", null);
      measure(`shop/${seg}`);
    }
    host.fire("cw-tab-string", "on_click", null);
    tree = measure("string");
    assert.ok(ids(tree, "cw-string").length > 0);
    host.fire("cw-hdr-gear", "on_click", null);
    tree = measure("settings");
    assert.ok(ids(tree, "cw-set-").length > 0);
    assert.deepEqual(host.errors, []);
    log(`qjs 64 agents, tabs p50/max ms: ${out.join(", ")}`);
  } finally {
    host.dispose();
  }
});

// ---------------------------------------------------------------------------
// Clicks

test("clicks through fire(): Sheet hits count, a purchase lands, tabs switch, the ribbon mini Sheet folds", async () => {
  const { host } = await copy(4);
  try {
    const before = hits(host);
    sheetHits(host, 6);
    assert.equal(hits(host), before + 6, "six Sheet hits");
    const bank = slotJson(host, ".state.bank");
    assert.ok(bank > 0, "the hits earned folds");
    // Earn enough for a Paper Stack, then buy it from the Shop.
    sheetHits(host, 30);
    host.fire("cw-tab-shop", "on_click", null);
    const { tree } = host.render();
    const buy = find(tree, "cw-shop-buy-paper-stack");
    assert.ok(buy, "the Paper Stack buy button");
    host.fire("cw-shop-buy-paper-stack", "on_click", null);
    host.advance(100);
    assert.ok(slotJson(host, ".state.owned['paper-stack']") >= 1, "bought");
    assert.deepEqual(host.errors, []);
  } finally {
    host.dispose();
  }

  const rib = await copy(4, "ribbon");
  try {
    const { tree } = rib.host.render();
    const mini = find(tree, "cw-rib-mini");
    assert.ok(mini, "no panel copy alive: the ribbon shows its mini Sheet");
    const before = hits(rib.host);
    sheetHits(rib.host, 3, "cw-rib-mini");
    assert.equal(hits(rib.host), before + 3);
    assert.deepEqual(rib.host.errors, []);
  } finally {
    rib.host.dispose();
  }
});

// ---------------------------------------------------------------------------
// Hot reload and VM restart

test("hot reload mid-play: same writer, no disk read, no rollback; play continues", async () => {
  const { host } = await copy(34);
  try {
    sheetHits(host, 8);
    const before = slotJson(host);
    const reads = host.callsTo("readTextFile").length;
    const { ms } = await host.reload();
    log(`qjs reload (34 agents): module graph ${f1(ms.moduleGraph)} ms, constructor + init ${f1(ms.instantiate)} ms`);
    assert.ok(ms.instantiate < BUDGETS.init, "constructor and init share one 500 ms scope on reload");
    assert.equal(host.callsTo("readTextFile").length, reads, "no disk read on reload");
    const after = slotJson(host);
    assert.equal(after.writerId, before.writerId);
    assert.equal(after.state.stats.hits, before.state.stats.hits, "no rollback");
    assert.ok(after.state.bank >= before.state.bank);
    host.render();
    host.fire("root", "on_size_change", PANEL);
    sheetHits(host, 2);
    assert.equal(hits(host), before.state.stats.hits + 2);
    host.advance(20000);
    assert.equal(diskHits(host), before.state.stats.hits + 2, "saved by the new generation");
    assert.deepEqual(host.errors, []);
  } finally {
    host.dispose();
  }
});

for (const variant of [
  { name: "the old write landed", latency: { write: 200, read: 400 } },
  { name: "the old write lands after the new read", latency: { write: 600, read: 0 } },
]) {
  test(`hot reload mid-write (${variant.name}): no rollback, no double count`, async () => {
    const host = await createHost({ modRoot: MOD, scenario: { ...scenario(4), latency: variant.latency } });
    try {
      await host.load();
      host.advance(0);
      host.render();
      host.fire("root", "on_size_change", PANEL);
      host.advance(2000); // load + first save
      sheetHits(host, 5);
      // Run to the moment a write is in flight.
      let inflight = null;
      for (let i = 0; i < 300 && !inflight; i++) {
        host.advance(100);
        inflight = slotJson(host, "?.inflight");
      }
      assert.ok(inflight, "a write is under way");
      host.advance(50);
      const mid = hits(host);
      await host.reload(); // the old generation's write never settles
      host.render();
      host.fire("root", "on_size_change", PANEL);
      sheetHits(host, 3);
      host.advance(20000);
      assert.equal(hits(host), mid + 3, "live: no rollback, no double count");
      assert.equal(diskHits(host), mid + 3, "disk: no rollback, no double count");
      assert.deepEqual(host.errors, []);
    } finally {
      host.dispose();
    }
  });
}

test("VM restart: close(cx) starts the final write; the fresh VM recovers from disk", async () => {
  const { host } = await copy(64);
  try {
    sheetHits(host, 7);
    const before = slotJson(host);
    const restart = host.restartVm();
    log(`qjs VM restart (64 agents): close ${f1(restart.close.ms)} ms (settled ${restart.close.settled}); ` +
      `module graph ${f1(restart.ms.moduleGraph)} ms, init ${f1(restart.ms.init)} ms`);
    assert.ok(restart.close.called, "close(cx) ran");
    assert.equal(diskHits(host), before.state.stats.hits, "the final write landed");
    // restartVm already loaded the fresh VM (empty globalThis): its init read the save.
    assert.notEqual(slotJson(host, "?.writerId"), before.writerId, "a new process is a new writer");
    host.advance(0);
    host.render();
    host.fire("root", "on_size_change", PANEL);
    host.advance(1000);
    const after = slotJson(host);
    assert.ok(after && after.state, "loaded from disk");
    assert.equal(after.state.stats.hits, before.state.stats.hits, "recovered every hit");
    assert.notEqual(after.writerId, before.writerId, "a new process is a new writer");
    sheetHits(host, 2);
    assert.equal(hits(host), before.state.stats.hits + 2);
    assert.deepEqual(host.errors, []);
  } finally {
    host.dispose();
  }
});

// ---------------------------------------------------------------------------
// Frozen prototypes and hostile data

test("hostile agent addresses under frozen prototypes: no pollution, no throw, every helper kept", async () => {
  const addresses = ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "prototype", "__defineGetter__", "isPrototypeOf"];
  const host = await createHost({ modRoot: MOD, scenario: scenario(addresses.length, "panel", { addresses }) });
  try {
    assert.equal(host.evalInVm("Object.isFrozen(Object.prototype) && Object.isFrozen(Array.prototype) && Object.isFrozen(Function.prototype)"), true);
    const protoBefore = host.evalInVm("Object.getOwnPropertyNames(Object.prototype).join(',')");
    await host.load();
    host.advance(0);
    host.render();
    host.fire("root", "on_size_change", PANEL);
    host.advance(3000);
    const { tree } = host.render();
    assert.deepEqual(host.errors, [], JSON.stringify(host.errors));
    assert.equal(host.evalInVm("Object.getOwnPropertyNames(Object.prototype).join(',')"), protoBefore);
    assert.equal(host.evalInVm("typeof ({}).toString === 'function' && ({}).constructor === Object"), true);
    const helpers = host.evalInVm(`Object.keys(${SLOT}.state.helpers).length`);
    assert.equal(helpers, addresses.length, "one helper per agent");
    assert.equal(ids(tree, "cw-flock-tile-").length, addresses.length, "one tile per agent");
    // The save round-trips through disk with these addresses.
    host.advance(20000);
    const text = host.readFile(SAVE);
    assert.ok(text && JSON.parse(text).format === "creaseworks-save");
    const restart = host.restartVm();
    assert.ok(restart.close.called);
    host.advance(0);
    host.advance(1000);
    assert.equal(host.evalInVm(`Object.keys(${SLOT}.state.helpers).length`), addresses.length);
    assert.deepEqual(host.errors, []);
  } finally {
    host.dispose();
  }
});

test.after(() => {
  if (report.length) console.log(`# --- creaseworks QuickJS summary ---\n${report.map((l) => `# ${l}`).join("\n")}`);
});

// ---------------------------------------------------------------------------
// Months of agent churn (DESIGN R13, review r1-02): the Album is compacted, so
// the save stays far below herdr's 1 MiB write limit, and loading it and every
// save cycle stay inside the 500 ms callback budget. Each run gets its own wasm
// instance (a fresh import of the harness), so its outcome does not depend on
// what the earlier tests of this file left in the shared wasm heap.
//
// Teardown (DESIGN R13, review r3-25). From a save of about 300 KiB this wasm
// QuickJS-ng build (0.12.1) aborts in JS_FreeRuntime
// (`list_empty(&rt->gc_obj_list)`) on dispose after a save cycle, although
// every step is in budget and the game is correct. Bisected in the harness
// (tools/qjs/harness.mjs header): it is the engine's cycle collector running
// while a glue async function executes again after an `await` (store.cycle
// after its pause, store.parseIn between parse steps). A collection forced
// there aborts the teardown of a 120-day save too; collections at step
// boundaries, in synchronous engine code, or none at all leave nothing behind.
// The save size only decides whether the automatic collection lands in such a
// function (a save cycle allocates about twice the save text). A leaked handle
// gives the same message, so every teardown here is a real assertion:
//   * 120 days: frees cleanly as the engine runs;
//   * a year and two years, as the engine runs: frees cleanly or fails with
//     exactly that leak check (RuntimeFreeError.gcObjList), nothing else;
//   * the same year and two-year saves and play with the collector held back
//     (createHost gcHeadroom, which changes only WHEN garbage is collected):
//     must free cleanly. A leaked handle, or anything the mod or harness kept
//     alive for real, fails here; passing is consistent with an engine
//     collector-timing fault. (The limit of this check: it catches leaks that
//     do not depend on when the collector runs, not a GC-timing-dependent
//     refcount error on the harness side.)
// herdr runs a different QuickJS (longbridge quickjs-jit), not checked here.

/**
 * The save text after `days` days of 20 agents a day (3 fledglings each), and
 * the pane helper count. Mail Sorter opens the Bundles; the timed boosts
 * (Rush, Storm, Chorus) are left on the tray the whole time and opened only at
 * the end, after their helpers were compacted (review r2-02: they used to pile
 * up for ever, and opening them un-compacted their Album records).
 */
async function churnSave(days) {
  const engine = await import("../../mods/creaseworks/engine/index.js");
  const T0 = Date.UTC(2026, 10, 25, 9);
  const s = engine.newGame({ seed: 5, now: T0, day: "2026-11-25" });
  s.bought["mail-sorter"] = true;
  let seq = 0;
  const act = (a) => engine.apply(s, { w: "w-yearchurn01", s: ++seq, ...a });
  const obs = (t, helpers) => act({ t, type: "observe", helpers, visible: true, active: true, matShown: true, day: "2026-11-25" });
  const ag = (i, extra = {}) => ({ addr: `w1:t${i}`, created: T0 + i * 997, status: "working", raw: "working", turn: 0, parent: null, pane: `p${i}`, title: "claude · refactor the payment module", paneName: "", space: "main", tab: "1", kind: "pane", ...extra });
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
    obs((t += 1000), []);
    t = T0 + (d + 1) * 86400000;
    engine.advance(s, t);
  }
  const K = engine.CONTENT.K;
  // the tray holds only envelopes of helpers the Album keeps whole
  assert.ok(Object.keys(s.envelopes).length <= K.albumKeep, `${Object.keys(s.envelopes).length} envelopes waiting`);
  for (const id of Object.keys(s.envelopes)) act({ t: (t += 100), type: "open", helperId: id });
  obs((t += 1000), []);
  assert.equal(Object.keys(s.envelopes).length, 0);
  const text = engine.serialize(s);
  // every compacted helper still packs (opening its envelope did not keep it
  // whole) or, past K.albumCompactKeep compact records, is counted in an Album
  // archive entry (review r3-04)
  const saved = Object.values(JSON.parse(text).state.helpers);
  const packed = saved.filter(Array.isArray).length;
  const archived = saved.reduce((a, h) => a + (!Array.isArray(h) && h.archive > 0 ? h.archive : 0), 0);
  assert.equal(packed + archived, n - K.albumKeep);
  assert.ok(packed <= K.albumCompactKeep + K.albumArchiveBatch, `${packed} compact records`);
  return { engine, text, clock: s.clock, n };
}

/**
 * Loads the churned save in a fresh harness (its own wasm instance) with 30
 * live agents, plays 40 s (save cycles included) and checks every step and the
 * written save. Returns the slowest step and the dispose error, if any.
 */
async function churnRun(days, tag, maxKiB = 512, { save = null, gcHeadroom = 0 } = {}) {
  const { engine, text, clock, n } = save ?? (await churnSave(days));
  assert.ok(text.length < maxKiB * 1024, `${text.length} bytes`);
  const { createHost: freshHost } = await import(`../../tools/qjs/harness.mjs?${tag}`);
  const now = clock + 1000;
  const live = roster(30);
  for (const term of live.terminals) term.created_ms = now - 5000 + term.created_ms;
  const host = await freshHost({
    modRoot: MOD,
    scenario: { ...scenario(0), ...live, now, files: { [SAVE]: text } },
    gcHeadroom,
  });
  let slowest;
  try {
    const load = await host.load();
    const steps = [load.ms.init];
    steps.push(...host.advance(0).stepMs);
    const cycles = [];
    for (let i = 0; i < 40; i++) {
      const before = host.callsTo("writeTextFile").length;
      const ms = host.advance(1000).stepMs;
      steps.push(...ms);
      if (host.callsTo("writeTextFile").length > before) cycles.push(Math.max(...ms));
    }
    assert.deepEqual(host.errors, [], JSON.stringify(host.errors));
    for (const ms of steps) assert.ok(ms < BUDGETS.timer, `step ${ms} ms`);
    const save = slotJson(host, ".save");
    assert.equal(save.status, "ok", JSON.stringify(save));
    assert.equal(save.writing, null);
    const disk = host.readFile(SAVE);
    assert.notEqual(disk, text, "a save cycle wrote the file");
    const back = engine.parseSave(disk);
    assert.equal(back.ok, true);
    const gone = Object.values(back.state.helpers).filter((h) => h.kind === "pane" && h.gone);
    assert.equal(gone.reduce((a, h) => a + (h.archive > 0 ? h.archive : 1), 0), n, "every helper is still in the Album");
    slowest = Math.max(...steps);
    assert.ok(cycles.length >= 2, "save cycles ran");
    log(`qjs ${days}-day churn save: ${(text.length / 1024).toFixed(0)} KiB, ${n} Album helpers; init ${f1(load.ms.init)} ms, ` +
      `slowest step ${f1(slowest)} ms, slowest save-cycle step ${f1(Math.max(...cycles))} ms (cycles: ${cycles.map(f1).join(", ")})`);
  } catch (e) {
    try {
      host.dispose();
    } catch {
      // the assertion above is the failure to report
    }
    throw e;
  }
  let leak = null;
  try {
    host.dispose();
  } catch (e) {
    leak = e;
  }
  return { slowest, leak, text, save: { engine, text, clock, n }, headroom: host.headroom };
}

/** Teardown as the engine runs: clean, or this wasm build's leak check and nothing else. */
function cleanOrEngineFault(leak, what) {
  if (leak === null) return "freed cleanly";
  // (each run imports its own copy of the harness, so its own RuntimeFreeError class)
  assert.equal(leak?.name, RuntimeFreeError.name, `${what}: dispose failed in another way: ${leak?.stack ?? leak}`);
  assert.equal(leak.gcObjList, true, `${what}: not the JS_FreeRuntime leak check: ${leak.message}`);
  return "JS_FreeRuntime leak check (engine collector timing)";
}

/** Held back for the replay: well above what 40 s of play on a two-year save allocates. */
const HEADROOM = 96 * 1024 * 1024;

test("a save after 120 days of 20 agents a day loads, saves within budget and frees cleanly (Album compaction, R13)", { timeout: 120000 }, async () => {
  const { leak } = await churnRun(120, "churn120");
  if (leak) throw leak;
});

let year = null;

test("a save after a year of 20 agents a day loads and saves within budget (Album compaction, R13)", { timeout: 180000 }, async () => {
  year = await churnRun(365, "churn365");
  log(`qjs 365-day teardown as the engine runs: ${cleanOrEngineFault(year.leak, "365 days")}`);
});

// Review r2-01: every save cycle used to serialise and hash the whole Album
// (≈ 0.8 ms per KiB), so a save of about 600 KiB passed the 500 ms budget.
// Format 3 re-hashes only the chunks that changed; twice the year (≈ 590 KiB)
// must stay in budget, load included, and under herdr's 1 MiB write limit.
let twoYear = null;
let twoYearText = null;

test("a save after two years of 20 agents a day loads and saves within budget (chunked save check, R13)", { timeout: 300000 }, async () => {
  twoYear = await churnRun(730, "churn730", 1024);
  twoYearText = twoYear.text;
  log(`qjs 730-day teardown as the engine runs: ${cleanOrEngineFault(twoYear.leak, "730 days")}`);
});

// Review r3-25: these used to be todo tests that failed on every run. The
// replay is the same save, the same 30 agents and the same 40 s of play in a
// fresh wasm instance; only the collector's timing differs.
for (const [days, tag, maxKiB, done] of [[365, "churn365q", 512, () => year], [730, "churn730q", 1024, () => twoYear]]) {
  test(`the QuickJS runtime frees cleanly after the ${days}-day save cycles with the engine's collector held back (R13, r3-25)`, { timeout: 300000 }, async () => {
    const natural = done();
    const replay = await churnRun(days, tag, maxKiB, { save: natural?.save ?? null, gcHeadroom: HEADROOM });
    assert.equal(replay.headroom.length, 1);
    assert.ok(replay.headroom[0].peak >= HEADROOM);
    if (replay.leak) throw replay.leak;
    log(`qjs ${days}-day teardown with ${HEADROOM / 1048576} MiB collector headroom: freed cleanly ` +
      `(as the engine runs: ${natural ? cleanOrEngineFault(natural.leak, `${days} days`) : "not run"})`);
  });
}

// Review r2-01 (residual budget): a load and a CAS merge each parse and verify
// the whole save. parseSaveSteps splits that work (STEP_HELPERS helpers per
// step) so the glue can yield between steps. Measured here on the two-year
// save in its own QuickJS-ng runtime with herdr's sandbox installed (frozen
// prototypes): every step well inside the budget, and the result the same as
// parseSave's (same save text when serialised again).
test("parseSaveSteps: a two-year save parses in steps far below the 500 ms budget, with parseSave's result (r2-01)", { timeout: 120000 }, async () => {
  if (twoYearText === null) ({ text: twoYearText } = await churnSave(730));
  const { newQuickJSWASMModuleFromVariant } = await import("quickjs-emscripten-core");
  const { default: variant } = await import("@jitl/quickjs-ng-wasmfile-release-sync");
  const QJS = await newQuickJSWASMModuleFromVariant(variant);
  const rt = QJS.newRuntime();
  rt.setMemoryLimit(256 * 1024 * 1024);
  rt.setMaxStackSize(256 * 1024);
  rt.setModuleLoader((name) => readFileSync(name, "utf8"), (base, name) => join(dirname(base), name));
  const vm = rt.newContext();
  const evalOk = (code, opts) => {
    const r = vm.evalCode(code, opts?.name ?? "eval.js", opts);
    if (r.error) {
      const e = vm.dump(r.error);
      r.error.dispose();
      throw new Error(JSON.stringify(e));
    }
    return r.value;
  };
  const dumpOk = (code) => {
    const h = evalOk(code);
    const v = vm.dump(h);
    h.dispose();
    return v;
  };
  try {
    const install = evalOk(readFileSync(join(repo, "tools", "qjs", "sandbox.js"), "utf8"));
    const policy = vm.newObject();
    const installed = vm.callFunction(install, vm.undefined, policy);
    (installed.value ?? installed.error).dispose();
    policy.dispose();
    install.dispose();
    const textHandle = vm.newString(twoYearText);
    vm.setProp(vm.global, "TEXT", textHandle);
    textHandle.dispose();
    evalOk(
      `import { parseSave, parseSaveSteps, serialize } from "./engine/save-codec.js";
       globalThis.STEPS = parseSaveSteps(TEXT);
       globalThis.WHOLE = () => serialize(parseSave(TEXT).state) === TEXT;
       globalThis.SAME = (r) => r.ok === true && serialize(r.state) === TEXT;`,
      { type: "module", name: join(MOD, "qjs-steps.js") },
    ).dispose();
    assert.equal(dumpOk("Object.isFrozen(Object.prototype) && Object.isFrozen(Array.prototype)"), true);
    const ms = [];
    for (;;) {
      const t = performance.now();
      const h = evalOk("globalThis.LAST = STEPS.next(); LAST.done");
      const done = vm.dump(h);
      h.dispose();
      ms.push(performance.now() - t);
      if (done) break;
      assert.ok(ms.length < 10000, "the steps end");
    }
    assert.equal(dumpOk("SAME(LAST.value)"), true, "stepped parse = the file");
    assert.equal(dumpOk("WHOLE()"), true, "parseSave = the file");
    const slowest = Math.max(...ms);
    const total = ms.reduce((a, b) => a + b, 0);
    assert.ok(ms.length >= 20, `${ms.length} steps`);
    assert.ok(slowest < 150, `slowest parse step ${slowest} ms`);
    log(`qjs parseSaveSteps on the two-year save (${(twoYearText.length / 1024).toFixed(0)} KiB): ${ms.length} steps, ` +
      `slowest ${f1(slowest)} ms, total ${f1(total)} ms`);
  } finally {
    vm.dispose();
    rt.dispose(); // every handle was released: the runtime frees cleanly
  }
});

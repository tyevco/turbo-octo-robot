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

import { createHost, BUDGETS } from "../../tools/qjs/harness.mjs";

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
// the save stays far below herdr's 1 MiB write limit and loading it and every
// save cycle stay inside the 500 ms callback budget. 280 days of 20 agents a
// day (3 fledglings each) is 5,600 lifetime pane helpers; the full-year size
// bound is asserted in Node (test/pacing/invariants.test.mjs, inv. 7). Past
// about 6,000 compacted records this wasm harness fails to free its runtime on
// dispose even though every step stays in budget (a harness limit, like the
// one save-backlog.test.mjs notes), so the QuickJS run stops short of a year.

const DAYS = 280;

test("a save after 280 days of 20 agents a day loads and saves within budget (Album compaction, R13)", { timeout: 120000 }, async () => {
  const engine = await import("../../mods/creaseworks/engine/index.js");
  const T0 = Date.UTC(2026, 10, 25, 9);
  const s = engine.newGame({ seed: 5, now: T0, day: "2026-11-25" });
  let seq = 0;
  const act = (a) => engine.apply(s, { w: "w-yearchurn01", s: ++seq, ...a });
  const obs = (t, helpers) => act({ t, type: "observe", helpers, visible: true, active: true, matShown: true, day: "2026-11-25" });
  const ag = (i, extra = {}) => ({ addr: `w1:t${i}`, created: T0 + i * 997, status: "working", raw: "working", turn: 0, parent: null, pane: `p${i}`, title: "claude · refactor the payment module", paneName: "", space: "main", tab: "1", kind: "pane", ...extra });
  let t = T0;
  let n = 0;
  for (let d = 0; d < DAYS; d++) {
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
  const text = engine.serialize(s);
  assert.ok(text.length < 512 * 1024, `${text.length} bytes`);
  const now = s.clock + 1000;
  const live = roster(30);
  for (const term of live.terminals) term.created_ms = now - 5000 + term.created_ms;
  const host = await createHost({
    modRoot: MOD,
    scenario: { ...scenario(0), ...live, now, files: { [SAVE]: text } },
  });
  try {
    const load = await host.load();
    const steps = [load.ms.init];
    steps.push(...host.advance(0).stepMs);
    for (let i = 0; i < 40; i++) steps.push(...host.advance(1000).stepMs);
    assert.deepEqual(host.errors, [], JSON.stringify(host.errors));
    for (const ms of steps) assert.ok(ms < BUDGETS.timer, `step ${ms} ms`);
    const save = slotJson(host, ".save");
    assert.equal(save.status, "ok", JSON.stringify(save));
    assert.equal(save.writing, null);
    const disk = host.readFile(SAVE);
    assert.notEqual(disk, text, "a save cycle wrote the file");
    const back = engine.parseSave(disk);
    assert.equal(back.ok, true);
    assert.equal(Object.values(back.state.helpers).filter((h) => h.kind === "pane" && h.gone).length, n);
    log(`qjs ${DAYS}-day churn save: ${(text.length / 1024).toFixed(0)} KiB, ${n} Album helpers; slowest step ${f1(Math.max(...steps))} ms`);
  } finally {
    host.dispose();
  }
});

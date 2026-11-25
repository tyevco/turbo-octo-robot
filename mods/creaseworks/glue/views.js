// Screenshot scenarios (ARCHITECTURE A10; DESIGN §15.3), read by
// tools/shots/shoot.mjs: the default export is an array of
// { name, size: {width, height}, scenario, setup?, block?, window? }.
//
// Every view is a REAL game: the scenario gives herdr agents and terminals
// (and save files), the real View loads, ticks and observes them, and
// `setup(view, { ctl, advance, flush })` plays it into shape by dispatching
// engine actions through the session (clicks, buys, wishes, turn deltas,
// another writer's observation). Where a state needs luck or hours (a storm,
// a crane's spawn time), setup moves the one engine field that decides it and
// then lets the engine do the rest. Each view has its own app home, so views
// never share a handover slot (shoot.mjs runs them in one process), and a
// fixed-seed save, so the shots repeat.
//
// A pure table: nothing is built at import time (the scenarios are getters;
// reading one also forgets a handover slot this view's previous run left in
// the rig's process).

import { newGame, serialize, apply, wishInfo } from "../engine/index.js";
import { WISH_MOMENT } from "../engine/view.js";
import { localDay } from "./clock.js";
import { getSlot, dropSlot } from "./live.js";
import * as store from "./store.js";

/** The mock's start time (tools/mock/controller.js DEFAULT_NOW: 2026-01-01T09:00:00Z). */
const T0 = 1767258000000;
const PANEL = { width: 320, height: 784 };
/**
 * The String tab down to its garlands: a standard-width panel tall enough that
 * the strand card, the wish button, Clears/Keeps, Perks and the "one per wish"
 * stripes all show above the footer (at 784 the tab ends at a clipped PERKS
 * heading and the stripes are below the fold: review r1-29).
 */
export const GARLANDS_SIZE = Object.freeze({ width: 320, height: 1160 });
const RIBBON_W = { 1100: 832, 1440: 1172 };
const TITLES = [
  "Refactor auth middleware", "Fix flaky login test", "Write the release notes", "Migrate to the new router",
  "Profile the image cache", "Review dependency bumps", "Port parser to streams", "Draft API docs",
  "Tidy CSS tokens", "Add retry to uploads", "Investigate memory spike", "Translate settings page",
];
const SPACES = [["api", "server"], ["web", "ui"], ["docs", "guide"], ["infra", "ops"]];

const home = (name) => `/shots/${name}/herdr-app`;
const savePath = (name) => `${home(name)}/data/creaseworks/save.json`;
const bakPath = (name) => `${home(name)}/data/creaseworks/save.bak.json`;

/** herdr agents + terminals for a roster { needs, finished, working, resting, kids, extra }. */
function roster(spec = {}) {
  const agents = [];
  const terminals = [];
  const order = [];
  for (const [key, status, raw] of [["needs", "blocked", "blocked"], ["finished", "done", "idle"], ["working", "working", "working"], ["resting", "idle", "idle"]]) {
    for (let i = 0; i < (spec[key] || 0); i++) order.push([status, raw]);
  }
  // A stride permutation, so join order is not group order.
  const len = order.length;
  let stride = 7;
  while (len > 1 && gcd(stride, len) !== 1) stride += 2;
  const mixed = order.map((_, i) => order[(i * stride) % len]);
  mixed.forEach(([status, raw], i) => {
    const n = i + 1;
    const [space, tab] = SPACES[i % SPACES.length];
    agents.push({
      address: `t${n}`, pane: `p${n}`, status, title: TITLES[i % TITLES.length], space: `s${(i % 4) + 1}`, space_name: space,
      tab: `c${(i % 4) + 1}-${Math.floor(i / 8) + 1}`, tab_index: Math.floor(i / 8) + 1, tab_name: `${tab} ${Math.floor(i / 8) + 1}`,
      focused: i === 0,
    });
    terminals.push({ address: `t${n}`, status: raw === "blocked" && i % 5 === 4 ? "error" : raw, turn: status === "done" ? 1 : 0, created_ms: T0 - 3600000 + n * 997 });
  });
  const kids = spec.kids === true ? Math.ceil(agents.length / 4) : spec.kids || 0;
  for (let j = 0; j < kids; j++) {
    const parent = agents[(j * 3) % Math.max(1, agents.length)];
    if (!parent) break;
    terminals.push({ address: `k${j + 1}`, status: ["working", "done", "blocked", "idle"][j % 4], turn: 0, parent: parent.address, created_ms: T0 - 1800000 + j * 331, title: `subtask ${j + 1}` });
  }
  return { agents, terminals };
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

/** A fixed-seed new game as save text (deterministic shots). */
function newSave(seed) {
  const t = T0 - 500;
  return serialize(newGame({ seed, now: t, day: localDay(t) }));
}

/** The scenario for view `name` (a getter: built when the rig asks). */
function scenarioFor(name, opts = {}) {
  const r = roster(opts.roster || {});
  const files = { [savePath(name)]: newSave(opts.seed ?? 20260101) };
  if (opts.files) Object.assign(files, opts.files(name));
  return {
    now: T0,
    patchDate: true, // the glue's clock (Date.now) reads the virtual clock
    appHome: home(name),
    home: `/shots/${name}`,
    props: { role: opts.role || "panel" },
    agents: r.agents,
    terminals: r.terminals,
    files,
    window: { visible: true, active: true, platform: "linux" },
    zoom: 1,
  };
}

// ---------------------------------------------------------------------------
// Setup helpers (they run against the mock controller the rig made)

const S = (view) => view.session;
const slot = () => getSlot();
const state = () => getSlot().state;
const act = (view, action) => S(view).dispatch(action, undefined);

/**
 * Load, first tick (observe + first save), size the copy, and a few Sheet hits
 * so the first-run hint is gone. The size goes in as the shell reports it, in
 * zoomed px (the rig's `tools.zoom`), so the copy is `size` logical px wide at
 * every zoom for the whole of setup (r4-16: at 1.5 it was 2/3 of that until the
 * rig resized it afterwards).
 */
async function begin(view, tools, size, hits = 3) {
  await tools.flush();
  const zoom = typeof tools.zoom === "number" && tools.zoom > 0 ? tools.zoom : 1;
  if (size) S(view).onSize({ width: size.width * zoom, height: size.height * zoom }, undefined);
  await tools.advance(1000);
  await sheetHits(view, tools, hits);
}

async function sheetHits(view, tools, n, gap = 120) {
  for (let i = 0; i < n; i++) {
    act(view, { type: "click", target: "sheet" });
    await tools.advance(gap);
  }
}

/** Folds earned elsewhere in the run (a long session, compressed). */
function grant(folds) {
  const s = state();
  s.bank += folds;
  s.runFolds += folds;
  s.lifetime += folds;
}

/**
 * Splits this run's folds between its sources the way a played run would
 * (`grant` adds folds with no source, so a wish made after it records a
 * single "everyone else" stripe): pane helpers in falling shares, your hands
 * (Sheet clicks) and workshops; what is left stays "everyone else". `k`
 * varies the split per wish. Moves only the fields the garland reads.
 */
function creditRun(k) {
  const s = state();
  const run = s.runFolds;
  const panes = Object.keys(s.helpers).map((id) => s.helpers[id]).filter((h) => h.kind === "pane" && !h.gone);
  // Helpers 62 % (falling: 1/(i+1+k mod 3)), hands 14-23 %, workshops 10 %, the rest everyone else.
  const parts = panes.map((_, i) => 1 / (i + 1 + (k % 3)));
  const sum = parts.reduce((a, x) => a + x, 0) || 1;
  panes.forEach((h, i) => {
    h.stats.run = Math.round((run * 0.62 * parts[i]) / sum);
  });
  s.stats.runBySource.sheet = Math.round(run * (0.14 + 0.03 * k));
  s.stats.runBySource.workshops = Math.round(run * 0.1);
}

function buyAll(view, items) {
  for (const [id, n] of items) act(view, { type: "buy", item: id, count: n });
}

const STANDARD_BUYS = [
  ["paper-stack", 10], ["bone-folder", 10], ["scissor-stand", 1], ["scissor-stand", 1], ["scissor-stand", 1], ["crisp-corners", 1], ["rice-treats", 1], ["paper-stack-t1", 1], ["wax-seal", 1],
];

/** A stocked mid-game: workshops, a tool, a folk upgrade, a charm. */
function midGame(view, folds = 2.5e5) {
  grant(folds);
  buyAll(view, STANDARD_BUYS);
}

/** Finishes a task on the given agents (turn +1 in terminals()), then ticks so envelopes land. */
async function finish(tools, addrs, status = "working") {
  const list = tools.ctl.terminalsList.map((t) => ({ ...t }));
  for (const t of list) {
    if (addrs.includes(t.address)) {
      t.turn = (t.turn || 0) + 1;
      if (status) t.status = status;
    }
  }
  tools.ctl.setTerminals(list);
  await tools.advance(1000);
}

const addrs = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `t${from + i}`);

/** Runs a spawn clock out now (the engine then spawns the piece on the next active second). */
async function spawnNow(view, tools, key) {
  const sp = state().spawn;
  sp[key] = sp.activeMs + 1;
  await sheetHits(view, tools, 2, 300);
  await tools.advance(1000);
}

function shopUi(view, segment) {
  const ui = S(view).ui;
  ui.tab = "shop";
  ui.segment = segment;
}

function lastNotice() {
  return slot().notice;
}

// ---------------------------------------------------------------------------
// The table

const STD = { finished: 1, working: 2, resting: 1 };

function view(name, opts, setup) {
  const entry = {
    name,
    size: opts.size || PANEL,
    get scenario() {
      // The rig shoots each view once per theme in one Node process: a slot left
      // by this view's previous run would be adopted like a hot reload. Start clean.
      const left = getSlot();
      if (left && left.home === home(name)) dropSlot();
      return scenarioFor(name, opts);
    },
    async setup(v, tools) {
      await begin(v, tools, opts.size || PANEL, opts.hits ?? 3);
      if (setup) await setup(v, tools);
    },
  };
  if (opts.block) entry.block = opts.block;
  if (opts.window) entry.window = true;
  return entry;
}

const VIEWS = [];
const add = (...a) => VIEWS.push(view(...a));

add("empty", { roster: {} }, async () => grant(1240));
add("first-run", { roster: { working: 1 }, hits: 0 });
add("standard-4", { roster: STD }, async (v, tools) => {
  midGame(v);
  await finish(tools, ["t1", "t3"]);
});
add("needs-you-3", { roster: { needs: 3, working: 2, resting: 1 } }, async (v, tools) => {
  midGame(v);
  await finish(tools, ["t4"]);
});
add("finished-2", { roster: { finished: 2, working: 2, resting: 1 } }, async (v, tools) => {
  midGame(v);
  await finish(tools, ["t3", "t4"]);
});
add("tray-full", { roster: { working: 5, resting: 3, finished: 2 } }, async (v, tools) => {
  midGame(v);
  await finish(tools, addrs(1, 10));
});
add("storm", { roster: STD }, async (v, tools) => {
  midGame(v);
  const b = state().boosts;
  const t = Date.now();
  b.stormEnd = t + 21000;
  b.storm = 21000;
  b.rushEnd = t + 55000;
  b.rush = 55000;
  await sheetHits(v, tools, 12, 250);
  await tools.advance(2000);
});
add("crane", { roster: STD }, async (v, tools) => {
  midGame(v);
  await spawnNow(v, tools, "nextCraneAt");
});
add("boat", { roster: STD }, async (v, tools) => {
  midGame(v, 1.3e6);
  act(v, { type: "buy", item: "harbour-ribbon", count: 1 });
  await spawnNow(v, tools, "nextBoatAt");
});
add("chain-7", { roster: STD }, async (v, tools) => {
  midGame(v, 2.5e6);
  act(v, { type: "buy", item: "long-crease", count: 1 });
  act(v, { type: "buy", item: "grand-crease", count: 1 });
  await spawnNow(v, tools, "nextChainAt");
  const chain = state().spawn.chain;
  if (chain) {
    for (let i = 0; i < 2; i++) {
      const node = S(v).vm().mat.nodes.find((n) => n.due) || S(v).vm().mat.nodes[0];
      if (node) act(v, { type: "click", target: "node", id: node.id });
      await tools.advance(200);
    }
  }
});
add("in-step", { roster: { working: 4, resting: 1, finished: 1 } }, async (v, tools) => {
  midGame(v);
  await finish(tools, ["t1", "t5"]);
  await sheetHits(v, tools, 30, 300);
});
add("flock-12", { roster: { needs: 2, finished: 1, working: 5, resting: 4, kids: true }, block: "cw-panel", window: true }, async (v, tools) => {
  midGame(v);
  await finish(tools, ["t3", "t7", "t9"]);
});
add("flock-34", { roster: { needs: 3, finished: 2, working: 14, resting: 15, kids: true } }, async (v, tools) => {
  midGame(v, 4e6);
  await finish(tools, ["t5", "t9", "t20", "t31"]);
});
add("flock-64-dense", { roster: { needs: 5, finished: 3, working: 30, resting: 26, kids: true } }, async (v, tools) => {
  midGame(v, 3.12e9);
  await finish(tools, ["t9", "t20", "t40", "t50", "t60"]);
});
add("flock-elsewhere", { roster: { needs: 1, working: 4, resting: 3 } }, async (v, tools) => {
  midGame(v);
  // Another window (its own writer) observes four agents this window cannot see.
  const t = Date.now();
  const other = ["e1", "e2", "e3", "e4"].map((addr, i) => ({
    addr, created: T0 - 7200000 + i, status: ["working", "idle", "working", "blocked"][i], raw: "working", turn: 0, parent: null,
    pane: `q${i}`, title: TITLES[(i + 5) % TITLES.length], paneName: "", space: "laptop", tab: "2", kind: "pane",
  }));
  apply(state(), { w: "other-window", s: 1, t, type: "observe", helpers: other, visible: true, active: false, matShown: false, day: localDay(t) });
  await finish(tools, ["t2"]);
  S(v).ui.folded.elsewhere = false; // the view is about Elsewhere: open it
});
add("album", { roster: { working: 9, resting: 4, finished: 2 } }, async (v, tools) => {
  midGame(v);
  // Nine agents leave; their records move to the Album.
  const keep = new Set(addrs(1, 6));
  tools.ctl.setAgents(tools.ctl.agentsList.filter((a) => keep.has(a.address)));
  tools.ctl.setTerminals(tools.ctl.terminalsList.filter((t) => keep.has(t.address)));
  await tools.advance(2000);
  S(v).ui.folded.album = false; // the view is about the Album: open it
});
for (const seg of ["works", "tools", "folk", "charms", "curios", "auto"]) {
  add(`shop-${seg}`, { roster: STD }, async (v) => {
    midGame(v, seg === "auto" || seg === "curios" ? 3e6 : 4e5);
    if (seg === "auto") act(v, { type: "buy", item: "mail-sorter", count: 1 });
    shopUi(v, seg);
  });
}
add("string-locked", { roster: STD }, async (v) => {
  midGame(v, 4.26e9);
  S(v).ui.tab = "string";
});
add("string-ready", { roster: STD }, async (v) => {
  midGame(v, 6.2e9);
  S(v).ui.tab = "string";
});
add("string-confirm", { roster: STD }, async (v, tools) => {
  midGame(v, 6.2e9);
  const h = S(v).handlers;
  h.tab("string", undefined);
  h.confirm("wish", undefined);
  await tools.advance(1600);
});
add("garlands", { roster: { working: 6, resting: 4, needs: 1, finished: 1 }, size: GARLANDS_SIZE }, async (v, tools) => {
  for (let k = 0; k < 4; k++) {
    midGame(v, 7e9 * (k + 1) ** 3);
    await finish(tools, [`t${k + 1}`, `t${k + 5}`]);
    await sheetHits(v, tools, 5);
    await tools.advance(30000);
    creditRun(k); // the stripes are what this view is for (r1-29)
    if (wishInfo(state()).can) act(v, { type: "wish" });
  }
  midGame(v, 8.4e8);
  S(v).ui.tab = "string";
  // The String at rest: past the last wish's moment (strands rise from
  // opacity 0 until WISH_MOMENT.settleMs), so the lit cranes show (r2-23).
  await tools.advance(WISH_MOMENT.settleMs + 1000);
});
add("settings", { roster: STD }, async (v) => {
  midGame(v);
  act(v, { type: "setting", key: "notify.master", value: true });
  act(v, { type: "setting", key: "notify.pile", value: false });
  S(v).handlers.tab("settings", undefined);
});
add("away", { roster: { needs: 2, working: 2, resting: 3 } }, async (v, tools) => {
  midGame(v);
  await finish(tools, ["t3", "t5"]);
  // Two hours away: the next tick credits an away segment and shows the card.
  tools.ctl.setNow(Date.now() + 2 * 3600000);
  await tools.flush();
  await finish(tools, ["t4", "t6"]);
});
add("busy", { roster: STD }, async (v, tools) => {
  midGame(v);
  // 31 minutes of live time with no player intent (50 s ticks, never "away"), then a hit.
  for (let i = 0; i < 38; i++) {
    tools.ctl.setNow(Date.now() + 50000);
    await tools.flush();
    if (i === 10 || i === 25) await finish(tools, [`t${(i % 4) + 1}`]);
  }
  await sheetHits(v, tools, 1);
});

// Save banners (DESIGN §3.8): each produced by the real store.
add("banner-recovered", { roster: STD, files: (name) => ({ [savePath(name)]: "{{{not json", [bakPath(name)]: newSave(7) }) }, async (v) => midGame(v));
// A fresh start shows the new game the store began (r2-23: no mid-game folds under it).
add("banner-fresh", { roster: STD, files: (name) => ({ [savePath(name)]: '"old shape"', [bakPath(name)]: "[]" }) }, async (v) => {
  S(v).ui.details = true;
});
add("banner-conflict", { roster: STD }, async (v, tools) => {
  midGame(v);
  // Another writer changes the file between every check and rename: retries run out.
  const s = state();
  for (let i = 0; i < 4; i++) {
    const other = JSON.parse(serialize(s));
    other.state.applied[`rival-${i}`] = 1;
    tools.ctl.raceNextWrite(serialize(rebuilt(other.state)), savePath("banner-conflict"));
  }
  act(v, { type: "buy", item: "paper-stack", count: 1 });
  await tools.advance(3000);
  if (!lastNotice() || lastNotice().kind !== "conflict") store.refreshNotice(slot());
});
add("banner-merged", { roster: STD }, async (v, tools) => {
  midGame(v);
  await tools.advance(16000);
  const text = tools.ctl.readFile(savePath("banner-merged"));
  const doc = JSON.parse(text);
  const st = rebuilt(doc.state);
  apply(st, { w: "other-window", s: 1, t: Date.now(), type: "click", target: "sheet" });
  tools.ctl.externalWrite(savePath("banner-merged"), serialize(st));
  act(v, { type: "buy", item: "paper-stack", count: 1 });
  await tools.advance(3500);
});
add("banner-error", { roster: STD }, async (v, tools) => {
  midGame(v);
  for (let i = 0; i < 6; i++) tools.ctl.failNextWrite("Permission denied (os error 13)", savePath("banner-error"));
  act(v, { type: "buy", item: "paper-stack", count: 1 });
  await tools.advance(3500);
});
add("banner-newer", { roster: STD, files: (name) => ({ [savePath(name)]: newerSave() }) });
add("banner-clock", { roster: STD }, async (v, tools) => {
  midGame(v);
  // The wall clock moves back 10 minutes (timers keep their own clock): one tick sees it.
  const virtual = Date.now;
  Date.now = () => virtual() - 10 * 60000;
  try {
    await tools.advance(1000);
  } finally {
    Date.now = virtual;
  }
});

add("rail", { roster: { needs: 2, finished: 1, working: 6, resting: 3 }, size: { width: 64, height: 784 } }, async (v, tools) => {
  midGame(v);
  await finish(tools, ["t4", "t8"]);
});
add("rail-64", { roster: { needs: 5, finished: 3, working: 30, resting: 26 }, size: { width: 64, height: 584 } }, async (v, tools) => {
  midGame(v, 3.12e9);
  await finish(tools, ["t10", "t30"]);
});
add("rail-banner", { roster: STD, size: { width: 64, height: 784 } }, async (v, tools) => {
  midGame(v);
  for (let i = 0; i < 6; i++) tools.ctl.failNextWrite("No space left on device (os error 28)", savePath("rail-banner"));
  act(v, { type: "buy", item: "paper-stack", count: 1 });
  await tools.advance(3500);
});

const RIBBON_ROSTERS = {
  0: {},
  4: { needs: 1, finished: 1, working: 1, resting: 1 },
  34: { needs: 3, finished: 2, working: 14, resting: 15 },
  64: { needs: 5, finished: 3, working: 30, resting: 26 },
  130: { needs: 7, finished: 5, working: 64, resting: 54 },
};
for (const n of [0, 4, 34, 64, 130]) {
  for (const win of [1100, 1440]) {
    add(`ribbon-${n}-${win}`, { roster: RIBBON_ROSTERS[n], role: "ribbon", size: { width: RIBBON_W[win], height: 30 } }, async (v, tools) => {
      midGame(v, n > 60 ? 3.12e9 : 2.5e5);
      if (n) await finish(tools, [`t${n}`, `t${Math.max(1, n - 2)}`]);
    });
  }
}
// The ribbon block of the whole-window shots (same roster as flock-12, the panel block).
add("ribbon-window", { roster: { needs: 2, finished: 1, working: 5, resting: 4, kids: true }, role: "ribbon", size: { width: 1172, height: 30 }, block: "cw-ribbon" }, async (v, tools) => {
  midGame(v);
  await finish(tools, ["t3", "t7", "t9"]);
});

// Panel widths the shipped layout gives (ARCHITECTURE B15; DESIGN §2.4 states):
// narrow = 1100 x 700 as shipped (226, Narrow), narrow-files = 1100 x 700 with
// Files open (146: drawn as the rail, below 200), wide = Wide at 440, wide-2560 = 2560 x 1440 (636: no max).
add("narrow", { roster: { needs: 1, finished: 1, working: 6, resting: 4 }, size: { width: 226, height: 584 } }, async (v) => midGame(v));
add("narrow-files", { roster: { needs: 1, finished: 1, working: 6, resting: 4 }, size: { width: 146, height: 584 } }, async (v) => midGame(v));
add("wide", { roster: { needs: 1, finished: 1, working: 6, resting: 4 }, size: { width: 440, height: 784 } }, async (v) => midGame(v));
add("wide-2560", { roster: { needs: 2, finished: 2, working: 18, resting: 8 }, size: { width: 636, height: 1324 } }, async (v) => midGame(v));
add("short", { roster: STD, size: { width: 320, height: 584 } }, async (v, tools) => {
  midGame(v);
  await spawnNow(v, tools, "nextChainAt");
});
add("calm", { roster: { needs: 2, finished: 1, working: 3, resting: 2 } }, async (v, tools) => {
  midGame(v);
  act(v, { type: "setting", key: "calm", value: true });
  act(v, { type: "setting", key: "pops", value: false });
  await finish(tools, ["t3", "t4"]);
});

/** A parsed save state with its null-prototype maps (for another writer's edits). */
function rebuilt(st) {
  for (const k of ["applied", "writersSeen", "owned", "bought", "auto", "helpers", "envelopes"]) {
    const m = Object.create(null);
    for (const key of Object.keys(st[k] || {})) m[key] = st[k][key];
    st[k] = m;
  }
  for (const k of ["bySource", "runBySource"]) {
    const m = Object.create(null);
    for (const key of Object.keys(st.stats[k] || {})) m[key] = st.stats[k][key];
    st.stats[k] = m;
  }
  return st;
}

/** A save from a newer Creaseworks (version 99, valid check). */
function newerSave() {
  const s = newGame({ seed: 3, now: T0 - 500, day: localDay(T0 - 500) });
  s.version = 99;
  return serialize(s).replace(/"version":1,/, '"version":99,');
}

export default VIEWS;

/** The workspace data the whole-window shots draw in the mock sidebar and tabs. */
export const windowScenario = {
  get agents() {
    return roster({ needs: 2, finished: 1, working: 5, resting: 4, kids: true }).agents;
  },
  get terminals() {
    return roster({ needs: 2, finished: 1, working: 5, resting: 4, kids: true }).terminals;
  },
  zoom: 1,
};


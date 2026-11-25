// Hero-shot scenarios for tools/shots/hero.mjs (the GitHub README images).
//
// Same contract as mods/creaseworks/glue/views.js ({ name, scenario, setup,
// block }) plus an optional `finale(view, tools)` that hero.mjs runs after the
// rig's settling ticks, right before the frame is rendered (a click whose "+N"
// pop is still on the mat, a tile clicked). Same honesty rule: every view is
// the REAL mod loaded under the mock herdr, played into shape by dispatching
// engine actions through the session (Sheet clicks, buys, a wish, finished
// turns) or by firing the rendered elements' own click handlers. Where a
// moment needs luck or hours (a storm, a crane's spawn time) setup moves the
// one engine field that decides it and lets the engine do the rest, exactly as
// views.js does. Nothing here draws pixels.
//
// One save, one moment: every view starts from MOMENT (seed, herd and play
// are identical), a second run after the first wish (10 Wishes), so the
// close-ups and the hero show the same game. A view then adds only what it is
// about (a tab, a storm, seven hours away, a click).
//
// The workspace (`heroRoster`) is shared by the mod's scenario and the window
// chrome, so the sidebar, tabs, terminals, panel and ribbon describe the same
// herd of 34. The active tab holds three panes with different programs
// (a Claude Code that needs you, a zsh shell, a Codex that finished), all in
// ~/code/herdr-clicker, which is what the rig's canned transcripts edit.

import { newGame, serialize, wishInfo } from "../../mods/creaseworks/engine/index.js";
import { WISH_MOMENT } from "../../mods/creaseworks/engine/view.js";
import { localDay } from "../../mods/creaseworks/glue/clock.js";
import { getSlot, dropSlot } from "../../mods/creaseworks/glue/live.js";
import { beginRender, renderRoot, fire } from "../mock/gpui-kit.js";

/** The mock's start time (tools/mock/controller.js DEFAULT_NOW). */
const T0 = 1767258000000;

const CLAUDE = { key: "claude", name: "Claude Code", agent: true, shell: false };
const CODEX = { key: "codex", name: "Codex", agent: true, shell: false };
const ZSH = { key: "zsh", name: "zsh", agent: false, shell: true };

const SPACES = [
  { id: "s1", name: "herdr-clicker", cwd: "~/code/herdr-clicker" },
  { id: "s2", name: "website", cwd: "~/code/website" },
  { id: "s3", name: "acme-api", cwd: "~/code/acme-api" },
  { id: "s4", name: "infra", cwd: "~/code/infra" },
];

/**
 * Pinned panes. herdr-clicker's "engine" tab is the active one (the hero's
 * three panes); its "ui" tab holds the agent the jump shot clicks through to.
 * Titles match the rig's canned transcripts (tools/render/window.mjs
 * terminalLines: the closed-form diff, the save codec, the shop.js edit).
 */
const PINNED = [
  { space: 0, tab: "engine", status: "blocked", raw: "blocked", title: "Make the offline catch-up closed-form", program: CLAUDE, focused: true },
  { space: 0, tab: "engine", status: "idle", raw: null, title: "", program: ZSH },
  { space: 0, tab: "engine", status: "done", raw: "idle", title: "Save codec tests", program: CODEX },
  { space: 0, tab: "ui", status: "blocked", raw: "blocked", title: "Shop panel layout", program: CLAUDE, jump: true },
  { space: 0, tab: "ui", status: "working", raw: "working", title: "Ribbon status icons", program: CODEX },
];
/** Where the rest of the herd lives: [space index, tab name, how many]. */
const REST_PLACES = [[0, "tests", 4], [1, "blog", 5], [1, "deploy", 4], [2, "server", 6], [2, "jobs", 4], [3, "ops", 6]];

const TITLES = [
  "Fix flaky login test", "Write the release notes", "Migrate to the new router", "Review dependency bumps",
  "Port parser to streams", "Draft API docs", "Tidy CSS tokens", "Investigate memory spike", "Translate settings page",
  "Bump the build image", "Split the search index", "Cache the font metrics", "Audit the error pages",
  "Rename the config keys", "Shrink the bundle", "Trace the slow query", "Fix the RSS feed dates",
];

/** The herd besides PINNED: 3 need you, 2 finished, 15 working, 14 resting in all (34). */
export const HERD = { needs: 1, finished: 1, working: 14, resting: 13 };

/**
 * herdr agents + terminals, grouped by space and tab as herdr's sidebar lists
 * them: PINNED first, then `rest` = { needs, finished, working, resting } in a
 * stride order over REST_PLACES (so no tab is all one status), and `kids`
 * subagent terminals under working parents. Join order (created_ms) is mixed
 * across spaces.
 */
export function heroRoster(rest = HERD, kids = 6) {
  const order = [];
  for (const [key, status, raw] of [["needs", "blocked", "blocked"], ["finished", "done", "idle"], ["working", "working", "working"], ["resting", "idle", "idle"]]) {
    for (let i = 0; i < (rest[key] || 0); i++) order.push({ status, raw });
  }
  const len = order.length;
  let stride = 7;
  while (len > 1 && gcd(stride, len) !== 1) stride += 2;
  const mixed = order.map((_, i) => order[(i * stride) % len]);
  const specs = PINNED.map((p) => ({ ...p }));
  let k = 0;
  for (const [space, tab, n] of REST_PLACES) {
    for (let j = 0; j < n && k < mixed.length; j++, k++) {
      specs.push({ ...mixed[k], space, tab, title: TITLES[k % TITLES.length], program: k % 3 === 1 ? CODEX : CLAUDE });
    }
  }
  for (; k < mixed.length; k++) specs.push({ ...mixed[k], space: 3, tab: "ops", title: TITLES[k % TITLES.length], program: CLAUDE });
  // Tab ids/indexes per space in first-seen order.
  const tabs = new Map();
  const agents = [];
  const terminals = [];
  specs.forEach((spec, i) => {
    const sp = SPACES[spec.space];
    const key = `${sp.id}:${spec.tab}`;
    if (!tabs.has(key)) tabs.set(key, [...tabs.keys()].filter((x) => x.startsWith(`${sp.id}:`)).length + 1);
    const tabIndex = tabs.get(key);
    const n = i + 1;
    agents.push({
      address: `t${n}`, pane: `p${n}`, status: spec.status, title: spec.title, program: spec.program, cwd: sp.cwd,
      space: sp.id, space_name: sp.name, tab: `${sp.id}-c${tabIndex}`, tab_index: tabIndex, tab_name: spec.tab, focused: spec.focused === true,
    });
    // Joined over the last hour, not in sidebar order.
    const joined = T0 - 3600000 + ((n * 7) % specs.length) * 997 + n;
    terminals.push({ address: `t${n}`, status: spec.raw, turn: spec.status === "done" ? 1 : 0, created_ms: joined });
  });
  const parents = agents.filter((a) => a.status === "working");
  for (let j = 0; j < kids && parents.length; j++) {
    const parent = parents[(j * 5) % parents.length];
    terminals.push({
      address: `k${j + 1}`, status: ["working", "done", "working", "idle"][j % 4], turn: 0, parent: parent.address,
      created_ms: T0 - 1800000 + j * 331, title: `subtask ${j + 1}`,
    });
  }
  return { agents, terminals };
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

/** Addresses by role in heroRoster(): the jump target, the finished panes, a few working ones. */
export function rosterRoles(roster = heroRoster()) {
  const a = roster.agents;
  return {
    jump: a[PINNED.findIndex((p) => p.jump)].address,
    jumpPane: a[PINNED.findIndex((p) => p.jump)].pane,
    done: a.filter((x) => x.status === "done").map((x) => x.address),
    working: a.filter((x) => x.status === "working").map((x) => x.address),
  };
}

const home = (name) => `/hero/${name}/herdr-app`;
const savePath = (name) => `${home(name)}/data/creaseworks/save.json`;
const SEED = 20260101;

function newSave(seed) {
  const t = T0 - 500;
  return serialize(newGame({ seed, now: t, day: localDay(t) }));
}

function scenarioFor(name) {
  const r = heroRoster();
  return {
    now: T0,
    patchDate: true,
    appHome: home(name),
    home: `/hero/${name}`,
    props: { role: "panel" },
    agents: r.agents,
    terminals: r.terminals,
    files: { [savePath(name)]: newSave(SEED) },
    window: { visible: true, active: true, platform: "linux" },
    zoom: 1,
  };
}

// ---------------------------------------------------------------------------
// Setup helpers (the same moves views.js makes)

const S = (view) => view.session;
const state = () => getSlot().state;
const act = (view, action) => S(view).dispatch(action, undefined);

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

/** The live element tree the view draws now (its handlers are the real ones). */
function live(view, tools) {
  beginRender();
  return tools.ctl.within("render", view, (cx) => renderRoot(view.render(cx)));
}

/** Fires a rendered element's own handler (a click as the shell delivers it). */
async function press(view, tools, id, event = "on_click", payload = {}) {
  const tree = live(view, tools);
  await tools.ctl.dispatch("event", view, (cx) => fire(tree, id, event, payload, cx));
}

/** Folds earned elsewhere in the run (a long session, compressed). */
function grant(folds) {
  const s = state();
  s.bank += folds;
  s.runFolds += folds;
  s.lifetime += folds;
}

/**
 * Splits a run's folds between its sources the way a played run would (as
 * views.js creditRun): helpers in falling shares, hands, workshops. Moves only
 * the fields the wish's garland reads.
 */
function creditRun() {
  const s = state();
  const run = s.runFolds;
  const panes = Object.keys(s.helpers).map((id) => s.helpers[id]).filter((h) => h.kind === "pane" && !h.gone);
  const parts = panes.map((_, i) => 1 / (i + 2));
  const sum = parts.reduce((a, x) => a + x, 0) || 1;
  panes.forEach((h, i) => {
    h.stats.run = Math.round((run * 0.62 * parts[i]) / sum);
  });
  s.stats.runBySource.sheet = Math.round(run * 0.17);
  s.stats.runBySource.workshops = Math.round(run * 0.1);
}

/** Buys `n` of each item the way the Shop does (×10 then ×1 presses); throws if one is refused. */
function buyAll(view, items) {
  for (const [id, n] of items) {
    let left = n;
    while (left > 0) {
      const step = left >= 10 ? 10 : 1;
      const before = state().bank;
      act(view, { type: "buy", item: id, count: step });
      if (state().bank === before) throw new Error(`hero-views: could not buy ${id} (×${step}, ${left} to go, bank ${Math.round(before)})`);
      left -= step;
    }
  }
}

/** Run 1, compressed: a full String, the two keep-basics items, a wish (10 Wishes). */
const RUN1_BUYS = [
  ["paper-stack", 50], ["bone-folder", 50], ["scissor-stand", 50], ["glue-pot", 40], ["fold-bench", 30], ["washi-vat", 25],
  ["flower-press", 12], ["crane-loft", 3], ["crisp-corners", 1], ["mail-sorter", 1], ["rice-treats", 1], ["soft-brushes", 1],
];

/** Run 2 so far: a stocked mid-game, bought item by item (what the Shop shows owned). */
const RUN2_BUYS = [
  ["paper-stack", 10], ["bone-folder", 10], ["paper-stack-t1", 1], ["bone-folder-t1", 1],
  ["scissor-stand", 10], ["scissor-stand-t1", 1], ["paper-stack", 15], ["paper-stack-t2", 1], ["bone-folder", 15], ["bone-folder-t2", 1],
  ["bone-tip-nail", 1], ["rice-treats", 1], ["echo-1", 1], ["steady-rhythm", 1], ["wax-seal", 1], ["deep-rest", 1],
  ["long-crease", 1], ["glue-pot", 10], ["glue-pot-t1", 1], ["valley-fold", 1], ["crane-bait", 1], ["fledgling-wings", 1],
  ["scissor-stand", 12], ["soft-brushes", 1], ["scrap-basket", 1], ["long-ribbon", 1], ["quick-creases", 1],
  ["long-streak", 1], ["fold-bench", 6], ["glue-pot", 4], ["grand-crease", 1], ["paper-stack", 15], ["bone-folder", 5],
];
/** Folds run 2 has made: what RUN2_BUYS cost plus the ~1.3M in the bank now. */
const RUN2_FOLDS = 9.4e6;

/**
 * THE moment every view starts from: the first wish made, a second run two
 * hours in (shop stocked, Wishes 10), envelopes on the finished helpers and
 * two working ones, a scrap and a chain of seven on the mat (two nodes
 * done). The views that show the mat let a gilded crane in at the end.
 */
async function moment(v, tools) {
  // Run 1.
  grant(6.3e9);
  buyAll(v, RUN1_BUYS);
  await sheetHits(v, tools, 4);
  creditRun();
  if (!wishInfo(state()).can) throw new Error("hero-views: run 1 cannot wish");
  act(v, { type: "wish" });
  await tools.advance(WISH_MOMENT.settleMs + 1000);
  // Run 2.
  grant(RUN2_FOLDS);
  buyAll(v, RUN2_BUYS);
  // Bundles wait in the tray to be opened by hand (the Mail Sorter, kept by the wish, switched off).
  act(v, { type: "switch", id: "mail-sorter", on: false });
  const roles = rosterRoles();
  // The finished helpers' turns end (they stay done: an envelope on a FINISHED tile), and two working ones finish a task.
  await finish(tools, roles.done, null);
  await finish(tools, [roles.working[2], roles.working[9]]);
  await spawnNow(v, tools, ["nextScrapAt"]);
  await spawnNow(v, tools, ["nextChainAt"]);
  await chainClicks(v, tools, 2);
}

/** Finishes a task on the given agents (turn +1; `status` null keeps their status), then ticks so envelopes land. */
async function finish(tools, list, status = "working") {
  const next = tools.ctl.terminalsList.map((t) => ({ ...t }));
  for (const t of next) {
    if (list.includes(t.address)) {
      t.turn = (t.turn || 0) + 1;
      if (status) t.status = status;
    }
  }
  tools.ctl.setTerminals(next);
  await tools.advance(1000);
}

/**
 * Runs the given spawn clocks out (the engine spawns the pieces on the next
 * active second). A player past their first crane: the one-time crane line is
 * already seen, so it does not cover the mat.
 */
async function spawnNow(view, tools, keys) {
  const sp = state().spawn;
  if (keys.includes("nextCraneAt")) sp.cranesSeen = Math.max(sp.cranesSeen, 3);
  for (const k of keys) sp[k] = sp.activeMs + 1;
  await sheetHits(view, tools, 2, 300);
  await tools.advance(1000);
}

/**
 * Lets a gilded crane in now and stops the clock as soon as it is on the mat:
 * it glides across the mat over its 13 s, and the frame is taken in its first
 * second, where it is clear of the Sheet.
 */
async function craneJustIn(view, tools) {
  const sp = state().spawn;
  sp.cranesSeen = Math.max(sp.cranesSeen, 3);
  sp.nextCraneAt = sp.activeMs + 1;
  for (let i = 0; i < 15 && !sp.crane; i++) await keepRhythm(view, tools, i);
  if (!state().spawn.crane) throw new Error("hero-views: no crane came in");
}

/** 100 ms of waiting with a Sheet hit every 300 ms, so the streak does not lapse. */
async function keepRhythm(view, tools, i) {
  if (i % 3 === 2) act(view, { type: "click", target: "sheet" });
  await tools.advance(100);
}

/** Runs the scrap clock out and stops as soon as a new scrap lies on the mat. */
async function scrapJustIn(view, tools) {
  const sp = state().spawn;
  const had = sp.scraps.length;
  sp.nextScrapAt = sp.activeMs + 1;
  for (let i = 0; i < 15 && sp.scraps.length <= had; i++) await keepRhythm(view, tools, i);
  if (state().spawn.scraps.length <= had) throw new Error("hero-views: no scrap came in");
}

/** Clicks the next due chain node `n` times (through the node's own handler). */
async function chainClicks(view, tools, n, gap = 200) {
  for (let i = 0; i < n; i++) {
    const node = S(view).vm().mat.nodes.find((x) => x.due);
    if (node) await press(view, tools, `cw-node-${node.id}`);
    await tools.advance(gap);
  }
}

/** Sheet hits through the Sheet's own mouse-down handler (pops at the click point). */
async function sheetPresses(view, tools, n, gap = 180) {
  const spots = [[40, 52], [70, 38], [58, 74], [30, 30], [82, 64], [50, 50]];
  for (let i = 0; i < n; i++) {
    const [x, y] = spots[i % spots.length];
    await press(view, tools, "cw-sheet", "on_mouse_down", { local_position: { x, y } });
    if (i < n - 1) await tools.advance(gap);
  }
}

// ---------------------------------------------------------------------------
// The table

/** The panel's size while setup runs (hero.mjs passes the block's real size as tools.block). */
const PANEL = { width: 465, height: 874 };

function view(name, setup, finale) {
  return {
    name,
    block: "cw-panel",
    get scenario() {
      const left = getSlot();
      if (left && left.home === home(name)) dropSlot();
      return scenarioFor(name);
    },
    async setup(v, tools) {
      await begin(v, tools, tools.block ?? PANEL, 3);
      await moment(v, tools);
      if (setup) await setup(v, tools);
    },
    finale,
  };
}

/** The last few Sheet hits of a rhythm: the streak meter up and the last hit's "+N" still on the mat. */
const keepFolding = (n = 9) => async (v, tools) => {
  await sheetPresses(v, tools, n - 1);
  await craneJustIn(v, tools);
  await sheetPresses(v, tools, 1);
};

/** The hero: the moment, mid-rhythm. */
export const HERO = view("hero", null, keepFolding());

/** The moment folded to the rail (no mat to click: the frame is the moment as it stands). */
export const RAIL = view("rail");

/** The mat close-up: a scrap picked up (its "+N" rises from where it lay), the chain waiting, the crane gliding. */
export const MAT = view("mat", null, async (v, tools) => {
  await sheetPresses(v, tools, 5);
  await scrapJustIn(v, tools);
  await craneJustIn(v, tools);
  // A scrap clear of the crane and of the mat's right edge, so its "+N" reads in full.
  const mat = S(v).vm().mat;
  const away = (s) => Math.hypot(s.x - (mat.crane.x + 24), s.y - (mat.crane.y + 18)) - (s.x > 250 ? 1000 : 0);
  const scrap = mat.scraps.slice().sort((a, b) => away(b) - away(a))[0];
  if (!scrap) throw new Error("hero-views: no scrap on the mat");
  await press(v, tools, `cw-scrap-${scrap.id}`);
});

/**
 * The frenzy: a Paper Storm and a Rush running (as views.js "storm" starts
 * them: the boost clocks a crane's storm or an opened envelope would set),
 * fast clicking (the streak meter high), a fresh gilded crane and scraps. A
 * storm drops a chain every 4 s, so two are usually on the mat: the older one
 * is finished node by node (its crease line drawn, the finishing "+N" on the
 * mat), leaving one chain.
 */
export const FRENZY = view("frenzy", async (v, tools) => {
  const b = state().boosts;
  const t = Date.now();
  b.stormEnd = t + 21000;
  b.storm = 21000;
  b.rushEnd = t + 55000;
  b.rush = 55000;
  await sheetHits(v, tools, 12, 250);
}, async (v, tools) => {
  const sp = state().spawn;
  // Fast clicking (the streak climbs) until the storm drops a fresh chain.
  const fresh = () => [sp.chain, sp.chain2].some((c) => c && sp.shownMs - c.born < 600);
  for (let i = 0; i < 120 && !fresh(); i++) {
    await sheetPresses(v, tools, 1);
    await tools.advance(100);
  }
  if (!fresh()) throw new Error("hero-views: the storm dropped no chain");
  await scrapJustIn(v, tools);
  await craneJustIn(v, tools);
  await sheetPresses(v, tools, 6, 100);
  await tools.advance(100);
  if (sp.chain && sp.chain2) {
    // Finish the older chain.
    const older = sp.chain.born <= sp.chain2.born ? "chain" : "chain2";
    const prefix = String(sp[older].id);
    for (let i = 0; i < 8 && sp[older]; i++) {
      const node = S(v).vm().mat.nodes.find((x) => x.due && String(x.id).startsWith(`${prefix}-`));
      if (!node) break;
      await press(v, tools, `cw-node-${node.id}`);
      if (sp[older]) await tools.advance(100);
    }
  } else {
    await chainClicks(v, tools, 2, 100);
    const node = S(v).vm().mat.nodes.find((x) => x.due);
    if (!node) throw new Error("hero-views: no chain on the frenzy mat");
    await press(v, tools, `cw-node-${node.id}`);
  }
});

/** The Flock with every group open. */
export const FLOCK = view("flock", async (v) => {
  S(v).ui.folded.resting = false; // a herd this size starts with Resting folded: open it, as a click on its header does
});

export const SHOP = view("shop", async (v) => {
  const ui = S(v).ui;
  ui.tab = "shop";
  ui.segment = "works";
});

/**
 * The same game later: run 2 played on into the late game until a second
 * wish is ready (a full String of 1,000 past the first wish's 1,000).
 */
export const STRING = view("string", async (v, tools) => {
  grant(4.3e10);
  buyAll(v, [["washi-vat", 30], ["flower-press", 20], ["crane-loft", 10], ["kite-tower", 2], ["snug-bench", 1], ["paper-hats", 1]]);
  await tools.advance(1000);
  if (!wishInfo(state()).can) throw new Error("hero-views: no wish ready");
  S(v).ui.tab = "string";
});

/**
 * Back after seven hours: the chain on the mat finished first, then the
 * player leaves; the herd works on (tasks finish between the stretches), and
 * the ticks credit the away time and show the card.
 */
export const AWAY = view("away", async (v, tools) => {
  await chainClicks(v, tools, 5, 150);
  const w = rosterRoles().working;
  // Seven hours in four stretches (the laptop asleep, herdr's window closed); helpers finish tasks in between.
  const batches = [[w[0], w[5], w[11]], [w[0], w[3]], [w[0], w[5], w[8]], [w[0], w[11]]];
  for (const list of batches) {
    tools.ctl.setNow(Date.now() + 1.75 * 3600000);
    await finish(tools, list);
  }
  await tools.advance(1000);
});

/** The jump: the needs-you tile of the agent in the "ui" tab, clicked. */
export const JUMP = view("jump", null, async (v, tools) => {
  const addr = rosterRoles().jump;
  const s = state();
  const id = Object.keys(s.helpers).find((k) => s.helpers[k].addr === addr);
  if (!id) throw new Error("hero-views: no helper for the jump target");
  await press(v, tools, `cw-flock-tile-${id}`);
});

export default [HERO, RAIL, MAT, FRENZY, FLOCK, SHOP, STRING, AWAY, JUMP];

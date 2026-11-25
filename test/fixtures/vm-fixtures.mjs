// Sample ViewModels in exactly the ARCHITECTURE B6 shape, one per screenshot
// view of DESIGN §15.3. The UI builders render from these until the real
// engine `view()` exists; the shots rig and the UI tests use them too.
// Deterministic: no clock, no randomness; helper ids and looks come from the
// engine's own identity hash (helperId / lookOf), strings from its formatters.
//
//   viewModel(name, opts?)  → ViewModel (B6)
//   scenario(name, opts?)   → { name, role, width, height, ui, vm }
//   VIEW_NAMES              → every view name (ribbon-* once; pick the window
//                             width with opts.window = 1100 | 1440)
//
// `scenario().ui` is the per-copy UI state the Session keeps (B7: tab,
// selected tile, confirm card, open details); `width`/`height` are the
// panel's Wp × H (or the ribbon's work width × 30).

import {
  helperId, lookOf, clip, formatCount, formatRate, formatDuration, fnv1a32n, slotXY, CONTENT,
} from "../../mods/creaseworks/engine/index.js";

// ---------------------------------------------------------------------------
// Names

export const SHOP_SEGMENTS = Object.freeze(["works", "tools", "folk", "charms", "curios", "auto"]);
export const STRING_STATES = Object.freeze(["locked", "ready", "confirm"]);
export const BANNER_KINDS = Object.freeze(["recovered", "fresh", "conflict", "merged", "error", "newer", "clock"]);
export const RIBBON_COUNTS = Object.freeze([0, 4, 34, 64, 130]);
/** Window width → ribbon work width W (window − 268 px sidebar, DESIGN §3.10). */
export const RIBBON_WIDTHS = Object.freeze({ 1100: 832, 1440: 1172 });

export const VIEW_NAMES = Object.freeze([
  "empty", "first-run", "standard-4", "needs-you-3", "finished-2", "tray-full", "storm", "crane", "boat",
  "chain-7", "in-step", "flock-12", "flock-34", "flock-64-dense", "flock-elsewhere", "album",
  ...SHOP_SEGMENTS.map((s) => `shop-${s}`),
  ...STRING_STATES.map((s) => `string-${s}`),
  "garlands", "settings", "away", "busy",
  ...BANNER_KINDS.map((k) => `banner-${k}`),
  "rail", "rail-64", "rail-banner",
  ...RIBBON_COUNTS.map((n) => `ribbon-${n}`),
  "narrow", "wide", "short", "calm",
]);

// ---------------------------------------------------------------------------
// Constants

const BASE_CREATED = 1767225600000; // 2026-01-01T00:00:00Z; any fixed value works
const STATUS_WORD = { working: "Working", blocked: "Needs you", done: "Finished", idle: "Resting" };
const GROUP_OF = { blocked: "needs", done: "finished", working: "working", idle: "resting" };
const GROUP_ORDER = ["needs", "finished", "working", "resting"];
const GROUP_TITLE = { needs: "Needs you", finished: "Finished", working: "Working", resting: "Resting" };
const STATUS_RANK = { blocked: 0, done: 1, working: 2, idle: 3 };

const TITLES = [
  "claude · fix flaky test in uploader",
  "codex · add retry to the sync worker",
  "claude · write migration for users table",
  "aider · rename config keys",
  "claude · review PR 412 🚀 and leave notes",
  "codex · port the parser to streaming input",
  "claude · bump dependencies and rerun CI",
  "gemini · draft release notes for 0.9",
  "claude · profile the render loop 👩‍💻",
  "codex · split settings into sections",
  "claude · investigate the 502s on staging 🇯🇵",
  "opencode · tidy up the README examples",
];
const SPACES = ["api", "web", "infra", "docs"];
const ENVELOPE_CYCLE = ["bundle", "rush", "bundle", "chorus", "bundle", "storm", "bundle", "rush", "bundle", "bundle"];

// ---------------------------------------------------------------------------
// Helpers (tiles, marks)

/**
 * A roster spec: `{ needs, finished, working, resting, elsewhere, album,
 * envelopes, kids, rest, pulse, spin, start }`. Helpers are numbered from
 * `start` (default 0) so different views reuse the same identities.
 */
function roster(spec) {
  const order = [];
  const push = (status, n) => {
    for (let i = 0; i < (n || 0); i++) order.push(status);
  };
  // Interleave so join order mixes statuses (tiles keep join order inside a group).
  const counts = { blocked: spec.needs || 0, done: spec.finished || 0, working: spec.working || 0, idle: spec.resting || 0 };
  const total = counts.blocked + counts.done + counts.working + counts.idle;
  const cycle = ["working", "idle", "blocked", "working", "done", "idle"];
  let guard = 0;
  while (order.length < total && guard < total * 12) {
    const s = cycle[guard % cycle.length];
    if (counts[s] > 0) {
      order.push(s);
      counts[s] -= 1;
    }
    guard += 1;
  }
  for (const s of ["working", "idle", "blocked", "done"]) push(s, counts[s]);

  const start = spec.start || 0;
  const names = new Map();
  const present = order.map((status, j) => helper(start + j, status, spec, names, j));
  const elsewhere = [];
  for (let j = 0; j < (spec.elsewhere || 0); j++) {
    const status = ["working", "idle", "working", "blocked"][j % 4];
    const h = helper(start + 500 + j, status, spec, names, j);
    h.opacity = 0.5;
    h.pulse = false;
    h.spin = false;
    h.envelope = false;
    elsewhere.push(h);
  }
  const album = [];
  for (let j = 0; j < (spec.album || 0); j++) {
    const id = helperId(`gone/t${start + 900 + j}`, BASE_CREATED + j * 7919);
    const look = lookOf(id);
    album.push({
      helperId: id,
      name: uniqueName(look.name, names),
      species: look.species,
      hue: look.hue,
      leftAgo: formatDuration((j + 1) * 3 * 3600000 + j * 86400000, { spaced: true, parts: 1 }),
      folds: formatCount(1.3e6 / (j + 1) + j * 4321),
    });
  }
  return { present, elsewhere, album };
}

function uniqueName(base, names) {
  const n = (names.get(base) || 0) + 1;
  names.set(base, n);
  return n === 1 ? base : `${base} ${n}`;
}

function helper(k, status, spec, names, j) {
  const addr = `${SPACES[k % SPACES.length]}/t${k + 1}`;
  const created = BASE_CREATED + k * 61000;
  const id = helperId(addr, created);
  const look = lookOf(id);
  const name = uniqueName(look.name, names);
  const space = SPACES[k % SPACES.length];
  const tab = `tab ${(k % 3) + 1}`;
  const title = clip(TITLES[k % TITLES.length], 60);
  const word = STATUS_WORD[status];
  const envelopeEvery = spec.envelopes === "all" ? 1 : spec.envelopes > 0 ? Math.max(1, Math.floor(1 / spec.envelopes)) : 0;
  const kids = spec.kids && k % 4 === 1 ? ["working", "idle", "working", "blocked", "working", "idle"].slice(0, 1 + (k % 6)) : [];
  const waited = `${(k % 9) + 2} m`;
  return {
    helperId: id,
    name,
    species: look.species,
    hue: look.hue,
    status,
    statusWord: word,
    envelope: envelopeEvery > 0 && j % envelopeEvery === 0,
    pips: kids,
    rest: status === "idle" ? Math.min(1, ((k * 37) % 100) / 100 + 0.05) : null,
    pulse: Boolean(spec.pulse) && status === "blocked",
    spin: Boolean(spec.spin) && status === "working",
    dashed: status === "blocked",
    opacity: status === "idle" ? 0.8 : 1,
    tooltip: `${name} · ${look.species} · ${word} · ${title} · ${space} / ${tab}`,
    pane: `p_${k + 1}`,
    addr,
    kind: "pane",
    // Not part of Tile: used to build marks, then dropped.
    _mark: `${name} — ${title.split(" · ")[0]} · ${space} / ${tab} — ${word}${status === "blocked" ? ` · ${waited}` : ""}`,
  };
}

function tileOf(h) {
  const { _mark, ...tile } = h;
  return tile;
}

function markOf(h, opacity = h.opacity === 0.5 ? 0.5 : 1) {
  return { helperId: h.helperId, status: h.status, hue: h.hue, envelope: h.envelope, dashed: h.dashed, opacity, tooltip: h._mark };
}

/** Present helpers in group order, join order inside a group. */
function byGroup(present) {
  return present
    .map((h, i) => ({ h, i }))
    .sort((a, b) => STATUS_RANK[a.h.status] - STATUS_RANK[b.h.status] || a.i - b.i)
    .map((x) => x.h);
}

function cap(list, n, pulseLimit) {
  let pulses = 0;
  for (const h of list) {
    if (h.pulse) {
      pulses += 1;
      if (pulses > pulseLimit) h.pulse = false;
    }
  }
  return list.slice(0, n);
}

/** B6 `ribbon` for `n` marks at work width W (DESIGN §3.10 density table). */
function ribbonFor(present, elsewhere, W) {
  const w = W - 16 - 118 - 100 - 16;
  const all = byGroup(present).map((h) => markOf(h)).concat(elsewhere.map((h) => markOf(h, 0.5)));
  const n = all.length;
  if (n * 22 <= w) return { marks: all, level: "A", tallies: [] };
  if (n <= 2 * Math.floor(w / 14)) return { marks: all, level: "B", tallies: [] };
  const marks = all.filter((m) => m.status === "blocked" || m.status === "done");
  const tallies = [];
  for (const status of ["working", "idle"]) {
    const count = all.filter((m) => m.status === status).length;
    if (count > 0) tallies.push({ status, count });
  }
  return { marks, level: "C", tallies };
}

// ---------------------------------------------------------------------------
// Shop

function workshopCost(base, owned) {
  return base * Math.pow(CONTENT.GROWTH, owned);
}

const SEG_ICON = { tools: "hand", folk: "paw", charms: "ribbon", curios: "curio", auto: "cog" };

function shopFor(bank, rate, owned, bought) {
  const works = [];
  let bestId = null;
  let bestPayback = Infinity;
  CONTENT.WORKSHOPS.forEach((w, i) => {
    const n = owned[i] || 0;
    const cost = workshopCost(w.base, n);
    const prevOwned = i === 0 || (owned[i - 1] || 0) > 0;
    const affordable = cost <= bank;
    const each = w.out * (n >= 10 ? 2 : 1);
    if (affordable && cost / each < bestPayback) {
      bestPayback = cost / each;
      bestId = w.id;
    }
    const sub = [];
    CONTENT.TIERS.forEach((t) => {
      const tid = `${w.id}-t${t.n}`;
      if (n >= t.at && !bought.has(tid)) {
        const tcost = w.base * t.mult;
        sub.push(row(tid, `${w.name}: ${t.name}`, 0, tcost, bank, rate, `${w.name} ×2`, w.id, true, true));
      }
    });
    const effect = `${formatRate(each)} each · ${formatRate(each * n, "short", { sign: false })} total`;
    works.push(row(w.id, w.name, n, cost, bank, rate, effect, w.id, false, prevOwned, sub));
  });
  for (const r of works) r.best = r.id === bestId;

  const segments = { works, tools: [], folk: [], charms: [], curios: [], auto: [] };
  for (const u of CONTENT.UPGRADES) {
    const have = bought.has(u.id);
    const revealed = have || u.cost <= 3 * bank || (u.req ? bought.has(u.req) : false);
    segments[u.seg].push(row(u.id, u.name, have ? 1 : 0, u.cost, bank, rate, u.text, SEG_ICON[u.seg], false, revealed));
  }
  for (const a of CONTENT.AUTOMATIONS) {
    const have = bought.has(a.id);
    segments.auto.push(row(a.id, a.name, have ? 1 : 0, a.cost, bank, rate, a.text, SEG_ICON.auto, false, have || a.cost <= 3 * bank));
  }
  return { segments };
}

function row(id, name, owned, cost, bank, rate, effect, icon, tier, revealed, sub = []) {
  const affordable = cost <= bank;
  const eta = affordable || !(rate > 0) ? null : `in ${formatDuration(((cost - bank) / rate) * 1000)}`;
  return { id, name, owned, cost: formatCount(cost), affordable, best: false, eta, effect, icon, tier, revealed, sub };
}

const STANDARD_OWNED = [42, 25, 17, 9, 3, 1, 0, 0, 0];
const STANDARD_BOUGHT = new Set([
  "paper-stack-t1", "paper-stack-t2", "bone-folder-t1", "crisp-corners", "bone-tip-nail", "echo-1", "steady-rhythm",
  "rice-treats", "deep-rest", "wax-seal", "long-crease", "crane-bait", "mail-sorter",
]);

// ---------------------------------------------------------------------------
// The base ViewModel and its parts

function settingsVm(over = {}) {
  const bought = over.bought || STANDARD_BOUGHT;
  const autoOn = over.autoOn || { "mail-sorter": true };
  return {
    calm: false,
    gather: true,
    nodes: true,
    pops: true,
    notify: { master: false, full: true, pile: true, save: true },
    order: "urgency",
    density: "auto",
    style: "short",
    ...over.values,
    notifySentToday: over.sent ?? 0,
    automations: CONTENT.AUTOMATIONS.map((a) => ({ id: a.id, name: a.name, owned: bought.has(a.id), on: bought.has(a.id) && Boolean(autoOn[a.id]) })),
  };
}

function stringVm(o = {}) {
  const wishes = o.wishes ?? 0;
  return {
    cranes: o.cranes ?? 742,
    of: 1000,
    nextIn: o.nextIn ?? "23.1M",
    lifetime: o.lifetime ?? "4.26B",
    gain: o.gain ?? 10,
    can: Boolean(o.can),
    perks: CONTENT.PERKS.map((p) => ({ at: p.at, text: p.text, have: wishes >= p.at })),
    garlands: o.garlands ?? [],
  };
}

function garlandsList(n, present) {
  const out = [];
  for (let g = 0; g < n; g++) {
    const stripes = [];
    let left = 100;
    const helpers = present.slice(0, Math.min(16, present.length));
    helpers.forEach((h, i) => {
      const weight = Math.max(1, Math.round((16 - i) * (1 + (g % 3)) / 4));
      stripes.push([`hue:${h.hue}`, weight, h.name]);
      left -= weight;
    });
    stripes.push(["hands", 18 - g, "your hands"]);
    stripes.push(["workshops", 30 + g * 4, "workshops"]);
    stripes.push(["rest", Math.max(2, left > 0 ? Math.round(left / 4) : 3), "everyone else"]);
    out.push({ wish: g + 1, day: `2026-11-${String(3 + g * 4).padStart(2, "0")}`, stripes, wishes: 10 + g * 3 });
  }
  return out;
}

const SHELF = ["crane", "frog", "fox", "koi", "rabbit", "turtle", "butterfly", "whale", "owl", "boat", "mouse", "snail"];

/**
 * The ViewModel builder all views start from. `o`: `{ roster, bank, rate,
 * wishes, frame, ticks, firstRunHint, short, matChipPulse, tray, mat,
 * streak, boosts, string, settings, away, notices, ribbonWidth, dense,
 * folded, workspace }`.
 */
function base(name, o = {}) {
  const spec = o.roster || {};
  const { present, elsewhere, album } = roster(spec);
  const grouped = byGroup(present);
  const counts = { needs: 0, finished: 0, working: 0, resting: 0 };
  for (const h of present) counts[GROUP_OF[h.status]] += 1;

  // Loop budget (DESIGN §13.5): ≤ 6 pulsing needs-you marks, ≤ 6 spins (In step) or ≤ 4 (new work).
  cap(grouped.filter((h) => h.status === "blocked"), Infinity, 6);
  let spins = 0;
  for (const h of grouped) {
    if (h.spin) {
      spins += 1;
      if (spins > (o.spinLimit ?? 4)) h.spin = false;
    }
  }

  const n = present.length;
  const dense = o.dense ?? n >= 21;
  const groups = [];
  if (o.workspace) {
    groups.push({ key: "all", title: "Workspace order", count: n, folded: false, tiles: present.map(tileOf) });
  } else {
    for (const key of GROUP_ORDER) {
      const tiles = grouped.filter((h) => GROUP_OF[h.status] === key);
      if (!tiles.length) continue;
      const folded = (o.folded && o.folded.includes(key)) || (key === "resting" && tiles.length > 12);
      groups.push({ key, title: GROUP_TITLE[key], count: tiles.length, folded, tiles: tiles.map(tileOf) });
    }
  }

  const needs = grouped.filter((h) => h.status === "blocked");
  const chips = needs.slice(0, 4).map((h) => ({ helperId: h.helperId, name: h.name, pulse: Boolean(o.matChipPulse) && h.pulse }));
  const withEnvelope = present.filter((h) => h.envelope);
  const trayAll = withEnvelope.map((h, i) => ({
    helperId: h.helperId,
    type: ENVELOPE_CYCLE[i % ENVELOPE_CYCLE.length],
    units: 1 + ((i * 5) % 4) + (i % 3 === 0 ? 0.25 : 0),
    bob: false,
  }));
  if (o.trayBob && trayAll.length && trayAll.length <= 6) trayAll[trayAll.length - 1].bob = true;

  const bank = o.bank ?? 48200;
  const rate = o.rate ?? 86.2;
  const W = o.ribbonWidth ?? RIBBON_WIDTHS[1440];
  const short = Boolean(o.short);
  const yScale = short ? (184 - 28 - 32) / (232 - 28 - 32) : 1;
  const at = (slot) => {
    const p = slotXY(slot);
    return { x: round1(p.x), y: round1(28 + (p.y - 28) * yScale) };
  };

  const vm = {
    rev: fnv1a32n(name) % 100000,
    header: {
      folds: formatCount(bank, o.style || "short"),
      rate: formatRate(rate, o.style || "short"),
      wishes: o.wishes ?? 0,
      counts,
    },
    sheet: { frame: o.frame ?? 3, ticks: o.ticks ?? 3, firstRunHint: Boolean(o.firstRunHint), short },
    mat: {
      chips,
      more: Math.max(0, needs.length - 4),
      shelf: needs.length ? [] : (o.shelf ?? SHELF.slice(0, 7)),
      nodes: [],
      scraps: [],
      crane: null,
      boat: null,
      ream: null,
      storm: false,
      creaseLine: null,
    },
    tray: { envelopes: trayAll.slice(0, 6), more: Math.max(0, trayAll.length - 6) },
    streak: { fill: 0.35, label: "×1.2", inStep: false, afterglow: null },
    boosts: [],
    helpers: {
      groups,
      dense,
      legend: n === 0,
      empty: n === 0,
      elsewhere: elsewhere.map(tileOf),
      album,
    },
    shop: shopFor(bank, rate, o.owned || STANDARD_OWNED, o.bought || STANDARD_BOUGHT),
    string: stringVm(o.string),
    settings: settingsVm(o.settings),
    away: o.away ?? null,
    notices: o.notices ?? [],
    ribbon: ribbonFor(present, elsewhere, W),
    rail: { pips: grouped.map((h) => markOf(h)).concat(elsewhere.map((h) => markOf(h, 0.5))) },
  };
  if (o.mat) Object.assign(vm.mat, o.mat(at));
  if (o.streak) Object.assign(vm.streak, o.streak);
  if (o.boosts) vm.boosts = o.boosts;
  return vm;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

// ---------------------------------------------------------------------------
// Notices (DESIGN §3.8)

const NOTICE = {
  recovered: { text: "Save was damaged. Loaded the backup from 14:02. Damaged copy kept.", actions: ["details", "dismiss"] },
  fresh: { text: "Save and backup were damaged. Started fresh; both files kept.", actions: ["details"] },
  conflict: { text: "Another window changed the save. Merging…", actions: [] },
  merged: { text: "Merged with another window's progress.", actions: [] },
  error: {
    text: `Can't save: ${clip("EACCES: permission denied, open '/home/me/.config/herdr-app/data/creaseworks/save.json.tmp'", 60)}. Retrying in 30 s. Your progress is safe in memory.`,
    actions: ["retry", "details"],
  },
  newer: { text: "This save is from a newer Creaseworks. Read-only until updated.", actions: ["details"] },
  clock: { text: "Your clock moved back. Nothing was credited for that time.", actions: ["dismiss"] },
};

function notice(kind) {
  return { kind, text: NOTICE[kind].text, actions: NOTICE[kind].actions.slice() };
}

// ---------------------------------------------------------------------------
// Away cards (DESIGN §3.7)

function awayCard(present) {
  const needs = present.filter((h) => h.status === "blocked").slice(0, 2);
  const best = present[0];
  return {
    kind: "away",
    duration: formatDuration((7 * 60 + 42) * 60000, "spaced"),
    capped: false,
    folds: "+" + formatCount(4.81e6),
    split: { workshops: formatCount(3.1e6), helpers: formatCount(1.71e6) },
    envelopes: 9,
    needs: needs.map((h) => ({ helperId: h.helperId, name: h.name })),
    rested: 5,
    best: best ? { helperId: best.helperId, name: best.name, species: best.species, tasks: 31 } : null,
    affordable: [
      { id: "washi-vat", name: "Washi Vat" },
      { id: "echo-2", name: "Echo Crease II" },
    ],
    collectable: true,
  };
}

function busyCard() {
  return {
    kind: "busy",
    duration: formatDuration(42 * 60000, "spaced"),
    capped: false,
    folds: "+" + formatCount(212400),
    split: null,
    envelopes: 3,
    needs: [],
    rested: 0,
    best: null,
    affordable: [],
    collectable: false,
  };
}

// ---------------------------------------------------------------------------
// Views

const STD = { finished: 1, working: 2, resting: 1, envelopes: 0.5 };

const PANEL = { role: "panel", width: 320, height: 784 };
const ui = (over = {}) => ({ tab: "flock", segment: "works", selected: null, confirm: false, details: false, ...over });

function boost(type, label, msLeft, msTotal) {
  return { type, label, msLeft, msTotal };
}

const BUILDERS = {
  empty: () => [PANEL, ui(), base("empty", { roster: {}, bank: 1240, rate: 0.6, frame: 1, ticks: 5, shelf: ["crane"] })],

  "first-run": () => [PANEL, ui(), base("first-run", {
    roster: { working: 1, spin: true }, bank: 0, rate: 0.3, frame: 0, ticks: 0, firstRunHint: true, shelf: [],
    owned: [0, 0, 0, 0, 0, 0, 0, 0, 0], bought: new Set(), string: { cranes: 0, nextIn: "6.00M", lifetime: "0", gain: 0 },
    streak: { fill: 0, label: "×1.0" },
  })],

  "standard-4": () => [PANEL, ui(), base("standard-4", { roster: STD })],

  "needs-you-3": () => [PANEL, ui(), base("needs-you-3", { roster: { needs: 3, working: 2, resting: 1, pulse: true, envelopes: 0.34 } })],

  "finished-2": () => [PANEL, ui(), base("finished-2", { roster: { finished: 2, working: 2, resting: 1, envelopes: 0.5 }, trayBob: true })],

  "tray-full": () => [PANEL, ui(), base("tray-full", { roster: { working: 5, resting: 3, finished: 2, envelopes: "all" } })],

  storm: () => [PANEL, ui(), base("storm", {
    roster: STD,
    mat: (at) => ({
      storm: true,
      nodes: [21, 12, 27].map((slot, j) => ({ id: `c9-${j + 1}`, i: j + 1, ...at(slot), due: j === 0, fading: false }))
        .concat([38, 47, 31].map((slot, j) => ({ id: `c10-${j + 1}`, i: j + 1, ...at(slot), due: j === 0, fading: false }))),
      creaseLine: [at(8), at(18), at(29)].map((p) => [p.x, p.y]),
    }),
    streak: { fill: 0.9, label: "×1.4" },
    boosts: [boost("storm", "Storm ×7", 18400, 30000), boost("rush", "Rush ×3", 52000, 90000)],
  })],

  crane: () => [PANEL, ui(), base("crane", {
    roster: STD,
    mat: (at) => {
      const p = at(9);
      return { crane: { id: "g4", x: p.x - 24, y: p.y - 18, x1: 8, msLeft: 14200 } };
    },
  })],

  boat: () => [PANEL, ui(), base("boat", {
    roster: STD, bought: new Set([...STANDARD_BOUGHT, "harbour-ribbon"]),
    mat: () => ({ boat: { id: "b2", x: 40, x1: 248, msLeft: 21000 } }),
  })],

  "chain-7": () => [PANEL, ui(), base("chain-7", {
    roster: STD, bought: new Set([...STANDARD_BOUGHT, "grand-crease"]),
    mat: (at) => ({
      nodes: [11, 1, 3, 8, 19, 29, 38].map((slot, j) => ({ id: `c12-${j + 1}`, i: j + 1, ...at(slot), due: j === 2, fading: j === 6 }))
        .slice(2),
      scraps: [{ id: "s7", ...at(42) }],
    }),
    streak: { fill: 0.6, label: "×1.3" },
  })],

  "in-step": () => [PANEL, ui(), base("in-step", {
    roster: { working: 4, resting: 1, finished: 1, spin: true, envelopes: 0.5 }, spinLimit: 6,
    streak: { fill: 1, label: "×1.5", inStep: true, afterglow: "12m" },
  })],

  "flock-12": () => [PANEL, ui(), base("flock-12", { roster: { needs: 2, finished: 1, working: 5, resting: 4, kids: true, envelopes: 0.25 } })],

  "flock-34": () => [PANEL, ui(), base("flock-34", { roster: { needs: 3, finished: 2, working: 14, resting: 15, kids: true, envelopes: 0.2 } })],

  "flock-64-dense": () => [PANEL, ui(), base("flock-64-dense", {
    roster: { needs: 5, finished: 3, working: 30, resting: 26, kids: true, envelopes: 0.15 }, bank: 3.12e9, rate: 1.86e6,
  })],

  "flock-elsewhere": () => [PANEL, ui(), base("flock-elsewhere", { roster: { needs: 1, working: 4, resting: 3, elsewhere: 4, envelopes: 0.25 } })],

  album: () => [PANEL, ui(), base("album", { roster: { working: 3, resting: 2, finished: 1, album: 9 } })],

  garlands: () => {
    const r = roster({ working: 6, resting: 4, needs: 1, finished: 1 });
    return [PANEL, ui({ tab: "string" }), base("garlands", {
      roster: { working: 6, resting: 4, needs: 1, finished: 1 }, wishes: 37, bank: 8.4e8, rate: 2.3e5,
      string: { cranes: 318, nextIn: "1.84B", lifetime: "92.4B", gain: 0, wishes: 37, garlands: garlandsList(4, r.present) },
    })];
  },

  settings: () => [PANEL, ui({ tab: "settings" }), base("settings", {
    roster: STD, settings: { values: { notify: { master: true, full: true, pile: false, save: true } }, sent: 1 },
  })],

  away: () => {
    const spec = { needs: 2, working: 2, resting: 3, envelopes: "all" };
    return [PANEL, ui(), base("away", { roster: spec, away: awayCard(roster(spec).present) })];
  },

  busy: () => [PANEL, ui(), base("busy", { roster: STD, away: busyCard() })],

  rail: () => [{ role: "panel", width: 64, height: 784 }, ui(), base("rail", { roster: { needs: 2, finished: 1, working: 6, resting: 3, envelopes: 0.25 } })],

  "rail-64": () => [{ role: "panel", width: 64, height: 584 }, ui(), base("rail-64", {
    roster: { needs: 5, finished: 3, working: 30, resting: 26, envelopes: 0.15 }, bank: 3.12e9, rate: 1.86e6,
  })],

  "rail-banner": () => [{ role: "panel", width: 64, height: 784 }, ui(), base("rail-banner", { roster: STD, notices: [notice("error")] })],

  narrow: () => [{ role: "panel", width: 240, height: 584 }, ui(), base("narrow", {
    roster: { needs: 1, finished: 1, working: 6, resting: 4, envelopes: 0.25 }, short: true, dense: true,
  })],

  wide: () => [{ role: "panel", width: 440, height: 784 }, ui(), base("wide", { roster: { needs: 1, finished: 1, working: 6, resting: 4, envelopes: 0.25 } })],

  short: () => [{ role: "panel", width: 320, height: 584 }, ui(), base("short", {
    roster: STD, short: true,
    mat: (at) => ({ nodes: [21, 12, 27].map((slot, j) => ({ id: `c5-${j + 1}`, i: j + 1, ...at(slot), due: j === 0, fading: false })) }),
  })],

  calm: () => [PANEL, ui(), base("calm", {
    roster: { needs: 2, finished: 1, working: 3, resting: 2, envelopes: 0.5 },
    settings: { values: { calm: true, pops: false } },
  })],
};

for (const seg of SHOP_SEGMENTS) {
  BUILDERS[`shop-${seg}`] = () => [PANEL, ui({ tab: "shop", segment: seg }), base(`shop-${seg}`, { roster: STD })];
}

BUILDERS["string-locked"] = () => [PANEL, ui({ tab: "string" }), base("string-locked", {
  roster: STD, bank: 2.1e7, rate: 41200, string: { cranes: 742, nextIn: "23.1M", lifetime: "4.26B", gain: 10, can: false },
})];
BUILDERS["string-ready"] = () => [PANEL, ui({ tab: "string" }), base("string-ready", {
  roster: STD, bank: 6.2e7, rate: 88400, string: { cranes: 1000, nextIn: "9.30M", lifetime: "6.00B", gain: 10, can: true },
})];
BUILDERS["string-confirm"] = () => [PANEL, ui({ tab: "string", confirm: true }), base("string-confirm", {
  roster: STD, bank: 6.2e7, rate: 88400, string: { cranes: 1000, nextIn: "9.30M", lifetime: "6.00B", gain: 10, can: true },
})];

for (const kind of BANNER_KINDS) {
  BUILDERS[`banner-${kind}`] = () => [PANEL, ui({ details: kind === "fresh" }), base(`banner-${kind}`, { roster: STD, notices: [notice(kind)] })];
}

const RIBBON_ROSTERS = {
  0: {},
  4: { needs: 1, finished: 1, working: 1, resting: 1, envelopes: 0.5 },
  34: { needs: 3, finished: 2, working: 14, resting: 15, envelopes: 0.2 },
  64: { needs: 5, finished: 3, working: 30, resting: 26, envelopes: 0.15 },
  130: { needs: 7, finished: 5, working: 64, resting: 54, envelopes: 0.1 },
};
for (const n of RIBBON_COUNTS) {
  BUILDERS[`ribbon-${n}`] = (opts) => {
    const W = opts.width ?? RIBBON_WIDTHS[opts.window ?? 1440];
    return [{ role: "ribbon", width: W, height: 30 }, ui(), base(`ribbon-${n}`, { roster: RIBBON_ROSTERS[n], ribbonWidth: W })];
  };
}

/** Views whose element trees must hold no loop or spin (DESIGN §13.5 steady state / calm). */
export const STEADY_VIEWS = Object.freeze(
  VIEW_NAMES.filter((v) => !["first-run", "needs-you-3", "finished-2", "storm", "crane", "boat", "in-step"].includes(v)),
);

/**
 * `{ name, role, width, height, ui, vm }` for a view. `opts.window`
 * (1100 | 1440) or `opts.width` picks the ribbon width for ribbon-* views.
 */
export function scenario(name, opts = {}) {
  if (!Object.hasOwn(BUILDERS, name)) throw new Error(`vm-fixtures: unknown view "${name}"`);
  const [frame, uiState, vm] = BUILDERS[name](opts);
  return { name, role: frame.role, width: frame.width, height: frame.height, ui: uiState, vm };
}

/** The B6 ViewModel of a view (see `scenario` for options). */
export function viewModel(name, opts = {}) {
  return scenario(name, opts).vm;
}

/** Every view as a scenario; ribbon views once per window width (`ribbon-34@1100`). */
export function allScenarios() {
  const out = [];
  for (const name of VIEW_NAMES) {
    if (name.startsWith("ribbon-")) {
      for (const w of [1100, 1440]) out.push({ ...scenario(name, { window: w }), name: `${name}@${w}` });
    } else {
      out.push(scenario(name));
    }
  }
  return out;
}

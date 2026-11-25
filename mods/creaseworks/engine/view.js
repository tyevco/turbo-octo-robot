// view(state, now, opts) → ViewModel (ARCHITECTURE B6, B10; DESIGN §3, §5.2,
// §13.5). Plain, pre-formatted data: every string is built and clip()ped
// here, every loop flag (pulse / spin / bob) already obeys the loop budget and
// calm mode, so the UI only draws. Pure: reads the state, never mutates it
// (the cached helper index aside, which is the engine's own memo).
//
// opts (all optional):
//   role       "panel" | "ribbon" ("rail" is also accepted; a panel under
//              140 px wide is the rail)
//   width      the copy's measured width (ribbon: work width W; panel: Wp)
//   dense      boolean override of the Roster density setting
//   style      "short" | "sci" override of the number style
//   writer     this window's writerId (Elsewhere grouping, stale helpers)
//   tab        the panel tab on show: "flock" (default) | "shop" | "string" | "settings"
//   short      the short mat variant (304 × 184, §2.3)
//   matShown   override of "the mat is on screen" (default: presence flags)
//   buyCount   Works toggle: 1 (default) | 10 | "max"
//   saveNotice the glue's save notice ({ kind, text?, message?, retryMs?, at? } | null)

import { K, WORKSHOPS, TIERS, UPGRADES, AUTOMATIONS, PERKS, ENVELOPES, SLOT, PRESTIGE } from "./content.js";
import { effects, itemInfo, maxAffordable, tierOf, estimateDelta, crowd } from "./economy.js";
import { indexHelpers, flock, groupFor } from "./helpers.js";
import { slotXY, nodeId, lifeLeft, rhythmAt, inStep as inStepAt } from "./clicking.js";
import { stackFactor } from "./envelopes.js";
import { stringInfo } from "./prestige.js";
import { rates } from "./engine.js";
import { formatCount, formatRate, formatDuration, formatEta, formatInt } from "./format.js";
import { clip } from "./text.js";

// ---------------------------------------------------------------------------
// Constants (module scope: literals only, A2 rule 2)

const GROUP_ORDER = ["needs", "finished", "working", "resting"];
const GROUP_RANK = { needs: 0, finished: 1, working: 2, resting: 3, elsewhere: 4 };
const STATUS_GROUP = { working: "working", blocked: "needs", done: "finished", idle: "resting" };
const KID_STATUS = { working: "working", blocked: "needs", done: "resting", idle: "resting" };
const WORD = { needs: "Needs you", finished: "Finished", working: "Working", resting: "Resting", elsewhere: "Elsewhere" };
const TITLE = { needs: "Needs you", finished: "Finished", working: "Working", resting: "Resting" };
const SEG_ICON = { tools: "ui/hand", folk: "ui/paw", charms: "ui/ribbon", curios: "ui/curio", auto: "ui/cog" };

/** Loop budget per copy (DESIGN §13.5). */
export const LOOP_BUDGET = Object.freeze({
  total: 12, pulse: 6, pulseMs: 10000, spinNew: 4, spinNewMs: 20000, spinStep: 6, bobMs: 10000,
});
/** Ribbon geometry (DESIGN §3.10): left block 118, right block 100, 16 px gutters. */
export const RIBBON = Object.freeze({ left: 118, right: 100, pad: 16, chip: 22, pip: 14, defaultWidth: 1172 });
const BOOST_CAP = { rush: 90000, storm: 30000, chorus: 240000, song: 120000, tailwind: 600000 };
const SAVE_TEXT = {
  recovered: "Save was damaged. Loaded the backup. Damaged copy kept.",
  fresh: "Save and backup were damaged. Started fresh; both files kept.",
  conflict: "Another window changed the save. Merging…",
  merged: "Merged with another window's progress.",
  error: "Can't save. Your progress is safe in memory.",
  newer: "This save is from a newer Creaseworks. Read-only until updated.",
  clock: "Your clock moved back. Nothing was credited for that time.",
};
const SAVE_ACTIONS = {
  recovered: ["details", "dismiss"], fresh: ["details"], conflict: [], merged: [],
  error: ["retry", "details"], newer: ["details"], clock: ["dismiss"],
};
const MAT = { w: 304, h: 232, shortH: 184, fieldTop: 28, fieldBottom: 200, shortBottom: 152 };
const CLIP = { name: 8, chip: 10, title: 60, markTitle: 40, notice: 140, row: 28, place: 40 };

// ---------------------------------------------------------------------------
// Small pure helpers

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const cnt = (n, style) => formatCount(n, style);
const plural = (n, one, many) => `${formatInt(n)} ${n === 1 ? one : many}`;

/** "×1.4" (one decimal, a whole value without ".0"). */
function times(x) {
  const t = Math.round(x * 10);
  return "×" + (t % 10 === 0 ? String(t / 10) : `${Math.floor(t / 10)}.${t % 10}`);
}

/** Up to two decimals, trailing zeros dropped ("2.25", "2.5", "3"). */
function dec2(x) {
  const c = Math.round(x * 100);
  const whole = Math.floor(c / 100);
  const frac = c % 100;
  if (frac === 0) return String(whole);
  return frac % 10 === 0 ? `${whole}.${frac / 10}` : `${whole}.${frac < 10 ? "0" : ""}${frac}`;
}

/** Natural order for herdr names ("tab 2" before "tab 10"). */
function natural(a, b) {
  const x = a === null || a === undefined ? "" : String(a);
  const y = b === null || b === undefined ? "" : String(b);
  if (x === y) return 0;
  const nx = /^\d+$/.test(x);
  const ny = /^\d+$/.test(y);
  if (nx && ny) return Number(x) - Number(y);
  const rx = /^(.*?)(\d+)$/.exec(x);
  const ry = /^(.*?)(\d+)$/.exec(y);
  if (rx && ry && rx[1] === ry[1]) return Number(rx[2]) - Number(ry[2]);
  return x < y ? -1 : 1;
}

const byJoin = (a, b) => a.joined - b.joined || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byWait = (a, b) => num(a.blockedAt, a.joined) - num(b.blockedAt, b.joined) || byJoin(a, b);
const byPlace = (a, b) => natural(a.space, b.space) || natural(a.tab, b.tab) || natural(a.pane, b.pane) || byJoin(a, b);

/**
 * When `h` started working, as closely as the record tells: `workingSince`
 * when the engine records it, else the latest of the times only a start of
 * work sets (joined, warmUntil − warmMs, thanksUntil − thanksMs). Every
 * candidate is ≤ the true start, so a recent value never invents new work.
 */
function workStart(h) {
  if (typeof h.workingSince === "number") return h.workingSince;
  let t = num(h.joined, -Infinity);
  const w = num(h.warmUntil) - K.warmMs;
  const th = num(h.thanksUntil) - K.thanksMs;
  if (h.warmUntil > 0 && w > t) t = w;
  if (h.thanksUntil > 0 && th > t) t = th;
  return t;
}

/** "Mina", "Mina 2": ASCII names, clipped (A2 rule 8). */
function shortName(h, max) {
  return clip(String(h.name ?? ""), max);
}

function place(h) {
  const sp = h.space ? String(h.space) : "";
  const tb = h.tab ? String(h.tab) : "";
  if (sp && tb) return clip(`${sp} / ${tb}`, CLIP.place);
  return clip(sp || tb, CLIP.place);
}

function ago(ms) {
  return formatDuration(Math.max(0, ms), { spaced: true, parts: 1 });
}

// ---------------------------------------------------------------------------
// Mat geometry

/** Mat px of slot `slot` (centre), mapped onto the short variant when asked. */
function slotPos(slot, short) {
  const p = slotXY(slot);
  if (!short) return { x: round1(p.x), y: round1(p.y) };
  const k = (MAT.shortBottom - MAT.fieldTop) / (MAT.fieldBottom - MAT.fieldTop);
  let x = p.x;
  const col = slot % SLOT.cols;
  const row = Math.floor(slot / SLOT.cols);
  // The short Sheet (96 at 104, 42) spans the whole band height: the four
  // middle columns of the top and bottom rows move out to its sides.
  if ((row === 0 || row === SLOT.rows - 1) && col >= 3 && col <= 6) x = col <= 4 ? 62 + 28 * (col - 3) : 214 + 28 * (col - 5);
  return { x: round1(x), y: round1(MAT.fieldTop + (p.y - MAT.fieldTop) * k) };
}

const round1 = (x) => Math.round(x * 10) / 10;

// ---------------------------------------------------------------------------
// The view

/**
 * view(state, now, opts) → ViewModel (ARCHITECTURE B6). Cheap: one pass over
 * the helpers, one rates() call, one flock() for the best-buy estimates.
 */
export function view(state, now, opts = {}) {
  const o = opts || {};
  const t = num(now, state.clock);
  const style = o.style === "sci" || o.style === "short" ? o.style : state.settings.style === "sci" ? "sci" : "short";
  const writer = o.writer === undefined ? undefined : o.writer;
  const role = o.role === "ribbon" ? "ribbon" : o.role === "rail" ? "rail" : "panel";
  const width = num(o.width, 0);
  const rail = role === "rail" || (role === "panel" && width > 0 && width < 140);
  const calm = state.settings.calm === true;
  const p = state.presence;
  const matShown = role === "panel" && !rail && (typeof o.matShown === "boolean" ? o.matShown : p.visible !== false && p.matShown !== false);
  const tab = typeof o.tab === "string" ? o.tab : "flock";
  const tilesShown = role === "panel" && !rail && tab === "flock";
  const short = o.short === true;

  const E = effects(state);
  const r = rates(state, writer);
  const idx = indexHelpers(state);
  const live = Math.max(0, t - state.clock); // ms since the engine's clock

  // ---- helpers: one pass --------------------------------------------------
  const roster = rosterOf(state, t, writer, idx);
  const loops = budget(state, E, t, o, { calm, matShown, tilesShown, roster });

  const helpers = helpersVm(state, t, roster, loops, o, style);
  const counts = { needs: roster.groups.needs.length, finished: roster.groups.finished.length, working: roster.groups.working.length, resting: roster.groups.resting.length };

  const liveRate = r.Rw + r.Hs;
  const header = {
    folds: cnt(state.bank, style),
    rate: formatRate(liveRate, style),
    wishes: state.wishes,
    counts,
  };

  const saveNotice = o.saveNotice && typeof o.saveNotice === "object" && typeof o.saveNotice.kind === "string" ? o.saveNotice : null;
  const awayVm = awayCard(state, t, E, style);
  const vm = {
    rev: state.rev,
    calm,
    header,
    sheet: {
      frame: state.hand.frame,
      ticks: state.hand.frame,
      firstRunHint: !state.ui.hints.fold && state.stats.hits < 3,
      hintBob: loops.hint,
      short,
    },
    mat: matVm(state, t, E, loops, short, calm, roster),
    tray: trayVm(state, t, E, r, idx, loops, style),
    streak: streakVm(state, E, t),
    boosts: boostsVm(state, E, live, t),
    helpers,
    shop: shopVm(state, E, r, idx, writer, o, style),
    string: stringVm(state, style),
    settings: settingsVm(state),
    away: awayVm,
    notices: noticesVm(state, t, saveNotice, style),
    ribbon: null,
    rail: null,
  };
  const marks = marksOf(state, t, roster);
  vm.ribbon = ribbonVm(state, t, roster, marks, role === "ribbon" && width > 0 ? width : RIBBON.defaultWidth, header, saveNotice, awayVm, style, liveRate);
  vm.rail = {
    pips: marks.all,
    count: header.folds,
    rate: formatRate(liveRate, style, { compact: true }),
    needs: counts.needs,
    envelopes: Object.keys(state.envelopes).length,
    crane: state.spawn.crane ? state.spawn.crane.id : null,
    save: saveNotice ? clip(saveNotice.text ? String(saveNotice.text) : SAVE_TEXT[saveNotice.kind] || "Save problem", CLIP.notice) : null,
  };
  return vm;
}

// ---------------------------------------------------------------------------
// Roster: groups, kids, Elsewhere, Album

function rosterOf(state, t, writer, idx) {
  const groups = { needs: [], finished: [], working: [], resting: [] };
  const elsewhere = [];
  const kidsOf = Object.create(null);
  const all = [];
  const present = idx.present;
  const presentIds = Object.create(null);
  for (let i = 0; i < present.length; i++) presentIds[present[i].id] = true;
  for (let i = 0; i < present.length; i++) {
    const h = present[i];
    if (h.kind === "kid" && h.parent && presentIds[h.parent]) {
      (kidsOf[h.parent] || (kidsOf[h.parent] = [])).push(h);
      continue;
    }
    const g = groupFor(h, writer);
    if (g === "elsewhere") elsewhere.push(h);
    else (groups[g] || groups.resting).push(h);
    all.push(h);
  }
  groups.needs.sort(byWait);
  groups.finished.sort(byJoin);
  groups.working.sort(byJoin);
  groups.resting.sort(byJoin);
  elsewhere.sort(byJoin);
  for (const k in kidsOf) kidsOf[k].sort(byJoin);
  const workspace = state.settings.order === "workspace";
  let ordered;
  if (workspace) {
    ordered = all.filter((h) => !elsewhereOf(h, writer)).sort(byPlace);
  } else {
    ordered = groups.needs.concat(groups.finished, groups.working, groups.resting);
  }
  return { groups, elsewhere, kidsOf, ordered, workspace, writer };
}

function elsewhereOf(h, writer) {
  return writer !== undefined && writer !== null && h.seenBy && h.seenBy !== writer;
}

function groupKey(h, writer) {
  if (elsewhereOf(h, writer)) return "elsewhere";
  return STATUS_GROUP[h.status] || "resting";
}

// ---------------------------------------------------------------------------
// Loop budget (DESIGN §13.5): ≤ 12 loop/spin nodes per copy; lowest priority
// drops first: needs-you > crane > storm > envelope > In step spin >
// new-work spin > first-run hint. Calm mode: none. The ribbon copy has none.

function budget(state, E, t, o, c) {
  const out = { pulse: Object.create(null), chipPulse: false, spin: Object.create(null), crane: false, storm: false, envelope: null, hint: false, count: 0 };
  if (c.calm || o.role === "ribbon") return out;
  let left = LOOP_BUDGET.total;
  const take = (want) => {
    const n = Math.max(0, Math.min(want, left));
    left -= n;
    return n;
  };
  // 1. needs-you pulse: the most recent waits within 10 s, one mark per helper
  //    (the tile while the Flock tab shows, else the mat chip).
  if (c.tilesShown || c.matShown) {
    let cand = c.roster.groups.needs;
    if (!c.tilesShown) cand = cand.slice(0, 4); // the drawn mat chips
    const recent = [];
    for (const h of cand) {
      const since = t - num(h.blockedAt, -Infinity);
      if (since >= 0 && since < LOOP_BUDGET.pulseMs) recent.push(h);
    }
    recent.sort((a, b) => b.blockedAt - a.blockedAt || byJoin(a, b));
    const n = take(Math.min(LOOP_BUDGET.pulse, recent.length));
    for (let i = 0; i < n; i++) out.pulse[recent[i].id] = true;
    out.chipPulse = !c.tilesShown;
  }
  const sp = state.spawn;
  // 2. gilded crane bob, 3. storm stripes (mat only)
  if (c.matShown && sp.crane) out.crane = take(1) === 1;
  if (c.matShown && state.boosts.stormEnd > t) out.storm = take(1) === 1;
  // 4. the newest tray envelope bobs for 10 s after it lands (if drawn)
  if (c.matShown) {
    const drawn = trayOrder(state).slice(0, 6);
    let newest = null;
    for (const [id, env] of drawn) if (!newest || env.lastAt > newest[1].lastAt) newest = [id, env];
    if (newest && t - newest[1].lastAt >= 0 && t - newest[1].lastAt < LOOP_BUDGET.bobMs && take(1) === 1) out.envelope = newest[0];
  }
  // 5. In step spins (≤ 6 visible working badges) replace 6. new-work spins (≤ 4)
  if (c.tilesShown) {
    const working = c.roster.workspace ? c.roster.ordered.filter((h) => h.status === "working") : c.roster.groups.working;
    if (inStepAt(state, E, t)) {
      const n = take(Math.min(LOOP_BUDGET.spinStep, working.length));
      for (let i = 0; i < n; i++) out.spin[working[i].id] = true;
    } else {
      const fresh = [];
      for (const h of working) {
        const s = workStart(h);
        if (t - s >= 0 && t - s < LOOP_BUDGET.spinNewMs) fresh.push([s, h]);
      }
      fresh.sort((a, b) => b[0] - a[0] || byJoin(a[1], b[1]));
      const n = take(Math.min(LOOP_BUDGET.spinNew, fresh.length));
      for (let i = 0; i < n; i++) out.spin[fresh[i][1].id] = true;
    }
  }
  // 7. first-run hint bob (until the 3rd fold)
  if (c.matShown && !state.ui.hints.fold && state.stats.hits < 3) out.hint = take(1) === 1;
  out.count = LOOP_BUDGET.total - left;
  return out;
}

// ---------------------------------------------------------------------------
// Flock tab (§3.3)

function helpersVm(state, t, roster, loops, o, style) {
  const tiles = roster.ordered;
  const nTiles = tiles.length + roster.elsewhere.length;
  const density = state.settings.density;
  const dense = typeof o.dense === "boolean" ? o.dense : density === "always" ? true : density === "never" ? false : nTiles >= 21;
  const groups = [];
  if (roster.workspace) {
    if (tiles.length) {
      groups.push({ key: "all", title: null, count: tiles.length, folded: false, tiles: tiles.map((h) => tile(state, t, h, "", roster, loops, style)) });
    }
  } else {
    for (const key of GROUP_ORDER) {
      const list = roster.groups[key];
      if (!list.length) continue;
      groups.push({
        key,
        title: TITLE[key],
        count: list.length,
        folded: key === "resting" && list.length > 12,
        tiles: list.map((h) => tile(state, t, h, key, roster, loops, style)),
      });
    }
  }
  const elsewhere = roster.elsewhere.map((h) => tile(state, t, h, "elsewhere", roster, loops, style));
  return {
    groups,
    dense,
    legend: nTiles <= 3,
    empty: nTiles === 0,
    working: roster.groups.working.length,
    pace: formatPace(roster.groups.working.length),
    elsewhere,
    album: albumOf(state, t, style),
  };
}

/** "9 working · bench pace 50 %" (crowd as a percentage, §5.3). */
function formatPace(n) {
  if (n === 0) return "nobody working";
  return `${formatInt(n)} working · bench pace ${Math.round(crowd(n) * 100)} %`;
}

function tile(state, t, h, key, roster, loops, style) {
  const g = key || groupKey(h, roster.writer);
  const status = g === "elsewhere" ? STATUS_GROUP[h.status] || "resting" : g;
  const word = WORD[status];
  const elsewhere = g === "elsewhere";
  const kids = roster.kidsOf[h.id];
  const pips = [];
  let kidsWorking = 0;
  if (kids) {
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.status === "working") kidsWorking++;
      if (pips.length < 4) pips.push({ helperId: k.id, status: KID_STATUS[k.status] || "resting", tooltip: `${shortName(k, CLIP.chip)} · fledgling · ${WORD[KID_STATUS[k.status] || "resting"]}` });
    }
  }
  const title = h.title ? clip(String(h.title), CLIP.title) : "";
  const where = place(h);
  let tooltip = `${shortName(h, 16)} · ${h.species} · ${elsewhere ? `${word} (another window)` : word}`;
  if (title) tooltip += ` · ${title}`;
  if (where) tooltip += ` · ${where}`;
  const rest = status === "resting" && !elsewhere ? Math.max(0, Math.min(1, num(h.rest))) : null;
  return {
    helperId: h.id,
    name: shortName(h, CLIP.name),
    species: h.species,
    hue: h.hue,
    status,
    statusWord: word,
    envelope: Object.hasOwn(state.envelopes, h.id),
    pips,
    pipsMore: kids && kids.length > 4 ? kids.length - 4 : 0,
    rest,
    pulse: !elsewhere && !loops.chipPulse && loops.pulse[h.id] === true,
    spin: !elsewhere && loops.spin[h.id] === true,
    dashed: status === "needs",
    opacity: elsewhere ? 0.5 : status === "resting" ? 0.8 : 1,
    tooltip,
    pane: h.pane ?? null,
    addr: h.addr ?? null,
    kind: h.kind,
    detail: {
      title,
      line: detailLine(state, t, h, status, kids ? kids.length : 0, style),
      rest: status === "resting" || status === "finished"
        ? `rest ${Math.round(num(h.rest) * 100)} % → next task ${times(1 + effectsRestMax(state) * num(h.rest))}`
        : null,
      where,
    },
  };
}

function effectsRestMax(state) {
  return state.bought["warm-hands"] === true ? 2 : K.restMax;
}

function detailLine(state, t, h, status, nKids, style) {
  const parts = [];
  if (status === "needs" && typeof h.blockedAt === "number") parts.push(`Needs you ${ago(t - h.blockedAt)}`);
  else if (status === "working") {
    const s = workStart(h);
    parts.push(Number.isFinite(s) && s <= t ? `Working ${ago(t - s)}` : "Working");
  } else parts.push(WORD[status]);
  if (nKids > 0) parts.push(plural(nKids, "fledgling", "fledglings"));
  parts.push(`${cnt(num(h.stats && h.stats.run), style)} folds this run`);
  return parts.join(" · ");
}

function albumOf(state, t, style) {
  const out = [];
  const hs = state.helpers;
  for (const id in hs) {
    const h = hs[id];
    if (!h.gone || h.kind !== "pane") continue;
    out.push(h);
  }
  out.sort((a, b) => num(b.missingSince) - num(a.missingSince) || byJoin(a, b));
  const rows = new Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const h = out[i];
    rows[i] = {
      helperId: h.id,
      name: shortName(h, 16),
      species: h.species,
      hue: h.hue,
      leftAgo: `left ${ago(t - num(h.missingSince, t))} ago`,
      folds: cnt(num(h.stats && h.stats.folds), style),
    };
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Ribbon and rail marks (§3.9, §3.10)

function mark(state, t, h, status, elsewhere) {
  const word = WORD[status];
  const title = h.title ? clip(String(h.title), CLIP.markTitle) : "";
  const where = place(h);
  let tip = shortName(h, 16);
  const mid = [title, where].filter(Boolean).join(" · ");
  if (mid) tip += ` — ${mid}`;
  tip += ` — ${elsewhere ? `${word} (another window)` : word}`;
  if (status === "needs" && typeof h.blockedAt === "number") tip += ` · ${ago(t - h.blockedAt)}`;
  return {
    helperId: h.id,
    status,
    hue: h.hue,
    envelope: Object.hasOwn(state.envelopes, h.id),
    dashed: status === "needs",
    opacity: elsewhere ? 0.5 : 1,
    tooltip: tip,
  };
}

function marksOf(state, t, roster) {
  // Group order with join order inside (§3.10), or workspace order; Elsewhere last.
  const list = roster.workspace
    ? roster.ordered
    : roster.groups.needs.slice().sort(byJoin).concat(roster.groups.finished, roster.groups.working, roster.groups.resting);
  const all = [];
  for (const h of list) all.push(mark(state, t, h, STATUS_GROUP[h.status] || "resting", false));
  for (const h of roster.elsewhere) all.push(mark(state, t, h, STATUS_GROUP[h.status] || "resting", true));
  return { all };
}

/** Ribbon density level for `n` marks in a ribbon `W` px wide (§3.10). */
export function ribbonLevel(n, W) {
  const w = W - RIBBON.pad - RIBBON.left - RIBBON.right - RIBBON.pad;
  if (n * RIBBON.chip <= w) return "A";
  if (n <= 2 * Math.floor(w / RIBBON.pip)) return "B";
  return "C";
}

function ribbonVm(state, t, roster, marks, W, header, saveNotice, awayVm, style, liveRate) {
  const n = marks.all.length;
  const level = ribbonLevel(n, W);
  let out = marks.all;
  const tallies = [];
  if (level === "C") {
    out = [];
    const tally = Object.create(null);
    for (const m of marks.all) {
      if (m.opacity === 1 && (m.status === "needs" || m.status === "finished")) out.push(m);
      else {
        const key = m.opacity === 1 ? m.status : "elsewhere";
        tally[key] = (tally[key] || 0) + 1;
      }
    }
    for (const key of ["working", "resting", "needs", "finished", "elsewhere"]) {
      if (!tally[key]) continue;
      tallies.push({ status: key, count: tally[key], label: formatInt(tally[key]), tooltip: `${formatInt(tally[key])} ${key === "elsewhere" ? "in another window" : WORD[key].toLowerCase()}` });
    }
  }
  const pot = state.away.pot;
  return {
    marks: out,
    level,
    tallies,
    width: Math.max(0, W - RIBBON.pad - RIBBON.left - RIBBON.right - RIBBON.pad),
    folds: header.folds,
    rate: formatRate(liveRate, style, { compact: true }),
    envelopes: Object.keys(state.envelopes).length,
    save: saveNotice ? "Save problem" : null,
    pill: pot ? `Welcome back +${cnt(pot.folds, style)}` : null,
    empty: n === 0 ? "No paper folk yet · start an agent in any tab and it joins the workshop" : null,
  };
}

// ---------------------------------------------------------------------------
// Mat (§3.2)

function matVm(state, t, E, loops, short, calm, roster) {
  const sp = state.spawn;
  // Needs-you chips: longest waiting first, up to 4, then "+n" (§3.2 item 10).
  const waiting = roster.groups.needs;
  const chips = [];
  for (let i = 0; i < waiting.length && i < 4; i++) {
    const h = waiting[i];
    chips.push({ helperId: h.id, name: shortName(h, CLIP.chip), pulse: loops.chipPulse && loops.pulse[h.id] === true, tooltip: `${shortName(h, 16)} needs you \u00b7 ${ago(t - num(h.blockedAt, t))}` });
  }
  const nodes = [];
  for (const key of ["chain", "chain2"]) {
    const c = sp[key];
    if (!c) continue;
    const left = lifeLeft(state, E, "chain", c);
    for (const n of c.nodes) {
      if (n.done) continue;
      const pos = slotPos(n.slot, short);
      nodes.push({ id: nodeId(c, n.i), i: n.i, label: String(n.i + 1), x: pos.x, y: pos.y, due: n.i === c.next, fading: left !== null && left <= 2000 });
    }
  }
  const scraps = sp.scraps.map((s) => {
    const pos = slotPos(s.slot, short);
    return { id: s.id, x: pos.x, y: pos.y };
  });
  let crane = null;
  if (sp.crane) {
    const pos = slotPos(sp.crane.slot, short);
    const life = E.craneLifeMs;
    const msLeft = num(lifeLeft(state, E, "crane", sp.crane));
    const x0 = Math.max(24, Math.min(280, pos.x));
    const x1 = calm ? x0 : x0 < MAT.w / 2 ? 280 : 24;
    const k = life > 0 ? 1 - msLeft / life : 1;
    crane = { id: sp.crane.id, x: round1(x0 + (x1 - x0) * k), y: pos.y, x1, msLeft, bob: loops.crane };
  }
  let boat = null;
  if (sp.boat) {
    const life = E.boatLifeMs;
    const msLeft = num(lifeLeft(state, E, "boat", sp.boat));
    const x0 = 24;
    const x1 = calm ? 216 : 280;
    const k = life > 0 ? 1 - msLeft / life : 1;
    boat = { id: sp.boat.id, x: calm ? x1 : round1(x0 + (x1 - x0) * k), x1, msLeft };
  }
  let ream = null;
  if (sp.ream) {
    const pos = slotPos(sp.ream.slot ?? SLOT.ream, short);
    ream = { id: sp.ream.id, x: pos.x, y: pos.y };
  }
  let creaseLine = null;
  const lc = sp.lastChain;
  if (lc && lc.result === "done" && t - lc.at >= 0 && t - lc.at < 3000 && Array.isArray(lc.slots)) {
    creaseLine = lc.slots.map((s) => {
      const pos = slotPos(s, short);
      return [pos.x, pos.y];
    });
  }
  return {
    chips,
    more: Math.max(0, waiting.length - 4),
    shelf: state.hand.figures.slice(),
    nodes,
    scraps,
    crane,
    boat,
    ream,
    storm: loops.storm,
    creaseLine,
  };
}

// ---------------------------------------------------------------------------
// Tray, streak, boosts (§3.2, §6.2)

function trayOrder(state) {
  const list = [];
  for (const id in state.envelopes) list.push([id, state.envelopes[id]]);
  list.sort((a, b) => a[1].landedAt - b[1].landedAt || (a[0] < b[0] ? -1 : 1));
  return list;
}

function trayVm(state, t, E, r, idx, loops, style) {
  const list = trayOrder(state);
  const shown = list.slice(0, 6);
  const N = idx.panes.length;
  const b = state.boosts;
  const tw = b.tailwind > 0 && b.tailwindMs > 0 ? 2 : 1;
  const envelopes = shown.map(([id, env]) => {
    const def = ENVELOPES.find((d) => d.type === env.type) || ENVELOPES[0];
    const u = num(env.units);
    let tooltip;
    if (env.type === "bundle") {
      tooltip = `Bundle: +${cnt(K.envRp * r.Rp * u * E.envMult * crowd(N) * tw, style)} folds`;
    } else {
      const ms = def.baseMs * stackFactor(u) * E.durMult * tw;
      const mult = env.type === "rush" ? E.rushMult : env.type === "storm" ? E.stormMult : K.chorusMult;
      const cur = env.type === "rush" ? Math.max(0, b.rushEnd - t) : env.type === "storm" ? Math.max(0, b.stormEnd - t) : Math.max(0, num(b.chorus));
      if (cur > 0) {
        const add = Math.max(0, Math.min(def.capMs, cur + ms * K.extendShare) - cur);
        tooltip = `${def.name} is running: opening now adds only ${formatDuration(add)}`;
      } else {
        tooltip = `${def.name} ${times(mult)} for ${formatDuration(ms)} · open when you're ready to click`;
      }
    }
    return {
      helperId: id,
      type: env.type,
      units: u,
      label: u >= 2 ? `×${dec2(u)}` : null,
      bob: loops.envelope === id,
      tooltip: clip(tooltip, CLIP.notice),
    };
  });
  return { envelopes, more: Math.max(0, list.length - 6), total: list.length };
}

function streakVm(state, E, t) {
  const r = rhythmAt(state, E, t);
  const c = 1 + E.comboMax * Math.min(r, K.rMax) / K.rMax;
  const glow = state.hand.afterglowMs;
  return {
    fill: Math.min(r, K.rMax) / K.rMax,
    label: times(c),
    inStep: inStepAt(state, E, t),
    afterglow: glow > 0 ? formatDuration(glow, { parts: 1 }) : null,
  };
}

function boostsVm(state, E, live, t) {
  const b = state.boosts;
  const out = [];
  const add = (type, label, msLeft) => {
    if (msLeft > 0) out.push({ type, label: clip(label, CLIP.row), msLeft: Math.round(msLeft), msTotal: Math.max(BOOST_CAP[type], Math.round(msLeft)) });
  };
  add("storm", `Paper Storm ${times(E.stormMult)}`, b.stormEnd - t);
  add("rush", `Rush ${times(E.rushMult)}`, b.rushEnd - t);
  add("song", `Flock Song ${times(K.songMult)}`, num(b.song) - live);
  add("chorus", `Chorus ${times(K.chorusMult)}`, num(b.chorus) - live);
  if (b.tailwind > 0) add("tailwind", `Tailwind ×2 · ${b.tailwind} left`, num(b.tailwindMs) - live);
  return out;
}

// ---------------------------------------------------------------------------
// Shop (§3.4)

function shopVm(state, E, r, idx, writer, o, style) {
  const bank = state.bank;
  const Rp = r.Rp;
  const fl = flock(state, E, idx, state.clock, writer);
  const reveal = 3 * Math.max(bank, state.runFolds);
  const buyCount = o.buyCount === 10 ? 10 : o.buyCount === "max" ? "max" : 1;
  let best = null; // [payback seconds, row]
  const consider = (row, cost, item) => {
    if (!row.affordable) return;
    const d = estimateDelta(state, E, fl, item);
    if (!(d > 0)) return;
    const pay = cost / d;
    if (!best || pay < best[0]) best = [pay, row];
  };
  const eta = (cost) => (cost > bank && Rp > 0 ? formatEta((cost - bank) / Rp * 1000) : null);

  // Works: every revealed workshop, then one silhouette.
  const works = [];
  for (let k = 0; k < WORKSHOPS.length; k++) {
    const w = WORKSHOPS[k];
    const owned = state.owned[w.id] || 0;
    const revealed = k === 0 || (state.owned[WORKSHOPS[k - 1].id] || 0) >= 1 || owned > 0;
    const n = buyCount === "max" ? Math.max(1, maxAffordable(state, w.id)) : buyCount;
    const info = itemInfo(state, w.id, n);
    const each = w.out * Math.pow(2, tierOf(state, w.id)) * E.G;
    const row = {
      id: w.id,
      name: revealed ? w.name : "???",
      owned,
      count: n,
      cost: cnt(info.cost, style),
      affordable: revealed && info.unlocked && info.cost <= bank,
      best: false,
      eta: revealed && info.unlocked ? eta(info.cost) : null,
      effect: revealed ? `${formatRate(each, style)} each · ${formatRate(each * owned, style, { sign: false })} total` : "",
      icon: `workshop/${w.id}`,
      tier: false,
      revealed,
      sub: [],
    };
    if (revealed) {
      const one = itemInfo(state, w.id, 1);
      if (one.unlocked && one.cost <= bank) consider(row, one.cost, w.id);
      for (const tr of TIERS) {
        const id = `${w.id}-t${tr.n}`;
        const ti = itemInfo(state, id, 1);
        if (!ti.unlocked || ti.have) continue;
        const sub = {
          id,
          name: clip(`${w.name}: ${tr.name}`, CLIP.row),
          owned: 0,
          cost: cnt(ti.cost, style),
          affordable: ti.ok,
          best: false,
          eta: eta(ti.cost),
          effect: `${w.name} output ×2`,
          icon: `workshop/${w.id}`,
          tier: true,
          revealed: true,
          sub: [],
        };
        consider(sub, ti.cost, id);
        row.sub.push(sub);
      }
    }
    works.push(row);
    if (!revealed) break;
  }

  const segments = { works, tools: [], folk: [], charms: [], curios: [], auto: [] };
  const owned = { works: [], tools: [], folk: [], charms: [], curios: [], auto: [] };
  // One "???" row per segment: the cheapest unlocked item not yet revealed.
  const silhouette = Object.create(null);
  const upgradeRow = (u, auto) => {
    const info = itemInfo(state, u.id, 1);
    const have = info.have === true;
    const revealed = have || (info.unlocked && (u.cost <= reveal || (u.req !== undefined && state.bought[u.req] === true)));
    const row = {
      id: u.id,
      name: revealed ? u.name : "???",
      owned: have ? 1 : 0,
      cost: cnt(u.cost, style),
      affordable: revealed && info.ok,
      best: false,
      eta: revealed && !have && info.unlocked ? eta(u.cost) : null,
      effect: revealed ? u.text : "",
      icon: SEG_ICON[u.seg],
      tier: false,
      revealed,
      sub: [],
      have,
    };
    if (auto) row.on = have && state.auto[u.id] !== false;
    if (revealed || !info.unlocked) return row;
    const s = silhouette[u.seg];
    if (!s || u.cost < s[0]) silhouette[u.seg] = [u.cost, row];
    return null;
  };
  for (const u of UPGRADES) {
    const row = upgradeRow(u, false);
    if (!row || !row.revealed) continue;
    if (row.have) owned[u.seg].push(row);
    else {
      consider(row, u.cost, u.id);
      segments[u.seg].push(row);
    }
  }
  for (const a of AUTOMATIONS) {
    const row = upgradeRow(a, true);
    if (row && row.revealed) segments.auto.push(row); // bought ones keep their switch here
  }
  for (const seg of ["tools", "folk", "charms", "curios", "auto"]) {
    segments[seg].sort((a, b) => costOf(a.id) - costOf(b.id));
    if (silhouette[seg]) segments[seg].push(silhouette[seg][1]);
    owned[seg].sort((a, b) => costOf(a.id) - costOf(b.id));
  }
  if (best) {
    best[1].best = true;
    best[1].tooltip = `Best buy: pays back in ${formatDuration(best[0] * 1000, { parts: 1 })}`;
  }
  return { segments, owned, buyCount };
}

function costOf(id) {
  for (const u of UPGRADES) if (u.id === id) return u.cost;
  for (const a of AUTOMATIONS) if (a.id === id) return a.cost;
  return Infinity;
}

// ---------------------------------------------------------------------------
// String tab (§3.5)

function stringVm(state, style) {
  const s = stringInfo(state);
  const strands = new Array(20);
  const per = s.of / 20;
  for (let i = 0; i < 20; i++) strands[i] = Math.max(0, Math.min(1, (s.cranes - i * per) / per));
  const W = state.wishes;
  const gainShown = Math.max(s.gain, s.needed);
  return {
    cranes: s.cranes,
    of: s.of,
    nextIn: cnt(s.nextIn, style),
    lifetime: cnt(s.lifetime, style),
    gain: s.gain,
    needed: s.needed,
    can: s.can,
    title: `${formatInt(Math.min(s.cranes, s.of))} / ${formatInt(s.of)} cranes`,
    next: `Next crane in ${cnt(s.nextIn, style)} folds · lifetime ${cnt(s.lifetime, style)}`,
    at: `At ${formatInt(s.of)}: +${formatInt(gainShown)} Wishes (+${Math.round(PRESTIGE.perWish * 100)} % to everything each, forever)`,
    button: s.can ? `Make the wish (+${formatInt(s.gain)} Wishes)` : `Make the wish (at ${formatInt(s.of)} cranes)`,
    strands,
    perks: PERKS.map((pk) => ({ at: pk.at, text: pk.text, have: W >= pk.at })),
    garlands: state.garlands.map((g) => ({
      wish: g.wish,
      day: g.day,
      wishes: g.wishes,
      title: `#${g.wish}`,
      text: `${g.day} · ${plural(g.wishes, "Wish", "Wishes")}`,
      stripes: (g.stripes || []).map((st) => ({
        key: st[0],
        weight: st[1],
        label: clip(String(st[2] ?? ""), 16),
        tooltip: clip(`${st[2] ?? st[0]} · ${Math.round(num(st[1]) * 100)} %`, CLIP.markTitle),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Settings (§3.6, §11)

function settingsVm(state) {
  const s = state.settings;
  const n = state.notify;
  const sent = n.day === state.day ? n.sent : 0;
  return {
    calm: s.calm === true,
    gather: s.gather !== false,
    nodes: s.nodes !== false,
    pops: s.calm === true ? false : s.pops !== false,
    popsDisabled: s.calm === true,
    notify: { master: s.notify.master === true, full: s.notify.full !== false, pile: s.notify.pile !== false, save: s.notify.save !== false },
    order: s.order === "workspace" ? "workspace" : "urgency",
    density: s.density === "always" || s.density === "never" ? s.density : "auto",
    style: s.style === "sci" ? "sci" : "short",
    notifySentToday: sent,
    notifyText: `${Math.min(3, sent)} of 3 sent today`,
    automations: AUTOMATIONS.map((a) => {
      const have = state.bought[a.id] === true;
      return { id: a.id, name: a.name, owned: have, on: have && state.auto[a.id] !== false };
    }),
  };
}

// ---------------------------------------------------------------------------
// Away card (§3.7, §10.3)

function awayCard(state, t, E, style) {
  const p = state.away.pot;
  if (p) {
    const hs = state.helpers;
    const needs = [];
    for (const id of p.needs || []) {
      const h = hs[id];
      if (h && !h.gone && h.status === "blocked") needs.push({ helperId: id, name: shortName(h, CLIP.chip) });
    }
    const envelopes = Object.keys(state.envelopes).length;
    const bestH = p.best ? hs[p.best] : null;
    const affordable = (p.affordable || []).map((id) => ({ id, name: nameOf(id) }));
    const duration = formatDuration(p.seconds * 1000, "spaced");
    return {
      kind: "away",
      title: "While you were away",
      duration,
      capped: p.capped === true,
      capText: p.capped
        ? `You were away ${formatDuration(num(p.gap, p.seconds * 1000), "spaced")}; helpers fold for at most 8 h while you're gone.`
        : "(Creaseworks counts up to 8 h)",
      folds: `+${cnt(p.folds, style)}`,
      split: `workshops ${cnt(p.split ? p.split.workshops : 0, style)} · helpers ${cnt(p.split ? p.split.helpers : 0, style)}`,
      envelopes,
      envelopesText: envelopes > 0 ? `${plural(envelopes, "envelope", "envelopes")} waiting on the tray` : null,
      needs,
      needsText: needs.length ? clip(`${plural(needs.length, "helper needs", "helpers need")} you: ${needs.map((x) => x.name).join(", ")}`, CLIP.notice) : null,
      rested: num(p.rested),
      restedText: p.rested > 0 ? `${plural(p.rested, "helper", "helpers")} rested fully (next tasks ${times(1 + E.restMax)})` : null,
      best: bestH ? clip(`Best helper: ${bestH.name} the ${bestH.species}, ${plural(bestH.stats.tasks, "task", "tasks")}`, CLIP.notice) : null,
      affordable,
      affordableText: affordable.length ? clip(`You can afford: ${affordable.map((x) => x.name).join(", ")}`, CLIP.notice) : null,
      tasks: null,
      collectable: true,
      at: p.at,
    };
  }
  let busy = null;
  for (const n of state.notices) if (n.kind === "busy" && (!busy || n.at > busy.at)) busy = n;
  if (busy) {
    const d = busy.data || {};
    const envelopes = num(d.envelopes);
    return {
      kind: "busy",
      title: "While you were busy",
      duration: formatDuration(num(d.seconds) * 1000, "spaced"),
      capped: false,
      capText: null,
      folds: `+${cnt(num(d.folds), style)}`,
      split: null,
      envelopes,
      envelopesText: envelopes > 0 ? `${plural(envelopes, "envelope", "envelopes")} waiting on the tray` : null,
      needs: [],
      needsText: null,
      rested: 0,
      restedText: null,
      best: null,
      affordable: [],
      affordableText: null,
      tasks: num(d.tasks),
      tasksText: `${plural(num(d.tasks), "task", "tasks")} finished`,
      collectable: false,
      at: busy.at,
    };
  }
  return null;
}

function nameOf(id) {
  for (const w of WORKSHOPS) if (w.id === id) return w.name;
  for (const u of UPGRADES) if (u.id === id) return u.name;
  for (const a of AUTOMATIONS) if (a.id === id) return a.name;
  return clip(String(id), CLIP.row);
}

// ---------------------------------------------------------------------------
// Notices (engine + the glue's save notice, §3.8)

function noticesVm(state, t, saveNotice, style) {
  const out = [];
  if (saveNotice) {
    const kind = saveNotice.kind;
    let text = typeof saveNotice.text === "string" ? saveNotice.text : SAVE_TEXT[kind] || "Save problem.";
    if (kind === "error" && typeof saveNotice.text !== "string" && saveNotice.message) {
      const retry = num(saveNotice.retryMs, 0);
      text = `Can't save: ${clip(String(saveNotice.message), 60)}.${retry > 0 ? ` Retrying in ${formatDuration(retry, "spaced")}.` : ""} Your progress is safe in memory.`;
    }
    out.push({ kind, text: clip(text, CLIP.notice), actions: (SAVE_ACTIONS[kind] || ["details"]).slice(), place: "banner", save: true, at: num(saveNotice.at, t) });
  }
  // Engine notices, newest first within each place.
  const list = state.notices.slice().sort((a, b) => b.at - a.at);
  for (const n of list) {
    const d = n.data || {};
    if (n.kind === "clock") {
      out.push({ kind: "clock", text: SAVE_TEXT.clock, actions: ["dismiss"], place: "banner", save: false, at: n.at });
    } else if (n.kind === "overflow") {
      out.push({ kind: "overflow", text: clip(`+${cnt(num(d.amount), style)} from a full envelope (${String(d.name ?? "")})`, CLIP.notice), actions: [], place: "footer", save: false, at: n.at });
    } else if (n.kind === "away") {
      out.push({ kind: "away", text: clip(`+${cnt(num(d.folds), style)} while away (${formatDuration(num(d.seconds) * 1000, "spaced")})`, CLIP.notice), actions: [], place: "footer", save: false, at: n.at });
    }
    // "busy" is the away card (vm.away), not a line.
  }
  return out;
}

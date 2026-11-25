// view(state, now, opts) → ViewModel (ARCHITECTURE B6, B10; DESIGN §3, §5.2,
// §13.5). Plain, pre-formatted data: every string is built and clip()ped
// here and every loop flag (pulse / spin / bob) already obeys the loop budget
// and calm mode, so the UI only draws. Pure: reads the state and never
// changes it (the engine's own cached helper index aside).
//
// opts (all optional; ARCHITECTURE B10):
//   role        "panel" | "ribbon" (a panel narrower than 140 px is the rail)
//   width       the copy's measured width (ribbon: work width W; panel: Wp)
//   dense       boolean override of the Roster density setting
//   style       "short" | "sci" override of the number style
//   writer      this window's writerId (Elsewhere grouping, stale helpers)
//   tab         the panel tab on show: "flock" (default) | "shop" | "string" | "settings"
//   short       the short mat variant (304 × 184, DESIGN §2.3)
//   matShown    override of "the mat is on screen" (default: the presence flags)
//   buyCount    the Works toggle: 1 (default) | 10 | "max"
//   saveNotice  the glue's save notice: { kind, text?, message?, retryMs?, at? } | null
//   album       false when the Flock's Album section is folded: its rows are
//               not built (helpers.album []); helpers.albumCount still counts

import { K, WORKSHOPS, TIERS, UPGRADES, AUTOMATIONS, PERKS, ENVELOPES, SLOT, PRESTIGE } from "./content.js";
import { effects, itemInfo, maxAffordable, tierOf, estimateDelta, crowd } from "./economy.js";
import { indexHelpers, flock } from "./helpers.js";
import { slotXY, nodeId, lifeLeft, rhythmAt, inStep as inStepAt } from "./clicking.js";
import { stackFactor } from "./envelopes.js";
import { stringInfo } from "./prestige.js";
import { rates } from "./engine.js";
import { bestSince } from "./away.js";
import { formatCount, formatRate, formatDuration, formatEta, formatInt } from "./format.js";
import { clip } from "./text.js";

// ---------------------------------------------------------------------------
// Constants (module scope: literals only, A2 rule 2)

const GROUP_ORDER = ["needs", "finished", "working", "resting"];
const GROUP_OF = { working: "working", blocked: "needs", done: "finished", idle: "resting" };
const WORD = { working: "Working", blocked: "Needs you", done: "Finished", idle: "Resting" };
const TITLE = { needs: "Needs you", finished: "Finished", working: "Working", resting: "Resting" };
const SEG_ICON = { tools: "hand", folk: "paw", charms: "ribbon", curios: "curio", auto: "cog" };

/** Loop budget per copy (DESIGN §13.5). */
export const LOOP_BUDGET = Object.freeze({
  total: 12, pulse: 6, pulseMs: 10000, spinNew: 4, spinNewMs: 20000, spinStep: 6, bobMs: 10000, chips: 4,
});
/** Ribbon geometry (DESIGN §3.10): left block 118, right block 100, 16 px gutters. */
export const RIBBON = Object.freeze({ left: 118, right: 100, pad: 16, chip: 22, pip: 14, defaultWidth: 1172 });
/** Rail below this panel width (DESIGN §2.4). */
const RAIL_BELOW = 140;
/** Boost bar totals: the remaining-time caps (DESIGN §6.2; Flock Song 120 s; Tailwind 10 min). */
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
/** Mat geometry (DESIGN §3.2): play field y 28–200 (short: 28–152); crane hit 48×36, boat 48×32. */
const MAT = { w: 304, fieldTop: 28, fieldBottom: 200, shortBottom: 152, craneW: 48, craneH: 36, boatW: 48, edge: 8 };
const CRANE_HINT = "A gilded crane! Click it before it flies off.";
const CLIP = { name: 8, chip: 10, long: 16, title: 60, agent: 24, notice: 140, row: 32, place: 40, error: 60 };

// ---------------------------------------------------------------------------
// Small pure helpers

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const cnt = (n, style) => formatCount(n, style);
const plural = (n, one, many) => `${formatInt(n)} ${n === 1 ? one : many}`;
const round1 = (x) => Math.round(x * 10) / 10;
const ago = (ms) => formatDuration(Math.max(0, ms), { spaced: true, parts: 1 });
const statusOf = (h) => (Object.hasOwn(WORD, h.status) ? h.status : "idle");

/** "×1.4", "×1.0": one decimal (the streak label). */
function times1(x) {
  const t = Math.round(x * 10);
  return `×${Math.floor(t / 10)}.${t % 10}`;
}

/** "×3", "×1.5": a multiplier, one decimal only when it has one. */
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
  const rx = /^(.*?)(\d+)$/.exec(x);
  const ry = /^(.*?)(\d+)$/.exec(y);
  if (rx && ry && rx[1] === ry[1] && rx[2] !== ry[2]) return Number(rx[2]) - Number(ry[2]);
  return x < y ? -1 : 1;
}

const byJoin = (a, b) => a.joined - b.joined || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byWait = (a, b) => num(a.blockedAt, a.joined) - num(b.blockedAt, b.joined) || byJoin(a, b);
const byPlace = (a, b) => natural(a.space, b.space) || natural(a.tab, b.tab) || natural(a.pane, b.pane) || byJoin(a, b);

/**
 * When `h` started working, as closely as the record tells: `workingSince`
 * if the engine records it, else the latest of the times only a start of work
 * sets (joined; warmUntil − 20 min; thanksUntil − 5 min). Every candidate is
 * ≤ the true start, so a recent value never invents new work.
 */
export function workStart(h) {
  if (typeof h.workingSince === "number") return h.workingSince;
  let t = num(h.joined, -Infinity);
  if (h.warmUntil > 0 && h.warmUntil - K.warmMs > t) t = h.warmUntil - K.warmMs;
  if (h.thanksUntil > 0 && h.thanksUntil - K.thanksMs > t) t = h.thanksUntil - K.thanksMs;
  return t;
}

/** Helper names are ASCII (§5.1); clipped all the same (A2 rule 8). */
function nameOfHelper(h, max) {
  return clip(String(h.name ?? ""), max);
}

function place(h) {
  const sp = h.space ? String(h.space) : "";
  const tb = h.tab ? String(h.tab) : "";
  return clip(sp && tb ? `${sp} / ${tb}` : sp || tb, CLIP.place);
}

/** The agent's name: the first " · " part of its title ("claude · fix flaky test" → "claude"). */
function agentOf(title) {
  if (!title) return "";
  const s = String(title);
  const k = s.indexOf(" · ");
  return clip(k > 0 ? s.slice(0, k) : s, CLIP.agent);
}

/** Mat px of slot `slot` (its centre), mapped onto the short variant when asked. */
export function slotPos(slot, short) {
  const p = slotXY(slot);
  if (!short) return { x: round1(p.x), y: round1(p.y) };
  const k = (MAT.shortBottom - MAT.fieldTop) / (MAT.fieldBottom - MAT.fieldTop);
  let x = p.x;
  const col = slot % SLOT.cols;
  const row = Math.floor(slot / SLOT.cols);
  // The short Sheet (96 at 104, 42) fills the band's height: the four middle
  // columns of the top and bottom rows move out to its sides.
  if ((row === 0 || row === SLOT.rows - 1) && col >= 3 && col <= 6) x = col <= 4 ? 62 + 28 * (col - 3) : 214 + 28 * (col - 5);
  return { x: round1(x), y: round1(MAT.fieldTop + (p.y - MAT.fieldTop) * k) };
}

/** Ribbon density level for `n` marks in a ribbon `W` px wide (DESIGN §3.10). */
export function ribbonLevel(n, W) {
  const w = W - RIBBON.pad - RIBBON.left - RIBBON.right - RIBBON.pad;
  if (n * RIBBON.chip <= w) return "A";
  if (n <= 2 * Math.floor(w / RIBBON.pip)) return "B";
  return "C";
}

// ---------------------------------------------------------------------------
// The view

/**
 * view(state, now, opts) → ViewModel (ARCHITECTURE B6). Cheap: one pass over
 * the helpers, one rates() call and one flock() for the best-buy estimates.
 */
export function view(state, now, opts = undefined) {
  const o = opts && typeof opts === "object" ? opts : {};
  const t = num(now, state.clock);
  const style = o.style === "sci" || o.style === "short" ? o.style : state.settings.style === "sci" ? "sci" : "short";
  const writer = o.writer === undefined || o.writer === null ? undefined : String(o.writer);
  const role = o.role === "ribbon" ? "ribbon" : "panel";
  const width = num(o.width, 0);
  const rail = role === "panel" && (o.role === "rail" || (width > 0 && width < RAIL_BELOW));
  const calm = state.settings.calm === true;
  const p = state.presence;
  const matShown = role === "panel" && !rail
    && (typeof o.matShown === "boolean" ? o.matShown : p.visible !== false && p.matShown !== false);
  const tilesShown = role === "panel" && !rail && (typeof o.tab === "string" ? o.tab : "flock") === "flock";
  const short = o.short === true;

  const E = effects(state);
  const r = rates(state, writer);
  const idx = indexHelpers(state);
  const live = Math.max(0, t - state.clock); // live ms since the engine's clock

  const roster = rosterOf(state, writer, idx);
  const loops = budget(state, E, t, { calm, role, matShown, tilesShown, roster });
  const counts = {
    needs: roster.groups.needs.length,
    finished: roster.groups.finished.length,
    working: roster.groups.working.length,
    resting: roster.groups.resting.length,
  };
  const liveRate = r.Rw + r.Hs;
  const header = { folds: cnt(state.bank, style), rate: formatRate(liveRate, style), wishes: state.wishes, counts };
  const saveNotice = o.saveNotice && typeof o.saveNotice === "object" && typeof o.saveNotice.kind === "string" ? o.saveNotice : null;
  const away = awayCard(state, E, style);
  const marks = marksOf(state, t, roster);
  const envelopes = Object.keys(state.envelopes).length;
  const firstRunHint = !state.ui.hints.fold && state.stats.hits < 3;

  return {
    rev: state.rev,
    calm,
    header,
    sheet: { frame: state.hand.frame, ticks: state.hand.frame, firstRunHint, hintBob: loops.hint, short },
    mat: matVm(state, t, E, loops, short, calm, roster),
    tray: trayVm(state, t, E, r, idx, loops, style),
    streak: streakVm(state, E, t),
    boosts: boostsVm(state, E, live, t),
    helpers: helpersVm(state, t, roster, loops, o, style, idx, tilesShown),
    shop: shopVm(state, E, r, idx, writer, o, style),
    string: stringVm(state, style, t),
    settings: settingsVm(state),
    away,
    notices: noticesVm(state, t, saveNotice, style),
    ribbon: ribbonVm(state, marks, role === "ribbon" && width > 0 ? width : RIBBON.defaultWidth, header, saveNotice, envelopes, style, liveRate),
    rail: {
      pips: marks,
      count: header.folds,
      rate: formatRate(liveRate, style, { compact: true }),
      needs: counts.needs,
      envelopes,
      crane: state.spawn.crane ? state.spawn.crane.id : null,
      save: saveNotice ? clip(typeof saveNotice.text === "string" ? saveNotice.text : SAVE_TEXT[saveNotice.kind] || "Save problem", CLIP.notice) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Roster: groups, fledglings, Elsewhere

function rosterOf(state, writer, idx) {
  const groups = { needs: [], finished: [], working: [], resting: [] };
  const elsewhere = [];
  const kidsOf = Object.create(null);
  const tiles = [];
  const present = idx.present;
  const here = Object.create(null);
  for (let i = 0; i < present.length; i++) here[present[i].id] = true;
  const other = writer !== undefined;
  for (let i = 0; i < present.length; i++) {
    const h = present[i];
    // A fledgling is a pip on its parent's tile (§3.3); one without a present parent gets its own tile.
    if (h.kind === "kid" && h.parent && here[h.parent]) {
      (kidsOf[h.parent] || (kidsOf[h.parent] = [])).push(h);
      continue;
    }
    if (other && h.seenBy && h.seenBy !== writer) elsewhere.push(h);
    else {
      groups[GROUP_OF[statusOf(h)]].push(h);
      tiles.push(h);
    }
  }
  groups.needs.sort(byWait);
  groups.finished.sort(byJoin);
  groups.working.sort(byJoin);
  groups.resting.sort(byJoin);
  elsewhere.sort(byJoin);
  for (const k in kidsOf) kidsOf[k].sort(byJoin);
  const workspace = state.settings.order === "workspace";
  const ordered = workspace ? tiles.sort(byPlace) : groups.needs.concat(groups.finished, groups.working, groups.resting);
  return { groups, elsewhere, kidsOf, ordered, workspace };
}

// ---------------------------------------------------------------------------
// Loop budget (DESIGN §13.5): ≤ 12 loop/spin nodes per copy; the lowest
// priority drops first: needs-you > crane > storm > envelope > In step spin >
// new-work spin > first-run hint. Calm mode and the ribbon copy: none.

function budget(state, E, t, c) {
  const out = { pulse: Object.create(null), chipPulse: false, spin: Object.create(null), crane: false, storm: false, envelope: null, hint: false, count: 0 };
  if (c.calm || c.role !== "panel") return out;
  let left = LOOP_BUDGET.total;
  const take = (want) => {
    const n = Math.max(0, Math.min(want, left));
    left -= n;
    return n;
  };
  // 1. Needs-you pulse: the most recent waits within 10 s (≤ 6), one mark per
  //    helper: the tile while the Flock tab shows, else the mat chip.
  if (c.tilesShown || c.matShown) {
    const cand = c.tilesShown ? c.roster.groups.needs : c.roster.groups.needs.slice(0, LOOP_BUDGET.chips);
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
  // 2. Gilded crane bob, 3. storm stripes (on the mat).
  if (c.matShown && sp.crane) out.crane = take(1) === 1;
  if (c.matShown && state.boosts.stormEnd > t) out.storm = take(1) === 1;
  // 4. The newest drawn tray envelope bobs for 10 s after it lands.
  if (c.matShown) {
    const drawn = trayOrder(state);
    let newest = null;
    for (let i = 0; i < drawn.length && i < 6; i++) if (!newest || drawn[i][1].lastAt > newest[1].lastAt) newest = drawn[i];
    const age = newest ? t - num(newest[1].lastAt, newest[1].landedAt) : -1;
    if (newest && age >= 0 && age < LOOP_BUDGET.bobMs && take(1) === 1) out.envelope = newest[0];
  }
  // 5. In step spins (≤ 6 working badges in display order) replace
  // 6. new-work spins (≤ 4, the latest starts within 20 s). Panel tiles only.
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
  // 7. The first-run hint bobs until the 3rd fold.
  if (c.matShown && !state.ui.hints.fold && state.stats.hits < 3) out.hint = take(1) === 1;
  out.count = LOOP_BUDGET.total - left;
  return out;
}

// ---------------------------------------------------------------------------
// Flock tab (§3.3)

function helpersVm(state, t, roster, loops, o, style, idx, tilesShown) {
  const nTiles = roster.ordered.length + roster.elsewhere.length;
  const density = state.settings.density;
  const dense = typeof o.dense === "boolean" ? o.dense : density === "always" ? true : density === "never" ? false : nTiles >= 21;
  const groups = [];
  if (roster.workspace) {
    if (roster.ordered.length) {
      groups.push({ key: "all", title: "Workspace order", count: roster.ordered.length, folded: false, tiles: roster.ordered.map((h) => tile(state, t, h, false, roster, loops)) });
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
        tiles: list.map((h) => tile(state, t, h, false, roster, loops)),
      });
    }
  }
  const nWorking = roster.groups.working.length;
  return {
    groups,
    dense,
    legend: nTiles === 0,
    empty: nTiles === 0,
    pace: nWorking > 0 ? `${formatInt(nWorking)} working · bench pace ${Math.round(crowd(nWorking) * 100)} %` : null,
    elsewhere: roster.elsewhere.map((h) => tile(state, t, h, true, roster, loops)),
    // Only the panel's Flock tab draws the Album, and only unfolded: rows are
    // built there (opts.album false = folded: none), counted everywhere.
    album: tilesShown && o.album !== false ? albumOf(state, t, style, idx) : [],
    albumCount: albumCount(state, idx),
  };
}

function tile(state, t, h, elsewhere, roster, loops) {
  const status = statusOf(h);
  const word = WORD[status];
  const kids = kidsFirstBlocked(roster.kidsOf[h.id]);
  const pips = kids ? kids.map(statusOf) : [];
  const title = h.title ? clip(String(h.title), CLIP.title) : "";
  const where = place(h);
  let tooltip = `${nameOfHelper(h, CLIP.long)} · ${h.species} · ${elsewhere ? `${word} (another window)` : word}`;
  if (title) tooltip += ` · ${title}`;
  if (where) tooltip += ` · ${where}`;
  return {
    helperId: h.id,
    name: nameOfHelper(h, CLIP.name),
    species: h.species,
    hue: h.hue,
    status,
    statusWord: word,
    envelope: Object.hasOwn(state.envelopes, h.id),
    pips,
    // The fledglings behind the pips, same order: a needs-you pip opens its
    // own agent (pane.focus, or terminal.peek when it has no pane, §5.6).
    kids: kids ? kids.map((k) => kidOf(k, t)) : [],
    rest: status === "idle" && !elsewhere ? Math.max(0, Math.min(1, num(h.rest))) : null,
    pulse: !elsewhere && !loops.chipPulse && loops.pulse[h.id] === true,
    spin: !elsewhere && loops.spin[h.id] === true,
    dashed: status === "blocked",
    opacity: elsewhere ? 0.5 : status === "idle" ? 0.8 : 1,
    tooltip,
    pane: h.pane ?? null,
    addr: h.addr ?? null,
    kind: h.kind === "kid" ? "kid" : "pane",
    detail: detail(state, t, h, status, title, where, kids ? kids.length : 0),
  };
}

/**
 * A tile's fledglings, waiting ones first (longest wait first), then the rest
 * in join order: the tile draws only the first 4 pips, and a waiting
 * fledgling must always get one (its own route to terminal.peek, §5.6).
 */
function kidsFirstBlocked(kids) {
  if (!kids || kids.length < 2) return kids;
  const blocked = [];
  const rest = [];
  for (const k of kids) (statusOf(k) === "blocked" ? blocked : rest).push(k);
  if (!blocked.length) return kids;
  blocked.sort(byWait);
  return blocked.concat(rest);
}

function kidOf(k, t) {
  const status = statusOf(k);
  const word = WORD[status];
  let tooltip = `${nameOfHelper(k, CLIP.long)} (fledgling) · ${word}`;
  if (status === "blocked") tooltip += typeof k.blockedAt === "number" ? ` ${ago(t - k.blockedAt)}: click to open it` : ": click to open it";
  return { helperId: k.id, status, name: nameOfHelper(k, CLIP.chip), pane: k.pane ?? null, tooltip };
}

/** The Flock detail card's lines (§3.3), for the selected tile. */
function detail(state, t, h, status, title, where, nKids) {
  const parts = [];
  if (status === "blocked" && typeof h.blockedAt === "number") parts.push(`Needs you ${ago(t - h.blockedAt)}`);
  else if (status === "working") {
    const s = workStart(h);
    parts.push(Number.isFinite(s) && s <= t ? `Working ${ago(t - s)}` : "Working");
  } else parts.push(WORD[status]);
  if (nKids > 0) parts.push(plural(nKids, "fledgling", "fledglings"));
  parts.push(`${cnt(num(h.stats && h.stats.run), state.settings.style)} folds this run`);
  const restMax = state.bought["warm-hands"] === true ? 2 : K.restMax;
  const rest = num(h.rest);
  return {
    title,
    where,
    line: parts.join(" · "),
    rest: status === "idle" || status === "done" ? `rest ${Math.round(rest * 100)} % → next task ${times(1 + restMax * rest)}` : null,
  };
}

// The Album grows without limit (§11.1: pane helpers are never dropped), so
// its rows are memoised: the sorted list per roster (the helper index object)
// and each row per helper until its "left … ago" text would change. The index
// is rebuilt on every observe with a helper list (any agent status change), so
// a new index first checks the last Album of the same save: same count and
// the same leaving times and folds in hs order (a 64-bit fingerprint; no
// per-record copy) carry the sorted list and rows over, so an observe costs
// one O(n) pass, not the sort and format. Any Album change moves a leaving
// time: a record that leaves gets the observe's time, one that rejoins takes
// its own out, compaction rounds them; name, species and hue do not change
// while a record stays gone. A view of an unchanged Album returns the very
// same frozen array; the output is always what a fresh build would give.
// The memo rides on the state under a symbol, as the helper index does
// (helpers.js): JSON skips it, so it never reaches the save, and it dies with
// its state. Per-record memory stays as before (the wasm QuickJS harness
// fails to free a runtime near 6,000 Album records; test/qjs R13 note).
const ALBUM = Symbol("creaseworks/album-memo"); // state → rows entry
const ALBUM_N = Symbol("creaseworks/album-count"); // state → { idx, n }

let f64 = null; // [Float64Array(1), Uint32Array view], made on first use (A2 rule 2)

/** The gone pane records (hs order) and their FNV-1a fingerprint, two lanes over the exact bits of each leaving time and folds. */
function albumScan(state) {
  if (!f64) {
    const buf = new Float64Array(1);
    f64 = [buf, new Uint32Array(buf.buffer)];
  }
  const fb = f64[0];
  const ub = f64[1];
  let a = 0x811c9dc5 | 0;
  let b = 0x01000193 | 0;
  const gone = [];
  const hs = state.helpers;
  for (const id in hs) {
    const h = hs[id];
    if (!(h.gone && h.kind === "pane")) continue;
    gone.push(h);
    fb[0] = typeof h.missingSince === "number" ? h.missingSince : NaN;
    a = Math.imul(Math.imul(a ^ ub[0], 16777619) ^ ub[1], 16777619);
    b = Math.imul(Math.imul(b ^ ub[1], 2246822519) ^ ub[0], 2246822519);
    fb[0] = h.stats && typeof h.stats.folds === "number" ? h.stats.folds : NaN;
    a = Math.imul(Math.imul(a ^ ub[0], 16777619) ^ ub[1], 16777619);
    b = Math.imul(Math.imul(b ^ ub[1], 2246822519) ^ ub[0], 2246822519);
  }
  return { gone, a: a >>> 0, b: b >>> 0 };
}

/** The roster's Album: its gone pane helpers (sorted, most recently left first, when rows are first built). */
function albumEntry(state, idx) {
  const prev = state[ALBUM];
  if (prev && prev.idx === idx) return prev;
  const scan = albumScan(state);
  let c;
  if (prev && prev.count === scan.gone.length && prev.a === scan.a && prev.b === scan.b) {
    c = prev;
  } else {
    c = { idx: null, a: scan.a, b: scan.b, gone: scan.gone, sorted: false, count: scan.gone.length, style: null, items: null, lo: -Infinity, hi: -Infinity, out: null };
  }
  c.idx = idx;
  state[ALBUM] = c;
  return c;
}

/** How many records the Album holds (no rows, no fingerprint: every view asks). */
function albumCount(state, idx) {
  const rows = state[ALBUM];
  if (rows && rows.idx === idx) return rows.count;
  const memo = state[ALBUM_N];
  if (memo && memo.idx === idx) return memo.n;
  let n = 0;
  const hs = state.helpers;
  for (const id in hs) {
    const h = hs[id];
    if (h.gone && h.kind === "pane") n++;
  }
  state[ALBUM_N] = { idx, n };
  return n;
}

/** [lo, hi): the elapsed ms over which ago(ms) prints the same text. */
function agoSpan(ms) {
  if (!(ms >= 1000)) return [-Infinity, 1000];
  const u = ms >= 86400000 ? 86400000 : ms >= 3600000 ? 3600000 : ms >= 60000 ? 60000 : 1000;
  const k = Math.floor(ms / u);
  return [k * u, (k + 1) * u];
}

function albumRow(h, t, style, texts) {
  const m = h.missingSince;
  const known = typeof m === "number" && Number.isFinite(m);
  const span = known ? agoSpan(t - m) : [-Infinity, Infinity];
  // Rows that left in the same unit step share one "left … ago" text.
  let left = texts[span[0]];
  if (left === undefined) left = texts[span[0]] = ago(known ? t - m : 0);
  const row = Object.freeze({
    helperId: h.id,
    name: nameOfHelper(h, CLIP.long),
    species: h.species,
    hue: h.hue,
    leftAgo: left,
    folds: cnt(num(h.stats && h.stats.folds), style),
  });
  return { h, row, lo: known ? m + span[0] : -Infinity, hi: known ? m + span[1] : Infinity };
}

function albumOf(state, t, style, idx) {
  const c = albumEntry(state, idx);
  if (c.items && c.style === style && t >= c.lo && t < c.hi) return c.out;
  const texts = Object.create(null);
  if (!c.sorted) {
    c.gone.sort((a, b) => num(b.missingSince) - num(a.missingSince) || byJoin(a, b));
    c.sorted = true;
  }
  if (!c.items || c.style !== style) {
    c.style = style;
    c.items = c.gone.map((h) => albumRow(h, t, style, texts));
  } else {
    const items = c.items;
    for (let i = 0; i < items.length; i++) if (!(t >= items[i].lo && t < items[i].hi)) items[i] = albumRow(items[i].h, t, style, texts);
  }
  let lo = -Infinity;
  let hi = Infinity;
  const out = new Array(c.items.length);
  for (let i = 0; i < c.items.length; i++) {
    const it = c.items[i];
    if (it.lo > lo) lo = it.lo;
    if (it.hi < hi) hi = it.hi;
    out[i] = it.row;
  }
  c.lo = lo;
  c.hi = hi;
  c.out = Object.freeze(out);
  return c.out;
}

// ---------------------------------------------------------------------------
// Ribbon and rail marks (§3.9, §3.10)

function mark(state, t, h, elsewhere) {
  const status = statusOf(h);
  const word = WORD[status];
  const mid = [agentOf(h.title), place(h)].filter(Boolean).join(" · ");
  let tip = nameOfHelper(h, CLIP.long);
  if (mid) tip += ` — ${mid}`;
  tip += ` — ${elsewhere ? `${word} (another window)` : word}`;
  if (status === "blocked" && typeof h.blockedAt === "number") tip += ` · ${ago(t - h.blockedAt)}`;
  return {
    helperId: h.id,
    status,
    hue: h.hue,
    envelope: Object.hasOwn(state.envelopes, h.id),
    dashed: status === "blocked",
    opacity: elsewhere ? 0.5 : 1,
    tooltip: tip,
  };
}

/** Group order with join order inside (or workspace order); Elsewhere last at 50 %. */
function marksOf(state, t, roster) {
  const g = roster.groups;
  const list = roster.workspace ? roster.ordered : g.needs.slice().sort(byJoin).concat(g.finished, g.working, g.resting);
  const out = new Array(list.length + roster.elsewhere.length);
  let k = 0;
  for (const h of list) out[k++] = mark(state, t, h, false);
  for (const h of roster.elsewhere) out[k++] = mark(state, t, h, true);
  return out;
}

function ribbonVm(state, all, W, header, saveNotice, envelopes, style, liveRate) {
  const n = all.length;
  const level = ribbonLevel(n, W);
  let marks = all;
  const tallies = [];
  if (level === "C") {
    // Needs-you and finished stay individual; the rest become tally chips.
    marks = [];
    let working = 0;
    let idle = 0;
    for (const m of all) {
      if (m.status === "blocked" || m.status === "done") marks.push(m);
      else if (m.status === "working") working++;
      else idle++;
    }
    if (working) tallies.push({ status: "working", count: working, label: formatInt(working), tooltip: `${formatInt(working)} working` });
    if (idle) tallies.push({ status: "idle", count: idle, label: formatInt(idle), tooltip: `${formatInt(idle)} resting` });
  }
  const pot = state.away.pot;
  return {
    marks,
    level,
    tallies,
    width: Math.max(0, W - RIBBON.pad - RIBBON.left - RIBBON.right - RIBBON.pad),
    folds: header.folds,
    rate: formatRate(liveRate, style, { compact: true }),
    envelopes,
    save: saveNotice ? "Save problem" : null,
    pill: pot ? `Welcome back +${cnt(pot.folds, style)}` : null,
    empty: n === 0 ? "No paper folk yet · start an agent in any tab and it joins the workshop" : null,
  };
}

// ---------------------------------------------------------------------------
// Mat (§3.2). Nodes, scraps, the ream and the crease line are slot centres;
// the crane and the boat are the left/top of their hit boxes (they glide by
// `left`), as the UI fixtures draw them.

function matVm(state, t, E, loops, short, calm, roster) {
  const sp = state.spawn;
  const waiting = roster.groups.needs;
  const chips = [];
  for (let i = 0; i < waiting.length && i < LOOP_BUDGET.chips; i++) {
    const h = waiting[i];
    chips.push({
      helperId: h.id,
      name: nameOfHelper(h, CLIP.chip),
      pulse: loops.chipPulse && loops.pulse[h.id] === true,
      tooltip: `${nameOfHelper(h, CLIP.long)} needs you · ${ago(t - num(h.blockedAt, t))}`,
    });
  }
  const nodes = [];
  for (const key of ["chain", "chain2"]) {
    const c = sp[key];
    if (!c) continue;
    const left = lifeLeft(state, E, "chain", c);
    for (const n of c.nodes) {
      if (n.done) continue;
      const pos = slotPos(n.slot, short);
      // `i` is the number drawn on the node (1-based); `id` is the click id.
      nodes.push({ id: nodeId(c, n.i), i: n.i + 1, x: pos.x, y: pos.y, due: n.i === c.next, fading: left !== null && left <= 2000 });
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
    const msLeft = Math.round(num(lifeLeft(state, E, "crane", sp.crane)));
    const maxX = MAT.w - MAT.craneW - MAT.edge;
    const x0 = Math.max(MAT.edge, Math.min(maxX, pos.x - MAT.craneW / 2));
    // It glides one way, towards the far side (§13.5); calm: it sits still.
    const x1 = calm ? x0 : pos.x < MAT.w / 2 ? maxX : MAT.edge;
    const k = life > 0 ? Math.max(0, Math.min(1, 1 - msLeft / life)) : 1;
    crane = { id: sp.crane.id, x: round1(x0 + (x1 - x0) * k), y: round1(pos.y - MAT.craneH / 2), x1: round1(x1), msLeft, bob: loops.crane };
    // The one-time line (§3.2): on the first crane only (spawn.cranesSeen
    // counts it in as it appears), caught or missed; never once one is caught.
    crane.hint = state.ui.hints.crane === true || num(sp.cranesSeen) > 1 ? null : CRANE_HINT;
  }
  let boat = null;
  if (sp.boat) {
    const life = E.boatLifeMs;
    const msLeft = Math.round(num(lifeLeft(state, E, "boat", sp.boat)));
    const x0 = MAT.edge;
    const x1 = MAT.w - MAT.boatW - MAT.edge;
    const k = life > 0 ? Math.max(0, Math.min(1, 1 - msLeft / life)) : 1;
    // Calm: it sits at the tray end.
    boat = calm ? { id: sp.boat.id, x: x1, x1, msLeft } : { id: sp.boat.id, x: round1(x0 + (x1 - x0) * k), x1, msLeft };
  }
  let ream = null;
  if (sp.ream) {
    const pos = slotPos(typeof sp.ream.slot === "number" ? sp.ream.slot : SLOT.ream, short);
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
    more: Math.max(0, waiting.length - LOOP_BUDGET.chips),
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
  const N = idx.panes.length;
  const b = state.boosts;
  const tw = b.tailwind > 0 && b.tailwindMs > 0 ? 2 : 1;
  const envelopes = [];
  for (let i = 0; i < list.length && i < 6; i++) {
    const [id, env] = list[i];
    const def = ENVELOPES.find((d) => d.type === env.type) || ENVELOPES[0];
    const u = num(env.units);
    let tooltip;
    if (env.type === "bundle") {
      tooltip = `Bundle: +${cnt(K.envRp * r.Rp * u * E.envMult * crowd(N) * tw, style)} folds`;
    } else {
      const ms = def.baseMs * stackFactor(u) * E.durMult * tw;
      const mult = env.type === "rush" ? E.rushMult : env.type === "storm" ? E.stormMult : K.chorusMult;
      const cur = env.type === "rush" ? b.rushEnd - t : env.type === "storm" ? b.stormEnd - t : num(b.chorus);
      if (cur > 0) {
        const add = Math.max(0, Math.min(def.capMs, cur + ms * K.extendShare) - cur);
        tooltip = `${def.name} is running: opening now adds only ${formatDuration(add)}`;
      } else {
        tooltip = `${def.name} ${times(mult)} for ${formatDuration(ms)} · open when you're ready to click`;
      }
    }
    envelopes.push({ helperId: id, type: env.type, units: u, bob: loops.envelope === id, label: u >= 2 ? `×${dec2(u)}` : null, tooltip: clip(tooltip, CLIP.notice) });
  }
  return { envelopes, more: Math.max(0, list.length - 6) };
}

function streakVm(state, E, t) {
  const r = rhythmAt(state, E, t);
  const glow = state.hand.afterglowMs;
  return {
    fill: Math.min(r, K.rMax) / K.rMax,
    label: times1(1 + E.comboMax * Math.min(r, K.rMax) / K.rMax),
    inStep: inStepAt(state, E, t),
    afterglow: glow > 0 ? formatDuration(glow, { parts: 1 }) : null,
  };
}

function boostsVm(state, E, live, t) {
  const b = state.boosts;
  const out = [];
  const add = (type, label, msLeft) => {
    if (msLeft > 0) out.push({ type, label, msLeft: Math.round(msLeft), msTotal: Math.max(BOOST_CAP[type], Math.round(msLeft)) });
  };
  add("storm", `Storm ${times(E.stormMult)}`, b.stormEnd - t);
  add("rush", `Rush ${times(E.rushMult)}`, b.rushEnd - t);
  add("song", `Flock Song ${times(K.songMult)}`, num(b.song) - live);
  add("chorus", `Chorus ${times(K.chorusMult)}`, num(b.chorus) - live);
  if (b.tailwind > 0) add("tailwind", `Tailwind ×2 · ${b.tailwind} left`, num(b.tailwindMs) - live);
  return out;
}

// ---------------------------------------------------------------------------
// Shop (§3.4). Every item of a segment is a row in table order; `revealed`
// false rows draw as the "???" silhouette and owned upgrades (`owned` 1) go
// into the segment's "Owned (n)" fold, as the UI decides.

function shopVm(state, E, r, idx, writer, o, style) {
  const bank = state.bank;
  const Rp = r.Rp;
  const fl = flock(state, E, idx, state.clock, writer);
  const reveal = 3 * Math.max(bank, state.runFolds);
  const buyCount = o.buyCount === 10 ? 10 : o.buyCount === "max" ? "max" : 1;
  let best = null; // [payback s, row]
  const consider = (row, cost, item) => {
    if (!row.affordable) return;
    const d = estimateDelta(state, E, fl, item);
    if (!(d > 0)) return;
    const pay = cost / d;
    if (!best || pay < best[0]) best = [pay, row];
  };
  const eta = (cost) => (cost > bank && Rp > 0 ? formatEta((cost - bank) / Rp * 1000) : null);

  const works = [];
  for (let k = 0; k < WORKSHOPS.length; k++) {
    const w = WORKSHOPS[k];
    const owned = state.owned[w.id] || 0;
    const revealed = k === 0 || owned > 0 || (state.owned[WORKSHOPS[k - 1].id] || 0) >= 1;
    const n = buyCount === "max" ? Math.max(1, maxAffordable(state, w.id)) : buyCount;
    const info = itemInfo(state, w.id, n);
    const each = w.out * Math.pow(2, tierOf(state, w.id)) * E.G;
    const row = {
      id: w.id,
      name: w.name,
      owned,
      cost: cnt(info.cost, style),
      affordable: revealed && info.unlocked && info.cost <= bank,
      best: false,
      eta: revealed && info.unlocked ? eta(info.cost) : null,
      effect: `${formatRate(each, style)} each · ${formatRate(each * owned, style, { sign: false })} total`,
      icon: w.id,
      tier: false,
      revealed,
      sub: [],
      count: n,
    };
    if (revealed) {
      if (buyCount === 1) consider(row, info.cost, w.id);
      else {
        const one = itemInfo(state, w.id, 1);
        if (one.unlocked && one.cost <= bank) consider({ affordable: true, ref: row }, one.cost, w.id);
      }
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
          effect: `${w.name} ×2`,
          icon: w.id,
          tier: true,
          revealed: true,
          sub: [],
        };
        consider(sub, ti.cost, id);
        row.sub.push(sub);
      }
    }
    works.push(row);
  }

  const segments = { works, tools: [], folk: [], charms: [], curios: [], auto: [] };
  const upgradeRow = (u, auto) => {
    const info = itemInfo(state, u.id, 1);
    const have = info.have === true;
    const revealed = have || (info.unlocked && (u.cost <= reveal || (u.req !== undefined && state.bought[u.req] === true)));
    const row = {
      id: u.id,
      name: u.name,
      owned: have ? 1 : 0,
      cost: cnt(u.cost, style),
      affordable: revealed && info.ok,
      best: false,
      eta: revealed && !have && info.unlocked ? eta(u.cost) : null,
      effect: u.text,
      icon: SEG_ICON[u.seg],
      tier: false,
      revealed,
      sub: [],
      locked: !info.unlocked,
    };
    if (auto) row.on = have && state.auto[u.id] !== false;
    return row;
  };
  for (const u of UPGRADES) {
    const row = upgradeRow(u, false);
    if (row.revealed && !row.owned) consider(row, u.cost, u.id);
    segments[u.seg].push(row);
  }
  for (const a of AUTOMATIONS) segments.auto.push(upgradeRow(a, true));
  if (best) {
    const row = best[1].ref || best[1];
    row.best = true;
    row.tooltip = `Best buy: pays back in ${formatDuration(best[0] * 1000, { parts: 1 })}`;
  }
  return { segments, buyCount };
}

// ---------------------------------------------------------------------------
// String tab (§3.5)

/** The §3.5 wish moment: strands rise and fade for `riseMs`, then settle (no motion) until `settleMs`. */
export const WISH_MOMENT = Object.freeze({ riseMs: 1000, settleMs: 3000 });

function wishMomentOf(state, t) {
  const lw = state.ui.lastWish;
  if (!lw || typeof lw.at !== "number") return null;
  const dt = t - lw.at;
  if (!(dt >= 0 && dt < WISH_MOMENT.settleMs)) return null;
  const fill = Math.max(0, Math.min(1, num(lw.fill)));
  const strands = new Array(20);
  for (let i = 0; i < 20; i++) strands[i] = Math.max(0, Math.min(1, fill * 20 - i));
  return { phase: dt < WISH_MOMENT.riseMs ? "rise" : "settle", strands };
}

function stringVm(state, style, t) {
  const s = stringInfo(state);
  const per = s.of / 20;
  const strands = new Array(20);
  for (let i = 0; i < 20; i++) strands[i] = Math.max(0, Math.min(1, (s.cranes - i * per) / per));
  const wishMoment = wishMomentOf(state, t);
  const W = state.wishes;
  const gainShown = Math.max(s.gain, s.needed);
  return {
    cranes: s.cranes,
    of: s.of,
    nextIn: cnt(s.nextIn, style),
    lifetime: cnt(s.lifetime, style),
    gain: s.gain,
    can: s.can,
    perks: PERKS.map((pk) => ({ at: pk.at, text: pk.text, have: W >= pk.at })),
    garlands: state.garlands.map((g) => ({
      wish: g.wish,
      day: g.day,
      stripes: (g.stripes || []).map((st) => [st[0], st[1], clip(String(st[2] ?? ""), CLIP.long)]),
      wishes: g.wishes,
    })),
    needed: s.needed,
    strands,
    title: `${formatInt(Math.min(s.cranes, s.of))} / ${formatInt(s.of)} cranes`,
    next: `Next crane in ${cnt(s.nextIn, style)} folds · lifetime ${cnt(s.lifetime, style)}`,
    at: `At ${formatInt(s.of)}: +${formatInt(gainShown)} Wishes (+${Math.round(PRESTIGE.perWish * 100)} % to everything each, forever)`,
    button: `Make the wish (+${formatInt(gainShown)} Wishes)`,
    // null, or for 3 s after a wish { phase: "rise" | "settle", strands }:
    // the String as it was wished away (§3.5 wish moment).
    wishMoment,
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
    notify: { master: s.notify.master === true, full: s.notify.full !== false, pile: s.notify.pile !== false, save: s.notify.save !== false },
    order: s.order === "workspace" ? "workspace" : "urgency",
    density: s.density === "always" || s.density === "never" ? s.density : "auto",
    style: s.style === "sci" ? "sci" : "short",
    notifySentToday: sent,
    automations: AUTOMATIONS.map((a) => {
      const have = state.bought[a.id] === true;
      return { id: a.id, name: a.name, owned: have, on: have && state.auto[a.id] !== false };
    }),
    popsDisabled: s.calm === true,
    notifyText: `${Math.min(3, sent)} of 3 sent today`,
  };
}

// ---------------------------------------------------------------------------
// Away and busy cards (§3.7, §10.3)

function awayCard(state, E, style) {
  const p = state.away.pot;
  const envelopes = Object.keys(state.envelopes).length;
  const envelopesText = envelopes > 0 ? `${plural(envelopes, "envelope", "envelopes")} waiting on the tray` : null;
  if (p) {
    const hs = state.helpers;
    const needs = [];
    for (const id of p.needs || []) {
      const h = hs[id];
      if (h && !h.gone && h.status === "blocked") needs.push({ helperId: id, name: nameOfHelper(h, CLIP.chip) });
    }
    // Tasks finished since the absence began (the pot's snapshot), never
    // lifetime totals; no line when nobody finished one (§10.3).
    const top = bestSince(state, p);
    const bh = top ? top.helper : null;
    const best = bh ? { helperId: bh.id, name: nameOfHelper(bh, CLIP.long), species: bh.species, tasks: top.tasks } : null;
    const affordable = (p.affordable || []).map((id) => ({ id, name: itemName(id) }));
    const rested = num(p.rested);
    return {
      kind: "away",
      duration: formatDuration(p.seconds * 1000, "spaced"),
      capped: p.capped === true,
      folds: `+${cnt(p.folds, style)}`,
      split: { workshops: cnt(p.split ? p.split.workshops : 0, style), helpers: cnt(p.split ? p.split.helpers : 0, style) },
      envelopes,
      needs,
      rested,
      best,
      affordable,
      collectable: true,
      title: "While you were away",
      capText: p.capped
        ? `You were away ${formatDuration(num(p.gap, p.seconds * 1000), "spaced")}; helpers fold for at most 8 h while you're gone.`
        : "(Creaseworks counts up to 8 h)",
      splitText: `workshops ${cnt(p.split ? p.split.workshops : 0, style)} · helpers ${cnt(p.split ? p.split.helpers : 0, style)}`,
      envelopesText,
      needsText: needs.length ? clip(`${needs.length === 1 ? "1 helper needs" : `${formatInt(needs.length)} helpers need`} you: ${needs.map((x) => x.name).join(", ")}`, CLIP.notice) : null,
      restedText: rested > 0 ? `${plural(rested, "helper", "helpers")} rested fully (next tasks ${times(1 + E.restMax)})` : null,
      bestText: best ? clip(`Best helper: ${best.name} the ${best.species}, ${plural(best.tasks, "task", "tasks")}`, CLIP.notice) : null,
      affordableText: affordable.length ? clip(`You can afford: ${affordable.map((x) => x.name).join(", ")}`, CLIP.notice) : null,
      at: p.at,
    };
  }
  let busy = null;
  for (const n of state.notices) if (n.kind === "busy" && (!busy || n.at > busy.at)) busy = n;
  if (!busy) return null;
  const d = busy.data || {};
  const tasks = num(d.tasks);
  return {
    kind: "busy",
    duration: formatDuration(num(d.seconds) * 1000, "spaced"),
    capped: false,
    folds: `+${cnt(num(d.folds), style)}`,
    split: null,
    envelopes: num(d.envelopes, envelopes),
    needs: [],
    rested: 0,
    best: null,
    affordable: [],
    collectable: false,
    title: "While you were busy",
    capText: null,
    splitText: null,
    envelopesText: num(d.envelopes, envelopes) > 0 ? `${plural(num(d.envelopes, envelopes), "envelope", "envelopes")} waiting on the tray` : null,
    tasks,
    tasksText: `${plural(tasks, "task", "tasks")} finished`,
    at: busy.at,
  };
}

function itemName(id) {
  for (const w of WORKSHOPS) if (w.id === id) return w.name;
  for (const u of UPGRADES) if (u.id === id) return u.name;
  for (const a of AUTOMATIONS) if (a.id === id) return a.name;
  return clip(String(id), CLIP.row);
}

// ---------------------------------------------------------------------------
// Notices: the glue's save notice first, then the engine's (§3.8). `place`
// says where each goes; the `busy` notice is the away card (vm.away).

function noticesVm(state, t, saveNotice, style) {
  const out = [];
  if (saveNotice) {
    const kind = saveNotice.kind;
    let text = typeof saveNotice.text === "string" ? saveNotice.text : SAVE_TEXT[kind] || "Save problem.";
    if (kind === "error" && typeof saveNotice.text !== "string" && saveNotice.message) {
      const retry = num(saveNotice.retryMs, 0);
      text = `Can't save: ${clip(String(saveNotice.message), CLIP.error)}.${retry > 0 ? ` Retrying in ${formatDuration(retry, "spaced")}.` : ""} Your progress is safe in memory.`;
    }
    out.push({ kind, text: clip(text, CLIP.notice), actions: (SAVE_ACTIONS[kind] || ["details"]).slice(), place: "banner", save: true, at: num(saveNotice.at, t) });
  }
  const list = state.notices.slice().sort((a, b) => b.at - a.at);
  for (const n of list) {
    const d = n.data || {};
    if (n.kind === "clock") {
      out.push({ kind: "clock", text: SAVE_TEXT.clock, actions: ["dismiss"], place: "banner", save: false, at: n.at });
    } else if (n.kind === "overflow") {
      const who = clip(String(d.name ?? ""), CLIP.long);
      out.push({ kind: "overflow", text: `+${cnt(num(d.amount), style)} from a full envelope${who ? ` (${who})` : ""}`, actions: [], place: "footer", save: false, at: n.at });
    } else if (n.kind === "away") {
      out.push({ kind: "away", text: `+${cnt(num(d.folds), style)} while away (${formatDuration(num(d.seconds) * 1000, "spaced")})`, actions: [], place: "footer", save: false, at: n.at });
    }
  }
  return out;
}

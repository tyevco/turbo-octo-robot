// Helpers: observation reconciliation, identity, production b_i, rest, warm,
// thanks, fledglings, Album and Elsewhere (DESIGN §5, §6.1, §12.5).

import { K, SPECIES, NAME_A, NAME_B } from "./content.js";
import { fnv1a32n } from "./hash.js";
import { crowd } from "./economy.js";
import { addUnits } from "./envelopes.js";
import { clip, cleanTitle } from "./text.js";

const STATUSES = ["working", "blocked", "done", "idle"];
const GROUP_OF = { working: "working", blocked: "needs", done: "finished", idle: "resting" };

/** Helper id: FNV-1a 32 hex of `address + "#" + created_ms` (§5.1). */
export function helperId(addr, created) {
  return hex8(fnv1a32n(`${addr}#${created}`));
}

function hex8(n) {
  return ("0000000" + n.toString(16)).slice(-8);
}

/** Species index, hue index and base name from the identity hash. */
export function lookOf(id) {
  const h = parseInt(id, 16) >>> 0;
  return {
    species: SPECIES[h % 12],
    hue: (h >>> 4) % 8,
    name: NAME_A[(h >>> 8) % 16] + NAME_B[(h >>> 12) % 12],
  };
}

/** Status group (needs|finished|working|resting|album), or "elsewhere" from `writerId`'s view. */
export function groupFor(h, writerId) {
  if (h.gone) return "album"; // Album records carry no cached group
  if (writerId !== undefined && writerId !== null && h.seenBy && h.seenBy !== writerId) return "elsewhere";
  return GROUP_OF[h.status] || "resting";
}

// The present-helper index is cached on the state under a symbol key (never
// serialised, dropped by cloneState) and rebuilt after any roster change.
const INDEX = Symbol("creaseworks/helper-index");

/** Forget the cached index (call after adding, removing or moving a helper to or from the Album). */
export function rosterChanged(state) {
  state[INDEX] = null;
}

/** Present helpers (not in the Album), split into all and pane helpers. */
export function indexHelpers(state) {
  const hs = state.helpers;
  const cached = state[INDEX];
  if (cached && cached.map === hs) return cached;
  const present = [];
  const panes = [];
  const ids = Object.keys(hs);
  for (let i = 0; i < ids.length; i++) {
    const h = hs[ids[i]];
    if (h.gone) continue;
    present.push(h);
    if (h.kind === "pane") panes.push(h);
  }
  const idx = { map: hs, present, panes };
  state[INDEX] = idx;
  return idx;
}

/**
 * Freshness of helper `h` at time `t` for the advancing `writer`: 1 live,
 * 2 unseen (another window stopped observing it 60 s ago: away rate for 8 h),
 * 0 unseen for more than 8 h (nothing). No writer given = every helper live.
 */
export function freshness(state, h, t, writer) {
  if (writer === undefined || writer === null || !h.seenBy || h.seenBy === writer) return 1;
  const ws = state.writersSeen[h.seenBy];
  const seen = typeof ws === "number" ? Math.max(ws, h.lastSeen) : h.lastSeen;
  if (t - seen < K.staleMs) return 1;
  if (t - seen < K.staleCreditMs) return 2;
  return 0;
}

/**
 * The flock's production terms at time `t` (§5.3, §10.2 "helpers nobody can see").
 * Returns { n, crowd, Hs0, Hstale, working: [[h, b_i]...], stale: [h...], N, base }.
 */
export function flock(state, E, idx, t, writer) {
  const base = (K.helperFlat * E.G + K.helperRw * E.Rw) * E.folk;
  const kidsW = Object.create(null);
  for (const h of idx.present) {
    if (h.kind === "kid" && h.status === "working" && h.parent && freshness(state, h, t, writer) === 1) {
      kidsW[h.parent] = (kidsW[h.parent] || 0) + 1;
    }
  }
  const working = [];
  const stale = [];
  let sum = 0;
  for (const h of idx.panes) {
    const fr = freshness(state, h, t, writer);
    if (fr === 2) { stale.push(h); continue; }
    if (fr !== 1 || h.status !== "working") continue;
    const warm = t < h.warmUntil ? h.warm : 1;
    const kids = 1 + E.kidBonus * Math.min(K.kidMax, kidsW[h.id] || 0);
    const thanks = t < h.thanksUntil ? K.thanksMult : 1;
    const b = base * warm * kids * thanks;
    working.push([h, b]);
    sum += b;
  }
  const n = working.length;
  const N = idx.panes.length;
  const c = crowd(n);
  return {
    n, crowd: c, Hs0: c * sum,
    Hstale: E.awayF * crowd(N) * base * stale.length,
    working, stale, N, base,
  };
}

/** Times in (t, end) where some helper's warm or thanks ends, or a writer turns stale. */
export function helperBreaks(state, idx, t, end, writer, out) {
  for (const h of idx.panes) {
    if (h.status === "working") {
      if (h.warmUntil > t && h.warmUntil < end) out.push(h.warmUntil);
      if (h.thanksUntil > t && h.thanksUntil < end) out.push(h.thanksUntil);
    }
  }
  if (writer !== undefined && writer !== null) {
    for (const w in state.writersSeen) {
      if (w === writer) continue;
      const a = state.writersSeen[w] + K.staleMs;
      const b = state.writersSeen[w] + K.staleCreditMs;
      if (a > t && a < end) out.push(a);
      if (b > t && b < end) out.push(b);
    }
  }
}

/** Resting and finished helpers charge rest over `dtMs` (§5.4). Returns how many became full. */
export function chargeRest(idx, E, dtMs) {
  let full = 0;
  const add = dtMs / E.restFullMs;
  for (const h of idx.present) {
    if (h.status !== "idle" && h.status !== "done") continue;
    if (h.rest >= 1) continue;
    h.rest = Math.min(1, h.rest + add);
    if (h.rest >= 1) full++;
  }
  return full;
}

// Fields only a present helper needs; an Album record drops them (save size,
// ARCHITECTURE A4: 64 helpers + 500 Album helpers < 256 KiB) and gets them
// back when the agent returns: these defaults, then the observation's values
// (addr, created, lastSeen, seenBy, group, title… are set by observe; the id
// is the hash of addr#created, so a returning agent finds its record).
const LIVE_FIELDS = {
  addr: "", created: 0, lastSeen: 0, seenBy: null, group: "resting",
  lastFinishAt: null, blockedAt: null, warm: 1, warmUntil: 0, thanksUntil: 0,
  title: null, pane: null, paneName: null, space: null, tab: null,
};

const round6 = (x) => (x === 0 ? 0 : Number(x.toPrecision(6)));

/** A helper whose agent has gone moves to the Album as a compact record. */
function toAlbum(h, t) {
  for (const k of Object.keys(LIVE_FIELDS)) delete h[k];
  h.gone = true;
  h.missingSince = t;
  h.rest = Math.round(h.rest * 1e4) / 1e4;
  h.stats.folds = round6(h.stats.folds);
  h.stats.run = round6(h.stats.run);
}

/** A returning agent (same address and created_ms) rejoins with its history. */
function rejoin(h, o) {
  h.gone = false;
  h.missingSince = null;
  for (const k of Object.keys(LIVE_FIELDS)) if (!(k in h)) h[k] = LIVE_FIELDS[k];
  h.addr = String(o.addr);
  h.created = Number(o.created) || 0;
}

function cleanStatus(s) {
  return STATUSES.indexOf(s) >= 0 ? s : "idle";
}

function str(v, max) {
  if (typeof v !== "string") return v === null || v === undefined ? null : String(v);
  return clip(cleanTitle(v), max);
}

function newRecord(state, o, id, t, w) {
  const look = lookOf(id);
  let name = look.name;
  let same = 0;
  for (const k in state.helpers) {
    const x = state.helpers[k];
    if (x.gone) continue;
    const sp = x.name.indexOf(" ");
    if ((sp < 0 ? x.name : x.name.slice(0, sp)) === look.name) same++;
  }
  if (same > 0) name = `${look.name} ${same + 1}`;
  const status = cleanStatus(o.status);
  return {
    id, addr: String(o.addr), created: Number(o.created) || 0,
    kind: o.kind === "kid" ? "kid" : "pane", parent: null,
    species: look.species, hue: look.hue, name,
    joined: t, lastSeen: t, seenBy: w,
    status, lastTurn: Number(o.turn) || 0, lastFinishAt: null,
    blockedAt: status === "blocked" ? t : null,
    rest: 0, warm: 1, warmUntil: 0, thanksUntil: 0, env: 0,
    stats: { tasks: 0, folds: 0, run: 0, envelopes: 0, checkIns: 0 },
    missingSince: null, group: GROUP_OF[status], gone: false,
    title: null, pane: null, paneName: null, space: null, tab: null,
  };
}

function transition(h, next, t, E) {
  const prev = h.status;
  if (prev === next) return;
  if (next === "working") {
    if (prev === "blocked" && h.blockedAt !== null && t - h.blockedAt <= K.thanksWindowMs) {
      h.thanksUntil = t + K.thanksMs;
    }
    if (h.rest > 0) {
      h.warm = 1 + E.restMax * h.rest;
      h.warmUntil = t + K.warmMs;
    }
    h.rest = 0;
  } else if (next === "blocked") {
    h.blockedAt = t;
  }
  h.status = next;
}

function finish(state, ctx, h, t, ev) {
  state.stats.tasks++;
  h.stats.tasks++;
  if (state.away.busy) state.away.busy.tasks++;
  if (h.warmUntil > t) h.warmUntil = t; // warm ends at the next turn increment
  const quick = h.lastFinishAt !== null && t - h.lastFinishAt < K.unitGapMs;
  h.lastFinishAt = t;
  let to = h;
  let units;
  if (h.kind === "kid") {
    units = quick ? K.unitKidQuick : K.unitKid;
    const p = h.parent ? state.helpers[h.parent] : null;
    if (p) to = p;
  } else {
    units = quick ? K.unitPaneQuick : K.unitPane;
  }
  addUnits(state, ctx, to, units, t, ev, `${h.id}:${h.lastTurn}`);
}

/**
 * Reconcile one `observe` action (§5.1, §6.1, §12.5). `t` is the action time,
 * `w` its writer. Helpers absent from a writer's list leave for the Album only
 * if that writer was the last to see them (`seenBy`).
 */
export function observe(state, ctx, action, t, ev) {
  const E = ctx.E;
  const w = action.w;
  const p = state.presence;
  // A background window does not overwrite the presence of the window being
  // played (its hand input within the last 30 s).
  if (!(p.handBy && p.handBy !== w && t - p.lastHandAt < K.activeWindowMs)) {
    if (typeof action.visible === "boolean") p.visible = action.visible;
    if (typeof action.active === "boolean") p.active = action.active;
    if (typeof action.matShown === "boolean") p.matShown = action.matShown;
  }
  if (typeof action.day === "string" && action.day > state.day) state.day = action.day;
  const hs = state.helpers;
  const list = Array.isArray(action.helpers) ? action.helpers : null;
  if (list) {
    const byAddr = Object.create(null);
    const ids = new Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o || typeof o !== "object") continue;
      ids[i] = helperId(o.addr, Number(o.created) || 0);
      byAddr[String(o.addr)] = i;
    }
    const seen = Object.create(null);
    const finished = [];
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      const id = ids[i];
      if (id === undefined || seen[id]) continue;
      seen[id] = true;
      let h = hs[id];
      const status = cleanStatus(o.status);
      if (!h) {
        h = newRecord(state, o, id, t, w);
        hs[id] = h;
      } else {
        // a stale observation replayed after a newer one (or after the agent left)
        if (h.gone ? t < h.missingSince : t < h.lastSeen) continue;
        if (h.gone) rejoin(h, o);
        const turn = Number(o.turn) || 0;
        if (turn > h.lastTurn) {
          h.lastTurn = turn;
          finished.push(h);
        } else if (turn < h.lastTurn) {
          h.lastTurn = turn; // core restart: rebaseline, no reward
        }
        transition(h, status, t, E);
      }
      resolveParent(state, h, o, list, ids, byAddr);
      h.lastSeen = t;
      h.seenBy = w;
      h.group = GROUP_OF[h.status];
      h.title = str(o.title, K.titleMax);
      h.pane = o.pane === null || o.pane === undefined ? null : String(o.pane);
      h.paneName = str(o.paneName, K.titleMax);
      h.space = str(o.space, K.titleMax);
      h.tab = str(o.tab, K.titleMax);
    }
    for (const id in hs) {
      const h = hs[id];
      if (h.gone || seen[id]) continue;
      if (!h.seenBy || h.seenBy === w) {
        if (t < h.lastSeen) continue;
        toAlbum(h, t);
      } else {
        h.group = "elsewhere";
      }
    }
    rosterChanged(state);
    // Finishes are paid after the roster settles, so overflow uses the new bench.
    if (finished.length) {
      ctx.refresh();
      for (const h of finished) finish(state, ctx, h, t, ev);
    }
  } else {
    for (const id in hs) {
      const h = hs[id];
      if (!h.gone && h.seenBy === w && t > h.lastSeen) h.lastSeen = t;
    }
  }
  prune(state, t);
}

function resolveParent(state, h, o, list, ids, byAddr) {
  if (h.kind !== "kid") return;
  let addr = o.parent;
  for (let hop = 0; hop < 32 && addr !== null && addr !== undefined; hop++) {
    const j = byAddr[String(addr)];
    if (j !== undefined) {
      if (list[j].kind !== "kid") { h.parent = ids[j]; return; }
      addr = list[j].parent;
      continue;
    }
    for (const id in state.helpers) {
      const x = state.helpers[id];
      if (!x.gone && x.addr === String(addr)) {
        if (x.kind === "pane") { h.parent = x.id; return; }
        if (x.parent) { h.parent = x.parent; return; }
        break;
      }
    }
    return;
  }
}

/** Fledglings gone for 30 days fold into their parent; writers unseen for 30 days are pruned. */
export function prune(state, t) {
  const hs = state.helpers;
  for (const id in hs) {
    const h = hs[id];
    if (h.kind !== "kid" || !h.gone || h.missingSince === null || t - h.missingSince <= K.kidAlbumMs) continue;
    const p = h.parent ? hs[h.parent] : null;
    if (p) {
      p.stats.kidsPast = (p.stats.kidsPast || 0) + 1;
      p.stats.kidsFolds = (p.stats.kidsFolds || 0) + h.stats.folds;
    }
    delete hs[id];
    rosterChanged(state);
  }
  for (const w in state.writersSeen) {
    if (t - state.writersSeen[w] > K.writerPruneMs) {
      delete state.writersSeen[w];
      delete state.applied[w];
    }
  }
}

/** Credit per-helper production shares (for the Flock card and the garland). */
export function creditHelpers(fl, mult, staleRate, sec) {
  if (sec <= 0) return;
  const k = fl.crowd * mult * sec;
  for (const [h, b] of fl.working) {
    const v = k * b;
    h.stats.folds += v;
    h.stats.run += v;
  }
  if (staleRate > 0 && fl.stale.length) {
    const v = staleRate * sec / fl.stale.length;
    for (const h of fl.stale) {
      h.stats.folds += v;
      h.stats.run += v;
    }
  }
}

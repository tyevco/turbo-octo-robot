// Helpers: observation reconciliation, identity, production b_i, rest, warm,
// thanks, fledglings, Album and Elsewhere (DESIGN §5, §6.1, §12.5).

import { K, SPECIES, NAME_A, NAME_B } from "./content.js";
import { fnv1a32n } from "./hash.js";
import { crowd, benchSum } from "./economy.js";
import { addUnits } from "./envelopes.js";
import { clip, cleanTitle } from "./text.js";

const STATUSES = ["working", "blocked", "done", "idle"];
const GROUP_OF = { working: "working", blocked: "needs", done: "finished", idle: "resting" };

/** Helper id: FNV-1a 32 hex of `address + "#" + created_ms` (§5.1). */
export function helperId(addr, created) {
  return hex8(fnv1a32n(`${addr}#${created}`));
}

/**
 * The id a terminal gets when its plain id is already held by a different
 * present terminal (a 32-bit hash clash, R6): attempt k ≥ 1 hashes
 * `address#created_ms#k`. Deterministic, so the clashing agent keeps the same
 * salted id on every observation.
 */
export function saltedId(addr, created, k) {
  return hex8(fnv1a32n(`${addr}#${created}#${k}`));
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
  const bs = [];
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
    bs.push(b);
    sum += b;
  }
  const n = working.length;
  const N = idx.panes.length;
  // Bench pace is marginal (§5.3): the k-th largest b_i counts eff(k) − eff(k−1),
  // so every working agent adds output and none can lower it. `crowd` is the
  // effective pace Hs0 / Σ b_i (crowd(n) when every b_i is equal), which the
  // per-helper credit shares.
  const Hs0 = benchSum(bs, sum);
  const c = sum > 0 ? Hs0 / sum : crowd(n);
  return {
    n, crowd: c, Hs0,
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
  // A salted id (R6) is remembered as its attempt number, so the same terminal
  // finds its own record again if it returns (the address is not kept).
  const salt = saltOf(h);
  if (salt > 0) h.salt = salt;
  else delete h.salt;
  for (const k of Object.keys(LIVE_FIELDS)) delete h[k];
  h.gone = true;
  h.missingSince = t;
  h.rest = Math.round(h.rest * 1e4) / 1e4;
  h.stats.folds = round6(h.stats.folds);
  h.stats.run = round6(h.stats.run);
}

// ---------------------------------------------------------------------------
// Album compaction (DESIGN R13). Beyond the K.albumKeep most recently gone pane
// helpers, an Album record is compacted: in memory it keeps only what the
// Album shows ({id, name, species, hue, folds, tasks, missingSince to the
// minute}, every other field at its default, `compact: true`), and the save
// codec writes it as a short array (packAlbum / unpackAlbum), about 40 bytes
// instead of about 290. The in-memory record is always exactly what loading
// its packed form gives, so a reload (or a merge, which replays onto the
// loaded save) changes nothing. Gone fledglings beyond K.kidAlbumKeep fold
// into their parent early, as they do after 30 days. Nothing is dropped.

const MINUTE = 60000;

/** The packed save form of a compact Album record, or null if `h` no longer matches its compact form. */
export function packAlbum(h) {
  if (!h || h.compact !== true || h.gone !== true || h.kind !== "pane" || h.parent !== null) return null;
  const s = h.stats;
  if (!s || typeof s !== "object" || typeof h.name !== "string") return null;
  if (h.joined !== 0 || h.status !== "idle" || h.lastTurn !== 0 || h.rest !== 0 || h.env !== 0) return null;
  if (s.run !== 0 || s.envelopes !== 0 || s.checkIns !== 0) return null;
  if (!Number.isFinite(s.folds) || !Number.isFinite(s.tasks)) return null;
  const m = h.missingSince;
  if (typeof m !== "number" || !Number.isFinite(m) || m % MINUTE !== 0) return null;
  const look = lookOf(h.id);
  if (h.species !== look.species || h.hue !== look.hue) return null;
  const a = [h.name === look.name ? 0 : h.name, s.folds, s.tasks, m / MINUTE];
  if (s.kidsPast > 0) {
    if (!Number.isFinite(s.kidsPast) || !Number.isFinite(s.kidsFolds)) return null;
    a.push(s.kidsPast, s.kidsFolds);
  } else if (s.kidsPast !== undefined && s.kidsPast !== 0) {
    return null;
  }
  return a;
}

const isFiniteNum = (v) => typeof v === "number" && Number.isFinite(v);

/** The in-memory compact record of a packed Album entry, or null when the entry is malformed. */
export function unpackAlbum(id, a) {
  if (typeof id !== "string" || !/^[0-9a-f]{8}$/.test(id) || !Array.isArray(a)) return null;
  if (a.length !== 4 && a.length !== 6) return null;
  if (a[0] !== 0 && (typeof a[0] !== "string" || a[0].length === 0)) return null;
  for (let i = 1; i < a.length; i++) if (!isFiniteNum(a[i])) return null;
  const look = lookOf(id);
  const stats = { tasks: a[2], folds: a[1], run: 0, envelopes: 0, checkIns: 0 };
  if (a.length === 6) {
    if (!(a[4] > 0)) return null;
    stats.kidsPast = a[4];
    stats.kidsFolds = a[5];
  }
  return {
    id, kind: "pane", parent: null, species: look.species, hue: look.hue,
    name: a[0] === 0 ? look.name : a[0],
    joined: 0, status: "idle", lastTurn: 0, rest: 0, env: 0, stats,
    missingSince: a[3] * MINUTE, gone: true, compact: true,
  };
}

const round4 = (x) => (x === 0 || !Number.isFinite(x) ? 0 : Number(x.toPrecision(4)));

/** Compact a gone pane record in place: exactly unpackAlbum(packAlbum(...)) of it. */
function compactRecord(h) {
  const s = h.stats || {};
  const m = typeof h.missingSince === "number" && Number.isFinite(h.missingSince) ? h.missingSince : 0;
  const a = [h.name, round4(s.folds), isFiniteNum(s.tasks) ? s.tasks : 0, Math.floor(m / MINUTE)];
  if (s.kidsPast > 0 && isFiniteNum(s.kidsPast)) a.push(s.kidsPast, isFiniteNum(s.kidsFolds) ? s.kidsFolds : 0);
  const look = lookOf(h.id);
  if (a[0] === look.name || typeof a[0] !== "string" || a[0].length === 0) a[0] = 0;
  const c = unpackAlbum(h.id, a);
  if (!c) return false; // not an engine-made id (a legacy or hand-edited save): kept whole
  for (const k of Object.keys(h)) delete h[k];
  Object.assign(h, c);
  return true;
}

const byLeft = (a, b) => a.missingSince - b.missingSince || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ---------------------------------------------------------------------------
// Display names (§5.1): the base name from the hash, and " 2", " 3"… for the
// smallest number no present helper with that base holds.

function nameParts(name) {
  const sp = name.indexOf(" ");
  if (sp < 0) return [name, 1];
  const n = name.slice(sp + 1);
  return [name.slice(0, sp), /^[1-9][0-9]{0,5}$/.test(n) ? Number(n) : 0];
}

/** base → { taken number: true } over the present helpers. */
function nameSlots(present) {
  const slots = Object.create(null);
  for (const x of present) takeName(slots, x.name);
  return slots;
}

function takeName(slots, name) {
  if (typeof name !== "string") return;
  const [base, k] = nameParts(name);
  if (!k) return;
  (slots[base] || (slots[base] = Object.create(null)))[k] = true;
}

function nameTaken(slots, name) {
  if (typeof name !== "string") return false;
  const [base, k] = nameParts(name);
  return k > 0 && slots[base] !== undefined && slots[base][k] === true;
}

function freeName(slots, base) {
  const used = slots[base];
  let k = 1;
  if (used) while (used[k] === true) k++;
  return k === 1 ? base : `${base} ${k}`;
}

/** A returning agent (same address and created_ms) rejoins with its history. */
function rejoin(h, o, slots, t) {
  const wasCompact = h.compact === true;
  h.gone = false;
  h.missingSince = null;
  delete h.compact;
  for (const k of Object.keys(LIVE_FIELDS)) if (!(k in h)) h[k] = LIVE_FIELDS[k];
  h.addr = String(o.addr);
  h.created = Number(o.created) || 0;
  // A compacted record kept no turn or join time: rebaseline the turn to this
  // sighting (no reward) and join it now, so join order lists it as the newest.
  if (wasCompact) {
    h.lastTurn = Number(o.turn) || 0;
    h.joined = t;
  }
  // Its old name may have been given to a present namesake meanwhile.
  if (nameTaken(slots, h.name)) h.name = freeName(slots, lookOf(h.id).name);
  takeName(slots, h.name);
}

function cleanStatus(s) {
  return STATUSES.indexOf(s) >= 0 ? s : "idle";
}

function str(v, max) {
  if (typeof v !== "string") return v === null || v === undefined ? null : String(v);
  return clip(cleanTitle(v), max);
}

function newRecord(o, id, t, w, slots) {
  const look = lookOf(id);
  const name = freeName(slots, look.name);
  takeName(slots, name);
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
    // Present helpers before this observation: their names and addresses are
    // indexed once (not rescanned per new agent, whatever the Album's size).
    const before = indexHelpers(state).present;
    let slots = null;
    const names = () => slots || (slots = nameSlots(before));
    let addrs = null;
    const byAddrPresent = () => {
      if (addrs) return addrs;
      addrs = Object.create(null);
      for (const x of before) {
        const a = String(x.addr);
        if (addrs[a] === undefined) addrs[a] = x;
      }
      return addrs;
    };
    const byAddr = Object.create(null);
    const ids = new Array(list.length);
    const claim = Object.create(null); // id → list index that holds it in this observation
    let keys = null;
    const byKeyPresent = () => {
      if (keys) return keys;
      keys = Object.create(null);
      for (const x of before) keys[`${x.addr}#${Number(x.created) || 0}`] = x.id;
      return keys;
    };
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o || typeof o !== "object") continue;
      ids[i] = claimId(hs, claim, list, o, i, byKeyPresent);
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
        h = newRecord(o, id, t, w, names());
        hs[id] = h;
      } else {
        // a stale observation replayed after a newer one (or after the agent left)
        if (h.gone ? t < h.missingSince : t < h.lastSeen) continue;
        if (h.gone) rejoin(h, o, names(), t);
        const turn = Number(o.turn) || 0;
        if (turn > h.lastTurn) {
          h.lastTurn = turn;
          finished.push(h);
        } else if (turn < h.lastTurn) {
          h.lastTurn = turn; // core restart: rebaseline, no reward
        }
        transition(h, status, t, E);
      }
      resolveParent(h, o, list, ids, byAddr, byAddrPresent);
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
      // Another window's helper stays in Elsewhere while that window may still
      // be observing it; once nobody has seen it for 8 h (its window closed, or
      // herdr restarted with a new writer id), any window adopts it (§12.5).
      if (!h.seenBy || h.seenBy === w || freshness(state, h, t, w) === 0) {
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

/**
 * The id list entry `i` takes (R6). A terminal already present keeps the id it
 * holds, plain or salted, whatever else came or went. Otherwise it takes its
 * plain id, unless that id is held by a different terminal (an earlier entry of
 * this list, or a present helper with another address or created_ms), when it
 * takes the first free salted id. A returning terminal whose plain id belongs
 * to a gone record first looks for its own salted Album record (`salt`). The
 * same terminal always resolves to the same id. undefined = no id (a duplicate
 * of an earlier entry, or no free salt).
 */
function claimId(hs, claim, list, o, i, present) {
  const addr = String(o.addr);
  const created = Number(o.created) || 0;
  const same = (j) => String(list[j].addr) === addr && (Number(list[j].created) || 0) === created;
  const held = present()[`${addr}#${created}`];
  if (held !== undefined) {
    const j = claim[held];
    if (j === undefined) {
      claim[held] = i;
      return held;
    }
    if (same(j)) return held;
  }
  let id = helperId(addr, created);
  const plain = hs[id];
  if (plain && plain.gone) {
    // Salted ids are taken in order, so the probe stops at the first unused one.
    for (let k = 1; k <= 16; k++) {
      const sid = saltedId(addr, created, k);
      const r = hs[sid];
      if (!r) break;
      if (r.gone && r.salt === k && claim[sid] === undefined) {
        claim[sid] = i;
        return sid;
      }
    }
  }
  for (let k = 1; k <= 16; k++) {
    const j = claim[id];
    if (j !== undefined) {
      if (same(j)) return id; // the same terminal twice
    } else {
      const h = hs[id];
      if (!h || h.gone || (h.addr === addr && h.created === created)) {
        claim[id] = i;
        return id;
      }
    }
    id = saltedId(addr, created, k);
  }
  return undefined;
}

/** The salt attempt k ≥ 1 behind a present helper's id, or 0 for a plain id (or unknown). */
function saltOf(h) {
  if (typeof h.addr !== "string" || h.addr === "") return 0;
  const created = Number(h.created) || 0;
  if (helperId(h.addr, created) === h.id) return 0;
  for (let k = 1; k <= 16; k++) if (saltedId(h.addr, created, k) === h.id) return k;
  return 0;
}

function resolveParent(h, o, list, ids, byAddr, byAddrPresent) {
  if (h.kind !== "kid") return;
  let addr = o.parent;
  for (let hop = 0; hop < 32 && addr !== null && addr !== undefined; hop++) {
    const j = byAddr[String(addr)];
    if (j !== undefined) {
      if (list[j].kind !== "kid") { h.parent = ids[j]; return; }
      addr = list[j].parent;
      continue;
    }
    const x = byAddrPresent()[String(addr)];
    if (x !== undefined && !x.gone) {
      if (x.kind === "pane") { h.parent = x.id; return; }
      if (x.parent) { h.parent = x.parent; return; }
    }
    return;
  }
}

/** A gone fledgling folds into its parent's record (kidsPast, kidsFolds) and leaves the save. */
function foldKid(state, h) {
  const hs = state.helpers;
  const p = h.parent ? hs[h.parent] : null;
  if (p) {
    p.stats.kidsPast = (p.stats.kidsPast || 0) + 1;
    p.stats.kidsFolds = (p.stats.kidsFolds || 0) + h.stats.folds;
  }
  delete hs[h.id];
  rosterChanged(state);
}

/**
 * Keep the save bounded (R13): fledglings gone for 30 days, or beyond the
 * K.kidAlbumKeep most recently gone, fold into their parent; gone pane helpers
 * beyond the K.albumKeep most recently gone are compacted. Writers unseen for
 * 30 days are pruned.
 */
export function prune(state, t) {
  const hs = state.helpers;
  const kids = [];
  const full = [];
  for (const id in hs) {
    const h = hs[id];
    if (!h.gone) continue;
    if (h.kind === "kid") {
      if (typeof h.missingSince !== "number") continue;
      if (t - h.missingSince > K.kidAlbumMs) foldKid(state, h);
      else kids.push(h);
    } else if (h.compact !== true && !(h.salt > 0)) {
      full.push(h); // a salted record keeps its `salt` (R6), so it is never compacted
    }
  }
  if (kids.length > K.kidAlbumKeep) {
    kids.sort(byLeft);
    for (let i = 0, n = kids.length - K.kidAlbumKeep; i < n; i++) foldKid(state, kids[i]);
  }
  if (full.length > K.albumKeep) {
    full.sort(byLeft);
    // Oldest first; a record that cannot be packed (not an engine-made id) stays whole.
    let excess = full.length - K.albumKeep;
    const n0 = excess;
    for (let i = 0; i < full.length && excess > 0; i++) if (compactRecord(full[i])) excess--;
    if (excess !== n0) rosterChanged(state);
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

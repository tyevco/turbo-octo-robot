// Helpers: observation reconciliation, identity, production b_i, rest, warm,
// thanks, fledglings, Album and Elsewhere (DESIGN §5, §6.1, §12.5).

import { K, SPECIES, NAMES, NAME_SKIP } from "./content.js";
import { fnv1a32n } from "./hash.js";
import { crowd, benchSum } from "./economy.js";
import { addUnits, settleEnvelope, pushNotice } from "./envelopes.js";
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

/**
 * A second, 16-bit hash of `address#created_ms` that an Album record keeps
 * (`key`) when its address is dropped (R6, r3-18): a new terminal whose plain
 * id clashes with a gone helper's record rejoins it only when the keys match;
 * otherwise the record is another terminal's and the newcomer takes a salted id.
 */
export function albumKey(addr, created) {
  return fnv1a32n(`key#${addr}#${created}`) >>> 16;
}

const validKey = (k) => Number.isInteger(k) && k >= 0 && k <= 0xffff;

/** True when gone record `h` may be the Album record of terminal (addr, created): its key matches, or it has none (an older save). */
function albumMatch(h, addr, created) {
  return h.key === undefined || h.key === albumKey(addr, created);
}

/** Species index, hue index and base name from the identity hash (names: content.js NAMES, §5.1). */
export function lookOf(id) {
  const h = parseInt(id, 16) >>> 0;
  return {
    species: SPECIES[h % 12],
    hue: (h >>> 4) % 8,
    name: NAMES[((h >>> 8) % 16) * 12 + ((h >>> 12) % 12)],
  };
}

/** True when a display name's base ("Loli" of "Loli 2") is one the game no longer gives (NAME_SKIP, §5.1). */
export function skippedName(name) {
  if (typeof name !== "string") return false;
  const sp = name.indexOf(" ");
  return NAME_SKIP.indexOf(sp < 0 ? name : name.slice(0, sp)) >= 0;
}

/** Status group (needs|finished|working|resting|album), or "elsewhere" from `writerId`'s view. */
export function groupFor(h, writerId) {
  if (h.gone) return "album"; // Album records carry no cached group
  if (writerId !== undefined && writerId !== null && h.seenBy && h.seenBy !== writerId) return "elsewhere";
  return GROUP_OF[h.status] || "resting";
}

// The present-helper index is cached on the state (never serialised, dropped by
// cloneState) and rebuilt after any roster change. Its key is a registry
// symbol, the same in every code generation, so the state a hot reload hands
// over keeps one index, not one per generation (glue/live.js: the slot holds
// plain data only; the index is a plain object of arrays). `shape` tells
// generations whose index differs apart: another shape is rebuilt, never read.
const INDEX = Symbol.for("creaseworks/helper-index");
const INDEX_SHAPE = 1;

/** Forget the cached index (call after adding, removing or moving a helper to or from the Album). */
export function rosterChanged(state) {
  if (Object.hasOwn(state, INDEX)) state[INDEX] = null;
}

/** Present helpers (not in the Album), split into all and pane helpers. */
export function indexHelpers(state) {
  const hs = state.helpers;
  const cached = Object.hasOwn(state, INDEX) ? state[INDEX] : null;
  if (cached && cached.map === hs && cached.shape === INDEX_SHAPE) return cached;
  const present = [];
  const panes = [];
  const ids = Object.keys(hs);
  for (let i = 0; i < ids.length; i++) {
    const h = hs[ids[i]];
    if (h.gone) continue;
    present.push(h);
    if (h.kind === "pane") panes.push(h);
  }
  const idx = Object.create(null);
  idx.shape = INDEX_SHAPE;
  idx.map = hs;
  idx.present = present;
  idx.panes = panes;
  if (Object.hasOwn(state, INDEX)) state[INDEX] = idx;
  else if (Object.isExtensible(state)) {
    // A build before this one kept its index under a symbol of its own code
    // generation: handed over by a hot reload, it is dropped here, once.
    for (const k of Object.getOwnPropertySymbols(state)) {
      if (k.description === INDEX.description && Object.getOwnPropertyDescriptor(state, k).configurable) delete state[k];
    }
    Object.defineProperty(state, INDEX, { value: idx, writable: true, configurable: true, enumerable: false });
  }
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
 * How much away-rate time helper `h` may still earn in an away segment that
 * starts at `t0` (§10.2 "helpers nobody can see", review r4-06). A helper has
 * one unseen allowance of K.staleCreditMs (8 h) per absence, counted from the
 * time it was last seen (`lastSeen`, or its writer's last sign of life, as in
 * `freshness`): the time since it went unseen (60 s after that) is spent,
 * whether it was credited live at the stale rate by another window, by an
 * earlier away segment, or not at all. So the live stale credit and the away
 * segment never add up past 8 h, whichever window reopens. A helper seen
 * within 60 s of `t0` (the game just closed) has the whole 8 h. With no
 * writer given (every helper live, as in `freshness`) or no `seenBy` (an
 * older save) the whole allowance is left. The same for every writer (the
 * helper's own window reopening or another one), so which window reopens
 * changes nothing. Returns ms (0 to K.staleCreditMs).
 */
export function unseenLeftMs(state, h, t0, writer) {
  if (writer === undefined || writer === null || !h.seenBy) return K.staleCreditMs;
  const ws = state.writersSeen[h.seenBy];
  const ls = typeof h.lastSeen === "number" && Number.isFinite(h.lastSeen) ? h.lastSeen : t0;
  const seen = typeof ws === "number" ? Math.max(ws, ls) : ls;
  const spent = Math.max(0, t0 - seen - K.staleMs);
  return Math.max(0, Math.min(K.staleCreditMs, K.staleCreditMs - spent));
}

/**
 * Whether pane helper `h` earns the away estimate (§10.2), in an away segment
 * and as a helper nobody can see: any status but "blocked". A helper waiting
 * for input is waiting for the absent player, so it stops helping, as it does
 * live (review r6-05).
 */
export function awayPays(h) {
  return h.status !== "blocked";
}

/**
 * The flock's production terms at time `t` (§5.3, §10.2 "helpers nobody can see").
 * Stale helpers (fr 2) earn the away rate unless they wait on the player
 * (awayPays); the away crowd counts the pane helpers the away rate pays (Na),
 * as in an away segment, so a waiting agent adds neither a share nor a seat.
 * Returns { n, crowd, Hs0, Hstale, working: [[h, b_i]...], kids: [[parent, b]...]
 * (working fledglings of a parent that is not working), stale: [h...], N, base }.
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
  let Na = 0;
  for (const h of idx.panes) {
    const pays = awayPays(h);
    if (pays) Na++;
    const fr = freshness(state, h, t, writer);
    if (fr === 2) { if (pays) stale.push(h); continue; }
    if (fr !== 1 || h.status !== "working") continue;
    const warm = t < h.warmUntil ? h.warm : 1;
    const kids = 1 + E.kidBonus * Math.min(K.kidMax, kidsW[h.id] || 0);
    const thanks = t < h.thanksUntil ? K.thanksMult : 1;
    const b = base * warm * kids * thanks;
    working.push([h, b]);
    bs.push(b);
    sum += b;
  }
  // Working fledglings whose parent is present here but not working (idle,
  // finished, or waiting on the player) still gather (r3-10, §5.3): each
  // parent gets `base · kidBonus · min(kidMax, working fledglings)`, the share
  // they add to a working parent, credited to the parent's record. They are
  // seats on the bench like any b_i (marginal pace), but not working agents.
  let orphans = null;
  for (const pid in kidsW) {
    const p = Object.hasOwn(state.helpers, pid) ? state.helpers[pid] : null;
    if (!p || p.gone || p.kind !== "pane" || p.status === "working") continue;
    if (freshness(state, p, t, writer) !== 1) continue;
    const b = base * E.kidBonus * Math.min(K.kidMax, kidsW[pid]);
    if (!(b > 0)) continue;
    (orphans || (orphans = [])).push([p, b]);
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
    Hstale: E.awayF * crowd(Na) * base * stale.length,
    working, kids: orphans || [], stale, N, base,
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
  warm: 1, warmUntil: 0, thanksUntil: 0,
  title: null, pane: null, paneName: null, space: null, tab: null,
};

// History a full Album record keeps (review r4-10): the envelope-unit budgets
// (r3-24) and the last finish and wait times. An agent that leaves and comes
// back in the same terminal (a one-shot agent run in a loop, a restart) rejoins
// with its budgets as they were, so leaving cannot refill them, and a wait
// that started before it left still earns its thanks. Only compaction (R13)
// forgets them; a rejoining compact record gets these defaults (a budget never
// drawn on), as a brand-new terminal does. A null value is not saved.
const KEPT_FIELDS = { lastFinishAt: null, unitAt: null, kidUnitAt: null, blockedAt: null };

const round6 = (x) => (x === 0 ? 0 : Number(x.toPrecision(6)));

/** A helper whose agent has gone moves to the Album as a compact record. */
function toAlbum(h, t) {
  // A salted id (R6) is remembered as its attempt number, so the same terminal
  // finds its own record again if it returns (the address is not kept).
  const salt = saltOf(h);
  if (salt > 0) h.salt = salt;
  else delete h.salt;
  if (typeof h.addr === "string" && h.addr !== "") h.key = albumKey(h.addr, Number(h.created) || 0);
  for (const k of Object.keys(LIVE_FIELDS)) delete h[k];
  for (const k of Object.keys(KEPT_FIELDS)) if (!isFiniteNum(h[k])) delete h[k];
  // the fledgling budget's field before kidUnitAt (r3-24), kept as kidUnitAt's start
  if (isFiniteNum(h.kidFinishAt) && !isFiniteNum(h.kidUnitAt)) h.kidUnitAt = h.kidFinishAt;
  delete h.kidFinishAt;
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
  if (h.key !== undefined) {
    if (!validKey(h.key)) return null;
    a.push(h.key); // r3-18: an odd length carries the key last
  }
  return a;
}

const isFiniteNum = (v) => typeof v === "number" && Number.isFinite(v);

const HEX8 = /^[0-9a-f]{8}$/;

/** The in-memory compact record of a packed Album entry, or null when the entry is malformed. */
export function unpackAlbum(id, a) {
  // Runs once per Album helper on every load (thousands after a year): no
  // allocation beyond the record itself (the look is computed inline).
  if (typeof id !== "string" || id.length !== 8 || !HEX8.test(id) || !Array.isArray(a)) return null;
  const len = a.length;
  if (len < 4 || len > 7) return null;
  // 4: name, folds, tasks, minute; 6: + kidsPast, kidsFolds; 5 and 7: + key (r3-18)
  const keyed = (len & 1) === 1;
  const body = keyed ? len - 1 : len;
  const a0 = a[0];
  if (a0 !== 0 && (typeof a0 !== "string" || a0.length === 0)) return null;
  for (let i = 1; i < len; i++) if (!isFiniteNum(a[i])) return null;
  if (keyed && !validKey(a[len - 1])) return null;
  const stats = { tasks: a[2], folds: a[1], run: 0, envelopes: 0, checkIns: 0 };
  if (body === 6) {
    if (!(a[4] > 0)) return null;
    stats.kidsPast = a[4];
    stats.kidsFolds = a[5];
  }
  const h = parseInt(id, 16) >>> 0;
  const rec = {
    id, kind: "pane", parent: null, species: SPECIES[h % 12], hue: (h >>> 4) % 8,
    name: a0 === 0 || skippedName(a0) ? NAMES[((h >>> 8) % 16) * 12 + ((h >>> 12) % 12)] : a0,
    joined: 0, status: "idle", lastTurn: 0, rest: 0, env: 0, stats,
    missingSince: a[3] * MINUTE, gone: true, compact: true,
  };
  if (keyed) rec.key = a[len - 1];
  return rec;
}

const round4 = (x) => (x === 0 || !Number.isFinite(x) ? 0 : Number(x.toPrecision(4)));

/**
 * Compact a gone pane record in place: exactly unpackAlbum(packAlbum(...)) of
 * it. Its folds and fledgling folds keep 4 significant digits (≤ 0.005 %),
 * which is what keeps a packed entry near 45 bytes; anything later added to a
 * compact record (an envelope cashed in, a fledgling folded in) is rounded
 * the same way by compacting it again (review r5-08: those sums were written
 * at full precision, ≈ 10 bytes more per entry).
 */
function compactRecord(h) {
  const s = h.stats || {};
  const m = typeof h.missingSince === "number" && Number.isFinite(h.missingSince) ? h.missingSince : 0;
  const a = [h.name, round4(s.folds), isFiniteNum(s.tasks) ? s.tasks : 0, Math.floor(m / MINUTE)];
  if (s.kidsPast > 0 && isFiniteNum(s.kidsPast)) a.push(s.kidsPast, isFiniteNum(s.kidsFolds) ? round4(s.kidsFolds) : 0);
  if (validKey(h.key)) a.push(h.key);
  const look = lookOf(h.id);
  if (a[0] === look.name || typeof a[0] !== "string" || a[0].length === 0 || skippedName(a[0])) a[0] = 0;
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
  const leftAt = h.missingSince;
  h.gone = false;
  h.missingSince = null;
  delete h.compact;
  delete h.key; // present again: its address is known (toAlbum sets the key anew)
  for (const k of Object.keys(LIVE_FIELDS)) if (!(k in h)) h[k] = LIVE_FIELDS[k];
  for (const k of Object.keys(KEPT_FIELDS)) if (!(k in h)) h[k] = KEPT_FIELDS[k];
  h.addr = String(o.addr);
  h.created = Number(o.created) || 0;
  // A compacted record kept no turn or join time: rebaseline the turn to this
  // sighting (no reward) and join it now, so join order lists it as the newest.
  if (wasCompact) {
    h.lastTurn = Number(o.turn) || 0;
    h.joined = t;
  }
  // Left while waiting and back waiting after more than the thanks window: a
  // new wait, timed (and pulsed) from now, not from before it left.
  if (h.status === "blocked" && cleanStatus(o.status) === "blocked" && isFiniteNum(leftAt) && t - leftAt > K.thanksWindowMs) h.blockedAt = t;
  // Its old name may have been given to a present namesake meanwhile (or be
  // one the game no longer gives, from an older save).
  if (nameTaken(slots, h.name) || skippedName(h.name)) h.name = freeName(slots, lookOf(h.id).name);
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
    status, lastTurn: Number(o.turn) || 0, lastFinishAt: null, unitAt: null, kidUnitAt: null,
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

const numOr = (x, d) => (typeof x === "number" && Number.isFinite(x) ? x : d);

/**
 * Draw on an envelope-unit budget (§6.1, r3-24): a token bucket that holds at
 * most one unit and refills one unit per K.unitRefillMs (12 min). `o[key]` is
 * the time the bucket was last empty (its level at `t` is
 * `min(1, (t − o[key]) / 12 min)`); `empty` is that time for a budget never
 * drawn on (null: it starts full). A finish takes all the bucket holds, in
 * 64ths (unit counts stay exact binary fractions, inv. 9 sums them); the
 * remainder below 1/64 stays in the bucket. So a budget pays at most one unit
 * per 12 minutes plus the one it starts with, however many finishes draw on
 * it: envelope units follow time, not the number of turns, and a finish soon
 * after another (or a stream of them) earns little or nothing. Returns the
 * share drawn (0 to 1).
 */
function drawUnits(o, key, t, empty = null) {
  let at = o[key];
  if (typeof at !== "number" || !Number.isFinite(at)) at = empty;
  if (typeof at !== "number" || !Number.isFinite(at)) {
    o[key] = t;
    return 1;
  }
  const from = Math.max(at, t - K.unitRefillMs);
  const share = Math.max(0, Math.floor(((t - from) / K.unitRefillMs) * 64) / 64);
  o[key] = from + share * K.unitRefillMs;
  return share;
}

function finish(state, ctx, h, t, ev) {
  state.stats.tasks++;
  h.stats.tasks++;
  if (state.away.busy) state.away.busy.tasks++;
  if (h.warmUntil > t) h.warmUntil = t; // warm ends at the next turn increment
  let to = h;
  let units;
  if (h.kind === "kid") {
    // A fledgling's units go to its parent while that parent is present; with
    // the parent gone (or unknown) they stay with the fledgling itself, so no
    // envelope is ever filed under an Album record (R13, review r2-18). Every
    // fledgling of a parent draws on the parent's one fledgling budget
    // (`kidUnitAt`, r3-24), so a burst of short-lived sub-agents with new
    // addresses earns what one busy fledgling does: at most half a unit per
    // 12 minutes. A fledgling on its own budget starts it empty when it
    // joined, so short-lived orphans with new addresses earn by their time too.
    const p = h.parent ? state.helpers[h.parent] : null;
    if (p && !p.gone) {
      to = p;
      // kidFinishAt: the same budget's field in saves before kidUnitAt
      units = K.unitKid * drawUnits(p, "kidUnitAt", t, numOr(p.kidFinishAt, null));
      delete p.kidFinishAt;
    } else {
      units = K.unitKid * drawUnits(h, "unitAt", t, numOr(h.lastFinishAt, numOr(h.joined, null)));
    }
  } else {
    // lastFinishAt: where a save before unitAt left this budget empty
    units = K.unitPane * drawUnits(h, "unitAt", t, numOr(h.lastFinishAt, null));
  }
  h.lastFinishAt = t;
  if (units > 0) addUnits(state, ctx, to, units, t, ev, `${h.id}:${h.lastTurn}`);
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
        else if (skippedName(h.name)) {
          // a present helper from an older save named before NAME_SKIP (§5.1)
          h.name = freeName(names(), lookOf(h.id).name);
          takeName(names(), h.name);
        }
        // Kind follows the observation (§5.2): a sub-agent with its own pane is
        // a fledgling only while its parent chain reaches another helper, so it
        // becomes a pane helper when that parent leaves (and a fledgling again
        // if it returns). The roster index is rebuilt below.
        const kind = o.kind === "kid" ? "kid" : "pane";
        if (h.kind !== kind) {
          h.kind = kind;
          h.parent = null;
        }
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
  prune(state, t, ctx, ev);
}

/**
 * The id list entry `i` takes (R6). A terminal already present keeps the id it
 * holds, plain or salted, whatever else came or went. Otherwise it takes its
 * plain id, unless that id is held by a different terminal (an earlier entry of
 * this list, a present helper with another address or created_ms, or an Album
 * record whose `key` is another terminal's, r3-18), when it takes the first
 * free salted id. A returning terminal first looks for its own salted Album
 * record (`salt`, `key`), whoever holds its plain id or none (r7-10). The
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
  // A returning terminal finds its own salted Album record first, whatever
  // became of its plain id (review r7-10): that id may be held by a present
  // terminal, or have no record at all (a fledgling that held it folded into
  // its parent, a compact record merged into an archive entry). Every k is
  // probed: the records of smaller salts can have left the save the same way.
  for (let k = 1; k <= 16; k++) {
    const sid = saltedId(addr, created, k);
    const r = hs[sid];
    if (r && r.gone && r.salt === k && claim[sid] === undefined && albumMatch(r, addr, created)) {
      claim[sid] = i;
      return sid;
    }
  }
  let id = helperId(addr, created);
  for (let k = 1; k <= 16; k++) {
    const j = claim[id];
    if (j !== undefined) {
      if (same(j)) return id; // the same terminal twice
    } else {
      const h = hs[id];
      // a gone record is free unless its key says it was another terminal (r3-18)
      if (!h || (h.gone ? albumMatch(h, addr, created) : h.addr === addr && h.created === created)) {
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

/**
 * A gone fledgling folds into its parent's record (kidsPast, kidsFolds) and
 * leaves the save. Nothing is dropped when that record is no longer in the
 * save (its parent was merged into an Album archive entry, r3-04) or it never
 * had a parent: it folds into the archive entry of the 30 days it left in when
 * there is one, else it stays as a helper of its own (a gone pane record,
 * compacted and archived like any other), so its folds stay in the Album.
 */
function foldKid(state, h) {
  const hs = state.helpers;
  let p = h.parent && Object.hasOwn(hs, h.parent) ? hs[h.parent] : null;
  if (!p && typeof h.missingSince === "number") {
    const aid = archiveId(h.missingSince);
    const a = Object.hasOwn(hs, aid) ? hs[aid] : null;
    if (a && a.archive > 0 && a.gone) p = a;
  }
  if (!p) {
    h.kind = "pane";
    h.parent = null;
    rosterChanged(state);
    return;
  }
  // The fledgling and the fledglings already folded into its own record (a
  // sub-agent in its own pane is a pane helper while its parent is away, §5.2,
  // and absorbs fledglings of its own then): review r4-11.
  const s = h.stats;
  p.stats.kidsPast = (p.stats.kidsPast || 0) + 1 + (isFiniteNum(s.kidsPast) && s.kidsPast > 0 ? s.kidsPast : 0);
  p.stats.kidsFolds = (p.stats.kidsFolds || 0) + (isFiniteNum(s.folds) ? s.folds : 0) + (isFiniteNum(s.kidsFolds) ? s.kidsFolds : 0);
  if (p.compact === true) compactRecord(p); // keeps its packed precision (r5-08)
  delete hs[h.id];
  rosterChanged(state);
}

/** The id of the archive entry for helpers that left at `m` (one per K.albumArchiveMs; never 8 hex digits). */
export function archiveId(m) {
  return `past-${Math.floor(m / K.albumArchiveMs)}`;
}

/**
 * Merge the oldest compact Album records into archive entries (R13, r3-04).
 * Compact records cost about 45 bytes each, and an agent's terminal never
 * leaves the save, so without this a heavy user (100 new terminals a day)
 * passed herdr's 1 MiB write limit in about nine months and could never save
 * again. Every record that left at or before the K.albumCompactKeep-th newest
 * compact one's leaving time is folded into the entry of its 30-day period
 * (`archiveId`): a gone pane record whose `archive` counts the helpers in it,
 * with their summed folds, tasks and fledgling totals, the latest leaving
 * time as `missingSince`, the earliest as `from`, and the look (species, hue)
 * of its latest helper. They stay saved helpers: the Album shows each entry
 * as one row ("1,204 helpers"), counts every helper in it, and its fold total
 * stays in the Album. A terminal of an archived helper that returns joins as
 * a new helper. Batched (only past keep + batch), so the selection runs once
 * per K.albumArchiveBatch departures; deterministic (leaving times and ids).
 * `keep`: how many of the newest compact records stay (K.albumCompactKeep,
 * fewer when the save would pass K.saveBudget, albumKeepFor).
 */
function archiveOldest(state, compacts, keep) {
  const hs = state.helpers;
  const n = compacts.length;
  if (!(keep < n)) return;
  const keys = new Float64Array(n);
  for (let i = 0; i < n; i++) keys[i] = compacts[i].missingSince;
  keys.sort();
  const cut = keys[n - keep - 1];
  for (const h of compacts) {
    const m = h.missingSince;
    if (!(m <= cut)) continue;
    const aid = archiveId(m);
    let a = Object.hasOwn(hs, aid) ? hs[aid] : null;
    if (!a || !(a.archive > 0) || !a.gone) {
      a = {
        id: aid, kind: "pane", parent: null, species: h.species, hue: h.hue, name: "",
        joined: 0, status: "idle", lastTurn: 0, rest: 0, env: 0,
        stats: { tasks: 0, folds: 0, run: 0, envelopes: 0, checkIns: 0 },
        missingSince: m, gone: true, archive: 0, from: m,
      };
      hs[aid] = a;
    }
    const s = h.stats;
    const st = a.stats;
    a.archive += 1;
    st.tasks += isFiniteNum(s.tasks) ? s.tasks : 0;
    st.folds = round6(st.folds + (isFiniteNum(s.folds) ? s.folds : 0));
    if (s.kidsPast > 0) {
      st.kidsPast = (st.kidsPast || 0) + s.kidsPast;
      st.kidsFolds = round6((st.kidsFolds || 0) + (isFiniteNum(s.kidsFolds) ? s.kidsFolds : 0));
    }
    if (m >= a.missingSince) {
      a.missingSince = m;
      a.species = h.species;
      a.hue = h.hue;
    }
    if (m < a.from) a.from = m;
    delete hs[h.id];
  }
  rosterChanged(state);
}

// ---------------------------------------------------------------------------
// Whole-save bound (R13, review r5-07). Archiving by count alone bounded only
// the Album: present helpers (≈ 600 bytes each, an agent with sub-agents is
// several) came on top, so a large roster over a full Album passed herdr's
// 1 MiB write limit and every save cycle failed. prune estimates the save's
// bytes (saveBytes) and, when the compact records would push it past
// K.saveBudget, keeps fewer of them one by one (the oldest go to archive
// entries, still counted and shown). The estimate is cheap (no stringify):
// a present helper's strings are counted exactly as UTF-8 JSON, every other
// record by its shape (content.js saveBytes*), so it is deterministic and the
// same in every window.

const PLAIN = /^[\x20\x21\x23-\x5b\x5d-\x7e]*$/;

/** UTF-8 bytes of `v` written as a JSON string (quotes included); 4 ("null") for a non-string. */
export function jsonBytes(v) {
  if (typeof v !== "string") return 4;
  if (PLAIN.test(v)) return v.length + 2;
  let n = 2;
  const len = v.length;
  for (let i = 0; i < len; i++) {
    const c = v.charCodeAt(i);
    if (c === 0x22 || c === 0x5c) n += 2;
    else if (c < 0x20) n += c === 8 || c === 9 || c === 10 || c === 12 || c === 13 ? 2 : 6; // \b \t \n \f \r, else \u00XX
    else if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < len && (v.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else if (c >= 0xd800 && c <= 0xdfff) n += 6; // a lone surrogate is written escaped
    else n += 3;
  }
  return n;
}

/** Estimated saved bytes of a present helper's record. */
function presentBytes(h) {
  return K.saveBytesPresent + jsonBytes(h.addr) + jsonBytes(h.name) + jsonBytes(h.parent) + jsonBytes(h.seenBy) +
    jsonBytes(h.title) + jsonBytes(h.pane) + jsonBytes(h.paneName) + jsonBytes(h.space) + jsonBytes(h.tab);
}

/** Estimated saved bytes of a compact record's packed entry. */
function compactBytes(h) {
  let n = K.saveBytesCompact;
  if (h.stats.kidsPast > 0) n += K.saveBytesCompactKids;
  // A name of its own ("Pib 2") is written instead of 0; a base name never
  // holds a space (§5.1), so no hash is needed here (this runs per record).
  const nm = h.name;
  if (typeof nm === "string" && nm.indexOf(" ") >= 0) n += nm.length + 1;
  return n;
}

/** Estimated saved bytes of helper record `h` (any kind). */
function recordBytes(h) {
  if (!h.gone) return presentBytes(h);
  if (h.compact === true) return compactBytes(h);
  return K.saveBytesGone;
}

/** Estimated bytes outside the helpers map: the fixed part and the envelopes. */
function restBytes(state) {
  let n = K.saveBytesRest;
  for (const id in state.envelopes) n += K.saveBytesEnvelope;
  return n;
}

/** The whole save's estimated size in bytes (what prune holds under K.saveBudget; tests compare it with serialize). */
export function saveBytes(state) {
  let n = restBytes(state);
  const hs = state.helpers;
  for (const id in hs) n += recordBytes(hs[id]);
  return n;
}

/**
 * How many of `n` compact records (`bytes` estimated in all) stay one by one
 * when everything else in the save is estimated at `other` bytes: all of them
 * while n ≤ K.albumCompactKeep + K.albumArchiveBatch and the save fits
 * K.saveBudget; else K.albumCompactKeep, or fewer, so that the kept ones plus a
 * batch of new ones fit the budget (batched like the count rule). n = keep all.
 */
export function albumKeepFor(n, bytes, other) {
  const room = K.saveBudget - other;
  const over = n > K.albumCompactKeep + K.albumArchiveBatch;
  if (!over && bytes <= room) return n;
  if (n === 0) return 0;
  const per = bytes / n;
  const fit = Math.floor(room / per) - K.albumArchiveBatch;
  return Math.max(0, Math.min(K.albumCompactKeep, fit, n));
}

/** A compact record changed after compaction (an envelope opened or a check-in for it): fields its packed form cannot hold. */
function compactChanged(h) {
  const s = h.stats;
  return h.env !== 0 || h.rest !== 0 || !s || s.run !== 0 || s.envelopes !== 0 || s.checkIns !== 0;
}

/**
 * Keep the save bounded (R13): fledglings gone for 30 days, or beyond the
 * K.kidAlbumKeep most recently gone, fold into their parent; gone pane helpers
 * beyond the K.albumKeep most recently gone are compacted, and a compact record
 * changed since is compacted again; once more than K.albumCompactKeep +
 * K.albumArchiveBatch compact records are kept, the oldest beyond
 * K.albumCompactKeep are merged into archive entries (archiveOldest), and
 * more of them when the save would pass K.saveBudget (albumKeepFor, r5-07).
 * With the step context, the envelope of a
 * helper whose record is compact or no longer in the save is cashed in
 * (settleEnvelope), so envelopes of long-gone helpers cannot pile up. Writers
 * unseen for 30 days are pruned.
 */
export function prune(state, t, ctx, ev) {
  const hs = state.helpers;
  const kids = [];
  const full = [];
  const compacts = [];
  let other = restBytes(state); // estimated bytes of everything but compact records (r5-07)
  let cbytes = 0; // and of the compact records
  for (const id in hs) {
    const h = hs[id];
    if (!h.gone) {
      other += presentBytes(h);
      continue;
    }
    if (h.kind === "kid") {
      other += K.saveBytesGone;
      if (skippedName(h.name)) h.name = lookOf(h.id).name;
      if (typeof h.missingSince !== "number") continue;
      if (t - h.missingSince > K.kidAlbumMs) foldKid(state, h);
      else kids.push(h);
    } else if (h.archive > 0) {
      other += K.saveBytesGone; // an archive entry (r3-04): many helpers, never compacted again
    } else if (h.compact === true) {
      if (compactChanged(h)) compactRecord(h);
      compacts.push(h);
      cbytes += compactBytes(h);
    } else if (!(h.salt > 0)) {
      if (skippedName(h.name)) h.name = lookOf(h.id).name;
      other += K.saveBytesGone; // counted whole even if compacted below, until the next call
      full.push(h); // a salted record keeps its `salt` (R6), so it is never compacted
    } else {
      if (skippedName(h.name)) h.name = lookOf(h.id).name;
      other += K.saveBytesGone;
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
  const keep = albumKeepFor(compacts.length, cbytes, other);
  if (keep < compacts.length) archiveOldest(state, compacts, keep);
  if (ctx && ev) settleOld(state, ctx, t, ev);
  settledNotices(state);
  for (const w in state.writersSeen) {
    if (t - state.writersSeen[w] > K.writerPruneMs) {
      delete state.writersSeen[w];
      delete state.applied[w];
    }
  }
}

/**
 * Cash in every envelope whose helper's record is compact or gone from the
 * save (§6.1, R13): at most one footer notice per call. The record stays
 * compact (settleEnvelope adds only to its folds, rounded as compaction
 * rounds them, r5-08). The notice is an
 * "overflow" note (the same conversion, so the view shows it and it expires
 * after K.noteLifeMs like one; `settled` marks it): "+3.2K from a full
 * envelope (Pib, long gone)", or "(4 helpers long gone)" for several.
 */
function settleOld(state, ctx, t, ev) {
  const hs = state.helpers;
  let ids = null;
  for (const id in state.envelopes) {
    const h = hs[id];
    if (h === undefined || h.compact === true) (ids || (ids = [])).push(id);
  }
  if (!ids) return;
  ctx.refresh();
  let amount = 0;
  for (const id of ids) {
    amount += settleEnvelope(state, ctx, id, t, ev);
    // the folds join a compact record at its packed precision (r5-08)
    const x = hs[id];
    if (x !== undefined && x.compact === true) compactRecord(x);
  }
  const h = ids.length === 1 ? hs[ids[0]] : undefined;
  pushNotice(state, { kind: "overflow", at: t, data: { amount, count: ids.length, settled: true, name: settledWho(h, ids.length) } });
}

/** The name part of a settled-envelope notice. */
function settledWho(h, count) {
  if (count > 1) return `${count} helpers long gone`;
  return h ? `${h.name}, long gone` : "a helper long gone";
}

/** A "settled" notice of the build before this one (never shown, never expiring) becomes the overflow note it stands for. */
function settledNotices(state) {
  for (const n of state.notices) {
    if (n.kind !== "settled") continue;
    const d = n.data && typeof n.data === "object" ? n.data : {};
    const count = typeof d.count === "number" ? d.count : 1;
    n.kind = "overflow";
    n.data = { amount: typeof d.amount === "number" ? d.amount : 0, count, settled: true, name: count > 1 ? settledWho(null, count) : d.name ? `${d.name}, long gone` : settledWho(null, 1) };
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
  if (fl.kids) {
    for (const [h, b] of fl.kids) {
      const v = k * b;
      h.stats.folds += v;
      h.stats.run += v;
    }
  }
  if (staleRate > 0 && fl.stale.length) {
    const v = staleRate * sec / fl.stale.length;
    for (const h of fl.stale) {
      h.stats.folds += v;
      h.stats.run += v;
    }
  }
}

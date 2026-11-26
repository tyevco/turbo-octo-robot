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
  delete h.slim;
  delete h.stub;
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
  delete h.salt; // and its id's salt follows from it (toAlbum sets it anew); a present record packs without it (R13)
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
      if (h && h.stub === true && !h.gone) {
        // a stub (R13, format 5) keeps neither: this sighting gives them back
        h.addr = String(o.addr);
        h.created = Number(o.created) || 0;
      }
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
      // seen again: written whole again when there is room (presentPlan)
      if (h.slim === true) delete h.slim;
      if (h.stub === true) delete h.stub;
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
      // a gone record is free unless its key says it was another terminal
      // (r3-18); a stub (R13) kept no address: it is the record of the
      // terminal its plain id is the hash of (only a plain id is written as one)
      if (!h || (h.gone ? albumMatch(h, addr, created) : (h.addr === addr && h.created === created) || (k === 1 && h.stub === true))) {
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
// bytes and, when the compact records would push it past K.saveBudget, keeps
// fewer of them one by one (the oldest go to archive entries, still counted
// and shown). The estimate is cheap (no stringify): a present helper counts
// an upper bound of its lean packed form (format 5, below: its strings
// exactly, each number by the widest text its value can take until the next
// observation, numMax / growMax), every other record by its shape (content.js
// saveBytes*), so it is deterministic and the same in every window. A roster
// whose lean forms alone pass the budget leaves no compact record; past that
// presentPlan writes the present helpers in smaller tiers, so any roster saves.

const PLAIN = /^[\x20\x21\x23-\x5b\x5d-\x7e]*$/;

// Sizes of strings that are not plain ASCII, memoised (a pure cache, bounded,
// made at its first use: the save plan measures every present helper's
// title and place at every save, and the same strings come back each time;
// a CJK title costs about 6 µs to measure in the wasm QuickJS harness).
let wideMemo = null;
const WIDE_MEMO_MAX = 16384;

/** UTF-8 bytes of `v` written as a JSON string (quotes included); 4 ("null") for a non-string. */
export function jsonBytes(v) {
  if (typeof v !== "string") return 4;
  if (PLAIN.test(v)) return v.length + 2;
  if (wideMemo === null) wideMemo = new Map();
  let n = wideMemo.get(v);
  if (n === undefined) {
    n = wideBytes(v);
    if (wideMemo.size >= WIDE_MEMO_MAX) wideMemo.clear();
    wideMemo.set(v, n);
  }
  return n;
}

function wideBytes(v) {
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

/** Estimated saved bytes of a present helper's record written whole (one packPresent cannot pack). */
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

/**
 * The widest text finite number `x` can be written as (≥ String(x).length;
 * exact for an integer below 1e15): a fraction has at most 17 significant
 * digits, so at most 18 characters from 1 up, 19 to 24 below 1 (its leading
 * zeros, or an exponent below 1e-6), 23 from 1e16 up (an exponent from 1e21);
 * one more for a minus sign. No number is formatted (prune runs this for
 * every number of every present helper at every observation).
 */
export function numMax(x) {
  const neg = x < 0 ? 1 : 0;
  const a = neg ? -x : x;
  if (a < 1e15 && Number.isInteger(a)) return numBytes(a) + neg;
  if (a >= 1e16) return 23 + neg;
  if (a >= 1) return 18 + neg;
  return (a >= 0.1 ? 19 : a >= 0.01 ? 20 : a >= 1e-3 ? 21 : a >= 1e-4 ? 22 : a >= 1e-5 ? 23 : 24) + neg;
}

/**
 * numMax for a value the engine changes between observations (folds and run
 * as the flock earns, rest as an idle helper rests, the envelope meter): the
 * widest text of any fraction of its size class (a fraction below 1 can take
 * up to 24 characters, any from 1 up to 1e16 18), so the estimate prune makes
 * at an observation still bounds the save written before the next one.
 */
function growMax(x) {
  const neg = x < 0 ? 1 : 0;
  const a = neg ? -x : x;
  return (a >= 1e16 ? 23 : a >= 1 ? 18 : 24) + neg;
}

/** The widest text of time `x` written as its offset from `L` ("null" for null). */
const offMax = (x, L) => (x === null || x === undefined ? 4 : isFiniteNum(x) ? numMax(x - L) : 24);

/**
 * An upper bound of the UTF-8 bytes present helper `h` takes in the save (its
 * `"<id>":` key and comma included) in its lean packed form, or in its slim
 * or stub form when it is slim or a stub (what prune makes room for before the
 * Album's compact records: the place strings fill whatever room is left,
 * presentPlan), or whole when its shape says it cannot be packed. Its strings
 * are counted exactly, its numbers by numMax / growMax. `writers`: writer id
 * → its index among the writersSeen keys that stay.
 */
function presentMax(h, writers) {
  const s = h.stats;
  const L = h.lastSeen;
  const flag = h.slim === true || h.stub === true;
  if (!s || typeof s !== "object" || !isFiniteNum(L) || !isFiniteNum(s.tasks) || !isFiniteNum(s.folds) || !isFiniteNum(s.run) || !isFiniteNum(h.rest) || !isFiniteNum(h.warm) || typeof h.id !== "string" || !HEX8.test(h.id) || !knownShape(h, h, flag)) return presentBytes(h);
  const n0 = parseInt(h.id, 16) >>> 0;
  const nm = h.name === NAMES[((n0 >>> 8) % 16) * 12 + ((n0 >>> 12) % 12)] ? 1 : jsonBytes(h.name);
  const kp = typeof h.parent === "string" ? jsonBytes(h.parent) : 1;
  const sb = h.seenBy;
  const w = sb === null ? 4 : writers[sb] !== undefined ? numBytes(writers[sb]) : jsonBytes(sb);
  const turn = isFiniteNum(h.lastTurn) ? numMax(h.lastTurn) : 24;
  // "<id>": and a comma
  if (h.stub === true) return 12 + 13 + nm + kp + w + numMax(L) + turn + (h.status === "blocked" ? 1 + offMax(h.blockedAt, L) : 0); // [3,nm,kp,st,w,L,turn(,ba)]
  // folds and run grow while it works (a fledgling, or another window's
  // helper at the unseen rate, may earn whatever its status), rest while it
  // idles or has finished; the rest changes only at observations
  const earns = h.status === "working" || h.kind === "kid" || h.group === "elsewhere";
  const fm = earns ? growMax : numMax;
  let n = 12 + 28 + jsonBytes(h.addr) + nm + kp + w + numMax(L) + turn + offMax(h.created, L) + offMax(h.joined, L) + numMax(h.env) +
    numMax(s.tasks) + fm(s.folds) + fm(s.run) + numMax(s.envelopes) + numMax(s.checkIns);
  if (s.kidsPast !== undefined || s.kidsFolds !== undefined) n += 2 + numMax(s.kidsPast) + numMax(s.kidsFolds);
  if (h.slim === true) return n + (h.blockedAt === null ? 0 : 1 + offMax(h.blockedAt, L)); // [2,S(,ba)]
  // [1,S,X]: X = [rest,warm,warmUntil',thanksUntil',lastFinishAt',unitAt',kidUnitAt',blockedAt']
  const rests = (h.status === "idle" || h.status === "done") && h.rest < 1;
  return n + 1 + 10 + (rests ? growMax(h.rest) : numMax(h.rest)) + numMax(h.warm) + (h.warmUntil === 0 ? 4 : offMax(h.warmUntil, L)) +
    (h.thanksUntil === 0 ? 4 : offMax(h.thanksUntil, L)) + offMax(h.lastFinishAt, L) + offMax(h.unitAt, L) + offMax(h.kidUnitAt, L) + offMax(h.blockedAt, L);
}

/** Estimated saved bytes of helper record `h` written whole, or as a compact Album entry. */
function recordBytes(h) {
  if (!h.gone) return presentBytes(h);
  if (h.compact === true) return compactBytes(h);
  return K.saveBytesGone;
}

/**
 * Estimated bytes outside the helpers map: the fixed part, the envelopes
 * (format 5 writes each as [type, units, landedAt, lastAt − landedAt]: counted
 * exactly, or K.saveBytesEnvelope for one written whole) and an away pot's
 * task snapshot (["<id>",tasks], one per pane helper, counted exactly).
 */
function restBytes(state) {
  let n = K.saveBytesRest;
  const envs = state.envelopes;
  for (const id in envs) {
    const e = envs[id];
    n += e && isFiniteNum(e.units) && isFiniteNum(e.landedAt) && isFiniteNum(e.lastAt)
      ? jsonBytes(id) + 8 + numBytes(e.units) + numBytes(e.landedAt) + numBytes(e.lastAt - e.landedAt)
      : K.saveBytesEnvelope;
  }
  const pot = state.away && state.away.pot;
  if (pot && Array.isArray(pot.tasks0)) {
    for (const x of pot.tasks0) n += Array.isArray(x) ? jsonBytes(x[0]) + 4 + (isFiniteNum(x[1]) ? numBytes(x[1]) : 4) : 16;
  }
  return n;
}

/**
 * The whole save's estimated size in bytes as serialize writes it (format 5:
 * the present helpers in the tiers presentPlan gives them, counted exactly;
 * tests compare it with serialize).
 */
export function saveBytes(state) {
  return presentPlan(state).bytes;
}

// ---------------------------------------------------------------------------
// Packed present helpers (R13, save format 5). A present helper's whole record
// is about 560 bytes of keys and numbers plus its strings, so about 1,300
// agents present at once passed herdr's 1 MiB write limit and no save could be
// written. The codec now writes each present helper as an array
// (`packPresent`), in one of four tiers:
//
//   full  [1, S, X, P]
//   lean  [1, S, X]     (no place strings: every observation sets them again;
//                        also how a helper with none is written)
//   slim  [2, S]        identity, its window's last sight of it and its totals
//         [2, S, ba']   (and its wait's start, when it has one)
//   stub  [3, name, kp, st, seenBy, lastSeen, lastTurn]   identity only
//         [3, …, ba']   (and its wait's start, when it waits)
//
//   S = [addr, name, kp, st, seenBy, lastSeen, lastTurn, created', joined', env, stats]
//   X = [rest, warm, warmUntil', thanksUntil', lastFinishAt', unitAt', kidUnitAt', blockedAt']
//   P = [title, pane, paneName, space, tab]
//
// name: 0 for the base name of its id; kp: 0 a pane helper, 1 a fledgling with
// no parent, else the parent's id; st: the status index (STATUSES: working,
// blocked, done, idle; the order is part of the format); seenBy: the index of
// its writer among the writersSeen keys (its id when that writer is not
// there); t' = t − lastSeen (warmUntil and thanksUntil 0, and the nullable
// times' null, are written as null); stats [tasks, folds, run, envelopes,
// checkIns(, kidsPast, kidsFolds)], run null when it equals folds (the first
// run). species, hue, missingSince and gone follow from these; group, a cache
// nothing reads (groupFor derives it), is not written and loads as the
// status's group (an Elsewhere helper's is set again at its next
// observation), so a helper's text is the same in every window and a merge
// does not re-hash every chunk. Every number is written as it is, so a record
// loads exactly as it was but for what its tier drops. The tiers share S's
// text (and lean / full X's), so a record is stringified once in parts and
// each tier's text and size follow from those.
//
// The tiers are chosen by `presentPlan` under K.saveBudget. When every present
// helper fits whole, all are written full. Otherwise every one's stub is
// reserved first (a helper whose id is salted, R6, is never a stub: its slim
// form, which keeps its address, is reserved instead), and then, in the order
// below, a first pass gives every helper that still fits its slim form, a
// second its lean form, a third its place strings: totals before game state,
// game state before place strings. The order is the same in every window:
// live helpers (seen by their window within K.staleMs of the state's clock)
// before unseen ones, unseen ones most recently seen first, helpers holding an
// envelope first, then by id (a fixed spread: no window's roster and no
// status is favoured). So every agent is a saved helper up to about 22,000
// present at once, well past the roster an observation can reconcile inside
// herdr's 500 ms budget (≈ 32 µs a helper in the wasm harness). Past that the
// last stubs in the order are left out (never a save refused for its roster:
// a helper left out joins again as a new helper when it is seen). A slim
// record loads with `slim: true` (its budgets empty at lastSeen, no warmth,
// thanks or rest), a stub with `stub: true` (no totals, its address and
// created_ms set again by the observation that sees it), and each is written
// so until an observation sees it again, so a reload or a merge, which
// replays onto the loaded save, writes the same text: a record whose dropped
// fields are gone writes the same whatever tier it gets, the order uses only
// what every tier keeps, and each pass gives the same records the same room.

const TIER_DROP = 0;
const TIER_STUB = 1;
const TIER_SLIM = 2;
const TIER_LEAN = 3;
const TIER_FULL = 4;
const STAT_N = 5;
const S_N = 11;
const X_N = 8;
const RECORD_KEYS = 31; // newRecord's fields (slim or stub: one more)

const isStrOrNull = (v) => v === null || typeof v === "string";
const timeOrNull = (v) => v === null || isFiniteNum(v);

// Records already checked to hold only the fields of a present record (keyed
// by the live record object: a pure cache, dropped with the record; the
// engine adds no other field to a record it made, so a record is checked
// once, not at every save: Object.keys of each record and its stats was a
// fifth of a 4,000-helper save plan in the wasm harness).
let shapeOk = null;

/** True when `h` (and its stats) hold no field a present record does not have; `key` is the live record `h` copies (the cache key). */
function knownShape(key, h, flagged) {
  if (shapeOk === null) shapeOk = new WeakSet();
  if (shapeOk.has(key)) return true;
  const s = h.stats;
  if (Object.keys(h).length !== RECORD_KEYS + (flagged ? 1 : 0)) return false;
  if (Object.keys(s).length !== (s.kidsPast !== undefined || s.kidsFolds !== undefined ? STAT_N + 2 : STAT_N)) return false;
  shapeOk.add(key);
  return true;
}

// Present records whose id is the plain hash of their address and created_ms
// (keyed by the live record: a present record's id, address and created_ms
// never change). Only those may be written as stubs: a stub keeps neither,
// and the observation that sees it again finds it by that hash (claimId).
let plainOk = null;

function plainId(key, h) {
  if (plainOk === null) plainOk = new WeakSet();
  if (plainOk.has(key)) return true;
  if (helperId(h.addr, h.created) !== h.id) return false;
  plainOk.add(key);
  return true;
}

const fin = (v) => typeof v === "number" && v - v === 0;

/** x − L when finite and L + (x − L) gives x back exactly, else undefined. */
function dt(x, L) {
  const d = x - L;
  return d - d === 0 && L + d === x ? d : undefined;
}

// The texts of one present helper's packed parts (presentParts writes them
// here: one scratch object, no allocation per helper).
const PARTS = { sT: "", xT: "", pT: null, bT: "", uT: "" };
const J = JSON.stringify;
const tOrNull = (d) => (d === null ? "null" : d);

/**
 * The JSON texts of present helper `h`'s packed parts into PARTS: S, X and P
 * (P null when it has no place strings), the slim form's wait suffix (bT,
 * "" without one) and its stub (uT); or false when `h` is not exactly what
 * unpackPresent gives back (a record of an older build or a hand-edited save:
 * written whole). `writers`: writer id → its index among the writersSeen keys
 * (optional). `key`: the live record `h` is a copy of (the caches' key; `h`
 * itself by default). Runs for every present helper at every save, so its
 * checks are inline and the texts are built directly (a number's text is the
 * same in a template as in JSON: every one here is finite), about twice as
 * fast in the wasm harness as building arrays and stringifying them.
 */
function presentParts(h, writers, key = h) {
  if (!h || h.gone !== false || h.missingSince !== null) return false;
  const id = h.id;
  if (typeof id !== "string" || id.length !== 8 || !HEX8.test(id)) return false;
  const s = h.stats;
  if (!s || typeof s !== "object") return false;
  const slim = h.slim === true;
  const stub = h.stub === true;
  if ((!slim && h.slim !== undefined) || (!stub && h.stub !== undefined) || (slim && stub)) return false;
  if (!knownShape(key, h, slim || stub)) return false;
  const addr = h.addr;
  const name = h.name;
  const seenBy = h.seenBy;
  const status = h.status;
  if (typeof addr !== "string" || typeof name !== "string" || name === "" || (seenBy !== null && typeof seenBy !== "string")) return false;
  const st = status === "working" ? 0 : status === "blocked" ? 1 : status === "done" ? 2 : status === "idle" ? 3 : -1;
  if (st < 0) return false;
  const g = h.group;
  if (g !== GROUP_OF[status] && g !== "elsewhere") return false;
  const kind = h.kind;
  const parent = h.parent;
  let kp;
  if (parent === null) kp = kind === "pane" ? "0" : kind === "kid" ? "1" : null;
  else kp = kind === "kid" && typeof parent === "string" && parent !== "" ? J(parent) : null;
  if (kp === null) return false;
  const L = h.lastSeen;
  const lastTurn = h.lastTurn;
  const env = h.env;
  const rest = h.rest;
  const warm = h.warm;
  if (!fin(L) || !fin(lastTurn) || !fin(env) || !fin(rest) || !fin(warm)) return false;
  const c = dt(h.created, L);
  const j = dt(h.joined, L);
  const wU = h.warmUntil;
  const tU = h.thanksUntil;
  const wu = wU === 0 ? null : dt(wU, L);
  const tu = tU === 0 ? null : dt(tU, L);
  const lf = h.lastFinishAt === null ? null : dt(h.lastFinishAt, L);
  const ua = h.unitAt === null ? null : dt(h.unitAt, L);
  const ka = h.kidUnitAt === null ? null : dt(h.kidUnitAt, L);
  const ba = h.blockedAt === null ? null : dt(h.blockedAt, L);
  if (c === undefined || j === undefined || wu === undefined || tu === undefined || lf === undefined || ua === undefined || ka === undefined || ba === undefined) return false;
  const title = h.title;
  const pane = h.pane;
  const paneName = h.paneName;
  const space = h.space;
  const tab = h.tab;
  if ((title !== null && typeof title !== "string") || (pane !== null && typeof pane !== "string") || (paneName !== null && typeof paneName !== "string") ||
    (space !== null && typeof space !== "string") || (tab !== null && typeof tab !== "string")) return false;
  const n = parseInt(id, 16) >>> 0;
  if (h.species !== SPECIES[n % 12] || h.hue !== (n >>> 4) % 8) return false;
  const tasks = s.tasks;
  const folds = s.folds;
  const run = s.run;
  const envs = s.envelopes;
  const checkIns = s.checkIns;
  if (!fin(tasks) || !fin(folds) || !fin(run) || !fin(envs) || !fin(checkIns)) return false;
  let kids = "";
  if (s.kidsPast !== undefined || s.kidsFolds !== undefined) {
    if (!fin(s.kidsPast) || !fin(s.kidsFolds)) return false;
    kids = `,${s.kidsPast},${s.kidsFolds}`;
  }
  const w = seenBy === null ? "null" : writers !== undefined && writers[seenBy] !== undefined ? writers[seenBy] : J(seenBy);
  const base = NAMES[((n >>> 8) % 16) * 12 + ((n >>> 12) % 12)];
  const nm = name === base ? "0" : J(name);
  // the first run's folds are its helper's folds: run is written as null then
  PARTS.sT = `[${J(addr)},${nm},${kp},${st},${w},${L},${lastTurn},${c},${j},${env},[${tasks},${folds},${run === folds ? "null" : run},${envs},${checkIns}${kids}]]`;
  PARTS.xT = `[${rest},${warm},${tOrNull(wu)},${tOrNull(tu)},${tOrNull(lf)},${tOrNull(ua)},${tOrNull(ka)},${tOrNull(ba)}]`;
  PARTS.pT = title !== null || pane !== null || paneName !== null || space !== null || tab !== null ? placeText(key, title, pane, paneName, space, tab) : null;
  PARTS.bT = ba === null ? "" : `,${ba}`;
  PARTS.uT = `[3,${nm},${kp},${st},${w},${L},${lastTurn}${st === 1 && ba !== null ? `,${ba}` : ""}]`;
  return true;
}

// The place text of a record, kept while its five strings stay the same (keyed
// by the live record object: a pure cache; a helper's place rarely changes,
// and stringifying five strings was a sixth of the parts' cost).
let placeTexts = null;

function placeText(key, title, pane, paneName, space, tab) {
  if (placeTexts === null) placeTexts = new WeakMap();
  const c = placeTexts.get(key);
  if (c !== undefined && c.title === title && c.pane === pane && c.paneName === paneName && c.space === space && c.tab === tab) return c.text;
  const text = `[${J(title)},${J(pane)},${J(paneName)},${J(space)},${J(tab)}]`;
  placeTexts.set(key, { title, pane, paneName, space, tab, text });
  return text;
}

/**
 * The packed form of present helper `h` at its largest tier ([1, S, X] or
 * [1, S, X, P]; [2, S(, ba')] when it is slim, its stub when it is one), or
 * null when it cannot be packed (presentParts). `writers` as there.
 */
export function packPresent(h, writers) {
  if (!presentParts(h, writers)) return null;
  if (h.stub === true) return JSON.parse(PARTS.uT);
  if (h.slim === true) return JSON.parse(`[2,${PARTS.sT}${PARTS.bT}]`);
  const a = [1, JSON.parse(PARTS.sT), JSON.parse(PARTS.xT)];
  if (PARTS.pT !== null) a.push(JSON.parse(PARTS.pT));
  return a;
}

/** The given tier's packed form of present helper `h` (stub, slim, lean or full; the tests' view of presentPlan's texts), or null. */
export function packPresentAs(h, tier, writers) {
  if (!presentParts(h, writers)) return null;
  const t = { stub: TIER_STUB, slim: TIER_SLIM, lean: TIER_LEAN, full: TIER_FULL }[tier];
  return t === undefined ? null : JSON.parse(tierText(t, PARTS.sT, PARTS.xT, PARTS.pT, PARTS.bT, PARTS.uT));
}

function tierText(tier, sT, xT, pT, bT, uT) {
  if (tier === TIER_STUB) return uT;
  if (tier === TIER_SLIM) return `[2,${sT}${bT}]`;
  return tier === TIER_LEAN || pT === null ? `[1,${sT},${xT}]` : `[1,${sT},${xT},${pT}]`;
}

/**
 * A present record of a save before format 5, or one a code generation
 * before this one handed over by a hot reload (the migrate path, R13): the
 * fields this build's present records hold are filled in (a budget's older
 * field moved to its own, as toAlbum does; an id's salt and an Album key
 * dropped, they follow from the address), so it packs like a new one. A
 * record of this build is never changed (the round trip stays exact).
 */
export function normalizePresent(h) {
  if (!h || typeof h !== "object" || Array.isArray(h) || h.gone !== false) return;
  if (isFiniteNum(h.kidFinishAt) && !isFiniteNum(h.kidUnitAt)) h.kidUnitAt = h.kidFinishAt;
  delete h.kidFinishAt; // (finish() reads it as kidUnitAt's start: the same budget)
  delete h.salt;
  delete h.key;
  delete h.compact;
  for (const k of Object.keys(LIVE_FIELDS)) if (!(k in h)) h[k] = LIVE_FIELDS[k];
  for (const k of Object.keys(KEPT_FIELDS)) if (!(k in h)) h[k] = KEPT_FIELDS[k];
  if (!("env" in h)) h.env = 0;
  if (!("missingSince" in h)) h.missingSince = null;
  if (h.group !== "elsewhere" && Object.hasOwn(GROUP_OF, h.status)) h.group = GROUP_OF[h.status];
}

/** L + d, or undefined when that is not finite (a damaged offset: 1e308 + 1e308). */
const at = (L, d) => {
  const x = L + d;
  return x - x === 0 ? x : undefined;
};
const nullTime = (v, L) => (v === null ? null : at(L, v));

/**
 * The in-memory record of a packed present entry (tag 1, 2 or 3), or null
 * when the entry is malformed. `writers`: the save's writersSeen keys in
 * order (a seenBy written as a number is the index of its writer there).
 */
export function unpackPresent(id, a, writers) {
  if (typeof id !== "string" || id.length !== 8 || !HEX8.test(id) || !Array.isArray(a)) return null;
  const len = a.length;
  const tag = a[0];
  if (tag === 3) return unpackStub(id, a, writers);
  if (tag === 2 ? len !== 2 && len !== 3 : tag !== 1 || (len !== 3 && len !== 4)) return null;
  const S = a[1];
  if (!Array.isArray(S) || S.length !== S_N) return null;
  const addr = S[0];
  const nm = S[1];
  const kp = S[2];
  const st = S[3];
  const seenBy = seenByOf(S[4], writers);
  if (typeof addr !== "string" || (nm !== 0 && (typeof nm !== "string" || nm === ""))) return null;
  if (kp !== 0 && kp !== 1 && (typeof kp !== "string" || kp === "")) return null;
  if (!Number.isInteger(st) || st < 0 || st > 3 || seenBy === undefined) return null;
  for (let i = 5; i <= 9; i++) if (!isFiniteNum(S[i])) return null;
  const sa = S[10];
  if (!Array.isArray(sa) || (sa.length !== STAT_N && sa.length !== STAT_N + 2)) return null;
  for (let i = 0; i < sa.length; i++) if (!isFiniteNum(sa[i]) && !(i === 2 && sa[i] === null)) return null;
  const L = S[5];
  const status = STATUSES[st];
  const stats = { tasks: sa[0], folds: sa[1], run: sa[2] === null ? sa[1] : sa[2], envelopes: sa[3], checkIns: sa[4] };
  if (sa.length > STAT_N) {
    stats.kidsPast = sa[5];
    stats.kidsFolds = sa[6];
  }
  let rest = 0;
  let warm = 1;
  let wu = 0;
  let tu = 0;
  let lf = null;
  let ua;
  let ka;
  let ba;
  let place = null;
  if (tag === 1) {
    const X = a[2];
    if (!Array.isArray(X) || X.length !== X_N || !isFiniteNum(X[0]) || !isFiniteNum(X[1])) return null;
    for (let i = 2; i < X_N; i++) if (!timeOrNull(X[i])) return null;
    rest = X[0];
    warm = X[1];
    wu = X[2] === null ? 0 : at(L, X[2]);
    tu = X[3] === null ? 0 : at(L, X[3]);
    lf = nullTime(X[4], L);
    ua = nullTime(X[5], L);
    ka = nullTime(X[6], L);
    ba = nullTime(X[7], L);
    if (len === 4) {
      place = a[3];
      if (!Array.isArray(place) || place.length !== 5) return null;
      for (let i = 0; i < 5; i++) if (!isStrOrNull(place[i])) return null;
    }
  } else {
    // slim: its budgets empty when it was last seen (nothing to draw at once),
    // no warmth, thanks or rest; its wait's start kept (the view times it, and
    // thanks follow from it, exactly as for the record it was)
    ua = L;
    ka = L;
    ba = len === 3 ? (isFiniteNum(a[2]) ? at(L, a[2]) : undefined) : null;
  }
  const created = at(L, S[7]);
  const joined = at(L, S[8]);
  if (created === undefined || joined === undefined || wu === undefined || tu === undefined || lf === undefined || ua === undefined || ka === undefined || ba === undefined) return null;
  const h = parseInt(id, 16) >>> 0;
  const rec = {
    id, addr, created, kind: kp === 0 ? "pane" : "kid", parent: typeof kp === "string" ? kp : null,
    species: SPECIES[h % 12], hue: (h >>> 4) % 8, name: nm === 0 ? NAMES[((h >>> 8) % 16) * 12 + ((h >>> 12) % 12)] : nm,
    joined, lastSeen: L, seenBy, status, lastTurn: S[6],
    lastFinishAt: lf, unitAt: ua, kidUnitAt: ka, blockedAt: ba,
    rest, warm, warmUntil: wu, thanksUntil: tu, env: S[9], stats,
    missingSince: null, group: GROUP_OF[status], gone: false,
    title: place ? place[0] : null, pane: place ? place[1] : null, paneName: place ? place[2] : null,
    space: place ? place[3] : null, tab: place ? place[4] : null,
  };
  if (tag === 2) rec.slim = true;
  return rec;
}

/** A packed seenBy: null, a writer id, or its index among `writers`; undefined when malformed. */
function seenByOf(v, writers) {
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 && Array.isArray(writers) && v < writers.length ? writers[v] : undefined;
  return isStrOrNull(v) ? v : undefined;
}

/**
 * A stub [3, name, kp, st, seenBy, lastSeen, lastTurn(, blockedAt')]: the
 * record of a present helper with no totals and no address (set again, with
 * its created_ms, by the observation that sees it: claimId finds it by its
 * id), joined at its last sighting, its budgets empty then, no warmth, thanks
 * or rest, waiting since its wait's start when it waits. Null when malformed.
 */
function unpackStub(id, a, writers) {
  const len = a.length;
  if (len !== 7 && len !== 8) return null;
  const nm = a[1];
  const kp = a[2];
  const st = a[3];
  const seenBy = seenByOf(a[4], writers);
  const L = a[5];
  if ((nm !== 0 && (typeof nm !== "string" || nm === "")) || (kp !== 0 && kp !== 1 && (typeof kp !== "string" || kp === ""))) return null;
  if (!Number.isInteger(st) || st < 0 || st > 3 || seenBy === undefined || !isFiniteNum(L) || !isFiniteNum(a[6])) return null;
  const status = STATUSES[st];
  if (len === 8 && (status !== "blocked" || !isFiniteNum(a[7]))) return null;
  const ba = len === 8 ? at(L, a[7]) : null;
  if (ba === undefined) return null;
  const h = parseInt(id, 16) >>> 0;
  return {
    id, addr: "", created: 0, kind: kp === 0 ? "pane" : "kid", parent: typeof kp === "string" ? kp : null,
    species: SPECIES[h % 12], hue: (h >>> 4) % 8, name: nm === 0 ? NAMES[((h >>> 8) % 16) * 12 + ((h >>> 12) % 12)] : nm,
    joined: L, lastSeen: L, seenBy, status, lastTurn: a[6],
    lastFinishAt: null, unitAt: L, kidUnitAt: L, blockedAt: ba,
    rest: 0, warm: 1, warmUntil: 0, thanksUntil: 0, env: 0,
    stats: { tasks: 0, folds: 0, run: 0, envelopes: 0, checkIns: 0 },
    missingSince: null, group: GROUP_OF[status], gone: false,
    title: null, pane: null, paneName: null, space: null, tab: null, stub: true,
  };
}

/** Characters of number `x` as JSON writes it (finite). */
export function numBytes(x) {
  if (Number.isInteger(x) && x > -1e15 && x < 1e15) {
    const v = x < 0 ? -x : x;
    const d = v < 1e8
      ? v < 1e4 ? (v < 1e2 ? (v < 10 ? 1 : 2) : v < 1e3 ? 3 : 4) : v < 1e6 ? (v < 1e5 ? 5 : 6) : v < 1e7 ? 7 : 8
      : v < 1e12 ? (v < 1e10 ? (v < 1e9 ? 9 : 10) : v < 1e11 ? 11 : 12) : v < 1e14 ? (v < 1e13 ? 13 : 14) : 15;
    return x < 0 ? d + 1 : d;
  }
  return String(x).length;
}

const NON_ASCII = /[^\x00-\x7f]/;
const ASCII_RUNS = /[\x00-\x7f]+/g;
const NARROW_RUNS = /[\u0080-߿\ud800-\udfff]+/g;

/**
 * UTF-8 bytes of JSON text `t` (JSON.stringify output: control characters and
 * lone surrogates are escaped in it, so every surrogate is half of a pair):
 * its length, +1 for each non-ASCII unit, +1 more for each from U+0800 outside
 * the surrogates. Native regex passes only (store.js oversize counts the same
 * way), none for ASCII text.
 */
function textBytes(t) {
  if (!NON_ASCII.test(t)) return t.length;
  const wide = t.replace(ASCII_RUNS, "");
  return t.length + wide.length + wide.replace(NARROW_RUNS, "").length;
}

// UTF-8 sizes of place arrays' texts, memoised (bounded, made at first use):
// a helper's title and place come back the same at every save.
let placeMemo = null;
const PLACE_MEMO_MAX = 16384;

/** textBytes of a place array's JSON text, memoised. */
function placeBytes(t) {
  if (!NON_ASCII.test(t)) return t.length;
  if (placeMemo === null) placeMemo = new Map();
  let n = placeMemo.get(t);
  if (n === undefined) {
    n = textBytes(t);
    if (placeMemo.size >= PLACE_MEMO_MAX) placeMemo.clear();
    placeMemo.set(t, n);
  }
  return n;
}

/** The writersSeen keys as writer id → index (how a seenBy is written). */
function writerIndex(ws, keep) {
  const writers = Object.create(null);
  if (ws && typeof ws === "object") {
    let i = 0;
    for (const w of Object.keys(ws)) if (keep === undefined || keep(w)) writers[w] = i++;
  }
  return writers;
}

/**
 * The save plan of the present helpers (R13, format 5): for every present
 * helper that packs, the JSON text of its packed array at the tier it is
 * written in (`texts`, id → text: serialize writes it as it is; "" for one
 * left out), and the whole save's estimated bytes (`bytes`: the present
 * helpers exactly, from those texts, everything else as prune counts it).
 * Deterministic: the same state gives the same plan in every window. Each
 * record's parts are written once (the stringify the save needs anyway) and
 * measured from their texts.
 */
export function presentPlan(state) {
  const it = presentPlanSteps(state, null, Infinity);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

/** A present helper the save plan may write in several tiers. */
function Cand(id, sT, xT, pT, bT, uT, sizes, lo, hi) {
  this.id = id;
  this.sT = sT;
  this.xT = xT;
  this.pT = pT;
  this.bT = bT;
  this.uT = uT;
  this.sizes = sizes; // bytes at each tier (index = tier), "<id>": and its comma included
  this.lo = lo; // the smallest tier it may take (stub, or slim for a salted id)
  this.hi = hi; // the largest (full; slim when it is slim, stub when it is a stub)
  this.k0 = 0;
  this.k1 = 0;
  this.k2 = 0;
}

/**
 * presentPlan in steps (a generator that yields after every `per` present
 * helpers measured, then returns the plan): serializeSteps drives it so a
 * large roster's plan spreads over task steps. `refs`: id → the live record
 * each of `state`'s helpers copies (the caches' keys; null when `state` is the
 * live state itself).
 */
export function* presentPlanSteps(state, refs, per) {
  const hs = state.helpers;
  const texts = Object.create(null);
  const writers = writerIndex(state.writersSeen);
  let other = restBytes(state);
  const cand = [];
  let lo = 0; // bytes of the present helpers each at its smallest tier
  let hi = 0; // and each at its largest
  let left = per;
  for (const id in hs) {
    const h = hs[id];
    if (Array.isArray(h)) {
      other += jsonBytes(id) + 2 + textBytes(JSON.stringify(h)); // already written (a parsed file)
      continue;
    }
    if (h.gone) {
      other += recordBytes(h);
      continue;
    }
    const key = refs === null ? h : refs[id];
    if (!presentParts(h, writers, key)) {
      other += presentBytes(h); // written whole
      continue;
    }
    const { sT, pT, bT, uT } = PARTS;
    const sizes = [0, 0, 0, 0, 0];
    // UTF-8 bytes of each tier's text, "<8 hex id>": and a comma included (X is all numbers: ASCII)
    const sb = textBytes(sT);
    sizes[TIER_STUB] = 12 + textBytes(uT);
    sizes[TIER_SLIM] = 12 + sb + 4 + bT.length;
    let top = TIER_FULL;
    if (h.stub === true) top = TIER_STUB;
    else if (h.slim === true) top = TIER_SLIM;
    else {
      sizes[TIER_LEAN] = 12 + sb + PARTS.xT.length + 5; // [1,S,X]
      sizes[TIER_FULL] = pT === null ? sizes[TIER_LEAN] : sizes[TIER_LEAN] + 1 + placeBytes(pT); // [1,S,X,P]
    }
    const bottom = h.stub === true || plainId(key, h) ? TIER_STUB : TIER_SLIM;
    lo += sizes[bottom];
    hi += sizes[top];
    cand.push(new Cand(id, sT, top >= TIER_LEAN ? PARTS.xT : null, pT, bT, uT, sizes, bottom, top));
    if (--left <= 0) {
      left = per;
      yield;
    }
  }
  if (other + hi <= K.saveBudget) {
    // every helper at its largest tier
    for (const c of cand) texts[c.id] = tierText(c.hi, c.sT, c.xT, c.pT, c.bT, c.uT);
    return { texts, bytes: other + hi };
  }
  // Past the budget: the order (live first, unseen ones most recently seen
  // first, helpers holding an envelope first, then id), from what every
  // tier keeps and the state's clock, so it is the same before and after a reload.
  const clock = isFiniteNum(state.clock) ? state.clock : 0;
  const none = Object.create(null);
  const ws = state.writersSeen && typeof state.writersSeen === "object" ? state.writersSeen : none;
  const envs = state.envelopes && typeof state.envelopes === "object" ? state.envelopes : none;
  for (const c of cand) {
    const h = hs[c.id];
    const w = h.seenBy !== null ? ws[h.seenBy] : undefined;
    const seen = isFiniteNum(w) && w > h.lastSeen ? w : h.lastSeen;
    const live = clock - seen < K.staleMs;
    c.k0 = live ? 0 : 1;
    c.k1 = live ? 0 : -h.lastSeen;
    c.k2 = Object.hasOwn(envs, c.id) ? 0 : 1;
  }
  cand.sort(byOrder);
  yield;
  const tiers = new Uint8Array(cand.length);
  for (let i = 0; i < cand.length; i++) tiers[i] = cand[i].lo;
  let bytes = other + lo;
  // Even the smallest forms pass the budget (past about 22,000 present
  // helpers): the last in the order are left out.
  for (let i = cand.length - 1; i >= 0 && bytes > K.saveBudget; i--) {
    bytes -= cand[i].sizes[tiers[i]];
    tiers[i] = TIER_DROP;
  }
  // Then totals, game state and place strings, each for every helper that
  // still fits, in order.
  for (let tier = TIER_SLIM; tier <= TIER_FULL; tier++) {
    for (let i = 0; i < cand.length; i++) {
      const c = cand[i];
      if (tiers[i] !== tier - 1 || c.hi < tier) continue;
      const up = c.sizes[tier] - c.sizes[tier - 1];
      if (bytes + up <= K.saveBudget) {
        tiers[i] = tier;
        bytes += up;
      }
    }
  }
  for (let i = 0; i < cand.length; i++) {
    const c = cand[i];
    texts[c.id] = tiers[i] === TIER_DROP ? "" : tierText(tiers[i], c.sT, c.xT, c.pT, c.bT, c.uT);
  }
  return { texts, bytes };
}

/** The save plan's order (presentPlanSteps; keys k0 live, k1 −lastSeen when unseen, k2 an envelope, then id). */
function byOrder(p, q) {
  return p.k0 - q.k0 || p.k1 - q.k1 || p.k2 - q.k2 || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0);
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
  // (a seenBy is written as its writer's index among the writers that stay)
  const ws = state.writersSeen;
  const writers = writerIndex(ws, (w) => !(t - ws[w] > K.writerPruneMs));
  for (const id in hs) {
    const h = hs[id];
    if (!h.gone) {
      // A present record of a code generation before this one, handed over
      // by a hot reload (an id's salt, kidFinishAt), is brought to this
      // build's shape here, as a load does (normalizePresent): packed from now on.
      if (h.stats && typeof h.stats === "object" && !knownShape(h, h, h.slim === true || h.stub === true)) normalizePresent(h);
      other += presentMax(h, writers); // the place strings yield first (presentPlan), then the Album
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

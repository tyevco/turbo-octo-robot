// Save file codec (ARCHITECTURE A4): one JSON object
// { "format": "creaseworks-save", "version": SAVE_VERSION, "check": "<fnv1a32 hex>", "state": {...} }.
// "state" is the canonical state JSON: JSON.stringify of the state in its own
// key order, with each compact Album record (DESIGN R13, helpers.js packAlbum)
// written as its short array. A parse → unpack → rebuild → stringify round trip
// gives the same text.
//
// The check (format 3, DESIGN R13 "save cost"): the helpers map is cut into
// chunks after every id whose last two hex digits are a multiple of 64 (about
// 64 helpers each, chosen by id, so adding or removing one helper changes only
// its own chunk); each chunk's JSON text {"id":record,...} gets an FNV-1a 32
// digest, and the check is FNV-1a 32 of the rest of the state (its JSON with
// "helpers" replaced by a marker), a newline, and the chunk digests in order.
// A writer remembers each chunk's digest (keyed by its text, on the state), so
// a save cycle hashes only the rest and the chunks that changed: the Album,
// which only grows, is not hashed again on every cycle. Loading hashes it all
// once. Formats 1 and 2 (check = FNV-1a 32 of the whole state text) still load.

import { SAVE_FORMAT, ENVELOPES } from "./content.js";
import { fnv1a32 } from "./hash.js";
import { VERSION, MAP_FIELDS, rebuildMaps, migrate, makeMap } from "./state.js";
import { packAlbum, unpackAlbum } from "./helpers.js";

/**
 * The file format version in the envelope. 2 = Album entries may be packed
 * arrays (R13); 3 = the chunked check above. The state's own `version` stays
 * VERSION (state.js): the in-memory state did not change, only its encoding. A
 * build that knows only format 1 reads a format 2 file as "newer" (read-only,
 * never written); a format 2 build cannot verify a format 3 check (DESIGN R13).
 */
export const SAVE_VERSION = 3;

// Digests of the chunk texts of the state's last serialisation (Map text →
// hex), under a symbol key: never serialised, dropped by cloneState, and a
// pure cache (a hit gives exactly what hashing the text gives).
const DIGESTS = Symbol("creaseworks/save-digests");
const MARK = "\u0001helpers";
const HOLE = `"helpers":${JSON.stringify(MARK)}`;

/** A chunk ends after this id: its last two hex digits are a multiple of 64 (any id that is not hex ends one too). */
function cutAfter(id) {
  return (parseInt(id.slice(-2), 16) & 63) === 0;
}

const asIs = (v) => v;
const packed = (h) => (h && h.compact === true && packAlbum(h)) || h;

/**
 * { body, check } of `state` under the format 3 rule. `value` maps a helpers
 * entry to what is written (packAlbum for a live state, as-is for a parsed
 * file); `memo` gives digests already known (text → hex), `out` collects this
 * call's (text → hex). With `memo` false only the body is made (check null).
 */
function encode(state, value, memo, out) {
  const hs = state.helpers;
  const hash = memo !== false;
  if (!isObj(hs)) {
    const body = JSON.stringify(state);
    return { body, check: hash ? fnv1a32(body) : null };
  }
  const ids = Object.keys(hs);
  const inner = [];
  let digests = "";
  let cur = null;
  const close = () => {
    const text = JSON.stringify(cur);
    cur = null;
    if (hash) {
      let d = memo ? memo.get(text) : undefined;
      if (d === undefined) d = fnv1a32(text);
      if (out) out.set(text, d);
      digests += d;
    }
    if (text.length > 2) inner.push(text.slice(1, -1));
  };
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    (cur || (cur = Object.create(null)))[id] = value(hs[id]);
    if (cutAfter(id)) close();
  }
  if (cur) close();
  const copy = Object.create(null);
  for (const k of Object.keys(state)) copy[k] = k === "helpers" ? MARK : state[k];
  const rest = JSON.stringify(copy);
  const at = rest.indexOf(HOLE);
  const body = rest.slice(0, at) + `"helpers":{${inner.join(",")}}` + rest.slice(at + HOLE.length);
  return { body, check: hash ? fnv1a32(`${rest}\n${digests}`) : null };
}

/** The format 3 check of a state as written or parsed (packed Album entries as arrays, or compact records). */
export function saveCheck(state) {
  return encode(state, packed, null, null).check;
}

/** Canonical JSON of a state (compact Album records packed). */
export function canonicalState(state) {
  return encode(state, packed, false, null).body;
}

/** Expand the packed Album entries of a parsed save's helpers (in place); false if one is malformed. */
function unpackHelpers(st) {
  if (!isObj(st.helpers)) return true;
  const src = st.helpers;
  const hs = makeMap(null);
  const ids = Object.keys(src);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const v = src[id];
    if (Array.isArray(v)) {
      const h = unpackAlbum(id, v);
      if (!h) return false;
      hs[id] = h;
    } else {
      hs[id] = v;
    }
  }
  st.helpers = hs;
  return true;
}

/** The full save file text for `state` (remembers its chunk digests on the state for the next call). */
export function serialize(state) {
  const memo = state && state[DIGESTS] instanceof Map ? state[DIGESTS] : null;
  const out = new Map();
  const { body, check } = encode(state, packed, memo, out);
  if (state && typeof state === "object" && Object.isExtensible(state)) state[DIGESTS] = out;
  return `{"format":${JSON.stringify(SAVE_FORMAT)},"version":${SAVE_VERSION},"check":"${check}","state":${body}}`;
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function getPath(state, path) {
  const dot = path.indexOf(".");
  if (dot < 0) return state[path];
  const head = state[path.slice(0, dot)];
  return isObj(head) ? head[path.slice(dot + 1)] : undefined;
}

/** Shape check of a parsed state; returns null when valid, else a short reason. */
export function validateState(s) {
  if (!isObj(s)) return "state";
  for (const k of ["version", "seed", "rng", "clock", "created", "bank", "runFolds", "lifetime", "wishes", "wishCount"]) {
    if (!isNum(s[k])) return k;
  }
  if (typeof s.day !== "string") return "day";
  for (const path of MAP_FIELDS) if (!isObj(getPath(s, path))) return path;
  for (const k of ["settings", "presence", "hand", "spawn", "boosts", "away", "notify", "stats", "ui"]) {
    if (!isObj(s[k])) return k;
  }
  for (const k of ["notices", "garlands"]) if (!Array.isArray(s[k])) return k;
  if (!Array.isArray(s.hand.figures) || !isNum(s.hand.r) || !isNum(s.hand.lastHitAt)) return "hand";
  if (!Array.isArray(s.spawn.scraps) || !isNum(s.spawn.activeMs)) return "spawn";
  for (const k of Object.keys(s.owned)) if (!isNum(s.owned[k]) || s.owned[k] < 0) return "owned";
  for (const k of Object.keys(s.applied)) if (!isNum(s.applied[k])) return "applied";
  for (const k of Object.keys(s.helpers)) {
    const h = s.helpers[k];
    if (!isObj(h) || h.id !== k || (!h.gone && typeof h.addr !== "string") || typeof h.name !== "string"
      || typeof h.status !== "string" || !isNum(h.lastTurn) || !isNum(h.rest) || !isObj(h.stats)) return "helpers";
  }
  for (const k of Object.keys(s.envelopes)) {
    const e = s.envelopes[k];
    if (!isObj(e) || !ENVELOPES.some((d) => d.type === e.type) || !isNum(e.units) || e.units < 0) return "envelopes";
  }
  if (s.bank < 0 || s.lifetime < 0) return "bank";
  return null;
}

/**
 * parseSave(text) → { ok: true, state } | { ok: false, reason, state? }.
 * reason: "parse" (not JSON / truncated), "format" (not a Creaseworks save),
 * "check" (hash mismatch), "newer" (a newer file format or state version: `state` is included,
 * maps rebuilt, for read-only display), "shape" (failed validation).
 */
export function parseSave(text) {
  if (typeof text !== "string") return { ok: false, reason: "parse" };
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, reason: "parse" };
  }
  if (!isObj(doc) || doc.format !== SAVE_FORMAT || !isNum(doc.version) || typeof doc.check !== "string" || !isObj(doc.state)) {
    return { ok: false, reason: "format" };
  }
  // Formats 1-2 hash the whole state text; 3 the chunked rule. A newer format
  // whose check this build cannot verify is "newer" without a state: read-only,
  // never treated as damaged (its backup is never restored over it).
  let digests = null;
  if (doc.version < 3) {
    if (fnv1a32(JSON.stringify(doc.state)) !== doc.check) return { ok: false, reason: "check" };
  } else {
    digests = new Map();
    if (encode(doc.state, asIs, null, digests).check !== doc.check) {
      return { ok: false, reason: doc.version > SAVE_VERSION ? "newer" : "check" };
    }
  }
  const unpacked = unpackHelpers(doc.state);
  if (doc.version > SAVE_VERSION || doc.state.version > VERSION) {
    const why = unpacked ? validateState(doc.state) : "helpers";
    return why ? { ok: false, reason: "newer" } : { ok: false, reason: "newer", state: rebuildMaps(doc.state) };
  }
  if (!unpacked || validateState(doc.state)) return { ok: false, reason: "shape" };
  const state = rebuildMaps(doc.state);
  try {
    migrate(state);
  } catch {
    return { ok: false, reason: "shape" };
  }
  // The first save after a load hashes only what changed since (a cache miss costs nothing but time).
  if (digests) state[DIGESTS] = digests;
  return { ok: true, state };
}

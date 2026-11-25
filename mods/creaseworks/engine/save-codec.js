// Save file codec (ARCHITECTURE A4): one JSON object
// { "format": "creaseworks-save", "version": N, "check": "<fnv1a32 hex>", "state": {...} }.
// The check covers the canonical state JSON: JSON.stringify of the state in its
// own key order, with each compact Album record (DESIGN R13, helpers.js
// packAlbum) written as its short array. A parse → unpack → rebuild →
// stringify round trip gives the same text.

import { SAVE_FORMAT, ENVELOPES } from "./content.js";
import { fnv1a32 } from "./hash.js";
import { VERSION, MAP_FIELDS, rebuildMaps, migrate, makeMap } from "./state.js";
import { packAlbum, unpackAlbum } from "./helpers.js";

/** Canonical JSON of a state (compact Album records packed). */
export function canonicalState(state) {
  const hs = state && state.helpers;
  let packed = null;
  if (hs && typeof hs === "object") {
    for (const id in hs) {
      const h = hs[id];
      if (!h || h.compact !== true) continue;
      const a = packAlbum(h);
      if (a) (packed || (packed = Object.create(null)))[id] = a;
    }
  }
  if (!packed) return JSON.stringify(state);
  const hs2 = Object.create(null);
  for (const id in hs) hs2[id] = packed[id] !== undefined ? packed[id] : hs[id];
  const copy = Object.create(null);
  for (const k of Object.keys(state)) copy[k] = k === "helpers" ? hs2 : state[k];
  return JSON.stringify(copy);
}

/** Expand the packed Album entries of a parsed save's helpers (in place); false if one is malformed. */
function unpackHelpers(st) {
  if (!isObj(st.helpers)) return true;
  const hs = makeMap(st.helpers);
  st.helpers = hs;
  for (const id of Object.keys(hs)) {
    if (!Array.isArray(hs[id])) continue;
    const h = unpackAlbum(id, hs[id]);
    if (!h) return false;
    hs[id] = h;
  }
  return true;
}

/** The full save file text for `state`. */
export function serialize(state) {
  const body = canonicalState(state);
  return `{"format":${JSON.stringify(SAVE_FORMAT)},"version":${VERSION},"check":"${fnv1a32(body)}","state":${body}}`;
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
 * "check" (hash mismatch), "newer" (a newer version: `state` is included,
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
  if (fnv1a32(JSON.stringify(doc.state)) !== doc.check) return { ok: false, reason: "check" };
  const unpacked = unpackHelpers(doc.state);
  if (doc.version > VERSION || doc.state.version > VERSION) {
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
  return { ok: true, state };
}

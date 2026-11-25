// Save file codec (ARCHITECTURE A4): one JSON object
// { "format": "creaseworks-save", "version": SAVE_VERSION, "check": "<fnv1a32 hex>", "state": {...} }.
// "state" is the canonical state JSON: JSON.stringify of the state in its own
// key order, with each compact Album record (DESIGN R13, helpers.js packAlbum)
// written as its short array. A parse → unpack → rebuild → stringify round trip
// gives the same text.
//
// The check (format 3, DESIGN §12.1, R13 "save cost"): the helpers map, in its
// own key order, is cut into chunks after every id whose last two hex digits
// are a multiple of 64 (about 64 helpers each); each chunk's JSON text
// {"id":record,...} gets an FNV-1a 32 digest, and the check is FNV-1a 32 of the
// rest of the state (its JSON with "helpers" replaced by a marker), a newline,
// and the chunk digests in order. A writer remembers each chunk's digest
// (keyed by its text), so a save cycle hashes only the rest and the chunks
// whose text changed. The Album's old chunks keep their text; new helpers are
// appended, so they change the last chunk or two, and a present helper changes
// the chunk it sits in (insertion order: a helper that rejoins keeps its old
// place). Loading hashes every chunk once. Formats 1 and 2 (check = FNV-1a 32
// of the whole state text) still load.
//
// Parsing a large save is split into steps (parseSaveSteps, a generator that
// yields after each STEP_HELPERS helpers) so the glue can spread a load or a
// merge across task steps; parseSave runs the same steps to the end at once.

import { SAVE_FORMAT, ENVELOPES } from "./content.js";
import { fnv1a32 } from "./hash.js";
import { VERSION, MAP_FIELDS, rebuildMaps, migrate, makeMap } from "./state.js";
import { packAlbum, unpackAlbum } from "./helpers.js";

/**
 * The file format version in the envelope. 2 = Album entries may be packed
 * arrays (R13); 3 = the chunked check above; 4 = a packed Album entry may end
 * in its terminal key (5 or 7 items, R6, r3-18) and the helpers map may hold
 * Album archive entries (`past-…`, R13, r3-04), which a format-3 build would
 * misread, so it reads a format-4 file as newer (read-only, never written).
 * The check rule of 4 is 3's. The state's own `version` stays
 * VERSION (state.js): the in-memory state did not change, only its encoding.
 * From format 3 on a build reads any higher format as "newer" (read-only,
 * never written) before verifying its check. Builds of formats 1 and 2 verify
 * the whole-text check first, so they read a format 3 file as damaged; none
 * of them was released (DESIGN §12.1, R13).
 */
export const SAVE_VERSION = 4;

/** Helpers handled per parseSaveSteps step (≈ 15 ms a step in the wasm QuickJS harness; the slowest step of a two-year save ≈ 60 ms). */
export const STEP_HELPERS = 1500;

// The digest cache of the state's last serialisation or parse, under a
// registry symbol (the same key in every code generation, so a hot reload's
// first save replaces it, never adds a second) as a non-enumerable property:
// plain data only (glue/live.js slot contract), never serialised, dropped by
// cloneState, and a pure cache (a hit gives exactly what hashing the text
// gives). { rule: SAVE_VERSION, texts: [chunk text…], digests: [hex…] }; a
// cache of another rule is ignored and replaced.
const CACHE = Symbol.for("creaseworks/save-digests");
const MARK = "\u0001helpers";
const HOLE = `"helpers":${JSON.stringify(MARK)}`;

/** A chunk ends after this id: its last two hex digits are a multiple of 64 (any id that is not hex ends one too). */
function cutAfter(id) {
  return (parseInt(id.slice(-2), 16) & 63) === 0;
}

const asIs = (v) => v;
const packed = (h) => (h && h.compact === true && packAlbum(h)) || h;

/**
 * Steps of { body, check } of `state` under the format 3 rule (yields after
 * every `per` helpers). `value` maps a helpers entry to what is written
 * (packAlbum for a live state, as-is for a parsed file); `memo` gives digests
 * already known (Map text → hex), `out` collects this call's ({ texts,
 * digests }). `hash` false: no check (null); `body` false: no body (null).
 */
function* encodeSteps(state, value, memo, out, hash, body, per) {
  const hs = state.helpers;
  if (!isObj(hs)) {
    const whole = JSON.stringify(state);
    return { body: whole, check: hash ? fnv1a32(whole) : null };
  }
  const ids = Object.keys(hs);
  const inner = body ? [] : null;
  let digests = "";
  let cur = null;
  let left = per;
  const close = () => {
    const text = JSON.stringify(cur);
    cur = null;
    if (hash) {
      let d = memo ? memo.get(text) : undefined;
      if (d === undefined) d = fnv1a32(text);
      if (out) {
        out.texts.push(text);
        out.digests.push(d);
      }
      digests += d;
    }
    if (inner && text.length > 2) inner.push(text.slice(1, -1));
  };
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    (cur || (cur = Object.create(null)))[id] = value(hs[id]);
    if (cutAfter(id)) close();
    if (--left <= 0) {
      left = per;
      yield;
    }
  }
  if (cur) close();
  const copy = Object.create(null);
  for (const k of Object.keys(state)) copy[k] = k === "helpers" ? MARK : state[k];
  const rest = JSON.stringify(copy);
  let text = null;
  if (body) {
    const at = rest.indexOf(HOLE);
    text = rest.slice(0, at) + `"helpers":{${inner.join(",")}}` + rest.slice(at + HOLE.length);
  }
  return { body: text, check: hash ? fnv1a32(`${rest}\n${digests}`) : null };
}

/** Run a step generator to its end at once. */
function finish(it) {
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

/** The format 3 check of a state as written or parsed (packed Album entries as arrays, or compact records). */
export function saveCheck(state) {
  return finish(encodeSteps(state, packed, null, null, true, false, Infinity)).check;
}

/** Canonical JSON of a state (compact Album records packed). */
export function canonicalState(state) {
  return finish(encodeSteps(state, packed, null, null, false, true, Infinity)).body;
}

/** The digest cache of `state` as a Map (text → hex), or null. */
function memoOf(state) {
  const c = state && typeof state === "object" ? state[CACHE] : undefined;
  if (!c || c.rule !== SAVE_VERSION || !Array.isArray(c.texts) || !Array.isArray(c.digests)) return null;
  const m = new Map();
  for (let i = 0; i < c.texts.length; i++) m.set(c.texts[i], c.digests[i]);
  return m;
}

/** Keep `out` as the digest cache of `state` (replacing any earlier one, of any generation). */
function remember(state, out) {
  if (!state || typeof state !== "object") return;
  const c = Object.create(null);
  c.rule = SAVE_VERSION;
  c.texts = out.texts;
  c.digests = out.digests;
  if (Object.hasOwn(state, CACHE)) {
    state[CACHE] = c;
    return;
  }
  if (!Object.isExtensible(state)) return;
  // A build before this one kept its cache under a symbol of its own code
  // generation: handed over by a hot reload, it is dropped here, once.
  for (const k of Object.getOwnPropertySymbols(state)) {
    if (k.description === CACHE.description && Object.getOwnPropertyDescriptor(state, k).configurable) delete state[k];
  }
  Object.defineProperty(state, CACHE, { value: c, writable: true, configurable: true, enumerable: false });
}

/** The full save file text for `state` (remembers its chunk digests on the state for the next call). */
export function serialize(state) {
  const out = { texts: [], digests: [] };
  const { body, check } = finish(encodeSteps(state, packed, memoOf(state), out, true, true, Infinity));
  remember(state, out);
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

/** Shape check of a parsed state up to (not including) its helpers; null when valid, else a short reason. */
function validateHead(s) {
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
  return null;
}

/** True when helpers entry `h` under key `k` is a valid record. */
function validHelper(h, k) {
  return isObj(h) && h.id === k && (h.gone || typeof h.addr === "string") && typeof h.name === "string"
    && typeof h.status === "string" && isNum(h.lastTurn) && isNum(h.rest) && isObj(h.stats);
}

/** Shape check after the helpers; null when valid. */
function validateTail(s) {
  for (const k of Object.keys(s.envelopes)) {
    const e = s.envelopes[k];
    if (!isObj(e) || !ENVELOPES.some((d) => d.type === e.type) || !isNum(e.units) || e.units < 0) return "envelopes";
  }
  if (s.bank < 0 || s.lifetime < 0) return "bank";
  return null;
}

/** Shape check of a parsed state; returns null when valid, else a short reason. */
export function validateState(s) {
  const head = validateHead(s);
  if (head) return head;
  for (const k of Object.keys(s.helpers)) if (!validHelper(s.helpers[k], k)) return "helpers";
  return validateTail(s);
}

/**
 * Steps of parseSave(text): a generator that yields after the JSON parse and
 * after every STEP_HELPERS helpers checked, unpacked or validated, and returns
 * parseSave's result. The glue drives it across task steps (a large save
 * takes most of a 500 ms step to parse in one go, DESIGN R13); nothing it
 * reads changes between steps (the text is a string, the parsed doc its own).
 */
export function* parseSaveSteps(text) {
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
  yield;
  // A higher format is "newer" before its check is verified: this build may
  // not know its rule, and a newer file is never treated as damaged (its
  // backup is never restored over it). Formats 1-2 hash the whole state text;
  // 3 and 4 the chunked rule.
  const newer = doc.version > SAVE_VERSION;
  let out = null;
  if (doc.version < 3) {
    if (fnv1a32(JSON.stringify(doc.state)) !== doc.check) return { ok: false, reason: "check" };
    yield;
  } else {
    out = { texts: [], digests: [] };
    const { check } = yield* encodeSteps(doc.state, asIs, null, out, true, false, STEP_HELPERS);
    if (check !== doc.check) return newer ? { ok: false, reason: "newer" } : { ok: false, reason: "check" };
  }
  // Expand the packed Album entries into a null-prototype map.
  const st = doc.state;
  let unpacked = true;
  if (isObj(st.helpers)) {
    const src = st.helpers;
    const hs = makeMap(null);
    const ids = Object.keys(src);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const v = src[id];
      if (Array.isArray(v)) {
        const h = unpackAlbum(id, v);
        if (!h) {
          unpacked = false;
          break;
        }
        hs[id] = h;
      } else {
        hs[id] = v;
      }
      if ((i + 1) % STEP_HELPERS === 0) yield;
    }
    if (unpacked) st.helpers = hs;
  }
  yield;
  let why = unpacked ? validateHead(st) : "helpers";
  if (!why) {
    const hs = st.helpers;
    const ids = Object.keys(hs);
    for (let i = 0; i < ids.length; i++) {
      if (!validHelper(hs[ids[i]], ids[i])) {
        why = "helpers";
        break;
      }
      if ((i + 1) % STEP_HELPERS === 0) yield;
    }
    if (!why) why = validateTail(st);
  }
  yield;
  if (newer || st.version > VERSION) {
    return why ? { ok: false, reason: "newer" } : { ok: false, reason: "newer", state: rebuildMaps(st) };
  }
  if (why) return { ok: false, reason: "shape" };
  try {
    migrate(st); // rebuilds every map into a null-prototype object
  } catch {
    return { ok: false, reason: "shape" };
  }
  // The first save after a load hashes only what changed since (a cache miss costs nothing but time).
  if (out) remember(st, out);
  return { ok: true, state: st };
}

/**
 * parseSave(text) → { ok: true, state } | { ok: false, reason, state? }.
 * reason: "parse" (not JSON / truncated), "format" (not a Creaseworks save),
 * "check" (hash mismatch), "newer" (a newer file format or state version: `state` is included,
 * maps rebuilt, for read-only display, when the file's check could be verified), "shape" (failed validation).
 * All of parseSaveSteps at once.
 */
export function parseSave(text) {
  return finish(parseSaveSteps(text));
}

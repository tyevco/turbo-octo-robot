// GameState shape (ARCHITECTURE B4) and the helpers that keep it plain JSON
// with null-prototype maps for every data-keyed object (A2 rule 3).

import { K } from "./content.js";

// 2: the Pattern book (DESIGN §4.7, ARCHITECTURE B17): `book`, the crease
// field and fold piece in `spawn`, hand.steady, boosts.coilEnd, ui.hints.field
// and .book. A version-1 state migrates through fillDefaults (an empty, closed
// book); a build that knows only 1 reads a version-2 state as newer.
export const VERSION = 2;

// Every field (dotted path from the state root) holding a data-keyed map.
// The save codec and cloneState rebuild each one into Object.create(null).
export const MAP_FIELDS = Object.freeze([
  "applied",
  "writersSeen",
  "owned",
  "bought",
  "auto",
  "helpers",
  "envelopes",
  "stats.bySource",
  "stats.runBySource",
  "book.found",
]);

/** A fresh null-prototype map, optionally filled from `src`'s own keys. */
export function makeMap(src) {
  const m = Object.create(null);
  if (src && typeof src === "object") {
    for (const k of Object.keys(src)) m[k] = src[k];
  }
  return m;
}

/** Rebuild every MAP field of `state` (in place) into a null-prototype object. */
export function rebuildMaps(state) {
  for (const path of MAP_FIELDS) {
    const dot = path.indexOf(".");
    if (dot < 0) {
      state[path] = makeMap(state[path]);
    } else {
      const head = state[path.slice(0, dot)];
      if (head && typeof head === "object") head[path.slice(dot + 1)] = makeMap(head[path.slice(dot + 1)]);
    }
  }
  return state;
}

/** A spawn block with every clock at its run start. */
export function newSpawn(activeMs, shownMs, seq, cranesSeen, reamDay, craneAt, syncedTo) {
  return {
    activeMs, shownMs, seq, syncedTo,
    nextChainAt: activeMs + K.chainEveryMs,
    nextScrapAt: activeMs + K.scrapEveryMs,
    nextCraneAt: craneAt,
    nextBoatAt: null,
    cranesSeen,
    chain: null, chain2: null, scraps: [], crane: null, boat: null, ream: null,
    reamDay,
    lastChain: null,
    // §4.7: primary chains left until a crease field (null: Crease Field not bought this run),
    // the live field and fold piece, the last set trace (its 3 s result), the crane a Gull
    // fold already pulled (cranesSeen), the end of Fair wind (active ms) and a Hurry still
    // owed (1: a Switchback fold was clicked and no chain or field has come since)
    fieldIn: null, field: null, fold: null, lastField: null, gullFor: -1, windUntil: 0, hurry: 0,
  };
}

/** A new game. `seed` is a uint32 from the glue; `now` ms; `day` "YYYY-MM-DD". */
export function newGame({ seed = 1, now = 0, day = "1970-01-01" } = {}) {
  const s = seed >>> 0;
  return {
    version: VERSION,
    seed: s,
    rng: s,
    clock: now,
    created: now,
    day,
    rev: 0,
    applied: makeMap(),
    writersSeen: makeMap(),
    bank: 0,
    runFolds: 0,
    lifetime: 0,
    wishes: 0,
    wishCount: 0,
    owned: makeMap(),
    bought: makeMap(),
    auto: makeMap(),
    autoAt: { fox: 0 },
    settings: {
      calm: false, gather: true, nodes: true, pops: true,
      notify: { master: false, full: true, pile: true, save: true },
      order: "urgency", density: "auto", style: "short",
    },
    presence: { visible: true, active: true, matShown: true, lastHandAt: 0, handBy: null },
    hand: { lastHitAt: 0, r: 0, frame: 0, figures: [], afterglowMs: 0, steady: 0 },
    spawn: newSpawn(0, 0, 1, 0, day, K.craneFirstMs, now),
    boosts: { rush: 0, storm: 0, chorus: 0, song: 0, tailwind: 0, tailwindMs: 0, rushEnd: 0, stormEnd: 0, coilEnd: 0 },
    helpers: makeMap(),
    envelopes: makeMap(),
    // highWater: the latest wall time this save has counted (§10.1): after a
    // clock-back, the stretch up to it is never credited a second time.
    // skipLeft: how much of a real-looking absence below the mark may still be
    // skipped (the clock-backs seen, capped at the 8 h away cap; away.js).
    away: { pot: null, capUsedMs: 0, lastLiveAt: now, lastSegmentEnd: null, last: null, busy: { since: now, folds: 0, tasks: 0 }, highWater: now, skipLeft: 0 },
    notices: [],
    notify: { day, sent: 0, firedFull: false, pileSince: null, pileDay: null, saveEpisode: null },
    garlands: [],
    stats: {
      bySource: makeMap(), runBySource: makeMap(), tasks: 0, hits: 0,
      units: { created: 0, opened: 0, converted: 0 },
    },
    // lastWish { at, fill }: when the last wish was made and how full the
    // String was (0..1), for the §3.5 wish moment (strands rise and fade).
    ui: { hints: { fold: false, crane: false, field: false, book: 0 }, narrowHintDay: null, lastWish: null },
    // §4.7 the Pattern book, kept across wishes: open once Crease Field was
    // bought; found: diagram id → { n traces, at (wall ms of the first find),
    // ready (spawn.activeMs from which its fold piece may drop again) }
    book: { open: false, found: makeMap() },
  };
}

/** Deep copy through JSON with every MAP field rebuilt (ARCHITECTURE B2). */
export function cloneState(state) {
  return rebuildMaps(JSON.parse(JSON.stringify(state)));
}

/** Fill fields missing from `target` with those of `template` (plain objects only). */
export function fillDefaults(target, template) {
  for (const k of Object.keys(template)) {
    const t = template[k];
    if (!(k in target) || target[k] === undefined) {
      target[k] = t;
    } else if (t && typeof t === "object" && !Array.isArray(t) && Object.getPrototypeOf(t) !== null
      && target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) {
      fillDefaults(target[k], t);
    }
  }
  return target;
}

/** Older save versions → current (in place). Throws on a newer version. */
export function migrate(state) {
  if (!state || typeof state !== "object") throw new TypeError("migrate: not a state");
  if (!(state.version <= VERSION)) throw new RangeError(`migrate: save version ${state.version} is newer than ${VERSION}`);
  rebuildMaps(state);
  fillDefaults(state, newGame({ seed: state.seed, now: state.clock, day: state.day }));
  state.version = VERSION;
  return state;
}

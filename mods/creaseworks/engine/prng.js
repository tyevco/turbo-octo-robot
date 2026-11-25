import { fnv1a32n } from "./hash.js";

// mulberry32 (DESIGN §4.6). next() steps the stream in `state.rng`; keyed()
// draws one value for a named purpose from the game seed. The engine uses
// keyed draws for every roll so that merged windows agree (see keyed());
// nothing may read Math.random (ARCHITECTURE A3).

/** One draw in [0, 1); advances `s.rng`. `s` is the GameState (or any {rng}). */
export function next(s) {
  let t = (s.rng + 0x6d2b79f5) >>> 0;
  s.rng = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** An integer in [0, n). */
export function nextInt(s, n) {
  return Math.floor(next(s) * n);
}

/**
 * A draw in [0, 1) keyed by what it is for (e.g. "env:<helperId>:<turn>"):
 * mulberry32 seeded from the game seed and the key. Keyed draws do not depend
 * on the order in which actions were applied, so two windows whose actions
 * are merged in a different order still roll the same envelope types, figures
 * and spawn outcomes (ARCHITECTURE A5).
 */
export function keyed(s, key) {
  return next({ rng: (fnv1a32n(key) ^ s.seed) >>> 0 });
}

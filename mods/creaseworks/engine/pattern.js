// Crease fields and the Pattern book (DESIGN §4.7, ARCHITECTURE B17): the
// pure shape rules. A field is nine dots in a 3 × 3 grid, numbered
// i = row · 3 + col; a trace is a list of distinct dots, each a neighbour
// (the eight around it, diagonals too) of the one before. A set trace is
// turned into its string of steps in eight directions and named whatever its
// position, turn, mirror, direction and (closed) starting dot.
//
// Imports only content.js; module scope holds literals only (A2 rule 2).

import { PATTERNS, K } from "./content.js";

// The eight steps, clockwise from east (y grows downwards): a step's
// direction is its index, written as one digit. A quarter turn adds 2; the
// mirror in the horizontal axis maps d to (8 − d) mod 8; reversing a step
// adds 4.
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

const colOf = (i) => i % 3;
const rowOf = (i) => (i - (i % 3)) / 3;

/** True when dots a and b (0..8) are neighbours: one apart across, down or diagonally. */
export function adjacent(a, b) {
  if (a === b) return false;
  return Math.abs(colOf(a) - colOf(b)) <= 1 && Math.abs(rowOf(a) - rowOf(b)) <= 1;
}

/** The step from dot a to its neighbour b, 0..7. */
function dirOf(a, b) {
  const dc = colOf(b) - colOf(a);
  const dr = rowOf(b) - rowOf(a);
  for (let d = 0; d < 8; d++) if (DIRS[d][0] === dc && DIRS[d][1] === dr) return d;
  return -1;
}

/** The dot one step `d` from dot i, or -1 off the grid. */
function stepFrom(i, d) {
  const c = colOf(i) + DIRS[d][0];
  const r = rowOf(i) + DIRS[d][1];
  return c < 0 || c > 2 || r < 0 || r > 2 ? -1 : r * 3 + c;
}

/** A path's steps (a closed one with its closing step last), or null when two dots in a row are not neighbours. */
function stepsOf(path, closed) {
  const out = [];
  const n = path.length;
  for (let k = 1; k < n; k++) {
    const d = dirOf(path[k - 1], path[k]);
    if (d < 0) return null;
    out.push(d);
  }
  if (closed) {
    const d = dirOf(path[n - 1], path[0]);
    if (d < 0) return null;
    out.push(d);
  }
  return out;
}

/** Symmetry s (0..7) of step d: s & 3 quarter turns, after the mirror when s ≥ 4. */
function sym(d, s) {
  const m = s >= 4 ? (8 - d) % 8 : d;
  return (m + 2 * (s & 3)) % 8;
}

/**
 * Every step string of one shape: the 8 symmetries × both directions, and
 * for a closed shape every starting dot (at most 8 × 2 × 9 = 144 strings of
 * at most 9 digits). `steps` as stepsOf gives them.
 */
function variants(steps, closed) {
  const n = steps.length;
  const out = [];
  const rev = [];
  for (let k = n - 1; k >= 0; k--) rev.push((steps[k] + 4) % 8);
  // reversing a closed tour: the same dots backwards, closing step last
  // (steps reversed is a rotation of that, which the start loop covers)
  for (const base of [steps, rev]) {
    for (let s = 0; s < 8; s++) {
      const m = base.map((d) => sym(d, s));
      const starts = closed ? n : 1;
      for (let st = 0; st < starts; st++) {
        let text = "";
        for (let k = 0; k < n; k++) text += m[(st + k) % n];
        out.push(text);
      }
    }
  }
  return out;
}

/** True when `path` is a list of distinct dots 0..8 (at most 9). */
function validPath(path) {
  if (!Array.isArray(path) || path.length > 9) return false;
  const seen = [false, false, false, false, false, false, false, false, false];
  for (const i of path) {
    if (!Number.isInteger(i) || i < 0 || i > 8 || seen[i]) return false;
    seen[i] = true;
  }
  return true;
}

/**
 * The canonical string of a trace: the smallest of its variants, prefixed
 * "o:" (open) or "c:" (closed). Null for a path that is not a trace of at
 * least 2 dots (3 when closed) of neighbouring, distinct dots.
 */
export function canonOf(path, closed) {
  const c = closed === true;
  if (!validPath(path) || path.length < (c ? 3 : 2)) return null;
  const steps = stepsOf(path, c);
  if (!steps) return null;
  let best = null;
  for (const v of variants(steps, c)) if (best === null || v < best) best = v;
  return `${c ? "c" : "o"}:${best}`;
}

/** The diagram id a set trace makes (PATTERNS[].canon), or null: a loose crease. */
export function classifyTrace(path, closed) {
  if (!Array.isArray(path) || path.length < 3) return null;
  const key = canonOf(path, closed);
  if (key === null) return null;
  for (const p of PATTERNS) for (const c of p.canon) if (c === key) return p.id;
  return null;
}

/**
 * What a click on dot i would do to `field`'s trace (DESIGN §4.7 rules 1-4):
 * "start" (an empty trace, never the centre), "step" (an unused neighbour of
 * the last dot), "set" (the last dot again, 3 or more dots: open), "close"
 * (the first dot, next to the last, 3 or more dots) or "none" (only its fold).
 */
export function traceMove(field, i) {
  if (!field || !Number.isInteger(i) || i < 0 || i > 8) return "none";
  const path = Array.isArray(field.path) ? field.path : [];
  const n = path.length;
  if (n === 0) return i === 4 ? "none" : "start";
  const last = path[n - 1];
  if (i === last) return n >= 3 ? "set" : "none";
  if (i === path[0]) return n >= 3 && adjacent(i, last) ? "close" : "none";
  if (path.indexOf(i) >= 0) return "none";
  return adjacent(i, last) ? "step" : "none";
}

/** True when nothing more can happen to the trace: no unused neighbour of its last dot, and the first dot is not next to it. */
export function deadEnd(path) {
  if (!Array.isArray(path) || path.length === 0) return false;
  const last = path[path.length - 1];
  for (let j = 0; j < 9; j++) if (adjacent(last, j) && path.indexOf(j) < 0) return false;
  return !(path.length >= 3 && adjacent(last, path[0]));
}

/** Every step string of diagram `p` (from its own tracing). */
function patternVariants(p) {
  const path = p.dots.map(([c, r]) => r * 3 + c);
  return variants(stepsOf(path, p.closed), p.closed);
}

/**
 * Is `path` (a loose set) the start of a tracing of one of the diagrams `ids`
 * that fits on the grid from where it is? → { id, more } (the dots it still
 * needs), the first such diagram in book order, or null. Only found diagrams
 * and the next one to find are passed, so a hidden one is never named.
 * A closed diagram traced in full but set open (`closed` false: the last dot
 * clicked again, or the field's life ran out), its last dot next to its
 * first, comes first → { id, more: 0, close: true }: it needed one closing
 * click on the first dot, and naming a longer open diagram would mislead.
 */
export function nearMiss(path, ids, closed = false) {
  if (!validPath(path) || path.length < 1 || !Array.isArray(ids)) return null;
  const k = path.length;
  if (closed !== true && k >= 3 && adjacent(path[k - 1], path[0])) {
    const shut = classifyTrace(path, true);
    if (shut !== null && ids.indexOf(shut) >= 0) return { id: shut, more: 0, close: true };
  }
  const own = stepsOf(path, false);
  if (!own) return null;
  let prefix = "";
  for (const d of own) prefix += d;
  for (const p of PATTERNS) {
    if (ids.indexOf(p.id) < 0 || k >= p.n) continue;
    for (const v of patternVariants(p)) {
      if (!v.startsWith(prefix)) continue;
      // walk the rest of this tracing from the trace's last dot: it must stay on the grid on unused dots
      const used = path.slice();
      let at = path[k - 1];
      let ok = true;
      for (let s = k - 1; s < p.n - 1 && ok; s++) {
        const next = stepFrom(at, Number(v[s]));
        if (next < 0 || used.indexOf(next) >= 0) ok = false;
        else { used.push(next); at = next; }
      }
      if (ok && p.closed && !adjacent(at, path[0])) ok = false;
      if (ok) return { id: p.id, more: p.n - k };
    }
  }
  return null;
}

/** Tier of a diagram traced n times: 0 none, 1 found (1), 2 learned (K.bookLearn), 3 mastered (K.bookMaster). */
export function bookTier(n) {
  if (!(n >= 1)) return 0;
  if (n >= K.bookMaster) return 3;
  return n >= K.bookLearn ? 2 : 1;
}

/** The book at a glance: diagrams found, marks earned (Σ tiers, of 27) and the next to find (book order), or null when all are found. */
export function bookInfo(state) {
  const found = state && state.book && state.book.found;
  let n = 0;
  let marks = 0;
  let next = null;
  for (const p of PATTERNS) {
    const f = found && Object.hasOwn(found, p.id) ? found[p.id] : null;
    if (f && f.n >= 1) {
      n++;
      marks += bookTier(f.n);
    } else if (next === null) {
      next = p.id;
    }
  }
  return { found: n, marks, next };
}

/** The PATTERNS row of diagram `id`, or undefined. */
export function patternOf(id) {
  for (const p of PATTERNS) if (p.id === id) return p;
  return undefined;
}

/** Dot index of grid (col, row). */
export function dotAt(col, row) {
  return row * 3 + col;
}

/** Grid [col, row] of dot i. */
export function colRow(i) {
  return [colOf(i), rowOf(i)];
}

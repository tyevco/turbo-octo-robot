// Pattern book shapes (DESIGN §4.7, ARCHITECTURE B17): the classifier, the
// trace rules and the book's tiers. The full enumeration of king-move paths
// on 3 × 3 runs here in Node only, never in the QuickJS harness.
import { test } from "node:test";
import assert from "node:assert/strict";
import { engine } from "./_util.mjs";
import { PATTERNS, K } from "../../mods/creaseworks/engine/content.js";

const { canonOf, classifyTrace, traceMove, deadEnd, nearMiss, bookTier, bookInfo, adjacent } = engine;
const idx = ([c, r]) => r * 3 + c;
const IDS = ["ridge", "gull", "napkin", "lozenge", "stair", "sail", "switchback", "hem", "coil"];

// The 8 symmetries of the square on grid coordinates (rotate, then maybe mirror) about the 3 × 3 centre.
const SYMS = [];
for (let k = 0; k < 4; k++) {
  for (const m of [false, true]) {
    SYMS.push(([c, r]) => {
      let x = c - 1;
      let y = r - 1;
      for (let q = 0; q < k; q++) [x, y] = [-y, x];
      if (m) x = -x;
      return [x + 1, y + 1];
    });
  }
}

/** Every placement of `dots` (coordinates) on the grid: shifted so it fits, in every position it fits. */
function placements(dots) {
  const out = [];
  const minC = Math.min(...dots.map((d) => d[0]));
  const minR = Math.min(...dots.map((d) => d[1]));
  const w = Math.max(...dots.map((d) => d[0])) - minC;
  const h = Math.max(...dots.map((d) => d[1])) - minR;
  for (let dc = 0; dc + w <= 2; dc++) for (let dr = 0; dr + h <= 2; dr++) out.push(dots.map(([c, r]) => [c - minC + dc, r - minR + dr]));
  return out;
}

/** Every tracing of a diagram: 8 symmetries × positions × 2 directions × (closed: every start). */
function tracings(p) {
  const out = [];
  for (const s of SYMS) {
    for (const placed of placements(p.dots.map(s))) {
      const path = placed.map(idx);
      for (const dir of [path, [...path].reverse()]) {
        const starts = p.closed ? dir.length : 1;
        for (let st = 0; st < starts; st++) out.push([...dir.slice(st), ...dir.slice(0, st)]);
      }
    }
  }
  return out;
}

/** Every king-move path on 3 × 3 with at least `min` dots (distinct dots, each a neighbour of the last). */
function allPaths(min = 2) {
  const out = [];
  const grow = (path) => {
    if (path.length >= min) out.push(path.slice());
    const last = path[path.length - 1];
    for (let j = 0; j < 9; j++) {
      if (path.includes(j) || !adjacent(last, j)) continue;
      path.push(j);
      grow(path);
      path.pop();
    }
  };
  for (let i = 0; i < 9; i++) grow([i]);
  return out;
}

test("PATTERNS: nine diagrams in book order; every canon is rebuilt from its dots; all distinct", () => {
  assert.deepEqual(PATTERNS.map((p) => p.id), IDS);
  const all = [];
  for (const p of PATTERNS) {
    assert.equal(p.dots.length, p.n, p.id);
    assert.ok(Object.isFrozen(p) && Object.isFrozen(p.dots) && Object.isFrozen(p.canon), `${p.id} frozen`);
    const path = p.dots.map(idx);
    assert.equal(canonOf(path, p.closed), p.canon[0], `${p.id}: canon rebuilt from its dots`);
    for (const c of p.canon) {
      assert.match(c, p.closed ? /^c:[0-7]+$/ : /^o:[0-7]+$/, p.id);
      all.push(c);
    }
    // its tracing starts off the centre, and every step is to a neighbour
    assert.notEqual(path[0], 4, `${p.id} starts on the centre`);
    for (let k = 1; k < path.length; k++) assert.ok(adjacent(path[k - 1], path[k]), `${p.id} step ${k}`);
    if (p.closed) assert.ok(adjacent(path[path.length - 1], path[0]), `${p.id} closes`);
    // the strings fit the card and the chip (DESIGN §4.7: short ≤ 16, text ≤ 44, name ≤ 12 graphemes)
    assert.ok(engine.graphemeCount(p.short) <= 16, `${p.id} short`);
    assert.ok(engine.graphemeCount(p.text) <= 44, `${p.id} text`);
    assert.ok(engine.graphemeCount(p.name) <= 12, `${p.id} name`);
    assert.equal(p.hint === null, p.id === "ridge", `${p.id} hint`);
    if (p.hint !== null) assert.ok(engine.graphemeCount(p.hint) <= 44, `${p.id} hint`);
  }
  assert.equal(new Set(all).size, all.length, "no two diagrams share a canon");
  // Ridge's two canons: straight across and corner to corner
  assert.deepEqual([...PATTERNS[0].canon], [canonOf([0, 1, 2], false), canonOf([0, 4, 8], false)]);
  // the fx keys of B17
  assert.deepEqual(PATTERNS.map((p) => p.fx), ["steady", "pull", "glow", "finish", "lift", "wind", "hurry", "margin", "windup"]);
});

test("every turn, mirror, position, direction and (closed) start of every diagram classifies to it", () => {
  for (const p of PATTERNS) {
    const ts = tracings(p);
    assert.ok(ts.length >= 8, p.id);
    for (const t of ts) assert.equal(classifyTrace(t, p.closed), p.id, `${p.id}: ${t.join(",")}`);
    // and Ridge's diagonal
    if (p.id === "ridge") for (const t of [[0, 4, 8], [8, 4, 0], [2, 4, 6], [6, 4, 2]]) assert.equal(classifyTrace(t, false), "ridge");
  }
  // every diagram fits in a field with a tracing that starts off the centre in some placement
  for (const p of PATTERNS) assert.ok(tracings(p).some((t) => t[0] !== 4), p.id);
});

test("near misses: one dot short, the wrong ending, or a closed/open mix-up is not the diagram", () => {
  for (const p of PATTERNS) {
    const path = p.dots.map(idx);
    // one dot short, set open: never this diagram
    const short = path.slice(0, -1);
    if (short.length >= 3) assert.notEqual(classifyTrace(short, false), p.id, `${p.id} short`);
    // set the other way (closed ↔ open): never this diagram
    if (path.length >= 3 && adjacent(path[path.length - 1], path[0])) assert.notEqual(classifyTrace(path, !p.closed), p.id, `${p.id} other ending`);
  }
  // Hem and Coil share a route: closing the Coil's 9 dots is a loose 9-dot loop; Hem set open is loose
  const coil = PATTERNS.find((p) => p.id === "coil").dots.map(idx);
  const hem = PATTERNS.find((p) => p.id === "hem").dots.map(idx);
  assert.equal(classifyTrace(coil, true), null);
  assert.equal(classifyTrace(hem, false), null);
  assert.equal(classifyTrace([...hem, 4], false), "coil");
  // the Lozenge's first three dots are a Gull (a different diagram, not a near miss of itself)
  assert.equal(classifyTrace([1, 5, 7], false), "gull");
  // fewer than 3 dots never classify; a broken or repeated path is not a trace
  assert.equal(classifyTrace([0, 1], false), null);
  assert.equal(classifyTrace([0, 2, 1], false), null, "0 → 2 is not a step");
  assert.equal(classifyTrace([0, 1, 0], false), null);
  assert.equal(classifyTrace([0, 1, 9], false), null);
  assert.equal(canonOf("012", false), null);
  // nearMiss names only the diagrams passed (found + next), with the dots still needed
  assert.deepEqual(nearMiss([0, 1, 4], ["napkin"]), { id: "napkin", more: 1 });
  assert.equal(nearMiss([0, 1, 4], ["ridge"]), null);
  assert.equal(nearMiss([0, 1, 4], []), null, "a hidden diagram is never named");
  assert.deepEqual(nearMiss([0, 1, 2, 5, 8, 7, 6], ["hem", "coil"]), { id: "hem", more: 1 });
  // a start that cannot be finished from where it is on the grid is no near miss: the Stair's
  // first three dots (0,0)(1,0)(1,1) need two more steps across and down
  assert.deepEqual(nearMiss([0, 1, 4], ["stair"]), { id: "stair", more: 2 });
  assert.deepEqual(nearMiss([2, 1, 4], ["stair"]), { id: "stair", more: 2 }, "mirrored: (0,1) then (0,2)");
  assert.equal(nearMiss([1, 2, 5], ["stair"]), null, "(1,0)(2,0)(2,1) has no room for the next step across");
});

test("full enumeration (Node only): every king-move path of 3+ dots classifies to at most one diagram, and exactly when its canon is that diagram's", () => {
  const paths = allPaths(3);
  assert.ok(paths.length > 10000, `${paths.length} paths`);
  const byCanon = new Map();
  for (const p of PATTERNS) for (const c of p.canon) byCanon.set(c, p.id);
  const reached = new Set();
  let matches = 0;
  for (const path of paths) {
    for (const closed of [false, true]) {
      if (closed && !adjacent(path[path.length - 1], path[0])) continue;
      const id = classifyTrace(path, closed);
      assert.equal(id, byCanon.get(canonOf(path, closed)) ?? null);
      if (id) {
        matches++;
        reached.add(id);
        assert.equal(PATTERNS.find((p) => p.id === id).closed, closed);
        assert.equal(PATTERNS.find((p) => p.id === id).n, path.length);
      }
    }
  }
  assert.deepEqual([...reached].sort(), [...IDS].sort(), "every diagram is reachable");
  assert.ok(matches > 0);
  // every 3-dot shape but Ridge and Gull is loose
  const three = new Set();
  for (const path of paths) if (path.length === 3) three.add(canonOf(path, false));
  const named = [...three].filter((c) => byCanon.has(c)).map((c) => byCanon.get(c));
  assert.deepEqual([...new Set(named)].sort(), ["gull", "ridge"]);
  assert.ok(three.size > 3, "there are loose 3-dot shapes");
  // closed 3-dot triangles are loose too, and canonOf is a pure function (same input, same string)
  assert.equal(classifyTrace([0, 1, 4], true), null);
  for (const path of paths.slice(0, 500)) assert.equal(canonOf(path, false), canonOf(path.slice(), false));
  // at most 144 candidate strings: a closed 9-dot loop has 8 × 2 × 9 variants; its canon is one of them
  assert.match(canonOf([0, 1, 2, 5, 8, 7, 6, 3], true), /^c:[0-7]{8}$/);
});

test("traceMove: start anywhere but the centre; step to an unused neighbour; set on the last dot again; close on the first", () => {
  const f = (path) => ({ id: "p1", born: 0, path });
  assert.equal(traceMove(f([]), 4), "none", "the centre never starts a trace");
  for (const i of [0, 1, 2, 3, 5, 6, 7, 8]) assert.equal(traceMove(f([]), i), "start");
  assert.equal(traceMove(f([0]), 4), "step", "the centre can be a step");
  assert.equal(traceMove(f([0]), 1), "step");
  assert.equal(traceMove(f([0]), 2), "none", "not a neighbour");
  assert.equal(traceMove(f([0]), 0), "none", "the last dot with fewer than 3");
  assert.equal(traceMove(f([0, 1]), 1), "none");
  assert.equal(traceMove(f([0, 1, 2]), 2), "set");
  assert.equal(traceMove(f([0, 1, 2]), 0), "none", "the first dot, not next to the last");
  assert.equal(traceMove(f([0, 1, 4]), 0), "close");
  assert.equal(traceMove(f([0, 1]), 0), "none", "closing needs 3 dots");
  assert.equal(traceMove(f([0, 1, 4, 3]), 1), "none", "a used dot");
  assert.equal(traceMove(f([0, 1, 4]), 9), "none");
  assert.equal(traceMove(f([0, 1, 4]), -1), "none");
  assert.equal(traceMove(f([0, 1, 4]), 1.5), "none");
  assert.equal(traceMove(null, 0), "none");
});

test("deadEnd: no unused neighbour of the last dot and the first dot not next to it", () => {
  assert.equal(deadEnd([]), false);
  assert.equal(deadEnd([0, 1, 2]), false);
  // a corner whose neighbours are all used, the first dot (1) not next to it: nothing more can happen
  assert.equal(deadEnd([1, 2, 5, 4, 3, 6, 7, 8]), true);
  // the same with the first dot next to the last: it can still close
  assert.equal(deadEnd([5, 2, 1, 0, 3, 6, 7, 4, 8]), false);
  assert.equal(deadEnd([0, 3, 6, 7, 4, 1, 2, 5, 8]), true, "all nine used, the first (0) not next to the last (8)");
  assert.equal(deadEnd([0, 1, 2, 5, 8, 7, 6, 3, 4]), false, "Coil: the centre is next to the first dot");
  assert.equal(deadEnd([4, 0, 1]), false);
});

test("bookTier and bookInfo: found 1, learned 4, mastered 12; marks are tiers; next is the first unfound in book order", () => {
  assert.deepEqual([0, 1, 3, 4, 11, 12, 9999].map(bookTier), [0, 1, 1, 2, 2, 3, 3]);
  assert.equal(K.bookLearn, 4);
  assert.equal(K.bookMaster, 12);
  const s = engine.newGame({ seed: 1 });
  assert.deepEqual(bookInfo(s), { found: 0, marks: 0, next: "ridge" });
  s.book.found.gull = { n: 4, at: 1, ready: 0 };
  assert.deepEqual(bookInfo(s), { found: 1, marks: 2, next: "ridge" });
  for (const id of IDS) s.book.found[id] = { n: 12, at: 1, ready: 0 };
  assert.deepEqual(bookInfo(s), { found: 9, marks: 27, next: null });
  // a prototype-named key in the map is a plain key and never counted
  s.book.found.__proto__ = { n: 3, at: 0, ready: 0 };
  assert.equal(bookInfo(s).found, 9);
  assert.equal(Object.getPrototypeOf(s.book.found), null);
});

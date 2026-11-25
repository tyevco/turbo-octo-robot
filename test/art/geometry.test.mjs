// Geometry of the generated art (sampled from the generator's shape model):
// facets tile without overlapping across levels, so the alpha file and the
// -a/-b/-c split fallback show the same picture; layered sprites line up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAssets, insideShape } from "../../tools/art/generate.mjs";

const assets = buildAssets();
const byPath = new Map(assets.map((a) => [a.path, a]));
const STEP = 0.25;
const OFF = 0.0731; // off the half-unit grid, so samples never sit on an edge

function* samples(w, h) {
  for (let y = OFF; y < h; y += STEP) for (let x = OFF; x < w; x += STEP) yield [x, y];
}
const covered = (shapes, x, y) => shapes.some((s) => insideShape(s, x, y));
const area = (shapes, w, h) => {
  let n = 0;
  for (const [x, y] of samples(w, h)) if (covered(shapes, x, y)) n++;
  return n * STEP * STEP;
};

const folk = assets.filter((a) => a.group === "folk");

test("12 faceted species, each using all three facet levels", () => {
  assert.equal(folk.length, 12);
  for (const a of folk) {
    const levels = new Set(a.shapes.map((s) => s.f));
    assert.deepEqual([...levels].sort(), [1, 2, 3], a.path);
  }
});

test("folk facets never overlap across levels (alpha and split render alike)", () => {
  for (const a of folk) {
    let overlap = 0;
    for (const [x, y] of samples(a.w, a.h)) {
      const levels = new Set(a.shapes.filter((s) => insideShape(s, x, y)).map((s) => s.f));
      if (levels.size > 1) overlap++;
    }
    assert.ok(overlap * STEP * STEP <= 0.25, `${a.path}: ${overlap * STEP * STEP} square units overlap across facet levels`);
  }
});

test("the split files are exactly the alpha file's levels", () => {
  for (const a of folk) {
    const name = a.path.slice(5, -4);
    for (const [suffix, level] of [["a", 1], ["b", 2], ["c", 3]]) {
      const part = byPath.get(`folk/${name}-${suffix}.svg`);
      assert.ok(part, `${name}-${suffix}`);
      assert.deepEqual(part.shapes, a.shapes.filter((s) => s.f === level));
      assert.doesNotMatch(part.svg, /fill-opacity/);
    }
  }
});

test("species fill their grid comparably (a 16 px blob is never a speck)", () => {
  for (const a of folk) {
    let minX = 99, maxX = -1, minY = 99, maxY = -1;
    for (const [x, y] of samples(a.w, a.h)) {
      if (!covered(a.shapes, x, y)) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    assert.ok(Math.max(maxX - minX, maxY - minY) >= 25, `${a.path} spans only ${maxX - minX}×${maxY - minY}`);
    const ink = area(a.shapes, a.w, a.h);
    assert.ok(ink >= 180 && ink <= 620, `${a.path}: ${ink} square units of ink`);
  }
});

test("Sheet frames: 8 frames, each shade layer lies on its base", () => {
  for (let i = 0; i < 8; i++) {
    const base = byPath.get(`sheet/${i}-base.svg`), shade = byPath.get(`sheet/${i}-shade.svg`);
    assert.ok(base && shade, `frame ${i}`);
    let outside = 0, shadeArea = 0;
    for (const [x, y] of samples(64, 64)) {
      if (!covered(shade.shapes, x, y)) continue;
      shadeArea++;
      if (!covered(base.shapes, x, y)) outside++;
    }
    assert.ok(shadeArea > 0, `frame ${i} has an empty shade`);
    assert.ok(outside * STEP * STEP <= 0.5, `frame ${i}: shade spills ${outside * STEP * STEP} units off the base`);
  }
});

test("Sheet frames all differ and grow no larger than the 64 grid", () => {
  const sigs = new Set();
  for (let i = 0; i < 8; i++) sigs.add(byPath.get(`sheet/${i}-base.svg`).svg);
  assert.equal(sigs.size, 8);
});

test("gilded crane: the outline is the body grown by about 1.5 units; shade lies on the body", () => {
  const outline = byPath.get("scene/crane-gilded-outline.svg").shapes;
  const body = byPath.get("scene/crane-gilded-body.svg").shapes;
  const shade = byPath.get("scene/crane-gilded-shade.svg").shapes;
  let uncovered = 0, shadeOff = 0;
  for (const [x, y] of samples(40, 28)) {
    const inBody = covered(body, x, y);
    if (inBody && !covered(outline, x, y)) uncovered++;
    if (covered(shade, x, y) && !inBody) shadeOff++;
    // every point 1 unit outside the body (in the 4 axis directions) is still outlined
    if (inBody) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!covered(outline, x + dx, y + dy)) uncovered++;
  }
  assert.equal(uncovered, 0);
  assert.ok(shadeOff * STEP * STEP <= 0.25);
  const grownBy = (area(outline, 40, 28) - area(body, 40, 28));
  assert.ok(grownBy > 60, `outline ring is only ${grownBy} units`);
});

test("only notify-icon.svg is full colour, and it is crane on mat", () => {
  for (const a of assets) {
    const fills = new Set([...a.svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]));
    if (a.path === "notify-icon.svg") assert.deepEqual([...fills].sort(), ["#2f6a55", "#fbf7ee"]);
    else assert.deepEqual([...fills], ["#000"], a.path);
  }
});

test("garland strand: 50 crane silhouettes, one per 4 units", () => {
  const g = byPath.get("ui/garland-strand.svg");
  assert.equal(g.shapes[0].parts.length, 50);
  for (let i = 0; i < 50; i++) assert.ok(covered(g.shapes, 6, i * 4 + 2.6), `crane ${i}`);
});

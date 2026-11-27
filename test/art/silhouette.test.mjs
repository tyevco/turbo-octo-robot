// Silhouette test (DESIGN §13.1, §14): the 12 species as one-colour 16 px
// blobs and the status glyphs at 12 px (greyscale = coverage, since each is a
// single colour) are rasterised by Chromium and compared pairwise. Each pair
// must differ by at least a minimum number of whole pixels of coverage, and
// each sprite must cover a sensible share of its square. The nine fold pieces
// (DESIGN §4.7 "Art"), base and shade drawn together, are held to the same
// bound against each other and against the scrap, ream, gilded crane, boat,
// the Sheet's fold frames and the species sprites, and each shade lies on its base.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ART_DIR } from "../../tools/art/generate.mjs";
import { NAMES } from "../../tools/art/check-svg.mjs";
import { loadPlaywright } from "../../tools/art/sheet.mjs";

let playwright = null;
try {
  playwright = loadPlaywright();
} catch {
  playwright = null;
}
const skip = !playwright && "playwright is not installed";

const uri = (f) => `data:image/svg+xml;base64,${readFileSync(join(ART_DIR, f)).toString("base64")}`;
const STATUS_GLYPHS = ["working-arc", "needs", "done-check", "rest", "envelope", "pip-work", "pip-rest", "pip-needs"];

/** Coverage maps (0..1 per pixel) for each sprite: layers drawn together at `size` px. */
async function coverage(page, sprites, size) {
  return page.evaluate(async ({ sprites, size }) => {
    const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
    const out = {};
    for (const [name, layers] of Object.entries(sprites)) {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const g = c.getContext("2d");
      for (const src of layers) g.drawImage(await load(src), 0, 0, size, size);
      const d = g.getImageData(0, 0, size, size).data;
      out[name] = Array.from({ length: size * size }, (_, i) => d[i * 4 + 3] / 255);
    }
    return out;
  }, { sprites, size });
}

function pairwise(maps) {
  const names = Object.keys(maps);
  const pairs = [];
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const a = maps[names[i]], b = maps[names[j]];
      pairs.push({ pair: `${names[i]}/${names[j]}`, d: a.reduce((s, v, k) => s + Math.abs(v - b[k]), 0) });
    }
  return pairs.sort((x, y) => x.d - y.d);
}

async function withPage(fn) {
  const browser = await playwright.chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><body></body>");
    return await fn(page);
  } finally {
    await browser.close();
  }
}

test("the 12 species are distinct one-colour blobs at 16 px", { skip }, async () => {
  const sprites = Object.fromEntries(NAMES.folk.map((n) => [n, ["a", "b", "c"].map((s) => uri(`folk/${n}-${s}.svg`))]));
  const maps = await withPage((page) => coverage(page, sprites, 16));
  for (const [n, m] of Object.entries(maps)) {
    const ink = m.reduce((s, v) => s + v, 0);
    assert.ok(ink >= 45 && ink <= 160, `${n}: ${ink.toFixed(1)} px of 256 covered`);
  }
  const closest = pairwise(maps)[0];
  assert.ok(closest.d >= 24, `closest pair ${closest.pair} differs by only ${closest.d.toFixed(1)} px`);
});

test("the facet split reproduces the silhouette of the alpha file at 16 px", { skip }, async () => {
  const sprites = {};
  for (const n of NAMES.folk) {
    sprites[`${n}:split`] = ["a", "b", "c"].map((s) => uri(`folk/${n}-${s}.svg`));
    sprites[`${n}:alpha`] = [uri(`folk/${n}.svg`)];
  }
  const maps = await withPage((page) => coverage(page, sprites, 16));
  for (const n of NAMES.folk) {
    const split = maps[`${n}:split`], alpha = maps[`${n}:alpha`];
    // facets lower coverage, they never move it: a pixel the one draws at least
    // half covered, the other draws at all
    const footprint = split.reduce((s, v, k) => s + ((v >= 0.5 && alpha[k] === 0) || (alpha[k] >= 0.5 && v === 0) ? 1 : 0), 0);
    assert.equal(footprint, 0, `${n}: footprints differ in ${footprint} px`);
  }
});

test("status glyphs are distinguishable at 12 px in greyscale", { skip }, async () => {
  const sprites = Object.fromEntries(STATUS_GLYPHS.map((n) => [n, [uri(`status/${n}.svg`)]]));
  const maps = await withPage((page) => coverage(page, sprites, 12));
  for (const [n, m] of Object.entries(maps)) {
    const ink = m.reduce((s, v) => s + v, 0);
    assert.ok(ink >= 25, `${n}: only ${ink.toFixed(1)} px of 144 covered`);
  }
  const closest = pairwise(maps)[0];
  assert.ok(closest.d >= 16, `closest pair ${closest.pair} differs by only ${closest.d.toFixed(1)} px`);
});

const FOLDS = ["ridge", "gull", "napkin", "lozenge", "stair", "sail", "switchback", "hem", "coil"];
const foldLayers = (id) => [uri(`scene/fold-${id}-base.svg`), uri(`scene/fold-${id}-shade.svg`)];

test("the nine fold pieces are distinct 16 px silhouettes, against each other and the scrap, ream, crane, boat, Sheet frames and species sprites", { skip }, async () => {
  const folds = Object.fromEntries(FOLDS.map((id) => [`fold-${id}`, foldLayers(id)]));
  const others = {
    scrap: [uri("scene/scrap.svg")],
    ream: [uri("scene/ream.svg")],
    crane: ["body", "shade", "outline"].map((l) => uri(`scene/crane-gilded-${l}.svg`)),
    boat: [uri("scene/boat-hull.svg"), uri("scene/boat-sail.svg")],
    // the Sheet's own eight fold frames: no fold piece may read as one of them (frame 3 is a diamond)
    ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((k) => [`sheet-${k}`, [uri(`sheet/${k}-base.svg`), uri(`sheet/${k}-shade.svg`)]])),
    ...Object.fromEntries(NAMES.folk.map((n) => [n, ["a", "b", "c"].map((s) => uri(`folk/${n}-${s}.svg`))])),
  };
  const maps = await withPage((page) => coverage(page, { ...folds, ...others }, 16));
  for (const n of Object.keys(folds)) {
    const ink = maps[n].reduce((s, v) => s + v, 0);
    assert.ok(ink >= 45 && ink <= 180, `${n}: ${ink.toFixed(1)} px of 256 covered`);
  }
  // every fold-vs-fold and fold-vs-other pair (other-vs-other pairs are the tests above)
  const pairs = pairwise(maps).filter((p) => p.pair.split("/").some((x) => x.startsWith("fold-")));
  assert.equal(pairs.length, 9 * 8 / 2 + 9 * Object.keys(others).length);
  const closest = pairs[0];
  assert.ok(closest.d >= 24, `closest pair ${closest.pair} differs by only ${closest.d.toFixed(1)} px`);
});

test("each fold piece's shade lies on its base at 16 px and 20 px", { skip }, async () => {
  const sprites = {};
  for (const id of FOLDS) {
    sprites[`${id}:base`] = [uri(`scene/fold-${id}-base.svg`)];
    sprites[`${id}:shade`] = [uri(`scene/fold-${id}-shade.svg`)];
  }
  for (const size of [16, 20]) {
    const maps = await withPage((page) => coverage(page, sprites, size));
    for (const id of FOLDS) {
      const base = maps[`${id}:base`], shade = maps[`${id}:shade`];
      const ink = shade.reduce((s, v) => s + v, 0);
      assert.ok(ink >= 2, `${id}: a shade to see (${ink.toFixed(1)} px at ${size})`);
      // a shade pixel at least half covered is never where the base draws nothing
      const off = shade.reduce((s, v, k) => s + (v >= 0.5 && base[k] === 0 ? 1 : 0), 0);
      assert.equal(off, 0, `${id}: ${off} shade px off the base at ${size} px`);
    }
  }
});

export { coverage, pairwise };

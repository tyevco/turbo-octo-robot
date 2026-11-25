// Silhouette test (DESIGN §13.1, §14): the 12 species as one-colour 16 px
// blobs and the status glyphs at 12 px (greyscale = coverage, since each is a
// single colour) are rasterised by Chromium and compared pairwise. Each pair
// must differ by at least a minimum number of whole pixels of coverage, and
// each sprite must cover a sensible share of its square.
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

export { coverage, pairwise };

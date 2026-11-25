// The String card's strands (DESIGN §3.5, review r3-20): a strand's tinted
// fill is clipped only on whole sprite crane rows, the sprite keeps its 12 × 200
// aspect so its rows sit on that grid (gpui scales an svg by width and
// centres it: a squashed box letterboxes the cranes off the grid), and the
// 304 px card draws the strands at the full 12 px.
//
//   node --import ./tools/node/register.mjs --test test/ui/string.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { installMockWindow, walk, findById } from "../../tools/mock/gpui-kit.js";
import * as F from "../fixtures/vm-fixtures.mjs";
import { pickScene, pickHues } from "../../mods/creaseworks/ui/palette.js";
import { renderString, strandShares, strandSize, strandFill, STRAND } from "../../mods/creaseworks/ui/string.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const THEMES = JSON.parse(readFileSync(join(root, "tools/mock/themes.json"), "utf8"));
const SPRITE = readFileSync(join(root, "mods/creaseworks/art/ui/garland-strand.svg"), "utf8");

installMockWindow();

const styleVal = (node, name) => (node.styles || []).find((s) => s[0] === name)?.[1];
const ctxFor = (width) => ({ T: THEMES.graphite, S: pickScene(true), hues: pickHues(true), dark: true, zoom: 1, calm: false, width, handlers: {} });

/** The [top, bottom] y extent of every crane in the shipped sprite, in sprite units. */
function spriteCranes() {
  const d = /\bd="([^"]+)"/.exec(SPRITE)[1];
  return d.split("Z").filter((p) => p.trim()).map((p) => {
    const ys = [...p.matchAll(/-?\d+(?:\.\d+)?\s*[ ,]\s*(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    return [Math.min(...ys), Math.max(...ys)];
  });
}

/**
 * Where each sprite crane is drawn on screen inside a fill box: gpui scales
 * the 12 × 200 viewBox to the box width and centres it vertically.
 * Returns [top, bottom] px from the bottom of the box (the clip is at the top).
 */
function drawnCranes(boxW, boxH) {
  const scale = boxW / STRAND.w;
  const pad = (boxH - STRAND.h * scale) / 2;
  return spriteCranes().map(([y0, y1]) => [boxH - (pad + y0 * scale), boxH - (pad + y1 * scale)]);
}

/** The strand fills and their sprites as rendered. */
function strandsOf(vm, width) {
  const json = renderString({ string: vm }, { tab: "string" }, ctxFor(width)).toJSON();
  const out = [];
  for (let i = 0; i < STRAND.count; i++) {
    const fill = findById(json, `cw-string-strand-${i}`);
    let sprite = null;
    walk(fill, (n) => { if (n.kind === "svg") sprite = n; });
    out.push({ h: styleVal(fill, "h"), w: styleVal(fill, "w"), sprite });
  }
  return out;
}

/** No crane may straddle the clip edge: every one is wholly below it or wholly above it. */
function assertNoCutCrane(strand, label) {
  const { h, sprite } = strand;
  const cranes = drawnCranes(styleVal(sprite, "w"), styleVal(sprite, "h"));
  for (const [top, bottom] of cranes) {
    const lo = Math.min(top, bottom);
    const hi = Math.max(top, bottom);
    assert.ok(hi <= h + 1e-6 || lo >= h - 1e-6, `${label}: clip at ${h} px cuts a crane drawn ${lo.toFixed(2)}..${hi.toFixed(2)} px`);
  }
  // The shown cranes are whole and counted: the clip sits on the row grid.
  const shown = cranes.filter(([a, b]) => Math.max(a, b) <= h + 1e-6).length;
  return shown;
}

test("r3-20: the sprite has 50 crane rows, each inside its own 4-unit row with a gap at the row edge", () => {
  const cranes = spriteCranes();
  assert.equal(cranes.length, STRAND.rows);
  assert.match(SPRITE, new RegExp(`viewBox="0 0 ${STRAND.w} ${STRAND.h}"`));
  const pitch = STRAND.h / STRAND.rows;
  cranes.forEach(([y0, y1], i) => {
    assert.ok(y0 > i * pitch && y1 < (i + 1) * pitch, `crane ${i}: ${y0}..${y1}`);
  });
});

test("r3-20: a 304 px card draws the strands at the full 12 × 200 and a crane row is 4 px", () => {
  assert.deepEqual(strandSize(304), { w: 12, h: 200, pitch: 4 });
  // Narrower cards shrink the strand at the sprite's own aspect (no letterbox).
  for (let cw = 200; cw <= 304; cw++) {
    const s = strandSize(cw);
    assert.ok(Number.isInteger(s.w) && s.w >= STRAND.minW && s.w <= STRAND.w, `${cw}: ${s.w}`);
    assert.ok(Math.abs(s.h / s.w - STRAND.h / STRAND.w) < 1e-9, `${cw}: aspect`);
    assert.ok(STRAND.count * s.w + (STRAND.count - 1) * STRAND.gap <= cw, `${cw}: fits`);
    assert.ok(Math.abs(s.pitch * STRAND.rows - s.h) < 1e-9);
  }
});

test("r3-20: strandFill shows whole crane rows only, rounding down; empty and full are exact", () => {
  const size = strandSize(304);
  assert.equal(strandFill(0, size), 0);
  assert.equal(strandFill(1, size), 200);
  assert.equal(strandFill(0.84, size), 168, "42 / 50 cranes");
  assert.equal(strandFill(28 / 60, size), 92, "28 / 60 cranes: 23 whole sprite rows, not 93.3 px");
  assert.equal(strandFill(0.999, size), 196, "one crane short of full is not full");
  assert.equal(strandFill(-1, size), 0);
  assert.equal(strandFill(Number.NaN, size), 0);
  const small = strandSize(240);
  assert.equal(strandFill(1, small), small.h);
  assert.ok(Math.abs(strandFill(0.5, small) - 25 * small.pitch) < 1e-3);
});

test("r3-20: no fill clips a crane mid-sprite, for any count of 1,000 or 1,200, at any card width", () => {
  const widths = [216, 240, 256, 280, 300, 320];
  const cases = [
    [892, 1000], [742, 1000], [999, 1000], [1, 1000], [1000, 1000],
    [88, 1200], [1199, 1200], [601, 1200], [7, 1300],
  ];
  for (const width of widths) {
    for (const [cranes, of] of cases) {
      const vm = { cranes, of, strands: strandShares({ cranes, of }), perks: [], garlands: [] };
      const strands = strandsOf(vm, width);
      const per = of / STRAND.count;
      strands.forEach((st, i) => {
        assert.equal(styleVal(st.sprite, "w"), st.w, "the sprite is the strand's width");
        const label = `${cranes}/${of} at ${width} px, strand ${i}`;
        const shown = assertNoCutCrane(st, label);
        const inStrand = Math.max(0, Math.min(per, cranes - i * per));
        assert.equal(shown, Math.floor((inStrand / per) * STRAND.rows + 1e-6), `${label}: whole rows shown`);
      });
    }
  }
});

test("r3-20: the shot fixtures (string-locked 892 / 1,000 and the garlands fixture) show only whole cranes", () => {
  for (const name of ["string-locked", "string-ready", "garlands", "first-run"]) {
    const s = F.scenario(name);
    const strands = strandsOf(s.vm.string, s.width);
    strands.forEach((st, i) => assertNoCutCrane(st, `${name} strand ${i}`));
  }
  // The garlands shot as reported: 88 of 1,200, strand 2 half full.
  const strands = strandsOf({ cranes: 88, of: 1200, perks: [], garlands: [] }, 320);
  assert.equal(strands[0].h, 200);
  assert.equal(strands[1].h, 92);
  assert.equal(strands[2].h, 0);
});

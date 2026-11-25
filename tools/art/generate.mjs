// Creaseworks art generator (DESIGN §13.1, §13.3).
//
//   node tools/art/generate.mjs [--out <dir>] [--check]
//
// Every SVG under mods/creaseworks/art/ is written from the coordinate tables
// below; nothing is hand-edited. Output is deterministic (same bytes on every
// run). `--check` writes nothing and exits 1 if a file on disk differs.
//
// Shapes are modelled first, then serialised, so tests can inspect geometry:
//   P(level, "x,y x,y ...")        polygon
//   C(level, cx, cy, r)            circle
//   R(level, x, y, w, h)           rect
//   H(level, part, part, ...)      one even-odd <path> of polygons/circles (holes)
//   D(level, d)                    hand-written <path> (arcs), no geometry model
// `level` is the facet: 1 → opacity 1, 2 → 0.78, 3 → 0.56. Faceted sprites
// that get the split fallback (-a/-b/-c) must not overlap across levels, so
// both renderings (alpha and split) show the same picture; the tests check it.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ART_DIR = resolve(HERE, "../../mods/creaseworks/art");

export const OPACITY = { 1: 1, 2: 0.78, 3: 0.56 };
export const NOTIFY_COLOURS = ["#2f6a55", "#fbf7ee"];

// ---------------------------------------------------------------------------
// Shape model

const snap = (v) => Math.round(v * 2) / 2;
const pts = (s) =>
  s.trim().split(/\s+/).map((pair) => {
    const [x, y] = pair.split(",").map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`bad point "${pair}"`);
    return [x, y];
  });

const P = (f, p) => ({ k: "poly", f, p: typeof p === "string" ? pts(p) : p });
const C = (f, cx, cy, r) => ({ k: "circle", f, cx, cy, r });
const R = (f, x, y, w, h) => ({ k: "rect", f, x, y, w, h });
const H = (f, ...parts) => ({ k: "compound", f, parts });
const D = (f, d) => ({ k: "raw", f, d });

/** Mirror a point list about the vertical line x = `axis`. */
const mirror = (p, axis) => pts(p).map(([x, y]) => [2 * axis - x, y]);

/** Transform shapes: scale `s`, then translate (dx, dy); snapped to half units. */
function xf(shapes, { s = 1, dx = 0, dy = 0, level } = {}) {
  const t = ([x, y]) => [snap(x * s + dx), snap(y * s + dy)];
  const one = (sh) => {
    const f = level ?? sh.f;
    switch (sh.k) {
      case "poly": return { ...sh, f, p: sh.p.map(t) };
      case "circle": { const [cx, cy] = t([sh.cx, sh.cy]); return { ...sh, f, cx, cy, r: snap(sh.r * s) }; }
      case "rect": { const [x, y] = t([sh.x, sh.y]); return { ...sh, f, x, y, w: snap(sh.w * s), h: snap(sh.h * s) }; }
      case "compound": return { ...sh, f, parts: sh.parts.map(one) };
      default: throw new Error(`cannot transform ${sh.k}`);
    }
  };
  return shapes.map(one);
}

/** A regular-ish gear outline (polygon points) around (cx, cy). */
function gearPoints(cx, cy, teeth, outer, root, phase = 0, tip = 0.5) {
  const out = [];
  const step = (2 * Math.PI) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = phase + i * step;
    const half = (step * tip) / 2;
    const rootHalf = (step * (tip + 0.18)) / 2;
    for (const [ang, r] of [[a - rootHalf, root], [a - half, outer], [a + half, outer], [a + rootHalf, root]]) {
      out.push([snap(cx + r * Math.sin(ang)), snap(cy - r * Math.cos(ang))]);
    }
  }
  return dedupe(out);
}

function dedupe(p) {
  const out = [];
  for (const q of p) {
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

/** Outward offset of a convex-or-mildly-concave polygon (miter, bevelled at sharp tips). */
function grow(p, d) {
  // orientation: positive area = clockwise in y-down screen space
  let area = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    area += x1 * y2 - x2 * y1;
  }
  const sign = area > 0 ? 1 : -1;
  const n = p.length;
  const normal = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return [(sign * dy) / len, (-sign * dx) / len];
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = p[(i - 1 + n) % n], cur = p[i], next = p[(i + 1) % n];
    const n1 = normal(prev, cur), n2 = normal(cur, next);
    const bis = [n1[0] + n2[0], n1[1] + n2[1]];
    const blen = Math.hypot(bis[0], bis[1]);
    const cos = (n1[0] * n2[0] + n1[1] * n2[1]);
    const miter = blen > 1e-9 ? d / Math.sqrt((1 + cos) / 2) : Infinity;
    if (miter <= d * 1.9) {
      out.push([cur[0] + (bis[0] / blen) * miter, cur[1] + (bis[1] / blen) * miter]);
    } else {
      // sharp tip: a square cap reaching d past the vertex along both edges
      const dir = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
      const t1 = dir(prev, cur), t2 = dir(cur, next);
      out.push([cur[0] + (n1[0] + t1[0]) * d, cur[1] + (n1[1] + t1[1]) * d], [cur[0] + (n2[0] - t2[0]) * d, cur[1] + (n2[1] - t2[1]) * d]);
    }
  }
  return dedupe(out.map(([x, y]) => [snap(x), snap(y)]));
}

/** Log-spiral shell split into three whorl facets (snail). */
function spiralShell(cx, cy, R0, phase, turnRatio = 0.5, steps = 10) {
  const at = (theta) => {
    const r = R0 * Math.pow(turnRatio, theta / (2 * Math.PI));
    const a = phase + theta;
    return [snap(cx + r * Math.cos(a)), snap(cy + r * Math.sin(a))];
  };
  const arm = (from) => Array.from({ length: steps + 1 }, (_, j) => at(from + (j * 2 * Math.PI) / steps));
  const a0 = arm(0), a1 = arm(2 * Math.PI), a2 = arm(4 * Math.PI);
  return [
    P(1, dedupe([...a0, ...a1.slice().reverse()])),
    P(2, dedupe([...a1, ...a2.slice().reverse()])),
    P(3, dedupe([...a2, [snap(cx), snap(cy)]])),
  ];
}

/** Whether (x, y) is inside a modelled shape (even-odd for compounds). */
export function insideShape(sh, x, y) {
  switch (sh.k) {
    case "poly": {
      let inside = false;
      const p = sh.p;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, yi] = p[i], [xj, yj] = p[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
    case "circle": return (x - sh.cx) ** 2 + (y - sh.cy) ** 2 < sh.r ** 2;
    case "rect": return x > sh.x && x < sh.x + sh.w && y > sh.y && y < sh.y + sh.h;
    case "compound": return sh.parts.reduce((acc, part) => acc !== insideShape(part, x, y), false);
    default: throw new Error(`no geometry for ${sh.k}`);
  }
}

// ---------------------------------------------------------------------------
// Serialisation

const num = (v) => {
  const r = Math.round(v * 2) / 2;
  if (Math.abs(r - v) > 1e-9) throw new Error(`coordinate ${v} is not on the half-unit grid`);
  return Object.is(r, -0) ? "0" : String(r);
};
const ptsStr = (p) => p.map(([x, y]) => `${num(x)},${num(y)}`).join(" ");
const circlePath = ({ cx, cy, r }) =>
  `M${num(cx - r)} ${num(cy)}A${num(r)} ${num(r)} 0 1 0 ${num(cx + r)} ${num(cy)}A${num(r)} ${num(r)} 0 1 0 ${num(cx - r)} ${num(cy)}Z`;
const polyPath = (p) => "M" + p.map(([x, y]) => `${num(x)} ${num(y)}`).join("L") + "Z";
const partPath = (part) => {
  if (part.k === "poly") return polyPath(part.p);
  if (part.k === "circle") return circlePath(part);
  if (part.k === "rect") return polyPath([[part.x, part.y], [part.x + part.w, part.y], [part.x + part.w, part.y + part.h], [part.x, part.y + part.h]]);
  throw new Error(`compound part ${part.k}`);
};

function paint(f, fill) {
  const o = OPACITY[f];
  if (o === undefined) throw new Error(`bad facet level ${f}`);
  return `fill="${fill}"${o === 1 ? "" : ` fill-opacity="${o}"`}`;
}

function element(sh, { fill = "#000", flat = false } = {}) {
  const pa = paint(flat ? 1 : sh.f, sh.fill ?? fill);
  switch (sh.k) {
    case "poly": return `<polygon points="${ptsStr(sh.p)}" ${pa}/>`;
    case "circle": return `<circle cx="${num(sh.cx)}" cy="${num(sh.cy)}" r="${num(sh.r)}" ${pa}/>`;
    case "rect": return `<rect x="${num(sh.x)}" y="${num(sh.y)}" width="${num(sh.w)}" height="${num(sh.h)}" ${pa}/>`;
    case "compound": return `<path d="${sh.parts.map(partPath).join("")}" fill-rule="evenodd" ${pa}/>`;
    case "raw": return `<path d="${sh.d}" ${pa}/>`;
    default: throw new Error(`unknown shape ${sh.k}`);
  }
}

export function svgText(w, h, shapes, opts = {}) {
  const ordered = [...shapes].sort((a, b) => a.f - b.f);
  const body = (opts.keepOrder ? shapes : ordered).map((s) => element(s, opts)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>\n`;
}

// ---------------------------------------------------------------------------
// Folk: 12 species on a 32 grid, 2-unit margin. Facing left where it matters.

const FOLK = {
  crane: [
    // body kite L(9,21.5) T(16,18) R(23,21.5) B(16,26)
    P(2, "9,21.5 16,18 23,21.5"),
    P(1, "9,21.5 23,21.5 16,26"),
    // neck + bent head (base on L–T), tail (base on T–R), both low and long
    P(1, "12,20 4,14 2,17.5 4.5,16.5 9,21.5"),
    P(2, "20,20 30,14 23,21.5"),
    // near wing and far wing, two facets each: a wide V
    P(1, "12,20 3,4 16,18"),
    P(3, "3,4 10.5,5.5 16,18"),
    P(3, "16,18 21.5,5.5 29,4"),
    P(2, "16,18 29,4 20,20"),
  ],
  frog: [
    P(1, "4,17 9,11 23,11 28,17"),
    C(1, 10, 9.5, 3.5),
    C(1, 22, 9.5, 3.5),
    P(2, "4,17 16,17 16,23 8,23"),
    P(3, "16,17 28,17 24,23 16,23"),
    // back legs folded out at the sides, front feet under
    P(1, "4,17 8,23 2,26"),
    P(1, "28,17 24,23 30,26"),
    P(1, "10,23 14,23 9,27.5"),
    P(1, "18,23 22,23 23,27.5"),
  ],
  fox: [
    // A(3,3) B(29,3) C(12,10.5) D(20,10.5) E(6,16) F(26,16) G(16,29) M(16,16)
    P(3, "3,3 12,10.5 8,10.5"),
    P(1, "3,3 8,10.5 12,10.5 16,16 6,16"),
    P(1, "12,10.5 20,10.5 16,16"),
    P(3, "29,3 24,10.5 20,10.5"),
    P(2, "29,3 26,16 16,16 20,10.5 24,10.5"),
    P(2, "6,16 16,16 16,29"),
    P(3, "16,16 26,16 16,29"),
  ],
  koi: [
    P(3, "2,15.5 8,10.5 8,15.5 8,21"),
    P(1, "8,10.5 16,8.5 24,13.5 24,15.5 8,15.5"),
    P(2, "8,15.5 24,15.5 24,18 16,23 8,21"),
    P(2, "12,9.5 17,4 20,11 16,8.5"),
    P(1, "12,22 13,27 16,23"),
    P(3, "24,13.5 30,7.5 27,15.5 30,24 24,18"),
  ],
  rabbit: [
    // ears (long, swept back), head, haunch, paw
    P(1, "8.5,13 11.5,2 14,2.5 12.5,13"),
    P(3, "12.5,13 18.5,3.5 21,4.5 15.5,15.5"),
    P(1, "3,19 6.5,14 8.5,13 12.5,13 15.5,15.5 13,21 7.5,21.5"),
    P(2, "15.5,15.5 18,16 24,16 29,21 29.5,27.5 13,27.5 12,22 13,21"),
    P(3, "7.5,21.5 13,21 12,22 13,27.5 7.5,27.5"),
  ],
  turtle: [
    // shell: inner hex + ring of six plates
    P(1, "14,12 20,12 22,16 20,20 14,20 12,16"),
    P(2, "12,8 22,8 20,12 14,12"),
    P(3, "22,8 26,16 22,16 20,12"),
    P(2, "26,16 22,24 20,20 22,16"),
    P(3, "22,24 12,24 14,20 20,20"),
    P(2, "12,24 8,16 12,16 14,20"),
    P(3, "8,16 12,8 14,12 12,16"),
    // head, flippers, tail
    P(1, "9,14 5,12.5 2,14.5 2,17.5 5,19.5 9,18 8,16"),
    P(1, "10,12 12,8 14.5,8 9.5,3.5 5.5,5 7,9.5"),
    P(1, "10,20 12,24 14.5,24 9.5,28.5 5.5,27 7,22.5"),
    P(1, "19.5,8 24.5,4.5 26.5,6.5 23,10 22,8"),
    P(1, "19.5,24 24.5,27.5 26.5,25.5 23,22 22,24"),
    P(1, "25,14 29.5,16 25,18 26,16"),
  ],
  butterfly: [
    P(1, "15,8.5 17,8.5 17.5,25 16,27.5 14.5,25"),
    // upper wings (two facets each), lower wings
    P(1, "4,3.5 2,9 4,15.5 14.5,15.5"),
    P(2, "14.5,11 4,3.5 14.5,15.5"),
    P(1, "28,3.5 30,9 28,15.5 17.5,15.5"),
    P(2, "17.5,11 28,3.5 17.5,15.5"),
    P(3, "14.5,17 4.5,18.5 5.5,25.5 10,27.5 14.5,22"),
    P(3, "17.5,17 27.5,18.5 26.5,25.5 22,27.5 17.5,22"),
    // antennae
    P(1, "15,8.5 11,3 12,2.5 16,8"),
    P(1, "17,8.5 21,3 20,2.5 16,8"),
  ],
  whale: [
    P(1, "2,18 4,12.5 9,9 15,8 21,9.5 24.5,13 26,18"),
    P(2, "2,18 26,18 24,22 18,25 10,25 4.5,22.5"),
    P(3, "24.5,13 26.5,10 22,4.5 27.5,6.5 30,2.5 30,9.5 27.5,13 26,18"),
  ],
  owl: [
    H(1, P(1, "5,3 12,8.5 20,8.5 27,3 26,14 16,17 6,14"), C(1, 11.5, 11.5, 2.5), C(1, 20.5, 11.5, 2.5)),
    P(2, "6,14 11,15.5 16,29 7,22"),
    P(3, "11,15.5 16,17 21,15.5 16,29"),
    P(2, "26,14 21,15.5 16,29 25,22"),
  ],
  boat: [
    P(1, "2,17 30,17 24.5,25.5 7.5,25.5"),
    P(2, "8,17 16,4.5 16,17"),
    P(3, "16,4.5 24,17 16,17"),
    P(3, "2,17 4.5,13.5 8,17"),
    P(2, "30,17 27.5,13.5 24,17"),
  ],
  mouse: [
    // front face: two big round ears over a folded head with a pointed nose
    C(1, 8, 8.5, 5.5),
    C(1, 24, 8.5, 5.5),
    P(1, "9,14.5 16,12 23,14.5 16,18"),
    P(2, "9,14.5 16,18 16,28.5 6.5,20.5"),
    P(3, "23,14.5 25.5,20.5 16,28.5 16,18"),
  ],
  snail: [
    ...spiralShell(19, 14, 10.5, Math.PI * 0.62, 0.5, 10),
    P(2, "2,27.5 3,23 5.5,20.5 9,20.5 11,24 28,24 30,27.5"),
    P(2, "4.5,21 2,13 3.5,12.5 6.5,20.5"),
    P(2, "7.5,20.5 8,12.5 9.5,12.5 9,20.5"),
  ],
};

// ---------------------------------------------------------------------------
// Sheet: the 8-frame fold sequence on a 64 grid. Each frame is a base
// silhouette (tinted S.sheet) and a shade layer drawn over it (S.sheetShade).

const craneX2 = xf(FOLK.crane, { s: 2 });
const SHEET = [
  { // 0 square, with the first diagonal crease
    base: [P(1, "6,6 58,6 58,58 6,58")],
    shade: [P(1, "6,6 7.5,6 58,56.5 58,58 56.5,58 6,7.5")],
  },
  { // 1 triangle (folded on the diagonal)
    base: [P(1, "3,18 61,18 32,47")],
    shade: [P(1, "32,18 61,18 32,47")],
  },
  { // 2 kite (edges folded to the centre line)
    base: [P(1, "32,4 47,26 32,60 17,26")],
    shade: [P(1, "17,26 32,31 32,60"), P(1, "47,26 32,60 33,31")],
  },
  { // 3 square base
    base: [P(1, "32,8 54,30 32,52 10,30")],
    shade: [P(1, "32,8 54,30 32,52 32,30")],
  },
  { // 4 bird base (long diamond, petal flap folded up)
    base: [P(1, "32,2 46,26 32,62 18,26")],
    shade: [P(1, "32,2 46,26 32,36 18,26")],
  },
  { // 5 narrowed: the lower legs thinned, split by a slit
    base: [P(1, "32,2 42,26 34.5,62 32,40 29.5,62 22,26")],
    shade: [P(1, "32,2 42,26 32,33 22,26")],
  },
  { // 6 neck and tail reversed up, wings still closed
    base: [
      P(1, "22,42 32,36 42,42 32,50"),
      P(1, "22,42 4,10 8,10 27,39"),
      P(1, "42,42 60,10 56,10 37,39"),
      P(1, "27,39 32,4 37,39 32,36"),
    ],
    shade: [P(1, "32,4 37,39 32,36"), P(1, "22,42 32,36 42,42")],
  },
  { // 7 crane (wings opened into the V)
    base: xf(craneX2, { level: 1 }),
    shade: xf(craneX2.filter((s) => s.f !== 1), { level: 1 }),
  },
];

// ---------------------------------------------------------------------------
// Status glyphs (16 grid; drawn 11 and 12 px). One level each: shape carries it.

const STATUS = {
  "working-arc": [D(1, "M8 1A7 7 0 1 1 1 8L3.5 8A4.5 4.5 0 1 0 8 3.5Z")],
  needs: [
    R(1, 0.5, 0.5, 2, 15),
    H(1, P(1, "2.5,0.5 15.5,7 2.5,13.5"), R(1, 4.5, 3, 3, 4.5), R(1, 4.5, 8.5, 3, 2.5)),
  ],
  "done-check": [H(1, C(1, 8, 8, 7.5), P(1, "3.5,8.5 5.5,6.5 7,8 10.5,4.5 12.5,6.5 7,12"))],
  rest: [D(1, "M10 0.5A7.5 7.5 0 1 0 15.5 10A6 6 0 0 1 10 0.5Z")],
  envelope: [
    P(1, "0.5,2.5 15.5,2.5 8,8.5"),
    P(1, "0.5,4.5 8,10.5 15.5,4.5 15.5,13.5 0.5,13.5"),
  ],
  "pip-work": [P(1, "8,0.5 15.5,8 8,15.5 0.5,8")],
  "pip-rest": [H(1, P(1, "8,0.5 15.5,8 8,15.5 0.5,8"), P(1, "8,4 12,8 8,12 4,8"))],
  "pip-needs": [P(1, "8,1 15.5,14.5 0.5,14.5")],
};

// ---------------------------------------------------------------------------
// Scene sprites

const goldCrane = xf(FOLK.crane, { s: 1, dx: 4, dy: -0.5 }); // 40×28 box; outline grows 1.5
const SCENE = {
  "envelope-body": { w: 28, h: 20, shapes: [P(1, "1,2 27,2 27,18.5 1,18.5")] },
  "envelope-flap": { w: 28, h: 20, shapes: [P(1, "1,2 27,2 14,12")] },
  "seal-bundle": {
    w: 12, h: 12,
    shapes: [P(1, "3,1 11.5,1 9.5,3.5 1,3.5"), P(1, "3,4.5 11.5,4.5 9.5,7 1,7"), P(1, "3,8 11.5,8 9.5,10.5 1,10.5")],
  },
  "seal-rush": {
    w: 12, h: 12,
    shapes: [P(1, "0.5,1.5 3,1.5 7,6 3,10.5 0.5,10.5 4.5,6"), P(1, "5,1.5 7.5,1.5 11.5,6 7.5,10.5 5,10.5 9,6")],
  },
  "seal-storm": { w: 12, h: 12, shapes: [P(1, "7,0.5 10.5,0.5 8,4.5 11,4.5 4,11.5 5.5,6.5 2,6.5")] },
  "seal-chorus": { w: 12, h: 12, shapes: [C(1, 6, 3, 2), C(1, 2.5, 9, 2), C(1, 9.5, 9, 2)] },
  scrap: {
    w: 16, h: 16,
    shapes: [
      P(1, "2.5,4.5 11,2 13,7.5 11.5,8.5 13.5,10 11.5,11.5 12.5,13.5 3.5,13.5"),
      P(2, "2.5,4.5 6,3.5 3,8"),
    ],
  },
  ream: {
    w: 28, h: 20,
    shapes: [
      P(1, "1,7 11,7 11,19 1,19"),
      P(1, "15,7 24,7 24,19 15,19"),
      P(3, "11,7 15,7 15,19 11,19"),
      P(3, "1,7 4,3 14,3 11,7"),
      P(1, "11,7 14,3 18,3 15,7"),
      P(3, "15,7 18,3 27,3 24,7"),
      P(2, "24,7 27,3 27,15 24,19"),
    ],
  },
  "crane-gilded-outline": { w: 40, h: 28, shapes: goldCrane.filter((s) => s.k === "poly").map((s) => P(1, grow(s.p, 1.5))) },
  "crane-gilded-body": { w: 40, h: 28, shapes: xf(goldCrane, { level: 1 }) },
  "crane-gilded-shade": { w: 40, h: 28, shapes: xf(goldCrane.filter((s) => s.f !== 1), { level: 1 }) },
  "boat-hull": {
    w: 40, h: 28,
    shapes: [P(1, "2,16 38,16 31,25.5 9,25.5"), P(1, "2,16 5,12 9.5,16"), P(1, "38,16 35,12 30.5,16")],
  },
  "boat-sail": { w: 40, h: 28, shapes: [P(1, "10,16 20,2 30,16")] },
};

// ---------------------------------------------------------------------------
// Workshops (24 grid; drawn 28)

const WORKSHOPS = {
  stack: [
    P(1, "12,2.5 22,7 12,11.5 2,7"),
    P(2, "2,8.5 12,13 22,8.5 22,11 12,15.5 2,11"),
    P(3, "2,12.5 12,17 22,12.5 22,15 12,19.5 2,15"),
  ],
  bonefolder: [
    P(1, "2,22 4,17.5 17.5,4 20,3 21,4"),
    P(3, "2,22 21,4 20,6.5 6.5,20"),
  ],
  scissors: [
    H(1, C(1, 8, 5, 3.5), C(1, 8, 5, 1.5)),
    H(1, C(1, 16, 5, 3.5), C(1, 16, 5, 1.5)),
    P(1, "8.5,8 10.5,7.5 13.5,14 11,14"),
    P(1, "15.5,8 13.5,7.5 10.5,14 13,14"),
    P(2, "5,14 19,14 17.5,22.5 6.5,22.5"),
  ],
  gluepot: [
    P(3, "3.5,10 20.5,10 20.5,12.5 3.5,12.5"),
    P(1, "5,12.5 19,12.5 17.5,22 6.5,22"),
    P(2, "12.5,10 19.5,1.5 21.5,3 15,10"),
  ],
  bench: [
    P(1, "1.5,6.5 22.5,6.5 22.5,10 1.5,10"),
    P(2, "3,21.5 5,10 7,10 5,21.5"),
    P(2, "10,21.5 6.5,10 8.5,10 12,21.5"),
    P(2, "21,21.5 19,10 17,10 19,21.5"),
    P(2, "14,21.5 17.5,10 15.5,10 12,21.5"),
  ],
  vat: [
    H(1, P(1, "5,2 19,2 19,9.5 5,9.5"), P(1, "7,4 17,4 17,7.5 7,7.5")),
    P(3, "7,4 17,4 17,7.5 7,7.5"),
    P(3, "2,11.5 22,11.5 22,13.5 2,13.5"),
    P(1, "3,13.5 21,13.5 19,22 5,22"),
  ],
  press: [
    P(2, "5,1 19,1 19,3.5 5,3.5"),
    P(2, "11,3.5 13,3.5 13,8.5 11,8.5"),
    P(1, "2,8.5 22,8.5 22,12 2,12"),
    P(3, "5,13 19,13 19,17 5,17"),
    P(1, "2,18 22,18 22,21.5 2,21.5"),
    P(1, "2,12 4,12 4,18 2,18"),
    P(1, "20,12 22,12 22,18 20,18"),
  ],
  loft: [
    P(1, "12,1.5 23,10 23,13 12,4.5 1,13 1,10"),
    P(1, "1,20.5 23,20.5 23,22.5 1,22.5"),
    P(3, "11.5,4.5 12.5,4.5 12.5,18 11.5,18"),
    P(2, "8,10 12,12 16,10 16,11.5 12,14 8,11.5"),
    P(2, "8.5,15.5 12,17.5 15.5,15.5 15.5,17 12,19.5 8.5,17"),
  ],
  kite: [
    P(1, "3,23 9,23 8.5,19 3.5,19"),
    P(2, "3.5,18 8.5,18 8,14 4,14"),
    P(1, "4,13 8,13 7.5,9 4.5,9"),
    P(2, "4.5,8 7.5,8 6,5"),
    P(1, "17.5,1 22.5,6.5 17.5,6.5"),
    P(2, "17.5,1 17.5,6.5 12.5,6.5"),
    P(2, "22.5,6.5 17.5,14 17.5,6.5"),
    P(3, "12.5,6.5 17.5,6.5 17.5,14"),
    P(3, "6.5,5 17,13.5 16.5,14.5 6,6"),
  ],
};

// ---------------------------------------------------------------------------
// UI glyphs (16 grid; drawn 11–24)

const crane16 = (x, y) => P(1, [[x - 4, y - 2], [x, y], [x + 4, y - 2], [x + 4, y + 0.5], [x, y + 3], [x - 4, y + 0.5]]);
const UI = {
  fold: [P(1, "1.5,1.5 10,1.5 10,6 14.5,6 14.5,14.5 1.5,14.5"), P(3, "10,1.5 14.5,6 10,6")],
  wish: [P(1, "8,0.5 9.5,6.5 15.5,8 9.5,9.5 8,15.5 6.5,9.5 0.5,8 6.5,6.5")],
  gear: [H(1, P(1, gearPoints(8, 8, 8, 7.5, 5.5, 0, 0.45)), C(1, 8, 8, 2.5))],
  flock: [crane16(8, 3), crane16(4, 11), crane16(12, 11)],
  shop: [
    P(1, "2,1.5 6,1.5 5.5,6 0.5,6"),
    P(3, "6,1.5 10,1.5 10.5,6 5.5,6"),
    P(1, "10,1.5 14,1.5 15.5,6 10.5,6"),
    H(1, P(1, "2,7 14,7 14,15 2,15"), P(1, "6.5,9.5 9.5,9.5 9.5,15 6.5,15")),
  ],
  string: [R(1, 7.5, 0, 1, 16), crane16(8, 2.5), crane16(8, 7.5), crane16(8, 12.5)],
  back: [P(1, "1,8 7,2 7,6 15,6 15,10 7,10 7,14")],
  chevron: [P(1, "4.5,2 7.5,2 13.5,8 7.5,14 4.5,14 10.5,8")],
  close: [P(1, "3,1.5 8,6.5 13,1.5 14.5,3 9.5,8 14.5,13 13,14.5 8,9.5 3,14.5 1.5,13 6.5,8 1.5,3")],
  info: [H(1, C(1, 8, 8, 7.5), R(1, 7, 3.5, 2, 2), R(1, 7, 6.5, 2, 6))],
  warn: [H(1, P(1, "8,0.5 15.5,15 0.5,15"), R(1, 7, 5, 2, 5), R(1, 7, 11, 2, 2))],
  check: [P(1, "1,8.5 3.5,6 6.5,9 12.5,3 15,5.5 6.5,14")],
  dots: [C(1, 2.5, 8, 2), C(1, 8, 8, 2), C(1, 13.5, 8, 2)],
  arrows: [
    P(1, "1,3 10.5,3 10.5,0.5 15,4 10.5,7.5 10.5,5 1,5"),
    P(1, "15,11 5.5,11 5.5,8.5 1,12 5.5,15.5 5.5,13 15,13"),
  ],
  lock: [
    D(1, "M4 7.5L4 5A4 4 0 0 1 12 5L12 7.5L10 7.5L10 5A2 2 0 0 0 6 5L6 7.5Z"),
    H(1, P(1, "2,7.5 14,7.5 14,15.5 2,15.5"), C(1, 8, 10.5, 1.5), P(1, "7.5,11 8.5,11 9,13.5 7,13.5")),
  ],
  clock: [H(1, C(1, 8, 8, 7.5), P(1, "7,3 9,3 9,7 12.5,7 12.5,9 7,9"))],
  hand: [
    P(1, "3.5,8 12.5,8 12.5,12 10.5,15.5 5.5,15.5 3.5,12"),
    P(1, "3.5,3.5 5.5,3.5 5.5,8.5 3.5,8.5"),
    P(1, "6,1.5 8,1.5 8,8.5 6,8.5"),
    P(1, "8.5,2 10.5,2 10.5,8.5 8.5,8.5"),
    P(1, "11,4 12.5,4 12.5,8.5 11,8.5"),
    P(1, "3.5,12 0.5,7.5 2,6.5 4.5,9"),
  ],
  paw: [C(1, 8, 11.5, 3.5), C(1, 2.5, 7, 1.5), C(1, 6, 3.5, 1.5), C(1, 10, 3.5, 1.5), C(1, 13.5, 7, 1.5)],
  ribbon: [
    H(1, C(1, 8, 6, 5.5), C(1, 8, 6, 2)),
    P(1, "4.5,10 2.5,15.5 4.5,14.5 6,15.5 7.5,11.5"),
    P(1, "11.5,10 13.5,15.5 11.5,14.5 10,15.5 8.5,11.5"),
  ],
  curio: [
    P(3, "4.5,1.5 8,1.5 8,5.5 0.5,5.5"),
    P(2, "8,1.5 11.5,1.5 15.5,5.5 8,5.5"),
    P(1, "0.5,6 8,6 8,15"),
    P(2, "8,6 15.5,6 8,15"),
  ],
  cog: [
    H(1, P(1, gearPoints(6, 10, 6, 5.5, 4, 0, 0.5)), C(1, 6, 10, 1.5)),
    H(1, P(1, gearPoints(12.5, 3.5, 5, 3.5, 2.5, Math.PI / 5, 0.5)), C(1, 12.5, 3.5, 1)),
  ],
  step: [C(1, 5, 12.5, 3), P(1, "6.5,1.5 8,1.5 8,12.5 6.5,12.5"), P(1, "8,1.5 13,4.5 13,7.5 8,5")],
  cloud: [C(1, 4.5, 10.5, 3.5), C(1, 8.5, 7.5, 4.5), C(1, 12, 10.5, 3.5), R(1, 4.5, 9.5, 7.5, 4.5)],
};

// garland strand: 50 crane silhouettes, 4 units each, in one path
function garlandStrand() {
  const parts = [];
  for (let i = 0; i < 50; i++) {
    const y = i * 4;
    parts.push(P(1, [[0.5, y + 0.5], [5, y + 2], [6, y + 1], [7, y + 2], [11.5, y + 0.5], [7.5, y + 3], [6, y + 3.5], [4.5, y + 3]]));
  }
  return [{ k: "compound", f: 1, parts, nonzero: true }];
}

// ---------------------------------------------------------------------------
// Manifest

/**
 * Every generated file: { path, w, h, group, shapes, split?, svg }. `group` is
 * one of folk, folk-split, sheet, status, scene, workshops, ui, garland,
 * notify, logo.
 */
export function buildAssets() {
  const out = [];
  const add = (path, w, h, group, shapes, opts = {}) => out.push({ path, w, h, group, shapes, svg: svgText(w, h, shapes, opts), ...opts.meta });

  for (const [name, shapes] of Object.entries(FOLK)) {
    add(`folk/${name}.svg`, 32, 32, "folk", shapes, { meta: { faceted: true } });
    for (const [suffix, level] of [["a", 1], ["b", 2], ["c", 3]]) {
      const part = shapes.filter((s) => s.f === level);
      add(`folk/${name}-${suffix}.svg`, 32, 32, "folk-split", part, { flat: true, meta: { of: name, level } });
    }
  }
  SHEET.forEach((frame, i) => {
    add(`sheet/${i}-base.svg`, 64, 64, "sheet", frame.base, { flat: true });
    add(`sheet/${i}-shade.svg`, 64, 64, "sheet", frame.shade, { flat: true });
  });
  for (const [name, shapes] of Object.entries(STATUS)) add(`status/${name}.svg`, 16, 16, "status", shapes);
  for (const [name, { w, h, shapes }] of Object.entries(SCENE)) add(`scene/${name}.svg`, w, h, "scene", shapes);
  for (const [name, shapes] of Object.entries(WORKSHOPS)) add(`workshops/${name}.svg`, 24, 24, "workshops", shapes);
  for (const [name, shapes] of Object.entries(UI)) add(`ui/${name}.svg`, 16, 16, "ui", shapes);
  add("ui/garland-strand.svg", 12, 200, "garland", garlandStrand(), { keepOrder: true });

  const notify = [
    { ...R(1, 0, 0, 36, 36), fill: NOTIFY_COLOURS[0] },
    ...xf(FOLK.crane, { s: 1, dx: 2, dy: 2.5 }).map((s) => ({ ...s, fill: NOTIFY_COLOURS[1], f: s.f === 3 ? 2 : 1 })),
  ];
  add("notify-icon.svg", 36, 36, "notify", notify, { keepOrder: true });
  add("logo.svg", 64, 64, "logo", logoShapes());
  return out;
}

function logoShapes() {
  // A folded square (the Sheet) on point, with the crane rising out of it.
  return [
    P(3, "32,4 32,60 4,32"),
    P(2, "32,4 60,32 32,60"),
    ...xf(FOLK.crane, { s: 1.5, dx: 8, dy: 6, level: 1 }),
  ];
}

// ---------------------------------------------------------------------------
// CLI

function main(argv) {
  const outDir = argv.includes("--out") ? resolve(argv[argv.indexOf("--out") + 1]) : ART_DIR;
  const checkOnly = argv.includes("--check");
  const assets = buildAssets();
  let stale = 0;
  for (const a of assets) {
    const file = join(outDir, a.path);
    const same = existsSync(file) && readFileSync(file, "utf8") === a.svg;
    if (checkOnly) {
      if (!same) { stale++; console.error(`stale: ${a.path}`); }
      continue;
    }
    if (!same) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, a.svg);
    }
  }
  // remove SVGs we no longer generate (never touches non-SVG files)
  const wanted = new Set(assets.map((a) => a.path));
  const walk = (dir, rel = "") => {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(join(dir, ent.name), r);
      else if (ent.name.endsWith(".svg") && !wanted.has(r)) {
        if (checkOnly) { stale++; console.error(`extra: ${r}`); } else rmSync(join(dir, ent.name));
      }
    }
  };
  walk(outDir);
  if (checkOnly) {
    if (stale) process.exit(1);
    console.log(`${assets.length} SVG files up to date`);
  } else console.log(`wrote ${assets.length} SVG files to ${outDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));

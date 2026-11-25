// Art contact sheet (DESIGN §13.1): every SVG under mods/creaseworks/art at
// 12/16/28/40 px on a light and a dark tile, tinted through a CSS mask the
// way tools/render/html.mjs draws gpui's svg(), plus the composites the game
// layers (Sheet frames, gilded crane, envelope + seal, boat), the facet split
// fallback next to the alpha files, and the 16 px silhouette and 12 px
// greyscale status tests.
//
//   node tools/art/sheet.mjs [--art <dir>] [--out tools/out/art-sheet.png] [--zoom <file>]
//
// `--zoom <file>` also writes a 4× nearest-neighbour blow-up of the true-size
// 16 px silhouettes and 12 px status glyphs (for reviewing single pixels).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ART = resolve(HERE, "../../mods/creaseworks/art");
const DEFAULT_OUT = resolve(HERE, "../out/art-sheet.png");

// Scene tokens S and stand-in theme colours (DESIGN §13.2).
const S = {
  light: { mat: "#2f6a55", sheet: "#fbf7ee", sheetShade: "#e6dcc6", ink: "#22302c", gold: "#f0c24b", goldShade: "#c99a2e", goldInk: "#4a3500" },
  dark: { mat: "#1d3a32", sheet: "#d9d1c0", sheetShade: "#bfb39b", ink: "#1d2724", gold: "#e9b93f", goldShade: "#c39a2c", goldInk: "#3d2c00" },
};
const TILE = {
  light: { bg: "#f4f1ea", fg: "#22302c", muted: "#6b6f6a" },
  dark: { bg: "#1f2422", fg: "#e8e4da", muted: "#9aa09a" },
};
const SIZES = [12, 16, 28, 40];

export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const tries = ["playwright", resolve(dirname(process.execPath), "../lib/node_modules/playwright")];
  let first = null;
  for (const id of tries) {
    try {
      return require(id);
    } catch (error) {
      first ??= error;
    }
  }
  throw new Error(`playwright is not installed (${first?.message ?? "not found"})`);
}

/** Every .svg under `dir`, as art-relative paths, sorted. */
export function listSvgs(dir) {
  const out = [];
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith(".svg")) out.push(relative(dir, p).split("\\").join("/"));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function viewSize(text) {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(text);
  return m ? [Number(m[1]), Number(m[2])] : [16, 16];
}

/** HTML for the whole sheet. */
export function sheetHtml(artDir) {
  const files = listSvgs(artDir);
  const src = Object.fromEntries(files.map((f) => [f, readFileSync(join(artDir, f), "utf8")]));
  const uri = (f) => `data:image/svg+xml;base64,${Buffer.from(src[f]).toString("base64")}`;
  const has = (f) => f in src;

  /** A masked div: the svg() equivalent. */
  const sprite = (f, w, h, color, extra = "") => {
    if (!has(f)) return `<div class="missing" style="width:${w}px;height:${h}px"></div>`;
    const m = `url('${uri(f)}') center / 100% 100% no-repeat`;
    return `<div class="sp" style="width:${w}px;height:${h}px;background-color:${color};-webkit-mask:${m};mask:${m};${extra}"></div>`;
  };
  const fit = (f, size) => {
    const [vw, vh] = viewSize(src[f] ?? "");
    const k = size / Math.max(vw, vh);
    return [Math.round(vw * k), Math.round(vh * k)];
  };
  const layered = (layers, w, h) =>
    `<div class="stack" style="width:${w}px;height:${h}px">${layers.map(([f, c, x = 0, y = 0, lw = w, lh = h]) => `<div style="position:absolute;left:${x}px;top:${y}px">${sprite(f, lw, lh, c)}</div>`).join("")}</div>`;

  const cell = (f) => {
    const rows = ["light", "dark"].map((mode) => {
      const t = TILE[mode];
      const items = SIZES.map((s) => { const [w, h] = fit(f, s); return sprite(f, w, h, t.fg); }).join("");
      return `<div class="row" style="background:${t.bg}">${items}</div>`;
    }).join("");
    return `<div class="cell"><div class="name">${esc(f)}</div>${rows}</div>`;
  };

  const groups = [
    ["Folk (alpha facets)", (f) => /^folk\/[a-z]+\.svg$/.test(f)],
    ["Status", (f) => f.startsWith("status/")],
    ["UI", (f) => f.startsWith("ui/") && f !== "ui/garland-strand.svg"],
    ["Workshops", (f) => f.startsWith("workshops/")],
    ["Scene", (f) => f.startsWith("scene/")],
    ["Sheet layers", (f) => f.startsWith("sheet/")],
    ["Logo", (f) => f === "logo.svg"],
  ];
  const sections = groups.map(([title, pick]) => {
    const list = files.filter(pick);
    return `<h2>${esc(title)} (${list.length})</h2><div class="grid">${list.map(cell).join("")}</div>`;
  });

  const folk = files.filter((f) => /^folk\/[a-z]+\.svg$/.test(f)).map((f) => f.slice(5, -4));

  // Silhouette test: a+b+c stacked in one colour = the blob at 16 px.
  const silhouettes = ["#fff", "#000"].map((bg) => {
    const fg = bg === "#fff" ? "#000" : "#fff";
    const items = folk.map((n) => `<div class="sil">${layered(["a", "b", "c"].map((s) => [`folk/${n}-${s}.svg`, fg]), 16, 16)}<span>${n}</span></div>`).join("");
    return `<div class="row big" style="background:${bg};color:${fg}">${items}</div>`;
  }).join("");

  // Split fallback vs alpha, on raised tiles in both themes, at 28 and 40.
  const mix = (c, s, t) => {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const a = p(c), b = p(s);
    return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
  };
  const hues = ["#b8432a", "#946000", "#3b7330", "#1d7373", "#2b62b0", "#6a4cb0", "#9c3a72", "#4c5a68"];
  const huesDark = ["#f08b6e", "#e3b04b", "#8fcc72", "#5ccaca", "#80aef2", "#b49cf0", "#ee8fc0", "#a9b5c2"];
  const split = ["light", "dark"].map((mode) => {
    const t = TILE[mode];
    const items = folk.map((n, i) => {
      const c = (mode === "light" ? hues : huesDark)[i % 8];
      const alpha = sprite(`folk/${n}.svg`, 40, 40, c);
      const sp = layered([[`folk/${n}-a.svg`, c], [`folk/${n}-b.svg`, mix(c, t.bg, 0.22)], [`folk/${n}-c.svg`, mix(c, t.bg, 0.44)]], 40, 40);
      return `<div class="pair">${alpha}${sp}</div>`;
    }).join("");
    return `<div class="row big" style="background:${t.bg}">${items}</div>`;
  }).join("");

  // Status at 12 px in greyscale (light and dark), and 11 px on a popover disc.
  const statusNames = ["working-arc", "needs", "done-check", "rest", "envelope", "pip-work", "pip-rest", "pip-needs"];
  const statusGrey = [["#fff", "#333"], ["#e8e8e8", "#555"], ["#222", "#ddd"]].map(([bg, fg]) =>
    `<div class="row big" style="background:${bg}">${statusNames.map((n) => `<div class="sil">${sprite(`status/${n}.svg`, 12, 12, fg)}</div>`).join("")}</div>`).join("");

  // Scene composites, on the mat in both themes.
  const scene = ["light", "dark"].map((mode) => {
    const s = S[mode];
    const sheetFrames = [112, 44, 26].map((z) =>
      `<div class="row" style="background:${s.mat}">${Array.from({ length: 8 }, (_, i) => layered([[`sheet/${i}-base.svg`, s.sheet], [`sheet/${i}-shade.svg`, s.sheetShade]], z, z)).join("")}</div>`).join("");
    const crane = (w, h) => layered([["scene/crane-gilded-outline.svg", s.goldInk], ["scene/crane-gilded-body.svg", s.gold], ["scene/crane-gilded-shade.svg", s.goldShade]], w, h);
    const boat = (w, h) => layered([["scene/boat-hull.svg", s.sheet], ["scene/boat-sail.svg", s.sheetShade]], w, h);
    const env = (seal) => layered([["scene/envelope-body.svg", s.sheet], ["scene/envelope-flap.svg", s.sheetShade], [`scene/${seal}.svg`, s.ink, 15, 7, 12, 12]], 28, 20);
    const strand = (n) => `<div class="stack" style="width:12px;height:200px">${sprite("ui/garland-strand.svg", 12, 200, s.sheet, "opacity:0.25")}<div style="position:absolute;left:0;bottom:0;width:12px;height:${n}px;overflow:hidden"><div style="position:absolute;bottom:0">${sprite("ui/garland-strand.svg", 12, 200, s.sheet)}</div></div></div>`;
    const strands = Array.from({ length: 20 }, (_, i) => strand(Math.max(0, Math.min(200, 200 - (i - 12) * 40)))).join('<div style="width:3px"></div>');
    const others = [
      crane(40, 28), crane(80, 56), boat(40, 28), boat(80, 56),
      ...["seal-bundle", "seal-rush", "seal-storm", "seal-chorus"].map(env),
      sprite("scene/scrap.svg", 16, 16, s.sheet), sprite("scene/scrap.svg", 32, 32, s.sheet),
      sprite("scene/ream.svg", 28, 20, s.sheet), sprite("scene/ream.svg", 56, 40, s.sheet),
      ...statusNames.slice(0, 5).map((n) => `<div class="chip" style="background:${mode === "light" ? "#ffffff" : "#2b302e"};box-shadow:0 0 0 1px ${s.sheet}">${sprite(`status/${n}.svg`, 12, 12, mode === "light" ? "#22302c" : "#e8e4da")}</div>`),
    ].join("");
    return `${sheetFrames}<div class="row" style="background:${s.mat}">${others}</div><div class="row" style="background:${s.mat};gap:0">${strands}</div>`;
  }).join("");

  const notify = has("notify-icon.svg")
    ? `<div class="row" style="background:#eee"><img src="${uri("notify-icon.svg")}" width="18" height="18"><img src="${uri("notify-icon.svg")}" width="36" height="36"><img src="${uri("notify-icon.svg")}" width="72" height="72"></div>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:12px;background:#8a8f8c;font:11px/1.3 system-ui,sans-serif;width:1376px}
    h2{font-size:13px;margin:14px 0 6px;color:#111}
    .grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
    .cell{background:#fff;border-radius:4px;overflow:hidden}
    .name{padding:2px 6px;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .row{display:flex;align-items:center;gap:8px;padding:6px 8px;flex-wrap:wrap}
    .row.big{gap:14px;padding:10px}
    .stack{position:relative;flex:none}
    .sp{flex:none}
    .missing{outline:2px solid red}
    .sil{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:10px}
    .pair{display:flex;gap:4px}
    .chip{width:22px;height:22px;border-radius:11px;background:#fbf7ee;box-shadow:0 0 0 1px #fbf7ee;display:flex;align-items:center;justify-content:center}
  </style></head><body>
    <h2>Silhouette test: folk at 16 px as one-colour blobs</h2>${silhouettes}
    <h2>Status at 12 px, greyscale</h2>${statusGrey}
    <h2>Facets: alpha file (left) vs split fallback (right), 40 px, hue tints</h2>${split}
    <h2>Scene composites on the mat: Sheet frames 0–7 at 112/44/26, crane, boat, envelopes, scrap, ream, status chips, the String</h2>${scene}
    <h2>notify-icon.svg (image(), 18/36/72)</h2>${notify}
    ${sections.join("")}
  </body></html>`;
}

/** Renders the sheet; returns the PNG path. */
export async function renderSheet({ art = DEFAULT_ART, out = DEFAULT_OUT, zoom = null } = {}) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
    await page.setContent(sheetHtml(art), { waitUntil: "load" });
    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out, fullPage: true });
    if (zoom) {
      // Blow up the true-size silhouette and status rows with nearest-neighbour scaling.
      const rows = await page.$$(".row.big");
      const shots = [];
      for (const r of rows.slice(0, 5)) shots.push((await r.screenshot()).toString("base64"));
      const zp = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await zp.setContent(`<body style="margin:0;background:#888">${shots.map((b) => `<img src="data:image/png;base64,${b}" style="display:block;zoom:4;image-rendering:pixelated;margin-bottom:2px">`).join("")}</body>`);
      await zp.screenshot({ path: zoom, fullPage: true });
    }
    return out;
  } finally {
    await browser.close();
  }
}

function argValue(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 ? resolve(argv[i + 1]) : fallback;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  renderSheet({ art: argValue(argv, "--art", DEFAULT_ART), out: argValue(argv, "--out", DEFAULT_OUT), zoom: argValue(argv, "--zoom", null) })
    .then((p) => console.log(`wrote ${p}`))
    .catch((e) => { console.error(e.message); process.exit(1); });
}

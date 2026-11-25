// Contact sheet: one PNG grid of every shot in a directory (ARCHITECTURE A10).
//
//   node tools/shots/contact-sheet.mjs [--dir tools/out/shots] [--out <file>]
//
// Renders an HTML page of <img> tiles (file name captions, failed shots
// outlined in red) and screenshots the full page. Views come first, then
// whole windows, each sorted by name.

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = resolve(HERE, "../out/shots");
export const SHEET_NAME = "contact-sheet.png";

/** `require('playwright')`, falling back to the global npm root next to this node. */
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

/** Launches chromium (no options) or throws with a readable reason. */
export async function launchBrowser() {
  const { chromium } = loadPlaywright();
  return chromium.launch();
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** PNG width and height from the IHDR chunk. */
export function pngSize(file) {
  const b = readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file} is not a PNG`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** The shots in `dir` (top level only, the sheet itself excluded), views first. */
export function listShots(dir) {
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir).filter((n) => n.endsWith(".png") && n !== SHEET_NAME);
  const isWindow = (n) => n.startsWith("window-");
  return names.sort((a, b) => Number(isWindow(a)) - Number(isWindow(b)) || a.localeCompare(b));
}

/** The sheet's HTML (tiles of `tile` px width, `columns` per row). */
export function sheetHtml(dir, shots, { columns = 4, tile = 340, errors = [], title = "Shots" } = {}) {
  const failed = new Set(errors);
  const width = columns * tile + (columns + 1) * 16;
  const tiles = shots.map((name) => {
    const { width: w, height: h } = pngSize(join(dir, name));
    const shownH = Math.round((tile * h) / w);
    const bad = failed.has(name.replace(/\.png$/, ""));
    return `<figure${bad ? ' class="bad"' : ""}><div class="frame"><img src="${pathToFileURL(join(dir, name)).href}" width="${tile}" height="${shownH}"></div>` +
      `<figcaption>${esc(name.replace(/\.png$/, ""))} <span>${w}×${h}</span></figcaption></figure>`;
  });
  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `html,body{margin:0;background:#2a2b2f;width:${width}px}` +
    `body{font:12px/1.3 system-ui,sans-serif;color:#d8d8dc;padding:16px;box-sizing:border-box}` +
    `h1{font-size:15px;margin:0 0 12px;color:#fff}` +
    `.grid{display:grid;grid-template-columns:repeat(${columns},${tile}px);gap:16px;align-items:start}` +
    `figure{margin:0}.frame{background:repeating-conic-gradient(#3a3b40 0 25%,#323338 0 50%) 0 0/16px 16px;line-height:0;outline:1px solid #45464c}` +
    `img{display:block;width:${tile}px;height:auto}figcaption{padding-top:5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}` +
    `figcaption span{color:#8a8b90}.bad .frame{outline:3px solid #ef4444}.bad figcaption{color:#fca5a5}` +
    `</style></head><body><h1>${esc(title)} · ${shots.length}</h1><div class="grid">${tiles.join("")}</div></body></html>`
  );
}

/**
 * Builds `<dir>/contact-sheet.png` (or `out`). Reuses `browser` when given.
 * Returns the file written, or null when there are no shots.
 */
export async function buildContactSheet({ dir = DEFAULT_DIR, out, browser, errors = [], columns, tile } = {}) {
  const shots = listShots(dir);
  if (!shots.length) return null;
  const file = out ?? join(dir, SHEET_NAME);
  const htmlDir = join(dir, "html");
  mkdirSync(htmlDir, { recursive: true });
  const htmlFile = join(htmlDir, "contact-sheet.html");
  const cols = columns ?? Math.min(4, shots.length);
  const html = sheetHtml(dir, shots, { columns: cols, tile, errors });
  writeFileSync(htmlFile, html);
  let own = null;
  if (!browser) own = await launchBrowser();
  const b = browser ?? own;
  try {
    const width = cols * (tile ?? 340) + (cols + 1) * 16;
    const page = await b.newPage({ viewport: { width, height: 600 }, deviceScaleFactor: 1 });
    try {
      await page.goto(pathToFileURL(htmlFile).href, { waitUntil: "load" });
      await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))));
      mkdirSync(dirname(file), { recursive: true });
      await page.screenshot({ path: file, fullPage: true });
    } finally {
      await page.close();
    }
  } finally {
    if (own) await own.close();
  }
  return file;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const dir = resolve(get("--dir") ?? DEFAULT_DIR);
  const out = get("--out") ? resolve(get("--out")) : undefined;
  try {
    const file = await buildContactSheet({ dir, out });
    if (!file) {
      console.error(`no shots in ${dir}`);
      process.exitCode = 1;
    } else console.log(file);
  } catch (error) {
    console.error(error.stack ?? String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

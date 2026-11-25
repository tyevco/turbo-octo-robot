// Hero screenshots for the GitHub README (docs/screenshots/).
//
//   node --import ./tools/node/register.mjs tools/shots/hero.mjs [--only name,...]
//
// Names: hero-dark, hero-light, flock, mat, frenzy, shop, string, away, ribbon,
// themes, rail, jump (default: all). Captions: docs/screenshots/CAPTIONS.md.
//
// Every image is a real render through the screenshot rig: the shipped mod
// (mods/creaseworks) runs under the mock herdr with a scenario from
// tools/shots/hero-views.js (one save, one moment, shared by every shot), its
// panel and ribbon copies share one mock window (as shoot.mjs
// runWindowCopies, plus the view's optional `finale`: the last clicks before
// the frame), the whole herdr window is drawn around them
// (tools/render/window.mjs) and Playwright chromium shoots it at
// deviceScaleFactor 2. Close-ups are crops of those whole-window renders (the
// crop box comes from the rendered elements' own boxes); themes.png and
// jump.png place such crops side by side under plain labels. No pixel is
// painted on.
//
// The window is 1920 x 988 with the game panel dragged a little wider than
// the layout's 0.39 weight (a user drag: the panel is resizable). The rig's
// terminal transcripts are up to 69 columns, so a two-column split needs
// 1,160 px of terminals for no line to be cut: that, not taste, sets the
// panel width. Each whole-window shot is checked: no terminal line clipped
// at a pane edge, no sidebar row cut by the footer.
//
// A PNG over 900 KB is re-encoded losslessly (zlib level 9, per-row filters);
// only if it is still over is it downscaled by the browser.

import "../node/register.mjs";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";
import { loadTarget, WINDOW_STATES, THEME_LIST, blockSizes } from "./shoot.mjs";
import { launchBrowser } from "./contact-sheet.mjs";
import { createController } from "../mock/controller.js";
import { beginRender, renderRoot, constructView, createMockWindow, serialize, handlersOf } from "../mock/gpui-kit.js";
import { renderToHtml } from "../render/html.mjs";
import { renderWindow, parseLayout, contentNodes, layoutBoxes, REPO_ROOT, THEMES } from "../render/window.mjs";
import { HERO, RAIL, MAT, FRENZY, FLOCK, SHOP, STRING, AWAY, JUMP, rosterRoles } from "./hero-views.js";

const OUT = resolve(REPO_ROOT, "docs/screenshots");
const SCALE = 2;
const LIMIT = 900 * 1024;
/** The hero window, and the panel width that leaves the terminals 1,160 px. */
const WIN = { width: 1920, height: 988 };
const HERO_PANEL = 467;
/** The mod's standard panel width: the String's strand card and the away card fill it edge to edge. */
const STD_PANEL = 320;
const THEME_ORDER = ["graphite", "paper", "ink", "moss", "atom-one-dark", "win98"];

// ---------------------------------------------------------------------------
// Running the mod's copies (shoot.mjs runWindowCopies + the view's finale)

/**
 * Runs every visible game block of `layout` as copies of the View in ONE mock
 * herdr window, plays `entry.setup` on the panel copy, sizes the copies like
 * the shell, lets two data ticks settle, then plays `entry.finale` (the last
 * clicks before the frame) and renders. Returns { [blockId]: {tree, palette},
 * errors, runs } (`runs`: the herdr commands the mod ran).
 */
async function runCopies(Class, mod, entry, themeName, size, layout) {
  const palette = THEMES[themeName];
  const appearance = THEME_LIST.find((t) => t.name === themeName)?.appearance ?? "dark";
  const blocks = contentNodes(layout).filter((b) => !b.hidden && b.content?.mod === mod && !b.float);
  const geometry = blockSizes(layout, size, 1);
  const scenario = { ...entry.scenario, theme: themeName, layout: JSON.parse(JSON.stringify(layout)), mod, zoom: 1 };
  const ctl = createController(scenario);
  const previousWindow = globalThis.window;
  globalThis.window = createMockWindow({ appearance, width: size.width, height: size.height, remSize: 13 });
  const copies = [];
  try {
    for (const block of blocks) {
      ctl.setProps(block.content.props ?? null);
      const view = constructView(Class);
      await ctl.dispatch("event", view, (cx) => view.init(undefined, cx), { cx: "ambient", initializing: view });
      copies.push({ block, view });
    }
    const main = copies.find((c) => c.block.id === entry.block) ?? copies.find((c) => c.block.content.props?.role !== "ribbon") ?? copies[0];
    const tools = {
      ctl, advance: (ms) => ctl.advance(ms), flush: () => ctl.flush(), theme: themeName, zoom: 1,
      block: geometry[main.block.id],
    };
    if (entry.setup) await entry.setup(main.view, tools);
    const render = (view) => {
      beginRender();
      return ctl.within("render", view, (cx) => renderRoot(view.render(cx)));
    };
    for (const { block, view } of copies) {
      const handler = handlersOf(render(view)).on_size_change;
      const box = geometry[block.id];
      if (handler && box) await ctl.dispatch("event", view, (cx) => handler({ width: box.width, height: box.height }, cx));
    }
    // Two data ticks: heartbeats and presence settle across the copies.
    await ctl.advance(1000);
    await ctl.advance(1000);
    await ctl.flush();
    if (entry.finale) await entry.finale(main.view, tools);
    const out = {};
    for (const { block, view } of copies) {
      beginRender();
      out[block.id] = { tree: ctl.within("render", view, (cx) => serialize(renderRoot(view.render(cx)), { cx })), palette };
    }
    out.errors = ctl.errors.slice();
    out.runs = ctl.runs.map((r) => ({ name: r.name, args: r.args, error: r.error }));
    return out;
  } finally {
    ctl.dispose();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

// ---------------------------------------------------------------------------
// Rendering a whole window

function gameBlocks(layout, mod) {
  const out = { panel: null, ribbon: null };
  for (const block of contentNodes(layout)) {
    if (block.content?.mod !== mod) continue;
    const role = block.content.props?.role === "ribbon" ? "ribbon" : "panel";
    out[role] ??= block.id;
  }
  return out;
}

function findNode(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

/** Drags the divider between the terminals and the panel so the panel is `px` wide (its weight, as a drag stores it). */
function setPanelWidth(layout, panelId, size, px) {
  const panel = findNode(layout, panelId);
  const main = findNode(layout, "main");
  const boxes = layoutBoxes(layout, { width: size.width, height: size.height, zoom: 1 });
  const avail = boxes[panelId].width + boxes.main.width;
  const mainWeight = typeof main.size?.weight === "number" ? main.size.weight : 1;
  panel.size = { weight: Math.round((px / (avail - px)) * mainWeight * 10000) / 10000 };
}

/**
 * The HTML of the herdr window with `entry`'s scenario in the game blocks.
 * `chrome(out, agents)` may move herdr's own focus after the mod's commands
 * (pane.focus is herdr's to carry out; the mock records it).
 */
async function windowHtml(base, entry, { theme, size = WIN, state = "", panel = HERO_PANEL, chrome = null }) {
  const st = WINDOW_STATES.find((s) => s.name === state);
  if (!st) throw new Error(`no window state ${state}`);
  const layout = parseLayout(JSON.parse(JSON.stringify(base.layout)));
  const ids = gameBlocks(layout, base.mod);
  if (!state && panel) setPanelWidth(layout, ids.panel, size, panel);
  st.edit(layout, ids);
  const results = await runCopies(base.Class, base.mod, entry, theme, size, layout);
  const warnings = [];
  for (const e of results.errors) warnings.push(`logged by the view: ${e.message ?? JSON.stringify(e)}`);
  const modBlocks = {};
  for (const block of contentNodes(layout)) {
    const r = results[block.id];
    if (r) modBlocks[block.id] = renderToHtml(r.tree, { zoom: 1, theme: r.palette, assetRoot: REPO_ROOT, warnings });
  }
  // The chrome (sidebar, tabs, terminals) draws the same herd the mod sees.
  let agents = entry.scenario.agents.map((a) => ({ ...a }));
  if (chrome) agents = chrome(results, agents);
  const scenario = { agents, terminals: entry.scenario.terminals, zoom: 1, branch: "main" };
  for (const w of warnings) console.log(`warning (${entry.name}/${theme}): ${w}`);
  return renderWindow({ layout, width: size.width, height: size.height, theme, scenario, modBlocks, gameMod: base.mod, zoom: 1 });
}

/** Opens `html` in a page at `size` (file:// so the mod's art loads); returns the page. */
async function openPage(browser, html, size, name, scale = SCALE) {
  const dir = join(OUT, ".html");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.html`);
  writeFileSync(file, html);
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: scale });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => r()))));
  if (problems.length) throw new Error(`page error in ${name}: ${problems.join("; ")}`);
  return page;
}

/**
 * Whole-window checks: no terminal line cut at its pane's right edge, no
 * terminal cut at the bottom, no sidebar agent row half hidden by the footer.
 * Returns a list of problems (empty when clean).
 */
async function chromeProblems(page) {
  return page.evaluate(() => {
    const out = [];
    for (const term of document.querySelectorAll(".terminal")) {
      const pane = term.closest("[data-pane]")?.getAttribute("data-pane") ?? "?";
      const box = term.getBoundingClientRect();
      const padR = parseFloat(getComputedStyle(term).paddingRight) || 0;
      for (const line of term.querySelectorAll(".tl")) {
        const r = document.createRange();
        r.selectNodeContents(line);
        const lb = r.getBoundingClientRect();
        if (lb.width && lb.right > box.right - padR + 0.5) out.push(`pane ${pane}: line cut at the right edge: "${line.textContent.trim().slice(0, 40)}"`);
        if (lb.height && lb.bottom > box.bottom + 0.5 && lb.top < box.bottom) out.push(`pane ${pane}: line cut at the bottom: "${line.textContent.trim().slice(0, 40)}"`);
      }
    }
    const list = document.querySelector(".agents > div:last-child");
    if (list) {
      const lb = list.getBoundingClientRect();
      for (const row of list.children) {
        const rb = row.getBoundingClientRect();
        const shown = Math.min(rb.bottom, lb.bottom) - Math.max(rb.top, lb.top);
        if (shown > 6 && shown < rb.height - 0.5) out.push(`sidebar row cut by the footer: "${row.textContent.trim().slice(0, 40)}" (${shown.toFixed(1)} of ${rb.height} px shown)`);
      }
    }
    return out;
  });
}

/** The viewport box of the first element matching `selector`. */
async function box(page, selector) {
  const b = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, selector);
  if (!b) throw new Error(`no element ${selector}`);
  return b;
}

/** The union box of every element matching `selector` (its content as laid out). */
async function boxAll(page, selector) {
  const b = await page.evaluate((sel) => {
    const els = [...document.querySelectorAll(sel)];
    if (!els.length) return null;
    const rs = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height);
    const x = Math.min(...rs.map((r) => r.left));
    const y = Math.min(...rs.map((r) => r.top));
    return { x, y, width: Math.max(...rs.map((r) => r.right)) - x, height: Math.max(...rs.map((r) => r.bottom)) - y };
  }, selector);
  if (!b) throw new Error(`no element ${selector}`);
  return b;
}

/** A crop box from edges (CSS px), rounded to whole device pixels and kept inside `size`. */
function edges(left, top, right, bottom, size) {
  const x = Math.max(0, Math.floor(left));
  const y = Math.max(0, Math.floor(top));
  return { x, y, width: Math.min(size.width, Math.ceil(right)) - x, height: Math.min(size.height, Math.ceil(bottom)) - y };
}

const PANEL = '[data-node="cw-panel"]';
const RIBBON = '[data-node="cw-ribbon"]';
const inPanel = (id) => `${PANEL} [data-id="${id}"]`;

// ---------------------------------------------------------------------------
// PNG size: lossless re-encode (zlib 9, adaptive row filters), then downscale

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Decodes an 8-bit RGB/RGBA non-interlaced PNG to raw rows; null when it is another kind. */
function decodePng(buf) {
  let pos = 8;
  let ihdr = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  if (!ihdr || ihdr.depth !== 8 || ihdr.interlace !== 0 || (ihdr.color !== 2 && ihdr.color !== 6)) return null;
  const bpp = ihdr.color === 6 ? 4 : 3;
  const stride = ihdr.width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * ihdr.height);
  for (let y = 0; y < ihdr.height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y > 0 ? out[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[dst + x] = v & 255;
    }
  }
  return { ...ihdr, bpp, stride, pixels: out };
}

/** Re-encodes losslessly: drops a fully opaque alpha channel, picks each row's best filter, zlib 9. */
function reencodePng(buf) {
  const img = decodePng(buf);
  if (!img) return buf;
  let { pixels, bpp, color } = img;
  if (bpp === 4) {
    let opaque = true;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 255) { opaque = false; break; }
    if (opaque) {
      const rgb = Buffer.alloc((pixels.length / 4) * 3);
      for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3) { rgb[j] = pixels[i]; rgb[j + 1] = pixels[i + 1]; rgb[j + 2] = pixels[i + 2]; }
      pixels = rgb;
      bpp = 3;
      color = 2;
    }
  }
  const stride = img.width * bpp;
  const filtered = Buffer.alloc((stride + 1) * img.height);
  const row = Buffer.alloc(stride);
  for (let y = 0; y < img.height; y++) {
    const cur = y * stride;
    let best = null;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? pixels[cur + x - bpp] : 0;
        const b = y > 0 ? pixels[cur - stride + x] : 0;
        const c = x >= bpp && y > 0 ? pixels[cur - stride + x - bpp] : 0;
        let p = 0;
        if (f === 1) p = a;
        else if (f === 2) p = b;
        else if (f === 3) p = (a + b) >> 1;
        else if (f === 4) {
          const q = a + b - c;
          const pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
          p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (pixels[cur + x] - p) & 255;
        row[x] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = Buffer.from(row);
        best.f = f;
      }
    }
    filtered[y * (stride + 1)] = best.f;
    best.copy(filtered, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = color;
  const out = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(filtered, { level: 9, memLevel: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return out.length < buf.length ? out : buf;
}

/** Downscales PNG bytes through an <img> in chromium to `factor` of their pixel size. */
async function downscale(browser, buf, factor) {
  const img = decodePng(buf);
  const width = Math.round(img.width * factor);
  const height = Math.round(img.height * factor);
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    await page.setContent(`<html><body style="margin:0;overflow:hidden"><img id="i" src="data:image/png;base64,${buf.toString("base64")}" ` +
      `style="display:block;width:${width}px;height:${height}px"></body></html>`);
    await page.waitForFunction(() => document.getElementById("i").complete);
    return await page.screenshot({ type: "png" });
  } finally {
    await page.close();
  }
}

/** Writes `buf` to docs/screenshots/<name>.png under LIMIT; returns a note. */
async function save(browser, name, buf) {
  let out = reencodePng(buf);
  let note = "";
  let factor = 1;
  while (out.length > LIMIT && factor > 0.5) {
    factor = Math.round((factor - 0.05) * 100) / 100;
    out = reencodePng(await downscale(browser, buf, factor));
    note = ` (downscaled to ${Math.round(factor * 100)} %)`;
  }
  const file = join(OUT, `${name}.png`);
  writeFileSync(file, out);
  const img = decodePng(out);
  console.log(`ok    ${file}  ${img.width}x${img.height}  ${Math.round(out.length / 1024)} KiB${note}`);
  return file;
}

// ---------------------------------------------------------------------------
// The shots

/** Renders `entry` in a whole window; returns the open page (caller closes). */
async function windowPage(browser, base, entry, opts) {
  const html = await windowHtml(base, entry, opts);
  const page = await openPage(browser, html, opts.size ?? WIN, `${entry.name}-${opts.theme}${opts.state ? `-${opts.state}` : ""}${opts.tag ?? ""}`);
  if (opts.check) {
    const problems = await chromeProblems(page);
    for (const p of problems) console.log(`CHECK (${entry.name}/${opts.theme}): ${p}`);
    if (problems.length) throw new Error(`${entry.name}/${opts.theme}: ${problems.length} chrome check(s) failed`);
  }
  return page;
}

async function shotWindow(browser, base, name, entry, opts) {
  const page = await windowPage(browser, base, entry, { ...opts, check: true });
  try {
    return await save(browser, name, await page.screenshot({ type: "png" }));
  } finally {
    await page.close();
  }
}

/** Crops `clip(page, size)` out of a whole-window render. */
async function shotCrop(browser, base, name, entry, opts, clip) {
  const size = opts.size ?? WIN;
  const page = await windowPage(browser, base, entry, opts);
  try {
    const c = await clip(page, size);
    return await save(browser, name, await page.screenshot({ type: "png", clip: c }));
  } finally {
    await page.close();
  }
}

/** Even padding around the panel's own edges (its 1 px border shows; less than the 8 px gap, so no neighbour does). */
const P = 6;

/** The panel from `top` (CSS px) down to `bottom`, with the panel's own left/right edges and P around. */
async function panelSlice(page, size, top, bottom) {
  const p = await box(page, PANEL);
  return edges(p.x - P, top - P, p.x + p.width + P, bottom + P, size);
}

/** From the panel's tab bar to the bottom of `selector`'s content. */
const fromTabs = (selector) => async (page, size) => {
  const tabs = await box(page, inPanel("cw-tabs"));
  const content = await boxAll(page, selector);
  const scroller = await box(page, inPanel("cw-content"));
  const bottom = content.y + content.height;
  if (bottom > scroller.y + scroller.height + 1) throw new Error(`the content runs past the panel (${Math.round(bottom - scroller.y - scroller.height)} px): use a taller window`);
  return panelSlice(page, size, tabs.y, bottom);
};

/** The panel's header, mat and boost bar (when one shows). */
async function matSlice(page, size) {
  const p = await box(page, PANEL);
  const mat = await box(page, inPanel("cw-mat"));
  const boost = await page.$(inPanel("cw-boostbar")) ? await box(page, inPanel("cw-boostbar")) : null;
  const bottom = boost && boost.height ? boost.y + boost.height : mat.y + mat.height;
  return panelSlice(page, size, p.y, bottom + 4);
}

const SHOTS = {
  "hero-dark": (b, base) => shotWindow(b, base, "hero-dark", HERO, { theme: "graphite" }),
  "hero-light": (b, base) => shotWindow(b, base, "hero-light", HERO, { theme: "paper" }),
  // The tab bar down to the last Resting row: 34 tiles fill the frame.
  flock: (b, base) => shotCrop(b, base, "flock", FLOCK, { theme: "graphite" }, fromTabs(`${PANEL} [data-id^="cw-flock-sec-"]`)),
  mat: (b, base) => shotCrop(b, base, "mat", MAT, { theme: "graphite" }, matSlice),
  frenzy: (b, base) => shotCrop(b, base, "frenzy", FRENZY, { theme: "graphite" }, matSlice),
  // A taller window, so the whole Works list shows without scrolling.
  shop: (b, base) => shotCrop(b, base, "shop", SHOP, { theme: "graphite", size: { width: 1920, height: 1240 } }, fromTabs(`${PANEL} [data-id="cw-shop"] > *`)),
  // The standard 320 px panel (the strand card is at most 304 wide) in a taller window: the wish button, Clears/Keeps, every perk and the garland show.
  string: (b, base) => shotCrop(b, base, "string", STRING, { theme: "graphite", size: { width: 1600, height: 1240 }, panel: STD_PANEL },
    fromTabs(`${PANEL} [data-id="cw-string"] > *`)),
  // The standard panel, so the card is as wide as the mat; the header, the card and the first Flock row,
  // cropped on the card's own left and right edges (the mat and the tab rule behind it stay out).
  away: (b, base) => shotCrop(b, base, "away", AWAY, { theme: "graphite", panel: STD_PANEL }, async (page, size) => {
    const card = await box(page, inPanel("cw-away"));
    const row = await box(page, `${PANEL} [data-id^="cw-flock-grid-"]`);
    const p = await box(page, PANEL);
    return edges(card.x, p.y + 1, card.x + card.width, Math.max(card.y + card.height, row.y + row.height) + P, size);
  }),
  // The fold total and the 34 marks, with the bottom of the terminals above and herdr's status bar below.
  ribbon: (b, base) => shotCrop(b, base, "ribbon", HERO, { theme: "graphite" }, async (page, size) => {
    const r = await box(page, RIBBON);
    const marks = await boxAll(page, `${RIBBON} [data-id^="cw-rib-m-"]`);
    const right = marks.x + marks.width + 24;
    // Up to 120 px of the terminals above, starting below the last line the crop's right edge would cut.
    const top = await page.evaluate(([top, right]) => {
      let t = top;
      for (const line of document.querySelectorAll(".terminal .tl")) {
        const range = document.createRange();
        range.selectNodeContents(line);
        const b = range.getBoundingClientRect();
        if (b.width && b.right > right && b.bottom > t && b.top < t + 200) t = Math.max(t, b.bottom + 2);
      }
      return t;
    }, [r.y - 120, right]);
    return edges(r.x, top, right, size.height, size);
  }),
  themes: (b, base) => shotThemes(b, base),
  // The right terminal column and the 64 px rail, down to just below the rail's status marks.
  rail: (b, base) => shotCrop(b, base, "rail", RAIL, { theme: "graphite", state: "folded", check: true }, async (page, size) => {
    const panes = await page.$$eval(".pane", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }));
    const right = panes.reduce((a, p) => (p.x > a.x ? p : a));
    const pips = await boxAll(page, `${PANEL} [data-id^="cw-rail-pip-"]`);
    return edges(right.x - 6, 0, size.width, pips.y + pips.height + 24, size);
  }),
  jump: (b, base) => shotJump(b, base),
};

// ---------------------------------------------------------------------------
// Composites: whole crops placed side by side under plain labels

async function composite(browser, name, tiles, { cols, bg, fg, gap = 22, label = 36 }) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:${bg};font-family:"Geist","Inter",system-ui,sans-serif}
.grid{display:inline-grid;grid-template-columns:repeat(${cols},max-content);gap:${gap}px;padding:${gap}px;align-items:start}
.tile{display:flex;flex-direction:column;align-items:flex-start}
.name{height:${label}px;line-height:${label - 10}px;font-size:16px;font-weight:600;color:${fg};letter-spacing:.01em;padding-left:2px}
img{display:block;border-radius:10px;box-shadow:0 1px 2px rgba(0,0,0,.18),0 6px 18px rgba(0,0,0,.12)}
</style></head><body><div class="grid">${tiles
    .map((t) => `<div class="tile"><div class="name">${t.label}</div><img src="data:image/png;base64,${t.png.toString("base64")}" ` +
      `style="width:${t.width}px;height:${t.height}px"></div>`)
    .join("")}</div></body></html>`;
  const rows = Math.ceil(tiles.length / cols);
  const colW = [];
  for (let c = 0; c < cols; c++) colW.push(Math.max(...tiles.filter((_, i) => i % cols === c).map((t) => t.width)));
  const rowH = [];
  for (let r = 0; r < rows; r++) rowH.push(Math.max(...tiles.slice(r * cols, r * cols + cols).map((t) => t.height + label)));
  const w = colW.reduce((a, x) => a + x, 0) + gap * (cols + 1);
  const h = rowH.reduce((a, x) => a + x, 0) + gap * (rows + 1);
  const page = await openPage(browser, html, { width: Math.ceil(w), height: Math.ceil(h) }, `${name}-grid`);
  try {
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    return await save(browser, name, await page.screenshot({ type: "png" }));
  } finally {
    await page.close();
  }
}

/**
 * The same moment in all six themes: each cell is herdr's tab bar over the
 * panel's header, mat, tabs and the Needs-you and Finished rows, labelled
 * with the theme's name and its background, chrome and accent colours.
 */
async function shotThemes(browser, base) {
  const tiles = [];
  for (const theme of THEME_ORDER) {
    const page = await windowPage(browser, base, HERO, { theme, tag: "-themes" });
    try {
      const p = await box(page, PANEL);
      const fin = await box(page, inPanel("cw-flock-sec-finished"));
      // herdr's tab bar above the panel (its chrome colour), the panel on its own edges.
      const clip = edges(p.x - P, 0, p.x + p.width + P, fin.y + fin.height + 8, WIN);
      const t = THEMES[theme];
      // The theme's own background, chrome and accent (tools/mock/themes.json) as swatches beside its name.
      const swatch = (c) => `<span style="display:inline-block;width:14px;height:14px;border-radius:4px;margin-left:6px;vertical-align:-2px;background:${c};box-shadow:inset 0 0 0 1px rgba(0,0,0,.25)"></span>`;
      const label = `${theme}<span style="margin-left:6px">${swatch(t.background)}${swatch(t.chrome)}${swatch(t.accent)}</span>`;
      tiles.push({ label, png: await page.screenshot({ type: "png", clip }), width: clip.width, height: clip.height });
    } finally {
      await page.close();
    }
  }
  return composite(browser, "themes", tiles, { cols: 2, bg: "#e9e7e2", fg: "#2a2925" });
}

/**
 * The jump, in two real frames: the moment (a needs-you tile in the panel)
 * and the window after that tile's own click handler ran: the mod asked
 * herdr for pane.focus, and herdr (drawn by the rig) shows that pane's space,
 * tab and pane focused.
 */
async function shotJump(browser, base) {
  const target = rosterRoles().jumpPane;
  const before = await windowPage(browser, base, HERO, { theme: "graphite", tag: "-jump-before" });
  let left;
  try {
    const p = await box(before, PANEL);
    const needs = await box(before, inPanel("cw-flock-sec-needs"));
    const clip = edges(p.x - P, p.y - P, p.x + p.width + P, needs.y + needs.height + P, WIN);
    left = { label: "1 · Click a helper who needs you", png: await before.screenshot({ type: "png", clip }), width: clip.width, height: clip.height };
  } finally {
    await before.close();
  }
  const chrome = (results, agents) => {
    const run = results.runs.find((r) => r.name === "pane.focus" && !r.error);
    if (!run || run.args?.pane !== target) throw new Error(`jump: the mod ran ${JSON.stringify(results.runs)}, not pane.focus ${target}`);
    return agents.map((a) => ({ ...a, focused: a.pane === run.args.pane }));
  };
  const after = await windowPage(browser, base, JUMP, { theme: "graphite", chrome, tag: "-jump-after", check: true });
  let right;
  try {
    const pane = await box(after, `[data-pane="${target}"]`);
    const clip = edges(0, 0, pane.x + pane.width + 8, left.height, WIN);
    right = { label: "2 · herdr jumps to its terminal", png: await after.screenshot({ type: "png", clip }), width: clip.width, height: clip.height };
  } finally {
    await after.close();
  }
  return composite(browser, "jump", [left, right], { cols: 2, bg: "#e9e7e2", fg: "#2a2925" });
}

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only") opts.only = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith("--only=")) opts.only = a.slice(7).split(",").map((s) => s.trim()).filter(Boolean);
    else throw new Error(`unknown option ${a}`);
  }
  const unknown = (opts.only ?? []).filter((n) => !SHOTS[n]);
  if (unknown.length) throw new Error(`--only: no shot ${unknown.join(", ")} (have ${Object.keys(SHOTS).join(", ")})`);
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  for (const t of THEME_ORDER) if (!THEMES[t]) throw new Error(`theme ${t} missing from tools/mock/themes.json`);
  mkdirSync(OUT, { recursive: true });
  const base = await loadTarget(REPO_ROOT);
  if (base.demo) throw new Error(`the mod is not loadable: ${base.reason}`);
  const browser = await launchBrowser();
  let failed = 0;
  try {
    for (const name of Object.keys(SHOTS)) {
      if (opts.only && !opts.only.includes(name)) continue;
      try {
        await SHOTS[name](browser, base);
      } catch (error) {
        failed++;
        console.error(`FAIL  ${name}: ${error.stack ?? error}`);
      }
    }
  } finally {
    await browser.close();
    rmSync(join(OUT, ".html"), { recursive: true, force: true });
  }
  if (failed) process.exitCode = 1;
}

await main();

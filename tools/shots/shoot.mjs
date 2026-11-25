// Screenshot rig (ARCHITECTURE A10).
//
//   node --import ./tools/node/register.mjs tools/shots/shoot.mjs [options]
//   npm run shots -- [options]
//
// Options:
//   --only a,b     only these views (names from views.js); "window" (or "windows",
//                  or a "window-…" prefix) selects the whole-window shots
//   --out <dir>    output directory (default tools/out/shots)
//   --preview      also write preview.png (1440x900 dark) and
//                  mods/<mod>/art/layout-preview.png (216x124); in demo mode both go
//                  to the output directory instead
//   --scale <n>    deviceScaleFactor for the shots people look at (default 2)
//   --no-windows   skip the whole-window shots
//   --no-sheet     skip the contact sheets
//   --themes a,b   only these themes (default: all six in tools/mock/themes.json)
//   --zooms 1,1.5  zoom levels per view (default 1 and 1.5; 1.5 adds -z1.5 to the name)
//   --no-vision    skip the grey / deuteranopia / protanopia captures
//
// For every view in mods/<mod>/glue/views.js (default export: an array of
// { name, size: {width, height}, scenario, setup?, block?, window? }) and each
// theme (the six of tools/mock/themes.json) it creates a mock herdr controller from the
// scenario, constructs the mod's View under Node with the mocks, runs init, then
// `setup(view, tools)` when given, settles ready host calls, renders, maps the
// tree to HTML (tools/render/html.mjs) and screenshots it with Playwright
// chromium to <out>/<view>-<theme>.png. Then whole windows (tools/render/window.mjs)
// at 1440x900 and 1100x700 in every theme and four states of the game's layout
// (expanded; panel folded to its 64 px rail; panel hidden; herdr's Files panel
// open): <out>/window-<w>x<h>[-<state>]-<theme>.png. A window's game blocks are
// copies of the View sharing ONE mock herdr window (as in herdr: one VM, one
// handover slot), each sized to its block by its root's on_size_change. A view
// or window that throws becomes a red error tile and the run exits 1.
// Contact sheets: contact-sheet.png (graphite and paper, views and windows) and
// contact-sheet-<theme>.png for every other theme shot.
//
// Without tools/game.json or the mod's views.js, a built-in demo view is shot
// instead (and placed in a bottom strip of the shipped main layout), so the rig
// can be tested before the game exists.
//
// views.js entries:
//   name      file-name-safe, unique
//   size      {width, height} CSS px of the view's shot (and of a float in a window)
//   scenario  a mock herdr scenario (tools/mock/controller.js); `theme` is overridden
//   setup     optional async (view, { ctl, advance, flush, theme }) run after init
//   block     optional: the layout block / float id this view's scenario fills in
//             whole-window shots (else the entry marked `window: true`, else the first)
// A named export `windowScenario` (optional) supplies the chrome's workspace data.

import "../node/register.mjs";
import { existsSync, mkdirSync, statSync, writeFileSync, readFileSync, copyFileSync, rmSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createController } from "../mock/controller.js";
import { View, div, beginRender, renderRoot, constructView, createMockWindow, serialize, handlersOf } from "../mock/gpui-kit.js";
import { THEME_NAMES, PALETTES, isLight } from "../mock/theme-resolve.js";
import { h_flex, v_flex, Button } from "../mock/gpui-base.js";
import { agents, theme as herdrTheme, settings } from "../mock/herdr.js";
import { renderToHtml, renderDocument } from "../render/html.mjs";
import { renderWindow, MAIN_LAYOUT, THEMES, REPO_ROOT, loadGame, contentNodes, parseLayout } from "../render/window.mjs";
import { buildContactSheet, loadPlaywright, launchBrowser } from "./contact-sheet.mjs";

/** Every theme the mock knows (tools/mock/themes.json), with its appearance. */
export const THEME_LIST = Object.freeze(
  THEME_NAMES.map((name) => Object.freeze({ name, appearance: isLight(PALETTES[name].background) ? "light" : "dark" })),
);
/** The two themes the main contact sheet shows (the rest get a sheet each). */
export const PRIMARY_THEMES = Object.freeze(["graphite", "paper"]);
/**
 * Whole-window states of the game's layout: `edit(layout, game)` changes a
 * copy of the parsed layout (game = { panel, ribbon } block ids of the mod).
 */
export const WINDOW_STATES = Object.freeze([
  { name: "", label: "expanded", edit: () => {} },
  { name: "folded", label: "panel folded to the rail", edit: (l, g) => { const n = findNode(l, g.panel); if (n) n.size = { px: 64 }; } },
  { name: "hidden", label: "panel hidden", edit: (l, g) => { const n = findNode(l, g.panel); if (n) n.hidden = true; } },
  { name: "files", label: "Files panel open", edit: (l) => { const n = findNode(l, "panel"); if (n) n.hidden = false; } },
]);

function findNode(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}
export const WINDOW_SIZES = Object.freeze([
  { width: 1440, height: 900 },
  { width: 1100, height: 700 },
]);
export const DEFAULT_OUT = resolve(REPO_ROOT, "tools/out/shots");
const PREVIEW_LIMIT = 1.5 * 1024 * 1024;
const PREVIEW_SCALE = 1600 / 1440;
// DESIGN §13.3: 216x124 (shown about 108x62 in herdr's Settings), from a window of the same aspect.
const LAYOUT_PREVIEW = { width: 216, height: 124, windowWidth: 1512, windowHeight: 868 };

// ---------------------------------------------------------------------------
// Playwright
// ---------------------------------------------------------------------------

export { loadPlaywright, launchBrowser };

/**
 * Colour-vision captures (DESIGN §15.3): CSS filters over the whole page.
 * Deuteranopia / protanopia are Machado, Oliveira & Fernandes (2009) at
 * severity 1, applied in linear RGB (feColorMatrix's default).
 */
export const VISION = Object.freeze({
  grey: { css: "grayscale(1)" },
  deuteranopia: { matrix: "0.367322 0.860646 -0.227968 0 0  0.280085 0.672501 0.047413 0 0  -0.011820 0.042940 0.968881 0 0  0 0 0 1 0" },
  protanopia: { matrix: "0.152286 1.052583 -0.204868 0 0  0.114503 0.786281 0.099216 0 0  -0.003882 -0.048116 1.051998 0 0  0 0 0 1 0" },
});
/** The views captured under each VISION filter (roster, ribbon, rail), in the primary themes. */
export const VISION_VIEWS = Object.freeze(["flock-34", "flock-64-dense", "ribbon-64-1440", "rail-64"]);
/** Zoom levels shot for every view (DESIGN §15.3); zoom 1 keeps the plain file name. */
export const ZOOMS = Object.freeze([1, 1.5]);

function withVision(html, mode) {
  const v = VISION[mode];
  if (!v) return html;
  const svgFilter = v.matrix
    ? `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0"><filter id="cw-vision"><feColorMatrix type="matrix" values="${v.matrix}"/></filter></svg>`
    : "";
  const css = `<style>html{filter:${v.css ?? "url(#cw-vision)"}}</style>`;
  return html.replace("</head>", `${css}</head>`).replace(/<body([^>]*)>/, `<body$1>${svgFilter}`);
}

async function screenshotHtml(browser, html, { file, width, height, scale = 2, htmlDir }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  try {
    // A file:// page, so file:// images and svg masks load.
    mkdirSync(htmlDir, { recursive: true });
    const htmlFile = join(htmlDir, file.replace(/^.*[\\/]/, "").replace(/\.png$/, ".html"));
    writeFileSync(htmlFile, html);
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => r()))));
    mkdirSync(dirname(file), { recursive: true });
    await page.screenshot({ path: file });
  } finally {
    await page.close();
  }
  if (problems.length) throw new Error(`page error in ${file}: ${problems.join("; ")}`);
  return file;
}

/** Re-encodes a PNG at a smaller size through an <img> (browser filtering). */
async function downscale(browser, src, dest, width, height) {
  const data = readFileSync(src).toString("base64");
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    await page.setContent(
      `<html><body style="margin:0;overflow:hidden"><img id="i" src="data:image/png;base64,${data}" ` +
        `style="display:block;width:${width}px;height:${height}px;object-fit:cover;object-position:left top"></body></html>`,
    );
    await page.waitForFunction(() => document.getElementById("i").complete);
    await page.screenshot({ path: dest });
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Error tiles
// ---------------------------------------------------------------------------

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function errorDocument(title, error, width, height) {
  const text = error?.stack ?? String(error);
  const font = Math.max(12, Math.round(width / 70));
  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}` +
    `body{background:#7f1d1d;color:#fff;font:${font + 1}px/1.45 system-ui,sans-serif;box-sizing:border-box;padding:16px;` +
    `border:6px solid #ef4444}h1{font-size:${font + 6}px;margin:0 0 8px}pre{white-space:pre-wrap;font:${font}px/1.4 monospace;margin:0;color:#fecaca}</style></head>` +
    `<body><h1>⚠ ${esc(title)} failed</h1><pre>${esc(text.split("\n").slice(0, 24).join("\n"))}</pre></body></html>`
  );
}

// ---------------------------------------------------------------------------
// Demo view (used while the game's views.js does not exist)
// ---------------------------------------------------------------------------

const DEMO_MOD = "demo-game";

class DemoView extends View {
  init() {
    this.coins = 12840;
  }
  render() {
    const t = herdrTheme();
    const z = settings().zoom;
    const list = agents();
    const tile = (a) =>
      v_flex().id(`agent-${a.address}`).flex_1().min_w(0).p(10 * z).gap(6 * z).rounded(10 * z).bg(t.raised)
        .border(1).border_color(t.border)
        .child(h_flex().gap(6 * z)
          .child(div().size(8 * z).rounded_full().bg(t[a.status] ?? t.dim))
          .child(div().flex_1().truncate().text_size(12 * z).text_color(t.foreground).child(a.title || a.program.name)))
        .child(div().text_size(11 * z).text_color(t.dim).child(`${a.status} · ${a.tab_name}`));
    const bar = (fraction) =>
      div().h(8 * z).w_full().rounded_full().bg(t.hover)
        .child(div().h_full().w(`${Math.round(fraction * 100)}%`).rounded_full().bg(t.accent));
    return v_flex().id("demo-root").size_full().p(16 * z).gap(12 * z).bg(t.background).text_color(t.foreground)
      .child(h_flex().gap(10 * z)
        .child(div().size(28 * z).rounded(8 * z).bg(t.working).flex().items_center().justify_center()
          .text_color(t.background).font_bold().child("★"))
        .child(v_flex().flex_1()
          .child(div().text_size(15 * z).font_semibold().child("Herd Clicker (demo)"))
          .child(div().text_size(11.5 * z).text_color(t.muted).child("Rig self-test: no views.js yet")))
        .child(div().text_size(20 * z).font_bold().text_color(t.working).child(String(this.coins).replace(/\B(?=(\d{3})+$)/g, ","))))
      .child(bar(0.62))
      .child(h_flex().gap(8 * z).children(list.slice(0, 3).map(tile)))
      .child(h_flex().gap(8 * z)
        .child(Button.new("collect").px(14 * z).h(30 * z).rounded(8 * z).bg(t.accent).text_color(t.accent_foreground)
          .text_size(13 * z).font_semibold().child("Collect"))
        .child(div().text_size(12 * z).text_color(t.dim).child(`${list.length} agents herding`)));
  }
}

export const DEMO_VIEWS = Object.freeze([
  {
    name: "demo",
    size: { width: 560, height: 240 },
    window: true,
    scenario: {
      agents: [
        { address: "t1", status: "working", title: "Closed-form catch-up", tab_name: "engine", focused: true },
        { address: "t2", status: "blocked", title: "Shop layout", tab_name: "ui" },
        { address: "t3", status: "done", title: "Save codec", tab_name: "engine" },
        { address: "t4", status: "idle", tab_name: "docs" },
      ],
    },
  },
]);

/** The shipped main layout with the demo mod in a 200px strip above the status bar. */
export function demoLayout() {
  const layout = JSON.parse(JSON.stringify(MAIN_LAYOUT));
  const work = layout.children.find((c) => c.id === "work");
  const at = work.children.findIndex((c) => c.id === "status");
  work.children.splice(at, 0, { id: "game-strip", type: "block", size: { px: 200 }, content: { mod: DEMO_MOD, props: { role: "strip" } } });
  return layout;
}

// ---------------------------------------------------------------------------
// The game (or the demo)
// ---------------------------------------------------------------------------

export function validateViews(views, where) {
  if (!Array.isArray(views)) throw new Error(`${where}: the default export must be an array of views`);
  const names = new Set();
  views.forEach((v, i) => {
    const at = `${where}[${i}]`;
    if (!v || typeof v.name !== "string" || !/^[A-Za-z0-9_-]+$/.test(v.name)) throw new Error(`${at}: name must be letters, digits, - or _`);
    if (names.has(v.name)) throw new Error(`${at}: duplicate view name ${v.name}`);
    if (/^window(-|$)/.test(v.name)) throw new Error(`${at}: view names starting with "window" are reserved for whole-window shots`);
    names.add(v.name);
    const s = v.size;
    if (!s || !(s.width > 0) || !(s.height > 0)) throw new Error(`${at} (${v.name}): size must be {width, height} > 0`);
    if (v.scenario !== undefined && (typeof v.scenario !== "object" || v.scenario === null)) throw new Error(`${at} (${v.name}): scenario must be an object`);
    if (v.setup !== undefined && typeof v.setup !== "function") throw new Error(`${at} (${v.name}): setup must be a function`);
  });
  return views;
}

/**
 * The game's mod, View class, views table and window layout; the demo when
 * tools/game.json or mods/<mod>/glue/views.js is missing.
 */
export async function loadTarget(root = REPO_ROOT) {
  const game = loadGame(root);
  const viewsPath = game ? resolve(root, "mods", game.mod, "glue/views.js") : null;
  if (!game || !existsSync(viewsPath)) {
    return {
      demo: true,
      reason: game ? `${viewsPath} does not exist yet` : "tools/game.json does not exist yet",
      mod: DEMO_MOD, Class: DemoView, views: DEMO_VIEWS, windowScenario: {}, layout: demoLayout(), layoutName: "main+demo",
    };
  }
  const viewsModule = await import(pathToFileURL(viewsPath).href);
  const views = validateViews(viewsModule.default, viewsPath);
  const mainModule = await import(pathToFileURL(resolve(root, "mods", game.mod, "main.js")).href);
  if (typeof mainModule.default !== "function") throw new Error(`mods/${game.mod}/main.js must default-export the View class`);
  const layoutPath = game.layout ? resolve(root, "layouts", `${game.layout}.json`) : null;
  const layout = layoutPath && existsSync(layoutPath) ? JSON.parse(readFileSync(layoutPath, "utf8")) : MAIN_LAYOUT;
  return {
    demo: false, mod: game.mod, Class: mainModule.default, views, windowScenario: viewsModule.windowScenario ?? null,
    layout, layoutName: layout === MAIN_LAYOUT ? "main (layouts/" + game.layout + ".json missing)" : game.layout,
  };
}

/**
 * Runs one copy of the View like the shell does (construct, init in an ambient
 * scope, optional setup, settle ready host calls, render) and returns the
 * serialised tree plus the palette used.
 */
export async function runView(Class, entry, themeName, extra = {}) {
  const palette = THEMES[themeName];
  const appearance = THEME_LIST.find((t) => t.name === themeName)?.appearance ?? "dark";
  const size = extra.size ?? entry.size;
  const scenario = { ...(entry.scenario ?? {}), theme: themeName };
  if (extra.props !== undefined) scenario.props = extra.props;
  if (extra.mod) scenario.mod ??= extra.mod;
  if (extra.zoom !== undefined) scenario.zoom = extra.zoom;
  const zoom = scenario.zoom ?? 1;
  const ctl = createController(scenario);
  const previousWindow = globalThis.window;
  globalThis.window = createMockWindow({ appearance, width: size.width * zoom, height: size.height * zoom, remSize: 13 * zoom });
  try {
    const view = constructView(Class);
    if (typeof view.init === "function") {
      await ctl.dispatch("event", view, (cx) => view.init(undefined, cx), { cx: "ambient", initializing: view });
    }
    if (entry.setup) {
      await entry.setup(view, { ctl, advance: (ms) => ctl.advance(ms), flush: () => ctl.flush(), theme: themeName });
    }
    await ctl.flush();
    if (zoom !== 1) {
      // The shell reports a block's size in zoomed px: size the copy the way it would.
      beginRender();
      const root = ctl.within("render", view, (cx) => renderRoot(view.render(cx)));
      const onSize = handlersOf(root).on_size_change;
      if (onSize) await ctl.dispatch("event", view, (cx) => onSize({ width: size.width * zoom, height: size.height * zoom }, cx));
      await ctl.advance(1000);
      await ctl.flush();
    }
    beginRender();
    const tree = ctl.within("render", view, (cx) => {
      return serialize(renderRoot(view.render(cx)), { cx });
    });
    const errors = ctl.errors.slice();
    return { tree, palette, zoom, errors };
  } finally {
    ctl.dispose();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

function viewDocument(result, entry, warnings) {
  return renderDocument(result.tree, {
    width: entry.size.width * result.zoom,
    height: entry.size.height * result.zoom,
    background: result.palette.background,
    zoom: result.zoom,
    theme: result.palette,
    assetRoot: REPO_ROOT,
    warnings,
  });
}

/** The view entry whose scenario fills game block `id` in a window shot. */
export function entryForBlock(views, id) {
  return views.find((v) => v.block === id) ?? views.find((v) => v.window) ?? views[0];
}

/** The block ids of the game's panel and ribbon in a layout (first block of each role). */
function gameBlocks(layout, mod) {
  const out = { panel: null, ribbon: null };
  for (const block of contentNodes(layout)) {
    if (block.content?.mod !== mod) continue;
    const role = block.content.props?.role === "ribbon" ? "ribbon" : "panel";
    out[role] ??= block.id;
  }
  return out;
}

/**
 * Runs every visible game block of a window as copies of the View in ONE mock
 * herdr window (shared handover slot, as in herdr), sizes each copy through
 * its root's on_size_change, and renders them. Returns {blockId: {tree, ...}}.
 */
export async function runWindowCopies(Class, target, themeName, size, layout) {
  const palette = THEMES[themeName];
  const appearance = THEME_LIST.find((t) => t.name === themeName)?.appearance ?? "dark";
  const blocks = contentNodes(layout).filter((b) => !b.hidden && b.content?.mod === target.mod && !b.float);
  const geometry = blockSizes(layout, size);
  const entry = entryForBlock(target.views, blocks.find((b) => b.content.props?.role !== "ribbon")?.id ?? null);
  const scenario = { ...(entry.scenario ?? {}), theme: themeName, layout: JSON.parse(JSON.stringify(layout)) };
  scenario.mod ??= target.mod;
  const ctl = createController(scenario);
  const previousWindow = globalThis.window;
  globalThis.window = createMockWindow({ appearance, width: size.width, height: size.height, remSize: 13 * (scenario.zoom ?? 1) });
  const copies = [];
  try {
    for (const block of blocks) {
      ctl.setProps(block.content.props ?? null);
      const view = constructView(Class);
      await ctl.dispatch("event", view, (cx) => view.init(undefined, cx), { cx: "ambient", initializing: view });
      copies.push({ block, view });
    }
    if (entry.setup && copies.length) {
      const main = copies.find((c) => c.block.id === entry.block) ?? copies.find((c) => c.block.content.props?.role !== "ribbon") ?? copies[0];
      await entry.setup(main.view, { ctl, advance: (ms) => ctl.advance(ms), flush: () => ctl.flush(), theme: themeName });
    }
    // Size each copy like the shell: its root element's on_size_change with the block's size.
    const render = (view) => {
      beginRender();
      return ctl.within("render", view, (cx) => renderRoot(view.render(cx)));
    };
    for (const { block, view } of copies) {
      const root = render(view);
      const handler = handlersOf(root).on_size_change;
      const box = geometry[block.id];
      if (handler && box) await ctl.dispatch("event", view, (cx) => handler({ width: box.width, height: box.height }, cx));
    }
    // Two data ticks: heartbeats and presence settle across the copies.
    await ctl.advance(1000);
    await ctl.advance(1000);
    await ctl.flush();
    const out = {};
    for (const { block, view } of copies) {
      beginRender();
      out[block.id] = {
        tree: ctl.within("render", view, (cx) => serialize(renderRoot(view.render(cx)), { cx })),
        palette,
        zoom: scenario.zoom ?? 1,
      };
    }
    out.errors = ctl.errors.slice();
    return out;
  } finally {
    ctl.dispose();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

/** Logical sizes of the game's blocks in a window (the same flex rules as render/window.mjs, simplified). */
function blockSizes(layout, size) {
  const out = {};
  const measure = (node, w, h) => {
    out[node.id] = { width: Math.round(w), height: Math.round(h) };
    const kids = (node.children ?? []).filter((c) => !c.hidden);
    if (!kids.length || node.type === "block") return;
    if (node.type === "stack") {
      for (const c of kids) measure(c, w, h);
      return;
    }
    const pad = typeof node.padding === "number" ? node.padding : 0;
    const gap = typeof node.gap === "number" ? node.gap : 0;
    const row = node.type === "row";
    const total = (row ? w : h) - 2 * pad - gap * (kids.length - 1);
    const fixed = kids.map((c) => (c.size && typeof c.size.px === "number" ? c.size.px : null));
    const weights = kids.map((c, i) => (fixed[i] === null ? (c.size && typeof c.size.weight === "number" ? c.size.weight : 1) : 0));
    const free = Math.max(0, total - fixed.reduce((a, b) => a + (b ?? 0), 0));
    const wsum = weights.reduce((a, b) => a + b, 0) || 1;
    kids.forEach((c, i) => {
      const len = fixed[i] ?? (free * weights[i]) / wsum;
      if (row) measure(c, len, h - 2 * pad);
      else measure(c, w - 2 * pad, len);
    });
  };
  measure(layout, size.width, size.height);
  return out;
}

async function windowDocument(target, themeName, size, warnings, state = WINDOW_STATES[0]) {
  const layout = parseLayout(JSON.parse(JSON.stringify(target.layout)));
  state.edit(layout, gameBlocks(layout, target.mod));
  const modBlocks = {};
  if (!target.demo) {
    const results = await runWindowCopies(target.Class, target, themeName, size, layout);
    for (const e of results.errors) warnings.push(`logged by the view: ${e.message ?? JSON.stringify(e)}`);
    for (const block of contentNodes(layout)) {
      const r = results[block.id];
      if (!r) continue;
      modBlocks[block.id] = renderToHtml(r.tree, { zoom: r.zoom, theme: r.palette, assetRoot: REPO_ROOT, warnings });
    }
  } else {
    for (const block of contentNodes(layout)) {
      if (block.hidden || block.content?.mod !== target.mod) continue;
      const entry = entryForBlock(target.views, block.id);
      let props = block.content.props ?? null;
      if (block.float) props = { ...(props ?? {}), float: block.id };
      const result = await runView(target.Class, entry, themeName, { props, mod: target.mod });
      const html = renderToHtml(result.tree, { zoom: result.zoom, theme: result.palette, assetRoot: REPO_ROOT, warnings });
      modBlocks[block.id] = block.float ? { html, width: entry.size.width, height: entry.size.height } : html;
    }
  }
  const scenario = target.windowScenario ?? entryForBlock(target.views, null)?.scenario ?? {};
  return renderWindow({
    layout, width: size.width, height: size.height, theme: themeName, scenario, modBlocks, gameMod: target.mod,
    zoom: scenario.zoom ?? 1,
  });
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

function themesFor(names) {
  if (!names) return THEME_LIST;
  const unknown = names.filter((n) => !THEME_LIST.some((t) => t.name === n));
  if (unknown.length) throw new Error(`--themes: unknown theme ${unknown.join(", ")} (have ${THEME_LIST.map((t) => t.name).join(", ")})`);
  return THEME_LIST.filter((t) => names.includes(t.name));
}

function selects(only, name) {
  if (!only) return true;
  return only.some((o) => o === name);
}

function selectsWindows(only) {
  if (!only) return true;
  return only.some((o) => o === "window" || o === "windows" || o.startsWith("window-"));
}

/**
 * Shoots everything. Options: { only: string[], out, preview, scale, windows, sheet,
 * browser (reuse one), root, log }. Returns { files, errors, demo, out }.
 */
export async function shoot(options = {}) {
  const out = resolve(options.out ?? DEFAULT_OUT);
  const htmlDir = join(out, "html");
  const scale = options.scale ?? 2;
  const log = options.log ?? ((m) => console.log(m));
  const files = [];
  const errors = [];
  mkdirSync(out, { recursive: true });
  rmSync(htmlDir, { recursive: true, force: true });
  // A full run replaces every shot: drop PNGs a previous run (or an older views table) left.
  if (!options.only && !options.themes && !options.zooms && options.windows !== false) {
    for (const n of readdirSync(out)) if (n.endsWith(".png")) rmSync(join(out, n), { force: true });
  }

  const browser = options.browser ?? (await launchBrowser());
  const ownBrowser = !options.browser;
  try {
    let target;
    try {
      target = await loadTarget(options.root ?? REPO_ROOT);
    } catch (error) {
      const file = join(out, "load-error.png");
      await screenshotHtml(browser, errorDocument("loading the mod", error, 800, 450), { file, width: 800, height: 450, scale: 1, htmlDir });
      errors.push({ name: "load", error });
      files.push(file);
      log(`error: ${error.stack ?? error}`);
      return { files, errors, out, demo: false };
    }
    if (target.demo) log(`demo mode: ${target.reason}; shooting the built-in demo view`);

    const shot = async (name, width, height, make, s = scale) => {
      const file = join(out, `${name}.png`);
      const warnings = [];
      let ok = true;
      try {
        const html = await make(warnings);
        await screenshotHtml(browser, html, { file, width, height, scale: s, htmlDir });
        for (const w of warnings) log(`warning (${name}): ${w}`);
        log(`ok    ${file}`);
      } catch (error) {
        ok = false;
        errors.push({ name, error });
        log(`FAIL  ${name}: ${error.stack ?? error}`);
        const w = Math.max(width, 480);
        const h = Math.max(height, 270);
        await screenshotHtml(browser, errorDocument(name, error, w, h), { file, width: w, height: h, scale: 1, htmlDir });
      }
      files.push(file);
      return ok;
    };

    const unknown = (options.only ?? []).filter((o) => !/^windows?$|^window-/.test(o) && !target.views.some((v) => v.name === o));
    if (unknown.length) {
      const error = new Error(`--only: no view named ${unknown.join(", ")} (have ${target.views.map((v) => v.name).join(", ")}, window)`);
      errors.push({ name: "only", error });
      log(`error: ${error.message}`);
    }

    const themes = themesFor(options.themes);
    const zooms = target.demo ? [1] : options.zooms ?? ZOOMS;
    for (const entry of target.views) {
      if (!selects(options.only, entry.name)) continue;
      for (const zoom of zooms) {
        for (const { name: themeName } of themes) {
          const suffix = zoom === 1 ? "" : `-z${zoom}`;
          await shot(`${entry.name}-${themeName}${suffix}`, entry.size.width * zoom, entry.size.height * zoom, async (warnings) => {
            const result = await runView(target.Class, entry, themeName, { mod: target.mod, zoom });
            for (const e of result.errors) warnings.push(`logged by the view: ${e.message ?? JSON.stringify(e)}`);
            return viewDocument(result, entry, warnings);
          });
        }
      }
      if (!target.demo && options.vision !== false && VISION_VIEWS.includes(entry.name)) {
        for (const themeName of PRIMARY_THEMES.filter((t) => themes.some((x) => x.name === t))) {
          for (const mode of Object.keys(VISION)) {
            await shot(`${entry.name}-${themeName}-${mode}`, entry.size.width, entry.size.height, async (warnings) => {
              const result = await runView(target.Class, entry, themeName, { mod: target.mod });
              return withVision(viewDocument(result, entry, warnings), mode);
            });
          }
        }
      }
    }

    if (options.windows !== false && selectsWindows(options.only)) {
      const states = target.demo ? WINDOW_STATES.slice(0, 1) : WINDOW_STATES;
      for (const size of WINDOW_SIZES) {
        for (const state of states) {
          for (const { name: themeName } of themes) {
            const name = `window-${size.width}x${size.height}${state.name ? `-${state.name}` : ""}-${themeName}`;
            await shot(name, size.width, size.height, (warnings) => windowDocument(target, themeName, size, warnings, state));
          }
        }
      }
    }

    const previews = async () => {
      const previewPath = target.demo ? join(out, "preview.png") : resolve(REPO_ROOT, "preview.png");
      const layoutPreviewPath = target.demo ? join(out, "layout-preview.png") : resolve(REPO_ROOT, "mods", target.mod, "art/layout-preview.png");
      const tmp = join(out, "html", "preview-raw.png");
      // DESIGN §1: the herdr.dev card is 1600x1000, i.e. the 1440x900 window at 10/9 scale.
      const okPreview = await shot("html/preview-raw", 1440, 900, (w) => windowDocument(target, "graphite", { width: 1440, height: 900 }, w), PREVIEW_SCALE);
      files.pop();
      if (!okPreview) return;
      mkdirSync(dirname(previewPath), { recursive: true });
      copyFileSync(tmp, previewPath);
      if (statSync(previewPath).size > PREVIEW_LIMIT) await downscale(browser, tmp, previewPath, 1200, 750);
      log(`ok    ${previewPath} (${Math.round(statSync(previewPath).size / 1024)} KiB)`);
      const lp = LAYOUT_PREVIEW;
      const rawLayout = join(out, "html", "layout-preview-raw.png");
      const okLayout = await shot("html/layout-preview-raw", lp.windowWidth, lp.windowHeight,
        (w) => windowDocument(target, "graphite", { width: lp.windowWidth, height: lp.windowHeight }, w), 1);
      files.pop();
      if (!okLayout) return;
      mkdirSync(dirname(layoutPreviewPath), { recursive: true });
      await downscale(browser, rawLayout, layoutPreviewPath, lp.width, lp.height);
      log(`ok    ${layoutPreviewPath}`);
      files.push(previewPath, layoutPreviewPath);
    };
    if (options.preview) await previews();

    if (options.sheet !== false) {
      // One sheet for the primary themes (and anything not themed), one per other theme:
      // a single sheet of every theme would pass Chromium's screenshot height limit.
      const extra = new RegExp(`-(z[0-9.]+|${Object.keys(VISION).join("|")})\\.png$`);
      const themeOf = (n) => {
        const base = n.replace(extra, ".png");
        return THEME_LIST.map((t) => t.name).find((t) => base.endsWith(`-${t}.png`)) ?? null;
      };
      const isZoomed = (n) => /-z[0-9.]+\.png$/.test(n);
      const isVision = (n) => new RegExp(`-(${Object.keys(VISION).join("|")})\\.png$`).test(n);
      const others = themes.map((t) => t.name).filter((t) => !PRIMARY_THEMES.includes(t));
      const sheets = [
        { file: join(out, "contact-sheet.png"), filter: (n) => !others.includes(themeOf(n)) && !isZoomed(n) && !isVision(n), title: "Shots" },
        { file: join(out, "contact-sheet-zoom.png"), filter: (n) => !others.includes(themeOf(n)) && isZoomed(n), title: "Shots · zoom 1.5" },
        { file: join(out, "contact-sheet-vision.png"), filter: (n) => isVision(n), title: "Shots · grey, deuteranopia, protanopia" },
        ...others.map((t) => ({ file: join(out, `contact-sheet-${t}.png`), filter: (n) => themeOf(n) === t, title: `Shots · ${t}` })),
      ];
      for (const sh of sheets) {
        const sheet = await buildContactSheet({ dir: out, out: sh.file, browser, errors: errors.map((e) => e.name), filter: sh.filter, title: sh.title, columns: 6, tile: 300 });
        if (sheet) {
          files.push(sheet);
          log(`ok    ${sheet}`);
        }
      }
    }
    return { files, errors, out, demo: target.demo };
  } finally {
    if (ownBrowser) await browser.close();
  }
}

export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === "--only") opts.only = value().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith("--only=")) opts.only = a.slice(7).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--out") opts.out = value();
    else if (a.startsWith("--out=")) opts.out = a.slice(6);
    else if (a === "--preview") opts.preview = true;
    else if (a === "--scale") opts.scale = Number(value());
    else if (a === "--no-windows") opts.windows = false;
    else if (a === "--no-sheet") opts.sheet = false;
    else if (a === "--zooms") opts.zooms = value().split(",").map(Number);
    else if (a === "--no-vision") opts.vision = false;
    else if (a === "--themes") opts.themes = value().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith("--themes=")) opts.themes = a.slice(9).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (opts.scale !== undefined && !(opts.scale > 0)) throw new Error("--scale must be a positive number");
  if (opts.zooms !== undefined && !opts.zooms.every((z) => z > 0)) throw new Error("--zooms must be positive numbers");
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(String(error.message));
    process.exitCode = 2;
    return;
  }
  if (opts.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(2, 20).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    return;
  }
  let browser;
  try {
    browser = await launchBrowser();
  } catch (error) {
    console.error(`cannot launch chromium: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  try {
    const { errors, files } = await shoot({ ...opts, browser });
    console.log(`${files.length} files, ${errors.length} failed`);
    if (errors.length) process.exitCode = 1;
  } catch (error) {
    console.error(error.stack ?? String(error));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

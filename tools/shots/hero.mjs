// Hero screenshots for the GitHub README (docs/screenshots/).
//
//   node --import ./tools/node/register.mjs tools/shots/hero.mjs [--only name,...]
//
// Names: hero-dark, hero-light, flock, confetti, shop, string, away, ribbon,
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
// jump.png place such crops side by side under plain labels (jump.png adds a
// "clicked" marker under its first frame, outside the frame's pixels). No
// pixel is painted on.
//
// The hero window is 1600 x 1000 with the game panel dragged to 467 px (a
// user drag: the panel is resizable), and the sidebar's Spaces/Agents
// divider dragged up so the agent list ends on a whole row. herdr's chrome
// (sidebar, tabs, pane headers, terminal transcripts, status bar) is drawn
// by the rig, not captured from herdr; the hero's panes get their own short
// transcripts (TRANSCRIPTS below) so no two panes repeat and no line is cut
// at 1600 px. Each whole-window shot is checked: no terminal line clipped at
// a pane edge, no sidebar row cut by the footer (HERO_LOOSE=1 only warns,
// for debugging a crop).
//
// The rig draws a "+N" pop before its rise (a pop starts to rise 16 ms after
// its click and hand hits are 80 ms or more apart), so a frame holds one pop
// at full strength: the last click's. Composites (themes, jump) sit on a
// transparent background with labels in dark pills, for GitHub's light and
// dark pages.
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
import { HERO, RAIL, CONFETTI, FLOCK, SHOP, STRING, AWAY, JUMP, NOTES, rosterRoles } from "./hero-views.js";

const OUT = resolve(REPO_ROOT, "docs/screenshots");
const SCALE = 2;
const LIMIT = 900 * 1024;
/** The hero window (1600 x 1000) and the game panel's width in it (a user drag: the panel is resizable). */
const WIN = { width: 1600, height: 1000 };
const HERO_PANEL = 467;
/** The rail shot's narrower window: its right terminal column and the rail make a tall crop, about 1:2. */
const RAIL_WIN = { width: 1280, height: 1000 };
/** The mod's standard panel width (the String's strand card and the away card fill it edge to edge). */
const STD_PANEL = 320;
/** The Spaces list's height in the sidebar (dragged up from half, see setSpacesHeight). */
const SPACES_PX = 300;
const THEME_ORDER = ["graphite", "paper", "ink", "moss", "atom-one-dark", "win98"];

// ---------------------------------------------------------------------------
// Terminal transcripts (herdr's chrome, not the mod)
//
// The rig's canned transcripts (tools/render/window.mjs terminalLines) give
// every agent pane the same Read/Update of tick.js and run up to 69 columns.
// The hero's panes each get their own short transcript, matched to the pane's
// title, drawn in the rig's own line markup and theme colours. Like the rest
// of herdr's chrome in these images, they are mock content: only the game
// panel and ribbon are the shipped mod.

const prompt = (cmd) => [["➜  ", "ansi2", true], ["herdr-clicker", "ansi6", true], [" git:(", "ansi4", true], ["main", "ansi1", true], [")", "ansi4", true], [" ✗ ", "ansi3", true], [cmd, "fg"]];
const BOX = 36;
const boxRow = (spans, color) => {
  const used = spans.reduce((n, x) => n + [...x[0]].length, 2);
  return [["│ ", color], ...spans, [" ".repeat(Math.max(0, BOX - used - 1)) + "│", color]];
};
const top = (c) => [["╭" + "─".repeat(BOX - 2) + "╮", c]];
const bottom = (c) => [["╰" + "─".repeat(BOX - 2) + "╯", c]];
const welcome = (cmd, name) => [prompt(cmd), top("accent"), boxRow([["✻ ", "ansi3"], [`Welcome to ${name}!`, "fg", true]], "accent"), bottom("accent"), []];
const inputBox = () => [top("dim"), boxRow([["> ", "dim"], ["█", "cursor"]], "dim"), bottom("dim"), [["  ? for shortcuts", "dim"]]];
const tool = (name, arg) => [["● ", "ansi2"], [name, "fg", true], [`(${arg})`, "dim"]];
const out = (text, color = "dim") => [[`  ⎿  ${text}`, color]];
const diff = (n, sign, code) => [[`     ${n} `, "dim"], [`${sign}  ${code}`, sign === "-" ? "ansi1" : "ansi2"]];
const ask = (file, lines) => [
  [["╭─ ", "ansi3"], ["Edit file ", "ansi3", true], [file, "dim"]],
  ...lines.map(([n, sign, code]) => [["│ ", "ansi3"], [`${n} `, "dim"], [`${sign}  ${code}`, sign === "-" ? "ansi1" : "ansi2"]]),
  [["│ ", "ansi3"], ["Make this edit to ", "fg"], [file.split("/").pop(), "fg", true], ["?", "fg"]],
  [["│ ", "ansi3"], ["❯ 1. Yes", "accent", true]],
  [["│ ", "ansi3"], ["  2. Yes, allow all edits this session", "fg"]],
  [["│ ", "ansi3"], ["  3. No, tell Claude what to change", "fg"]],
  [["╰─", "ansi3"]],
];
const cx = (text) => [["• ", "fg"], [text, "fg", true]];
const cxOut = (text, color = "dim") => [[`  └ ${text}`, color]];

/** Transcripts by pane title (zsh by program); a pane with none keeps the rig's. */
const TRANSCRIPTS = {
  // The active tab: a Claude Code waiting on an edit, a zsh shell, a Codex done.
  "Make the offline catch-up closed-form": () => [
    ...welcome("claude", "Claude Code"),
    [["> ", "dim"], ["make the offline catch-up closed-form", "fg"]],
    [],
    tool("Read", "engine/tick.js"),
    out("Read 142 lines"),
    tool("Read", "engine/away.js"),
    out("Read 96 lines"),
    tool("Search", "simulate\\(, engine/"),
    out("Found 3 matches in 2 files"),
    [],
    [["● ", "fg"], ["Catch-up runs one step per second, so", "fg"]],
    [["  8 h away is 28,800 steps. Rates are", "fg"]],
    [["  flat between buys, so a closed form", "fg"]],
    [["  gives the same totals in one step.", "fg"]],
    [],
    tool("Update", "engine/tick.js"),
    out("12 additions, 4 removals"),
    diff(41, "-", "for (…) state = step(state);"),
    diff(41, "+", "state = closedForm(state, dt);"),
    tool("Bash", "npm test -- tick"),
    [["  ⎿  ✔ 31 passing ", "ansi2"], ["(0.6s)", "dim"]],
    [],
    ...ask("engine/away.js", [[88, "-", "const credit = simulate(dt);"], [88, "+", "const credit = closedForm(dt);"]]),
  ],
  zsh: () => [
    prompt("npm run lint"),
    [],
    [["> creaseworks@0.9.0 lint", "dim"]],
    [["> eslint mods tools", "dim"]],
    [],
    [["✔ 0 problems", "ansi2"]],
    prompt("git status --short"),
    [[" M engine/tick.js", "ansi3"]],
    [[" M engine/away.js", "ansi3"]],
    [[" M docs/BALANCE.md", "ansi3"]],
    [["?? tests/save-codec.test.js", "ansi1"]],
    prompt("npm test"),
    [["▶ engine", "fg"]],
    [["  ✔ advance is deterministic ", "ansi2"], ["(2.1ms)", "dim"]],
    [["  ✔ catch-up capped at 8h ", "ansi2"], ["(0.4ms)", "dim"]],
    [["  ✔ a wish keeps its perks ", "ansi2"], ["(0.9ms)", "dim"]],
    [["▶ save codec", "fg"]],
    [["  ✔ round-trips a full save ", "ansi2"], ["(3.2ms)", "dim"]],
    [["  ✔ rejects a damaged file ", "ansi2"], ["(0.6ms)", "dim"]],
    [["ℹ tests 142 ", "fg"], ["ℹ pass 142 ", "ansi2"], ["ℹ fail 0", "dim"]],
    [...prompt(""), ["█", "cursor"]],
  ],
  "Save codec tests": () => [
    ...welcome("codex", "Codex"),
    [["> ", "dim"], ["save codec tests", "fg"]],
    [],
    cx("Explored"),
    cxOut("Read save-codec.js, store.js"),
    cx("Added tests/save-codec.test.js"),
    [["  ", "fg"], ["+64", "ansi2"], [" round-trip, truncated, bad sum", "dim"]],
    [["• ", "fg"], ["Edited glue/store.js ", "fg", true], ["+9 ", "ansi2"], ["-2", "ansi1"]],
    cx("Ran npm test -- save-codec"),
    cxOut("✔ 14 passing (0.8s)", "ansi2"),
    [],
    [["Done: a damaged save keeps a backup.", "fg"]],
    [],
    ...inputBox(),
  ],
  // The "ui" tab (the jump shot): a Claude Code waiting on an edit, a Codex at work.
  "Shop panel layout": () => [
    ...welcome("claude", "Claude Code"),
    [["> ", "dim"], ["shop panel layout", "fg"]],
    [],
    tool("Read", "ui/shop.js"),
    out("Read 388 lines"),
    tool("Read", "ui/widgets.js"),
    out("Read 640 lines"),
    tool("Update", "ui/shop.js"),
    out("6 additions, 3 removals"),
    diff(196, "-", "row.child(price(item));"),
    diff(196, "+", "row.child(price(item).flex_none());"),
    [],
    ...ask("ui/shop.js", [[240, "-", "const w = 120;"], [240, "+", "const w = rowWidth(ctx);"]]),
  ],
  "Ribbon status icons": () => [
    ...welcome("codex", "Codex"),
    [["> ", "dim"], ["ribbon status icons", "fg"]],
    [],
    cx("Explored"),
    cxOut("Read ribbon.js, color.js"),
    cx("Edited ui/ribbon.js"),
    [["  ", "fg"], ["+18 ", "ansi2"], ["-6", "ansi1"], [" one mark per helper", "dim"]],
    cx("Running npm test -- ribbon"),
    [],
    [["✻ ", "ansi5"], ["Working ", "ansi3"], ["(41s · esc to interrupt)", "dim"]],
  ],
};

const escHtml = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One transcript in the rig's terminal markup (window.mjs terminal(): a `.tl` div per line). */
function transcriptHtml(lines, t) {
  const color = (k) => (k === "fg" ? t.terminal_foreground : k === "cursor" ? t.cursor : t[k] ?? t.terminal_foreground);
  return lines.map((spans) => `<div class="tl">${spans.length
    ? spans.map(([text, k, bold]) => `<span style="color:${color(k)}${bold ? ";font-weight:700" : ""}">${escHtml(text)}</span>`).join("")
    : "&nbsp;"}</div>`).join("");
}

/** Swaps the rig's transcript for the pane's own one in the window HTML (pane by pane). */
function withTranscripts(html, agents, theme) {
  const t = THEMES[theme];
  for (const a of agents) {
    const make = TRANSCRIPTS[a.program?.shell ? "zsh" : a.title];
    if (!make) continue;
    const at = html.indexOf(`data-pane="${a.pane}"`);
    if (at < 0) continue;
    const re = /<div class="terminal"[^>]*>((?:<div class="tl">(?:(?!<\/div>).)*<\/div>)*)<\/div>/gs;
    re.lastIndex = at;
    const m = re.exec(html);
    if (!m) throw new Error(`no terminal markup for pane ${a.pane}`);
    const start = m.index + m[0].length - m[1].length - "</div>".length;
    html = html.slice(0, start) + transcriptHtml(make(), t) + html.slice(start + m[1].length);
  }
  return html;
}

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
 * Drags the sidebar's divider between the Spaces and Agents lists so Spaces
 * is `px` tall (the four spaces and their header; herdr lets the user drag
 * it), which shows more agents and lets the list end on a whole row.
 */
function setSpacesHeight(layout, size, px) {
  const spaces = findNode(layout, "spaces");
  const agents = findNode(layout, "agents");
  if (!spaces || !agents) return;
  const boxes = layoutBoxes(layout, { width: size.width, height: size.height, zoom: 1 });
  const avail = boxes.spaces.height + boxes.agents.height;
  spaces.size = { weight: Math.round(px * 10000) / 10000 };
  agents.size = { weight: Math.round((avail - px) * 10000) / 10000 };
}

/**
 * The HTML of the herdr window with `entry`'s scenario in the game blocks.
 * `chrome(out, agents)` may move herdr's own focus after the mod's commands
 * (pane.focus is herdr's to carry out; the mock records it).
 */
async function windowHtml(base, entry, { theme, size = WIN, state = "", panel = HERO_PANEL, spaces = SPACES_PX, chrome = null }) {
  const st = WINDOW_STATES.find((s) => s.name === state);
  if (!st) throw new Error(`no window state ${state}`);
  const layout = parseLayout(JSON.parse(JSON.stringify(base.layout)));
  const ids = gameBlocks(layout, base.mod);
  if (!state && panel) setPanelWidth(layout, ids.panel, size, panel);
  if (spaces) setSpacesHeight(layout, size, spaces);
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
  const html = renderWindow({ layout, width: size.width, height: size.height, theme, scenario, modBlocks, gameMod: base.mod, zoom: 1 });
  return withTranscripts(html, agents, theme);
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
    if (problems.length && !process.env.HERO_LOOSE) throw new Error(`${entry.name}/${opts.theme}: ${problems.length} chrome check(s) failed`);
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
  return insidePanel(page, size, tabs.y, bottom + 10);
};

/** The mat and the boost bar's chips under it (when one shows), inside the panel's border, a margin around. */
async function matSlice(page, size) {
  const mat = await box(page, inPanel("cw-mat"));
  const chips = await page.$(`${inPanel("cw-boostbar")} > *`) ? await boxAll(page, `${inPanel("cw-boostbar")} > *`) : null;
  const bottom = chips && chips.height ? chips.y + chips.height : mat.y + mat.height;
  return insidePanel(page, size, mat.y - 4, bottom + 8);
}

/** Inside the panel's 1 px border lines, from `top` to `bottom` (CSS px). */
async function insidePanel(page, size, top, bottom) {
  const p = await box(page, PANEL);
  return edges(p.x + 1, top, p.x + p.width - 1, bottom, size);
}

const SHOTS = {
  "hero-dark": (b, base) => shotWindow(b, base, "hero-dark", HERO, { theme: "graphite" }),
  // The README's <picture> source for prefers-color-scheme: light (the same moment).
  "hero-light": (b, base) => shotWindow(b, base, "hero-light", HERO, { theme: "paper" }),
  // The tab bar down to the last Resting row: 34 tiles fill the frame.
  flock: (b, base) => shotCrop(b, base, "flock", FLOCK, { theme: "graphite" }, fromTabs(`${PANEL} [data-id^="cw-flock-sec-"]`)),
  confetti: (b, base) => shotCrop(b, base, "confetti", CONFETTI, { theme: "graphite" }, matSlice),
  // The Works list down to the Washi Vat (the tiers after it are still hidden), inside the panel's border.
  shop: (b, base) => shotCrop(b, base, "shop", SHOP, { theme: "graphite" }, async (page, size) => {
    const tabs = await box(page, inPanel("cw-tabs"));
    const vat = await box(page, inPanel("cw-shop-row-washi-vat"));
    return insidePanel(page, size, tabs.y, vat.y + vat.height + 10);
  }),
  // The String: its title, the strand of 1,000 and the wish button (the perks and garland below are left out).
  // The mod's standard 320 px panel (the strand card is at most 304 wide, so it fills it).
  string: (b, base) => shotCrop(b, base, "string", STRING, { theme: "graphite", panel: STD_PANEL }, async (page, size) => {
    const tabs = await box(page, inPanel("cw-tabs"));
    const wish = await box(page, inPanel("cw-string-wish"));
    // P under the button: less than the 6 px gap to the line below it.
    return panelSlice(page, size, tabs.y, wish.y + wish.height - 1);
  }),
  // The mod's standard 320 px panel (the card fills it): the panel's header and the card, the panel's edges and a margin around.
  away: (b, base) => shotCrop(b, base, "away", AWAY, { theme: "graphite", panel: STD_PANEL }, async (page, size) => {
    const p = await box(page, PANEL);
    const card = await box(page, inPanel("cw-away"));
    // 4 px under the card: the Flock rows below start 5 px under it.
    const c = await panelSlice(page, size, p.y, card.y + card.height);
    return { ...c, height: Math.ceil(card.y + card.height + 4) - c.y };
  }),
  // The ribbon, end to end: the bottom 10 px of the panes above it, herdr's status bar below.
  ribbon: (b, base) => shotCrop(b, base, "ribbon", HERO, { theme: "graphite" }, async (page, size) => {
    const r = await box(page, RIBBON);
    return edges(r.x - 8, r.y - 10, r.x + r.width + 8, size.height, size);
  }),
  themes: (b, base) => shotThemes(b, base),
  // The right terminal column and the 64 px rail, from under the tab bar down to the ribbon (the rail's full height).
  rail: (b, base) => shotCrop(b, base, "rail", RAIL, { theme: "graphite", state: "folded", size: RAIL_WIN, check: true }, async (page, size) => {
    const panes = await page.$$eval(".pane", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }));
    const left = Math.max(...panes.map((p) => p.x));
    const topY = Math.min(...panes.map((p) => p.y));
    const r = await box(page, RIBBON);
    return edges(left - 5, topY - 6, size.width, r.y, size);
  }),
  jump: (b, base) => shotJump(b, base),
};

// ---------------------------------------------------------------------------
// Composites: whole crops placed side by side under plain labels, on a
// transparent background (the README sits on GitHub's light or dark page)

async function composite(browser, name, tiles, { cols, gap = 22, label = 40 }) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;font-family:"Geist","Inter",system-ui,sans-serif}
.grid{display:inline-grid;grid-template-columns:repeat(${cols},max-content);gap:${gap}px;padding:${gap}px;align-items:start}
.tile{display:flex;flex-direction:column;align-items:flex-start}
.name{position:relative;height:${label}px;width:100%}
.pill{position:absolute;left:0;top:2px;display:inline-flex;align-items:center;height:28px;padding:0 12px;border-radius:14px;
  background:#2a2c31;color:#f2f1ee;font-size:15px;font-weight:600;letter-spacing:.01em;white-space:nowrap}
.below{position:relative;height:${label}px;width:100%}
.mark{position:absolute;top:6px;width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-bottom:13px solid #e5484d;transform:translateX(-10px)}
.note{position:absolute;top:22px;transform:translateX(-50%);font-size:14px;font-weight:600;color:#e5484d;white-space:nowrap}
img{display:block;border-radius:10px;box-shadow:0 1px 2px rgba(0,0,0,.18),0 6px 18px rgba(0,0,0,.12)}
</style></head><body><div class="grid">${tiles
    .map((t) => `<div class="tile" style="width:${t.width}px"><div class="name"><span class="pill">${t.label}</span></div>` +
      `<img src="data:image/png;base64,${t.png.toString("base64")}" style="width:${t.width}px;height:${t.height}px">` +
      `${t.mark != null ? `<div class="below"><span class="mark" style="left:${t.mark}px"></span><span class="note" style="left:${t.mark}px">clicked</span></div>` : ""}</div>`)
    .join("")}</div></body></html>`;
  const rows = Math.ceil(tiles.length / cols);
  const colW = [];
  for (let c = 0; c < cols; c++) colW.push(Math.max(...tiles.filter((_, i) => i % cols === c).map((t) => t.width)));
  const rowH = [];
  for (let r = 0; r < rows; r++) rowH.push(Math.max(...tiles.slice(r * cols, r * cols + cols).map((t) => t.height + label + (t.mark != null ? label : 0))));
  const w = colW.reduce((a, x) => a + x, 0) + gap * (cols + 1);
  const h = rowH.reduce((a, x) => a + x, 0) + gap * (rows + 1);
  const page = await openPage(browser, html, { width: Math.ceil(w), height: Math.ceil(h) }, `${name}-grid`);
  try {
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    return await save(browser, name, await page.screenshot({ type: "png", omitBackground: true }));
  } finally {
    await page.close();
  }
}

/**
 * The same moment in all six themes, 3 x 2: each cell is the bottom of the
 * window, where the theme shows most: the right edge of the Codex terminal, the
 * panel's tabs and Flock, the ribbon and herdr's status bar (the mat, which
 * stays a green cutting mat in every theme, is left out). Each label names
 * the theme with swatches of its terminal background, chrome and accent
 * (tools/mock/themes.json), all three of which show in the cell.
 */
async function shotThemes(browser, base) {
  const tiles = [];
  for (const theme of THEME_ORDER) {
    const page = await windowPage(browser, base, HERO, { theme, tag: "-themes" });
    try {
      const p = await box(page, PANEL);
      const tabs = await box(page, inPanel("cw-tabs"));
      // 120 px of the Codex terminal: its right edge, past the end of most lines (the terminal's colour, little cut text).
      const clip = edges(p.x - 128, tabs.y - 4, WIN.width, WIN.height, WIN);
      const t = THEMES[theme];
      const swatch = (c) => `<span style="display:inline-block;width:13px;height:13px;border-radius:4px;margin-left:5px;background:${c};box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)"></span>`;
      const label = `${theme}<span style="margin-left:8px;display:inline-flex">${swatch(t.background)}${swatch(t.chrome)}${swatch(t.accent)}</span>`;
      tiles.push({ label, png: await page.screenshot({ type: "png", clip }), width: clip.width, height: clip.height });
    } finally {
      await page.close();
    }
  }
  return composite(browser, "themes", tiles, { cols: 3 });
}

/**
 * The jump, in two real frames: the moment (a needs-you tile in the panel)
 * and the window after that tile's own click handler ran: the mod asked
 * herdr for pane.focus, and herdr (drawn by the rig) shows that pane's space,
 * tab and pane focused. A marker under the first frame, outside its
 * pixels, points up at the tile that was clicked (the rig draws no cursor).
 */
async function shotJump(browser, base) {
  const target = rosterRoles().jumpPane;
  const before = await windowPage(browser, base, HERO, { theme: "graphite", tag: "-jump-before" });
  let left;
  try {
    const p = await box(before, PANEL);
    // Down to the Finished heading: the Needs-you tiles and the gap under them.
    const fin = await box(before, inPanel("cw-flock-sec-finished"));
    if (!NOTES.jumpTile) throw new Error("jump: no tile for the jump helper");
    const tile = await box(before, inPanel(NOTES.jumpTile));
    const clip = edges(p.x - P, p.y - P, p.x + p.width + P, fin.y - 1, WIN);
    left = {
      label: "1 · Click a helper who needs you", mark: tile.x + tile.width / 2 - clip.x,
      png: await before.screenshot({ type: "png", clip }), width: clip.width, height: clip.height,
    };
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
    // Down past the pane's last line (its edit prompt), so no line is cut.
    const last = await boxAll(after, `[data-pane="${target}"] .tl`);
    let bottom = Math.max(left.height, last.y + last.height + 12);
    // ...and past any sidebar row that edge would cut.
    const rows = await after.$$eval(".agents > div:last-child > *", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.top, r.bottom]; }));
    const cut = rows.find(([t, b]) => t < bottom && b > bottom);
    if (cut) bottom = cut[1];
    const clip = edges(0, 0, pane.x + pane.width + 8, bottom, WIN);
    right = { label: "2 · herdr jumps to its terminal", png: await after.screenshot({ type: "png", clip }), width: clip.width, height: clip.height };
  } finally {
    await after.close();
  }
  return composite(browser, "jump", [left, right], { cols: 2 });
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

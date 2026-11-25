// Whole-window renderer for screenshots (ARCHITECTURE A1, A10).
//
// renderWindow({ layoutPath | layout, width, height, theme, scenario, modBlocks, zoom, gameMod })
// returns a complete HTML document of `width` x `height` CSS px: the layout's
// node tree (docs/research/layouts-share.md §2, src/layout.rs) laid out with
// flexbox, the shipped chrome (workspace-chrome, spaces, agents, tabs, pane
// headers, workspace-status, files, changes) drawn approximately from
// defaults/mods/*/main.js with the theme's colours, fake terminals in the tab
// block, and the game mod's blocks filled with the given HTML fragments.
//
// Approximations: no real terminal grid, icons are simple inline SVGs, the
// spinner is a static ring, a float with `peek` is drawn closed (only `peek`
// px showing) unless `drawersOpen` is set, and divider drags/min/max clamping
// are left to CSS.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Controller } from "../mock/controller.js";
import { PATH_SCRIPT } from "./html.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "../..");
export const THEMES = JSON.parse(readFileSync(resolve(HERE, "../mock/themes.json"), "utf8"));

// Constants from herdr-app 0.1.18.
const HEADER_HEIGHT = 30; // src/window.rs:32
const FLOAT_MARGIN = 12; // src/window/floats.rs:13-24
const FRAME_PAD = 5;
const TERMINAL_FLOAT = { width: 560, height: 320 }; // src/window/floats.rs:134-136
const NODE_TYPES = ["block", "row", "column", "stack"];

/**
 * herdr's shipped `defaults/layouts/main.json` (herdr-app 0.1.18, Apache-2.0),
 * used when no layout file is given and the repo has no layout of its own yet.
 */
export const MAIN_LAYOUT = Object.freeze({
  id: "root",
  type: "row",
  titlebar: "none",
  traffic_lights: [12, 16],
  background: "canvas",
  terminal_padding: [14, 12],
  divider: { width: 1, color: "border" },
  children: [
    {
      id: "sidebar", type: "column", size: { px: 268 }, min: 44, max: 480, background: "chrome", resizable: false,
      children: [
        { id: "brand", type: "block", size: { px: 46 }, window_drag: true, content: { mod: "workspace-chrome" } },
        {
          id: "sidebar-lists", type: "column",
          children: [
            { id: "spaces", type: "block", size: { weight: 1 }, min: 90, content: { mod: "spaces" } },
            { id: "agents", type: "block", size: { weight: 1 }, min: 90, content: { mod: "agents" } },
          ],
        },
        { id: "sidebar-footer", type: "block", size: { px: 69 }, content: { mod: "workspace-chrome", props: { footer: true } } },
      ],
    },
    {
      id: "work", type: "column", resizable: false,
      children: [
        { id: "tabs", type: "block", size: { px: 42 }, window_drag: true, content: { mod: "tabs" } },
        {
          id: "work-body", type: "row", padding: 8, gap: 8,
          children: [
            {
              id: "main", type: "block",
              content: {
                tab: "active",
                pane: {
                  gap: 8, radius: 10, background: "background", lone: true,
                  border: { width: 1, color: "border" },
                  focus: { width: 1, color: "accent" },
                  header: { content: { mod: "pane" }, height: 30, position: "top", reveal: "always" },
                },
              },
            },
            {
              id: "panel", type: "column", hidden: true, size: { px: 368 }, min: 280, max: 900,
              children: [
                {
                  id: "panel-body", type: "stack", active: "files",
                  children: [
                    { id: "files", type: "block", content: { mod: "files" } },
                    { id: "changes", type: "block", content: { mod: "changes" } },
                  ],
                },
              ],
            },
          ],
        },
        { id: "status", type: "block", size: { px: 28 }, content: { mod: "workspace-status" } },
      ],
    },
  ],
});

/** A believable workspace for the chrome when the scenario has no agents. */
export const DEMO_AGENTS = Object.freeze([
  {
    address: "t1", pane: "p1", space: "s1", space_name: "herdr-clicker", tab: "c1", tab_index: 1, tab_name: "engine",
    status: "working", title: "Make the offline catch-up closed-form", focused: true, cwd: "~/code/herdr-clicker",
    program: { key: "claude", name: "Claude Code", agent: true, shell: false },
  },
  {
    address: "t2", pane: "p2", space: "s1", space_name: "herdr-clicker", tab: "c1", tab_index: 1, tab_name: "engine",
    status: "done", title: "Save codec tests", cwd: "~/code/herdr-clicker",
    program: { key: "codex", name: "Codex", agent: true, shell: false },
  },
  {
    address: "t3", pane: "p3", space: "s1", space_name: "herdr-clicker", tab: "c2", tab_index: 2, tab_name: "ui",
    status: "blocked", title: "Shop panel layout", cwd: "~/code/herdr-clicker/mods",
    program: { key: "claude", name: "Claude Code", agent: true, shell: false },
  },
  {
    address: "t4", pane: "p4", space: "s2", space_name: "website", tab: "c3", tab_index: 1, tab_name: "docs",
    status: "idle", title: "", cwd: "~/code/website",
    program: { key: "zsh", name: "zsh", agent: false, shell: true },
  },
  {
    address: "t5", pane: "p5", space: "s2", space_name: "website", tab: "c4", tab_index: 2, tab_name: "deploy",
    status: "working", title: "Fix the RSS feed dates", cwd: "~/code/website",
    program: { key: "claude", name: "Claude Code", agent: true, shell: false },
  },
]);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (n) => String(Math.round(n * 1000) / 1000);
const style = (parts) => parts.filter(Boolean).join(";");

/** Reads `tools/game.json` ({mod, layout}) or returns null. */
export function loadGame(root = REPO_ROOT) {
  const path = resolve(root, "tools/game.json");
  if (!existsSync(path)) return null;
  const game = JSON.parse(readFileSync(path, "utf8"));
  if (!game || typeof game.mod !== "string") throw new Error(`${path}: expected {"mod": "<mod>", "layout": "<Name>"}`);
  return game;
}

/** A theme name ("graphite", "paper", …) or a colour map. */
export function paletteOf(theme) {
  if (theme && typeof theme === "object") return theme;
  const name = theme ?? "graphite";
  if (!Object.hasOwn(THEMES, name)) throw new Error(`renderWindow: unknown theme ${JSON.stringify(name)} (have ${Object.keys(THEMES).join(", ")})`);
  return THEMES[name];
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** A layout colour: a theme token name or `#rgb[a]`/`#rrggbb[aa]`. */
export function layoutColor(value, palette) {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(`layout colour must be a string, got ${JSON.stringify(value)}`);
  if (HEX.test(value)) return value;
  if (Object.hasOwn(palette, value)) return palette[value];
  throw new Error(`layout colour ${JSON.stringify(value)} is neither a theme colour name nor #rrggbb[aa]`);
}

/** Appends an alpha byte to a #rrggbb colour (theme colours may already carry one). */
function alpha(color, a) {
  let c = color;
  if (/^#[0-9a-f]{3}$/i.test(c)) c = "#" + [...c.slice(1)].map((d) => d + d).join("");
  if (/^#[0-9a-f]{8}$/i.test(c)) {
    const base = parseInt(c.slice(7), 16) / 255;
    return c.slice(0, 7) + Math.round(base * a * 255).toString(16).padStart(2, "0");
  }
  return c.slice(0, 7) + Math.round(a * 255).toString(16).padStart(2, "0");
}

function backgroundCss(bg, palette) {
  if (bg == null) return null;
  if (typeof bg === "string") return `background:${layoutColor(bg, palette)}`;
  if (Array.isArray(bg.gradient)) {
    const [a, b] = bg.gradient;
    return `background:linear-gradient(${num(bg.angle ?? 180)}deg, ${layoutColor(a, palette)}, ${layoutColor(b, palette)})`;
  }
  if (typeof bg.image === "string") {
    const fit = bg.fit === "contain" ? "contain" : "cover";
    const path = resolve(REPO_ROOT, bg.image);
    return `background:${palette.canvas} url("file://${encodeURI(path)}") center/${fit} no-repeat`;
  }
  throw new Error(`unsupported layout background ${JSON.stringify(bg)}`);
}

function paddingCss(p, z) {
  if (p == null) return null;
  if (typeof p === "number") return `padding:${num(p * z)}px`;
  if (Array.isArray(p) && p.length === 2) return `padding:${num(p[0] * z)}px ${num(p[1] * z)}px`;
  throw new Error(`padding must be n or [vertical, horizontal], got ${JSON.stringify(p)}`);
}

const SHADOWS = {
  sm: "0 1px 2px rgba(0,0,0,.18)",
  md: "0 4px 10px rgba(0,0,0,.22)",
  lg: "0 12px 32px rgba(0,0,0,.32)",
};

// ---------------------------------------------------------------------------
// Layout parsing (src/layout.rs, docs/research/layouts-share.md §2)
// ---------------------------------------------------------------------------

/**
 * Checks and normalises a layout tree: types, unique ids (auto `node-N` like
 * herdr), float ids, size/min/max shapes. Returns a deep copy.
 */
export function parseLayout(input) {
  const root = typeof input === "string" ? JSON.parse(input) : JSON.parse(JSON.stringify(input));
  const ids = new Set();
  let auto = 0;
  const visit = (node, path) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) throw new Error(`${path}: a layout node must be an object`);
    if (!NODE_TYPES.includes(node.type)) throw new Error(`${path}: unknown node type ${JSON.stringify(node.type)} (block, row, column or stack)`);
    if (!node.id) {
      do node.id = `node-${++auto}`;
      while (ids.has(node.id));
    }
    if (ids.has(node.id)) throw new Error(`${path}: duplicate node id ${JSON.stringify(node.id)}`);
    ids.add(node.id);
    if (node.size !== undefined) {
      const s = node.size;
      const ok = s && typeof s === "object" && (typeof s.px === "number" || typeof s.weight === "number");
      if (!ok) throw new Error(`${path} (${node.id}): size must be {"px": n} or {"weight": n}`);
    }
    for (const k of ["min", "max", "gap", "radius"]) {
      if (node[k] !== undefined && typeof node[k] !== "number") throw new Error(`${path} (${node.id}): ${k} must be a number`);
    }
    if (node.type === "block") {
      if (!node.content || typeof node.content !== "object") throw new Error(`${path} (${node.id}): a block needs content`);
    } else {
      if (!Array.isArray(node.children)) throw new Error(`${path} (${node.id}): a ${node.type} needs children`);
      node.children.forEach((c, i) => visit(c, `${path}.children[${i}]`));
    }
    for (const [i, f] of (node.floating ?? []).entries()) {
      if (!f || typeof f.id !== "string" || !f.id) throw new Error(`${path} (${node.id}).floating[${i}]: a float needs an id`);
      if (!f.content) throw new Error(`${path} (${node.id}).floating[${i}]: a float needs content`);
      if (f.edge !== undefined && !["top", "right", "bottom", "left"].includes(f.edge)) throw new Error(`float ${f.id}: bad edge ${f.edge}`);
      if (f.align !== undefined && !["start", "center", "end"].includes(f.align)) throw new Error(`float ${f.id}: bad align ${f.align}`);
      if (ids.has(f.id)) throw new Error(`float ${f.id}: duplicate id`);
      ids.add(f.id);
    }
  };
  visit(root, "root");
  return root;
}

/** Every block and float (with its content) in the tree, hidden ones included. */
export function contentNodes(layout) {
  const out = [];
  const visit = (node, hidden) => {
    const h = hidden || !!node.hidden;
    if (node.type === "block") out.push({ id: node.id, content: node.content, hidden: h, float: false, node });
    for (const f of node.floating ?? []) out.push({ id: f.id, content: f.content, hidden: h || !!f.hidden, float: true, node: f });
    for (const c of node.children ?? []) visit(c, h);
  };
  visit(layout, false);
  return out;
}

// ---------------------------------------------------------------------------
// Workspace data (from a mock herdr scenario)
// ---------------------------------------------------------------------------

function workspaceOf(scenario) {
  const sc = { ...(scenario ?? {}) };
  if (!sc.agents || sc.agents.length === 0) {
    if (!sc.spaces && !sc.panes) sc.agents = DEMO_AGENTS.map((a) => ({ ...a }));
  }
  const ctl = new Controller(sc);
  const agents = ctl.agentsList;
  const spaces = ctl._spaces();
  const panes = ctl._panes();
  // cwd and branch for the pane headers / status bar (agents() has no cwd).
  const extra = new Map((sc.agents ?? []).map((a, i) => [a.pane ?? `p${i + 1}`, a]));
  for (const p of panes) {
    const a = extra.get(p.pane);
    if (p.cwd == null && a?.cwd) p.cwd = a.cwd;
  }
  const space = spaces.find((s) => s.active) ?? spaces[0] ?? null;
  const tab = space?.tabs.find((t) => t.active) ?? space?.tabs[0] ?? null;
  const shown = panes.filter((p) => p.tab === tab?.id);
  const platform = sc.window?.platform ?? "linux";
  return { agents, spaces, panes, space, tab, shown, platform, branch: sc.branch ?? space?.branch ?? "main" };
}

// ---------------------------------------------------------------------------
// Icons (simple strokes in currentColor)
// ---------------------------------------------------------------------------

const ICON_PATHS = {
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>',
  sidebar: '<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M6 3v10"/>',
  settings: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  monitor: '<rect x="2" y="3" width="12" height="8" rx="1.5"/><path d="M6 14h4M8 11v3"/>',
  branch: '<circle cx="5" cy="4" r="1.5"/><circle cx="5" cy="12" r="1.5"/><circle cx="11" cy="6" r="1.5"/><path d="M5 5.5v5M11 7.5c0 2.5-6 1.5-6 3"/>',
  folder: '<path d="M2 4.5c0-.8.7-1.5 1.5-1.5H6l1.5 1.5h5c.8 0 1.5.7 1.5 1.5v5.5c0 .8-.7 1.5-1.5 1.5h-9C2.7 13 2 12.3 2 11.5z"/>',
  file: '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/>',
  changes: '<path d="M5 2v8M2 6h6M10 12h4"/><circle cx="12" cy="5" r="2"/>',
  sort: '<path d="M3 5h10M5 8h6M7 11h2"/>',
  chevron: '<path d="M6 4l4 4-4 4"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  terminal: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5 7l2 1.5L5 10M8.5 10.5H11"/>',
  spark: '<path d="M8 2v12M2 8h12M3.8 3.8l8.4 8.4M12.2 3.8l-8.4 8.4"/>',
};

function icon(name, size, color) {
  return (
    `<svg width="${num(size)}" height="${num(size)}" viewBox="0 0 16 16" fill="none" stroke="${color ?? "currentColor"}" ` +
    `stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" style="flex:none">${ICON_PATHS[name]}</svg>`
  );
}

/** Program badge: a coloured tile with the program's initial (stands in for the program icon). */
function programIcon(program, size, t) {
  const key = program?.key ?? "";
  const colors = { claude: "#d97757", codex: t.ansi4, gemini: t.ansi5, zsh: t.dim, bash: t.dim };
  if (program?.shell || !program?.agent) return icon("terminal", size, t.dim);
  const bg = colors[key] ?? t.ansi6;
  if (key === "claude") {
    return `<svg width="${num(size)}" height="${num(size)}" viewBox="0 0 16 16" style="flex:none"><g stroke="${bg}" stroke-width="2" stroke-linecap="round">` +
      `<path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2"/></g></svg>`;
  }
  return `<span style="flex:none;width:${num(size)}px;height:${num(size)}px;border-radius:${num(size / 4)}px;background:${bg};` +
    `color:#fff;font-size:${num(size * 0.62)}px;font-weight:700;display:flex;align-items:center;justify-content:center">${esc((program?.name ?? "?")[0])}</span>`;
}

// Status marks (defaults/mods/agents/main.js:213-220, pane/main.js, tabs/main.js).
function spinner(size, color) {
  return `<span class="spin" style="width:${num(size)}px;height:${num(size)}px;border:${num(Math.max(1.2, size / 8))}px solid ${color};border-right-color:transparent"></span>`;
}

function statusMark(status, t, z) {
  if (status === "working") return spinner(12 * z, t.working);
  if (status === "blocked") {
    return `<span style="flex:none;padding:0 ${num(6 * z)}px;height:${num(18 * z)}px;display:flex;align-items:center;border-radius:${num(5 * z)}px;` +
      `background:${alpha(t.blocked, 0.15)};color:${t.blocked};font-size:${num(10.5 * z)}px;font-weight:600">Needs you</span>`;
  }
  if (status === "done") return `<span style="flex:none;width:${num(7 * z)}px;height:${num(7 * z)}px;margin:0 ${num(3 * z)}px;border-radius:50%;background:${t.done}"></span>`;
  if (status === "idle") return `<span style="flex:none;width:${num(7 * z)}px;height:${num(7 * z)}px;margin:0 ${num(3 * z)}px;border-radius:50%;border:${num(1.5 * z)}px solid ${t.idle}"></span>`;
  return "";
}

// ---------------------------------------------------------------------------
// Shipped chrome (approximations of defaults/mods/*)
// ---------------------------------------------------------------------------

function brandBar(ctx) {
  const { t, z, ws } = ctx;
  const mac = ws.platform === "macos";
  return `<div class="chrome brand" style="${style([
    "display:flex", "align-items:center", "height:100%", `background:${t.chrome}`,
    `padding:0 ${num(10 * z)}px 0 ${num((mac ? 76 : 14) * z)}px`, `gap:${num(4 * z)}px`, `font-size:${num(13.5 * z)}px`,
  ])}">` +
    `<div style="flex:1;display:flex;align-items:center;gap:${num(8 * z)}px">` +
    `<span style="width:${num(20 * z)}px;height:${num(20 * z)}px;border-radius:${num(5 * z)}px;background:linear-gradient(135deg,${t.accent},${t.ansi5});` +
    `display:flex;align-items:center;justify-content:center;color:${t.accent_foreground};font-weight:800;font-size:${num(11 * z)}px">h</span>` +
    `<span style="font-weight:600;color:${t.foreground}">Herdr</span></div>` +
    iconButton(ctx, "search") + iconButton(ctx, "sidebar") +
    `</div>`;
}

function iconButton(ctx, name, size = 15) {
  const { t, z } = ctx;
  return `<span style="flex:none;width:${num(26 * z)}px;height:${num(26 * z)}px;display:flex;align-items:center;justify-content:center;` +
    `border-radius:${num(6 * z)}px;color:${t.muted}">${icon(name, size * z)}</span>`;
}

function sidebarFooter(ctx) {
  const { t, z } = ctx;
  const row = (ic, label, dim) =>
    `<div style="display:flex;align-items:center;height:${num(28 * z)}px;padding:0 ${num(8 * z)}px;gap:${num(9 * z)}px;border-radius:${num(8 * z)}px;color:${dim ? t.dim : t.muted}">` +
    `${icon(ic, 14 * z)}<span>${esc(label)}</span></div>`;
  return `<div class="chrome footer" style="${style([
    "display:flex", "flex-direction:column", "height:100%", "box-sizing:border-box", `background:${t.chrome}`,
    `border-top:1px solid ${t.border}`, `padding:${num(4 * z)}px ${num(8 * z)}px ${num(8 * z)}px`, `font-size:${num(13 * z)}px`,
  ])}">${row("settings", "Settings", false)}${row("plus", "Add machine", true)}</div>`;
}

function listHeader(ctx, label, right) {
  const { t, z } = ctx;
  return `<div style="flex:none;display:flex;align-items:center;justify-content:space-between;height:${num(31 * z)}px;` +
    `padding:0 ${num(10 * z)}px 0 ${num(16 * z)}px;font-size:${num(11.5 * z)}px;color:${t.dim};font-weight:500">` +
    `<span>${esc(label)}</span>${right ?? ""}</div>`;
}

function spacesList(ctx) {
  const { t, z, ws } = ctx;
  const avatars = [t.ansi4, t.ansi2, t.ansi5, t.ansi3, t.ansi6, t.ansi1];
  const rows = ws.spaces.map((s, i) => {
    const active = s.active;
    const count = ws.agents.filter((a) => a.space === s.id).length;
    const branch = s.branch ?? (i === 0 ? ws.branch : "main");
    return `<div style="position:relative;display:flex;flex-direction:column;justify-content:center;gap:${num(1 * z)}px;height:${num(44 * z)}px;` +
      `padding:0 ${num(8 * z)}px;border-radius:${num(7 * z)}px;${active ? `background:${t.selected}` : ""}">` +
      `<div style="display:flex;align-items:center;gap:${num(8 * z)}px">` +
      `<span style="flex:none;width:${num(18 * z)}px;height:${num(18 * z)}px;border-radius:${num(5 * z)}px;background:${avatars[i % avatars.length]};` +
      `color:#fff;font-size:${num(10.5 * z)}px;font-weight:700;display:flex;align-items:center;justify-content:center">${esc((s.name || "?")[0].toUpperCase())}</span>` +
      `<span class="trunc" style="flex:1;color:${t.foreground}">${esc(s.name)}</span>` +
      `${s.status && s.status !== "idle" ? statusMark(s.status === "blocked" ? "done" : s.status, { ...t, done: t[s.status] }, z) : ""}` +
      `<span style="flex:none;color:${t.dim};font-size:${num(11 * z)}px">${count}</span></div>` +
      `<div style="display:flex;align-items:center;gap:${num(5 * z)}px;padding-left:${num(26 * z)}px;font-size:${num(11.5 * z)}px;color:${t.dim}">` +
      `${icon("branch", 11 * z)}<span class="trunc">${esc(branch)}</span>${i === 0 ? `<span style="color:${t.ansi2}">↑2</span>` : ""}</div></div>`;
  });
  const machine =
    `<div style="display:flex;align-items:center;height:${num(26 * z)}px;padding:0 ${num(8 * z)}px;gap:${num(7 * z)}px;font-size:${num(11 * z)}px;color:${t.dim}">` +
    `${icon("monitor", 12 * z)}<span style="flex:1">This computer</span>` +
    `<span style="width:${num(6 * z)}px;height:${num(6 * z)}px;border-radius:50%;background:${t.ansi2}"></span></div>`;
  return `<div class="chrome spaces" style="display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:${t.chrome};font-size:${num(13 * z)}px">` +
    listHeader(ctx, "Spaces", iconButton(ctx, "plus", 13)) +
    `<div style="flex:1;min-height:0;overflow:hidden;padding:0 ${num(8 * z)}px">${machine}${rows.join("")}</div></div>`;
}

function agentsList(ctx) {
  const { t, z, ws } = ctx;
  const ages = ["2m", "14m", "1h", "3m", "26m", "5h", "40s"];
  const groups = [];
  for (const a of ws.agents) {
    if (groups.at(-1)?.id === a.space) groups.at(-1).members.push(a);
    else groups.push({ id: a.space, label: a.space_name, members: [a] });
  }
  const rows = [];
  let n = 0;
  for (const g of groups) {
    rows.push(
      `<div style="display:flex;align-items:center;gap:${num(6 * z)}px;height:${num(30 * z)}px;padding:${num(8 * z)}px ${num(8 * z)}px 0;box-sizing:border-box;` +
        `font-size:${num(11 * z)}px;font-weight:500;color:${t.dim}"><span class="trunc">${esc(g.label)}</span></div>`,
    );
    for (const a of g.members) {
      const name = a.program?.agent ? a.program.name : a.title || a.program?.name || "shell";
      const sub = a.title && a.program?.agent ? a.title : a.tab_name;
      rows.push(
        `<div class="agent-row" data-status="${esc(a.status)}" style="display:flex;align-items:center;gap:${num(8 * z)}px;height:${num(30 * z)}px;padding:0 ${num(8 * z)}px;` +
          `border-radius:${num(7 * z)}px;${a.focused ? `background:${t.selected}` : ""}">` +
          `${programIcon(a.program, 14 * z, t)}` +
          `<span style="flex:none;color:${t.foreground}">${esc(name)}</span>` +
          `<span class="trunc" style="flex:1;min-width:0;color:${t.dim};font-size:${num(12 * z)}px">${esc(sub)}</span>` +
          `${statusMark(a.status, t, z)}` +
          `<span style="flex:none;font-size:${num(11 * z)}px;color:${t.dim}">${ages[n++ % ages.length]}</span></div>`,
      );
    }
  }
  const header =
    `<div style="flex:none;display:flex;align-items:center;justify-content:space-between;height:${num(41 * z)}px;box-sizing:border-box;` +
    `padding:${num(14 * z)}px ${num(16 * z)}px ${num(5 * z)}px;font-size:${num(11.5 * z)}px;font-weight:500;color:${t.dim}">` +
    `<span>Agents</span>${icon("sort", 14 * z)}</div>`;
  const empty = ws.agents.length
    ? ""
    : `<div style="padding:0 ${num(12 * z)}px;font-size:${num(12 * z)}px;color:${t.dim}">No agent status yet. Agents show up here when they report their status.</div>`;
  return `<div class="chrome agents" style="display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:${t.chrome};` +
    `border-top:1px solid ${t.border};font-size:${num(13 * z)}px">${header}${empty}` +
    `<div style="flex:1;min-height:0;overflow:hidden;padding:0 ${num(8 * z)}px">${rows.join("")}</div></div>`;
}

function tabsBar(ctx) {
  const { t, z, ws, layout } = ctx;
  const tabs = ws.space?.tabs ?? [];
  const pills = tabs.map((c) => {
    const lead = ws.panes.find((p) => p.tab === c.id && p.program?.agent) ?? ws.panes.find((p) => p.tab === c.id);
    const mark = c.status === "working" ? spinner(12 * z, t.working)
      : c.status === "blocked" || c.status === "done" ? `<span style="width:${num(6 * z)}px;height:${num(6 * z)}px;border-radius:50%;background:${t[c.status]}"></span>` : "";
    return `<div class="tab-pill" style="flex:none;display:flex;align-items:center;gap:${num(7 * z)}px;height:${num(29 * z)}px;box-sizing:border-box;` +
      `padding:0 ${num(10 * z)}px;border-radius:${num(7 * z)}px;font-size:${num(12.8 * z)}px;` +
      `border:1px solid ${c.active ? t.border : t.chrome};background:${c.active ? t.raised : t.chrome};color:${c.active ? t.foreground : t.muted}">` +
      `${lead?.program ? programIcon(lead.program, 14 * z, t) : ""}<span class="trunc" style="max-width:${num(170 * z)}px">${esc(c.name)}</span>${mark}` +
      `${c.active ? `<span style="color:${t.dim};display:flex">${icon("close", 12 * z)}</span>` : ""}</div>`;
  });
  const panel = findNode(layout, "panel");
  const body = findNode(layout, "panel-body");
  const panelButton = (id, label, ic) => {
    const on = panel && !panel.hidden && body?.active === id;
    return `<div style="flex:none;display:flex;align-items:center;gap:${num(5 * z)}px;height:${num(26 * z)}px;padding:0 ${num(8 * z)}px;` +
      `border-radius:${num(6 * z)}px;font-size:${num(12 * z)}px;background:${on ? t.selected : t.chrome};color:${on ? t.foreground : t.muted}">` +
      `${icon(ic, 14 * z)}<span>${label}</span></div>`;
  };
  const mac = ws.platform === "macos" && layout.titlebar === "none";
  const sidebar = findNode(layout, "sidebar");
  const lightsPad = mac && layout.traffic_lights ? Math.max(10, layout.traffic_lights[0] + 64 - (sidebar && !sidebar.hidden ? sidebar.size?.px ?? 0 : 0)) : 10;
  return `<div class="chrome tabs" style="${style([
    "display:flex", "align-items:center", "height:100%", "box-sizing:border-box", `background:${t.chrome}`,
    `border-bottom:1px solid ${t.border}`, `padding:0 ${num(10 * z)}px 0 ${num(lightsPad * z)}px`, `gap:${num(3 * z)}px`,
  ])}">` +
    `<div style="flex:1;min-width:0;display:flex;align-items:center;gap:${num(3 * z)}px;overflow:hidden">${pills.join("")}` +
    `<span style="flex:none;width:${num(26 * z)}px;height:${num(26 * z)}px;display:flex;align-items:center;justify-content:center;color:${t.dim};font-size:${num(16 * z)}px">+</span></div>` +
    panelButton("files", "Files", "file") + panelButton("changes", "Changes", "changes") + `</div>`;
}

function statusBar(ctx) {
  const { t, z, ws } = ctx;
  const needs = ws.agents.filter((a) => a.status === "blocked").length;
  const n = ws.agents.length;
  return `<div class="chrome status" style="${style([
    "display:flex", "align-items:center", "height:100%", "box-sizing:border-box", `background:${t.chrome}`,
    `border-top:1px solid ${t.border}`, `padding:0 ${num(14 * z)}px`, `gap:${num(16 * z)}px`, `font-size:${num(11.8 * z)}px`, `color:${t.muted}`,
  ])}">` +
    `<span style="display:flex;align-items:center;gap:${num(6 * z)}px">${icon("monitor", 13 * z)}This computer</span>` +
    `<span style="display:flex;align-items:center;gap:${num(6 * z)}px">${icon("branch", 13 * z)}${esc(ws.branch)}</span>` +
    `<span style="display:flex;align-items:center;gap:${num(6 * z)}px"><span style="width:${num(6 * z)}px;height:${num(6 * z)}px;border-radius:50%;background:${t.dim}"></span>` +
    `${n} ${n === 1 ? "agent" : "agents"}${needs ? `<span style="color:${t.blocked}">· ${needs} ${needs === 1 ? "needs" : "need"} you</span>` : ""}</span>` +
    `<span style="flex:1"></span><span style="color:${t.dim};white-space:pre">${ws.platform === "macos" ? "⇧⌘P" : "Ctrl+Shift+P"}  commands</span></div>`;
}

const FILE_TREE = [
  [0, "folder", "docs"], [0, "folder", "layouts"], [0, "folder", "mods"], [1, "folder", "engine"], [2, "file", "state.js"],
  [2, "file", "tick.js"], [2, "file", "text.js"], [1, "folder", "glue"], [1, "folder", "ui"], [1, "file", "main.js"],
  [1, "file", "mod.json"], [0, "folder", "tools"], [0, "file", "keys.json"], [0, "file", "package.json"], [0, "file", "README.md"],
  [0, "file", "RECIPE.md"],
];

function filesPanel(ctx) {
  const { t, z } = ctx;
  const rows = FILE_TREE.map(([depth, kind, name], i) =>
    `<div style="display:flex;align-items:center;gap:${num(6 * z)}px;height:${num(26 * z)}px;padding-left:${num((8 + depth * 14) * z)}px;` +
      `border-radius:${num(6 * z)}px;${i === 5 ? `background:${t.selected};color:${t.foreground}` : `color:${kind === "folder" ? t.foreground : t.muted}`}">` +
      `${icon(kind, 14 * z, kind === "folder" ? t.accent : undefined)}<span class="trunc">${esc(name)}</span></div>`,
  );
  return panelFrame(ctx, "Files", "herdr-clicker", rows.join(""));
}

function changesPanel(ctx) {
  const { t, z } = ctx;
  const changes = [["mods/engine/tick.js", 12, 4], ["mods/engine/state.js", 3, 1], ["mods/ui/shop.js", 41, 0], ["docs/BALANCE.md", 6, 6], ["test/engine.test.mjs", 58, 2]];
  const rows = changes.map(([path, add, del]) =>
    `<div style="display:flex;align-items:center;gap:${num(8 * z)}px;height:${num(28 * z)}px;padding:0 ${num(8 * z)}px;color:${t.foreground}">` +
      `${icon("file", 14 * z, t.muted)}<span class="trunc" style="flex:1">${esc(path)}</span>` +
      `<span style="color:${t.ansi2}">+${add}</span><span style="color:${t.ansi1}">−${del}</span></div>`,
  );
  return panelFrame(ctx, "Changes", `${changes.length} files`, rows.join(""));
}

function panelFrame(ctx, title, sub, body) {
  const { t, z } = ctx;
  return `<div class="chrome panel-mod" style="display:flex;flex-direction:column;height:100%;box-sizing:border-box;background:${t.background};` +
    `border:1px solid ${t.border};border-radius:${num(10 * z)}px;overflow:hidden;font-size:${num(12.5 * z)}px">` +
    `<div style="flex:none;display:flex;align-items:center;gap:${num(8 * z)}px;height:${num(36 * z)}px;padding:0 ${num(12 * z)}px;border-bottom:1px solid ${t.border}">` +
    `<span style="font-weight:600;color:${t.foreground}">${esc(title)}</span><span style="color:${t.dim}">${esc(sub)}</span></div>` +
    `<div style="flex:1;min-height:0;overflow:hidden;padding:${num(6 * z)}px">${body}</div></div>`;
}

function placeholder(ctx, label, note) {
  const { t, z } = ctx;
  return `<div class="placeholder" style="height:100%;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${num(4 * z)}px;` +
    `border:1px dashed ${t.border};border-radius:${num(8 * z)}px;color:${t.dim};font-size:${num(12 * z)}px;` +
    `background:repeating-linear-gradient(135deg, transparent 0 ${num(8 * z)}px, ${t.hover} ${num(8 * z)}px ${num(16 * z)}px)">` +
    `<span style="color:${t.muted};font-weight:600">${esc(label)}</span>${note ? `<span>${esc(note)}</span>` : ""}</div>`;
}

// ---------------------------------------------------------------------------
// Terminals and pane frames
// ---------------------------------------------------------------------------

/** Fake terminal lines: [[text, colorKey, bold?], …] per line. */
const BOX = 36;
const boxTop = "╭" + "─".repeat(BOX - 2) + "╮";
const boxBottom = "╰" + "─".repeat(BOX - 2) + "╯";
const boxLine = (spans, color) => {
  const used = spans.reduce((n, s) => n + [...s[0]].length, 2);
  return [["│ ", color], ...spans, [" ".repeat(Math.max(0, BOX - used - 1)) + "│", color]];
};

function terminalLines(pane, index, ws) {
  const cwd = pane.cwd ?? "~/code/herdr-clicker";
  const prompt = (cmd) => [[cwd, "ansi4", true], [" on ", "dim"], ["git:(" + ws.branch + ")", "ansi5"], [" ❯ ", "ansi2", true], [cmd, "fg"]];
  const program = pane.program ?? {};
  if (program.shell || !program.agent) {
    return [
      prompt("git status --short"),
      [[" M mods/engine/tick.js", "ansi3"]],
      [[" M docs/BALANCE.md", "ansi3"]],
      [["?? mods/ui/shop.js", "ansi1"]],
      prompt("npm test"),
      [["▶ engine", "fg"]],
      [["  ✔ advance is deterministic ", "ansi2"], ["(2.1ms)", "dim"]],
      [["  ✔ offline catch-up is capped at 8h ", "ansi2"], ["(0.4ms)", "dim"]],
      [["  ✔ prestige keeps unlocked tiers ", "ansi2"], ["(0.9ms)", "dim"]],
      [["ℹ tests 128 ", "fg"], ["ℹ pass 128 ", "ansi2"], ["ℹ fail 0", "dim"]],
      prompt(""),
    ];
  }
  const name = program.name ?? "Claude Code";
  const task = pane.title || "Tidy up the engine module";
  const head = [
    prompt(program.key ?? "claude"),
    [[boxTop, "accent"]],
    boxLine([["✻ ", "ansi3"], [`Welcome to ${name}!`, "fg", true]], "accent"),
    [[boxBottom, "accent"]],
    [],
    [["> ", "dim"], [task.charAt(0).toLowerCase() + task.slice(1), "fg"]],
    [],
    [["● ", "ansi2"], ["Read", "fg", true], ["(mods/engine/tick.js)", "dim"]],
    [["  ⎿  Read 142 lines", "dim"]],
    [["● ", "ansi2"], ["Update", "fg", true], ["(mods/engine/tick.js)", "dim"]],
    [["  ⎿  Updated mods/engine/tick.js with 12 additions and 4 removals", "dim"]],
    [["     41 ", "dim"], ["-  for (let i = 0; i < steps; i++) state = step(state);", "ansi1"]],
    [["     41 ", "dim"], ["+  state = advanceClosedForm(state, dt);", "ansi2"]],
    [["● ", "ansi2"], ["Bash", "fg", true], ["(npm test)", "dim"]],
    [["  ⎿  ✔ 128 passing ", "ansi2"], ["(1.4s)", "dim"]],
    [],
  ];
  const input = [[boxTop, "dim"]];
  const cursor = boxLine([["> ", "dim"], ["█", "cursor"]], "dim");
  if (pane.status === "blocked") {
    return [
      ...head,
      [["╭─ ", "ansi3"], ["Edit file", "ansi3", true]],
      [["│ ", "ansi3"], ["Do you want to make this edit to ", "fg"], ["shop.js", "fg", true], ["?", "fg"]],
      [["│ ", "ansi3"], ["❯ 1. Yes", "accent", true]],
      [["│ ", "ansi3"], ["  2. Yes, allow all edits this session", "fg"]],
      [["│ ", "ansi3"], ["  3. No, and tell Claude what to do differently", "fg"]],
      [["╰─", "ansi3"]],
    ];
  }
  if (pane.status === "done") {
    return [
      ...head,
      [["● ", "fg"], ["Done. The save codec now rejects damaged files and keeps a backup.", "fg"]],
      [],
      input, cursor, [[boxBottom, "dim"]],
      [["  ? for shortcuts", "dim"]],
    ];
  }
  if (pane.status === "idle") {
    return [...head.slice(0, 5), input, cursor, [[boxBottom, "dim"]], [["  ? for shortcuts", "dim"]]];
  }
  return [
    ...head,
    [["✻ ", index % 2 ? "ansi5" : "ansi3"], ["Thinking… ", "ansi3"], ["(", "dim"], ["esc", "dim", true], [" to interrupt · 38s · ↓ 2.1k tokens)", "dim"]],
  ];
}

function terminal(ctx, pane, index) {
  const { t, z, layout } = ctx;
  const [px, py] = layout.terminal_padding ?? [10, 6];
  const color = (k) => (k === "fg" ? t.terminal_foreground : k === "cursor" ? t.cursor : t[k] ?? t.terminal_foreground);
  const lines = terminalLines(pane, index, ctx.ws).map((spans) =>
    `<div class="tl">${spans.length ? spans.map(([text, k, bold]) => `<span style="color:${color(k)}${bold ? ";font-weight:700" : ""}">${esc(text)}</span>`).join("") : "&nbsp;"}</div>`,
  );
  return `<div class="terminal" style="height:100%;box-sizing:border-box;overflow:hidden;padding:${num(py * z)}px ${num(px * z)}px;` +
    `font-family:var(--mono);font-size:${num(13 * z)}px;line-height:1.35;color:${t.terminal_foreground};white-space:pre">${lines.join("")}</div>`;
}

function paneHeader(ctx, pane, frame, height) {
  const { t, z } = ctx;
  const bottom = frame.header?.position === "bottom";
  const name = pane.name || ((pane.program?.agent || pane.program?.shell) && pane.program.name) || pane.title || pane.program?.name || "shell";
  const header = frame.header?.content;
  if (header && typeof header === "object" && header.mod && header.mod !== "pane") {
    return `<div class="pane-header" style="flex:none;height:${num(height)}px">${blockContent(ctx, { id: `pane-header-${pane.pane}`, content: header })}</div>`;
  }
  return `<div class="pane-header" style="${style([
    "flex:none", "display:flex", "align-items:center", `height:${num(height)}px`, "box-sizing:border-box",
    `padding:0 ${num(10 * z)}px`, `gap:${num(8 * z)}px`, `background:${t.background}`,
    bottom ? `border-top:1px solid ${t.border}` : `border-bottom:1px solid ${t.border}`, `font-size:${num(12 * z)}px`,
  ])}">${programIcon(pane.program, 14 * z, t)}` +
    `<span class="trunc" style="flex:none;max-width:${num(260 * z)}px;font-weight:500;color:${t.foreground}">${esc(name)}</span>` +
    `<span class="trunc" style="flex:1;color:${t.dim}">${esc(pane.cwd ?? "")}</span>` +
    `${pane.status === "idle" ? "" : statusMark(pane.status, t, z)}</div>`;
}

/** Splits n panes into a simple grid like herdr's default splits. */
function paneGrid(panes, gap, render) {
  const g = `${num(gap)}px`;
  const col = (items) => `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:${g}">${items.join("")}</div>`;
  const cells = panes.map(render);
  if (cells.length <= 1) return cells.join("");
  if (cells.length === 2) return `<div style="display:flex;gap:${g};height:100%">${cells.join("")}</div>`;
  const left = cells.slice(0, Math.ceil(cells.length / 2) - (cells.length === 3 ? 1 : 0));
  const right = cells.slice(left.length);
  return `<div style="display:flex;gap:${g};height:100%">${col(left)}${col(right)}</div>`;
}

function tabContent(ctx, content) {
  const { t, z, ws } = ctx;
  const frame = content.pane ?? null;
  const panes = ws.shown.length ? ws.shown : [];
  if (!panes.length) return placeholder(ctx, "No panes", "this tab is empty");
  const framed = frame && (panes.length > 1 || frame.lone);
  const gap = (frame?.gap ?? 0) * z;
  const cell = (p, i) => {
    if (!framed) return `<div class="pane" data-pane="${esc(p.pane)}" style="flex:1;min-height:0;min-width:0;height:100%">${terminal(ctx, p, i)}</div>`;
    const focused = p.focused;
    const border = focused && frame.focus?.width ? frame.focus : frame.border;
    const bw = (border?.width ?? 0) * z;
    const headerH = (frame.header ? frame.header.height ?? HEADER_HEIGHT : 0) * z;
    const head = frame.header ? paneHeader(ctx, p, frame, headerH) : "";
    const body = `<div style="flex:1;min-height:0;position:relative">${terminal(ctx, p, i)}` +
      `${frame.veil && !focused ? `<div style="position:absolute;inset:0;background:${alpha(t.background, frame.veil)}"></div>` : ""}</div>`;
    return `<div class="pane" data-pane="${esc(p.pane)}" style="${style([
      "flex:1", "min-height:0", "min-width:0", "display:flex", "flex-direction:column", "box-sizing:border-box", "overflow:hidden",
      frame.background ? backgroundCss(frame.background, t) : "",
      bw ? `border:${num(bw)}px solid ${layoutColor(border.color ?? "border", t)}` : "",
      frame.radius ? `border-radius:${num(frame.radius * z)}px` : "",
      frame.shadow ? `box-shadow:${SHADOWS[frame.shadow]}` : "",
    ])}">${frame.header?.position === "bottom" ? body + head : head + body}</div>`;
  };
  return `<div class="tab-block" style="height:100%">${paneGrid(panes, gap, cell)}</div>`;
}

// ---------------------------------------------------------------------------
// Block content dispatch
// ---------------------------------------------------------------------------

function modFragment(ctx, id, mod) {
  const entry = ctx.modBlocks?.[id] ?? ctx.modBlocks?.["*"];
  if (entry == null) return placeholder(ctx, mod, `no fragment for block "${id}"`);
  const html = typeof entry === "string" ? entry : entry.html;
  return `<div class="mod-block" data-mod="${esc(mod)}" data-block="${esc(id)}" style="position:relative;width:100%;height:100%;overflow:hidden">${html}</div>`;
}

function blockContent(ctx, node) {
  const c = node.content;
  if (typeof c.mod === "string") {
    if (ctx.gameMod && c.mod === ctx.gameMod) return modFragment(ctx, node.id, c.mod);
    switch (c.mod) {
      case "workspace-chrome": return c.props?.footer ? sidebarFooter(ctx) : brandBar(ctx);
      case "spaces": return spacesList(ctx);
      case "agents": return agentsList(ctx);
      case "tabs": return tabsBar(ctx);
      case "workspace-status": return statusBar(ctx);
      case "files": return filesPanel(ctx);
      case "changes": return changesPanel(ctx);
      default:
        if (ctx.modBlocks && Object.hasOwn(ctx.modBlocks, node.id)) return modFragment(ctx, node.id, c.mod);
        return placeholder(ctx, c.mod, "mod");
    }
  }
  if (c.tab !== undefined || c.context !== undefined) return tabContent(ctx, { ...c, pane: c.pane });
  if (typeof c.terminal === "string") {
    const p = ctx.ws.panes.find((x) => x.terminal === c.terminal) ?? { pane: c.terminal, terminal: c.terminal, program: { shell: true } };
    return terminal(ctx, p, 0);
  }
  if (c.agent !== undefined) {
    const p = ctx.ws.panes.find((x) => x.focused) ?? ctx.ws.panes[0];
    return p ? terminal(ctx, p, 0) : placeholder(ctx, "agent", "no focused agent");
  }
  throw new Error(`block ${node.id}: unknown content ${JSON.stringify(c)}`);
}

// ---------------------------------------------------------------------------
// Node layout
// ---------------------------------------------------------------------------

function findNode(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return null;
}

/** Flex item sizing of `node` inside a parent laid out along `axis` ("row" | "column" | null). */
function itemCss(node, axis, z) {
  const parts = ["position:relative", "box-sizing:border-box", "min-width:0", "min-height:0"];
  if (axis === null) {
    parts.push("width:100%", "height:100%");
    return parts;
  }
  const size = node.size ?? { weight: 1 };
  if (typeof size.px === "number") parts.push(`flex:0 0 ${num(size.px * z)}px`);
  else parts.push(`flex:${num(size.weight)} 1 0px`);
  const dim = axis === "row" ? "width" : "height";
  if (typeof node.min === "number") parts.push(`min-${dim}:${num(node.min * z)}px`);
  if (typeof node.max === "number") parts.push(`max-${dim}:${num(node.max * z)}px`);
  return parts;
}

function lookCss(node, ctx) {
  const { t, z } = ctx;
  const parts = [];
  if (node.background !== undefined) parts.push(backgroundCss(node.background, t));
  if (node.radius) parts.push(`border-radius:${num(node.radius * z)}px`, "overflow:hidden");
  if (node.border) parts.push(`border:${num((node.border.width ?? 1) * z)}px solid ${layoutColor(node.border.color ?? "border", t)}`);
  if (node.shadow) parts.push(`box-shadow:${SHADOWS[node.shadow] ?? SHADOWS.md}`);
  if (node.padding !== undefined) parts.push(paddingCss(node.padding, z));
  return parts;
}

function renderNode(node, ctx, axis) {
  if (node.hidden) return "";
  const { z } = ctx;
  const parts = [...itemCss(node, axis, z), ...lookCss(node, ctx), "overflow:hidden"];
  let inner = "";
  if (node.type === "row" || node.type === "column") {
    const dir = node.type;
    parts.push("display:flex", `flex-direction:${dir}`);
    if (node.gap) parts.push(`gap:${num(node.gap * z)}px`);
    const visible = node.children.filter((c) => !c.hidden);
    const divider = node.divider
      ? `<div class="divider" style="flex:none;${dir === "row" ? "width" : "height"}:${num((node.divider.width ?? 1) * z)}px;` +
        `background:${layoutColor(node.divider.color ?? "border", ctx.t)}"></div>`
      : "";
    inner = visible.map((c) => renderNode(c, ctx, dir)).join(divider);
  } else if (node.type === "stack") {
    parts.push("display:flex", "flex-direction:column");
    const visible = node.children.filter((c) => !c.hidden);
    const active = visible.find((c) => c.id === node.active) ?? visible[0];
    const header = node.header ? stackHeader(node, visible, active, ctx) : "";
    const body = active ? `<div style="flex:1;min-height:0;position:relative">${renderNode(active, ctx, null)}</div>` : "";
    inner = node.header?.position === "bottom" ? body + header : header + body;
  } else {
    inner = blockContent(ctx, node);
  }
  const floats = (node.floating ?? []).filter((f) => !f.hidden).map((f) => renderFloat(f, ctx)).join("");
  return `<div class="node node-${node.type}" data-node="${esc(node.id)}" style="${style(parts)}">${inner}${floats}</div>`;
}

function stackHeader(node, visible, active, ctx) {
  const { t, z } = ctx;
  const h = (node.header.height ?? HEADER_HEIGHT) * z;
  const content = node.header.content;
  if (content && typeof content === "object" && content.mod) {
    return `<div class="stack-header" style="flex:none;height:${num(h)}px">${blockContent(ctx, { id: `${node.id}-header`, content })}</div>`;
  }
  const items = visible.map((c, i) =>
    `<span style="padding:0 ${num(10 * z)}px;height:100%;display:flex;align-items:center;${c === active ? `color:${t.foreground};box-shadow:inset 0 -2px ${t.accent}` : `color:${t.muted}`}">` +
      `${esc(c.title ?? String(i + 1))}</span>`,
  );
  return `<div class="stack-header" style="flex:none;display:flex;height:${num(h)}px;font-size:${num(12 * z)}px;background:${t.chrome};` +
    `border-bottom:1px solid ${t.border}">${items.join("")}</div>`;
}

function renderFloat(f, ctx) {
  const { t, z } = ctx;
  const edge = f.edge ?? "right";
  const align = f.align ?? "center";
  const m = num(FLOAT_MARGIN * z);
  const entry = ctx.modBlocks?.[f.id];
  let w;
  let h;
  if (f.content?.terminal) ({ width: w, height: h } = TERMINAL_FLOAT);
  else if (entry && typeof entry === "object") ({ width: w, height: h } = entry);
  w = (w ?? 280) * z;
  h = (h ?? 180) * z;
  const box = { id: f.id, content: f.content };
  const parts = ["position:absolute", "z-index:10", `width:${num(w)}px`, `height:${num(h)}px`];
  const side = edge === "left" || edge === "right";
  const alignCss = (a, startProp, endProp, axisSize) =>
    a === "start" ? `${startProp}:${m}px` : a === "end" ? `${endProp}:${m}px` : `${startProp}:calc(50% - ${num(axisSize / 2)}px)`;
  if (side) parts.push(alignCss(align, "top", "bottom", h + 2 * FRAME_PAD * z));
  else parts.push(alignCss(align, "left", "right", w));
  const peek = side && typeof f.peek === "number" && !ctx.drawersOpen ? f.peek * z : null;
  if (peek !== null) parts.push(`${edge}:${num(peek - w)}px`);
  else parts.push(`${edge}:${m}px`);
  const frame = style([
    "box-sizing:content-box", `padding:${num(FRAME_PAD * z)}px 0`, `background:${t.popover}`, `border:1px solid ${t.border}`,
    `border-radius:${num(12 * z)}px`, `box-shadow:${SHADOWS.lg}`, "overflow:hidden",
  ]);
  return `<div class="float" data-float="${esc(f.id)}" data-edge="${edge}" style="${style(parts)};${frame}">` +
    `<div style="width:100%;height:100%;position:relative">${blockContent(ctx, box)}</div></div>`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * A complete HTML document of the whole window.
 *
 * Options:
 * - `layoutPath` (JSON file) or `layout` (object or JSON text); default MAIN_LAYOUT.
 * - `width`, `height` CSS px (1440 x 900).
 * - `theme`: "graphite" | "paper" | any name in tools/mock/themes.json, or a colour map.
 * - `scenario`: a mock herdr scenario (agents, spaces, panes, window.platform, branch);
 *   without agents a demo workspace (DEMO_AGENTS) is shown.
 * - `modBlocks`: {<block or float id>: html | {html, width, height}} for the game mod's
 *   blocks (`"*"` matches any game block); width/height size a float.
 * - `gameMod`: the game's mod folder (default: tools/game.json `mod`).
 * - `zoom` (1), `drawersOpen` (false: floats with `peek` show only `peek` px).
 */
export function renderWindow(options = {}) {
  const width = options.width ?? 1440;
  const height = options.height ?? 900;
  const z = options.zoom ?? 1;
  const t = paletteOf(options.theme ?? "graphite");
  let source = options.layout ?? null;
  if (!source && options.layoutPath) source = readFileSync(options.layoutPath, "utf8");
  const layout = parseLayout(source ?? MAIN_LAYOUT);
  const gameMod = options.gameMod !== undefined ? options.gameMod : loadGame()?.mod ?? null;
  const ctx = {
    t, z, layout, gameMod, ws: workspaceOf(options.scenario),
    modBlocks: options.modBlocks ?? {}, drawersOpen: !!options.drawersOpen,
  };
  const body = renderNode(layout, ctx, null);
  const lights = ctx.ws.platform === "macos" && layout.titlebar === "none" && Array.isArray(layout.traffic_lights)
    ? trafficLights(layout.traffic_lights, z)
    : "";
  const css = [
    "html,body{margin:0;padding:0}",
    `html,body{width:${width}px;height:${height}px;overflow:hidden;background:${t.canvas}}`,
    `:root{--mono:"JetBrains Mono","Geist Mono","DejaVu Sans Mono","Menlo",monospace}`,
    `.window{position:relative;width:${width}px;height:${height}px;overflow:hidden;color:${t.foreground};` +
      `font-family:"Geist","Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:${num(13 * z)}px;line-height:1.3;` +
      "-webkit-font-smoothing:antialiased}",
    ".trunc{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;min-width:0}",
    ".tl{height:1.35em;overflow:hidden}",
    ".spin{flex:none;box-sizing:border-box;border-radius:50%;display:inline-block;transform:rotate(-30deg)}",
  ].join("\n");
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta name="viewport" content="width=${width}, initial-scale=1"><title>window</title><style>${css}</style></head>` +
    `<body><div class="window" data-theme="${esc(typeof options.theme === "string" ? options.theme : "custom")}">${body}${lights}</div>` +
    `<script>${PATH_SCRIPT}</script></body></html>`
  );
}

function trafficLights([x, y], z) {
  const colors = ["#ff5f57", "#febc2e", "#28c840"];
  return colors
    .map((c, i) => `<span style="position:absolute;left:${num((x + i * 20) * z)}px;top:${num((y - 6) * z)}px;width:${num(12 * z)}px;height:${num(12 * z)}px;` +
      `border-radius:50%;background:${c};z-index:20"></span>`)
    .join("");
}

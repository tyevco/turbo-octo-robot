#!/usr/bin/env node
// Builds layouts/<Name>.json (DESIGN §2.5) from herdr's shipped main layout.
//
//   node tools/layout/build.mjs           write layouts/<Name>.json
//   node tools/layout/build.mjs --check   exit 1 if the file differs from what would be written
//
// Input: tools/layout/main.json, a byte-identical copy of herdr-app 0.1.18
// `defaults/layouts/main.json` (Apache-2.0). Every node and root field of it is
// kept; the build adds and changes exactly:
//   root      "preview": mods/<mod>/art/layout-preview.png (travels with the mod folder)
//   main      "min": 80 (MAIN_MIN: a drag never squeezes the terminals below 80 px)
//   panel     (herdr's Files/Changes column) "size": {"weight": 0.66} instead of {"px": 368}
//   work-body "cw-panel": the game, {"weight": 0.39}, min 64 (folds to a 64 px rail),
//             right after main and BEFORE the Files column (main | cw-panel | panel)
//   work      "cw-ribbon" (30 px) between work-body and status
// Why weights (ARCHITECTURE B15): herdr makes a {px} node flex_none, and min/max
// only add min_w/max_w (src/window.rs sized()), so a {px} node never gives way
// and a narrow window or zoom 1.5 pushes the last node of the row off-screen.
// Weight nodes shrink to their min first. No max on cw-panel: herdr keeps grow
// factors normalised after a node freezes at its max, so a capped weight node
// leaves the rest of its share empty (src/window/pane_size.rs shares()). 0.39
// gives the game 322 px and Files 367 px at 1440 x 900, close to the shipped
// 368 and the designed 320; at 1100 x 700 the game is 226 px (DESIGN §2.4
// Narrow) and on big windows it keeps growing (1920: 456, 2560: 636).
// Why cw-panel sits before Files (r2-15): herdr renders every container
// overflow_hidden and never wraps a row, so a row whose mins do not fit is
// clipped at its END. With Files open the mins are (80 + 64 + 280) x zoom, which
// a window narrower than about 724 x zoom px cannot hold (1100 px from zoom 1.6,
// 1440 px from zoom 2.0; herdr's zoom goes to 3.0). Ending the row with the
// optional Files column makes herdr clip Files first: main and the game (at
// least the 64 px rail) stay whole while work-body's content box holds
// (80 + 64 + one 8 px gap) x zoom (test/layout "past zoom 1.5").
// Why main's min is 80, not 360: herdr's main has no min; ours only stops a drag.
// The smallest window we support, 1100 x 700 at zoom 1.5 with Files open, has
// 649 px for main + Files (280 x 1.5) + the rail (64 x 1.5): main gets 133 px
// (88 design px). Any min above 88 makes main hold its min there and cut the
// Files column (before r2-15: the game, r1-32); 80 keeps everything on screen
// with a little slack. Raising it would not widen the terminals in any window
// where everything fits; past that it only trades Files width for main width.
// At zoom 1 the terminals never come near it (1100 x 700 with Files: 373 px).
// Field names are src/layout.rs's; tools/layout/schema.mjs checks the result.
// <mod> and <Name> come from tools/game.json.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateLayout } from "./schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "../..");
export const MAIN_PATH = resolve(HERE, "main.json");

export function readGame(root = ROOT) {
  return JSON.parse(readFileSync(resolve(root, "tools/game.json"), "utf8"));
}

export function readMain(path = MAIN_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const clone = (x) => JSON.parse(JSON.stringify(x));

/** A copy of `obj` with `key: value` inserted right before `before` (or at the end). */
function insertBefore(obj, before, key, value) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === before) out[key] = value;
    if (k !== key) out[k] = v;
  }
  if (!(key in out)) out[key] = value;
  return out;
}

function find(node, id) {
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const f = find(c, id);
    if (f) return f;
  }
  return null;
}

function need(root, id) {
  const n = find(root, id);
  if (!n) throw new Error(`main.json has no node "${id}"`);
  return n;
}

/** main's min (design px): fits 1100 x 700 at zoom 1.5 with Files open (header). */
export const MAIN_MIN = 80;
/** The game panel's weight beside main (weight 1): 322 px at 1440 x 900 (glue/commands.js DEFAULT_PANEL_WEIGHT). */
export const PANEL_WEIGHT = 0.39;
/** The folded panel (glue/commands.js RAIL_WEIGHT): a weight so small that cw-panel's 64 px min always wins. */
export const RAIL_WEIGHT = 0.001;
/** herdr's Files/Changes column as a weight: 367 px at 1440 x 900 with the game panel open (shipped: 368 px). */
export const FILES_WEIGHT = 0.66;

/** The game's two blocks (DESIGN §2.1, §2.5). */
export function gameNodes(mod) {
  return {
    panel: {
      id: "cw-panel", type: "block", size: { weight: PANEL_WEIGHT }, min: 64,
      radius: 10, border: { width: 1, color: "border" }, background: "chrome",
      content: { mod, props: { role: "panel" } },
    },
    ribbon: {
      id: "cw-ribbon", type: "block", size: { px: 30 }, background: "chrome",
      content: { mod, props: { role: "ribbon" } },
    },
  };
}

/** Builds the layout object from the shipped main layout. Pure. */
export function buildLayout(main, { mod }) {
  let root = clone(main);
  root = insertBefore(root, "children", "preview", `mods/${mod}/art/layout-preview.png`);

  const work = need(root, "work");
  const workBody = need(root, "work-body");
  const status = need(root, "status");
  const mainNode = need(root, "main");
  if (!work.children.includes(workBody) || !work.children.includes(status)) {
    throw new Error("main.json changed shape: work-body and status are no longer children of work");
  }
  if (!workBody.children.includes(mainNode)) throw new Error("main.json changed shape: main is no longer in work-body");

  // main: "min" right after "type", as DESIGN §2.5 writes it.
  const mainIndex = workBody.children.indexOf(mainNode);
  const { id, type, ...rest } = mainNode;
  workBody.children[mainIndex] = { id, type, min: MAIN_MIN, ...rest };

  // herdr's Files/Changes column shrinks by weight (to its own min 280) instead of
  // pushing the game panel off-screen; every other field of it is kept.
  const files = need(root, "panel");
  if (!workBody.children.includes(files)) throw new Error("main.json changed shape: panel is no longer in work-body");
  if (!files.size || typeof files.size.px !== "number") throw new Error("main.json changed shape: panel is no longer {px}-sized");
  files.size = { weight: FILES_WEIGHT };

  // The game goes right after main, before Files: a too-tight row is clipped at
  // its end, so the optional Files column is what herdr cuts first (r2-15).
  const { panel, ribbon } = gameNodes(mod);
  workBody.children.splice(workBody.children.indexOf(files), 0, panel);
  work.children.splice(work.children.indexOf(status), 0, ribbon);
  return root;
}

/** The file text: two-space JSON like the shipped layouts, with a final newline. */
export function layoutText(layout) {
  return `${JSON.stringify(layout, null, 2)}\n`;
}

export function outputPath(root = ROOT, game = readGame(root)) {
  return resolve(root, "layouts", `${game.layout}.json`);
}

/** Builds and validates; returns {path, text}. Throws on a layout herdr would not read as meant. */
export function build({ root = ROOT, mainPath = MAIN_PATH } = {}) {
  const game = readGame(root);
  const layout = buildLayout(readMain(mainPath), game);
  const problems = validateLayout(layout);
  if (problems.length) throw new Error(`built layout is invalid:\n  ${problems.join("\n  ")}`);
  return { path: outputPath(root, game), text: layoutText(layout) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { path, text } = build();
  if (process.argv.includes("--check")) {
    let current = null;
    try { current = readFileSync(path, "utf8"); } catch {}
    if (current !== text) {
      console.error(`${path} is out of date: run node tools/layout/build.mjs`);
      process.exit(1);
    }
    console.log(`${path} is up to date`);
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    console.log(`wrote ${path}`);
  }
}

#!/usr/bin/env node
// Builds layouts/<Name>.json (DESIGN §2.5) from herdr's shipped main layout.
//
//   node tools/layout/build.mjs           write layouts/<Name>.json
//   node tools/layout/build.mjs --check   exit 1 if the file differs from what would be written
//
// Input: tools/layout/main.json, a byte-identical copy of herdr-app 0.1.18
// `defaults/layouts/main.json` (Apache-2.0). Every node and root field of it is
// kept; the build adds exactly:
//   root      "preview": mods/<mod>/art/layout-preview.png (travels with the mod folder)
//   main      "min": 360 (a drag never squeezes the terminals below 360 px)
//   work-body last child "cw-panel": the game, 320 px, folds to a 64 px rail
//   work      "cw-ribbon" (30 px) between work-body and status
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

/** The game's two blocks (DESIGN §2.1, §2.5). */
export function gameNodes(mod) {
  return {
    panel: {
      id: "cw-panel", type: "block", size: { px: 320 }, min: 64, max: 560,
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

  // main: "min": 360 right after "type", as DESIGN §2.5 writes it.
  const mainIndex = workBody.children.indexOf(mainNode);
  const { id, type, ...rest } = mainNode;
  workBody.children[mainIndex] = { id, type, min: 360, ...rest };

  const { panel, ribbon } = gameNodes(mod);
  workBody.children.push(panel);
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

// Shared paths and readers for test/layout/*.test.mjs.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const at = (...p) => resolve(ROOT, ...p);
export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

export const GAME = readJson(at("tools/game.json"));
export const LAYOUT_PATH = at("layouts", `${GAME.layout}.json`);
export const MOD_DIR = at("mods", GAME.mod);
export const REF = readJson(at("tools/layout/herdr-defaults.json"));
export const MAIN = readJson(at("tools/layout/main.json"));

// herdr-app 0.1.18's source, when the research checkout is present: the
// committed copies above are checked against it.
export const HERDR_SRC =
  "/tmp/claude-0/-home-user-turbo-octo-robot/765765b0-bd4e-5d4c-890a-1f1834a9bff2/scratchpad/herdr-src";
export const HAVE_HERDR = existsSync(resolve(HERDR_SRC, "src/layout.rs"));

export const isDir = (p) => {
  try { return statSync(p).isDirectory(); } catch { return false; }
};

/** The JSON code blocks of a DESIGN.md section (from its heading to the next `### `/`## `). */
export function designJsonBlocks(heading) {
  const text = readFileSync(at("docs/DESIGN.md"), "utf8");
  const start = text.indexOf(heading);
  if (start < 0) throw new Error(`DESIGN.md has no heading ${heading}`);
  const rest = text.slice(start + heading.length);
  const end = rest.search(/\n#{2,3} /);
  const section = end < 0 ? rest : rest.slice(0, end);
  return [...section.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
}

/** Mods a layout may name: herdr's shipped ones and this repo's game mod. */
export const KNOWN_MODS = new Set([...REF.shippedMods, GAME.mod]);

// The art folder matches DESIGN §13.3 exactly, every art name DESIGN mentions
// exists, and the generator is deterministic and in sync with the files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAssets, ART_DIR } from "../../tools/art/generate.mjs";
import { listArt } from "../../tools/art/check-svg.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DESIGN = readFileSync(join(ROOT, "docs/DESIGN.md"), "utf8");

/** Brace expansion: {a,b} and {0..7}, left to right. */
export function expand(pattern) {
  const m = /\{([^{}]*)\}/.exec(pattern);
  if (!m) return [pattern];
  const range = /^(\d+)\.\.(\d+)$/.exec(m[1]);
  const options = range
    ? Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => String(Number(range[1]) + i))
    : m[1].split(",");
  return options.flatMap((o) => expand(pattern.slice(0, m.index) + o + pattern.slice(m.index + m[0].length)));
}

function section133() {
  const start = DESIGN.indexOf("### 13.3");
  const end = DESIGN.indexOf("### 13.4");
  assert.ok(start > 0 && end > start, "DESIGN §13.3 not found");
  return DESIGN.slice(start, end);
}

/** The SVG files the §13.3 table lists (first column, backticked patterns). */
function designFiles() {
  const rows = section133().split("\n").filter((l) => l.startsWith("| `"));
  const firstCells = rows.map((r) => r.split("|")[1]);
  const patterns = firstCells.flatMap((c) => [...c.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
  const folkPattern = patterns.find((p) => p.startsWith("folk/{"));
  const species = expand(folkPattern).map((f) => f.slice(5, -4));
  const files = patterns.flatMap((p) => (p.includes("*") ? species.map((s) => p.replace("*", s)) : [p])).flatMap(expand);
  return { files, species };
}

test("DESIGN §13.3 lists 12 species and 139 SVG files (+ layout-preview.png)", () => {
  const { files, species } = designFiles();
  assert.equal(species.length, 12);
  const svgs = files.filter((f) => f.endsWith(".svg"));
  assert.equal(new Set(svgs).size, svgs.length, "duplicate names in the table");
  // The table's rows sum to 139 SVGs (120 before the Pattern book's 18 fold
  // layers and its tab glyph, DESIGN §4.7). The rows are the authority.
  assert.equal(svgs.length, 139);
  assert.deepEqual(files.filter((f) => !f.endsWith(".svg")), ["layout-preview.png"]);
});

test("the art folder holds exactly the SVGs DESIGN §13.3 lists", () => {
  const want = designFiles().files.filter((f) => f.endsWith(".svg")).sort();
  assert.deepEqual(listArt(ART_DIR), want);
});

test("the generator produces exactly the §13.3 files", () => {
  const want = designFiles().files.filter((f) => f.endsWith(".svg")).sort();
  assert.deepEqual(buildAssets().map((a) => a.path).sort(), want);
});

test("every art name referenced anywhere in DESIGN exists", () => {
  const refs = new Set();
  for (const m of DESIGN.matchAll(/\b((?:folk|sheet|status|scene|workshops|ui)\/[A-Za-z0-9{},.*<>-]+)/g)) {
    let ref = m[1].replace(/[.,]+$/, "");
    if (/\.(js|json|png)$/.test(ref)) continue;
    if ((ref.match(/\{/g) ?? []).length !== (ref.match(/\}/g) ?? []).length) continue; // wrapped line
    if (!ref.endsWith(".svg")) ref += ".svg";
    ref = ref.replace("<f>", "{0..7}");
    if (ref.includes("*")) {
      for (const s of designFiles().species) refs.add(ref.replace("*", s));
    } else refs.add(ref);
  }
  for (const m of DESIGN.matchAll(/\b(notify-icon|logo)\.svg/g)) refs.add(m[0]);
  const names = [...refs].flatMap(expand);
  assert.ok(names.length >= 120, `only ${names.length} references found`);
  const missing = names.filter((n) => !existsSync(join(ART_DIR, n)));
  assert.deepEqual(missing, []);
});

test("the notify call's icon path points at the shipped file", () => {
  const m = /icon: "mods\/creaseworks\/art\/([^"]+)"/.exec(DESIGN);
  assert.ok(m, "notify icon path not found in DESIGN");
  assert.ok(existsSync(join(ART_DIR, m[1])));
});

test("generation is deterministic and the files on disk are up to date", () => {
  const a = buildAssets(), b = buildAssets();
  assert.deepEqual(a.map((x) => x.svg), b.map((x) => x.svg));
  const stale = a.filter((x) => readFileSync(join(ART_DIR, x.path), "utf8") !== x.svg).map((x) => x.path);
  assert.deepEqual(stale, [], "run `node tools/art/generate.mjs`");
});

test("r3-20: the garland strand matches the String card's row grid (STRAND.w × STRAND.h, STRAND.rows cranes, a gap at every row edge)", async () => {
  const { STRAND } = await import("../../mods/creaseworks/ui/string.js");
  const a = buildAssets().find((x) => x.path === "ui/garland-strand.svg");
  assert.ok(a, "ui/garland-strand.svg is generated");
  assert.equal(a.w, STRAND.w);
  assert.equal(a.h, STRAND.h);
  const pitch = STRAND.h / STRAND.rows;
  assert.ok(Number.isInteger(pitch), "a whole-unit crane row");
  const parts = a.shapes[0].parts;
  assert.equal(parts.length, STRAND.rows);
  // The fill is clipped only at whole multiples of the pitch: no crane may
  // touch one, or the clip edge would cut it.
  parts.forEach((part, i) => {
    const ys = part.p.map((pt) => pt[1]);
    assert.ok(Math.min(...ys) > i * pitch && Math.max(...ys) < (i + 1) * pitch, `crane ${i}: ${Math.min(...ys)}..${Math.max(...ys)}`);
  });
});

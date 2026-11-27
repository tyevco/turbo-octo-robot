// Sprites (DESIGN §13.1, §13.3, §13.4). Every sprite is a one-colour SVG drawn
// with `svg(path)` and tinted by `text_color`. Asset paths resolve against
// herdr's application directory, not this file, so they are always
// "mods/creaseworks/art/<folder>/<name>.svg" (gpui-ui §3).
//
// FACETS: "alpha" draws a faceted sprite (the folk species) as one file whose
// facets are alpha steps 1 / 0.78 / 0.56. "split" layers the generated
// <name>-a/-b/-c files tinted c, mix(c, surface, 0.22), mix(c, surface, 0.44)
// for hosts where the alpha steps flatten (§17 R1). Flip the constant here.

import { div, svg } from "gpui-kit";
import { mix, hex6, isHex } from "./color.js";

/** "alpha" | "split" (DESIGN §13.1). */
export const FACETS = "alpha";

/** Asset root, relative to herdr's application directory. */
export const ART_ROOT = "mods/creaseworks/art";

const f = Object.freeze;

/** Every file the generator writes, by folder (DESIGN §13.3). */
export const ASSETS = f({
  folk: f(["crane", "frog", "fox", "koi", "rabbit", "turtle", "butterfly", "whale", "owl", "boat", "mouse", "snail"]),
  sheet: f([
    "0-base", "0-shade", "1-base", "1-shade", "2-base", "2-shade", "3-base", "3-shade",
    "4-base", "4-shade", "5-base", "5-shade", "6-base", "6-shade", "7-base", "7-shade",
  ]),
  status: f(["working-arc", "needs", "done-check", "rest", "envelope", "pip-work", "pip-rest", "pip-needs"]),
  scene: f([
    "envelope-body", "envelope-flap", "seal-bundle", "seal-rush", "seal-storm", "seal-chorus", "scrap", "ream",
    "crane-gilded-outline", "crane-gilded-body", "crane-gilded-shade", "boat-hull", "boat-sail",
    "fold-ridge-base", "fold-ridge-shade", "fold-gull-base", "fold-gull-shade", "fold-napkin-base", "fold-napkin-shade",
    "fold-lozenge-base", "fold-lozenge-shade", "fold-stair-base", "fold-stair-shade", "fold-sail-base", "fold-sail-shade",
    "fold-switchback-base", "fold-switchback-shade", "fold-hem-base", "fold-hem-shade", "fold-coil-base", "fold-coil-shade",
  ]),
  workshops: f(["stack", "bonefolder", "scissors", "gluepot", "bench", "vat", "press", "loft", "kite"]),
  ui: f([
    "fold", "wish", "gear", "flock", "shop", "string", "back", "chevron", "close", "info", "warn", "check", "dots",
    "arrows", "lock", "clock", "hand", "paw", "ribbon", "curio", "cog", "step", "cloud", "book", "garland-strand",
  ]),
});

/** Folders whose sprites also exist as a facet split set (`-a`, `-b`, `-c`). */
export const SPLIT_FOLDERS = f(["folk"]);

/** Kind names accepted by spritePath, mapped to their folder. */
const KIND_FOLDER = f({
  folk: "folk",
  species: "folk",
  sheet: "sheet",
  status: "status",
  scene: "scene",
  seal: "scene",
  workshop: "workshops",
  workshops: "workshops",
  ui: "ui",
  icon: "ui",
});

/** Workshop ids (B3) and content.js icon words → workshop file names. */
const WORKSHOP_FILE = f({
  "paper-stack": "stack",
  "bone-folder": "bonefolder",
  "scissor-stand": "scissors",
  "glue-pot": "gluepot",
  "fold-bench": "bench",
  "washi-vat": "vat",
  "flower-press": "press",
  "crane-loft": "loft",
  "kite-tower": "kite",
  folder: "bonefolder",
  pot: "gluepot",
  tower: "kite",
});

/** Status (herdr word, game word or marker) → status glyph file (§5.2). */
const STATUS_FILE = f({
  working: "working-arc",
  blocked: "needs",
  error: "needs",
  needs: "needs",
  done: "done-check",
  finished: "done-check",
  idle: "rest",
  resting: "rest",
  envelope: "envelope",
});

/** Fledgling status → pip file (filled diamond, hollow diamond, triangle). */
const PIP_FILE = f({
  working: "pip-work",
  idle: "pip-rest",
  resting: "pip-rest",
  done: "pip-rest",
  blocked: "pip-needs",
  needs: "pip-needs",
});

const has = (o, k) => typeof k === "string" && Object.hasOwn(o, k);

/**
 * "mods/creaseworks/art/<folder>/<name>.svg". `kind` is a folder
 * (`folk sheet status scene workshops ui`) or an alias (`species`, `seal`,
 * `workshop`, `icon`). Workshop ids and content.js icon words are mapped to
 * their files; `seal` takes an envelope type (`"rush"` → `seal-rush`).
 * Throws a TypeError for an unknown kind or name, so a typo fails a test
 * instead of drawing nothing (herdr only warns once for a missing asset).
 */
export function spritePath(kind, name) {
  if (!has(KIND_FOLDER, kind)) throw new TypeError(`spritePath: unknown kind "${kind}"`);
  const folder = KIND_FOLDER[kind];
  let file = String(name);
  if (folder === "workshops" && has(WORKSHOP_FILE, file)) file = WORKSHOP_FILE[file];
  if (kind === "seal" && !file.startsWith("seal-")) file = "seal-" + file;
  if (kind === "status" && has(STATUS_FILE, file)) file = STATUS_FILE[file];
  if (!ASSETS[folder].includes(file)) throw new TypeError(`spritePath: no ${folder} sprite "${name}"`);
  return `${ART_ROOT}/${folder}/${file}.svg`;
}

/** The status glyph path for a status word (`working`, `needs`, `done`, `envelope`, …). */
export function statusGlyphPath(status) {
  return spritePath("status", has(STATUS_FILE, status) ? STATUS_FILE[status] : "rest");
}

/** The fledgling pip path for a fledgling status. */
export function pipPath(status) {
  return spritePath("status", has(PIP_FILE, status) ? PIP_FILE[status] : "pip-rest");
}

/** The two sheet layers of fold frame `frame` (0..7): `{ base, shade }`. */
export function sheetPaths(frame) {
  const n = Number.isInteger(frame) ? Math.max(0, Math.min(7, frame)) : 0;
  return { base: spritePath("sheet", `${n}-base`), shade: spritePath("sheet", `${n}-shade`) };
}

/**
 * The two layers of a Pattern book diagram's fold piece (DESIGN §4.7 "Art"):
 * `{ base, shade }` (24-unit files; base tinted S.sheet, shade S.sheetShade).
 * Throws a TypeError for an unknown diagram, like spritePath.
 */
export function foldPaths(kind) {
  return { base: spritePath("scene", `fold-${kind}-base`), shade: spritePath("scene", `fold-${kind}-shade`) };
}

/**
 * A fold piece drawn at `size` px: a relative div holding its base (`color`)
 * and shade (`shadeColor`) layers. With `shadeColor` null only the base
 * shows (the shelf's 16 px one-layer icon, like the species there).
 */
export function foldSprite(kind, size, color, shadeColor = null) {
  const { base, shade } = foldPaths(kind);
  const box = div().relative().w(size).h(size).flex_none();
  box.child(svg(base).absolute().top(0).left(0).w(size).h(size).text_color(color));
  if (shadeColor) box.child(svg(shade).absolute().top(0).left(0).w(size).h(size).text_color(shadeColor));
  return box;
}

/** True when `path` names a sprite that has a facet split set. */
export function isSplittable(path) {
  const m = typeof path === "string" ? /^mods\/creaseworks\/art\/([a-z]+)\/([a-z0-9-]+)\.svg$/.exec(path) : null;
  return Boolean(m && SPLIT_FOLDERS.includes(m[1]) && !/-[abc]$/.test(m[2]));
}

/** The three facet files of a splittable sprite path. */
export function splitPaths(path) {
  const stem = path.slice(0, -4);
  return [`${stem}-a.svg`, `${stem}-b.svg`, `${stem}-c.svg`];
}

function dims(size) {
  if (Array.isArray(size)) return { w: size[0], h: size[1] };
  if (size && typeof size === "object") return { w: size.w, h: size.h };
  return { w: size, h: size };
}

/**
 * A sprite: `svg(path).w(w).h(h).text_color(color)`. `size` is a number
 * (square), `[w, h]` or `{ w, h }` in logical px. `opts.surface` is the
 * colour under the sprite, needed by the facet split; `opts.facets`
 * overrides FACETS (tests and the contact sheet). With "split" and a folk
 * sprite the result is a relative `div` of the three tinted layers (no spin:
 * only status glyphs spin, and they are not faceted). svg() takes no
 * handlers or tooltip: wrap the result in a div for those (§13.4).
 */
export function sprite(path, size, color, opts = undefined) {
  const { w, h } = dims(size);
  const mode = opts && opts.facets ? opts.facets : FACETS;
  if (mode === "split" && isSplittable(path)) {
    const surface = opts && isHex(opts.surface) ? opts.surface : null;
    const c = hex6(color);
    const tints = surface ? [c, mix(c, surface, 0.22), mix(c, surface, 0.44)] : [c, c, c];
    const box = div().relative().w(w).h(h).flex_none();
    splitPaths(path).forEach((p, i) => {
      box.child(svg(p).absolute().top(0).left(0).w(w).h(h).text_color(tints[i]));
    });
    return box;
  }
  return svg(path).w(w).h(h).flex_none().text_color(color);
}

/** A species glyph (`folk/<species>.svg`). */
export function speciesSprite(species, size, color, opts = undefined) {
  return sprite(spritePath("folk", species), size, color, opts);
}

/** A ui glyph (`ui/<name>.svg`). */
export function icon(name, size, color) {
  return sprite(spritePath("ui", name), size, color);
}

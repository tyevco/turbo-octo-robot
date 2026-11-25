// SVG checker for mods/creaseworks/art (DESIGN §13.1). Run by `npm test`
// (test/art/check.test.mjs) and by hand:
//
//   node tools/art/check-svg.mjs [dir]
//
// Rules, per file:
//   * root is exactly <svg xmlns=… viewBox="0 0 W H" width="W" height="H">,
//     W×H as listed for the file's folder (DESIGN §13.3)
//   * children are only path | polygon | rect | circle, self-closed, no nesting,
//     each with a whitelisted attribute set; at least one shape
//   * nothing from text | style | filter | mask | image | gradients | pattern |
//     script | href | use | g | stroke | transform | clip anywhere
//   * fill="#000" on every shape (notify-icon.svg: only its listed literals)
//   * fill-opacity only 0.78 or 0.56 (facets; 1 is written by leaving it out),
//     and none at all in the flat layers (folk -a/-b/-c, sheet/*)
//   * coordinates on the whole/half-unit grid and inside the viewBox
//     (folk: inside the 2-unit margin); path data absolute M L H V A Z only
//   * ≤ 40 points per polygon or subpath; size ≤ 1.2 KB (listed exceptions)

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DIR = resolve(HERE, "../../mods/creaseworks/art");

export const MAX_BYTES = 1200;
export const MAX_POINTS = 40;
/** Files allowed past MAX_BYTES: the 50-crane strand and the full-colour toast icon. */
export const BYTE_EXCEPTIONS = { "ui/garland-strand.svg": 4096, "notify-icon.svg": 2048 };
export const NOTIFY_FILE = "notify-icon.svg";
export const NOTIFY_FILLS = ["#2f6a55", "#fbf7ee"];
export const FACET_OPACITIES = ["0.78", "0.56"];
const FORBIDDEN = /text|style|filter|mask|image|gradient|pattern|script|href|<use|<g[\s>]|stroke|transform|clip|<!|<\?/i;

const SCENE_BOX = {
  "envelope-body": [28, 20], "envelope-flap": [28, 20],
  "seal-bundle": [12, 12], "seal-rush": [12, 12], "seal-storm": [12, 12], "seal-chorus": [12, 12],
  scrap: [16, 16], ream: [28, 20],
  "crane-gilded-outline": [40, 28], "crane-gilded-body": [40, 28], "crane-gilded-shade": [40, 28],
  "boat-hull": [40, 28], "boat-sail": [40, 28],
};

/** The names DESIGN §13.3 lists per folder (the checker refuses anything else). */
export const NAMES = {
  folk: ["crane", "frog", "fox", "koi", "rabbit", "turtle", "butterfly", "whale", "owl", "boat", "mouse", "snail"],
  status: ["working-arc", "needs", "done-check", "rest", "envelope", "pip-work", "pip-rest", "pip-needs"],
  workshops: ["stack", "bonefolder", "scissors", "gluepot", "bench", "vat", "press", "loft", "kite"],
  ui: ["fold", "wish", "gear", "flock", "shop", "string", "back", "chevron", "close", "info", "warn", "check", "dots",
    "arrows", "lock", "clock", "hand", "paw", "ribbon", "curio", "cog", "step", "cloud", "garland-strand"],
  scene: Object.keys(SCENE_BOX),
};

function listed(folder, name) {
  if (folder === "folk") return NAMES.folk.includes(name.replace(/-[abc]$/, ""));
  if (folder === "sheet") return /^[0-7]-(base|shade)$/.test(name);
  if (folder === "") return name === "notify-icon" || name === "logo";
  return NAMES[folder]?.includes(name) ?? false;
}

/** Expected { w, h, margin, flat } for an art-relative path, or null if unknown. */
export function specFor(path) {
  const parts = path.split("/");
  if (parts.length > 2 || !path.endsWith(".svg")) return null;
  const [folder, file] = parts.length === 2 ? parts : ["", parts[0]];
  const name = file.replace(/\.svg$/, "");
  if (!listed(folder, name)) return null;
  switch (folder) {
    case "folk": return { w: 32, h: 32, margin: 2, flat: /-[abc]$/.test(name) };
    case "sheet": return { w: 64, h: 64, margin: 0, flat: true };
    case "status": return { w: 16, h: 16, margin: 0, flat: false };
    case "workshops": return { w: 24, h: 24, margin: 0, flat: false };
    case "ui": return name === "garland-strand" ? { w: 12, h: 200, margin: 0, flat: true } : { w: 16, h: 16, margin: 0, flat: false };
    case "scene": return SCENE_BOX[name] ? { w: SCENE_BOX[name][0], h: SCENE_BOX[name][1], margin: 0, flat: false } : null;
    case "":
      if (name === "notify-icon") return { w: 36, h: 36, margin: 0, flat: false };
      if (name === "logo") return { w: 64, h: 64, margin: 0, flat: false };
      return null;
    default: return null;
  }
}

const ATTRS = {
  polygon: ["points"],
  path: ["d", "fill-rule"],
  rect: ["x", "y", "width", "height"],
  circle: ["cx", "cy", "r"],
};
const REQUIRED = { polygon: ["points"], path: ["d"], rect: ["x", "y", "width", "height"], circle: ["cx", "cy", "r"] };
const PAINT = ["fill", "fill-opacity"];

const onGrid = (v) => Number.isFinite(v) && Math.abs(v * 2 - Math.round(v * 2)) < 1e-9;
const NUM = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;

/** Parses absolute path data into subpaths of points; throws on anything else. */
export function parsePathData(d) {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+(?:\.\d+)?|\.\d+)/g) ?? [];
  if (tokens.join("").length !== d.replace(/[\s,]/g, "").length) throw new Error("unparsable path data");
  const subpaths = [];
  let cur = null, x = 0, y = 0, i = 0;
  const take = (n) => {
    const out = tokens.slice(i, i + n).map(Number);
    if (out.length !== n || out.some((v, k) => !NUM.test(tokens[i + k]))) throw new Error("missing numbers in path data");
    i += n;
    return out;
  };
  const extras = [];
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (!"MLHVAZ".includes(cmd)) throw new Error(`path command "${cmd}" (only absolute M L H V A Z)`);
    if (cmd === "Z") { cur = null; continue; }
    if (cmd === "M") { [x, y] = take(2); cur = [[x, y]]; subpaths.push(cur); continue; }
    if (!cur) throw new Error(`"${cmd}" before M`);
    if (cmd === "L") [x, y] = take(2);
    else if (cmd === "H") [x] = take(1);
    else if (cmd === "V") [y] = take(1);
    else if (cmd === "A") {
      const [rx, ry, rot, large, sweep, ex, ey] = take(7);
      if (rot !== 0 || ![0, 1].includes(large) || ![0, 1].includes(sweep)) throw new Error("arc rotation must be 0 and flags 0/1");
      extras.push(rx, ry);
      [x, y] = [ex, ey];
    }
    cur.push([x, y]);
  }
  return { subpaths, extras };
}

function parsePoints(s) {
  const nums = s.trim().split(/[\s,]+/);
  if (nums.length % 2 || !nums.every((n) => NUM.test(n))) throw new Error(`bad points "${s.slice(0, 40)}"`);
  const out = [];
  for (let k = 0; k < nums.length; k += 2) out.push([Number(nums[k]), Number(nums[k + 1])]);
  return out;
}

/** Checks one file's text. Returns a list of error strings (empty = pass). */
export function checkSvg(text, path) {
  const errors = [];
  const err = (m) => errors.push(`${path}: ${m}`);
  const spec = specFor(path);
  if (!spec) return [`${path}: not a listed art file (DESIGN §13.3)`];
  const bytes = Buffer.byteLength(text);
  const limit = BYTE_EXCEPTIONS[path] ?? MAX_BYTES;
  if (bytes > limit) err(`${bytes} bytes, over the ${limit}-byte limit`);
  if (FORBIDDEN.test(text)) err(`forbidden content (${FORBIDDEN.exec(text)[0]})`);

  const root = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 ([\d.]+) ([\d.]+)" width="([\d.]+)" height="([\d.]+)">([\s\S]*)<\/svg>\n?$/.exec(text);
  if (!root) return [...errors, `${path}: root must be <svg xmlns viewBox="0 0 W H" width="W" height="H"> … </svg>`];
  const [vw, vh, w, h] = root.slice(1, 5).map(Number);
  if (vw !== w || vh !== h) err(`viewBox ${vw}×${vh} does not match width/height ${w}×${h}`);
  if (vw !== spec.w || vh !== spec.h) err(`viewBox ${vw}×${vh}, expected ${spec.w}×${spec.h}`);

  const lo = spec.margin, hiX = spec.w - spec.margin, hiY = spec.h - spec.margin;
  const inBox = ([x, y], pad = 0) => x - pad >= lo - 1e-9 && x + pad <= hiX + 1e-9 && y - pad >= lo - 1e-9 && y + pad <= hiY + 1e-9;
  const checkPts = (list, what, pad = 0) => {
    if (list.length > MAX_POINTS) err(`${what} has ${list.length} points (max ${MAX_POINTS})`);
    for (const p of list) {
      if (!onGrid(p[0]) || !onGrid(p[1])) err(`${what}: ${p} is off the half-unit grid`);
      if (!inBox(p, pad)) err(`${what}: ${p} is outside ${spec.margin ? "the margin" : "the viewBox"}`);
    }
  };

  const body = root[5];
  const re = /<(\w+)((?:\s+[\w-]+="[^"]*")*)\s*\/>/g;
  let pos = 0, count = 0, m;
  while ((m = re.exec(body))) {
    if (body.slice(pos, m.index).trim()) err(`unexpected content "${body.slice(pos, m.index).trim().slice(0, 30)}"`);
    pos = re.lastIndex;
    count++;
    const tag = m[1];
    const what = `<${tag}> #${count}`;
    if (!ATTRS[tag]) { err(`element <${tag}> is not allowed (only path, polygon, rect, circle)`); continue; }
    const attrs = {};
    for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) {
      if (a[1] in attrs) err(`${what}: duplicate ${a[1]}`);
      attrs[a[1]] = a[2];
    }
    for (const k of Object.keys(attrs)) if (![...ATTRS[tag], ...PAINT].includes(k)) err(`${what}: attribute ${k} is not allowed`);
    for (const k of REQUIRED[tag]) if (!(k in attrs)) err(`${what}: missing ${k}`);
    const fills = path === NOTIFY_FILE ? NOTIFY_FILLS : ["#000"];
    if (!fills.includes(attrs.fill)) err(`${what}: fill "${attrs.fill}" (must be ${fills.join(" or ")})`);
    if ("fill-opacity" in attrs) {
      if (spec.flat) err(`${what}: fill-opacity in a flat layer`);
      else if (!FACET_OPACITIES.includes(attrs["fill-opacity"])) err(`${what}: fill-opacity ${attrs["fill-opacity"]} (only 1, 0.78, 0.56)`);
    }
    if ("fill-rule" in attrs && !["evenodd", "nonzero"].includes(attrs["fill-rule"])) err(`${what}: fill-rule ${attrs["fill-rule"]}`);
    try {
      if (tag === "polygon") checkPts(parsePoints(attrs.points), what);
      else if (tag === "path") {
        const { subpaths, extras } = parsePathData(attrs.d);
        if (!subpaths.length) err(`${what}: empty path`);
        subpaths.forEach((sp, k) => checkPts(sp, `${what} subpath ${k + 1}`));
        for (const v of extras) if (!onGrid(v) || v <= 0) err(`${what}: arc radius ${v} off grid`);
      } else if (tag === "rect") {
        const [x, y, rw, rh] = ["x", "y", "width", "height"].map((k) => Number(attrs[k]));
        if (!(rw > 0 && rh > 0)) err(`${what}: empty rect`);
        checkPts([[x, y], [x + rw, y + rh]], what);
      } else if (tag === "circle") {
        const [cx, cy, r] = ["cx", "cy", "r"].map((k) => Number(attrs[k]));
        if (!(r > 0) || !onGrid(r)) err(`${what}: radius ${r}`);
        checkPts([[cx, cy]], what, r);
      }
    } catch (e) {
      err(`${what}: ${e.message}`);
    }
  }
  if (body.slice(pos).trim()) err(`unexpected content "${body.slice(pos).trim().slice(0, 30)}"`);
  if (!count) err("no shapes");
  return errors;
}

/** All .svg files under `dir` (art-relative, sorted). */
export function listArt(dir) {
  const out = [];
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith(".svg")) out.push(relative(dir, p).split("\\").join("/"));
    }
  };
  if (existsSync(dir) && statSync(dir).isDirectory()) walk(dir);
  return out.sort();
}

/** Checks every SVG under `dir`; also that only notify-icon.svg uses colour. */
export function checkDir(dir = DEFAULT_DIR) {
  const files = listArt(dir);
  const errors = [];
  for (const f of files) errors.push(...checkSvg(readFileSync(join(dir, f), "utf8"), f));
  return { files, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_DIR;
  const { files, errors } = checkDir(dir);
  for (const e of errors) console.error(e);
  console.log(`${files.length} SVG files checked, ${errors.length} problem${errors.length === 1 ? "" : "s"}`);
  process.exit(errors.length || !files.length ? 1 : 0);
}

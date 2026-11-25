// Tab contents (DESIGN §3.3 Flock, §3.4 Shop, §3.5 String, §3.6 Settings;
// ARCHITECTURE B11): every panel fixture rendered by each tab renderer through
// the mock gpui in graphite and paper (invalid methods and colours throw
// there), ids on every clickable and unique per tree, stable across renders,
// handler wiring with the B11 arguments, grapheme clipping with inflated
// strings, the status glyph per status (greyscale: one distinct shape file
// each, plus the dashed needs-you border), the virtual list above 80 tiles,
// the shop row states, the String's strands, arming and garlands, the
// Settings rows, the loop budget, and 64-helper render time (Node and QuickJS).
//
//   node --import ./tools/node/register.mjs --test test/ui/tabs.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { installMockWindow, walk, fire, findById } from "../../tools/mock/gpui-kit.js";
import { createHost } from "../../tools/qjs/harness.mjs";
import * as F from "../fixtures/vm-fixtures.mjs";
import { graphemes } from "../../mods/creaseworks/engine/index.js";
import { pickScene, pickHues } from "../../mods/creaseworks/ui/palette.js";
import { statusColor } from "../../mods/creaseworks/ui/color.js";
import { statusGlyphPath, pipPath } from "../../mods/creaseworks/ui/art.js";
import { renderFlock, isFolded, TILE, VIRTUAL_ABOVE, VLIST, FLOCK_CLIP } from "../../mods/creaseworks/ui/flock.js";
import { renderShop, SEGMENTS, SILHOUETTES, SHOP_CLIP } from "../../mods/creaseworks/ui/shop.js";
import { renderString, STRAND, ARM_MS, isArmed, STRING_CLIP } from "../../mods/creaseworks/ui/string.js";
import { renderSettings, SETTINGS_CLIP } from "../../mods/creaseworks/ui/settings.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const UI = join(root, "mods/creaseworks/ui");
const THEMES = JSON.parse(readFileSync(join(root, "tools/mock/themes.json"), "utf8"));
const THEME_NAMES = ["graphite", "paper"];

installMockWindow();

const isDark = (name) => name !== "paper" && name !== "win98";

const HANDLER_NAMES = [
  "click", "open", "openHelper", "buy", "setting", "switchAuto", "wish", "collect", "dismiss", "fold", "show", "tab",
  "segment", "select", "toggleGroup", "showGroup", "details", "confirm", "cancel", "retrySave", "checkSave",
  "restoreBackup", "sharePath", "pickSharePath", "resetGame",
];

/** A ctx (B11) with recording handlers; `calls` gets `[name, ...args without cx]`. */
function makeCtx(themeName, s, over = {}) {
  const dark = isDark(themeName);
  const calls = [];
  const handlers = {};
  for (const n of HANDLER_NAMES) handlers[n] = (...args) => calls.push([n, ...args.slice(0, -1)]);
  return {
    T: THEMES[themeName], S: pickScene(dark), hues: pickHues(dark), dark, zoom: 1, calm: false,
    width: s.width, height: s.height, handlers, calls, ...over,
  };
}

const RENDER = { flock: renderFlock, shop: renderShop, string: renderString, settings: renderSettings };

/** Every panel scenario wide enough for tab content (the rail has none). */
const PANEL_SCENARIOS = F.allScenarios().filter((s) => s.role === "panel" && s.width >= 140);

/** The tab each scenario shows (its `ui.tab`). */
const tabOf = (s) => (s.ui && RENDER[s.ui.tab] ? s.ui.tab : "flock");

function allNodes(json, visit, path = []) {
  visit(json, path);
  const kids = (json.children || []).concat(json.slots ? Object.values(json.slots) : []);
  for (const k of kids) if (k && typeof k === "object") allNodes(k, visit, json.id ? path.concat(json.id) : path);
}

const CLICK_EVENTS = ["on_click", "on_mouse_down", "on_mouse_up", "on_change", "on_item_click"];

function clickables(json) {
  const out = [];
  walk(json, (node) => {
    const hs = Object.keys(node.handlers || {});
    if (hs.some((h) => CLICK_EVENTS.some((e) => h === e || h.startsWith(e + ":")))) out.push(node);
  });
  return out;
}

function ids(json) {
  const out = [];
  walk(json, (node) => {
    if (node.id) out.push(node.id);
  });
  return out;
}

function texts(json) {
  const out = [];
  allNodes(json, (n) => {
    if (n.kind === "text") out.push(n.text);
  });
  return out;
}

function countLoops(json) {
  let n = 0;
  walk(json, (node) => {
    n += (node.loops ? node.loops.length : 0) + (node.spin ? 1 : 0) + (node.frames ? 1 : 0);
  });
  return n;
}

const style = (node, name) => (node.styles || []).find((s) => s[0] === name);
const styleVal = (node, name) => style(node, name)?.[1];

const fakeCx = () => {
  const cx = { stopped: 0, stop_propagation() { cx.stopped++; }, notify() {} };
  return cx;
};

/** A copy of a vm (fixtures are fresh per call, but tests mutate copies only). */
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------------
// Every fixture renders, in both themes, for every tab

test("every panel fixture renders in each tab renderer through the mock gpui (graphite and paper)", () => {
  let n = 0;
  for (const s of PANEL_SCENARIOS) {
    for (const th of THEME_NAMES) {
      for (const [name, render] of Object.entries(RENDER)) {
        const ctx = makeCtx(th, s);
        const tree = render(s.vm, s.ui, ctx);
        assert.ok(tree && tree.__r, `${s.name} ${name} ${th}: a live element`);
        const json = tree.toJSON();
        assert.equal(json.id, `cw-${name === "settings" ? "set" : name}`, `${s.name} ${name}: root id`);
        assert.ok(style(json, "w_full"), `${s.name} ${name}: full width`);
        assert.ok(!style(json, "h") && !style(json, "overflow_y_scrollbar"), `${s.name} ${name}: no fixed height or own outer scroll (B11)`);
        n++;
      }
    }
  }
  assert.ok(n >= 40 * 2 * 4, `${n} renders`);
});

test("the same arguments give the same tree; the vm, ui and ctx are not mutated", () => {
  for (const s of PANEL_SCENARIOS) {
    const ctx = makeCtx("graphite", s);
    const vm0 = JSON.stringify(s.vm);
    const ui0 = JSON.stringify(s.ui);
    for (const render of Object.values(RENDER)) {
      const a = JSON.stringify(render(s.vm, s.ui, ctx).toJSON());
      const b = JSON.stringify(render(s.vm, s.ui, ctx).toJSON());
      assert.equal(a, b, s.name);
    }
    assert.equal(JSON.stringify(s.vm), vm0, `${s.name}: vm untouched`);
    assert.equal(JSON.stringify(s.ui), ui0, `${s.name}: ui untouched`);
    assert.equal(ctx.calls.length, 0, `${s.name}: rendering calls no handler`);
  }
});

// ---------------------------------------------------------------------------
// Ids

/** Extra states that draw more clickables than the fixtures' defaults. */
function richStates() {
  const out = [];
  for (const s of PANEL_SCENARIOS) out.push([s, s.ui]);
  const f12 = F.scenario("flock-12");
  const first = f12.vm.helpers.groups[0].tiles[0].helperId;
  const allOpen = { needs: false, finished: false, working: false, resting: false, elsewhere: false, album: false, legend: false };
  out.push([f12, { ...f12.ui, selected: first, folded: allOpen }]);
  const els = F.scenario("flock-elsewhere");
  out.push([els, { ...els.ui, folded: allOpen }]);
  const alb = F.scenario("album");
  out.push([alb, { ...alb.ui, folded: allOpen }]);
  for (const seg of F.SHOP_SEGMENTS) {
    const sh = F.scenario(`shop-${seg}`);
    out.push([sh, { ...sh.ui, folded: { [`owned:${seg}`]: false } }]);
  }
  const set = F.scenario("settings");
  out.push([set, { ...set.ui, confirm: "reset", armedAt: 0, now: 2000 }]);
  out.push([set, { ...set.ui, confirm: "restore", armedAt: 0, now: 100 }]);
  return out;
}

test("every clickable has an id, ids are unique in each tree and stable across renders", () => {
  for (const [s, ui] of richStates()) {
    for (const th of THEME_NAMES) {
      for (const [name, render] of Object.entries(RENDER)) {
        const ctx = makeCtx(th, s, { save: { state: "saved", text: "Saved 12 s ago", path: "/home/me/.herdr/data/creaseworks/save.json", backup: "3 m ago" } });
        const json = render(s.vm, ui, ctx).toJSON();
        for (const c of clickables(json)) {
          assert.ok(typeof c.id === "string" && c.id.length > 0, `${s.name} ${name}: a ${c.kind} with ${Object.keys(c.handlers)} has no id`);
          const prefix = name === "settings" ? "cw-set-" : `cw-${name}-`;
          assert.ok(c.id.startsWith(prefix), `${s.name} ${name}: id ${c.id} outside the ${prefix} prefix`);
        }
        const all = ids(json);
        const seen = new Set();
        for (const id of all) {
          assert.ok(!seen.has(id), `${s.name} ${name} ${th}: duplicate id ${id}`);
          seen.add(id);
        }
        // Tooltips need a stateful (id-carrying) element.
        walk(json, (node) => {
          if (style(node, "tooltip") && node.kind !== "Button" && node.kind !== "button") assert.ok(node.id, `${s.name} ${name}: tooltip on an element without id`);
        });
      }
    }
  }
});

test("tile ids come from helper ids, not positions: reordering tiles keeps each tile's id", () => {
  const s = F.scenario("flock-12");
  const ctx = makeCtx("graphite", s);
  const vm = clone(s.vm);
  const g = vm.helpers.groups.find((x) => x.key === "working");
  const before = ids(renderFlock(vm, s.ui, ctx).toJSON()).filter((id) => id.startsWith("cw-flock-tile-"));
  g.tiles.reverse();
  const after = ids(renderFlock(vm, s.ui, ctx).toJSON()).filter((id) => id.startsWith("cw-flock-tile-"));
  assert.deepEqual([...after].sort(), [...before].sort());
  for (const t of g.tiles) assert.ok(after.includes(`cw-flock-tile-${t.helperId}`));
});

// ---------------------------------------------------------------------------
// Text: clipped, ≥ 11 px

const FREE_TEXT = new Set([
  "name", "text", "tooltip", "label", "folds", "title", "statusWord", "leftAgo", "effect", "cost", "eta", "nextIn",
  "lifetime", "where", "line", "rest", "notifyText", "day", "next", "at", "button", "pace",
]);
const LONG = "Ünïcödé 👩‍💻🇯🇵 ".repeat(40);

function inflate(v, key) {
  if (typeof v === "string") return FREE_TEXT.has(key) ? LONG + v : v;
  if (key === "stripes" && Array.isArray(v)) return v.map((st) => [st[0], st[1], LONG + st[2]]);
  if (Array.isArray(v)) return v.map((x) => inflate(x, key));
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = inflate(x, k);
    return out;
  }
  return v;
}

/** Limits per id prefix of the nearest enclosing ids; anything else ≤ 140 graphemes. */
const LIMITS = [
  [/^cw-flock-tile-/, FLOCK_CLIP.name],
  [/^cw-flock-detail$/, FLOCK_CLIP.title],
  [/^cw-flock-head$/, FLOCK_CLIP.head],
  [/^cw-shop-row-/, SHOP_CLIP.effect],
  [/^cw-string-g\d+$/, STRING_CLIP.garland],
  [/^cw-string-perks$/, STRING_CLIP.perk],
  [/^cw-set-auto-/, SETTINGS_CLIP.name],
  [/^cw-set-save$/, 140],
];

test("every text node is clipped (inflated vm strings), tooltips ≤ 140 and no text below 11 px", () => {
  const save = { state: "problem", text: LONG, path: "/x/" + LONG + "/save.json", backup: LONG, damaged: [LONG, LONG] };
  for (const [s0, ui0] of richStates()) {
    const vm = inflate(s0.vm, "");
    const ui = { ...ui0 };
    if (ui.selected === undefined || ui.selected === null) {
      const t = vm.helpers.groups.flatMap((g) => g.tiles)[0];
      if (t) ui.selected = t.helperId;
    }
    for (const [name, render] of Object.entries(RENDER)) {
      const ctx = makeCtx("graphite", s0, { save });
      const json = render(vm, ui, ctx).toJSON();
      let count = 0;
      allNodes(json, (n, path) => {
        if (n.kind === "text") {
          count++;
          const len = graphemes(n.text).length;
          let limit = 140;
          for (const [re, lim] of LIMITS) if (path.some((id) => re.test(id))) limit = Math.min(limit, lim);
          assert.ok(len <= limit, `${s0.name} ${name}: text in ${path.at(-1)} has ${len} graphemes (limit ${limit}): ${n.text.slice(0, 40)}`);
          return;
        }
        for (const st of n.styles || []) {
          if (st[0] === "text_size") assert.ok(st[1] >= 11, `${s0.name} ${name}: text_size ${st[1]} in ${n.id ?? path.at(-1)}`);
          if (st[0] === "tooltip") assert.ok(graphemes(st[1]).length <= 140, `${s0.name} ${name}: tooltip of ${n.id} has ${graphemes(st[1]).length} graphemes`);
        }
      });
      assert.ok(count >= 2, `${s0.name} ${name}`);
    }
  }
});

test("long text either truncates or wraps on purpose (no unbounded single-line run)", () => {
  const s = F.scenario("flock-34");
  const vm = inflate(s.vm, "");
  const json = renderFlock(vm, { ...s.ui, selected: vm.helpers.groups[0].tiles[0].helperId }, makeCtx("graphite", s)).toJSON();
  walk(json, (n) => {
    const kids = (n.children || []).filter((c) => c.kind === "text");
    if (!kids.length) return;
    const len = graphemes(kids.map((k) => k.text).join("")).length;
    if (len > 24) assert.ok(style(n, "truncate") || style(n, "whitespace_normal"), `text of ${len} graphemes neither truncates nor wraps: ${kids[0].text.slice(0, 30)}`);
  });
});

// ---------------------------------------------------------------------------
// Flock: tiles

const STATUSES = ["working", "blocked", "done", "idle"];

function tilesOf(json) {
  const out = [];
  walk(json, (n) => {
    if (typeof n.id === "string" && n.id.startsWith("cw-flock-tile-")) out.push(n);
  });
  return out;
}

test("status glyphs: each status has its own glyph file (greyscale-distinguishable shapes), used on every badge", () => {
  const files = STATUSES.map((st) => statusGlyphPath(st));
  assert.equal(new Set(files).size, 4, `distinct files: ${files}`);
  const bodies = files.map((f) => readFileSync(join(root, f), "utf8"));
  assert.equal(new Set(bodies).size, 4, "the four glyph files differ in shape, not only in name");
  // Fledgling pips: filled diamond, hollow diamond, triangle.
  const pips = ["working", "idle", "blocked"].map((st) => pipPath(st));
  assert.equal(new Set(pips).size, 3);
  assert.equal(pipPath("done"), pipPath("idle"));

  for (const th of THEME_NAMES) {
    for (const name of ["flock-12", "flock-34", "flock-64-dense", "needs-you-3", "flock-elsewhere"]) {
      const s = F.scenario(name);
      const json = renderFlock(s.vm, { ...s.ui, folded: { resting: false, elsewhere: false } }, makeCtx(th, s)).toJSON();
      const byId = new Map();
      for (const g of s.vm.helpers.groups) for (const t of g.tiles) byId.set(t.helperId, t);
      for (const t of s.vm.helpers.elsewhere) byId.set(t.helperId, t);
      const seen = new Map();
      for (const node of tilesOf(json)) {
        const id = node.id.slice("cw-flock-tile-".length);
        const t = byId.get(id);
        assert.ok(t, `${name}: tile ${id} from the vm`);
        const badge = findById(node, `cw-flock-badge-${id}`);
        assert.ok(badge, `${name}: badge on ${id}`);
        const glyph = badge.children.find((c) => c.kind === "svg");
        assert.equal(glyph.args[0], statusGlyphPath(t.status), `${name}: ${t.status} badge`);
        const want = statusColor(THEMES[th], t.status, "popover");
        assert.equal(styleVal(glyph, "text_color"), want, `${name}: guarded ${t.status} colour on T.popover`);
        if (!seen.has(t.status)) seen.set(t.status, glyph.args[0]);
        // The needs-you tile has the dashed border (a second, non-colour cue).
        const dashed = Boolean(style(node, "border_dashed"));
        assert.equal(dashed, t.status === "blocked", `${name}: dashed border iff needs you (${t.status})`);
        if (dashed) {
          assert.equal(styleVal(node, "border"), 2);
          assert.equal(styleVal(node, "border_color"), statusColor(THEMES[th], "blocked", "raised"));
        }
      }
      // Distinct statuses drew distinct shapes.
      const shapes = [...seen.values()];
      assert.equal(new Set(shapes).size, shapes.length, name);
    }
  }
});

test("tiles: normal 52×64 up to 20 helpers, dense 40×44 with no name; T.raised, rounded 8", () => {
  for (const [name, dense] of [["flock-12", false], ["flock-34", true], ["flock-64-dense", true], ["narrow", true]]) {
    const s = F.scenario(name);
    assert.equal(Boolean(s.vm.helpers.dense), dense, `${name}: fixture density`);
    const ctx = makeCtx("graphite", s);
    const json = renderFlock(s.vm, { ...s.ui, folded: { resting: false } }, ctx).toJSON();
    const g = dense ? TILE.dense : TILE.normal;
    const tiles = tilesOf(json);
    assert.ok(tiles.length > 0, name);
    for (const t of tiles) {
      assert.equal(styleVal(t, "w"), g.w, name);
      assert.equal(styleVal(t, "h"), g.h, name);
      assert.equal(styleVal(t, "rounded"), 8);
      const badge = t.children.find((c) => c.id && c.id.startsWith("cw-flock-badge-"));
      assert.equal(styleVal(badge, "w"), g.badge);
      assert.equal(styleVal(badge, "top"), -4);
      assert.equal(styleVal(badge, "right"), -4);
    }
    // Names only on normal tiles.
    const names = tiles.flatMap((t) => texts(t)).filter((x) => !x.startsWith("+"));
    if (dense) assert.equal(names.length, 0, `${name}: dense tiles carry no name`);
    else assert.ok(names.length >= tiles.length, `${name}: every normal tile has a name`);
  }
});

test("tiles: envelope marker, pips (4 then +n), rest bar, resting opacity, tooltip", () => {
  const s = F.scenario("flock-12");
  const ctx = makeCtx("paper", s);
  const vm = clone(s.vm);
  const working = vm.helpers.groups.find((g) => g.key === "working").tiles;
  working[0].pips = ["working", "idle", "blocked", "working", "idle", "done"];
  working[0].envelope = true;
  const resting = vm.helpers.groups.find((g) => g.key === "resting").tiles;
  resting[0].rest = 0.5;
  const json = renderFlock(vm, { ...s.ui, folded: { resting: false } }, ctx).toJSON();
  const tile = findById(json, `cw-flock-tile-${working[0].helperId}`);
  const pipSvgs = [];
  walk(tile, (n) => {
    if (n.kind === "svg" && /status\/pip-/.test(n.args[0])) pipSvgs.push(n);
  });
  assert.equal(pipSvgs.length, 4, "4 pips drawn");
  assert.deepEqual(pipSvgs.map((n) => n.args[0]), ["working", "idle", "blocked", "working"].map(pipPath));
  assert.ok(texts(tile).includes("+2"), "then +n");
  for (const p of pipSvgs) assert.equal(styleVal(p, "w"), TILE.normal.pip);
  const env = findById(tile, `cw-flock-env-${working[0].helperId}`);
  assert.ok(env, "envelope marker");
  assert.ok(env.handlers.on_click);
  const disc = env.children[0];
  assert.equal(styleVal(disc, "w"), 14);
  assert.equal(styleVal(disc, "bg"), ctx.S.sheet);
  assert.equal(styleVal(disc.children[0], "text_color"), ctx.S.ink);
  assert.equal(styleVal(disc.children[0], "w"), 11);

  const rt = findById(json, `cw-flock-tile-${resting[0].helperId}`);
  const bar = findById(rt, `cw-flock-rest-${resting[0].helperId}`);
  assert.ok(bar, "rest bar on a resting tile");
  assert.equal(styleVal(bar, "w"), 20);
  assert.equal(styleVal(bar, "h"), 2);
  assert.equal(styleVal(bar, "bg"), ctx.T.muted);
  assert.deepEqual(bar.transitions.map((t) => t.property ?? t[0]), ["width"]);
  // Content at opacity 0.8 (the badge stays opaque).
  for (const c of rt.children) {
    const badge = c.id === `cw-flock-badge-${resting[0].helperId}`;
    assert.equal(styleVal(c, "opacity"), badge ? undefined : 0.8, c.id ?? c.kind);
  }
  assert.equal(styleVal(findById(json, `cw-flock-tile-${working[0].helperId}`).children[0], "opacity"), undefined);
  assert.match(styleVal(rt, "tooltip"), / · Resting/);
  // No rest bar on a working tile.
  assert.equal(findById(tile, `cw-flock-rest-${working[0].helperId}`), null);
});

test("tile handlers: click selects (again deselects), the envelope marker stops propagation and opens", () => {
  const s = F.scenario("flock-12");
  const vm = clone(s.vm);
  const t = vm.helpers.groups.find((g) => g.key === "working").tiles[0];
  t.envelope = true;
  const ctx = makeCtx("graphite", s);
  const tree = renderFlock(vm, s.ui, ctx);
  fire(tree, `cw-flock-tile-${t.helperId}`, "on_click", {}, fakeCx());
  const cx = fakeCx();
  fire(tree, `cw-flock-env-${t.helperId}`, "on_click", {}, cx);
  assert.equal(cx.stopped, 1);
  assert.deepEqual(ctx.calls, [["select", t.helperId], ["open", t.helperId]]);

  const ctx2 = makeCtx("graphite", s);
  const tree2 = renderFlock(vm, { ...s.ui, selected: t.helperId }, ctx2);
  fire(tree2, `cw-flock-tile-${t.helperId}`, "on_click", {}, fakeCx());
  fire(tree2, "cw-flock-detail-open", "on_click", {}, fakeCx());
  fire(tree2, "cw-flock-detail-close", "on_click", {}, fakeCx());
  fire(tree2, "cw-flock-detail-env", "on_click", {}, fakeCx());
  assert.deepEqual(ctx2.calls, [["select", null], ["openHelper", t.helperId], ["select", null], ["open", t.helperId]]);
});

test("detail card: shown only for a selected tile, first in the tab, with name · species · hue and Open pane", () => {
  const s = F.scenario("flock-34");
  const t = s.vm.helpers.groups[1].tiles[0];
  const ctx = makeCtx("graphite", s);
  assert.equal(findById(renderFlock(s.vm, s.ui, ctx).toJSON(), "cw-flock-detail"), null);
  const json = renderFlock(s.vm, { ...s.ui, selected: t.helperId }, ctx).toJSON();
  assert.equal(json.children[0].id, "cw-flock-detail");
  const words = texts(json.children[0]).join(" | ");
  assert.ok(words.startsWith(`${t.name} · ${t.species} · `), words);
  assert.ok(findById(json, "cw-flock-detail-open"));
  assert.ok(texts(findById(json, "cw-flock-detail-open")).includes("Open pane ›"));
  // An unknown selection draws no card.
  assert.equal(findById(renderFlock(s.vm, { ...s.ui, selected: "nope" }, ctx).toJSON(), "cw-flock-detail"), null);
});

test("groups: fixed order, headers fold with toggleGroup, workspace order hides its header, folded group is one row", () => {
  const s0 = F.scenario("flock-34");
  // With no fledgling waiting in Resting, the vm folds it (above 12; r4-12
  // keeps it open over a waiting one, as flock-34 has).
  const s = { ...s0, vm: clone(s0.vm) };
  const rg = s.vm.helpers.groups.find((g) => g.key === "resting");
  for (const t of rg.tiles) t.pips = t.pips.map((p) => (p === "blocked" ? "working" : p));
  rg.folded = true;
  const ctx = makeCtx("graphite", s);
  const tree = renderFlock(s.vm, s.ui, ctx);
  const json = tree.toJSON();
  const secs = json.children.filter((c) => /^cw-flock-sec-/.test(c.id)).map((c) => c.id.slice(13));
  assert.deepEqual(secs, ["needs", "finished", "working", "resting"]);
  // Resting (15 > 12) is folded by the vm: header only.
  const resting = findById(json, "cw-flock-sec-resting");
  assert.equal(s0.vm.helpers.groups.find((g) => g.key === "resting").folded, false, "flock-34 itself keeps Resting open");
  assert.equal(s.vm.helpers.groups.find((g) => g.key === "resting").folded, true);
  assert.equal(resting.children.length, 1);
  assert.equal(styleVal(resting.children[0], "h"), 24);
  fire(tree, "cw-flock-grp-resting", "on_click", {}, fakeCx());
  assert.deepEqual(ctx.calls, [["toggleGroup", "resting"]]);
  // The glue stores !isFolded: the next render shows the tiles.
  const folded = { resting: !isFolded(s.vm, s.ui, "resting") };
  const open = renderFlock(s.vm, { ...s.ui, folded }, ctx).toJSON();
  assert.equal(findById(open, "cw-flock-sec-resting").children.length, 2);
  // scrollTo unfolds its group.
  assert.equal(findById(renderFlock(s.vm, { ...s.ui, scrollTo: "resting" }, ctx).toJSON(), "cw-flock-sec-resting").children.length, 2);

  // Workspace order: one "all" group with no header.
  const vm = clone(s.vm);
  const tiles = vm.helpers.groups.flatMap((g) => g.tiles);
  vm.helpers.groups = [{ key: "all", title: "Workspace order", count: tiles.length, folded: false, tiles }];
  const ws = renderFlock(vm, s.ui, ctx).toJSON();
  assert.equal(findById(ws, "cw-flock-grp-all"), null);
  assert.equal(tilesOf(ws).length, tiles.length);
});

test("virtual list above 80 tiles: on_item_click on the list, no handlers in rows, a definite height", () => {
  const s = F.scenario("flock-64-dense");
  const vm = clone(s.vm);
  const working = vm.helpers.groups.find((g) => g.key === "working");
  const base = working.tiles.slice();
  while (working.tiles.length <= VIRTUAL_ABOVE + 10) {
    const k = working.tiles.length;
    working.tiles.push({ ...base[k % base.length], helperId: `v${k.toString(16).padStart(7, "0")}` });
  }
  working.count = working.tiles.length;
  const ctx = makeCtx("graphite", s);
  const tree = renderFlock(vm, s.ui, ctx);
  const json = tree.toJSON();
  const list = findById(json, "cw-flock-vl-working");
  assert.ok(list, "a v_virtual_list");
  assert.equal(list.kind, "v_virtual_list");
  assert.equal(list.args[1], working.tiles.length);
  assert.equal(list.args[2], VLIST.row);
  assert.equal(styleVal(list, "h"), VLIST.rows * VLIST.row, "definite height");
  assert.ok(list.handlers.on_item_click);
  assert.deepEqual(list.keys.slice(0, 3), working.tiles.slice(0, 3).map((t) => t.helperId));
  walk(list, (n) => {
    if (n === list) return;
    assert.deepEqual(Object.keys(n.handlers || {}), [], "no handlers in item rows");
    assert.equal(n.id, null, "no ids in item rows");
    assert.equal(countLoops(n), 0);
  });
  // Other groups stay grids.
  assert.ok(findById(json, "cw-flock-grid-needs"));
  fire(tree, "cw-flock-vl-working", "on_item_click", working.tiles[85].helperId, fakeCx());
  assert.deepEqual(ctx.calls, [["select", working.tiles[85].helperId]]);
  // 80 exactly stays a grid (with the fledgling-heavy Resting folded, as
  // r3-16 measures it: open, the tile budget lists the biggest group).
  working.tiles = working.tiles.slice(0, VIRTUAL_ABOVE);
  assert.equal(findById(renderFlock(vm, { ...s.ui, folded: { resting: true } }, ctx).toJSON(), "cw-flock-vl-working"), null);
});

test("Elsewhere and Album fold by default; Album rows are 28 px with 'left … ago' and folds", () => {
  const s = F.scenario("flock-elsewhere");
  const ctx = makeCtx("graphite", s);
  const tree = renderFlock(s.vm, s.ui, ctx);
  const json = tree.toJSON();
  const sec = findById(json, "cw-flock-sec-elsewhere");
  assert.equal(sec.children.length, 1, "folded by default");
  fire(tree, "cw-flock-grp-elsewhere", "on_click", {}, fakeCx());
  assert.deepEqual(ctx.calls, [["toggleGroup", "elsewhere"]]);
  const open = renderFlock(s.vm, { ...s.ui, folded: { elsewhere: false } }, ctx).toJSON();
  const tiles = tilesOf(findById(open, "cw-flock-sec-elsewhere"));
  assert.equal(tiles.length, s.vm.helpers.elsewhere.length);
  for (const t of tiles) assert.equal(findById(t, t.id.replace("tile", "env")), null, "no envelope marker on another window's helper");

  const a = F.scenario("album");
  const ja = renderFlock(a.vm, a.ui, ctx).toJSON();
  assert.equal(findById(ja, "cw-flock-album").children.length, 1);
  const ja2 = renderFlock(a.vm, { ...a.ui, folded: { album: false } }, ctx).toJSON();
  const rows = findById(ja2, "cw-flock-album").children.slice(1);
  assert.equal(rows.length, a.vm.helpers.album.length);
  for (const [i, r] of rows.entries()) {
    assert.equal(styleVal(r, "h"), 28);
    const words = texts(r);
    assert.ok(words.includes(`left ${a.vm.helpers.album[i].leftAgo} ago`), words.join(" | "));
    assert.ok(words.includes(`${a.vm.helpers.album[i].folds} folds`));
  }
});

test("empty state: 304×200 card, three species at 0.6, the copy and the five-row legend", () => {
  const s = F.scenario("empty");
  assert.equal(s.vm.helpers.empty, true);
  const ctx = makeCtx("paper", s);
  const json = renderFlock(s.vm, s.ui, ctx).toJSON();
  const card = findById(json, "cw-flock-empty");
  assert.ok(card);
  assert.equal(styleVal(card, "w"), 304);
  assert.equal(styleVal(card, "min_h"), 200);
  const words = texts(card);
  assert.ok(words.includes("No paper folk yet."));
  assert.ok(words.some((w) => w.startsWith("Start a coding agent in any tab.")));
  const legend = findById(card, "cw-flock-legend");
  assert.equal(legend.children.length, 5);
  const species = [];
  walk(card, (n) => {
    if (n.kind === "svg" && n.args[0].includes("/folk/")) species.push(n.args[0].split("/").pop());
  });
  assert.deepEqual(species, ["crane.svg", "fox.svg", "koi.svg"]);
  // "?" opens the legend in a populated flock.
  const f = F.scenario("flock-12");
  const tree = renderFlock(f.vm, f.ui, ctx);
  assert.equal(findById(tree.toJSON(), "cw-flock-legend"), null);
  fire(tree, "cw-flock-legend-btn", "on_click", {}, fakeCx());
  assert.deepEqual(ctx.calls.at(-1), ["toggleGroup", "legend"]);
  assert.ok(findById(renderFlock(f.vm, { ...f.ui, folded: { legend: false } }, ctx).toJSON(), "cw-flock-legend"));
});

// ---------------------------------------------------------------------------
// Loop budget

test("tabs obey the vm's flags: steady views and calm add no loop or spin; pulse/spin only where asked", () => {
  for (const s of PANEL_SCENARIOS) {
    for (const [name, render] of Object.entries(RENDER)) {
      const calm = render(s.vm, s.ui, makeCtx("graphite", s, { calm: true })).toJSON();
      assert.equal(countLoops(calm), 0, `${s.name} ${name}: calm`);
      const json = render(s.vm, s.ui, makeCtx("graphite", s)).toJSON();
      if (F.STEADY_VIEWS.includes(s.name)) assert.equal(countLoops(json), 0, `${s.name} ${name}: steady`);
      if (name !== "flock") assert.equal(countLoops(json), 0, `${s.name} ${name}: no loops outside the Flock`);
    }
    // Flock: loops = the vm's pulse (blocked) + spin (working) flags on drawn tiles.
    const json = renderFlock(s.vm, { ...s.ui, folded: { resting: false } }, makeCtx("graphite", s)).toJSON();
    let want = 0;
    for (const g of s.vm.helpers.groups) {
      for (const t of g.tiles) want += (t.pulse && t.status === "blocked" ? 1 : 0) + (t.spin && t.status === "working" ? 1 : 0);
    }
    assert.equal(countLoops(json), want, `${s.name}: flock loops`);
    assert.ok(want <= 12, s.name);
  }
});

// ---------------------------------------------------------------------------
// Shop

function shopRows(json) {
  const out = [];
  walk(json, (n) => {
    if (typeof n.id === "string" && /^cw-shop-row-/.test(n.id)) out.push(n);
  });
  return out;
}

test("shop: six segments (icons only below 280 px), the segment and ×1/×10/Max handlers", () => {
  const s = F.scenario("shop-works");
  const ctx = makeCtx("graphite", s);
  const tree = renderShop(s.vm, s.ui, ctx);
  const json = tree.toJSON();
  const segs = findById(json, "cw-shop-segs");
  assert.equal(styleVal(segs, "h"), 40);
  assert.deepEqual(segs.children.map((c) => c.id), SEGMENTS.map((x) => `cw-shop-seg-${x.key}`));
  assert.deepEqual(segs.children.map((c) => texts(c)[0]), ["Works", "Tools", "Folk", "Charms", "Curios", "Auto"]);
  for (const c of segs.children) assert.ok(c.children.some((k) => k.kind === "svg"), "14 px icon");
  fire(tree, "cw-shop-seg-folk", "on_click", {}, fakeCx());
  for (const v of ["1", "10", "max"]) fire(tree, `cw-shop-count-${v}`, "on_click", {}, fakeCx());
  assert.deepEqual(ctx.calls, [["segment", "folk"], ["setting", "buyCount", 1], ["setting", "buyCount", 10], ["setting", "buyCount", "max"]]);
  // Narrow: icons only, labels in tooltips.
  const narrow = renderShop(s.vm, s.ui, makeCtx("graphite", s, { width: 240 })).toJSON();
  for (const c of findById(narrow, "cw-shop-segs").children) {
    assert.equal(texts(c).length, 0);
    assert.ok(styleVal(c, "tooltip"));
  }
  // Count toggle only on Works.
  for (const seg of ["tools", "auto"]) {
    const t = F.scenario(`shop-${seg}`);
    assert.equal(findById(renderShop(t.vm, t.ui, makeCtx("graphite", t)).toJSON(), "cw-shop-count"), null);
  }
});

test("shop rows: affordable = accent button + 3 px accent bar; unaffordable = raised/muted with time-to-afford; best-buy diamond", () => {
  for (const th of THEME_NAMES) {
    for (const seg of F.SHOP_SEGMENTS) {
      const s = F.scenario(`shop-${seg}`);
      const ctx = makeCtx(th, s);
      const T = ctx.T;
      const json = renderShop(s.vm, s.ui, ctx).toJSON();
      const byId = new Map();
      for (const r of s.vm.shop.segments[seg]) {
        byId.set(r.id, r);
        for (const x of r.sub || []) byId.set(x.id, x);
      }
      for (const node of shopRows(json)) {
        const id = node.id.slice("cw-shop-row-".length);
        const row = byId.get(id);
        assert.ok(row, `${seg}: row ${id}`);
        assert.equal(styleVal(node, "h"), row.tier ? 36 : 52);
        const btn = findById(node, `cw-shop-buy-${id}`);
        if (seg === "auto" && row.owned > 0) {
          assert.equal(btn, null, "owned automation: a switch, no buy button");
          assert.ok(findById(node, `cw-shop-auto-${id}`));
          continue;
        }
        assert.ok(btn, `${seg}: buy button for ${id}`);
        assert.equal(styleVal(btn, "w"), 72);
        assert.equal(styleVal(btn, "h"), 28);
        assert.equal(styleVal(btn, "rounded"), 6);
        assert.ok(texts(btn).includes(row.cost));
        const bar = node.children.find((c) => styleVal(c, "w") === 3);
        if (row.affordable) {
          assert.equal(styleVal(btn, "bg"), T.accent);
          assert.equal(styleVal(btn, "text_color"), T.accent_foreground);
          assert.ok(bar && styleVal(bar, "bg") === T.accent, `${id}: 3 px accent bar`);
          assert.ok(btn.handlers.on_click);
        } else {
          assert.equal(styleVal(btn, "bg"), T.raised);
          assert.equal(styleVal(btn, "text_color"), T.muted);
          assert.equal(bar, undefined);
          if (row.eta) assert.ok(texts(node).includes(row.eta), `${id}: time-to-afford`);
        }
        const diamond = findById(node, `cw-shop-best-${id}`);
        assert.equal(Boolean(diamond), row.best === true, `${id}: best-buy diamond iff best`);
        if (diamond) {
          const g = diamond.children[0];
          assert.equal(g.args[0], pipPath("working"));
          assert.equal(styleVal(g, "w"), 6);
        }
      }
    }
  }
  // The works fixture has exactly one best buy and it is drawn.
  const s = F.scenario("shop-works");
  const best = s.vm.shop.segments.works.flatMap((r) => [r, ...(r.sub || [])]).filter((r) => r.best);
  assert.equal(best.length, 1);
  assert.ok(findById(renderShop(s.vm, s.ui, makeCtx("graphite", s)).toJSON(), `cw-shop-best-${best[0].id}`));
});

test("shop: buy passes the Works count to workshops and 1 to tiers and upgrades; tiers sit under their workshop", () => {
  const s = F.scenario("shop-works");
  const vm = clone(s.vm);
  for (const r of vm.shop.segments.works) {
    r.affordable = r.revealed !== false;
    for (const x of r.sub) x.affordable = true;
  }
  const ws = vm.shop.segments.works.find((r) => r.sub.length > 0);
  for (const count of [1, 10, "max"]) {
    vm.shop.buyCount = count;
    const ctx = makeCtx("graphite", s);
    const tree = renderShop(vm, s.ui, ctx);
    fire(tree, `cw-shop-buy-${ws.id}`, "on_click", {}, fakeCx());
    fire(tree, `cw-shop-buy-${ws.sub[0].id}`, "on_click", {}, fakeCx());
    assert.deepEqual(ctx.calls, [["buy", ws.id, count], ["buy", ws.sub[0].id, 1]]);
    const on = findById(tree.toJSON(), `cw-shop-count-${count}`);
    assert.equal(styleVal(on, "bg"), ctx.T.accent);
  }
  const ids0 = shopRows(renderShop(vm, s.ui, makeCtx("graphite", s)).toJSON()).map((n) => n.id);
  const at = ids0.indexOf(`cw-shop-row-${ws.id}`);
  assert.equal(ids0[at + 1], `cw-shop-row-${ws.sub[0].id}`);

  const t = F.scenario("shop-charms");
  const vm2 = clone(t.vm);
  const r = vm2.shop.segments.charms.find((x) => x.revealed && !x.owned) || vm2.shop.segments.charms[0];
  r.revealed = true;
  r.owned = 0;
  r.affordable = true;
  const ctx = makeCtx("graphite", t);
  fire(renderShop(vm2, t.ui, ctx), `cw-shop-buy-${r.id}`, "on_click", {}, fakeCx());
  assert.deepEqual(ctx.calls, [["buy", r.id, 1]]);
});

test("shop: unrevealed items are ??? silhouettes (at most 2, never the real name), owned upgrades fold into Owned (n)", () => {
  for (const seg of F.SHOP_SEGMENTS) {
    const s = F.scenario(`shop-${seg}`);
    const rows = s.vm.shop.segments[seg];
    const hidden = rows.filter((r) => r.revealed === false);
    const ctx = makeCtx("graphite", s);
    const tree = renderShop(s.vm, s.ui, ctx);
    const json = tree.toJSON();
    const all = texts(json).join(" | ");
    for (const r of hidden) assert.ok(!all.includes(r.name), `${seg}: hidden ${r.name} printed`);
    const sil = ids(json).filter((id) => id.startsWith("cw-shop-unknown-"));
    assert.equal(sil.length, Math.min(SILHOUETTES, hidden.length), seg);
    for (const [i, id] of sil.entries()) assert.equal(id, `cw-shop-unknown-${hidden[i].id}`);
    if (hidden.length > SILHOUETTES) assert.ok(all.includes(`+${hidden.length - SILHOUETTES} more to discover`), seg);
    const owned = seg === "works" || seg === "auto" ? [] : rows.filter((r) => r.revealed !== false && r.owned > 0);
    const sec = findById(json, `cw-shop-owned-${seg}`);
    assert.equal(Boolean(sec), owned.length > 0, `${seg}: Owned section iff owned upgrades`);
    if (sec) {
      assert.ok(texts(sec).includes(`Owned (${owned.length})`));
      assert.equal(sec.children.length, 1, "folded by default");
      fire(tree, `cw-shop-owned-${seg}-toggle`, "on_click", {}, fakeCx());
      assert.deepEqual(ctx.calls, [["toggleGroup", `owned:${seg}`]]);
      const open = renderShop(s.vm, { ...s.ui, folded: { [`owned:${seg}`]: false } }, ctx).toJSON();
      assert.equal(findById(open, `cw-shop-owned-${seg}`).children.length, 1 + owned.length);
      for (const r of owned) assert.equal(findById(json, `cw-shop-row-${r.id}`), null, `${seg}: owned ${r.id} not a buy row`);
    }
  }
});

test("shop Auto: owned automations show a Switch wired to switchAuto", () => {
  const s = F.scenario("shop-auto");
  const ctx = makeCtx("graphite", s);
  const tree = renderShop(s.vm, s.ui, ctx);
  const owned = s.vm.shop.segments.auto.filter((r) => r.owned > 0);
  assert.ok(owned.length >= 1);
  for (const r of owned) {
    const sw = findById(tree.toJSON(), `cw-shop-auto-${r.id}`);
    assert.equal(sw.kind, "Switch");
    fire(tree, `cw-shop-auto-${r.id}`, "on_change", !(r.on !== false), fakeCx());
  }
  assert.deepEqual(ctx.calls, owned.map((r) => ["switchAuto", r.id, !(r.on !== false)]));
});

// ---------------------------------------------------------------------------
// String

test("string: 20 strand columns, 40 strand sprites, filled heights from the crane count, on a 304×208 S.mat card", () => {
  for (const name of ["string-locked", "string-ready", "garlands", "first-run"]) {
    const s = F.scenario(name);
    const ctx = makeCtx("graphite", s);
    const json = renderString(s.vm, s.ui, ctx).toJSON();
    const card = findById(json, "cw-string-card");
    assert.equal(styleVal(card, "w"), 304);
    assert.equal(styleVal(card, "h"), STRAND.card);
    assert.equal(styleVal(card, "bg"), ctx.S.mat);
    let svgs = 0;
    walk(card, (n) => {
      if (n.kind === "svg") {
        svgs++;
        assert.match(n.args[0], /ui\/garland-strand\.svg$/);
        assert.equal(styleVal(n, "text_color"), ctx.S.sheet);
      }
    });
    assert.equal(svgs, 2 * STRAND.count, `${name}: 40 sprites, never 1,000`);
    const cranes = s.vm.string.cranes;
    let filled = 0;
    for (let i = 0; i < STRAND.count; i++) {
      const f = findById(card, `cw-string-strand-${i}`);
      assert.ok(f, `strand ${i}`);
      assert.ok(style(f, "overflow_hidden"));
      assert.deepEqual(f.transitions.map((t) => t.property ?? t[0]), ["height"]);
      filled += styleVal(f, "h");
    }
    assert.ok(Math.abs(filled - (Math.min(cranes, 1000) / 1000) * STRAND.count * STRAND.h) < 1, `${name}: ${filled}`);
    assert.ok(texts(json).includes(`${cranes.toLocaleString("en-US")} / 1,000 cranes`), name);
  }
});

test("string: the wish button is disabled below the gate; the confirm card arms after 1.5 s", () => {
  const locked = F.scenario("string-locked");
  const ctx = makeCtx("graphite", locked);
  const tree = renderString(locked.vm, locked.ui, ctx);
  const btn = findById(tree.toJSON(), "cw-string-wish");
  assert.equal(styleVal(btn, "disabled"), true);
  assert.deepEqual(Object.keys(btn.handlers), []);

  const ready = F.scenario("string-ready");
  const ctx2 = makeCtx("paper", ready);
  const t2 = renderString(ready.vm, ready.ui, ctx2);
  const b2 = findById(t2.toJSON(), "cw-string-wish");
  assert.equal(styleVal(b2, "bg"), ctx2.T.accent);
  assert.equal(styleVal(b2, "w"), 304);
  assert.equal(styleVal(b2, "h"), 36);
  assert.ok(texts(b2)[0].startsWith("Make the wish (+10 Wishes)"));
  fire(t2, "cw-string-wish", "on_click", {}, fakeCx());
  assert.deepEqual(ctx2.calls, [["confirm", "wish"]]);

  const conf = F.scenario("string-confirm");
  for (const [armedAt, now, armed] of [[undefined, undefined, false], [1000, 1000, false], [1000, 2499, false], [1000, 2500, true], [1000, 9000, true]]) {
    const ui = { ...conf.ui, armedAt, now };
    assert.equal(isArmed(ui), armed);
    const c = makeCtx("graphite", conf);
    const tree3 = renderString(conf.vm, ui, c);
    const json = tree3.toJSON();
    assert.equal(findById(json, "cw-string-wish"), null, "the button turned into the card");
    const card = findById(json, "cw-string-confirm");
    assert.equal(styleVal(card, "bg"), c.T.popover);
    assert.equal(styleVal(card, "border_color"), c.T.accent);
    const make = findById(json, "cw-string-make");
    assert.equal(styleVal(make, "disabled"), !armed, `armedAt ${armedAt} now ${now}`);
    fire(tree3, "cw-string-keep", "on_click", {}, fakeCx());
    if (armed) fire(tree3, "cw-string-make", "on_click", {}, fakeCx());
    else assert.throws(() => fire(tree3, "cw-string-make", "on_click", {}, fakeCx()), /no on_click handler/);
    assert.deepEqual(c.calls, armed ? [["cancel"], ["wish"]] : [["cancel"]]);
  }
  assert.equal(ARM_MS, 1500);
  // A confirm card never shows while the gate is shut.
  assert.equal(findById(renderString(locked.vm, { ...locked.ui, confirm: "wish", armedAt: 0, now: 5000 }, ctx).toJSON(), "cw-string-confirm"), null);
});

test("string: perks list, and one garland per wish of paint_path stripes with one Background each and a tooltip", () => {
  const s = F.scenario("garlands");
  const ctx = makeCtx("graphite", s);
  const json = renderString(s.vm, s.ui, ctx).toJSON();
  const perks = findById(json, "cw-string-perks");
  assert.equal(perks.children.length, 1 + s.vm.string.perks.length);
  for (const [i, p] of s.vm.string.perks.entries()) assert.ok(texts(perks.children[i + 1]).includes(p.text));
  const box = findById(json, "cw-string-garlands");
  assert.ok(box);
  for (const g of s.vm.string.garlands) {
    const bar = findById(box, `cw-string-g${g.wish}`);
    assert.ok(bar, `garland ${g.wish}`);
    assert.equal(styleVal(bar, "h"), 12);
    assert.equal(styleVal(bar, "w"), 304);
    const total = g.stripes.reduce((a, st) => a + st[1], 0);
    let width = 0;
    g.stripes.forEach((st, j) => {
      const wrap = findById(bar, `cw-string-g${g.wish}-s${j}`);
      assert.ok(wrap, `stripe ${j}`);
      width += styleVal(wrap, "w");
      assert.equal(styleVal(wrap, "tooltip"), `${st[2]}: ${Math.round((st[1] / total) * 100)} %`);
      assert.equal(wrap.children.length, 1);
      const path = wrap.children[0];
      assert.equal(path.kind, "path", "window.paint_path");
      assert.equal(path.args[1].kind, "solid");
      assert.equal(path.args[1].values.length, 1);
      if (st[0] === "hands") assert.equal(path.args[1].values[0], ctx.S.node);
      if (st[0] === "workshops") assert.equal(path.args[1].values[0], ctx.S.sheetShade);
      if (st[0] === "rest") assert.equal(path.args[1].values[0], ctx.T.muted);
      if (st[0].startsWith("hue:")) assert.equal(path.args[1].values[0], ctx.hues[Number(st[0].slice(4))]);
    });
    assert.ok(Math.abs(width - 304) < 1, `garland ${g.wish} spans ${width}`);
    assert.ok(texts(box).some((w) => w.startsWith(`#${g.wish} · ${g.day} · ${g.wishes} Wishes`)));
  }
});

// ---------------------------------------------------------------------------
// Settings

test("settings: §3.6 sections in order, switches and radios wired to setting/switchAuto", () => {
  const s = F.scenario("settings");
  const ctx = makeCtx("graphite", s, { save: { state: "saved", text: "Saved 12 s ago", path: "/home/me/.herdr/data/creaseworks/save.json", backup: "3 m ago" } });
  const tree = renderSettings(s.vm, s.ui, ctx);
  const json = tree.toJSON();
  const heads = ids(json).filter((id) => id.startsWith("cw-set-h-"));
  assert.deepEqual(heads, ["cw-set-h-calm", "cw-set-h-notify", "cw-set-h-auto", "cw-set-h-play", "cw-set-h-roster", "cw-set-h-style", "cw-set-h-save"]);
  for (const row of ["cw-set-calm-row", "cw-set-notify-master-row", "cw-set-gather-row", "cw-set-nodes-row", "cw-set-pops-row"]) {
    assert.equal(styleVal(findById(json, row), "min_h"), 36, row);
  }
  const cx = fakeCx;
  fire(tree, "cw-set-calm", "on_change", true, cx());
  fire(tree, "cw-set-notify-master", "on_change", false, cx());
  fire(tree, "cw-set-notify-pile", "on_change", true, cx());
  fire(tree, "cw-set-gather", "on_change", false, cx());
  fire(tree, "cw-set-nodes", "on_change", false, cx());
  fire(tree, "cw-set-pops", "on_change", false, cx());
  fire(tree, "cw-set-order-workspace", "on_click", {}, cx());
  fire(tree, "cw-set-density-always", "on_click", {}, cx());
  fire(tree, "cw-set-style-sci", "on_click", {}, cx());
  fire(tree, "cw-set-auto-mail-sorter", "on_change", false, cx());
  fire(tree, "cw-set-check", "on_click", {}, cx());
  fire(tree, "cw-set-restore", "on_click", {}, cx());
  fire(tree, "cw-set-share", "on_click", {}, cx());
  fire(tree, "cw-set-reset", "on_click", {}, cx());
  assert.deepEqual(ctx.calls, [
    ["setting", "calm", true], ["setting", "notify.master", false], ["setting", "notify.pile", true],
    ["setting", "gather", false], ["setting", "nodes", false], ["setting", "pops", false],
    ["setting", "order", "workspace"], ["setting", "density", "always"], ["setting", "style", "sci"],
    ["switchAuto", "mail-sorter", false], ["checkSave"], ["confirm", "restore"],
    // r1-16: the share button opens the share card; it never sends this window's own path.
    ["confirm", "share"], ["confirm", "reset"],
  ]);
  // Only owned automations get a switch; "1 of 3 sent today".
  const switches = [];
  walk(json, (n) => {
    if (n.kind === "Switch" && n.id.startsWith("cw-set-auto-")) switches.push(n.id);
  });
  assert.deepEqual(switches, s.vm.settings.automations.filter((a) => a.owned).map((a) => `cw-set-auto-${a.id}`));
  assert.ok(texts(json).some((w) => w.startsWith("1 of 3 sent today")));
  // Chosen radio is not re-selectable (no duplicate setting).
  const c2 = makeCtx("graphite", s);
  fire(renderSettings(s.vm, s.ui, c2), "cw-set-order-urgency", "on_click", {}, fakeCx());
  assert.deepEqual(c2.calls, []);
});

test("settings: event checkboxes off with the master switch; floating numbers off and disabled in calm", () => {
  const s = F.scenario("settings");
  const vm = clone(s.vm);
  vm.settings.notify.master = false;
  const json = renderSettings(vm, s.ui, makeCtx("graphite", s)).toJSON();
  for (const k of ["full", "pile", "save"]) {
    const cb = findById(json, `cw-set-notify-${k}`);
    assert.equal(styleVal(cb, "disabled"), true);
    assert.equal(styleVal(cb, "checked"), false);
    assert.deepEqual(Object.keys(cb.handlers), []);
  }
  const calm = F.scenario("calm");
  const cj = renderSettings(calm.vm, calm.ui, makeCtx("graphite", calm)).toJSON();
  const pops = findById(cj, "cw-set-pops");
  assert.equal(styleVal(pops, "disabled"), true);
  assert.equal(styleVal(pops, "checked"), false);
  assert.equal(styleVal(findById(cj, "cw-set-calm"), "checked"), true);
});

test("settings: restore and reset are two-step confirms armed after 1.5 s", () => {
  const s = F.scenario("settings");
  for (const kind of ["restore", "reset"]) {
    for (const [now, armed] of [[100, false], [1499, false], [1500, true]]) {
      const ctx = makeCtx("graphite", s, { save: { state: "saved", backup: "3 m ago", path: "/p/save.json" } });
      const tree = renderSettings(s.vm, { ...s.ui, confirm: kind, armedAt: 0, now }, ctx);
      const json = tree.toJSON();
      const card = findById(json, `cw-set-${kind}-card`);
      assert.ok(card, kind);
      assert.equal(styleVal(card, "border_color"), ctx.T.accent);
      assert.equal(styleVal(findById(json, `cw-set-${kind}`), "disabled"), true, "the first button waits while the card is open");
      assert.equal(styleVal(findById(json, `cw-set-${kind}-confirm`), "disabled"), !armed);
      fire(tree, `cw-set-${kind}-cancel`, "on_click", {}, fakeCx());
      if (armed) fire(tree, `cw-set-${kind}-confirm`, "on_click", {}, fakeCx());
      assert.deepEqual(ctx.calls, armed ? [["cancel"], [kind === "reset" ? "resetGame" : "restoreBackup"]] : [["cancel"]]);
    }
  }
  // No backup yet: Restore is disabled.
  const json = renderSettings(s.vm, s.ui, makeCtx("graphite", s, { save: { state: "saved", backup: false } })).toJSON();
  assert.equal(styleVal(findById(json, "cw-set-restore"), "disabled"), true);
});

test("settings: the save path is middle-truncated and a problem shows the warn glyph", () => {
  const s = F.scenario("settings");
  const path = "/home/someone/with/a/very/long/herdr/application/home/data/creaseworks/save.json";
  const json = renderSettings(s.vm, s.ui, makeCtx("graphite", s, { save: { state: "problem", text: "Can't save: disk full", path, backup: "3 m ago" } })).toJSON();
  const p = texts(findById(json, "cw-set-save-path"))[0];
  assert.ok(graphemes(p).length <= SETTINGS_CLIP.path);
  assert.ok(p.startsWith("/home/") && p.endsWith("save.json") && p.includes("…"), p);
  let warn = false;
  walk(findById(json, "cw-set-save"), (n) => {
    if (n.kind === "svg" && n.args[0].endsWith("ui/warn.svg")) warn = true;
  });
  assert.ok(warn);
});

// ---------------------------------------------------------------------------
// Render time

const TAB_VIEWS = [
  ["flock", "flock-64-dense"], ["flock", "flock-34"], ["shop", "shop-works"], ["shop", "shop-charms"],
  ["string", "garlands"], ["settings", "settings"],
];

test("render time: a 64-helper Flock and each tab well under the 50 ms render budget (Node)", () => {
  const rows = [];
  for (const [tab, view] of TAB_VIEWS) {
    const s = F.scenario(view);
    const ui = { ...s.ui, folded: { resting: false }, selected: s.vm.helpers.groups[0]?.tiles[0]?.helperId ?? null };
    const ctx = makeCtx("graphite", s);
    RENDER[tab](s.vm, ui, ctx); // warm
    const N = 10;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) RENDER[tab](s.vm, ui, ctx);
    const ms = (performance.now() - t0) / N;
    rows.push(`${tab}/${view} ${ms.toFixed(2)}`);
    assert.ok(ms < 15, `${tab} ${view}: ${ms.toFixed(2)} ms per render`);
  }
  console.log(`# tab render ms (mean of 10): ${rows.join(", ")}`);
});

const FROZEN_REALM = Object.isFrozen(Object.prototype);

test("qjs: the tab modules load under the sandbox; the 64-helper Flock renders within budget", {
  skip: FROZEN_REALM && "quickjs-emscripten does not load with frozen prototypes",
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), "cw-tabs-"));
  try {
    cpSync(join(root, "mods/creaseworks/engine"), join(dir, "engine"), { recursive: true });
    mkdirSync(join(dir, "ui"));
    for (const f of readdirSync(UI)) if (f.endsWith(".js")) copyFileSync(join(UI, f), join(dir, "ui", f));
    const views = TAB_VIEWS.map(([tab, view]) => {
      const s = F.scenario(view);
      return { tab, s: { ...s, ui: { ...s.ui, folded: { resting: false } } } };
    });
    writeFileSync(join(dir, "main.js"), [
      'import { View } from "gpui-kit";',
      'import { v_flex } from "gpui-base";',
      'import { pickScene, pickHues } from "./ui/palette.js";',
      'import { renderFlock } from "./ui/flock.js";',
      'import { renderShop } from "./ui/shop.js";',
      'import { renderString } from "./ui/string.js";',
      'import { renderSettings } from "./ui/settings.js";',
      "const R = { flock: renderFlock, shop: renderShop, string: renderString, settings: renderSettings };",
      `const T = ${JSON.stringify(THEMES.graphite)};`,
      `const VIEWS = ${JSON.stringify(views)};`,
      "let pick = 0;",
      "globalThis.__pick = (i) => { pick = i; };",
      "export default class M extends View {",
      "  render() {",
      "    const out = v_flex().id(\"m\");",
      "    VIEWS.forEach((v, i) => {",
      "      if (i !== pick) return;",
      "      const ctx = { T, S: pickScene(true), hues: pickHues(true), zoom: 1, calm: false, width: v.s.width, height: v.s.height, handlers: {} };",
      "      out.child(R[v.tab](v.s.vm, v.s.ui, ctx));",
      "    });",
      "    return out;",
      "  }",
      "}",
      "",
    ].join("\n"));
    const host = await createHost({ modRoot: dir, scenario: {} });
    try {
      await host.load();
      // The 64-helper Flock (view 0) several times: the first QuickJS pass is the slowest.
      const times = [];
      for (let i = 0; i < 3; i++) {
        const { tree, ms } = host.render();
        assert.equal(tree.children[0].id, "cw-flock");
        times.push(ms);
      }
      const rest = [];
      for (let i = 1; i < views.length; i++) {
        host.evalInVm(`globalThis.__pick(${i})`);
        const { tree, ms } = host.render();
        assert.equal(tree.children.length, 1);
        rest.push(`${views[i].tab}/${views[i].s.name} ${ms.toFixed(1)}`);
      }
      assert.deepEqual(host.errors, []);
      console.log(`# qjs render ms: flock-64-dense ${times.map((m) => m.toFixed(1)).join(" / ")}; ${rest.join(", ")}`);
      assert.ok(times.at(-1) < 50, `flock-64-dense ${times}`);
    } finally {
      host.dispose();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("asset files used by the tabs exist", () => {
  const paths = new Set();
  for (const s of PANEL_SCENARIOS) {
    for (const render of Object.values(RENDER)) {
      walk(render(s.vm, { ...s.ui, folded: { resting: false, elsewhere: false, album: false, legend: false } }, makeCtx("graphite", s)).toJSON(), (n) => {
        if (n.kind === "svg") paths.add(n.args[0]);
      });
    }
  }
  for (const p of paths) assert.ok(existsSync(join(root, p)), p);
  assert.ok(paths.size > 20);
});

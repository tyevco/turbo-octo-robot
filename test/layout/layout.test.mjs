// layouts/<Name>.json (DESIGN §2.5) and mods/<mod>/mod.json, checked against
// herdr-app 0.1.18: src/layout.rs fields (tools/layout/schema.mjs), unique and
// kept ids, missing_mods rules, and the palette's mod.json rules.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateLayout, layoutIds, walkNodes, pathTo, modStrings, propsValues, referencedMods, paletteEntryError,
} from "../../tools/layout/schema.mjs";
import { build, buildLayout, PANEL_WEIGHT, FILES_WEIGHT } from "../../tools/layout/build.mjs";
import { layoutBoxes, shares } from "../../tools/render/window.mjs";
import { find, validateArgs, missing } from "../../tools/mock/commands.js";
import {
  at, readJson, GAME, LAYOUT_PATH, MOD_DIR, REF, MAIN, HERDR_SRC, HAVE_HERDR, isDir, designJsonBlocks, KNOWN_MODS,
} from "./_util.mjs";

const LAYOUT = readJson(LAYOUT_PATH);
const clone = (x) => JSON.parse(JSON.stringify(x));
const ADDED = ["cw-panel", "cw-ribbon"];

describe("committed herdr copies", () => {
  test("tools/layout/main.json is herdr's shipped main.json, byte for byte", { skip: !HAVE_HERDR && "herdr source not present" }, () => {
    assert.equal(readFileSync(at("tools/layout/main.json"), "utf8"), readFileSync(resolve(HERDR_SRC, "defaults/layouts/main.json"), "utf8"));
  });

  test("tools/layout/herdr-defaults.json matches herdr's keys files and shipped mods", { skip: !HAVE_HERDR && "herdr source not present" }, () => {
    const shippedDir = resolve(HERDR_SRC, "src/keys/shipped");
    const files = ["defaults/keys.json", "defaults/keys.macos.json", ...readdirSync(shippedDir).sort().map((f) => `src/keys/shipped/${f}`)];
    assert.deepEqual(Object.keys(REF.keys).sort(), files.sort());
    for (const f of files) assert.deepEqual(REF.keys[f], readJson(resolve(HERDR_SRC, f)), f);
    const mods = readdirSync(resolve(HERDR_SRC, "defaults/mods")).filter((n) => isDir(resolve(HERDR_SRC, "defaults/mods", n))).sort();
    assert.deepEqual(REF.shippedMods, mods);
  });
});

describe("schema validator (src/layout.rs)", () => {
  test("accepts every layout herdr ships", () => {
    const shipped = HAVE_HERDR
      ? readdirSync(resolve(HERDR_SRC, "defaults/layouts")).filter((f) => f.endsWith(".json")).map((f) => resolve(HERDR_SRC, "defaults/layouts", f))
      : [at("tools/layout/main.json")];
    assert.ok(shipped.length >= 1);
    for (const f of shipped) assert.deepEqual(validateLayout(readJson(f)), [], f);
  });

  test("flags unknown, misplaced and mistyped fields", () => {
    const cases = [
      [(l) => { l.minn = 3; }, /unknown field "minn"/],
      [(l) => { l.children[0].children[0].content.props = { a: 1 }; l.children[0].children[0].content.prop = 1; }, /unknown field "prop"/],
      [(l) => { l.children[1].content = { mod: "tabs" }; }, /unknown field "content"/],
      [(l) => { l.children[1].preview = "x.png"; }, /"preview" is read on the root only/],
      [(l) => { l.children[0].id = "work"; }, /duplicate id "work"/],
      [(l) => { l.children[0].type = "grid"; }, /unknown type "grid"/],
      [(l) => { l.children[0].size = { px: 10, weight: 1 }; }, /exactly \{px\} or \{weight\}/],
      [(l) => { l.children[0].hidden = "yes"; }, /hidden: must be true or false/],
      [(l) => { l.titlebar = "custom"; }, /titlebar: must be one of/],
      [(l) => { l.divider.colour = "x"; }, /unknown field "colour"/],
      [(l) => { l.children[0].children[0].content = { mod: "x", tab: "active" }; }, /more than one kind of content/],
      [(l) => { l.children[0].background = { image: "a.png", fit: "fill" }; }, /fit: must be one of/],
      [(l) => { l.children[0].min = 500; l.children[0].max = 100; }, /min 500 is above max 100/],
      [(l) => { l.floating = [{ id: "f", content: { agent: "focused" }, edge: "middle" }]; }, /edge: must be one of/],
    ];
    for (const [edit, re] of cases) {
      const l = clone(MAIN);
      edit(l);
      const problems = validateLayout(l);
      assert.ok(problems.some((p) => re.test(p)), `${re}: ${problems.join(" | ") || "no problems"}`);
    }
  });

  test("checks pane frames (main's active-tab content)", () => {
    const l = clone(MAIN);
    const main = walkNodes(l).find(({ node }) => node.id === "main").node;
    main.content.pane.header.reveal = "sometimes";
    main.content.pane.focus.background = "accent"; // a Line here, not a FocusLook
    const problems = validateLayout(l);
    assert.ok(problems.some((p) => /reveal: must be one of/.test(p)), problems.join(" | "));
    assert.ok(problems.some((p) => /focus: unknown field "background"/.test(p)), problems.join(" | "));
  });
});

describe(`layouts/${GAME.layout}.json`, () => {
  test("is what tools/layout/build.mjs writes (run it after changing main.json or the build)", () => {
    const { path, text } = build();
    assert.equal(path, LAYOUT_PATH);
    assert.equal(readFileSync(LAYOUT_PATH, "utf8"), text);
  });

  test("is exactly the layout in DESIGN §2.5", () => {
    const [layout] = designJsonBlocks("### 2.5 The layout file");
    assert.deepEqual(LAYOUT, layout);
  });

  test("parses with only fields src/layout.rs knows", () => {
    assert.deepEqual(validateLayout(LAYOUT), []);
  });

  test("ids are unique and non-empty", () => {
    const ids = layoutIds(LAYOUT);
    assert.equal(new Set(ids).size, ids.length, `duplicates: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
    for (const { node } of walkNodes(LAYOUT)) assert.ok(typeof node.id === "string" && node.id, JSON.stringify(node).slice(0, 80));
  });

  test("every node of main.json is kept, in the same place", () => {
    for (const { node } of walkNodes(MAIN)) {
      assert.deepEqual(pathTo(LAYOUT, node.id), pathTo(MAIN, node.id), node.id);
    }
  });

  test("adds only cw-panel, cw-ribbon, the preview and main's min; sizes the Files column by weight", () => {
    const mainIds = new Set(layoutIds(MAIN));
    assert.deepEqual(layoutIds(LAYOUT).filter((id) => !mainIds.has(id)).sort(), [...ADDED].sort());
    // Undo the additions: what is left is main.json exactly.
    const l = clone(LAYOUT);
    delete l.preview;
    const shipped = walkNodes(MAIN).find(({ node }) => node.id === "panel").node;
    for (const { node } of walkNodes(l)) {
      if (node.children) node.children = node.children.filter((c) => !ADDED.includes(c.id));
      if (node.id === "main") {
        assert.equal(node.min, 360);
        delete node.min;
      }
      if (node.id === "panel") {
        assert.deepEqual(node.size, { weight: FILES_WEIGHT });
        node.size = shipped.size;
      }
    }
    assert.deepEqual(l, MAIN);
    assert.deepEqual(buildLayout(MAIN, GAME), LAYOUT);
  });

  test("no theme or colors (the person's theme stays theirs)", () => {
    for (const { node } of walkNodes(LAYOUT)) {
      assert.ok(!("theme" in node), `${node.id} sets theme`);
      assert.ok(!("colors" in node), `${node.id} sets colors`);
    }
  });

  test("no string under a \"mod\" key inside props (missing_mods would require it)", () => {
    for (const { path, value } of propsValues(LAYOUT)) {
      assert.deepEqual(modStrings(value), [], path);
    }
  });

  test("every mod it names is shipped with herdr or is this repo's mod", () => {
    const names = referencedMods(LAYOUT);
    assert.ok(names.includes(GAME.mod));
    for (const n of names) assert.ok(KNOWN_MODS.has(n), `unknown mod ${n}`);
    assert.ok(isDir(MOD_DIR), `mods/${GAME.mod} is missing`);
  });

  test("cw-panel is the last child of work-body, not under panel-body", () => {
    const path = pathTo(LAYOUT, "cw-panel");
    assert.deepEqual(path, ["root", "work", "work-body", "cw-panel"]);
    assert.ok(!path.includes("panel-body") && !path.includes("panel"));
    const workBody = walkNodes(LAYOUT).find(({ node }) => node.id === "work-body").node;
    assert.equal(workBody.children.at(-1).id, "cw-panel");
  });

  test("cw-panel: a weight beside main, never below the 64 px rail, no max; content is the panel copy", () => {
    const panel = walkNodes(LAYOUT).find(({ node }) => node.id === "cw-panel").node;
    assert.equal(panel.type, "block");
    // A {px} node is flex_none in herdr (src/window.rs sized()): it would never give way.
    assert.deepEqual(panel.size, { weight: PANEL_WEIGHT });
    assert.equal(panel.min, 64);
    // A capped weight node leaves the rest of its share empty (pane_size.rs shares()).
    assert.ok(!("max" in panel));
    assert.ok(!panel.hidden);
    assert.deepEqual(panel.content, { mod: GAME.mod, props: { role: "panel" } });
  });

  test("cw-ribbon: 30 px, across the work column, right above status; always shown", () => {
    const work = walkNodes(LAYOUT).find(({ node }) => node.id === "work").node;
    const ids = work.children.map((c) => c.id);
    assert.deepEqual(ids, ["tabs", "work-body", "cw-ribbon", "status"]);
    const ribbon = work.children[2];
    assert.deepEqual(ribbon.size, { px: 30 });
    assert.ok(!ribbon.hidden);
    assert.deepEqual(ribbon.content, { mod: GAME.mod, props: { role: "ribbon" } });
  });

  test("main keeps terminals at least 360 px wide", () => {
    const main = walkNodes(LAYOUT).find(({ node }) => node.id === "main").node;
    assert.equal(main.min, 360);
  });

  // r1-32: laid out with herdr's own geometry (src/window/pane_size.rs shares(),
  // ported in tools/render/window.mjs), in the window states the game can be in.
  const STATES = {
    expanded: () => {},
    folded: (l) => { find(l, "cw-panel").size = { px: 64 }; },
    files: (l) => { find(l, "panel").hidden = false; },
    "files-folded": (l) => { find(l, "panel").hidden = false; find(l, "cw-panel").size = { px: 64 }; },
  };
  const find = (l, id) => walkNodes(l).find(({ node }) => node.id === id).node;
  const boxesAt = (state, width, height, zoom) => {
    const l = clone(LAYOUT);
    STATES[state](l);
    return layoutBoxes(l, { width, height, zoom });
  };
  /** Whether herdr's own nodes plus the rail can fit: sidebar, gaps and padding, main 360, Files 280 when open, rail 64. */
  const fits = (state, width, zoom) => {
    const files = state.startsWith("files");
    return width >= (268 + 1 + 16 + 360 + 8 + 64 + (files ? 280 + 8 : 0)) * zoom;
  };

  test("shares() is herdr's: px first, weights share the rest, min/max freeze, grow stays normalised", () => {
    const n = (size, min, max) => ({ size, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
    assert.deepEqual(shares([n({ px: 100 }), n({ weight: 1 }), n({ weight: 3 })], 500), [100, 100, 300]);
    assert.deepEqual(shares([n({ px: 100 }), n({ weight: 1 })], 500, 1.5), [150, 350]);
    assert.deepEqual(shares([n(undefined, 360), n({ weight: 1 }, 64)], 500), [360, 140], "min first");
    assert.deepEqual(shares([n(undefined, 360), n({ weight: 1 }, 64)], 300), [360, 64], "overflows: herdr clips");
    // A weight node at its max: the other keeps its normalised share, the rest is empty.
    assert.deepEqual(shares([n({ weight: 1 }), n({ weight: 1 }, 64, 320)], 1000), [500, 320]);
  });

  for (const [width, height] of [[1100, 700], [1280, 800], [1440, 900], [1920, 1080], [2560, 1440]]) {
    for (const zoom of [1, 1.5]) {
      for (const state of Object.keys(STATES)) {
        test(`${width}x${height} zoom ${zoom}, ${state}: the game panel is on screen and the terminals keep 360`, () => {
          const b = boxesAt(state, width, height, zoom);
          const p = b["cw-panel"];
          const wb = b["work-body"].inner;
          // No empty strip after the panel (a capped weight node would leave one).
          assert.ok(p.x + p.width >= wb.x + wb.width - 0.5 || !fits(state, width, zoom), `ends at ${p.x + p.width} of ${wb.x + wb.width}`);
          assert.ok(p.x + p.width <= wb.x + wb.width + 0.5 || !fits(state, width, zoom), `overflows: ${p.x + p.width} > ${wb.x + wb.width}`);
          if (!fits(state, width, zoom)) return; // herdr's own nodes and the rail need more than the window has
          assert.ok(Math.abs(p.visible.width - p.width) < 0.5, `panel ${p.width} px, ${p.visible.width} on screen`);
          assert.ok(p.width >= 64 * zoom - 0.01, `panel ${p.width}`);
          assert.ok(b.main.width >= 360 * zoom - 0.01, `terminals ${b.main.width}`);
          if (state.startsWith("files")) assert.ok(b.panel.visible.width >= 280 * zoom - 0.01, `Files ${b.panel.visible.width}`);
        });
      }
    }
  }

  test("designed widths: about 320 px at 1440 x 900, Files near its shipped 368, narrow windows shrink the game first", () => {
    const at1440 = boxesAt("expanded", 1440, 900, 1);
    assert.ok(Math.abs(at1440["cw-panel"].width - 320) <= 4, `panel ${at1440["cw-panel"].width}`);
    const files1440 = boxesAt("files", 1440, 900, 1);
    assert.ok(Math.abs(files1440.panel.width - 368) <= 4, `Files ${files1440.panel.width}`);
    const files1100 = boxesAt("files", 1100, 700, 1);
    assert.ok(files1100["cw-panel"].width >= 140, `1100 with Files: still a panel, ${files1100["cw-panel"].width}`);
    assert.ok(files1100.main.width >= 360 && files1100.panel.width >= 280);
    const z = boxesAt("expanded", 1100, 700, 1.5);
    assert.ok(z["cw-panel"].width >= 64 * 1.5 && z.main.width >= 540, "1100 at zoom 1.5: the panel gives way, the terminals keep 360");
  });

  test("the preview picture lives in the mod folder (it travels with the copied folder)", () => {
    assert.equal(LAYOUT.preview, `mods/${GAME.mod}/art/layout-preview.png`);
  });

  test("the preview picture exists", { todo: !existsSync(at(LAYOUT.preview)) && "made by npm run shots (ARCHITECTURE A12)" }, () => {
    assert.ok(existsSync(at(LAYOUT.preview)), LAYOUT.preview);
  });
});

describe(`mods/${GAME.mod}/mod.json`, () => {
  const path = resolve(MOD_DIR, "mod.json");
  const text = readFileSync(path, "utf8");

  test("is valid JSON (an invalid file docks the mod at the right)", () => {
    assert.doesNotThrow(() => JSON.parse(text));
    assert.equal(typeof JSON.parse(text), "object");
  });

  const meta = JSON.parse(text);

  test("is exactly DESIGN §2.5's", () => {
    const [, design] = designJsonBlocks("### 2.5 The layout file");
    assert.deepEqual(meta, design);
  });

  test("place none, a title, never focusable", () => {
    assert.equal(meta.place, "none");
    assert.equal(typeof meta.title, "string");
    assert.ok(meta.title.trim());
    assert.ok(!("focusable" in meta));
    assert.ok(!("overlay" in meta));
  });

  test("every palette entry is kept by the palette (defaults/frame/palette/main.js modEntry)", () => {
    assert.ok(Array.isArray(meta.palette) && meta.palette.length > 0);
    for (const p of meta.palette) assert.equal(paletteEntryError(p, GAME.mod, find), null, JSON.stringify(p));
    const ids = meta.palette.map((p) => `${p.command}:${JSON.stringify(p.args ?? {})}`);
    assert.equal(new Set(ids).size, ids.length, "duplicate entries are dropped");
  });

  test("mod commands are <mod>.<command> with no args; app commands exist with valid args", () => {
    const nodeIds = new Set(layoutIds(LAYOUT));
    for (const p of meta.palette) {
      const c = find(p.command);
      if (!c) {
        assert.match(p.command, new RegExp(`^${GAME.mod}\\.[a-z][a-z0-9_-]*$`), p.command);
        assert.ok(!("args" in p), `${p.command} takes no args`);
        continue;
      }
      assert.equal(validateArgs(c, p.args ?? {}), null, p.command);
      assert.equal(missing(c, p.args ?? {}), null, p.command);
      if (p.command.startsWith("layout.") && p.args?.id) assert.ok(nodeIds.has(p.args.id), `${p.command}: no node ${p.args.id}`);
    }
  });

  test("palette checker rejects what the palette drops", () => {
    const bad = [
      {},
      { title: " ", command: `${GAME.mod}.fold` },
      { title: "x", command: `${GAME.mod}.fold`, args: { a: 1 } },
      { title: "x", command: "other-mod.fold" },
      { title: "x", command: `${GAME.mod}.` },
      { title: "x", command: "layout.toggle" },
      { title: "x", command: "layout.toggle", args: { id: 3 } },
      { title: "x", command: "layout.toggle", args: { id: "a", px: 3 } },
      { title: "x", command: "layout.toggle", args: [] },
    ];
    for (const p of bad) assert.notEqual(paletteEntryError(p, GAME.mod, find), null, JSON.stringify(p));
  });
});

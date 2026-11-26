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
import { build, buildLayout, cappedWeightNodes, PANEL_WEIGHT, FILES_WEIGHT, FILES_MIN, MAIN_MIN, RAIL_WEIGHT } from "../../tools/layout/build.mjs";
import { layoutBoxes, shares } from "../../tools/render/window.mjs";
import { find, validateArgs, missing } from "../../tools/mock/commands.js";
import {
  at, readJson, GAME, LAYOUT_PATH, MOD_DIR, REF, MAIN, HERDR_SRC, HAVE_HERDR, isDir, designJsonBlocks, KNOWN_MODS,
} from "./_util.mjs";

const LAYOUT = readJson(LAYOUT_PATH);
const clone = (x) => JSON.parse(JSON.stringify(x));
const ADDED = ["cw-panel", "cw-ribbon"];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** ui/panel.js FULL_BELOW: a narrower panel draws the rail. */
const FULL_RAIL = Number(readFileSync(resolve(MOD_DIR, "ui/panel.js"), "utf8").match(/export const FULL_BELOW = (\d+);/)[1]);

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

  test("adds only cw-panel, cw-ribbon, the preview and main's min; sizes the Files column by weight with a lower min", () => {
    const mainIds = new Set(layoutIds(MAIN));
    assert.deepEqual(layoutIds(LAYOUT).filter((id) => !mainIds.has(id)).sort(), [...ADDED].sort());
    // Undo the additions: what is left is main.json exactly.
    const l = clone(LAYOUT);
    delete l.preview;
    const shipped = walkNodes(MAIN).find(({ node }) => node.id === "panel").node;
    for (const { node } of walkNodes(l)) {
      if (node.children) node.children = node.children.filter((c) => !ADDED.includes(c.id));
      if (node.id === "main") {
        assert.equal(node.min, MAIN_MIN);
        delete node.min;
      }
      if (node.id === "panel") {
        assert.deepEqual(node.size, { weight: FILES_WEIGHT });
        assert.equal(node.min, FILES_MIN);
        assert.ok(FILES_MIN < shipped.min, `Files min ${FILES_MIN} below herdr's ${shipped.min} (r6-07)`);
        assert.ok(!("max" in node) && typeof shipped.max === "number", "herdr's Files max is dropped: no max on a weight node (r7-01)");
        node.size = shipped.size;
        node.min = shipped.min;
        node.max = shipped.max;
      }
    }
    assert.deepEqual(l, MAIN);
    assert.deepEqual(buildLayout(MAIN, GAME), LAYOUT);
  });

  test("no {weight} node has a max (a capped weight node leaves an empty strip, B15, r7-01)", () => {
    assert.deepEqual(cappedWeightNodes(LAYOUT), []);
    const capped = clone(LAYOUT);
    walkNodes(capped).find(({ node }) => node.id === "panel").node.max = 900;
    assert.deepEqual(cappedWeightNodes(capped), ["panel"]);
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

  test("cw-panel sits in work-body right after main and before the Files column, not under panel-body", () => {
    const path = pathTo(LAYOUT, "cw-panel");
    assert.deepEqual(path, ["root", "work", "work-body", "cw-panel"]);
    assert.ok(!path.includes("panel-body") && !path.includes("panel"));
    const workBody = walkNodes(LAYOUT).find(({ node }) => node.id === "work-body").node;
    // herdr clips a too-tight row at its end (r2-15): the optional Files column
    // ends the row, so it is what gives way first, never the game.
    assert.deepEqual(workBody.children.map((c) => c.id), ["main", "cw-panel", "panel"]);
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

  test("main's min stops a drag at 80 px and still fits 1100 x 700 at zoom 1.5 with Files open", () => {
    const main = walkNodes(LAYOUT).find(({ node }) => node.id === "main").node;
    assert.equal(main.min, MAIN_MIN);
    assert.equal(MAIN_MIN, 80);
  });

  // r1-32: laid out with herdr's own geometry (src/window/pane_size.rs shares(),
  // ported in tools/render/window.mjs), in the window states the game can be in.
  // Folded is what the fold command runs: a tiny weight held at the 64 px min.
  const STATES = {
    expanded: () => {},
    folded: (l) => { find(l, "cw-panel").size = { weight: RAIL_WEIGHT }; },
    files: (l) => { find(l, "panel").hidden = false; },
    "files-folded": (l) => { find(l, "panel").hidden = false; find(l, "cw-panel").size = { weight: RAIL_WEIGHT }; },
  };
  const find = (l, id) => walkNodes(l).find(({ node }) => node.id === id).node;
  const boxesAt = (state, width, height, zoom) => {
    const l = clone(LAYOUT);
    STATES[state](l);
    return layoutBoxes(l, { width, height, zoom });
  };

  test("shares() is herdr's: px first, weights share the rest, min/max freeze, grow stays normalised", () => {
    const n = (size, min, max) => ({ size, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
    assert.deepEqual(shares([n({ px: 100 }), n({ weight: 1 }), n({ weight: 3 })], 500), [100, 100, 300]);
    assert.deepEqual(shares([n({ px: 100 }), n({ weight: 1 })], 500, 1.5), [150, 350]);
    assert.deepEqual(shares([n(undefined, 360), n({ weight: 1 }, 64)], 500), [360, 140], "min first");
    assert.deepEqual(shares([n(undefined, 360), n({ weight: 1 }, 64)], 300), [360, 64], "overflows: herdr clips");
    // A weight node at its max: the other keeps its normalised share, the rest is empty.
    assert.deepEqual(shares([n({ weight: 1 }), n({ weight: 1 }, 64, 320)], 1000), [500, 320]);
    // The rail: a tiny weight at its min leaves no strip; the others share the rest.
    assert.deepEqual(shares([n(undefined), n({ weight: RAIL_WEIGHT }, 64)], 2000), [1936, 64]);
  });

  // No case is skipped: every tested window has room for everything (MAIN_MIN is
  // chosen for the tightest one, 1100 x 700 at zoom 1.5 with Files open).
  // r7-01: herdr's zoom starts at 0.5 (settings.rs ZOOM_MIN), and wide or
  // zoomed-out windows are where a capped weight node (Files at its old max
  // 900) froze and left a strip: 3440 folded 285 px, 3840 folded 444, 5120
  // folded 954, 2560 zoom 0.8 folded 152, 1920 zoom 0.5 folded 222.
  const WIDE = [[2880, 1800], [3000, 2000], [3440, 1440], [3840, 2160], [5120, 2880]];
  for (const [width, height] of [[1100, 700], [1280, 800], [1440, 900], [1920, 1080], [2560, 1440], ...WIDE]) {
    for (const zoom of [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.5]) {
      for (const state of Object.keys(STATES)) {
        test(`${width}x${height} zoom ${zoom}, ${state}: everything on screen, no empty strip`, () => {
          const b = boxesAt(state, width, height, zoom);
          const p = b["cw-panel"];
          const wb = b["work-body"].inner;
          // No empty strip at the end of the row (a capped weight node would leave one), no overflow.
          const last = state.startsWith("files") ? b.panel : p;
          assert.ok(Math.abs(last.x + last.width - (wb.x + wb.width)) < 0.5, `ends at ${last.x + last.width} of ${wb.x + wb.width}`);
          assert.ok(Math.abs(p.visible.width - p.width) < 0.5, `panel ${p.width} px, ${p.visible.width} on screen`);
          assert.ok(p.width >= 64 * zoom - 0.01, `panel ${p.width}`);
          if (state.endsWith("folded")) assert.ok(Math.abs(p.width - 64 * zoom) < 0.01, `the rail is 64 px: ${p.width}`);
          assert.ok(b.main.width >= MAIN_MIN * zoom - 0.01, `terminals ${b.main.width}`);
          // At zoom 1 the terminals keep DESIGN §2.2's 360 in every state.
          if (zoom === 1) assert.ok(b.main.width >= 360 - 0.01, `terminals ${b.main.width} at zoom 1`);
          if (state.startsWith("files")) {
            assert.ok(b.panel.width >= FILES_MIN * zoom - 0.01, `Files ${b.panel.width}`);
            assert.ok(Math.abs(b.panel.visible.width - b.panel.width) < 0.5, `Files ${b.panel.width} px, ${b.panel.visible.width} on screen`);
          }
        });
      }
    }
  }

  // r2-15: herdr's zoom goes to 3.0 in 0.1 steps, and past 1.5 a window with
  // Files open can run out of room for every min ((80 + 160 + 64) x zoom). herdr
  // renders containers overflow_hidden and clips a row at its end, so Files
  // (the last child) gives way first: main and the game stay whole wherever
  // work-body holds main's min, a gap and the 64 px rail.
  const ZOOMS_PAST = [1.6, 1.7, 1.8, 2, 2.2, 2.5, 3];
  for (const [width, height] of [[1100, 700], [1280, 800], [1440, 900], [1920, 1080], [2560, 1440]]) {
    for (const zoom of ZOOMS_PAST) {
      for (const state of Object.keys(STATES)) {
        test(`past zoom 1.5: ${width}x${height} zoom ${zoom}, ${state}: the game is clipped last`, () => {
          const b = boxesAt(state, width, height, zoom);
          const p = b["cw-panel"];
          const wb = b["work-body"].inner;
          const fits = wb.width >= (MAIN_MIN + 8 + 64) * zoom - 0.01;
          // The terminals keep their min and are never clipped while it fits.
          assert.ok(b.main.width >= MAIN_MIN * zoom - 0.01, `terminals ${b.main.width}`);
          assert.ok(b.main.x + b.main.width <= p.x + 0.01, "main comes before the game");
          if (fits) {
            assert.ok(Math.abs(b.main.visible.width - b.main.width) < 0.5, `main ${b.main.width} px, ${b.main.visible.width} on screen`);
            assert.ok(Math.abs(p.visible.width - p.width) < 0.5, `panel ${p.width} px, ${p.visible.width} on screen`);
            assert.ok(p.width >= 64 * zoom - 0.01, `panel ${p.width}`);
            assert.ok(p.x + p.width <= width + 0.01, `panel ends at ${p.x + p.width} of ${width}`);
          }
          if (state.startsWith("files")) {
            // Files ends the row, so anything that does not fit is cut from Files first.
            assert.ok(b.panel.x >= p.x + p.width - 0.01, "Files comes after the game");
            if (p.visible.width < p.width - 0.5) assert.ok(b.panel.visible.width < 0.5, "the game is cut only once Files is gone");
          } else {
            // Without Files the game ends the row and fills it (no strip) wherever it fits. Only
            // zoom 3 below about 1300 px does not: herdr's own px sidebar (268 x 3) leaves
            // work-body less than main's min + the rail, which no order of ours can help.
            if (fits) assert.ok(Math.abs(p.x + p.width - (wb.x + wb.width)) < 0.5, `ends at ${p.x + p.width} of ${wb.x + wb.width}`);
            else assert.ok(zoom === 3 && width < 1300, `${width}x${height} zoom ${zoom} should fit without Files`);
          }
        });
      }
    }
  }

  test("past zoom 1.5 the reviewed windows keep the game on screen (r2-15)", () => {
    // Before the reorder: 1100 x 700 zoom 1.6 cut 47 of the rail's 102 px; zoom 2 put it all off-screen;
    // 1440 x 900 zoom 2.5 put it off-screen.
    for (const [w, h, z] of [[1100, 700, 1.6], [1100, 700, 2], [1100, 700, 2.5], [1440, 900, 2], [1440, 900, 2.5], [1440, 900, 3]]) {
      const b = boxesAt("files", w, h, z);
      const p = b["cw-panel"];
      assert.ok(Math.abs(p.visible.width - p.width) < 0.5 && p.x + p.width <= w, `${w}x${h} zoom ${z}: the game ${p.x}..${p.x + p.width}, ${p.visible.width} of ${p.width} on screen`);
      assert.ok(Math.abs(b.main.visible.width - b.main.width) < 0.5, `${w}x${h} zoom ${z}: main on screen`);
    }
    // With Files' min at 160 (r6-07) 1100 x 700 zoom 1.6 holds the whole row; at zoom 2 Files is clipped, keeping 226 of 320.
    const z16 = boxesAt("files", 1100, 700, 1.6);
    assert.ok(Math.abs(z16.panel.visible.width - z16.panel.width) < 0.5, `Files ${z16.panel.visible.width} of ${z16.panel.width}`);
    const z2 = boxesAt("files", 1100, 700, 2);
    assert.ok(z2.panel.visible.width < z2.panel.width && z2.panel.visible.width > 200, `Files ${z2.panel.visible.width} of ${z2.panel.width}`);
  });

  test("folding gives the terminals room whenever the panel is wider than the rail (the narrow hint's promise)", () => {
    for (const [width, height] of [[1100, 700], [1280, 800], [1440, 900], [1920, 1080], [2560, 1440]]) {
      for (const zoom of [1, 1.5]) {
        for (const files of [false, true]) {
          const open = boxesAt(files ? "files" : "expanded", width, height, zoom);
          const shut = boxesAt(files ? "files-folded" : "folded", width, height, zoom);
          const at = `${width}x${height} zoom ${zoom}${files ? " with Files" : ""}`;
          // The hint is offered only for a panel of 140 design px or more (session.js narrowHint).
          if (open["cw-panel"].width / zoom < 140) continue;
          assert.ok(shut.main.width > open.main.width + 0.5 * (open["cw-panel"].width - 64 * zoom) - 0.5,
            `${at}: terminals ${open.main.width} -> ${shut.main.width}`);
        }
      }
    }
  });

  test("designed widths (ARCHITECTURE B15): about 320 at 1440 x 900; Narrow at 1100 x 700; Wide and uncapped on big windows", () => {
    const px = (state, w, h, z = 1) => Math.round(boxesAt(state, w, h, z)["cw-panel"].width);
    assert.ok(Math.abs(px("expanded", 1440, 900) - 320) <= 4, `1440: ${px("expanded", 1440, 900)}`);
    const files1440 = boxesAt("files", 1440, 900, 1);
    assert.ok(Math.abs(files1440.panel.width - 368) <= 4, `Files ${files1440.panel.width}`);
    // DESIGN §2.4 states: Narrow 140-279, Standard 280-399, Wide 400+.
    assert.equal(px("expanded", 1100, 700), 226, "1100 x 700: Narrow (the terminals get 581 instead of 488)");
    assert.equal(px("files", 1440, 900), 217, "1440 x 900 with Files: Narrow");
    assert.equal(px("files", 1100, 700), 152, "1100 x 700 with Files: still a panel, Narrow (Files gives way to 257, r6-07)");
    assert.equal(px("expanded", 1920, 1080), 456, "1920: Wide");
    assert.equal(px("expanded", 2560, 1440), 636, "2560: Wide, past the old 560 cap (no max, B15)");
    // Zoom 1.5: the panel gives way first; with Files open it is the rail at 1100.
    const z = boxesAt("expanded", 1100, 700, 1.5);
    assert.equal(Math.round(z["cw-panel"].width), 185, "1100 at zoom 1.5: the panel gives way (124 design px, drawn as the rail)");
    assert.equal(Math.round(z.main.width), 475, "the terminals: 317 design px");
    const zf = boxesAt("files", 1100, 700, 1.5);
    assert.ok(zf["cw-panel"].width < FULL_RAIL * 1.5, `1100 at zoom 1.5 with Files: drawn as the rail (${zf["cw-panel"].width})`);
    assert.equal(Math.round(zf.panel.width), FILES_MIN * 1.5, "Files gives way to its (lowered) min");
  });

  // r6-07: herdr's Files min of 280 held 420 px at zoom 1.5 and left the
  // terminals 133 px (88 design px: a column or two per pane). Files now gives
  // way by weight, so the terminals stay usable in the tightest supported
  // window, open or folded, and never get less with Files open than before.
  const USABLE = 190; // design px for the terminals (two panes of about 13 columns at zoom 1.5)
  for (const [width, height] of [[1100, 700], [1280, 800], [1440, 900]]) {
    for (const state of ["files", "files-folded"]) {
      test(`r6-07: ${width}x${height} zoom 1.5, ${state}: the terminals keep a usable width`, () => {
        const b = boxesAt(state, width, height, 1.5);
        assert.ok(b.main.width / 1.5 >= USABLE, `terminals ${b.main.width / 1.5} design px`);
        assert.ok(Math.abs(b.main.visible.width - b.main.width) < 0.5, "on screen");
        const old = clone(LAYOUT);
        find(old, "panel").min = 280;
        STATES[state](old);
        assert.ok(b.main.width > layoutBoxes(old, { width, height, zoom: 1.5 }).main.width + 20, "wider than with herdr's 280 min");
      });
    }
  }
  test("r6-07: 1100x700 zoom 1.5 with Files: 294 px terminals (196 design px), not 133", () => {
    assert.equal(Math.round(boxesAt("files", 1100, 700, 1.5).main.width), 294);
    assert.equal(Math.round(boxesAt("files-folded", 1100, 700, 1.5).main.width), 313);
  });

  test("the preview picture lives in the mod folder (it travels with the copied folder)", () => {
    assert.equal(LAYOUT.preview, `mods/${GAME.mod}/art/layout-preview.png`);
  });

  // r6-15: a plain test. The picture is committed (Settings shows it, and it is
  // the only preview copied on install: herdr's AGENTS.md), so a fresh clone has it.
  test("the preview picture exists and is a PNG", () => {
    assert.ok(existsSync(at(LAYOUT.preview)), LAYOUT.preview);
    assert.deepEqual([...readFileSync(at(LAYOUT.preview)).subarray(0, 8)], PNG_MAGIC, LAYOUT.preview);
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

// r2-26: RECIPE.md is the brief another agent rebuilds the game from (herdr's
// defaults/AGENTS.md: "Write it from the real files ... nothing the build
// doesn't do"). It described the old px layout (main min 360, cw-panel px 320
// max 560, Files 368, layout.resize {px}, the rail below 140), which would
// bring the off-screen panel back. These checks read it against the files.
describe("RECIPE.md is written from the built files", () => {
  const recipe = readFileSync(at("RECIPE.md"), "utf8");
  const readme = readFileSync(at("README.md"), "utf8");
  const section = (name) => {
    const start = recipe.indexOf(`## ${name}`);
    assert.ok(start >= 0, `RECIPE.md has no "## ${name}"`);
    const rest = recipe.slice(start + 3);
    const end = rest.search(/\n## /);
    return end < 0 ? rest : rest.slice(0, end);
  };
  const node = (id) => walkNodes(LAYOUT).find(({ node: n }) => n.id === id).node;
  const workBody = node("work-body");
  const modFiles = (dir = MOD_DIR) => readdirSync(dir).flatMap((f) => {
    const p = resolve(dir, f);
    return isDir(p) ? modFiles(p) : f.endsWith(".js") ? [p] : [];
  });
  const sources = modFiles().map((p) => readFileSync(p, "utf8"));

  test("has the share format's sections, in order", () => {
    const heads = [...recipe.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    assert.deepEqual(heads, ["What you see", "How it behaves", "Built from", "Watch out", "Done when"]);
  });

  test("Built from: the node tree has work-body's children in order, with their sizes as built", () => {
    const tree = section("Built from").match(/```\n([\s\S]*?)```/)[1];
    const lineOf = (id) => tree.split("\n").find((l) => new RegExp(`[─└├]\\s${id} \\(`).test(l));
    const ids = workBody.children.map((c) => c.id);
    const at = ids.map((id) => tree.indexOf(lineOf(id) ?? `missing ${id}`));
    assert.ok(at.every((i) => i >= 0), `tree lines for ${ids}`);
    assert.deepEqual([...at].sort((a, b) => a - b), at, `work-body order ${ids}`);
    for (const c of workBody.children) {
      const line = lineOf(c.id);
      if (c.size?.weight !== undefined) assert.ok(line.includes(`weight ${c.size.weight}`), `${c.id}: ${line}`);
      if (c.size?.px !== undefined) assert.ok(line.includes(`${c.size.px}`), `${c.id}: ${line}`);
      if (c.min !== undefined) assert.ok(line.includes(`min ${c.min}`), `${c.id}: ${line}`);
      if (c.max !== undefined) assert.ok(line.includes(`max ${c.max}`), `${c.id}: ${line}`);
      else assert.ok(!/\bmax \d/.test(line), `${c.id} has no max: ${line}`);
      if (c.hidden) assert.ok(line.includes("hidden"), `${c.id}: ${line}`);
    }
    assert.ok(lineOf("cw-ribbon").includes(`px ${node("cw-ribbon").size.px}`));
    assert.ok(section("Built from").includes(`"min": ${MAIN_MIN}`), "the main min it adds");
    assert.ok(section("Built from").includes(`{"weight": ${FILES_WEIGHT}}`), "the Files weight");
  });

  test("What you see: the work body in the built order and sizes", () => {
    const see = section("What you see");
    const iMain = see.indexOf("**Terminal panes** (`main`");
    const iGame = see.indexOf("**Creaseworks panel** (`cw-panel`");
    const iFiles = see.indexOf("**Files / Changes panel**");
    assert.ok(iMain >= 0 && iGame >= 0 && iFiles >= 0);
    const order = workBody.children.map((c) => ({ main: iMain, "cw-panel": iGame, panel: iFiles })[c.id]);
    assert.deepEqual([...order].sort((a, b) => a - b), order, "same order as work-body");
    const line = (i) => see.slice(i, see.indexOf("\n", i));
    assert.ok(line(iMain).includes(`min ${MAIN_MIN} px`), line(iMain));
    assert.ok(line(iGame).includes(`weight ${PANEL_WEIGHT}`) && line(iGame).includes("min 64") && line(iGame).includes("no max"), line(iGame));
    assert.ok(line(iFiles).includes(`weight ${FILES_WEIGHT}`) && line(iFiles).includes(`min ${FILES_MIN}`) && line(iFiles).includes("no max") && !/max 900/.test(line(iFiles)), line(iFiles));
  });

  test("no figure of the old px layout is left", () => {
    for (const re of [/min:? 360/, /"min": 360/, /px 320/, /max 560/, /drag range/, /resize \{[^}]*\bpx\}/, /below 140 px it draws/, /panel is clipped/]) {
      assert.ok(!re.test(recipe), `RECIPE.md still says ${re}`);
    }
  });

  test("the rail threshold is ui/panel.js's", () => {
    const full = Number(readFileSync(resolve(MOD_DIR, "ui/panel.js"), "utf8").match(/export const FULL_BELOW = (\d+);/)[1]);
    assert.ok(section("What you see").includes(`below ${full} px it draws the rail`));
    assert.ok(section("Built from").includes(`draws the rail below ${full} px`));
  });

  test("herdr functions: exactly what the mod imports from \"herdr\"", () => {
    const imported = new Set();
    for (const src of sources) {
      for (const m of src.matchAll(/^import\s*\{([^}]*)\}\s*from\s*"herdr";/gm)) {
        for (const part of m[1].split(",")) {
          const name = part.trim().split(/\s+as\s+/)[0];
          if (name) imported.add(name);
        }
      }
    }
    assert.ok(imported.has("pickFiles") && imported.has("run"));
    const para = section("Built from").split("\n").find((l) => l.startsWith("**herdr functions**"));
    const listed = new Set([...para.matchAll(/`(\w+)\(\)`/g)].map((m) => m[1]));
    assert.deepEqual([...listed].sort(), [...imported].sort());
  });

  test("Commands run: every command the glue and the palette run, and resize by weight only", () => {
    const run = new Set();
    for (const src of sources) {
      for (const m of src.matchAll(/\b(?:safeRun|run)\(\s*"([a-z]+\.[a-z_]+)"/g)) run.add(m[1]);
      for (const m of src.matchAll(/\bcommand = "([a-z]+\.[a-z_]+)"/g)) run.add(m[1]);
    }
    const meta = readJson(resolve(MOD_DIR, "mod.json"));
    for (const p of meta.palette) if (find(p.command)) run.add(p.command);
    assert.ok(run.has("layout.resize") && run.has("pane.focus") && run.has("terminal.peek"), [...run].join(" "));
    const para = section("Built from").split("\n").find((l) => l.startsWith("**Commands run**"));
    for (const c of run) assert.ok(para.includes(`\`${c} {`), `${c} missing from: ${para}`);
    assert.match(para, /`layout\.resize \{id:"cw-panel", weight\}`/);
    assert.ok(!/layout\.resize \{[^}]*px/.test(para), "never px");
  });

  // r7-03: the Files line is the installer's list of what the mod writes
  // (defaults/AGENTS.md: say which files a mod touches). It left out
  // save.recovery.json, and said nothing of the companions written next to a
  // shared save. Every path glue/store.js pathsFor() gives is named, for this
  // home and for a shared save.
  test("Files: every file glue/store.js writes, here and next to a shared save (r7-03)", async () => {
    const { pathsFor } = await import(resolve(MOD_DIR, "glue/store.js"));
    const para = section("Built from").split("\n").find((l) => l.startsWith("**Files**"));
    assert.ok(para, "a **Files** paragraph");
    const own = pathsFor("<appHome>");
    const base = (p) => p.slice(p.lastIndexOf("/") + 1);
    assert.ok(para.includes(`\`${own.save}\``), `${own.save} in: ${para}`);
    const keys = Object.keys(own).filter((k) => !["dir", "shared"].includes(k));
    assert.deepEqual(keys.sort(), ["bak", "damaged", "location", "recovery", "save"], "store.js paths changed: update RECIPE's Files line");
    for (const k of keys) {
      const p = k === "damaged" ? own.damaged("<n>") : own[k];
      assert.ok(para.includes(`\`${base(p)}\``), `${k}: ${base(p)} missing from: ${para}`);
    }
    // Sharing: the backup, recovery and damaged files sit next to the shared file.
    const sh = pathsFor("<appHome>", "/path/name.json");
    for (const p of [sh.save, sh.bak, sh.recovery, sh.damaged("<n>")]) {
      assert.ok(para.includes(`\`${p}\``), `shared: ${p} missing from: ${para}`);
    }
    assert.equal(sh.location, own.location, "location.json stays in this home");
  });

  // r2-27: herdr's palette lists every mod's entries in every layout and
  // cannot scope them; outside Creaseworks they fail with a toast. That is
  // said where a person and a rebuilding agent will read it.
  test("Watch out and README say the palette entries work only in the Creaseworks layout", () => {
    const meta = readJson(resolve(MOD_DIR, "mod.json"));
    if (!Array.isArray(meta.palette) || !meta.palette.length) return;
    const watch = section("Watch out");
    assert.match(watch, /\*\*Palette entries show in every layout\.\*\*/);
    assert.match(watch, /no node "cw-panel" in the shown layout/);
    assert.match(watch, /unknown command/);
    assert.match(readme, /palette entries in every layout, but these work only while the Creaseworks layout is shown/);
    // "Commands always have a receiver" is true inside the layout only.
    assert.ok(!/Commands need a shown copy\. The ribbon is always shown/.test(watch));
  });

  // r5-19: herdr's ctrl-shift-l is a bare layout.switch, which takes the next
  // name of a main-first, byte-ordered list; it never returns to "your own" layout.
  test("README and RECIPE never say ctrl-shift-l switches back (r5-19)", () => {
    for (const [f, s] of [["README.md", readme], ["RECIPE.md", recipe]]) {
      assert.ok(!/ctrl-shift-l`?\s+(switches|goes|takes you)\s+back/.test(s), f);
      for (const line of s.split("\n").filter((l) => l.includes("ctrl-shift-l")))
        assert.match(line, /cycles/, `${f}: ${line}`);
      assert.match(s, /layout\.switch \{name:"main"\}/, `${f} names the way back`);
    }
    assert.match(section("Done when"), /`layout\.switch \{name:"main"\}`[^\n]*goes back to it unchanged/);
  });
});

// r6-15: the herdr.dev share format (layouts/, mods/<name>/, RECIPE.md,
// preview.png, keys.json) and the MIT licence are files a fresh clone must have.
describe("share-format files", () => {
  test(`layouts/${GAME.layout}.json and mods/${GAME.mod}/ are named after the game`, () => {
    assert.ok(existsSync(LAYOUT_PATH), LAYOUT_PATH);
    assert.ok(isDir(MOD_DIR), MOD_DIR);
    assert.ok(existsSync(resolve(MOD_DIR, "main.js")) && existsSync(resolve(MOD_DIR, "mod.json")));
  });

  test("preview.png at the root is a PNG", () => {
    assert.ok(existsSync(at("preview.png")), "preview.png");
    assert.deepEqual([...readFileSync(at("preview.png")).subarray(0, 8)], PNG_MAGIC);
  });

  test("keys.json exists and is a JSON object", () => {
    assert.ok(existsSync(at("keys.json")), "keys.json");
    const keys = readJson(at("keys.json"));
    assert.equal(typeof keys, "object");
    assert.ok(keys && !Array.isArray(keys));
  });

  test("RECIPE.md and README.md exist; README has the install step", () => {
    assert.ok(existsSync(at("RECIPE.md")) && existsSync(at("README.md")));
    assert.match(readFileSync(at("README.md"), "utf8"), /Add the layout at https?:\/\/\S+/);
  });

  test("LICENSE is MIT, copyright Tyler Coles", () => {
    assert.ok(existsSync(at("LICENSE")), "LICENSE");
    const lines = readFileSync(at("LICENSE"), "utf8").split(/\r?\n/);
    assert.equal(lines[0], "MIT License");
    assert.ok(lines.includes("Copyright (c) 2026 Tyler Coles"), lines.slice(0, 4).join(" | "));
    assert.ok(lines.some((l) => l.startsWith("Permission is hereby granted, free of charge")));
  });

  // r7-16: herdr is Apache-2.0. Files copied or adapted from it need the
  // licence text beside them (§4(a)) and a note of what was changed (§4(b));
  // LICENSE (MIT) covers only this repo's own work.
  const HERDR_FILES = [
    "tools/layout/main.json", "tools/layout/herdr-defaults.json", "tools/mock/themes.json", "tools/mock/commands.js",
    "tools/mock/theme-resolve.js", "tools/qjs/sandbox.js", "tools/render/window.mjs", `layouts/${GAME.layout}.json`,
  ];
  test("the Apache-2.0 text ships with herdr's files (r7-16)", () => {
    const apache = readFileSync(at("LICENSES/Apache-2.0.txt"), "utf8");
    assert.match(apache, /^\s*Apache License\s+Version 2\.0, January 2004/);
    assert.match(apache, /4\. Redistribution\./);
    assert.match(apache, /END OF TERMS AND CONDITIONS/);
    if (HAVE_HERDR) assert.equal(apache, readFileSync(resolve(HERDR_SRC, "LICENSE"), "utf8"), "herdr's own LICENSE, byte for byte");
  });
  test("THIRD-PARTY-NOTICES.md names every file copied, adapted or ported from herdr (r7-16)", () => {
    const notices = readFileSync(at("THIRD-PARTY-NOTICES.md"), "utf8");
    assert.match(notices, /herdr-app 0\.1\.18/);
    assert.match(notices, /Apache License, Version 2\.0/);
    assert.match(notices, /\(LICENSES\/Apache-2\.0\.txt\)/);
    assert.match(notices, /MIT, Copyright \(c\) 2026 Tyler Coles/);
    // Any tooling file whose header says it was copied or ported from herdr is listed too.
    const walk = (dir) => readdirSync(at(dir)).flatMap((f) => {
      const rel = `${dir}/${f}`;
      if (rel === "tools/out" || f === "node_modules") return [];
      return isDir(at(rel)) ? walk(rel) : /\.(m?js|json)$/.test(f) ? [rel] : [];
    });
    const marked = walk("tools").filter((f) => /copied from herdr|port of herdr|ported exactly/i.test(readFileSync(at(f), "utf8")));
    assert.ok(marked.includes("tools/mock/commands.js") && marked.includes("tools/qjs/sandbox.js"), marked.join(" "));
    for (const f of new Set([...HERDR_FILES, ...marked])) {
      assert.ok(existsSync(at(f)), f);
      assert.ok(notices.includes(`\`${f}\``), `${f} missing from THIRD-PARTY-NOTICES.md`);
    }
    // §4(b): the adapted layout says what was changed.
    const row = notices.split("\n").find((l) => l.startsWith(`| \`layouts/${GAME.layout}.json\``));
    assert.ok(row && /What was changed|weight/.test(row) && row.includes("cw-panel") && row.includes("cw-ribbon"), row);
  });
  test("README's licence note points at the Apache text and the notices (r7-16)", () => {
    const readme = readFileSync(at("README.md"), "utf8");
    const lic = readme.slice(readme.indexOf("## Licence"));
    assert.match(lic, /MIT\. Copyright \(c\) 2026 Tyler Coles/);
    assert.match(lic, /Apache License 2\.0/);
    assert.ok(lic.includes("(LICENSES/Apache-2.0.txt)") && lic.includes("(THIRD-PARTY-NOTICES.md)"), lic);
    assert.ok(lic.includes(`\`layouts/${GAME.layout}.json\` is adapted from herdr's \`main.json\``), lic);
  });
});

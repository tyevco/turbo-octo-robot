// Whole-window renderer (tools/render/window.mjs) and the screenshot rig
// (tools/shots/shoot.mjs, contact-sheet.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderWindow, parseLayout, contentNodes, layoutColor, MAIN_LAYOUT, THEMES,
} from "../../tools/render/window.mjs";
import { shoot, launchBrowser, parseArgs, validateViews, demoLayout } from "../../tools/shots/shoot.mjs";
import { pngSize, listShots } from "../../tools/shots/contact-sheet.mjs";

// herdr's shipped layout, when the research checkout is present.
const SHIPPED_MAIN =
  "/tmp/claude-0/-home-user-turbo-octo-robot/765765b0-bd4e-5d4c-890a-1f1834a9bff2/scratchpad/herdr-src/defaults/layouts/main.json";
const HAVE_MAIN = existsSync(SHIPPED_MAIN);
const mainOptions = () => (HAVE_MAIN ? { layoutPath: SHIPPED_MAIN } : { layout: MAIN_LAYOUT });

const clone = (x) => JSON.parse(JSON.stringify(x));
const nodeIds = (html) => [...html.matchAll(/data-node="([^"]+)"/g)].map((m) => m[1]);
const count = (html, needle) => html.split(needle).length - 1;

test("the embedded MAIN_LAYOUT is herdr's shipped main.json", { skip: !HAVE_MAIN && "shipped main.json not available" }, () => {
  assert.deepEqual(clone(MAIN_LAYOUT), JSON.parse(readFileSync(SHIPPED_MAIN, "utf8")));
});

test("main layout: every shipped region is drawn, the hidden panel is not", () => {
  const html = renderWindow({ ...mainOptions(), width: 1440, height: 900, theme: "graphite", gameMod: null });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /width:1440px;height:900px/);
  const ids = nodeIds(html);
  for (const id of ["root", "sidebar", "brand", "sidebar-lists", "spaces", "agents", "sidebar-footer", "work", "tabs", "work-body", "main", "status"]) {
    assert.ok(ids.includes(id), `region ${id}`);
  }
  for (const id of ["panel", "panel-body", "files", "changes"]) assert.ok(!ids.includes(id), `${id} is hidden`);
  // Chrome pieces.
  assert.ok(html.includes('class="chrome brand"') && html.includes(">Herdr<"));
  assert.ok(html.includes('class="chrome spaces"') && html.includes(">Spaces<"));
  assert.ok(html.includes('class="chrome agents"') && html.includes(">Agents<"));
  assert.ok(html.includes('class="chrome footer"') && html.includes("Settings") && html.includes("Add machine"));
  assert.ok(html.includes('class="chrome tabs"') && count(html, 'class="tab-pill"') === 2);
  assert.ok(html.includes('class="chrome status"') && html.includes("This computer") && html.includes("1 needs you"));
  // Pane cards: the demo workspace's active tab has two panes, framed (lone), 30px headers.
  assert.equal(count(html, 'class="pane"'), 2);
  assert.equal(count(html, 'class="pane-header"'), 2);
  assert.match(html, /class="pane-header" style="[^"]*height:30px/);
  assert.equal(count(html, 'class="terminal"'), 2);
  assert.ok(html.includes("var(--mono)") && html.includes("Welcome to Claude Code!") && html.includes("git:(main)"));
  // Status dots from the theme.
  const t = THEMES.graphite;
  for (const key of ["working", "blocked", "done", "idle", "chrome", "canvas", "accent"]) assert.ok(html.includes(t[key]), `graphite ${key}`);
  // The divider between sidebar and work.
  assert.equal(count(html, 'class="divider"'), 1);
});

test("paper theme uses paper colours", () => {
  const html = renderWindow({ ...mainOptions(), theme: "paper", gameMod: null });
  assert.ok(html.includes(THEMES.paper.chrome) && html.includes(THEMES.paper.canvas));
  assert.ok(!html.includes(THEMES.graphite.chrome));
  assert.throws(() => renderWindow({ theme: "nope" }), /unknown theme "nope"/);
});

test("the files/changes panel shows when not hidden, with its stack's active child", () => {
  const layout = clone(MAIN_LAYOUT);
  const panel = layout.children[1].children[1].children[1];
  panel.hidden = false;
  let html = renderWindow({ layout, gameMod: null });
  assert.ok(nodeIds(html).includes("panel") && nodeIds(html).includes("files"));
  assert.ok(!nodeIds(html).includes("changes"));
  assert.ok(html.includes("tick.js") && html.includes(">Files<"));
  panel.children[0].active = "changes";
  html = renderWindow({ layout, gameMod: null });
  assert.ok(nodeIds(html).includes("changes") && !nodeIds(html).includes("files"));
  assert.ok(html.includes(">Changes<") && html.includes("5 files"));
});

test("game blocks get their fragments; floats are placed by edge, align and peek", () => {
  const layout = demoLayout();
  layout.children[1].children[1].children[0].floating = [
    { id: "drawer", content: { mod: "demo-game", props: { role: "drawer" } }, edge: "right", align: "start", peek: 52 },
    { id: "gone", content: { mod: "demo-game" }, hidden: true },
  ];
  const html = renderWindow({
    layout, gameMod: "demo-game", scenario: { window: { platform: "macos" } },
    modBlocks: { "game-strip": "<b id=strip-frag>STRIP</b>", drawer: { html: "<b id=drawer-frag>D</b>", width: 200, height: 120 } },
  });
  assert.ok(html.includes('data-block="game-strip"') && html.includes("<b id=strip-frag>STRIP</b>"));
  assert.match(html, /data-float="drawer" data-edge="right" style="[^"]*width:200px;height:120px;top:12px;right:-148px/);
  assert.ok(!html.includes('data-float="gone"'));
  const open = renderWindow({ layout, gameMod: "demo-game", drawersOpen: true, modBlocks: { drawer: { html: "x", width: 200, height: 120 } } });
  assert.match(open, /data-float="drawer"[^>]*right:12px/);
  // macOS: traffic lights at [12, 16].
  assert.equal(count(html, "#ff5f57"), 1);
  // A game block without a fragment is a visible placeholder, not an error.
  const missing = renderWindow({ layout: demoLayout(), gameMod: "demo-game" });
  assert.ok(missing.includes('class="placeholder"') && missing.includes('no fragment for block &quot;game-strip&quot;'));
});

test("layout schema: sizes, zoom, colours and errors", () => {
  const layout = {
    id: "r", type: "column", background: { gradient: ["accent", "#102030"], angle: 90 },
    children: [
      { type: "block", size: { px: 40 }, min: 20, max: 60, content: { mod: "workspace-status" } },
      { id: "x", type: "row", size: { weight: 2 }, padding: [4, 6], radius: 8, border: { width: 2, color: "accent" }, gap: 3,
        children: [{ id: "t", type: "block", content: { terminal: "t1" } }] },
    ],
  };
  const parsed = parseLayout(layout);
  assert.equal(parsed.children[0].id, "node-1", "ids are auto-filled like herdr");
  const html = renderWindow({ layout, zoom: 1.5, gameMod: null });
  assert.match(html, /data-node="node-1" style="[^"]*flex:0 0 60px;min-height:30px;max-height:90px/);
  assert.match(html, /data-node="x" style="[^"]*flex:2 1 0px[^"]*border-radius:12px[^"]*border:3px solid #96b2d7[^"]*padding:6px 9px[^"]*gap:4.5px/);
  assert.ok(html.includes("linear-gradient(90deg, #96b2d7, #102030)"));
  assert.equal(layoutColor("#abc", THEMES.paper), "#abc");
  assert.equal(layoutColor("border", THEMES.paper), THEMES.paper.border);
  assert.throws(() => layoutColor("rebeccapurple", THEMES.paper), /neither a theme colour name/);
  assert.throws(() => parseLayout({ type: "grid", children: [] }), /unknown node type "grid"/);
  assert.throws(() => parseLayout({ id: "a", type: "row", children: [{ id: "a", type: "block", content: { mod: "m" } }] }), /duplicate node id "a"/);
  assert.throws(() => parseLayout({ type: "row", children: [], floating: [{ content: { mod: "m" } }] }), /a float needs an id/);
  assert.throws(() => parseLayout({ type: "block" }), /a block needs content/);
  assert.throws(() => parseLayout({ type: "row", children: [], size: { pct: 3 } }), /size must be/);
  const blocks = contentNodes(clone(MAIN_LAYOUT));
  assert.deepEqual(blocks.filter((b) => b.hidden).map((b) => b.id), ["files", "changes"]);
});

test("shoot CLI arguments and views validation", () => {
  assert.deepEqual(parseArgs(["--only", "a, b", "--out", "x", "--preview", "--no-windows", "--scale", "1"]),
    { only: ["a", "b"], out: "x", preview: true, windows: false, scale: 1 });
  assert.throws(() => parseArgs(["--bogus"]), /unknown option --bogus/);
  assert.throws(() => parseArgs(["--scale", "0"]), /--scale/);
  assert.throws(() => validateViews({}, "v"), /must be an array/);
  assert.throws(() => validateViews([{ name: "a b", size: { width: 1, height: 1 } }], "v"), /name must be/);
  assert.throws(() => validateViews([{ name: "a", size: { width: 1, height: 1 } }, { name: "a", size: { width: 1, height: 1 } }], "v"), /duplicate/);
  assert.throws(() => validateViews([{ name: "window-x", size: { width: 1, height: 1 } }], "v"), /reserved/);
  assert.throws(() => validateViews([{ name: "a", size: { width: 0, height: 1 } }], "v"), /size/);
});

// ---------------------------------------------------------------------------
// Screenshots (skipped when chromium cannot start)
// ---------------------------------------------------------------------------

let browser = null;
let launchError = null;
try {
  browser = await launchBrowser();
} catch (error) {
  launchError = error;
}
const noBrowser = launchError ? `chromium cannot launch: ${String(launchError.message).split("\n")[0]}` : false;

test.after(async () => {
  if (browser) await browser.close();
});

test("the demo view is screenshot in both themes, with a contact sheet", { skip: noBrowser }, async () => {
  const out = mkdtempSync(join(tmpdir(), "shots-"));
  try {
    const result = await shoot({ only: ["demo"], out, windows: false, browser, log: () => {} });
    assert.equal(result.demo, true);
    assert.deepEqual(result.errors, []);
    for (const theme of ["graphite", "paper"]) {
      const file = join(out, `demo-${theme}.png`);
      assert.ok(existsSync(file), file);
      assert.deepEqual(pngSize(file), { width: 1120, height: 480 }, "560x240 at deviceScaleFactor 2");
    }
    assert.deepEqual(listShots(out), ["demo-graphite.png", "demo-paper.png"]);
    assert.ok(existsSync(join(out, "contact-sheet.png")));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("a whole window is screenshot at its size", { skip: noBrowser }, async () => {
  const out = mkdtempSync(join(tmpdir(), "shots-"));
  try {
    const result = await shoot({ only: ["window"], out, scale: 1, sheet: false, browser, log: () => {} });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(pngSize(join(out, "window-1440x900-graphite.png")), { width: 1440, height: 900 });
    assert.deepEqual(pngSize(join(out, "window-1100x700-paper.png")), { width: 1100, height: 700 });
    assert.ok(!existsSync(join(out, "demo-graphite.png")), "--only window skips the views");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("a view that throws becomes a red error tile and is reported", { skip: noBrowser }, async () => {
  const root = mkdtempSync(join(tmpdir(), "game-"));
  try {
    mkdirSync(join(root, "tools"), { recursive: true });
    mkdirSync(join(root, "mods/toy/glue"), { recursive: true });
    writeFileSync(join(root, "tools/game.json"), JSON.stringify({ mod: "toy", layout: "Toy" }));
    writeFileSync(join(root, "mods/toy/main.js"), [
      'import { View, div } from "gpui-kit";',
      'import { props, theme } from "herdr";',
      "export default class Toy extends View {",
      "  render() {",
      '    if (props()?.boom) throw new Error("kaboom in render");',
      '    return div().size_full().bg(theme().accent).child("toy");',
      "  }",
      "}",
    ].join("\n"));
    writeFileSync(join(root, "mods/toy/glue/views.js"), [
      "export default [",
      '  { name: "ok", size: { width: 200, height: 100 }, scenario: {} },',
      '  { name: "bad", size: { width: 200, height: 100 }, scenario: { props: { boom: true } } },',
      "];",
    ].join("\n"));
    const out = join(root, "shots");
    const result = await shoot({ root, only: ["ok", "bad"], out, scale: 1, browser, log: () => {} });
    assert.equal(result.demo, false);
    assert.deepEqual(result.errors.map((e) => e.name).sort(), ["bad-graphite", "bad-paper"]);
    assert.match(result.errors[0].error.message, /kaboom in render/);
    assert.deepEqual(pngSize(join(out, "ok-paper.png")), { width: 200, height: 100 });
    // The error tile is at least 480x270 and red.
    assert.deepEqual(pngSize(join(out, "bad-graphite.png")), { width: 480, height: 270 });
    assert.ok(readFileSync(join(out, "html/bad-graphite.html"), "utf8").includes("kaboom in render"));
    assert.ok(existsSync(join(out, "contact-sheet.png")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

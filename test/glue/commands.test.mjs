// Commands and "open this agent" (DESIGN §2.6, §5.6; ARCHITECTURE B11):
// liveness before any run, pane.focus {pane} / {terminal} or terminal.peek
// {terminal}, never agent.focus, check-ins, group keys that cycle, each
// command acting once across the panel and the ribbon, fold via
// layout.resize / layout.show (rail and unfolded panel both {weight}s that
// give way in a narrow window or at zoom, and that a drag keeps as weights:
// ARCHITECTURE B15) with the last weight share remembered, and the envelope
// command.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { win, agent, term } from "./_util.mjs";
import { layoutInfo, filesEstimate, panelState, DEFAULT_PANEL_WEIGHT, RAIL_WEIGHT, FILES_PX_FALLBACK, TIGHT_TEXT, TIGHT_FILES_TEXT } from "../../mods/creaseworks/glue/commands.js";
import { findById } from "../../tools/mock/gpui-kit.js";
import { ScrollHandle } from "gpui-base";
import { sectionIndex } from "../../mods/creaseworks/ui/flock.js";
import { pipColumns, railFlash, TIGHT_PREFIX } from "../../mods/creaseworks/ui/rail.js";
import { POP_RISE_MS, POP_PRUNE_MS, POP_DONE_MS, POP_CAP } from "../../mods/creaseworks/glue/session.js";
import { applyLayoutCommand, applyDrag } from "../../tools/mock/commands.js";
import { layoutBoxes } from "../../tools/render/window.mjs";
import { PANEL_WEIGHT, RAIL_WEIGHT as BUILD_RAIL_WEIGHT, MAIN_MIN } from "../../tools/layout/build.mjs";

const SHIPPED = JSON.parse(readFileSync(new URL("../../layouts/Creaseworks.json", import.meta.url), "utf8"));

let w;
afterEach(() => w && w.dispose());

const byAddr = (slot, addr) => Object.values(slot.state.helpers).find((h) => h.addr === addr);
const runsOf = (ctl, name) => ctl.runs.filter((r) => r.name === name);

const LAYOUT = (over = {}) => ({
  id: "root", type: "row", children: [
    { id: "work", type: "column", children: [
      { id: "work-body", type: "row", children: [
        { id: "main", type: "block" },
        { id: "panel", type: "column", hidden: over.files !== true, size: { px: 368 } },
        { id: "cw-panel", type: "block", size: over.panelSize ?? { weight: 0.39 }, hidden: over.panelHidden === true },
      ] },
      { id: "cw-ribbon", type: "block", size: { px: 30 }, hidden: over.ribbonHidden === true },
    ] },
  ],
});

async function game(extra = {}) {
  w = win({
    agents: [agent(1, "blocked"), agent(2, "blocked"), agent(3, "done")],
    terminals: [term(1, "blocked"), term(2, "blocked"), term(3, "idle", { turn: 1 }), { address: "k1", status: "error", parent: "t1", created_ms: 7 }],
    layout: LAYOUT(),
    ...extra,
  });
  const panel = await w.copy("panel");
  const ribbon = await w.copy("ribbon");
  await w.advance(2000);
  return { panel, ribbon };
}

test("layout() is read tolerantly", () => {
  assert.equal(layoutInfo(null).known, false);
  const i = layoutInfo(LAYOUT({ files: true, ribbonHidden: true }));
  assert.equal(i.known, true);
  assert.equal(i.ribbonHidden, true);
  assert.equal(i.panelHidden, false);
  assert.equal(i.filesShown, true);
  assert.equal(i.filesPx, 368);
  assert.equal(i.panelWeight, 0.39);
  assert.equal(layoutInfo(LAYOUT({ panelSize: { px: 64 } })).panelWeight, null);
  assert.equal(layoutInfo(SHIPPED).panelWeight, DEFAULT_PANEL_WEIGHT, "the layout's own weight");
  assert.equal(PANEL_WEIGHT, DEFAULT_PANEL_WEIGHT, "tools/layout/build.mjs and glue/commands.js agree");
  assert.equal(BUILD_RAIL_WEIGHT, RAIL_WEIGHT);
  assert.equal(i.mainWeight, 1, "main has no size: herdr's weight 1");
  assert.equal(i.filesWeight, null, "a px Files column");
  const shipped = layoutInfo(SHIPPED);
  assert.deepEqual([shipped.filesWeight, shipped.filesMin, shipped.filesMax, shipped.filesPx], [0.66, 280, 900, FILES_PX_FALLBACK]);
  assert.equal(layoutInfo({ id: "root", children: [] }).ribbonHidden, true, "a missing node is hidden");
});

test("openHelper: pane.focus {pane} for pane helpers, terminal.peek for paneless fledglings, never agent.focus", async () => {
  const { panel } = await game();
  const t1 = byAddr(w.slot, "t1");
  const k1 = byAddr(w.slot, "k1");
  await w.handler(panel, "openHelper", t1.id);
  await w.handler(panel, "openHelper", k1.id);
  assert.deepEqual(w.ctl.runs.map((r) => [r.name, r.args]), [["pane.focus", { pane: "p1" }], ["terminal.peek", { terminal: "k1" }]]);
  assert.equal(w.ctl.runErrors().length, 0, "the window accepts both");
  assert.equal(byAddr(w.slot, "t1").stats.checkIns, 1, "a needs-you click is a check-in");
  assert.equal(runsOf(w.ctl, "agent.focus").length, 0);
});

test("the answer key reaches a waiting paneless fledgling through terminal.peek (r1-14)", async () => {
  const { panel } = await game({
    agents: [agent(1, "working")],
    terminals: [term(1, "working"), { address: "k1", status: "blocked", parent: "t1", created_ms: 7 }],
  });
  const k1 = byAddr(w.slot, "k1");
  assert.equal(k1.status, "blocked");
  await w.handler(panel, "openHelper", "needs");
  assert.deepEqual(runsOf(w.ctl, "terminal.peek").map((r) => r.args), [{ terminal: "k1" }]);
  assert.equal(runsOf(w.ctl, "pane.focus").length, 0);
});

test("openHelper: liveness first — a gone agent says so and runs nothing", async () => {
  const { panel } = await game();
  const k1 = byAddr(w.slot, "k1");
  w.ctl.setTerminals([term(1, "blocked"), term(2, "blocked"), term(3, "idle", { turn: 1 })]);
  await w.advance(1000);
  const runs = w.ctl.runs.length;
  await w.handler(panel, "openHelper", k1.id);
  assert.equal(w.ctl.runs.length, runs, "no command");
  assert.equal(w.slot.flash.text, "That agent has gone");
  const vm = panel.session.vm();
  assert.equal(vm.notices[0].text, "That agent has gone");
  await w.advance(3500);
  assert.equal(w.slot.flash, null, "for 3 s");
  await w.handler(panel, "openHelper", "nope");
  assert.equal(w.ctl.runs.length, runs);
});

test("group keys pick the longest waiting and cycle on repeat; answer with nobody waiting", async () => {
  const { panel } = await game();
  // The waiting fledgling k1 (no pane) is in the cycle too, opened with terminal.peek.
  for (let i = 0; i < 4; i++) await w.handler(panel, "openHelper", "needs");
  const opened = w.ctl.runs.map((r) => r.args.pane ?? r.args.terminal);
  assert.deepEqual(opened, ["p1", "p2", "k1", "p1"]);
  await w.handler(panel, "openHelper", "finished");
  assert.deepEqual(runsOf(w.ctl, "pane.focus").at(-1).args, { pane: "p3" });
  w.ctl.setAgents([agent(3, "idle")]);
  w.ctl.setTerminals([term(3, "idle", { turn: 1 })]);
  await w.advance(1000);
  const runs = w.ctl.runs.length;
  w.ctl.sendCommand("answer");
  w.ctl.sendCommand("answer");
  await w.flush();
  assert.equal(w.ctl.runs.length, runs);
  assert.equal(w.slot.flash.text, "Nobody needs you");
  assert.equal(panel.session.vm().ribbon.pill, "Nobody needs you");
});

test("each command acts once: the ribbon handles it; the panel only while the ribbon is hidden", async () => {
  const { ribbon } = await game();
  // herdr delivers a command to every shown copy: once to each.
  w.ctl.sendCommand("answer");
  w.ctl.sendCommand("answer");
  await w.flush();
  assert.equal(runsOf(w.ctl, "pane.focus").length, 1);
  // Ribbon hidden (layout.set): herdr delivers to shown copies only, so only
  // the panel copy gets it (the mock has one queue: stop the ribbon's loop).
  w.ctl.layoutValue = LAYOUT({ ribbonHidden: true });
  w.ctl.closeOwner(ribbon);
  w.ctl.sendCommand("answer");
  await w.flush();
  assert.equal(runsOf(w.ctl, "pane.focus").length, 2);
  w.ctl.sendCommand("answer");
  await w.flush();
  // the third waiting helper is the paneless fledgling k1
  assert.equal(runsOf(w.ctl, "pane.focus").length + runsOf(w.ctl, "terminal.peek").length, 3);
});

test("filesEstimate: a weight Files column's real width from the panel's measured width", () => {
  const tree = JSON.parse(JSON.stringify(SHIPPED));
  applyLayoutCommand(tree, "layout.show", { id: "panel" });
  const info = layoutInfo(tree);
  for (const [width, height] of [[1100, 700], [1280, 800], [1440, 900], [1920, 1080], [2560, 1440]]) {
    const b = layoutBoxes(tree, { width, height });
    const est = filesEstimate(info, b["cw-panel"].width);
    assert.ok(Math.abs(est - b.panel.width) <= 1, `${width}: estimate ${est}, Files ${b.panel.width}`);
  }
  assert.equal(filesEstimate(info, 64), FILES_PX_FALLBACK, "a folded panel says nothing about Files");
  assert.equal(filesEstimate(layoutInfo(LAYOUT({ files: true })), 300), 368, "a px Files column is its px");
  assert.equal(filesEstimate(layoutInfo(null), 300), FILES_PX_FALLBACK);
});

test("fold: layout.resize to the rail weight and back to the last weight (never px); a hidden panel is shown first", async () => {
  // The player dragged the panel narrower: herdr stores the new weight (src/window.rs drag_to).
  const { panel, ribbon } = await game({ layout: LAYOUT({ panelSize: { weight: 0.3 } }) });
  await w.handler(panel, "click", "sheet", null, null); // nothing to do with folding
  w.ctl.within("event", panel, (cx) => panel.session.onSize({ width: 262, height: 784 }, cx));
  w.ctl.sendCommand("fold");
  w.ctl.sendCommand("fold");
  await w.flush();
  assert.deepEqual(runsOf(w.ctl, "layout.resize").map((r) => r.args), [{ id: "cw-panel", weight: RAIL_WEIGHT }]);
  w.ctl.layoutValue = LAYOUT({ panelSize: { weight: RAIL_WEIGHT } });
  await w.advance(1000);
  w.ctl.within("event", panel, (cx) => panel.session.onSize({ width: 64, height: 784 }, cx));
  await w.handler(ribbon, "fold");
  assert.deepEqual(runsOf(w.ctl, "layout.resize").at(-1).args, { id: "cw-panel", weight: 0.3 }, "the last unfolded weight");
  w.ctl.layoutValue = LAYOUT({ panelHidden: true, panelSize: { weight: RAIL_WEIGHT } });
  await w.advance(1000);
  await w.handler(ribbon, "fold");
  assert.deepEqual(w.ctl.runs.slice(-2).map((r) => [r.name, r.args]), [["layout.show", { id: "cw-panel" }], ["layout.resize", { id: "cw-panel", weight: 0.3 }]]);
  for (const r of runsOf(w.ctl, "layout.resize")) assert.ok(!("px" in r.args) && typeof r.args.weight === "number", `never px: ${JSON.stringify(r.args)}`);
  assert.equal(w.ctl.runErrors().length, 0);
});

test("unfold with nothing remembered: the layout's own weight, even from a px-sized panel", async () => {
  const { panel, ribbon } = await game({ layout: LAYOUT({ panelSize: { px: 64 } }) });
  w.ctl.within("event", panel, (cx) => panel.session.onSize({ width: 64, height: 784 }, cx));
  await w.handler(ribbon, "fold");
  assert.deepEqual(runsOf(w.ctl, "layout.resize").at(-1).args, { id: "cw-panel", weight: DEFAULT_PANEL_WEIGHT });
  assert.equal(w.ctl.runErrors().length, 0);
});

test("the panel a fold/unfold leaves stays on screen, Files open, zoom 1 and 1.5 (herdr's geometry)", async () => {
  // The real layout with Files open (r1-32): the copies fold, unfold, hide and show
  // it; every layout.* they run is applied the way herdr's window applies it, then
  // laid out with herdr's shares() at 1100 x 700 and 1440 x 900, zoom 1 and 1.5.
  const tree = JSON.parse(JSON.stringify(SHIPPED));
  applyLayoutCommand(tree, "layout.show", { id: "panel" });
  const { panel, ribbon } = await game({ layout: tree });
  let applied = 0;
  const sync = async (width) => {
    for (const r of w.ctl.runs.slice(applied)) if (r.name.startsWith("layout.")) assert.equal(applyLayoutCommand(tree, r.name, r.args), null, r.name);
    applied = w.ctl.runs.length;
    w.ctl.layoutValue = JSON.parse(JSON.stringify(tree));
    await w.advance(1000);
    const b = layoutBoxes(tree, { width: 1100, height: 700 });
    if (!b["cw-panel"]) return; // hidden: its copy is not measured
    w.ctl.within("event", panel, (cx) => panel.session.onSize({ width: width ?? Math.round(b["cw-panel"].inner.width), height: 584 }, cx));
  };
  const check = (label) => {
    for (const [size, zoom] of [[[1100, 700], 1], [[1440, 900], 1], [[1100, 700], 1.5], [[1440, 900], 1.5]]) {
      const b = layoutBoxes(tree, { width: size[0], height: size[1], zoom });
      const p = b["cw-panel"];
      const at = `${label} at ${size.join("x")} zoom ${zoom}`;
      assert.ok(p.width >= 64 * zoom - 0.01, `${at}: panel ${p.width}`);
      assert.ok(Math.abs(p.visible.width - p.width) < 0.5, `${at}: panel ${p.width} px, ${p.visible.width} on screen`);
      assert.ok(b.main.width >= (zoom === 1 ? 360 : MAIN_MIN * zoom) - 0.01, `${at}: terminals ${b.main.width}`);
      assert.ok(b.panel.width >= 280 * zoom - 0.01 && Math.abs(b.panel.visible.width - b.panel.width) < 0.5, `${at}: Files ${b.panel.visible.width} of ${b.panel.width}`);
    }
  };
  await sync();
  check("as shipped");
  await w.handler(ribbon, "fold");
  await sync(64);
  check("folded");
  await w.handler(ribbon, "fold");
  await sync();
  check("unfolded");
  applyLayoutCommand(tree, "layout.hide", { id: "cw-panel" });
  await sync();
  await w.handler(ribbon, "fold");
  await sync();
  check("shown again");
  assert.deepEqual(runsOf(w.ctl, "layout.resize").map((r) => r.args), [
    { id: "cw-panel", weight: RAIL_WEIGHT }, { id: "cw-panel", weight: DEFAULT_PANEL_WEIGHT }, { id: "cw-panel", weight: DEFAULT_PANEL_WEIGHT },
  ]);
  assert.equal(w.ctl.runErrors().length, 0);
});

test("dragging the rail open keeps weights (drag_to); the dragged width is remembered and stays on screen", async () => {
  // herdr's drag_to keeps a {px} side as px, so a px rail dragged open would never
  // shrink again. The rail is a weight: the drag stores two weights.
  const tree = JSON.parse(JSON.stringify(SHIPPED));
  const { panel, ribbon } = await game({ layout: tree });
  let applied = 0;
  const sync = async () => {
    for (const r of w.ctl.runs.slice(applied)) if (r.name.startsWith("layout.")) assert.equal(applyLayoutCommand(tree, r.name, r.args), null, r.name);
    applied = w.ctl.runs.length;
    w.ctl.layoutValue = JSON.parse(JSON.stringify(tree));
    await w.advance(1000);
    const b = layoutBoxes(tree, { width: 1440, height: 900 });
    w.ctl.within("event", panel, (cx) => panel.session.onSize({ width: Math.round(b["cw-panel"].inner.width), height: 784 }, cx));
    await w.advance(1000);
    return b;
  };
  await sync();
  await w.handler(ribbon, "fold");
  let b = await sync();
  assert.equal(Math.round(b["cw-panel"].width), 64, "folded: the rail");
  // The player drags the divider between main and the rail 236 px to the left.
  const drag = { la: b.main.width, lb: b["cw-panel"].width, start: b.main.x, p: b.main.x + b.main.width - 236 };
  assert.equal(applyDrag(tree, "work-body", 0, drag), null);
  const cw = tree.children[1].children[1].children.find((n) => n.id === "cw-panel");
  assert.equal(typeof cw.size.weight, "number", `still a weight: ${JSON.stringify(cw.size)}`);
  b = await sync();
  assert.ok(Math.abs(b["cw-panel"].width - 300) < 1, `dragged to ${b["cw-panel"].width}`);
  const main = tree.children[1].children[1].children.find((n) => n.id === "main");
  const share = Math.round((cw.size.weight / main.size.weight) * 1000) / 1000;
  assert.equal(w.slot.widths.lastWeight, share, "remembered as a share of main's weight");
  // Fold and unfold: back to the dragged width.
  await w.handler(ribbon, "fold");
  await sync();
  await w.handler(ribbon, "fold");
  b = await sync();
  assert.ok(Math.abs(b["cw-panel"].width - 300) < 2, `unfolded to ${b["cw-panel"].width}`);
  // The dragged panel still gives way: a narrow window or zoom 1.5 with Files open keeps it on screen.
  applyLayoutCommand(tree, "layout.show", { id: "panel" });
  for (const [width, height, zoom] of [[1100, 700, 1], [1100, 700, 1.5]]) {
    const z = layoutBoxes(tree, { width, height, zoom })["cw-panel"];
    assert.ok(Math.abs(z.visible.width - z.width) < 0.5 && z.width >= 64 * zoom - 0.01, `${width} zoom ${zoom}: ${z.visible.width} of ${z.width}`);
  }
  // A layout reset puts main back to weight 1: the share keeps the dragged proportion.
  delete main.size;
  applyLayoutCommand(tree, "layout.hide", { id: "panel" });
  await w.handler(ribbon, "fold");
  await sync();
  await w.handler(ribbon, "fold");
  b = await sync();
  assert.ok(Math.abs(b["cw-panel"].width - 300) < 2, `after a reset of main: ${b["cw-panel"].width}`);
  assert.equal(w.ctl.runErrors().length, 0);
});

test("envelope command opens the oldest envelope", async () => {
  w = win({ agents: [agent(1), agent(2)], terminals: [term(1), term(2)], layout: LAYOUT() });
  await w.copy("panel");
  await w.copy("ribbon");
  await w.advance(2000);
  w.ctl.setTerminals([term(1, "working", { turn: 1 }), term(2)]);
  await w.advance(2000);
  w.ctl.setTerminals([term(1, "working", { turn: 1 }), term(2, "working", { turn: 1 })]);
  await w.advance(2000);
  const env = w.slot.state.envelopes;
  assert.equal(Object.keys(env).length, 2);
  const oldest = Object.keys(env).sort((a, b) => env[a].landedAt - env[b].landedAt)[0];
  w.ctl.sendCommand("envelope");
  w.ctl.sendCommand("envelope");
  await w.flush();
  assert.equal(Object.keys(w.slot.state.envelopes).length, 1, "opened once");
  assert.equal(oldest in w.slot.state.envelopes, false);
});

test("select / showGroup from the ribbon reach the panel copy's ui and show the panel", async () => {
  const { panel, ribbon } = await game({ layout: LAYOUT({ panelHidden: true }) });
  await w.advance(1000);
  const t2 = byAddr(w.slot, "t2");
  await w.handler(ribbon, "select", t2.id);
  assert.equal(runsOf(w.ctl, "layout.show").length, 1);
  panel.session.vm();
  assert.equal(panel.session.ui.selected, t2.id);
  assert.equal(panel.session.ui.tab, "flock");
  await w.handler(ribbon, "showGroup", "resting");
  panel.session.vm();
  assert.equal(panel.session.ui.scrollTo, "resting");
});

test("narrow window (§2.3): the ribbon offers to fold once per Files opening and once a day", async () => {
  const { panel, ribbon } = await game({ layout: LAYOUT({ files: true }) });
  w.ctl.within("event", panel, (cx) => panel.session.onSize({ width: 320, height: 584 }, cx));
  w.ctl.within("event", ribbon, (cx) => ribbon.session.onSize({ width: 832, height: 30 }, cx));
  await w.advance(1000);
  assert.equal(ribbon.session.ctx().narrowHint, true, "1100 px with Files open: mainEst 112");
  await w.handler(ribbon, "dismiss", "narrow");
  assert.equal(ribbon.session.ctx().narrowHint, false);
  w.ctl.layoutValue = LAYOUT();
  await w.advance(1000);
  assert.equal(ribbon.session.ctx().narrowHint, false, "dismissed today (mainEst 488 without Files)");
  w.ctl.layoutValue = LAYOUT({ files: true });
  await w.advance(1000);
  assert.equal(ribbon.session.ctx().narrowHint, true, "a new Files opening asks again");
  w.ctl.within("event", ribbon, (cx) => ribbon.session.onSize({ width: 1600, height: 30 }, cx));
  w.ctl.layoutValue = LAYOUT();
  await w.advance(1000);
  assert.equal(ribbon.session.ctx().narrowHint, false, "wide enough");
  assert.equal(panel.session.ctx().narrowHint, undefined, "a ribbon-only chip");
});

// ---------------------------------------------------------------------------
// Verification round 2: r2-12, r2-13, r2-14 (tight and zoomed panels), r2-19
// (counts chip scroll), r2-20 (pops), r2-21 (Elsewhere marks)

const sizeOf = (v, width, height) => w.ctl.within("event", v, (cx) => v.session.onSize({ width, height }, cx));
const styleOf = (node, name) => (node && Array.isArray(node.styles) ? node.styles.find((x) => x[0] === name) : undefined);
const resizes = () => runsOf(w.ctl, "layout.resize").map((r) => r.args.weight);

test("r2-12: the tight rail (unfolded, 146 px with Files open) answers every click: select, showGroup and show flash why, the chevron folds", async () => {
  const { panel, ribbon } = await game({ layout: LAYOUT({ files: true }) });
  sizeOf(panel, 146, 584);
  sizeOf(ribbon, 832, 30);
  await w.advance(1000);
  assert.equal(panelState(w.slot), "tight");
  assert.ok(findById(w.render(panel).tree, "cw-rail"), "drawn as the rail");
  assert.equal(panel.session.ctx().folded, false);
  const t3 = byAddr(w.slot, "t3");
  const before = w.ctl.runs.length;
  // A rail pip (panel copy), a ribbon mark, a ribbon tally, the save chip / Welcome pill.
  for (const [v, name, ...args] of [[panel, "select", t3.id], [ribbon, "select", t3.id], [ribbon, "showGroup", "working"], [panel, "showGroup", "finished"], [ribbon, "show"]]) {
    w.slot.flash = null;
    await w.handler(v, name, ...args);
    assert.equal(w.slot.flash && w.slot.flash.text, TIGHT_FILES_TEXT, `${name}: says why the full panel cannot open`);
  }
  assert.equal(w.ctl.runs.length, before, "no resize: it has its weight, and the game never widens itself past it");
  assert.equal(ribbon.session.vm().ribbon.pill, TIGHT_FILES_TEXT, "the ribbon shows it");
  const flashEl = findById(w.render(panel).tree, "cw-rail-flash");
  assert.ok(flashEl, "the tight rail shows it under the count");
  assert.ok(JSON.stringify(flashEl).includes("close Files"));
  // Its chevron folds it to the rail weight.
  const chevron = findById(w.render(panel).tree, "cw-rail-unfold");
  assert.match(styleOf(chevron, "tooltip")[1], /fold to a slim rail/);
  await w.handler(panel, "fold");
  assert.deepEqual(resizes(), [RAIL_WEIGHT]);
  // Folded (the rail weight, 64): a pip select unfolds the panel with it selected.
  w.ctl.layoutValue = LAYOUT({ files: true, panelSize: { weight: RAIL_WEIGHT } });
  await w.advance(1000);
  sizeOf(panel, 64, 584);
  assert.equal(panel.session.ctx().folded, true);
  await w.handler(panel, "select", t3.id);
  assert.deepEqual(resizes(), [RAIL_WEIGHT, DEFAULT_PANEL_WEIGHT]);
  panel.session.vm();
  assert.equal(panel.session.ui.selected, t3.id);
  assert.equal(w.ctl.runErrors().length, 0);
});

test("r2-13: an unfolded panel measured under 140 (zoom 1.5) folds; folded is the layout weight, not the width", async () => {
  const { panel, ribbon } = await game({ layout: LAYOUT() });
  for (const width of [124, 106]) {
    w.ctl.runs.length = 0;
    w.ctl.layoutValue = LAYOUT();
    await w.advance(1000);
    sizeOf(panel, width, 584);
    assert.equal(panelState(w.slot), "tight", `${width}`);
    assert.equal(panel.session.ctx().folded, false);
    const chevron = findById(w.render(panel).tree, "cw-rail-unfold");
    assert.match(styleOf(chevron, "tooltip")[1], /fold to a slim rail/, `${width}: the chevron folds`);
    await w.handler(ribbon, "fold");
    // A second press before the next tick unfolds again (the slot notes the resize at once).
    await w.handler(panel, "fold");
    assert.deepEqual(resizes(), [RAIL_WEIGHT, DEFAULT_PANEL_WEIGHT], `${width}: folds, then unfolds`);
  }
  // The narrow hint is offered there too (folding gives the terminals 60 px); not for an unfolded panel at its 64 px min.
  w.ctl.layoutValue = LAYOUT();
  await w.advance(1000);
  sizeOf(panel, 124, 584);
  sizeOf(ribbon, 650, 30);
  await w.advance(1000);
  assert.equal(ribbon.session.ctx().narrowHint, true, "124 px");
  sizeOf(panel, 64, 584);
  await w.advance(1000);
  assert.equal(panelState(w.slot), "folded", "at its 64 px min it looks like the rail");
  assert.equal(ribbon.session.ctx().narrowHint, false, "at its 64 px min folding changes nothing");
  assert.equal(panel.session.ctx().folded, true, "the chevron unfolds");
  // It already has its weight: the chevron and a pip say why, and resize nothing.
  w.ctl.runs.length = 0;
  w.slot.flash = null;
  await w.handler(panel, "fold");
  assert.equal(w.slot.flash && w.slot.flash.text, TIGHT_TEXT);
  assert.deepEqual(resizes(), []);
  // A px panel at 64 (an old state file) and an unknown layout fall back as before.
  assert.equal(panelState({ widths: { panel: 64 }, layout: layoutInfo(LAYOUT({ panelSize: { px: 64 } })) }), "folded");
  assert.equal(panelState({ widths: { panel: 120 }, layout: layoutInfo(null) }), "folded");
  assert.equal(panelState({ widths: { panel: 146 }, layout: layoutInfo(null) }), "tight");
  assert.equal(panelState({ widths: { panel: 320 }, layout: layoutInfo(LAYOUT({ panelHidden: true })) }), "hidden");
  assert.equal(w.ctl.runErrors().length, 0);
});

test("r2-14: a tight rail uses its column (more pip columns) and the ribbon offers to give the terminals the room", async () => {
  assert.equal(pipColumns(64), 4);
  assert.equal(pipColumns(146), 9);
  assert.equal(pipColumns(199), 12);
  assert.equal(pipColumns(undefined), 4);
  const { panel, ribbon } = await game({ layout: LAYOUT({ files: true }) });
  sizeOf(panel, 146, 584);
  sizeOf(ribbon, 1600, 30); // terminals over 600: only the tight rail's wasted column asks
  await w.advance(1000);
  const grid = findById(w.render(panel).tree, "cw-rail-pips").children[0];
  assert.equal(styleOf(grid, "w")[1], 9 * 14);
  assert.equal(ribbon.session.ctx().narrowHint, true);
  sizeOf(panel, 320, 584);
  await w.advance(1000);
  assert.equal(ribbon.session.ctx().narrowHint, false, "a full panel with room to spare");
});

test("r2-12: a panel made tight by a drag on a wide window unfolds to the remembered weight; one that has it says to drag or widen", async () => {
  const { panel, ribbon } = await game({ layout: LAYOUT() });
  sizeOf(ribbon, 1400, 30);
  sizeOf(panel, 400, 584);
  await w.advance(1000);
  assert.equal(w.slot.widths.lastWeight, 0.39, "the full panel's weight is remembered");
  // A drag leaves it 0.12 wide, 150 px, Files closed.
  w.ctl.layoutValue = LAYOUT({ panelSize: { weight: 0.12 } });
  await w.advance(1000);
  sizeOf(panel, 150, 584);
  await w.advance(1000);
  assert.equal(panelState(w.slot), "tight");
  assert.equal(w.slot.widths.lastWeight, 0.39, "a weight that leaves the panel tight is never remembered");
  const t3 = byAddr(w.slot, "t3");
  for (const [v, name, ...args] of [[ribbon, "select", t3.id], [panel, "select", t3.id], [ribbon, "showGroup", "working"], [ribbon, "show"]]) {
    w.ctl.runs.length = 0;
    w.slot.flash = null;
    w.ctl.layoutValue = LAYOUT({ panelSize: { weight: 0.12 } });
    await w.advance(1000);
    await w.handler(v, name, ...args);
    assert.deepEqual(resizes(), [0.39], `${name}: unfolds to the remembered weight`);
    assert.equal(w.slot.flash, null, `${name}: no "too narrow" flash`);
  }
  // Fold then fold comes back to the full weight, not the drag's 0.12.
  w.ctl.runs.length = 0;
  w.ctl.layoutValue = LAYOUT({ panelSize: { weight: 0.12 } });
  await w.advance(1000);
  await w.handler(panel, "fold");
  await w.handler(panel, "fold");
  assert.deepEqual(resizes(), [RAIL_WEIGHT, 0.39]);
  // With its remembered weight and still 150 px (a narrow window), a click says to drag or widen.
  w.ctl.runs.length = 0;
  w.ctl.layoutValue = LAYOUT();
  await w.advance(1000);
  w.slot.flash = null;
  await w.handler(ribbon, "select", t3.id);
  assert.deepEqual(resizes(), []);
  assert.equal(w.slot.flash && w.slot.flash.text, TIGHT_TEXT);
  assert.match(TIGHT_TEXT, /drag/);
  assert.match(TIGHT_TEXT, /widen the window/);
  assert.equal(w.ctl.runErrors().length, 0);
});

test("r2-12: a rail touched by a drag (herdr keeps 0.025-0.07, no min) measuring 64 is folded: select and the chevron unfold it", async () => {
  const { panel, ribbon } = await game({ layout: LAYOUT({ panelSize: { weight: 0.066 } }) });
  sizeOf(panel, 64, 584);
  sizeOf(ribbon, 1400, 30);
  await w.advance(1000);
  assert.equal(panelState(w.slot), "folded");
  assert.equal(panel.session.ctx().folded, true);
  const chevron = findById(w.render(panel).tree, "cw-rail-unfold");
  assert.equal(styleOf(chevron, "tooltip")[1], "Unfold Creaseworks");
  const t3 = byAddr(w.slot, "t3");
  w.ctl.runs.length = 0;
  await w.handler(panel, "select", t3.id);
  assert.deepEqual(resizes(), [DEFAULT_PANEL_WEIGHT], "a rail pip unfolds it");
  w.ctl.runs.length = 0;
  w.ctl.layoutValue = LAYOUT({ panelSize: { weight: 0.066 } });
  await w.advance(1000);
  await w.handler(panel, "fold");
  assert.deepEqual(resizes(), [DEFAULT_PANEL_WEIGHT], "the first chevron press unfolds (no invisible fold to 0.001)");
  // A second press before the new width is measured folds again (it reads the new weight, not the old 64).
  await w.handler(panel, "fold");
  assert.deepEqual(resizes(), [DEFAULT_PANEL_WEIGHT, RAIL_WEIGHT]);
  assert.equal(w.ctl.runErrors().length, 0);
});

test("r2-12: a rail click under 120 px (zoom 1.5, or 64) shows the short flash and rings the chevron", async () => {
  assert.equal(railFlash(TIGHT_FILES_TEXT, 106), TIGHT_PREFIX);
  assert.equal(railFlash(TIGHT_TEXT, 64), TIGHT_PREFIX);
  assert.equal(railFlash(TIGHT_FILES_TEXT, 146), TIGHT_FILES_TEXT);
  assert.equal(railFlash("Nobody needs you", 64), "Nobody needs you");
  assert.ok(TIGHT_TEXT.startsWith(TIGHT_PREFIX) && TIGHT_FILES_TEXT.startsWith(TIGHT_PREFIX));
  const { panel } = await game({ layout: LAYOUT() });
  sizeOf(panel, 106, 584);
  await w.advance(1000);
  assert.equal(panelState(w.slot), "tight");
  const chevronBorder = () => styleOf(findById(w.render(panel).tree, "cw-rail-unfold"), "border_color");
  assert.equal(chevronBorder(), undefined, "no ring before a click");
  const t3 = byAddr(w.slot, "t3");
  await w.handler(panel, "select", t3.id);
  assert.equal(w.slot.flash && w.slot.flash.text, TIGHT_TEXT, "it has its weight: only the window keeps it narrow");
  const tree = w.render(panel).tree;
  const flashEl = findById(tree, "cw-rail-flash");
  assert.ok(flashEl, "the 106 px rail shows the flash");
  assert.ok(JSON.stringify(flashEl).includes(TIGHT_PREFIX));
  assert.ok(chevronBorder(), "the chevron is ringed while it shows");
  await w.advance(4000);
  assert.equal(findById(w.render(panel).tree, "cw-rail-flash"), null, "gone with the flash");
  assert.equal(chevronBorder(), undefined);
});

test("r2-19: the counts chip ● / ◗ scrolls the Flock to its group, then the group's header folds it again", async () => {
  const { panel, ribbon } = await game();
  const handle = w.ctl.within("event", panel, () => ScrollHandle.new());
  panel.session.scroll = handle;
  panel.session.sectionIndex = sectionIndex;
  await w.advance(1000);
  await w.handler(panel, "showGroup", "finished");
  assert.equal(panel.session.ui.scrollTo, null, "consumed");
  const calls = handle.__mock.calls;
  assert.equal(calls.length, 1);
  const tree = w.render(panel).tree;
  const content = findById(tree, "cw-content");
  assert.ok(styleOf(content, "track_scroll"), "the Flock's scroll area tracks the handle");
  assert.equal(content.children[calls[0][1]].id, "cw-flock-sec-finished", "scroll_to_item reveals the group's section");
  const shown = () => findById(w.render(panel).tree, "cw-flock-sec-finished").children.length;
  assert.equal(shown(), 2);
  await w.handler(panel, "toggleGroup", "finished");
  assert.equal(shown(), 1, "folds");
  await w.handler(panel, "toggleGroup", "finished");
  assert.equal(shown(), 2, "unfolds");
  // From a ribbon tally: the panel copy scrolls at its next tick (never in render).
  await w.handler(ribbon, "showGroup", "needs");
  await w.advance(1000);
  assert.equal(calls.length, 2);
  const c2 = findById(w.render(panel).tree, "cw-content");
  assert.equal(c2.children[calls[1][1]].id, "cw-flock-sec-needs");
  assert.equal(panel.session.ui.scrollTo, null);
  // Without a handle (an older main.js) the group still unfolds and nothing stays pinned.
  panel.session.scroll = null;
  await w.handler(panel, "showGroup", "finished");
  assert.equal(panel.session.ui.scrollTo, null);
  assert.equal(w.ctl.runErrors().length, 0);
});

test("r2-19: a needs tally whose only waiting helper is a fledgling scrolls to its parent's group, unfolded", async () => {
  w = win({
    agents: [agent(1, "working"), agent(2, "idle")],
    terminals: [term(1, "working"), term(2, "idle"), { address: "k1", status: "blocked", parent: "t1", created_ms: 7 }],
    layout: LAYOUT(),
  });
  const panel = await w.copy("panel");
  const ribbon = await w.copy("ribbon");
  await w.advance(2000);
  const handle = w.ctl.within("event", panel, () => ScrollHandle.new());
  panel.session.scroll = handle;
  panel.session.sectionIndex = sectionIndex;
  const vm = panel.session.vm();
  assert.equal(vm.header.counts.needs, 1, "the fledgling needs you");
  assert.equal(vm.helpers.groups.some((g) => g.key === "needs"), false, "no Needs you section");
  panel.session.ui.folded.working = true;
  await w.handler(ribbon, "showGroup", "needs");
  await w.advance(1000);
  const calls = handle.__mock.calls.filter((c) => c[0] === "scroll_to_item");
  assert.equal(calls.length, 1);
  const content = findById(w.render(panel).tree, "cw-content");
  assert.equal(content.children[calls[0][1]].id, "cw-flock-sec-working", "the section holding the parent's tile");
  assert.equal(panel.session.ui.folded.working, false, "unfolded, so its waiting pip shows");
  assert.equal(w.ctl.runErrors().length, 0);
});

test("r2-20: floating +N numbers rise within one after(16) of the click and are removed by one after(800)", async () => {
  w = win({ agents: [agent(1)], terminals: [term(1)], layout: LAYOUT() });
  const panel = await w.copy("panel");
  await w.advance(2000);
  await w.handler(panel, "click", "sheet", null, { x: 150, y: 116 });
  const pops = () => panel.session.ui.pops;
  assert.equal(pops().length, 1);
  assert.equal(pops()[0].risen, false, "drawn at the click point first");
  await w.advance(POP_RISE_MS + 4);
  assert.equal(pops()[0].risen, true, "rises at once, not at the next 1 s tick");
  await w.advance(POP_PRUNE_MS);
  assert.equal(pops().length, 0, "removed after the transition");
  // A burst of 12 clicks 80 ms apart: every pop rises before the next click.
  let fresh = 0;
  for (let i = 0; i < 12; i++) {
    await w.handler(panel, "click", "sheet", null, { x: 150, y: 116 });
    await w.advance(20);
    if (pops().every((p) => p.risen)) fresh++;
    assert.ok(pops().length <= 5);
    await w.advance(60);
  }
  assert.equal(fresh, 12);
  await w.advance(2000);
  assert.equal(pops().length, 0);
  assert.equal(w.ctl.runErrors().length, 0);
});

test("r2-20: fast clicking (12 and 20 a second) never cuts a number mid-rise, keeps at most 5, and shows every fold once", async () => {
  w = win({ agents: [agent(1)], terminals: [term(1)], layout: LAYOUT() });
  const panel = await w.copy("panel");
  await w.advance(2000);
  const pops = () => panel.session.ui.pops;
  const value = (label) => Number(String(label).replace(/[^0-9]/g, ""));
  for (const gap of [83, 50]) {
    await w.advance(3000);
    const seen = new Map(); // id → { at, label, last }
    const bank0 = w.slot.state.bank;
    const watch = async (ms) => {
      for (let k = 0; k < ms; k += 10) {
        await w.advance(Math.min(10, ms - k));
        const now = Date.now();
        assert.ok(pops().length <= POP_CAP, `${gap}: at most ${POP_CAP} alive`);
        for (const p of pops()) {
          if (!seen.has(p.id)) seen.set(p.id, { at: p.at, label: p.label, last: now });
          seen.get(p.id).last = now;
        }
      }
    };
    for (let i = 0; i < 40; i++) {
      await w.handler(panel, "click", "sheet", null, { x: 150, y: 116 });
      await watch(gap);
    }
    await watch(1500);
    assert.equal(pops().length, 0);
    let total = 0;
    for (const [id, p] of seen) {
      assert.ok(p.last - p.at >= POP_DONE_MS - 10, `${gap}: ${id} lived ${p.last - p.at} ms, through its ${POP_DONE_MS} ms rise`);
      total += value(p.label);
    }
    // Every click's earnings appear in some pop (carried while 5 are rising), at most the last carry unshown.
    const earned = w.slot.state.bank - bank0;
    assert.ok(total <= earned && total >= earned * 0.8, `${gap}: shown ${total} of ${earned}`);
  }
  assert.equal(w.ctl.runErrors().length, 0);
});

test("r2-21: a needs-you mark of an Elsewhere helper says it is in another window, not that it has gone", async () => {
  const { panel, ribbon } = await game();
  const t1 = byAddr(w.slot, "t1");
  w.slot.state.helpers[t1.id].seenBy = "other-window";
  w.ctl.setAgents([agent(2, "blocked"), agent(3, "done")]);
  w.ctl.setTerminals([term(2, "blocked"), term(3, "idle", { turn: 1 })]);
  await w.advance(1000);
  const h = w.slot.state.helpers[t1.id];
  assert.equal(h.gone, false);
  const m = ribbon.session.vm().ribbon.marks.find((x) => x.helperId === t1.id);
  assert.deepEqual([m.status, m.opacity], ["blocked", 0.5]);
  const runs = w.ctl.runs.length;
  for (const v of [ribbon, panel]) {
    w.slot.flash = null;
    await w.handler(v, "openHelper", t1.id);
    assert.equal(w.ctl.runs.length, runs, "nothing to open in this window");
    assert.equal(w.slot.flash.text, "That agent is in another window");
  }
});

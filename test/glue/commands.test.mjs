// Commands and "open this agent" (DESIGN §2.6, §5.6; ARCHITECTURE B11):
// liveness before any run, pane.focus {pane} / {terminal} or terminal.peek
// {terminal}, never agent.focus, check-ins, group keys that cycle, each
// command acting once across the panel and the ribbon, fold via
// layout.resize / layout.show (rail {px: 64}, unfolded panel a {weight} that
// gives way in a narrow window or at zoom: ARCHITECTURE B15) with the last
// weight remembered, and the envelope command.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { win, agent, term } from "./_util.mjs";
import { layoutInfo, DEFAULT_PANEL_WEIGHT, RAIL_PX } from "../../mods/creaseworks/glue/commands.js";
import { applyLayoutCommand } from "../../tools/mock/commands.js";
import { layoutBoxes } from "../../tools/render/window.mjs";
import { PANEL_WEIGHT } from "../../tools/layout/build.mjs";

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
  await w.handler(panel, "openHelper", "needs");
  await w.handler(panel, "openHelper", "needs");
  await w.handler(panel, "openHelper", "needs");
  assert.deepEqual(runsOf(w.ctl, "pane.focus").map((r) => r.args.pane), ["p1", "p2", "p1"]);
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
  assert.equal(runsOf(w.ctl, "pane.focus").length, 3);
});

test("fold: layout.resize to a 64 px rail and back to the last weight (never px); a hidden panel is shown first", async () => {
  // The player dragged the panel narrower: herdr stores the new weight (src/window.rs drag_to).
  const { panel, ribbon } = await game({ layout: LAYOUT({ panelSize: { weight: 0.3 } }) });
  await w.handler(panel, "click", "sheet", null, null); // nothing to do with folding
  w.ctl.within("event", panel, (cx) => panel.session.onSize({ width: 262, height: 784 }, cx));
  w.ctl.sendCommand("fold");
  w.ctl.sendCommand("fold");
  await w.flush();
  assert.deepEqual(runsOf(w.ctl, "layout.resize").map((r) => r.args), [{ id: "cw-panel", px: RAIL_PX }]);
  w.ctl.layoutValue = LAYOUT({ panelSize: { px: 64 } });
  await w.advance(1000);
  w.ctl.within("event", panel, (cx) => panel.session.onSize({ width: 64, height: 784 }, cx));
  await w.handler(ribbon, "fold");
  assert.deepEqual(runsOf(w.ctl, "layout.resize").at(-1).args, { id: "cw-panel", weight: 0.3 }, "the last unfolded weight");
  w.ctl.layoutValue = LAYOUT({ panelHidden: true, panelSize: { px: 64 } });
  await w.advance(1000);
  await w.handler(ribbon, "fold");
  assert.deepEqual(w.ctl.runs.slice(-2).map((r) => [r.name, r.args]), [["layout.show", { id: "cw-panel" }], ["layout.resize", { id: "cw-panel", weight: 0.3 }]]);
  for (const r of runsOf(w.ctl, "layout.resize")) assert.ok(r.args.px === RAIL_PX || !("px" in r.args), `only the rail is px: ${JSON.stringify(r.args)}`);
  assert.equal(w.ctl.runErrors().length, 0);
});

test("unfold with nothing remembered: the layout's own weight, even from a px-sized panel", async () => {
  const { panel, ribbon } = await game({ layout: LAYOUT({ panelSize: { px: 64 } }) });
  w.ctl.within("event", panel, (cx) => panel.session.onSize({ width: 64, height: 784 }, cx));
  await w.handler(ribbon, "fold");
  assert.deepEqual(runsOf(w.ctl, "layout.resize").at(-1).args, { id: "cw-panel", weight: DEFAULT_PANEL_WEIGHT });
  assert.equal(w.ctl.runErrors().length, 0);
});

test("the panel a fold/unfold leaves stays on screen with the terminals at 360 (herdr's geometry)", async () => {
  // The real layout with Files open (r1-32): the copies fold, unfold, hide and show
  // it; every layout.* they run is applied the way herdr's window applies it, then
  // laid out with herdr's shares() at 1100 x 700, and at zoom 1.5.
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
    for (const [size, zoom] of [[[1100, 700], 1], [[1440, 900], 1], [[1100, 700], 1.5]]) {
      const files = zoom === 1;
      const l = JSON.parse(JSON.stringify(tree));
      if (!files) applyLayoutCommand(l, "layout.hide", { id: "panel" }); // at zoom 1.5 Files alone needs 540 + 420 of 661 px
      const b = layoutBoxes(l, { width: size[0], height: size[1], zoom });
      const p = b["cw-panel"];
      const at = `${label} at ${size.join("x")} zoom ${zoom}`;
      assert.ok(p.width >= 64 * zoom - 0.01, `${at}: panel ${p.width}`);
      assert.ok(Math.abs(p.visible.width - p.width) < 0.5, `${at}: panel ${p.width} px, ${p.visible.width} on screen`);
      assert.ok(b.main.width >= 360 * zoom - 0.01, `${at}: terminals ${b.main.width}`);
      if (files) assert.ok(b.panel.visible.width >= 280 - 0.01, `${at}: Files ${b.panel.visible.width}`);
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
    { id: "cw-panel", px: RAIL_PX }, { id: "cw-panel", weight: DEFAULT_PANEL_WEIGHT }, { id: "cw-panel", weight: DEFAULT_PANEL_WEIGHT },
  ]);
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

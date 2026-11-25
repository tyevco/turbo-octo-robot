// Commands and "open this agent" (DESIGN §2.6, §5.6; ARCHITECTURE B11):
// liveness before any run, pane.focus {pane} / {terminal} or terminal.peek
// {terminal}, never agent.focus, check-ins, group keys that cycle, each
// command acting once across the panel and the ribbon, fold via
// layout.resize / layout.show with the last width remembered, and the
// envelope command.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { win, agent, term } from "./_util.mjs";
import { layoutInfo } from "../../mods/creaseworks/glue/commands.js";

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
        { id: "cw-panel", type: "block", size: { px: 320 }, hidden: over.panelHidden === true },
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

test("fold: layout.resize to 64 and back to the last width; a hidden panel is shown first", async () => {
  const { panel, ribbon } = await game();
  await w.handler(panel, "click", "sheet", null, null); // nothing to do with folding
  w.ctl.within("event", panel, (cx) => panel.session.onSize({ width: 352, height: 784 }, cx));
  w.ctl.sendCommand("fold");
  w.ctl.sendCommand("fold");
  await w.flush();
  assert.deepEqual(runsOf(w.ctl, "layout.resize").map((r) => r.args), [{ id: "cw-panel", px: 64 }]);
  w.ctl.within("event", panel, (cx) => panel.session.onSize({ width: 64, height: 784 }, cx));
  await w.handler(ribbon, "fold");
  assert.deepEqual(runsOf(w.ctl, "layout.resize").at(-1).args, { id: "cw-panel", px: 352 }, "the last unfolded width");
  w.ctl.layoutValue = LAYOUT({ panelHidden: true });
  await w.advance(1000);
  await w.handler(ribbon, "fold");
  assert.deepEqual(w.ctl.runs.slice(-2).map((r) => [r.name, r.args]), [["layout.show", { id: "cw-panel" }], ["layout.resize", { id: "cw-panel", px: 352 }]]);
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

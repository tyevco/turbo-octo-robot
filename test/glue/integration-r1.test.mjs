// Integration of verification round 1 across owners: the Settings share row's
// file picker and `shared` flag (r1-16), the folded Album built only when shown
// (r1-03, view opt `album`), and the narrow hint's Files estimate.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { win, DIR, freshState, saveText } from "./_util.mjs";

let w;
afterEach(() => w && w.dispose());

test("pickSharePath joins the picked save; saveInfo.shared is true only while sharing; a cancel changes nothing", async () => {
  const shared = "/other/home/data/creaseworks/save.json";
  const s = freshState(7);
  s.bank = 999;
  w = win({ files: { [shared]: saveText(s) }, pickFiles: [shared] });
  const v = await w.copy("panel");
  await w.advance(1000);
  assert.equal(v.session.ctx().save.shared, false);
  await w.handler(v, "confirm", "share");
  await w.handler(v, "pickSharePath");
  await w.flush();
  assert.deepEqual(JSON.parse(w.ctl.readFile(`${DIR}/location.json`)), { path: shared });
  assert.equal(v.session.ctx().save.shared, true);
  assert.equal(v.session.ui.confirm, false, "the share card closes");
  await w.handler(v, "sharePath", "");
  await w.flush();
  assert.equal(v.session.ctx().save.shared, false);
  w.ctl.scenario.pickFiles = null; // the person cancels
  await w.handler(v, "pickSharePath");
  await w.flush();
  assert.equal(v.session.ctx().save.shared, false);
});

test("pickSharePath says so when the picker cannot open", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.advance(1000);
  await w.handler(v, "pickSharePath");
  await w.flush();
  assert.match(w.slot.flash.text, /file picker/);
});

test("the Album's rows are built only while its section is unfolded; its count is always there", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.advance(1000);
  const st = w.slot.state;
  assert.equal(v.session.albumOpen(), false, "folded by default");
  assert.deepEqual(v.session.vm().helpers.album, []);
  assert.equal(typeof v.session.vm().helpers.albumCount, "number");
  await w.handler(v, "toggleGroup", "album");
  assert.equal(v.session.albumOpen(), true);
  assert.ok(Array.isArray(v.session.vm().helpers.album));
  assert.ok(st);
});

// r2-19 across owners: main.js builds the Session with the Flock's
// `sectionIndex` and a ScrollHandle (`newFlockScroll`), so in the shipped game
// a counts chip and a ribbon tally scroll the Flock to their group. Built
// through main.js's own init, never by putting a handle on the session.
test("r2-19: the View main.js builds scrolls the Flock: the panel copy gets a ScrollHandle and sectionIndex, a chip and a tally scroll", async () => {
  const { agent, term } = await import("./_util.mjs");
  const { findById } = await import("../../tools/mock/gpui-kit.js");
  w = win({
    agents: [agent(1, "blocked"), agent(2, "working"), agent(3, "done")],
    terminals: [term(1, "blocked"), term(2, "working"), term(3, "idle", { turn: 1 })],
  });
  const panel = await w.copy("panel");
  const ribbon = await w.copy("ribbon");
  await w.advance(2000);
  const s = panel.session;
  assert.equal(typeof s.sectionIndex, "function", "main.js passes ui/flock.js sectionIndex");
  assert.ok(s.scroll && typeof s.scroll.scroll_to_item === "function", "main.js passes newFlockScroll()'s handle");
  assert.equal(panel.session.ctx().scroll, s.scroll, "the panel's #cw-content tracks it");
  const calls = () => s.scroll.__mock.calls.filter((c) => c[0] === "scroll_to_item");
  await w.handler(panel, "showGroup", "finished");
  assert.equal(calls().length, 1, "a counts chip scrolls");
  const content = findById(w.render(panel).tree, "cw-content");
  assert.equal(content.children[calls()[0][1]].id, "cw-flock-sec-finished");
  await w.handler(ribbon, "showGroup", "working");
  await w.advance(1000);
  assert.equal(calls().length, 2, "a ribbon tally scrolls the panel copy at its next tick");
  assert.equal(findById(w.render(panel).tree, "cw-content").children[calls()[1][1]].id, "cw-flock-sec-working");
  assert.equal(s.ui.scrollTo, null, "nothing stays pinned");
  assert.equal(ribbon.session.scroll, null, "the ribbon draws no Flock: no handle");
  assert.equal(w.ctl.runErrors().length, 0);
});

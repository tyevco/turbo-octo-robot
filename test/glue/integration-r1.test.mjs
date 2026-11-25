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

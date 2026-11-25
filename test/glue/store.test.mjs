// Store (ARCHITECTURE A4, A5; DESIGN §12.1, §12.2): first load, damaged files
// kept aside (n = 1..5, oldest replaced), the backup, a CAS conflict merged
// without double counting, write failures with back-off, a newer save,
// backup rotation, the shared-save pointer, and notices that are never silent.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { win, SAVE, BAK, DIR, damaged, saveText, freshState, parsed, engine } from "./_util.mjs";

let w;
afterEach(() => w && w.dispose());

const hits = (s) => s.stats.hits;

test("first load creates the save, then it trails a backup", async () => {
  w = win();
  await w.copy("panel");
  assert.equal(w.ctl.readFile(SAVE), null, "nothing written in init");
  await w.advance(1000);
  const p = parsed(w.ctl);
  assert.ok(p && p.ok, "the first tick writes a valid save");
  assert.equal(w.slot.notice, null, "a first run is not a problem");
  assert.equal(w.ctl.readFile(BAK), null, "no backup before a second save");
  await w.handler(w.copies[0], "click", "sheet", null, { x: 150, y: 120 });
  await w.advance(16000);
  assert.ok(engine.parseSave(w.ctl.readFile(BAK)).ok, "the previous good save became the backup");
});

test("a damaged save is kept aside and the backup loads, with a recovered notice", async () => {
  const good = freshState(3);
  good.bank = 777;
  w = win({ files: { [SAVE]: "{{{not json", [BAK]: saveText(good) } });
  const v = await w.copy("panel");
  await w.flush();
  const slot = w.slot;
  assert.equal(slot.notice.kind, "recovered");
  assert.match(slot.notice.text, /Loaded the backup from \d\d:\d\d\. Damaged copy kept\./);
  assert.equal(w.ctl.readFile(damaged(1)), "{{{not json", "the damaged copy is kept");
  assert.ok(slot.state.bank >= 777);
  await w.advance(1000);
  assert.ok(parsed(w.ctl).ok, "the repaired save is written at once");
  const vm = v.session.vm();
  assert.equal(vm.notices[0].kind, "recovered", "the banner shows it (never silent)");
  assert.equal(vm.ribbon.save, "Save problem");
  // Dismiss clears it.
  await w.handler(v, "dismiss", "recovered");
  assert.equal(w.slot.notice, null);
});

test("save and backup both damaged: both kept, fresh game, fresh notice", async () => {
  w = win({ files: { [SAVE]: '"old shape"', [BAK]: "[]" } });
  await w.copy("panel");
  await w.flush();
  assert.equal(w.slot.notice.kind, "fresh");
  assert.equal(w.ctl.readFile(damaged(1)), '"old shape"');
  assert.equal(w.ctl.readFile(damaged(2)), "[]");
  assert.equal(w.slot.state.bank, 0);
  assert.deepEqual(w.slot.save.damaged, ["save.damaged-1.json", "save.damaged-2.json"]);
});

test("damaged copies: n = 1..5, the oldest is replaced", async () => {
  const files = { [SAVE]: "truncated {", [BAK]: saveText(freshState(2)) };
  for (let n = 1; n <= 5; n++) files[damaged(n)] = `old ${n}`;
  w = win({ files });
  await w.copy("panel");
  await w.flush();
  assert.equal(w.ctl.readFile(damaged(1)), "old 2");
  assert.equal(w.ctl.readFile(damaged(4)), "old 5");
  assert.equal(w.ctl.readFile(damaged(5)), "truncated {");
  assert.equal(w.ctl.readFile(`${DIR}/save.damaged-6.json`), null);
});

test("every damaged input is caught (parse, format, check, newer, shape)", async () => {
  const good = saveText(freshState(4));
  const badCheck = good.replace(/"check":"[0-9a-f]{8}"/, '"check":"00000000"');
  for (const bad of ["{{{not json", "null", "42", '"old shape"', "[]", good.slice(0, good.length / 2), badCheck]) {
    w = win({ files: { [SAVE]: bad } });
    await w.copy("panel");
    await w.flush();
    assert.equal(w.slot.notice && w.slot.notice.kind, "fresh", `input ${bad.slice(0, 20)}`);
    assert.equal(w.ctl.readFile(damaged(1)), bad);
    w.dispose();
  }
  w = null;
});

test("a newer save loads read-only and is never written", async () => {
  const s = freshState(5);
  s.version = 99;
  const text = engine.serialize(s).replace('"version":1,', '"version":99,');
  w = win({ files: { [SAVE]: text } });
  await w.copy("panel");
  await w.flush();
  assert.equal(w.slot.notice.kind, "newer");
  assert.equal(w.slot.readOnly, true);
  await w.advance(20000);
  assert.equal(w.ctl.readFile(SAVE), text);
  assert.equal(w.ctl.writes.length, 0);
});

test("CAS conflict from another writer: re-read, merge, retry; nothing counted twice", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.advance(1000); // first save
  const slot = w.slot;
  // Another window (writer B) changes the save: three Sheet hits of its own.
  const disk = engine.parseSave(w.ctl.readFile(SAVE)).state;
  const t = Date.now();
  for (let i = 1; i <= 3; i++) engine.apply(disk, { w: "B", s: i, t: t + i * 300, type: "click", target: "sheet" });
  w.ctl.externalWrite(SAVE, engine.serialize(disk));
  // Meanwhile this window hits twice.
  await w.hits(v, 2);
  const mine = hits(slot.state);
  await w.advance(16000);
  const p = parsed(w.ctl);
  assert.ok(p.ok);
  assert.equal(hits(p.state), 5, "3 from B + 2 from A, once each");
  assert.equal(hits(slot.state), 5);
  assert.ok(mine <= 2);
  assert.equal(p.state.applied.B, 3);
  assert.equal(slot.notice.kind, "merged", "the merged banner explains the jump");
  await w.advance(7000);
  assert.equal(slot.notice, null, "merged clears after 6 s");
  // A second write sees no conflict and keeps every count.
  await w.handler(v, "click", "sheet", null, null);
  await w.advance(16000);
  assert.equal(hits(parsed(w.ctl).state), 6);
});

test("a write failure shows the error and backs off 10 s, 30 s, 60 s, then 5 min", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.advance(1000);
  const msg = "Permission denied (os error 13)";
  for (let i = 0; i < 4; i++) w.ctl.failNextWrite(msg, SAVE);
  await w.handler(v, "buy", "paper-stack", 1); // urgent: due in 2 s
  const slot = w.slot;
  const attempts = () => w.ctl.writes.filter((x) => x.path === SAVE && x.injected).map((x) => x.t);
  await w.advance(3000);
  assert.equal(slot.notice.kind, "error");
  assert.equal(slot.notice.message, msg);
  assert.equal(slot.notice.retryMs, 10000);
  const vm = v.session.vm();
  assert.match(vm.notices[0].text, /Can't save: Permission denied \(os error 13\)\. Retrying in 10 s\./);
  await w.advance(10000);
  await w.advance(30000);
  await w.advance(60000);
  const a = attempts();
  assert.equal(a.length, 4);
  const gaps = a.slice(1).map((x, i) => x - a[i]);
  assert.ok(gaps[0] >= 10000 && gaps[0] < 12000, `gap ${gaps[0]}`);
  assert.ok(gaps[1] >= 30000 && gaps[1] < 32000, `gap ${gaps[1]}`);
  assert.ok(gaps[2] >= 60000 && gaps[2] < 62000, `gap ${gaps[2]}`);
  assert.equal(slot.notice.retryMs, 300000);
  // Retry now skips the wait; the injected failures are used up, so it lands.
  await w.handler(v, "retrySave");
  await w.flush();
  assert.equal(slot.notice, null, "a good write clears the error");
  assert.ok(parsed(w.ctl).ok);
  assert.equal(parsed(w.ctl).state.applied[slot.writerId], slot.seq, "the buy reached the disk");
});

test("backups rotate at most every 5 minutes", async () => {
  w = win();
  const v = await w.copy("panel");
  for (let i = 0; i < 40; i++) {
    await w.handler(v, "click", "sheet", null, null);
    await w.advance(15000);
  }
  const baks = w.ctl.writes.filter((x) => x.path === BAK && x.ok).map((x) => x.t);
  assert.ok(baks.length >= 2 && baks.length <= 3, `${baks.length} backup writes in 10 min`);
  for (let i = 1; i < baks.length; i++) assert.ok(baks[i] - baks[i - 1] >= 300000);
});

test("location.json points at a shared save: it is loaded and written there", async () => {
  const shared = "/shared/creaseworks/save.json";
  const s = freshState(6);
  s.bank = 4242;
  w = win({ files: { [`${DIR}/location.json`]: JSON.stringify({ path: shared }), [shared]: saveText(s) } });
  const v = await w.copy("panel");
  await w.flush();
  assert.equal(w.slot.paths.save, shared);
  assert.ok(w.slot.state.bank >= 4242);
  await w.handler(v, "buy", "paper-stack", 1);
  await w.advance(4000);
  assert.equal(w.ctl.readFile(SAVE), null, "the local save is unused");
  assert.ok(engine.parseSave(w.ctl.readFile(shared.replace(/\.json$/, ".bak.json"))).ok, "the backup lives next to the shared save");
  assert.equal(parsed(w.ctl, shared).state.owned["paper-stack"], 1);
  assert.equal(v.session.ctx().save.path, shared);
});

test("sharePath validates, writes only the pointer and joins the other save", async () => {
  const shared = "/other/home/data/creaseworks/save.json";
  const s = freshState(7);
  s.bank = 999;
  w = win({ files: { [shared]: saveText(s), "/other/notes.json": '{"a":1}' } });
  const v = await w.copy("panel");
  await w.advance(1000);
  await w.handler(v, "sharePath", "relative/save.json");
  await w.flush();
  assert.match(w.slot.flash.text, /absolute/);
  await w.handler(v, "sharePath", "/other/notes.json");
  await w.flush();
  assert.match(w.slot.flash.text, /not a Creaseworks save/);
  assert.equal(w.ctl.readFile(`${DIR}/location.json`), null);
  await w.handler(v, "sharePath", shared);
  await w.flush();
  assert.deepEqual(JSON.parse(w.ctl.readFile(`${DIR}/location.json`)), { path: shared });
  assert.equal(w.slot.paths.save, shared);
  assert.ok(w.slot.state.bank >= 999);
  await w.handler(v, "click", "sheet", null, null);
  await w.advance(16000);
  assert.ok(parsed(w.ctl, shared).state.applied[w.slot.writerId] >= 1, "this window's actions joined the shared save");
});

test("restore backup keeps the current save aside (reason restore); reset starts fresh", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.advance(1000);
  await w.handler(v, "click", "sheet", null, null);
  await w.advance(16000); // second save: backup = first save (0 hits)
  const before = w.ctl.readFile(SAVE);
  await w.handler(v, "restoreBackup");
  await w.flush();
  assert.equal(w.ctl.readFile(damaged(1)), before);
  assert.ok(w.slot.save.damaged.includes("save.damaged-1.json (restore)"));
  assert.equal(w.slot.state.stats.hits, 0);
  await w.advance(1000);
  assert.equal(parsed(w.ctl).state.stats.hits, 0);
  await w.handler(v, "resetGame");
  await w.flush();
  assert.ok(w.slot.save.damaged.includes("save.damaged-2.json (reset)"));
});

test("check save now: a file damaged under us is kept aside and saved over", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.advance(1000);
  w.ctl.externalWrite(SAVE, "garbage");
  await w.handler(v, "checkSave");
  await w.flush();
  assert.equal(w.ctl.readFile(damaged(1)), "garbage");
  assert.equal(w.slot.notice.kind, "recovered");
  await w.advance(1000);
  assert.ok(parsed(w.ctl).ok);
});

test("cadence: a purchase saves 2 s later; steady play saves every 15 s, not every tick", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.advance(1000);
  const saves = () => w.ctl.writes.filter((x) => x.path === SAVE && x.ok).map((x) => x.t);
  const n0 = saves().length;
  await w.handler(v, "buy", "paper-stack", 1);
  const at = Date.now();
  await w.advance(3000);
  assert.equal(saves().length, n0 + 1);
  assert.ok(saves().at(-1) - at >= 2000 && saves().at(-1) - at <= 3000, "debounced 2 s");
  for (let i = 0; i < 300; i++) {
    await w.handler(v, "click", "sheet", null, null);
    await w.advance(200);
  }
  const during = saves().slice(n0 + 1);
  assert.ok(during.length >= 3 && during.length <= 5, `${during.length} saves in 60 s of play`);
  for (let i = 1; i < during.length; i++) assert.ok(during[i] - during[i - 1] >= 14000);
});

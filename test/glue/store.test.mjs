// Store (ARCHITECTURE A4, A5; DESIGN §12.1, §12.2): first load, damaged files
// kept aside (n = 1..5, oldest replaced), the backup, a CAS conflict merged
// without double counting, write failures with back-off, a newer save,
// backup rotation, the shared-save pointer, and notices that are never silent.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { win, SAVE, BAK, DIR, HOME, DEFAULT_NOW, damaged, saveText, freshState, parsed, engine } from "./_util.mjs";
import * as store from "../../mods/creaseworks/glue/store.js";
import { newSlot, dispatch } from "../../mods/creaseworks/glue/live.js";
import { localDay } from "../../mods/creaseworks/glue/clock.js";

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

// ---------------------------------------------------------------------------
// Review round 1 (r1-06 … r1-13): each defect with the test that catches it.

const LOC = `${DIR}/location.json`;
const RECOVERY = `${DIR}/save.recovery.json`;

test("r1-06: after sharing stops, {\"path\":null} is no damage; a really damaged pointer still is", async () => {
  const shared = "/other/home/data/creaseworks/save.json";
  w = win({ files: { [shared]: saveText(freshState(8)) } });
  const v = await w.copy("panel");
  await w.advance(1000);
  await w.handler(v, "sharePath", shared);
  await w.flush();
  await w.handler(v, "sharePath", "");
  await w.flush();
  assert.deepEqual(JSON.parse(w.ctl.readFile(LOC)), { path: null });
  await w.advance(16000);
  const files = Object.fromEntries([...w.ctl.files].filter(([p]) => p.startsWith(DIR)));
  for (let restart = 0; restart < 2; restart++) {
    w.dispose();
    w = win({ files });
    await w.copy("panel");
    await w.flush();
    assert.equal(w.slot.paths.save, SAVE);
    assert.equal(w.slot.notice, null, "no false 'damaged pointer' notice on a restart");
  }
  for (const bad of ["{{{", '{"path":"relative.json"}', '{"path":5}', "[]"]) {
    w.dispose();
    w = win({ files: { ...files, [LOC]: bad } });
    await w.copy("panel");
    await w.flush();
    assert.equal(w.slot.notice && w.slot.notice.kind, "recovered", `pointer ${bad}`);
    assert.match(w.slot.notice.text, /location\.json/);
  }
});

test("r1-07: the wall clock moving back an hour does not stop saving or backup rotation", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.advance(3000);
  await w.hits(v, 3);
  await w.advance(20000);
  const OFF = 3600000;
  Date.now = () => w.ctl.t - OFF; // clock.js reads Date.now; timers keep virtual time
  await w.hits(v, 10);
  const n0 = w.ctl.writes.filter((x) => x.path === SAVE && x.ok).length;
  await w.advance(20000);
  assert.ok(w.ctl.writes.filter((x) => x.path === SAVE && x.ok).length > n0, "saved within the 15 s cadence");
  assert.equal(parsed(w.ctl).state.stats.hits, 13, "every hit on disk");
  // Backup rotation keeps its 5 min pace on the new clock.
  const b0 = w.ctl.writes.filter((x) => x.path === BAK && x.ok).length;
  for (let i = 0; i < 24; i++) {
    await w.handler(v, "click", "sheet", null, null);
    await w.advance(15000);
  }
  assert.ok(w.ctl.writes.filter((x) => x.path === BAK && x.ok).length > b0, "the backup rotated after the jump");
  assert.ok(w.slot.save.dirtyAt === null || w.slot.save.dirtyAt <= Date.now());
});

test("r1-08: a backup that can't be written is shown and retried; Settings never claims a rotation that failed", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.advance(1000);
  const msg = "Permission denied (os error 13)";
  for (let i = 0; i < 3; i++) w.ctl.failNextWrite(msg, BAK);
  await w.handler(v, "click", "sheet", null, null);
  await w.advance(16000); // second save: rotation is due and fails
  const slot = w.slot;
  assert.equal(w.ctl.readFile(BAK), null, "no backup was written");
  assert.equal(slot.notice && slot.notice.kind, "error", "never silent");
  assert.match(slot.notice.text, /Can't update the backup \(save\.bak\.json\): Permission denied/);
  const info = v.session.ctx().save;
  assert.match(info.backup, /^not updated \(Permission denied/);
  assert.doesNotMatch(String(info.backup), /rotated/);
  assert.match(info.text, /^Backup problem · saved/);
  assert.equal(slot.save.status, "ok", "the main save goes on");
  const vm = v.session.vm();
  assert.equal(vm.notices[0].kind, "error");
  // The main save keeps landing while the backup waits for its retry.
  await w.hits(v, 2);
  await w.advance(16000);
  assert.equal(parsed(w.ctl).state.stats.hits, 3);
  // Retry now: the failures are used up and the rotation lands.
  for (let i = 0; i < 3 && w.ctl.readFile(BAK) === null; i++) {
    await w.handler(v, "retrySave");
    await w.handler(v, "click", "sheet", null, null);
    await w.advance(3000);
  }
  assert.ok(engine.parseSave(w.ctl.readFile(BAK)).ok, "rotated once the disk allowed it");
  assert.equal(slot.notice, null, "the backup notice clears");
  assert.match(v.session.ctx().save.backup, /^rotated \d\d:\d\d$/);
});

test("r1-08: another writer's rotation (a CAS rejection on the backup) is caught up quietly", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.advance(1000);
  w.ctl.externalWrite(BAK, saveText(freshState(9)));
  await w.handler(v, "click", "sheet", null, null);
  await w.advance(16000);
  assert.equal(w.slot.notice, null);
  assert.equal(w.slot.bakText, w.ctl.readFile(BAK));
});

test("r1-09: an unreadable save.json: progress goes to save.recovery.json, the banner says what to do, and it recovers", async () => {
  const huge = `{"pad":"${"x".repeat(1100000)}"}`;
  w = win({ files: { [SAVE]: huge } });
  const v = await w.copy("panel");
  await w.advance(1000);
  const slot = w.slot;
  assert.equal(slot.notice.kind, "error");
  assert.match(slot.notice.text, /Can't read save\.json: Text file exceeds 1 MiB\. Move or delete it \(path in Details\); until then progress is kept in save\.recovery\.json\./);
  assert.ok(engine.parseSave(w.ctl.readFile(RECOVERY)).ok, "the recovery file is written at once");
  await w.hits(v, 4);
  await w.advance(16000);
  assert.equal(parsed(w.ctl, RECOVERY).state.stats.hits, 4, "on the normal cadence");
  assert.equal(w.ctl.readFile(SAVE), huge, "save.json is never touched");
  assert.match(v.session.ctx().save.text, /save\.recovery\.json/);
  // A restart prefers the recovery file to the (older or missing) backup.
  const files = Object.fromEntries([...w.ctl.files].filter(([p]) => p.startsWith(DIR)));
  w.dispose();
  w = win({ files });
  const v2 = await w.copy("panel");
  await w.flush();
  assert.equal(w.slot.state.stats.hits, 4, "loaded from save.recovery.json");
  // The player moves save.json away: the next save writes it again and the problem clears.
  w.ctl.externalWrite(SAVE, null);
  await w.hits(v2, 1);
  await w.advance(16000);
  assert.equal(parsed(w.ctl).state.stats.hits, 5);
  assert.equal(w.slot.notice, null);
  assert.equal(w.slot.save.status, "ok");
  // Later play rotates the backup past the left-over recovery file.
  await w.hits(v2, 3);
  await w.advance(16000);
  await w.hits(v2, 2);
  await w.advance(6 * 60000);
  const bak = parsed(w.ctl, BAK).state;
  assert.ok(bak.stats.hits > 4 && bak.clock > parsed(w.ctl, RECOVERY).state.clock, `backup rotated (${bak.stats.hits} hits)`);
  // save.json turns unreadable again: the newer backup is loaded, not the stale recovery file.
  const later = Object.fromEntries([...w.ctl.files].filter(([p]) => p.startsWith(DIR)));
  later[SAVE] = huge;
  w.dispose();
  w = win({ files: later });
  await w.copy("panel");
  await w.flush();
  assert.equal(w.slot.state.stats.hits, bak.stats.hits, "no rollback to the old recovery file");
  assert.equal(w.slot.notice.kind, "error");
});

test("r1-09: save.json replaced by a readable file while unreadable: it is kept aside, not lost", async () => {
  w = win({ files: { [SAVE]: `{"pad":"${"x".repeat(1100000)}"}` } });
  const v = await w.copy("panel");
  await w.advance(1000);
  await w.hits(v, 2);
  const other = saveText(freshState(10));
  w.ctl.externalWrite(SAVE, other);
  await w.advance(16000);
  assert.equal(parsed(w.ctl).state.stats.hits, 2, "this window's game saved");
  assert.equal(w.ctl.readFile(damaged(1)), other, "the file found there was kept aside");
  assert.equal(w.slot.notice.kind, "recovered");
  assert.match(w.slot.notice.text, /save\.damaged-1\.json/);
});

test("r1-10: Reset survives another window saving before this window's next write", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.advance(1000);
  await w.hits(v, 5);
  await w.advance(16000);
  await w.handler(v, "resetGame");
  // (no tick yet) Window B, on the same save, writes its pre-reset game plus a hit.
  const disk = engine.parseSave(w.ctl.readFile(SAVE)).state;
  engine.apply(disk, { w: "B", s: 1, t: Date.now(), type: "click", target: "sheet" });
  w.ctl.externalWrite(SAVE, engine.serialize(disk));
  await w.advance(3000);
  assert.equal(w.slot.state.stats.hits, 0, "not merged back in memory");
  assert.equal(parsed(w.ctl).state.stats.hits, 0, "the new game is on disk");
  assert.ok(!w.slot.notice || w.slot.notice.kind !== "merged");
  // Ordinary saving goes on (merging again) afterwards.
  await w.hits(v, 1);
  await w.advance(16000);
  assert.equal(parsed(w.ctl).state.stats.hits, 1);
  assert.equal(w.slot.save.overwrite, null);
});

test("r1-11: Settings save tools say something for every outcome, busy included", async () => {
  w = win({ latency: { write: 400 } });
  const v = await w.copy("panel");
  await w.advance(2000);
  await w.handler(v, "click", "sheet", null, null);
  await w.advance(16000); // a second save: the first became the backup
  await w.handler(v, "restoreBackup");
  await w.advance(1500); // 400 ms writes: the old save is kept aside first
  assert.match(w.slot.flash.text, /^Restored the backup\. The old save was kept as save\.damaged-1\.json\.$/);
  await w.advance(4000);
  await w.handler(v, "resetGame");
  await w.advance(1500); // 400 ms writes: the old save is kept aside first
  assert.match(w.slot.flash.text, /^Started a new game\. The old save was kept as save\.damaged-2\.json\.$/);
  await w.advance(4000);
  // A write under way: each tool flashes instead of doing nothing.
  for (const [name, ...args] of [["checkSave"], ["restoreBackup"], ["resetGame"], ["sharePath", "/x/save.json"]]) {
    await w.handler(v, "buy", "paper-stack", 1);
    for (let i = 0; i < 40 && w.slot.save.writing === null; i++) await w.advance(100);
    assert.notEqual(w.slot.save.writing, null, "a save is being written");
    w.slot.flash = null;
    const hitsBefore = w.slot.state.stats.hits;
    await w.handler(v, name, ...args);
    assert.match(w.slot.flash && w.slot.flash.text, /try again in a moment/, name);
    assert.equal(w.slot.state.stats.hits, hitsBefore);
    await w.advance(2000);
  }
});

test("r1-12: the fresh-start notice says what was missing or damaged and what was really kept", async () => {
  w = win({ files: { [BAK]: "[]" } });
  await w.copy("panel");
  await w.flush();
  assert.equal(w.slot.notice.text, "Save was missing and the backup was damaged. Started fresh; the damaged file was kept.");
  w.dispose();
  w = win({ files: { [SAVE]: '"old shape"', [BAK]: "[]" } });
  w.ctl.failNextWrite("Permission denied (os error 13)", damaged(1));
  w.ctl.failNextWrite("Permission denied (os error 13)", damaged(1));
  await w.copy("panel");
  await w.flush();
  assert.equal(w.slot.notice.text, "Save and backup were damaged. Started fresh; neither damaged file could be kept.");
  assert.deepEqual(w.slot.save.damaged, []);
  w.dispose();
  w = win({ files: { [SAVE]: "{{{" } });
  w.ctl.failNextWrite("Permission denied (os error 13)", damaged(1));
  await w.copy("panel");
  await w.flush();
  assert.equal(w.slot.notice.text, "Save was damaged and there was no backup. Started fresh; the damaged file could not be kept.");
  assert.equal(store.freshText(true, "a", true, null), "Save and backup were damaged. Started fresh; one damaged file could not be kept.");
  assert.equal(store.freshText(true, "a", true, "b"), "Save and backup were damaged. Started fresh; both files kept.");
});

test("r1-13: a damaged backup is reported as damaged, not 'present'", async () => {
  w = win({ files: { [SAVE]: '"old shape"', [BAK]: "[]" } });
  const v = await w.copy("panel");
  await w.flush();
  const info = v.session.ctx().save;
  assert.equal(info.backup, "damaged");
  assert.deepEqual(info.damaged, ["save.damaged-1.json", "save.damaged-2.json"]);
});

test("r2-07: a shared-save pointer to a missing file loads this window's own save, says so, and creates nothing there", async () => {
  const shared = "/other/home/data/creaseworks/save.json";
  const local = freshState(6);
  local.bank = 777777;
  w = win({ files: { [`${DIR}/location.json`]: JSON.stringify({ path: shared }), [SAVE]: saveText(local) } });
  const v = await w.copy("panel");
  await w.flush();
  await w.advance(5000);
  assert.equal(w.slot.paths.save, SAVE, "this window's own save");
  assert.ok(w.slot.state.bank >= 777777, "its progress loaded, not a fresh game");
  assert.equal(w.slot.notice && w.slot.notice.kind, "recovered");
  assert.match(w.slot.notice.text, /^Shared save not found: \/other\/home\/data\/creaseworks\/save\.json\. Using this window's own; share again in Settings/);
  assert.ok([...w.slot.notice.text].length <= 140, "fits the banner");
  assert.equal(w.ctl.readFile(shared), null, "nothing created at the shared path");
  assert.equal(v.session.ctx().save.shared, false);
  assert.deepEqual(JSON.parse(w.ctl.readFile(`${DIR}/location.json`)), { path: shared }, "the pointer stays (the drive may come back)");
});

test("r2-07: a missing shared save beside no local save starts fresh, never silently", async () => {
  const shared = "/mnt/usb/a-rather-long-folder-name-for-the-shared-game/creaseworks/save.json";
  w = win({ files: { [`${DIR}/location.json`]: JSON.stringify({ path: shared }) } });
  await w.copy("panel");
  await w.flush();
  assert.equal(w.slot.notice && w.slot.notice.kind, "recovered");
  assert.match(w.slot.notice.text, /^Shared save not found: …[^…]*\/creaseworks\/save\.json\./, "the end of the path, clipped at the front");
  await w.advance(3000);
  assert.ok(parsed(w.ctl).ok, "the local save is created");
  assert.equal(w.ctl.readFile(shared), null);
});

test("r2-07 review: a missing shared save beside a damaged save and backup says both, within the banner clip", async () => {
  const shared = "/mnt/usb/a-rather-long-folder-name-for-the-shared-game/creaseworks/save.json";
  w = win({ files: { [`${DIR}/location.json`]: JSON.stringify({ path: shared }), [SAVE]: "{ not json", [BAK]: "also not json" } });
  const v = await w.copy("panel");
  await w.flush();
  const n = w.slot.notice;
  assert.equal(n && n.kind, "fresh");
  assert.ok([...engine.graphemes(n.text)].length <= store.NOTICE_MAX, `${n.text.length}: ${n.text}`);
  assert.match(n.text, /^Shared save not found; using this window's own\. Save and backup were damaged\. Started fresh; both files kept\.$/);
  // The banner shows it whole: the fresh start is not cut off.
  const banner = v.session.vm().notices.find((x) => x.save);
  assert.ok(banner, "a save banner");
  assert.match(banner.text, /Started fresh; both files kept\.$/);
  assert.equal(w.ctl.readFile(shared), null);
});

test("r2-07 review: every load notice joined to a missing shared save fits the banner", () => {
  assert.equal(store.NOTICE_MAX, 140);
  const texts = [];
  for (const hadMain of [true, false]) for (const hadBak of [true, false]) {
    if (!hadMain && !hadBak) continue;
    for (const kept of [null, "save.damaged-5.json"]) for (const keptBak of [null, "save.damaged-5.json"]) texts.push(store.freshText(hadMain, kept, hadBak, keptBak));
  }
  const when = "Wednesday 30 September, 12:59 PM";
  for (const lead of ["Save was missing.", "Save was damaged."]) for (const tail of ["", " Damaged copy kept.", " The damaged copy could not be kept."]) texts.push(`${lead} Loaded the backup from ${when}.${tail}`);
  texts.push("The shared-save pointer (location.json) was damaged. Using this window's own save.");
  for (const t of texts) {
    const j = store.goneJoined(t);
    assert.ok(j.startsWith("Shared save not found"), j);
    assert.ok(j.endsWith(t), "the other problem is said whole");
    assert.ok([...engine.graphemes(j)].length <= store.NOTICE_MAX, `${j.length}: ${j}`);
  }
});

test("r2-06 review: releaseAbandoned frees an orphaned claim (quietly for a plain save, said for a Settings tool)", async () => {
  w = win();
  await w.copy("panel");
  await w.advance(3000);
  const S = w.slot.save;
  const t = Date.now();
  for (const [what, said] of [["cycle", false], ["resolve", false], ["reset", true], ["restore", true], ["share", true], ["check", true]]) {
    w.slot.notices.load = null;
    store.refreshNotice(w.slot);
    Object.assign(S, { writing: 77, writingBy: "a-closed-copy", writingFor: what, writingGen: S.writingGen, writingAt: t, orphanAt: null, status: "saving" });
    assert.equal(store.releaseAbandoned(w.slot, t), false, `${what}: the copy has only just gone`);
    assert.equal(store.releaseAbandoned(w.slot, t + store.ORPHAN_MS), true, `${what}: released`);
    assert.equal(S.writing, null);
    assert.equal(S.writingFor, null);
    assert.equal(!!(w.slot.notice && /cut off when a Creaseworks view closed/.test(w.slot.notice.text)), said, what);
  }
});

test("r2-08 review: a claim lost while settleShare reads the backup switches nothing, and the next save settles it", async () => {
  const shared = "/other/home/data/creaseworks/save.json";
  const s = freshState(7);
  s.bank = 999;
  w = win({ files: { [shared]: saveText(s) } });
  const v = await w.copy("panel");
  await w.advance(5000);
  await w.hits(v, 2);
  await w.advance(20000);
  assert.equal(parsed(w.ctl).state.stats.hits, 2, "saved locally first");
  // A share cut off after its pointer write landed (as a hot reload leaves it).
  w.ctl.externalWrite(`${DIR}/location.json`, JSON.stringify({ path: shared }));
  w.slot.save.sharing = { to: shared };
  w.ctl.latency.read = 300;
  await w.hits(v, 1);
  for (let i = 0; i < 3000 && w.slot.save.writing === null; i++) await w.advance(10);
  assert.notEqual(w.slot.save.writing, null, "the cycle that settles the share has started");
  await w.advance(450); // location.json read (300 ms) settled; the backup read is under way
  const reads = w.ctl.log.filter((e) => e.type === "read").map((e) => e.path);
  assert.equal(reads[reads.length - 1], `${DIR}/location.json`);
  await w.reload(); // the claim is released (an older code generation's)
  assert.equal(w.slot.paths.save, SAVE, "nothing switched while the claim was lost");
  assert.ok(w.slot.save.sharing, "still to be settled");
  w.ctl.latency.read = 0;
  await w.advance(3000);
  assert.equal(w.slot.paths.save, shared, "settled by the next save");
  assert.equal(w.slot.save.sharing, null);
  await w.hits(w.copies[0], 2);
  await w.advance(20000);
  const p = parsed(w.ctl, shared).state;
  assert.ok(p.bank >= 999 || p.lifetime >= 999, "joined onto that game");
  assert.equal(p.applied[w.slot.writerId], w.slot.seq, "this window's actions reached the shared file");
  assert.equal(w.slot.notice, null, "no false 'another window replaced the save'");
});

test("r2-08: a hot reload during Share a save: the next save follows the pointer that landed", async () => {
  const shared = "/other/home/data/creaseworks/save.json";
  const s = freshState(7);
  s.bank = 999;
  w = win({ files: { [shared]: saveText(s) }, latency: { write: 300, read: 0 } });
  const v = await w.copy("panel");
  await w.advance(5000);
  await w.handler(v, "sharePath", shared);
  for (let i = 0; i < 3; i++) await w.advance(50);
  assert.notEqual(w.slot.save.writing, null, "the pointer write is under way");
  assert.ok(w.slot.save.sharing, "its intent is recorded first");
  await w.reload();
  await w.advance(1000);
  assert.deepEqual(JSON.parse(w.ctl.readFile(`${DIR}/location.json`)), { path: shared }, "the cut-off write landed");
  assert.equal(w.slot.paths.save, shared, "and this window saves where it points");
  assert.equal(w.slot.save.sharing, null);
  assert.match(w.slot.flash.text, /Now sharing save\.json/);
  await w.hits(w.copies[0], 3);
  await w.advance(20000);
  const p = parsed(w.ctl, shared).state;
  assert.equal(p.stats.hits, 3, "play after the reload reaches the shared file");
  assert.ok(p.bank >= 999 || p.lifetime >= 999, "joined onto that game");
  assert.equal(w.slot.notice, null, "no false 'another window replaced the save'");
});

test("r2-08: a share whose pointer write failed keeps the file in use", async () => {
  const shared = "/other/home/data/creaseworks/save.json";
  w = win({ files: { [shared]: saveText(freshState(7)) } });
  const v = await w.copy("panel");
  await w.advance(5000);
  w.ctl.failNextWrite("Permission denied (os error 13)", `${DIR}/location.json`);
  await w.handler(v, "sharePath", shared);
  await w.advance(100);
  assert.match(w.slot.flash.text, /Can't write location\.json/);
  assert.equal(w.slot.save.sharing, null);
  assert.equal(w.slot.paths.save, SAVE);
});

test("r2-10: Windows paths (drive letter, UNC) are absolute for Share a save and the pointer", async () => {
  for (const p of ["C:\\Users\\me\\herdr\\data\\creaseworks\\save.json", "d:/games/save.json", "\\\\server\\share\\save.json", "/home/me/save.json"]) {
    assert.equal(store.isAbsolutePath(p), true, p);
  }
  for (const p of ["save.json", "C:save.json", "\\save.json", "./save.json", ""]) assert.equal(store.isAbsolutePath(p), false, p);
  const win32 = "C:\\Users\\me\\other\\save.json";
  const P = store.pathsFor("C:\\Users\\me\\herdr-app\\", win32);
  assert.equal(P.bak, "C:\\Users\\me\\other\\save.bak.json");
  assert.equal(P.damaged(2), "C:\\Users\\me\\other\\save.damaged-2.json");
  // A picked Windows path is accepted and the pointer to it is followed on the next load.
  w = win({ files: { [`${DIR}/location.json`]: JSON.stringify({ path: win32 }), [win32]: saveText(freshState(8)) } });
  await w.copy("panel");
  await w.flush();
  assert.equal(w.slot.paths.save, win32, "a drive-letter pointer is not 'damaged'");
  assert.equal(w.slot.notice, null);
  const v = w.copies[0];
  await w.handler(v, "sharePath", "");
  await w.advance(100);
  assert.match(w.slot.flash.text, /Back to this window's own save/);
  await w.handler(v, "sharePath", win32);
  await w.advance(100);
  assert.match(w.slot.flash.text, /^Now sharing save\.json/, "the file name after the last backslash");
  assert.equal(w.slot.paths.save, win32);
});

test("r2-11: Details lists each kept damaged copy once, under the name that holds it now", async () => {
  w = win();
  await w.copy("panel");
  await w.advance(3000);
  for (let i = 0; i < 7; i++) {
    w.ctl.externalWrite(SAVE, `garbage ${i}`);
    let p;
    await w.ctl.dispatch("task", null, () => {
      p = store.checkSave(w.slot, { now: () => Date.now() });
    });
    await w.ctl.flush();
    assert.equal(await p, "damaged");
    await w.advance(3000);
  }
  const list = w.slot.save.damaged;
  assert.deepEqual(list, ["save.damaged-1.json", "save.damaged-2.json", "save.damaged-3.json", "save.damaged-4.json", "save.damaged-5.json"]);
  for (let n = 1; n <= 5; n++) assert.equal(w.ctl.readFile(damaged(n)), `garbage ${n + 1}`, `damaged-${n} holds the ${n + 2}th damaged file`);
  // With reasons: a reset kept when all five are full shifts the others too.
  await w.handler(w.copies[0], "resetGame");
  await w.advance(3000);
  assert.deepEqual(w.slot.save.damaged.slice(-2), ["save.damaged-4.json", "save.damaged-5.json (reset)"]);
  assert.equal(new Set(w.slot.save.damaged).size, w.slot.save.damaged.length, "no name twice");
  assert.deepEqual(w.copies[0].session.ctx().save.damaged, w.slot.save.damaged.slice(-5));
});

test("r2-09: a VM restart's late final write is this window's own: merged back at once, no 'another window' banner", async () => {
  const { dropSlot } = await import("./_util.mjs");
  const { newCodeGeneration } = await import("../../mods/creaseworks/glue/live.js");
  w = win({ latency: { write: 60, read: 0 } });
  const v = await w.copy("panel");
  await w.advance(5000);
  await w.hits(v, 2);
  await w.advance(20000);
  await w.hits(v, 4); // not saved yet
  const p = w.ctl.within("event", v, (cx) => v.session.close(cx));
  assert.notEqual(p, null, "the closing ticker writes");
  // restart_mods: the old VM closes detached and the new one loads at once (same process: same shared map).
  w.ctl.newGeneration();
  newCodeGeneration();
  dropSlot();
  w.copies.length = 0;
  await w.copy("panel");
  await w.advance(10);
  assert.equal(w.slot.state.stats.hits, 2, "the new VM read the file before the old VM's write landed");
  let merged = false;
  for (let i = 0; i < 40; i++) {
    await w.advance(100);
    if (w.slot.notice && w.slot.notice.kind === "merged") merged = true;
  }
  assert.equal(parsed(w.ctl).state.stats.hits, 6);
  assert.equal(w.slot.state.stats.hits, 6, "back within the 2 s debounce, not the 15 s cadence");
  assert.equal(merged, false, "the previous VM is not 'another window'");
});

// Integration r2-01/r2-03: a large save is parsed across task steps
// (engine parseSaveSteps) on the load and merge paths, never in one step.
test("a save of 64 KiB or more loads in steps (a task yield between parse steps); a reload during them stops the load", async () => {
  const eu = await import("../engine/_util.mjs");
  const { newSlot } = await import("../../mods/creaseworks/glue/live.js");
  const s = eu.seeded(77, DEFAULT_NOW - 3600000);
  const me = eu.writer(s, "wBig");
  let t = DEFAULT_NOW - 3500000;
  for (let b = 0; b < 8; b++) {
    me.act(eu.observeAction((t += 60000), Array.from({ length: 400 }, (_, i) => eu.agent(5000 + b * 400 + i, "working", 0))));
    me.act(eu.observeAction((t += 1000), []));
  }
  const text = engine.serialize(s);
  assert.ok(text.length >= store.STEP_PARSE_CHARS, `a big save (${text.length} chars)`);
  w = win({ files: { [SAVE]: text } });
  const view = await w.copy("panel");
  await w.flush();
  assert.equal(engine.serialize(w.slot.state).length > 0, true);
  const run = async (stopAfter) => {
    const slot = newSlot(HOME, null);
    slot.loading = 1;
    let sleeps = 0;
    const env = {
      now: () => DEFAULT_NOW,
      seed: () => 1,
      sleep: async () => {
        sleeps++;
        if (sleeps === stopAfter) slot.loading = 2; // a reload superseded this load
      },
      gen: 1,
    };
    // in a host call, as the session's task runs it (the mock checks)
    const { p: pr } = await w.ctl.dispatch("event", view, () => ({ p: store.load(slot, env) }));
    let ok;
    let done = false;
    pr.then((v) => {
      ok = v;
      done = true;
    });
    for (let i = 0; i < 100 && !done; i++) await w.flush();
    assert.ok(done, "the load settled");
    return { ok, slot, sleeps };
  };
  const a = await run(0);
  assert.equal(a.ok, true);
  assert.ok(a.sleeps >= 4, `yielded between parse steps (${a.sleeps})`);
  assert.equal(engine.serialize(a.slot.state), text, "the stepped parse gives the same game");
  assert.equal(a.slot.notice, null);
  const b = await run(2);
  assert.equal(b.ok, false, "a superseded load stops at its next step");
  assert.equal(b.slot.state, null);
});

/** Runs async host work in a task scope and settles it (virtual clock). */
async function hostWork(fn) {
  let p;
  await w.ctl.dispatch("task", null, () => {
    p = fn();
  });
  for (let i = 0; i < 50; i++) await w.ctl.flush();
  return p;
}

// r3-08: the newest kept copy is always at the highest n, so a shift drops the oldest.
test("r3-08: a gap in save.damaged-1..5 is closed, and the next shift replaces the oldest copy, never a newer one", async () => {
  const files = {};
  for (let n = 2; n <= 5; n++) files[damaged(n)] = `old-${n}`; // damaged-1 removed by hand
  w = win({ files });
  const paths = store.pathsFor(HOME);
  assert.equal(await hostWork(() => store.keepAside(paths, "X")), "save.damaged-5.json", "the newest is the highest n");
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => w.ctl.readFile(damaged(n))), ["old-2", "old-3", "old-4", "old-5", "X"], "the gap closed; nothing dropped");
  assert.equal(await hostWork(() => store.keepAside(paths, "Y")), "save.damaged-5.json");
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => w.ctl.readFile(damaged(n))), ["old-3", "old-4", "old-5", "X", "Y"], "the oldest (old-2) replaced, X kept");
  // A gap above the highest in use: the copy goes after it, nothing moves.
  w.dispose();
  w = win({ files: { [damaged(1)]: "a", [damaged(3)]: "b" } });
  assert.equal(await hostWork(() => store.keepAside(paths, "c")), "save.damaged-4.json");
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => w.ctl.readFile(damaged(n))), ["a", null, "b", "c", null]);
});

// r3-01: a damaged save.json read again on every init (a load cut off, a
// reload, a restart) is kept aside once, not once per load.
test("r3-01: the same damaged save is kept aside once however often it is loaded", async () => {
  const { newSlot } = await import("../../mods/creaseworks/glue/live.js");
  const good = freshState(3);
  const files = { [SAVE]: "{{{damaged", [BAK]: saveText(good) };
  for (let n = 1; n <= 3; n++) files[damaged(n)] = `older ${n}`;
  w = win({ files });
  const view = await w.copy("panel");
  await w.ctl.flush();
  w.ctl.externalWrite(SAVE, "{{{damaged"); // as if the first load's save never landed
  for (let i = 0; i < 4; i++) {
    const slot = newSlot(HOME, null);
    slot.loading = 1;
    const env = { now: () => Date.now(), seed: () => 1, gen: 1, sleep: () => Promise.resolve() };
    const { p } = await w.ctl.dispatch("event", view, () => ({ p: store.load(slot, env) }));
    for (let k = 0; k < 50; k++) await w.ctl.flush();
    assert.equal(await p, true);
    assert.match(slot.notice.text, /Damaged copy kept\./);
    assert.deepEqual(slot.save.damaged, ["save.damaged-4.json"], `load ${i + 1}: listed under the one file that holds it`);
  }
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => w.ctl.readFile(damaged(n))), ["older 1", "older 2", "older 3", "{{{damaged", null], "kept once; the older copies stay");
});

// r3-09: a deleted save.json is said as missing, never as another window's merge.
test("r3-09: save.json deleted under a running game is said and written again; no 'merged' banner", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.advance(3000);
  assert.ok(parsed(w.ctl).ok);
  const kinds = new Set();
  w.ctl.externalWrite(SAVE, null);
  await w.hits(v, 2);
  for (let i = 0; i < 200; i++) {
    await w.advance(100);
    if (w.slot.notice) kinds.add(w.slot.notice.kind);
  }
  assert.equal(parsed(w.ctl).state.stats.hits, 2, "written again");
  assert.ok(!kinds.has("merged"), `no merged notice (${[...kinds]})`);
  assert.equal(w.slot.notices.load.kind, "recovered");
  assert.equal(w.slot.notices.load.text, store.MISSING_TEXT);
  // Garbage written by another writer: the recovered notice, and no "merged" beside it.
  kinds.clear();
  w.ctl.externalWrite(SAVE, "garbage from elsewhere");
  await w.hits(v, 1);
  for (let i = 0; i < 200; i++) {
    await w.advance(100);
    if (w.slot.notices.write) kinds.add(w.slot.notices.write.kind);
  }
  assert.ok(!kinds.has("merged"), `no merged write notice (${[...kinds]})`);
  assert.match(w.slot.notices.load.text, /damaged by another writer/);
  assert.equal(parsed(w.ctl).state.stats.hits, 3);
});

test("r3 notices fit the banner (NOTICE_MAX graphemes)", () => {
  for (const text of [store.MISSING_TEXT, store.LOAD_RETRIED_TEXT]) assert.ok(engine.graphemes(text).length <= store.NOTICE_MAX, text);
});

const HUGE = `{"pad":"${"x".repeat(1100000)}"}`;
const CHANGED = "The file changed outside Herdr. Reload before saving; your draft is still here.";
/** A save text whose check no longer matches (damaged), for `hits` hits. */
const damagedText = (n) => {
  const s = freshState(3);
  s.stats.hits = n;
  return saveText(s).replace(`"hits":${n}`, `"hits":${n + 1}`);
};

test("r4-03: save.json turning unreadable during play: progress goes to save.recovery.json in that same save and survives a restart", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.advance(1000);
  await w.hits(v, 3);
  await w.advance(16000);
  assert.equal(hits(parsed(w.ctl).state), 3);
  // Another writer (or the player) leaves save.json over 1 MiB mid-game.
  w.ctl.externalWrite(SAVE, HUGE);
  await w.hits(v, 5);
  await w.advance(16000);
  assert.equal(w.slot.save.unreadable, "Text file exceeds 1 MiB");
  assert.equal(w.slot.save.status, "error");
  assert.equal(w.slot.notice.kind, "error");
  assert.match(w.slot.notice.text, /^Can't read save\.json: Text file exceeds 1 MiB\. Move or delete it \(path in Details\); until then progress is kept in save\.recovery\.json\./);
  assert.equal(hits(parsed(w.ctl, RECOVERY).state), 8, "the hits made after it went bad are in the recovery file");
  assert.equal(w.ctl.readFile(SAVE), HUGE, "save.json is never touched");
  const files = Object.fromEntries([...w.ctl.files].filter(([p]) => p.startsWith(DIR)));
  w.dispose();
  w = win({ files });
  await w.copy("panel");
  await w.flush();
  assert.equal(w.slot.state.stats.hits, 8, "nothing lost across a restart");
});

test("r4-03: unreadable found by a merge's read (a folder in its place): recovery file, and a damaged one there is kept aside first", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.advance(1000);
  await w.hits(v, 2);
  await w.advance(16000);
  const badRec = damagedText(77);
  w.ctl.externalWrite(RECOVERY, badRec);
  // The write is rejected as a conflict, then the merge's read finds a folder.
  w.ctl.externalWrite(SAVE, null);
  w.ctl.mkdir(SAVE);
  w.ctl.failNextWrite(CHANGED, SAVE);
  await w.hits(v, 2);
  await w.advance(16000);
  assert.equal(w.slot.save.unreadable, "Not a regular file");
  assert.equal(w.slot.notice.kind, "error");
  assert.match(w.slot.notice.text, /^Can't read save\.json: Not a regular file\./);
  assert.equal(w.ctl.readFile(damaged(1)), badRec, "the damaged recovery file was kept aside, not overwritten unseen");
  assert.ok(w.slot.save.damaged.includes("save.damaged-1.json"), "and listed in Details");
  assert.equal(hits(parsed(w.ctl, RECOVERY).state), 4);
});

test("r4-03: Check save now on an unreadable save.json keeps a damaged recovery file aside too", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.advance(1000);
  const badRec = damagedText(12);
  w.ctl.externalWrite(RECOVERY, badRec);
  w.ctl.externalWrite(SAVE, HUGE);
  await w.handler(v, "checkSave");
  await w.flush();
  assert.equal(w.slot.save.unreadable, "Text file exceeds 1 MiB");
  assert.equal(w.ctl.readFile(damaged(1)), badRec);
  await w.advance(3000);
  assert.ok(parsed(w.ctl, RECOVERY).ok, "the game written to the recovery file");
});

/** Two windows' slots on one save (the store driven directly), both in step with save.json. */
function twoWriters(seed) {
  const base = engine.newGame({ seed, now: DEFAULT_NOW, day: localDay(DEFAULT_NOW) });
  w.ctl.externalWrite(SAVE, engine.serialize(base));
  const mk = (id) => {
    const slot = newSlot(HOME, store.slotPaths(HOME));
    slot.writerId = id;
    const text = w.ctl.readFile(SAVE);
    slot.state = engine.parseSave(text).state;
    slot.baseText = text;
    slot.save.baseOk = true;
    return slot;
  };
  return [mk("wA"), mk("wB")];
}
const clickN = (slot, n, t) => {
  for (let i = 0; i < n; i++) dispatch(slot, { type: "click", target: "sheet" }, t + i * 400);
};
const cycle = (slot) => hostWork(() => store.cycle(slot, { now: () => w.ctl.now() }));

test("r4-03: two windows that both find save.json unreadable merge in save.recovery.json, neither writes over the other", async () => {
  w = win();
  const [A, B] = twoWriters(9);
  w.ctl.externalWrite(SAVE, HUGE);
  const t = w.ctl.now();
  clickN(A, 4, t);
  clickN(B, 7, t);
  assert.equal(await cycle(A), true);
  assert.equal(await cycle(B), true);
  assert.deepEqual({ ...parsed(w.ctl, RECOVERY).state.applied }, { wA: 4, wB: 7 }, "B took in A's game before writing");
  clickN(A, 1, w.ctl.now());
  assert.equal(await cycle(A), true);
  const rec = parsed(w.ctl, RECOVERY).state;
  assert.deepEqual({ ...rec.applied }, { wA: 5, wB: 7 }, "A's next write (a conflict) merged B's game");
  assert.equal(A.state.applied.wB, 7);
  assert.equal(B.save.damaged.length + A.save.damaged.length, 0, "nothing kept aside: nothing could not be merged");
  assert.equal(w.ctl.readFile(SAVE), HUGE, "save.json is never touched");
});

test("r4-03 / r5-02: two windows' recovery games that cannot be merged: the other is kept aside once and said, and the windows converge", async () => {
  w = win();
  const [A, B] = twoWriters(10);
  const t = w.ctl.now();
  clickN(A, 2, t);
  assert.equal(await cycle(A), true);
  clickN(B, 3, w.ctl.now());
  assert.equal(await cycle(B), true, "B merged A's save.json write");
  // A has not read B's last save.json write when save.json turns unreadable:
  // with autosave between two windows that is the ordinary state.
  w.ctl.externalWrite(SAVE, HUGE);
  const kinds = [];
  for (let round = 0; round < 8; round++) {
    await w.advance(2000);
    clickN(A, 1, w.ctl.now());
    assert.equal(await cycle(A), true, `round ${round}: A saved`);
    await w.advance(2000);
    clickN(B, 1, w.ctl.now());
    assert.equal(await cycle(B), true, `round ${round}: B saved`);
    if (round === 0) {
      // First contact: B's file lacks what B saved to save.json, so A's game is kept aside, said and listed.
      assert.equal(engine.parseSave(w.ctl.readFile(damaged(1))).state.applied.wA, 3, "A's recovery game kept");
      assert.ok(B.save.damaged.some((d) => d.startsWith("save.damaged-1.json (another window's save.recovery.json")), "and listed in B's Details");
      assert.equal(B.notices.load.text, store.recOtherText("save.recovery.json", "save.damaged-1.json"));
    }
    if (round === 1) {
      // A finds its recovery write replaced: it takes B's game in, says so and names the kept copy.
      assert.equal(A.notices.load.text, store.recReplacedText("save.recovery.json", "save.damaged-1.json"));
      assert.ok(A.save.damaged.includes("save.damaged-1.json"), "named in A's Details");
    }
    kinds.push([1, 2, 3, 4, 5].filter((n) => w.ctl.readFile(damaged(n)) !== null).length);
  }
  const rec = parsed(w.ctl, RECOVERY).state.applied;
  assert.deepEqual({ ...rec }, { wA: 10, wB: 11 }, "both windows' games in one file");
  assert.deepEqual({ ...A.state.applied }, { wA: 10, wB: 10 }, "A took in B's game");
  assert.deepEqual({ ...B.state.applied }, { wA: 10, wB: 11 }, "B takes in A's every round");
  assert.deepEqual(kinds, [1, 1, 1, 1, 1, 1, 1, 1], "one copy kept aside, once: the damaged slots never rotate");
  assert.equal(A.save.damaged.length + B.save.damaged.length, 2, "Details lists that one copy in each window");
  assert.equal(w.ctl.readFile(SAVE), HUGE, "save.json is never touched");
});

test("r5-02: a kept (reset) copy is not pushed out by two windows sharing save.recovery.json", async () => {
  w = win();
  const [A, B] = twoWriters(12);
  w.ctl.externalWrite(damaged(1), "a (reset) copy");
  B.save.damaged.push("save.damaged-1.json (reset)");
  clickN(A, 2, w.ctl.now());
  assert.equal(await cycle(A), true);
  clickN(B, 3, w.ctl.now());
  assert.equal(await cycle(B), true);
  w.ctl.externalWrite(SAVE, HUGE);
  for (let round = 0; round < 10; round++) {
    await w.advance(2000);
    clickN(A, 1, w.ctl.now());
    await cycle(A);
    await w.advance(2000);
    clickN(B, 1, w.ctl.now());
    await cycle(B);
  }
  assert.equal(w.ctl.readFile(damaged(1)), "a (reset) copy", "the (reset) copy is still kept");
  assert.equal(w.ctl.readFile(damaged(3)), null, "only one more copy was kept");
  assert.ok(B.save.damaged.includes("save.damaged-1.json (reset)"));
});

test("r5-02: a recovery game replaced unseen: this window keeps its own last game aside and takes the file in", async () => {
  w = win();
  const [A] = twoWriters(10);
  w.ctl.externalWrite(SAVE, HUGE);
  const t = w.ctl.now();
  clickN(A, 3, t);
  assert.equal(await cycle(A), true);
  const mine = w.ctl.readFile(RECOVERY);
  // B writes over A's file without keeping it aside, then A, with new actions,
  // finds a game holding B's progress but not its own.
  const other = parsed(w.ctl, RECOVERY).state;
  delete other.applied.wA;
  other.applied.wB = 9;
  const theirs = engine.serialize(other);
  w.ctl.externalWrite(RECOVERY, theirs);
  clickN(A, 2, w.ctl.now());
  assert.equal(await cycle(A), true);
  assert.equal(w.ctl.readFile(damaged(1)), mine, "this window's last recovery game is kept");
  assert.ok(A.save.damaged.some((d) => d.startsWith("save.damaged-1.json (this window's save.recovery.json")), "and listed in Details");
  assert.equal(A.notices.load.text, store.recReplacedText("save.recovery.json", "save.damaged-1.json"));
  assert.deepEqual({ ...parsed(w.ctl, RECOVERY).state.applied }, { wA: 5, wB: 9 }, "the other game taken in, this window's unsaved actions replayed onto it");
  assert.equal(A.save.recOwn, 5);
  // The next write merges as usual: nothing more kept aside.
  clickN(A, 1, w.ctl.now());
  assert.equal(await cycle(A), true);
  assert.equal(w.ctl.readFile(damaged(2)), null);
});

test("r5-03: a VM restart while save.json is unreadable keeps the old VM's final write to save.recovery.json", async () => {
  w = win();
  const [old] = twoWriters(3);
  old.writerId = "wOld";
  w.ctl.externalWrite(SAVE, HUGE);
  clickN(old, 3, w.ctl.now());
  assert.equal(await cycle(old), true);
  clickN(old, 4, w.ctl.now()); // not saved yet when the new VM loads
  const nv = newSlot(HOME, store.slotPaths(HOME));
  nv.writerId = "wNew";
  nv.ownWriters = ["wOld"];
  nv.loading = 1;
  assert.equal(await hostWork(() => store.load(nv, { now: () => w.ctl.now(), seed: () => 1, gen: 1, writer: "wNew" })), true);
  nv.loading = 0;
  assert.equal(nv.state.applied.wOld, 3);
  await w.advance(100);
  assert.equal(await cycle(old), true, "the old VM's close() write lands after the new VM's load");
  assert.equal(parsed(w.ctl, RECOVERY).state.applied.wOld, 7);
  await w.advance(2000);
  clickN(nv, 1, w.ctl.now());
  assert.equal(await cycle(nv), true);
  assert.deepEqual({ ...parsed(w.ctl, RECOVERY).state.applied }, { wOld: 7, wNew: 1 }, "the old VM's 4 actions taken in, not written over");
  assert.equal(nv.notices.load, null, "this window's own write: no 'another window' notice");
  assert.equal(nv.flash, null);
  assert.deepEqual(nv.save.damaged, []);
});

test("r5-04: save.json readable again after the bad file is moved: the windows' saves are merged, never kept aside", async () => {
  w = win();
  const [A, B] = twoWriters(11);
  w.ctl.externalWrite(SAVE, HUGE);
  clickN(A, 2, w.ctl.now());
  await cycle(A);
  clickN(B, 2, w.ctl.now());
  await cycle(B);
  clickN(A, 1, w.ctl.now());
  await cycle(A);
  assert.deepEqual({ ...parsed(w.ctl, RECOVERY).state.applied }, { wA: 3, wB: 2 });
  w.ctl.externalWrite(SAVE, null); // the player moves the bad file away
  await w.advance(2000);
  clickN(A, 3, w.ctl.now());
  assert.equal(await cycle(A), true);
  assert.deepEqual({ ...parsed(w.ctl).state.applied }, { wA: 6, wB: 2 }, "A back on save.json");
  await w.advance(2000);
  clickN(B, 1, w.ctl.now());
  assert.equal(await cycle(B), true);
  assert.deepEqual({ ...parsed(w.ctl).state.applied }, { wA: 6, wB: 3 }, "B merged A's save.json write");
  assert.equal(w.ctl.readFile(damaged(1)), null, "nothing kept aside");
  assert.deepEqual(B.save.damaged, []);
  assert.equal(B.notices.write.kind, "merged");
  assert.equal(B.save.unreadable, null);
  await w.advance(2000);
  clickN(A, 1, w.ctl.now());
  assert.equal(await cycle(A), true);
  assert.deepEqual({ ...parsed(w.ctl).state.applied }, { wA: 7, wB: 3 });
  assert.equal(A.notices.load, null, "no 'progress left the game' notice");
});

test("r5-04: an older save put back while unreadable still lacks this window's progress: kept aside, not merged", async () => {
  w = win();
  const [A] = twoWriters(13);
  const older = w.ctl.readFile(SAVE);
  w.ctl.externalWrite(SAVE, HUGE);
  clickN(A, 3, w.ctl.now());
  assert.equal(await cycle(A), true);
  w.ctl.externalWrite(SAVE, older); // a valid save, but without the actions saved to the recovery file
  await w.advance(2000);
  clickN(A, 1, w.ctl.now());
  assert.equal(await cycle(A), true);
  assert.equal(parsed(w.ctl).state.applied.wA, 4, "this window's game saved");
  assert.equal(w.ctl.readFile(damaged(1)), older, "the file found there kept aside");
  assert.match(A.notices.load.text, /save\.damaged-1\.json/);
});

test("r5-05: merging another window's recovery game names a refused purchase, as a save.json merge does", async () => {
  for (const unreadable of [false, true]) {
    w = win();
    const base = engine.newGame({ seed: 9, now: DEFAULT_NOW, day: localDay(DEFAULT_NOW) });
    base.bank = 20;
    w.ctl.externalWrite(SAVE, engine.serialize(base));
    const mk = (id) => {
      const slot = newSlot(HOME, store.slotPaths(HOME));
      slot.writerId = id;
      const text = w.ctl.readFile(SAVE);
      slot.state = engine.parseSave(text).state;
      slot.baseText = text;
      slot.save.baseOk = true;
      return slot;
    };
    const A = mk("wA");
    const B = mk("wB");
    if (unreadable) w.ctl.externalWrite(SAVE, HUGE);
    const t = w.ctl.now();
    dispatch(A, { type: "buy", item: "paper-stack", count: 1 }, t);
    dispatch(B, { type: "buy", item: "paper-stack", count: 1 }, t + 10);
    assert.equal(await cycle(A), true);
    assert.equal(await cycle(B), true);
    const st = parsed(w.ctl, unreadable ? RECOVERY : SAVE).state;
    assert.deepEqual({ ...st.applied }, { wA: 1, wB: 1 });
    assert.ok(st.bank >= 8 && st.bank < 9, `B's buy was refused on the merged game (bank ${st.bank})`);
    const want = store.refundText(true, ["Paper Stack"]);
    assert.equal(want, "Merged with another window's progress. Refunded: Paper Stack.");
    if (unreadable) {
      assert.equal(B.notice.kind, "error", "the unreadable notice stays on show");
      assert.equal(B.flash.text, want, "and the refund is said beside it");
      assert.ok(B.flash.until - w.ctl.now() >= store.MERGED_MS - 1000, "for as long as the merged banner");
    } else {
      assert.equal(B.notices.write.text, want);
    }
    w.dispose();
    w = null;
  }
});

test("r5-06: a damaged save.recovery.json found during play is said, kept or not", async () => {
  for (const full of [false, true]) {
    w = win();
    const v = await w.copy("panel");
    await w.advance(1000);
    await w.hits(v, 2);
    await w.advance(16000);
    // All five kept-aside slots unreadable: the damaged file cannot be kept.
    if (full) for (let n = 1; n <= 5; n++) w.ctl.externalWrite(damaged(n), HUGE);
    const badRec = damagedText(77);
    w.ctl.externalWrite(RECOVERY, badRec);
    w.ctl.externalWrite(SAVE, null);
    w.ctl.mkdir(SAVE);
    await w.hits(v, 1);
    await w.advance(16000);
    assert.equal(w.slot.save.unreadable, "Not a regular file");
    assert.equal(hits(parsed(w.ctl, RECOVERY).state), 3, "this window's game written there");
    const load = w.slot.notices.load;
    assert.equal(load.kind, "recovered");
    if (full) {
      assert.equal(load.text, store.recDamagedText("save.recovery.json", null));
      assert.match(load.text, /could not be kept aside/);
    } else {
      assert.equal(w.ctl.readFile(damaged(1)), badRec);
      assert.equal(load.text, store.recDamagedText("save.recovery.json", "save.damaged-1.json"));
    }
    w.dispose();
    w = null;
  }
});

test("r5-02: Reset while save.json is unreadable keeps the recovery game aside, is never merged back, and the other window takes it in", async () => {
  w = win();
  const [A, B] = twoWriters(14);
  w.ctl.externalWrite(SAVE, HUGE);
  clickN(A, 5, w.ctl.now());
  assert.equal(await cycle(A), true);
  clickN(B, 5, w.ctl.now());
  assert.equal(await cycle(B), true);
  assert.ok(parsed(w.ctl, RECOVERY).state.stats.hits >= 8, "both windows' hits in the recovery game");
  // The game being replaced is this window's live game (the recovery file may
  // lack its latest actions, or be left from an earlier episode); B's progress
  // there is kept aside by A's next recovery write, below.
  const before = engine.serialize(A.state);
  const flashes = [];
  const env = { now: () => w.ctl.now(), seed: () => 7, flash: (m) => flashes.push(m) };
  assert.equal(await hostWork(() => store.resetGame(A, env)), "ok");
  assert.equal(w.ctl.readFile(damaged(1)), before, "the game being replaced is kept");
  assert.ok(A.save.damaged.includes("save.damaged-1.json (reset)"));
  assert.equal(flashes[0], "Started a new game. The old save was kept as save.damaged-1.json.");
  // B saves before A's reset is written: A's write replaces it, B's game kept aside.
  await w.advance(1000);
  clickN(B, 1, w.ctl.now());
  assert.equal(await cycle(B), true);
  const theirs = w.ctl.readFile(RECOVERY);
  await w.advance(1000);
  clickN(A, 1, w.ctl.now());
  assert.equal(await cycle(A), true);
  const reset = parsed(w.ctl, RECOVERY).state;
  assert.equal(reset.stats.hits, 1, "the reset game is written, not merged with the old one");
  assert.equal(reset.applied.wB, undefined);
  assert.equal(w.ctl.readFile(damaged(2)), theirs, "B's game kept aside");
  // B finds its write replaced: it takes the reset game in and names its kept copy.
  await w.advance(1000);
  clickN(B, 1, w.ctl.now());
  assert.equal(await cycle(B), true);
  assert.equal(B.notices.load.text, store.recReplacedText("save.recovery.json", "save.damaged-2.json"));
  assert.equal(parsed(w.ctl, RECOVERY).state.stats.hits, 2, "the reset game plus B's new hit");
  // From then on the two merge: nothing more kept aside.
  await w.advance(1000);
  clickN(A, 1, w.ctl.now());
  assert.equal(await cycle(A), true);
  assert.equal(parsed(w.ctl, RECOVERY).state.stats.hits, 3);
  assert.equal(w.ctl.readFile(damaged(3)), null);
});

test("r5 recovery notices fit the banner (NOTICE_MAX graphemes)", () => {
  for (const kept of [null, "save.damaged-5.json"]) {
    for (const text of [store.recOtherText("save.recovery.json", kept), store.recReplacedText("save.recovery.json", kept), store.recDamagedText("save.recovery.json", kept)]) {
      assert.ok(engine.graphemes(text).length <= store.NOTICE_MAX, text);
    }
  }
  assert.ok(engine.graphemes(store.refundText(true, ["Paper Stack: Third Tier", "Paper Stack: Third Tier", "Paper Stack: Third Tier", "x"])).length <= store.NOTICE_MAX);
});

// ---------------------------------------------------------------------------
// r5 review round 2: the way back to save.json, notices while it is unreadable,
// a Reset that landed in the recovery file, a stale recovery file.

/** Two windows in recovery mode, both written to save.recovery.json; `bLast`: B wrote there last. */
async function bothInRecovery(seed, bLast) {
  const [A, B] = twoWriters(seed);
  w.ctl.externalWrite(SAVE, HUGE);
  clickN(A, 2, w.ctl.now());
  await cycle(A);
  await w.advance(2000);
  clickN(B, 2, w.ctl.now());
  await cycle(B);
  await w.advance(2000);
  clickN(A, 1, w.ctl.now());
  await cycle(A);
  if (bLast) {
    await w.advance(2000);
    clickN(B, 1, w.ctl.now());
    await cycle(B);
  }
  return [A, B];
}

test("r5-04: back on save.json in either order: the first window back takes in the recovery file's latest game, nothing is kept aside", async () => {
  for (const bLast of [false, true]) {
    w = win();
    const [A, B] = await bothInRecovery(15, bLast);
    const rec = { ...parsed(w.ctl, RECOVERY).state.applied };
    assert.deepEqual(rec, bLast ? { wA: 3, wB: 3 } : { wA: 3, wB: 2 });
    w.ctl.externalWrite(SAVE, null); // the player moves the bad file away
    await w.advance(2000);
    clickN(A, 3, w.ctl.now());
    assert.equal(await cycle(A), true);
    assert.deepEqual({ ...parsed(w.ctl).state.applied }, { wA: 6, wB: rec.wB }, `A back on save.json with B's latest recovery write (bLast ${bLast})`);
    await w.advance(2000);
    clickN(B, 1, w.ctl.now());
    assert.equal(await cycle(B), true);
    assert.deepEqual({ ...parsed(w.ctl).state.applied }, { wA: 6, wB: rec.wB + 1 }, "B merged A's save.json write");
    await w.advance(2000);
    clickN(A, 1, w.ctl.now());
    assert.equal(await cycle(A), true);
    const fin = parsed(w.ctl).state;
    assert.equal(hits(fin), bLast ? 11 : 10, "every click of both windows is in the save");
    for (let n = 1; n <= 5; n++) assert.equal(w.ctl.readFile(damaged(n)), null, `nothing kept aside (bLast ${bLast})`);
    assert.deepEqual(A.save.damaged, []);
    assert.deepEqual(B.save.damaged, []);
    assert.equal(A.notices.load, null, "no 'progress left the game' notice");
    assert.equal(B.notices.load, null);
    w.dispose();
    w = null;
  }
});

test("r5-04: back on save.json, a save there lacking this window's recovery progress that another window kept aside is merged, and said", async () => {
  w = win();
  const [A] = twoWriters(16);
  w.ctl.externalWrite(SAVE, HUGE);
  clickN(A, 3, w.ctl.now());
  assert.equal(await cycle(A), true);
  const mine = w.ctl.readFile(RECOVERY);
  // Another window kept A's recovery game aside and went back first with its own game.
  w.ctl.externalWrite(damaged(1), mine);
  const other = parsed(w.ctl, RECOVERY).state;
  delete other.applied.wA;
  other.applied.wB = 4;
  w.ctl.externalWrite(SAVE, engine.serialize(other));
  await w.advance(2000);
  clickN(A, 1, w.ctl.now());
  assert.equal(await cycle(A), true);
  assert.deepEqual({ ...parsed(w.ctl).state.applied }, { wA: 4, wB: 4 }, "merged: the other game with this window's unsaved action");
  assert.equal(w.ctl.readFile(damaged(2)), null, "the other window's fresh save is not kept aside");
  assert.ok(A.save.damaged.includes("save.damaged-1.json"), "this window's kept game named in Details");
  assert.match(A.notices.load.text, /this window's earlier progress left the game/);
});

test("r5-02 / r5-06: recovery-file notices are flashed while the unreadable notice is on show, and dropped on the way back", async () => {
  w = win();
  const [A, B] = twoWriters(10);
  clickN(A, 2, w.ctl.now());
  await cycle(A);
  clickN(B, 3, w.ctl.now());
  await cycle(B);
  w.ctl.externalWrite(SAVE, HUGE);
  await w.advance(2000);
  clickN(A, 1, w.ctl.now());
  await cycle(A);
  await w.advance(2000);
  clickN(B, 1, w.ctl.now());
  await cycle(B);
  // First contact: B keeps A's game aside.
  const other = store.recOtherText("save.recovery.json", "save.damaged-1.json");
  assert.equal(B.notices.load.text, other);
  assert.equal(B.notice.kind, "error", "the unreadable notice outranks it");
  assert.equal(B.flash.text, other, "so it is flashed");
  assert.ok(B.flash.until - w.ctl.now() >= store.MERGED_MS - 1000);
  // A finds its game replaced.
  await w.advance(2000);
  clickN(A, 1, w.ctl.now());
  await cycle(A);
  const replaced = store.recReplacedText("save.recovery.json", "save.damaged-1.json");
  assert.equal(A.notices.load.text, replaced);
  assert.equal(A.notice.kind, "error");
  assert.equal(A.flash.text, replaced);
  // A damaged recovery file: said and flashed too.
  await w.advance(2000);
  w.ctl.externalWrite(RECOVERY, damagedText(5));
  clickN(A, 1, w.ctl.now());
  await cycle(A);
  const dmg = store.recDamagedText("save.recovery.json", "save.damaged-2.json");
  assert.equal(A.notices.load.text, dmg);
  assert.equal(A.flash.text, dmg);
  // Back on save.json: the stale episode notices go ("saved there now" is no longer true).
  w.ctl.externalWrite(SAVE, null);
  await w.advance(2000);
  clickN(A, 1, w.ctl.now());
  assert.equal(await cycle(A), true);
  assert.equal(A.save.unreadable, null);
  assert.equal(A.notices.load, null, "the recovery-file notice is dropped when leaving recovery mode");
  assert.ok(A.save.damaged.includes("save.damaged-2.json"), "the kept copies stay named in Details");
});

test("r5-02: Reset while unreadable, written to the recovery file, then save.json readable: the windows merge, nothing is written over", async () => {
  w = win();
  const [A, B] = twoWriters(17);
  w.ctl.externalWrite(SAVE, HUGE);
  clickN(A, 5, w.ctl.now());
  await cycle(A);
  clickN(B, 5, w.ctl.now());
  await cycle(B);
  const env = { now: () => w.ctl.now(), seed: () => 7, flash: () => {} };
  assert.equal(await hostWork(() => store.resetGame(A, env)), "ok");
  await w.advance(1000);
  clickN(A, 1, w.ctl.now());
  await cycle(A);
  assert.equal(A.save.overwriteRec, true, "the reset game landed in the recovery file");
  await w.advance(1000);
  clickN(B, 2, w.ctl.now());
  await cycle(B); // B takes the reset game in
  await w.advance(1000);
  clickN(A, 1, w.ctl.now());
  await cycle(A);
  const keptBefore = [1, 2, 3, 4, 5].filter((n) => w.ctl.readFile(damaged(n)) !== null).length;
  const recHits = hits(parsed(w.ctl, RECOVERY).state);
  w.ctl.externalWrite(SAVE, null);
  await w.advance(1000);
  clickN(B, 4, w.ctl.now());
  assert.equal(await cycle(B), true);
  await w.advance(1000);
  clickN(A, 1, w.ctl.now());
  assert.equal(await cycle(A), true);
  assert.equal(A.save.overwrite, null, "the Reset counts as landed");
  await w.advance(1000);
  clickN(B, 1, w.ctl.now());
  assert.equal(await cycle(B), true);
  assert.equal(hits(parsed(w.ctl).state), recHits + 6, "B's 4 + A's 1 + B's 1 clicks on top of the shared reset game: none lost");
  assert.equal([1, 2, 3, 4, 5].filter((n) => w.ctl.readFile(damaged(n)) !== null).length, keptBefore, "nothing more kept aside");
  assert.equal(B.notices.load, null, "no (false) 'that window kept the old file aside' notice");
});

test("r5-02: Reset while unreadable not yet written anywhere, then save.json readable: a save found there is kept aside before it is replaced", async () => {
  w = win();
  const [A, B] = twoWriters(18);
  w.ctl.externalWrite(SAVE, HUGE);
  clickN(A, 3, w.ctl.now());
  await cycle(A);
  const env = { now: () => w.ctl.now(), seed: () => 7, flash: () => {} };
  assert.equal(await hostWork(() => store.resetGame(A, env)), "ok");
  // B was never in recovery mode: its save lands at save.json once the bad file is moved.
  w.ctl.externalWrite(SAVE, null);
  clickN(B, 2, w.ctl.now());
  assert.equal(await cycle(B), true);
  const theirs = w.ctl.readFile(SAVE);
  await w.advance(1000);
  clickN(A, 1, w.ctl.now());
  assert.equal(await cycle(A), true);
  assert.equal(hits(parsed(w.ctl).state), 1, "the reset game is written");
  const kept = [1, 2, 3, 4, 5].map((n) => w.ctl.readFile(damaged(n)));
  assert.ok(kept.includes(theirs), "B's save found there is kept aside first");
  assert.ok(A.save.damaged.some((d) => /\(reset\)$/.test(d) && d !== "save.damaged-1.json (reset)"), "and listed with the reason");
  assert.equal(A.notices.load.text, store.unmergedText(`save.damaged-${kept.indexOf(theirs) + 1}.json`), "and said");
});

test("r5 minor: Reset with save.json unreadable before any recovery write keeps this window's live game, not a recovery file left from earlier", async () => {
  w = win();
  const [A] = twoWriters(19);
  const left = engine.newGame({ seed: 2, now: DEFAULT_NOW - 86400000, day: localDay(DEFAULT_NOW - 86400000) });
  w.ctl.externalWrite(RECOVERY, engine.serialize(left));
  clickN(A, 4, w.ctl.now());
  w.ctl.externalWrite(SAVE, HUGE); // A has not cycled since: enterUnreadable has not run
  const live = engine.serialize(A.state);
  const flashes = [];
  const env = { now: () => w.ctl.now(), seed: () => 7, flash: (m) => flashes.push(m) };
  assert.equal(await hostWork(() => store.resetGame(A, env)), "ok");
  assert.equal(w.ctl.readFile(damaged(1)), live, "the game being replaced is kept");
  assert.equal(flashes[0], "Started a new game. The old save was kept as save.damaged-1.json.");
});

test("r5 stale recovery file: writers the game pruned (unseen > 30 days) count as nothing new, so it is never taken in", async () => {
  w = win();
  const [A] = twoWriters(20);
  const longAgo = DEFAULT_NOW - 40 * 86400000;
  const left = engine.newGame({ seed: 2, now: longAgo, day: localDay(longAgo) });
  engine.apply(left, { w: "wGone", s: 50, t: longAgo + 10, type: "click", target: "sheet" });
  left.stats.hits = 999;
  w.ctl.externalWrite(RECOVERY, engine.serialize(left));
  w.ctl.externalWrite(SAVE, HUGE);
  clickN(A, 2, w.ctl.now());
  assert.equal(await cycle(A), true);
  const rec = parsed(w.ctl, RECOVERY).state;
  assert.deepEqual({ ...rec.applied }, { wA: 2 }, "this window's game written over the stale one");
  assert.equal(hits(rec), 2, "not rolled back to the stale game");
  assert.equal(A.notices.load, null);
  assert.equal(A.flash, null);
});

test("r4-04: a shared save gone with its backup during play: this window's own save, said, nothing created at the shared path", async () => {
  const SH = "/mnt/usb/cw/save.json";
  const SHB = "/mnt/usb/cw/save.bak.json";
  const st = freshState(5);
  st.stats.hits = 40;
  w = win({ files: { [`${DIR}/location.json`]: JSON.stringify({ path: SH }), [SH]: saveText(st), [SHB]: saveText(st) } });
  const v = await w.copy("panel");
  await w.advance(3000);
  assert.equal(w.slot.paths.save, SH);
  // The drive is unmounted: the whole folder goes.
  w.ctl.externalWrite(SH, null);
  w.ctl.externalWrite(SHB, null);
  await w.hits(v, 3);
  await w.advance(16000);
  assert.equal(w.ctl.readFile(SH), null, "nothing created at the shared path");
  assert.equal(w.slot.paths.save, SAVE, "this window's own save");
  assert.equal(hits(parsed(w.ctl).state), 43, "the running game saved there, nothing rolled back");
  assert.equal(w.slot.notice.kind, "recovered");
  assert.match(w.slot.notice.text, /^Shared save not found: \/mnt\/usb\/cw\/save\.json\. Using this window's own; share again in Settings/);
  // The drive comes back: the game goes on from where it was, with no false "another window" notice.
  w.ctl.externalWrite(SH, saveText(st));
  await w.hits(v, 1);
  await w.advance(16000);
  assert.equal(w.slot.state.stats.hits, 44);
  assert.equal(hits(parsed(w.ctl).state), 44);
  assert.doesNotMatch(w.slot.notice.text, /Another window/);
  assert.equal(hits(parsed(w.ctl, SH).state), 40, "the shared file is left as it was");
});

test("r4-04: with a local save there, the switch merges onto it as a load would; Check save now switches too; a lone missing save.json is still written again", async () => {
  const SH = "/mnt/usb/cw/save.json";
  const SHB = "/mnt/usb/cw/save.bak.json";
  const st = freshState(5);
  st.stats.hits = 40;
  const local = freshState(6);
  local.bank = 555555;
  w = win({ files: { [`${DIR}/location.json`]: JSON.stringify({ path: SH }), [SH]: saveText(st), [SHB]: saveText(st), [SAVE]: saveText(local) } });
  const v = await w.copy("panel");
  await w.advance(3000);
  w.ctl.externalWrite(SH, null);
  w.ctl.externalWrite(SHB, null);
  await w.hits(v, 2);
  await w.advance(16000);
  assert.equal(w.ctl.readFile(SH), null);
  assert.ok(parsed(w.ctl).state.bank >= 555555, "this window's own save, as a load loads it");
  assert.match(w.slot.notice.text, /^Shared save not found/);
  assert.doesNotMatch(w.slot.notice.text, /Another window/);
  w.dispose();

  // Check save now finds it gone: the same switch.
  w = win({ files: { [`${DIR}/location.json`]: JSON.stringify({ path: SH }), [SH]: saveText(st), [SHB]: saveText(st) } });
  const v2 = await w.copy("panel");
  await w.advance(3000);
  w.ctl.externalWrite(SH, null);
  w.ctl.externalWrite(SHB, null);
  let r;
  await w.ctl.dispatch("task", null, () => {
    r = store.checkSave(w.slot, { now: () => Date.now() });
  });
  await w.flush();
  assert.equal(await r, "missing");
  assert.equal(w.slot.paths.save, SAVE);
  await w.advance(3000);
  assert.equal(w.ctl.readFile(SH), null);
  assert.equal(hits(parsed(w.ctl).state), 40);
  w.dispose();

  // Only the shared save.json deleted (its backup still there): written again in place (r3-09).
  w = win({ files: { [`${DIR}/location.json`]: JSON.stringify({ path: SH }), [SH]: saveText(st), [SHB]: saveText(st) } });
  const v3 = await w.copy("panel");
  await w.advance(3000);
  w.ctl.externalWrite(SH, null);
  await w.hits(v3, 1);
  await w.advance(16000);
  assert.equal(w.slot.paths.save, SH);
  assert.equal(hits(parsed(w.ctl, SH).state), 41);
  assert.equal(w.slot.notices.load.text, store.MISSING_TEXT);
  void v2;
});

test("r4-05: an unreadable save.json beside a damaged backup: the backup is kept aside, the fresh start is said", async () => {
  const badBak = damagedText(500);
  w = win({ files: { [SAVE]: HUGE, [BAK]: badBak } });
  const v = await w.copy("panel");
  await w.advance(1000);
  assert.equal(w.slot.state.stats.hits, 0);
  assert.equal(w.slot.notice.kind, "error", "the unreadable banner first");
  assert.equal(w.slot.notices.load.kind, "fresh");
  assert.equal(w.slot.notices.load.text, "Save can't be read and the backup was damaged. Started fresh; the damaged file was kept.");
  assert.equal(w.ctl.readFile(damaged(1)), badBak);
  assert.deepEqual(w.slot.save.damaged, ["save.damaged-1.json"]);
  // The player moves save.json away: the fresh notice shows, and the backup rotation loses nothing.
  w.ctl.externalWrite(SAVE, null);
  await w.hits(v, 2);
  await w.advance(16000);
  assert.equal(w.slot.notice.kind, "fresh");
  await w.advance(6 * 60000);
  assert.notEqual(w.ctl.readFile(BAK), badBak, "the backup rotated");
  assert.equal(w.ctl.readFile(damaged(1)), badBak, "its damaged copy is still kept");
});

test("r4-05: an unreadable save.json beside a damaged recovery file: kept aside before the recovery write replaces it", async () => {
  const badRec = damagedText(900);
  w = win({ files: { [SAVE]: HUGE, [RECOVERY]: badRec } });
  await w.copy("panel");
  await w.advance(3000);
  assert.equal(w.slot.state.stats.hits, 0);
  assert.equal(w.ctl.readFile(damaged(1)), badRec, "kept aside");
  assert.ok(parsed(w.ctl, RECOVERY).ok, "then replaced by this game");
  assert.equal(w.slot.notices.load.kind, "fresh");
  assert.equal(w.slot.notices.load.text, "Save can't be read and the recovery file was damaged and there was no backup. Started fresh; the damaged file was kept.");
  w.dispose();
  // Neither file at all: still never a silent fresh start.
  w = win({ files: { [SAVE]: HUGE } });
  await w.copy("panel");
  await w.advance(1000);
  assert.equal(w.slot.notices.load.text, "Save can't be read and there was no backup. Started fresh.");
  w.dispose();
  // A good backup beside a damaged recovery file loads, the recovery file kept aside, no fresh notice.
  const good = freshState(4);
  good.stats.hits = 33;
  w = win({ files: { [SAVE]: HUGE, [RECOVERY]: badRec, [BAK]: saveText(good) } });
  await w.copy("panel");
  await w.advance(1000);
  assert.equal(w.slot.state.stats.hits, 33);
  assert.equal(w.ctl.readFile(damaged(1)), badRec);
  assert.equal(w.slot.notices.load, null);
});

test("r4-05: every unreadable fresh-start notice fits the banner, alone and after a missing shared save", () => {
  for (const hadRec of [false, true])
    for (const hadBak of [false, true])
      for (const kr of [null, "save.damaged-1.json"])
        for (const kb of [null, "save.damaged-2.json"]) {
          const text = store.unreadableFreshText(hadRec, kr, hadBak, kb);
          assert.ok(engine.graphemes(text).length <= store.NOTICE_MAX, text);
          assert.ok(engine.graphemes(store.goneJoined(text)).length <= store.NOTICE_MAX, store.goneJoined(text));
        }
});

// r6-04: a backup that is there but can't be read (herdr's read() errors:
// "Not a regular file", "Text file exceeds 1 MiB", invalid UTF-8, permission)
// still holds the player's progress. It is never taken for "no backup", and
// a fresh start beside it is never silent.
const BIG_BAK = `{"pad":"${"x".repeat(1100000)}"}`;
// Two-byte characters over 1 MiB: the mock's cut lands inside one, so the read says invalid UTF-8.
const BAD_UTF8_BAK = "é".repeat(524289);
const BAK_CASES = [
  ["a folder", (ctl) => ctl.mkdir(BAK), "Not a regular file", {}],
  ["over 1 MiB", () => {}, "Text file exceeds 1 MiB", { [BAK]: BIG_BAK }],
  ["invalid UTF-8", () => {}, "stream did not contain valid UTF-8", { [BAK]: BAD_UTF8_BAK }],
];

test("r6-04: save.json missing beside an unreadable backup: a fresh start that says the backup can't be read and was left in place", async () => {
  for (const [what, make, msg, files] of BAK_CASES) {
    w = win({ files });
    make(w.ctl);
    const v = await w.copy("panel");
    await w.flush();
    const n = w.slot.notice;
    assert.ok(n, `${what}: never a silent fresh start`);
    assert.equal(n.kind, "fresh", what);
    assert.equal(n.text, "Save was missing; backup can't be read (left in place; Details). Started fresh.", what);
    assert.equal(n.message, msg, `${what}: the host message`);
    assert.doesNotMatch(n.text, /no backup/);
    const info = v.session.ctx().save;
    assert.equal(info.backup, "can't be read, left in place", what);
    assert.equal(info.backupWhy, msg, `${what}: the message in Details, on a row of its own (r7-04)`);
    assert.equal(info.backupPath, BAK, `${what}: and the path`);
    const banner = v.session.vm().notices.find((x) => x.save);
    assert.ok(banner && banner.actions.includes("details"), `${what}: the banner offers Details`);
    await w.advance(3000);
    assert.ok(parsed(w.ctl).ok, `${what}: the fresh game is saved`);
    assert.equal(w.ctl.readFile(BAK), files[BAK] ?? null, `${what}: the backup is left as it was`);
    // The rotation is never tried over it (herdr's write would fail reading it
    // and say "the save itself is fine" over this notice): the fresh-start
    // notice, the banner and the Details row stay as they were, rotation after
    // rotation, and the progress in it is never written over.
    const text = n.text;
    for (const dt of [20000, 60000, 6 * 60000, 30 * 60000]) {
      await w.advance(dt);
      assert.equal(w.ctl.readFile(BAK), files[BAK] ?? null, `${what} +${dt}: still left as it was`);
      assert.equal(w.slot.notices.bak, null, `${what} +${dt}: no backup error`);
      assert.equal(w.slot.notice && w.slot.notice.kind, "fresh", `${what} +${dt}: the fresh-start notice is on show`);
      assert.equal(w.slot.notice.text, text, `${what} +${dt}`);
      const b = v.session.vm().notices.find((x) => x.save);
      assert.equal(b && b.text, text, `${what} +${dt}: the banner`);
      assert.doesNotMatch(b.text, /save itself is fine/, `${what} +${dt}`);
      const si = v.session.ctx().save;
      assert.deepEqual([si.backup, si.backupWhy, si.backupPath], ["can't be read, left in place", msg, BAK], `${what} +${dt}: the Details rows keep the message and path`);
    }
    assert.deepEqual(w.ctl.writes.filter((x) => x.path === BAK), [], `${what}: no write to the backup was tried`);
    assert.ok(parsed(w.ctl).ok, `${what}: the fresh game keeps saving`);
    w.dispose();
    w = null;
  }
});

test("r6-04: a damaged save.json beside an unreadable backup never says there was no backup", async () => {
  for (const [what, make, msg, files] of BAK_CASES) {
    w = win({ files: { ...files, [SAVE]: "{not json" } });
    make(w.ctl);
    await w.copy("panel");
    await w.flush();
    const n = w.slot.notice;
    assert.equal(n && n.kind, "fresh", what);
    assert.equal(n.text, "Save was damaged; backup can't be read (left in place; Details). Started fresh; the damaged file was kept.", what);
    assert.equal(n.message, msg, what);
    assert.equal(w.ctl.readFile(damaged(1)), "{not json", `${what}: the damaged save kept aside`);
    assert.equal(w.ctl.readFile(BAK), files[BAK] ?? null, `${what}: the backup is not kept aside or touched`);
    await w.advance(6 * 60000);
    assert.equal(w.slot.notice && w.slot.notice.kind, "fresh", `${what}: still the fresh-start notice after rotations`);
    assert.equal(w.slot.notice.text, n.text, what);
    assert.equal(w.slot.notices.bak, null, what);
    assert.equal(w.ctl.readFile(BAK), files[BAK] ?? null, `${what}: still left as it was`);
    assert.deepEqual(w.ctl.writes.filter((x) => x.path === BAK), [], `${what}: no write to the backup was tried`);
    w.dispose();
    w = null;
  }
});

test("r6-04: an unreadable save.json beside an unreadable backup says both can't be read", async () => {
  w = win({ files: { [SAVE]: HUGE, [BAK]: BIG_BAK } });
  const v = await w.copy("panel");
  await w.advance(1000);
  assert.equal(w.slot.notices.write.kind, "error", "the unreadable save.json notice comes first");
  assert.equal(w.slot.notices.load.text, "Save and backup can't be read (left in place; Details). Started fresh.");
  assert.equal(w.slot.notices.load.message, "Text file exceeds 1 MiB");
  assert.equal(v.session.ctx().save.backup, "can't be read, left in place");
  assert.equal(v.session.ctx().save.backupWhy, "Text file exceeds 1 MiB");
  assert.equal(w.ctl.readFile(BAK), BIG_BAK);
  w.dispose();
  w = win({ files: { [SAVE]: HUGE, [RECOVERY]: damagedText(5) } });
  w.ctl.mkdir(BAK);
  await w.copy("panel");
  await w.advance(1000);
  assert.equal(w.slot.notices.load.text, "Save and backup unreadable (left in place), recovery file damaged. Started fresh; the damaged file was kept.");
});

test("r6-04: a missing shared save beside an unreadable local backup says both", async () => {
  const shared = "/mnt/usb/a-rather-long-folder-name-for-the-shared-game/creaseworks/save.json";
  w = win({ files: { [`${DIR}/location.json`]: JSON.stringify({ path: shared }), [BAK]: BIG_BAK } });
  await w.copy("panel");
  await w.flush();
  const n = w.slot.notice;
  assert.equal(n && n.kind, "fresh");
  assert.equal(n.text, "Shared save not found; using this window's own. Save was missing; backup can't be read (left in place; Details). Started fresh.");
  assert.equal(w.ctl.readFile(shared), null);
});

test("r6-04: a backup that turns readable again is kept aside, and said, before any rotation replaces it", async () => {
  for (const [what, make, , files] of BAK_CASES) {
    w = win({ files });
    make(w.ctl);
    const v = await w.copy("panel");
    await w.advance(3000);
    // The player fixes it (the folder moved away and the old game put back, permissions fixed).
    const old = freshState(2);
    const oldText = saveText(old);
    if (what === "a folder") w.ctl.dirs.delete(BAK); // (the mock has no rmdir)
    w.ctl.externalWrite(BAK, oldText);
    await w.advance(6 * 60000);
    assert.equal(w.ctl.readFile(damaged(1)), oldText, `${what}: the old game is kept aside before the backup rotates`);
    const info = v.session.ctx().save;
    assert.ok(info.damaged.some((d) => d.startsWith("save.damaged-1.json (the unreadable backup, from ")), `${what}: listed in Details: ${info.damaged}`);
    const n = w.slot.notices.load;
    assert.equal(n && n.kind, "recovered", what);
    assert.match(n.text, /^The backup can be read again: kept as save\.damaged-1\.json \(game from .+\) \(Details\)\. This game started fresh\.$/, what);
    assert.doesNotMatch(String(info.backup), /can't be read/, String(info.backup));
    // Then the backup trails this game as usual; the old game stays in the kept copy.
    await w.advance(6 * 60000);
    const bak = w.ctl.readFile(BAK);
    assert.notEqual(bak, oldText, `${what}: rotated once kept`);
    assert.equal(w.ctl.readFile(damaged(1)), oldText, `${what}: the kept copy stays`);
    w.dispose();
    w = null;
  }
});

test("r6-04: a backup readable again that can't be kept aside is never rotated over", async () => {
  w = win({ files: { [BAK]: BIG_BAK } });
  const v = await w.copy("panel");
  await w.advance(3000);
  const oldText = saveText(freshState(2));
  w.ctl.externalWrite(BAK, oldText);
  w.ctl.failNextWrite("No space left on device (os error 28)", damaged(1));
  await w.advance(6 * 60000);
  assert.equal(w.ctl.readFile(damaged(1)), null, "the keep-aside write failed");
  assert.equal(w.ctl.readFile(BAK), oldText, "not rotated over");
  const si = v.session.ctx().save;
  assert.deepEqual([si.backup, si.backupWhy, si.backupPath], ["readable again, left in place", "could not be kept aside yet", BAK]);
  assert.equal(w.slot.notice && w.slot.notice.kind, "fresh", "the fresh-start notice stays");
  // The next try keeps it, then the backup rotates.
  await w.advance(6 * 60000);
  assert.equal(w.ctl.readFile(damaged(1)), oldText, "kept on the next try");
  await w.advance(6 * 60000);
  assert.notEqual(w.ctl.readFile(BAK), oldText, "rotated once kept");
  assert.equal(w.ctl.readFile(damaged(1)), oldText);
});

test("r6-04: a backup that can't be read and is then moved away is rotated as usual", async () => {
  w = win({ files: { [BAK]: BIG_BAK } });
  const v = await w.copy("panel");
  await w.advance(3000);
  w.ctl.externalWrite(BAK, null); // (deletes it)
  await w.advance(12 * 60000);
  assert.notEqual(w.ctl.readFile(BAK), null, "a new backup was written");
  assert.match(String(v.session.ctx().save.backup), /^rotated /);
  assert.equal(w.ctl.readFile(damaged(1)), null, "nothing to keep aside");
});

test("r6-04: the kept-aside notice fits the banner", () => {
  const t = store.backupKeptText("save.damaged-5.json", " (game from 23:59)");
  assert.ok(engine.graphemes(t).length <= store.NOTICE_MAX, t);
  assert.doesNotMatch(t, /save itself is fine/);
});

test("r6-04: every unreadable-backup fresh-start notice fits the banner, alone and after a missing shared save", () => {
  const texts = [];
  for (const hadMain of [false, true]) for (const kept of [null, "save.damaged-5.json"]) texts.push(store.freshText(hadMain, kept, false, undefined, "Text file exceeds 1 MiB"));
  for (const hadRec of [false, true]) for (const kr of [null, "save.damaged-5.json"]) texts.push(store.unreadableFreshText(hadRec, kr, false, undefined, "Not a regular file"));
  for (const t of texts) {
    assert.doesNotMatch(t, /no backup|backup was damaged/, t);
    assert.ok(engine.graphemes(t).length <= store.NOTICE_MAX, t);
    const j = store.goneJoined(t);
    assert.ok(j.startsWith("Shared save not found") && j.endsWith(t), j);
  }
});

// r7-05: a backup that can't be read beside a good save.json is never
// rotated (r6-04), so while it lasts there is no working backup: an error
// notice says so (banner, footer, ribbon, the save notification), not only
// the Details row, until it can be read again or is gone.
test("r7-05: a good save beside an unreadable backup shows a backup error until the backup is fixed", async () => {
  for (const [what, make, msg, files] of BAK_CASES) {
    const good = freshState(3);
    good.bank = 5000;
    w = win({ files: { ...files, [SAVE]: saveText(good) } });
    make(w.ctl);
    const v = await w.copy("panel");
    await w.flush();
    assert.ok(w.slot.state.bank >= 5000, `${what}: the save loads`);
    const first = w.slot.notice;
    for (const dt of [3000, 6 * 60000, 30 * 60000]) {
      await w.advance(dt);
      const n = w.slot.notice;
      assert.equal(n && n.kind, "error", `${what} +${dt}: never silent`);
      assert.equal(n, w.slot.notices.bak, `${what} +${dt}: the backup notice`);
      assert.equal(n.text, store.backupUnreadableText(BAK, msg), what);
      assert.match(n.text, /^Can't read the backup \(save\.bak\.json\): .+\. Left in place, not updated; the save itself is fine\.$/, what);
      assert.doesNotMatch(n.text, /started fresh/i, what);
      assert.equal(n.at, first.at, `${what}: one episode`);
      const info = v.session.ctx().save;
      assert.equal(info.state, "problem", `${what}: the footer's problem state`);
      assert.match(info.text, /^Backup problem · saved/, what);
      const vm = v.session.vm();
      assert.equal(vm.ribbon.save, "Save problem", `${what}: the ribbon`);
      const b = vm.notices.find((x) => x.save);
      assert.equal(b && b.text, n.text, `${what}: the banner`);
      assert.ok(store.problemEpisode(w.slot), `${what}: counted for the save notification`);
      assert.equal(w.ctl.readFile(BAK), files[BAK] ?? null, `${what}: left as it was`);
    }
    assert.deepEqual(w.ctl.writes.filter((x) => x.path === BAK), [], `${what}: never rotated over`);
    // Fixed (an older copy of this same game put back): Retry reads it again at
    // once; an ordinary backup of this game is adopted, not kept aside.
    if (what === "a folder") w.ctl.dirs.delete(BAK);
    w.ctl.externalWrite(BAK, saveText(good));
    await w.handler(v, "retrySave");
    await w.advance(3000);
    assert.equal(w.slot.notices.bak, null, `${what}: the backup notice is cleared`);
    assert.equal(w.slot.notice, null, `${what}: nothing else to say`);
    assert.equal(w.slot.save.problemSince, null, what);
    assert.equal(w.ctl.readFile(damaged(1)), null, `${what}: a backup of this game is not kept aside`);
    assert.notEqual(w.ctl.readFile(BAK), saveText(good), `${what}: rotated as usual`);
    assert.match(String(v.session.ctx().save.backup), /^rotated /, what);
    w.dispose();
    w = null;
  }
});

test("r7-05: a backup that can't be read never covers the fresh-start or unreadable-save notice", async () => {
  w = win({ files: { [BAK]: BIG_BAK } });
  await w.copy("panel");
  await w.advance(6 * 60000);
  assert.equal(w.slot.notice.kind, "fresh");
  assert.equal(w.slot.notices.bak, null);
  w.dispose();
  w = win({ files: { [SAVE]: HUGE, [BAK]: BIG_BAK } });
  await w.copy("panel");
  await w.advance(6 * 60000);
  assert.equal(w.slot.notice, w.slot.notices.write, "the unreadable save.json comes first");
  assert.equal(w.slot.notices.bak, null);
});

test("r7-05: a good save beside a backup readable again but not kept aside says so", async () => {
  w = win({ files: { [SAVE]: saveText(freshState(3)), [BAK]: BIG_BAK } });
  const v = await w.copy("panel");
  await w.advance(3000);
  const other = saveText(freshState(2)); // another game: kept aside before any rotation
  w.ctl.externalWrite(BAK, other);
  w.ctl.failNextWrite("No space left on device (os error 28)", damaged(1));
  await w.handler(v, "retrySave");
  await w.advance(3000);
  assert.equal(w.ctl.readFile(BAK), other, "not rotated over");
  assert.equal(w.slot.notice && w.slot.notice.kind, "error");
  assert.equal(w.slot.notice.text, store.backupHeldText(BAK));
  assert.ok(engine.graphemes(store.backupHeldText(BAK)).length <= store.NOTICE_MAX);
  await w.advance(6 * 60000);
  assert.equal(w.ctl.readFile(damaged(1)), other, "kept on the next try");
  assert.equal(w.slot.notices.bak, null, "the backup error is cleared");
  assert.match(w.slot.notice.text, /^The backup can be read again: kept as save\.damaged-1\.json .+ It held another game; this one is unchanged\.$/);
});

test("r7-05: every backup-error text fits the banner", () => {
  for (const [, , msg] of BAK_CASES) {
    const t = store.backupUnreadableText("/x/" + "🗂".repeat(40) + "/save.bak.json", msg + " " + "🙁".repeat(80));
    assert.ok(engine.graphemes(t).length <= store.NOTICE_MAX, t);
  }
});

// r7-06: a backup readable again is kept aside only when it may hold progress
// that is nowhere else, and "This game started fresh." only after a fresh start.
test("r7-06: beside a good save, a backup readable again with another game is kept aside without saying the game started fresh", async () => {
  w = win({ files: { [SAVE]: saveText(freshState(3)) } });
  w.ctl.mkdir(BAK);
  await w.copy("panel");
  await w.advance(3000);
  w.ctl.dirs.delete(BAK);
  const other = saveText(freshState(2));
  w.ctl.externalWrite(BAK, other);
  await w.advance(6 * 60000);
  assert.equal(w.ctl.readFile(damaged(1)), other, "kept aside: another game");
  const n = w.slot.notices.load;
  assert.equal(n && n.kind, "recovered");
  assert.doesNotMatch(n.text, /started fresh/, n.text);
  assert.match(n.text, /It held another game; this one is unchanged\.$/);
  assert.ok(engine.graphemes(store.backupKeptText("save.damaged-5.json", " (game from 23:59)", false)).length <= store.NOTICE_MAX);
});

test("r7-06: two windows on one save: the second never keeps the first one's ordinary rotation aside", async () => {
  w = win();
  for (let n = 1; n <= 5; n++) w.ctl.externalWrite(damaged(n), `kept ${n}`);
  const base = engine.newGame({ seed: 9, now: Date.now(), day: "2026-01-01" });
  w.ctl.externalWrite(SAVE, engine.serialize(base));
  w.ctl.mkdir(BAK);
  const env = { now: () => Date.now() };
  const mk = async (id) => {
    const slot = newSlot(HOME, store.slotPaths(HOME));
    slot.writerId = id;
    slot.loading = 1;
    await hostWork(() => store.load(slot, { now: () => Date.now(), seed: () => 1, gen: 1 }));
    slot.loading = 0;
    return slot;
  };
  const A = await mk("wA");
  const B = await mk("wB");
  assert.equal(A.save.bakUnreadable, "Not a regular file");
  assert.equal(B.notice && B.notice.kind, "error", "B says the backup can't be read too");
  await w.ctl.advance(2000);
  await hostWork(() => store.cycle(A, env));
  await hostWork(() => store.cycle(B, env));
  // The player puts an older game back in place of the folder.
  w.ctl.dirs.delete(BAK);
  const oldGame = saveText(freshState(2));
  w.ctl.externalWrite(BAK, oldGame);
  await w.ctl.advance(6 * 60000);
  dispatch(A, { type: "click", target: "sheet" }, Date.now());
  await hostWork(() => store.cycle(A, env)); // A keeps the old game aside
  await w.ctl.advance(6 * 60000);
  dispatch(A, { type: "click", target: "sheet" }, Date.now());
  await hostWork(() => store.cycle(A, env)); // A rotates
  assert.notEqual(w.ctl.readFile(BAK), oldGame, "A rotated its save in");
  dispatch(B, { type: "click", target: "sheet" }, Date.now());
  await hostWork(() => store.cycle(B, env)); // B probes now
  assert.deepEqual([1, 2, 3, 4].map((n) => w.ctl.readFile(damaged(n))), ["kept 2", "kept 3", "kept 4", "kept 5"], "only the oldest made room, once");
  assert.equal(w.ctl.readFile(damaged(5)), oldGame, "the old game is kept, once");
  assert.equal(B.notice, null, "B says nothing: its backup is an ordinary one again");
  assert.equal(B.save.bakUnreadable, null);
  assert.equal(B.save.damaged.length, 0, "B kept nothing aside");
});

// r7-07: the backup check moves back with the clock like every other save timer.
test("r7-07: the wall clock moving back does not delay the unreadable-backup check", async () => {
  w = win({ files: { [SAVE]: saveText(freshState(3)) } });
  w.ctl.mkdir(BAK);
  await w.copy("panel");
  await w.advance(6 * 60000);
  assert.ok(typeof w.slot.save.bakProbeAt === "number", "probed");
  const OFF = 3 * 3600000;
  Date.now = () => w.ctl.t - OFF; // clock.js reads Date.now; timers keep virtual time
  w.ctl.dirs.delete(BAK);
  w.ctl.externalWrite(BAK, saveText(freshState(3)));
  for (let i = 0; i < 28; i++) {
    await w.advance(15000);
    if (!w.slot.save.bakUnreadable) break;
  }
  assert.equal(w.slot.save.bakUnreadable, null, "read again within the 5 min cadence on the new clock");
  assert.ok(w.slot.save.bakProbeAt <= Date.now());
  assert.equal(w.slot.notices.bak, null);
  const s = { save: { dirtyAt: null, urgentAt: null, retryAt: 0, bakRetryAt: 0, savedAt: null, bakProbeAt: 5000 }, bakAt: null };
  store.rebaseClock(s, 1000);
  assert.equal(s.save.bakProbeAt, 1000);
});

// r6-18: herdr's create_new write (expected null) returns the OS text when the
// file appeared in between: Unix and Windows word it differently.
test("r6-18: isCas takes herdr's CAS texts and the create_new collision on Unix and Windows", () => {
  for (const m of [
    "The file changed outside Herdr",
    "The file changed while saving",
    "File exists (os error 17)",
    "The file exists. (os error 80)",
    "Die Datei ist vorhanden. (os error 80)",
    "`herdr.writeTextFile`: The file exists. (os error 80)",
    "`herdr.writeTextFile`: File exists (os error 17)",
  ]) assert.equal(store.isCas(new Error(m)), true, m);
  for (const m of ["Permission denied (os error 13)", "Text file exceeds 1 MiB", "Not a regular file", "No space left on device (os error 28)", "Access is denied. (os error 5)", "os error 170"]) {
    assert.equal(store.isCas(new Error(m)), false, m);
  }
});

test("r6-18: a racing first write on Windows is merged, not shown as a save error", async () => {
  const other = freshState(9);
  other.stats.hits = 41;
  w = win();
  await w.copy("panel");
  // Another process creates save.json between herdr's check and its create_new open.
  w.ctl.failNextWrite("The file exists. (os error 80)", SAVE);
  w.ctl.externalWrite(SAVE, saveText(other));
  await w.advance(3000);
  assert.equal(w.slot.save.errors, 0, "no save error and no back-off");
  assert.notEqual(w.slot.notices.write && w.slot.notices.write.kind, "error");
  const p = parsed(w.ctl);
  assert.ok(p.ok && p.state.stats.hits >= 41, "the other process's save is merged in");
});

// r6-16: the engine holds the save under K.saveBudget by archiving Album
// records and (format 5) by writing the least recently active present helpers
// slim, but a roster whose slim records alone pass herdr's 1 MiB limit (about
// 8,500 helpers present at once, DESIGN R13; 1,300 before format 5) cannot
// shrink. The store measures the text before writing, as a last resort: such
// a write is never sent, the reason is said in words, and it is retried until
// the roster is small enough again.
test("r6-16: oversize measures UTF-8 bytes exactly around herdr's 1 MiB limit", () => {
  assert.equal(store.FILE_LIMIT, 1024 * 1024);
  const L = store.FILE_LIMIT;
  const cases = [
    "x".repeat(L), "x".repeat(L + 1), "x".repeat(349525), "é".repeat(L / 2), "é".repeat(L / 2) + "x",
    "漢".repeat(349525), "漢".repeat(349525) + "x", "漢".repeat(349525) + "xy", "🐦".repeat(L / 4), "🐦".repeat(L / 4) + "é",
    `${"a".repeat(500000)}${"支払い".repeat(60000)}`, `${"a".repeat(600000)}${"é🐦漢".repeat(50000)}`,
    // over the limit in UTF-16 units alone: still the exact byte count, not the length
    "é".repeat(L + 1), "漢".repeat(L), "🐦".repeat(L / 2 + 1), `${"x".repeat(L)}${"支払い".repeat(1000)}`,
  ];
  for (const t of cases) {
    const bytes = Buffer.byteLength(t, "utf8");
    assert.equal(store.oversize(t), bytes > L ? bytes : 0, `${t.length} units, ${bytes} bytes`);
  }
  assert.equal(store.oversize(""), 0);
});

test("r6-16: the too-big message fits the banner's error clip whole", () => {
  for (const kib of [1025, 1216, 4096, 9999]) {
    const m = store.oversizeText(kib * 1024);
    assert.ok(engine.graphemes(m).length <= 60, m);
    assert.match(m, new RegExp(`^save is ${kib} KiB, over herdr's 1 MiB cap: too many helpers$`));
    const r = store.oversizeText(kib * 1024, true);
    assert.ok(engine.graphemes(r).length <= 60, r);
    assert.match(r, new RegExp(`^recovery file is ${kib} KiB, over 1 MiB: too many helpers$`));
  }
  // a non-ASCII save over the limit in length alone says its real size
  assert.equal(store.oversizeText(store.oversize("漢".repeat(store.FILE_LIMIT))), "save is 3072 KiB, over herdr's 1 MiB cap: too many helpers");
});

test("R13 (format 5): 4,000 agents present at once save under the budget, every one a saved helper", async () => {
  const agents = [];
  const terminals = [];
  for (let i = 1; i <= 4000; i++) {
    agents.push({ address: `t${i}`, pane: `p${i}`, status: i % 3 ? "working" : "idle", title: `agent ${i} 支払い照合サービスのテスト ${"漢".repeat(20)}`, space_name: "支払いチーム", tab_name: "統合テスト", tab_index: 1, focused: i === 1 });
    terminals.push({ address: `t${i}`, status: i % 3 ? "working" : "idle", turn: 0, created_ms: 1000 + i * 997 });
  }
  w = win({ agents, terminals });
  await w.copy("panel");
  await w.advance(3000);
  const text = w.ctl.readFile(SAVE);
  assert.ok(text, "written");
  assert.ok(Buffer.byteLength(text, "utf8") <= engine.CONTENT.K.saveBudget, `${Buffer.byteLength(text, "utf8")} bytes`);
  assert.equal(w.slot.save.status, "ok");
  assert.equal(w.slot.notices.write, null);
  const p = parsed(w.ctl);
  assert.ok(p && p.ok);
  assert.equal(Object.values(p.state.helpers).filter((h) => !h.gone).length, 4000, "every agent is a saved helper");
});

/** Pane agents enough that even their slim records pass 1 MiB (format 5, R13). */
const OVER_MIB = 14000;

test("r6-16: a recovery write over 1 MiB is never sent, and its message is shown whole", async () => {
  const agents = [];
  const terminals = [];
  for (let i = 1; i <= OVER_MIB; i++) {
    agents.push({ address: `t${i}`, pane: `p${i}`, status: "working", title: `agent ${i} 支払い照合サービスのテスト ${"漢".repeat(20)}`, space_name: "api", tab_name: "tab 1", tab_index: 1, focused: i === 1 });
    terminals.push({ address: `t${i}`, status: "working", turn: 0, created_ms: 1000 + i * 997 });
  }
  w = win({ files: { [SAVE]: HUGE }, agents, terminals });
  const v = await w.copy("panel");
  await w.advance(3000);
  assert.equal(w.ctl.readFile(RECOVERY), null, "nothing written");
  assert.deepEqual(w.ctl.writes.filter((x) => x.path === RECOVERY), [], "the recovery write was not sent to herdr");
  const m = w.slot.notices.write.message;
  assert.match(m, /^recovery file is \d+ KiB, over 1 MiB: too many helpers$/);
  const banner = v.session.vm().notices.find((x) => x.save);
  assert.ok(banner.text.includes(`Can't save: ${m}.`), banner.text);
});

test("r6-16: a save over 1 MiB is never sent, is said in words, and saves again once the roster shrinks", async () => {
  const many = (n) => {
    const agents = [];
    const terminals = [];
    for (let i = 1; i <= n; i++) {
      agents.push({ address: `t${i}`, pane: `p${i}`, status: "working", title: `agent ${i} 支払い照合サービスのテスト ${"漢".repeat(20)}`, space_name: "api", tab_name: "tab 1", tab_index: 1, focused: i === 1 });
      terminals.push({ address: `t${i}`, status: "working", turn: 0, created_ms: 1000 + i * 997 });
    }
    return { agents, terminals };
  };
  w = win(many(OVER_MIB));
  const v = await w.copy("panel");
  await w.advance(3000);
  assert.equal(w.ctl.readFile(SAVE), null, "nothing written");
  assert.equal(w.ctl.counts.writeTextFile ?? 0, 0, "the write was not sent to herdr");
  assert.equal(w.slot.save.status, "error");
  assert.match(w.slot.notices.write.message, /^save is \d+ KiB, over herdr's 1 MiB cap: too many helpers$/);
  const banner = v.session.vm().notices.find((x) => x.save);
  assert.match(banner.text, /^Can't save: save is \d+ KiB, over herdr's 1 MiB cap: too many helpers\. Retrying in .*Your progress is safe in memory\.$/);
  assert.equal(v.session.ctx().save.state, "problem");
  // The flock goes back to a size that fits: the next retry saves, and the notice clears.
  const few = many(40);
  w.ctl.setAgents(few.agents);
  w.ctl.setTerminals(few.terminals);
  await w.advance(6 * 60000);
  const p = parsed(w.ctl);
  assert.ok(p && p.ok, "saved once it fits");
  assert.ok(Buffer.byteLength(w.ctl.readFile(SAVE), "utf8") <= store.FILE_LIMIT);
  assert.equal(w.slot.save.status, "ok");
  assert.equal(w.slot.notices.write, null);
});

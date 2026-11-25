// Store (ARCHITECTURE A4, A5; DESIGN §12.1, §12.2): first load, damaged files
// kept aside (n = 1..5, oldest replaced), the backup, a CAS conflict merged
// without double counting, write failures with back-off, a newer save,
// backup rotation, the shared-save pointer, and notices that are never silent.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { win, SAVE, BAK, DIR, damaged, saveText, freshState, parsed, engine } from "./_util.mjs";
import * as store from "../../mods/creaseworks/glue/store.js";

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

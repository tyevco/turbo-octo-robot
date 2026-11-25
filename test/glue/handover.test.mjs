// Handover slot and writer election (ARCHITECTURE A6; DESIGN §3.11, §12.3,
// §12.4): plain data only, hot reload adopts without a disk read or a
// rollback, a reload in the middle of a write (both outcomes: it landed / it
// did not) neither rolls back nor counts twice, two copies elect one ticker
// and one writer, a dead ticker is replaced, close(cx) starts a final write,
// a hidden window ticks every 5 s, and checking() renders a static demo.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { win, SAVE, parsed, agent, term, engine } from "./_util.mjs";
import { SLOT_KEY } from "../../mods/creaseworks/glue/live.js";

let w;
afterEach(() => w && w.dispose());

/** True when `v` holds only plain data (no functions, no class instances but Object/Array). */
function plain(v, path = "slot", seen = new Set()) {
  if (v === null || typeof v !== "object") {
    assert.notEqual(typeof v, "function", `${path} is a function`);
    return;
  }
  if (seen.has(v)) return;
  seen.add(v);
  const proto = Object.getPrototypeOf(v);
  assert.ok(proto === null || proto === Object.prototype || proto === Array.prototype, `${path} is a ${proto && proto.constructor && proto.constructor.name}`);
  for (const k of Object.keys(v)) plain(v[k], `${path}.${k}`, seen);
}

test("the slot is plain data at Symbol.for(\"creaseworks/live\")", async () => {
  w = win({ agents: [agent(1)], terminals: [term(1)] });
  await w.copy("panel");
  await w.copy("ribbon");
  await w.advance(3000);
  assert.ok(globalThis[SLOT_KEY] === w.slot);
  assert.equal(SLOT_KEY, Symbol.for("creaseworks/live"));
  plain(w.slot);
  assert.equal(typeof w.slot.writerId, "string");
  assert.ok(w.slot.writerId.length >= 8);
});

test("hot reload adopts the slot: same writer, no disk read, no rollback", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.copy("ribbon");
  await w.advance(1000);
  await w.hits(v, 5);
  const before = { writer: w.slot.writerId, hits: w.slot.state.stats.hits, bank: w.slot.state.bank, seq: w.slot.seq };
  const reads = w.ctl.log.filter((e) => e.type === "read").length;
  await w.reload();
  assert.equal(w.ctl.log.filter((e) => e.type === "read").length, reads, "no disk read on reload");
  assert.equal(w.slot.writerId, before.writer);
  assert.equal(w.slot.state.stats.hits, before.hits);
  assert.ok(w.slot.state.bank >= before.bank);
  await w.hits(w.copies[0], 1);
  assert.equal(w.slot.seq, before.seq + 1, "seq continues");
  await w.advance(2000);
  assert.ok(w.slot.ticker.startsWith("panel:") || w.slot.ticker.startsWith("ribbon:"));
  assert.ok(w.copies.some((c) => c.session.copyId === w.slot.ticker), "a new-generation copy ticks at once");
  await w.advance(16000);
  assert.equal(parsed(w.ctl).state.stats.hits, before.hits + 1);
});

for (const variant of [
  { name: "the old write landed", latency: { write: 200, read: 400 }, cas: 0 },
  { name: "the old write lands after the new read", latency: { write: 600, read: 0 }, cas: 1 },
]) {
  test(`reload mid-write (${variant.name}): no rollback, no double count`, async () => {
    w = win({ latency: variant.latency });
    const v = await w.copy("panel");
    await w.advance(1500); // load + first save
    await w.hits(v, 4);
    await w.handler(v, "buy", "paper-stack", 1); // urgent save in 2 s
    // Run to the moment the write is in flight.
    for (let i = 0; i < 40 && !w.slot.inflight; i++) await w.advance(100);
    assert.ok(w.slot.inflight, "a write is under way");
    const hits = w.slot.state.stats.hits;
    await w.advance(100);
    await w.reload(); // the old generation's write never settles
    await w.hits(w.copies[0], 3);
    await w.advance(20000);
    const p = parsed(w.ctl);
    assert.ok(p.ok);
    assert.equal(p.state.stats.hits, hits + 3, "every hit once");
    assert.equal(w.slot.state.stats.hits, hits + 3, "no rollback in memory");
    assert.equal(w.slot.inflight, null);
    assert.equal(w.ctl.writes.filter((x) => !x.ok).length, variant.cas, variant.cas ? "a CAS merge with its own landed write" : "adopted as base");
    assert.ok(!w.slot.notice || w.slot.notice.kind !== "merged", "a reload is not \"another window\"");
  });
}

test("two copies: one ticker, one writer, one observation per change", async () => {
  w = win({ agents: [agent(1), agent(2, "blocked")], terminals: [term(1), term(2, "blocked")] });
  const panel = await w.copy("panel");
  const ribbon = await w.copy("ribbon");
  await w.advance(20000);
  const tickers = [panel, ribbon].filter((c) => c.session.copyId === w.slot.ticker);
  assert.equal(tickers.length, 1);
  assert.equal(Object.keys(w.slot.copies).length, 2);
  assert.equal(w.ctl.writes.filter((x) => !x.ok).length, 0, "no write ever races another");
  const counts = w.ctl.counts;
  assert.ok(counts.agents <= 21 && counts.terminals <= 21, `agents() ${counts.agents}× in 20 s: once per tick, ticker only`);
  assert.equal(counts.panes ?? 0, 0, "never panes()");
  // One observe for the roster (nothing changed since).
  const obs = engine.parseSave(w.ctl.readFile(SAVE)).state;
  assert.equal(Object.keys(obs.helpers).length, 2);
  // The ticker goes away: the other copy claims after 5 s.
  const gone = tickers[0];
  const other = gone === panel ? ribbon : panel;
  w.ctl.closeOwner(gone);
  await w.advance(7000);
  assert.equal(w.slot.ticker, other.session.copyId);
});

test("close(cx) from the ticker starts the final write at once", async () => {
  w = win();
  const v = await w.copy("panel");
  const r = await w.copy("ribbon");
  await w.advance(1000);
  await w.hits(v, 3);
  const ticker = [v, r].find((c) => c.session.copyId === w.slot.ticker);
  const other = ticker === v ? r : v;
  const writes = w.ctl.writes.length;
  const p1 = w.ctl.within("event", other, (cx) => other.close(cx));
  assert.equal(p1, null, "a non-ticker copy does not write");
  w.ctl.within("event", ticker, (cx) => ticker.close(cx));
  await w.advance(200);
  assert.ok(w.ctl.writes.length > writes, "written within the 250 ms close budget");
  assert.equal(parsed(w.ctl).state.stats.hits, 3);
});

test("a hidden window ticks every 5 s; a visible one every second", async () => {
  w = win();
  await w.copy("panel");
  await w.advance(1000);
  const timers = () => w.ctl.pendingTasks().filter((t) => t.kind === "timer");
  assert.equal(timers().length, 1);
  w.ctl.setWindow({ visible: false });
  await w.advance(1000);
  assert.equal(timers().length, 1, "one data timer per copy");
  const due0 = timers()[0].due;
  assert.equal(due0 - Date.now() > 1000, true, "re-registered at 5000 ms");
  const ticks = w.ctl.counts.window;
  await w.advance(20000);
  assert.ok(w.ctl.counts.window - ticks <= 5, "≤ 1 tick per 5 s while hidden");
  assert.equal(w.slot.state.presence.visible, false, "the engine knows (spawns do not advance unseen)");
  w.ctl.setWindow({ visible: true });
  await w.advance(6000);
  assert.ok(timers()[0].due - Date.now() <= 1000);
});

test("checking(): a static demo, no timers, writes or run", async () => {
  w = win({ checking: true, window: null });
  const v = await w.copy("panel");
  await w.advance(5000);
  assert.equal(w.ctl.pendingTasks().length, 0);
  assert.equal(w.ctl.writes.length, 0);
  assert.equal(w.ctl.runs.length, 0);
  assert.equal(w.slot, null, "the demo never installs the slot");
  const vm = v.session.vm();
  assert.equal(vm.header.folds, "12.4K");
  assert.equal(vm.header.counts.needs, 1);
  assert.equal(vm.header.counts.working, 1);
  assert.equal(vm.header.counts.resting, 1);
  assert.equal(vm.tray.envelopes.length + vm.tray.more, 2);
  const { tree } = w.render(v);
  assert.equal(tree.id, "root");
  const r = await w.copy("ribbon");
  assert.equal(w.render(r).tree.id, "root");
});

// ---------------------------------------------------------------------------
// r1-01: herdr cancels the old generation's tasks without settling them, so a
// reload during ANY save step (not only the main write) must not leave
// save.writing held: saving goes on, the footer does not say "Saving…"
// forever, and close(cx) still writes.

/** Steps until `cond()` (≤ 100 × 50 ms). */
async function until(cond, what) {
  for (let i = 0; i < 100 && !cond(); i++) await w.advance(50);
  assert.ok(cond(), what);
}

async function savingGoesOn(hitsBefore) {
  assert.equal(w.slot.save.writing, null, "the old generation's claim is released at init");
  assert.notEqual(w.slot.save.status, "saving");
  await w.hits(w.copies[0], 2);
  await w.advance(20000);
  assert.equal(w.slot.save.writing, null);
  assert.equal(w.slot.save.status, "ok");
  assert.equal(parsed(w.ctl).state.stats.hits, hitsBefore + 2, "saved after the reload, nothing lost or doubled");
  assert.doesNotMatch(w.copies[0].session.ctx().save.text, /Saving/);
  // close(cx) from the ticker still starts its final write.
  await w.hits(w.copies[0], 1);
  const ticker = w.copies.find((c) => c.session.copyId === w.slot.ticker);
  const p = w.ctl.within("event", ticker, (cx) => ticker.close(cx));
  assert.notEqual(p, null, "close(cx) writes");
  await w.advance(1000);
  assert.equal(parsed(w.ctl).state.stats.hits, hitsBefore + 3);
}

test("r1-01: reload during the backup rotation", async () => {
  w = win({ latency: { write: 300, read: 0 } });
  const v = await w.copy("panel");
  await w.copy("ribbon");
  await w.advance(3000);
  await w.hits(v, 3);
  await w.handler(v, "buy", "paper-stack", 1);
  await until(() => w.slot.save.writing !== null && !w.slot.inflight, "the backup write is under way (no main write yet)");
  const hits = w.slot.state.stats.hits;
  await w.reload();
  await savingGoesOn(hits);
});

test("r1-01: reload during the merge read after a CAS rejection", async () => {
  w = win({ latency: { write: 0, read: 400 } });
  const v = await w.copy("panel");
  await w.advance(3000);
  const disk = engine.parseSave(w.ctl.readFile(SAVE)).state;
  for (let i = 1; i <= 3; i++) engine.apply(disk, { w: "B", s: i, t: Date.now() + i * 300, type: "click", target: "sheet" });
  w.ctl.externalWrite(SAVE, engine.serialize(disk));
  await w.hits(v, 2);
  await w.handler(v, "buy", "paper-stack", 1);
  await until(() => w.slot.save.writing !== null && w.slot.notice && w.slot.notice.kind === "conflict", "the merge read is under way");
  assert.equal(w.slot.inflight, null);
  await w.reload();
  await savingGoesOn(5);
  assert.equal(parsed(w.ctl).state.applied.B, 3, "the other writer's hits merged once");
});

test("r1-01: reload during a Settings save tool (check save now)", async () => {
  w = win({ latency: { read: 400 } });
  const v = await w.copy("panel");
  await w.advance(3000);
  await w.hits(v, 1);
  await w.handler(v, "checkSave");
  assert.notEqual(w.slot.save.writing, null, "the check holds the claim");
  await w.reload();
  await savingGoesOn(1);
});

test("r1-01: a second panel opened in the same code generation keeps a live claim (Reset goes through)", async () => {
  w = win({ latency: { write: 400, read: 0 } });
  const v = await w.copy("panel");
  await w.advance(3000);
  await w.hits(v, 5);
  await w.advance(18000);
  assert.equal(parsed(w.ctl).state.stats.hits, 5);
  w.slot.flash = null;
  await w.handler(v, "resetGame");
  for (let i = 0; i < 5; i++) await w.advance(50);
  const claim = w.slot.save.writing;
  assert.notEqual(claim, null, "the reset holds the claim (keeping the old save aside)");
  await w.copy("panel"); // the layout opened twice: same generation, and the first panel stays open
  assert.equal(w.slot.save.writing, claim, "the claim is kept: its task is still running");
  await w.advance(3000);
  assert.match(w.slot.flash && w.slot.flash.text, /Started a new game\. The old save was kept as save\.damaged-1\.json\./);
  assert.equal(w.slot.state.stats.hits, 0);
  await w.advance(20000);
  assert.equal(parsed(w.ctl).state.stats.hits, 0, "the reset is saved");
  assert.equal(engine.parseSave(w.ctl.readFile(SAVE.replace(/\.json$/, ".damaged-1.json"))).state.stats.hits, 5);
});

test("r1-01: a claim made by an older code generation is released by the next init", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.advance(3000);
  await w.hits(v, 2);
  Object.assign(w.slot.save, { writing: 99, writingBy: null, writingGen: "an-older-build", writingAt: Date.now(), status: "saving" });
  await w.copy("ribbon"); // herdr re-evaluates the modules on a reload: a new token
  assert.equal(w.slot.save.writing, null);
  await w.advance(4000);
  assert.equal(parsed(w.ctl).state.stats.hits, 2);
});

test("r1-01: a claim that never settles is released after WRITE_STALL_MS, with the save made due", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.advance(3000);
  await w.hits(v, 2);
  const { codeGeneration } = await import("../../mods/creaseworks/glue/live.js");
  const { WRITE_STALL_MS } = await import("../../mods/creaseworks/glue/store.js");
  Object.assign(w.slot.save, { writing: 99, writingBy: v.session.copyId, writingFor: "check", writingGen: codeGeneration(), writingAt: Date.now(), status: "saving" });
  await w.advance(WRITE_STALL_MS - 5000);
  assert.equal(parsed(w.ctl).state.stats.hits, 0, "a live-looking claim is waited for");
  await w.advance(10000);
  assert.equal(w.slot.save.writing, null);
  assert.equal(parsed(w.ctl).state.stats.hits, 2);
  // r2-03: never silent (a Settings save tool may not have finished): said until dismissed.
  assert.equal(w.slot.notice && w.slot.notice.kind, "recovered");
  assert.match(w.slot.notice.text, /A save step stopped before finishing; saving again/);
});

test("r2-06 review: a plain save cycle that stalls is released with a short flash, no lasting notice", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.advance(3000);
  await w.hits(v, 2);
  const { codeGeneration } = await import("../../mods/creaseworks/glue/live.js");
  const { WRITE_STALL_MS } = await import("../../mods/creaseworks/glue/store.js");
  Object.assign(w.slot.save, { writing: 99, writingBy: v.session.copyId, writingFor: "cycle", writingGen: codeGeneration(), writingAt: Date.now(), status: "saving" });
  let flashed = null;
  for (let ms = 0; ms < WRITE_STALL_MS + 5000 && w.slot.save.writing === 99; ms += 1000) {
    await w.advance(1000);
    if (w.slot.flash) flashed = w.slot.flash.text;
  }
  assert.equal(w.slot.save.writing === 99, false, "released");
  assert.match(String(flashed), /A save step stalled; saving again/);
  await w.advance(5000);
  assert.equal(parsed(w.ctl).state.stats.hits, 2, "saved again, nothing lost");
  assert.equal(w.slot.notice, null, "nothing to dismiss: a plain save lost nothing");
});

test("r2-06 review: the panel closing during an ordinary background save is not a lasting alarm", async () => {
  const { ORPHAN_MS } = await import("../../mods/creaseworks/glue/store.js");
  w = win({ latency: { write: 400, read: 0 } });
  const panel = await w.copy("panel");
  const ribbon = await w.copy("ribbon");
  await w.advance(3000);
  await w.hits(panel, 5);
  for (let i = 0; i < 400 && w.slot.save.writing === null; i++) await w.advance(50);
  assert.notEqual(w.slot.save.writing, null, "a background save is under way");
  assert.equal(w.slot.save.writingFor, "cycle");
  assert.equal(w.slot.save.writingBy, panel.session.copyId);
  await w.ctl.closeView(panel);
  assert.notEqual(w.slot.save.writing, null, "the closed copy's save task was cancelled: its claim is orphaned");
  await w.advance(ORPHAN_MS + 5000);
  assert.equal(w.slot.save.writing, null, "the orphaned claim was released");
  assert.equal(w.slot.notice, null, `no notice for an ordinary close (${JSON.stringify(w.slot.notice)})`);
  assert.equal(parsed(w.ctl).state.stats.hits, 5, "every hit on disk");
  assert.equal(w.slot.save.status, "ok");
  assert.match(ribbon.session.ctx().save.text, /Saved/);
});

test("r2-06: a copy closed during its Reset: herdr cancels the copy's owner:null tasks, and the claim is released and said", async () => {
  const { ORPHAN_MS, WRITE_STALL_MS } = await import("../../mods/creaseworks/glue/store.js");
  w = win({ latency: { write: 400, read: 0 } });
  const panel = await w.copy("panel");
  const ribbon = await w.copy("ribbon");
  await w.advance(3000);
  await w.hits(panel, 5);
  await w.advance(18000);
  assert.equal(parsed(w.ctl).state.stats.hits, 5);
  await w.handler(panel, "resetGame");
  for (let i = 0; i < 5; i++) await w.advance(50);
  assert.notEqual(w.slot.save.writing, null, "the reset holds the claim (keeping the old save aside)");
  assert.equal(w.slot.save.writingBy, panel.session.copyId);
  // The panel closes (layout.hide, the window's panel closed): herdr releases its
  // application generation, which cancels the Reset task although it is owner: null.
  await w.ctl.closeView(panel);
  assert.ok(w.ctl.deadApps.size >= 1);
  const left = w.ctl.pendingTasks().filter((t) => t.app === w.ctl.appOf(panel, false));
  assert.ok(left.every((t) => t.kind === "host" && t.fn === "writeTextFile"), `every task of the closed copy stopped; only a write already started lands, unanswered (${JSON.stringify(left)})`);
  assert.notEqual(w.slot.save.writing, null, "nothing settles the claim");
  await w.advance(ORPHAN_MS + 2000);
  assert.ok(ORPHAN_MS + 2500 < WRITE_STALL_MS);
  assert.equal(w.slot.save.writing, null, "released once its copy stayed gone, long before WRITE_STALL_MS");
  // Never silent: said until dismissed (the Reset did not take effect).
  const n = w.slot.notice;
  assert.ok(n && n.kind === "recovered" && /cut off when a Creaseworks view closed/.test(n.text), JSON.stringify(n));
  assert.match(ribbon.session.ctx().save.text, /Saved/);
  await w.advance(5000);
  assert.equal(w.slot.save.status, "ok");
  assert.equal(w.slot.notice, n, "still shown after the next save");
  assert.equal(parsed(w.ctl).state.stats.hits, w.slot.state.stats.hits, "the game in memory is on disk");
});

test("r2-06: a copy only taken over by a newly opened one keeps its claim (it beats again)", async () => {
  const { ORPHAN_MS } = await import("../../mods/creaseworks/glue/store.js");
  w = win();
  const v = await w.copy("panel");
  await w.advance(3000);
  await w.hits(v, 2);
  const { codeGeneration } = await import("../../mods/creaseworks/glue/live.js");
  // A long-running claim of the first panel (e.g. a slow disk), still alive.
  Object.assign(w.slot.save, { writing: 99, writingBy: v.session.copyId, writingGen: codeGeneration(), writingAt: Date.now(), status: "saving" });
  await w.copy("panel"); // takeOver drops the first panel's entry; it beats again on its next tick
  assert.equal(w.slot.save.writing, 99);
  await w.advance(ORPHAN_MS + 5000);
  assert.equal(w.slot.save.writing, 99, "a copy that is still open is not an orphan");
  assert.equal(w.slot.notice, null);
});

test("r2-06: closeView gives close(cx) its 250 ms, then releases the copy (its final write lands)", async () => {
  w = win();
  const v = await w.copy("panel");
  await w.advance(3000);
  await w.hits(v, 3);
  const settled = await w.ctl.closeView(v);
  assert.equal(settled, true, "the final write settled inside the deadline");
  assert.equal(parsed(w.ctl).state.stats.hits, 3);
  assert.equal(w.slot.save.writing, null);
  assert.deepEqual(w.ctl.errors, []);
});

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

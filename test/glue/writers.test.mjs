// Two windows on one save (DESIGN §6.1, §11.2, §12.5; ARCHITECTURE A5): two
// writers (two slots, one shared file) merging through the real store; a
// finished task's envelope exists once whichever window saw it; the
// notification cap (3 a day) holds across writers; notifications are opt-in,
// quiet while the panel is shown in an active window, held (not claimed or
// counted) while the window is hidden or inactive (r6-02), and never for agent
// status; a lasting save problem notifies once and shows a hidden ribbon.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { win, SAVE, parsed, agent, term, engine, HOME } from "./_util.mjs";
import { newSlot, dispatch, COALESCE_AT, COALESCE_HELPERS, PENDING_MAX, LOG_HELPERS_MAX } from "../../mods/creaseworks/glue/live.js";
import * as store from "../../mods/creaseworks/glue/store.js";
import * as notifier from "../../mods/creaseworks/glue/notify.js";
import { localDay } from "../../mods/creaseworks/glue/clock.js";

let w;
afterEach(() => w && w.dispose());

/** Runs async host work in a task scope and settles it (virtual clock). */
async function hostWork(ctl, fn) {
  let p;
  await ctl.dispatch("task", null, () => {
    p = fn();
  });
  await ctl.flush();
  return p;
}

/** A second window's writer: its own slot on the same save file. */
function writerSlot(ctl, text, id) {
  const slot = newSlot(HOME, store.slotPaths(HOME));
  slot.writerId = id;
  const p = engine.parseSave(text);
  slot.state = p.state;
  slot.baseText = text;
  slot.save.baseOk = true;
  return slot;
}

const env = { now: () => Date.now() };
const obs = (turn, status = "working") => [{ addr: "t1", created: 5, status, raw: status, turn, parent: null, pane: "p1", title: "x", paneName: "", space: "s", tab: "1", kind: "pane" }];
const observe = (slot, t, turn) => dispatch(slot, { type: "observe", helpers: obs(turn), visible: true, active: true, matShown: true, day: localDay(t) }, t);

test("a turn delta becomes one envelope across two writers", async () => {
  w = win();
  const base = engine.newGame({ seed: 9, now: Date.now(), day: localDay(Date.now()) });
  w.ctl.externalWrite(SAVE, engine.serialize(base));
  const A = writerSlot(w.ctl, w.ctl.readFile(SAVE), "wA");
  const B = writerSlot(w.ctl, w.ctl.readFile(SAVE), "wB");
  const t = Date.now();
  // Both windows see the same terminal finish a task (same address, same created_ms).
  observe(A, t + 1000, 0);
  observe(B, t + 1200, 0);
  observe(A, t + 61000, 1);
  observe(B, t + 61500, 1);
  assert.equal(Object.keys(A.state.envelopes).length, 1);
  assert.equal(Object.keys(B.state.envelopes).length, 1);
  w.ctl.setNow(t + 62000);
  assert.equal(await hostWork(w.ctl, () => store.cycle(A, env)), true);
  assert.equal(await hostWork(w.ctl, () => store.cycle(B, env)), true, "B merges A's save and writes");
  const p = parsed(w.ctl);
  assert.equal(Object.keys(p.state.envelopes).length, 1, "one drop per (helperId, turn)");
  const h = Object.values(p.state.helpers)[0];
  assert.equal(h.stats.tasks, 1);
  assert.equal(p.state.stats.tasks, 1);
  assert.equal(p.state.applied.wA, A.seq);
  assert.equal(p.state.applied.wB, B.seq);
  // And again in the other order, after another finish.
  observe(B, t + 130000, 2);
  observe(A, t + 131000, 2);
  w.ctl.setNow(t + 132000);
  await hostWork(w.ctl, () => store.cycle(B, env));
  await hostWork(w.ctl, () => store.cycle(A, env));
  const q = parsed(w.ctl);
  assert.equal(Object.values(q.state.helpers)[0].stats.tasks, 2);
  assert.ok(Object.keys(q.state.envelopes).length === 1, "stacked into the one envelope or opened, never two drops");
});

test("the notification cap (3 a day) holds across two writers", async () => {
  w = win();
  const t = Date.now();
  const day = localDay(t);
  const base = engine.newGame({ seed: 4, now: t, day });
  base.lifetime = 7e9; // a wish is available: "Your string is full"
  base.settings.notify.master = true;
  base.notify.day = day;
  base.notify.sent = 2;
  w.ctl.externalWrite(SAVE, engine.serialize(base));
  const A = writerSlot(w.ctl, w.ctl.readFile(SAVE), "wA");
  const B = writerSlot(w.ctl, w.ctl.readFile(SAVE), "wB");
  const nenv = { day, quiet: false, layout: { known: false } };
  const save = () => {};
  assert.equal(notifier.check(A, t, nenv, save), "claimed");
  assert.equal(notifier.check(B, t, nenv, save), "claimed");
  assert.equal(w.ctl.notifications.length, 0, "nothing is sent before the claim is saved");
  await hostWork(w.ctl, () => store.cycle(A, env));
  assert.equal(notifier.check(A, t + 1000, nenv, save), "sent");
  await hostWork(w.ctl, () => store.cycle(B, env)); // merges: sent 3 + B's claim = 4
  assert.equal(notifier.check(B, t + 1000, nenv, save), "capped");
  assert.equal(w.ctl.notifications.length, 1, "the third of the day, once");
  const n = w.ctl.notifications[0].notification;
  assert.equal(n.title, "Your string is full");
  assert.equal(n.level, "info");
  assert.equal(n.timeout, 6000);
  assert.equal(n.icon, "mods/creaseworks/art/notify-icon.svg");
  // A click shows and unfolds the panel through the mod's own command (r3-06: layout.show left a folded panel on the rail).
  assert.deepEqual(n.action, { name: "creaseworks.show", args: {} });
  assert.equal(w.ctl.recorded.playSound.length, 0, "never sound");
  // Day is full now for both.
  assert.equal(notifier.wanted(A, t + 2000, nenv), null);
  assert.equal(notifier.wanted(B, t + 2000, nenv), null);
  assert.equal(parsed(w.ctl).state.notify.sent, 4);
});

test("opt-in, quiet while the panel shows in an active window, never for agent status", async () => {
  w = win({ agents: [agent(1), agent(2)], terminals: [term(1), term(2)] });
  const panel = await w.copy("panel");
  await w.advance(2000);
  // Agents need you and finish, master off: nothing.
  w.ctl.setAgents([agent(1, "blocked"), agent(2, "done")]);
  w.ctl.setTerminals([term(1, "blocked"), term(2, "idle", { turn: 1 })]);
  await w.advance(5000);
  await w.handler(panel, "setting", "notify.master", true);
  await w.advance(60000);
  assert.equal(w.ctl.notifications.length, 0, "never for needs-you or finished (herdr does that)");
  // A wish becomes available while the panel is shown and the window active: quiet.
  w.slot.state.lifetime = 7e9;
  await w.advance(5000);
  assert.equal(w.ctl.notifications.length, 0, "quiet while the panel is shown and the window is active");
  // r6-02: herdr's toast is drawn in the window and expires on the wall clock,
  // so while the window is inactive or hidden nothing is claimed, counted or sent.
  for (const away of [{ active: false }, { active: false, visible: false }, { active: true, visible: false }]) {
    w.ctl.setWindow(away);
    await w.advance(30000);
    assert.equal(w.ctl.notifications.length, 0, `held while away: ${JSON.stringify(away)}`);
  }
  assert.equal(w.slot.state.notify.firedFull, false, "the once-per-run wish notice is not used up unseen");
  assert.equal(notifier.sentOn(w.slot.state, localDay(Date.now())), 0, "and no daily slot is counted");
  // Back and active with the panel shown: still quiet (the game is in view).
  w.ctl.setWindow({ active: true, visible: true });
  await w.advance(5000);
  assert.equal(w.ctl.notifications.length, 0);
  // Active with the panel hidden: the held notification is sent now, where it can be seen.
  w.ctl.layoutValue = { id: "root", children: [{ id: "cw-panel", hidden: true }, { id: "cw-ribbon" }] };
  await w.advance(5000);
  assert.equal(w.ctl.notifications.length, 1);
  assert.equal(w.ctl.notifications[0].notification.title, "Your string is full");
  await w.advance(60000);
  assert.equal(w.ctl.notifications.length, 1, "once per run");
  assert.equal(panel.session.vm().settings.notifySentToday, 1);
});

test("r6-02: a claim confirmed after the window went away is sent once it is active again, not into an unseen toast", async () => {
  w = win();
  const t = Date.now();
  const day = localDay(t);
  const base = engine.newGame({ seed: 4, now: t, day });
  base.lifetime = 7e9;
  base.settings.notify.master = true;
  w.ctl.externalWrite(SAVE, engine.serialize(base));
  const A = writerSlot(w.ctl, w.ctl.readFile(SAVE), "wA");
  const here = { day, quiet: false, away: false, layout: { known: false } };
  const away = { ...here, away: true };
  assert.equal(notifier.wanted(A, t, away), null, "nothing is wanted while away");
  assert.equal(notifier.check(A, t, away, () => {}), null, "nor claimed");
  assert.equal(A.state.notify.firedFull, false);
  assert.equal(notifier.check(A, t, here, () => {}), "claimed");
  await hostWork(w.ctl, () => store.cycle(A, env));
  assert.equal(notifier.check(A, t + 1000, away, () => {}), null, "confirmed, but the window is away: held");
  assert.equal(notifier.check(A, t + 20 * 60000, away, () => {}), null, "a confirmed claim is never given up while held");
  assert.equal(w.ctl.notifications.length, 0);
  assert.equal(notifier.check(A, t + 20 * 60000 + 1000, here, () => {}), "sent");
  assert.equal(w.ctl.notifications.length, 1);
  assert.equal(notifier.check(A, t + 20 * 60000 + 2000, here, () => {}), null, "sent once");
});

// r7-08: a held claim survives local midnight (claimed again under the new
// day's slots, never dropped as "capped"), and is held while quiet too.
function wishSlot(day, t, sent = 0) {
  const base = engine.newGame({ seed: 4, now: t, day });
  base.lifetime = 7e9;
  base.settings.notify.master = true;
  base.notify.day = day;
  base.notify.sent = sent;
  w.ctl.externalWrite(SAVE, engine.serialize(base));
  return writerSlot(w.ctl, w.ctl.readFile(SAVE), "wA");
}

test("r7-08: a wish notice held while away past local midnight is sent the next day, on that day's slots", async () => {
  w = win();
  const t = Date.now();
  const day1 = "2026-01-01";
  const day2 = "2026-01-02";
  const A = wishSlot(day1, t);
  const here = (day) => ({ day, quiet: false, away: false, layout: { known: false } });
  let saves = 0;
  const save = () => saves++;
  assert.equal(notifier.check(A, t, here(day1), save), "claimed");
  await hostWork(w.ctl, () => store.cycle(A, env));
  assert.equal(notifier.check(A, t + 1000, { ...here(day1), away: true }, save), null, "held while away");
  // Back after midnight: claimed again under day 2, not dropped.
  assert.equal(notifier.check(A, t + 2000, here(day2), save), "claimed", "claimed again on the new day");
  assert.equal(w.ctl.notifications.length, 0, "not before that claim is saved");
  assert.equal(A.notify.claim.day, day2);
  assert.ok(saves >= 2, "the new claim asks for a save");
  await hostWork(w.ctl, () => store.cycle(A, env));
  assert.equal(notifier.check(A, t + 3000, here(day2), save), "sent");
  assert.equal(w.ctl.notifications.length, 1);
  assert.equal(w.ctl.notifications[0].notification.title, "Your string is full");
  assert.equal(notifier.sentOn(A.state, day2), 1, "counted on the day it was sent");
  assert.equal(notifier.check(A, t + 4000, here(day2), save), null, "once");
  assert.equal(parsed(w.ctl).state.notify.day, day2);
});

test("r7-08: a held claim waits for a day with a free slot, and is dropped only when no longer wanted", async () => {
  w = win();
  const t = Date.now();
  const day1 = "2026-01-01";
  const A = wishSlot(day1, t);
  const here = (day) => ({ day, quiet: false, away: false, layout: { known: false } });
  assert.equal(notifier.check(A, t, here(day1), () => {}), "claimed");
  await hostWork(w.ctl, () => store.cycle(A, env));
  // Day 2 is already full (another window used its three slots).
  A.state.notify.day = "2026-01-02";
  A.state.notify.sent = 3;
  assert.equal(notifier.check(A, t + 1000, here("2026-01-02"), () => {}), null, "held: day 2 has no slot");
  assert.ok(A.notify.claim, "still held");
  assert.equal(notifier.check(A, t + 2000, here("2026-01-03"), () => {}), "claimed", "claimed on day 3");
  await hostWork(w.ctl, () => store.cycle(A, env));
  // The wish was made meanwhile: nothing stale is sent.
  A.state.lifetime = 0;
  assert.equal(engine.stringInfo(A.state).can, false);
  assert.equal(notifier.check(A, t + 3000, here("2026-01-03"), () => {}), null);
  assert.equal(A.notify.claim, null, "dropped: no longer wanted");
  assert.equal(w.ctl.notifications.length, 0);
});

test("r7-08: a confirmed claim is held while the panel is shown in an active window", async () => {
  w = win();
  const t = Date.now();
  const day = "2026-01-01";
  const A = wishSlot(day, t);
  const here = { day, quiet: false, away: false, layout: { known: false } };
  assert.equal(notifier.check(A, t, here, () => {}), "claimed");
  await hostWork(w.ctl, () => store.cycle(A, env));
  assert.equal(notifier.check(A, t + 1000, { ...here, quiet: true }, () => {}), null, "quiet: held");
  assert.equal(w.ctl.notifications.length, 0);
  assert.equal(notifier.check(A, t + 2000, here, () => {}), "sent", "sent once the panel is folded");
  assert.equal(w.ctl.notifications.length, 1);
});

test("a save problem lasting 5 min notifies once per episode; hidden ribbon and panel → ribbon shown once", async () => {
  const layout = { id: "root", children: [{ id: "cw-panel", hidden: true }, { id: "cw-ribbon", hidden: true }] };
  w = win({ layout });
  const panel = await w.copy("panel");
  await w.advance(2000);
  await w.handler(panel, "setting", "notify.master", true);
  for (let i = 0; i < 30; i++) w.ctl.failNextWrite("No space left on device (os error 28)", SAVE);
  await w.advance(3000);
  assert.equal(w.slot.notice.kind, "error");
  await w.advance(31000);
  const shows = w.ctl.runs.filter((r) => r.name === "layout.show" && r.args.id === "cw-ribbon");
  assert.equal(shows.length, 1, "the ribbon is shown instead of toasting");
  await w.advance(5 * 60000);
  const saves = w.ctl.notifications.filter((n) => n.notification.title === "Creaseworks can't save");
  assert.equal(saves.length, 1);
  await w.advance(10 * 60000);
  assert.equal(w.ctl.notifications.filter((n) => n.notification.title === "Creaseworks can't save").length, 1, "once per episode");
  assert.equal(w.ctl.runs.filter((r) => r.name === "layout.show" && r.args.id === "cw-ribbon").length, 1);
});

// ---------------------------------------------------------------------------
// r1-05: the unconfirmed-action log stays bounded while saves cannot land, and
// a long backlog is merged in task slices (cx.sleep(0)), never in one step.

const click = (slot, t) => dispatch(slot, { type: "click", target: "sheet" }, t);

test("r1-05: a read-only game records no unconfirmed actions", async () => {
  w = win();
  w.ctl.externalWrite(SAVE, engine.serialize(engine.newGame({ seed: 3, now: Date.now(), day: localDay(Date.now()) })));
  const A = writerSlot(w.ctl, w.ctl.readFile(SAVE), "wA");
  A.readOnly = true;
  const t = Date.now();
  for (let i = 0; i < 500; i++) click(A, t + i * 100);
  assert.equal(A.pending.length, 0);
  assert.equal(A.seq, 500, "actions still apply to the live game");
});

/** The agent rewards of a state: finished tasks, reward units, envelopes on the mat. */
const rewards = (st) => ({ tasks: st.stats.tasks, units: { ...st.stats.units }, envelopes: Object.keys(st.envelopes).length });

/** The live game of `slot` moved to `now` (what a merge onto an unchanged file must give). */
function liveAt(slot, now) {
  const st = engine.parseSave(engine.serialize(slot.state)).state;
  engine.advance(st, now, slot.writerId);
  return st;
}

/** Another writer (wB) adds one click to the file on disk. */
function otherWriterSaves(ctl, t) {
  const other = engine.parseSave(ctl.readFile(SAVE)).state;
  engine.apply(other, { w: "wB", s: 1, t, type: "click", target: "sheet" });
  const text = engine.serialize(other);
  ctl.externalWrite(SAVE, text);
  return text;
}

test("r1-05: turn counters are never coalesced: a merge after a long backlog keeps every finished task", async () => {
  // engine/helpers.js observe pays at most one finish per observation, so an
  // observation that moves a turn counter must stay in the log.
  w = win();
  w.ctl.externalWrite(SAVE, engine.serialize(engine.newGame({ seed: 4, now: Date.now(), day: localDay(Date.now()) })));
  const A = writerSlot(w.ctl, w.ctl.readFile(SAVE), "wA");
  const t = Date.now();
  observe(A, t + 100, 0); // the observation that introduces the agent
  for (let i = 0; i < COALESCE_AT; i++) click(A, t + 1000 + i * 100);
  for (let k = 1; k <= 20; k++) observe(A, t + 60000 + k * 120000, k);
  const rosters = A.pending.filter((a) => a.type === "observe" && Array.isArray(a.helpers));
  assert.equal(rosters.length, 21, "every observation that moves a turn counter (or adds the agent) stays");
  const end = t + 60000 + 21 * 120000;
  const want = rewards(liveAt(A, end));
  assert.equal(want.tasks, 20);
  assert.ok(want.units.created > 0 && want.envelopes > 0, JSON.stringify(want));
  otherWriterSaves(w.ctl, t + 500);
  w.ctl.setNow(end);
  assert.equal(await hostWork(w.ctl, () => store.cycle(A, env)), true);
  const disk = parsed(w.ctl).state;
  assert.equal(disk.applied.wA, A.seq, "the whole backlog reached the disk");
  assert.equal(disk.applied.wB, 1, "and the other writer's click");
  assert.deepEqual(rewards(disk), want, "every finished task, reward unit and envelope on disk");
  assert.deepEqual(rewards(A.state), want, "and in memory: no rollback");
});

test("r1-05: an observation that changes nothing the engine keeps coalesces; status changes stay", async () => {
  w = win();
  w.ctl.externalWrite(SAVE, engine.serialize(engine.newGame({ seed: 4, now: Date.now(), day: localDay(Date.now()) })));
  const A = writerSlot(w.ctl, w.ctl.readFile(SAVE), "wA");
  const t = Date.now();
  const look = (tt, turn, status, title) =>
    dispatch(A, { type: "observe", helpers: obs(turn, status).map((o) => ({ ...o, title })), visible: true, active: true, matShown: true, day: localDay(t) }, tt);
  look(t + 100, 0, "working", "start");
  for (let i = 0; i < COALESCE_AT; i++) click(A, t + 1000 + i * 100);
  // 50 title changes, then a turn bump, a status change and 50 more title changes
  for (let k = 0; k < 50; k++) look(t + 60000 + k * 1000, 0, "working", `title ${k}`);
  look(t + 120000, 1, "working", "done one");
  look(t + 121000, 1, "blocked", "asks");
  for (let k = 0; k < 50; k++) look(t + 130000 + k * 1000, 1, "blocked", `asks ${k}`);
  const rosters = A.pending.filter((a) => a.type === "observe" && Array.isArray(a.helpers));
  assert.ok(rosters.length <= 7, `title-only observations coalesce (${rosters.length} of 103 kept)`);
  assert.deepEqual(rosters.map((a) => `${a.helpers[0].turn}:${a.helpers[0].status}`).filter((x, i, xs) => xs.indexOf(x) === i), ["0:working", "1:working", "1:blocked"], "every turn and status change kept");
  assert.equal(rosters[rosters.length - 1].helpers[0].title, "asks 49", "the latest observation is kept");
  assert.ok(A.pending.every((a, i) => i === 0 || a.s > A.pending[i - 1].s), "still in order");
  const end = t + 200000;
  const live = liveAt(A, end);
  otherWriterSaves(w.ctl, t + 500);
  w.ctl.setNow(end);
  assert.equal(await hostWork(w.ctl, () => store.cycle(A, env)), true);
  const disk = parsed(w.ctl).state;
  assert.deepEqual(rewards(disk), rewards(live));
  const h = Object.values(disk.helpers)[0];
  assert.equal(h.status, "blocked");
  assert.equal(h.title, "asks 49");
  assert.equal(h.joined, Object.values(live.helpers)[0].joined, "the observation that added the agent is kept");
});

test("r1-05: past PENDING_MAX the log is given up; the other window is told its saved progress was replaced", async () => {
  w = win();
  w.ctl.externalWrite(SAVE, engine.serialize(engine.newGame({ seed: 4, now: Date.now(), day: localDay(Date.now()) })));
  const A = writerSlot(w.ctl, w.ctl.readFile(SAVE), "wA");
  const B = writerSlot(w.ctl, w.ctl.readFile(SAVE), "wB");
  const t = Date.now();
  for (let i = 0; i <= PENDING_MAX; i++) click(A, t + i * 10);
  assert.ok(A.pending.length < COALESCE_AT, `given up (${A.pending.length})`);
  assert.equal(A.save.logLost, true);
  // B saved meanwhile: its file is kept aside (never merged against a lost log) and A's game is written.
  for (let i = 1; i <= 3; i++) click(B, t + i * 300);
  w.ctl.setNow(t + 210000);
  assert.equal(await hostWork(w.ctl, () => store.cycle(B, env)), true);
  const bText = w.ctl.readFile(SAVE);
  w.ctl.setNow(t + 220000);
  assert.equal(await hostWork(w.ctl, () => store.cycle(A, env)), true);
  assert.equal(parsed(w.ctl).state.applied.wA, A.seq, "this window's game on disk");
  assert.equal(w.ctl.readFile(`${SAVE.replace(/\.json$/, "")}.damaged-1.json`), bText, "the other writer's file kept aside");
  assert.equal(A.notice.kind, "recovered");
  assert.match(A.notice.text, /kept aside as save\.damaged-1\.json/);
  assert.equal(A.save.logLost, false);
  // B's next save merges onto A's file: its saved clicks left the game, and B says where they are.
  click(B, t + 230000);
  w.ctl.setNow(t + 231000);
  assert.equal(await hostWork(w.ctl, () => store.cycle(B, env)), true);
  assert.equal(B.notice.kind, "recovered");
  assert.match(B.notice.text, /Another window replaced the save.*kept in save\.damaged-1\.json/);
  assert.ok(B.save.damaged.includes("save.damaged-1.json"), "listed in Details");
  // Shown once: later merges are ordinary.
  store.dismiss(B, "recovered");
  click(A, t + 240000);
  w.ctl.setNow(t + 241000);
  await hostWork(w.ctl, () => store.cycle(A, env));
  click(B, t + 250000);
  w.ctl.setNow(t + 251000);
  assert.equal(await hostWork(w.ctl, () => store.cycle(B, env)), true);
  assert.notEqual(B.notice && B.notice.kind, "recovered");
});

test("r1-05: a Reset in another window is not a silent loss either", async () => {
  w = win();
  w.ctl.externalWrite(SAVE, engine.serialize(engine.newGame({ seed: 4, now: Date.now(), day: localDay(Date.now()) })));
  const A = writerSlot(w.ctl, w.ctl.readFile(SAVE), "wA");
  const B = writerSlot(w.ctl, w.ctl.readFile(SAVE), "wB");
  const t = Date.now();
  for (let i = 1; i <= 3; i++) click(B, t + i * 300);
  w.ctl.setNow(t + 5000);
  assert.equal(await hostWork(w.ctl, () => store.cycle(B, env)), true);
  const flashes = [];
  const envA = { now: () => Date.now(), seed: () => 7, flash: (x) => flashes.push(x) };
  assert.equal(await hostWork(w.ctl, () => store.resetGame(A, envA)), "ok");
  assert.match(flashes[0], /Started a new game\. The old save was kept as save\.damaged-1\.json/);
  assert.equal(await hostWork(w.ctl, () => store.cycle(A, env)), true);
  click(B, t + 9000);
  w.ctl.setNow(t + 10000);
  assert.equal(await hostWork(w.ctl, () => store.cycle(B, env)), true);
  assert.match(B.notice.text, /kept in save\.damaged-1\.json/);
  assert.equal(parsed(w.ctl).state.stats.hits, 1, "the reset holds; B's newer click joins it");
});

test("r1-05: a log given up while a merge yields is still replayed whole", async () => {
  w = win();
  w.ctl.externalWrite(SAVE, engine.serialize(engine.newGame({ seed: 5, now: Date.now(), day: localDay(Date.now()) })));
  const A = writerSlot(w.ctl, w.ctl.readFile(SAVE), "wA");
  const t = Date.now();
  const N = 2000;
  for (let i = 0; i < N; i++) click(A, t + i * 10);
  otherWriterSaves(w.ctl, t + 5);
  let sleeps = 0;
  let merging = 0;
  const sliced = {
    now: () => Date.now(),
    sleep: () => {
      sleeps += 1;
      // The merge yields after the read and after the parse (r2-03), then between
      // replay slices: during the first replay yield the log grows past
      // PENDING_MAX and is given up.
      if (A.notices.write && A.notices.write.kind === "conflict") merging += 1;
      if (merging === 3) for (let i = 0; i <= PENDING_MAX - N + 5; i++) click(A, t + (N + i) * 10);
      return Promise.resolve();
    },
  };
  w.ctl.setNow(t + 300000);
  assert.equal(await hostWork(w.ctl, () => store.cycle(A, sliced)), true);
  assert.ok(merging >= 3, "the log was given up while the merge replayed it");
  const disk = parsed(w.ctl).state;
  assert.equal(disk.applied.wA, A.seq, "every action of this window");
  assert.equal(disk.applied.wB, 1, "merged, not overwritten: the other writer's click stays");
  assert.equal(A.save.logLost, false);
  assert.equal(w.ctl.readFile(`${SAVE.replace(/\.json$/, "")}.damaged-1.json`), null, "nothing kept aside");
});

test("r1-05: a long backlog merges in slices with a yield between them, nothing lost or doubled", async () => {
  w = win();
  w.ctl.externalWrite(SAVE, engine.serialize(engine.newGame({ seed: 5, now: Date.now(), day: localDay(Date.now()) })));
  const A = writerSlot(w.ctl, w.ctl.readFile(SAVE), "wA");
  const t = Date.now();
  const N = 2000;
  for (let i = 0; i < N; i++) click(A, t + i * 100);
  const B = engine.parseSave(w.ctl.readFile(SAVE)).state;
  for (let i = 1; i <= 3; i++) engine.apply(B, { w: "wB", s: i, t: t + i * 300, type: "click", target: "sheet" });
  w.ctl.externalWrite(SAVE, engine.serialize(B));
  let sleeps = 0;
  let joined = 0;
  const sliced = {
    now: () => Date.now(),
    sleep: () => {
      sleeps += 1;
      // A click while the merge yields joins the end of the log and is replayed too.
      if (sleeps === 2) {
        click(A, t + N * 100 + 50);
        joined += 1;
      }
      return Promise.resolve();
    },
  };
  w.ctl.setNow(t + N * 100 + 1000);
  assert.equal(await hostWork(w.ctl, () => store.cycle(A, sliced)), true);
  assert.ok(sleeps >= Math.floor(N / store.REPLAY_SLICE) - 1, `${sleeps} yields for ${N} actions`);
  const p = parsed(w.ctl).state;
  assert.equal(p.applied.wA, N + joined, "every action of this window once");
  assert.equal(p.applied.wB, 3);
  assert.equal(A.pending.length, 0);
});

test("r2-04: the unconfirmed log is bounded by size too: big rosters give it up long before PENDING_MAX", async () => {
  w = win();
  w.ctl.externalWrite(SAVE, engine.serialize(engine.newGame({ seed: 4, now: Date.now(), day: localDay(Date.now()) })));
  const A = writerSlot(w.ctl, w.ctl.readFile(SAVE), "wA");
  const t = Date.now();
  // 130 agents whose roster changes on every observation (a turn counter moves): none coalesce.
  const roster = (k) => {
    const list = [];
    for (let i = 1; i <= 130; i++) {
      const status = (i + k) % 3 ? "working" : "idle";
      list.push({ addr: `t${i}`, created: i, status, raw: status, turn: k, parent: null, pane: `p${i}`, title: `agent ${i} · ${k}`, paneName: "", space: "s", tab: "1", kind: "pane" });
    }
    return list;
  };
  const most = Math.floor(LOG_HELPERS_MAX / 130);
  let k = 0;
  for (; k < most; k++) dispatch(A, { type: "observe", helpers: roster(k), visible: true, active: true, matShown: true, day: localDay(t) }, t + k * 2500);
  assert.equal(A.save.logLost, false);
  assert.equal(A.pending.length, most);
  assert.equal(A.logHelpers, most * 130, "the log counts the helper entries it holds");
  dispatch(A, { type: "observe", helpers: roster(k), visible: true, active: true, matShown: true, day: localDay(t) }, t + k * 2500);
  assert.equal(A.save.logLost, true, `given up past ${LOG_HELPERS_MAX} helper entries (${most + 1} observations, not ${PENDING_MAX})`);
  assert.equal(A.pending.length, 0);
  assert.equal(A.logHelpers, 0);
  // The next save writes this window's game whole (as for PENDING_MAX), and the count follows the log.
  otherWriterSaves(w.ctl, t + 500);
  dispatch(A, { type: "observe", helpers: roster(k + 1), visible: true, active: true, matShown: true, day: localDay(t) }, t + (k + 1) * 2500);
  assert.equal(A.logHelpers, 130);
  w.ctl.setNow(t + (k + 2) * 2500);
  assert.equal(await hostWork(w.ctl, () => store.cycle(A, env)), true);
  assert.equal(parsed(w.ctl).state.applied.wA, A.seq, "this window's game on disk");
  assert.equal(A.pending.length, 0);
  assert.equal(A.logHelpers, 0, "a save that confirms the log empties the count");
  assert.equal(A.save.logLost, false);
});

test("r5-09: a big roster whose titles move coalesces by size, so failed saves keep the log (130 x 4 helpers)", () => {
  const A = newSlot(HOME, store.slotPaths(HOME));
  A.writerId = "wA";
  A.state = engine.newGame({ seed: 4, now: Date.now(), day: localDay(Date.now()) });
  const t = Date.now();
  const N = 650; // 130 agents with 4 sub-agents each
  const roster = (k, turn = 0) => {
    const list = [];
    for (let i = 1; i <= N; i++) {
      const kid = i > 130;
      list.push({ addr: `t${i}`, created: i, status: "working", raw: "working", turn, parent: kid ? `t${1 + (i % 130)}` : null,
        pane: kid ? null : `p${i}`, title: `agent ${i} · ${k}`, paneName: "", space: "s", tab: "1", kind: kid ? "kid" : "pane" });
    }
    return list;
  };
  const day = localDay(t);
  // One title-only observation a second for 20 minutes, no save landing: far past the
  // ~98 that reached LOG_HELPERS_MAX before (always under COALESCE_AT actions).
  const OBS = 1200;
  for (let k = 0; k < OBS; k++) {
    dispatch(A, { type: "observe", helpers: roster(k), visible: true, active: true, matShown: true, day }, t + k * 1000);
    assert.equal(A.save.logLost, false, `kept at observation ${k}`);
  }
  assert.ok(A.pending.length < COALESCE_AT, `under the count bound (${A.pending.length})`);
  assert.ok(A.logHelpers <= COALESCE_HELPERS + 2 * N, `bounded by size (${A.logHelpers})`);
  assert.ok(A.logHelpers < LOG_HELPERS_MAX);
  // A turn change is never coalesced away: it and the observation after it stay in the log.
  dispatch(A, { type: "observe", helpers: roster(OBS, 1), visible: true, active: true, matShown: true, day }, t + OBS * 1000);
  dispatch(A, { type: "observe", helpers: roster(OBS + 1, 1), visible: true, active: true, matShown: true, day }, t + (OBS + 1) * 1000);
  const rosters = A.pending.filter((a) => a.type === "observe" && Array.isArray(a.helpers));
  assert.ok(rosters.some((a) => a.helpers[0].turn === 1 && a.helpers[0].title === `agent 1 · ${OBS}`), "the turn change kept");
  assert.equal(A.logHelpers, rosters.length * N, "the size count matches the kept observations");
  assert.equal(A.save.logLost, false);
});

test("r2-04: coalesced observations leave the size count", () => {
  const A = newSlot(HOME, store.slotPaths(HOME));
  A.writerId = "wA";
  A.state = engine.newGame({ seed: 4, now: Date.now(), day: localDay(Date.now()) });
  const t = Date.now();
  for (let i = 0; i < COALESCE_AT; i++) click(A, t + i * 10);
  for (let k = 0; k < 40; k++) dispatch(A, { type: "observe", helpers: obs(0).map((o) => ({ ...o, title: `t${k}` })), visible: true, active: true, matShown: true, day: localDay(t) }, t + 10000 + k * 1000);
  const rosters = A.pending.filter((a) => a.type === "observe" && Array.isArray(a.helpers));
  assert.ok(rosters.length < 40);
  assert.equal(A.logHelpers, rosters.length, "one entry per kept observation of one agent");
});

test("r2-03: a CAS merge takes in, parses, replays and serialises in separate task steps", async () => {
  w = win();
  w.ctl.externalWrite(SAVE, engine.serialize(engine.newGame({ seed: 5, now: Date.now(), day: localDay(Date.now()) })));
  const A = writerSlot(w.ctl, w.ctl.readFile(SAVE), "wA");
  const t = Date.now();
  A.bakText = A.baseText; // no backup rotation in this cycle
  A.bakAt = t;
  click(A, t + 10);
  otherWriterSaves(w.ctl, t + 5);
  const seq = [];
  const claims = [];
  const calls = () => w.ctl.calls.filter((c) => c.fn === "readTextFile" || c.fn === "writeTextFile").length;
  const sliced = {
    now: () => Date.now(),
    sleep: () => {
      seq.push(`sleep@${calls()}`);
      claims.push(A.save.writing);
      return Promise.resolve();
    },
  };
  w.ctl.resetCounts();
  w.ctl.setNow(t + 1000);
  assert.equal(await hostWork(w.ctl, () => store.cycle(A, sliced)), true);
  const io = w.ctl.calls.filter((c) => c.fn === "readTextFile" || c.fn === "writeTextFile").map((c) => c.fn);
  assert.deepEqual(io, ["writeTextFile", "readTextFile", "writeTextFile"], "write, CAS, read, merged write");
  // Yields: before the first serialisation; after the read settles (before the parse);
  // after the parse (before replay and advance); before the merged serialisation.
  assert.deepEqual(seq, ["sleep@0", "sleep@2", "sleep@2", "sleep@2"]);
  assert.equal(claims[0], null, "the first yield comes before the claim (r2-03 review)");
  assert.equal(parsed(w.ctl).state.applied.wB, 1);
  assert.equal(parsed(w.ctl).state.applied.wA, A.seq);
});

test("r2-03 review: no claim is held across the yield before the first write, so a close in that gap still writes", async () => {
  w = win();
  w.ctl.externalWrite(SAVE, engine.serialize(engine.newGame({ seed: 5, now: Date.now(), day: localDay(Date.now()) })));
  const A = writerSlot(w.ctl, w.ctl.readFile(SAVE), "wA");
  const t = Date.now();
  A.bakText = A.baseText;
  A.bakAt = t;
  click(A, t + 10);
  let wake = null;
  const gate = { now: () => Date.now(), sleep: () => new Promise((r) => (wake = r)) };
  w.ctl.setNow(t + 1000);
  let first;
  await w.ctl.dispatch("task", null, () => {
    first = store.cycle(A, gate);
  });
  assert.equal(typeof wake, "function", "the cycle is yielding");
  assert.equal(A.save.writing, null, "no claim held while it yields (session.close skips its final write only while one is)");
  // session.close's final write, made in that gap, goes ahead.
  assert.equal(await hostWork(w.ctl, () => store.cycle(A, env)), true);
  assert.equal(parsed(w.ctl).state.applied.wA, A.seq);
  const before = w.ctl.readFile(SAVE);
  await w.ctl.dispatch("task", null, () => wake());
  await w.ctl.flush();
  assert.equal(await first, true, "the yielded cycle then saves as usual, onto the text just written");
  assert.equal(w.ctl.readFile(SAVE), before, "the same game, nothing doubled");
  assert.equal(A.notice, null);
  assert.equal(A.save.writing, null);
});

test("r4-09: a log given up while a write is out stays given up: the next conflict keeps the other file aside, nothing undone", async () => {
  w = win({ latency: { write: 500 } });
  const start = engine.newGame({ seed: 4, now: Date.now(), day: localDay(Date.now()) });
  start.bank = 1e12;
  start.lifetime = 1e12;
  w.ctl.externalWrite(SAVE, engine.serialize(start));
  const A = writerSlot(w.ctl, w.ctl.readFile(SAVE), "wA");
  const t = Date.now();
  for (let i = 0; i < PENDING_MAX - 1; i++) click(A, t + i);
  // A save goes out; while it is in flight three purchases pass PENDING_MAX.
  let p;
  await w.ctl.dispatch("task", null, () => {
    p = store.cycle(A, env);
  });
  await w.ctl.advance(600); // (the backup rotates first)
  assert.ok(A.inflight, "the write is out");
  for (let i = 0; i < 3; i++) dispatch(A, { type: "buy", item: "paper-stack", count: 1 }, Date.now());
  assert.equal(A.save.logLost, true);
  assert.equal(A.state.owned["paper-stack"], 3);
  await w.ctl.advance(1000);
  assert.equal(await p, true);
  assert.equal(parsed(w.ctl).state.owned["paper-stack"] || 0, 0, "the text written lacks the purchases");
  assert.equal(A.save.logLost, true, "so the log stays given up");
  // Another window writes the save before A's next save.
  const B = writerSlot(w.ctl, w.ctl.readFile(SAVE), "wB");
  click(B, Date.now());
  let q;
  await w.ctl.dispatch("task", null, () => {
    q = store.cycle(B, env);
  });
  await w.ctl.advance(1000);
  assert.equal(await q, true);
  const bText = w.ctl.readFile(SAVE);
  let r;
  await w.ctl.dispatch("task", null, () => {
    r = store.cycle(A, env);
  });
  await w.ctl.advance(3000);
  assert.equal(await r, true);
  assert.equal(A.state.owned["paper-stack"], 3, "no purchase undone");
  assert.equal(parsed(w.ctl).state.owned["paper-stack"], 3);
  assert.equal(w.ctl.readFile(`${SAVE.replace(/\.json$/, "")}.damaged-1.json`), bText, "the other window's file kept aside");
  assert.equal(A.notice && A.notice.kind, "recovered", "and said");
  assert.equal(A.save.logLost, false, "cleared by a write that holds the whole game");
});

test("r4-09: the recovery write keeps a log given up during it given up too", async () => {
  w = win({ latency: { write: 500 }, files: { [SAVE]: `{"pad":"${"x".repeat(1100000)}"}` } });
  const v = await w.copy("panel");
  await w.advance(3000);
  const A = w.slot;
  assert.ok(A.save.unreadable);
  const t = Date.now();
  for (let i = 0; i < PENDING_MAX - 1; i++) click(A, t + i);
  let p;
  await w.ctl.dispatch("task", null, () => {
    p = store.cycle(A, env);
  });
  await w.ctl.advance(100);
  assert.notEqual(A.save.writing, null, "the recovery write is out");
  for (let i = 0; i < 3; i++) click(A, Date.now());
  assert.equal(A.save.logLost, true);
  await w.ctl.advance(1000);
  assert.equal(await p, true);
  assert.equal(A.save.logLost, true);
  void v;
});

// Two windows on one save (DESIGN §6.1, §11.2, §12.5; ARCHITECTURE A5): two
// writers (two slots, one shared file) merging through the real store; a
// finished task's envelope exists once whichever window saw it; the
// notification cap (3 a day) holds across writers; notifications are opt-in,
// quiet while the panel is shown in an active window, and never for agent
// status; a lasting save problem notifies once and shows a hidden ribbon.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { win, SAVE, parsed, agent, term, engine, HOME } from "./_util.mjs";
import { newSlot, dispatch } from "../../mods/creaseworks/glue/live.js";
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
  assert.deepEqual(n.action, { name: "layout.show", args: { id: "cw-panel" } });
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
  w.ctl.setWindow({ active: false });
  await w.advance(5000);
  assert.equal(w.ctl.notifications.length, 1);
  assert.equal(w.ctl.notifications[0].notification.title, "Your string is full");
  await w.advance(60000);
  assert.equal(w.ctl.notifications.length, 1, "once per run");
  assert.equal(panel.session.vm().settings.notifySentToday, 1);
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

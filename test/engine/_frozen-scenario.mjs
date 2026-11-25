// Run by frozen.test.mjs in a child process under tools/node/frozen.mjs (the
// five prototypes frozen as in herdr's sandbox). Prints one JSON summary line.
import * as engine from "../../mods/creaseworks/engine/index.js";

const out = { frozen: Object.isFrozen(Object.prototype) && Object.isFrozen(Array.prototype) };
const T0 = Date.UTC(2026, 10, 25, 9);
const s = engine.newGame({ seed: 99, now: T0, day: "2026-11-25" });
let seq = 0;
const act = (w, a) => engine.apply(s, { w, s: ++seq, ...a });
const odd = ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty", "t1/../x", "peer/t7"];
const obs = (t, turn, status) => ({
  t, type: "observe", visible: true, active: true, matShown: true, day: "2026-11-25",
  helpers: odd.map((addr, i) => ({ addr, created: 1000 + i, status, raw: status, turn, parent: null, pane: `p${i}`, title: "🇯🇵 fix 👩🏽‍💻", paneName: addr, space: addr, tab: addr, kind: "pane" })),
});
act("__proto__", obs(T0, 0, "working"));
for (let i = 0; i < 400; i++) act("constructor", { t: T0 + 1000 + i * 500, type: "click", target: "sheet" });
act("__proto__", obs(T0 + 300000, 1, "idle"));
for (const id of Object.keys(s.envelopes)) act("toString", { t: T0 + 300001, type: "open", helperId: id });
s.bank += 1e7;
act("toString", { t: T0 + 300002, type: "buy", item: "paper-stack", count: "max" });
act("toString", { t: T0 + 300003, type: "setting", key: "notify.master", value: true });
act("toString", { t: T0 + 300004, type: "setting", key: "__proto__", value: true });
engine.advance(s, T0 + 20 * 3600000, "__proto__");
act("constructor", { t: T0 + 20 * 3600000 + 1, type: "collect" });
act("__proto__", obs(T0 + 20 * 3600000 + 2, 1, "idle")); // unchanged: no reward
act("__proto__", { t: T0 + 20 * 3600000 + 3, type: "observe", helpers: [], visible: true, active: true, matShown: true });
// r4-10: they come back in the same terminals and finish, leave, come back a
// minute later and finish again: the second finish draws on the budget the
// Album record kept (5/64 of a unit each), not a fresh one.
const T1 = T0 + 20 * 3600000;
act("__proto__", obs(T1 + 60000, 2, "idle"));
act("__proto__", { t: T1 + 60001, type: "observe", helpers: [], visible: true, active: true, matShown: true });
act("__proto__", obs(T1 + 120000, 3, "working"));
// r4-06: "__proto__" closes; "valueOf" stays open 4 h seeing none of them;
// then "__proto__" reopens 16 h on: the away segment pays only what is left of
// each helper's 8 h unseen allowance.
act("valueOf", { t: T1 + 121000, type: "observe", helpers: [], visible: true, active: true, matShown: true });
for (let t = T1 + 150000; t <= T1 + 120000 + 4 * 3600000; t += 30000) engine.advance(s, t, "valueOf");
const pot0 = s.away.pot ? s.away.pot.split.helpers : 0;
// the same reopening had every helper been seen at the clock: the whole 8 h
const ref = engine.cloneState(s);
for (const id of Object.keys(ref.helpers)) if (!ref.helpers[id].gone) ref.helpers[id].lastSeen = ref.clock;
engine.advance(ref, T1 + 120000 + 16 * 3600000, "__proto__");
engine.advance(s, T1 + 120000 + 16 * 3600000, "__proto__");
const potOf = (x) => (x.away.pot ? x.away.pot.split.helpers - pot0 : 0);
out.staleShare = potOf(s) / potOf(ref);
act("__proto__", { t: T1 + 120000 + 16 * 3600000 + 1, type: "observe", helpers: [], visible: true, active: true, matShown: true });
const text = engine.serialize(s);
const back = engine.parseSave(text);
const clone = engine.cloneState(s);
out.helpers = Object.keys(s.helpers).length;
out.album = Object.values(s.helpers).filter((h) => h.gone).length;
out.units = s.stats.units;
out.applied = Object.keys(s.applied).sort();
out.ok = back.ok && engine.serialize(back.state) === text && engine.serialize(clone) === text;
out.nullProto = Object.getPrototypeOf(back.state.applied) === null && Object.getPrototypeOf(back.state.helpers) === null;
out.away = s.stats.bySource.away > 0;
for (const bad of ["{{{not json", "null", "42", '"old shape"', "[]", text.slice(0, 99)]) {
  const r = engine.parseSave(bad);
  if (r.ok) out.ok = false;
}
console.log(JSON.stringify(out));

// Helpers and envelopes (§5, §6): identity, turn deltas, units, stacking,
// overflow, opening, boosts, Album / Elsewhere, prototype-key addresses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { engine, seeded, writer, agent, kid, observeAction, close, T0 } from "./_util.mjs";

test("helper id = fnv1a32(addr#created); look from the hash (§5.1)", () => {
  const id = engine.helperId("t1", 1001);
  assert.equal(id, engine.fnv1a32("t1#1001"));
  const h = parseInt(id, 16) >>> 0;
  const look = engine.lookOf(id);
  assert.equal(look.species, engine.CONTENT.SPECIES[h % 12]);
  assert.equal(look.hue, (h >>> 4) % 8);
  assert.equal(look.name, engine.CONTENT.NAME_A[(h >>> 8) % 16] + engine.CONTENT.NAME_B[(h >>> 12) % 12]);
  assert.match(look.name, /^[A-Za-z]+$/);
});

test("turn deltas: first sighting and turn < lastTurn rebaseline; d > 0 is one finish (§6.1, inv. 8)", () => {
  const s = seeded();
  const me = writer(s);
  me.act(observeAction(T0, [agent(1, "working", 7)]));
  const id = engine.helperId("t1", 1001);
  assert.equal(s.helpers[id].lastTurn, 7);
  assert.equal(Object.keys(s.envelopes).length, 0);
  me.act(observeAction(T0 + 1000, [agent(1, "idle", 8)]));
  assert.equal(s.envelopes[id].units, 1);
  // The same observation again (replayed, or from a second writer) creates nothing.
  me.act(observeAction(T0 + 2000, [agent(1, "idle", 8)]));
  const other = writer(s, "wB");
  other.act(observeAction(T0 + 2500, [agent(1, "idle", 8)]));
  assert.equal(s.envelopes[id].units, 1);
  // Core restart: turn goes back → rebaseline, no reward.
  me.act(observeAction(T0 + 3000, [agent(1, "working", 0)]));
  assert.equal(s.helpers[id].lastTurn, 0);
  assert.equal(s.envelopes[id].units, 1);
  // Within 60 s of the previous credited finish: 0.25.
  me.act(observeAction(T0 + 4000, [agent(1, "idle", 1)]));
  assert.equal(s.envelopes[id].units, 1.25);
  me.act(observeAction(T0 + 70000, [agent(1, "idle", 3)]));
  assert.equal(s.envelopes[id].units, 2.25);
  assert.equal(s.helpers[id].stats.tasks, 3);
  // A new created_ms is a new helper (rebaselined), and the old one goes to the Album.
  me.act(observeAction(T0 + 80000, [agent(1, "idle", 9, { created: 5000 })]));
  assert.equal(s.helpers[id].gone, true);
  assert.equal(engine.groupFor(s.helpers[id], "wA"), "album");
  assert.equal(s.helpers[engine.helperId("t1", 5000)].lastTurn, 9);
  assert.equal(s.envelopes[id].units, 2.25); // the envelope stays on the tray
});

test("fledglings add 0.5 unit to the parent (0.125 within 60 s) and multiply it (§5.3, §6.1)", () => {
  const s = seeded();
  const me = writer(s);
  me.act(observeAction(T0, [agent(1, "working", 0), kid(2, 1, "working", 0), kid(3, 1, "working", 0)]));
  const p = engine.helperId("t1", 1001);
  const k = engine.helperId("t2", 1002);
  assert.equal(s.helpers[k].parent, p);
  assert.equal(s.helpers[k].kind, "kid");
  close(engine.rates(s).Hs0, 0.3 * (1 + 0.25 * 2));
  me.act(observeAction(T0 + 1000, [agent(1, "working", 0), kid(2, 1, "idle", 1), kid(3, 1, "working", 0)]));
  assert.equal(s.envelopes[p].units, 0.5);
  assert.equal(s.envelopes[k], undefined);
  me.act(observeAction(T0 + 2000, [agent(1, "working", 0), kid(2, 1, "idle", 2), kid(3, 1, "working", 0)]));
  assert.equal(s.envelopes[p].units, 0.625);
  close(engine.rates(s).Hs0, 0.3 * 1.25);
  // a fledgling of a fledgling counts for the pane helper at the root
  me.act(observeAction(T0 + 3000, [agent(1, "working", 0), kid(2, 1, "idle", 2), kid(3, 1, "working", 0), kid(4, 3, "working", 0)]));
  assert.equal(s.helpers[engine.helperId("t4", 1004)].parent, p);
});

test("warm, thanks and rest (§5.3, §5.4)", () => {
  const s = seeded();
  const me = writer(s);
  me.act(observeAction(T0, [agent(1, "idle", 0)]));
  const id = engine.helperId("t1", 1001);
  for (let t = T0; t <= T0 + 15 * 60000; t += 30000) engine.advance(s, t);
  close(s.helpers[id].rest, 0.5);
  me.act(observeAction(T0 + 15 * 60000 + 1, [agent(1, "working", 0)]));
  close(engine.rates(s).Hs0, 0.3 * 1.5, 1e-6);
  assert.equal(s.helpers[id].rest, 0);
  // warm ends at the next turn increment
  me.act(observeAction(T0 + 16 * 60000, [agent(1, "working", 1)]));
  close(engine.rates(s).Hs0, 0.3);
  // needs you → working within 5 min: thanks ×1.5 for 5 min
  me.act(observeAction(T0 + 17 * 60000, [agent(1, "blocked", 1)]));
  assert.equal(engine.rates(s).Hs0, 0);
  me.act(observeAction(T0 + 19 * 60000, [agent(1, "working", 1)]));
  close(engine.rates(s).Hs0, 0.3 * 1.5);
  for (let t = T0 + 19 * 60000; t <= T0 + 24 * 60000 + 1000; t += 30000) engine.advance(s, t);
  close(engine.rates(s).Hs0, 0.3);
  // waiting never charges rest
  me.act(observeAction(T0 + 25 * 60000, [agent(1, "blocked", 1)]));
  for (let t = T0 + 25 * 60000; t <= T0 + 35 * 60000; t += 30000) engine.advance(s, t);
  assert.equal(s.helpers[id].rest, 0);
});

test("stacking: one envelope per helper, cap 9, overflow converts at 45·Rp·crowd(N) (inv. 9)", () => {
  const s = seeded(4);
  s.owned["paper-stack"] = 20;
  const me = writer(s);
  let t = T0;
  let turn = 0;
  me.act(observeAction(t, [agent(1, "working", turn), agent(2, "working", 0)]));
  const id = engine.helperId("t1", 1001);
  const converted = [];
  for (let i = 0; i < 12; i++) {
    t += 61000;
    turn++;
    const ev = me.act(observeAction(t, [agent(1, "working", turn), agent(2, "working", 0)]));
    const o = ev.find((e) => e.kind === "earn" && e.source === "overflow");
    if (o) converted.push(o.amount / engine.rates(s).Rp);
  }
  assert.equal(s.envelopes[id].units, 9);
  assert.equal(converted.length, 3);
  for (const c of converted) close(c, 45 * engine.crowd(2), 1e-6);
  const u = s.stats.units;
  assert.equal(u.created, 12);
  assert.equal(u.converted, 3);
  assert.equal(u.created, u.opened + u.converted + 9);
  assert.ok(s.notices.some((n) => n.kind === "overflow"));
  // opening: bundle pays 45·Rp·u·envMult·crowd(N); boosts follow §6.1
  const env = s.envelopes[id];
  env.type = "bundle";
  const Rp = engine.rates(s).Rp;
  const ev = me.act({ t: t + 10, type: "open", helperId: id });
  close(ev.find((e) => e.source === "env").amount, 45 * Rp * 9 * engine.crowd(2), 1e-9);
  assert.equal(s.envelopes[id], undefined);
  assert.equal(u.created, u.opened + u.converted);
  assert.equal(me.act({ t: t + 20, type: "open", helperId: id }).at(-1).reason, "gone");
});

test("boost envelopes: durations, extension by 25 %, caps (§6.1, §6.2)", () => {
  const s = seeded();
  const me = writer(s);
  s.envelopes.a = { type: "rush", units: 3, landedAt: T0, lastAt: T0 };
  me.act({ t: T0, type: "open", helperId: "a" });
  assert.equal(s.boosts.rush, 30000 * 1.5);
  s.envelopes.b = { type: "rush", units: 1, landedAt: T0, lastAt: T0 };
  me.act({ t: T0, type: "open", helperId: "b" });
  assert.equal(s.boosts.rush, 45000 + 7500);
  s.envelopes.c = { type: "rush", units: 9, landedAt: T0, lastAt: T0 };
  me.act({ t: T0, type: "open", helperId: "c" });
  assert.equal(s.boosts.rush, 75000);
  s.envelopes.c2 = { type: "rush", units: 9, landedAt: T0, lastAt: T0 };
  me.act({ t: T0, type: "open", helperId: "c2" });
  assert.equal(s.boosts.rush, 90000);
  s.bought["long-ribbon"] = true;
  s.envelopes.d = { type: "chorus", units: 1, landedAt: T0, lastAt: T0 };
  me.act({ t: T0, type: "open", helperId: "d" });
  assert.equal(s.boosts.chorus, 180000);
  s.envelopes.e = { type: "storm", units: 9, landedAt: T0, lastAt: T0 };
  me.act({ t: T0, type: "open", helperId: "e" });
  assert.equal(s.boosts.storm, 30000);
  // Rush ×3 on hand hits (Storm ×7 wins while both run)
  engine.advance(s, T0 + 31000);
  assert.equal(s.boosts.storm, 0);
  assert.equal(s.boosts.rush, 90000 - 31000);
  const before = s.bank;
  me.act({ t: T0 + 31500, type: "click", target: "sheet" });
  close(s.bank - before, 3 * (1 + 0.5 / 40)); // Rp = 0, so V = hand·G = 1
});

test("Album and Elsewhere: a writer moves a helper to the Album only if it saw it last (§12.5)", () => {
  const s = seeded();
  const a = writer(s, "wA");
  const b = writer(s, "wB");
  a.act(observeAction(T0, [agent(1, "working", 0), agent(2, "working", 0)]));
  b.act(observeAction(T0 + 10, [agent(3, "blocked", 0)]));
  const id1 = engine.helperId("t1", 1001);
  const id3 = engine.helperId("t3", 1003);
  assert.equal(s.helpers[id3].seenBy, "wB");
  assert.equal(s.helpers[id1].gone, false);
  assert.equal(engine.groupFor(s.helpers[id3], "wA"), "elsewhere");
  assert.equal(engine.groupFor(s.helpers[id3], "wB"), "needs");
  a.act(observeAction(T0 + 20, [agent(2, "working", 0)]));
  assert.equal(s.helpers[id1].gone, true);
  assert.equal(engine.groupFor(s.helpers[id1], "wA"), "album");
  assert.equal(s.helpers[id3].gone, false);
  // the returning agent rejoins with its history
  s.helpers[id1].stats.tasks = 5;
  a.act(observeAction(T0 + 30, [agent(1, "idle", 0), agent(2, "working", 0)]));
  assert.equal(s.helpers[id1].gone, false);
  assert.equal(s.helpers[id1].stats.tasks, 5);
});

test("a helper another window stopped observing earns the away rate, then nothing after 8 h (§10.2)", () => {
  const s = seeded();
  s.owned["paper-stack"] = 10;
  const a = writer(s, "wA");
  const b = writer(s, "wB");
  a.act(observeAction(T0, [agent(1, "working", 0)]));
  b.act(observeAction(T0, [agent(2, "working", 0)]));
  // wA keeps ticking; wB goes silent.
  let t = T0;
  const per = [];
  for (let k = 0; k < 9 * 3600 / 30; k++) {
    t += 30000;
    const before = s.stats.bySource.helpers || 0;
    engine.advance(s, t, "wA");
    per.push(((s.stats.bySource.helpers || 0) - before) / 30);
  }
  const Rw = engine.rates(s).Rw;
  const base = 0.3 + 0.04 * Rw;
  close(per[0], engine.crowd(2) * 2 * base, 1e-9); // both live for the first 60 s
  close(per[10], base + 0.25 * engine.crowd(2) * base, 1e-9);
  close(per.at(-1), base, 1e-9);
});

test("'__proto__', 'constructor' and 'toString' addresses are ordinary helpers (§5.1 fuzz)", () => {
  const s = seeded();
  const me = writer(s);
  const odd = ["__proto__", "constructor", "toString", "t1/../x", "peer/t7", "hasOwnProperty"];
  const list = odd.map((addr, i) => agent(i, "working", 0, { addr, title: "👩🏽‍💻 fix 🇯🇵 1️⃣ 🏴󠁧󠁢󠁳󠁣󠁴󠁿".repeat(20) }));
  me.act(observeAction(T0, list));
  assert.equal(Object.keys(s.helpers).length, odd.length);
  for (let i = 0; i < odd.length; i++) {
    const h = s.helpers[engine.helperId(odd[i], 1000 + i)];
    assert.equal(h.addr, odd[i]);
    assert.ok(engine.graphemes(h.title).length <= 80);
  }
  me.act(observeAction(T0 + 70000, list.map((o) => ({ ...o, turn: 1, status: "idle" }))));
  assert.equal(Object.keys(s.envelopes).length, odd.length);
  const text = engine.serialize(s);
  const back = engine.parseSave(text);
  assert.equal(back.ok, true);
  assert.equal(Object.getPrototypeOf(back.state.helpers), null);
  assert.equal(engine.serialize(back.state), text);
  // the envelope map stays null-prototype through apply/open
  const z = writer(back.state, "wZ");
  for (const id of Object.keys(back.state.envelopes)) z.act({ t: T0 + 80000, type: "open", helperId: id });
  assert.equal(Object.keys(back.state.envelopes).length, 0);
});

test("Mail Sorter opens Bundles 10 s after they land; Boost Keeper only while clicking (§8)", () => {
  const s = seeded(2);
  const me = writer(s);
  s.bought["mail-sorter"] = true;
  s.bought["boost-keeper"] = true;
  s.envelopes.x = { type: "bundle", units: 1, landedAt: T0, lastAt: T0 };
  s.envelopes.y = { type: "rush", units: 2, landedAt: T0, lastAt: T0 };
  engine.advance(s, T0 + 9000);
  assert.ok(s.envelopes.x);
  engine.advance(s, T0 + 10000);
  assert.equal(s.envelopes.x, undefined);
  assert.ok(s.envelopes.y); // no hand hit yet
  me.act({ t: T0 + 11000, type: "click", target: "sheet" });
  engine.advance(s, T0 + 12000);
  assert.equal(s.envelopes.y, undefined);
  assert.ok(s.boosts.rush > 0);
  // switched off: nothing opens
  me.act({ t: T0 + 13000, type: "switch", id: "mail-sorter", on: false });
  s.envelopes.z = { type: "bundle", units: 1, landedAt: T0, lastAt: T0 };
  engine.advance(s, T0 + 30000);
  assert.ok(s.envelopes.z);
  assert.equal(me.act({ t: T0 + 30001, type: "switch", id: "thrifty-fox", on: true }).at(-1).reason, "switch");
});

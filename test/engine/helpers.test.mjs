// Helpers and envelopes (§5, §6): identity, turn deltas, units, stacking,
// overflow, opening, boosts, Album / Elsewhere, prototype-key addresses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { engine, seeded, writer, agent, kid, observeAction, close, T0 } from "./_util.mjs";
import { saltedId, rosterChanged, albumKey, archiveId } from "../../mods/creaseworks/engine/helpers.js";

test("helper id = fnv1a32(addr#created); look from the hash (§5.1)", () => {
  const id = engine.helperId("t1", 1001);
  assert.equal(id, engine.fnv1a32("t1#1001"));
  const h = parseInt(id, 16) >>> 0;
  const look = engine.lookOf(id);
  assert.equal(look.species, engine.CONTENT.SPECIES[h % 12]);
  assert.equal(look.hue, (h >>> 4) % 8);
  assert.equal(look.name, engine.CONTENT.NAMES[((h >>> 8) % 16) * 12 + ((h >>> 12) % 12)]);
  assert.match(look.name, /^[A-Za-z]+$/);
});

// Review r2-28: two syllables can spell a slur, a sexualised or vulgar slang
// word, a deity's or a well-known character's name. Each such pair takes the
// next pair in table order that is not skipped (§5.1); NAMES is that table,
// written out. NEVER is the review's list, kept here independently of
// NAME_SKIP so that dropping one from the skip list fails this test (round 2
// added the second and third rows: "Haku" was first remapped to "Haro").
const NEVER = [
  "Loli", "Nob", "Yuri", "Miku", "Riku", "Yuna", "Zero", "Mona", "Rito", "Pipo", "Loki", "Haku", "Tali",
  "Haro", "Rin", "Moro", "Zemo", "Kapo", "Pito", "Misa", "Kon",
  "Han", "Mob", "Momo", "Kato", "Koro", "Kali", "Kaki", "Feto", "Taki", "Suki", "Sub",
];

test("helper names: none of the 192 is a skipped word or borrowed name; NAMES is NAME_A × NAME_B with skips remapped (§5.1, r2-28)", () => {
  const { NAME_A, NAME_B, NAME_SKIP, NAMES } = engine.CONTENT;
  assert.equal(NAMES.length, 192);
  assert.ok(Object.isFrozen(NAMES) && Object.isFrozen(NAME_SKIP));
  for (const w of NEVER) assert.ok(NAME_SKIP.includes(w), w);
  const raw = [];
  for (const a of NAME_A) for (const b of NAME_B) raw.push(a + b);
  for (const w of NAME_SKIP) assert.ok(raw.includes(w), `${w} is a real pair (the list has no dead entries)`);
  for (let i = 0; i < 192; i++) {
    let j = i;
    while (NAME_SKIP.includes(raw[j])) j = (j + 1) % 192;
    assert.equal(NAMES[i], raw[j], `index ${i}`);
    assert.ok(!NAME_SKIP.includes(NAMES[i]), NAMES[i]);
    assert.match(NAMES[i], /^[A-Z][a-z]{1,3}$/);
  }
  // every hash index gives a name from the table: sweep the 16 × 12 name bits
  const seen = new Set();
  for (let a = 0; a < 16; a++) {
    for (let b = 0; b < 12; b++) {
      const id = ((a << 8) | (b << 12)).toString(16).padStart(8, "0");
      const name = engine.lookOf(id).name;
      assert.ok(!NEVER.includes(name), `${id} → ${name}`);
      seen.add(name);
    }
  }
  assert.equal(seen.size, 192 - NAME_SKIP.length);
  assert.equal(seen.size, 160);
  // no name holds more than 4 of the 192 slots (remaps do not pile up on one name)
  const per = new Map();
  for (const x of NAMES) per.set(x, (per.get(x) || 0) + 1);
  assert.ok(Math.max(...per.values()) <= 4, JSON.stringify([...per].filter(([, v]) => v > 3)));
});

test("a helper or Album record named before the skip list is renamed: present, whole and packed (§5.1, r2-28)", () => {
  const s = seeded(9);
  const me = writer(s);
  const K = engine.CONTENT.K;
  let t = T0;
  me.act(observeAction((t += 1000), [agent(1), agent(2)]));
  const id1 = engine.helperId("t1", 1001);
  const id2 = engine.helperId("t2", 1002);
  // an older save: a present helper and a gone one carry names the game no longer gives
  s.helpers[id1].name = "Loli";
  me.act(observeAction((t += 1000), [agent(1)]));
  s.helpers[id2].name = "Zero 2";
  me.act(observeAction((t += 1000), [agent(1)]));
  assert.equal(s.helpers[id1].name, engine.lookOf(id1).name);
  assert.equal(s.helpers[id2].name, engine.lookOf(id2).name);
  // a packed Album entry with an explicit skipped name loads under its look name
  for (let k = 0; k < K.albumKeep + 1; k++) {
    me.act(observeAction((t += 1000), [agent(1), agent(100 + k)]));
    me.act(observeAction((t += 1000), [agent(1)]));
  }
  assert.equal(s.helpers[id2].compact, true);
  const doc = JSON.parse(engine.serialize(s));
  doc.state.helpers[id2] = [0, 1, 0, doc.state.helpers[id2][3]];
  doc.state.helpers[id2][0] = "Miku";
  const body = JSON.stringify(doc.state);
  const back = engine.parseSave(`{"format":"creaseworks-save","version":2,"check":"${engine.fnv1a32(body)}","state":${body}}`);
  assert.equal(back.ok, true);
  assert.equal(back.state.helpers[id2].name, engine.lookOf(id2).name);
  for (const h of Object.values(s.helpers)) assert.ok(!NEVER.includes(h.name.split(" ")[0]), h.name);
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
  // Units follow the time since the previous credited finish (r3-24): 3 s
  // later is the 1/8 minimum, 6 min later half a unit, 12 min or more a whole one.
  me.act(observeAction(T0 + 4000, [agent(1, "idle", 1)]));
  assert.equal(s.envelopes[id].units, 1.125);
  me.act(observeAction(T0 + 4000 + 360000, [agent(1, "idle", 3)]));
  assert.equal(s.envelopes[id].units, 1.625);
  me.act(observeAction(T0 + 4000 + 360000 + 3600000, [agent(1, "idle", 4)]));
  assert.equal(s.envelopes[id].units, 2.625);
  assert.equal(s.helpers[id].stats.tasks, 4);
  // A new created_ms is a new helper (rebaselined), and the old one goes to the Album.
  me.act(observeAction(T0 + 8000000, [agent(1, "idle", 9, { created: 5000 })]));
  assert.equal(s.helpers[id].gone, true);
  assert.equal(engine.groupFor(s.helpers[id], "wA"), "album");
  assert.equal(s.helpers[engine.helperId("t1", 5000)].lastTurn, 9);
  assert.equal(s.envelopes[id].units, 2.625); // the envelope stays on the tray
});

test("fledglings add 0.5 unit to the parent from one budget, and multiply it (§5.3, §6.1, r3-24)", () => {
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
  // the other fledgling 1 s later draws on the same parent budget: 0.5 · 1/8
  me.act(observeAction(T0 + 2000, [agent(1, "working", 0), kid(2, 1, "idle", 1), kid(3, 1, "idle", 1)]));
  assert.equal(s.envelopes[p].units, 0.5625);
  close(engine.rates(s).Hs0, 0.3);
  // a fledgling of a fledgling counts for the pane helper at the root
  me.act(observeAction(T0 + 3000, [agent(1, "working", 0), kid(2, 1, "idle", 1), kid(3, 1, "working", 1), kid(4, 3, "working", 0)]));
  assert.equal(s.helpers[engine.helperId("t4", 1004)].parent, p);
});

test("r3-24: a burst of new short-lived fledglings earns what one fledgling does, not 0.5 unit each", () => {
  const s = seeded();
  const me = writer(s);
  const p = engine.helperId("t1", 1001);
  let t = T0;
  me.act(observeAction(t, [agent(1, "working", 0)]));
  // 50 sub-agents over 15 min, each a new address that works 10 s and finishes
  for (let i = 0; i < 50; i++) {
    const a = 100 + i;
    me.act(observeAction((t += 1000), [agent(1, "working", 0), kid(a, 1, "working", 0)]));
    me.act(observeAction((t += 10000), [agent(1, "working", 0), kid(a, 1, "idle", 1)]));
    me.act(observeAction((t += 7000), [agent(1, "working", 0)]));
  }
  assert.ok(t - T0 <= 15 * 60000);
  const u = s.envelopes[p].units;
  // the first full 0.5, then 49 finishes 18 s apart at the 1/8 minimum: 0.5 + 49 · 0.0625
  assert.equal(u, 0.5 + 49 * 0.0625);
  assert.ok(u < 4, `${u} units (0.5 each would be 25)`);
});

test("r3-24: short turns earn units by time, so an agent answered every minute earns about what a 12-minute one does", () => {
  const unitsOver = (workMin, needsMin) => {
    const s = seeded();
    const me = writer(s);
    const id = engine.helperId("t1", 1001);
    let t = T0;
    let turn = 0;
    me.act(observeAction(t, [agent(1, "working", 0)]));
    while (t < T0 + 3600000) {
      me.act(observeAction((t += workMin * 60000), [agent(1, "blocked", ++turn)]));
      me.act(observeAction((t += needsMin * 60000), [agent(1, "working", turn)]));
    }
    return s.stats.units.created;
  };
  const long = unitsOver(12, 2); // P1's blocks: 4-5 finishes, each a whole unit
  const short = unitsOver(1, 1); // 30 finishes an hour
  assert.ok(long >= 4 && long <= 5, `${long}`);
  assert.ok(short <= 6, `${short} units in an hour of 1-minute turns`);
  assert.ok(short < 30 / 4, "30 finishes an hour earn far less than 30 units");
});

test("r3-10: working fledglings gather for their parent while the parent is idle, finished or waiting", () => {
  for (const ps of ["idle", "done", "blocked"]) {
    const s = seeded();
    const me = writer(s);
    me.act(observeAction(T0, [agent(1, ps, 0), kid(2, 1, "working", 0), kid(3, 1, "working", 0)]));
    const p = engine.helperId("t1", 1001);
    const r = engine.rates(s);
    // base · kidBonus · 2: the share two working fledglings add to a working parent
    close(r.Hs0, 0.3 * 0.25 * 2, 1e-9, ps);
    assert.equal(r.nWorking, 0, "the parent is not a working agent");
    engine.advance(s, T0 + 30000);
    assert.ok(s.bank > 0, `${ps}: ${s.bank}`);
    close(s.helpers[p].stats.folds, s.bank, 1e-9, "credited to the parent's record");
    // Fledgling Pockets (kidBonus) raise it too
    const kb = engine.CONTENT.UPGRADES.find((u) => u.fx === "kids");
    if (kb) {
      s.bought[kb.id] = true;
      close(engine.rates(s).Hs0, 0.3 * kb.v * 2, 1e-9, `${ps} kidBonus`);
    }
  }
  // a working parent: the fledglings multiply it as before (no double count)
  const s = seeded();
  const me = writer(s);
  me.act(observeAction(T0, [agent(1, "working", 0), kid(2, 1, "working", 0)]));
  close(engine.rates(s).Hs0, 0.3 * 1.25);
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

test("stacking: one envelope per helper, cap 9, overflow converts at max(45·Rp, 75·V)·crowd(N) (inv. 9, r3-11)", () => {
  const s = seeded(4);
  s.owned["paper-stack"] = 20;
  const me = writer(s);
  let t = T0;
  let turn = 0;
  me.act(observeAction(t, [agent(1, "working", turn), agent(2, "working", 0)]));
  const id = engine.helperId("t1", 1001);
  const converted = [];
  for (let i = 0; i < 12; i++) {
    t += 12 * 60000; // a whole unit per finish (r3-24)
    turn++;
    const ev = me.act(observeAction(t, [agent(1, "working", turn), agent(2, "working", 0)]));
    const o = ev.find((e) => e.kind === "earn" && e.source === "overflow");
    const r = engine.rates(s);
    if (o) converted.push(o.amount / Math.max(45 * r.Rp, 75 * r.V));
  }
  assert.equal(s.envelopes[id].units, 9);
  assert.equal(converted.length, 3);
  for (const c of converted) close(c, engine.crowd(2), 1e-6);
  const u = s.stats.units;
  assert.equal(u.created, 12);
  assert.equal(u.converted, 3);
  assert.equal(u.created, u.opened + u.converted + 9);
  assert.ok(s.notices.some((n) => n.kind === "overflow"));
  // opening: bundle pays max(45·Rp, 75·V)·u·envMult·crowd(N); boosts follow §6.1
  const env = s.envelopes[id];
  env.type = "bundle";
  const r = engine.rates(s);
  const ev = me.act({ t: t + 10, type: "open", helperId: id });
  close(ev.find((e) => e.source === "env").amount, Math.max(45 * r.Rp, 75 * r.V) * 9 * engine.crowd(2), 1e-9);
  assert.equal(s.envelopes[id], undefined);
  assert.equal(u.created, u.opened + u.converted);
  assert.equal(me.act({ t: t + 20, type: "open", helperId: id }).at(-1).reason, "gone");
});

test("r3-11: a Bundle never pays 0: with nobody working and no workshop it pays the 75·V floor (open, tooltip, overflow, settle)", () => {
  const s = seeded(1);
  const me = writer(s);
  me.act(observeAction(T0, [agent(1, "working", 0)]));
  me.act(observeAction(T0 + 300000, [agent(1, "idle", 1)]));
  const id = engine.helperId("t1", 1001);
  const env = s.envelopes[id];
  assert.ok(env);
  env.type = "bundle";
  const r = engine.rates(s);
  assert.equal(r.Rp, 0, "the finished agent left the bench and there is no workshop");
  assert.ok(r.V > 0);
  const want = 75 * r.V * env.units * engine.crowd(1);
  const tray = engine.view(s, T0 + 300000, { role: "panel", width: 320, writer: "wA" }).tray.envelopes[0];
  assert.equal(tray.tooltip, `Bundle: +${engine.formatCount(want)} folds`);
  assert.notEqual(tray.tooltip, "Bundle: +0 folds");
  const bank = s.bank;
  const ev = me.act({ t: T0 + 300010, type: "open", helperId: id });
  close(ev.find((e) => e.source === "env").amount, want);
  close(s.bank - bank, want);
  // the same floor for units above the cap
  s.envelopes[id] = { type: "rush", units: 9, landedAt: T0, lastAt: T0 };
  const ev2 = me.act(observeAction(T0 + 300000 + 3600000, [agent(1, "idle", 2)]));
  const o = ev2.find((e) => e.kind === "earn" && e.source === "overflow");
  assert.ok(o && o.amount > 0, JSON.stringify(ev2));
  close(o.amount, 75 * engine.rates(s).V * engine.crowd(1), 1e-9);
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

// --- review fixes r1-15, r1-21, r1-22, r1-23, r1-24 -------------------------

test("marginal bench pace: a fresh agent never lowers a warm bench's Hs0, and a waiting agent never raises it (§5.3, inv. 6)", () => {
  // One helper warm ×3 with thanks ×1.5 (b = 4.5·base) and four fresh ones: under the old
  // crowd(n)·Σb a fifth fresh agent lowered Hs0 (0.83 · 8.5 < 7.5 · 1).
  const s = seeded();
  const me = writer(s);
  me.act(observeAction(T0, [agent(1, "idle", 0)]));
  engine.advance(s, T0 + 31 * 60000, "wA"); // rest fills
  me.act(observeAction(T0 + 31 * 60000, [agent(1, "blocked", 0)]));
  me.act(observeAction(T0 + 32 * 60000, [agent(1, "working", 0)])); // warm ×2 and thanks ×1.5
  const id1 = engine.helperId("t1", 1001);
  assert.ok(s.helpers[id1].warm > 1 && s.helpers[id1].thanksUntil > s.clock);
  let t = T0 + 32 * 60000;
  const list = [agent(1, "working", 0)];
  let prev = engine.rates(s).Hs0;
  for (let i = 2; i <= 40; i++) {
    list.push(agent(i, "working", 0));
    me.act(observeAction((t += 1000), list));
    const hs = engine.rates(s).Hs0;
    assert.ok(hs > prev, `n=${i}: Hs0 ${hs} ≤ ${prev}`);
    prev = hs;
  }
  // Any working agent that turns to Needs you lowers Hs0 (never raises it).
  for (let i = 1; i <= 40; i++) {
    const before = engine.rates(s).Hs0;
    const flip = list.map((o, k) => (k === i - 1 ? { ...o, status: "blocked" } : o));
    const c = engine.cloneState(s);
    engine.apply(c, { w: "wA", s: 99999, ...observeAction(t + 500, flip) });
    assert.ok(engine.rates(c).Hs0 < before, `agent ${i} waiting raised Hs0`);
  }
  // equal benches keep crowd(n)·Σ b exactly
  const e = seeded();
  writer(e).act(observeAction(T0, Array.from({ length: 9 }, (_, i) => agent(i + 1, "working", 0))));
  close(engine.rates(e).Hs0, engine.crowd(9) * 9 * 0.3, 1e-12);
});

test("Elsewhere: helpers last seen by a writer nobody has heard from for 8 h are adopted into the Album (§12.5)", () => {
  const s = seeded();
  const old = writer(s, "w-old");
  old.act(observeAction(T0 + 1000, [agent(1), agent(2), agent(3)]));
  engine.advance(s, T0 + 5000, "w-old");
  // herdr restarts: a new process, a new writer id; agents 1 and 2 ended meanwhile
  const now = writer(s, "w-new");
  let t = T0 + 600000;
  now.act(observeAction(t, [agent(3)]));
  const id1 = engine.helperId("t1", 1001);
  const id2 = engine.helperId("t2", 1002);
  // within 8 h the old window might still be observing them: Elsewhere
  assert.equal(engine.groupFor(s.helpers[id1], "w-new"), "elsewhere");
  t = T0 + 5000 + 8 * 3600000 - 1000;
  engine.advance(s, t, "w-new");
  now.act(observeAction(t, [agent(3)]));
  assert.equal(s.helpers[id1].gone, false);
  // past 8 h without a sighting: any window that does not list them moves them to the Album
  t = T0 + 5000 + 8 * 3600000 + 1000;
  engine.advance(s, t, "w-new");
  now.act(observeAction(t, [agent(3)]));
  for (const id of [id1, id2]) {
    assert.equal(s.helpers[id].gone, true);
    assert.equal(engine.groupFor(s.helpers[id], "w-new"), "album");
  }
  const vm = engine.view(s, t + 1, { writer: "w-new" });
  assert.equal(vm.helpers.elsewhere.length, 0);
  assert.equal(vm.helpers.albumCount, 2);
  assert.equal(engine.rates(s, "w-new").nPresent, 1);
  // a live second window's helpers are not adopted
  const b = writer(s, "wB");
  b.act(observeAction(t + 1000, [agent(9)]));
  now.act(observeAction(t + 2000, [agent(3)]));
  assert.equal(s.helpers[engine.helperId("t9", 1009)].gone, false);
});

/** Two terminals whose `addr#created` strings clash in the 32-bit hash. */
function clashingPair() {
  const created = 1795000000000;
  const seen = new Map();
  for (let i = 1; ; i++) {
    const id = engine.helperId(`t${i}`, created + i);
    if (seen.has(id)) return [seen.get(id), i, created];
    seen.set(id, i);
  }
}

test("a 32-bit id clash between two present agents loses neither: the later one takes a salted id (R6)", () => {
  const [a, b, created] = clashingPair();
  assert.equal(engine.helperId(`t${a}`, created + a), engine.helperId(`t${b}`, created + b));
  const ag = (i, status) => agent(i, status, 0, { created: created + i });
  const s = seeded();
  const me = writer(s);
  me.act(observeAction(T0, [ag(a, "working"), ag(b, "blocked")]));
  const plain = engine.helperId(`t${a}`, created + a);
  const salted = saltedId(`t${b}`, created + b, 1);
  assert.equal(Object.keys(s.helpers).length, 2);
  assert.equal(s.helpers[plain].addr, `t${a}`);
  assert.equal(s.helpers[salted].addr, `t${b}`);
  assert.equal(engine.groupFor(s.helpers[salted], "wA"), "needs");
  // the same ids whatever the list order, and turns pay the right helper
  me.act(observeAction(T0 + 1000, [agent(b, "idle", 1, { created: created + b }), ag(a, "working")]));
  assert.equal(Object.keys(s.helpers).length, 2);
  assert.equal(s.helpers[salted].stats.tasks, 1);
  assert.equal(s.helpers[plain].stats.tasks, 0);
  assert.equal(s.envelopes[salted].units, 1);
  const back = engine.parseSave(engine.serialize(s));
  assert.equal(back.ok, true);
  assert.equal(back.state.helpers[salted].addr, `t${b}`);
});

test("a salted id is kept after the plain id's holder leaves, and each agent of a clashing pair rejoins its own record (R6)", () => {
  const [a, b, created] = clashingPair();
  const plain = engine.helperId(`t${a}`, created + a);
  const salted = saltedId(`t${b}`, created + b, 1);
  const ag = (i, status, turn = 0) => agent(i, status, turn, { created: created + i });
  const s = seeded();
  const me = writer(s);
  let t = T0;
  const obs = (list) => me.act(observeAction((t += 1000), list));
  obs([ag(a, "working", 5), ag(b, "working", 0)]);
  obs([ag(a, "idle", 6), ag(b, "working", 0)]);
  const nameA = s.helpers[plain].name;
  const nameB = s.helpers[salted].name;
  obs([ag(b, "working", 1)]); // A leaves; B finishes a turn
  obs([ag(b, "idle", 2)]); // and again: B must not take over A's Album record
  assert.equal(Object.keys(s.helpers).length, 2);
  assert.equal(s.helpers[plain].gone, true);
  assert.equal(s.helpers[plain].name, nameA);
  assert.equal(s.helpers[plain].stats.tasks, 1);
  assert.equal(s.helpers[salted].gone, false);
  assert.equal(s.helpers[salted].addr, `t${b}`);
  assert.equal(s.helpers[salted].name, nameB);
  assert.equal(s.helpers[salted].stats.tasks, 2);
  assert.ok(s.envelopes[salted].units > 1, "both of B's turns fill B's envelope");
  // both leave; the save keeps which Album record was salted
  obs([]);
  assert.equal(s.helpers[salted].salt, 1);
  assert.equal(s.helpers[plain].salt, undefined);
  const back = engine.parseSave(engine.serialize(s));
  assert.equal(back.ok, true);
  assert.equal(back.state.helpers[salted].salt, 1);
  // B returns first (A's plain record is gone): it finds its own salted record
  obs([ag(b, "working", 2)]);
  assert.equal(s.helpers[salted].gone, false);
  assert.equal(s.helpers[salted].stats.tasks, 2);
  assert.equal(s.helpers[plain].gone, true);
  // A returns next to it: its own plain record, not a new one
  obs([ag(b, "working", 2), ag(a, "working", 6)]);
  assert.equal(Object.keys(s.helpers).length, 2);
  assert.equal(s.helpers[plain].gone, false);
  assert.equal(s.helpers[plain].addr, `t${a}`);
  assert.equal(s.helpers[plain].stats.tasks, 1);
  // B's salted record is never compacted (it would lose `salt`)
  obs([ag(a, "working", 6)]);
  for (let i = 0; i < 260; i++) obs([ag(a, "working", 6), agent(20000 + i, "working")]);
  assert.equal(s.helpers[salted].compact, undefined);
  assert.equal(s.helpers[salted].salt, 1);
});

test("r3-18: a new terminal whose plain id clashes with a gone helper's Album record does not take it over", () => {
  // helperId("t10871", 11871) === helperId("t60266", 61266): agent(i) is addr t<i>, created 1000 + i
  const A = 10871;
  const B = 60266;
  const id = engine.helperId(`t${A}`, 1000 + A);
  assert.equal(engine.helperId(`t${B}`, 1000 + B), id, "a real 32-bit clash");
  const s = seeded(3);
  const me = writer(s);
  let t = T0;
  me.act(observeAction((t += 1000), [agent(A, "working", 0)]));
  me.act(observeAction((t += 3600000), [agent(A, "idle", 5)]));
  me.act(observeAction((t += 1000), []));
  const a = s.helpers[id];
  const was = { name: a.name, tasks: a.stats.tasks, folds: a.stats.folds, joined: a.joined, missingSince: a.missingSince };
  assert.equal(a.gone, true);
  assert.equal(a.key, albumKey(`t${A}`, 1000 + A), "the Album record keeps its terminal key");
  assert.equal(a.addr, undefined);
  // a day later B appears: it takes a salted id; A's record stays in the Album as it was
  me.act(observeAction((t += 86400000), [agent(B, "working", 0)]));
  assert.equal(s.helpers[id].gone, true);
  assert.deepEqual({ name: a.name, tasks: a.stats.tasks, folds: a.stats.folds, joined: a.joined, missingSince: a.missingSince }, was);
  const bid = saltedId(`t${B}`, 1000 + B, 1);
  assert.equal(s.helpers[bid].addr, `t${B}`);
  assert.equal(s.helpers[bid].stats.tasks, 0);
  assert.equal(engine.view(s, t, { role: "panel", width: 320, writer: "wA" }).helpers.albumCount, 1);
  // A returns: it rejoins its own record with its history
  me.act(observeAction((t += 1000), [agent(B, "working", 0), agent(A, "working", 5)]));
  assert.equal(s.helpers[id].gone, false);
  assert.equal(s.helpers[id].addr, `t${A}`);
  assert.equal(s.helpers[id].stats.tasks, 1);
  assert.equal(s.helpers[id].key, undefined, "a present helper keeps its address, not a key");
  // both leave and B returns: B finds its own salted record, A's stays gone
  me.act(observeAction((t += 1000), []));
  me.act(observeAction((t += 1000), [agent(B, "working", 0)]));
  assert.equal(s.helpers[bid].gone, false);
  assert.equal(s.helpers[id].gone, true);
  // the key survives compaction and a save round trip (packed entries end in it)
  for (let k = 0; k < engine.CONTENT.K.albumKeep + 2; k++) {
    me.act(observeAction((t += 1000), [agent(B, "working", 0), agent(200 + k)]));
  }
  me.act(observeAction((t += 1000), [agent(B, "working", 0)]));
  assert.equal(s.helpers[id].compact, true);
  const back = engine.parseSave(engine.serialize(s));
  assert.equal(back.ok, true);
  assert.equal(back.state.helpers[id].key, albumKey(`t${A}`, 1000 + A));
  // an Album record from an older save (no key) is rejoined by its plain id, as before
  delete s.helpers[id].key;
  me.act(observeAction((t += 1000), [agent(B, "working", 0), agent(A, "working", 5)]));
  assert.equal(s.helpers[id].gone, false);
});

test("display names: a newcomer takes the smallest free number; a returning namesake is renamed only on a clash (§5.1)", () => {
  const ag = (i) => agent(i, "working", 0, { addr: `w1:t${i}` });
  const byName = Object.create(null);
  for (let i = 0; i < 5000; i++) (byName[engine.lookOf(engine.helperId(`w1:t${i}`, 1000 + i)).name] ||= []).push(i);
  const [base, [a, b, c, d]] = Object.entries(byName).find(([, v]) => v.length >= 4);
  const s = seeded();
  const me = writer(s);
  let t = T0;
  const live = () => Object.values(s.helpers).filter((h) => !h.gone).map((h) => h.name).sort();
  const obs = (list) => me.act(observeAction((t += 1000), list.map(ag)));
  obs([a, b, c]);
  assert.deepEqual(live(), [base, `${base} 2`, `${base} 3`].sort());
  obs([b, c]); // the bare name leaves
  obs([b, c, d]); // a newcomer takes it, not a second "3"
  assert.deepEqual(live(), [base, `${base} 2`, `${base} 3`].sort());
  obs([a, b, c, d]); // the first returns: its name is taken now
  const names = live();
  assert.equal(new Set(names).size, 4);
  assert.deepEqual(names, [base, `${base} 2`, `${base} 3`, `${base} 4`].sort());
  assert.equal(s.helpers[engine.helperId(`w1:t${d}`, 1000 + d)].name, base);
});

test("observing new agents does not rescan the helper map per agent (r1-24: O(new + total), not O(new × total))", () => {
  const s = seeded();
  const me = writer(s);
  let t = T0;
  // 400 helpers that came and went
  for (let k = 0; k < 4; k++) {
    me.act(observeAction((t += 1000), Array.from({ length: 100 }, (_, i) => agent(1000 + k * 100 + i))));
    me.act(observeAction((t += 1000), []));
  }
  let enumerations = 0;
  const hs = s.helpers;
  s.helpers = new Proxy(hs, { ownKeys(target) { enumerations++; return Reflect.ownKeys(target); } });
  const kids = Array.from({ length: 30 }, (_, i) => kid(5000 + i, 4000 + i, "working", 0));
  me.act(observeAction((t += 1000), [...Array.from({ length: 130 }, (_, i) => agent(4000 + i)), ...kids]));
  assert.ok(enumerations <= 8, `${enumerations} enumerations of the helper map for 160 new agents`);
  s.helpers = hs;
  rosterChanged(s);
  assert.equal(Object.values(hs).filter((h) => !h.gone).length, 160);
  for (const k of kids) assert.equal(hs[engine.helperId(k.addr, k.created)].parent, engine.helperId(`t${k.parent.slice(1)}`, 1000 + Number(k.parent.slice(1))));
});

// Review r2-18: a sub-agent with its own pane is a fledgling only while its
// parent chain reaches another helper (§5.2). When the parent leaves, the glue
// reports it as a pane helper; the engine follows, so it gathers and its
// rewards stay its own (never filed under the gone parent's Album record).
test("a kept fledgling whose parent leaves becomes a pane helper: it gathers, and its envelope is its own (§5.2, r2-18)", () => {
  const s = seeded(18);
  const me = writer(s);
  const id1 = engine.helperId("t1", 1001);
  const id2 = engine.helperId("t2", 1002);
  let t = T0;
  const child = (turn, extra = {}) => agent(2, "working", turn, { kind: "kid", parent: "t1", ...extra });
  me.act(observeAction((t += 1000), [agent(1), child(0)]));
  assert.equal(s.helpers[id2].kind, "kid");
  assert.equal(s.helpers[id2].parent, id1);
  assert.equal(engine.rates(s, "wA").nWorking, 1, "the parent works, with its fledgling's bonus");
  // the parent's pane closes: the glue re-reports the sub-agent as a pane helper
  me.act(observeAction((t += 1000), [agent(2, "working", 0)]));
  assert.equal(s.helpers[id1].gone, true);
  assert.equal(s.helpers[id2].kind, "pane");
  assert.equal(s.helpers[id2].parent, null);
  const r = engine.rates(s, "wA");
  assert.equal(r.nWorking, 1, "the orphan gathers");
  assert.equal(r.nPresent, 1);
  assert.ok(r.Hs0 > 0);
  // its finish is a pane finish on its own envelope
  me.act(observeAction((t += 61000), [agent(2, "idle", 1)]));
  assert.equal(s.envelopes[id1], undefined, "nothing filed under the gone parent");
  assert.equal(s.envelopes[id2].units, engine.CONTENT.K.unitPane);
  // the parent returns and the chain reaches it again: a fledgling once more
  me.act(observeAction((t += 1000), [agent(1), child(1, { status: "idle" })]));
  assert.equal(s.helpers[id2].kind, "kid");
  assert.equal(s.helpers[id2].parent, id1);
  assert.equal(engine.rates(s, "wA").nPresent, 1);
});

test("a fledgling whose parent is gone keeps its own reward (never the parent's Album record) (r2-18)", () => {
  const s = seeded(19);
  const me = writer(s);
  const id1 = engine.helperId("t1", 1001);
  const id3 = engine.helperId("t3", 1003);
  let t = T0;
  me.act(observeAction((t += 1000), [agent(1), kid(3, 1, "working", 0)]));
  // an observation that still names the gone parent (a host race): the engine does not credit it
  me.act(observeAction((t += 1000), [kid(3, 1, "working", 0)]));
  assert.equal(s.helpers[id1].gone, true);
  me.act(observeAction((t += 61000), [kid(3, 1, "idle", 1)]));
  assert.equal(s.envelopes[id1], undefined);
  assert.equal(s.envelopes[id3].units, engine.CONTENT.K.unitKid);
});

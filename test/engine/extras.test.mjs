// Automations, scraps, the Paper Boat, calm lives, settings and fledgling folding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { engine, seeded, writer, agent, kid, observeAction, close, T0 } from "./_util.mjs";
import { rosterChanged, archiveId } from "../../mods/creaseworks/engine/helpers.js";

test("Thrifty Fox buys the best-payback workshop at 4× its cost, at most once per 10 s", () => {
  const s = seeded();
  const me = writer(s);
  s.bought["thrifty-fox"] = true;
  s.owned["paper-stack"] = 1;
  s.bank = 4 * 180 - 1;
  engine.advance(s, T0 + 1000);
  // payback: paper stack 17.4 / 0.05 = 348 s, bone folder 180 / 0.3 = 600 s → paper stack
  assert.equal(s.owned["paper-stack"], 2);
  engine.advance(s, T0 + 5000);
  assert.equal(s.owned["paper-stack"], 2); // < 10 s since the last buy
  engine.advance(s, T0 + 11000);
  assert.equal(s.owned["paper-stack"], 3);
  s.bank = 10;
  engine.advance(s, T0 + 30000);
  assert.equal(s.owned["paper-stack"], 3); // bank < 4 × cost
  me.act({ t: T0 + 30001, type: "switch", id: "thrifty-fox", on: false });
  s.bank = 1e6;
  engine.advance(s, T0 + 60000);
  assert.equal(s.owned["paper-stack"], 3);
});

test("Crease Helper finishes a chain at 80 % of its life at half value, without rhythm", () => {
  const s = seeded(14);
  const me = writer(s);
  s.bought["crease-helper"] = true;
  let t = T0;
  while (!s.spawn.chain) {
    t += 1000;
    me.act({ t, type: "click", target: "sheet" });
  }
  const c = s.spawn.chain;
  const hits = s.stats.hits;
  const r = s.hand.r;
  const before = s.stats.bySource.node || 0;
  const V = engine.rates(s).V;
  const evs = [];
  for (let k = 1; k <= 9; k++) evs.push(...engine.advance(s, t + k * 1000));
  assert.equal(s.spawn.chain, null);
  assert.equal(evs.find((e) => e.kind === "chain").result, "done");
  close((s.stats.bySource.node || 0) - before, 0.5 * V * (2 * c.k + 3 * c.k), 1e-3);
  assert.equal(s.stats.hits, hits);
  assert.equal(s.hand.r, r);
});

test("scraps every 45 active s pay max(30·Rp, 50·V) · scrapMult", () => {
  const s = seeded(15);
  s.bought["scrap-basket"] = true;
  s.owned["paper-stack"] = 40;
  const me = writer(s);
  let t = T0;
  let sp = null;
  for (let k = 0; k < 60 && !sp; k++) {
    t += 1000;
    const ev = me.act({ t, type: "click", target: "sheet" });
    sp = ev.find((e) => e.kind === "spawn" && e.what === "scrap");
  }
  assert.ok(sp);
  assert.ok(Math.abs(s.spawn.activeMs - 45000) <= 1000);
  const r = engine.rates(s);
  const ev = me.act({ t: t + 500, type: "click", target: "scrap", id: sp.id });
  close(ev.find((e) => e.source === "scrap").amount, Math.max(30 * r.Rp, 50 * r.V) * 2, 1e-6);
});

test("the Paper Boat (Harbour Ribbon): Tailwind doubles the next 3 envelopes and pays 120·Rp", () => {
  const s = seeded(16);
  const me = writer(s);
  s.owned["paper-stack"] = 20;
  s.bank = 2e6;
  me.act({ t: T0, type: "buy", item: "harbour-ribbon", count: 1 });
  assert.ok(s.spawn.nextBoatAt >= 1800000 && s.spawn.nextBoatAt <= 2700000);
  s.spawn.nextBoatAt = 5000;
  let t = T0;
  let boat = null;
  while (!boat && t < T0 + 20000) {
    t += 1000;
    boat = me.act({ t, type: "click", target: "sheet" }).find((e) => e.kind === "spawn" && e.what === "boat");
  }
  assert.ok(boat);
  const Rp = engine.rates(s).Rp;
  const ev = me.act({ t: t + 100, type: "click", target: "boat", id: boat.id });
  close(ev.find((e) => e.source === "boat").amount, 120 * Rp, 1e-6);
  assert.equal(s.boosts.tailwind, 3);
  for (const id of ["a", "b", "c", "d"]) s.envelopes[id] = { type: "rush", units: 1, landedAt: t, lastAt: t };
  me.act({ t: t + 200, type: "open", helperId: "a" });
  assert.equal(s.boosts.rush, 60000);
  assert.equal(s.boosts.tailwind, 2);
  engine.advance(s, t + 11 * 60000); // an away segment: Tailwind's window is frozen
  assert.equal(s.boosts.tailwind, 2);
  for (let k = 1; k <= 22; k++) engine.advance(s, t + 11 * 60000 + k * 30000);
  assert.equal(s.boosts.tailwind, 0); // 10 min of live time ran out
});

test("calm mode doubles lives and changes no value", () => {
  const s = seeded();
  const a = engine.effects(s);
  s.settings.calm = true;
  const b = engine.effects(s);
  assert.equal(b.nodeLifeMs, 2 * a.nodeLifeMs);
  assert.equal(b.scrapLifeMs, 2 * a.scrapLifeMs);
  assert.equal(b.craneLifeMs, 2 * a.craneLifeMs);
  assert.equal(b.boatLifeMs, 2 * a.boatLifeMs);
  for (const k of ["G", "hand", "echo", "folk", "envMult", "durMult", "chainK", "chainEveryMs"]) assert.equal(b[k], a[k], k);
});

test("settings: dotted keys, validated values", () => {
  const s = seeded();
  const me = writer(s);
  me.act({ t: T0, type: "setting", key: "notify.master", value: true });
  me.act({ t: T0, type: "setting", key: "style", value: "sci" });
  assert.equal(s.settings.notify.master, true);
  assert.equal(s.settings.style, "sci");
  assert.equal(me.act({ t: T0, type: "setting", key: "style", value: "fancy" }).at(-1).reason, "value");
  assert.equal(me.act({ t: T0, type: "setting", key: "__proto__", value: true }).at(-1).reason, "setting");
  assert.equal(me.act({ t: T0, type: "setting", key: "toString", value: true }).at(-1).reason, "setting");
  assert.equal(me.act({ t: T0, type: "hint", key: "crane" }).length, 0);
  assert.equal(s.ui.hints.crane, true);
});

test("fledglings in the Album for 30 days fold into their parent", () => {
  const s = seeded();
  const me = writer(s);
  me.act(observeAction(T0, [agent(1, "working", 0), kid(2, 1, "working", 0)]));
  const kidId = engine.helperId("t2", 1002);
  s.helpers[kidId].stats.folds = 123;
  me.act(observeAction(T0 + 1000, [agent(1, "working", 0)]));
  assert.equal(s.helpers[kidId].gone, true);
  me.act(observeAction(T0 + 29 * 86400000, [agent(1, "working", 0)], { day: "2026-12-24" }));
  assert.ok(s.helpers[kidId]);
  me.act(observeAction(T0 + 31 * 86400000, [agent(1, "working", 0)], { day: "2026-12-26" }));
  assert.equal(s.helpers[kidId], undefined);
  const p = s.helpers[engine.helperId("t1", 1001)];
  assert.equal(p.stats.kidsPast, 1);
  assert.equal(p.stats.kidsFolds, 123);
});

test("r3-04: a fledgling whose parent's record left the save folds into its archive entry, or stays as a helper of its own, never dropped", () => {
  for (const withArchive of [true, false]) {
    const s = seeded();
    const me = writer(s);
    me.act(observeAction(T0, [agent(1, "working", 0), agent(3, "working", 0), kid(2, 1, "working", 0)]));
    const kidId = engine.helperId("t2", 1002);
    const pid = engine.helperId("t1", 1001);
    s.helpers[kidId].stats.folds = 123;
    me.act(observeAction(T0 + 1000, [agent(3, "working", 0)]));
    assert.equal(s.helpers[kidId].gone, true);
    // the parent's record merged into an Album archive entry (r3-04) and left the save
    delete s.helpers[pid];
    const aid = archiveId(T0 + 1000);
    if (withArchive) {
      s.helpers[aid] = {
        id: aid, kind: "pane", parent: null, species: "crane", hue: 0, name: "",
        joined: 0, status: "idle", lastTurn: 0, rest: 0, env: 0,
        stats: { tasks: 5, folds: 1000, run: 0, envelopes: 0, checkIns: 0 },
        missingSince: T0 + 1000, gone: true, archive: 2, from: T0,
      };
    }
    rosterChanged(s); // the records changed by hand
    me.act(observeAction(T0 + 31 * 86400000, [agent(3, "working", 0)], { day: "2026-12-26" }));
    if (withArchive) {
      assert.equal(s.helpers[kidId], undefined);
      assert.equal(s.helpers[aid].stats.kidsPast, 1);
      assert.equal(s.helpers[aid].stats.kidsFolds, 123);
    } else {
      const h = s.helpers[kidId];
      assert.ok(h, "kept in the save");
      assert.equal(h.kind, "pane");
      assert.equal(h.parent, null);
      assert.equal(h.gone, true);
      assert.equal(h.stats.folds, 123);
      assert.ok(engine.parseSave(engine.serialize(s)).ok);
    }
  }
});

test("checkin counts a visit; dismiss removes notices; unknown actions are ignored", () => {
  const s = seeded();
  const me = writer(s);
  me.act(observeAction(T0, [agent(1, "blocked", 0)]));
  const id = engine.helperId("t1", 1001);
  me.act({ t: T0 + 1, type: "checkin", helperId: id });
  assert.equal(s.helpers[id].stats.checkIns, 1);
  assert.equal(me.act({ t: T0 + 2, type: "teleport" }).at(-1).reason, "type");
  assert.equal(engine.apply(s, null)[0].reason, "shape");
  assert.equal(engine.apply(s, { w: 3, s: 1, type: "click" })[0].reason, "shape");
});

// Review r2-02: Mail Sorter and the wish open only Bundles, so Rush, Storm and
// Chorus envelopes of helpers long gone piled up for ever (≈ 88 B each), and
// opening one un-compacted its Album record for good. Now an envelope whose
// helper's record is compact (or no longer in the save) is cashed in, and a
// compact record changed after compaction is compacted again (§6.1, R13).
const waitingUnits = (s) => Object.values(s.envelopes).reduce((a, e) => a + e.units, 0);

test("envelopes of helpers compacted into the Album are cashed in; none piles up; no unit is lost (§6.1, R13, r2-02)", () => {
  const s = seeded(202);
  const me = writer(s);
  const K = engine.CONTENT.K;
  s.bought["mail-sorter"] = true;
  s.owned["paper-stack"] = 20;
  let t = T0;
  const total = K.albumKeep + 60;
  for (let k = 0; k < total; k++) {
    const a = agent(100 + k, "working", 0);
    me.act(observeAction((t += 1000), [a]));
    me.act(observeAction((t += 61000), [{ ...a, status: "idle", turn: 1 }])); // one task, one envelope
    me.act(observeAction((t += 1000), []));
    t += K.mailSorterMs;
    engine.advance(s, t); // Mail Sorter opens the Bundles; timed boosts wait for the player
  }
  const hs = Object.values(s.helpers);
  const compact = hs.filter((h) => h.compact);
  assert.equal(compact.length, total - K.albumKeep);
  // no envelope is left under a compact record, so the waiting ones are bounded by the full Album
  for (const id of Object.keys(s.envelopes)) assert.notEqual(s.helpers[id].compact, true, id);
  assert.ok(Object.keys(s.envelopes).length <= K.albumKeep);
  assert.ok(Object.keys(s.envelopes).length > 0, "the newest timed envelopes still wait for the player");
  // conservation (BALANCE inv. 9): created = opened + converted + waiting
  const v = s.stats.units;
  assert.ok(Math.abs(v.created - (v.opened + v.converted + waitingUnits(s))) < 1e-9);
  assert.ok(v.converted > 0, "timed envelopes of compacted helpers converted to folds");
  assert.ok((s.stats.bySource.overflow || 0) > 0);
  // the cash-in is said (review round 2: a "settled" kind had no view and never expired): an
  // overflow footer note, the same conversion, which the view shows and which expires
  const note = s.notices.find((n) => n.kind === "overflow" && n.data.settled === true);
  assert.ok(note && note.data.amount > 0 && note.data.count >= 1, JSON.stringify(s.notices));
  assert.ok(!s.notices.some((n) => n.kind === "settled"));
  const shown = engine.view(s, t, { writer: "wA" }).notices.filter((n) => n.at === note.at && n.kind === "overflow");
  assert.equal(shown.length, 1);
  assert.equal(shown[0].place, "footer");
  assert.match(shown[0].text, /^\+\S+ from a full envelope \((\d+ helpers long gone|[A-Z][a-z]+( \d+)?, long gone)\)$/);
  engine.advance(s, t + K.noteLifeMs + 1000);
  assert.ok(!s.notices.includes(note), "it expires like any footer note");
  // every compact record still packs, and the save round-trips
  const doc = JSON.parse(engine.serialize(s));
  for (const h of compact) assert.ok(Array.isArray(doc.state.helpers[h.id]), h.id);
  const back = engine.parseSave(engine.serialize(s));
  assert.equal(back.ok, true);
});

test("an envelope or check-in on a compact record (an older save) never keeps it whole: the next observation settles and re-compacts it (R13, r2-02)", () => {
  const s = seeded(203);
  const me = writer(s);
  const K = engine.CONTENT.K;
  s.owned["paper-stack"] = 20; // Rp > 0, so a settled envelope pays
  let t = T0;
  for (let k = 0; k < K.albumKeep + 3; k++) {
    me.act(observeAction((t += 1000), [agent(100 + k)]));
    me.act(observeAction((t += 1000), []));
  }
  const [a, b, c] = Object.values(s.helpers).filter((h) => h.compact);
  // an older save: envelopes filed under compact records (one gets opened by hand first)
  s.envelopes[a.id] = { type: "rush", units: 2, landedAt: t, lastAt: t };
  s.envelopes[b.id] = { type: "bundle", units: 1, landedAt: t, lastAt: t };
  s.envelopes.deadbeef = { type: "chorus", units: 1, landedAt: t, lastAt: t }; // no record at all
  s.stats.units.created += 4;
  me.act({ t: (t += 1000), type: "open", helperId: a.id });
  me.act({ t: (t += 1000), type: "checkin", helperId: c.id });
  // a notice of the build before this one, a kind the view never showed and nothing expired
  s.notices.push({ kind: "settled", at: t, data: { amount: 12, count: 1, name: "Pib" } });
  const bank = s.bank;
  me.act(observeAction((t += 1000), []));
  assert.deepEqual(Object.keys(s.envelopes), []);
  assert.ok(s.bank > bank, "the waiting ones were paid");
  assert.ok(!s.notices.some((n) => n.kind === "settled"), JSON.stringify(s.notices));
  const old = s.notices.find((n) => n.data && n.data.amount === 12);
  assert.deepEqual({ kind: old.kind, name: old.data.name, settled: old.data.settled }, { kind: "overflow", name: "Pib, long gone", settled: true });
  const now = s.notices.find((n) => n.data && n.data.settled && n.data.count === 2);
  assert.equal(now.data.name, "2 helpers long gone");
  for (const h of [a, b, c]) {
    assert.equal(h.compact, true);
    assert.equal(h.stats.envelopes, 0);
    assert.equal(h.stats.checkIns, 0);
    assert.equal(h.stats.run, 0);
  }
  const doc = JSON.parse(engine.serialize(s));
  for (const h of [a, b, c]) assert.ok(Array.isArray(doc.state.helpers[h.id]), h.id);
  const v = s.stats.units;
  assert.ok(Math.abs(v.created - (v.opened + v.converted + waitingUnits(s))) < 1e-9);
});

// Review r5-08: cashing in an envelope (or folding a fledgling) added a
// full-precision sum to a compact record, which compactChanged never caught,
// so its packed entry carried ≈ 10 more bytes ([0,32.75387861057565,…]).
const sig4 = (x) => (x === 0 ? 0 : Number(x.toPrecision(4)));

test("r5-08: folds cashed in or folded into a compact record keep its packed precision (4 significant digits)", () => {
  const s = seeded(508);
  const me = writer(s);
  const K = engine.CONTENT.K;
  s.owned["paper-stack"] = 23; // Rp > 0, so a settled envelope pays an odd amount
  let t = T0;
  // the first helper finishes a task (a timed envelope waits: no Mail Sorter) and has a fledgling
  me.act(observeAction((t += 1000), [agent(1), kid(2, 1)]));
  me.act(observeAction((t += 61000), [{ ...agent(1), status: "idle", raw: "idle", turn: 1 }, kid(2, 1)]));
  const pid = engine.helperId("t1", 1001);
  const kidId = engine.helperId("t2", 1002);
  s.helpers[kidId].stats.folds = 123.456789;
  me.act(observeAction((t += 1000), []));
  assert.ok(s.envelopes[pid] || Object.keys(s.envelopes).length === 0);
  const hadEnvelope = !!s.envelopes[pid];
  if (!hadEnvelope) s.envelopes[pid] = { type: "rush", units: 1.37, landedAt: t, lastAt: t };
  if (!hadEnvelope) s.stats.units.created += 1.37;
  // K.albumKeep more leave: the first record is compacted and its envelope cashed in in the same pass
  for (let k = 0; k < K.albumKeep; k++) {
    me.act(observeAction((t += 1000), [agent(100 + k)]));
    me.act(observeAction((t += 1000), []));
  }
  const p = s.helpers[pid];
  assert.equal(p.compact, true);
  assert.equal(s.envelopes[pid], undefined, "cashed in");
  const note = s.notices.find((n) => n.kind === "overflow" && n.data.settled === true);
  assert.ok(note && note.data.amount > 0);
  assert.notEqual(note.data.amount, sig4(note.data.amount), "the cash-in itself has more than 4 digits");
  assert.equal(p.stats.folds, sig4(p.stats.folds), `folds ${p.stats.folds}`);
  // the fledgling folds into its compact parent 30 days on: kidsFolds keeps 4 digits too
  me.act(observeAction((t += 31 * 86400000), [], { day: "2026-12-27" }));
  assert.equal(s.helpers[kidId], undefined);
  assert.equal(p.compact, true);
  assert.equal(p.stats.kidsPast, 1);
  assert.equal(p.stats.kidsFolds, sig4(123.456789));
  // what is saved is the record itself (R13: in memory = unpack(pack)), at 4 digits
  const text = engine.serialize(s);
  const a = JSON.parse(text).state.helpers[pid];
  assert.ok(Array.isArray(a));
  assert.equal(a[1], p.stats.folds);
  assert.equal(a[5], p.stats.kidsFolds);
  for (const x of [a[1], a[5]]) assert.ok(String(x).replace(/e.*$/, "").replace(/[-.]/g, "").replace(/^0+/, "").length <= 4, String(x));
  const back = engine.parseSave(text);
  assert.equal(back.ok, true);
  assert.equal(engine.serialize(back.state), text);
  const v = s.stats.units;
  assert.ok(Math.abs(v.created - (v.opened + v.converted + waitingUnits(s))) < 1e-9);
});

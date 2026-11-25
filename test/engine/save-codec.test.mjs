// Save codec (ARCHITECTURE A4): envelope, check, MAP rebuild, damaged inputs, size.
import { test } from "node:test";
import assert from "node:assert/strict";
import { engine, seeded, writer, agent, kid, observeAction, T0 } from "./_util.mjs";
import { SAVE_VERSION } from "../../mods/creaseworks/engine/save-codec.js";

function played() {
  const s = seeded(21);
  const me = writer(s);
  me.act(observeAction(T0, [agent(1, "working", 0), agent(2, "idle", 0), kid(3, 1, "working", 0)]));
  for (let i = 0; i < 50; i++) me.act({ t: T0 + 1000 + i * 600, type: "click", target: "sheet" });
  me.act(observeAction(T0 + 40000, [agent(1, "idle", 1), agent(2, "idle", 0), kid(3, 1, "idle", 1)]));
  me.act({ t: T0 + 41000, type: "buy", item: "paper-stack", count: 1 });
  engine.advance(s, T0 + 5 * 3600000);
  return s;
}

test("serialize: format, version, FNV-1a check over the canonical state; round trip is exact", () => {
  const s = played();
  const text = engine.serialize(s);
  const doc = JSON.parse(text);
  assert.equal(doc.format, "creaseworks-save");
  assert.equal(doc.version, SAVE_VERSION);
  assert.equal(doc.state.version, engine.VERSION);
  assert.equal(doc.check, engine.fnv1a32(JSON.stringify(doc.state)));
  assert.match(doc.check, /^[0-9a-f]{8}$/);
  const back = engine.parseSave(text);
  assert.equal(back.ok, true);
  assert.equal(engine.serialize(back.state), text);
  for (const path of engine.MAP_FIELDS) {
    const v = path.split(".").reduce((o, k) => o[k], back.state);
    assert.equal(Object.getPrototypeOf(v), null, path);
  }
  // the parsed state keeps playing like the original
  const a = engine.cloneState(s);
  engine.advance(a, a.clock + 30000);
  engine.advance(back.state, back.state.clock + 30000);
  assert.equal(engine.serialize(back.state), engine.serialize(a));
});

test("damaged inputs are reported, never thrown (A4, A12)", () => {
  const good = engine.serialize(played());
  const cases = [
    ["{{{not json", "parse"],
    ["null", "format"],
    ["42", "format"],
    ['"old shape"', "format"],
    ["[]", "format"],
    ["", "parse"],
    [good.slice(0, Math.floor(good.length / 2)), "parse"],
    [good.slice(0, -1), "parse"],
    ['{"format":"other-save","version":1,"check":"00000000","state":{}}', "format"],
    ['{"format":"creaseworks-save","version":1,"check":"00000000","state":[]}', "format"],
  ];
  for (const [text, reason] of cases) {
    const r = engine.parseSave(text);
    assert.equal(r.ok, false, text.slice(0, 20));
    assert.equal(r.reason, reason, text.slice(0, 20));
  }
  assert.equal(engine.parseSave(undefined).reason, "parse");
  // bad check: one digit of the bank changed
  const doc = JSON.parse(good);
  doc.state.bank += 1;
  assert.equal(engine.parseSave(JSON.stringify(doc)).reason, "check");
  const doc2 = JSON.parse(good);
  doc2.check = doc2.check === "00000000" ? "00000001" : "00000000";
  assert.equal(engine.parseSave(JSON.stringify(doc2)).reason, "check");
});

test("the file format is 2 (packed Album entries): a format-1 build reads it as newer, never as damaged (R13)", () => {
  // Builds before Album compaction compare the envelope version with their own
  // VERSION (1): "newer" means read-only and never written, where "shape" would
  // restore the backup and write it over this save (a rollback).
  assert.equal(SAVE_VERSION, 2);
  assert.ok(SAVE_VERSION > engine.VERSION);
  const doc = JSON.parse(engine.serialize(played()));
  assert.ok(doc.version > 1);
  // a format-1 file (no packed entries, or one written while the format was still 1) still loads
  const s = played();
  const v1 = engine.serialize(s).replace(`"version":${SAVE_VERSION},`, '"version":1,');
  const back = engine.parseSave(v1);
  assert.equal(back.ok, true);
  assert.equal(back.state.bank, s.bank);
  // a format newer than this build's is read-only
  const v3 = engine.serialize(s).replace(`"version":${SAVE_VERSION},`, `"version":${SAVE_VERSION + 1},`);
  assert.equal(engine.parseSave(v3).reason, "newer");
  assert.equal(engine.parseSave(v3).state.bank, s.bank);
});

test("a newer version is detected (state kept for read-only display); migrate() refuses it", () => {
  const s = played();
  const newer = { ...JSON.parse(engine.serialize(s)) };
  newer.version = SAVE_VERSION + 1;
  newer.state.version = engine.VERSION + 1;
  newer.check = engine.fnv1a32(JSON.stringify(newer.state));
  const r = engine.parseSave(JSON.stringify(newer));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "newer");
  assert.equal(r.state.bank, s.bank);
  assert.equal(Object.getPrototypeOf(r.state.helpers), null);
  assert.throws(() => engine.migrate(r.state), RangeError);
});

test("shape validation: a well-formed envelope around a wrong state is 'shape'", () => {
  const wrap = (state) => JSON.stringify({ format: "creaseworks-save", version: 1, check: engine.fnv1a32(JSON.stringify(state)), state });
  assert.equal(engine.parseSave(wrap({ version: 1 })).reason, "shape");
  const s = JSON.parse(engine.serialize(played())).state;
  for (const mutate of [
    (x) => { x.helpers = []; },
    (x) => { x.bank = "lots"; },
    (x) => { x.bank = -5; },
    (x) => { x.envelopes.zz = { type: "gold", units: 1 }; },
    (x) => { x.owned["paper-stack"] = -1; },
    (x) => { const id = Object.keys(x.helpers)[0]; x.helpers[id].id = "other"; },
    (x) => { delete x.spawn; },
    (x) => { x.notices = {}; },
  ]) {
    const y = JSON.parse(JSON.stringify(s));
    mutate(y);
    assert.equal(engine.parseSave(wrap(y)).reason, "shape");
  }
  // missing optional fields are filled by migrate (older saves load)
  const y = JSON.parse(JSON.stringify(s));
  delete y.ui;
  delete y.autoAt;
  y.ui = { hints: {} };
  const r = engine.parseSave(wrap(y));
  assert.equal(r.ok, true);
  assert.equal(r.state.ui.hints.fold, false);
  assert.equal(r.state.autoAt.fox, 0);
});

test("prototype-named keys survive the codec in every MAP field", () => {
  const s = played();
  for (const k of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    s.applied[k] = 3;
    s.writersSeen[k] = T0;
    s.stats.bySource[k] = 1;
  }
  const text = engine.serialize(s);
  const r = engine.parseSave(text);
  assert.equal(r.ok, true);
  assert.equal(Object.getPrototypeOf(r.state.applied), null);
  assert.equal(r.state.applied.__proto__, 3);
  assert.equal(r.state.applied.constructor, 3);
  assert.equal(engine.serialize(r.state), text);
  // a writer named "__proto__" is idempotent like any other
  assert.equal(engine.apply(r.state, { w: "__proto__", s: 3, t: r.state.clock, type: "hint", key: "fold" })[0].reason, "applied");
});

test("64 present helpers plus 500 Album helpers save in < 256 KiB (inv. 7)", () => {
  const s = seeded(31);
  // realistic identities: herdr addresses, 13-digit created_ms, glue writer ids
  const me = writer(s, "w-7f3a9c2e41");
  const real = (i, status, turn, extra) => agent(i, status, turn, { addr: `w${i % 9}:t${i}`, created: T0 - 86400000 + i * 997, ...extra });
  let t = T0;
  // 500 helpers that came and went, each with a task done and its envelope opened
  for (let batch = 0; batch < 10; batch++) {
    const list = Array.from({ length: 50 }, (_, i) => real(10000 + batch * 50 + i, "working", 0, {
      title: "claude · refactor the payment module 👩🏽‍💻 and add tests for the edge cases",
    }));
    me.act(observeAction((t += 1000), list));
    me.act(observeAction((t += 61000), list.map((o) => ({ ...o, turn: 1, status: "idle" }))));
    for (const id of Object.keys(s.envelopes)) me.act({ t, type: "open", helperId: id });
    me.act(observeAction((t += 1000), []));
  }
  const present = Array.from({ length: 64 }, (_, i) => real(i, i % 3 ? "working" : "idle", 0, {
    title: "codex · fix the flaky integration test in the billing service 🧪🔥",
  }));
  const kids = Array.from({ length: 32 }, (_, i) => real(200 + i, "working", 0, { kind: "kid", pane: null, parent: `w${i % 9}:t${i}` }));
  me.act(observeAction((t += 1000), [...present, ...kids]));
  me.act(observeAction((t += 61000), [...present.map((o) => ({ ...o, turn: 3 })), ...kids.map((o) => ({ ...o, turn: 2 }))]));
  engine.advance(s, t + 30000);
  const hs = Object.values(s.helpers);
  assert.equal(hs.filter((h) => h.gone).length, 500);
  assert.equal(hs.filter((h) => !h.gone && h.kind === "pane").length, 64);
  assert.equal(hs.filter((h) => !h.gone && h.kind === "kid").length, 32);
  assert.equal(Object.keys(s.envelopes).length, 64);
  const text = engine.serialize(s);
  assert.ok(text.length < 256 * 1024, `${text.length} bytes`);
  assert.equal(engine.parseSave(text).ok, true);
});

// --- Album compaction (DESIGN R13; review r1-02) -----------------------------

/** `days` of churn: `perDay` pane agents a day, each with `kids` fledglings, a task each, then gone. */
function churn(s, me, days, perDay = 20, kids = 3) {
  const ag = (i, extra = {}) => agent(i, "working", 0, { addr: `w1:t${i}`, created: T0 + i * 997, title: "claude · refactor the payment module", ...extra });
  let t = s.clock;
  let n = 0;
  for (let d = 0; d < days; d++) {
    const list = [];
    for (let k = 0; k < perDay; k++) {
      const i = n++;
      list.push(ag(i));
      for (let j = 0; j < kids; j++) list.push(ag(1e6 + i * kids + j, { kind: "kid", pane: null, parent: `w1:t${i}` }));
    }
    me.act(observeAction((t += 1000), list));
    me.act(observeAction((t += 3600000), list.map((o) => ({ ...o, turn: 2, status: "idle" }))));
    for (const id of Object.keys(s.envelopes)) me.act({ t, type: "open", helperId: id });
    me.act(observeAction((t += 1000), []));
    t = T0 + (d + 1) * 86400000;
    engine.advance(s, t);
  }
  return n;
}

test("Album compaction: old gone helpers are packed, never dropped, and a round trip is exact (R13)", () => {
  const s = seeded(41);
  const me = writer(s, "w-7f3a9c2e41");
  const panes = churn(s, me, 20, 20, 1);
  const hs = Object.values(s.helpers);
  const K = engine.CONTENT.K;
  // every pane agent is still a saved helper; only the newest K.albumKeep keep full records
  assert.equal(hs.filter((h) => h.kind === "pane" && h.gone).length, panes);
  assert.equal(hs.filter((h) => h.kind === "pane" && h.gone && !h.compact).length, K.albumKeep);
  assert.equal(hs.filter((h) => h.kind === "kid").length, K.kidAlbumKeep);
  const compact = hs.filter((h) => h.compact);
  assert.equal(compact.length, panes - K.albumKeep);
  // the oldest are the compacted ones; their folds from the fledglings that folded in stay
  const newestCompact = Math.max(...compact.map((h) => h.missingSince));
  const oldestFull = Math.min(...hs.filter((h) => h.kind === "pane" && h.gone && !h.compact).map((h) => h.missingSince));
  assert.ok(newestCompact <= oldestFull);
  assert.ok(compact.every((h) => h.stats.tasks === 1 && h.stats.kidsPast === 1));
  const text = engine.serialize(s);
  const doc = JSON.parse(text);
  const packed = Object.values(doc.state.helpers).filter(Array.isArray);
  assert.equal(packed.length, compact.length);
  assert.ok(packed.every((a) => a.length === 4 || a.length === 6));
  assert.equal(doc.check, engine.fnv1a32(JSON.stringify(doc.state)));
  const back = engine.parseSave(text);
  assert.equal(back.ok, true);
  assert.equal(engine.serialize(back.state), text);
  // in memory a compact record is exactly what loading it gives (merge and reload change nothing)
  for (const h of compact) assert.deepEqual({ ...back.state.helpers[h.id] }, { ...h });
  const a = engine.cloneState(s);
  const z = writer(a, "w-7f3a9c2e41");
  const zb = writer(back.state, "w-7f3a9c2e41");
  for (let k = 0; k < 500; k++) { z.make({}); zb.make({}); } // same sequence numbers
  const more = [observeAction(a.clock + 1000, [agent(7, "working", 0)]), observeAction(a.clock + 2000, [])];
  for (const x of more) { z.act(x); zb.act(x); }
  engine.advance(a, a.clock + 60000);
  engine.advance(back.state, back.state.clock + 60000);
  assert.equal(engine.serialize(back.state), engine.serialize(a));
  // the Album still lists every one of them
  const vm = engine.view(s, s.clock, { writer: "w-7f3a9c2e41" });
  assert.equal(vm.helpers.albumCount, panes);
});

test("a compacted helper whose agent returns rejoins with its name and stats; its turn is rebaselined (R13)", () => {
  const s = seeded(42);
  const me = writer(s);
  const K = engine.CONTENT.K;
  let t = T0;
  const first = agent(1, "working", 3);
  me.act(observeAction((t += 1000), [first]));
  me.act(observeAction((t += 61000), [{ ...first, turn: 4, status: "idle" }]));
  for (const id of Object.keys(s.envelopes)) me.act({ t, type: "open", helperId: id });
  me.act(observeAction((t += 1000), []));
  const id = engine.helperId("t1", 1001);
  const name = s.helpers[id].name;
  for (let k = 0; k < K.albumKeep; k++) {
    me.act(observeAction((t += 1000), [agent(100 + k)]));
    me.act(observeAction((t += 1000), []));
  }
  assert.equal(s.helpers[id].compact, true);
  assert.equal(s.helpers[id].stats.tasks, 1);
  // what compaction gives up (DESIGN R13): the stored rest boost, this run's share, the join time
  assert.equal(s.helpers[id].rest, 0);
  assert.equal(s.helpers[id].stats.run, 0);
  assert.equal(s.helpers[id].joined, 0);
  const units = s.stats.units.created;
  me.act(observeAction((t += 1000), [agent(500), { ...first, turn: 9, status: "working" }]));
  const h = s.helpers[id];
  assert.equal(h.gone, false);
  assert.equal(h.compact, undefined);
  assert.equal(h.name, name);
  assert.equal(h.stats.tasks, 1);
  assert.equal(h.lastTurn, 9);
  // it rejoins as the newest in join order, not ahead of every present helper
  assert.equal(h.joined, t);
  const present = Object.values(s.helpers).filter((x) => !x.gone);
  assert.equal(present.length, 2);
  assert.ok(present.every((x) => x.joined <= h.joined));
  assert.equal(s.stats.units.created, units, "no reward for the turns it did while compacted");
  me.act(observeAction((t += 61000), [{ ...first, turn: 10, status: "idle" }]));
  assert.equal(h.stats.tasks, 2);
});

test("a compact record changed after compaction is saved whole; a malformed packed entry is 'shape' (R13)", () => {
  const s = seeded(43);
  const me = writer(s);
  const K = engine.CONTENT.K;
  let t = T0;
  for (let k = 0; k < K.albumKeep + 3; k++) {
    me.act(observeAction((t += 1000), [agent(100 + k)]));
    me.act(observeAction((t += 1000), []));
  }
  const c = Object.values(s.helpers).filter((h) => h.compact);
  assert.equal(c.length, 3);
  me.act({ t: (t += 1000), type: "checkin", helperId: c[0].id }); // touches a field the packed form drops
  const text = engine.serialize(s);
  const doc = JSON.parse(text);
  assert.equal(Array.isArray(doc.state.helpers[c[0].id]), false);
  assert.equal(Array.isArray(doc.state.helpers[c[1].id]), true);
  const back = engine.parseSave(text);
  assert.equal(back.ok, true);
  assert.equal(back.state.helpers[c[0].id].stats.checkIns, 1);
  assert.equal(engine.serialize(back.state), text);
  // a damaged packed entry with a matching check is a shape error, never a throw
  for (const bad of [[], ["x"], [0, "1", 1, 1], [0, 1, 1, 1, 0, 0], ["", 1, 1, 1]]) {
    const st = JSON.parse(JSON.stringify(doc.state));
    st.helpers[c[1].id] = bad;
    const body = JSON.stringify(st);
    const forged = `{"format":"creaseworks-save","version":${engine.VERSION},"check":"${engine.fnv1a32(body)}","state":${body}}`;
    assert.equal(engine.parseSave(forged).reason, "shape", JSON.stringify(bad));
  }
});

test("compaction skips a gone record whose id is not an engine id (legacy or hand-edited save): it stays whole (R13)", () => {
  const s = seeded(44);
  const me = writer(s);
  const K = engine.CONTENT.K;
  let t = T0;
  for (let k = 0; k < K.albumKeep; k++) {
    me.act(observeAction((t += 1000), [agent(100 + k)]));
    me.act(observeAction((t += 1000), []));
  }
  // re-key the three oldest Album records under ids validateState accepts but unpackAlbum does not
  const doc = JSON.parse(engine.serialize(s));
  const oldest = Object.values(doc.state.helpers).sort((a, b) => a.missingSince - b.missingSince).slice(0, 3);
  const legacy = oldest.map((h, i) => {
    delete doc.state.helpers[h.id];
    h.id = `legacy-${i}`;
    doc.state.helpers[h.id] = h;
    return h;
  });
  const body = JSON.stringify(doc.state);
  const loaded = engine.parseSave(`{"format":"creaseworks-save","version":${engine.VERSION},"check":"${engine.fnv1a32(body)}","state":${body}}`);
  assert.equal(loaded.ok, true);
  const st = loaded.state;
  const me2 = writer(st, "wB");
  for (let k = 0; k < 3; k++) {
    me2.act(observeAction((t += 1000), [agent(900 + k)]));
    me2.act(observeAction((t += 1000), []));
  }
  for (const h of legacy) {
    const x = st.helpers[h.id];
    assert.equal(x.compact, undefined, h.id);
    assert.equal(x.id, h.id);
    assert.equal(x.name, h.name);
    assert.equal(x.stats.tasks, h.stats.tasks);
  }
  // the engine-made ones beyond albumKeep are still compacted, and everything round-trips
  assert.equal(Object.values(st.helpers).filter((h) => h.compact).length, 3);
  const text = engine.serialize(st);
  const back = engine.parseSave(text);
  assert.equal(back.ok, true);
  assert.equal(engine.serialize(back.state), text);
  assert.equal(engine.view(st, st.clock, { writer: "wB" }).helpers.albumCount, K.albumKeep + 3);
});

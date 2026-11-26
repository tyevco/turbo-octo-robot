// Save codec (ARCHITECTURE A4): envelope, check, MAP rebuild, damaged inputs, size.
import { test } from "node:test";
import assert from "node:assert/strict";
import { engine, seeded, writer, agent, kid, observeAction, T0 } from "./_util.mjs";
import { SAVE_VERSION, saveCheck } from "../../mods/creaseworks/engine/save-codec.js";
import { jsonBytes, saveBytes } from "../../mods/creaseworks/engine/helpers.js";

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

/** The format 3 check, written out from its definition (DESIGN R13): rest + "\n" + chunk digests. */
function checkByHand(state) {
  const ids = Object.keys(state.helpers);
  let digests = "";
  let cur = {};
  let n = 0;
  for (const id of ids) {
    cur[id] = state.helpers[id];
    n++;
    if ((parseInt(id.slice(-2), 16) & 63) === 0) {
      digests += engine.fnv1a32(JSON.stringify(cur));
      cur = {};
      n = 0;
    }
  }
  if (n) digests += engine.fnv1a32(JSON.stringify(cur));
  const rest = JSON.stringify({ ...state, helpers: "\u0001helpers" });
  return engine.fnv1a32(`${rest}\n${digests}`);
}

/** A file of format 1 or 2 (check = FNV-1a 32 of the whole state text) for the same state. */
function oldFormat(text, version) {
  const doc = JSON.parse(text);
  const body = JSON.stringify(doc.state);
  return `{"format":"creaseworks-save","version":${version},"check":"${engine.fnv1a32(body)}","state":${body}}`;
}

test("serialize: format, version, chunked FNV-1a check over the canonical state; round trip is exact", () => {
  const s = played();
  const text = engine.serialize(s);
  const doc = JSON.parse(text);
  assert.equal(doc.format, "creaseworks-save");
  assert.equal(doc.version, SAVE_VERSION);
  assert.equal(doc.state.version, engine.VERSION);
  assert.equal(doc.check, checkByHand(doc.state));
  assert.equal(doc.check, saveCheck(doc.state));
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

test("the file format is 4 (chunked check, keyed Album entries, archives); formats 1-3 still load; a newer one is read-only, never damaged (R13)", () => {
  // Builds before Album compaction compare the envelope version with their own
  // VERSION (1): "newer" means read-only and never written, where "shape" would
  // restore the backup and write it over this save (a rollback).
  assert.equal(SAVE_VERSION, 4);
  assert.ok(SAVE_VERSION > engine.VERSION);
  const s = played();
  const text = engine.serialize(s);
  assert.equal(JSON.parse(text).version, 4);
  // a format-3 file (chunked check, the same rule) still loads, to the same game
  const v3 = text.replace(`"version":4,`, `"version":3,`);
  assert.equal(engine.parseSave(v3).ok, true);
  assert.equal(engine.serialize(engine.parseSave(v3).state), text);
  // format-1 and format-2 files (whole-text check) still load, to the same game
  for (const v of [1, 2]) {
    const back = engine.parseSave(oldFormat(text, v));
    assert.equal(back.ok, true, `format ${v}`);
    assert.equal(engine.serialize(back.state), text, `format ${v}`);
    // a damaged one is still caught
    assert.equal(engine.parseSave(oldFormat(text, v).replace(`"bank":${s.bank}`, `"bank":${s.bank + 1}`)).reason, "check");
  }
  // a format-3 file with the old whole-text check is damaged, not trusted
  assert.equal(engine.parseSave(oldFormat(text, 3)).reason, "check");
  // a format newer than this build's is read-only: with the same check rule its state shows,
  // with a check this build cannot verify it is still "newer" (never restored over)
  const v4 = text.replace(`"version":${SAVE_VERSION},`, `"version":${SAVE_VERSION + 1},`);
  assert.equal(engine.parseSave(v4).reason, "newer");
  assert.equal(engine.parseSave(v4).state.bank, s.bank);
  const v4other = oldFormat(text, SAVE_VERSION + 1);
  assert.equal(engine.parseSave(v4other).reason, "newer");
  assert.equal(engine.parseSave(v4other).state, undefined);
});

test("a newer version is detected (state kept for read-only display); migrate() refuses it", () => {
  const s = played();
  const newer = { ...JSON.parse(engine.serialize(s)) };
  newer.version = SAVE_VERSION + 1;
  newer.state.version = engine.VERSION + 1;
  newer.check = saveCheck(newer.state);
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
  // name, folds, tasks, minute, kidsPast, kidsFolds, then the terminal key (r3-18)
  assert.ok(packed.every((a) => a.length === 7 && Number.isInteger(a[6]) && a[6] >= 0 && a[6] <= 0xffff));
  assert.equal(doc.check, checkByHand(doc.state));
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
  // the Album still lists every one of them: each pane agent and its one fledgling,
  // whether the fledgling keeps its own record or is folded into its parent (r5-16)
  const vm = engine.view(s, s.clock, { writer: "w-7f3a9c2e41" });
  const kidsPast = hs.reduce((a, h) => a + (h.gone && h.stats && h.stats.kidsPast > 0 ? h.stats.kidsPast : 0), 0);
  assert.equal(kidsPast + hs.filter((h) => h.kind === "kid" && h.gone).length, panes);
  assert.equal(vm.helpers.albumCount, panes * 2);
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

test("a compact record changed after compaction is saved whole until the next observation compacts it again; a malformed packed entry is 'shape' (R13)", () => {
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
  // review r2-02: it does not stay whole for good, the next observation compacts it again
  me.act(observeAction((t += 1000), []));
  assert.equal(Array.isArray(JSON.parse(engine.serialize(s)).state.helpers[c[0].id]), true);
  assert.equal(c[0].stats.checkIns, 0);
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

// --- Save cost (review r2-01): the chunked check and its digest cache --------

test("FNV-1a 32 matches a TextEncoder reference over ASCII, multi-byte, emoji and lone surrogates", () => {
  const ref = (s) => {
    let h = 0x811c9dc5;
    for (const b of new TextEncoder().encode(s)) h = Math.imul(h ^ b, 0x01000193);
    return h >>> 0;
  };
  const parts = ["", "a", "Z~", "\u0000", "é", "€", "߿", "ࠀ", "￿", "😀", "👩🏽‍💻", "\ud800", "\udc00", "\udbff", "x\ud83dy", "\ud83d"];
  for (const a of parts) for (const b of parts) for (const c of ["", "q", "\ud83d"]) {
    const s = a + b + c;
    assert.equal(engine.fnv1a32n(s), ref(s), JSON.stringify(s));
  }
  assert.equal(engine.fnv1a32n("x".repeat(100000)), ref("x".repeat(100000)));
});

test("the digest cache never changes a save: after any change the text equals a fresh serialisation's (r2-01)", () => {
  const s = seeded(51);
  const me = writer(s, "w-7f3a9c2e41");
  const K = engine.CONTENT.K;
  churn(s, me, 15, 20, 1);
  const a = engine.serialize(s);
  assert.equal(engine.serialize(s), a, "unchanged state, same text");
  assert.equal(engine.serialize(engine.cloneState(s)), a, "cloneState drops the cache, same text");
  // change an old compact record (deep in the Album), a whole Album record and a present one
  const hs = Object.values(s.helpers);
  const compact = hs.find((h) => h.compact);
  const full = hs.find((h) => h.gone && !h.compact && h.kind === "pane");
  compact.stats.folds += 1;
  full.stats.tasks += 1;
  me.act(observeAction(s.clock + 1000, [agent(9001)]));
  const b = engine.serialize(s);
  assert.notEqual(b, a);
  assert.equal(b, engine.serialize(engine.cloneState(s)));
  const back = engine.parseSave(b);
  assert.equal(back.ok, true);
  assert.equal(back.state.helpers[compact.id].stats.folds, compact.stats.folds);
  // the parsed state carries the digests it verified: its next save is the same text
  assert.equal(engine.serialize(back.state), b);
  // a damaged digit inside one Album chunk is still caught
  const i = b.indexOf(`"${compact.id}":[`);
  const j = b.indexOf("]", i);
  const entry = b.slice(i, j + 1);
  const bad = b.replace(entry, entry.replace(/,(\d)/, (m, d) => `,${(Number(d) + 1) % 10}`));
  assert.notEqual(bad, b);
  assert.equal(engine.parseSave(bad).reason, "check");
  assert.ok(hs.length > 2 * K.albumKeep);
});

test("chunked check: integer-like, zero and prototype-named helper ids round-trip exactly (r2-01)", () => {
  const s = played();
  const one = Object.values(s.helpers)[0];
  for (const id of ["12345678", "00000000", "00000040", "__proto__", "constructor", "ffffff00"]) {
    s.helpers[id] = { ...JSON.parse(JSON.stringify(one)), id, gone: true, missingSince: s.clock };
  }
  const text = engine.serialize(s);
  const doc = JSON.parse(text);
  assert.equal(doc.check, saveCheck(doc.state));
  const back = engine.parseSave(text);
  assert.equal(back.ok, true);
  assert.equal(engine.serialize(back.state), text);
  assert.equal(engine.serialize(engine.cloneState(back.state)), text);
  assert.equal(back.state.helpers.__proto__.id, "__proto__");
});

// Review r2-01 (memory across hot reload): the digest cache rides on the live
// state, which the slot hands to the next code generation. It is plain data
// under a registry symbol, so a reload's first save replaces it instead of
// leaving the old generation's cache (≈ the save's size) behind for good.
test("the digest cache is one plain-data, non-enumerable entry across code generations; an older build's orphan is dropped (r2-01)", async () => {
  const gen2 = await import("../../mods/creaseworks/engine/save-codec.js?generation-2");
  assert.notEqual(gen2.serialize, engine.serialize, "a second module instance");
  const s = seeded(61);
  const me = writer(s, "w-0a1b2c3d4e");
  churn(s, me, 3, 10, 1);
  // a build before this one cached under a symbol of its own generation
  const ORPHAN = Symbol("creaseworks/save-digests");
  s[ORPHAN] = new Map([["x", "00000000"]]);
  s[Symbol("creaseworks/helper-index")] = { map: null, present: [], panes: [] };
  delete s[Symbol.for("creaseworks/helper-index")];
  const a = engine.serialize(s);
  const b = gen2.serialize(s);
  assert.equal(b, a);
  me.act(observeAction(s.clock + 1000, [agent(4242)]));
  const c = gen2.serialize(s);
  assert.equal(engine.serialize(s), c);
  assert.equal(c, engine.serialize(engine.cloneState(s)));
  // the engine's caches on the state: one each, under registry symbols (the helper index too, helpers.js)
  const all = Object.getOwnPropertySymbols(s);
  assert.deepEqual(all.map((k) => Symbol.keyFor(k)).sort(), ["creaseworks/helper-index", "creaseworks/save-digests"], "one of each, the orphans gone");
  for (const k of all) assert.equal(Object.getOwnPropertyDescriptor(s, k).enumerable, false);
  const { indexHelpers } = await import("../../mods/creaseworks/engine/helpers.js");
  const idx = indexHelpers(s);
  assert.equal(s[Symbol.for("creaseworks/helper-index")], idx);
  assert.equal(Object.getPrototypeOf(idx), null);
  assert.ok(Array.isArray(idx.present) && Array.isArray(idx.panes));
  const syms = [Symbol.for("creaseworks/save-digests")];
  const d = Object.getOwnPropertyDescriptor(s, syms[0]);
  assert.equal(d.enumerable, false);
  const cache = d.value;
  // plain data only (glue/live.js slot contract): no Map, no class instance
  assert.equal(Object.getPrototypeOf(cache), null);
  assert.deepEqual(Object.keys(cache).sort(), ["digests", "rule", "texts"]);
  assert.equal(cache.rule, SAVE_VERSION);
  assert.ok(Array.isArray(cache.texts) && cache.texts.every((x) => typeof x === "string"));
  assert.ok(cache.digests.every((x) => /^[0-9a-f]{8}$/.test(x)));
  assert.equal(cache.texts.length, cache.digests.length);
  assert.equal(JSON.parse(JSON.stringify(cache)).texts.length, cache.texts.length, "survives a JSON round trip");
  // a cache of another rule is ignored (never trusted), then replaced
  cache.rule = SAVE_VERSION + 1;
  cache.digests = cache.digests.map(() => "deadbeef");
  assert.equal(engine.serialize(s), c);
  assert.equal(s[syms[0]].rule, SAVE_VERSION);
});

// Review r2-01 (residual budget): a load or a CAS merge parses and verifies the
// whole save; parseSaveSteps splits that work so the glue can yield between
// task steps (the QuickJS timing is in test/qjs/creaseworks.test.mjs).
test("parseSaveSteps gives parseSave's result for every kind of input, in steps of at most STEP_HELPERS helpers (r2-01)", async () => {
  const { parseSaveSteps, STEP_HELPERS } = await import("../../mods/creaseworks/engine/save-codec.js");
  const run = (text) => {
    const it = parseSaveSteps(text);
    let n = 0;
    let r = it.next();
    while (!r.done) {
      n++;
      r = it.next();
    }
    return { r: r.value, n };
  };
  const s = seeded(71);
  const me = writer(s, "w-5e6f7a8b9c");
  churn(s, me, 40, 100, 1);
  const n = Object.keys(s.helpers).length;
  assert.ok(n > 2 * STEP_HELPERS, `${n} helpers`);
  const text = engine.serialize(s);
  const doc = JSON.parse(text);
  const newerDoc = { ...doc, version: SAVE_VERSION + 1 };
  const flip = text.replace(/"folds":(\d)/, (m, d) => `"folds":${(Number(d) + 1) % 10}`);
  const cases = {
    ok: text,
    old1: oldFormat(text, 1),
    old2: oldFormat(text, 2),
    newer: JSON.stringify(newerDoc),
    newerUnverified: JSON.stringify({ ...newerDoc, check: "00000000" }),
    newerState: (() => {
      const st = { ...doc.state, version: engine.VERSION + 1 };
      return `{"format":"creaseworks-save","version":${SAVE_VERSION},"check":"${saveCheck(st)}","state":${JSON.stringify(st)}}`;
    })(),
    check: flip,
    parse: text.slice(0, -10),
    format: '{"format":"other","version":3,"check":"x","state":{}}',
    shape: (() => {
      const st = { ...doc.state, bank: -1 };
      return `{"format":"creaseworks-save","version":${SAVE_VERSION},"check":"${saveCheck(st)}","state":${JSON.stringify(st)}}`;
    })(),
    badPacked: (() => {
      const st = JSON.parse(JSON.stringify(doc.state));
      const id = Object.keys(st.helpers).find((k) => Array.isArray(st.helpers[k]));
      st.helpers[id] = [0, 1];
      return `{"format":"creaseworks-save","version":${SAVE_VERSION},"check":"${saveCheck(st)}","state":${JSON.stringify(st)}}`;
    })(),
    notText: 42,
  };
  for (const [name, input] of Object.entries(cases)) {
    const whole = engine.parseSave(input);
    const { r, n: steps } = run(input);
    assert.equal(r.ok, whole.ok, name);
    assert.equal(r.reason, whole.reason, name);
    assert.equal(Boolean(r.state), Boolean(whole.state), name);
    if (r.state) assert.equal(engine.canonicalState(r.state), engine.canonicalState(whole.state), name);
    if (name === "ok") {
      assert.equal(engine.serialize(r.state), text);
      // the check, the unpacking and the validation each yield every STEP_HELPERS helpers
      assert.ok(steps >= 3 * Math.floor(n / STEP_HELPERS), `${steps} steps for ${n} helpers`);
    }
  }
  assert.equal(engine.parseSave(cases.newer).reason, "newer");
  assert.ok(engine.parseSave(cases.newer).state, "a verified newer file is shown read-only");
  assert.equal(engine.parseSave(cases.newerUnverified).reason, "newer", "an unverifiable newer file is never 'damaged'");
  assert.equal(engine.parseSave(cases.newerState).reason, "newer");
  assert.equal(engine.parseSave(cases.check).reason, "check");
  assert.equal(engine.parseSave(cases.shape).reason, "shape");
  assert.equal(engine.parseSave(cases.badPacked).reason, "shape");
  assert.equal(engine.parseSave(cases.old1).ok, true);
});

// Review r5-07: the whole save is held under K.saveBudget by an estimate
// (helpers.js saveBytes); it must count strings as herdr counts the write
// (UTF-8 bytes of the JSON text) and never fall short of the real size.
test("r5-07: jsonBytes is the UTF-8 size of a string as JSON writes it", () => {
  const cases = [
    "", "plain ascii", 'quote " and \\ backslash', "tab\tand\nnewline\u0001", "claude · refactor",
    "支払い照合サービスをリファクタリング", "emoji 👩🏽‍💻 and 🧪🔥", "lone \ud83d surrogate", "\udc00", "é".repeat(80),
  ];
  for (const s of cases) assert.equal(jsonBytes(s), Buffer.byteLength(JSON.stringify(s), "utf8"), JSON.stringify(s));
  assert.equal(jsonBytes(null), 4);
  assert.equal(jsonBytes(undefined), 4);
});

test("r5-07: the save estimate is never below the real save, and close to it", () => {
  const s = seeded(57);
  const me = writer(s, "w-7f3a9c2e41");
  const real = (i, status, turn, extra) => agent(i, status, turn, { addr: `w${i % 9}:t${i}`, created: T0 - 86400000 + i * 997, ...extra });
  let t = T0;
  const check = (what) => {
    const bytes = Buffer.byteLength(engine.serialize(s), "utf8");
    const est = saveBytes(s);
    assert.ok(est >= bytes, `${what}: estimate ${est} < ${bytes} bytes`);
    assert.ok(est <= bytes * 1.6 + 32768, `${what}: estimate ${est} far above ${bytes} bytes`);
  };
  check("a new game");
  // helpers that come and go with long titles, sub-agents and finished tasks
  for (let batch = 0; batch < 12; batch++) {
    const list = Array.from({ length: 30 }, (_, i) => real(10000 + batch * 30 + i, "working", 0, {
      title: batch % 2 ? "codex · 支払い照合サービスの不安定な統合テストを直す 🧪🔥" : 'claude · fix "quoted" \\ paths in the billing service',
      space: batch % 3 ? "payments" : "支払い", tab: "integration",
    }));
    const kids = list.slice(0, 10).map((o, k) => real(50000 + batch * 30 + k, "working", 0, { kind: "kid", pane: null, parent: o.addr, title: o.title }));
    me.act(observeAction((t += 1000), [...list, ...kids]));
    me.act(observeAction((t += 61000), [...list, ...kids].map((o) => ({ ...o, turn: 1, status: "idle" }))));
    check(`batch ${batch} present`);
    me.act(observeAction((t += 1000), []));
    check(`batch ${batch} gone`);
  }
  assert.ok(Object.values(s.helpers).some((h) => h.compact), "some records compacted");
});

// Review r6-03: a save whose lifetime is past the crane hold (about 1.3e42)
// is well formed, so it loads, and the game built from it renders at once
// (it used to hang every view build); a non-finite lifetime cannot be
// written as JSON and is the visible damaged path ("lifetime").
test("a save with lifetime 2e42 or more loads and renders fast; a non-number lifetime is damaged (r6-03)", () => {
  for (const L of [2e42, 1e300]) {
    const s = played();
    s.lifetime = L;
    const r = engine.parseSave(engine.serialize(s));
    assert.equal(r.ok, true, String(L));
    assert.equal(r.state.lifetime, L);
    const t0 = performance.now();
    engine.view(r.state, r.state.clock + 1000);
    assert.ok(performance.now() - t0 < 500, `view at L ${L}`);
  }
  const s = played();
  s.lifetime = Infinity; // JSON writes null
  const r = engine.parseSave(engine.serialize(s));
  assert.equal(r.ok, false);
  assert.ok(r.reason === "shape" || r.reason === "check", r.reason);
});

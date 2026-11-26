// Prestige (§9): reset and keep rules, perks, garlands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { engine, seeded, writer, agent, observeAction, close, T0 } from "./_util.mjs";

function ready(W = 0) {
  const s = seeded(8);
  const me = writer(s);
  me.act(observeAction(T0, [agent(1, "working", 0), agent(2, "working", 0), agent(3, "idle", 0)]));
  s.wishes = W;
  s.wishCount = W > 0 ? 1 : 0;
  for (let i = 0; i < 60; i++) me.act({ t: T0 + 1000 + i * 500, type: "click", target: "sheet" });
  s.bank = 5e8;
  for (const item of ["crisp-corners", "mail-sorter", "thrifty-fox", "echo-1", "wax-seal", "harbour-ribbon"]) {
    me.act({ t: T0 + 40000, type: "buy", item, count: 1 });
  }
  me.act({ t: T0 + 40000, type: "buy", item: "paper-stack", count: 30 });
  me.act({ t: T0 + 40000, type: "buy", item: "bone-folder", count: 10 });
  me.act({ t: T0 + 40000, type: "switch", id: "thrifty-fox", on: false });
  me.act({ t: T0 + 40000, type: "setting", key: "calm", value: true });
  engine.advance(s, T0 + 50000);
  s.envelopes[engine.helperId("t1", 1001)] = { type: "bundle", units: 2, landedAt: T0, lastAt: T0 };
  s.envelopes[engine.helperId("t2", 1002)] = { type: "rush", units: 3, landedAt: T0, lastAt: T0 };
  s.stats.units.created += 5;
  s.lifetime = Math.max(s.lifetime, engine.lifetimeFor(100 * (W + Math.max(10, Math.ceil(W / 4) + 5))));
  return { s, me };
}

test("an unready wish is ignored", () => {
  const s = seeded();
  const me = writer(s);
  assert.equal(me.act({ t: T0, type: "wish" }).at(-1).reason, "wish");
  assert.equal(s.wishes, 0);
});

test("the first wish: opens Bundles, resets the run, keeps helpers, boosts envelopes, settings, switches", () => {
  const { s, me } = ready(0);
  const L = s.lifetime;
  const helpersBefore = JSON.stringify(Object.keys(s.helpers));
  const rushId = engine.helperId("t2", 1002);
  const ev = me.act({ t: T0 + 60000, type: "wish" });
  assert.ok(ev.some((e) => e.kind === "earn" && e.source === "env"));
  assert.equal(ev.find((e) => e.kind === "wish").gain, 10);
  assert.equal(s.wishes, 10);
  assert.equal(s.wishCount, 1);
  assert.equal(s.bank, 0);
  assert.equal(s.runFolds, 0);
  assert.ok(s.lifetime >= L);
  assert.deepEqual(Object.keys(s.owned), []);
  // perk at 10: Crisp Corners and Mail Sorter kept, the rest cleared
  assert.deepEqual(Object.keys(s.bought).sort(), ["crisp-corners", "mail-sorter"]);
  assert.equal(s.auto["thrifty-fox"], false); // switches survive
  assert.equal(s.settings.calm, true);
  assert.equal(JSON.stringify(Object.keys(s.helpers)), helpersBefore);
  assert.deepEqual(Object.keys(s.envelopes), [rushId]); // the timed boost envelope carries over
  assert.equal(s.boosts.rush, 0);
  assert.equal(s.hand.r, 0);
  assert.equal(s.hand.afterglowMs, 0);
  assert.deepEqual(s.hand.figures, []);
  assert.equal(s.spawn.chain, null);
  assert.deepEqual(s.stats.runBySource && Object.keys(s.stats.runBySource), []);
  assert.equal(engine.rates(s).G, 1.5);
  // the garland: ≤ 20 stripes, shares summing to ~1, hands and workshops named
  assert.equal(s.garlands.length, 1);
  const g = s.garlands[0];
  assert.equal(g.wish, 1);
  assert.equal(g.wishes, 10);
  assert.ok(g.stripes.length <= 20);
  close(g.stripes.reduce((a, x) => a + x[1], 0), 1, 1e-3);
  assert.ok(g.stripes.some((x) => x[0] === "hands"));
  assert.ok(g.stripes.some((x) => x[0] === "workshops"));
  assert.ok(g.stripes.some((x) => /^hue:[0-7]$/.test(x[0])));
});

test("perks: 25 carries a tenth of the last run's three cheapest workshops; 100 keeps automations", () => {
  {
    const { s, me } = ready(20);
    s.owned["paper-stack"] = 30;
    s.owned["bone-folder"] = 19;
    s.owned["scissor-stand"] = 29;
    s.owned["glue-pot"] = 40; // not one of the three cheapest kinds
    me.act({ t: T0 + 60000, type: "wish" });
    assert.ok(s.wishes >= 25);
    assert.deepEqual({ ...s.owned }, { "paper-stack": 3, "bone-folder": 1, "scissor-stand": 2 });
    assert.equal(Object.getPrototypeOf(s.owned), null);
    assert.equal(s.bought["thrifty-fox"], undefined);
  }
  {
    // below a tenth nothing carries over (no zero entries)
    const { s, me } = ready(20);
    s.owned["paper-stack"] = 9;
    s.owned["bone-folder"] = 0;
    me.act({ t: T0 + 60000, type: "wish" });
    assert.deepEqual(Object.keys(s.owned), []);
  }
  {
    // under 25 Wishes nothing carries over
    const { s, me } = ready(5);
    me.act({ t: T0 + 60000, type: "wish" });
    assert.ok(s.wishes < 25);
    assert.deepEqual(Object.keys(s.owned), []);
  }
  {
    const { s, me } = ready(95);
    me.act({ t: T0 + 60000, type: "wish" });
    assert.ok(s.wishes >= 100);
    assert.deepEqual(Object.keys(s.bought).sort(), ["crisp-corners", "mail-sorter", "thrifty-fox"]);
  }
});

test("perks: 50 makes gilded cranes 20 % sooner; 250 lets envelopes stack to 15", () => {
  const s = seeded();
  assert.equal(engine.effects(s).craneLo, 340);
  s.wishes = 50;
  assert.equal(engine.effects(s).craneLo, 340 * 0.8);
  s.bought["crane-bait"] = true;
  assert.equal(engine.effects(s).craneLo, 240 * 0.8);
  assert.equal(engine.effects(s).envCap, 9);
  s.wishes = 250;
  assert.equal(engine.effects(s).envCap, 15);
});

test("a later wish needs gain ≥ max(5, ceil(0.25·W)) and adds to W", () => {
  const { s, me } = ready(40);
  const info = engine.wishInfo(s);
  assert.equal(info.needed, 10);
  assert.ok(info.can);
  me.act({ t: T0 + 60000, type: "wish" });
  assert.equal(s.wishes, 40 + info.gain);
  assert.equal(engine.wishInfo(s).can, false);
});

test("r1-18: a wish records the wish moment; the vm draws it (rise, then settle, then nothing)", () => {
  const { s, me } = ready(0);
  const full = engine.stringInfo(s);
  const fill = Math.min(1, full.cranes / full.of);
  me.act({ t: T0 + 60000, type: "wish" });
  assert.equal(s.ui.lastWish.at, T0 + 60000);
  close(s.ui.lastWish.fill, fill, 1e-3);
  const at = (dt) => engine.view(s, T0 + 60000 + dt, { role: "panel", width: 320, tab: "string" }).string.wishMoment;
  const rise = at(0);
  assert.equal(rise.phase, "rise");
  assert.equal(rise.strands.length, 20);
  // the String as it was wished away: shares from the recorded fill
  rise.strands.forEach((k, i) => close(k, Math.max(0, Math.min(1, s.ui.lastWish.fill * 20 - i)), 1e-9));
  assert.equal(at(999).phase, "rise");
  assert.equal(at(1000).phase, "settle");
  assert.equal(at(2999).phase, "settle");
  assert.equal(at(3000), null);
  assert.equal(at(-1), null, "a clock before the wish shows nothing");
  // survives the save round trip; older saves default to null
  const back = engine.parseSave(engine.serialize(s));
  assert.deepEqual(back.state.ui.lastWish, s.ui.lastWish);
  delete s.ui.lastWish;
  assert.equal(engine.parseSave(engine.serialize(s)).state.ui.lastWish, null);
});

// Review r5-12: for W 10–39 the gate opens at 100·needed shown cranes while
// the String holds 100·max(10, needed): the String is half full when the
// wish opens. Every line must name the gain it really gives.
test("r5-12: the String's gate, lines and notification name the real gains (W = 10, 1 wish made)", async () => {
  const { wanted } = await import("../../mods/creaseworks/glue/notify.js");
  const s = seeded(8);
  s.wishes = 10;
  s.wishCount = 1;
  const at = (c) => {
    s.lifetime = engine.lifetimeFor(c);
    return { info: engine.stringInfo(s), vm: engine.view(s, T0, { role: "panel", width: 320, tab: "string" }).string };
  };
  let { info, vm } = at(1499);
  assert.equal(info.of, 1000);
  assert.equal(info.gate, 500);
  assert.equal(info.can, false);
  assert.equal(vm.gate, 500);
  assert.equal(vm.gateStrand, 10);
  assert.equal(vm.title, "499 / 1,000 cranes");
  assert.equal(vm.at, "At 500: +5 Wishes · at 1,000: +10");
  ({ info, vm } = at(1500));
  assert.equal(info.can, true);
  assert.equal(info.full, false);
  assert.equal(vm.at, "Ready: +5 Wishes · at 1,000: +10");
  assert.equal(vm.button, "Make the wish (+5 Wishes)");
  // the "at 1,000" gain is what the String gives when it is full
  s.lifetime = engine.lifetimeFor(100 * s.wishes + info.of);
  assert.equal(engine.wishInfo(s).gain, info.atOf);
  // notification: ready but not full is not "full"
  s.lifetime = engine.lifetimeFor(1500);
  s.settings.notify.master = true;
  const slot = { state: s };
  let n = wanted(slot, T0, { day: s.day, quiet: false });
  assert.equal(n.event, "full");
  assert.equal(n.title, "A wish is ready");
  ({ info, vm } = at(2000));
  assert.equal(info.full, true);
  assert.equal(vm.gateStrand, 10, "the gate mark stays where the wish opened");
  assert.equal(vm.at, "Ready: +10 Wishes (+5 % to everything each, forever)");
  assert.ok(vm.strands.every((x) => x === 1));
  n = wanted(slot, T0, { day: s.day, quiet: false });
  assert.equal(n.title, "Your string is full");
});

test("r5-12: for every W the 'at' line's gain at the String's size is the real one; no gate mark when the gate is the end", () => {
  for (const W of [0, 5, 10, 15, 20, 24, 39, 40, 41, 100, 400]) {
    const s = seeded(8);
    s.wishes = W;
    s.wishCount = W > 0 ? 1 : 0;
    s.lifetime = engine.lifetimeFor(100 * W + 1);
    const info = engine.stringInfo(s);
    const vm = engine.view(s, T0, { role: "panel", width: 320, tab: "string" }).string;
    assert.ok(info.gate <= info.of, `W ${W}`);
    assert.equal(vm.gateStrand === null, info.gate === info.of, `W ${W}`);
    s.lifetime = engine.lifetimeFor(100 * W + info.gate - 1);
    assert.equal(engine.wishInfo(s).can, false, `W ${W}: closed below the gate`);
    s.lifetime = engine.lifetimeFor(100 * W + info.gate);
    assert.equal(engine.wishInfo(s).can, true, `W ${W}: open at the gate`);
    s.lifetime = engine.lifetimeFor(100 * W + info.of);
    assert.equal(engine.wishInfo(s).gain, info.atOf, `W ${W}: gain at the String's size`);
    assert.match(vm.at, new RegExp(`(^A|a)t ${engine.formatInt(info.of)}: \\+${engine.formatInt(info.atOf)}( |$)`), `W ${W}: ${vm.at}`);
  }
});

// Review r5-13: the away pot is earned; a wish made while it waits credits it.
test("r5-13: a wish credits an uncollected away pot first (lifetime, the gain), and the confirm says so", () => {
  const { s, me } = ready(0);
  engine.advance(s, T0 + 50000 + 8 * 3600000);
  const pot = s.away.pot;
  assert.ok(pot && pot.folds > 0, "an away pot waits");
  const vm = engine.view(s, T0 + 50000 + 8 * 3600000, { role: "panel", width: 320, tab: "string" }).string;
  assert.match(vm.potNote, /^First collects your \+\S+ folds from while you were away\.$/);
  const L = s.lifetime;
  const before = engine.wishInfo(s).gain;
  const ev = me.act({ t: T0 + 50000 + 8 * 3600000, type: "wish" });
  const earn = ev.find((e) => e.kind === "earn" && e.source === "away");
  assert.ok(earn, "the pot is credited");
  close(earn.amount, pot.folds);
  assert.ok(s.lifetime >= L + pot.folds - 1e-6, "the pot reaches lifetime");
  assert.equal(s.away.pot, null);
  assert.ok(ev.some((e) => e.kind === "wish" && e.gain >= before));
  assert.ok(s.notices.some((n) => n.kind === "away"), "never silent: the footer notice says what was credited");
  assert.equal(engine.view(s, T0 + 50000 + 8 * 3600000, { role: "panel", width: 320, tab: "string" }).string.potNote, null);
});

// Review r6-03: above about L 1.3e42 the crane count passes 2^53, where
// c + 1 === c, and the old upward correction spun forever (view() calls
// cranes on every build, so every render and tick hung). Each call is now a
// fixed handful of steps whatever L is, and the count holds at
// Number.MAX_SAFE_INTEGER.
test("cranes(L) returns at once for any L: huge, Infinity, NaN; exact below 2^53, held at MAX_SAFE_INTEGER above (r6-03)", () => {
  const max = Number.MAX_SAFE_INTEGER;
  const t0 = performance.now();
  for (const L of [2e42, 1e43, 1e60, 1e300, Number.MAX_VALUE, Infinity]) assert.equal(engine.cranes(L), max, String(L));
  for (const L of [NaN, -1, 0, -Infinity, undefined]) assert.equal(engine.cranes(L), 0, String(L));
  assert.ok(performance.now() - t0 < 50, "no correction loop runs away");
  // Still the largest c with lifetimeFor(c) <= L right up to the hold.
  // Near 2^53 adjacent lifetimes are a float ulp apart, so "largest c" is
  // only defined to rounding: the count sits on the curve and under L.
  for (const L of [1e41, 1e42, 1.25e42]) {
    const c = engine.cranes(L);
    const ideal = 1000 * Math.pow(L / 6e9, 0.4);
    assert.ok(Number.isSafeInteger(c) && c < Number.MAX_SAFE_INTEGER, `L ${L}: ${c}`);
    assert.ok(Math.abs(c - ideal) / ideal < 1e-13, `L ${L}: ${c} vs ${ideal}`);
    assert.ok(engine.lifetimeFor(c) <= L, `L ${L}`);
  }
  for (const c of [1, 999, 1000, 1001, 123456, 1e9 + 7, 2e12 + 3, 4503599627370497]) {
    assert.equal(engine.cranes(engine.lifetimeFor(c)), c, `c ${c}`);
    assert.ok(engine.lifetimeFor(c + 1) > engine.lifetimeFor(c));
  }
  // Monotone across the hold.
  let prev = 0;
  for (let e = 9; e <= 308; e += 0.5) {
    const c = engine.cranes(Math.min(Number.MAX_VALUE, Math.pow(10, e)));
    assert.ok(c >= prev, `10^${e}`);
    prev = c;
  }
  assert.equal(prev, max);
});

test("a game with lifetime 2e42 or more still builds its view and String tab fast (r6-03)", () => {
  for (const L of [2e42, 1e300, Number.MAX_VALUE]) {
    const { s } = ready();
    s.lifetime = L;
    const t0 = performance.now();
    const w = engine.wishInfo(s);
    const info = engine.stringInfo(s);
    engine.view(s, s.clock + 1000);
    assert.ok(performance.now() - t0 < 500, `L ${L}`);
    assert.equal(w.cranes, Number.MAX_SAFE_INTEGER);
    assert.ok(w.can && Number.isSafeInteger(w.gain) && w.gain > 0, JSON.stringify(w));
    assert.ok(Number.isFinite(info.cranes) && Number.isFinite(info.of));
  }
});

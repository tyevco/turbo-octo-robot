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

test("perks: 25 starts with 10 Paper Stacks and 5 Bone Folders; 100 keeps automations", () => {
  {
    const { s, me } = ready(20);
    me.act({ t: T0 + 60000, type: "wish" });
    assert.ok(s.wishes >= 25);
    assert.equal(s.owned["paper-stack"], 10);
    assert.equal(s.owned["bone-folder"], 5);
    assert.equal(s.bought["thrifty-fox"], undefined);
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
  assert.equal(engine.effects(s).craneLo, 300);
  s.wishes = 50;
  assert.equal(engine.effects(s).craneLo, 240);
  s.bought["crane-bait"] = true;
  assert.equal(engine.effects(s).craneLo, 210 * 0.8);
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

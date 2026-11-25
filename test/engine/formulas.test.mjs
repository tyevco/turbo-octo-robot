// Formulas against the DESIGN tables (§4, §5.3, §7, §9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { engine, seeded, writer, agent, observeAction, close, T0 } from "./_util.mjs";

const { CONTENT } = engine;

test("index.js exposes the B2 API", () => {
  for (const name of ["newGame", "apply", "advance", "replay", "rates", "view", "cloneState", "migrate",
    "serialize", "parseSave", "VERSION", "clip", "graphemes", "formatCount", "formatRate", "formatDuration", "CONTENT"]) {
    assert.ok(name in engine, name);
  }
  assert.equal(Number.isInteger(engine.VERSION), true);
});

test("workshop table and cost_n = base · 1.16^n (§7.2)", () => {
  const ids = CONTENT.WORKSHOPS.map((w) => w.id);
  assert.deepEqual(ids, ["paper-stack", "bone-folder", "scissor-stand", "glue-pot", "fold-bench", "washi-vat", "flower-press", "crane-loft", "kite-tower"]);
  assert.deepEqual(CONTENT.WORKSHOPS.map((w) => w.base), [15, 180, 2200, 26000, 310000, 3.7e6, 4.5e7, 5.4e8, 6.5e9]);
  assert.deepEqual(CONTENT.WORKSHOPS.map((w) => w.out), [0.05, 0.3, 1.8, 11, 65, 390, 2300, 14000, 84000]);
  assert.equal(engine.workshopCost("paper-stack", 0), 15);
  close(engine.workshopCost("paper-stack", 1), 17.4);
  close(engine.workshopCost("glue-pot", 5), 26000 * 1.16 ** 5);
  // ×10 is the closed-form geometric sum of ten single costs.
  let sum = 0;
  for (let n = 3; n < 13; n++) sum += engine.workshopCost("bone-folder", n);
  close(engine.workshopCost("bone-folder", 3, 10), sum);
});

test("buying: ×1, ×10, Max, locks and refusals", () => {
  const s = seeded();
  const me = writer(s);
  s.bank = 1000;
  const ev = me.act({ t: T0, type: "buy", item: "bone-folder", count: 1 });
  assert.equal(ev.at(-1).reason, "locked"); // predecessor not owned
  me.act({ t: T0, type: "buy", item: "paper-stack", count: 10 });
  assert.equal(s.owned["paper-stack"], 10);
  close(s.bank, 1000 - 15 * (1.16 ** 10 - 1) / 0.16);
  const before = s.bank;
  const max = engine.maxAffordable(s, "paper-stack");
  assert.ok(engine.workshopCost("paper-stack", 10, max) <= before);
  assert.ok(engine.workshopCost("paper-stack", 10, max + 1) > before);
  me.act({ t: T0, type: "buy", item: "paper-stack", count: "max" });
  assert.equal(s.owned["paper-stack"], 10 + max);
  const ev2 = me.act({ t: T0, type: "buy", item: "kite-tower", count: 1 });
  assert.equal(ev2.at(-1).kind, "ignored");
  s.bank = 1e9;
  assert.equal(me.act({ t: T0, type: "buy", item: "echo-2", count: 1 }).at(-1).reason, "locked");
  me.act({ t: T0, type: "buy", item: "echo-1", count: 1 });
  me.act({ t: T0, type: "buy", item: "echo-2", count: 1 });
  assert.equal(me.act({ t: T0, type: "buy", item: "echo-2", count: 1 }).at(-1).reason, "owned");
  assert.equal(engine.rates(s).echo, 0.10);
});

test("tier upgrades: at 10/25/50, cost ×20/×200/×4000, each ×2 output", () => {
  const s = seeded();
  const me = writer(s);
  s.owned["glue-pot"] = 9;
  s.bank = 1e12;
  assert.equal(me.act({ t: T0, type: "buy", item: "glue-pot-t1", count: 1 }).at(-1).reason, "locked");
  s.owned["glue-pot"] = 10;
  const bank = s.bank;
  me.act({ t: T0, type: "buy", item: "glue-pot-t1", count: 1 });
  assert.equal(bank - s.bank, 26000 * 20);
  close(engine.rates(s).Rw, 10 * 11 * 2);
  assert.equal(engine.itemInfo(s, "glue-pot-t2").cost, 26000 * 200);
  assert.equal(engine.itemInfo(s, "glue-pot-t3").cost, 26000 * 4000);
  s.owned["glue-pot"] = 50;
  me.act({ t: T0, type: "buy", item: "glue-pot-t2", count: 1 });
  me.act({ t: T0, type: "buy", item: "glue-pot-t3", count: 1 });
  close(engine.rates(s).Rw, 50 * 11 * 8);
});

test("upgrade costs match §7.3", () => {
  const cost = (id) => CONTENT.UPGRADES.find((u) => u.id === id).cost;
  const expect = {
    "crisp-corners": 100, "bone-tip-nail": 1500, "valley-fold": 40000, "mountain-fold": 1.2e6, "squash-fold": 4e7,
    "petal-fold": 1.5e9, "thousandth-fold": 6e10, "echo-1": 2000, "echo-2": 80000, "echo-3": 4e6, "echo-4": 3e8,
    "echo-5": 2e10, "steady-rhythm": 5000, "long-streak": 250000, "endless-streak": 5e7, "rice-treats": 2000,
    "soft-brushes": 100000, "snug-bench": 5e6, "paper-hats": 3e8, "gold-leaf-hats": 2e10, "shared-rhythm": 2e6,
    "deep-rest": 20000, "dreamy-rest": 2e6, "warm-hands": 500000, "fledgling-wings": 50000, "flight-school": 5e6,
    "night-shift": 500000, "night-owl": 5e7, "wax-seal": 10000, "ribbon-tie": 1e6, "long-ribbon": 100000,
    "longer-ribbon": 1e7, "brisk-charm": 3e6, "gale-charm": 1e8, "long-crease": 20000, "grand-crease": 2e6,
    "quick-creases": 200000, "scrap-basket": 100000, "crane-bait": 50000, "crane-song": 5e6, "slow-wings": 500000,
    "harbour-ribbon": 1e6,
  };
  for (const [id, c] of Object.entries(expect)) assert.equal(cost(id), c, id);
  assert.equal(CONTENT.UPGRADES.length, Object.keys(expect).length);
  assert.deepEqual(CONTENT.AUTOMATIONS.map((a) => [a.id, a.cost]),
    [["mail-sorter", 25000], ["thrifty-fox", 500000], ["boost-keeper", 2.5e6], ["crease-helper", 5e6]]);
});

test("eff(n): 4.44 / 5.41 / 6.06, strictly increasing; adding an agent never lowers Hs0", () => {
  assert.equal(engine.eff(4), 4);
  assert.equal(engine.eff(8).toFixed(2), "4.44");
  assert.equal(engine.eff(30).toFixed(2), "5.41");
  assert.equal(engine.eff(64).toFixed(2), "6.06");
  for (let n = 0; n < 200; n++) assert.ok(engine.eff(n + 1) > engine.eff(n), `eff(${n + 1})`);
  let prev = 0;
  for (let n = 1; n <= 64; n++) {
    const s = seeded();
    const me = writer(s);
    me.act(observeAction(T0, Array.from({ length: n }, (_, i) => agent(i, "working"))));
    const { Hs0, crowd, nWorking } = engine.rates(s);
    assert.equal(nWorking, n);
    close(crowd, engine.eff(n) / n);
    close(Hs0, engine.eff(n) * 0.3);
    assert.ok(Hs0 > prev);
    prev = Hs0;
  }
});

test("rates: G, Rw, b_i, V = hand·G + echo·Rp (§4.1, §5.3)", () => {
  const s = seeded();
  s.wishes = 20; // G = 2
  s.owned["paper-stack"] = 10;
  s.owned["bone-folder"] = 4;
  s.bought["crisp-corners"] = true;
  s.bought["bone-tip-nail"] = true;
  s.bought["rice-treats"] = true;
  const me = writer(s);
  me.act(observeAction(T0, [agent(1, "working"), agent(2, "working"), agent(3, "idle")]));
  const r = engine.rates(s);
  assert.equal(r.G, 2);
  close(r.Rw, 2 * (10 * 0.05 + 4 * 0.3));
  const b = (0.3 * 2 + 0.04 * r.Rw) * 1.5;
  close(r.Hs0, 2 * b);
  close(r.Rp, r.Rw + r.Hs0);
  assert.equal(r.hand, 4);
  close(r.V, 4 * 2 + 0.03 * r.Rp);
  me.act({ t: T0, type: "setting", key: "gather", value: false });
  assert.equal(engine.rates(s).Rp, engine.rates(s).Rw);
  assert.equal(engine.rates(s).Hs, 0);
});

test("cranes(L) and the first wish: L = 6e9 gives exactly 1,000 cranes and 10 Wishes (§9)", () => {
  assert.equal(engine.cranes(0), 0);
  assert.equal(engine.cranes(6e6), 100);
  assert.equal(engine.cranes(6e6 - 1), 99);
  assert.equal(engine.cranes(6e9), 1000);
  assert.equal(engine.cranes(6e9 - 1), 999);
  assert.equal(engine.cranes(6e12), 10000);
  for (let c = 1; c < 3000; c += 7) {
    const L = engine.lifetimeFor(c);
    assert.equal(engine.cranes(L), c, `c=${c}`);
    assert.equal(engine.cranes(L * (1 - 1e-12)), c - 1, `c=${c}-`);
  }
  const s = seeded();
  s.lifetime = 6e9 - 1;
  assert.equal(engine.wishInfo(s).can, false);
  s.lifetime = 6e9;
  const w = engine.wishInfo(s);
  assert.equal(w.can, true);
  assert.equal(w.gain, 10);
  const me = writer(s);
  const ev = me.act({ t: T0, type: "wish" });
  assert.deepEqual(ev.find((e) => e.kind === "wish"), { kind: "wish", gain: 10 });
  assert.equal(s.wishes, 10);
  assert.equal(engine.rates(s).G, 1.5);
  // later wish: gain ≥ max(5, ceil(0.25·W))
  s.lifetime = engine.lifetimeFor(1499);
  assert.equal(engine.wishInfo(s).can, false); // gain 4
  s.lifetime = engine.lifetimeFor(1500);
  assert.equal(engine.wishInfo(s).can, true);
  s.wishes = 100;
  s.lifetime = engine.lifetimeFor(12400);
  assert.equal(engine.wishInfo(s).gain, 24);
  assert.equal(engine.wishInfo(s).can, false); // needs 25
  const str = engine.stringInfo(s);
  assert.equal(str.of, 2500);
  assert.equal(str.cranes, 2400);
});

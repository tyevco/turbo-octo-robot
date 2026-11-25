// Rates, costs, purchases and crediting (DESIGN §4.1, §5.3, §7).

import { WORKSHOPS, TIERS, UPGRADES, AUTOMATIONS, GROWTH, K, PRESTIGE } from "./content.js";

// Lookups scan the small frozen tables (no index built at import time, A2 rule 2).
function findIn(list, id) {
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return undefined;
}
const UP_BY_ID = { get: (id) => findIn(UPGRADES, id) };
const AUTO_BY_ID = { get: (id) => findIn(AUTOMATIONS, id) };
const WS_BY_ID = { get: (id) => findIn(WORKSHOPS, id), has: (id) => findIn(WORKSHOPS, id) !== undefined };

/** The table row of any upgrade, automation or workshop id (undefined if none). */
export function itemRow(id) {
  return findIn(UPGRADES, id) || findIn(AUTOMATIONS, id) || findIn(WORKSHOPS, id);
}

export const CLICK_SOURCES = Object.freeze(["sheet", "mini", "node", "scrap", "crane", "ream", "boat"]);

/** Bench pace: eff(n) = n up to the knee (4), then 4·(n/4)^0.15. */
export function eff(n) {
  if (n <= K.knee) return n > 0 ? n : 0;
  return K.knee * Math.pow(n / K.knee, K.crowdExp);
}

/** crowd(n) = eff(n)/n; 1 for an empty bench. */
export function crowd(n) {
  return n > 0 ? eff(n) / n : 1;
}

/**
 * Hs0 from the working helpers' b_i (`bs`, summing to `sum`): marginal bench
 * pace (§5.3). With the b_i sorted largest first, the k-th counts
 * eff(k) − eff(k−1). That is crowd(n)·Σ b_i when every b_i is equal, and it
 * never falls when a working agent joins (or rises when one stops working),
 * whatever the warm, fledgling and thanks multipliers. Sorts `bs` in place.
 */
export function benchSum(bs, sum) {
  const n = bs.length;
  if (n <= K.knee) return sum; // eff(k) − eff(k−1) = 1 up to the knee
  let same = true;
  for (let i = 1; i < n && same; i++) same = bs[i] === bs[0];
  if (same) return crowd(n) * sum;
  bs.sort((a, b) => b - a);
  let total = 0;
  let prev = 0;
  for (let k = 1; k <= n; k++) {
    const e = eff(k);
    total += (e - prev) * bs[k - 1];
    prev = e;
  }
  return total;
}

/** Everything bought turned into the numbers the formulas use. */
export function effects(state) {
  const b = state.bought;
  let hand = 1;
  let echo = K.echoBase;
  let folk = 1;
  const E = {
    G: 1 + PRESTIGE.perWish * state.wishes,
    hand: 1, echo: K.echoBase, gapMs: K.gapMs, comboMax: K.comboMax, folk: 1,
    stepIn: K.stepIn, stepMult: K.stepMult, glowMult: K.glowMult,
    restFullMs: K.restFullMin * 60000, restMax: K.restMax, kidBonus: K.kidBonus, awayF: K.awayF,
    envMult: 1, durMult: 1, rushMult: K.rushMult, stormMult: K.stormMult,
    chainK: K.chainK, chainEveryMs: K.chainEveryMs, scrapMult: 1, craneLo: K.craneLo,
    craneLifeMs: K.craneLifeMs, boat: false,
    envCap: state.wishes >= 250 ? K.envCapPerk : K.envCap,
    life: state.settings && state.settings.calm ? K.calmLife : 1,
    gather: !(state.settings && state.settings.gather === false),
  };
  for (const u of UPGRADES) {
    if (b[u.id] !== true) continue;
    switch (u.fx) {
      case "hand": hand *= 2; break;
      case "echo": if (u.v > echo) echo = u.v; break;
      case "gap": E.gapMs = u.v; break;
      case "combo": if (u.v > E.comboMax) E.comboMax = u.v; break;
      case "folk": folk *= K.folkMult; break;
      case "shared":
        E.stepIn = K.stepInShared; E.stepMult = K.stepMultShared; E.glowMult = K.glowMultShared; break;
      case "rest": if (u.v * 60000 < E.restFullMs) E.restFullMs = u.v * 60000; break;
      case "warm": E.restMax = u.v; break;
      case "kids": if (u.v > E.kidBonus) E.kidBonus = u.v; break;
      case "away": if (u.v > E.awayF) E.awayF = u.v; break;
      case "env": if (u.v > E.envMult) E.envMult = u.v; break;
      case "dur": if (u.v > E.durMult) E.durMult = u.v; break;
      case "rush": E.rushMult = u.v; break;
      case "storm": E.stormMult = u.v; break;
      case "chainK": if (u.v > E.chainK) E.chainK = u.v; break;
      case "chainEvery": E.chainEveryMs = u.v; break;
      case "scrap": E.scrapMult = u.v; break;
      case "crane": if (u.v < E.craneLo) E.craneLo = u.v; break;
      case "craneLife": E.craneLifeMs = u.v; break;
      case "boat": E.boat = true; break;
      default: break;
    }
  }
  E.hand = hand;
  E.echo = echo;
  E.folk = folk;
  if (state.wishes >= 50) E.craneLo *= K.cranePerk;
  E.nodeLifeMs = K.nodeLifeMs * E.life;
  E.scrapLifeMs = K.scrapLifeMs * E.life;
  E.craneLifeMs *= E.life;
  E.boatLifeMs = K.boatLifeMs * E.life;
  E.Rw = workshopRate(state, E.G);
  return E;
}

/** Number of tiers bought for workshop `id`. */
export function tierOf(state, id) {
  let t = 0;
  for (const tier of TIERS) if (state.bought[`${id}-t${tier.n}`] === true) t++;
  return t;
}

/** Rw = G · Σ n_k · O_k · 2^tier_k. */
export function workshopRate(state, G) {
  let sum = 0;
  for (const w of WORKSHOPS) {
    const n = state.owned[w.id];
    if (n > 0) sum += n * w.out * Math.pow(2, tierOf(state, w.id));
  }
  return G * sum;
}

/** Cost of the next `count` of workshop `id` from `owned` (closed-form geometric sum). */
export function workshopCost(id, owned, count = 1) {
  const w = WS_BY_ID.get(id);
  if (!w || !(count > 0)) return 0;
  const first = w.base * Math.pow(GROWTH, owned);
  if (count === 1) return first;
  return first * (Math.pow(GROWTH, count) - 1) / (GROWTH - 1);
}

/** How many of workshop `id` the bank buys at once ("Max"). */
export function maxAffordable(state, id) {
  const w = WS_BY_ID.get(id);
  if (!w) return 0;
  const owned = state.owned[id] || 0;
  const first = w.base * Math.pow(GROWTH, owned);
  if (state.bank < first) return 0;
  let c = Math.floor(Math.log(1 + state.bank * (GROWTH - 1) / first) / Math.log(GROWTH));
  if (c < 0) c = 0;
  while (c > 0 && workshopCost(id, owned, c) > state.bank) c--;
  while (workshopCost(id, owned, c + 1) <= state.bank) c++;
  return c;
}

/** Describe any item id: kind, cost (for count 1 / given count), and whether it can be bought now. */
export function itemInfo(state, item, count = 1) {
  if (WS_BY_ID.has(item)) {
    const k = WORKSHOPS.findIndex((w) => w.id === item);
    const owned = state.owned[item] || 0;
    const unlocked = k === 0 || (state.owned[WORKSHOPS[k - 1].id] || 0) >= 1;
    const n = count === "max" ? maxAffordable(state, item) : count;
    const cost = workshopCost(item, owned, n > 0 ? n : 1);
    return { kind: "workshop", id: item, count: n, cost, unlocked, ok: unlocked && n > 0 && cost <= state.bank };
  }
  const m = /^(.+)-t([123])$/.exec(item);
  if (m && WS_BY_ID.has(m[1])) {
    const w = WS_BY_ID.get(m[1]);
    const tier = TIERS[Number(m[2]) - 1];
    const prev = tier.n === 1 || state.bought[`${w.id}-t${tier.n - 1}`] === true;
    const unlocked = prev && (state.owned[w.id] || 0) >= tier.at;
    const cost = w.base * tier.mult;
    const have = state.bought[item] === true;
    return { kind: "tier", id: item, count: 1, cost, unlocked, have, ok: unlocked && !have && cost <= state.bank };
  }
  const u = UP_BY_ID.get(item) || AUTO_BY_ID.get(item);
  if (u) {
    const have = state.bought[item] === true;
    const unlocked = !u.req || state.bought[u.req] === true;
    return { kind: u.seg === "auto" ? "automation" : "upgrade", id: item, count: 1, cost: u.cost, unlocked, have, ok: unlocked && !have && u.cost <= state.bank };
  }
  return null;
}

/** Add `amount` folds from `source` to the bank, the run and the lifetime totals. */
export function credit(state, source, amount) {
  if (!(amount > 0)) return 0;
  state.bank += amount;
  state.runFolds += amount;
  state.lifetime += amount;
  const s = state.stats;
  s.bySource[source] = (s.bySource[source] || 0) + amount;
  s.runBySource[source] = (s.runBySource[source] || 0) + amount;
  if (state.away.busy) state.away.busy.folds += amount;
  return amount;
}

/**
 * Buy `item` (`count` 1 | 10 | "max" for workshops, else 1). Returns the events;
 * an unaffordable or locked purchase is an `ignored` event and changes nothing.
 */
export function buy(state, item, count, onBought) {
  const n = count === "max" ? "max" : count === 10 ? 10 : 1;
  const info = itemInfo(state, item, n);
  if (!info) return [{ kind: "ignored", reason: "unknown", item }];
  if (!info.unlocked) return [{ kind: "ignored", reason: "locked", item }];
  if (info.have) return [{ kind: "ignored", reason: "owned", item }];
  if (!info.ok) return [{ kind: "ignored", reason: "afford", item, cost: info.cost }];
  state.bank -= info.cost;
  if (info.kind === "workshop") {
    state.owned[item] = (state.owned[item] || 0) + info.count;
  } else {
    state.bought[item] = true;
    if (info.kind === "automation") state.auto[item] = true;
  }
  if (onBought) onBought(item);
  return [{ kind: "buy", item, count: info.count, cost: info.cost }];
}

/**
 * Estimated gain in income per open second from buying `item` (BALANCE §3.1);
 * the best-buy hint and the simulator's policy share it. `fl` is a flock()
 * result; `o.activeFrac` / `o.cps` default to P1's 0.0625 and 1.25.
 */
export function estimateDelta(state, E, fl, item, o = {}) {
  const activeFrac = o.activeFrac ?? 0.0625;
  const cps = o.cps ?? 1.25;
  const Rp = E.Rw + (E.gather ? fl.Hs0 + fl.Hstale : 0);
  const hands = (h, e, rp) => (h * E.G + e * rp) * cps * 2.2;
  const nW = fl.n;
  const f = 1 + K.helperRw * nW * crowd(nW) * E.folk;
  const w = WS_BY_ID.get(item);
  if (w) return w.out * Math.pow(2, tierOf(state, item)) * E.G * f;
  const m = /^(.+)-t([123])$/.exec(item);
  if (m && WS_BY_ID.has(m[1])) {
    const ws = WS_BY_ID.get(m[1]);
    return (state.owned[ws.id] || 0) * ws.out * Math.pow(2, tierOf(state, ws.id)) * E.G * f;
  }
  const u = UP_BY_ID.get(item);
  if (!u) return 0;
  switch (u.fx) {
    case "hand": return activeFrac * hands(E.hand, 0, 0);
    case "echo": return activeFrac * hands(0, Math.max(0, u.v - E.echo), Rp);
    case "folk": return 0.5 * fl.Hs0;
    case "rest": case "warm": case "kids": case "shared": return 0.15 * fl.Hs0;
    case "away": return 0.10 * Rp;
    case "env": case "dur": case "rush": case "storm": return 0.08 * Rp;
    case "gap": case "combo": return 0.3 * activeFrac * hands(E.hand, E.echo, Rp);
    default: return 0.4 * activeFrac * hands(E.hand, E.echo, Rp);
  }
}

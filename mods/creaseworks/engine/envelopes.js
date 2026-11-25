// Envelopes: turn-delta units, per-helper stacking, overflow, opening, boosts
// (DESIGN §6). `ctx` is the step context from engine.js ({ E, idx, rates(t) }).

import { ENVELOPES, K } from "./content.js";
import { keyed } from "./prng.js";
import { credit, crowd } from "./economy.js";

/** The ENVELOPES row of a type. */
export function envelopeDef(type) {
  for (const d of ENVELOPES) if (d.type === type) return d;
  return ENVELOPES[0];
}

function rollType(state, key) {
  const u = keyed(state, key);
  let acc = 0;
  for (const d of ENVELOPES) {
    acc += d.chance;
    if (u < acc) return d.type;
  }
  return ENVELOPES[ENVELOPES.length - 1].type;
}

/** Stack multiplier f = 1 + 0.25·(u − 1). */
export function stackFactor(units) {
  return 1 + K.stackStep * (units - 1);
}

/**
 * Add `units` to `to`'s envelope (one per helper; type rolled on creation,
 * keyed by the finish `key` = "<helperId>:<turn>").
 * Units above the cap convert at once into 45·Rp·crowd(N)·units folds (§6.1).
 */
export function addUnits(state, ctx, to, units, t, ev, key) {
  const E = ctx.E;
  state.stats.units.created += units;
  to.env += units;
  let env = state.envelopes[to.id];
  if (!env) {
    env = { type: rollType(state, `env:${key ?? to.id + ":" + t}`), units: 0, landedAt: t, lastAt: t };
    state.envelopes[to.id] = env;
  }
  env.lastAt = t;
  const room = Math.max(0, E.envCap - env.units);
  const add = Math.min(units, room);
  const over = units - add;
  env.units += add;
  ev.push({ kind: "envelope", helperId: to.id, units: add });
  if (over > 0) {
    const r = ctx.rates(t);
    const amount = K.envRp * r.Rp * crowd(ctx.idx.panes.length) * over;
    state.stats.units.converted += over;
    credit(state, "overflow", amount);
    to.stats.folds += amount;
    to.stats.run += amount;
    ev.push({ kind: "earn", source: "overflow", amount });
    pushNotice(state, { kind: "overflow", at: t, data: { helperId: to.id, name: to.name, amount } });
  }
}

/**
 * Cash in `helperId`'s envelope without the player (§6.1, R13): its helper left
 * long ago (its Album record is compact or gone from the save). A Bundle pays
 * what opening it would (`45 · Rp · u · envMult · crowd(N)`, no Tailwind); a
 * timed boost converts like units above the cap (`45 · Rp · crowd(N) · u`).
 * The folds go to the record's Album total only (a compact record keeps its
 * packed form). Returns the folds paid (0 when there is no envelope).
 */
export function settleEnvelope(state, ctx, helperId, t, ev) {
  const env = state.envelopes[helperId];
  if (!env) return 0;
  delete state.envelopes[helperId];
  const u = env.units;
  const r = ctx.rates(t);
  const c = crowd(ctx.idx.panes.length);
  let amount;
  if (env.type === "bundle") {
    amount = K.envRp * r.Rp * u * ctx.E.envMult * c;
    state.stats.units.opened += u;
    credit(state, "env", amount);
    ev.push({ kind: "earn", source: "env", amount });
  } else {
    amount = K.envRp * r.Rp * c * u;
    state.stats.units.converted += u;
    credit(state, "overflow", amount);
    ev.push({ kind: "earn", source: "overflow", amount });
  }
  const h = state.helpers[helperId];
  if (h) h.stats.folds += amount;
  return amount;
}

/** Add a notice; at most K.noticesMax kept (oldest footer notes dropped first). */
export function pushNotice(state, n) {
  const list = state.notices;
  if (n.kind === "clock") {
    for (let i = list.length - 1; i >= 0; i--) if (list[i].kind === "clock") list.splice(i, 1);
  }
  list.push(n);
  while (list.length > K.noticesMax) {
    const i = list.findIndex((x) => x.kind !== "clock");
    list.splice(i >= 0 ? i : 0, 1);
  }
}

/**
 * Start or extend a boost. A running boost of the same kind is extended by
 * `extendShare` of `ms`; remaining time is capped at `capMs` (§6.2). `at` is
 * the action's time (≤ clock).
 */
export function addBoost(state, kind, ms, capMs, extendShare, ev, at) {
  const b = state.boosts;
  if (kind === "rush" || kind === "storm") {
    // Hand-hit boosts end at a wall time on the hand-input timeline, which an
    // action merged in late (at < clock) sees at its own time.
    const base = at === undefined ? state.clock : at;
    const endKey = kind === "rush" ? "rushEnd" : "stormEnd";
    const cur = Math.max(0, b[endKey] - base);
    b[endKey] = base + Math.min(capMs, cur + (cur > 0 ? ms * extendShare : ms));
    b[kind] = Math.max(0, b[endKey] - state.clock);
    if (kind === "storm") {
      const sp = state.spawn;
      sp.nextChainAt = Math.min(sp.nextChainAt, sp.activeMs + K.chainStormMs);
    }
  } else {
    const cur = b[kind] > 0 ? b[kind] : 0;
    b[kind] = Math.min(capMs, cur + (cur > 0 ? ms * extendShare : ms));
  }
  ev.push({ kind: "boost", type: kind, ms: b[kind] });
}

/** Open `helperId`'s envelope (a click or an automation; §6.2). */
export function openEnvelope(state, ctx, helperId, t, ev) {
  const env = state.envelopes[helperId];
  if (!env) {
    ev.push({ kind: "ignored", reason: "gone", helperId });
    return ev;
  }
  const E = ctx.E;
  const u = env.units;
  const b = state.boosts;
  let tw = 1;
  if (b.tailwind > 0 && b.tailwindMs > 0) {
    tw = 2;
    b.tailwind -= 1;
    if (b.tailwind <= 0) { b.tailwind = 0; b.tailwindMs = 0; }
  }
  delete state.envelopes[helperId];
  state.stats.units.opened += u;
  const h = state.helpers[helperId];
  if (h) h.stats.envelopes++;
  const def = envelopeDef(env.type);
  if (env.type === "bundle") {
    const r = ctx.rates(t);
    const amount = K.envRp * r.Rp * u * E.envMult * crowd(ctx.idx.panes.length) * tw;
    credit(state, "env", amount);
    if (h) { h.stats.folds += amount; h.stats.run += amount; }
    ev.push({ kind: "earn", source: "env", amount });
  } else {
    const ms = def.baseMs * stackFactor(u) * E.durMult * tw;
    addBoost(state, env.type, ms, def.capMs, K.extendShare, ev, Math.min(t, state.clock));
  }
  return ev;
}

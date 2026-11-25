// Clicking (DESIGN §4): hand hits, rhythm, combo, In step, afterglow, figures,
// chains, scraps, gilded cranes, boats, the Fresh Ream, and the spawn clocks
// that run on active time. `ctx` = { E, idx, rates(t) } from engine.js.

import { K, SPECIES, FREE_SLOTS, SLOT } from "./content.js";
import { keyed } from "./prng.js";
import { credit } from "./economy.js";
import { addBoost } from "./envelopes.js";

/** Node id used by actions and element ids: `<chainId>-<i>`. */
export function nodeId(chain, i) {
  return `${chain.id}-${i}`;
}

/** Centre of spawn slot `i` in mat-local px (304 × 232 mat). */
export function slotXY(i) {
  const col = i % SLOT.cols;
  const row = Math.floor(i / SLOT.cols);
  return { x: SLOT.w * (col + 0.5), y: SLOT.y0 + SLOT.h * (row + 0.5) };
}

/**
 * The rhythm counter as the player sees it at `t`: r, or 0 once the gap since
 * the last credited hit exceeds the rhythm gap. The stored r resets lazily on
 * the next hit (it is kept so hits merged in late from another window keep
 * the streak they had there).
 */
export function rhythmAt(state, E, t) {
  const h = state.hand;
  return h.lastHitAt > 0 && t - h.lastHitAt <= E.gapMs ? h.r : 0;
}

/** True while In step (r at the threshold and the last hit within the rhythm gap). */
export function inStep(state, E, t) {
  const h = state.hand;
  return h.r >= E.stepIn && t <= h.lastHitAt + E.gapMs;
}

/** step multiplier for working helpers at `t` (§5.3). */
export function stepMult(state, E, t) {
  if (inStep(state, E, t)) return E.stepMult;
  return state.hand.afterglowMs > 0 ? E.glowMult : 1;
}

/** song multiplier (§5.3). */
export function songMult(state) {
  if (state.boosts.song > 0) return K.songMult;
  return state.boosts.chorus > 0 ? K.chorusMult : 1;
}

/**
 * Hand-hit multiplier from Storm / Rush at the hit's time `t`. Rush and Storm
 * run on the hand-input timeline (boosts.rushEnd / stormEnd, wall ms), so a
 * hit merged in late from another window gets the boost it had there.
 */
export function hitBoost(state, E, t) {
  const b = state.boosts;
  if (t < b.stormEnd) return E.stormMult;
  return t < b.rushEnd ? E.rushMult : 1;
}

/** combo = 1 + comboMax · min(r, 40)/40. */
export function combo(state, E) {
  return 1 + E.comboMax * Math.min(state.hand.r, K.rMax) / K.rMax;
}

/**
 * Credit one hand hit at `t` (≥ 80 ms after the previous credited one, ≤ 12.5/s).
 * Updates rhythm and afterglow. Returns false when the hit is not credited.
 */
function handHit(state, E, t) {
  const h = state.hand;
  const prev = h.lastHitAt;
  if (prev > 0 && Math.abs(t - prev) < K.hitMinMs) return false;
  const gap = t - prev;
  if (prev > 0 && gap < 0) {
    // a merged hit from another window, older than our last: keep the rhythm
  } else if (prev > 0 && gap <= E.gapMs) {
    h.r = Math.min(K.rMax, h.r + 1);
  } else {
    h.r = 1;
  }
  if (t > prev) h.lastHitAt = t;
  state.stats.hits++;
  if (state.stats.hits >= 3) state.ui.hints.fold = true;
  if (h.r >= E.stepIn) h.afterglowMs = Math.min(K.glowMaxMs, h.afterglowMs + K.glowPerHitMs);
  return true;
}

function vc(state, E, r, t) {
  return r.V * combo(state, E) * hitBoost(state, E, t);
}

function findChain(sp, chainId) {
  if (sp.chain && sp.chain.id === chainId) return "chain";
  if (sp.chain2 && sp.chain2.id === chainId) return "chain2";
  return null;
}

function chainSlots(chain) {
  return chain.nodes.map((n) => n.slot);
}

/** One `click` action (§4.2-§4.5). */
export function click(state, ctx, action, t, ev) {
  const E = ctx.E;
  const sp = state.spawn;
  const tgt = action.target;
  if (t > state.presence.lastHandAt) state.presence.lastHandAt = t;
  switch (tgt) {
    case "sheet":
    case "mini": {
      if (!handHit(state, E, t)) return ignore(ev, "fast");
      const r = ctx.rates(state.clock);
      const v = vc(state, E, r, t);
      const hand = state.hand;
      hand.frame = (hand.frame + 1) % K.figureEvery;
      if (hand.frame === 0) {
        const species = SPECIES[Math.floor(keyed(state, `fig:${state.stats.hits}`) * SPECIES.length)];
        hand.figures.push(species);
        if (hand.figures.length > K.shelfMax) hand.figures.splice(0, hand.figures.length - K.shelfMax);
        earn(state, ev, tgt, K.figureMult * v);
        ev.push({ kind: "figure", species });
      } else {
        earn(state, ev, tgt, v);
      }
      return ev;
    }
    case "node": {
      const id = String(action.id ?? "");
      const dash = id.lastIndexOf("-");
      const which = dash > 0 ? findChain(sp, id.slice(0, dash)) : null;
      if (!which) return ignore(ev, "gone");
      const chain = sp[which];
      const i = Number(id.slice(dash + 1));
      const node = chain.nodes.find((n) => n.i === i);
      if (!node || node.done) return ignore(ev, "gone");
      if (!handHit(state, E, t)) return ignore(ev, "fast");
      const r = ctx.rates(state.clock);
      const v = vc(state, E, r, t);
      if (i === chain.next) {
        node.done = true;
        chain.next++;
        earn(state, ev, "node", K.nodePay * v);
        if (chain.next >= chain.k) {
          earn(state, ev, "node", K.chainFinishPerNode * chain.k * v);
          sp.lastChain = { result: "done", slots: chainSlots(chain), at: t };
          sp[which] = null;
          ev.push({ kind: "chain", result: "done" });
        }
      } else {
        earn(state, ev, "node", K.nodeWrongPay * v);
        sp.lastChain = { result: "torn", slots: chainSlots(chain), at: t };
        sp[which] = null;
        ev.push({ kind: "chain", result: "torn" });
      }
      return ev;
    }
    case "scrap": {
      const k = sp.scraps.findIndex((s) => s.id === action.id);
      if (k < 0) return ignore(ev, "gone");
      if (!handHit(state, E, t)) return ignore(ev, "fast");
      sp.scraps.splice(k, 1);
      const r = ctx.rates(state.clock);
      earn(state, ev, "scrap", Math.max(K.scrapRp * r.Rp, K.scrapV * r.V) * E.scrapMult);
      return ev;
    }
    case "crane": {
      const c = sp.crane;
      if (!c || (action.id !== undefined && action.id !== null && action.id !== c.id)) return ignore(ev, "gone");
      sp.crane = null;
      state.ui.hints.crane = true;
      const r = ctx.rates(state.clock);
      ev.push({ kind: "crane", outcome: c.outcome });
      if (c.outcome === "lucky") {
        earn(state, ev, "crane", Math.min(K.luckyRp * r.Rp, K.luckyBank * state.bank) + K.luckyV * r.V);
      } else if (c.outcome === "storm") {
        addBoost(state, "storm", K.stormFromCraneMs, 30000, 1, ev, Math.min(t, state.clock));
      } else {
        addBoost(state, "song", K.songMs, K.songCapMs, 1, ev);
      }
      return ev;
    }
    case "boat": {
      const b = sp.boat;
      if (!b || (action.id !== undefined && action.id !== null && action.id !== b.id)) return ignore(ev, "gone");
      sp.boat = null;
      const r = ctx.rates(state.clock);
      state.boosts.tailwind = K.tailwindOpens;
      state.boosts.tailwindMs = K.tailwindMs;
      ev.push({ kind: "boost", type: "tailwind", ms: K.tailwindMs });
      earn(state, ev, "boat", K.boatRp * r.Rp);
      return ev;
    }
    case "ream": {
      const rm = sp.ream;
      if (!rm || (action.id !== undefined && action.id !== null && action.id !== rm.id)) return ignore(ev, "gone");
      sp.ream = null;
      const r = ctx.rates(state.clock);
      earn(state, ev, "ream", Math.max(K.reamRp * r.Rp, K.reamV * r.V));
      return ev;
    }
    default:
      return ignore(ev, "target");
  }
}

function ignore(ev, reason) {
  ev.push({ kind: "ignored", reason });
  return ev;
}

function earn(state, ev, source, amount) {
  const a = credit(state, source, amount);
  if (a > 0) ev.push({ kind: "earn", source, amount: a });
}

function freeSlots(sp) {
  const used = Object.create(null);
  for (const c of [sp.chain, sp.chain2]) if (c) for (const n of c.nodes) used[n.slot] = true;
  for (const s of sp.scraps) used[s.slot] = true;
  if (sp.crane) used[sp.crane.slot] = true;
  const out = [];
  for (const i of FREE_SLOTS) if (!used[i]) out.push(i);
  return out;
}

function pickSlots(state, sp, k) {
  const free = freeSlots(sp);
  if (free.length < k) return null;
  const out = [];
  for (let j = 0; j < k; j++) {
    const at = Math.floor(keyed(state, `slot:${sp.seq}:${j}`) * free.length);
    out.push(free[at]);
    free.splice(at, 1);
  }
  return out;
}

function craneInterval(state, E) {
  const sp = state.spawn;
  return (E.craneLo + E.craneLo * keyed(state, `crane-gap:${sp.cranesSeen}:${sp.seq}`)) * 1000;
}

function creaseHelperOn(state) {
  return state.bought["crease-helper"] === true && state.auto["crease-helper"] !== false;
}

/**
 * Spawn clocks and lives over one live piece of `dt` ms starting at `t`
 * (§4.4, §4.5). Spawn clocks run on active time; lives run on mat-shown time.
 * Events are processed in time order, so the outcome does not depend on how
 * the caller splits time into ticks.
 */
export function spawnPiece(state, ctx, t, dt, shown, active, ev, storm) {
  if (!shown || dt < 0) return;
  const E = ctx.E;
  const sp = state.spawn;
  const A0 = sp.activeMs;
  const S0 = sp.shownMs;
  let x = 0;
  for (let guard = 0; guard < 1000; guard++) {
    let best = Infinity;
    let what = null;
    const consider = (off, w) => {
      if (off < best) { best = off; what = w; }
    };
    for (const key of ["chain", "chain2"]) {
      const c = sp[key];
      if (!c) continue;
      consider(c.born + E.nodeLifeMs - S0, key);
      if (creaseHelperOn(state) && !c.helped) consider(c.born + K.creaseHelperAt * E.nodeLifeMs - S0, `help-${key}`);
    }
    for (const s of sp.scraps) consider(s.born + E.scrapLifeMs - S0, "scrap-out");
    if (sp.crane) consider(sp.crane.born + E.craneLifeMs - S0, "crane-out");
    if (sp.boat) consider(sp.boat.born + E.boatLifeMs - S0, "boat-out");
    if (active) {
      consider(sp.nextChainAt - A0, "chain-in");
      consider(sp.nextScrapAt - A0, "scrap-in");
      consider(sp.nextCraneAt - A0, "crane-in");
      if (E.boat && sp.nextBoatAt !== null) consider(sp.nextBoatAt - A0, "boat-in");
      if (sp.reamDay !== state.day && !sp.ream) consider(0, "ream-in");
    }
    if (what === null || best > dt) break;
    if (best > x) x = best;
    sp.shownMs = S0 + x;
    if (active) sp.activeMs = A0 + x;
    const at = t + x;
    switch (what) {
      case "chain":
      case "chain2":
        sp[what] = null;
        break;
      case "help-chain":
      case "help-chain2": {
        const key = what.slice(5);
        const c = sp[key];
        const r = ctx.rates(at);
        const v = r.V * K.creaseHelperValue;
        const left = c.k - c.next;
        earn(state, ev, "node", (K.nodePay * left + K.chainFinishPerNode * c.k) * v);
        sp.lastChain = { result: "done", slots: chainSlots(c), at };
        sp[key] = null;
        ev.push({ kind: "chain", result: "done" });
        break;
      }
      case "scrap-out": {
        const lim = S0 + x;
        sp.scraps = sp.scraps.filter((s) => s.born + E.scrapLifeMs > lim);
        break;
      }
      case "crane-out": sp.crane = null; break;
      case "boat-out": sp.boat = null; break;
      case "chain-in": {
        sp.nextChainAt = sp.activeMs + (storm ? K.chainStormMs : E.chainEveryMs);
        if (state.settings.nodes === false) break;
        const key = !sp.chain ? "chain" : storm && !sp.chain2 ? "chain2" : null;
        if (!key) break;
        const slots = pickSlots(state, sp, E.chainK);
        if (!slots) break;
        const id = `c${sp.seq++}`;
        sp[key] = { id, k: E.chainK, next: 0, born: sp.shownMs, nodes: slots.map((slot, i) => ({ i, slot, done: false })) };
        ev.push({ kind: "spawn", what: "chain", id });
        break;
      }
      case "scrap-in": {
        sp.nextScrapAt = sp.activeMs + K.scrapEveryMs;
        if (sp.scraps.length >= K.scrapMaxLive) break;
        const slots = pickSlots(state, sp, 1);
        if (!slots) break;
        const id = `s${sp.seq++}`;
        sp.scraps.push({ id, slot: slots[0], born: sp.shownMs });
        ev.push({ kind: "spawn", what: "scrap", id });
        break;
      }
      case "crane-in": {
        if (sp.crane) { sp.nextCraneAt = sp.activeMs + craneInterval(state, E); break; }
        const slots = pickSlots(state, sp, 1);
        if (!slots) { sp.nextCraneAt = sp.activeMs + craneInterval(state, E); break; }
        const u = keyed(state, `crane:${sp.seq}`);
        const outcome = u < 0.5 ? "lucky" : u < 0.8 ? "storm" : "song";
        const id = `g${sp.seq++}`;
        sp.crane = { id, slot: slots[0], born: sp.shownMs, outcome };
        sp.cranesSeen++;
        sp.nextCraneAt = sp.activeMs + craneInterval(state, E);
        ev.push({ kind: "spawn", what: "crane", id, n: sp.cranesSeen });
        break;
      }
      case "boat-in": {
        sp.nextBoatAt = sp.activeMs + (K.boatLo + K.boatSpread * keyed(state, `boat:${sp.seq}`)) * 1000;
        if (sp.boat) break;
        const id = `b${sp.seq++}`;
        sp.boat = { id, born: sp.shownMs };
        ev.push({ kind: "spawn", what: "boat", id });
        break;
      }
      case "ream-in": {
        const id = `r${sp.seq++}`;
        sp.ream = { id, day: state.day, slot: SLOT.ream };
        sp.reamDay = state.day;
        ev.push({ kind: "spawn", what: "ream", id });
        break;
      }
      default:
        break;
    }
  }
  sp.shownMs = S0 + dt;
  if (active) sp.activeMs = A0 + dt;
}

/** ms of life left for a live chain / scrap / crane / boat (null for the ream). */
export function lifeLeft(state, E, what, item) {
  if (!item || item.born === undefined) return null;
  const life = what === "chain" ? E.nodeLifeMs : what === "scrap" ? E.scrapLifeMs : what === "crane" ? E.craneLifeMs : E.boatLifeMs;
  return Math.max(0, item.born + life - state.spawn.shownMs);
}

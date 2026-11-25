// Automations (DESIGN §8). Each runs only when bought and switched on; the
// Crease Helper lives in clicking.js (it acts inside the spawn clock).

import { K, WORKSHOPS, ENVELOPES } from "./content.js";
import { buy, itemInfo, tierOf } from "./economy.js";
import { openEnvelope } from "./envelopes.js";

/** Bought and switched on. */
export function isOn(state, id) {
  return state.bought[id] === true && state.auto[id] !== false;
}

/**
 * Run the automations at `now` after the engine step. `live` is false right
 * after an away segment (the Boost Keeper never opens while the player is away).
 */
export function runAutomations(state, ctx, now, ev, live, onBought) {
  if (isOn(state, "mail-sorter")) {
    for (const id of Object.keys(state.envelopes)) {
      const env = state.envelopes[id];
      if (env.type === "bundle" && now - env.landedAt >= K.mailSorterMs) openEnvelope(state, ctx, id, now, ev);
    }
  }
  if (isOn(state, "thrifty-fox") && now - state.autoAt.fox >= K.foxEveryMs) {
    let best = null;
    let bestPay = Infinity;
    for (const w of WORKSHOPS) {
      const info = itemInfo(state, w.id, 1);
      if (!info.unlocked) continue;
      const pay = info.cost / (w.out * Math.pow(2, tierOf(state, w.id)));
      if (pay < bestPay) { bestPay = pay; best = info; }
    }
    if (best && state.bank >= K.foxBankMult * best.cost) {
      state.autoAt.fox = now;
      const out = buy(state, best.id, 1, onBought);
      for (const e of out) ev.push(e);
      ctx.refreshE();
    }
  }
  if (live && isOn(state, "boost-keeper") && state.presence.active
    && state.hand.lastHitAt > 0 && now - state.hand.lastHitAt <= K.keeperHandMs) {
    let pick = null;
    for (const id of Object.keys(state.envelopes)) {
      const env = state.envelopes[id];
      if (env.type === "bundle" || state.boosts[env.type] > 0) continue;
      if (!pick || env.units > pick[1].units) pick = [id, env];
    }
    if (pick && ENVELOPES.some((d) => d.type === pick[1].type)) openEnvelope(state, ctx, pick[0], now, ev);
  }
}

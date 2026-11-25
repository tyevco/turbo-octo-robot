// Prestige: String the Thousand (DESIGN §9, §3.5).

import { PRESTIGE, K, WORKSHOPS, AUTOMATIONS } from "./content.js";
import { CLICK_SOURCES } from "./economy.js";
import { openEnvelope } from "./envelopes.js";
import { makeMap, newSpawn } from "./state.js";

/**
 * cranes(L) = floor(100 · cbrt(L / Lw)), computed exactly: the largest c with
 * (c/100)³ · Lw ≤ L, so L = 6e9 gives exactly 1,000.
 */
export function cranes(L) {
  if (!(L > 0)) return 0;
  const lw = PRESTIGE.Lw / 1e6; // (c/100)³·Lw = c³·Lw/1e6
  let c = Math.floor(100 * Math.cbrt(L / PRESTIGE.Lw));
  while (c > 0 && c * c * c * lw > L) c--;
  while ((c + 1) * (c + 1) * (c + 1) * lw <= L) c++;
  return c;
}

/** Lifetime folds at which crane `c` is strung. */
export function lifetimeFor(c) {
  return c * c * c * (PRESTIGE.Lw / 1e6);
}

/** Wishes a wish would give now, and whether the gate is open. */
export function wishInfo(state) {
  const c = cranes(state.lifetime);
  const W = state.wishes;
  const total = Math.floor(c / 100);
  const gain = Math.max(0, total - W);
  const needed = W === 0 && state.wishCount === 0
    ? Math.ceil(PRESTIGE.firstCranes / 100)
    : Math.max(PRESTIGE.minGain, Math.ceil(PRESTIGE.gateShare * W));
  const can = W === 0 && state.wishCount === 0 ? c >= PRESTIGE.firstCranes : gain >= needed;
  return { cranes: c, total, gain, needed, can };
}

/** The String tab's numbers (§3.5, §9). */
export function stringInfo(state) {
  const w = wishInfo(state);
  const of = 100 * Math.max(10, w.needed);
  const shown = w.cranes - 100 * state.wishes;
  return {
    cranes: Math.max(0, shown),
    of,
    nextIn: Math.max(0, lifetimeFor(w.cranes + 1) - state.lifetime),
    lifetime: state.lifetime,
    gain: w.gain,
    needed: w.needed,
    can: w.can,
  };
}

/** Garland stripes for the run that ends now (≤ 20: top 16 helpers, hands, workshops, everyone else). */
function garland(state) {
  const run = state.runFolds;
  const stripes = [];
  if (!(run > 0)) return stripes;
  const hs = Object.keys(state.helpers).map((id) => state.helpers[id]).filter((h) => h.kind === "pane" && h.stats.run > 0);
  hs.sort((a, b) => b.stats.run - a.stats.run || (a.id < b.id ? -1 : 1));
  let used = 0;
  for (const h of hs.slice(0, K.garlandHelpers)) {
    stripes.push([`hue:${h.hue}`, round4(h.stats.run / run), h.name]);
    used += h.stats.run;
  }
  let hands = 0;
  for (const s of CLICK_SOURCES) hands += state.stats.runBySource[s] || 0;
  const works = state.stats.runBySource.workshops || 0;
  if (hands > 0) stripes.push(["hands", round4(hands / run), "your hands"]);
  if (works > 0) stripes.push(["workshops", round4(works / run), "workshops"]);
  const rest = run - used - hands - works;
  if (rest > run * 1e-4) stripes.push(["rest", round4(rest / run), "everyone else"]);
  return stripes;
}

function round4(x) {
  return Math.round(x * 1e4) / 1e4;
}

/**
 * Make the wish (§9): open every Bundle at current value, record a garland,
 * reset the run, keep helpers, Album, Wishes, perks, timed boost envelopes,
 * settings, switches, notification counters, lifetime totals and garlands.
 */
export function wish(state, ctx, t, ev) {
  const info = wishInfo(state);
  if (!info.can || info.gain <= 0) {
    ev.push({ kind: "ignored", reason: "wish" });
    return ev;
  }
  // How full the String is as it is wished away: the §3.5 wish moment draws
  // these strands rising and fading (vm string.wishMoment).
  const before = stringInfo(state);
  state.ui.lastWish = { at: t, fill: round4(Math.max(0, Math.min(1, before.cranes / before.of))) };
  for (const id of Object.keys(state.envelopes)) {
    if (state.envelopes[id].type === "bundle") openEnvelope(state, ctx, id, t, ev);
  }
  state.garlands.push({ wish: state.wishCount + 1, day: state.day, stripes: garland(state), wishes: info.gain });
  if (state.garlands.length > K.garlandsMax) state.garlands.splice(0, state.garlands.length - K.garlandsMax);

  const W = state.wishes + info.gain;
  state.wishes = W;
  state.wishCount++;
  const keep = makeMap();
  if (W >= 10) {
    if (state.bought["crisp-corners"] === true) keep["crisp-corners"] = true;
    if (state.bought["mail-sorter"] === true) keep["mail-sorter"] = true;
  }
  if (W >= 100) for (const a of AUTOMATIONS) if (state.bought[a.id] === true) keep[a.id] = true;
  state.bought = keep;
  state.owned = makeMap();
  if (W >= 25) {
    state.owned[WORKSHOPS[0].id] = 10;
    state.owned[WORKSHOPS[1].id] = 5;
  }
  state.bank = 0;
  state.runFolds = 0;
  const b = state.boosts;
  b.rush = 0; b.storm = 0; b.chorus = 0; b.song = 0; b.tailwind = 0; b.tailwindMs = 0; b.rushEnd = 0; b.stormEnd = 0;
  const hand = state.hand;
  hand.r = 0; hand.frame = 0; hand.figures = []; hand.afterglowMs = 0;
  const sp = state.spawn;
  const craneAt = sp.cranesSeen === 0 ? K.craneFirstMs : sp.activeMs + K.craneFirstMs;
  state.spawn = newSpawn(sp.activeMs, sp.shownMs, sp.seq, sp.cranesSeen, sp.reamDay, craneAt, sp.syncedTo);
  if (state.bought["harbour-ribbon"] === true) state.spawn.nextBoatAt = sp.activeMs + K.boatLo * 1000;
  state.away.pot = null;
  state.stats.runBySource = makeMap();
  for (const id in state.helpers) state.helpers[id].stats.run = 0;
  state.notify.firedFull = false;
  ev.push({ kind: "wish", gain: info.gain });
  return ev;
}

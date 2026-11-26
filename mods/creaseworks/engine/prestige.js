// Prestige: String the Thousand (DESIGN §9, §3.5).

import { PRESTIGE, K, WORKSHOPS, AUTOMATIONS } from "./content.js";
import { CLICK_SOURCES } from "./economy.js";
import { openEnvelope } from "./envelopes.js";
import { collect } from "./away.js";
import { makeMap, newSpawn } from "./state.js";

/**
 * cranes(L) = floor(1000 · (L / Lw)^0.4) (firstCranes, stringExp): the
 * largest c with lifetimeFor(c) ≤ L, so cranes(lifetimeFor(c)) is exactly c
 * and L = Lw (6e9) gives exactly 1,000.
 *
 * Review r6-03: the count is held at Number.MAX_SAFE_INTEGER (reached near
 * L 1.46e42), where c + 1 would equal c and the correction could never end,
 * and Infinity or NaN never loop either. The estimate is off by float
 * rounding only, so each correction is capped at CRANE_STEPS steps; every
 * call is a fixed handful of pow calls whatever L is (render 50 ms).
 */
const CRANE_STEPS = 64;
export function cranes(L) {
  if (!(L > 0)) return 0;
  const max = Number.MAX_SAFE_INTEGER;
  if (!(L < Infinity)) return max;
  const est = Math.floor(PRESTIGE.firstCranes * Math.pow(L / PRESTIGE.Lw, PRESTIGE.stringExp));
  if (!(est < max)) return max;
  let c = est;
  for (let i = 0; i < CRANE_STEPS && c > 0 && lifetimeFor(c) > L; i++) c--;
  for (let i = 0; i < CRANE_STEPS && c < max && lifetimeFor(c + 1) <= L; i++) c++;
  return c;
}

/** Lifetime folds at which crane `c` is strung: Lw · (c / 1000)^(1 / 0.4). */
export function lifetimeFor(c) {
  return c > 0 ? PRESTIGE.Lw * Math.pow(c / PRESTIGE.firstCranes, 1 / PRESTIGE.stringExp) : 0;
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

/**
 * The String tab's numbers (§3.5, §9). The String holds `of` =
 * 100·max(10, needed) cranes; `gate` is the shown count at which the wish
 * opens (100·needed, or the first wish's 1,000), which is inside the String
 * (below `of`) for W 10–39 (review r5-12): the String is not full then, so
 * the tab marks the gate and words its lines from the real gains. `atOf` is
 * the gain once the String is full (of / 100 Wishes, or the gain now when it
 * is already past full).
 */
export function stringInfo(state) {
  const w = wishInfo(state);
  const of = 100 * Math.max(10, w.needed);
  const first = state.wishes === 0 && state.wishCount === 0;
  const gate = Math.min(of, first ? PRESTIGE.firstCranes : 100 * w.needed);
  const shown = Math.max(0, w.cranes - 100 * state.wishes);
  return {
    cranes: shown,
    of,
    gate,
    full: shown >= of,
    atOf: Math.max(w.gain, of / 100),
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
 * Make the wish (§9): credit an uncollected away pot, open every Bundle at
 * current value, record a garland, reset the run, keep helpers, Album,
 * Wishes, perks, timed boost envelopes, settings, switches, notification
 * counters, lifetime totals and garlands.
 */
export function wish(state, ctx, t, ev) {
  let info = wishInfo(state);
  if (!info.can || info.gain <= 0) {
    ev.push({ kind: "ignored", reason: "wish" });
    return ev;
  }
  // The while-you-were-away folds are earned: a wish made with the away card
  // still up (it never blocks the tabs, §3.7) credits them first, so they
  // reach lifetime (and so the Wishes) instead of being reset uncounted
  // (review r5-13). The gain can only grow by it.
  if (state.away.pot) {
    collect(state, t, ev, true);
    info = wishInfo(state);
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
  const last = state.owned;
  state.owned = makeMap();
  // 25-Wish perk "Spare parts": a tenth (rounded down) of the last run's
  // workshops of the three cheapest kinds carries over (§9).
  if (W >= 25) {
    for (let k = 0; k < K.spareKinds; k++) {
      const id = WORKSHOPS[k].id;
      const n = Math.floor((last[id] ?? 0) / K.spareDiv);
      if (n > 0) state.owned[id] = n;
    }
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

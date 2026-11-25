// Engine public API (ARCHITECTURE B2): apply, advance, replay, rates and the
// state helpers. Pure in the sense of A3: no clock, no randomness but the
// seeded PRNG in the state; functions mutate the state passed in.

import * as CONTENT_TABLES from "./content.js";
import { keyed } from "./prng.js";
import { effects, buy as buyItem, credit, estimateDelta } from "./economy.js";
import { indexHelpers, flock, helperBreaks, chargeRest, creditHelpers, observe } from "./helpers.js";
import { openEnvelope } from "./envelopes.js";
import { click, spawnPiece, inStep, stepMult, songMult } from "./clicking.js";
import { awaySegment, collect, potLive, rebase, look } from "./away.js";
import { wish } from "./prestige.js";
import { runAutomations } from "./automations.js";
import { newGame, cloneState, migrate, VERSION, MAP_FIELDS } from "./state.js";

const K = CONTENT_TABLES.K;

export { newGame, cloneState, migrate, VERSION, MAP_FIELDS };
export { effects, itemInfo, workshopCost, maxAffordable, tierOf, eff, crowd, CLICK_SOURCES } from "./economy.js";
export { cranes, lifetimeFor, wishInfo, stringInfo } from "./prestige.js";
export { groupFor, helperId, lookOf } from "./helpers.js";
export { nodeId, slotXY, lifeLeft, inStep, combo, rhythmAt, hitBoost } from "./clicking.js";
export { stackFactor, envelopeDef } from "./envelopes.js";
export { isOn } from "./automations.js";
export { fnv1a32, fnv1a32n } from "./hash.js";
export const CONTENT = CONTENT_TABLES;

/**
 * The step context: effects of what is bought, the present-helper index and a
 * per-time cache of rates. `writer` is the advancing writer (or undefined).
 */
function makeCtx(state, writer) {
  const ctx = {
    writer,
    E: effects(state),
    idx: indexHelpers(state),
    cacheT: NaN,
    cache: null,
    refresh() { ctx.idx = indexHelpers(state); ctx.cacheT = NaN; },
    refreshE() { ctx.E = effects(state); ctx.cacheT = NaN; },
    rates(t) {
      if (ctx.cacheT === t && ctx.cache) return ctx.cache;
      ctx.cache = ratesAt(state, ctx, t);
      ctx.cacheT = t;
      return ctx.cache;
    },
  };
  return ctx;
}

function ratesAt(state, ctx, t) {
  const E = ctx.E;
  const fl = flock(state, E, ctx.idx, t, ctx.writer);
  const Hs0 = fl.Hs0 + fl.Hstale;
  const Rp = E.Rw + (E.gather ? Hs0 : 0);
  const Hs = E.gather ? fl.Hs0 * stepMult(state, E, t) * songMult(state) + fl.Hstale : 0;
  return {
    G: E.G, Rw: E.Rw, Hs0, Hs, Rp, hand: E.hand, echo: E.echo,
    V: E.hand * E.G + E.echo * Rp,
    crowd: fl.crowd, nWorking: fl.n, nPresent: fl.N, Hstale: fl.Hstale,
  };
}

/** rates(state) at state.clock (ARCHITECTURE B2). */
export function rates(state, writer) {
  return makeCtx(state, writer).rates(state.clock);
}

/**
 * Estimated income gain per open second of buying `item` (BALANCE §3.1), as
 * used by the best-buy hint and the simulator. `o` = { activeFrac, cps }.
 */
export function estimate(state, item, o) {
  const ctx = makeCtx(state);
  return estimateDelta(state, ctx.E, flock(state, ctx.E, ctx.idx, state.clock), item, o);
}

/** Purchases with side effects on the spawn clocks. */
function afterBuy(state, item) {
  if (item === "harbour-ribbon" && state.spawn.nextBoatAt === null) {
    state.spawn.nextBoatAt = state.spawn.activeMs + (K.boatLo + K.boatSpread * keyed(state, "boat:first")) * 1000;
  }
}

/** The next time in (t, t1] where a rate or a clock changes slope. */
function nextBreak(state, ctx, t, t1) {
  const out = [];
  const E = ctx.E;
  const h = state.hand;
  const b = state.boosts;
  if (inStep(state, E, t)) out.push(h.lastHitAt + E.gapMs);
  if (h.afterglowMs > 0) out.push(t + h.afterglowMs);
  if (b.chorus > 0) out.push(t + b.chorus);
  if (b.song > 0) out.push(t + b.song);
  if (b.tailwindMs > 0) out.push(t + b.tailwindMs);
  const end = state.presence.lastHandAt + K.activeWindowMs;
  if (end > t) out.push(end);
  helperBreaks(state, ctx.idx, t, t1, ctx.writer, out);
  let m = t1;
  for (const x of out) if (x > t && x < m) m = x;
  return m;
}

/**
 * Spawn clocks belong to the window being played: the writer of the latest
 * hand input (or any writer before the first one, or a caller that names no
 * writer). Other windows advancing the shared clock leave the mat alone, and
 * the owner's actions merged in late first bring the spawn clocks up to their
 * own time (syncSpawns), so every lineage of the save spawns the same pieces.
 */
function spawnOwner(state, writer) {
  const by = state.presence.handBy;
  return writer === undefined || writer === null || !by || by === writer;
}

/**
 * Spawn clocks over [t, t + dt), split where active time ends (30 s after the
 * last hand input) and where a Paper Storm ends (boosts.stormEnd, wall time).
 */
function spawnSpan(state, ctx, t, dt, ev) {
  const p = state.presence;
  const b2 = state.boosts;
  const shown = p.visible !== false && p.matShown !== false;
  const activeEnd = p.lastHandAt + K.activeWindowMs;
  const canBeActive = shown && p.active !== false;
  const end = t + dt;
  let a = t;
  while (a < end) {
    let b = end;
    if (activeEnd > a && activeEnd < b) b = activeEnd;
    if (b2.stormEnd > a && b2.stormEnd < b) b = b2.stormEnd;
    spawnPiece(state, ctx, a, b - a, shown, canBeActive && a < activeEnd, ev, a < b2.stormEnd);
    a = b;
  }
  if (dt === 0) spawnPiece(state, ctx, t, 0, shown, canBeActive && t < activeEnd, ev, t < b2.stormEnd);
}

/** Bring the spawn clocks from spawn.syncedTo up to `upTo` (they lag only after a merge). */
function syncSpawns(state, ctx, upTo, ev) {
  const sp = state.spawn;
  const from = sp.syncedTo;
  if (!(from < upTo)) return;
  if (upTo - from <= K.spawnCatchUpMs) spawnSpan(state, ctx, from, upTo - from, ev);
  sp.syncedTo = upTo;
}

/** One live piece [t, t + dt) with constant rates (closed form). */
function piece(state, ctx, t, dt, ev, earned) {
  const E = ctx.E;
  const sec = dt / 1000;
  const fl = flock(state, E, ctx.idx, t, ctx.writer);
  if (E.Rw > 0) earned.workshops += credit(state, "workshops", E.Rw * sec);
  if (E.gather) {
    const mult = stepMult(state, E, t) * songMult(state);
    const amount = (fl.Hs0 * mult + fl.Hstale) * sec;
    if (amount > 0) {
      earned.helpers += credit(state, "helpers", amount);
      creditHelpers(fl, mult, fl.Hstale, sec);
    }
  }
  chargeRest(ctx.idx, E, dt);
  if (spawnOwner(state, ctx.writer)) {
    syncSpawns(state, ctx, t, ev);
    spawnSpan(state, ctx, t, dt, ev);
    state.spawn.syncedTo = t + dt;
  }
  const b = state.boosts;
  b.rush = Math.max(0, b.rushEnd - (t + dt));
  b.storm = Math.max(0, b.stormEnd - (t + dt));
  b.chorus = Math.max(0, b.chorus - dt);
  b.song = Math.max(0, b.song - dt);
  if (b.tailwindMs > 0) {
    b.tailwindMs = Math.max(0, b.tailwindMs - dt);
    if (b.tailwindMs === 0) b.tailwind = 0;
  }
  state.hand.afterglowMs = Math.max(0, state.hand.afterglowMs - dt);
  potLive(state, dt, t + dt, ev);
}

/** Move the clock from state.clock to `now` (> clock): an away segment if the gap is > 60 s. */
function step(state, ctx, now, ev) {
  const t0 = state.clock;
  const earned = { workshops: 0, helpers: 0 };
  let live = true;
  if (now - t0 > K.awayAfterMs) {
    awaySegment(state, ctx, t0, now, ev);
    state.spawn.syncedTo = now; // spawns are frozen while away
    live = false;
  } else {
    let t = t0;
    for (let guard = 0; t < now && guard < 100000; guard++) {
      const t1 = nextBreak(state, ctx, t, now);
      piece(state, ctx, t, t1 - t, ev, earned);
      t = t1;
    }
  }
  state.clock = now;
  if (ctx.writer !== undefined && ctx.writer !== null) {
    const w = state.writersSeen[ctx.writer];
    if (!(w >= now)) state.writersSeen[ctx.writer] = now;
  }
  if (earned.workshops > 0) ev.push({ kind: "earn", source: "workshops", amount: earned.workshops });
  if (earned.helpers > 0) ev.push({ kind: "earn", source: "helpers", amount: earned.helpers });
  runAutomations(state, ctx, now, ev, live, (item) => afterBuy(state, item));
  const n = state.notify;
  const piled = Object.keys(state.envelopes).length >= K.pileCount;
  if (piled && n.pileSince === null) n.pileSince = now;
  if (!piled) n.pileSince = null;
  pruneNotices(state, now);
}

function pruneNotices(state, now) {
  const list = state.notices;
  for (let i = list.length - 1; i >= 0; i--) {
    const x = list[i];
    const life = x.kind === "overflow" || x.kind === "away" ? K.noteLifeMs : x.kind === "busy" ? K.busyMs : Infinity;
    if (now - x.at > life) list.splice(i, 1);
  }
}

/**
 * advance(state, now[, writer]) → Event[]. Moves time forward from state.clock
 * (closed form per segment; an away segment when the gap is > 60 s). A clock
 * more than 5 s behind state.clock is a clock-back: no credit, rebase, notice.
 * `writer` (the glue's writerId) lets helpers another window stopped observing
 * fall back to the away rate (§10.2); without it every helper counts as seen.
 */
export function advance(state, now, writer) {
  const ev = [];
  if (typeof now !== "number" || !Number.isFinite(now)) return ev;
  if (now < state.clock - K.clockBackMs) {
    rebase(state, now, ev);
    state.rev++;
    return ev;
  }
  if (now <= state.clock) return ev;
  step(state, makeCtx(state, writer), now, ev);
  state.rev++;
  return ev;
}

const SETTINGS = {
  calm: "bool", gather: "bool", nodes: "bool", pops: "bool",
  "notify.master": "bool", "notify.full": "bool", "notify.pile": "bool", "notify.save": "bool",
  order: ["urgency", "workspace"], density: ["auto", "always", "never"], style: ["short", "sci"],
};

function setting(state, key, value, ev) {
  const rule = Object.hasOwn(SETTINGS, key) ? SETTINGS[key] : null;
  if (!rule) return ev.push({ kind: "ignored", reason: "setting" });
  if (rule === "bool" ? typeof value !== "boolean" : rule.indexOf(value) < 0) {
    return ev.push({ kind: "ignored", reason: "value" });
  }
  const dot = key.indexOf(".");
  if (dot < 0) state.settings[key] = value;
  else state.settings[key.slice(0, dot)][key.slice(dot + 1)] = value;
  return ev.push({ kind: "setting", key, value });
}

function notified(state, action, ev) {
  const n = state.notify;
  const day = action.day;
  if (typeof day !== "string") return ev.push({ kind: "ignored", reason: "day" });
  if (day > n.day) { n.day = day; n.sent = 0; }
  if (day < n.day) return ev.push({ kind: "ignored", reason: "old-day" });
  n.sent++;
  if (action.event === "full") n.firedFull = true;
  else if (action.event === "pile") n.pileDay = day;
  else if (action.event === "save") n.saveEpisode = action.episode ?? day;
  return ev.length;
}

function dismiss(state, action, t, ev) {
  const kind = action.notice;
  if (kind === "away" && state.away.pot) collect(state, t, ev, false);
  const list = state.notices;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].kind === kind && (action.at === undefined || list[i].at === action.at)) list.splice(i, 1);
  }
}

const PLAYER = { click: 1, open: 1, buy: 1, wish: 1, collect: 1 };

/**
 * apply(state, action) → Event[] (ARCHITECTURE A5, B5). Idempotent by (w, s):
 * an action with s ≤ applied[w] is ignored. Advances to max(clock, t) first.
 */
export function apply(state, action) {
  const ev = [];
  if (!action || typeof action !== "object") return [{ kind: "ignored", reason: "shape" }];
  const w = action.w;
  const s = action.s;
  if (typeof w !== "string" || typeof s !== "number" || !Number.isFinite(s)) return [{ kind: "ignored", reason: "shape" }];
  const last = state.applied[w];
  if (typeof last === "number" && s <= last) return [{ kind: "ignored", reason: "applied" }];
  const t = typeof action.t === "number" && Number.isFinite(action.t) ? action.t : state.clock;
  const ctx = makeCtx(state, w);
  if (t > state.clock) {
    step(state, ctx, t, ev);
    ctx.cacheT = NaN;
  }
  state.applied[w] = s;
  const seen = state.writersSeen[w];
  if (!(seen >= t)) state.writersSeen[w] = t;
  const now = state.clock;
  if (PLAYER[action.type]) look(state, t);
  if (action.type === "click" && t >= state.presence.lastHandAt) state.presence.handBy = w;
  // The owner's actions see the spawn clocks at their own time (merges replay them late).
  if (spawnOwner(state, w)) syncSpawns(state, ctx, Math.min(t, now), ev);
  switch (action.type) {
    case "click":
      click(state, ctx, action, t, ev);
      break;
    case "open":
      openEnvelope(state, ctx, String(action.helperId), Math.min(t, now), ev);
      break;
    case "buy":
      for (const e of buyItem(state, String(action.item), action.count, (item) => afterBuy(state, item))) ev.push(e);
      break;
    case "switch":
      if (state.bought[action.id] === true && CONTENT_TABLES.AUTOMATIONS.some((a) => a.id === action.id)) {
        state.auto[action.id] = action.on === true;
      } else {
        ev.push({ kind: "ignored", reason: "switch" });
      }
      break;
    case "setting":
      setting(state, String(action.key), action.value, ev);
      break;
    case "wish":
      wish(state, ctx, now, ev);
      break;
    case "collect":
      collect(state, now, ev, false);
      break;
    case "rebase":
      rebase(state, t, ev);
      break;
    case "observe": {
      observe(state, ctx, action, t, ev);
      const sp = state.spawn;
      if (sp.ream && sp.ream.day !== state.day) sp.ream = null;
      break;
    }
    case "dismiss":
      dismiss(state, action, now, ev);
      break;
    case "notified":
      notified(state, action, ev);
      break;
    case "hint":
      if (action.key === "fold" || action.key === "crane") state.ui.hints[action.key] = true;
      else if (action.key === "narrow") state.ui.narrowHintDay = state.day;
      else ev.push({ kind: "ignored", reason: "hint" });
      break;
    case "checkin": {
      const h = state.helpers[String(action.helperId)];
      if (h) h.stats.checkIns++;
      else ev.push({ kind: "ignored", reason: "gone" });
      break;
    }
    default:
      ev.push({ kind: "ignored", reason: "type" });
  }
  state.rev++;
  return ev;
}

/** apply each action in order. */
export function replay(state, actions) {
  const ev = [];
  for (const a of actions) for (const e of apply(state, a)) ev.push(e);
  return ev;
}

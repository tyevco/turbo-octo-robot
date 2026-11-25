// Away segments, the shared 8 h cap, the away pot, Collect, the clock-back
// rebase and the "While you were busy" card (DESIGN §10, §3.7).

import { K, WORKSHOPS, UPGRADES, AUTOMATIONS } from "./content.js";
import { credit, crowd, itemInfo } from "./economy.js";
import { freshness } from "./helpers.js";
import { pushNotice } from "./envelopes.js";

/**
 * Credit an away segment (clock, now] in closed form:
 * away = f · (Rw + crowd(N) · Σ_present (0.3·G + 0.04·Rw) · folk) · a, a = min(gap, cap left).
 * Boost timers, afterglow, spawns and the rhythm are frozen; rest charges by a.
 */
export function awaySegment(state, ctx, t0, t1, ev) {
  const E = ctx.E;
  const aw = state.away;
  const gap = t1 - t0;
  if (aw.lastSegmentEnd === null || t0 - aw.lastSegmentEnd >= K.capShareLiveMs) aw.capUsedMs = 0;
  const a = Math.max(0, Math.min(gap, K.awayCapMs - aw.capUsedMs));
  aw.capUsedMs += a;
  aw.lastSegmentEnd = t1;
  const capped = a < gap;
  // Boost timers are frozen while away: hand-hit boost ends move by the gap.
  const bo = state.boosts;
  if (bo.rushEnd > t0) bo.rushEnd += gap;
  if (bo.stormEnd > t0) bo.stormEnd += gap;
  const sec = a / 1000;

  // Present pane helpers whose window was seen within 8 h, whatever their status.
  const panes = ctx.idx.panes.filter((h) => freshness(state, h, t0, ctx.writer) !== 0);
  const N = panes.length;
  const base = (K.helperFlat * E.G + K.helperRw * E.Rw) * E.folk;
  const works = E.awayF * E.Rw * sec;
  const helpers = E.gather ? E.awayF * crowd(N) * base * N * sec : 0;
  if (N > 0 && helpers > 0) {
    const each = helpers / N;
    for (const h of panes) { h.stats.folds += each; h.stats.run += each; }
  }
  let rested = 0;
  const add = a / E.restFullMs;
  for (const h of ctx.idx.present) {
    if (h.status !== "idle" && h.status !== "done") continue;
    const was = h.rest;
    h.rest = Math.min(1, h.rest + add);
    if (was < 1 && h.rest >= 1) rested++;
  }
  const folds = works + helpers;
  ev.push({ kind: "away", seconds: sec, credited: folds, capped });
  aw.busy = { since: t1, folds: 0, tasks: 0 };

  if (gap < K.awayCardMs && !aw.pot) {
    if (folds > 0) {
      credit(state, "away", folds);
      ev.push({ kind: "earn", source: "away", amount: folds });
    }
    aw.last = { seconds: sec, folds, at: t1 };
    pushNotice(state, { kind: "away", at: t1, data: { seconds: sec, folds } });
    return;
  }
  // A new pot snapshots every pane helper's task count (`tasks0`, [id, n]
  // pairs) so the card's best helper counts the tasks done since the last
  // visit, not lifetime totals (§10.3).
  const p = aw.pot || {
    seconds: 0, gap: 0, capped: false, folds: 0, split: { workshops: 0, helpers: 0 },
    envelopes: 0, needs: [], rested: 0, best: null, affordable: [], at: t1, liveMs: 0,
    tasks0: ctx.idx.panes.map((h) => [h.id, h.stats.tasks]),
  };
  p.seconds += sec;
  p.gap += gap;
  p.capped = p.capped || capped;
  p.folds += folds;
  p.split.workshops += works;
  p.split.helpers += helpers;
  p.envelopes = Object.keys(state.envelopes).length;
  p.needs = ctx.idx.present.filter((h) => h.status === "blocked").map((h) => h.id);
  p.rested += rested;
  const top = bestSince(state, p);
  p.best = top ? top.helper.id : null;
  p.affordable = affordableWith(state, state.bank + p.folds);
  p.at = t1;
  p.liveMs = 0;
  aw.pot = p;
}

/**
 * The present pane helper with the most tasks finished since the pot's
 * snapshot (`tasks0`): { helper, tasks } with tasks > 0, or null. A pot
 * without a snapshot (an older save) or a helper that joined after it has no
 * known baseline and is left out.
 */
export function bestSince(state, p) {
  if (!p || !Array.isArray(p.tasks0)) return null;
  const hs = state.helpers;
  let best = null;
  for (const pair of p.tasks0) {
    if (!Array.isArray(pair)) continue;
    const id = String(pair[0]);
    const h = Object.hasOwn(hs, id) ? hs[id] : null;
    if (!h || h.gone || !h.stats) continue;
    const n = (typeof h.stats.tasks === "number" ? h.stats.tasks : 0) - (typeof pair[1] === "number" ? pair[1] : 0);
    if (n > 0 && (!best || n > best.tasks || (n === best.tasks && h.id < best.helper.id))) best = { helper: h, tasks: n };
  }
  return best;
}

/** Up to 3 items (most expensive first) the bank plus `funds` would buy that it cannot buy now. */
function affordableWith(state, funds) {
  const out = [];
  const consider = (id) => {
    const info = itemInfo(state, id, 1);
    if (info && info.unlocked && !info.have && info.cost <= funds && info.cost > state.bank) out.push([info.cost, id]);
  };
  for (const w of WORKSHOPS) consider(w.id);
  for (const u of UPGRADES) consider(u.id);
  for (const a of AUTOMATIONS) consider(a.id);
  out.sort((x, y) => y[0] - x[0] || (x[1] < y[1] ? -1 : 1));
  return out.slice(0, 3).map((x) => x[1]);
}

/** Credit the away pot (the Collect click, the card's ✕, or 10 min of live time). */
export function collect(state, t, ev, auto) {
  const p = state.away.pot;
  if (!p) {
    ev.push({ kind: "ignored", reason: "pot" });
    return ev;
  }
  state.away.pot = null;
  if (p.folds > 0) {
    credit(state, "away", p.folds);
    ev.push({ kind: "earn", source: "away", amount: p.folds });
  }
  state.away.last = { seconds: p.seconds, folds: p.folds, at: t };
  if (auto) pushNotice(state, { kind: "away", at: t, data: { seconds: p.seconds, folds: p.folds } });
  return ev;
}

/** Live time passes for the pot; after 10 min it is credited anyway. */
export function potLive(state, dtMs, t, ev) {
  const p = state.away.pot;
  if (!p) return;
  p.liveMs += dtMs;
  if (p.liveMs >= K.potAutoMs) collect(state, t, ev, true);
}

/**
 * Time forward over a stretch this save already counted (§10.1). After a
 * clock-back the clock sits below `away.highWater`; the mark moves on with
 * every credited stretch, so `highWater − clock` stays the size of the
 * clock-back. A move forward from below the mark is one of:
 * - the clock put right: it lands on the mark (within 5 s) or past it. The
 *   whole stretch up to the mark is skipped (no credit, frozen like a rebase:
 *   boost ends move with it), whatever its size.
 * - an absence (> 60 s, the away threshold) that lands below the mark: real
 *   time, or the clock put only partly right; it cannot be told which. Up to
 *   `away.skipLeft` of it is skipped: what the clock-backs since the mark
 *   moved back, capped at the 8 h away cap (the most a put-right jump could
 *   ever have credited). A clock wrong forward and then corrected costs at
 *   most 8 h of absence, never every absence until wall time catches up;
 *   clock round trips of any size, whole or partial, credit nothing twice.
 * - a live move (≤ 60 s; a hidden window's 5 s ticks too): credited as usual.
 * A skip that swallows more than the away threshold is never silent: the
 * `clock` notice is raised again if it is not already showing. The notice
 * stays until it is dismissed.
 * Returns the ms skipped (0 when nothing was).
 */
export function skipCounted(state, now) {
  const aw = state.away;
  const c = state.clock;
  const hw = aw.highWater;
  if (!(typeof hw === "number" && hw > c && now > c)) return 0;
  const left = typeof aw.skipLeft === "number" && aw.skipLeft > 0 ? Math.min(aw.skipLeft, K.awayCapMs) : 0;
  let to;
  if (now >= hw - K.clockBackMs) {
    to = Math.min(now, hw);
    if (to >= hw) aw.skipLeft = 0;
  } else if (now - c > K.awayAfterMs && left > 0) {
    to = c + Math.min(now - c, left);
    aw.skipLeft = left - (to - c);
  } else {
    return 0;
  }
  const shift = to - c;
  const bo = state.boosts;
  if (bo.rushEnd > c) bo.rushEnd += shift;
  if (bo.stormEnd > c) bo.stormEnd += shift;
  if (state.spawn.syncedTo < to) state.spawn.syncedTo = to;
  state.clock = to;
  if (shift > K.awayAfterMs && !state.notices.some((n) => n.kind === "clock")) pushNotice(state, { kind: "clock", at: to });
  return shift;
}

/** Keep `away.highWater` after time moved forward from `from` to `state.clock` (credited). */
export function raiseHighWater(state, from) {
  const aw = state.away;
  const hw = typeof aw.highWater === "number" ? aw.highWater : from;
  const g = Math.max(0, state.clock - from);
  aw.highWater = hw > from ? hw + g : Math.max(hw, state.clock);
}

/** The clock moved back: no credit, rebase to `now`, show the `clock` notice. */
export function rebase(state, now, ev) {
  if (!(now < state.clock)) return ev;
  const shift = now - state.clock;
  const bo = state.boosts;
  if (bo.rushEnd > state.clock) bo.rushEnd += shift;
  if (bo.stormEnd > state.clock) bo.stormEnd += shift;
  state.clock = now;
  state.away.lastSegmentEnd = state.away.lastSegmentEnd === null ? null : Math.min(state.away.lastSegmentEnd, now);
  // What a later absence below the mark may skip grows by this clock-back (≤ 8 h).
  const left = typeof state.away.skipLeft === "number" && state.away.skipLeft > 0 ? state.away.skipLeft : 0;
  state.away.skipLeft = Math.min(K.awayCapMs, left - shift);
  pushNotice(state, { kind: "clock", at: now });
  ev.push({ kind: "notice", notice: "clock" });
  return ev;
}

/** A player intent at `t`: closes a live absence of ≥ 30 min with the "busy" card. */
export function look(state, t) {
  const b = state.away.busy;
  if (b && t - b.since >= K.busyMs) {
    pushNotice(state, {
      kind: "busy", at: t,
      data: { seconds: (t - b.since) / 1000, folds: b.folds, tasks: b.tasks, envelopes: Object.keys(state.envelopes).length },
    });
  }
  state.away.busy = { since: t, folds: 0, tasks: 0 };
  state.away.lastLiveAt = t;
}

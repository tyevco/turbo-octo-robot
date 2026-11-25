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
  const p = aw.pot || {
    seconds: 0, gap: 0, capped: false, folds: 0, split: { workshops: 0, helpers: 0 },
    envelopes: 0, needs: [], rested: 0, best: null, affordable: [], at: t1, liveMs: 0,
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
  let best = null;
  for (const h of ctx.idx.panes) if (!best || h.stats.tasks > best.stats.tasks) best = h;
  p.best = best && best.stats.tasks > 0 ? best.id : null;
  p.affordable = affordableWith(state, state.bank + p.folds);
  p.at = t1;
  p.liveMs = 0;
  aw.pot = p;
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

/** The clock moved back: no credit, rebase to `now`, show the `clock` notice. */
export function rebase(state, now, ev) {
  if (!(now < state.clock)) return ev;
  const shift = now - state.clock;
  const bo = state.boosts;
  if (bo.rushEnd > state.clock) bo.rushEnd += shift;
  if (bo.stormEnd > state.clock) bo.stormEnd += shift;
  state.clock = now;
  state.away.lastSegmentEnd = state.away.lastSegmentEnd === null ? null : Math.min(state.away.lastSegmentEnd, now);
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

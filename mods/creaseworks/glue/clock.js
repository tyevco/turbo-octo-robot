// The glue's clock (ARCHITECTURE A3, A7; DESIGN §11.2). The only place that
// reads the wall clock: the harnesses swap the global `Date.now` for their
// virtual clock, so everything above this file is testable.

import { WISH_MOMENT } from "../engine/view.js";

/** Wall clock, ms since the epoch. */
export function now() {
  return Date.now();
}

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** The local calendar day of `ms` as "YYYY-MM-DD" (timezone offset applied; no Intl). */
export function localDay(ms) {
  const d = new Date(ms);
  const local = new Date(ms - d.getTimezoneOffset() * 60000);
  return `${pad(local.getUTCFullYear(), 4)}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

/** Local wall time of `ms` as "HH:MM" (for "Loaded the backup from 14:02"). */
export function localTime(ms) {
  const d = new Date(ms);
  const local = new Date(ms - d.getTimezoneOffset() * 60000);
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

/** The re-render bucket of `ms`: counters change every second, every 5 s in calm mode (§11.1). */
export function bucket(ms, calm) {
  return Math.floor(ms / (calm ? 5000 : 1000));
}

/**
 * The phase of the String's wish moment at `ms` (engine view.js wishMomentOf):
 * "rise", "settle", or "" outside it. The view model shows a different
 * String in each, so a copy builds one for each phase as it starts, whatever
 * its re-render bucket: in calm mode a 5 s bucket could pass over the 2 s
 * "settle", and the strands faded by "rise" came back at full opacity (r8-11).
 */
export function wishPhase(state, ms) {
  const lw = state && state.ui ? state.ui.lastWish : null;
  if (!lw || typeof lw.at !== "number") return "";
  const dt = ms - lw.at;
  if (!(dt >= 0 && dt < WISH_MOMENT.settleMs)) return "";
  return dt < WISH_MOMENT.riseMs ? "rise" : "settle";
}

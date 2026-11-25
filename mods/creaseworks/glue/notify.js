// Notifications (DESIGN §11.2): opt-in, at most 3 a day across every event
// and every window, never sound, never for agent status.
//
// The counter `{day, sent}` lives in the save and merges by max per day
// (engine `notified` action). A notification is first CLAIMED: the ticker
// dispatches `{type:"notified", event, day}` and saves at once; only when that
// save is confirmed (after any merge with another window) and the merged
// counter for the day is still ≤ 3 does it call notify(). Two windows racing
// for the last slot therefore send one notification, not two. The save event
// cannot wait for a save (saving is what fails), so it is sent on the local
// counter.
//
// Save problems never depend on notifications: if the ribbon and the panel
// are both hidden while a save problem lasts 30 s, the ribbon is shown once
// per episode instead (run("layout.show", {id: "cw-ribbon"})).

import { notify, run } from "herdr";
import { wishInfo } from "../engine/index.js";
import { dispatch, touch } from "./live.js";
import { problemEpisode } from "./store.js";

export const DAILY_CAP = 3;
export const PILE_MS = 30 * 60000;
export const SAVE_PROBLEM_MS = 5 * 60000;
export const RESCUE_MS = 30000;
export const ICON = "mods/creaseworks/art/notify-icon.svg";

/** How many notifications the save says were sent on `day`. */
export function sentOn(state, day) {
  const n = state.notify;
  return n && n.day === day ? n.sent : 0;
}

/**
 * The event that wants a notification now, or null. `env` = { day, quiet }:
 * quiet = the panel is shown and the window is active (nothing is sent then).
 */
export function wanted(slot, t, env) {
  const s = slot.state;
  if (!s) return null;
  const set = s.settings.notify;
  if (!set || set.master !== true || env.quiet) return null;
  if (sentOn(s, env.day) >= DAILY_CAP) return null;
  const n = s.notify;
  if (set.full !== false && !n.firedFull && wishInfo(s).can) {
    return { event: "full", title: "Your string is full", body: "A wish is ready in Creaseworks." };
  }
  if (set.pile !== false && n.pileSince !== null && t - n.pileSince >= PILE_MS && n.pileDay !== env.day) {
    const k = Object.keys(s.envelopes).length;
    return { event: "pile", title: "Envelopes are piling up", body: `${k} unopened envelopes are waiting in Creaseworks.` };
  }
  const ep = problemEpisode(slot);
  if (set.save !== false && ep && t - ep.since >= SAVE_PROBLEM_MS && n.saveEpisode !== ep.id) {
    return { event: "save", episode: ep.id, title: "Creaseworks can't save", body: ep.text || "Your progress is safe in memory; see the banner." };
  }
  return null;
}

function send(w) {
  try {
    notify({ title: w.title, body: w.body, level: "info", timeout: 6000, icon: ICON, action: { name: "layout.show", args: { id: "cw-panel" } } });
    return true;
  } catch {
    return false;
  }
}

/**
 * One ticker step. Returns what happened: "claimed", "sent", "capped",
 * "rescued" or null. `save()` asks for an immediate save (the claim).
 */
export function check(slot, t, env, save) {
  const s = slot.state;
  if (!s) return null;
  rescue(slot, t, env);
  const N = slot.notify;
  const claim = N.claim;
  if (claim) {
    if (slot.save.confirmed >= claim.s) {
      N.claim = null;
      touch(slot);
      if (sentOn(s, claim.day) <= DAILY_CAP && claim.day === env.day) return send(claim) ? "sent" : null;
      return "capped";
    }
    if (claim.at > t) claim.at = t; // the wall clock moved back: count the 10 min from now
    if (t - claim.at > 10 * 60000) N.claim = null; // never confirmed (read-only, failing saves): give up
    return null;
  }
  const w = wanted(slot, t, env);
  if (!w) return null;
  const action = { type: "notified", event: w.event, day: env.day };
  if (w.episode) action.episode = w.episode;
  dispatch(slot, action, t);
  if (w.event === "save") return send(w) ? "sent" : null;
  N.claim = { s: slot.seq, event: w.event, day: env.day, at: t, title: w.title, body: w.body };
  save();
  return "claimed";
}

/** Shows the ribbon once per save-problem episode when the ribbon and the panel are both hidden for 30 s. */
export function rescue(slot, t, env) {
  const ep = problemEpisode(slot);
  if (!ep || !env.layout || !env.layout.known) return false;
  if (!env.layout.ribbonHidden || !env.layout.panelHidden) return false;
  if (t - ep.since < RESCUE_MS || slot.notify.rescued === ep.id) return false;
  slot.notify.rescued = ep.id;
  try {
    run("layout.show", { id: "cw-ribbon" });
  } catch {
    // a refused run arrives as a herdr toast; nothing more to do
  }
  return true;
}

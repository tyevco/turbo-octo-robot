// The handover slot (ARCHITECTURE A5, A6; DESIGN §12.3, §12.4).
//
// One live game per VM, shared by every copy of the mod (panel, ribbon) and
// carried across hot reloads at globalThis[Symbol.for("creaseworks/live")].
// The slot holds PLAIN DATA ONLY (no functions, no class instances of any code
// generation): numbers, strings, arrays, plain and null-prototype objects.
// It is created and changed only from init, handlers and tasks — never at
// module top level.

import { apply } from "../engine/index.js";

export const SLOT_KEY = Symbol.for("creaseworks/live");
export const SLOT_VERSION = 1;
/** A ticker whose heartbeat is older than this hands over (A6). */
export const TICKER_STALE_MS = 5000;
/** Copies silent this long are forgotten. */
const FORGET_MS = 60000;
/** Saves: 2 s after a purchase, wish, setting, switch or envelope open; else 15 s (§12.1). */
export const DEBOUNCE_MS = 2000;
export const CADENCE_MS = 15000;
const URGENT = { buy: 1, wish: 1, setting: 1, switch: 1, open: 1, collect: 1, notified: 1 };

const map = () => Object.create(null);

/** A random id (writerId, copy ids): 12 base-36 characters from Math.random (glue only). */
export function randomId() {
  let s = "";
  for (let i = 0; i < 12; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

/** A uint32 seed for newGame (glue only). */
export function randomSeed() {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

/** The slot if one of this shape is installed, else null. */
export function getSlot() {
  const s = globalThis[SLOT_KEY];
  return s && typeof s === "object" && s.v === SLOT_VERSION ? s : null;
}

/** Installs `slot` as the VM's live game. */
export function installSlot(slot) {
  globalThis[SLOT_KEY] = slot;
  return slot;
}

/** Forgets the VM's live game (tests, shots). */
export function dropSlot() {
  delete globalThis[SLOT_KEY];
}

/**
 * A new slot for app home `home`. `state` stays null until the store has
 * loaded (A4 load order); `paths` come from the store.
 */
export function newSlot(home, paths) {
  return {
    v: SLOT_VERSION,
    home,
    writerId: randomId(),
    seq: 0,
    baseText: null, // the exact text expected on disk (CAS)
    bakText: null,
    bakAt: null,
    pending: [],
    state: null,
    notice: null, // the save notice on show: { kind, text?, message?, retryMs?, at }
    inflight: null, // { text, upto } while a save write is under way
    copies: map(), // copyId → last heartbeat ms
    ticker: null,
    rev: 0, // glue change counter (state, notices, flashes, requests)
    paths,
    loading: 0, // load generation in progress (0: none)
    readOnly: false,
    save: {
      status: "ok", baseOk: false, gen: 0, writing: null, savedAt: null, dirtyAt: null, urgentAt: null,
      writtenRev: -1, confirmed: 0, errors: 0, retryAt: 0, damaged: [], problemSince: null,
    },
    notices: { load: null, write: null },
    flash: null, // { text, until }
    obs: { sig: null, presence: null },
    live: map(), // address → true (latest terminals() read; §5.6 liveness)
    panes: map(), // pane agent address → pane id
    widths: { panel: null, panelHeight: null, ribbon: null, lastPanel: null },
    layout: { known: false, ribbonHidden: false, panelHidden: false, filesShown: false, filesPx: 368 },
    presence: { visible: true, active: true, panelShown: false },
    request: null, // { at, select?, group? } a ribbon/rail click for the panel copy's ui
    notify: { claim: null, rescued: null },
    narrow: { filesEpoch: 0, filesWas: false, dismissed: -1 },
    cycle: null, // { group, last, at } (counts chip ▲ / ✓ cycling)
  };
}

/** Bumps the glue revision (every copy re-renders on its next tick). */
export function touch(slot) {
  slot.rev += 1;
}

/** Marks the state as changed at `t` (urgent: a 2 s debounce; else the 15 s cadence). */
export function markDirty(slot, t, urgent) {
  const S = slot.save;
  if (S.dirtyAt === null) S.dirtyAt = t;
  if (urgent) S.urgentAt = t + DEBOUNCE_MS;
}

/** When the next save is due (Infinity when nothing changed). */
export function dueAt(slot) {
  const S = slot.save;
  if (S.dirtyAt === null) return Infinity;
  const cadence = S.dirtyAt + CADENCE_MS;
  return S.urgentAt !== null && S.urgentAt < cadence ? S.urgentAt : cadence;
}

/**
 * Applies a player intent or observation as an action `{w, s, t, ...}` (A5):
 * the engine applies it to the live state, it joins `pending` until a save
 * confirms it, and the state is marked dirty. Returns the engine's events.
 */
export function dispatch(slot, partial, t) {
  if (!slot.state) return [];
  const action = { type: String(partial.type) };
  for (const k of Object.keys(partial)) {
    if (k === "w" || k === "s" || k === "t" || k === "type") continue;
    if (partial[k] !== undefined) action[k] = partial[k];
  }
  action.w = slot.writerId;
  action.s = slot.seq + 1;
  action.t = t;
  slot.seq = action.s;
  const ev = apply(slot.state, action);
  slot.pending.push(action);
  markDirty(slot, t, URGENT[action.type] === 1);
  touch(slot);
  return ev;
}

/** The role part of a copy id ("panel:k3…" → "panel"). */
export function roleOf(copyId) {
  const i = String(copyId).indexOf(":");
  return i < 0 ? String(copyId) : String(copyId).slice(0, i);
}

/**
 * A new copy (a fresh init, e.g. after a hot reload) takes over the entries of
 * older copies with the same role: their timers died with their generation, so
 * the ticker passes on at once instead of after 5 s.
 */
export function takeOver(slot, copyId) {
  const role = roleOf(copyId);
  for (const id of Object.keys(slot.copies)) {
    if (id === copyId || roleOf(id) !== role) continue;
    if (slot.ticker === id) slot.ticker = copyId;
    delete slot.copies[id];
  }
}

/**
 * A copy's heartbeat (A6): records it and elects the ticker. The copy named
 * in `ticker` keeps it; if that copy's heartbeat is older than `staleMs` (or it
 * is gone), the first live copy to beat claims it. True when `copyId` ticks.
 */
export function beat(slot, copyId, t, staleMs = TICKER_STALE_MS) {
  slot.copies[copyId] = t;
  const cur = slot.ticker;
  if (cur === null || !(cur in slot.copies) || t - slot.copies[cur] > staleMs) slot.ticker = copyId;
  for (const id of Object.keys(slot.copies)) if (t - slot.copies[id] > FORGET_MS) delete slot.copies[id];
  return slot.ticker === copyId;
}

/** Whether a copy with `role` has beaten within `staleMs` of `t`. */
export function roleAlive(slot, role, t, staleMs) {
  for (const id of Object.keys(slot.copies)) if (roleOf(id) === role && t - slot.copies[id] <= staleMs) return true;
  return false;
}

/** A 3 s message on the ribbon pill and the panel footer ("Nobody needs you", "That agent has gone"). */
export function flash(slot, text, t, ms = 3000) {
  slot.flash = { text: String(text), until: t + ms };
  touch(slot);
}

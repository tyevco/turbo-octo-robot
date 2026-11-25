// Commands and "open this agent" (DESIGN §2.6, §5.6, §3.9, §3.10).
//
// Keys and palette entries reach every shown copy through nextCommand(). Each
// command acts once: the ribbon copy handles them; the panel copy handles them
// only while the ribbon is hidden (layout() says so, or no ribbon copy is
// alive). `fold` toggles the panel and the 64 px rail with layout.resize, and
// both are weights (ARCHITECTURE B15): a {px} node never shrinks in herdr, so
// a px-sized panel would be pushed off-screen by a narrow window or zoom. The
// rail is a tiny weight held at cw-panel's min (64), so a drag that opens it
// is stored as weights too (src/window.rs drag_to keeps a {px} side as px).
// The last unfolded weight, as a share of main's, is remembered in the slot
// and localStorage, every call in try/catch; `answer` opens the helper that
// has needed you longest; `envelope` opens the oldest envelope.

import { nextCommand, run } from "herdr";
import { dispatch, flash, roleAlive } from "./live.js";

export const PANEL_ID = "cw-panel";
export const RIBBON_ID = "cw-ribbon";
/** The rail's width: cw-panel's min in layouts/Creaseworks.json. */
export const RAIL_PX = 64;
/**
 * The folded panel's weight: so small that cw-panel's min (64) always wins
 * (64 px up to a 64 000 px wide work row), yet a weight, so a drag stores
 * weights (drag_to) and a narrow window can never push it off-screen.
 */
export const RAIL_WEIGHT = 0.001;
export const DEFAULT_PANEL_PX = 320;
/** layouts/Creaseworks.json's cw-panel weight beside main (tools/layout/build.mjs PANEL_WEIGHT). */
export const DEFAULT_PANEL_WEIGHT = 0.39;
/** Remembered weights outside this range are ignored (a stray value never hides the panel or the terminals). */
const WEIGHT_MIN = 0.05;
const WEIGHT_MAX = 20;
export const RAIL_BELOW = 140;
const WIDTH_KEY = "creaseworks.panelWidth";
const WEIGHT_KEY = "creaseworks.panelWeight";
const CYCLE_MS = 30000;

// ---------------------------------------------------------------------------
// layout() (its shape is not pinned down, DESIGN §17 R4: read it tolerantly)

function findNode(tree, id, depth = 0) {
  if (!tree || typeof tree !== "object" || depth > 64) return null;
  if (Array.isArray(tree)) {
    for (const x of tree) {
      const f = findNode(x, id, depth + 1);
      if (f) return f;
    }
    return null;
  }
  if (tree.id === id) return tree;
  if (Array.isArray(tree.children)) return findNode(tree.children, id, depth + 1);
  if (tree.root) return findNode(tree.root, id, depth + 1);
  if (tree.nodes && typeof tree.nodes === "object") {
    if (Object.hasOwn(tree.nodes, id) && tree.nodes[id] && typeof tree.nodes[id] === "object") return { id, ...tree.nodes[id] };
    return findNode(Object.values(tree.nodes), id, depth + 1);
  }
  return null;
}

const pxOf = (node) => {
  const s = node && node.size;
  if (typeof s === "number") return s;
  if (s && typeof s.px === "number") return s.px;
  if (node && typeof node.px === "number") return node.px;
  return null;
};

const weightOf = (node) => {
  const s = node && node.size;
  if (s && typeof s === "object" && typeof s.weight === "number") return s.weight;
  if (node && typeof node.weight === "number") return node.weight;
  return null;
};

const goodWeight = (w) => typeof w === "number" && Number.isFinite(w) && w >= WEIGHT_MIN && w <= WEIGHT_MAX;

/** Files' width when layout() gives no px for it: its width at 1440 x 900 (as a weight it is 280 at 1100). */
export const FILES_PX_FALLBACK = 368;
const FILES_MIN = 280;
const FILES_MAX = 900;

const numberOr = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/**
 * What the commands need from `layout()`: { known, ribbonHidden, panelHidden,
 * filesShown, filesPx, panelWeight, mainWeight, filesWeight, filesMin,
 * filesMax }. A node missing from a known tree counts as hidden. `filesPx` is
 * the Files column's px size, else FILES_PX_FALLBACK (368): a weight-sized
 * Files column has no fixed width, so `filesEstimate(info, Wp)` gives the
 * real one from the panel's measured width. `panelWeight` is cw-panel's
 * {weight} or null (px-sized, or not reported); `mainWeight` is main's
 * (herdr's default 1 when it has no size).
 */
export function layoutInfo(tree) {
  if (!tree || typeof tree !== "object") {
    return { known: false, ribbonHidden: false, panelHidden: false, filesShown: false, filesPx: FILES_PX_FALLBACK, panelWeight: null, mainWeight: 1, filesWeight: null, filesMin: FILES_MIN, filesMax: FILES_MAX };
  }
  const ribbon = findNode(tree, RIBBON_ID);
  const panel = findNode(tree, PANEL_ID);
  const files = findNode(tree, "panel");
  const main = findNode(tree, "main");
  const mainPx = pxOf(main);
  return {
    known: true,
    ribbonHidden: !ribbon || ribbon.hidden === true,
    panelHidden: !panel || panel.hidden === true,
    filesShown: !!files && files.hidden !== true,
    filesPx: pxOf(files) ?? FILES_PX_FALLBACK,
    panelWeight: weightOf(panel),
    mainWeight: mainPx !== null ? null : weightOf(main) ?? 1,
    filesWeight: weightOf(files),
    filesMin: numberOr(files && files.min, FILES_MIN),
    filesMax: numberOr(files && files.max, FILES_MAX),
  };
}

/**
 * The Files column's width (design px) beside a panel measured `Wp` design px
 * wide. A {px} Files column is its px. A weight one shares the row with the
 * panel by weight (herdr's shares(): both take free x weight / total), so it is
 * Wp x filesWeight / panelWeight held to its min and max; exact while the panel
 * is wider than its min (unfolded). Else FILES_PX_FALLBACK.
 */
export function filesEstimate(info, Wp) {
  if (!info || !info.known) return FILES_PX_FALLBACK;
  if (info.filesWeight === null || info.filesWeight === undefined) return info.filesPx;
  const pw = info.panelWeight;
  if (!goodWeight(pw) || typeof Wp !== "number" || !Number.isFinite(Wp) || Wp < RAIL_BELOW) return info.filesPx;
  const share = (Wp * info.filesWeight) / pw;
  return Math.round(Math.max(Math.min(share, info.filesMax), info.filesMin));
}

// ---------------------------------------------------------------------------
// localStorage (per copy; a malformed store makes every call throw, §12.6)

export function recallWidth() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const v = Number(ls.getItem(WIDTH_KEY));
    return Number.isFinite(v) && v >= RAIL_BELOW && v <= 900 ? v : null;
  } catch {
    return null;
  }
}

export function rememberWidth(px) {
  try {
    const ls = globalThis.localStorage;
    if (ls) ls.setItem(WIDTH_KEY, String(Math.round(px)));
  } catch {
    // per-copy convenience only
  }
}

/** This copy's remembered unfolded weight, or null. */
export function recallWeight() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const raw = ls.getItem(WEIGHT_KEY);
    if (raw === null || raw === undefined || raw === "") return null;
    const v = Number(raw);
    return goodWeight(v) ? v : null;
  } catch {
    return null;
  }
}

export function rememberWeight(w) {
  try {
    const ls = globalThis.localStorage;
    if (ls) ls.setItem(WEIGHT_KEY, String(Math.round(w * 1000) / 1000));
  } catch {
    // per-copy convenience only
  }
}

function safeRun(name, args) {
  try {
    run(name, args);
    return true;
  } catch {
    return false;
  }
}

/** The panel's last unfolded width in px (slot, then this copy's localStorage, then 320): for display only. */
export function lastWidth(slot) {
  const w = slot.widths.lastPanel;
  return typeof w === "number" && w >= RAIL_BELOW ? w : recallWidth() ?? DEFAULT_PANEL_PX;
}

/** main's weight in the latest `layout()` read (herdr's default 1; a drag between main and the panel changes it). */
function mainWeightOf(slot) {
  const m = slot.layout ? slot.layout.mainWeight : null;
  return typeof m === "number" && Number.isFinite(m) && m > 0 ? m : 1;
}

/**
 * The unfolded panel's weight as a share of main's (slot, then localStorage),
 * else the layout's 0.39. A drag changes both weights (drag_to), so the share
 * is what keeps the width the player chose.
 */
export function lastWeight(slot) {
  const w = slot.widths.lastWeight;
  if (goodWeight(w)) return w;
  return recallWeight() ?? DEFAULT_PANEL_WEIGHT;
}

/** Remembers the panel's current weight share (from `layout()`) while it is unfolded at `px`. */
function keepWeight(slot, px) {
  const L = slot.layout;
  const w = L ? L.panelWeight : null;
  if (typeof px !== "number" || px < RAIL_BELOW || !goodWeight(w)) return;
  const share = Math.round((w / mainWeightOf(slot)) * 1000) / 1000;
  if (!goodWeight(share) || share === slot.widths.lastWeight) return;
  slot.widths.lastWeight = share;
  rememberWeight(share);
}

/** Records the panel copy's measured width; an unfolded one (and its weight) is remembered. */
export function notePanelWidth(slot, px) {
  slot.widths.panel = px;
  if (px >= RAIL_BELOW && px !== slot.widths.lastPanel) {
    slot.widths.lastPanel = px;
    rememberWidth(px);
  }
  keepWeight(slot, px);
}

/** The unfolded panel: a {weight} (the remembered share of main's), never {px}, so a narrow window or zoom shrinks it. */
function unfoldArgs(slot) {
  return { id: PANEL_ID, weight: Math.round(lastWeight(slot) * mainWeightOf(slot) * 1000) / 1000 };
}

/** The rail: a {weight} held at cw-panel's 64 px min, so dragging it open stores weights. */
function railArgs() {
  return { id: PANEL_ID, weight: RAIL_WEIGHT };
}

/** `creaseworks.fold`: panel ↔ rail; a hidden panel is shown (and unfolded) first. */
export function fold(slot, info) {
  const L = info ?? slot.layout;
  if (L.panelHidden) {
    safeRun("layout.show", { id: PANEL_ID });
    return safeRun("layout.resize", unfoldArgs(slot)) ? "shown" : "failed";
  }
  const w = slot.widths.panel;
  if (typeof w === "number" && w < RAIL_BELOW) return safeRun("layout.resize", unfoldArgs(slot)) ? "unfolded" : "failed";
  if (typeof w === "number") {
    slot.widths.lastPanel = w;
    rememberWidth(w);
    keepWeight(slot, w);
  }
  return safeRun("layout.resize", railArgs()) ? "folded" : "failed";
}

/** Shows the full panel (ribbon save chip, Welcome back pill, a rail/ribbon tile): no-op when shown. */
export function show(slot, info) {
  const L = info ?? slot.layout;
  if (L.panelHidden) {
    safeRun("layout.show", { id: PANEL_ID });
    safeRun("layout.resize", unfoldArgs(slot));
    return "shown";
  }
  const w = slot.widths.panel;
  if (typeof w === "number" && w < RAIL_BELOW) {
    safeRun("layout.resize", unfoldArgs(slot));
    return "unfolded";
  }
  return "noop";
}

// ---------------------------------------------------------------------------
// Picking helpers

/**
 * This window's tiles: present helpers, minus fledglings drawn as pips on a
 * present parent (B10). `kids`: keep those fledglings too.
 */
function present(slot, kids = false) {
  const out = [];
  const hs = slot.state ? slot.state.helpers : null;
  if (!hs) return out;
  for (const id in hs) {
    const h = hs[id];
    if (!h || h.gone) continue;
    if (h.seenBy && h.seenBy !== slot.writerId) continue; // Elsewhere: another window's agent
    if (!kids && h.kind === "kid" && h.parent && Object.hasOwn(hs, h.parent) && !hs[h.parent].gone) continue;
    out.push(h);
  }
  return out;
}

/**
 * Needs-you helpers, longest waiting first. Fledglings drawn as pips count
 * too: a paneless one is reached only this way or by its pip (terminal.peek, r1-14).
 */
export function waiting(slot) {
  return present(slot, true)
    .filter((h) => h.status === "blocked")
    .sort((a, b) => (a.blockedAt ?? a.joined) - (b.blockedAt ?? b.joined) || a.joined - b.joined);
}

/** Finished helpers, oldest finish first. */
export function finished(slot) {
  return present(slot)
    .filter((h) => h.status === "done")
    .sort((a, b) => (a.lastFinishAt ?? a.joined) - (b.lastFinishAt ?? b.joined) || a.joined - b.joined);
}

/** A group key ("needs" / "finished") → the helper to open, cycling on repeat. */
export function pickFromGroup(slot, group, t) {
  const list = group === "finished" ? finished(slot) : waiting(slot);
  if (!list.length) return null;
  const c = slot.cycle;
  let k = 0;
  if (c && c.group === group && t - c.at < CYCLE_MS) {
    const i = list.findIndex((h) => h.id === c.last);
    k = i < 0 ? 0 : (i + 1) % list.length;
  }
  slot.cycle = { group, last: list[k].id, at: t };
  return list[k].id;
}

/**
 * openHelper (§5.6): liveness check against the latest terminals() read;
 * pane helpers (and kept fledglings) → pane.focus {pane} ({terminal} when only
 * the terminal is known); paneless fledglings → terminal.peek {terminal}.
 * Never agent.focus. A needs-you click is recorded as a check-in. Returns
 * { ok, command?, args?, why? }.
 */
export function openHelper(slot, idOrGroup, t) {
  if (!slot.state) return { ok: false, why: "loading" };
  let id = idOrGroup;
  if (idOrGroup === "needs" || idOrGroup === "finished") {
    id = pickFromGroup(slot, idOrGroup, t);
    if (id === null) {
      flash(slot, idOrGroup === "needs" ? "Nobody needs you" : "Nobody has finished", t);
      return { ok: false, why: "nobody" };
    }
  }
  const h = Object.hasOwn(slot.state.helpers, String(id)) ? slot.state.helpers[String(id)] : null;
  if (!h || h.gone || !(h.addr in slot.live)) {
    flash(slot, "That agent has gone", t);
    return { ok: false, why: "gone" };
  }
  const pane = h.addr in slot.panes ? slot.panes[h.addr] : typeof h.pane === "string" && h.pane ? h.pane : null;
  let command;
  let args;
  if (pane !== null) {
    command = "pane.focus";
    args = { pane };
  } else if (h.kind === "kid") {
    command = "terminal.peek";
    args = { terminal: h.addr };
  } else {
    command = "pane.focus";
    args = { terminal: h.addr };
  }
  try {
    run(command, args);
  } catch {
    flash(slot, "That agent has gone", t);
    return { ok: false, why: "run" };
  }
  if (h.status === "blocked") dispatch(slot, { type: "checkin", helperId: h.id }, t);
  return { ok: true, command, args };
}

/** The oldest unopened envelope's helper id, or null. */
export function oldestEnvelope(slot) {
  const env = slot.state ? slot.state.envelopes : null;
  if (!env) return null;
  let best = null;
  let at = Infinity;
  for (const id in env) {
    const e = env[id];
    const t = e && typeof e.landedAt === "number" ? e.landedAt : 0;
    if (t < at) {
      at = t;
      best = id;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The command loop (one per copy)

/** Whether this copy acts on a command: the ribbon does; the panel only while the ribbon is hidden. */
export function actsOnCommands(slot, role, info, t, staleMs) {
  // A hidden copy gets no commands from herdr; the check keeps it exactly once anyway.
  if (role === "ribbon") return !(info.known && info.ribbonHidden);
  if (info.known) return info.ribbonHidden;
  return !roleAlive(slot, "ribbon", t, staleMs);
}

/** Runs one command name ("fold", "answer", "envelope"; a ":value" suffix is ignored). */
export function runCommand(slot, name, t) {
  const c = String(name).split(":")[0];
  if (!slot.state) return "loading";
  if (c === "fold") return fold(slot);
  if (c === "answer") {
    const r = openHelper(slot, "needs", t);
    return r.ok ? "opened" : r.why;
  }
  if (c === "envelope") {
    const id = oldestEnvelope(slot);
    if (id === null) {
      flash(slot, "No envelopes yet", t);
      return "none";
    }
    dispatch(slot, { type: "open", helperId: id }, t);
    return "opened";
  }
  return "unknown";
}

/**
 * Starts a copy's command loop: `cx.spawn` awaiting nextCommand() forever
 * (it ends when herdr shuts down or the generation is replaced). `handle(name,
 * cx)` decides and acts.
 */
export function startCommandLoop(cx, handle) {
  return cx.spawn(async (tcx) => {
    for (;;) {
      let name;
      try {
        name = await nextCommand();
      } catch {
        return; // shutting down
      }
      try {
        handle(String(name), tcx);
      } catch {
        // one bad command never ends the loop
      }
    }
  });
}


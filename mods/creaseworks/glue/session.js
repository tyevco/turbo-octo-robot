// The per-copy controller main.js uses (ARCHITECTURE B7, B11; DESIGN §3.11,
// §12.3, §12.4). Each copy (panel, ribbon) owns a Session; every Session
// shares the one live game in the handover slot (glue/live.js).
//
// The data tick (cx.timer.every: 1000 ms visible, 5000 ms while
// window()?.visible === false), per copy: heartbeat; if this copy is the
// ticker: layout(), agents() + terminals() once (observe only on change),
// advance(now, writerId), notifications, save cadence (a herdr read that
// throws keeps its last good reading and says so once: r4-01); every copy re-renders
// (cx.notify()) when the slot's rev or the clock bucket (5 s in calm mode)
// changed. Handlers dispatch B5 actions or change this copy's `ui`.

import { appHome, checking, props, window as herdrWindow, agents, terminals, layout, theme, settings, pickFiles, run } from "herdr";
import { view, advance, apply, newGame, formatCount } from "../engine/index.js";
import { now as clockNow, localDay, bucket } from "./clock.js";
import { getSlot, installSlot, newSlot, randomId, randomSeed, beat, takeOver, dispatch as liveDispatch, markDirty, touch, roleAlive, flash, codeGeneration, TICKER_STALE_MS } from "./live.js";
import * as store from "./store.js";
import { buildObservation, observeFromAgents, signature } from "./observe.js";
import { layoutInfo, filesEstimate, fold as foldPanel, show as showPanel, openHelper as openHelperCmd, runCommand, actsOnCommands, startCommandLoop, notePanelWidth, recallWidth, recallWeight, syncStore, panelState, RAIL_PX, FULL_BELOW, PANEL_ID } from "./commands.js";
import * as notifier from "./notify.js";

export const VISIBLE_MS = 1000;
export const HIDDEN_MS = 5000;
export const POP_MS = 1200;
/** A burst of pops rises this soon after the click (DESIGN §13.5: one after(16) per burst). */
export const POP_RISE_MS = 16;
/** Risen pops are removed after their 700 ms transition (one after(800) per burst). */
export const POP_PRUNE_MS = 800;
/** A pop's rise and fade is over this long after its click (rise at 16, 700 ms transition). */
export const POP_DONE_MS = POP_RISE_MS + 700;
/** At most this many pops alive (DESIGN §13.5; ui/mat.js draws the last 5). */
export const POP_CAP = 5;
export const SHORT_BELOW = 640;
/**
 * r6-07: the narrow hint offers to hide a panel at (or about) its 64 px rail
 * while the terminals have less than this (design px): folding it gains
 * nothing there, hiding gives them the rail and its gap.
 */
export const HIDE_BELOW = 360;
/** A panel less than this wider than the rail is offered hiding, not folding (folding would gain under 24 px). */
export const FOLD_GAIN_MIN = 24;
/** The flash after the hint hides the panel: how to get it back. */
export const HIDDEN_TEXT = "Panel hidden: the ribbon's fold button brings it back";
/**
 * A load that has made no progress for this long has stopped (its task cut
 * off: herdr's budget, a view closed): it is started again, and the
 * placeholder says so (r3-01). A load step yields every ≈ 60 ms.
 */
export const LOAD_STALL_MS = 15000;
export const LOADING_TEXT = "Opening the workshop…";
export const LOAD_RETRY_TEXT = "Opening the save stopped partway; trying again…";
/**
 * A herdr read that throws (r4-01: herdr builds a host result with ordinary
 * assignment under the frozen Object.prototype, so a terminal label or report
 * key named `constructor`, `toString`, … throws "'<key>' is read-only" at the
 * call site; ARCHITECTURE A7) keeps the last good reading, and the game goes
 * on earning, notifying and saving. It says so once per spell, for this long.
 */
export const READ_FAIL_MS = 12000;
export const READ_FAIL_TEXT = Object.freeze({
  // The words before the colon are what a narrow rail shows (ui/rail.js railFlash, 32 graphemes).
  agents: "Agent list unreadable: herdr's list failed, so helpers keep their last state.",
  // r5-11: agents() still reads, so pane agents' statuses keep updating once
  // a full read has been seen; before that (or after a reload from an older
  // build) nothing is observed, so the text must hold in both cases.
  terminals: "Agent details unreadable: herdr's list failed; some helpers keep their state.",
  layout: "Layout unreadable: herdr's layout failed, so the panel keeps its last place.",
});
const SAVE_KINDS = { recovered: 1, fresh: 1, conflict: 1, merged: 1, error: 1, newer: 1 };
const MAT_TARGETS = { sheet: 1, node: 1, scrap: 1, crane: 1, boat: 1, ream: 1 };

const map = () => Object.create(null);
const notifyCx = (cx) => {
  if (cx && typeof cx.notify === "function") {
    try {
      cx.notify();
    } catch {
      // a cx from a phase that may not notify (tests, shots): the next tick re-renders
    }
  }
};

/**
 * The terminals' width (design px) with the panel `Wp` wide at about its
 * rail, in a ribbon (work column) `W` wide. filesEstimate says nothing there
 * (a rail's width does not follow its weight), so a weight Files column is
 * shared with main by weight, held to its min and max (herdr's shares()).
 */
export function railMainEstimate(W, Wp, L) {
  const room = W - 16 - (Wp + 8);
  if (!L || !L.filesShown) return room;
  const rest = room - 8;
  const fw = L.filesWeight;
  let files = L.filesPx;
  if (typeof fw === "number" && Number.isFinite(fw) && fw > 0) {
    const mw = typeof L.mainWeight === "number" && Number.isFinite(L.mainWeight) && L.mainWeight > 0 ? L.mainWeight : 1;
    files = Math.max(Math.min((rest * fw) / (fw + mw), L.filesMax), L.filesMin);
  }
  return rest - files;
}

/** The ticker hands over when its heartbeat is older than this (a hidden window beats every 5 s). */
const staleFor = (interval) => Math.max(TICKER_STALE_MS, Math.round(interval * 2.5));

/** A fresh per-copy UI state (B11 `ui`). */
export function newUi() {
  return {
    tab: "flock", back: "flock", segment: "works", selected: null, confirm: false, armedAt: null, now: null,
    details: false, folded: map(), scrollTo: null, pops: [], buyCount: 1,
  };
}

/**
 * The static `herdr-app check` demo (§3.11): 3 helpers (working, needs you,
 * resting), 2 envelopes, 12.4K folds. Pure engine calls, no host work.
 */
export function demoState(t) {
  const day = localDay(t);
  const s = newGame({ seed: 12345, now: t - 120000, day });
  const obs = (status, turn, addr, title) => ({
    addr, created: 1767225600000, status, raw: status, turn, parent: null, pane: `p-${addr}`, title, paneName: "", space: "~", tab: "1", kind: "pane",
  });
  apply(s, { w: "demo", s: 1, t: t - 120000, type: "observe", visible: true, active: true, matShown: true, day,
    helpers: [obs("working", 1, "t1", "Refactor the parser"), obs("working", 1, "t2", "Write the tests"), obs("working", 1, "t3", "Update docs")] });
  apply(s, { w: "demo", s: 2, t: t - 60000, type: "observe", visible: true, active: true, matShown: true, day,
    helpers: [obs("working", 2, "t1", "Refactor the parser"), obs("blocked", 1, "t2", "Write the tests"), obs("idle", 2, "t3", "Update docs")] });
  advance(s, t);
  s.bank = 12400;
  s.lifetime = Math.max(s.lifetime, 12400);
  s.runFolds = Math.max(s.runFolds, 12400);
  return s;
}

export class Session {
  /**
   * role: "panel" | "ribbon" | null (null: read props().role in init).
   * opts: { isFolded(vm, ui, key), sectionIndex(vm, ui, key),
   * virtualGroups(vm, ui, prev) } (from ui/flock.js), `artDark(T, fallback)`
   * (from ui/palette.js: which art the theme showing needs, r5-01) and `scroll`, a
   * ScrollHandle created in init (all passed by main.js). With `sectionIndex`
   * and `scroll`, a counts-chip ● / ◗ or a ribbon tally scrolls the Flock to
   * its group (DESIGN §3.1). With `virtualGroups`, the panel keeps the last
   * render's Flock lists in `ui.flockLists` (the r3-16 hysteresis).
   */
  constructor(role = null, opts = {}) {
    this.role = role === "ribbon" ? "ribbon" : role === "panel" ? "panel" : null;
    this.isFolded = typeof opts.isFolded === "function" ? opts.isFolded : null;
    this.sectionIndex = typeof opts.sectionIndex === "function" ? opts.sectionIndex : null;
    this.virtualGroups = typeof opts.virtualGroups === "function" ? opts.virtualGroups : null;
    this.artDark = typeof opts.artDark === "function" ? opts.artDark : null;
    this.artKey = null;
    this.artIsDark = true;
    // The Flock lists the last panel render drew (handed to the next one as ui.flockLists).
    this.flockDrawn = null;
    this.scroll = opts.scroll && typeof opts.scroll.scroll_to_item === "function" ? opts.scroll : null;
    this.popRise = null;
    this.popPrune = null;
    this.ui = newUi();
    this.slot = null;
    this.copyId = null;
    this.demo = null;
    this.width = null;
    this.height = null;
    this.interval = 0;
    this.timer = null;
    this.lastRev = -1;
    this.lastBucket = -1;
    this.cache = null;
    // The vm key's name for each state object it has seen (a load or merge puts a new one in the slot).
    this.stateIds = new WeakMap();
    this.stateSeq = 0;
    // The time of this copy's last tick or handler build (render builds for it: vmTime).
    this.vmAt = null;
    this.popSeq = 0;
    this.popCarry = null;
    this.handledRequest = 0;
    // What this copy's own localStorage holds of the slot's widths (commands.js syncStore).
    this.stored = { weight: undefined, width: undefined };
    this.handlers = this.makeHandlers();
  }

  // -------------------------------------------------------------------------
  // Lifecycle

  init(cx) {
    if (this.role === null) {
      // props() from "herdr", never init's argument (undefined for layout views; A2 rule 10).
      const p = props();
      this.role = p && typeof p === "object" && p.role === "ribbon" ? "ribbon" : "panel";
    }
    // Only the panel copy draws the Flock: a ribbon copy lets its handle go.
    if (this.role !== "panel") this.releaseScroll();
    if (checking()) {
      // Static preview: no timers, no writes, no run (§3.11; A2 rule 11).
      const t = clockNow();
      this.demo = { state: demoState(t), t };
      return;
    }
    const t = clockNow();
    const home = appHome();
    let slot = getSlot();
    if (slot && slot.home !== home) slot = null;
    if (!slot) slot = installSlot(newSlot(home, store.slotPaths(home)));
    this.slot = slot;
    this.copyId = `${this.role}:${randomId()}`;
    takeOver(slot, this.copyId);
    // Each copy has its own localStorage (keyed by its props): the first copy
    // to start brings back what it remembers; syncStore copies it to the others (r3-05).
    if (slot.widths.lastPanel === null) {
      const w = recallWidth();
      if (w !== null) slot.widths.lastPanel = w;
    }
    if (slot.widths.lastWeight === null || slot.widths.lastWeight === undefined) {
      const w = recallWeight();
      if (w !== null) slot.widths.lastWeight = w;
    }
    beat(slot, this.copyId, t);
    if (slot.state === null) {
      // (one load at a time: another copy of this code generation may be loading already)
      if (!this.loadUnderWay(t)) this.startLoad(cx);
    }
    // A hot reload: release the older generation's save claim (its task never
    // settles), then settle a main write that may have landed.
    else if (store.adopt(slot, t)) cx.spawn(() => store.resolveInflight(slot, { now: clockNow, owner: this.copyId }), { owner: null });
    const win = herdrWindow();
    this.retime(cx, !win || win.visible !== false);
    startCommandLoop(cx, (name, tcx) => this.onCommand(name, tcx));
  }

  /**
   * Loads the save in a task (A4 load order). The task's cx.sleep goes to the
   * store, so every parse step of a large save (and each of the two parses of
   * a recovery) runs in a task step of its own, never in one 500 ms step
   * (r3-01). Once loaded, the ViewModel is built here, so render only reads
   * the cache (r3-03; §5.5 item 7). `retry`: a load that stopped is started
   * again (tick); the placeholder and, once loaded, a notice say so.
   */
  startLoad(cx, retry = false) {
    const slot = this.slot;
    const gen = (slot.loading || 0) + 1;
    const t = clockNow();
    slot.loading = gen;
    slot.loadAt = t;
    slot.loadBy = this.copyId;
    slot.loadGen = codeGeneration();
    if (retry) slot.loadTries = (slot.loadTries || 0) + 1;
    else if (typeof slot.loadTries !== "number") slot.loadTries = 0;
    const owner = this.copyId;
    cx.spawn(async (tcx) => {
      const sleep = sleeper(tcx);
      const env = { now: clockNow, seed: randomSeed, gen, writer: slot.writerId, sleep, owner };
      const ok = await store.load(slot, env);
      if (!ok || slot.loading !== gen) return;
      slot.loading = 0;
      slot.loadAt = null;
      store.noteLoadRetried(slot, clockNow(), slot.loadTries || 0);
      slot.loadTries = 0;
      touch(slot);
      // The ViewModel in a task step of its own (the last parse step was in this one).
      if (sleep) await sleep(0);
      if (getSlot() !== slot) return;
      this.changed(tcx, clockNow());
    }, { owner: null });
    if (retry) touch(slot);
  }

  /** True when a load of this code generation is under way and still moving (a copy that started it is open). */
  loadUnderWay(t) {
    return this.loadStop(t) === null;
  }

  /**
   * Why the load under way can no longer finish: null (it is moving), "none"
   * (no load of this code generation), "gone" (the copy that started it has
   * closed, so its tasks were cancelled: no save problem) or "stalled" (no
   * progress for LOAD_STALL_MS: a step was stopped, e.g. by the budget).
   */
  loadStop(t) {
    const slot = this.slot;
    if (!slot.loading || slot.loadGen !== codeGeneration()) return "none";
    if (typeof slot.loadAt === "number" && t - slot.loadAt > LOAD_STALL_MS) return "stalled";
    if (typeof slot.loadBy !== "string" || !(slot.loadBy in slot.copies)) return "gone";
    return null;
  }

  /**
   * The load watchdog (r3-01): a load whose task stopped (herdr's budget
   * interrupt cannot be caught, and a closed view's tasks are cancelled)
   * never settles, so nothing would ever show but the placeholder. One that
   * has made no progress for LOAD_STALL_MS, or whose copy has gone, is
   * started again by this copy. Only a stall counts as a try (the placeholder
   * and a notice say so); a load whose copy simply closed is handed over
   * quietly, since nothing went wrong with the save.
   */
  watchLoad(cx, t) {
    const slot = this.slot;
    if (!slot.loading || slot.state !== null) return;
    if (typeof slot.loadAt === "number" && slot.loadAt > t) slot.loadAt = t; // the clock moved back
    const why = this.loadStop(t);
    if (why === null) return;
    this.startLoad(cx, why !== "gone");
  }

  /** The placeholder's text while there is no game to show (main.js). */
  loadingText() {
    const slot = this.slot;
    if (!slot || this.demo || !(slot.loadTries > 0)) return LOADING_TEXT;
    return slot.loadTries > 1 ? `${LOAD_RETRY_TEXT} (try ${slot.loadTries + 1})` : LOAD_RETRY_TEXT;
  }

  /** (Re)registers this copy's one data timer at 1000 ms (visible) or 5000 ms (hidden). */
  retime(cx, visible) {
    const ms = visible ? VISIBLE_MS : HIDDEN_MS;
    if (this.interval === ms && this.timer) return;
    if (this.timer) {
      try {
        this.timer.cancel();
      } catch {
        // already gone
      }
    }
    this.interval = ms;
    this.timer = cx.timer.every(ms, (tcx) => this.tick(tcx));
  }

  /** The data tick (B7). */
  tick(cx) {
    const slot = this.slot;
    if (!slot) return;
    const t = clockNow();
    const win = herdrWindow();
    const visible = !win || win.visible !== false;
    const active = !win || win.active !== false;
    this.retime(cx, visible);
    if (getSlot() !== slot) return; // a newer slot replaced this one (another app home in tests)
    const ticker = beat(slot, this.copyId, t, staleFor(this.interval));
    syncStore(slot, this.stored);
    if (slot.state === null && slot.loading) this.watchLoad(cx, t);
    if (slot.state && !slot.loading && ticker) this.tickerWork(cx, t, visible, active);
    // (a flash dated far ahead is from before the wall clock moved back)
    if (slot.flash && (t >= slot.flash.until || slot.flash.until - t > 60000)) {
      slot.flash = null;
      touch(slot);
    }
    store.expireNotices(slot, t);
    this.prunePops(t);
    this.maybeRender(cx, t);
  }

  tickerWork(cx, t, visible, active) {
    const slot = this.slot;
    // Each herdr read on its own: a throw keeps the last good reading (r4-01).
    const lay = readHost(slot, "layout", layout, t);
    const L = lay.ok ? layoutInfo(lay.value) : slot.layout;
    slot.layout = L;
    const stale = staleFor(this.interval);
    const panelAlive = roleAlive(slot, "panel", t, stale);
    // Folded or not is the layout's weight, not the measured width (r2-13).
    const pst = panelState(slot, L);
    const panelShown = panelAlive && pst !== "hidden" && pst !== "folded";
    slot.presence = { visible, active, panelShown, panelAlive };
    // Narrow-window hint epochs: a new Files-panel opening allows the hint again (§2.3).
    if (L.filesShown && !slot.narrow.filesWas) slot.narrow.filesEpoch += 1;
    slot.narrow.filesWas = L.filesShown;

    // Observe: agents() once + terminals() once, never panes() (§5.1). When
    // agents() throws, the last good observation stands (no observe of
    // helpers; liveness and pane ids as last read) and the tick goes on. When
    // only terminals() throws (r5-11: a label or report key named like an
    // Object.prototype member), the pane agents are still observed from
    // agents(), with the rest carried over from the last terminals() that
    // read (observeFromAgents): a waiting agent still stops and shows needs-you.
    const ag = readHost(slot, "agents", agents, t);
    const tm = ag.ok ? readHost(slot, "terminals", terminals, t) : ag;
    let obs = null;
    if (ag.ok && tm.ok) {
      try {
        obs = buildObservation(ag.value, tm.value);
        slot.lastTerms = Array.isArray(tm.value) ? tm.value : null;
      } catch (e) {
        readFailed(slot, "agents", t, e);
      }
    } else if (ag.ok) {
      try {
        obs = observeFromAgents(ag.value, slot.lastTerms);
      } catch (e) {
        readFailed(slot, "agents", t, e);
      }
    }
    if (obs) {
      readOk(slot, "agents");
      if (tm.ok) readOk(slot, "terminals");
      const live = map();
      for (const a of obs.live.keys()) live[a] = true;
      const panes = map();
      for (const [a, p] of obs.panes) panes[a] = p;
      slot.live = live;
      slot.panes = panes;
    }
    const day = localDay(t);
    // A panel too narrow for the full view draws the rail: no mat on screen.
    const matShown = visible && panelShown && pst === "full";
    const sig = obs ? signature(obs.list) : slot.obs.sig;
    const pres = `${visible}|${active}|${matShown}|${day}`;
    if (obs && sig !== slot.obs.sig) {
      slot.obs.sig = sig;
      slot.obs.presence = pres;
      liveDispatch(slot, { type: "observe", helpers: obs.list, visible, active, matShown, day }, t);
    } else if (pres !== slot.obs.presence) {
      slot.obs.presence = pres;
      liveDispatch(slot, { type: "observe", helpers: null, visible, active, matShown, day }, t);
    }

    // Advance (closed form; this window's writerId so stale helpers fall back to the away rate).
    // Time alone moving the counters is no glue change: every copy re-renders
    // on its clock bucket (1 s, 5 s in calm mode: r3-12), so the slot is not
    // touched for it. A player action or a roster change touches it at once.
    // The bumps it makes to state.rev are counted in slot.timeRev, so the vm
    // key leaves them out too (render between buckets reads the cached vm).
    // Anything it does beyond earning (a node or pickup appearing, an
    // automation buying or opening) is shown at once.
    const before = slot.state.rev;
    const ev = advance(slot.state, t, slot.writerId);
    const more = ev.some((e) => e.kind !== "earn");
    if (slot.state.rev !== before) {
      if (!more) slot.timeRev = (slot.timeRev || 0) + (slot.state.rev - before);
      markDirty(slot, t, false);
    }
    if (more) touch(slot);

    // Notifications (opt-in, ≤ 3 a day) and the save-problem ribbon rescue.
    // herdr's toast expires on the wall clock even while nobody looks, so a
    // hidden or inactive window holds them back until it is active (r6-02).
    notifier.check(slot, t, { day, quiet: panelShown && active, away: !visible || !active, layout: L }, () => {
      markDirty(slot, t, true);
      slot.save.urgentAt = t;
    });

    // Save cadence (A4).
    if (store.due(slot, t)) this.startWrite(cx);
  }

  startWrite(cx) {
    const slot = this.slot;
    cx.spawn((tcx) => store.cycle(slot, { now: clockNow, sleep: sleeper(tcx), owner: this.copyId }), { owner: null });
  }

  maybeRender(cx, t) {
    const slot = this.slot;
    const calm = !!(slot.state && slot.state.settings.calm);
    const b = bucket(t, calm);
    const arming = this.ui.confirm && typeof this.ui.armedAt === "number" && t - this.ui.armedAt < 3000;
    // (render reads the vm for this tick's time until the next tick: vmTime)
    this.vmAt = t;
    if (slot.rev !== this.lastRev || b !== this.lastBucket || arming || this.ui.pops.length || this.ui.scrollTo !== null) {
      this.lastRev = slot.rev;
      this.lastBucket = b;
      this.changed(cx, t);
    }
  }

  /**
   * Something this copy shows changed: build the ViewModel now, in the tick or
   * handler (500 ms budget), so render only reads the cache (§5.5 item 7), then
   * cx.notify().
   */
  changed(cx, t = undefined) {
    if (!this.loading()) {
      let vm = null;
      // (a handler builds for the time now; render then reads that vm)
      const at = typeof t === "number" || this.demo ? t : clockNow();
      try {
        vm = this.vm(at);
      } catch {
        // render builds it again and shows the problem there
      }
      this.consumeScroll(vm);
    }
    notifyCx(cx);
  }

  /**
   * A pending `ui.scrollTo` (a counts chip, a ribbon tally): the Flock scrolls
   * to that group's section with the ScrollHandle (DESIGN §3.1), then it is
   * cleared, so it never pins its group open (r2-19: the group was unfolded by
   * `folded[key] = false`; its header folds it again). Runs in a handler or
   * the tick, never in render; the request is consumed after the next layout.
   */
  consumeScroll(vm) {
    const u = this.ui;
    const key = u.scrollTo;
    if (key === null || key === undefined) return;
    if (this.role !== "panel") {
      u.scrollTo = null; // the ribbon draws no Flock (its request went to the panel copy)
      return;
    }
    if (!vm) return;
    u.scrollTo = null;
    // A needs tally whose longest wait is a fledgling (a pip on its parent's
    // tile, r2-17) scrolls to the section holding that tile, unfolded.
    let k = key;
    const ng = vm.helpers ? vm.helpers.needsGroup : null;
    if (key === "needs" && typeof ng === "string" && ng !== "needs") {
      k = ng;
      u.folded[k] = false;
    }
    if (!this.scroll || !this.sectionIndex || u.tab !== "flock") return;
    try {
      const i = this.sectionIndex(vm, u, k);
      if (typeof i === "number" && i >= 0) this.scroll.scroll_to_item(i);
    } catch {
      // a released handle (hot reload): the group is unfolded all the same
    }
  }

  /** Lets the Flock's ScrollHandle go (a ribbon copy, close). */
  releaseScroll() {
    const h = this.scroll;
    this.scroll = null;
    if (h && typeof h.release === "function") {
      try {
        h.release();
      } catch {
        // already released
      }
    }
  }

  /** close(cx): the ticker starts one final write at once (≤ 250 ms on a VM restart). */
  close(_cx) {
    const slot = this.slot;
    if (!slot || this.demo) return null;
    const wasTicker = slot.ticker === this.copyId;
    delete slot.copies[this.copyId];
    if (wasTicker) slot.ticker = null;
    if (this.timer) {
      try {
        this.timer.cancel();
      } catch {
        // already gone
      }
      this.timer = null;
    }
    this.releaseScroll();
    for (const k of ["popRise", "popPrune"]) {
      const h = this[k];
      this[k] = null;
      if (h && typeof h.cancel === "function") {
        try {
          h.cancel();
        } catch {
          // already fired
        }
      }
    }
    if (!wasTicker || !slot.state || slot.readOnly) return null;
    const t = clockNow();
    advance(slot.state, t, slot.writerId);
    markDirty(slot, t, true);
    // A stalled claim, or one orphaned by a copy closed 15 s ago, no longer blocks the final write.
    store.releaseAbandoned(slot, t);
    if (slot.save.writing !== null) return null; // the write under way lands; the next load merges
    return store.cycle(slot, { now: clockNow, sleep: sleeper(_cx), owner: this.copyId });
  }

  // -------------------------------------------------------------------------
  // Commands

  onCommand(name, cx) {
    const slot = this.slot;
    if (!slot || !slot.state) return;
    const t = clockNow();
    // (a layout() that throws: the last good layout; keys still act, r4-01)
    const lay = readHost(slot, "layout", layout, t);
    const L = lay.ok ? layoutInfo(lay.value) : slot.layout;
    if (!actsOnCommands(slot, this.role, L, t, staleFor(this.interval || VISIBLE_MS))) return;
    slot.layout = L;
    runCommand(slot, name, t);
    notifyCx(cx);
  }

  // -------------------------------------------------------------------------
  // View model

  /** True while the game is loading (main.js draws a placeholder). */
  loading() {
    return !this.demo && (!this.slot || !this.slot.state);
  }

  state() {
    return this.demo ? this.demo.state : this.slot ? this.slot.state : null;
  }

  /**
   * The cached ViewModel for this copy, keyed on exactly what view() reads:
   * the state (which object, and its rev without the bumps time alone makes:
   * slot.timeRev, tickerWork), the writer, width, tab, buyCount, saveNotice,
   * clock bucket, short, Album open, flash. Not slot.rev: a save landing or a
   * heartbeat touches the slot but changes no vm. herdr re-renders whenever
   * its live data changes, and a key that moved every second (or with every
   * save) rebuilt the whole vm inside render between calm mode's 5 s buckets
   * (r3-12, r3-03: 18-39 ms of the 50 ms budget at 1-2 years). Render
   * (`t` undefined) builds for the time of this copy's last tick or handler
   * while it is recent, so a render between a bucket's start and this copy's
   * next tick reads the cache too; the tick moves it on.
   */
  vm(t = undefined) {
    const s = this.state();
    if (!s) return null;
    const at = this.vmTime(t);
    this.applyRequest();
    const slot = this.slot;
    const notice = slot ? slot.notice : null;
    const fl = slot && slot.flash && at < slot.flash.until ? slot.flash.text : null;
    const tab = this.ui.tab;
    const width = this.width ?? (this.role === "ribbon" ? 0 : 320);
    const short = this.role === "panel" && typeof this.height === "number" && this.height > 0 && this.height < SHORT_BELOW;
    // The Album's rows are built only while its section is unfolded (r1-03:
    // a folded Album with thousands of records costs nothing to render).
    const album = this.role === "panel" && tab === "flock" && this.albumOpen();
    const key = [
      this.stateId(s), s.rev - (slot && slot.state === s && slot.timeRev ? slot.timeRev : 0), slot ? slot.writerId : "", width, tab, this.ui.buyCount, notice ? `${notice.kind}@${notice.at}@${notice.retryMs ?? ""}@${notice.text ?? ""}@${notice.message ?? ""}` : "",
      bucket(at, !!s.settings.calm), short, fl ?? "", album,
    ].join("|");
    if (this.cache && this.cache.key === key) return this.cache.vm;
    const vm = view(s, at, {
      role: this.role,
      width,
      writer: slot ? slot.writerId : undefined,
      tab,
      short,
      buyCount: this.ui.buyCount,
      saveNotice: notice ? saveNoticeOf(notice) : null,
      album,
    });
    if (fl) {
      vm.ribbon = { ...vm.ribbon, pill: fl };
      vm.notices = [{ kind: "flash", text: fl, actions: [], place: "footer", save: false, at }].concat(vm.notices);
    }
    this.cache = { key, vm };
    return vm;
  }

  /** A name for the state object, new for each object (the vm key). */
  stateId(s) {
    let id = this.stateIds.get(s);
    if (id === undefined) {
      id = ++this.stateSeq;
      this.stateIds.set(s, id);
    }
    return id;
  }

  /** The time vm() builds for: the tick's or handler's `t`; in render, the last tick's or handler's while recent. */
  vmTime(t) {
    if (this.demo) {
      if (typeof t === "number") return t;
      return this.demo.t;
    }
    if (typeof t === "number") {
      this.vmAt = t;
      return t;
    }
    const now = clockNow();
    const last = this.vmAt;
    // (recent: within one data tick; a clock that moved back is never read)
    if (typeof last === "number" && now >= last && now - last <= (this.interval || VISIBLE_MS) + VISIBLE_MS) return last;
    return now;
  }

  /** True when this copy's Flock shows the Album section unfolded (folded by default). */
  albumOpen() {
    const u = this.ui;
    if (this.isFolded) {
      try {
        return !this.isFolded(null, u, "album");
      } catch {
        // fall through to the plain rule
      }
    }
    return u.scrollTo === "album" || u.folded.album === false;
  }

  /** This copy's ui with a fresh `now` (confirm arming compares it; renderers never read a clock). */
  uiForRender(vm) {
    const u = this.ui;
    u.now = this.demo ? this.demo.t : clockNow();
    // r3-16: the Flock's grid-or-list choice remembers the last render's lists.
    // ui.flockLists is that memory; flockParts computes the same pure value
    // from it, which is kept here for the next render.
    if (this.role === "panel" && this.virtualGroups && vm && u.tab === "flock") {
      u.flockLists = this.flockDrawn;
      try {
        this.flockDrawn = this.virtualGroups(vm, u, this.flockDrawn);
      } catch {
        this.flockDrawn = null;
      }
    }
    return u;
  }

  /** A ribbon / rail click asked the panel to select a tile or show a group (applied by the panel copy). */
  applyRequest() {
    const r = this.slot && this.slot.request;
    if (!r || this.role !== "panel" || r.at <= this.handledRequest) return;
    this.handledRequest = r.at;
    // (a group request's scroll runs at the next changed(): never in render)
    if (r.select !== undefined) {
      this.ui.tab = "flock";
      this.ui.selected = r.select;
    }
    if (r.group !== undefined) {
      this.ui.tab = "flock";
      this.ui.folded[r.group] = false;
      this.ui.scrollTo = r.group;
    }
  }

  /** artDark(T, fallback), remembered per theme surface (one theme() per render). */
  artDarkFor(T, fallback) {
    if (!this.artDark) return fallback;
    const key = (T && T.raised) + "|" + (T && T.chrome) + "|" + (T && T.surface) + "|" + fallback;
    if (this.artKey !== key) {
      this.artKey = key;
      try {
        this.artIsDark = this.artDark(T, fallback) !== false;
      } catch {
        this.artIsDark = fallback;
      }
    }
    return this.artIsDark;
  }

  /** The glue part of the B11 ctx (main.js adds S, hues from ctx.dark). */
  ctx() {
    const s = this.state();
    const slot = this.slot;
    const t = this.demo ? this.demo.t : clockNow();
    let T = {};
    let appearanceDark = true;
    let zoom = 1;
    try {
      T = theme() || {};
    } catch {
      T = {};
    }
    try {
      const st = settings() || {};
      appearanceDark = st.dark !== false;
      zoom = typeof st.zoom === "number" && st.zoom > 0 ? st.zoom : 1;
    } catch {
      // defaults
    }
    // r5-01: the art (scene, hues) follows the theme SHOWING, not the window
    // appearance: settings().dark is only the appearance, and a single-name
    // theme ("theme": "paper") shows the same theme on a dark OS. artDark
    // judges the theme's own raised surface; `appearanceDark` is its fallback.
    const dark = this.artDarkFor(T, appearanceDark);
    const width = this.width ?? (this.role === "ribbon" ? null : 320);
    const ctx = {
      T, dark, appearanceDark, zoom,
      calm: !!(s && s.settings.calm),
      width,
      height: this.role === "ribbon" ? 30 : this.height,
      handlers: this.handlers,
    };
    if (this.role === "panel" && this.scroll) ctx.scroll = this.scroll;
    if (slot && s) {
      ctx.save = store.saveInfo(slot, t);
      // The rail's chevron: unfold the rail weight, else fold (a tight rail too).
      if (this.role === "panel") ctx.folded = panelState(slot) === "folded";
      if (this.role === "ribbon") {
        ctx.panelShown = !!slot.presence.panelShown;
        // r3-14: only a full panel shows the away card (a tight rail has none).
        ctx.panelFull = ctx.panelShown && panelState(slot) === "full";
        const offer = this.narrowOffer(t);
        ctx.narrowHint = offer !== null;
        ctx.narrowHide = offer === "hide";
      }
    } else if (this.role === "ribbon") {
      ctx.panelShown = false;
    }
    return ctx;
  }

  /**
   * §2.3: the ribbon's one-time "terminals are narrow" chip: true when it is
   * offered (see narrowOffer).
   */
  narrowHint(t) {
    return this.narrowOffer(t) !== null;
  }

  /**
   * What the narrow chip offers, or null: "fold" while the panel is unfolded
   * (by its layout weight) and folding gives the terminals room (the panel is
   * at least FOLD_GAIN_MIN wider than the 64 px rail, and either the
   * terminals are under 600 or the panel is a tight rail under FULL_BELOW
   * holding its whole column: r2-13, r2-14, 124 or 106 at zoom 1.5 too);
   * "hide" when the panel is the rail or about it (folded, or unfolded and
   * held near its 64 px min: zoom 1.5 with Files open; folding gains
   * nothing) and the terminals still have under HIDE_BELOW (r6-07: before,
   * the chip stayed silent exactly where the terminals were narrowest). Once
   * per Files opening with Files open, else once a day.
   */
  narrowOffer(_t) {
    const slot = this.slot;
    const s = slot && slot.state;
    if (!s || this.role !== "ribbon" || typeof this.width !== "number") return null;
    const L = slot.layout;
    const Wp = slot.widths.panel;
    if (typeof Wp !== "number") return null;
    const st = panelState(slot);
    // A folded rail is not "shown" (the ribbon draws the mini Sheet), but it is on screen.
    const onScreen = slot.presence.panelShown || (st === "folded" && slot.presence.panelAlive === true);
    if (!onScreen) return null;
    const again = L.filesShown ? slot.narrow.dismissed !== slot.narrow.filesEpoch : s.ui.narrowHintDay !== s.day;
    if (!again) return null;
    if (st === "folded" || Wp - RAIL_PX < FOLD_GAIN_MIN) return railMainEstimate(this.width, Wp, L) < HIDE_BELOW ? "hide" : null;
    if (st !== "full" && st !== "tight") return null;
    const mainEst = this.width - 16 - (Wp + 8) - (L.filesShown ? filesEstimate(L, Wp) + 8 : 0);
    if (mainEst >= 600 && st === "full") return null;
    return "fold";
  }

  /**
   * A "+N" pop at the click point (r2-20). Pops through their transition are
   * dropped; one still rising is never cut: with POP_CAP alive (10+ clicks a
   * second) the amount is carried into the next pop that has room, so every
   * fold earned is shown once and each number finishes its rise. A carry
   * older than a second is dropped (it would read as a new click's).
   */
  addPop(sum, x, y, style, cx) {
    const t = clockNow();
    const u = this.ui;
    const alive = u.pops.filter((p) => !(p.risen && t - p.at >= POP_DONE_MS));
    const carry = this.popCarry && t - this.popCarry.at < 1000 ? this.popCarry.sum : 0;
    if (alive.length >= POP_CAP) {
      this.popCarry = { sum: carry + sum, at: t };
      u.pops = alive;
      this.schedulePrune(cx && cx.timer);
      return;
    }
    this.popCarry = null;
    this.popSeq += 1;
    u.pops = alive.concat([{ id: `pop${this.popSeq}`, label: `+${formatCount(sum + carry, style)}`, x, y, risen: false, at: t }]);
    this.schedulePops(cx);
  }

  /**
   * DESIGN §13.5: one cx.timer.after(16) per burst raises every new pop
   * (`risen`: top − 28, opacity 0 over 700 ms), one after(≤ 800), due when
   * the oldest pop's transition ends, removes the finished ones; at most one
   * of each is pending, so fast clicking keeps two
   * timers (r2-20: they used to wait for the 1 s data tick). The data tick's
   * prunePops stays the fallback when a timer cannot be set.
   */
  schedulePops(cx) {
    const timer = cx && cx.timer;
    if (!timer || typeof timer.after !== "function") return;
    if (this.popRise === null) {
      try {
        this.popRise = timer.after(POP_RISE_MS, (tcx) => {
          this.popRise = null;
          let any = false;
          for (const p of this.ui.pops) {
            if (!p.risen) {
              p.risen = true;
              any = true;
            }
          }
          if (any) notifyCx(tcx);
        });
      } catch {
        this.popRise = null;
      }
    }
    this.schedulePrune(timer);
  }

  schedulePrune(timer) {
    if (this.popPrune !== null || !timer || typeof timer.after !== "function") return;
    // Due when the oldest pop's transition ends (at most POP_PRUNE_MS away),
    // so a burst frees room for the next number as soon as one is done.
    const t0 = clockNow();
    let due = POP_PRUNE_MS;
    for (const p of this.ui.pops) due = Math.min(due, Math.max(POP_RISE_MS, p.at + POP_DONE_MS - t0));
    try {
      this.popPrune = timer.after(due, (tcx) => {
        this.popPrune = null;
        const t = clockNow();
        const before = this.ui.pops.length;
        // Risen and through their 700 ms transition (a later click's pops wait for the next one).
        this.ui.pops = this.ui.pops.filter((p) => !(p.risen && t - p.at >= POP_DONE_MS));
        let rose = false;
        for (const p of this.ui.pops) {
          if (!p.risen && t - p.at >= POP_RISE_MS) {
            p.risen = true; // the after(16) could not be set: never re-arm on an unrisen pop
            rose = true;
          }
        }
        if (rose) notifyCx(tcx);
        if (this.ui.pops.length) this.schedulePrune(tcx && tcx.timer);
        if (this.ui.pops.length !== before) notifyCx(tcx);
      });
    } catch {
      this.popPrune = null;
    }
  }

  prunePops(t) {
    const pops = this.ui.pops;
    if (!pops.length) return;
    const keep = [];
    for (const p of pops) {
      if (t - p.at < POP_MS) {
        p.risen = true;
        keep.push(p);
      }
    }
    this.ui.pops = keep;
  }

  // -------------------------------------------------------------------------
  // Size

  /** on_size_change: logical px ÷ settings().zoom (§2.3); the panel's width goes to the slot. */
  onSize(size, cx) {
    if (!size || typeof size !== "object") return;
    let zoom = 1;
    try {
      const z = settings().zoom;
      if (typeof z === "number" && z > 0) zoom = z;
    } catch {
      // zoom 1
    }
    const w = typeof size.width === "number" ? Math.round(size.width / zoom) : this.width;
    const h = typeof size.height === "number" ? Math.round(size.height / zoom) : this.height;
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    const slot = this.slot;
    if (slot && !this.demo) {
      if (this.role === "panel") {
        notePanelWidth(slot, w);
        slot.widths.panelHeight = h;
      } else {
        slot.widths.ribbon = w;
      }
      touch(slot);
    }
    notifyCx(cx);
  }

  // -------------------------------------------------------------------------
  // Actions

  /** live.dispatch + cx.notify() (B7). Returns the engine's events. */
  dispatch(action, cx) {
    const slot = this.slot;
    if (this.demo || !slot || !slot.state || slot.loading) return [];
    const ev = liveDispatch(slot, action, clockNow());
    this.changed(cx);
    return ev;
  }

  /** §5.6 (helper id, or the group key "needs" / "finished"). */
  openHelper(helperId, cx) {
    const slot = this.slot;
    if (this.demo || !slot || !slot.state) return { ok: false, why: "loading" };
    const r = openHelperCmd(slot, helperId, clockNow());
    this.changed(cx);
    return r;
  }

  env(tcx = null) {
    const slot = this.slot;
    return { now: clockNow, seed: randomSeed, sleep: sleeper(tcx), owner: this.copyId, flash: (text) => flash(slot, text, clockNow()) };
  }

  /** Runs a store task (Settings tools) in a task that outlives this copy. */
  storeTask(cx, fn) {
    const slot = this.slot;
    if (this.demo || !slot || !slot.state) return;
    const run = async (tcx) => {
      await fn(slot, this.env(tcx));
      notifyCx(tcx);
    };
    if (cx && typeof cx.spawn === "function") cx.spawn(run, { owner: null });
    else run(null);
  }

  /** Cross-copy request: the panel copy applies it to its ui; the panel is shown/unfolded. */
  requestPanel(req, cx) {
    const slot = this.slot;
    if (!slot) return;
    const t = clockNow();
    slot.request = { ...req, at: Math.max(t, (slot.request ? slot.request.at : 0) + 1) };
    touch(slot);
    // A tight panel cannot show more: show() flashes why (r2-12).
    showPanel(slot, undefined, t);
    notifyCx(cx);
  }

  makeHandlers() {
    const self = this;
    const ui = () => self.ui;
    return {
      click(target, id, event, cx) {
        const a = { type: "click", target: String(target) };
        if (id !== null && id !== undefined) a.id = String(id);
        if (event && typeof event.x === "number" && typeof event.y === "number") {
          a.x = event.x;
          a.y = event.y;
        }
        const ev = self.dispatch(a, undefined);
        const s = self.state();
        if (s && MAT_TARGETS[a.target] === 1 && !s.settings.calm && s.settings.pops !== false && a.x !== undefined) {
          let sum = 0;
          for (const e of ev) if (e && e.kind === "earn" && typeof e.amount === "number") sum += e.amount;
          if (sum > 0) self.addPop(sum, a.x, a.y, s.settings.style, cx);
        }
        self.changed(cx);
      },
      open(helperId, cx) {
        self.dispatch({ type: "open", helperId: String(helperId) }, cx);
      },
      openHelper(helperId, cx) {
        self.openHelper(helperId, cx);
      },
      buy(item, count, cx) {
        self.dispatch({ type: "buy", item: String(item), count: count === "max" ? "max" : Number(count) || 1 }, cx);
      },
      setting(key, value, cx) {
        if (key === "buyCount") {
          ui().buyCount = value === "max" ? "max" : value === 10 ? 10 : 1;
          self.changed(cx);
          return;
        }
        self.dispatch({ type: "setting", key: String(key), value }, cx);
      },
      switchAuto(id, on, cx) {
        self.dispatch({ type: "switch", id: String(id), on: on === true }, cx);
      },
      wish(cx) {
        self.dispatch({ type: "wish" }, undefined);
        ui().confirm = false;
        ui().armedAt = null;
        self.changed(cx);
      },
      collect(cx) {
        self.dispatch({ type: "collect" }, cx);
      },
      dismiss(notice, cx) {
        const slot = self.slot;
        const kind = String(notice);
        if (!slot || self.demo) return;
        if (kind === "narrow") {
          if (slot.layout.filesShown) slot.narrow.dismissed = slot.narrow.filesEpoch;
          self.dispatch({ type: "hint", key: "narrow" }, undefined);
          touch(slot);
        } else if (SAVE_KINDS[kind] === 1) {
          store.dismiss(slot, kind);
        } else {
          self.dispatch({ type: "dismiss", notice: kind }, undefined);
        }
        self.changed(cx);
      },
      fold(cx) {
        if (self.slot && !self.demo) foldPanel(self.slot, undefined, clockNow());
        self.changed(cx);
      },
      show(cx) {
        if (self.slot && !self.demo) showPanel(self.slot, undefined, clockNow());
        self.changed(cx);
      },
      hide(cx) {
        // The narrow chip's "Hide" (r6-07). The ribbon's fold button (fold:
        // a hidden panel is shown and unfolded) and the palette bring it back.
        const slot = self.slot;
        if (slot && !self.demo) {
          let ok = true;
          try {
            run("layout.hide", { id: PANEL_ID });
          } catch {
            ok = false; // a refused run arrives as a herdr toast
          }
          if (ok) {
            slot.layout = { ...slot.layout, panelHidden: true };
            flash(slot, HIDDEN_TEXT, clockNow());
          }
        }
        self.changed(cx);
      },
      tab(name, cx) {
        const u = ui();
        const next = String(name);
        if (next === "settings" && u.tab !== "settings") u.back = u.tab;
        u.tab = next;
        u.confirm = false;
        u.armedAt = null;
        self.changed(cx);
      },
      segment(name, cx) {
        ui().segment = String(name);
        self.changed(cx);
      },
      select(helperId, cx) {
        const u = ui();
        u.selected = helperId === null || helperId === undefined ? null : String(helperId);
        u.tab = "flock";
        // The panel copy draws the rail below FULL_BELOW (folded or tight): it
        // shows no selection, so the click unfolds the panel or says why not (r2-12).
        const rail = self.role === "panel" && typeof self.width === "number" && self.width < FULL_BELOW;
        if (self.role === "ribbon" || rail) self.requestPanel({ select: u.selected }, cx);
        else self.changed(cx);
      },
      toggleGroup(key, cx) {
        const u = ui();
        const k = String(key);
        const vm = self.vm();
        const was = self.isFolded && vm ? self.isFolded(vm, u, k) : u.folded[k] === true;
        u.folded[k] = !was;
        self.changed(cx);
      },
      showGroup(key, cx) {
        const u = ui();
        const k = String(key);
        u.tab = "flock";
        u.folded[k] = false;
        u.scrollTo = k;
        const rail = self.role === "panel" && typeof self.width === "number" && self.width < FULL_BELOW;
        if (self.role === "ribbon" || rail) self.requestPanel({ group: k }, cx);
        else self.changed(cx);
      },
      details(on, cx) {
        ui().details = on === true;
        self.changed(cx);
      },
      confirm(kind, cx) {
        const u = ui();
        u.confirm = kind === true ? "wish" : String(kind);
        u.armedAt = clockNow();
        u.now = u.armedAt;
        self.changed(cx);
      },
      cancel(cx) {
        ui().confirm = false;
        ui().armedAt = null;
        self.changed(cx);
      },
      retrySave(cx) {
        const slot = self.slot;
        if (!slot || self.demo) return;
        store.retryNow(slot, clockNow());
        if (store.due(slot, clockNow()) && cx && typeof cx.spawn === "function") self.startWrite(cx);
        self.changed(cx);
      },
      checkSave(cx) {
        // Every outcome says something ("busy" flashes in the store).
        self.storeTask(cx, (slot, env) => store.checkSave(slot, env).then((r) => {
          if (r === "ok") env.flash("Save checked: it reads back fine.");
          else if (r === "newer") env.flash("The save on disk is from a newer Creaseworks.");
          else if (r === "missing") env.flash("The save file was missing; writing it again now.");
          else if (r === "damaged") env.flash("The save file was damaged; see the banner.");
          else if (r === "error") env.flash("The save file can't be read; see the banner.");
        }));
      },
      restoreBackup(cx) {
        ui().confirm = false;
        self.storeTask(cx, (slot, env) => store.restoreBackup(slot, env));
      },
      resetGame(cx) {
        ui().confirm = false;
        self.storeTask(cx, (slot, env) => store.resetGame(slot, env));
      },
      sharePath(path, cx) {
        ui().confirm = false;
        self.storeTask(cx, (slot, env) => store.sharePath(slot, env, path));
      },
      pickSharePath(cx) {
        // §12.5: the system file picker chooses the other window's save.json.
        self.storeTask(cx, async (slot, env) => {
          let got = null;
          try {
            got = await pickFiles({ prompt: "Share this save", multiple: false });
          } catch {
            env.flash("The file picker could not open.");
            return;
          }
          if (!Array.isArray(got) || !got.length || typeof got[0] !== "string") return;
          ui().confirm = false;
          await store.sharePath(slot, env, got[0]);
        });
      },
    };
  }
}

/**
 * One herdr read (layout(), agents(), terminals()): { ok, value }. A throw is
 * noted (readFailed) and gives { ok: false }; a read that works ends the
 * spell for "layout" (the agent reads end theirs once both work: tickerWork).
 */
function readHost(slot, what, fn, t) {
  try {
    const value = fn();
    if (what === "layout") readOk(slot, what);
    return { ok: true, value };
  } catch (e) {
    readFailed(slot, what, t, e);
    return { ok: false, value: undefined };
  }
}

/** The slot's read-failure spells (made on first use; a hot reload hands them over with the slot). */
function readSpells(slot) {
  if (!slot.readFail || typeof slot.readFail !== "object") slot.readFail = map();
  return slot.readFail;
}

/**
 * A herdr read threw: the first throw of a spell flashes READ_FAIL_TEXT[what]
 * for READ_FAIL_MS (never silent), later ones only count, so a failure on
 * every tick shows one notice, not one a second.
 */
function readFailed(slot, what, t, e) {
  const spells = readSpells(slot);
  const sp = spells[what];
  if (sp) {
    sp.count += 1;
    sp.last = t;
    return;
  }
  spells[what] = { since: t, last: t, count: 1, message: e && typeof e.message === "string" ? e.message : String(e) };
  flash(slot, READ_FAIL_TEXT[what], t, READ_FAIL_MS);
}

/** A read worked again: its spell is over (a later failure says so again). */
function readOk(slot, what) {
  const spells = slot.readFail;
  if (spells && spells[what]) delete spells[what];
}

/** A task cx's sleep for the store's sliced replays (null when the cx has none). */
function sleeper(tcx) {
  return tcx && typeof tcx.sleep === "function" ? (ms) => tcx.sleep(ms) : null;
}

/** The slot notice as view() takes it (B10 `saveNotice`). */
function saveNoticeOf(n) {
  const out = { kind: n.kind, at: n.at };
  if (typeof n.text === "string") out.text = n.text;
  if (typeof n.message === "string") out.message = n.message;
  if (typeof n.retryMs === "number") out.retryMs = n.retryMs;
  return out;
}

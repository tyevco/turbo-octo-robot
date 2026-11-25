// The per-copy controller main.js uses (ARCHITECTURE B7, B11; DESIGN §3.11,
// §12.3, §12.4). Each copy (panel, ribbon) owns a Session; every Session
// shares the one live game in the handover slot (glue/live.js).
//
// The data tick (cx.timer.every: 1000 ms visible, 5000 ms while
// window()?.visible === false), per copy: heartbeat; if this copy is the
// ticker: layout(), agents() + terminals() once (observe only on change),
// advance(now, writerId), notifications, save cadence; every copy re-renders
// (cx.notify()) when the slot's rev or the clock bucket (5 s in calm mode)
// changed. Handlers dispatch B5 actions or change this copy's `ui`.

import { appHome, checking, props, window as herdrWindow, agents, terminals, layout, theme, settings, pickFiles } from "herdr";
import { view, advance, apply, newGame, formatCount } from "../engine/index.js";
import { now as clockNow, localDay, bucket } from "./clock.js";
import { getSlot, installSlot, newSlot, randomId, randomSeed, beat, takeOver, dispatch as liveDispatch, markDirty, touch, roleAlive, flash, TICKER_STALE_MS } from "./live.js";
import * as store from "./store.js";
import { buildObservation, signature } from "./observe.js";
import { layoutInfo, filesEstimate, fold as foldPanel, show as showPanel, openHelper as openHelperCmd, runCommand, actsOnCommands, startCommandLoop, notePanelWidth, recallWidth, RAIL_BELOW } from "./commands.js";
import * as notifier from "./notify.js";

export const VISIBLE_MS = 1000;
export const HIDDEN_MS = 5000;
export const POP_MS = 1200;
export const SHORT_BELOW = 640;
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
   * opts: { isFolded(vm, ui, key) } (from ui/flock.js, passed by main.js).
   */
  constructor(role = null, opts = {}) {
    this.role = role === "ribbon" ? "ribbon" : role === "panel" ? "panel" : null;
    this.isFolded = typeof opts.isFolded === "function" ? opts.isFolded : null;
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
    this.popSeq = 0;
    this.handledRequest = 0;
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
    if (slot.widths.lastPanel === null) {
      const w = recallWidth();
      if (w !== null) slot.widths.lastPanel = w;
    }
    beat(slot, this.copyId, t);
    if (slot.state === null) this.startLoad(cx);
    // A hot reload: release the older generation's save claim (its task never
    // settles), then settle a main write that may have landed.
    else if (store.adopt(slot, t)) cx.spawn(() => store.resolveInflight(slot, { now: clockNow, owner: this.copyId }), { owner: null });
    const win = herdrWindow();
    this.retime(cx, !win || win.visible !== false);
    startCommandLoop(cx, (name, tcx) => this.onCommand(name, tcx));
  }

  startLoad(cx) {
    const slot = this.slot;
    const gen = (slot.loading || 0) + 1;
    slot.loading = gen;
    const env = { now: clockNow, seed: randomSeed, gen, writer: slot.writerId };
    cx.spawn(async (tcx) => {
      const ok = await store.load(slot, env);
      if (!ok || slot.loading !== gen) return;
      slot.loading = 0;
      touch(slot);
      notifyCx(tcx);
    }, { owner: null });
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
    const L = layoutInfo(layout());
    slot.layout = L;
    const stale = staleFor(this.interval);
    const panelAlive = roleAlive(slot, "panel", t, stale);
    const pw = slot.widths.panel;
    const panelShown = panelAlive && !L.panelHidden && !(typeof pw === "number" && pw < RAIL_BELOW);
    slot.presence = { visible, active, panelShown };
    // Narrow-window hint epochs: a new Files-panel opening allows the hint again (§2.3).
    if (L.filesShown && !slot.narrow.filesWas) slot.narrow.filesEpoch += 1;
    slot.narrow.filesWas = L.filesShown;

    // Observe: agents() once + terminals() once, never panes() (§5.1).
    const obs = buildObservation(agents(), terminals());
    const live = map();
    for (const a of obs.live.keys()) live[a] = true;
    const panes = map();
    for (const [a, p] of obs.panes) panes[a] = p;
    slot.live = live;
    slot.panes = panes;
    const day = localDay(t);
    const matShown = visible && panelShown;
    const sig = signature(obs.list);
    const pres = `${visible}|${active}|${matShown}|${day}`;
    if (sig !== slot.obs.sig) {
      slot.obs.sig = sig;
      slot.obs.presence = pres;
      liveDispatch(slot, { type: "observe", helpers: obs.list, visible, active, matShown, day }, t);
    } else if (pres !== slot.obs.presence) {
      slot.obs.presence = pres;
      liveDispatch(slot, { type: "observe", helpers: null, visible, active, matShown, day }, t);
    }

    // Advance (closed form; this window's writerId so stale helpers fall back to the away rate).
    const before = slot.state.rev;
    advance(slot.state, t, slot.writerId);
    if (slot.state.rev !== before) {
      markDirty(slot, t, false);
      touch(slot);
    }

    // Notifications (opt-in, ≤ 3 a day) and the save-problem ribbon rescue.
    notifier.check(slot, t, { day, quiet: panelShown && active, layout: L }, () => {
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
    if (slot.rev !== this.lastRev || b !== this.lastBucket || arming || this.ui.pops.length) {
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
      try {
        this.vm(t);
      } catch {
        // render builds it again and shows the problem there
      }
    }
    notifyCx(cx);
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
    if (!wasTicker || !slot.state || slot.readOnly) return null;
    const t = clockNow();
    advance(slot.state, t, slot.writerId);
    markDirty(slot, t, true);
    if (slot.save.writing !== null) return null; // the write under way lands; the next load merges
    return store.cycle(slot, { now: clockNow, sleep: sleeper(_cx), owner: this.copyId });
  }

  // -------------------------------------------------------------------------
  // Commands

  onCommand(name, cx) {
    const slot = this.slot;
    if (!slot || !slot.state) return;
    const t = clockNow();
    const L = layoutInfo(layout());
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

  /** The cached ViewModel for this copy (keyed on rev, width, tab, buyCount, saveNotice, clock bucket). */
  vm(t = undefined) {
    const s = this.state();
    if (!s) return null;
    const at = typeof t === "number" ? t : this.demo ? this.demo.t : clockNow();
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
      s.rev, slot ? slot.rev : 0, width, tab, this.ui.buyCount, notice ? `${notice.kind}@${notice.at}@${notice.retryMs ?? ""}` : "",
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
  uiForRender() {
    this.ui.now = this.demo ? this.demo.t : clockNow();
    return this.ui;
  }

  /** A ribbon / rail click asked the panel to select a tile or show a group (applied by the panel copy). */
  applyRequest() {
    const r = this.slot && this.slot.request;
    if (!r || this.role !== "panel" || r.at <= this.handledRequest) return;
    this.handledRequest = r.at;
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

  /** The glue part of the B11 ctx (main.js adds T, S, hues). */
  ctx() {
    const s = this.state();
    const slot = this.slot;
    const t = this.demo ? this.demo.t : clockNow();
    let T = {};
    let dark = true;
    let zoom = 1;
    try {
      T = theme() || {};
    } catch {
      T = {};
    }
    try {
      const st = settings() || {};
      dark = st.dark !== false;
      zoom = typeof st.zoom === "number" && st.zoom > 0 ? st.zoom : 1;
    } catch {
      // defaults
    }
    const width = this.width ?? (this.role === "ribbon" ? null : 320);
    const ctx = {
      T, dark, zoom,
      calm: !!(s && s.settings.calm),
      width,
      height: this.role === "ribbon" ? 30 : this.height,
      handlers: this.handlers,
    };
    if (slot && s) {
      ctx.save = store.saveInfo(slot, t);
      if (this.role === "ribbon") {
        ctx.panelShown = !!slot.presence.panelShown;
        ctx.narrowHint = this.narrowHint(t);
      }
    } else if (this.role === "ribbon") {
      ctx.panelShown = false;
    }
    return ctx;
  }

  /** §2.3: the ribbon's one-time "fold to a rail?" chip. */
  narrowHint(_t) {
    const slot = this.slot;
    const s = slot && slot.state;
    if (!s || this.role !== "ribbon" || typeof this.width !== "number") return false;
    const L = slot.layout;
    const Wp = slot.widths.panel;
    if (!slot.presence.panelShown || typeof Wp !== "number" || Wp < RAIL_BELOW) return false;
    const mainEst = this.width - 16 - (Wp + 8) - (L.filesShown ? filesEstimate(L, Wp) + 8 : 0);
    if (mainEst >= 600) return false;
    if (L.filesShown) return slot.narrow.dismissed !== slot.narrow.filesEpoch;
    return s.ui.narrowHintDay !== s.day;
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
    showPanel(slot);
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
          if (sum > 0) {
            self.popSeq += 1;
            const pops = ui().pops.concat([{ id: `pop${self.popSeq}`, label: `+${formatCount(sum, s.settings.style)}`, x: a.x, y: a.y, risen: false, at: clockNow() }]);
            ui().pops = pops.slice(-5);
          }
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
        if (self.slot && !self.demo) foldPanel(self.slot);
        self.changed(cx);
      },
      show(cx) {
        if (self.slot && !self.demo) showPanel(self.slot);
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
        const folded = self.role === "panel" && typeof self.width === "number" && self.width < RAIL_BELOW;
        if (self.role === "ribbon" || folded) self.requestPanel({ select: u.selected }, cx);
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
        const folded = self.role === "panel" && typeof self.width === "number" && self.width < RAIL_BELOW;
        if (self.role === "ribbon" || folded) self.requestPanel({ group: k }, cx);
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

// The panel frame (DESIGN §3.1, §2.4): `renderPanel(vm, ui, ctx)`
// (ARCHITECTURE B11). Standard 320 × H: header 44, save banner (§3.8, only
// with a notice), the mat (§3.2), boost bar 26, tabs 32, the active tab's
// content (flex_1, min_h 0, overflow_y_scrollbar) and footer 22, on T.chrome
// with 1 px T.border dividers. Below 200 px wide (folded, or unfolded in a
// window that leaves it too little room) the panel is the rail (§3.9, §2.4).
// The away card (§3.7) is the last child, an absolute overlay over the mat,
// so it paints above everything else; it never blocks the tabs: `awaySlot`
// keeps it inside the mat and the boost bar (review r7-11).

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { clip } from "../engine/index.js";
import { statusColor } from "./color.js";
import { icon, spritePath, sprite, statusGlyphPath, foldPaths } from "./art.js";
import { countdownBar, iconButton, text, hoverOn } from "./widgets.js";
import { renderMat, matGeometry, isCalm } from "./mat.js";
import { renderBanner, bannerLayout, saveProblem } from "./banner.js";
import { renderAway, awayFit, awayWidth } from "./away.js";
import { renderRail } from "./rail.js";
import { flockParts } from "./flock.js";
import { renderShop } from "./shop.js";
import { renderString } from "./string.js";
import { renderBook } from "./book.js";
import { renderSettings } from "./settings.js";

/** Grapheme limits for every string this module draws (tested). */
export const PANEL_CLIP = Object.freeze({ folds: 10, rate: 12, count: 5, wishes: 6, boost: 22, footer: 60, tab: 12, glow: 24, barHint: 40 });

/**
 * Fixed heights of the frame (DESIGN §3.1). The away card sits at mat y
 * `awayTop` when it fits, else higher (to mat y `awayMinTop`), and its bottom
 * stays `awayGap` px above the tabs.
 */
export const FRAME = Object.freeze({ header: 44, matTop: 4, boost: 26, tabs: 32, footer: 22, awayTop: 36, awayMinTop: 4, awayGap: 4 });

/** Below this width the panel copy draws the rail (§2.4). */
export const RAIL_BELOW = 140;
/**
 * The full panel needs this much (the mat's 200 px minimum; the header's
 * counts chip between the fold and gear buttons). A panel the window leaves
 * narrower (1100 × 700 with Files open: 146) is drawn as the rail too.
 */
export const FULL_BELOW = 200;

const TABS = Object.freeze([
  { key: "flock", label: "Flock" },
  { key: "shop", label: "Shop" },
  { key: "string", label: "String" },
  // the Pattern book (DESIGN §4.7): shown once vm.book.open
  { key: "book", label: "Book", icon: "book" },
]);

/**
 * The tab row's geometry (DESIGN §4.7 "The Book tab"; tested): side padding
 * and gap, each tab's padding (10; 6 with four tabs below `narrowBelow`),
 * Book's 14 px icon there, and below `countBelow` the Flock tab without its
 * count (the header's counts chip shows it). The `T.accent` dot is 6 px.
 */
export const TAB_ROW = Object.freeze({ px: 4, gap: 2, pad: 10, tightPad: 6, iconGap: 4, icon: 14, dot: 6, narrowBelow: 280, countBelow: 220 });

const RENDER = Object.freeze({ shop: renderShop, string: renderString, book: renderBook, settings: renderSettings });

const COUNT_SEGMENTS = Object.freeze([
  { group: "needs", status: "blocked", word: "need you", open: true },
  { group: "finished", status: "done", word: "finished", open: true },
  { group: "working", status: "working", word: "working", open: false },
  { group: "resting", status: "idle", word: "resting", open: false },
]);

const SEAL = Object.freeze({ bundle: "seal-bundle", rush: "seal-rush", storm: "seal-storm", chorus: "seal-chorus" });

function handler(ctx, name) {
  const h = ctx && ctx.handlers;
  const f = h && typeof h[name] === "function" ? h[name] : null;
  return (...args) => (f ? f(...args) : undefined);
}

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** The active tab key ("flock" by default; unknown keys fall back too). */
export function activeTab(ui) {
  const t = ui && ui.tab;
  return t === "shop" || t === "string" || t === "book" || t === "settings" ? t : "flock";
}

/** True when the vm opens the Book tab (the Pattern book, once Crease Field is first bought). */
export function bookOpen(vm) {
  return Boolean(vm && vm.book && vm.book.open === true);
}

function countsChip(vm, T, ctx) {
  const counts = (vm.header && vm.header.counts) || {};
  const openHelper = handler(ctx, "openHelper");
  const showGroup = handler(ctx, "showGroup");
  const bg = T.raised;
  const chip = h_flex().id("cw-hdr-counts").h(22).flex_none().rounded(11).bg(bg).border(1).border_color(T.border).px(2);
  for (const seg of COUNT_SEGMENTS) {
    const n = Math.max(0, Math.round(num(counts[seg.group], 0)));
    const el = h_flex()
      .id(`cw-hdr-count-${seg.group}`)
      .h(20)
      .px(4)
      .gap(2)
      .rounded(10)
      .tooltip(seg.open ? `${n} ${seg.word}${n ? ": open the pane" : ""}` : `${n} ${seg.word}: show in the Flock`)
      .child(sprite(statusGlyphPath(seg.status), 11, statusColor(T, seg.status, bg)))
      .child(text(clip(String(n), PANEL_CLIP.count), { size: 11, weight: 600, color: n > 0 ? T.foreground : T.muted }, T));
    if (n > 0) {
      el.cursor_pointer()
        .hover((s) => s.bg(hoverOn(T, bg)))
        .on_click((e, cx) => (seg.open ? openHelper(seg.group, cx) : showGroup(seg.group, cx)));
    }
    chip.child(el);
  }
  return chip;
}

function header(vm, ui, ctx) {
  const T = ctx.T;
  const h = vm.header || {};
  const narrow = num(ctx.width, 320) < 280;
  const fold = handler(ctx, "fold");
  const tab = handler(ctx, "tab");
  const wishes = Math.max(0, Math.round(num(h.wishes, 0)));
  const row1 = h_flex()
    .h(22)
    .gap(6)
    .child(text(clip(String(h.folds ?? "0"), PANEL_CLIP.folds), { size: 18, weight: 600, color: T.foreground }, T).line_height("122%"))
    .child(text("folds", { size: 11, color: T.muted }, T))
    .child(div().flex_1())
    .child(text(clip(String(h.rate ?? ""), PANEL_CLIP.rate), { size: 11, color: T.muted }, T));
  const wish = h_flex()
    .id("cw-hdr-wishes")
    .gap(3)
    .tooltip(`${wishes} Wish${wishes === 1 ? "" : "es"}: +5 % to everything each, forever`)
    .child(icon("wish", 11, T.muted))
    .child(text(clip(narrow ? String(wishes) : `${wishes} Wish${wishes === 1 ? "" : "es"}`, PANEL_CLIP.wishes + 7), { size: 11, color: T.foreground }, T));
  const row2 = h_flex().h(22).gap(6).child(countsChip(vm, T, ctx)).child(div().flex_1()).child(wish);
  return h_flex()
    .id("cw-hdr")
    .w_full()
    .h(FRAME.header)
    .flex_none()
    .pl(2)
    .pr(4)
    .gap(2)
    .border_b(1)
    .border_color(T.border)
    .child(iconButton("cw-hdr-fold", "fold", "Fold Creaseworks to a rail (ctrl-shift-g)", { size: 16, onClick: (e, cx) => fold(cx) }, T))
    .child(v_flex().flex_1().min_w(0).child(row1).child(row2))
    .child(iconButton("cw-hdr-gear", "gear", "Settings", { size: 18, hit: 28, color: activeTab(ui) === "settings" ? T.foreground : T.muted, onClick: (e, cx) => tab("settings", cx) }, T));
}

function boostBar(vm, ctx) {
  const T = ctx.T;
  // Calm mode (DESIGN §11.1 item 4): the countdown snaps each tick (r4-13).
  const calm = isCalm(vm, ctx);
  const boosts = Array.isArray(vm.boosts) ? vm.boosts : [];
  const bar = h_flex().id("cw-boostbar").w_full().h(FRAME.boost).flex_none().px(8).gap(6).overflow_hidden();
  if (!boosts.length) {
    // While a crease field is up the muted hint says so in words (§4.7).
    const field = vm.sheet && vm.sheet.field;
    const hint = field && typeof field.barHint === "string" && field.barHint ? clip(field.barHint, PANEL_CLIP.barHint) : "Open envelopes when you're ready";
    return bar.child(text(hint, { size: 11, color: T.muted, truncate: true }, T).id("cw-boostbar-hint"));
  }
  for (const b of boosts) {
    const type = String(b.type ?? "");
    // Pattern book chips (§4.7) carry their diagram's fold: Wind-up the spring, Steady the ridge pleat.
    const seal = Object.hasOwn(SEAL, type) ? spritePath("scene", SEAL[type])
      : type === "coil" ? foldPaths("coil").base
        : type === "steady" ? foldPaths("ridge").base
          : spritePath("ui", type === "song" ? "step" : "arrows");
    // Steady is a static charge (msLeft null): no countdown, a tooltip that says what it does.
    const timed = typeof b.msLeft === "number";
    const tip = timed ? `${b.label ?? type}: ${Math.ceil(num(b.msLeft) / 1000)} s left` : type === "steady" ? "Steady: your next short pause costs no beats" : String(b.label ?? type);
    const el = h_flex()
      .id(`cw-boostbar-${type}`)
      .h(22)
      .flex_none()
      .px(6)
      .gap(4)
      .rounded(11)
      .bg(T.raised)
      .tooltip(clip(tip, 60))
      .child(sprite(seal, 12, T.foreground))
      .child(text(clip(String(b.label ?? type), PANEL_CLIP.boost), { size: 11, weight: 600, color: T.foreground }, T));
    if (timed) el.child(countdownBar(`cw-boostbar-${type}-bar`, num(b.msLeft), num(b.msTotal, 1), { width: 48, height: 3, calm }, T, ctx.S));
    bar.child(el);
  }
  return bar;
}

function tabsRow(vm, ui, ctx) {
  const T = ctx.T;
  const go = handler(ctx, "tab");
  const current = activeTab(ui) === "book" && !bookOpen(vm) ? "flock" : activeTab(ui);
  const row = h_flex().id("cw-tabs").w_full().h(FRAME.tabs).flex_none().px(TAB_ROW.px).gap(TAB_ROW.gap).border_b(1).border_color(T.border);
  const book = bookOpen(vm);
  const width = num(ctx.width, 320);
  const tight = book && width < TAB_ROW.narrowBelow;
  const tabEl = (key, label, selected, target, opts = {}) => {
    const el = h_flex()
      .id(`cw-tab-${key}`)
      .h(FRAME.tabs)
      .px(tight ? TAB_ROW.tightPad : TAB_ROW.pad)
      .gap(TAB_ROW.iconGap)
      .flex_none()
      .cursor_pointer()
      .role("tab")
      .aria_selected(selected)
      .text_size(12)
      .font_weight(600)
      .text_color(selected ? T.foreground : T.muted)
      .hover((s) => s.text_color(T.foreground))
      .on_click((e, cx) => go(target, cx));
    if (opts.icon) el.child(icon(opts.icon, TAB_ROW.icon, selected ? T.foreground : T.muted));
    else el.child(clip(label, PANEL_CLIP.tab + 4));
    if (opts.tooltip) el.tooltip(opts.tooltip);
    // new marks since the tab was last opened: a static accent dot (no pulse)
    if (opts.dot) el.child(div().id(`cw-tab-${key}-dot`).w(TAB_ROW.dot).h(TAB_ROW.dot).flex_none().rounded_full().bg(T.accent));
    if (selected) el.border_b(2).border_color(T.accent);
    return el;
  };
  if (current === "settings") {
    const back = ui && (ui.back === "shop" || ui.back === "string" || (ui.back === "book" && book)) ? ui.back : "flock";
    row.child(
      h_flex()
        .id("cw-tab-back")
        .h(FRAME.tabs)
        .px(8)
        .gap(4)
        .flex_none()
        .cursor_pointer()
        .hover((s) => s.bg(hoverOn(T, T.chrome)))
        .on_click((e, cx) => go(back, cx))
        .child(icon("back", 12, T.muted))
        .child(text("Back", { size: 12, weight: 600, color: T.foreground }, T)),
    );
    row.child(div().flex_1());
    row.child(text("Settings", { size: 12, weight: 600, color: T.muted }, T).pr(8));
    return row;
  }
  const counts = (vm.header && vm.header.counts) || {};
  // Tiles only: waiting fledglings count in needs (r2-17) but are pips on their parent's tile.
  const total = Math.max(0, ["needs", "finished", "working", "resting"].reduce((a, k) => a + Math.max(0, num(counts[k], 0)), 0) - Math.max(0, num(vm.header && vm.header.kidsWaiting, 0)));
  for (const t of TABS) {
    if (t.key === "book" && !book) continue;
    const count = t.key === "flock" && total > 0 && !(book && width < TAB_ROW.countBelow);
    const label = count ? `${t.label} ${total}` : t.label;
    const opts = {};
    if (t.key === "book") {
      const fresh = Boolean(vm.book.newMarks) && current !== "book";
      if (tight) opts.icon = t.icon;
      opts.tooltip = fresh ? "Pattern book · new" : "Pattern book";
      opts.dot = fresh;
    }
    row.child(tabEl(t.key, label, current === t.key, t.key, opts));
  }
  return row;
}

function footer(vm, ctx) {
  const T = ctx.T;
  const save = (ctx && ctx.save) || {};
  const problem = save.state === "problem" || (save.state === undefined && saveProblem(vm));
  const saving = save.state === "saving";
  const notices = Array.isArray(vm.notices) ? vm.notices : [];
  const line = notices.find((n) => n && n.place === "footer" && typeof n.text === "string");
  let words;
  if (line) words = line.text;
  else if (typeof save.text === "string" && save.text) words = save.text;
  else words = problem ? "Save problem: see the banner" : saving ? "Saving…" : "Saved";
  const glyph = problem
    ? icon("warn", 12, statusColor(T, "blocked", "chrome"))
    : icon(saving ? "dots" : "check", 12, T.muted);
  const row = h_flex()
    .id("cw-foot")
    .w_full()
    .h(FRAME.footer)
    .flex_none()
    .px(8)
    .gap(6)
    .border_t(1)
    .border_color(T.border)
    .child(glyph)
    .child(text(clip(String(words), PANEL_CLIP.footer), { size: 11, color: T.muted, truncate: true }, T).flex_1());
  const pill = (id, label, tip) =>
    h_flex().id(id).h(18).px(6).flex_none().rounded(9).bg(T.raised).tooltip(tip).child(text(label, { size: 11, weight: 600, color: T.foreground }, T));
  if (vm.streak && vm.streak.inStep) row.child(pill("cw-foot-instep", "In step", "In step: every working helper works faster"));
  else if (vm.streak && typeof vm.streak.afterglowText === "string" && vm.streak.afterglowText) {
    // The banked afterglow (review r5-14): a static chip, so calm mode is the same.
    row.child(pill("cw-foot-glow", clip(vm.streak.afterglowText, PANEL_CLIP.glow), "Afterglow: your working helpers keep working faster while it lasts. Clicks made In step bank more."));
  }
  if (isCalm(vm, ctx)) row.child(pill("cw-foot-calm", "Calm", "Calm mode: no motion (Settings)"));
  return row;
}

/**
 * Where the away card goes (panel px) and how tall it may be (r7-11): the
 * tabs' top is header + banner + mat top + mat + boost bar; the card's bottom
 * stays `awayGap` above it, its top no higher than mat y `awayMinTop`, at mat
 * y `awayTop` (36; less on a low mat) when the card fits there.
 * → { top, maxH, tabsTop, fit } (fit: away.js `awayFit`).
 */
export function awaySlot(vm, ui, ctx) {
  const lay = bannerLayout(vm, ui, ctx);
  const g = matGeometry(vm, ctx);
  const matY = FRAME.header + (lay ? lay.total : 0) + FRAME.matTop;
  const tabsTop = matY + g.h + FRAME.boost;
  const bottom = tabsTop - FRAME.awayGap;
  const minTop = matY + FRAME.awayMinTop;
  const maxH = Math.max(0, bottom - minTop);
  const fit = awayFit(vm.away, awayWidth(ctx.width), maxH);
  const pref = matY + Math.min(FRAME.awayTop, Math.max(0, g.h - 140));
  const top = Math.round(Math.max(minTop, Math.min(pref, bottom - fit.height)));
  return { top, maxH: bottom - top, tabsTop, fit };
}

/** The whole panel copy (or the rail below FULL_BELOW px). Pure (B11). */
export function renderPanel(vm, ui, ctx) {
  const width = num(ctx.width, 320);
  if (width < FULL_BELOW) return renderRail(vm, ui, ctx);
  const T = ctx.T;
  // A Book tab the vm does not open (a stale ui.tab) shows the Flock.
  const tab = activeTab(ui) === "book" && !bookOpen(vm) ? "flock" : activeTab(ui);
  const root = v_flex().id("cw-panel").relative().size_full().min_h(0).bg(T.chrome).text_color(T.foreground).overflow_hidden();
  root.child(header(vm, ui, ctx));
  const banner = renderBanner(vm, ui, ctx);
  if (banner) root.child(banner);
  root.child(h_flex().id("cw-mat-slot").w_full().flex_none().px(8).pt(FRAME.matTop).justify_center().child(renderMat(vm, ui, ctx)));
  root.child(boostBar(vm, ctx));
  root.child(tabsRow(vm, ui, ctx));
  if (tab === "flock") {
    // The Flock's parts are the scroll area's direct children (the #cw-flock
    // padding and gap), so ctx.scroll (the session's ScrollHandle) can reveal
    // a group by its index (flock.js sectionIndex; DESIGN §3.1, r2-19).
    const area = v_flex().id("cw-content").flex_1().min_h(0).w_full().px(8).pt(6).pb(10).gap(4).overflow_y_scrollbar();
    if (ctx.scroll) area.track_scroll(ctx.scroll);
    root.child(area.children(flockParts(vm, ui, ctx)));
  } else {
    const content = RENDER[tab](vm, ui, ctx);
    root.child(div().id("cw-content").flex_1().min_h(0).w_full().overflow_y_scrollbar().child(content));
  }
  root.child(footer(vm, ctx));
  if (vm.away && typeof vm.away === "object") {
    const slot = awaySlot(vm, ui, ctx);
    const away = renderAway(vm, ui, ctx, { maxH: slot.maxH });
    if (away) root.child(div().id("cw-away-slot").absolute().left(8).top(slot.top).child(away));
  }
  return root;
}

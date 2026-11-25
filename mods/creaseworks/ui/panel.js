// The panel frame (DESIGN §3.1, §2.4): `renderPanel(vm, ui, ctx)`
// (ARCHITECTURE B11). Standard 320 × H: header 44, save banner (§3.8, only
// with a notice), the mat (§3.2), boost bar 26, tabs 32, the active tab's
// content (flex_1, min_h 0, overflow_y_scrollbar) and footer 22, on T.chrome
// with 1 px T.border dividers. Below 200 px wide (folded, or unfolded in a
// window that leaves it too little room) the panel is the rail (§3.9, §2.4). The away card (§3.7) is the last child, an absolute overlay over the
// mat, so it paints above everything else; it never blocks the tabs.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { clip } from "../engine/index.js";
import { statusColor } from "./color.js";
import { icon, spritePath, sprite, statusGlyphPath } from "./art.js";
import { countdownBar, iconButton, text, hoverOn } from "./widgets.js";
import { renderMat, matGeometry, isCalm } from "./mat.js";
import { renderBanner, bannerLayout, saveProblem } from "./banner.js";
import { renderAway } from "./away.js";
import { renderRail } from "./rail.js";
import { flockParts } from "./flock.js";
import { renderShop } from "./shop.js";
import { renderString } from "./string.js";
import { renderSettings } from "./settings.js";

/** Grapheme limits for every string this module draws (tested). */
export const PANEL_CLIP = Object.freeze({ folds: 10, rate: 12, count: 5, wishes: 6, boost: 22, footer: 60, tab: 12 });

/** Fixed heights of the frame (DESIGN §3.1). */
export const FRAME = Object.freeze({ header: 44, matTop: 4, boost: 26, tabs: 32, footer: 22, awayTop: 36 });

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
]);

const RENDER = Object.freeze({ shop: renderShop, string: renderString, settings: renderSettings });

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
  return t === "shop" || t === "string" || t === "settings" ? t : "flock";
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
    return bar.child(text("Open envelopes when you're ready", { size: 11, color: T.muted }, T));
  }
  for (const b of boosts) {
    const type = String(b.type ?? "");
    const seal = Object.hasOwn(SEAL, type) ? spritePath("scene", SEAL[type]) : spritePath("ui", type === "song" ? "step" : "arrows");
    bar.child(
      h_flex()
        .id(`cw-boostbar-${type}`)
        .h(22)
        .flex_none()
        .px(6)
        .gap(4)
        .rounded(11)
        .bg(T.raised)
        .tooltip(clip(`${b.label ?? type}: ${Math.ceil(num(b.msLeft) / 1000)} s left`, 60))
        .child(sprite(seal, 12, T.foreground))
        .child(text(clip(String(b.label ?? type), PANEL_CLIP.boost), { size: 11, weight: 600, color: T.foreground }, T))
        .child(countdownBar(`cw-boostbar-${type}-bar`, num(b.msLeft), num(b.msTotal, 1), { width: 48, height: 3, calm }, T, ctx.S)),
    );
  }
  return bar;
}

function tabsRow(vm, ui, ctx) {
  const T = ctx.T;
  const go = handler(ctx, "tab");
  const current = activeTab(ui);
  const row = h_flex().id("cw-tabs").w_full().h(FRAME.tabs).flex_none().px(4).gap(2).border_b(1).border_color(T.border);
  const tabEl = (key, label, selected, target) => {
    const el = h_flex()
      .id(`cw-tab-${key}`)
      .h(FRAME.tabs)
      .px(10)
      .gap(4)
      .flex_none()
      .cursor_pointer()
      .role("tab")
      .aria_selected(selected)
      .text_size(12)
      .font_weight(600)
      .text_color(selected ? T.foreground : T.muted)
      .hover((s) => s.text_color(T.foreground))
      .on_click((e, cx) => go(target, cx))
      .child(clip(label, PANEL_CLIP.tab + 4));
    if (selected) el.border_b(2).border_color(T.accent);
    return el;
  };
  if (current === "settings") {
    const back = ui && (ui.back === "shop" || ui.back === "string") ? ui.back : "flock";
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
    const label = t.key === "flock" && total > 0 ? `${t.label} ${total}` : t.label;
    row.child(tabEl(t.key, label, current === t.key, t.key));
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
  if (isCalm(vm, ctx)) row.child(pill("cw-foot-calm", "Calm", "Calm mode: no motion (Settings)"));
  return row;
}

/** The whole panel copy (or the rail below FULL_BELOW px). Pure (B11). */
export function renderPanel(vm, ui, ctx) {
  const width = num(ctx.width, 320);
  if (width < FULL_BELOW) return renderRail(vm, ui, ctx);
  const T = ctx.T;
  const tab = activeTab(ui);
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
  const away = renderAway(vm, ui, ctx);
  if (away) {
    const lay = bannerLayout(vm, ui, ctx);
    const g = matGeometry(vm, ctx);
    const top = FRAME.header + (lay ? lay.total : 0) + FRAME.matTop + Math.min(FRAME.awayTop, Math.max(0, g.h - 140));
    root.child(div().id("cw-away-slot").absolute().left(8).top(top).child(away));
  }
  return root;
}

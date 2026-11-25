// The rail, the folded panel (DESIGN §3.9): `renderRail(vm, ui, ctx)`
// (ARCHITECTURE B11), 64 × H, everything centred with 8 px gaps: save glyph
// (only with a notice), count and rate, the mini Sheet, needs-you and
// envelope buttons, the per-helper pip grid (scrolls only when taller than the
// room), the gilded crane (while one is live) and the unfold chevron. No mat,
// no loops (the view sends none for the rail).

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { clip } from "../engine/index.js";
import { statusColor, statusDisc, hex6, isHex } from "./color.js";
import { icon, sheetPaths, spritePath, sprite, statusGlyphPath } from "./art.js";
import { iconButton, text, hoverOn } from "./widgets.js";
import { bannerNotices } from "./banner.js";

/** Grapheme limits for every string this module draws (tested). */
export const RAIL_CLIP = Object.freeze({ count: 7, rate: 9, n: 4, tooltip: 140, flash: 80, flashShort: 32 });
/** Every "the full panel cannot open" flash starts with this (glue/commands.js tightText). */
export const TIGHT_PREFIX = "Too narrow";

const PITCH = 14;
const COLS = 4;
const MAX_COLS = 12;
/** A rail at least this wide (tight: unfolded, under 200) shows the whole flash line; a narrower one its short form. */
const FLASH_ABOVE = 120;

/**
 * The flash as the rail draws it at `width`: whole from FLASH_ABOVE, else
 * its short form (the words before a colon: "Too narrow"), so a rail click
 * at any width (64, or 72-119 at zoom 1.5) says something (r2-12).
 */
export function railFlash(textIn, width) {
  const t = String(textIn ?? "");
  if (!t) return "";
  if (typeof width === "number" && width >= FLASH_ABOVE) return clip(t, RAIL_CLIP.flash);
  const k = t.indexOf(":");
  return clip(k > 0 ? t.slice(0, k) : t, RAIL_CLIP.flashShort);
}

/** Pip columns for a rail `width` px wide: 4 in the 64 px rail, more in a tight one (r2-14: it uses its column). */
export function pipColumns(width) {
  const w = typeof width === "number" && Number.isFinite(width) ? width : 64;
  return Math.max(COLS, Math.min(MAX_COLS, Math.floor((w - 8) / PITCH)));
}

function handler(ctx, name) {
  const h = ctx && ctx.handlers;
  const f = h && typeof h[name] === "function" ? h[name] : null;
  return (...args) => (f ? f(...args) : undefined);
}

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const statusOf = (s) => (s === "blocked" || s === "done" || s === "working" ? s : "idle");

function railButton(id, glyphEl, n, tooltip, onClick, T) {
  const el = h_flex()
    .id(id)
    .w(40)
    .h(28)
    .flex_none()
    .gap(4)
    .justify_center()
    .rounded(6)
    .bg(T.raised)
    .tooltip(tooltip)
    .child(glyphEl)
    .child(text(clip(String(n), RAIL_CLIP.n), { size: 11, weight: 600, color: n > 0 ? T.foreground : T.muted }, T));
  if (onClick) el.cursor_pointer().hover((s) => s.bg(hoverOn(T, T.raised))).on_click(onClick);
  else el.opacity(0.7);
  return el;
}

/**
 * The needs-you button's glyph: on T.raised, unless the needs-you colour
 * fails there (win98: #ff0000 on #dfdfdf fell back to grey #404040, r3-21);
 * then on a 16 px `statusDisc(T)` disc, as the Flock badges are.
 */
function needsGlyph(T) {
  const onRaised = statusColor(T, "blocked", T.raised);
  if (!isHex(T.blocked) || onRaised === hex6(T.blocked)) return sprite(statusGlyphPath("blocked"), 12, onRaised);
  const disc = statusDisc(T);
  return h_flex()
    .flex_none()
    .w(16)
    .h(16)
    .rounded(8)
    .justify_center()
    .bg(disc)
    .child(sprite(statusGlyphPath("blocked"), 12, statusColor(T, "blocked", disc)));
}

function pipGrid(marks, T, openHelper, select, cols) {
  const COLS = cols;
  const rows = Math.ceil(marks.length / COLS);
  const grid = div().relative().w(COLS * PITCH).h(Math.max(PITCH, rows * PITCH)).flex_none();
  marks.forEach((m, k) => {
    const status = statusOf(m.status);
    const urgent = status === "blocked" || status === "done";
    const id = m.helperId;
    const pip = h_flex()
      .id(`cw-rail-pip-${id}`)
      .absolute()
      .left((k % COLS) * PITCH)
      .top(Math.floor(k / COLS) * PITCH)
      .w(PITCH)
      .h(PITCH)
      .justify_center()
      .cursor_pointer()
      .tooltip(clip(String(m.tooltip ?? ""), RAIL_CLIP.tooltip) || "Helper")
      .on_click((e, cx) => (urgent ? openHelper(id, cx) : select(id, cx)))
      .child(svg(statusGlyphPath(status)).w(12).h(12).flex_none().text_color(statusColor(T, status, "chrome")));
    if (num(m.opacity, 1) < 1) pip.opacity(num(m.opacity, 1));
    grid.child(pip);
  });
  return div().id("cw-rail-pips").flex_1().min_h(0).w_full().flex().justify_center().overflow_y_scrollbar().child(grid);
}

/** The 64 px rail. */
export function renderRail(vm, ui, ctx) {
  const T = ctx.T;
  const S = ctx.S;
  const rail = vm.rail || {};
  const header = vm.header || {};
  const counts = header.counts || {};
  const click = handler(ctx, "click");
  const open = handler(ctx, "open");
  const openHelper = handler(ctx, "openHelper");
  const select = handler(ctx, "select");
  const fold = handler(ctx, "fold");
  const root = v_flex()
    .id("cw-rail")
    .size_full()
    .min_h(0)
    .items_center()
    .gap(8)
    .py(8)
    .bg(T.chrome)
    .overflow_hidden();

  // 1. Save glyph with the banner text as tooltip.
  const banner = bannerNotices(vm)[0];
  const saveText = typeof rail.save === "string" && rail.save ? rail.save : banner ? banner.text : null;
  if (saveText) {
    root.child(
      h_flex()
        .id("cw-rail-save")
        .w(28)
        .h(28)
        .justify_center()
        .tooltip(clip(String(saveText), RAIL_CLIP.tooltip))
        .child(icon("warn", 20, statusColor(T, "blocked", "chrome"))),
    );
  }
  // 2. Count, two lines.
  root.child(
    v_flex()
      .items_center()
      .child(text(clip(String(rail.count ?? header.folds ?? ""), RAIL_CLIP.count), { size: 11, weight: 600, color: T.foreground }, T))
      .child(text(clip(String(rail.rate ?? header.rate ?? ""), RAIL_CLIP.rate), { size: 11, color: T.muted }, T)),
  );
  // 2b. The flash (why a click could not open the full panel, r2-12) under
  // the count: whole in a rail 120 or wider, its short form ("Too narrow")
  // in a narrower one, so no rail click is without a visible effect.
  const flashNote = Array.isArray(vm.notices) ? vm.notices.find((n) => n && n.kind === "flash" && typeof n.text === "string") : null;
  const flashText = flashNote ? railFlash(flashNote.text, ctx.width) : "";
  if (flashText) {
    const wide = typeof ctx.width === "number" && ctx.width >= FLASH_ABOVE;
    root.child(text(flashText, { id: "cw-rail-flash", size: 11, color: T.foreground }, T).w_full().px(wide ? 6 : 2).text_center().flex_none());
  }
  const tightFlash = !!flashNote && flashNote.text.startsWith(TIGHT_PREFIX);
  // 3. Mini Sheet: one fold per click.
  const frame = num(vm.sheet && vm.sheet.frame, 0);
  const { base, shade } = sheetPaths(frame);
  root.child(
    div()
      .id("cw-sheet-mini")
      .relative()
      .w(44)
      .h(44)
      .flex_none()
      .rounded(8)
      .bg(S.mat)
      .cursor_pointer()
      .tooltip("Fold the paper")
      .active((s) => s.opacity(0.88))
      .on_click((e, cx) => click("mini", null, null, cx))
      .child(svg(base).absolute().left(4).top(4).w(36).h(36).text_color(S.sheet))
      .child(svg(shade).absolute().left(4).top(4).w(36).h(36).text_color(S.sheetShade)),
  );
  // 4. Needs-you button: opens the longest waiting (the glue cycles).
  const needs = num(rail.needs, num(counts.needs, 0));
  root.child(railButton(
    "cw-rail-needs",
    needsGlyph(T),
    needs,
    needs > 0 ? `${needs} need${needs === 1 ? "s" : ""} you: open the longest waiting` : "Nobody needs you",
    needs > 0 ? (e, cx) => openHelper("needs", cx) : null,
    T,
  ));
  // 5. Envelope button: opens the oldest envelope.
  const tray = vm.tray || {};
  const envs = Array.isArray(tray.envelopes) ? tray.envelopes : [];
  const nEnv = num(rail.envelopes, envs.length + num(tray.more, 0));
  const oldest = envs[0] && envs[0].helperId;
  root.child(railButton(
    "cw-rail-env",
    sprite(spritePath("status", "envelope"), 12, T.muted),
    nEnv,
    nEnv > 0 ? `${nEnv} envelope${nEnv === 1 ? "" : "s"}: open the oldest` : "No envelopes",
    nEnv > 0 && oldest ? (e, cx) => open(oldest, cx) : null,
    T,
  ));
  // 6. Per-helper pip grid.
  const marks = Array.isArray(rail.pips) ? rail.pips : [];
  root.child(pipGrid(marks, T, openHelper, select, pipColumns(ctx.width)));
  // 7. Gilded crane (only while one is live; clicking counts as catching it).
  const craneId = rail.crane ?? (vm.mat && vm.mat.crane ? vm.mat.crane.id : null);
  if (craneId) {
    const art = div().relative().w(24).h(18);
    for (const [part, color] of [["outline", S.goldInk], ["body", S.gold], ["shade", S.goldShade]]) {
      art.child(svg(spritePath("scene", `crane-gilded-${part}`)).absolute().top(0).left(0).w(24).h(18).text_color(color));
    }
    root.child(
      h_flex()
        .id("cw-rail-crane")
        .w(28)
        .h(28)
        .flex_none()
        .justify_center()
        .rounded(6)
        .bg(S.mat)
        .cursor_pointer()
        .tooltip("A gilded crane! Click it before it flies off.")
        .on_click((e, cx) => click("crane", craneId, null, cx))
        .child(art),
    );
  }
  // 8. Unfold chevron.
  // A rail drawn only because the window leaves the panel too little room
  // (unfolded, under 200 px: 146 with Files open, 124 or 106 at zoom 1.5)
  // cannot unfold further: its chevron folds it to 64 and gives the terminals
  // the room. Folded or not is the layout's weight (ctx.folded, r2-13); a ctx
  // without it falls back to the width.
  // While a "Too narrow" flash shows, the chevron is ringed in the accent
  // (a visible answer at any width, r2-12): it is the panel's fold control.
  const tight = typeof ctx.folded === "boolean" ? !ctx.folded : typeof ctx.width === "number" && ctx.width >= 140;
  const tip = tight ? "Too narrow for the full panel: fold to a slim rail to give the terminals room, or drag its edge or widen the window" : "Unfold Creaseworks";
  const chevron = iconButton("cw-rail-unfold", tight ? "fold" : "chevron", tip, { size: 16, onClick: (e, cx) => fold(cx) }, T);
  if (tightFlash) chevron.bg(T.raised).border(1).border_color(T.accent);
  root.child(chevron);
  return root;
}

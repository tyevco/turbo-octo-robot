// The rail, the folded panel (DESIGN §3.9): `renderRail(vm, ui, ctx)`
// (ARCHITECTURE B11), 64 × H, everything centred with 8 px gaps: save glyph
// (only with a notice), count and rate, the mini Sheet, needs-you and
// envelope buttons, the per-helper pip grid (scrolls only when taller than the
// room), the gilded crane (while one is live) and the unfold chevron. No mat,
// no loops (the view sends none for the rail).

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { clip } from "../engine/index.js";
import { statusColor } from "./color.js";
import { icon, sheetPaths, spritePath, sprite, statusGlyphPath } from "./art.js";
import { iconButton, text, hoverOn } from "./widgets.js";
import { bannerNotices } from "./banner.js";

/** Grapheme limits for every string this module draws (tested). */
export const RAIL_CLIP = Object.freeze({ count: 7, rate: 9, n: 4, tooltip: 140 });

const PITCH = 14;
const COLS = 4;

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

function pipGrid(marks, T, openHelper, select) {
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
    sprite(statusGlyphPath("blocked"), 12, statusColor(T, "blocked", T.raised)),
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
  root.child(pipGrid(marks, T, openHelper, select));
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
  root.child(iconButton("cw-rail-unfold", "chevron", "Unfold Creaseworks", { size: 16, onClick: (e, cx) => fold(cx) }, T));
  return root;
}

// The ribbon (DESIGN §3.10, §2.3): `renderRibbon(vm, ui, ctx)` (ARCHITECTURE
// B11), 30 px × the work width. Left block 118 (fold icon, count, rate),
// middle: one mark per helper, never capped (density A chips, B two-row pips,
// C tallies beyond B), right block 100 (envelope count, mini Sheet while the
// panel is folded or hidden, fold toggle). A save chip, the "Welcome back"
// pill or the narrow-window hint take the first place of the middle area.
// The ribbon draws no loops (the view's budget gives it none).

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { clip } from "../engine/index.js";
import { statusColor } from "./color.js";
import { hueOf } from "./palette.js";
import { sheetPaths, spritePath, sprite, statusGlyphPath } from "./art.js";
import { button, chip, iconButton, text, hoverOn } from "./widgets.js";
import { bannerNotices } from "./banner.js";

/** Grapheme limits for every string this module draws (tested). */
export const RIBBON_CLIP = Object.freeze({ count: 8, rate: 10, pill: 24, empty: 80, n: 5, tooltip: 140, hint: 44 });

/** Block widths (§3.10): pad 8, left 118, right 100. */
export const RIBBON_BLOCKS = Object.freeze({ pad: 8, left: 118, right: 100 });

const CHIP_PITCH = 22;
const PIP_PITCH = 14;
const GROUP_OF = Object.freeze({ working: "working", idle: "resting", blocked: "needs", done: "finished" });

function handler(ctx, name) {
  const h = ctx && ctx.handlers;
  const f = h && typeof h[name] === "function" ? h[name] : null;
  return (...args) => (f ? f(...args) : undefined);
}

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const statusOf = (s) => (s === "blocked" || s === "done" || s === "working" ? s : "idle");

/** Pip area width for a ribbon of work width W: W − 16 − 118 − 100 − 16. */
export function pipArea(W) {
  return Math.max(0, W - 2 * RIBBON_BLOCKS.pad - RIBBON_BLOCKS.left - RIBBON_BLOCKS.right - 2 * RIBBON_BLOCKS.pad);
}

/** Density level for n marks in pip area w (§3.10 table). */
export function densityLevel(n, w) {
  if (n * CHIP_PITCH <= w) return "A";
  if (n <= 2 * Math.floor(w / PIP_PITCH)) return "B";
  return "C";
}

function markClick(m, h) {
  const id = m.helperId;
  const status = statusOf(m.status);
  if (status === "blocked" || status === "done") return (e, cx) => h.openHelper(id, cx);
  return (e, cx) => h.select(id, cx);
}

function chipMark(m, T, S, hues, h) {
  const status = statusOf(m.status);
  const id = m.helperId;
  const el = div()
    .id(`cw-rib-m-${id}`)
    .relative()
    .flex_none()
    .w(20)
    .h(20)
    .rounded(5)
    .bg(T.raised)
    .cursor_pointer()
    .tooltip(clip(String(m.tooltip ?? ""), RIBBON_CLIP.tooltip) || "Helper")
    .hover((s) => s.bg(hoverOn(T, T.raised)))
    .on_click(markClick(m, h))
    .child(svg(statusGlyphPath(status)).absolute().left(4).top(3).w(12).h(12).text_color(statusColor(T, status, "raised")))
    .child(div().absolute().left(3).bottom(1).w(14).h(2).rounded(1).bg(hueOf(hues, m.hue)));
  if (m.dashed || status === "blocked") el.border(1).border_dashed().border_color(statusColor(T, "blocked", "chrome"));
  if (num(m.opacity, 1) < 1) el.opacity(num(m.opacity, 1));
  if (m.envelope) {
    // The envelope marker opens the envelope; it sits over the chip.
    el.child(
      div()
        .id(`cw-rib-env-${id}`)
        .absolute()
        .right(-3)
        .top(-3)
        .w(10)
        .h(10)
        .rounded(5)
        .bg(S.sheet)
        .border(1)
        .border_color(T.border)
        .cursor_pointer()
        .tooltip("Envelope ready: click to open")
        .on_click((e, cx) => {
          cx.stop_propagation();
          return h.open(id, cx);
        }),
    );
  }
  return el;
}

function pipMark(m, k, T, h) {
  const status = statusOf(m.status);
  const id = m.helperId;
  const el = h_flex()
    .id(`cw-rib-m-${id}`)
    .absolute()
    .left(Math.floor(k / 2) * PIP_PITCH)
    .top(k % 2 === 0 ? 1 : 15)
    .w(PIP_PITCH)
    .h(PIP_PITCH)
    .justify_center()
    .cursor_pointer()
    .tooltip(clip(String(m.tooltip ?? ""), RIBBON_CLIP.tooltip) || "Helper")
    .on_click(markClick(m, h))
    .child(svg(statusGlyphPath(status)).w(12).h(12).flex_none().text_color(statusColor(T, status, "chrome")));
  if (num(m.opacity, 1) < 1) el.opacity(num(m.opacity, 1));
  return el;
}

function pipBlock(marks, T, h, id) {
  const cols = Math.ceil(marks.length / 2);
  const box = div().id(id).relative().flex_none().w(cols * PIP_PITCH).h(30);
  marks.forEach((m, k) => box.child(pipMark(m, k, T, h)));
  return box;
}

function tally(t, T, h) {
  const status = statusOf(t.status);
  const group = GROUP_OF[status];
  const label = clip(String(t.label ?? t.count ?? 0), RIBBON_CLIP.n);
  return chip(`cw-rib-tally-${status}`, label, {
    status,
    border: T.border,
    tooltip: clip(String(t.tooltip ?? `${label} ${group}`), RIBBON_CLIP.tooltip),
    onClick: (e, cx) => h.showGroup(group, cx),
  }, T);
}

function leadChip(vm, ctx, T, S, h) {
  const rib = vm.ribbon || {};
  const out = [];
  const banner = bannerNotices(vm)[0];
  const save = typeof rib.save === "string" && rib.save ? rib.save : banner && banner.kind !== "clock" ? "Save problem" : null;
  if (save) {
    out.push(chip("cw-rib-save", clip(save, RIBBON_CLIP.pill), {
      icon: "warn",
      iconColor: statusColor(T, "blocked", "popover"),
      border: statusColor(T, "blocked", "chrome"),
      tooltip: clip(String(banner ? banner.text : save), RIBBON_CLIP.tooltip),
      onClick: (e, cx) => h.show(cx),
    }, T, S));
  }
  if (typeof rib.pill === "string" && rib.pill) {
    out.push(chip("cw-rib-welcome", clip(rib.pill, RIBBON_CLIP.pill), {
      icon: "fold",
      border: T.border,
      tooltip: "Open Creaseworks to collect",
      onClick: (e, cx) => h.show(cx),
    }, T, S));
  }
  if (ctx.narrowHint) {
    out.push(
      h_flex()
        .id("cw-rib-hint")
        .flex_none()
        .h(28)
        .gap(4)
        .child(
          h_flex().h(22).px(8).rounded(11).bg(T.popover).border(1).border_color(T.border)
            .child(text(clip("Narrow window: fold Creaseworks to a rail?", RIBBON_CLIP.hint), { size: 11, color: T.foreground }, T)),
        )
        .child(button("cw-rib-hint-fold", "Fold", { h: 28, size: 11, px: 6, onClick: (e, cx) => h.fold(cx) }, T))
        .child(button("cw-rib-hint-later", "Not now", { variant: "ghost", h: 28, size: 11, px: 6, onClick: (e, cx) => h.dismiss("narrow", cx) }, T)),
    );
  }
  return out;
}

/** The ribbon. */
export function renderRibbon(vm, ui, ctx) {
  const T = ctx.T;
  const S = ctx.S;
  const hues = ctx.hues;
  const W = num(ctx.width, num(vm.ribbon && vm.ribbon.width, 0) + 2 * RIBBON_BLOCKS.pad + RIBBON_BLOCKS.left + RIBBON_BLOCKS.right + 2 * RIBBON_BLOCKS.pad);
  const h = {
    open: handler(ctx, "open"),
    openHelper: handler(ctx, "openHelper"),
    select: handler(ctx, "select"),
    showGroup: handler(ctx, "showGroup"),
    show: handler(ctx, "show"),
    fold: handler(ctx, "fold"),
    dismiss: handler(ctx, "dismiss"),
    click: handler(ctx, "click"),
  };
  const rib = vm.ribbon || {};
  const header = vm.header || {};
  const marks = Array.isArray(rib.marks) ? rib.marks : [];
  const tallies = Array.isArray(rib.tallies) ? rib.tallies : [];
  const w = pipArea(W);

  // Left block.
  const left = h_flex()
    .id("cw-rib-left")
    .w(RIBBON_BLOCKS.left)
    .h(30)
    .flex_none()
    .gap(4)
    .child(iconButton("cw-rib-fold", "fold", "Fold or unfold Creaseworks", { size: 14, hit: 28, onClick: (e, cx) => h.fold(cx) }, T))
    .child(
      v_flex()
        .min_w(0)
        .child(text(clip(String(rib.folds ?? header.folds ?? ""), RIBBON_CLIP.count), { size: 12, weight: 600, color: T.foreground }, T).line_height("117%"))
        .child(text(clip(String(rib.rate ?? header.rate ?? ""), RIBBON_CLIP.rate), { size: 11, color: T.muted }, T).line_height("118%")),
    );

  // Middle.
  const middle = h_flex().id("cw-rib-marks").flex_1().min_w(0).h(30).gap(4).overflow_hidden();
  for (const el of leadChip(vm, ctx, T, S, h)) middle.child(el);
  if (!marks.length && !tallies.length) {
    const empty = typeof rib.empty === "string" && rib.empty ? rib.empty : "No paper folk yet · start an agent in any tab and it joins the workshop";
    middle.child(text(clip(empty, RIBBON_CLIP.empty), { size: 11, color: T.muted, truncate: true }, T));
  } else {
    const level = rib.level === "A" || rib.level === "B" || rib.level === "C" ? rib.level : densityLevel(marks.length, w);
    if (level === "A") {
      const row = h_flex().id("cw-rib-chips").gap(2).flex_none();
      for (const m of marks) row.child(chipMark(m, T, S, hues, h));
      middle.child(row);
    } else {
      middle.child(pipBlock(marks, T, h, "cw-rib-pips"));
      for (const t of level === "C" ? tallies : []) middle.child(tally(t, T, h));
    }
  }

  // Right block.
  const tray = vm.tray || {};
  const envs = Array.isArray(tray.envelopes) ? tray.envelopes : [];
  const nEnv = num(rib.envelopes, envs.length + num(tray.more, 0));
  const oldest = envs[0] && envs[0].helperId;
  const right = h_flex().id("cw-rib-right").w(RIBBON_BLOCKS.right).h(30).flex_none().gap(2).justify_end();
  const envBtn = h_flex()
    .id("cw-rib-env")
    .min_w(28)
    .h(28)
    .px(4)
    .gap(3)
    .justify_center()
    .rounded(6)
    .tooltip(nEnv > 0 ? `${nEnv} envelope${nEnv === 1 ? "" : "s"}: open the oldest` : "No envelopes")
    .child(sprite(spritePath("status", "envelope"), 12, T.muted))
    .child(text(clip(String(nEnv), RIBBON_CLIP.n), { size: 11, weight: 600, color: nEnv > 0 ? T.foreground : T.muted }, T));
  if (nEnv > 0 && oldest) envBtn.cursor_pointer().hover((s) => s.bg(hoverOn(T, T.chrome))).on_click((e, cx) => h.open(oldest, cx));
  right.child(envBtn);
  if (!ctx.panelShown) {
    const { base, shade } = sheetPaths(num(vm.sheet && vm.sheet.frame, 0));
    right.child(
      div()
        .id("cw-rib-mini")
        .relative()
        .w(26)
        .h(26)
        .flex_none()
        .rounded(5)
        .bg(S.mat)
        .cursor_pointer()
        .tooltip("Fold the paper")
        .active((s) => s.opacity(0.88))
        .on_click((e, cx) => h.click("mini", null, null, cx))
        .child(svg(base).absolute().left(3).top(3).w(20).h(20).text_color(S.sheet))
        .child(svg(shade).absolute().left(3).top(3).w(20).h(20).text_color(S.sheetShade)),
    );
  }
  right.child(iconButton("cw-rib-toggle", "arrows", "Fold or unfold Creaseworks (ctrl-shift-g)", { size: 14, onClick: (e, cx) => h.fold(cx) }, T));

  return h_flex()
    .id("cw-ribbon")
    .w_full()
    .h(30)
    .px(RIBBON_BLOCKS.pad)
    .gap(RIBBON_BLOCKS.pad)
    .bg(T.chrome)
    .overflow_hidden()
    .child(left)
    .child(middle)
    .child(right);
}


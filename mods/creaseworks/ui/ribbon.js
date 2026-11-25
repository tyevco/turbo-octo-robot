// The ribbon (DESIGN §3.10, §2.3): `renderRibbon(vm, ui, ctx)` (ARCHITECTURE
// B11), 30 px × the work width. Left block 118 (fold icon, count, rate),
// middle: one mark per helper, never capped (density A chips, B two-row pips,
// C tallies beyond B), right block 100 (envelope count, mini Sheet while the
// panel is folded or hidden, fold toggle). A save chip, the "Welcome back"
// pill or the narrow-window hint take the first place of the middle area;
// their reserved width is subtracted before the density level is chosen
// (`ribbonLayout`), so a lead chip never pushes a mark past the edge.
// The ribbon draws no loops (the view's budget gives it none).

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { cellWidth, clip, formatInt } from "../engine/index.js";
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
/** Status glyph placement in a 20 px chip, without and with the envelope marker. */
export const CHIP_GLYPH = Object.freeze({
  plain: Object.freeze({ x: 4, y: 3, size: 12 }),
  envelope: Object.freeze({ x: 1, y: 7, size: 10 }),
});
/** The chip's envelope marker: a disc in the top-right corner holding the envelope glyph. */
export const ENV_MARKER = Object.freeze({ size: 10, glyph: 8 });
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
  const env = Boolean(m.envelope);
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
    .on_click(markClick(m, h));
  // With an envelope the status glyph steps down-left (10 px at 1,7) so the
  // envelope marker fits in the chip's top-right corner without covering it.
  const g = env ? CHIP_GLYPH.envelope : CHIP_GLYPH.plain;
  el.child(svg(statusGlyphPath(status)).absolute().left(g.x).top(g.y).w(g.size).h(g.size).text_color(statusColor(T, status, "raised")))
    .child(div().absolute().left(3).bottom(1).w(14).h(2).rounded(1).bg(hueOf(hues, m.hue)));
  if (m.dashed || status === "blocked") el.border(1).border_dashed().border_color(statusColor(T, "blocked", "chrome"));
  if (num(m.opacity, 1) < 1) el.opacity(num(m.opacity, 1));
  if (env) {
    // The envelope marker (DESIGN §5.2): the envelope glyph in S.ink on an
    // S.sheet disc, inside the chip's top-right corner (it never reaches the
    // neighbouring chip). Clicking it opens the envelope.
    const d = ENV_MARKER;
    el.child(
      h_flex()
        .id(`cw-rib-env-${id}`)
        .absolute()
        .right(0)
        .top(0)
        .w(d.size)
        .h(d.size)
        .rounded(d.size / 2)
        .justify_center()
        .bg(S.sheet)
        .border(1)
        // T.muted, not T.border: a cream dot on a light chrome needs a real edge (paper, win98).
        .border_color(T.muted)
        .cursor_pointer()
        .tooltip("Envelope ready: click to open")
        .on_click((e, cx) => {
          cx.stop_propagation();
          return h.open(id, cx);
        })
        .child(svg(spritePath("status", "envelope")).flex_none().w(d.glyph).h(d.glyph).text_color(S.ink)),
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

// ---------------------------------------------------------------------------
// Widths the middle area reserves. The lead chips (save chip, "Welcome back"
// pill, narrow-window hint) share the middle row with the marks, so the
// density level is chosen for the width they leave (DESIGN §3.10 "one mark
// per helper, never capped"). Text widths are upper bounds (11 px text is
// about 5.4 px a cell; 6 / 6.4 leave room for other fonts), and every lead
// element is bounded to its reserved width (max_w + truncate, or a fixed
// button width), so the marks are never pushed past the overflow edge.

/** Upper bound, in px, of an 11 px text run (`weight` 400 or 600). */
export function textBound(str, weight = 400) {
  return Math.ceil(cellWidth(String(str ?? "")) * (weight >= 600 ? 6.4 : 6));
}

/** Width of a `widgets.chip` pill with a 12 px glyph and an 11/600 label (border 2 + px 16 + glyph 12 + gap 4). */
function chipBound(label) {
  return label ? 34 + textBound(label, 600) : 30;
}

/** Width of a small text button (px 6, 1 px border), never under the 28 px hit. */
function buttonBound(label) {
  return Math.max(28, 14 + textBound(label, 600));
}

const MIDDLE_GAP = 4;
const HINT_TEXT = "Narrow window: fold Creaseworks to a rail?";
const DENSE = Object.freeze({ A: 0, B: 1, C: 2 });

function tally(t, T, h) {
  const status = statusOf(t.status);
  const group = GROUP_OF[status];
  const label = clip(String(t.label ?? t.count ?? 0), RIBBON_CLIP.n);
  return chip(`cw-rib-tally-${status}`, label, {
    status,
    border: T.border,
    maxW: chipBound(label),
    tooltip: clip(String(t.tooltip ?? `${label} ${group}`), RIBBON_CLIP.tooltip),
    onClick: (e, cx) => h.showGroup(group, cx),
  }, T);
}

/**
 * The lead elements as specs `{ key, w, label }` (no elements built). With
 * `compact` the pills drop their labels (tooltips keep the words) and the
 * narrow hint is its two buttons only; used when even level C would not fit.
 */
function leadSpecs(vm, ctx, compact) {
  const rib = vm.ribbon || {};
  const out = [];
  const banner = bannerNotices(vm)[0];
  const save = typeof rib.save === "string" && rib.save ? rib.save : banner && banner.kind !== "clock" ? "Save problem" : null;
  if (save) {
    const label = compact ? null : clip(save, RIBBON_CLIP.pill);
    out.push({ key: "save", label, w: chipBound(label), save, banner });
  }
  if (typeof rib.pill === "string" && rib.pill) {
    const label = compact ? null : clip(rib.pill, RIBBON_CLIP.pill);
    out.push({ key: "welcome", label, w: chipBound(label), pill: rib.pill });
  }
  if (ctx && ctx.narrowHint) {
    const label = compact ? null : clip(HINT_TEXT, RIBBON_CLIP.hint);
    const fold = buttonBound("Fold");
    const later = buttonBound("Not now");
    const pill = label ? 18 + textBound(label, 400) : 0;
    out.push({ key: "hint", label, pill, fold, later, w: (pill ? pill + 4 : 0) + fold + 4 + later });
  }
  return out;
}

function leadWidth(specs) {
  let w = 0;
  for (const sp of specs) w += sp.w + MIDDLE_GAP;
  return w;
}

function leadElement(sp, T, S, h) {
  if (sp.key === "save") {
    return chip("cw-rib-save", sp.label, {
      icon: "warn",
      iconColor: statusColor(T, "blocked", "popover"),
      border: statusColor(T, "blocked", "chrome"),
      maxW: sp.w,
      tooltip: clip(String(sp.banner ? sp.banner.text : sp.save), RIBBON_CLIP.tooltip),
      onClick: (e, cx) => h.show(cx),
    }, T, S);
  }
  if (sp.key === "welcome") {
    return chip("cw-rib-welcome", sp.label, {
      icon: "fold",
      border: T.border,
      maxW: sp.w,
      tooltip: sp.label ? "Open Creaseworks to collect" : clip(`${sp.pill}: open Creaseworks to collect`, RIBBON_CLIP.tooltip),
      onClick: (e, cx) => h.show(cx),
    }, T, S);
  }
  const row = h_flex().id("cw-rib-hint").flex_none().max_w(sp.w).h(28).gap(4);
  if (sp.label) {
    row.child(
      h_flex().flex_none().max_w(sp.pill).min_w(0).h(22).px(8).rounded(11).bg(T.popover).border(1).border_color(T.border).overflow_hidden()
        .child(text(sp.label, { size: 11, color: T.foreground, truncate: true }, T)),
    );
  }
  const foldTip = sp.label ? undefined : HINT_TEXT;
  return row
    .child(button("cw-rib-hint-fold", "Fold", { h: 28, w: sp.fold, size: 11, px: 6, tooltip: foldTip, onClick: (e, cx) => h.fold(cx) }, T))
    .child(button("cw-rib-hint-later", "Not now", { variant: "ghost", h: 28, w: sp.later, size: 11, px: 6, onClick: (e, cx) => h.dismiss("narrow", cx) }, T));
}

/** Width the marks of a level need (chips 22 a mark, pips 14 a column of two, tallies their chip + gap). */
function needOf(level, marks, tallies) {
  if (level === "A") return marks.length * CHIP_PITCH;
  const pips = Math.ceil(marks.length / 2) * PIP_PITCH;
  if (level === "B") return pips;
  let w = pips;
  for (const t of tallies) w += MIDDLE_GAP + chipBound(clip(String(t.label ?? t.count ?? 0), RIBBON_CLIP.n));
  return w;
}

/** Level C from a full mark list: needs-you and finished stay individual, the rest become tallies (as engine/view.js). */
function toTallies(all) {
  const marks = [];
  let working = 0;
  let idle = 0;
  for (const m of all) {
    const st = statusOf(m.status);
    if (st === "blocked" || st === "done") marks.push(m);
    else if (st === "working") working++;
    else idle++;
  }
  const tallies = [];
  if (working) tallies.push({ status: "working", count: working, label: formatInt(working), tooltip: `${formatInt(working)} working` });
  if (idle) tallies.push({ status: "idle", count: idle, label: formatInt(idle), tooltip: `${formatInt(idle)} resting` });
  return { marks, tallies };
}

/**
 * The middle area's plan for a ribbon of work width `W` (tested):
 * `{ w, lead, avail, level, marks, tallies, need, compact, specs }`. The
 * level is the denser of the view's level and the one that fits beside the
 * lead chips; when that is C the view's tallies are used, or built here.
 */
export function ribbonLayout(vm, ctx, W) {
  const rib = (vm && vm.ribbon) || {};
  const marks0 = Array.isArray(rib.marks) ? rib.marks : [];
  const tallies0 = Array.isArray(rib.tallies) ? rib.tallies : [];
  const w = pipArea(W);
  const viewLevel = rib.level === "A" || rib.level === "B" || rib.level === "C" ? rib.level : null;
  // Helpers in all: the view's level C has already folded some into tallies.
  let n = marks0.length;
  if (viewLevel === "C") for (const t of tallies0) n += Math.max(0, num(t.count, 0));
  const plan = (compact) => {
    const specs = leadSpecs(vm, ctx, compact);
    const lead = leadWidth(specs);
    const avail = Math.max(0, w - lead);
    let level = densityLevel(n, avail);
    if (viewLevel && DENSE[viewLevel] > DENSE[level]) level = viewLevel;
    let marks = marks0;
    let tallies = viewLevel === "C" ? tallies0 : [];
    if (level === "C" && viewLevel !== "C") ({ marks, tallies } = toTallies(marks0));
    if (level !== "C") tallies = [];
    return { w, lead, avail, level, marks, tallies, need: needOf(level, marks, tallies), compact, specs };
  };
  const full = plan(false);
  if (full.need <= full.avail || !full.specs.length) return full;
  // Even level C overflows beside the full lead: the compact lead, when it clips less.
  const tight = plan(true);
  return tight.need - tight.avail < full.need - full.avail ? tight : full;
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

  // Middle: the lead chips first, then the marks at the level that fits beside them.
  const lay = ribbonLayout(vm, ctx, W);
  const middle = h_flex().id("cw-rib-marks").flex_1().min_w(0).h(30).gap(MIDDLE_GAP).overflow_hidden();
  for (const sp of lay.specs) middle.child(leadElement(sp, T, S, h));
  if (!lay.marks.length && !lay.tallies.length) {
    const empty = typeof rib.empty === "string" && rib.empty ? rib.empty : "No paper folk yet · start an agent in any tab and it joins the workshop";
    middle.child(text(clip(empty, RIBBON_CLIP.empty), { size: 11, color: T.muted, truncate: true }, T));
  } else if (lay.level === "A") {
    const row = h_flex().id("cw-rib-chips").gap(2).flex_none();
    for (const m of lay.marks) row.child(chipMark(m, T, S, hues, h));
    middle.child(row);
  } else {
    if (lay.marks.length) middle.child(pipBlock(lay.marks, T, h, "cw-rib-pips"));
    for (const t of lay.tallies) middle.child(tally(t, T, h));
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


// "While you were away" / "While you were busy" card (DESIGN §3.7, §10.3):
// `renderAway(vm, ui, ctx, fit)` (ARCHITECTURE B11) → element | null. An
// absolute, non-blocking card the panel places over the mat (304 wide at mat
// x 0, y 36); it has its own close ✕ and, for the away kind, Collect. Uses
// the vm's ready lines (B10 `capText splitText …`) when present, else builds
// them from the B6 fields.
//
// The card stays inside the mat and the boost bar, so the tabs below are
// never covered (review r7-11: a full seven-row card ran 314 px down over the
// Flock/Shop/String row). `fit.maxH` is the room the panel gives it; when the
// whole card does not fit, `awayFit` makes it tight (less padding, Collect on
// the folds row) and then lets the lowest rows give way (best helper, you
// can afford, rested, envelopes; who needs you always stays).

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { clip, graphemes } from "../engine/index.js";
import { statusColor, statusDisc, surfaceColor } from "./color.js";
import { icon, spritePath, sprite, statusGlyphPath } from "./art.js";
import { button, divider, iconButton, text } from "./widgets.js";

/** Grapheme limits for every string this module draws (tested). */
export const AWAY_CLIP = Object.freeze({ title: 24, line: 64, folds: 16, cap: 90 });

/**
 * The close ✕ tooltips (tested). Closing the away card collects its folds at
 * once (the engine's `dismiss` of "away" credits the pot, ARCHITECTURE B9):
 * the tooltip says so (r3-13; it used to claim the folds stayed to collect).
 */
export const AWAY_CLOSE = Object.freeze({ away: "Close and collect the folds", busy: "Close" });

function handler(ctx, name) {
  const h = ctx && ctx.handlers;
  const f = h && typeof h[name] === "function" ? h[name] : null;
  return (...args) => (f ? f(...args) : undefined);
}

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const str = (v) => (typeof v === "string" && v ? v : null);

function line(glyphEl, words, T, extra) {
  const row = h_flex().min_h(22).gap(8).child(div().w(16).flex_none().flex().justify_center().child(glyphEl));
  row.child(text(clip(words, AWAY_CLIP.line), { size: 11, color: T.foreground, truncate: true }, T).flex_1());
  if (extra) row.child(extra);
  return row;
}

/**
 * A status glyph for a card line, guarded for the card (T.popover). Where
 * the theme's needs-you colour fails 3:1 on T.popover (win98: red, olive and
 * grey all fell back to one #404040, r3-21) the glyph sits on a 16 px disc
 * of `statusDisc(T)` instead, so it keeps its own colour.
 */
function statusMark(T, status) {
  const disc = statusDisc(T);
  const g = sprite(statusGlyphPath(status), 12, statusColor(T, status, disc));
  if (disc === surfaceColor(T, "popover")) return g;
  return h_flex().w(16).h(16).flex_none().rounded(8).justify_center().bg(disc).border(1).border_color(T.border).child(g);
}

/** The ready lines of an away/busy vm (B10 strings first, then B6 fields). */
export function awayLines(a) {
  const needs = Array.isArray(a.needs) ? a.needs : [];
  const affordable = Array.isArray(a.affordable) ? a.affordable : [];
  const envelopes = num(a.envelopes);
  const rested = num(a.rested);
  const best = a.best && typeof a.best === "object" ? a.best : null;
  const busy = a.kind === "busy";
  return {
    title: str(a.title) || (busy ? "While you were busy" : "While you were away"),
    cap: str(a.capText) || (a.capped ? "Helpers fold for at most 8 h while you're gone." : busy ? null : "(Creaseworks counts up to 8 h)"),
    split: str(a.splitText) || (a.split && typeof a.split === "object" ? `workshops ${a.split.workshops} · helpers ${a.split.helpers}` : null),
    envelopes: str(a.envelopesText) || (envelopes > 0 ? `${plural(envelopes, "envelope", "envelopes")} waiting on the tray` : null),
    needs: str(a.needsText) || (needs.length ? `${needs.length === 1 ? "1 helper needs" : `${needs.length} helpers need`} you: ${needs.map((x) => x.name).join(", ")}` : null),
    rested: str(a.restedText) || (rested > 0 ? `${plural(rested, "helper", "helpers")} rested fully` : null),
    best: str(a.bestText) || (best ? `Best helper: ${best.name} the ${best.species}, ${plural(num(best.tasks), "task", "tasks")}` : null),
    affordable: str(a.affordableText) || (affordable.length ? `You can afford: ${affordable.map((x) => x.name).join(", ")}` : null),
    tasks: str(a.tasksText) || (typeof a.tasks === "number" ? `${plural(a.tasks, "task", "tasks")} finished` : null),
  };
}

/**
 * The card's box model, for its height (tested against the shots: gpui text
 * lines are 1.618 × the text size; the 7-row card measures 314 + 2 px).
 */
export const AWAY_BOX = Object.freeze({
  pad: 14, gap: 6, tightPad: 10, tightGap: 4, border: 1, lh: 1.618034,
  row: 22, actionRow: 28, close: 28, collect: 28, collectTop: 4, capPx: 6.4,
});

/** The card's optional rows in draw order, and the order they give way when room is short (r7-11). */
export const AWAY_ROWS = Object.freeze(["tasks", "envelopes", "needs", "rested", "best", "affordable"]);
export const AWAY_DROP = Object.freeze(["best", "affordable", "rested", "envelopes", "tasks"]);

/** The card's width for a panel `width` (the mat's, 304 at most). */
export function awayWidth(width) {
  return Math.max(200, Math.min(304, num(width, 320) - 16));
}

function headCap(a, L) {
  return clip(L.cap ? `${a.duration ?? ""}  ${L.cap}` : String(a.duration ?? ""), AWAY_CLIP.cap);
}

/** The rows this card has, in draw order. */
function presentRows(a, L) {
  const busy = a.kind === "busy";
  const has = { tasks: busy && L.tasks, envelopes: L.envelopes, needs: !busy && L.needs, rested: !busy && L.rested, best: !busy && L.best, affordable: !busy && L.affordable };
  return AWAY_ROWS.filter((k) => Boolean(has[k]));
}

const hasCollect = (a) => a.kind !== "busy" && a.collectable !== false;

/** The fold icon's column and the gap after it: the folds figure and the split line start this far in (px). */
const SPLIT_INDENT = 16 + 8;

/**
 * The card's height in px for `rows` (keys of AWAY_ROWS), tight or not: its
 * padding and border, the head (title and the wrapped cap line beside ✕),
 * the divider, the folds row (with Collect at its end when tight), the rows
 * and the Collect row, with the gaps between them.
 */
export function awayHeight(a, width, opts = {}) {
  const B = AWAY_BOX;
  const L = awayLines(a);
  const tight = Boolean(opts.tight);
  const rows = Array.isArray(opts.rows) ? opts.rows : presentRows(a, L);
  const pad = tight ? B.tightPad : B.pad;
  const gap = tight ? B.tightGap : B.gap;
  const lh = (size) => size * B.lh;
  const capW = Math.max(40, width - 2 * B.border - 2 * pad - B.close - 8);
  const capLines = Math.max(1, Math.ceil((graphemes(headCap(a, L)).length * B.capPx) / capW));
  const head = Math.max(B.close, lh(13) + capLines * lh(11));
  let folds = lh(a.kind === "busy" ? 16 : 20);
  const collect = hasCollect(a);
  if (tight && collect) folds = Math.max(folds, B.collect);
  // The split line wraps (it is never cut inside a number, r8-14) in the
  // width right of the fold icon, under the folds figure or, when tight,
  // under the folds row and its Collect.
  if (L.split) {
    const splitW = Math.max(40, width - 2 * B.border - 2 * pad - SPLIT_INDENT);
    folds += Math.max(1, Math.ceil((graphemes(clip(L.split, AWAY_CLIP.line)).length * B.capPx) / splitW)) * lh(11);
  }
  const parts = [head, 1, folds];
  for (const k of rows) parts.push(k === "needs" && (a.needs || [])[0] && a.needs[0].helperId ? B.actionRow : B.row);
  if (collect && !tight) parts.push(B.collectTop + B.collect);
  return 2 * B.border + 2 * pad + parts.reduce((x, y) => x + y, 0) + gap * (parts.length - 1);
}

/**
 * How the card fits in `maxH` px (none: no limit): the whole card when it
 * fits, else tight, else tight without the rows of AWAY_DROP in turn until it
 * fits (needs-you rows never go). → { tight, rows, dropped, height }.
 */
export function awayFit(a, width, maxH) {
  const L = awayLines(a);
  const all = presentRows(a, L);
  const room = typeof maxH === "number" && Number.isFinite(maxH) ? maxH : Infinity;
  const full = awayHeight(a, width, { rows: all });
  if (full <= room) return { tight: false, rows: all, dropped: [], height: full };
  let rows = all.slice();
  const dropped = [];
  let height = awayHeight(a, width, { tight: true, rows });
  for (const k of AWAY_DROP) {
    if (height <= room) break;
    if (!rows.includes(k)) continue;
    rows = rows.filter((r) => r !== k);
    dropped.push(k);
    height = awayHeight(a, width, { tight: true, rows });
  }
  return { tight: true, rows, dropped, height };
}

/**
 * The card for `vm.away`, or null. `width` defaults to 304 (the mat);
 * `fit.maxH` (optional) caps its height (see `awayFit`).
 */
export function renderAway(vm, ui, ctx, fit = undefined) {
  const a = vm && vm.away;
  if (!a || typeof a !== "object") return null;
  const T = ctx.T;
  const busy = a.kind === "busy";
  const L = awayLines(a);
  const width = awayWidth(ctx.width);
  const plan = awayFit(a, width, fit && fit.maxH);
  const B = AWAY_BOX;
  const show = new Set(plan.rows);
  const dismiss = handler(ctx, "dismiss");
  const collect = handler(ctx, "collect");
  const openHelper = handler(ctx, "openHelper");
  const kind = busy ? "busy" : "away";

  const head = h_flex()
    .gap(8)
    .child(
      v_flex()
        .flex_1()
        .min_w(0)
        .child(text(clip(L.title, AWAY_CLIP.title), { size: 13, weight: 600, color: T.foreground }, T))
        .child(text(headCap(a, L), { size: 11, color: T.muted }, T).whitespace_normal()),
    )
    .child(iconButton("cw-away-close", "close", busy ? AWAY_CLOSE.busy : AWAY_CLOSE.away, {
      size: 14, surface: T.popover, stop: true, onClick: (e, cx) => dismiss(kind, cx),
    }, T));

  const card = v_flex()
    .id("cw-away")
    .w(width)
    .p(plan.tight ? B.tightPad : B.pad)
    .gap(plan.tight ? B.tightGap : B.gap)
    .rounded(10)
    .bg(T.popover)
    .border(1)
    .border_color(T.border)
    .shadow_lg()
    .child(head)
    .child(divider(T));
  // The limit is a hard one: should the text run taller than the estimate,
  // the card clips at its own edge rather than reach the tabs.
  if (fit && typeof fit.maxH === "number" && Number.isFinite(fit.maxH)) card.max_h(Math.max(0, Math.floor(fit.maxH))).overflow_hidden();
  const collectButton = () =>
    button("cw-away-collect", "Collect", { variant: "primary", w: 88, h: B.collect, stop: true, onClick: (e, cx) => collect(cx) }, T);
  const withCollect = !busy && a.collectable !== false;

  // Tight: Collect moves up to the end of the folds row (one row less), and
  // the split line goes under that row at its full width: beside the 88 px
  // button a cut fell inside a number ("helpers 7,9…" read as 7.9, r8-14).
  // It wraps between words rather than being cut, so a figure stays whole.
  const tightCollect = plan.tight && withCollect;
  const split = L.split
    ? text(clip(L.split, AWAY_CLIP.line), { size: 11, color: T.muted }, T).id("cw-away-split").min_w(0).whitespace_normal()
    : null;
  const foldsRow = h_flex()
    .gap(8)
    .child(div().w(16).flex_none().flex().justify_center().child(icon("fold", 16, T.muted)))
    .child(
      v_flex()
        .flex_1()
        .min_w(0)
        .child(text(clip(String(a.folds ?? ""), AWAY_CLIP.folds) + " folds", { size: busy ? 16 : 20, weight: 600, color: T.foreground }, T))
        .when(split !== null && !tightCollect, (el) => el.child(split)),
    );
  if (tightCollect) foldsRow.child(collectButton());
  card.child(
    tightCollect && split !== null
      ? v_flex()
          .child(foldsRow)
          .child(h_flex().gap(8).child(div().w(16).flex_none()).child(v_flex().flex_1().min_w(0).child(split)))
      : foldsRow,
  );

  const row = (key, el) => (show.has(key) ? card.child(el.id(`cw-away-row-${key}`)) : null);
  if (show.has("tasks")) row("tasks", line(icon("check", 12, T.muted), L.tasks, T));
  if (show.has("envelopes")) row("envelopes", line(sprite(spritePath("status", "envelope"), 12, T.muted), L.envelopes, T));
  const needs = Array.isArray(a.needs) ? a.needs : [];
  if (show.has("needs")) {
    const first = needs[0] && needs[0].helperId;
    const go = first
      ? button("cw-away-open", "Open ›", { h: B.actionRow, size: 11, px: 8, stop: true, onClick: (e, cx) => openHelper(first, cx) }, T)
      : null;
    row("needs", line(statusMark(T, "blocked"), L.needs, T, go));
  }
  if (show.has("rested")) row("rested", line(statusMark(T, "idle"), L.rested, T));
  if (show.has("best")) row("best", line(statusMark(T, "done"), L.best, T));
  if (show.has("affordable")) row("affordable", line(icon("shop", 12, T.muted), L.affordable, T));

  if (withCollect && !plan.tight) card.child(h_flex().justify_end().pt(B.collectTop).child(collectButton()));
  return card;
}

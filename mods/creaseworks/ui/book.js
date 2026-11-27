// The Book tab, the Pattern book (DESIGN §4.7 "The Book tab"; ARCHITECTURE
// B17 UI): `renderBook(vm, ui, ctx)` (B11). Returns one element sized to its
// content at full width (8 px side padding); the panel wraps it in the
// scrolling `#cw-content`. Pure: it draws only what `vm.book` says, and its
// cards exist only while the tab shows (the vm builds them only then).
//
// Layout: a header ("Pattern book" and "5 / 9 · 14 / 27 marks"), the status
// line, the help line while fewer than 3 diagrams are found (afterwards in
// the header's info tooltip), then the nine cards in 2 (Narrow, < 280 px),
// 3 (Standard) or 4 (Wide, ≥ 400 px) columns, 8 px apart. Each card is a
// `div#cw-book-<id>` on T.raised: a 56 × 56 paper square (S.sheet) with the
// diagram drawn from the same `PATTERNS[].dots` the classifier's canons are
// tested against (one fill path for the nine dots, one stroke path for the
// line), beside it the fold piece on a small S.mat tile, the tier pips and
// the count; under it the name, the status and the effect (the short label
// at Narrow). Nothing moves: no loops, no transitions.

import { div, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { clip } from "../engine/index.js";
import { validateBackgroundColor } from "./color.js";
import { icon, sprite, pipPath, foldSprite } from "./art.js";
import { text } from "./widgets.js";

/** Grapheme limits for every string this module draws (tested; ARCHITECTURE B17). */
export const BOOK_CLIP = Object.freeze({ name: 12, short: 16, effect: 44, hint: 44, line: 60, chip: 40, count: 28, sub: 20, status: 16, tooltip: 140, help: 160 });

/**
 * Card geometry (px): the drawing, the fold tile, the pips, padding, the gap
 * between cards, the name and text lines, and the gap under the drawing.
 * A card is as tall as its text (`cardLines`); every card in a row takes
 * the tallest one's height.
 */
export const CARD = Object.freeze({ draw: 56, tile: 20, foldPx: 16, pip: 8, pad: 6, gap: 8, name: 16, line: 14, under: 4 });

/**
 * The 14 px text lines under a card's name (tested): found = status +
 * effect (3 lines; the 1-line short label at Narrow); next = dots + short
 * effect + hint (3 lines); hidden = dots + hint (3 lines).
 */
export function cardLines(c, narrow) {
  const state = c && (c.state === "found" || c.state === "next") ? c.state : "hidden";
  const hint = c && c.hint ? 3 : 0;
  if (state === "found") return 1 + (narrow ? 1 : 3);
  if (state === "next") return 2 + hint;
  return 1 + hint;
}

/** A card's height for `lines` text lines. */
export const cardHeight = (lines) => 2 * CARD.pad + CARD.draw + CARD.under + CARD.name + lines * CARD.line;

/** The book's one help line (DESIGN §4.7 "Tracing"): shown until 3 are found, then the header's tooltip. */
export const BOOK_HELP = "Join neighbouring dots on the Sheet's crease field. Click the last dot again to set, or end on the first to close. Any turn or mirror counts.";

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const r1 = (v) => Math.round(v * 10) / 10;

function paint(path, background) {
  const win = globalThis.window;
  if (!win || typeof win.paint_path !== "function") return null;
  return win.paint_path(path, background);
}

/** Columns for a panel `width`: 2 below 280 (Narrow), 4 from 400 (Wide), else 3. */
export function bookColumns(width) {
  const w = num(width, 320);
  return w < 280 ? 2 : w >= 400 ? 4 : 3;
}

/** A card's width for a panel `width`: the content (width − 16) shared by the columns and their 8 px gaps. */
export function cardWidth(width) {
  const cols = bookColumns(width);
  const inner = Math.max(180, num(width, 320) - 16);
  return Math.floor((inner - CARD.gap * (cols - 1)) / cols);
}

/** Cards narrower than this show the short effect label instead of the three-line effect. */
export const SHORT_BELOW = 96;

/** The tier pips row's width: three 8 px pips 2 px apart. */
export const PIPS_W = 3 * CARD.pip + 2 * 2;

/**
 * The drawing's side for a card `w` px wide: CARD.draw, smaller only where
 * the column beside it (w − 2·pad − draw − 4) would be narrower than the
 * pips (280–331 px and Wide 400–439 px), so the pips, the fold tile and the
 * count never sit on the drawing. The drawing is in percent, so it scales.
 */
export function drawSize(w) {
  return Math.max(0, Math.min(CARD.draw, Math.floor(num(w, 96)) - 2 * CARD.pad - 4 - PIPS_W));
}

/** Percent of the drawing for a grid point (0..2): (2c + 1) / 6, as on the Sheet. */
const cellPct = (c) => `${r1(((2 * num(c) + 1) / 6) * 100)}%`;

/** An octagon's corners on the unit circle (cos, sin of 22.5° + k · 45°), as literals. */
const OCT = Object.freeze([[0.9239, 0.3827], [0.3827, 0.9239], [-0.3827, 0.9239], [-0.9239, 0.3827], [-0.9239, -0.3827], [-0.3827, -0.9239], [0.3827, -0.9239], [0.9239, -0.3827]]);

/**
 * The octagons of every drawing, by "col,row,radius" (built on first use and
 * kept: nine cards draw the same 27 shapes, and building their percent
 * strings was most of the tab's render time in QuickJS).
 */
let octagons = null;

/** A diamond (half-diagonal `rad` px) round grid point (c, rw), in percent coordinates (kept like the octagons). */
function diamond(c, rw, rad) {
  if (!octagons) octagons = Object.create(null);
  const key = `d${c},${rw},${rad}`;
  const hit = octagons[key];
  if (hit) return hit;
  const cx = ((2 * num(c) + 1) / 6) * CARD.draw;
  const cy = ((2 * num(rw) + 1) / 6) * CARD.draw;
  const p = (x, y) => [`${r1((x / CARD.draw) * 100)}%`, `${r1((y / CARD.draw) * 100)}%`];
  const pts = [p(cx + rad, cy), p(cx, cy + rad), p(cx - rad, cy), p(cx, cy - rad)];
  octagons[key] = pts;
  return pts;
}

/** An octagon (radius `rad` px in a CARD.draw box) round grid point (c, rw), in percent coordinates. */
function octagon(c, rw, rad) {
  if (!octagons) octagons = Object.create(null);
  const key = `${c},${rw},${rad}`;
  const hit = octagons[key];
  if (hit) return hit;
  const cx = ((2 * num(c) + 1) / 6) * CARD.draw;
  const cy = ((2 * num(rw) + 1) / 6) * CARD.draw;
  const pts = OCT.map(([u, v]) => [`${r1(((cx + rad * u) / CARD.draw) * 100)}%`, `${r1(((cy + rad * v) / CARD.draw) * 100)}%`]);
  octagons[key] = pts;
  return pts;
}

/**
 * The 56 × 56 drawing of a diagram (DESIGN §4.7): one fill path for the
 * nine dots (used ones 6 px, others 3 px) and, when the card shows the
 * shape, one 2 px S.ink stroke path for the line (closed shapes closed, the
 * start dot ringed). The "next" card draws its line dashed; the whole
 * drawing is at 0.6 for it. Hidden cards: the nine dots only.
 */
/**
 * The built paths of every drawing, by its dots, closed and state (built on
 * first use and kept: a Path is immutable geometry in percent, so a render
 * only paints it; rebuilding nine cards' paths each render was most of the
 * all-found Book tab's time in QuickJS). { dots, line | null }.
 */
let paths = null;

function drawingPaths(card, dots) {
  if (!paths) paths = Object.create(null);
  const key = `${card.state === "next" ? "n" : "f"}${card.closed === true ? "c" : "o"}${dots ? dots.map(([c, r]) => `${c}${r}`).join("") : "-"}`;
  const hit = paths[key];
  if (hit) return hit;
  const used = new Set((dots || []).map(([c, r]) => `${c},${r}`));
  const fill = PathBuilder.fill();
  // used dots 6 px octagons, the others 3 px diamonds (a 3 px dot is a dot either way; half the path)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) fill.add_polygon(used.has(`${c},${r}`) ? octagon(c, r, 3) : diamond(c, r, 1.6));
  let line = null;
  if (dots && dots.length >= 2) {
    const b = PathBuilder.stroke(2);
    dots.forEach(([c, r], k) => {
      if (k === 0) b.move_to(cellPct(c), cellPct(r));
      else b.line_to(cellPct(c), cellPct(r));
    });
    if (card.closed === true) b.line_to(cellPct(dots[0][0]), cellPct(dots[0][1]));
    // the start dot ringed (a separate subpath of the same stroke)
    b.add_polygon(octagon(dots[0][0], dots[0][1], 6));
    if (card.state === "next") b.dash_array([4, 3]);
    line = b.build();
  }
  const out = { dots: fill.build(), line };
  paths[key] = out;
  return out;
}

function drawing(card, S, size = CARD.draw) {
  const dots = Array.isArray(card.dots) ? card.dots : null;
  const built = drawingPaths(card, dots);
  const ink = Background.solid(validateBackgroundColor(S.ink));
  const box = div().id(`cw-book-${card.id}-draw`).relative().flex_none().w(size).h(size).rounded(4).bg(S.sheet);
  const dotsEl = paint(built.dots, ink);
  if (dotsEl) box.child(dotsEl.absolute().inset_0());
  if (built.line) {
    const line = paint(built.line, ink);
    if (line) box.child(line.absolute().inset_0());
  }
  if (card.state === "next") box.opacity(0.6);
  return box;
}

/** Three tier pips (filled / hollow diamonds: a shape cue) for `pips: [bool, bool, bool]`. */
function pipsRow(card, T) {
  const row = h_flex().gap(2).flex_none();
  const pips = Array.isArray(card.pips) ? card.pips : [false, false, false];
  for (let k = 0; k < 3; k++) row.child(sprite(pipPath(pips[k] ? "working" : "idle"), CARD.pip, T.foreground));
  return row;
}

/** One line of 11 px text, clipped and truncated to the card. */
const line = (s, T, color = T.muted, weight = 400) => text(s, { size: 11, weight, color, truncate: true }, T).w_full().h(CARD.line).line_height(`${CARD.line}px`);

/** `n` lines of wrapped 11 px text in a fixed box (the overflow is hidden; the full text is in the tooltip). */
const lines = (s, n, T, color = T.muted) =>
  div().w_full().h(n * CARD.line).overflow_hidden().child(text(s, { size: 11, color }, T).whitespace_normal().line_height(`${CARD.line}px`));

/** A card's clue (the hint): `lines` in italic, so it never reads on from the short effect above it. */
const clue = (s, T) =>
  div().w_full().h(3 * CARD.line).overflow_hidden().child(text(s, { size: 11, color: T.muted }, T).italic().whitespace_normal().line_height(`${CARD.line}px`));

function card(c, narrow, w, h, ctx) {
  const T = ctx.T;
  const S = ctx.S;
  const state = c.state === "found" || c.state === "next" ? c.state : "hidden";
  const name = state === "hidden" ? "???" : clip(str(c.name), BOOK_CLIP.name);
  const sub = clip(str(c.sub), BOOK_CLIP.sub);
  // Beside the drawing: the fold on its mat tile, the pips and the count (found only),
  // in a column never narrower than the pips (drawSize).
  const draw = drawSize(w);
  const side = v_flex().id(`cw-book-${c.id}-side`).flex_1().min_w(PIPS_W).items_end().gap(4);
  if (state === "found") {
    let tile = null;
    try {
      tile = h_flex().id(`cw-book-${c.id}-fold`).w(CARD.tile).h(CARD.tile).flex_none().rounded(4).bg(S.mat).justify_center().items_center()
        .tooltip(clip(str(c.fold) || name, BOOK_CLIP.tooltip))
        .child(foldSprite(String(c.id), CARD.foldPx, S.sheet, S.sheetShade));
    } catch {
      tile = null; // an unknown diagram from a newer build: no tile
    }
    if (tile) side.child(tile);
    side.child(pipsRow(c, T));
    if (typeof c.count === "string" && c.count) side.child(text(clip(c.count, 8), { size: 11, weight: 600, color: T.foreground }, T));
  }
  // (the row keeps CARD.draw's height, so a smaller drawing never changes the card's)
  const top = h_flex().w_full().h(CARD.draw).items_start().gap(4).child(drawing(c, S, draw)).child(side);
  const body = v_flex().w_full().gap(0).pt(CARD.under);
  body.child(text(name, { size: 12, weight: 600, color: state === "hidden" ? T.muted : T.foreground, truncate: true }, T).w_full().h(CARD.name).line_height(`${CARD.name}px`));
  if (state === "found") {
    body.child(line(clip(str(c.status), BOOK_CLIP.status), T, T.foreground));
    // the short label at Narrow and on cards under 96 px (280-319 and 400-439 px panels), where
    // three lines of 70-80 px cut most effects short; the full text is in the tooltip
    // (wrapped in the effect's three lines there, so a 16-grapheme label is never cut)
    if (narrow) body.child(line(clip(str(c.short), BOOK_CLIP.short), T));
    else if (w < SHORT_BELOW) body.child(lines(clip(str(c.short), BOOK_CLIP.short), 3, T));
    else body.child(lines(clip(str(c.effect), BOOK_CLIP.effect), 3, T));
  } else if (state === "next") {
    body.child(line(sub, T, T.foreground));
    body.child(line(clip(str(c.short), BOOK_CLIP.short), T));
    if (c.hint) body.child(clue(clip(str(c.hint), BOOK_CLIP.hint), T).id(`cw-book-${c.id}-clue`));
  } else {
    body.child(line(sub, T, T.foreground));
    if (c.hint) body.child(clue(clip(str(c.hint), BOOK_CLIP.hint), T).id(`cw-book-${c.id}-clue`));
  }
  const tip = state === "found" ? str(c.tooltip) : state === "next" ? `Next to find · ${sub}${c.hint ? ` · ${c.hint}` : ""}` : `${sub}${c.hint ? ` · ${c.hint}` : ""}`;
  return v_flex()
    .id(`cw-book-${c.id}`)
    .flex_none()
    .w(w)
    .h(h)
    .p(CARD.pad)
    .rounded(6)
    .bg(T.raised)
    .overflow_hidden()
    .tooltip(clip(tip, BOOK_CLIP.tooltip))
    .child(top)
    .child(body);
}

/** The Book tab (§4.7). Pure (B11). */
export function renderBook(vm, ui, ctx) {
  const T = ctx.T;
  const b = (vm && vm.book) || {};
  const width = num(ctx.width, 320);
  const narrow = width < 280;
  const root = v_flex().id("cw-book").w_full().px(8).pt(8).pb(10).gap(6);
  const count = clip(narrow ? `${num(b.found)} / ${num(b.of, 9)}` : str(b.count) || `${num(b.found)} / ${num(b.of, 9)}`, BOOK_CLIP.count);
  const head = h_flex()
    .id("cw-book-head")
    .w_full()
    .gap(6)
    .child(text("Pattern book", { size: 13, weight: 600, color: T.foreground }, T))
    .child(div().flex_1())
    .child(text(count, { size: 11, weight: 600, color: T.foreground }, T).flex_none().whitespace_nowrap());
  const help = typeof b.help === "string" && b.help ? b.help : null;
  if (!help) {
    // the help line has moved into the header's tooltip (§4.7)
    head.child(div().id("cw-book-info").flex_none().tooltip(clip(BOOK_HELP, BOOK_CLIP.help)).child(icon("info", 12, T.muted)));
  }
  root.child(head);
  if (b.line) root.child(text(clip(str(b.line), BOOK_CLIP.line), { size: 11, color: T.muted }, T).whitespace_normal());
  if (help) root.child(text(clip(help, BOOK_CLIP.help), { size: 11, color: T.muted }, T).whitespace_normal());
  const cards = Array.isArray(b.cards) ? b.cards.filter((c) => c && typeof c === "object" && typeof c.id === "string") : [];
  const cols = bookColumns(width);
  const w = cardWidth(width);
  const grid = v_flex().id("cw-book-cards").w_full().gap(CARD.gap);
  for (let k = 0; k < cards.length; k += cols) {
    const row = h_flex().w_full().gap(CARD.gap).items_start();
    const these = cards.slice(k, k + cols);
    const h = cardHeight(Math.max(...these.map((c) => cardLines(c, narrow))));
    for (const c of these) row.child(card(c, narrow, w, h, ctx));
    grid.child(row);
  }
  root.child(grid);
  return root;
}

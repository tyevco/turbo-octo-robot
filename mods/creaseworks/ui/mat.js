// The mat, the main scene (DESIGN §3.2, §4, §13.5): `renderMat(vm, ui, ctx)`
// (ARCHITECTURE B11). Layering is sibling order (later paints on top): grid
// and edge (paint_path), storm stripes, crease line, the Sheet and its fold
// ticks, crease nodes, scraps, the ream, the gilded crane, the boat, the top
// band (needs-you chips or the figure shelf), the bottom band (tray and
// streak meter), floating numbers, the first-run hint.
//
// Positions in the vm are logical px in the 304×232 mat (304×184 with
// `sheet.short`). The mat drawn here is `ctx.width − 16` wide and 184 / 232 /
// 260 tall (narrow / standard / wide, §2.4); `matGeometry` maps vm positions
// into it piecewise around the Sheet so nothing that missed the Sheet in the
// vm overlaps it here. Loops only where the vm asks (pulse, bob, hintBob,
// storm) and never in calm mode (§11.1).

import { div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex } from "gpui-base";
import { clip } from "../engine/index.js";
import { validateBackgroundColor } from "./color.js";
import { sheetPaths, spritePath, speciesSprite, icon, sprite } from "./art.js";
import { chip, pop, progressBar, text } from "./widgets.js";

/** Grapheme limits for every string this module draws (tested). */
export const MAT_CLIP = Object.freeze({ chip: 10, more: 6, label: 8, pop: 10, hint: 40, craneHint: 48 });

const SRC_W = 304;
const STD = Object.freeze({ h: 232, sheet: 112, sx: 96, sy: 58 });
const SHORT = Object.freeze({ h: 184, sheet: 96, sx: 104, sy: 42 });
const TOP_BAND = 28;
const BOTTOM_BAND = 32;
const HALF_HIT = 14;
const CRANE = Object.freeze({ w: 48, h: 36 });
const BOAT = Object.freeze({ w: 48, h: 32, x0: 8, x1: 248 });
const ENV_TYPES = Object.freeze(["bundle", "rush", "storm", "chorus"]);
const HINT_TEXT = "Click the paper to fold it";
const CRANE_HINT = "A gilded crane! Click it before it flies off.";
/** The first gilded crane's callout chip (§3.2): 176 wide (two lines of 11/600) where it fits. */
const CRANE_CHIP = Object.freeze({ w: 176 });
/** The chip's text box: 8 px side padding, 14 px lines (127 % of 11), 6 px for border and air; ≈ 6.4 px a grapheme at 11/600. */
const CHIP_TEXT = Object.freeze({ padX: 8, padY: 6, line: 14, px: 6.4, minW: 64, maxLines: 6 });

function handler(ctx, name) {
  const h = ctx && ctx.handlers;
  const f = h && typeof h[name] === "function" ? h[name] : null;
  return (...args) => (f ? f(...args) : undefined);
}

/** Calm mode from ctx or the vm (§11.1: no loops, no spins, no pops). */
export function isCalm(vm, ctx) {
  return Boolean((ctx && ctx.calm) || (vm && vm.calm) || (vm && vm.settings && vm.settings.calm));
}

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const r1 = (v) => Math.round(v * 10) / 10;
const pct = (v, of) => `${r1((v / of) * 100)}%`;

/** Piecewise linear map of `v` from [a0, a1] onto [b0, b1] (identity when equal). */
function lin(v, a0, a1, b0, b1) {
  if (a1 === a0) return b0;
  return b0 + ((v - a0) * (b1 - b0)) / (a1 - a0);
}

/**
 * The drawn mat's size and the vm → drawn position map:
 * `{ w, h, sheet, sx, sy, short, mapX(x), mapY(y) }`. Standard 320 wide and
 * a non-short vm give the identity.
 */
export function matGeometry(vm, ctx) {
  const width = num(ctx && ctx.width, 320);
  const srcShort = Boolean(vm && vm.sheet && vm.sheet.short);
  const narrow = width < 280;
  const wide = width >= 400;
  const w = Math.max(200, Math.round(width - 16));
  const src = srcShort ? SHORT : STD;
  const h = srcShort || narrow ? SHORT.h : wide ? 260 : STD.h;
  const sheet = h === SHORT.h ? SHORT.sheet : STD.sheet;
  const fieldTop = TOP_BAND;
  const fieldBot = h - BOTTOM_BAND;
  const sx = Math.round((w - sheet) / 2);
  const sy = Math.round(fieldTop + (fieldBot - fieldTop - sheet) / 2);
  // x: left of the Sheet, the Sheet's columns, right of the Sheet; each keeps
  // a half hit area clear of the Sheet's edges.
  const a = src.sx;
  const b = src.sx + src.sheet;
  const mapX = (x) => {
    if (x < a) return lin(Math.max(HALF_HIT, x), HALF_HIT, a - HALF_HIT, HALF_HIT, sx - HALF_HIT);
    if (x <= b) return x - a + sx;
    return lin(Math.min(SRC_W - HALF_HIT, x), b + HALF_HIT, SRC_W - HALF_HIT, sx + sheet + HALF_HIT, w - HALF_HIT);
  };
  const srcBot = src.h - BOTTOM_BAND;
  const mapY = (y) => (src.h === h ? y : lin(y, TOP_BAND, srcBot, fieldTop, fieldBot));
  // A box (left/top, w × h) pushed off the Sheet by the shortest move: slot
  // centres next to the Sheet put a 28 px hit area up to ~1 px over its edge.
  const clear = (bx, by, bw, bh) => {
    const ox = Math.min(bx + bw, sx + sheet) - Math.max(bx, sx);
    const oy = Math.min(by + bh, sy + sheet) - Math.max(by, sy);
    if (ox <= 0 || oy <= 0) return [bx, by];
    const moves = [
      [sx - (bx + bw), 0], [sx + sheet - bx, 0], [0, sy - (by + bh)], [0, sy + sheet - by],
    ].filter(([dx, dy]) => bx + dx >= 0 && bx + dx + bw <= w && by + dy >= 0 && by + dy + bh <= h);
    if (!moves.length) return [bx, by];
    moves.sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - Math.abs(b[0]) - Math.abs(b[1]));
    return [r1(bx + moves[0][0]), r1(by + moves[0][1])];
  };
  return { w, h, sheet, sx, sy, short: h === SHORT.h, mapX, mapY, clear };
}

function paint(path, background) {
  const win = globalThis.window;
  if (!win || typeof win.paint_path !== "function") return null;
  return win.paint_path(path, background);
}

/** Grid lines every `step` px in % coordinates, one stroke path. */
function gridPath(w, h, step) {
  const b = PathBuilder.stroke(1);
  for (let x = step; x < w; x += step) b.move_to(pct(x, w), "0%").line_to(pct(x, w), "100%");
  for (let y = step; y < h; y += step) b.move_to("0%", pct(y, h)).line_to("100%", pct(y, h));
  return b.build();
}

function layer(el) {
  return el ? el.absolute().inset_0() : null;
}

function background(g, S, calm, zoom, storm) {
  const out = [];
  // 1. Grid: two stroke elements (minor 16, major 64), then the 4 px edge.
  out.push(layer(paint(gridPath(g.w, g.h, 16), Background.solid(validateBackgroundColor(S.grid)))));
  out.push(layer(paint(gridPath(g.w, g.h, 64), Background.solid(validateBackgroundColor(S.gridMajor)))));
  const edge = PathBuilder.fill().add_polygon([["0%", pct(g.h - 4, g.h)], ["100%", pct(g.h - 4, g.h)], ["100%", "100%"], ["0%", "100%"]]).build();
  out.push(layer(paint(edge, Background.solid(validateBackgroundColor(S.matEdge)))));
  // 2. Confetti stripes (internal id "storm"), under the play pieces.
  if (storm && !calm) {
    const rect = PathBuilder.fill().add_polygon([["0%", "0%"], ["100%", "0%"], ["100%", "100%"], ["0%", "100%"]]).build();
    const stripes = layer(paint(rect, Background.pattern_slash(validateBackgroundColor(S.onMat), 2 * zoom, 12 * zoom)));
    if (stripes) out.push(stripes.id("cw-storm").opacity(0.06).loop("opacity", { from: 0.06, to: 0.16, period: 1200 }));
  }
  return out.filter(Boolean);
}

function creaseLine(points, g, S) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const b = PathBuilder.stroke(2);
  points.forEach((p, i) => {
    const x = pct(g.mapX(num(p[0])), g.w);
    const y = pct(g.mapY(num(p[1])), g.h);
    if (i === 0) b.move_to(x, y);
    else b.line_to(x, y);
  });
  b.dash_array([6, 4]);
  const el = layer(paint(b.build(), Background.solid(validateBackgroundColor(S.sheet))));
  return el ? el.id("cw-crease-line") : null;
}

function theSheet(vm, g, S, click, zoom) {
  const frame = num(vm.sheet && vm.sheet.frame, 0);
  const { base, shade } = sheetPaths(frame);
  const size = g.sheet;
  const el = div()
    .id("cw-sheet")
    .absolute()
    .left(g.sx)
    .top(g.sy)
    .w(size)
    .h(size)
    .cursor_pointer()
    .tooltip("Fold the paper")
    .active((s) => s.opacity(0.88))
    .on_mouse_down("left", (e, cx) => {
      const z = zoom > 0 ? zoom : 1;
      const lp = e && e.local_position;
      const lx = lp && typeof lp.x === "number" ? lp.x / z : size / 2;
      const ly = lp && typeof lp.y === "number" ? lp.y / z : size / 2;
      return click("sheet", null, { x: r1(g.sx + lx), y: r1(g.sy + ly) }, cx);
    })
    .child(svg(base).absolute().top(0).left(0).w(size).h(size).text_color(S.sheet))
    .child(svg(shade).absolute().top(0).left(0).w(size).h(size).text_color(S.sheetShade));
  // Fold ticks: 8 × (6×2), done ticks in S.sheet, the rest S.crease.
  const done = Math.max(0, Math.min(8, Math.round(num(vm.sheet && vm.sheet.ticks, 0))));
  const ticks = h_flex()
    .absolute()
    .left(Math.round(g.sx + (size - 74) / 2))
    .top(g.sy + size + 5)
    .w(74)
    .h(2)
    .gap(4);
  for (let i = 0; i < 8; i++) ticks.child(div().w(6).h(2).flex_none().bg(i < done ? S.sheet : S.crease));
  return [el, ticks];
}

/** The centre of a `size` hit area at vm (x, y), mapped and kept off the Sheet. */
function place(g, vx, vy, bw, bh) {
  const [bx, by] = g.clear(r1(g.mapX(num(vx)) - bw / 2), r1(g.mapY(num(vy)) - bh / 2), bw, bh);
  return [bx + bw / 2, by + bh / 2];
}

function node(n, g, S, click, calm) {
  const [x, y] = place(g, n.x, n.y, 28, 28);
  const label = clip(String(n.i ?? ""), 3);
  const disc = h_flex()
    .w(22)
    .h(22)
    .flex_none()
    .rounded_full()
    .justify_center()
    .bg(S.sheet)
    .border(2)
    .border_color(S.node)
    .child(text(label, { size: 11, weight: 600, color: S.ink }));
  const el = h_flex()
    .id(`cw-node-${n.id}`)
    .absolute()
    .left(r1(x - HALF_HIT))
    .top(r1(y - HALF_HIT))
    .w(28)
    .h(28)
    .justify_center()
    .rounded_full()
    .cursor_pointer()
    .tooltip(`Crease node ${label}${n.due ? " (next)" : ""}`)
    .on_click((e, cx) => {
      cx.stop_propagation();
      return click("node", n.id, { x: r1(x), y: r1(y) }, cx);
    })
    .child(disc);
  if (n.due) el.border(3).border_color(S.node);
  if (n.fading) {
    el.opacity(0.4);
    if (!calm) el.transition("opacity", 2000);
  }
  return el;
}

function scrap(s, g, S, click) {
  const [x, y] = place(g, s.x, s.y, 28, 28);
  return h_flex()
    .id(`cw-scrap-${s.id}`)
    .absolute()
    .left(r1(x - HALF_HIT))
    .top(r1(y - HALF_HIT))
    .w(28)
    .h(28)
    .justify_center()
    .cursor_pointer()
    .tooltip("A paper scrap")
    .on_click((e, cx) => {
      cx.stop_propagation();
      return click("scrap", s.id, { x: r1(x), y: r1(y) }, cx);
    })
    .child(sprite(spritePath("scene", "scrap"), 16, S.sheet));
}

function ream(r, g, S, click) {
  const [x, y] = place(g, r.x, r.y, 36, 28);
  return h_flex()
    .id("cw-ream")
    .absolute()
    .left(r1(Math.max(0, x - 18)))
    .top(r1(Math.max(0, y - 14)))
    .w(36)
    .h(28)
    .justify_center()
    .cursor_pointer()
    .tooltip("A fresh ream: today's welcome")
    .on_click((e, cx) => {
      cx.stop_propagation();
      return click("ream", r.id, { x: r1(x), y: r1(y) }, cx);
    })
    .child(sprite(spritePath("scene", "ream"), [28, 20], S.sheet));
}

function craneBox(c, g) {
  const cx0 = g.mapX(num(c.x) + CRANE.w / 2) - CRANE.w / 2;
  const cy0 = g.mapY(num(c.y) + CRANE.h / 2) - CRANE.h / 2;
  return g.clear(r1(Math.max(0, Math.min(g.w - CRANE.w, cx0))), r1(Math.max(0, Math.min(g.h - CRANE.h, cy0))), CRANE.w, CRANE.h);
}

/**
 * Where the first gilded crane's callout chip goes: `{ x, y, w, h, lines,
 * follow }` in mat px, or null without a crane. Tried in order, the first box
 * that stays inside the play field (between the bands) and covers neither the
 * Sheet nor the crane wins:
 *   1. the 176 px chip above the crane, then below it (it glides with it);
 *   2. a narrow chip in the side margin the crane is in (or, while it crosses
 *      the Sheet's columns, the margin it is flying to): below, above or
 *      level with the crane;
 *   3. the 176 px chip in the strip above or below the Sheet;
 *   4. a narrow chip in the other margin.
 * At 320 px the 176 px chip always spans some of the Sheet's columns and the
 * strips beside it are 30 px, so it is usually the margin (r2-22: the chip
 * used to drop onto the middle of the Sheet). Where nothing fits (below
 * 280 px) it takes the box that covers least of the Sheet's edge. Heights
 * come from a word-wrap estimate at 11/600 (`CHIP_TEXT.px` a grapheme, 14 px
 * lines).
 */
export function craneHintBox(c, g, hint = CRANE_HINT) {
  if (!c || !g) return null;
  const [left, top] = craneBox(c, g);
  const crane = [left, top, CRANE.w, CRANE.h];
  const sheet = [g.sx, g.sy, g.sheet, g.sheet];
  const fieldTop = TOP_BAND;
  const fieldBot = g.h - BOTTOM_BAND;
  const hit = (a, b) => Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]) > 0 && Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]) > 0;
  const fits = (b) => b.w >= CHIP_TEXT.minW && b.lines <= CHIP_TEXT.maxLines && b.x >= 0 && b.x + b.w <= g.w && b.y >= fieldTop && b.y + b.h <= fieldBot &&
    !hit([b.x, b.y, b.w, b.h], sheet) && !hit([b.x, b.y, b.w, b.h], crane);
  const sized = (x, w) => {
    const lines = chipLines(hint, w - 2 * CHIP_TEXT.padX);
    return { x: r1(x), w: r1(w), lines, h: lines * CHIP_TEXT.line + CHIP_TEXT.padY };
  };
  const out = [];
  // 1. The wide chip, centred over the crane (it glides with it).
  const ww = Math.min(CRANE_CHIP.w, g.w - 8);
  const wide = sized(Math.max(4, Math.min(g.w - ww - 4, left + CRANE.w / 2 - ww / 2)), ww);
  out.push({ ...wide, y: top - wide.h - 4, follow: true }, { ...wide, y: top + CRANE.h + 4, follow: true });
  // 2. The crane's side margin, 4. the other one.
  const margins = {
    left: sized(4, g.sx - 8),
    right: sized(g.sx + g.sheet + 4, g.w - g.sx - g.sheet - 8),
  };
  const mid = left + CRANE.w / 2;
  const heading = num(c.x1, num(c.x)) - num(c.x);
  const side = mid < g.sx ? "left" : mid > g.sx + g.sheet ? "right" : heading > 0 ? "right" : heading < 0 ? "left" : mid < g.sx + g.sheet / 2 ? "left" : "right";
  const around = (m) => [top + CRANE.h + 4, top - m.h - 4, Math.max(fieldTop, Math.min(fieldBot - m.h, top + CRANE.h / 2 - m.h / 2))].map((y) => ({ ...m, y, follow: false }));
  out.push(...around(margins[side]));
  // 3. The strips under and over the Sheet, the wide chip as close as it gets.
  const strip = sized(Math.max(4, Math.min(g.w - ww - 4, left + CRANE.w / 2 - ww / 2)), ww);
  const below = top >= g.sy + g.sheet / 2;
  const under = { ...strip, y: g.sy + g.sheet + Math.max(0, Math.floor((fieldBot - g.sy - g.sheet - strip.h) / 2)), follow: false };
  const over = { ...strip, y: g.sy - strip.h - Math.max(0, Math.floor((g.sy - fieldTop - strip.h) / 2)), follow: false };
  out.push(...(below ? [under, over] : [over, under]));
  out.push(...around(margins[side === "left" ? "right" : "left"]));
  for (const b of out) {
    b.y = r1(b.y);
    if (fits(b)) return b;
  }
  // Nothing fits (a narrow mat: 56 px margins, 14 px strips): each box pulled
  // into the field, the one that covers the least of the Sheet (never the crane).
  const area = (a, b) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  let best = null;
  let bestCost = Infinity;
  for (const b of out) {
    if (b.w < CHIP_TEXT.minW || b.lines > CHIP_TEXT.maxLines || b.h > fieldBot - fieldTop) continue;
    const y = r1(Math.max(fieldTop, Math.min(fieldBot - b.h, b.y)));
    const box = [b.x, y, b.w, b.h];
    const cost = area(box, sheet) + 4 * area(box, crane);
    if (cost < bestCost) {
      best = { ...b, y };
      bestCost = cost;
    }
  }
  return best || { ...wide, y: r1(Math.max(fieldTop, Math.min(fieldBot - wide.h, top + CRANE.h + 4))), follow: true };
}

/** Lines a greedy word wrap of `s` takes in `px` px at 11/600 (an over-estimate). */
function chipLines(s, px) {
  const per = Math.max(1, Math.floor(px / CHIP_TEXT.px));
  let lines = 1;
  let used = 0;
  for (const word of String(s).split(" ")) {
    const n = Array.from(word).length;
    if (used === 0) used = n;
    else if (used + 1 + n <= per) used += 1 + n;
    else {
      lines++;
      used = n;
    }
    while (used > per) {
      lines++;
      used -= per;
    }
  }
  return lines;
}

/**
 * The first gilded crane's one-time line (§3.2, `vm.mat.crane.hint` while
 * `ui.hints.crane` is unset): a T.popover chip beside the crane, never over
 * the Sheet, the crane or the bands (`craneHintBox`). No handlers: clicks
 * reach the mat and the crane as before.
 */
function craneHint(c, g, T, calm) {
  if (!c || typeof c.hint !== "string" || !c.hint) return null;
  const hint = clip(c.hint, MAT_CLIP.craneHint);
  const b = craneHintBox(c, g, hint);
  const el = div()
    .id("cw-crane-hint")
    .absolute()
    .left(b.x)
    .top(b.y)
    .w(b.w)
    .h(b.h)
    .px(CHIP_TEXT.padX)
    .flex()
    .items_center()
    .justify_center()
    .rounded(8)
    .bg(T.popover)
    .border(1)
    .border_color(T.border)
    // fixed copy: wraps instead of cutting (§13.4), on 14 px lines the box was sized for
    .child(text(hint, { size: 11, weight: 600, color: T.foreground }).whitespace_normal().line_height("127%").text_center());
  // It glides with the crane only while it sits over or under it.
  if (b.follow && !calm && num(c.x1, c.x) !== num(c.x)) el.transition("left", { duration: 1000, easing: "linear" });
  return el;
}

function crane(c, g, S, click, calm, zoom) {
  const [left, top] = craneBox(c, g);
  const bob = !calm && (c.bob === undefined ? true : Boolean(c.bob));
  const art = div().id("cw-crane-art").absolute().left(4).top(4).w(40).h(28);
  for (const [part, color] of [["outline", S.goldInk], ["body", S.gold], ["shade", S.goldShade]]) {
    art.child(svg(spritePath("scene", `crane-gilded-${part}`)).absolute().top(0).left(0).w(40).h(28).text_color(color));
  }
  if (bob) art.loop("top", { from: 4, to: 4 - 4 * zoom, period: 1300 });
  const el = div()
    .id("cw-crane")
    .absolute()
    .left(left)
    .top(top)
    .w(CRANE.w)
    .h(CRANE.h)
    .cursor_pointer()
    .tooltip("A gilded crane! Click it before it flies off.")
    .on_click((e, cx) => {
      cx.stop_propagation();
      return click("crane", c.id, { x: r1(left + CRANE.w / 2), y: r1(top) }, cx);
    })
    .child(art);
  // Glide (§13.5, §17 R2 fallback): the vm moves x each data tick; ease
  // linearly over that tick. Calm: it sits still.
  if (!calm && num(c.x1, c.x) !== num(c.x)) el.transition("left", { duration: 1000, easing: "linear" });
  return el;
}

function boat(b, g, S, click, calm) {
  const left = r1(lin(num(b.x, BOAT.x0), BOAT.x0, BOAT.x1, BOAT.x0, g.w - BOAT.w - BOAT.x0));
  const top = g.h - BOTTOM_BAND;
  const el = div()
    .id("cw-boat")
    .absolute()
    .left(Math.max(0, left))
    .top(top)
    .w(BOAT.w)
    .h(BOAT.h)
    .cursor_pointer()
    .tooltip("The Paper Boat: catch it for a Tailwind")
    .on_click((e, cx) => {
      cx.stop_propagation();
      return click("boat", b.id, { x: r1(left + BOAT.w / 2), y: top }, cx);
    })
    .child(svg(spritePath("scene", "boat-hull")).absolute().left(4).top(2).w(40).h(28).text_color(S.sheet))
    .child(svg(spritePath("scene", "boat-sail")).absolute().left(4).top(2).w(40).h(28).text_color(S.sheetShade));
  if (!calm && num(b.x1, b.x) !== num(b.x)) el.transition("left", { duration: 1000, easing: "linear" });
  return el;
}

const chipWidth = (name) => 8 + 12 + 4 + Math.ceil(name.length * 6.5) + 8 + 2;

function topBand(vm, g, T, S, openHelper, calm) {
  const mat = vm.mat || {};
  const chips = Array.isArray(mat.chips) ? mat.chips : [];
  const band = h_flex().id("cw-mat-top").absolute().left(0).top(0).w(g.w).h(TOP_BAND).px(6).gap(4).overflow_hidden();
  if (chips.length) {
    let room = g.w - 12 - 28;
    let shown = 0;
    for (const c of chips) {
      if (shown >= 4) break;
      const name = clip(String(c.name ?? ""), MAT_CLIP.chip);
      const cw = chipWidth(name);
      if (shown > 0 && cw > room) break;
      room -= cw + 4;
      const id = c.helperId;
      band.child(chip(`cw-chip-${id}`, name, {
        status: "blocked",
        border: S.sheet,
        pulse: Boolean(c.pulse) && !calm,
        tooltip: c.tooltip ? clip(String(c.tooltip), 140) : `${name} needs you: open its pane`,
        stop: true,
        onClick: (e, cx) => openHelper(id, cx),
      }, T, S));
      shown++;
    }
    const more = num(mat.more, 0) + (chips.length - shown);
    if (more > 0) band.child(text(clip(`+${more}`, MAT_CLIP.more), { size: 11, weight: 600, color: S.onMat }));
    return band;
  }
  // Nobody waiting: the shelf, the last 12 figures folded (16 px each).
  const shelf = Array.isArray(mat.shelf) ? mat.shelf.slice(-12) : [];
  const fit = Math.max(0, Math.floor((g.w - 12) / 18));
  for (const sp of shelf.slice(-fit)) {
    try {
      band.child(speciesSprite(sp, 16, S.sheet, { surface: S.mat }));
    } catch {
      // An unknown species from a newer save draws nothing rather than failing the render.
    }
  }
  return band;
}

function envelope(env, S, open, calm, zoom) {
  const id = env.helperId;
  const type = ENV_TYPES.includes(env.type) ? env.type : "bundle";
  const label = stackLabel(env);
  const long = label !== null && label.length > 2;
  const art = div()
    .id(`cw-env-${id}-art`)
    .absolute()
    .left(0)
    .top(4)
    .w(28)
    .h(20)
    .child(svg(spritePath("scene", "envelope-body")).absolute().top(0).left(0).w(28).h(20).text_color(S.sheet))
    .child(svg(spritePath("scene", "envelope-flap")).absolute().top(0).left(0).w(28).h(20).text_color(S.sheetShade))
    // A longer count ("×2.8", "×12") takes the envelope's lower half under a
    // smaller seal; a short one ("×3") sits left of the seal as before.
    .child(long
      ? svg(spritePath("seal", type)).absolute().top(0).left(17).w(10).h(10).text_color(S.ink)
      : svg(spritePath("seal", type)).absolute().top(1).left(15).w(12).h(12).text_color(S.ink));
  if (label !== null) {
    art.child(long
      ? div().absolute().left(0).top(9).w(28).text_center().text_size(11).line_height("127%").font_weight(600).text_color(S.ink).child(label)
      : div().absolute().left(2).top(6).text_size(11).font_weight(600).text_color(S.ink).child(label));
  }
  if (env.bob && !calm) art.loop("top", { from: 4, to: 4 - 2 * zoom, period: 1600 });
  const word = type === "bundle" ? "Bundle" : type === "rush" ? "Rush" : type === "storm" ? "Confetti" : "Chorus";
  return div()
    .id(`cw-env-${id}`)
    .relative()
    .flex_none()
    .w(28)
    .h(28)
    .cursor_pointer()
    .tooltip(env.tooltip ? clip(String(env.tooltip), 140) : `${word} envelope · click to open`)
    .on_click((e, cx) => {
      cx.stop_propagation();
      return open(id, cx);
    })
    .child(art);
}

/**
 * The tray stack count an envelope shows (DESIGN §3.2 item 11: ×n when
 * n ≥ 2): the vm's `label` ("×2.8"; units are 64ths of a share and a
 * fledgling's finish adds half a one, review r5-15), else built from
 * `units` the same way (one decimal below 10); null below 2.
 */
export function stackLabel(env) {
  if (env && typeof env.label === "string" && env.label) return clip(env.label, MAT_CLIP.label);
  const u = num(env && env.units, 1);
  if (!(u >= 2)) return null;
  return clip(`×${u >= 9.95 ? Math.round(u) : Math.round(u * 10) / 10}`, MAT_CLIP.label);
}

const textW = (s) => Math.ceil(String(s).length * 6.5);

function bottomBand(vm, g, T, S, open, calm, zoom) {
  const tray = vm.tray || {};
  const envs = Array.isArray(tray.envelopes) ? tray.envelopes : [];
  const streak = vm.streak || {};
  const inStep = Boolean(streak.inStep);
  const label = clip(String(streak.label ?? ""), MAT_CLIP.label);
  const avail = g.w - 16;
  const labelW = inStep ? 12 + 4 + textW("In step") : textW(label);
  const minTrack = 40;
  const moreW = 26;
  const room = avail - (minTrack + 6 + labelW) - 8 - moreW;
  const cap = Math.max(1, Math.min(6, Math.floor((room + 2) / 30)));
  const drawn = envs.slice(0, cap);
  const more = num(tray.more, 0) + (envs.length - drawn.length);
  const trayRow = h_flex().id("cw-tray").gap(2).flex_none();
  for (const env of drawn) trayRow.child(envelope(env, S, open, calm, zoom));
  if (more > 0) trayRow.child(text(clip(`+${more}`, MAT_CLIP.more), { size: 11, weight: 600, color: S.onMat }));
  const used = drawn.length * 30 + (more > 0 ? moreW : 0);
  const track = Math.max(minTrack, Math.min(96, avail - used - 8 - 6 - labelW));
  const meter = h_flex()
    .id("cw-streak")
    .gap(6)
    .flex_none()
    .tooltip(clip(
      (inStep ? `In step ${label}: your helpers work faster` : `Rhythm ${label}: keep clicking in time`) +
        // the banked afterglow (review r5-14; the footer chip shows it too)
        (!inStep && typeof streak.afterglowText === "string" && streak.afterglowText ? ` · ${streak.afterglowText}` : ""),
      MAT_CLIP.hint + 24,
    ))
    .child(progressBar("cw-streak-bar", num(streak.fill, 0), { width: track, height: 6, track: S.grid, fill: S.node, ms: 150, calm }, T, S));
  if (inStep) {
    meter.child(h_flex().gap(4).child(icon("step", 12, S.onMat)).child(text("In step", { size: 11, weight: 600, color: S.onMat })));
  } else {
    meter.child(text(label, { size: 11, weight: 600, color: S.onMat }));
  }
  return h_flex()
    .id("cw-mat-bottom")
    .absolute()
    .left(0)
    .top(g.h - BOTTOM_BAND)
    .w(g.w)
    .h(BOTTOM_BAND)
    .px(8)
    .gap(8)
    .justify_between()
    .child(trayRow)
    .child(meter);
}

function firstRunHint(vm, g, T, calm, zoom) {
  const sheet = vm.sheet || {};
  if (!sheet.firstRunHint) return null;
  const bob = !calm && (sheet.hintBob === undefined ? true : Boolean(sheet.hintBob));
  const w = 168;
  const top = Math.max(2, g.sy - 34);
  const tri = PathBuilder.fill().add_polygon([["0%", "0%"], ["100%", "0%"], ["50%", "100%"]]).build();
  const arrow = paint(tri, Background.solid(validateBackgroundColor(T.popover)));
  const body = div()
    .id("cw-hint-bob")
    .absolute()
    .left(0)
    .top(0)
    .w(w)
    .h(32)
    .child(
      h_flex()
        .h(22)
        .w(w)
        .px(8)
        .justify_center()
        .rounded(11)
        .bg(T.popover)
        .border(1)
        .border_color(T.border)
        .child(text(clip(HINT_TEXT, MAT_CLIP.hint), { size: 11, weight: 600, color: T.foreground })),
    );
  if (arrow) body.child(arrow.absolute().left(w / 2 - 5).top(22).w(10).h(8));
  if (bob) body.loop("top", { from: 0, to: 4 * zoom, period: 900 });
  const hint = div().id("cw-hint").absolute().left(Math.round(g.sx + g.sheet / 2 - w / 2)).top(top).w(w).h(32).child(body);
  return hint;
}

function pops(vm, ui, S, calm) {
  if (calm || (vm.settings && vm.settings.pops === false)) return [];
  const list = ui && Array.isArray(ui.pops) ? ui.pops.slice(-5) : [];
  return list.map((p) => pop(`cw-pop-${p.id}`, clip(String(p.label ?? ""), MAT_CLIP.pop), num(p.x), num(p.y), Boolean(p.risen), undefined, S));
}

/**
 * The mat (DESIGN §3.2): a `div#cw-mat` sized by `matGeometry`, holding every
 * scene layer in paint order. Pure (B11).
 */
export function renderMat(vm, ui, ctx) {
  const T = ctx.T;
  const S = ctx.S;
  const zoom = num(ctx.zoom, 1) || 1;
  const calm = isCalm(vm, ctx);
  const g = matGeometry(vm, ctx);
  const click = handler(ctx, "click");
  const open = handler(ctx, "open");
  const openHelper = handler(ctx, "openHelper");
  const mat = vm.mat || {};
  const root = div().id("cw-mat").relative().flex_none().w(g.w).h(g.h).rounded(10).overflow_hidden().bg(S.mat);
  for (const el of background(g, S, calm, zoom, Boolean(mat.storm))) root.child(el);
  const line = creaseLine(mat.creaseLine, g, S);
  if (line) root.child(line);
  for (const el of theSheet(vm, g, S, click, zoom)) root.child(el);
  for (const n of Array.isArray(mat.nodes) ? mat.nodes : []) root.child(node(n, g, S, click, calm));
  for (const s of Array.isArray(mat.scraps) ? mat.scraps : []) root.child(scrap(s, g, S, click));
  if (mat.ream) root.child(ream(mat.ream, g, S, click));
  if (mat.crane) root.child(crane(mat.crane, g, S, click, calm, zoom));
  if (mat.boat) root.child(boat(mat.boat, g, S, click, calm));
  root.child(topBand(vm, g, T, S, openHelper, calm));
  root.child(bottomBand(vm, g, T, S, open, calm, zoom));
  for (const p of pops(vm, ui, S, calm)) root.child(p);
  const hint = firstRunHint(vm, g, T, calm, zoom);
  if (hint) root.child(hint);
  const callout = craneHint(mat.crane, g, T, calm);
  if (callout) root.child(callout);
  return root;
}

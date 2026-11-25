// Flock tab, the helper roster (DESIGN §3.3, §5.2, §5.5, §13.5):
// `renderFlock(vm, ui, ctx)` (ARCHITECTURE B11). Returns one element sized to
// its content at full width (8 px side padding); the panel wraps it in the
// scrolling `#cw-content`.
//
// Top to bottom: the detail card of the selected tile, the header line
// ("Flock 30 · 9 working · bench pace 47 %" and the legend "?"), the legend
// when asked for, the status groups (fixed order, foldable; the "all" group of
// workspace order has no header), Elsewhere, the Album; or the empty state.
// Tiles are 52×64 (dense 40×44) on T.raised with the status badge, the
// envelope marker, fledgling pips, the rest bar and the dashed needs-you
// border. A group with more than 80 tiles open draws as a v_virtual_list of
// 28 px rows with one `on_item_click` on the list (no handlers in the rows) and
// a definite height (§5.5 item 8); so do the heaviest groups while the open
// tile grids together would weigh more than TILE_BUDGET tiles (r3-16).

import { div, svg } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, ScrollHandle } from "gpui-base";
import { clip, clipCells, crowd } from "../engine/index.js";
import { statusColor, statusDisc, contrast, hex6, isHex } from "./color.js";
import { ASSETS, FACETS, pipPath, speciesSprite, statusGlyphPath, spritePath, sprite } from "./art.js";
import { HUE_NAMES, hueOf, pickHues } from "./palette.js";
import { button, glyph, hoverOn, iconButton, sectionHeader, text } from "./widgets.js";
import { isCalm } from "./mat.js";

/** Grapheme limits for every string this module draws (tested). */
export const FLOCK_CLIP = Object.freeze({
  name: 8, group: 20, rowName: 16, longName: 20, title: 60, where: 32, line: 60, rest: 48, head: 48, count: 5, tooltip: 140, album: 12,
});

/** Tile geometry (DESIGN §3.3). */
export const TILE = Object.freeze({
  normal: Object.freeze({ w: 52, h: 64, gap: 6, glyph: 28, badge: 18, badgeGlyph: 12, env: 14, envGlyph: 11, envHit: 28, pip: 6, rest: 40 }),
  dense: Object.freeze({ w: 40, h: 44, gap: 4, glyph: 22, badge: 16, badgeGlyph: 12, env: 12, envGlyph: 11, envHit: 24, pip: 4, rest: 28 }),
});

/** A group with more open tiles than this draws as a virtual list (§5.5 item 8). */
export const VIRTUAL_ABOVE = 80;

/**
 * The most tiles the open groups draw as tile grids in one render, all groups
 * together (r3-16; a tile weighs 1, more with fledgling pips and a needs-you
 * flag, `tileUnits`): past it the heaviest groups switch to virtual lists,
 * needs-you last, until the rest fit. A per-group switch alone let four
 * groups of 79 draw 316 tiles a frame, past the 50 ms render budget.
 */
export const TILE_BUDGET = 80;

/** Virtual list row height and the most rows shown before it scrolls. */
export const VLIST = Object.freeze({ row: 28, rows: 10 });

/** Groups and sections folded by default when `ui.folded` says nothing. */
const FOLDED_BY_DEFAULT = Object.freeze({ elsewhere: true, album: true, legend: true });

const STATUS_ORDER = Object.freeze(["working", "blocked", "done", "idle"]);

const LEGEND = Object.freeze([
  { status: "working", shape: "arc", text: "Working: folding for you" },
  { status: "blocked", shape: "pennant", text: "Needs you: click to open its pane" },
  { status: "done", shape: "check", text: "Finished: done while you were not looking" },
  { status: "idle", shape: "crescent", text: "Resting: storing a boost" },
  { status: "envelope", shape: "envelope marker", text: "A reward is waiting" },
]);

const EMPTY_SPECIES = Object.freeze(["crane", "fox", "koi"]);

function handler(ctx, name) {
  const h = ctx && ctx.handlers;
  const f = h && typeof h[name] === "function" ? h[name] : null;
  return (...args) => (f ? f(...args) : undefined);
}

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const has = (o, k) => o !== null && typeof o === "object" && Object.hasOwn(o, k);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function speciesOf(s) {
  return typeof s === "string" && ASSETS.folk.includes(s) ? s : "crane";
}

function statusOf(s) {
  return STATUS_ORDER.includes(s) ? s : "idle";
}

/**
 * Whether a Flock section is folded: a pending `ui.scrollTo` unfolds its
 * group (the glue also stores `folded[key] = false` and clears `scrollTo`
 * once it has scrolled, so it never pins the group open: r2-19), then
 * `ui.folded[key]` decides when set, else the default (the vm's `folded` for
 * status groups; Elsewhere, Album and the legend start folded; `owned:<seg>`
 * Shop folds too). The glue's `toggleGroup(key)` should store
 * `!isFolded(vm, ui, key)` so the first click always flips what is drawn.
 */
export function isFolded(vm, ui, key) {
  if (ui && ui.scrollTo === key) return false;
  const f = ui && ui.folded;
  if (f && typeof f === "object" && Object.hasOwn(f, key)) return Boolean(f[key]);
  if (typeof key === "string" && key.startsWith("owned:")) return true;
  if (key === "legend") return !(vm && vm.helpers && vm.helpers.legend === true);
  if (Object.hasOwn(FOLDED_BY_DEFAULT, key)) return FOLDED_BY_DEFAULT[key];
  const groups = vm && vm.helpers && Array.isArray(vm.helpers.groups) ? vm.helpers.groups : [];
  const g = groups.find((x) => x && x.key === key);
  return Boolean(g && g.folded);
}

/** Every tile of the vm (groups, then Elsewhere). */
export function allTiles(vm) {
  const h = (vm && vm.helpers) || {};
  const out = [];
  for (const g of Array.isArray(h.groups) ? h.groups : []) for (const t of Array.isArray(g.tiles) ? g.tiles : []) out.push(t);
  for (const t of Array.isArray(h.elsewhere) ? h.elsewhere : []) out.push(t);
  return out;
}

/** The selected tile (`ui.selected`), or null. */
export function selectedTile(vm, ui) {
  const id = ui && ui.selected;
  if (typeof id !== "string" || !id) return null;
  return allTiles(vm).find((t) => t && t.helperId === id) || null;
}

/** "Flock 30 · 9 working · bench pace 47 %" (the vm's `pace` when present). */
export function flockHeadline(vm) {
  const h = (vm && vm.helpers) || {};
  const groups = Array.isArray(h.groups) ? h.groups : [];
  let total = 0;
  let working = 0;
  for (const g of groups) {
    const tiles = Array.isArray(g.tiles) ? g.tiles : [];
    total += Math.max(num(g.count, tiles.length), 0);
    if (g.key === "working") working += Math.max(num(g.count, tiles.length), 0);
    else if (g.key === "all") working += tiles.filter((t) => t && t.status === "working").length;
  }
  let pace = typeof h.pace === "string" ? h.pace : null;
  if (pace === null && working > 0) pace = `${working} working · bench pace ${Math.round(crowd(working) * 100)} %`;
  return pace ? `Flock ${total} · ${pace}` : `Flock ${total}`;
}

// ---------------------------------------------------------------------------
// Tiles

function hues(ctx) {
  return Array.isArray(ctx.hues) && ctx.hues.length === 8 ? ctx.hues : pickHues(Boolean(ctx.dark));
}

/**
 * Colours and handlers every tile of one render shares, computed once (the
 * contrast guard is not cheap in QuickJS and 64 tiles would repeat it).
 */
export function tileLook(ctx) {
  const T = ctx.T;
  const S = ctx.S;
  // The badge disc: T.popover, or (win98) a surface where needs-you keeps its red (r3-21).
  const disc = statusDisc(T);
  const onPopover = Object.create(null);
  for (const st of STATUS_ORDER) onPopover[st] = statusColor(T, st, disc);
  return {
    chromeHover: hoverOn(T, T.chrome),
    blockedOnChrome: statusColor(T, "blocked", "chrome"),
    T,
    S,
    hues: hues(ctx),
    hover: hoverOn(T, T.raised),
    blocked: statusColor(T, "blocked", "raised"),
    // The envelope marker's cream disc vanishes on a light tile: give it a real edge there.
    envRing: isHex(S.sheet) && isHex(T.raised) && contrast(S.sheet, hex6(T.raised)) < 1.5 ? T.muted : T.border,
    disc,
    // The badge glyph colours, guarded for `disc` (the name predates the disc choice).
    onPopover,
    select: handler(ctx, "select"),
    open: handler(ctx, "open"),
    openHelper: handler(ctx, "openHelper"),
  };
}

/** Extra px around a needs-you pip's hit area on each side (the pip itself is 6 or 4 px). */
export const PIP_HIT = 4;

/**
 * The fledgling pips. A needs-you pip is the fledgling's own needs-you mark
 * (§5.2): clicking it opens that sub-agent (`openHelper(kidId)`: pane.focus,
 * or terminal.peek for one without a pane, §5.6) and stops the click there.
 */
function pipsRow(pips, kids, g, hue, look) {
  const T = look.T;
  const row = h_flex().absolute().left(4).bottom(g === TILE.dense ? 3 : 5).gap(2);
  const n = Math.min(4, pips.length);
  for (let i = 0; i < n; i++) {
    const p = pips[i];
    const st = p === "blocked" || p === "error" ? "blocked" : p === "working" ? "working" : "idle";
    const mark = svg(pipPath(st)).w(g.pip).h(g.pip).flex_none().text_color(st === "blocked" ? look.blocked : hue);
    const kid = kids[i];
    const kidId = kid && typeof kid.helperId === "string" ? kid.helperId : "";
    if (st !== "blocked" || !kidId) {
      row.child(mark);
      continue;
    }
    row.child(
      div()
        .relative()
        .flex_none()
        .w(g.pip)
        .h(g.pip)
        .child(mark)
        .child(
          div()
            .id(`cw-flock-kid-${kidId}`)
            .absolute()
            .left(-PIP_HIT)
            .top(-PIP_HIT)
            .w(g.pip + 2 * PIP_HIT)
            .h(g.pip + 2 * PIP_HIT)
            .cursor_pointer()
            .tooltip(clip(str(kid.tooltip) || "A fledgling needs you: click to open it", FLOCK_CLIP.tooltip))
            .on_click((e, cx) => {
              if (cx && typeof cx.stop_propagation === "function") cx.stop_propagation();
              look.openHelper(kidId, cx);
            }),
        ),
    );
  }
  if (pips.length > 4) {
    const more = text(`+${clip(String(pips.length - 4), FLOCK_CLIP.count)}`, { size: 11, color: T.muted }, T).line_height("100%");
    // Waiting fledglings come first (vm order), so one past the 4th pip only
    // happens with 5+ waiting: "+N" then opens the first of those.
    let waiting = null;
    for (let i = 4; i < pips.length && !waiting; i++) {
      const kid = kids[i];
      if ((pips[i] === "blocked" || pips[i] === "error") && kid && typeof kid.helperId === "string" && kid.helperId) waiting = kid;
    }
    if (!waiting) row.child(more);
    else {
      const kidId = waiting.helperId;
      row.child(
        div()
          .id(`cw-flock-kid-more-${kidId}`)
          .flex_none()
          .cursor_pointer()
          .tooltip(clip(str(waiting.tooltip) || "A fledgling needs you: click to open it", FLOCK_CLIP.tooltip))
          .on_click((e, cx) => {
            if (cx && typeof cx.stop_propagation === "function") cx.stop_propagation();
            look.openHelper(kidId, cx);
          })
          .child(more),
      );
    }
  }
  return row;
}

/**
 * A tile's fledglings that need you, in vm order (waiting ones come first):
 * the kid objects, or null for a waiting pip with no kid behind it (tested).
 */
export function waitingKids(tile) {
  const pips = tile && Array.isArray(tile.pips) ? tile.pips : [];
  const kids = tile && Array.isArray(tile.kids) ? tile.kids : [];
  const out = [];
  const n = Math.max(pips.length, kids.length);
  for (let i = 0; i < n; i++) {
    const k = kids[i] && typeof kids[i] === "object" ? kids[i] : null;
    const st = k && typeof k.status === "string" ? k.status : pips[i];
    if (st === "blocked" || st === "error") out.push(k && typeof k.helperId === "string" && k.helperId ? k : null);
  }
  return out;
}

/** The first waiting fledgling with an id (the one a click opens), or null. */
function firstWaiting(waiting) {
  for (const k of waiting) if (k) return k;
  return null;
}

/**
 * The parent tile's needs-you flag for its waiting fledglings (r3-17): a
 * badge-size disc at the top left with the needs-you pennant and a ring in
 * the needs-you colour, the same size as the status badge at every density
 * (a 4 px pip alone was lost among 64 dense tiles). Clicking it opens the
 * first waiting fledgling (pane.focus, or terminal.peek without a pane,
 * §5.6) and stops there; the tooltip counts them.
 */
function kidFlag(id, waiting, g, look) {
  const T = look.T;
  const kid = firstWaiting(waiting);
  const n = waiting.length;
  const tip = n === 1
    ? str(kid && kid.tooltip) || "A fledgling needs you: click to open it"
    : `${n} fledglings need you: click to open ${kid ? `${str(kid.name) || "the first"}` : "the first"}`;
  const el = h_flex()
    .id(`cw-flock-kidflag-${id}`)
    .absolute()
    .top(-4)
    .left(-4)
    .w(g.badge)
    .h(g.badge)
    .rounded(g.badge / 2)
    .justify_center()
    .bg(look.disc || T.popover)
    .border(1)
    .border_color(look.blocked)
    .tooltip(clip(tip, FLOCK_CLIP.tooltip))
    .child(svg(statusGlyphPath("blocked")).w(g.badgeGlyph).h(g.badgeGlyph).text_color(look.onPopover.blocked));
  if (kid) {
    const kidId = kid.helperId;
    el.cursor_pointer().on_click((e, cx) => {
      if (cx && typeof cx.stop_propagation === "function") cx.stop_propagation();
      look.openHelper(kidId, cx);
    });
  }
  return el;
}

/**
 * One tile (§3.3). `opts`: `{ dense, selected, calm, inStep, elsewhere,
 * look }` (`look` from `tileLook(ctx)`; computed here when absent).
 */
export function tileElement(tile, opts, ctx) {
  const look = opts.look || tileLook(ctx);
  const T = look.T;
  const g = opts.dense ? TILE.dense : TILE.normal;
  const id = str(tile.helperId);
  const status = statusOf(tile.status);
  const hue = hueOf(look.hues, tile.hue);
  const select = look.select;
  const open = look.open;
  const openHelper = look.openHelper;
  const selected = Boolean(opts.selected);
  const needsYou = tile.dashed === true || status === "blocked";

  const el = div()
    .id(`cw-flock-tile-${id}`)
    .relative()
    .flex_none()
    .w(g.w)
    .h(g.h)
    .rounded(8)
    .bg(selected ? look.hover : T.raised)
    .cursor_pointer()
    .hover((s) => s.bg(look.hover))
    .tooltip(clip(str(tile.tooltip) || `${str(tile.name)} · ${str(tile.statusWord)}`, FLOCK_CLIP.tooltip))
    // A needs-you tile is a needs-you mark: a click opens the agent (§5.6);
    // every other tile, and any tile another window sees, selects (its
    // detail card has "Open pane ›").
    .on_click((e, cx) => (needsYou && !opts.elsewhere ? openHelper(id, cx) : select(selected ? null : id, cx)));
  if (needsYou) el.border(2).border_dashed().border_color(look.blocked);
  else if (selected) el.border(2).border_color(T.accent);
  else el.border(1).border_color(T.border);

  // Content (glyph, name, pips, rest bar) at the tile's opacity; the badge and
  // the envelope marker stay opaque so the status shape always reads.
  // Each content child takes the tile's opacity (one call each instead of a
  // wrapper element: 64 tiles are rendered every frame).
  const opacity = Math.max(0.3, Math.min(1, num(tile.opacity, 1)));
  const fade = opacity < 1 ? (x) => x.opacity(opacity) : (x) => x;
  const sp = speciesOf(tile.species);
  const figure = FACETS === "alpha" ? svg(spritePath("folk", sp)).size(g.glyph).text_color(hue) : speciesSprite(sp, g.glyph, hue, { surface: T.raised });
  el.child(fade(figure.absolute().top(opts.dense ? 4 : 6).left((g.w - g.glyph) / 2 - 1)));
  if (!opts.dense) {
    el.child(
      fade(
        text(clip(str(tile.name), FLOCK_CLIP.name), { size: 11, color: T.foreground, truncate: true }, T)
          .absolute()
          .top(40)
          .left(3)
          .right(3)
          .text_center()
          .line_height("120%"),
      ),
    );
  }
  const pips = Array.isArray(tile.pips) ? tile.pips : [];
  if (pips.length) el.child(fade(pipsRow(pips, Array.isArray(tile.kids) ? tile.kids : [], g, hue, look)));
  const withEnvelope = tile.envelope === true && !opts.elsewhere;
  if (status === "idle" && typeof tile.rest === "number") {
    const k = Math.max(0, Math.min(1, tile.rest));
    const bar = restBar(g, withEnvelope);
    // The T.border track shows the bar's full extent, so a low store reads as
    // "a little of this" rather than a stray speck.
    el.child(fade(div().id(`cw-flock-rest-track-${id}`).absolute().bottom(1).left(bar.left).h(2).w(bar.w).rounded(1).bg(T.border)));
    el.child(
      fade(
        div()
          .id(`cw-flock-rest-${id}`)
          .absolute()
          .bottom(1)
          .left(bar.left)
          .h(2)
          .w(Math.round(bar.w * k * 10) / 10)
          .rounded(1)
          .bg(T.muted)
          .transition("width", opts.calm ? 150 : 600),
      ),
    );
  }

  // Status badge at the top right (−4, −4): a `look.disc` disc (T.popover in
  // every theme where needs-you reads there), 1 px T.border ring, the status
  // glyph guarded for that disc (widgets.glyph, inlined).
  const mark = svg(statusGlyphPath(status)).w(g.badgeGlyph).h(g.badgeGlyph).text_color(look.onPopover[status]);
  if (!opts.calm && tile.spin === true && status === "working") mark.spin(opts.inStep ? 600 : 1200);
  const badge = h_flex()
    .id(`cw-flock-badge-${id}`)
    .absolute()
    .top(-4)
    .right(-4)
    .w(g.badge)
    .h(g.badge)
    .rounded(g.badge / 2)
    .justify_center()
    .bg(look.disc || T.popover)
    .border(1)
    .border_color(T.border)
    .child(mark);
  if (!opts.calm && tile.pulse === true && status === "blocked") badge.loop("opacity", { from: 0.55, to: 1, period: 1200 });
  el.child(badge);

  // A waiting fledgling's needs-you flag (another window's helpers are not ours to open).
  if (pips.length && !opts.elsewhere) {
    const waiting = waitingKids(tile);
    if (waiting.length) el.child(kidFlag(id, waiting, g, look));
  }

  // Envelope marker at the bottom right: its own target (stops propagation).
  if (withEnvelope) {
    // The marker's centre sits near the corner (it pokes 2 px out, like the
    // badge at the top) so it never covers the name.
    const off = envOffset(g);
    el.child(
      h_flex()
        .id(`cw-flock-env-${id}`)
        .absolute()
        .right(off)
        .bottom(off)
        .w(g.envHit)
        .h(g.envHit)
        .justify_center()
        .cursor_pointer()
        .tooltip("Envelope ready: open it")
        .on_click((e, cx) => {
          if (cx && typeof cx.stop_propagation === "function") cx.stop_propagation();
          open(id, cx);
        })
        .child(
          h_flex()
            .w(g.env)
            .h(g.env)
            .rounded(g.env / 2)
            .justify_center()
            .bg(look.S.sheet)
            .border(1)
            .border_color(look.envRing || T.border)
            .child(svg(spritePath("status", "envelope")).w(g.envGlyph).h(g.envGlyph).text_color(look.S.ink)),
        ),
    );
  }
  return el;
}

/** The envelope marker's offset from the tile's bottom-right corner (px, negative: it pokes out). */
function envOffset(g) {
  return g === TILE.dense ? -4 : -9;
}

/**
 * The rest bar's box: `g.rest` px wide, centred; with an envelope marker it
 * stops 2 px short of the marker's disc so the disc never hides its end.
 */
export function restBar(g, withEnvelope) {
  const left = Math.round((g.w - g.rest) / 2);
  if (!withEnvelope) return { left, w: g.rest };
  const discLeft = g.w - envOffset(g) - g.envHit + (g.envHit - g.env) / 2;
  return { left, w: Math.max(4, Math.min(g.rest, discLeft - 2 - left)) };
}

function tileGrid(tiles, opts, ctx, key) {
  const g = opts.dense ? TILE.dense : TILE.normal;
  const grid = div().id(`cw-flock-grid-${key}`).w_full().flex().flex_row().flex_wrap().gap(g.gap).py(4);
  const one = { ...opts, selected: false };
  for (const t of tiles) {
    if (!t || typeof t.helperId !== "string") continue;
    one.selected = opts.selectedId === t.helperId;
    grid.child(tileElement(t, one, ctx));
  }
  return grid;
}

/** A 28 px row for the virtual list: no handlers, no ids, no loops (rows are rebuilt every frame). */
function listRow(t, look, selectedId, elsewhere) {
  const T = look.T;
  const status = statusOf(t.status);
  const hue = hueOf(look.hues, t.hue);
  const row = h_flex()
    .h(VLIST.row)
    .w_full()
    .px(6)
    .gap(8)
    .rounded(6)
    .bg(t.helperId === selectedId ? look.chromeHover : T.chrome)
    .child(
      h_flex()
        .w(18)
        .h(18)
        .flex_none()
        .rounded(9)
        .justify_center()
        .bg(look.disc || T.popover)
        .border(1)
        .border_color(T.border)
        .child(svg(statusGlyphPath(status)).w(12).h(12).text_color(look.onPopover[status])),
    )
    .child(div().opacity(Math.max(0.3, Math.min(1, num(t.opacity, 1)))).child(speciesSprite(speciesOf(t.species), 16, hue, { surface: T.chrome })))
    .child(text(clip(str(t.name), FLOCK_CLIP.rowName), { size: 11, weight: 600, color: T.foreground, truncate: true }, T).flex_1())
    .child(text(clip(str(t.statusWord), FLOCK_CLIP.rowName), { size: 11, color: T.muted }, T));
  // A waiting fledgling makes the row a needs-you mark too (r3-17): the row
  // click opens that fledgling (virtualGroup), so it takes the dashed edge
  // and a pennant with the count of waiting fledglings.
  const waiting = elsewhere ? [] : waitingKids(t);
  if (status === "blocked" || t.dashed === true || waiting.length) row.border(1).border_dashed().border_color(look.blockedOnChrome);
  if (waiting.length) {
    const flag = h_flex().flex_none().gap(2).child(svg(statusGlyphPath("blocked")).w(12).h(12).flex_none().text_color(look.blockedOnChrome));
    flag.child(text(clip(String(waiting.length), FLOCK_CLIP.count), { size: 11, weight: 600, color: T.foreground }, T));
    row.child(flag);
  }
  if (t.envelope === true) row.child(sprite(spritePath("status", "envelope"), 11, T.muted));
  return row;
}

/** The v_virtual_list for one big group (§5.5 item 8). */
function virtualGroup(key, tiles, look, selectedId) {
  const list = tiles.filter((t) => t && typeof t.helperId === "string");
  const select = look.select;
  const openHelper = look.openHelper;
  // Needs-you rows open their agent; a row whose fledgling waits opens that
  // fledgling (r3-17); Elsewhere rows (another window's) select.
  const opens = Object.create(null);
  const elsewhere = key === "elsewhere";
  if (!elsewhere) {
    for (const t of list) {
      if (t.dashed === true || statusOf(t.status) === "blocked") opens[t.helperId] = t.helperId;
      else {
        const kid = firstWaiting(waitingKids(t));
        if (kid) opens[t.helperId] = kid.helperId;
      }
    }
  }
  const rows = Math.min(list.length, VLIST.rows);
  return v_virtual_list(
    `cw-flock-vl-${key}`,
    list.length,
    VLIST.row,
    (i) => list[i].helperId,
    (range) => {
      const out = [];
      const end = Math.min(range && typeof range.end === "number" ? range.end : list.length, list.length);
      for (let i = Math.max(0, (range && range.start) || 0); i < end; i++) out.push(listRow(list[i], look, selectedId, elsewhere));
      return out;
    },
  )
    .w_full()
    .h(rows * VLIST.row)
    .on_item_click((helperId, cx) => {
      const target = Object.hasOwn(opens, helperId) ? opens[helperId] : null;
      return target ? openHelper(target, cx) : select(helperId === selectedId ? null : helperId, cx);
    });
}

// ---------------------------------------------------------------------------
// Sections

/**
 * Display cells that fit `px` at `size` px text (clipCells: emoji count 2).
 * 0.64 em per cell (0.68 for semibold) errs wide for proportional fonts, so
 * a string clipped to this never reaches gpui's own `.truncate()`, which
 * cuts by code point and can split an emoji (§13.4, A2 rule 8).
 */
export function cellsFor(px, size, bold) {
  return Math.max(4, Math.floor(Math.max(0, px) / (size * (bold ? 0.68 : 0.64))));
}

/**
 * The detail card's text column width in px for a panel `width` wide: the
 * content's 8 px sides and a scrollbar's 8 px, the card's 8 px padding and
 * 1 px border, the 40 px sprite, two 8 px gaps and the 28 px close button.
 */
export function detailTextPx(width) {
  return Math.max(120, num(width, 320) - 16 - 8 - 16 - 2 - 40 - 16 - 28);
}

function detailCard(t, vm, ctx) {
  const T = ctx.T;
  const colPx = detailTextPx(ctx.width);
  const fit = (s, size, bold, minus = 0) => clipCells(s, cellsFor(colPx - minus, size, bold));
  const id = str(t.helperId);
  const d = t.detail && typeof t.detail === "object" ? t.detail : {};
  const parts = str(t.tooltip).split(" · ");
  const title = typeof d.title === "string" ? d.title : parts.length >= 5 ? parts[3] : "";
  const where = typeof d.where === "string" ? d.where : parts.length >= 5 ? parts[parts.length - 1] : "";
  const line = typeof d.line === "string" ? d.line : str(t.statusWord);
  const rest = typeof d.rest === "string" ? d.rest : t.status === "idle" && typeof t.rest === "number" ? `rest ${Math.round(t.rest * 100)} %` : null;
  const hue = hueOf(hues(ctx), t.hue);
  const hueName = HUE_NAMES[((num(t.hue) % 8) + 8) % 8];
  const select = handler(ctx, "select");
  const openHelper = handler(ctx, "openHelper");
  const open = handler(ctx, "open");

  const info = v_flex()
    .flex_1()
    .min_w(0)
    .gap(1)
    .child(text(fit(clip(`${str(t.name)} · ${speciesOf(t.species)} · ${hueName}`, FLOCK_CLIP.head), 12, true), { size: 12, weight: 600, color: T.foreground, truncate: true }, T));
  const titleLine = [title, where].filter(Boolean).join("   ");
  if (titleLine) info.child(text(fit(clip(titleLine, FLOCK_CLIP.title), 11, false), { size: 11, color: T.muted, truncate: true }, T));
  info.child(
    h_flex()
      .gap(4)
      .min_w(0)
      .child(svg(statusGlyphPath(statusOf(t.status))).w(11).h(11).flex_none().text_color(statusColor(T, statusOf(t.status), "raised")))
      .child(text(fit(clip(line, FLOCK_CLIP.line), 11, false, 15), { size: 11, color: T.foreground, truncate: true }, T)),
  );
  if (rest) info.child(text(fit(clip(rest, FLOCK_CLIP.rest), 11, false), { size: 11, color: T.muted, truncate: true }, T));
  // Fledglings that need you, each with its own open button (§5.6: pane.focus,
  // or terminal.peek when it has no pane).
  const waitingKids = (Array.isArray(t.kids) ? t.kids : []).filter((k) => k && k.status === "blocked" && typeof k.helperId === "string");
  for (const k of waitingKids.slice(0, 3)) {
    info.child(
      button(`cw-flock-detail-kid-${k.helperId}`, fit(`Open ${clip(str(k.name), FLOCK_CLIP.name)} (fledgling) ›`, 11, false, 12), {
        variant: "ghost",
        h: 24,
        size: 11,
        px: 4,
        tooltip: clip(str(k.tooltip) || "A fledgling needs you", FLOCK_CLIP.tooltip),
        onClick: (e, cx) => openHelper(k.helperId, cx),
      }, T),
    );
  }

  const actions = h_flex().gap(6).pt(2);
  if (t.envelope === true) {
    actions.child(button("cw-flock-detail-env", "Open envelope", { h: 28, size: 11, px: 8, onClick: (e, cx) => open(id, cx) }, T));
  }
  actions.child(div().flex_1());
  actions.child(button("cw-flock-detail-open", "Open pane ›", { w: 88, h: 28, size: 11, px: 6, onClick: (e, cx) => openHelper(id, cx) }, T));
  info.child(actions);

  return h_flex()
    .id("cw-flock-detail")
    .w_full()
    .min_h(72)
    .items_start()
    .gap(8)
    .p(8)
    .rounded(8)
    .bg(T.raised)
    .border(1)
    .border_color(T.border)
    .child(div().flex_none().opacity(Math.max(0.5, Math.min(1, num(t.opacity, 1)))).child(speciesSprite(speciesOf(t.species), 40, hue, { surface: T.raised })))
    .child(info)
    .child(iconButton("cw-flock-detail-close", "close", "Close the card", { size: 12, surface: T.raised, onClick: (e, cx) => select(null, cx) }, T));
}

function legendRows(T, S) {
  const box = v_flex().id("cw-flock-legend").gap(2).py(4);
  for (const row of LEGEND) {
    const mark = row.status === "envelope"
      ? glyph("envelope", { size: 14, glyphSize: 11 }, T, S)
      : svg(statusGlyphPath(row.status)).w(12).h(12).flex_none().text_color(statusColor(T, row.status, "chrome"));
    box.child(
      h_flex()
        .min_h(20)
        .gap(8)
        .child(h_flex().w(16).flex_none().justify_center().child(mark))
        .child(text(row.shape, { size: 11, color: T.muted }, T).w(64).flex_none())
        // wraps (fixed copy, at most two lines at 240 px) instead of cutting the meaning off
        .child(text(row.text, { size: 11, color: T.foreground }, T).whitespace_normal().flex_1().min_w(0)),
    );
  }
  return box;
}

function emptyState(ctx) {
  const T = ctx.T;
  const w = Math.max(200, Math.min(304, num(ctx.width, 320) - 16));
  const figures = h_flex().gap(16).justify_center().opacity(0.6);
  for (const sp of EMPTY_SPECIES) figures.child(speciesSprite(sp, 40, T.dim, { surface: T.raised }));
  return v_flex()
    .id("cw-flock-empty")
    .w(w)
    .min_h(200)
    .p(14)
    .gap(8)
    .rounded(10)
    .bg(T.raised)
    .border(1)
    .border_color(T.border)
    .child(figures)
    .child(text("No paper folk yet.", { size: 13, weight: 600, color: T.foreground }, T))
    .child(
      text("Start a coding agent in any tab. Every agent herdr shows joins your workshop as a helper.", { size: 11, color: T.muted }, T)
        .whitespace_normal(),
    )
    .child(legendRows(T, ctx.S));
}

function albumSection(vm, ui, ctx) {
  const T = ctx.T;
  const album = Array.isArray(vm.helpers.album) ? vm.helpers.album : [];
  // The engine leaves the rows out while the section is folded (view opts
  // `album: false`); `albumCount` still counts them for the header.
  const total = Math.max(album.length, Math.round(num(vm.helpers.albumCount)));
  if (!total) return null;
  const folded = isFolded(vm, ui, "album");
  const toggleGroup = handler(ctx, "toggleGroup");
  const box = v_flex().id("cw-flock-album").w_full();
  box.child(
    sectionHeader("cw-flock-grp-album", "album", "Album", total, {
      folded,
      onToggle: (cx) => toggleGroup("album", cx),
    }, T).tooltip(clip(`${plural(total, "helper", "helpers")} who have left`, FLOCK_CLIP.tooltip)),
  );
  if (folded) return box;
  const row = (a) =>
    h_flex()
      .h(28)
      .w_full()
      .px(4)
      .gap(8)
      .child(speciesSprite(speciesOf(a.species), 16, T.dim, { surface: T.chrome }))
      .child(text(clip(str(a.name), FLOCK_CLIP.rowName), { size: 11, color: T.foreground, truncate: true }, T).flex_1())
      .child(text(clip(`left ${str(a.leftAgo)} ago`, FLOCK_CLIP.album + 9), { size: 11, color: T.muted }, T))
      .child(text(clip(`${str(a.folds)} folds`, FLOCK_CLIP.album + 6), { size: 11, color: T.muted }, T));
  if (album.length > VIRTUAL_ABOVE) {
    box.child(
      v_virtual_list("cw-flock-vl-album", album.length, 28, (i) => str(album[i].helperId) || `a${i}`, (range) => {
        const out = [];
        const end = Math.min(range && typeof range.end === "number" ? range.end : album.length, album.length);
        for (let i = Math.max(0, (range && range.start) || 0); i < end; i++) out.push(row(album[i]));
        return out;
      })
        .w_full()
        .h(VLIST.rows * 28),
    );
  } else {
    for (const a of album) box.child(row(a));
  }
  return box;
}

/**
 * The Flock's parts top to bottom, as keys: "detail" (the selected tile's
 * card), "empty", "head", "legend", one "group:<key>" per status group (and
 * "group:all" in workspace order), "group:elsewhere", "album". `flockParts`
 * builds exactly these, in this order, as the scroll area's direct children,
 * so `sectionIndex` is the index a ScrollHandle's scroll_to_item takes.
 */
export function flockKeys(vm, ui) {
  const h = (vm && vm.helpers) || {};
  const groups = Array.isArray(h.groups) ? h.groups : [];
  const elsewhere = Array.isArray(h.elsewhere) ? h.elsewhere : [];
  const out = [];
  if (selectedTile(vm, ui)) out.push("detail");
  const album = Math.max(Array.isArray(h.album) ? h.album.length : 0, Math.round(num(h.albumCount))) > 0;
  if (h.empty === true || (groups.length === 0 && elsewhere.length === 0)) {
    out.push("empty");
    if (album) out.push("album");
    return out;
  }
  out.push("head");
  if (!isFolded(vm, ui, "legend")) out.push("legend");
  for (const g of groups) out.push(`group:${str(g.key)}`);
  if (elsewhere.length) out.push("group:elsewhere");
  if (album) out.push("album");
  return out;
}

/**
 * Tiles' weight against TILE_BUDGET (measured in the QuickJS harness): a tile
 * 1, each fledgling pip it draws (at most 4) 1/8, a waiting one 1/4 (its own
 * click target), and the needs-you flag of a parent with one 3/8.
 */
function tileUnits(tiles) {
  let u = 0;
  for (const t of tiles) {
    u += 1;
    const pips = t && Array.isArray(t.pips) ? t.pips : null;
    if (!pips) continue;
    let waiting = false;
    for (let i = 0; i < pips.length; i++) {
      const w = pips[i] === "blocked" || pips[i] === "error";
      if (i < 4) u += w ? 0.25 : 0.125;
      if (w) waiting = true;
    }
    if (waiting) u += 0.375;
  }
  return u;
}

/** A group heavier than this (in tile units) is a virtual list even alone. */
export const GROUP_UNITS_MAX = 100;

/**
 * The open groups drawn as virtual lists, as a null-prototype set
 * `{ [key]: true }` ("needs", …, "all", "elsewhere"; tested). A group with
 * more than VIRTUAL_ABOVE tiles always is (§5.5 item 8), and so is one
 * heavier than GROUP_UNITS_MAX (80 tiles each with a waiting fledgling). Then,
 * while the open tile grids together weigh more than TILE_BUDGET, the
 * heaviest one left switches too, needs-you last and the later group on a
 * tie, until one grid is left (r3-16). Folded groups count nothing.
 */
export function virtualGroups(vm, ui) {
  const h = (vm && vm.helpers) || {};
  const groups = Array.isArray(h.groups) ? h.groups : [];
  const elsewhere = Array.isArray(h.elsewhere) ? h.elsewhere : [];
  const out = Object.create(null);
  const open = [];
  for (const g of groups) {
    const key = str(g && g.key);
    if (key !== "all" && isFolded(vm, ui, key)) continue;
    const tiles = Array.isArray(g && g.tiles) ? g.tiles : [];
    open.push({ key, n: tiles.length, u: tileUnits(tiles) });
  }
  if (elsewhere.length && !isFolded(vm, ui, "elsewhere")) open.push({ key: "elsewhere", n: elsewhere.length, u: tileUnits(elsewhere) });
  let total = 0;
  let grids = 0;
  for (const o of open) {
    if (o.n > VIRTUAL_ABOVE || o.u > GROUP_UNITS_MAX) out[o.key] = true;
    else {
      total += o.u;
      grids++;
    }
  }
  // The last grid left stays one (it is within both single-group limits).
  for (; total > TILE_BUDGET && grids > 1; grids--) {
    let big = null;
    for (const o of open) {
      if (out[o.key] === true) continue;
      // Needs-you keeps its tiles while any other group can still go.
      const later = big && (o.key === "needs") === (big.key === "needs") ? o.u >= big.u : big && big.key === "needs";
      if (!big || later) big = o;
    }
    if (!big) break;
    out[big.key] = true;
    total -= big.u;
  }
  return out;
}

/**
 * The Flock's ScrollHandle (the panel's `#cw-content` tracks it as ctx.scroll):
 * main.js creates it in init and hands it to the Session with `sectionIndex`.
 * Null where the host has none.
 */
export function newFlockScroll() {
  try {
    return ScrollHandle.new();
  } catch {
    return null;
  }
}

/** The scroll-area index of a group's section ("needs", …, "elsewhere", "album"), or -1. */
export function sectionIndex(vm, ui, key) {
  const k = str(key);
  return flockKeys(vm, ui).indexOf(k === "album" ? "album" : `group:${k}`);
}

/**
 * The Flock tab's parts as elements (`flockKeys` order), each `flex_none` so
 * the panel can lay them out directly in its scrolling `#cw-content`. Pure (B11).
 */
export function flockParts(vm, ui, ctx) {
  const T = ctx.T;
  const h = (vm && vm.helpers) || {};
  const groups = Array.isArray(h.groups) ? h.groups : [];
  const elsewhere = Array.isArray(h.elsewhere) ? h.elsewhere : [];
  const calm = isCalm(vm, ctx);
  const inStep = Boolean(vm && vm.streak && vm.streak.inStep);
  const dense = Boolean(h.dense);
  const toggleGroup = handler(ctx, "toggleGroup");
  const sel = selectedTile(vm, ui);
  const selectedId = sel ? sel.helperId : null;
  const tileOpts = { dense, calm, inStep, selectedId, look: tileLook(ctx) };
  const virtual = virtualGroups(vm, ui);
  const out = [];
  for (const key of flockKeys(vm, ui)) {
    let el = null;
    if (key === "detail") el = detailCard(sel, vm, ctx);
    else if (key === "empty") el = emptyState(ctx);
    else if (key === "album") el = albumSection(vm, ui, ctx);
    else if (key === "head") {
      const legendOpen = !isFolded(vm, ui, "legend");
      el = h_flex()
        .id("cw-flock-head")
        .w_full()
        .h(28)
        .gap(6)
        .child(text(clip(flockHeadline(vm), FLOCK_CLIP.head), { size: 11, color: T.muted, truncate: true }, T).flex_1())
        .child(iconButton("cw-flock-legend-btn", "info", legendOpen ? "Hide the status legend" : "Status legend", {
          size: 14,
          color: legendOpen ? T.foreground : T.muted,
          onClick: (e, cx) => toggleGroup("legend", cx),
        }, T));
    } else if (key === "legend") el = legendRows(T, ctx.S);
    else if (key === "group:elsewhere") {
      const folded = isFolded(vm, ui, "elsewhere");
      el = v_flex().id("cw-flock-sec-elsewhere").w_full();
      el.child(
        sectionHeader("cw-flock-grp-elsewhere", "elsewhere", "Elsewhere", clip(String(elsewhere.length), FLOCK_CLIP.count), {
          folded,
          onToggle: (cx) => toggleGroup("elsewhere", cx),
        }, T).tooltip("Helpers another window sees"),
      );
      if (!folded) {
        el.child(
          virtual.elsewhere === true
            ? virtualGroup("elsewhere", elsewhere, tileOpts.look, selectedId)
            : tileGrid(elsewhere, { ...tileOpts, elsewhere: true }, ctx, "elsewhere"),
        );
      }
    } else {
      const gk = key.slice(6);
      const g = groups.find((x) => str(x.key) === gk);
      const tiles = g && Array.isArray(g.tiles) ? g.tiles : [];
      const folded = gk !== "all" && isFolded(vm, ui, gk);
      el = v_flex().id(`cw-flock-sec-${gk}`).w_full();
      if (gk !== "all") {
        el.child(
          sectionHeader(`cw-flock-grp-${gk}`, gk, clip(str(g && g.title) || gk, FLOCK_CLIP.group), clip(String(num(g && g.count, tiles.length)), FLOCK_CLIP.count), {
            folded,
            onToggle: (cx) => toggleGroup(gk, cx),
          }, T),
        );
      }
      if (!folded) el.child(virtual[gk] === true ? virtualGroup(gk, tiles, tileOpts.look, selectedId) : tileGrid(tiles, tileOpts, ctx, gk));
    }
    // (albumSection is null only when flockKeys left the Album out)
    if (el) out.push(el.flex_none());
  }
  return out;
}

/** The Flock tab content as one element (`#cw-flock`, its parts as children). Pure (B11). */
export function renderFlock(vm, ui, ctx) {
  return v_flex().id("cw-flock").w_full().px(8).pt(6).pb(10).gap(4).children(flockParts(vm, ui, ctx));
}

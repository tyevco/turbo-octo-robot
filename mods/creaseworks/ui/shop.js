// Shop tab (DESIGN §3.4, §7, §8): `renderShop(vm, ui, ctx)` (ARCHITECTURE
// B11). Returns one element sized to its content at full width (8 px side
// padding); the panel wraps it in the scrolling `#cw-content`.
//
// A 40 px segment control (Works | Tools | Folk | Charms | Curios | Auto; icons
// only below 280 px), the Works count toggle ×1 | ×10 | Max, then the rows of
// the segment in table order: 52 px rows with a 72×28 buy button (affordable:
// T.accent with a 3 px T.accent bar on the row; else T.raised with the
// time-to-afford line), the best-buy diamond, tier sub-rows (36 px) under
// their workshop, at most two "???" silhouettes for unrevealed items, owned
// upgrades folded into "Owned (n)", and the automation switches.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { clip } from "../engine/index.js";
import { pipPath, spritePath, sprite } from "./art.js";
import { button, guarded, hoverOn, text, toggle } from "./widgets.js";
import { isFolded } from "./flock.js";

/** Grapheme limits for every string this module draws (tested). */
export const SHOP_CLIP = Object.freeze({ name: 22, owned: 6, effect: 44, cost: 10, eta: 16, tooltip: 80, segment: 8, more: 28 });

/** Segment keys, labels and icons (DESIGN §3.4). */
export const SEGMENTS = Object.freeze([
  Object.freeze({ key: "works", label: "Works", icon: "workshops/stack" }),
  Object.freeze({ key: "tools", label: "Tools", icon: "hand" }),
  Object.freeze({ key: "folk", label: "Folk", icon: "paw" }),
  Object.freeze({ key: "charms", label: "Charms", icon: "ribbon" }),
  Object.freeze({ key: "curios", label: "Curios", icon: "curio" }),
  Object.freeze({ key: "auto", label: "Auto", icon: "cog" }),
]);

/** Works count choices (`setting("buyCount", value)`, ui-only). */
export const BUY_COUNTS = Object.freeze([
  Object.freeze({ value: 1, label: "×1" }),
  Object.freeze({ value: 10, label: "×10" }),
  Object.freeze({ value: "max", label: "Max" }),
]);

/** Unrevealed rows drawn as "???" per segment before "+n more to discover". */
export const SILHOUETTES = 2;

/** Below this width the segment control shows icons only (§3.4 narrow state). */
const NARROW = 280;

function handler(ctx, name) {
  const h = ctx && ctx.handlers;
  const f = h && typeof h[name] === "function" ? h[name] : null;
  return (...args) => (f ? f(...args) : undefined);
}

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

/** The active segment key ("works" by default). */
export function activeSegment(ui) {
  const s = ui && ui.segment;
  return SEGMENTS.some((x) => x.key === s) ? s : "works";
}

/** The Works count: the vm's (B10 `shop.buyCount`), else `ui.buyCount`, else 1. */
export function buyCount(vm, ui) {
  const c = vm && vm.shop && vm.shop.buyCount !== undefined ? vm.shop.buyCount : ui && ui.buyCount;
  return c === 10 || c === "max" ? c : 1;
}

/** Art path of a row icon: a workshop id, a `ui/` glyph name or "<folder>/<name>". */
export function rowIconPath(name) {
  const s = str(name);
  const tries = s.includes("/") ? [["workshop", s.split("/")[1]], ["ui", s.split("/")[1]]] : [["workshop", s], ["ui", s]];
  for (const [kind, n] of tries) {
    try {
      return spritePath(kind, n);
    } catch {
      // try the next folder
    }
  }
  return spritePath("ui", "curio");
}

function segmentControl(current, ctx) {
  const T = ctx.T;
  const go = handler(ctx, "segment");
  const narrow = num(ctx.width, 320) < NARROW;
  const bar = h_flex().id("cw-shop-segs").role("tab_list").w_full().h(40).flex_none().gap(2).border_b(1).border_color(T.border);
  for (const s of SEGMENTS) {
    const on = s.key === current;
    const color = on ? T.foreground : T.muted;
    const cell = v_flex()
      .id(`cw-shop-seg-${s.key}`)
      .role("tab")
      .aria_selected(on)
      .flex_1()
      .min_w(0)
      .h(40)
      .items_center()
      .justify_center()
      .gap(2)
      .rounded_t(6)
      .cursor_pointer()
      .tooltip(s.label)
      .hover((st) => st.bg(hoverOn(T, T.chrome)))
      .on_click((e, cx) => go(s.key, cx))
      .child(sprite(rowIconPath(s.icon), 14, color));
    if (!narrow) cell.child(text(clip(s.label, SHOP_CLIP.segment), { size: 11, weight: 600, color }, T));
    if (on) cell.bg(T.raised).border_b(2).border_color(T.accent);
    bar.child(cell);
  }
  return bar;
}

function countToggle(current, ctx) {
  const T = ctx.T;
  const setting = handler(ctx, "setting");
  const box = h_flex().id("cw-shop-count").h(28).flex_none().rounded(6).border(1).border_color(T.border).overflow_hidden();
  for (const c of BUY_COUNTS) {
    const on = c.value === current;
    const cell = h_flex()
      .id(`cw-shop-count-${c.value}`)
      .role("radio_button")
      .aria_selected(on)
      .h(28)
      .min_w(36)
      .px(8)
      .justify_center()
      .cursor_pointer()
      .text_size(11)
      .font_weight(600)
      .text_color(on ? T.accent_foreground : T.foreground)
      .tooltip(c.value === "max" ? "Buy as many as you can afford" : `Buy ${c.value} at a time`)
      .on_click((e, cx) => setting("buyCount", c.value, cx))
      .child(c.label);
    if (on) cell.bg(T.accent);
    else cell.hover((st) => st.bg(hoverOn(T, T.chrome)));
    box.child(cell);
  }
  return h_flex()
    .w_full()
    .h(32)
    .gap(6)
    .child(text("Buy", { size: 11, color: T.muted }, T))
    .child(div().flex_1())
    .child(box);
}

/** One buyable row (or tier sub-row). `count` is what the buy button buys. */
function itemRow(row, seg, count, ctx, sub = false) {
  const T = ctx.T;
  const id = str(row.id);
  const affordable = row.affordable === true;
  const owned = Math.max(0, num(row.owned));
  const buy = handler(ctx, "buy");
  const switchAuto = handler(ctx, "switchAuto");
  const h = sub ? 36 : 52;

  const el = h_flex()
    .id(`cw-shop-row-${id}`)
    .relative()
    .w_full()
    .h(h)
    .flex_none()
    .gap(8)
    .pl(sub ? 32 : 10)
    .pr(4)
    .rounded(6);
  if (affordable) el.child(div().absolute().left(sub ? 24 : 0).top(sub ? 6 : 8).w(3).h(h - (sub ? 12 : 16)).rounded(2).bg(T.accent));
  el.child(sprite(rowIconPath(row.icon), sub ? 20 : 28, affordable ? T.foreground : T.muted));

  const name = h_flex()
    .gap(6)
    .min_w(0)
    .child(text(clip(str(row.name), SHOP_CLIP.name), { size: sub ? 12 : 13, weight: 600, color: T.foreground, truncate: true }, T));
  if (seg === "works" && !sub && owned > 0) {
    name.child(text(clip(`×${owned}`, SHOP_CLIP.owned), { size: 11, weight: 600, color: T.muted }, T));
  }
  const left = v_flex().flex_1().min_w(0).gap(1).child(name);
  if (row.effect) left.child(text(clip(str(row.effect), SHOP_CLIP.effect), { size: 11, color: T.muted, truncate: true }, T));
  el.child(left);

  // Auto: an owned automation shows its switch instead of a buy button.
  if (seg === "auto" && owned > 0) {
    const on = row.on !== false;
    el.child(toggle(`cw-shop-auto-${id}`, on, { label: `${str(row.name)} ${on ? "on" : "off"}`, onChange: (v, cx) => switchAuto(id, Boolean(v), cx) }, T));
    return el;
  }

  const cost = clip(str(row.cost), SHOP_CLIP.cost);
  const n = seg === "works" && !sub ? (count === "max" ? Math.max(1, num(row.count, 1)) : count) : 1;
  let tip = affordable ? `Buy ${n === 1 ? "" : `${n} `}for ${cost}` : row.eta ? `${cost}: affordable ${str(row.eta)}` : `${cost}: not affordable yet`;
  if (row.best === true) tip = str(row.tooltip) || "Best buy";
  const right = v_flex().flex_none().items_end().gap(1);
  const line = h_flex().gap(6);
  if (row.best === true) {
    line.child(
      div()
        .id(`cw-shop-best-${id}`)
        .flex_none()
        .tooltip(clip(str(row.tooltip) || "Best buy", SHOP_CLIP.tooltip))
        .child(svg(pipPath("working")).w(6).h(6).text_color(guarded(T.accent, T.chrome, T.foreground))),
    );
  }
  line.child(
    button(`cw-shop-buy-${id}`, cost, {
      variant: affordable ? "primary" : "muted",
      w: 72,
      h: sub ? 28 : 28,
      size: 12,
      px: 4,
      disabled: !affordable,
      tooltip: clip(tip, SHOP_CLIP.tooltip),
      onClick: (e, cx) => buy(id, seg === "works" && !sub ? count : 1, cx),
    }, T),
  );
  right.child(line);
  if (!affordable && row.eta) right.child(text(clip(str(row.eta), SHOP_CLIP.eta), { size: 11, color: T.muted }, T));
  el.child(right);
  return el;
}

function silhouette(seg, i, row, ctx) {
  const T = ctx.T;
  return h_flex()
    .id(`cw-shop-unknown-${seg}-${i}`)
    .w_full()
    .h(52)
    .flex_none()
    .gap(8)
    .pl(10)
    .pr(4)
    .child(sprite(rowIconPath(row.icon), 28, T.dim))
    .child(
      v_flex()
        .flex_1()
        .min_w(0)
        .child(text("???", { size: 13, weight: 600, color: T.muted }, T))
        .child(text(seg === "works" ? "Own the one above to reveal" : "Fold more to reveal", { size: 11, color: T.muted, truncate: true }, T)),
    )
    .child(sprite(spritePath("ui", "lock"), 14, T.dim));
}

function ownedSection(seg, rows, vm, ui, ctx) {
  const T = ctx.T;
  const key = `owned:${seg}`;
  const folded = isFolded(vm, ui, key);
  const toggleGroup = handler(ctx, "toggleGroup");
  const box = v_flex().id(`cw-shop-owned-${seg}`).w_full().pt(4);
  box.child(
    h_flex()
      .id(`cw-shop-owned-${seg}-toggle`)
      .h(28)
      .w_full()
      .px(4)
      .gap(6)
      .rounded(6)
      .cursor_pointer()
      .hover((st) => st.bg(hoverOn(T, T.chrome)))
      .on_click((e, cx) => toggleGroup(key, cx))
      .child(sprite(spritePath("ui", "check"), 11, T.muted))
      .child(text(`Owned (${rows.length})`, { size: 11, weight: 600, color: T.foreground }, T))
      .child(div().flex_1())
      .child(text(folded ? "▸" : "▾", { size: 11, color: T.muted }, T)),
  );
  if (folded) return box;
  for (const r of rows) {
    box.child(
      h_flex()
        .h(28)
        .w_full()
        .gap(8)
        .pl(10)
        .pr(4)
        .child(sprite(rowIconPath(r.icon), 16, T.muted))
        .child(text(clip(str(r.name), SHOP_CLIP.name), { size: 12, color: T.foreground, truncate: true }, T).flex_none())
        .child(text(clip(str(r.effect), SHOP_CLIP.effect), { size: 11, color: T.muted, truncate: true }, T).flex_1()),
    );
  }
  return box;
}

/** The Shop tab content. Pure (B11). */
export function renderShop(vm, ui, ctx) {
  const T = ctx.T;
  const seg = activeSegment(ui);
  const segments = (vm && vm.shop && vm.shop.segments) || {};
  const rows = Array.isArray(segments[seg]) ? segments[seg] : [];
  const count = buyCount(vm, ui);

  const root = v_flex().id("cw-shop").w_full().px(8).pt(4).pb(10).gap(2);
  root.child(segmentControl(seg, ctx));
  if (seg === "works") root.child(countToggle(count, ctx));

  const list = v_flex().id(`cw-shop-list-${seg}`).w_full().gap(2).pt(seg === "works" ? 0 : 6);
  const hidden = [];
  const owned = [];
  for (const row of rows) {
    if (!row || typeof row.id !== "string") continue;
    if (row.revealed === false) {
      hidden.push(row);
      continue;
    }
    if (seg !== "works" && seg !== "auto" && num(row.owned) > 0) {
      owned.push(row);
      continue;
    }
    list.child(itemRow(row, seg, count, ctx));
    if (seg === "works" && Array.isArray(row.sub)) {
      for (const s of row.sub) if (s && typeof s.id === "string") list.child(itemRow(s, seg, count, ctx, true));
    }
  }
  hidden.slice(0, SILHOUETTES).forEach((row, i) => list.child(silhouette(seg, i, row, ctx)));
  if (hidden.length > SILHOUETTES) {
    const more = hidden.length - SILHOUETTES;
    list.child(text(clip(`+${more} more to discover`, SHOP_CLIP.more), { size: 11, color: T.muted }, T).pl(10).py(4));
  }
  if (!rows.length) list.child(text("Nothing here yet.", { size: 11, color: T.muted }, T).py(8));
  root.child(list);
  if (owned.length) root.child(ownedSection(seg, owned, vm, ui, ctx));
  return root;
}

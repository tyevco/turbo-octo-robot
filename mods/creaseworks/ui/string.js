// String tab, the prestige (DESIGN §3.5, §9): `renderString(vm, ui, ctx)`
// (ARCHITECTURE B11). Returns one element sized to its content at full width
// (8 px side padding); the panel wraps it in the scrolling `#cw-content`.
//
// The string is 20 strand columns on a S.mat card: each a dim
// `ui/garland-strand.svg` (S.sheet at 0.25) under a second tinted copy in an
// `overflow_hidden` div whose height is the strand's filled share
// (`.transition("height", 600)`): 40 sprites, never 1,000. Then the next-crane
// and gate lines, the wish button (disabled below the gate), the two-step
// confirm card whose "Make the wish" arms 1.5 s after the card appeared
// (`ui.armedAt` / `ui.now`, never a clock read here), what a wish clears and
// keeps, the perks, and one garland per wish drawn as one paint_path
// rectangle per stripe with a tooltip naming its source and share.

import { div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { clip } from "../engine/index.js";
import { isHex, validateBackgroundColor } from "./color.js";
import { spritePath, icon } from "./art.js";
import { hueOf, pickHues } from "./palette.js";
import { button, divider, text } from "./widgets.js";
import { isCalm } from "./mat.js";

/** Grapheme limits for every string this module draws (tested). */
export const STRING_CLIP = Object.freeze({ title: 24, line: 64, button: 40, perk: 60, garland: 40, stripe: 60, note: 120 });

/** Strand geometry (DESIGN §3.5): 20 × (12 × 200), gap 3, on a 304 × 208 card. */
export const STRAND = Object.freeze({ count: 20, w: 12, h: 200, gap: 3, card: 208, minW: 6 });

/** The confirm card's arming delay (ms): "Make the wish" is disabled until then. */
export const ARM_MS = 1500;

/** What a wish clears and keeps (DESIGN §3.5, §9). */
export const CLEARS = "Clears: folds, workshops, upgrades, running boosts.";
export const KEEPS = "Keeps: helpers and their history, Wishes, perks, waiting boost envelopes, settings, switches, garlands.";

function handler(ctx, name) {
  const h = ctx && ctx.handlers;
  const f = h && typeof h[name] === "function" ? h[name] : null;
  return (...args) => (f ? f(...args) : undefined);
}

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const int = (n) => {
  const s = String(Math.round(Math.abs(n)));
  let out = "";
  for (let i = 0; i < s.length; i++) out += (i > 0 && (s.length - i) % 3 === 0 ? "," : "") + s[i];
  return (n < 0 ? "-" : "") + out;
};

/**
 * True when a two-step confirm is armed: `ui.armedAt` and `ui.now` are both
 * numbers and at least `ARM_MS` apart. Without them it stays disarmed (safe:
 * the glue re-renders on its 1 s data tick with a fresh `ui.now`).
 */
export function isArmed(ui) {
  return Boolean(ui && typeof ui.armedAt === "number" && typeof ui.now === "number" && ui.now - ui.armedAt >= ARM_MS);
}

/** Whether the wish confirm card is open (`ui.confirm` true or "wish"). */
export function wishConfirming(ui) {
  return Boolean(ui && (ui.confirm === true || ui.confirm === "wish"));
}

/** The 20 strand fill shares 0..1 (the vm's `strands` when present). */
export function strandShares(s) {
  if (s && Array.isArray(s.strands) && s.strands.length === STRAND.count) {
    return s.strands.map((v) => Math.max(0, Math.min(1, num(v))));
  }
  const of = Math.max(1, num(s && s.of, 1000));
  const cranes = Math.max(0, num(s && s.cranes));
  const per = of / STRAND.count;
  const out = [];
  for (let i = 0; i < STRAND.count; i++) out.push(Math.max(0, Math.min(1, (cranes - i * per) / per)));
  return out;
}

/** The tab's ready lines (B10 strings first, then built from the B6 fields). */
export function stringLines(s) {
  const of = Math.max(1, num(s.of, 1000));
  const cranes = Math.max(0, num(s.cranes));
  const gain = Math.max(0, num(s.gain));
  const shown = Math.max(gain, num(s.needed));
  return {
    title: str(s.title) || `${int(Math.min(cranes, of))} / ${int(of)} cranes`,
    next: str(s.next) || `Next crane in ${str(s.nextIn)} folds · lifetime ${str(s.lifetime)}`,
    at: str(s.at) || `At ${int(of)}: +${int(shown)} Wishes (+5 % to everything each, forever)`,
    button: str(s.button) || `Make the wish (+${int(shown)} Wishes)`,
    gain,
  };
}

function cardWidth(ctx) {
  return Math.max(200, Math.min(304, num(ctx.width, 320) - 16));
}

function strands(s, ctx, calm) {
  const S = ctx.S;
  const cw = cardWidth(ctx);
  const sw = Math.max(STRAND.minW, Math.min(STRAND.w, Math.floor((cw - 8 - (STRAND.count - 1) * STRAND.gap) / STRAND.count)));
  const shares = strandShares(s);
  const path = spritePath("ui", "garland-strand");
  const row = h_flex().absolute().top(4).left(0).w_full().justify_center().items_start().gap(STRAND.gap);
  shares.forEach((k, i) => {
    const fill = div()
      .id(`cw-string-strand-${i}`)
      .absolute()
      .bottom(0)
      .left(0)
      .w(sw)
      .h(Math.round(STRAND.h * k * 10) / 10)
      .overflow_hidden()
      .transition("height", calm ? 150 : 600)
      .child(svg(path).absolute().bottom(0).left(0).w(sw).h(STRAND.h).text_color(S.sheet));
    row.child(
      div()
        .relative()
        .flex_none()
        .w(sw)
        .h(STRAND.h)
        .child(div().absolute().inset_0().opacity(0.25).child(svg(path).w(sw).h(STRAND.h).text_color(S.sheet)))
        .child(fill),
    );
  });
  return div().id("cw-string-card").relative().flex_none().w(cw).h(STRAND.card).rounded(8).bg(S.mat).overflow_hidden().child(row);
}

function confirmCard(s, L, ui, ctx) {
  const T = ctx.T;
  const armed = isArmed(ui);
  const cancel = handler(ctx, "cancel");
  const wish = handler(ctx, "wish");
  const wait = typeof ui.armedAt === "number" && typeof ui.now === "number" ? Math.max(0, ARM_MS - (ui.now - ui.armedAt)) : ARM_MS;
  const actions = h_flex()
    .gap(8)
    .pt(4)
    .child(button("cw-string-keep", "Keep folding", { h: 28, size: 12, onClick: (e, cx) => cancel(cx) }, T))
    .child(div().flex_1())
    .child(button("cw-string-make", "Make the wish", {
      variant: "primary",
      h: 28,
      size: 12,
      disabled: !armed,
      tooltip: armed ? "Reset this run for the Wishes" : `Ready in ${Math.max(1, Math.ceil(wait / 1000))} s`,
      onClick: (e, cx) => wish(cx),
    }, T));
  return v_flex()
    .id("cw-string-confirm")
    .w(cardWidth(ctx))
    .p(12)
    .gap(4)
    .rounded(8)
    .bg(T.popover)
    .border(1)
    .border_color(T.accent)
    .child(text("Make the wish?", { size: 13, weight: 600, color: T.foreground }, T))
    .child(text(clip(`+${int(L.gain)} Wishes: +5 % to everything each, forever`, STRING_CLIP.line), { size: 12, weight: 600, color: T.foreground }, T))
    .child(text(CLEARS, { size: 11, color: T.foreground }, T).whitespace_normal())
    .child(text(KEEPS, { size: 11, color: T.muted }, T).whitespace_normal())
    .child(actions);
}

function perks(list, T) {
  const box = v_flex().id("cw-string-perks").w_full().gap(1);
  box.child(text("PERKS", { size: 11, weight: 600, color: T.muted }, T).pt(4));
  for (const p of list) {
    const have = p && p.have === true;
    box.child(
      h_flex()
        .min_h(22)
        .gap(6)
        .child(text(clip(int(num(p.at)), 6), { size: 11, weight: 600, color: T.foreground }, T).w(28).flex_none().text_right())
        .child(
          h_flex().w(14).flex_none().justify_center().child(
            have ? icon("check", 11, T.foreground) : text("·", { size: 11, color: T.muted }, T),
          ),
        )
        .child(text(clip(str(p.text), STRING_CLIP.perk), { size: 11, color: have ? T.foreground : T.muted, truncate: true }, T).flex_1()),
    );
  }
  return box;
}

function stripeColor(key, ctx) {
  const T = ctx.T;
  const S = ctx.S;
  const k = str(key);
  let c = null;
  if (k.startsWith("hue:")) {
    const hs = Array.isArray(ctx.hues) && ctx.hues.length === 8 ? ctx.hues : pickHues(Boolean(ctx.dark));
    c = hueOf(hs, parseInt(k.slice(4), 10));
  } else if (k === "hands") c = S.node;
  else if (k === "workshops") c = S.sheetShade;
  else c = T.muted;
  return isHex(c) ? validateBackgroundColor(c) : validateBackgroundColor(T.muted);
}

const LABEL = Object.freeze({ hands: "your hands", workshops: "workshops", rest: "everyone else" });

function paintRect(color) {
  const win = globalThis.window;
  if (!win || typeof win.paint_path !== "function") return null;
  const rect = PathBuilder.fill().add_polygon([["0%", "0%"], ["100%", "0%"], ["100%", "100%"], ["0%", "100%"]]).build();
  return win.paint_path(rect, Background.solid(color)).absolute().inset_0();
}

function garland(g, ctx, width) {
  const T = ctx.T;
  const wish = Math.max(0, Math.round(num(g.wish)));
  const stripes = (Array.isArray(g.stripes) ? g.stripes : []).filter((st) => Array.isArray(st) && num(st[1]) > 0).slice(0, 20);
  const total = stripes.reduce((a, st) => a + num(st[1]), 0);
  const day = typeof g.day === "number" ? `day ${g.day}` : str(g.day);
  const wishes = Math.max(0, Math.round(num(g.wishes)));
  const bar = div().id(`cw-string-g${wish}`).relative().w(width).h(12).rounded(2).overflow_hidden().bg(T.raised);
  let x = 0;
  stripes.forEach((st, j) => {
    const w = total > 0 ? (num(st[1]) / total) * width : 0;
    const x0 = Math.round(x * 10) / 10;
    x += w;
    const x1 = Math.round(x * 10) / 10;
    if (x1 - x0 <= 0) return;
    const color = stripeColor(st[0], ctx);
    const who = str(st[2]) || (Object.hasOwn(LABEL, str(st[0])) ? LABEL[str(st[0])] : str(st[0]));
    const share = total > 0 ? Math.round((num(st[1]) / total) * 100) : 0;
    const wrap = div()
      .id(`cw-string-g${wish}-s${j}`)
      .absolute()
      .top(0)
      .left(x0)
      .w(Math.round((x1 - x0) * 10) / 10)
      .h(12)
      .tooltip(clip(`${clip(who, STRING_CLIP.garland)}: ${share} %`, STRING_CLIP.stripe));
    const rect = paintRect(color);
    wrap.child(rect || div().absolute().inset_0().bg(color));
    bar.child(wrap);
  });
  const label = [`#${wish}`, day, `${int(wishes)} Wishes`].filter(Boolean).join(" · ");
  return v_flex()
    .w_full()
    .gap(3)
    .py(3)
    .child(text(clip(label, STRING_CLIP.garland), { size: 11, color: T.muted }, T))
    .child(bar);
}

/** The String tab content. Pure (B11). */
export function renderString(vm, ui, ctx) {
  const T = ctx.T;
  const s = (vm && vm.string) || {};
  const L = stringLines(s);
  const calm = isCalm(vm, ctx);
  const confirm = handler(ctx, "confirm");
  const can = s.can === true;
  const width = cardWidth(ctx);

  const root = v_flex().id("cw-string").w_full().px(8).pt(8).pb(10).gap(6);
  root.child(
    h_flex()
      .w_full()
      .gap(8)
      .child(text("The String", { size: 13, weight: 600, color: T.foreground }, T))
      .child(div().flex_1())
      .child(text(clip(L.title, STRING_CLIP.title), { size: 13, weight: 600, color: T.foreground }, T)),
  );
  root.child(strands(s, ctx, calm));
  root.child(text(clip(L.next, STRING_CLIP.line), { size: 11, color: T.muted, truncate: true }, T));
  root.child(text(clip(L.at, STRING_CLIP.line), { size: 11, color: T.muted, truncate: true }, T));

  if (can && wishConfirming(ui)) {
    root.child(confirmCard(s, L, ui, ctx));
  } else {
    root.child(
      button("cw-string-wish", clip(L.button, STRING_CLIP.button), {
        variant: can ? "primary" : "muted",
        w: width,
        h: 36,
        size: 12,
        disabled: !can,
        tooltip: can ? "Opens a card to confirm" : `Reach ${int(Math.max(1, num(s.of, 1000)))} cranes to make the wish`,
        onClick: (e, cx) => confirm("wish", cx),
      }, T),
    );
    root.child(text(CLEARS, { size: 11, color: T.muted }, T).whitespace_normal());
    root.child(text(KEEPS, { size: 11, color: T.muted }, T).whitespace_normal());
  }

  root.child(divider(T));
  root.child(perks(Array.isArray(s.perks) ? s.perks : [], T));

  const garlands = Array.isArray(s.garlands) ? s.garlands : [];
  if (garlands.length) {
    root.child(divider(T));
    const box = v_flex().id("cw-string-garlands").w_full().gap(2);
    box.child(text("GARLANDS (ONE PER WISH)", { size: 11, weight: 600, color: T.muted }, T).pt(4));
    for (const g of garlands.slice(-50).reverse()) if (g && typeof g === "object") box.child(garland(g, ctx, width));
    root.child(box);
  }
  return root;
}

// Save / clock banner (DESIGN §3.8, §12.2): `renderBanner(vm, ui, ctx)`
// (ARCHITECTURE B11) → element | null. At least 28 px under the header; text
// is always T.foreground (never a status colour on a tint), tints go through
// withAlpha() after hex6(). "Details ▸" expands a 3-line card (path with
// middle truncation, last good save, backup state and kept damaged files).

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { clip, graphemes } from "../engine/index.js";
import { withAlpha, isHex, over, statusColor } from "./color.js";
import { icon } from "./art.js";
import { button, text } from "./widgets.js";

/** Grapheme limits for every string this module draws (tested). */
export const BANNER_CLIP = Object.freeze({ text: 140, lead: 60, path: 44, line: 48 });

/** Kinds shown in the banner (save notices plus the engine's clock notice). */
export const BANNER_KINDS = Object.freeze(["recovered", "fresh", "conflict", "merged", "error", "newer", "clock"]);

/** Kind → glyph and background (§3.8 table). `tint` is a theme key drawn at 0x1f, else T.raised. */
const LOOK = Object.freeze({
  recovered: { glyph: "warn", tint: "working" },
  fresh: { glyph: "warn", tint: "blocked" },
  conflict: { glyph: "arrows", tint: null },
  merged: { glyph: "arrows", tint: null },
  error: { glyph: "warn", tint: "blocked" },
  newer: { glyph: "lock", tint: "blocked" },
  clock: { glyph: "clock", tint: null },
});

function handler(ctx, name) {
  const h = ctx && ctx.handlers;
  const f = h && typeof h[name] === "function" ? h[name] : null;
  return (...args) => (f ? f(...args) : undefined);
}

/** The banner notices of a vm, save notice first (B10 `place`, or the §3.8 kinds). */
export function bannerNotices(vm) {
  const list = Array.isArray(vm && vm.notices) ? vm.notices : [];
  return list.filter((n) => n && typeof n.kind === "string" && (n.place ? n.place === "banner" : BANNER_KINDS.includes(n.kind)));
}

/** True when the vm carries a save problem (banner kinds other than `clock`, `merged`). */
export function saveProblem(vm) {
  return bannerNotices(vm).some((n) => n.kind !== "clock" && n.kind !== "merged" && n.kind !== "conflict");
}

/** `clip` that keeps the head and the tail: "/home/me/…/save.json". */
export function middleClip(str, max) {
  const g = graphemes(String(str ?? ""));
  if (g.length <= max) return g.join("");
  const keep = Math.max(2, max - 1);
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return g.slice(0, head).join("") + "…" + g.slice(g.length - tail).join("");
}

/** Background of a banner kind on the panel chrome, as an opaque colour. */
export function bannerBg(T, kind) {
  const look = Object.hasOwn(LOOK, kind) ? LOOK[kind] : LOOK.error;
  if (!look.tint || !isHex(T[look.tint])) return T.raised;
  const tint = withAlpha(T[look.tint], 0x1f / 255);
  return isHex(T.chrome) ? over(tint, T.chrome) : tint;
}

/** First sentence (11/600) and the rest (11/400) of a notice text. */
function split(textStr) {
  const s = clip(String(textStr ?? ""), BANNER_CLIP.text);
  const m = /^(.+?[.…])(\s+)(.*)$/.exec(s);
  if (!m || m[1].length > 80) return [s, ""];
  return [m[1], m[3]];
}

function detailsCard(ctx, T) {
  const save = (ctx && ctx.save) || {};
  const lines = [];
  lines.push(save.path ? `File: ${middleClip(save.path, BANNER_CLIP.path)}` : "File: the save in herdr's app home");
  lines.push(clip(save.lastGood ? `Last good save: ${save.lastGood}` : "Last good save: not known yet", BANNER_CLIP.line));
  const kept = Array.isArray(save.damaged) && save.damaged.length ? ` · kept ${save.damaged.map(String).join(", ")}` : "";
  lines.push(clip(`Backup: ${save.backup ? String(save.backup) : "see Settings › Save"}${kept}`, BANNER_CLIP.line));
  const card = v_flex().id("cw-banner-details").mx(8).mb(4).px(6).py(4).gap(0).rounded(6).bg(T.raised).border(1).border_color(T.border);
  for (const l of lines) card.child(text(l, { size: 11, color: T.muted, truncate: true }, T));
  return card;
}

const ACTION_W = Object.freeze({ retry: 72, details: 64, dismiss: 56 });
const LINE = 14;
/** Height of the expanded Details card (3 lines). */
export const DETAILS_H = 58;

/**
 * The banner's geometry for the panel (it places the away card under it):
 * `{ notice, lead, rest, h, detailsH, total }`, or null without a banner.
 * Heights come from a text-width estimate (11 px ≈ 6.2 px per grapheme), and
 * the banner is drawn at exactly that height.
 */
export function bannerLayout(vm, ui, ctx) {
  const notice = bannerNotices(vm)[0];
  if (!notice) return null;
  const width = typeof ctx.width === "number" && ctx.width > 0 ? ctx.width : 320;
  const actions = Array.isArray(notice.actions) ? notice.actions : [];
  let actionsW = 0;
  for (const a of actions) if (Object.hasOwn(ACTION_W, a)) actionsW += ACTION_W[a] + 6;
  // One short action sits at the end of the text row; more go on a row below.
  const inline = actionsW <= 80;
  const avail = width - 16 - 14 - 6 - (inline ? actionsW : 0);
  const perLine = Math.max(8, Math.floor(Math.max(40, avail) / 6.2));
  const [lead, rest] = split(notice.text);
  const len = (t) => graphemes(t).length;
  let lines;
  if (len(lead) + 1 + len(rest) <= perLine) lines = 1;
  else lines = Math.ceil(len(lead) / perLine) + (rest ? Math.ceil(len(rest) / perLine) : 0);
  const h = Math.max(28, lines * LINE + 8);
  const actionsH = inline || !actionsW ? 0 : 28;
  const detailsH = ui && ui.details && actions.includes("details") ? DETAILS_H : 0;
  return { notice, lead, rest, h, inline, actionsH, detailsH, total: h + actionsH + detailsH };
}

/**
 * The banner for the first banner notice, or null. Actions: `details`
 * (ctx.handlers.details), `dismiss`, `retry` (retrySave).
 */
export function renderBanner(vm, ui, ctx) {
  const lay = bannerLayout(vm, ui, ctx);
  if (!lay) return null;
  const T = ctx.T;
  const n = lay.notice;
  const kind = n.kind;
  const look = Object.hasOwn(LOOK, kind) ? LOOK[kind] : LOOK.error;
  const bg = bannerBg(T, kind);
  const glyphColor = look.tint ? statusColor(T, look.tint, bg) : T.muted;
  const words = h_flex().id("cw-banner-text").flex_1().min_w(0).flex_wrap().gap_x(4).tooltip(clip(String(n.text ?? ""), BANNER_CLIP.text));
  words.child(div().text_size(11).line_height("127%").font_weight(600).text_color(T.foreground).whitespace_normal().child(lay.lead));
  if (lay.rest) words.child(div().text_size(11).line_height("127%").font_weight(400).text_color(T.foreground).whitespace_normal().child(lay.rest));
  const row = h_flex()
    .id("cw-banner")
    .w_full()
    .h(lay.h)
    .flex_none()
    .px(8)
    .gap(6)
    .bg(bg)
    .overflow_hidden()
    .child(icon(look.glyph, 14, glyphColor))
    .child(words);
  const actions = Array.isArray(n.actions) ? n.actions : [];
  const details = lay.detailsH > 0;
  const onDetails = handler(ctx, "details");
  const onDismiss = handler(ctx, "dismiss");
  const onRetry = handler(ctx, "retrySave");
  const bar = lay.inline ? row : h_flex().id("cw-banner-actions").w_full().h(28).flex_none().px(8).gap(6).justify_end();
  for (const a of actions) {
    if (a === "retry") {
      bar.child(button("cw-banner-retry", "Retry now", { h: 28, size: 11, px: 6, onClick: (e, cx) => onRetry(cx) }, T));
    } else if (a === "details") {
      bar.child(button("cw-banner-details-toggle", details ? "Details ▾" : "Details ▸", { variant: "ghost", h: 28, size: 11, px: 4, onClick: (e, cx) => onDetails(!details, cx) }, T));
    } else if (a === "dismiss") {
      bar.child(button("cw-banner-dismiss", "Dismiss", { variant: "ghost", h: 28, size: 11, px: 4, onClick: (e, cx) => onDismiss(kind, cx) }, T));
    }
  }
  const wrap = v_flex().id("cw-banner-wrap").w_full().h(lay.total).flex_none().bg(bg).border_b(1).border_color(T.border).child(row);
  if (!lay.inline && lay.actionsH) wrap.child(bar);
  if (details) wrap.child(detailsCard(ctx, T).h(DETAILS_H - 4));
  return wrap;
}

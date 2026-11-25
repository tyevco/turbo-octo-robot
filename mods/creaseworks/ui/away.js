// "While you were away" / "While you were busy" card (DESIGN §3.7, §10.3):
// `renderAway(vm, ui, ctx)` (ARCHITECTURE B11) → element | null. An absolute,
// non-blocking card the panel places over the mat (304 wide at mat x 0,
// y 36); it has its own close ✕ and, for the away kind, Collect. Uses the
// vm's ready lines (B10 `capText splitText …`) when present, else builds them
// from the B6 fields.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { clip } from "../engine/index.js";
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

/** The card for `vm.away`, or null. `width` defaults to 304 (the mat). */
export function renderAway(vm, ui, ctx) {
  const a = vm && vm.away;
  if (!a || typeof a !== "object") return null;
  const T = ctx.T;
  const busy = a.kind === "busy";
  const L = awayLines(a);
  const width = Math.max(200, Math.min(304, num(ctx.width, 320) - 16));
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
        .child(text(clip(L.cap ? `${a.duration ?? ""}  ${L.cap}` : String(a.duration ?? ""), AWAY_CLIP.cap), { size: 11, color: T.muted }, T).whitespace_normal()),
    )
    .child(iconButton("cw-away-close", "close", busy ? AWAY_CLOSE.busy : AWAY_CLOSE.away, {
      size: 14, surface: T.popover, stop: true, onClick: (e, cx) => dismiss(kind, cx),
    }, T));

  const card = v_flex()
    .id("cw-away")
    .w(width)
    .p(14)
    .gap(6)
    .rounded(10)
    .bg(T.popover)
    .border(1)
    .border_color(T.border)
    .shadow_lg()
    .child(head)
    .child(divider(T));

  const foldsRow = h_flex()
    .gap(8)
    .child(div().w(16).flex_none().flex().justify_center().child(icon("fold", 16, T.muted)))
    .child(
      v_flex()
        .min_w(0)
        .child(text(clip(String(a.folds ?? ""), AWAY_CLIP.folds) + " folds", { size: busy ? 16 : 20, weight: 600, color: T.foreground }, T))
        .when(Boolean(L.split), (el) => el.child(text(clip(L.split, AWAY_CLIP.line), { size: 11, color: T.muted, truncate: true }, T))),
    );
  card.child(foldsRow);

  if (busy && L.tasks) card.child(line(icon("check", 12, T.muted), L.tasks, T));
  if (L.envelopes) card.child(line(sprite(spritePath("status", "envelope"), 12, T.muted), L.envelopes, T));
  const needs = Array.isArray(a.needs) ? a.needs : [];
  if (!busy && L.needs) {
    const first = needs[0] && needs[0].helperId;
    const go = first
      ? button("cw-away-open", "Open ›", { h: 28, size: 11, px: 8, stop: true, onClick: (e, cx) => openHelper(first, cx) }, T)
      : null;
    card.child(line(statusMark(T, "blocked"), L.needs, T, go));
  }
  if (!busy && L.rested) card.child(line(statusMark(T, "idle"), L.rested, T));
  if (!busy && L.best) card.child(line(statusMark(T, "done"), L.best, T));
  if (!busy && L.affordable) card.child(line(icon("shop", 12, T.muted), L.affordable, T));

  if (!busy && a.collectable !== false) {
    card.child(
      h_flex()
        .justify_end()
        .pt(4)
        .child(button("cw-away-collect", "Collect", { variant: "primary", w: 88, h: 28, stop: true, onClick: (e, cx) => collect(cx) }, T)),
    );
  }
  return card;
}

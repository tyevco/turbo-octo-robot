// Reusable element builders (DESIGN §3, §5.2, §13.5, §14). Every builder is a
// pure function of its arguments plus the theme `T` (herdr theme() keys) and
// the scene tokens `S` (ui/palette.js pickScene), always the last two
// parameters: `button(id, label, opts, T, S)`. `kit(T, S)` binds them once
// per render. Builders return fresh elements (gpui elements are single-use).
//
// Rules carried here so screen builders cannot forget them:
// * every clickable takes a stable, non-empty id (a TypeError otherwise);
// * text is never below 11 px (`text()` throws a RangeError);
// * status glyphs use the guarded colour for the surface they sit on;
// * handlers given `stop: true` call `cx.stop_propagation()` first (pieces
//   that sit over another clickable, §3).

import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Button, Switch, Checkbox } from "gpui-base";
import { contrast, isHex, over, statusColor, statusKey, GUARD_MIN } from "./color.js";
import { icon, pipPath, sprite, spritePath, statusGlyphPath } from "./art.js";

/** Minimum text size anywhere in the game (DESIGN §3, §14.3). */
export const MIN_TEXT = 11;

/** Minimum hit area for a clickable (DESIGN §14.4). */
export const MIN_HIT = 28;

/** Header words per status (DESIGN §5.2). */
export const STATUS_WORD = Object.freeze({
  working: "Working",
  blocked: "Needs you",
  done: "Finished",
  idle: "Resting",
  envelope: "Envelope ready",
});

/** Status for a Flock group key. */
export const GROUP_STATUS = Object.freeze({ needs: "blocked", finished: "done", working: "working", resting: "idle" });

function requireId(id, what) {
  if (typeof id !== "string" || id.length === 0) {
    throw new TypeError(`${what} needs a stable, non-empty string id (DESIGN §3); got ${id === undefined ? "undefined" : JSON.stringify(id)}`);
  }
  return id;
}

/** Wraps a click handler: stops propagation first when `stop` is set. */
export function clickHandler(fn, stop = false) {
  return (event, cx) => {
    if (stop && cx && typeof cx.stop_propagation === "function") cx.stop_propagation();
    return fn(event, cx);
  };
}

/** `fg` if it reaches 3:1 on `bg`, else `fallback` (graphics guard for non-status theme colours). */
export function guarded(fg, bg, fallback) {
  return isHex(fg) && isHex(bg) && contrast(fg, bg) >= GUARD_MIN ? fg : fallback;
}

/** An opaque hover colour: `T.hover` (often translucent) composited over `bg`. */
export function hoverOn(T, bg) {
  return isHex(T.hover) && isHex(bg) ? over(T.hover, bg) : bg;
}

// ---------------------------------------------------------------------------
// Text

/**
 * A text run: `opts = { size = 11, weight = 400, color = T.foreground,
 * truncate = false, id }`. Strings must already be clipped with
 * engine `clip()` when `truncate` is set (A2 rule 8).
 */
export function text(str, opts = {}, T = {}, _S = undefined) {
  const size = opts.size ?? MIN_TEXT;
  if (!(size >= MIN_TEXT)) throw new RangeError(`text size ${size} is below the ${MIN_TEXT} px minimum (DESIGN §14.3)`);
  const el = div().text_size(size).font_weight(opts.weight ?? 400).text_color(opts.color ?? T.foreground);
  if (opts.id) el.id(opts.id);
  if (opts.truncate) el.min_w(0).truncate();
  return el.child(String(str));
}

// ---------------------------------------------------------------------------
// Buttons

/**
 * A text button (`Button.new(id)`, unstyled, drawn here). `opts`:
 * `variant` "primary" (T.accent, T.accent_foreground; the affordable buy
 * button) | "secondary" (T.raised, 1 px T.border, T.foreground) | "muted"
 * (T.raised, T.muted text; the unaffordable buy button) | "ghost";
 * `w`, `h` (default 28), `size` (text, default 12), `disabled`, `onClick`,
 * `stop`, `tooltip`, `selected`. Disabled buttons draw as "muted" and do not
 * activate.
 */
export function button(id, label, opts = {}, T, _S = undefined) {
  requireId(id, "button");
  const disabled = Boolean(opts.disabled);
  const variant = disabled ? "muted" : opts.variant ?? "secondary";
  const h = opts.h ?? 28;
  let bg;
  let fg;
  if (variant === "primary") {
    bg = T.accent;
    fg = T.accent_foreground;
  } else if (variant === "muted") {
    bg = T.raised;
    fg = T.muted;
  } else if (variant === "ghost") {
    bg = null;
    fg = T.foreground;
  } else {
    bg = T.raised;
    fg = T.foreground;
  }
  const el = Button.new(id)
    .h(h)
    .min_w(MIN_HIT)
    .px(opts.px ?? 10)
    .flex()
    .items_center()
    .justify_center()
    .rounded(opts.rounded ?? 6)
    .text_size(opts.size ?? 12)
    .font_weight(600)
    .text_color(fg);
  if (opts.w !== undefined) el.w(opts.w);
  if (bg) el.bg(bg);
  if (variant === "secondary") el.border(1).border_color(T.border);
  if (opts.selected !== undefined) el.selected(Boolean(opts.selected));
  if (opts.tooltip) el.tooltip(String(opts.tooltip));
  el.disabled(disabled);
  if (!disabled) {
    el.cursor_pointer();
    if (variant === "primary") el.hover((s) => s.opacity(0.9));
    else el.hover((s) => s.bg(hoverOn(T, bg ?? T.chrome)));
    el.active((s) => s.opacity(0.85));
    if (opts.onClick) el.on_click(clickHandler(opts.onClick, opts.stop));
  }
  return el.child(String(label));
}

/**
 * An icon-only control: a `div#id` hit area (default 28×28, DESIGN §14.4)
 * carrying the tooltip (svg takes none, §13.4) around a ui glyph. `iconName`
 * is a `ui/` sprite name or a full art path. `opts`: `size` (glyph, 16),
 * `hit` (28), `color` (T.muted), `onClick`, `stop`, `badge` (text after the
 * glyph, 11/600), `surface` (for the hover colour; T.chrome).
 */
export function iconButton(id, iconName, tooltip, opts = {}, T, _S = undefined) {
  requireId(id, "iconButton");
  if (typeof tooltip !== "string" || !tooltip) throw new TypeError(`iconButton "${id}" needs a tooltip (it has no text of its own)`);
  const hit = Math.max(opts.hit ?? MIN_HIT, MIN_HIT);
  const path = iconName.includes("/") ? iconName : spritePath("ui", iconName);
  const color = opts.color ?? T.muted;
  const el = h_flex()
    .id(id)
    .min_w(hit)
    .h(hit)
    .justify_center()
    .gap(4)
    .rounded(6)
    .cursor_pointer()
    .tooltip(tooltip)
    .accessibility_label(tooltip)
    .hover((s) => s.bg(hoverOn(T, opts.surface ?? T.chrome)))
    .child(sprite(path, opts.size ?? 16, color));
  if (opts.badge !== undefined && opts.badge !== null) {
    el.child(text(opts.badge, { size: 11, weight: 600, color: opts.badgeColor ?? T.foreground }, T));
  }
  if (opts.onClick) el.on_click(clickHandler(opts.onClick, opts.stop));
  return el;
}

/** A `div#id` that only carries a tooltip around `child` (svg/image take none). */
export function tooltipWrap(id, tooltip, child, _T = undefined, _S = undefined) {
  requireId(id, "tooltipWrap");
  return div().id(id).tooltip(String(tooltip)).child(child);
}

// ---------------------------------------------------------------------------
// Toggles

/**
 * A switch (DESIGN §3.6): `Switch.new(id)` drawn here as a 32×18 track
 * (T.accent on, T.input off) with a 14 px T.foreground knob that moves with
 * `.transition("left", 120)`, then the word "On"/"Off" (11, T.muted).
 * `opts`: `onChange(on, cx)`, `disabled`, `word` (default true).
 */
export function toggle(id, on, opts = {}, T, _S = undefined) {
  requireId(id, "toggle");
  const checked = Boolean(on);
  const disabled = Boolean(opts.disabled);
  const knob = div()
    .id(`${id}-knob`)
    .absolute()
    .top(2)
    .left(checked ? 16 : 2)
    .w(14)
    .h(14)
    .rounded(7)
    .bg(checked ? knobOn(T) : T.foreground)
    .transition("left", 120);
  const track = div()
    .relative()
    .flex_none()
    .w(32)
    .h(18)
    .rounded(9)
    .bg(checked ? T.accent : T.input)
    .child(knob);
  const row = h_flex().gap(6).min_h(MIN_HIT).child(track);
  if (opts.word !== false) row.child(text(checked ? "On" : "Off", { size: 11, color: T.muted }, T));
  const el = Switch.new(id).checked(checked).disabled(disabled);
  if (disabled) el.opacity(0.5);
  else el.cursor_pointer();
  if (opts.onChange && !disabled) el.on_change(opts.onChange);
  if (opts.label) el.accessibility_label(String(opts.label));
  return el.child(row);
}

/**
 * The knob on the accent track: T.foreground or T.accent_foreground, whichever
 * stands out more from T.accent (T.foreground is dark-on-blue in paper and
 * win98, light-on-light-blue in graphite).
 */
export function knobOn(T) {
  const a = T.accent;
  const fg = T.foreground;
  const af = T.accent_foreground;
  if (!isHex(a) || !isHex(af)) return fg;
  if (!isHex(fg)) return af;
  return contrast(af, a) > contrast(fg, a) ? af : fg;
}

/** Alias of `toggle` under the DESIGN name. */
export const switchToggle = toggle;

/**
 * A radio (DESIGN §3.6): a 14 px ring (T.border, guarded to T.muted when the
 * border is under 3:1 on `opts.surface`) holding a 6 px T.accent dot when
 * chosen, then the label (12/400). `opts`: `onSelect(cx)` (only fires when
 * not already chosen), `surface` (default T.chrome), `disabled`.
 */
export function radio(id, chosen, label, opts = {}, T, _S = undefined) {
  requireId(id, "radio");
  const surface = opts.surface ?? T.chrome;
  const ringColor = guarded(isHex(T.border) && isHex(surface) ? over(T.border, surface) : T.border, surface, T.muted);
  const ring = h_flex()
    .flex_none()
    .w(14)
    .h(14)
    .rounded(7)
    .border(1)
    .border_color(ringColor)
    .justify_center();
  if (chosen) ring.child(div().w(6).h(6).rounded(3).bg(T.accent));
  const el = h_flex()
    .id(id)
    .role("radio_button")
    .aria_selected(Boolean(chosen))
    .gap(6)
    .min_h(MIN_HIT)
    .px(4)
    .rounded(6)
    .child(ring)
    .child(text(label, { size: 12, color: T.foreground }, T));
  if (opts.disabled) return el.opacity(0.5);
  el.cursor_pointer().hover((s) => s.bg(hoverOn(T, surface)));
  if (opts.onSelect) {
    const pick = opts.onSelect;
    el.on_click((e, cx) => {
      if (!chosen) pick(cx, e);
    });
  }
  return el;
}

/**
 * A row of radios for one setting: `choices` = `[{ value, label }]`; ids are
 * `${id}-${value}`. `opts.onSelect(value, cx)`.
 */
export function radioGroup(id, choices, value, opts = {}, T, S = undefined) {
  requireId(id, "radioGroup");
  const row = h_flex().id(id).role("radio_group").gap(8).flex_wrap();
  choices.forEach((c, i) => {
    const one = radio(`${id}-${c.value}`, c.value === value, c.label, {
      surface: opts.surface,
      disabled: opts.disabled,
      onSelect: opts.onSelect ? (cx) => opts.onSelect(c.value, cx) : undefined,
    }, T, S);
    one.set_position(i + 1, choices.length);
    row.child(one);
  });
  return row;
}

/**
 * A checkbox (`Checkbox.new(id)`, drawn here): a 14 px box with 1 px ring
 * (guarded like the radio), filled T.accent with a check glyph in
 * T.accent_foreground when checked; then the label. `opts.onChange(checked, cx)`.
 */
export function checkbox(id, checked, label, opts = {}, T, _S = undefined) {
  requireId(id, "checkbox");
  const surface = opts.surface ?? T.chrome;
  const ringColor = guarded(isHex(T.border) && isHex(surface) ? over(T.border, surface) : T.border, surface, T.muted);
  const box = h_flex().flex_none().w(14).h(14).rounded(3).justify_center();
  if (checked) box.bg(T.accent).child(icon("check", 11, T.accent_foreground));
  else box.border(1).border_color(ringColor);
  const el = Checkbox.new(id)
    .checked(Boolean(checked))
    .disabled(Boolean(opts.disabled))
    .child(h_flex().gap(6).min_h(MIN_HIT).child(box).child(text(label, { size: 12, color: T.foreground }, T)));
  if (opts.disabled) el.opacity(0.5);
  else el.cursor_pointer();
  if (opts.onChange && !opts.disabled) el.on_change(opts.onChange);
  return el;
}

// ---------------------------------------------------------------------------
// Chips, bars, headers

/**
 * A pill chip (DESIGN §3.2 item 10, §3.10): height 22, `rounded(11)`, px 8,
 * T.popover, 1 px border (`opts.border`, default S.sheet: separates it from
 * the mat), optional status glyph (`opts.status`, 12 px, colour guarded on
 * T.popover) or ui glyph (`opts.icon`), label 11/600 T.foreground.
 * `opts`: `onClick` (then `id` is required), `stop`, `tooltip`, `dashed`,
 * `pulse` (needs-you loop, DESIGN §13.5), `bg`.
 */
export function chip(id, label, opts = {}, T, S) {
  const clickable = Boolean(opts.onClick);
  if (clickable || opts.tooltip || opts.pulse) requireId(id, "chip");
  const bg = opts.bg ?? T.popover;
  const el = h_flex()
    .h(22)
    .flex_none()
    .px(8)
    .gap(4)
    .rounded(11)
    .bg(bg)
    .border(1)
    .border_color(opts.border ?? (S ? S.sheet : T.border));
  if (id) el.id(clickable ? `${id}-pill` : id);
  if (opts.dashed) el.border_dashed();
  if (opts.status) el.child(sprite(statusGlyphPath(opts.status), 12, statusColor(T, opts.status, bg)));
  else if (opts.icon) el.child(icon(opts.icon, 12, opts.iconColor ?? T.muted));
  if (label !== null && label !== undefined && label !== "") {
    el.child(text(label, { size: 11, weight: 600, color: opts.color ?? T.foreground }, T));
  }
  if (opts.pulse) el.loop("opacity", { from: 0.55, to: 1, period: 1200 });
  if (!clickable) {
    if (opts.tooltip) el.tooltip(String(opts.tooltip));
    return el;
  }
  // The visible pill is 22 tall; the clickable `div#id` around it keeps the
  // 28 px target (DESIGN §14.4) and carries the handler and tooltip.
  const hit = h_flex().id(id).h(MIN_HIT).flex_none().cursor_pointer().on_click(clickHandler(opts.onClick, opts.stop));
  if (opts.tooltip) hit.tooltip(String(opts.tooltip));
  return hit.child(el);
}

/**
 * A progress bar: a `width`×`height` track with a fill whose absolute px
 * width animates with `.transition("width", ms)` (DESIGN §3.2 item 12:
 * streak 96×6, 150 ms; rest bars 600 ms). `fraction` is clamped to 0..1.
 * `opts`: `width` (required, px), `height` (6), `track` (S.grid),
 * `fill` (S.node), `ms` (150), `easing`, `calm` (durations over 150 ms snap).
 * The fill's id is `${id}-fill` (motion identity).
 */
export function progressBar(id, fraction, opts = {}, T, S) {
  requireId(id, "progressBar");
  const width = opts.width;
  if (!(width > 0)) throw new TypeError(`progressBar "${id}" needs opts.width in px (transitions need absolute lengths)`);
  const height = opts.height ?? 6;
  const k = typeof fraction === "number" && fraction === fraction ? Math.max(0, Math.min(1, fraction)) : 0;
  const ms = opts.ms ?? 150;
  const fill = div()
    .id(`${id}-fill`)
    .absolute()
    .top(0)
    .left(0)
    .h(height)
    .w(Math.round(width * k * 10) / 10)
    .rounded(height / 2)
    .bg(opts.fill ?? (S ? S.node : T.accent));
  if (!(opts.calm && ms > 150) && ms > 0) {
    fill.transition("width", opts.easing ? { duration: ms, easing: opts.easing } : ms);
  }
  return div()
    .id(id)
    .relative()
    .flex_none()
    .w(width)
    .h(height)
    .rounded(height / 2)
    .bg(opts.track ?? (S ? S.grid : T.input))
    .child(fill);
}

/**
 * A boost countdown bar (DESIGN §6.2, 48×3). Default: the width of the time
 * left, eased linearly over one data tick (`opts.tickMs`, 1000), the §17 R2
 * fallback. With `opts.native` the fill targets 0 with one linear transition
 * of `msLeft` (render it once at the current width first).
 */
export function countdownBar(id, msLeft, msTotal, opts = {}, T, S) {
  const left = Math.max(0, msLeft || 0);
  const total = msTotal > 0 ? msTotal : 1;
  if (opts.native) {
    return progressBar(id, 0, { width: opts.width ?? 48, height: opts.height ?? 3, fill: opts.fill ?? T.foreground, track: opts.track ?? T.input, ms: Math.max(1, left), easing: "linear" }, T, S);
  }
  return progressBar(id, left / total, { width: opts.width ?? 48, height: opts.height ?? 3, fill: opts.fill ?? T.foreground, track: opts.track ?? T.input, ms: opts.tickMs ?? 1000, easing: "linear" }, T, S);
}

/**
 * A Flock group header (DESIGN §3.3): 24 px row, status glyph 11 px (guarded
 * on `opts.surface`, default T.chrome), title 11/600 (upper-case while open;
 * "● Working 9" when folded), count, and a fold arrow. `key` is the group key
 * (`needs finished working resting elsewhere album`). Clickable when
 * `opts.onToggle(cx)` is given (id required).
 */
export function sectionHeader(id, key, title, count, opts = {}, T, _S = undefined) {
  if (opts.onToggle) requireId(id, "sectionHeader");
  const folded = Boolean(opts.folded);
  const surface = opts.surface ?? T.chrome;
  const status = Object.hasOwn(GROUP_STATUS, key) ? GROUP_STATUS[key] : null;
  const el = h_flex().h(24).gap(6).px(4).flex_none();
  if (id) el.id(id);
  if (status) el.child(sprite(statusGlyphPath(status), 11, statusColor(T, status, surface)));
  else if (key === "elsewhere") el.child(icon("cloud", 11, T.muted));
  const words = folded ? String(title) : String(title).toUpperCase();
  el.child(text(words, { size: 11, weight: 600, color: folded ? T.foreground : T.muted }, T));
  el.child(text(String(count), { size: 11, weight: 600, color: T.foreground }, T));
  el.child(div().flex_1());
  el.child(text(folded ? "▸" : "▾", { size: 11, color: T.muted }, T));
  if (opts.onToggle) {
    const toggleFold = opts.onToggle;
    el.cursor_pointer().hover((s) => s.bg(hoverOn(T, surface))).on_click((e, cx) => toggleFold(cx, e));
  }
  return el;
}

// ---------------------------------------------------------------------------
// Status glyphs

/**
 * A bare status glyph (ribbon pips, rail pips, headers) in the colour guarded
 * against `surface` (a theme key or colour). `opts.spin` (ms, working only).
 */
export function statusGlyph(status, size, surface, opts = {}, T, _S = undefined) {
  const g = svg(statusGlyphPath(status)).w(size).h(size).flex_none().text_color(statusColor(T, status, surface));
  if (opts.spin && status === "working") g.spin(opts.spin === true ? 1200 : opts.spin);
  return g;
}

/**
 * A status badge (DESIGN §3.3): a `size` disc (18; dense 16) in T.popover
 * with a 1 px T.border ring holding the `glyphSize` (12) status glyph in the
 * guarded colour for T.popover. `status` "envelope" draws the envelope
 * marker instead: S.ink glyph (11) on a S.sheet disc (14; dense 12).
 * `opts`: `size`, `glyphSize`, `spin` (true = 1200 ms, or a period; working
 * only), `pulse` (needs-you only: opacity loop 0.55↔1 / 1200 ms), `id`
 * (required with `onClick`), `onClick`, `stop`, `tooltip`.
 */
export function glyph(status, opts = {}, T, S) {
  const envelope = status === "envelope";
  const size = opts.size ?? (envelope ? 14 : 18);
  const glyphSize = opts.glyphSize ?? (envelope ? 11 : 12);
  const discBg = envelope ? S.sheet : T.popover;
  const color = envelope ? S.ink : statusColor(T, status, "popover");
  const g = svg(envelope ? spritePath("status", "envelope") : statusGlyphPath(status)).w(glyphSize).h(glyphSize).text_color(color);
  if (!envelope && opts.spin && status === "working") g.spin(opts.spin === true ? 1200 : opts.spin);
  const el = h_flex()
    .flex_none()
    .w(size)
    .h(size)
    .rounded(size / 2)
    .justify_center()
    .bg(discBg)
    .border(1)
    .border_color(T.border)
    .child(g);
  if (opts.id) el.id(opts.id);
  if (opts.pulse && statusKey(status) === "blocked") el.loop("opacity", { from: 0.55, to: 1, period: 1200 });
  if (opts.tooltip) el.tooltip(String(opts.tooltip));
  if (opts.onClick) {
    requireId(opts.id, "glyph");
    el.cursor_pointer().on_click(clickHandler(opts.onClick, opts.stop));
  }
  return el;
}

/** A fledgling pip (DESIGN §3.3): `size` (6; dense 4) diamond/triangle; colour `hue`, triangle guarded `blocked`. */
export function pip(status, size, hue, surface, T, _S = undefined) {
  const color = status === "blocked" || status === "needs" ? statusColor(T, "blocked", surface) : hue;
  return svg(pipPath(status)).w(size).h(size).flex_none().text_color(color);
}

// ---------------------------------------------------------------------------
// Floating numbers

/**
 * A floating "+N" (DESIGN §13.5): 12/600 S.onMat at (x, y) in mat px; when
 * `risen` it targets y − 28 and opacity 0, both with 700 ms transitions.
 * `id` keeps the motion identity across the flip.
 */
export function pop(id, label, x, y, risen, _T = undefined, S) {
  requireId(id, "pop");
  return div()
    .id(id)
    .absolute()
    .left(x)
    .top(risen ? y - 28 : y)
    .opacity(risen ? 0 : 1)
    .transition("top", 700)
    .transition("opacity", 700)
    .text_size(12)
    .font_weight(600)
    .text_color(S.onMat)
    .whitespace_nowrap()
    .child(String(label));
}

// ---------------------------------------------------------------------------
// Layout helpers

/** A 1 px divider in T.border (`vertical` for a column rule). */
export function divider(T, vertical = false) {
  return vertical ? div().w(1).h_full().flex_none().bg(T.border) : div().h(1).w_full().flex_none().bg(T.border);
}

/** A labelled settings row (DESIGN §3.6): label 12/400 + help 11 T.muted on the left, `control` right; 36 px tall. */
export function settingRow(id, label, help, control, T, _S = undefined) {
  const left = v_flex().flex_1().min_w(0).child(text(label, { size: 12, color: T.foreground }, T));
  if (help) left.child(text(help, { size: 11, color: T.muted, truncate: true }, T));
  const row = h_flex().min_h(36).gap(8).child(left);
  if (id) row.id(id);
  if (control) row.child(control);
  return row;
}

/**
 * Every builder with `T` and `S` bound: `const w = kit(T, S); w.button(id, label, opts)`.
 */
export function kit(T, S) {
  return Object.freeze({
    T,
    S,
    text: (str, opts) => text(str, opts, T, S),
    button: (id, label, opts) => button(id, label, opts, T, S),
    iconButton: (id, name, tip, opts) => iconButton(id, name, tip, opts, T, S),
    tooltipWrap: (id, tip, child) => tooltipWrap(id, tip, child, T, S),
    toggle: (id, on, opts) => toggle(id, on, opts, T, S),
    radio: (id, chosen, label, opts) => radio(id, chosen, label, opts, T, S),
    radioGroup: (id, choices, value, opts) => radioGroup(id, choices, value, opts, T, S),
    checkbox: (id, checked, label, opts) => checkbox(id, checked, label, opts, T, S),
    chip: (id, label, opts) => chip(id, label, opts, T, S),
    progressBar: (id, fraction, opts) => progressBar(id, fraction, opts, T, S),
    countdownBar: (id, msLeft, msTotal, opts) => countdownBar(id, msLeft, msTotal, opts, T, S),
    sectionHeader: (id, key, title, count, opts) => sectionHeader(id, key, title, count, opts, T, S),
    statusGlyph: (status, size, surface, opts) => statusGlyph(status, size, surface, opts, T, S),
    glyph: (status, opts) => glyph(status, opts, T, S),
    pip: (status, size, hue, surface) => pip(status, size, hue, surface, T, S),
    pop: (id, label, x, y, risen) => pop(id, label, x, y, risen, T, S),
    divider: (vertical) => divider(T, vertical),
    settingRow: (id, label, help, control) => settingRow(id, label, help, control, T, S),
  });
}

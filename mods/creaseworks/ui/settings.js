// Settings, in the content area (DESIGN §3.6, §8, §11, §12):
// `renderSettings(vm, ui, ctx)` (ARCHITECTURE B11). Returns one element sized
// to its content at full width (8 px side padding); the panel wraps it in the
// scrolling `#cw-content` and shows "← Back" in the tabs row.
//
// Sections in §3.6 order: Calm mode, Notifications (master switch, three event
// checkboxes, "n of 3 sent today"), Automations (one switch per owned one),
// Play, Roster (order, density), Number style, Save (path middle-truncated,
// status, Check save now, Restore backup… two-step, Share a save…), Reset
// game… (two-step). Both two-step confirms arm 1.5 s after the card appears
// (`ui.armedAt` / `ui.now`, as the String tab's wish). Rows are 36 px: label
// 12/400 and a help line 11 T.muted, the control on the right.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { clip } from "../engine/index.js";
import { statusColor } from "./color.js";
import { icon } from "./art.js";
import { button, checkbox, divider, radioGroup, settingRow, text, toggle } from "./widgets.js";
import { middleClip } from "./banner.js";
import { isArmed, ARM_MS } from "./string.js";

/** Grapheme limits for every string this module draws (tested). */
export const SETTINGS_CLIP = Object.freeze({ path: 44, line: 60, name: 22, help: 60, damaged: 60 });

/** Choices of the radio settings (values are the vm's / B4 settings values). */
export const CHOICES = Object.freeze({
  order: Object.freeze([
    Object.freeze({ value: "urgency", label: "Urgency groups" }),
    Object.freeze({ value: "workspace", label: "Workspace order" }),
  ]),
  density: Object.freeze([
    Object.freeze({ value: "auto", label: "Auto" }),
    Object.freeze({ value: "always", label: "Always" }),
    Object.freeze({ value: "never", label: "Never" }),
  ]),
  style: Object.freeze([
    Object.freeze({ value: "short", label: "Short (12.4K)" }),
    Object.freeze({ value: "sci", label: "Scientific (1.24e4)" }),
  ]),
});

const EVENTS = Object.freeze([
  Object.freeze({ key: "full", label: "Your string is full" }),
  Object.freeze({ key: "pile", label: "Envelopes are piling up" }),
  Object.freeze({ key: "save", label: "Creaseworks can't save" }),
]);

function handler(ctx, name) {
  const h = ctx && ctx.handlers;
  const f = h && typeof h[name] === "function" ? h[name] : null;
  return (...args) => (f ? f(...args) : undefined);
}

const num = (v, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

function heading(id, words, T) {
  return text(words, { size: 11, weight: 600, color: T.muted, id }, T).pt(10).pb(2);
}

function switchRow(id, label, help, on, opts, ctx) {
  const T = ctx.T;
  const control = toggle(id, Boolean(on), { label, disabled: opts.disabled, onChange: opts.onChange }, T);
  return settingRow(`${id}-row`, label, help ? clip(help, SETTINGS_CLIP.help) : null, control, T);
}

function radioBlock(id, label, help, choices, value, ctx) {
  const T = ctx.T;
  const setting = handler(ctx, "setting");
  const key = id.slice("cw-set-".length);
  return v_flex()
    .id(`${id}-block`)
    .w_full()
    .child(settingRow(null, label, help, null, T))
    .child(radioGroup(id, choices, value, { onSelect: (v, cx) => setting(key, v, cx) }, T));
}

/** A two-step confirm card (restore / reset), armed after ARM_MS. */
function confirmCard(id, title, body, yes, onYes, ui, ctx) {
  const T = ctx.T;
  const cancel = handler(ctx, "cancel");
  const armed = isArmed(ui);
  const wait = ui && typeof ui.armedAt === "number" && typeof ui.now === "number" ? Math.max(0, ARM_MS - (ui.now - ui.armedAt)) : ARM_MS;
  return v_flex()
    .id(`${id}-card`)
    .w_full()
    .p(12)
    .gap(4)
    .rounded(8)
    .bg(T.popover)
    .border(1)
    .border_color(T.accent)
    .child(text(title, { size: 12, weight: 600, color: T.foreground }, T))
    .child(text(body, { size: 11, color: T.muted }, T).whitespace_normal())
    .child(
      h_flex()
        .gap(8)
        .pt(4)
        .child(button(`${id}-cancel`, "Keep folding", { h: 28, size: 12, onClick: (e, cx) => cancel(cx) }, T))
        .child(div().flex_1())
        .child(button(`${id}-confirm`, yes, {
          variant: "primary",
          h: 28,
          size: 12,
          disabled: !armed,
          tooltip: armed ? yes : `Ready in ${Math.max(1, Math.ceil(wait / 1000))} s`,
          onClick: (e, cx) => onYes(cx),
        }, T)),
    );
}

function saveSection(vm, ui, ctx) {
  const T = ctx.T;
  const save = (ctx && ctx.save) || {};
  const checkSave = handler(ctx, "checkSave");
  const confirm = handler(ctx, "confirm");
  const restoreBackup = handler(ctx, "restoreBackup");
  const cancel = handler(ctx, "cancel");
  const box = v_flex().id("cw-set-save").w_full().gap(4);
  box.child(heading("cw-set-h-save", "SAVE", T));
  const path = str(save.path);
  box.child(
    text(path ? middleClip(path, SETTINGS_CLIP.path) : "Save file: in herdr's app data", { size: 11, color: T.foreground, id: "cw-set-save-path" }, T)
      .tooltip(clip(path || "<herdr app home>/data/creaseworks/save.json", 140)),
  );
  const parts = [str(save.text) || (save.state === "saving" ? "Saving…" : save.state === "problem" ? "Save problem: see the banner" : "Saved")];
  if (typeof save.backup === "string" && save.backup) parts.push(`backup ${save.backup}`);
  else if (save.backup === false || save.backup === null) parts.push("no backup yet");
  const status = h_flex().gap(6).min_w(0);
  if (save.state === "problem") status.child(icon("warn", 12, statusColor(T, "blocked", "chrome")));
  status.child(text(clip(parts.join(" · "), SETTINGS_CLIP.line), { size: 11, color: T.muted, truncate: true }, T));
  box.child(status);
  const damaged = Array.isArray(save.damaged) ? save.damaged.filter((d) => typeof d === "string") : [];
  if (damaged.length) {
    box.child(text(clip(`Damaged copies kept: ${damaged.join(", ")}`, SETTINGS_CLIP.damaged), { size: 11, color: T.muted, truncate: true }, T));
  }
  const restoring = ui && ui.confirm === "restore";
  box.child(
    h_flex()
      .gap(6)
      .flex_wrap()
      .pt(2)
      .child(button("cw-set-check", "Check save now", { h: 28, size: 12, onClick: (e, cx) => checkSave(cx) }, T))
      .child(button("cw-set-restore", "Restore backup…", {
        h: 28,
        size: 12,
        disabled: save.backup === false || restoring,
        onClick: (e, cx) => confirm("restore", cx),
      }, T)),
  );
  if (restoring) {
    box.child(confirmCard(
      "cw-set-restore",
      "Restore the backup?",
      "The current save is kept as a damaged copy (reason \"restore\"), then the backup is loaded.",
      "Restore",
      (cx) => restoreBackup(cx),
      ui,
      ctx,
    ));
  }
  const sharing = ui && ui.confirm === "share";
  box.child(
    button("cw-set-share", "Share a save with another herdr home…", {
      variant: "ghost",
      h: 28,
      size: 12,
      px: 4,
      tooltip: "Save to another window's save.json (writes only location.json here)",
      // Opens the share card; it never sends this window's own path (that
      // would only answer "already saves there").
      onClick: (e, cx) => (sharing ? cancel(cx) : confirm("share", cx)),
    }, T),
  );
  if (sharing) box.child(shareCard(save, ctx));
  return box;
}

/**
 * The share card (DESIGN §12.5): pick window A's …/data/creaseworks/save.json
 * (`handlers.pickSharePath`: the glue opens the file picker and hands the
 * chosen absolute path to `sharePath`), or stop sharing (`sharePath("")`, this
 * window's own save again; shown only when `ctx.save.shared === true`).
 */
function shareCard(save, ctx) {
  const T = ctx.T;
  const h = ctx && ctx.handlers;
  const canPick = Boolean(h && typeof h.pickSharePath === "function");
  const pickSharePath = handler(ctx, "pickSharePath");
  const sharePath = handler(ctx, "sharePath");
  const cancel = handler(ctx, "cancel");
  const card = v_flex()
    .id("cw-set-share-card")
    .w_full()
    .p(12)
    .gap(4)
    .rounded(8)
    .bg(T.popover)
    .border(1)
    .border_color(T.accent)
    .child(text("Share a save with another herdr home", { size: 12, weight: 600, color: T.foreground }, T))
    .child(
      text("Choose the other window's save.json (its path is under Save in that window's Settings). This window then plays and saves that game; only location.json is written here.", { size: 11, color: T.muted }, T)
        .whitespace_normal(),
    );
  const row = h_flex().gap(6).flex_wrap().pt(4);
  row.child(button("cw-set-share-pick", "Choose save.json…", {
    variant: "primary",
    h: 28,
    size: 12,
    disabled: !canPick,
    tooltip: canPick ? "Opens the file picker" : "The file picker is not available in this window",
    onClick: (e, cx) => pickSharePath(cx),
  }, T));
  if (save.shared === true) {
    row.child(button("cw-set-share-stop", "Stop sharing", {
      h: 28,
      size: 12,
      tooltip: "Back to this window's own save (location.json cleared)",
      onClick: (e, cx) => sharePath("", cx),
    }, T));
  }
  row.child(div().flex_1());
  row.child(button("cw-set-share-cancel", "Close", { variant: "ghost", h: 28, size: 12, px: 6, onClick: (e, cx) => cancel(cx) }, T));
  return card.child(row);
}

/** The Settings content. Pure (B11). */
export function renderSettings(vm, ui, ctx) {
  const T = ctx.T;
  const s = (vm && vm.settings) || {};
  const setting = handler(ctx, "setting");
  const switchAuto = handler(ctx, "switchAuto");
  const confirm = handler(ctx, "confirm");
  const resetGame = handler(ctx, "resetGame");
  const calm = s.calm === true;
  const notify = s.notify && typeof s.notify === "object" ? s.notify : {};
  const master = notify.master === true;
  const sent = Math.max(0, Math.min(3, Math.round(num(s.notifySentToday))));

  const root = v_flex().id("cw-set").w_full().px(8).pt(2).pb(12);

  // 1. Calm mode
  root.child(heading("cw-set-h-calm", "CALM MODE", T));
  root.child(switchRow("cw-set-calm", "Calm mode", "No motion or floating numbers; same earnings", calm, {
    onChange: (on, cx) => setting("calm", Boolean(on), cx),
  }, ctx));

  // 2. Notifications
  root.child(heading("cw-set-h-notify", "NOTIFICATIONS", T));
  const notifyText = str(s.notifyText) || `${sent} of 3 sent today`;
  root.child(switchRow("cw-set-notify-master", "Notifications", `${notifyText} · never for agent status`, master, {
    onChange: (on, cx) => setting("notify.master", Boolean(on), cx),
  }, ctx));
  const events = v_flex().id("cw-set-notify-events").pl(12);
  for (const ev of EVENTS) {
    events.child(checkbox(`cw-set-notify-${ev.key}`, master && notify[ev.key] !== false, ev.label, {
      disabled: !master,
      onChange: (checked, cx) => setting(`notify.${ev.key}`, Boolean(checked), cx),
    }, T));
  }
  root.child(events);

  // 3. Automations
  root.child(heading("cw-set-h-auto", "AUTOMATIONS", T));
  const autos = (Array.isArray(s.automations) ? s.automations : []).filter((a) => a && a.owned === true && typeof a.id === "string");
  if (autos.length) {
    for (const a of autos) {
      root.child(switchRow(`cw-set-auto-${a.id}`, clip(str(a.name), SETTINGS_CLIP.name), null, a.on === true, {
        onChange: (on, cx) => switchAuto(a.id, Boolean(on), cx),
      }, ctx));
    }
  } else {
    root.child(text("None bought yet: find them in Shop → Auto.", { size: 11, color: T.muted }, T).py(4));
  }

  // 4. Play
  root.child(heading("cw-set-h-play", "PLAY", T));
  root.child(switchRow("cw-set-gather", "Helpers gather", "Off: the flock is a status board only", s.gather !== false, {
    onChange: (on, cx) => setting("gather", Boolean(on), cx),
  }, ctx));
  root.child(switchRow("cw-set-nodes", "Crease nodes appear", "Numbered nodes to click in order", s.nodes !== false, {
    onChange: (on, cx) => setting("nodes", Boolean(on), cx),
  }, ctx));
  const popsDisabled = calm || s.popsDisabled === true;
  root.child(switchRow("cw-set-pops", "Floating numbers", popsDisabled ? "Off in calm mode" : "+N over the mat when you fold", !popsDisabled && s.pops !== false, {
    disabled: popsDisabled,
    onChange: (on, cx) => setting("pops", Boolean(on), cx),
  }, ctx));

  // 5. Roster
  root.child(heading("cw-set-h-roster", "ROSTER", T));
  root.child(radioBlock("cw-set-order", "Order", "Workspace order follows herdr's sidebar", CHOICES.order, s.order === "workspace" ? "workspace" : "urgency", ctx));
  root.child(radioBlock("cw-set-density", "Dense tiles", "Auto: dense at 21+ helpers or when narrow", CHOICES.density,
    s.density === "always" || s.density === "never" ? s.density : "auto", ctx));

  // 6. Number style
  root.child(heading("cw-set-h-style", "NUMBER STYLE", T));
  root.child(radioGroup("cw-set-style", CHOICES.style, s.style === "sci" ? "sci" : "short", {
    onSelect: (v, cx) => setting("style", v, cx),
  }, T));

  // 7. Save
  root.child(saveSection(vm, ui, ctx));

  // 8. Reset
  root.child(div().h(10));
  root.child(divider(T));
  const resetting = ui && ui.confirm === "reset";
  root.child(
    settingRow(
      "cw-set-reset-row",
      "Reset game…",
      "Starts over; the old save is kept as a damaged copy",
      button("cw-set-reset", "Reset…", { h: 28, size: 12, disabled: resetting, onClick: (e, cx) => confirm("reset", cx) }, T),
      T,
    ),
  );
  if (resetting) {
    root.child(confirmCard(
      "cw-set-reset",
      "Reset the game?",
      "Folds, workshops, upgrades, Wishes and helpers' history start over. The old save is kept as save.damaged-<n>.json (reason \"reset\").",
      "Reset",
      (cx) => resetGame(cx),
      ui,
      ctx,
    ));
  }
  return root;
}

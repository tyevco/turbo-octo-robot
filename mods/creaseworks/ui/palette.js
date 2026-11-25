// Every colour literal of Creaseworks (DESIGN §13.2): scene tokens `S` and
// helper identity hues `Hue`, light and dark. UI and status colours come from
// herdr's theme() (`T`), never from here. test/ui/foundation.test.mjs
// validates every literal and recomputes every contrast ratio §13.2 claims.
// Module scope holds frozen literals only (ARCHITECTURE A2 rule 2).

const f = Object.freeze;

/** Scene tokens, light appearance. */
export const S_LIGHT = f({
  mat: "#2f6a55",
  matEdge: "#24523f",
  grid: "#ffffff1f",
  gridMajor: "#ffffff38",
  sheet: "#fbf7ee",
  sheetShade: "#e6dcc6",
  crease: "#c9b994",
  ink: "#22302c",
  onMat: "#ffffff",
  node: "#f2b134",
  gold: "#f0c24b",
  goldShade: "#c99a2e",
  goldInk: "#4a3500",
});

/** Scene tokens, dark appearance (the sheet is dimmed to avoid glare). */
export const S_DARK = f({
  mat: "#1d3a32",
  matEdge: "#14291f",
  grid: "#ffffff14",
  gridMajor: "#ffffff24",
  sheet: "#d9d1c0",
  sheetShade: "#bfb39b",
  crease: "#a8996f",
  ink: "#1d2724",
  onMat: "#f4f1ea",
  node: "#e9b93f",
  gold: "#e9b93f",
  goldShade: "#c39a2c",
  goldInk: "#3d2c00",
});

/** `S.light` / `S.dark`; pick one with `pickScene(settings().dark)`. */
export const S = f({ light: S_LIGHT, dark: S_DARK });

/** Hue names by index (identity, never status). Same order as engine CONTENT.HUES. */
export const HUE_NAMES = f(["vermilion", "saffron", "leaf", "teal", "sky", "violet", "plum", "slate"]);

/** Helper identity hues for light themes (≥ 4.0:1 on raised and chrome of paper and win98). */
export const HUE_LIGHT = f(["#b8432a", "#946000", "#3b7330", "#1d7373", "#2b62b0", "#6a4cb0", "#9c3a72", "#4c5a68"]);

/** Helper identity hues for dark themes (≥ 4.0:1 on raised and chrome of the four dark themes). */
export const HUE_DARK = f(["#f08b6e", "#e3b04b", "#8fcc72", "#5ccaca", "#80aef2", "#b49cf0", "#ee8fc0", "#a9b5c2"]);

/** `Hue.light` / `Hue.dark`; pick one with `pickHues(settings().dark)`. */
export const Hue = f({ light: HUE_LIGHT, dark: HUE_DARK });

/** The two literals of the one full-colour file, art/notify-icon.svg (§13.3). */
export const NOTIFY_ICON = f({ crane: "#fbf7ee", mat: "#2f6a55" });

/** Scene tokens for the current appearance. */
export function pickScene(dark) {
  return dark ? S_DARK : S_LIGHT;
}

/** Identity hues for the current appearance (index with `tile.hue`, 0..7). */
export function pickHues(dark) {
  return dark ? HUE_DARK : HUE_LIGHT;
}

/** One hue by index, wrapping out-of-range or bad indexes to a valid one. */
export function hueOf(hues, i) {
  const n = Number.isInteger(i) ? i : 0;
  return hues[((n % 8) + 8) % 8];
}

// herdr-app 0.1.18 `src/settings.rs` theme resolution, ported exactly (f32 arithmetic
// included, via Math.fround) so the mock's `theme()` matches the app colour for colour.
//   palettes     src/settings.rs:31-77 (presets), defaults/themes/*.json (shipped files)
//   is_light     src/settings.rs:265-268
//   mix / hex    src/settings.rs:289-298
//   resolve      src/settings.rs:306-363
// `themes.json` is this module's output for every preset and shipped theme; the tooling
// tests regenerate it and compare. Plain ES module, no imports (Node and QuickJS).

const f = Math.fround;

const DARK_STATUS = [0xe5c07b, 0xf0705f, 0x76a8ff];

export const PALETTES = {
  graphite: {
    background: 0x17191d, foreground: 0xd2d4d9, selection: 0x394454, cursor: null, status: DARK_STATUS,
    ansi: [0x45484f, 0xdc8c95, 0xa6bd91, 0xd8be87, 0x96b2d7, 0xb5a2ce, 0x8cbdc3, 0xd2d4d9, 0x818793, 0xf0a5ad, 0xbad5a2, 0xead2a1, 0xb0cbef, 0xcbb7e6, 0xa4d5db, 0xf0f0f2],
    colors: {},
  },
  ink: {
    background: 0x111720, foreground: 0xcdd6e4, selection: 0x344861, cursor: null, status: DARK_STATUS,
    ansi: [0x414b5a, 0xe58c9a, 0x89c5aa, 0xd9be82, 0x91b6ee, 0xb9a0e2, 0x85c4d0, 0xcdd6e4, 0x7f91a7, 0xf5a5b2, 0xa5dec3, 0xedd39c, 0xaccbfa, 0xd0b7f4, 0xa0dce5, 0xf0f5fc],
    colors: {},
  },
  moss: {
    background: 0x151c19, foreground: 0xcdd7ce, selection: 0x354a40, cursor: null, status: DARK_STATUS,
    ansi: [0x435248, 0xdf978d, 0xa0c4a2, 0xd4bc8b, 0x99b9cd, 0xbba4c8, 0x8bbdb5, 0xcdd7ce, 0x82968a, 0xf1afa3, 0xb8dab9, 0xe9d2a5, 0xb1d0e2, 0xd1bddc, 0xa4d6ca, 0xeff5ee],
    colors: {},
  },
  paper: {
    background: 0xffffff, foreground: 0x25272c, selection: 0xcfdcf5, cursor: 0x25272c, status: [0x9a6700, 0xc93c2c, 0x2f6fe4],
    ansi: [0x25272c, 0xc62a2a, 0x1a7f37, 0x8f5d00, 0x1f62d0, 0x7a45c8, 0x0f6f74, 0x5f6068, 0x7b7e87, 0xd1242f, 0x1f883d, 0x9a6700, 0x0969da, 0x8250df, 0x1b7c83, 0x111214],
    colors: {},
  },
  // Shipped theme files (defaults/themes): status comes from ansi (status: null).
  "atom-one-dark": {
    background: 0x21252b, foreground: 0xabb2bf, selection: 0x323844, cursor: 0xabb2bf, status: null,
    ansi: [0x454c59, 0xe06c75, 0x98c379, 0xe5c07b, 0x61afef, 0xc678dd, 0x56b6c2, 0xabb2bf, 0x767676, 0xe06c75, 0x98c379, 0xe5c07b, 0x61afef, 0xc678dd, 0x56b6c2, 0xabb2bf],
    colors: {},
  },
  win98: {
    background: 0xffffff, foreground: 0xc0c0c0, selection: 0x000080, cursor: 0xc0c0c0, status: null,
    ansi: [0x555555, 0xaa0000, 0x00aa00, 0xaa5500, 0x0000bb, 0xaa00aa, 0x00aaaa, 0xaaaaaa, 0x555555, 0xff5555, 0x55ff55, 0xffff55, 0x5555ff, 0xff55ff, 0x55ffff, 0xffffff],
    colors: {
      background: "#000000", foreground: "#000000", surface: "#c0c0c0", popover: "#c0c0c0", raised: "#dfdfdf",
      hover: "#dfdfdf", border: "#808080", input: "#ffffff", muted: "#404040", dim: "#808080", accent: "#000080",
      accent_foreground: "#ffffff", ring: "#000000", working: "#808000", blocked: "#ff0000", done: "#0000ff",
      idle: "#808080", unknown: "#808080",
    },
  },
};

/** `settings::PRESETS` then the shipped theme files, in `themes()` order (files sorted). */
export const THEME_NAMES = ["graphite", "ink", "moss", "paper", "atom-one-dark", "win98"];

/** `is_light`: f32 luminance of the background over 0.5. */
export function isLight(c) {
  const ch = (s) => f(f((c >>> s) & 255) / f(255));
  const y = f(f(f(f(0.2126) * ch(16)) + f(f(0.7152) * ch(8))) + f(f(0.0722) * ch(0)));
  return y > f(0.5);
}

/** `hex`: `#rrggbb`. */
export function hex(c) {
  return "#" + (c >>> 0).toString(16).padStart(6, "0");
}

/** `mix(a, b, t)`, per channel in f32, rounded half away from zero. */
export function mix(a, b, t) {
  const tf = f(t);
  const one = f(f(1) - tf);
  let acc = 0;
  for (const s of [16, 8, 0]) {
    const x = f((a >>> s) & 255);
    const y = f((b >>> s) & 255);
    const v = f(f(x * one) + f(y * tf));
    acc |= Math.round(v) << s; // v >= 0, so JS round (half up) = Rust round (half away from zero)
  }
  return acc >>> 0;
}

/** `resolve(palette, overrides)`: every theme colour by name, keys sorted like a BTreeMap. */
export function resolve(p, overrides = {}) {
  const bg = p.background;
  const light = isLight(bg);
  const fg = light ? 0x1b1b1e : 0xeeeeef;
  const [working, blocked, done] = p.status ?? [p.ansi[3], p.ansi[1], p.ansi[4]];
  let popover, raised, hover, selected, border, input, canvas, chrome;
  if (light) {
    const warm = 0xe8e8e2;
    [popover, raised, hover, selected, border, input, canvas, chrome] =
      [hex(bg), hex(mix(bg, 0, 0.035)), "#0000000c", "#00000012", "#00000017", "#00000026", mix(bg, warm, 0.2), mix(bg, warm, 0.6)];
  } else {
    [popover, raised, hover, selected, border, input, canvas, chrome] =
      [hex(mix(bg, 0xffffff, 0.06)), hex(mix(bg, 0xffffff, 0.09)), "#ffffff0e", "#ffffff17", "#ffffff18", "#ffffff24", mix(bg, 0, 0.16), mix(bg, 0, 0.32)];
  }
  const t = new Map([
    ["background", hex(bg)],
    ["terminal_foreground", hex(p.foreground)],
    ["foreground", hex(fg)],
    ["surface", hex(bg)],
    ["canvas", hex(canvas)],
    ["chrome", hex(chrome)],
    ["popover", popover],
    ["raised", raised],
    ["hover", hover],
    ["selected", selected],
    ["border", border],
    ["input", input],
    ["muted", hex(mix(bg, fg, light ? 0.66 : 0.6))],
    ["dim", hex(mix(bg, fg, light ? 0.46 : 0.38))],
    ["accent", hex(p.ansi[4])],
    ["accent_foreground", hex(bg)],
    ["solid", hex(fg)],
    ["solid_foreground", hex(light ? 0xffffff : mix(bg, 0, 0.28))],
    ["ring", hex(mix(bg, fg, 0.7))],
    ["selection", hex(p.selection)],
    ["cursor", hex(p.cursor ?? p.foreground)],
    ["working", hex(working)],
    ["blocked", hex(blocked)],
    ["done", hex(done)],
    ["idle", hex(mix(bg, fg, 0.38))],
    ["unknown", hex(mix(bg, fg, 0.38))],
  ]);
  p.ansi.forEach((c, i) => t.set(`ansi${i}`, hex(c)));
  for (const k of Object.keys(overrides)) t.set(k, overrides[k]);
  return sortedObject(t);
}

/** Rust's BTreeMap<String, _> order: byte-wise, which for these ASCII keys is code-unit order. */
function sortedObject(map) {
  const keys = [...map.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(keys.map((k) => [k, map.get(k)]));
}

/** A theme by name, with settings/layout colour overrides on top (`settings::set`). */
export function resolveNamed(name, colors = {}) {
  const p = PALETTES[name] ?? PALETTES.graphite; // unknown theme: graphite, as settings::set does
  return resolve(p, { ...p.colors, ...colors });
}

/** Every theme for `herdr.themes()`: `{ light, name, colors }`. */
export function allThemes() {
  return THEME_NAMES.map((name) => ({ light: isLight(PALETTES[name].background), name, colors: resolveNamed(name) }));
}

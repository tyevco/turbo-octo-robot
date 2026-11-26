# Third-party notices

Creaseworks itself (the game, its art and its mod code under `mods/creaseworks/`, the docs and most of the tooling) is MIT, Copyright (c) 2026 Tyler Coles: see [LICENSE](LICENSE).

The files below hold material taken from **herdr-app 0.1.18** (herdr.dev), which is licensed under the Apache License, Version 2.0. herdr ships no NOTICE file. The full licence text is in [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt). These parts stay under Apache-2.0; the rest of each file listed as "changed" or "port" is this repo's work under MIT.

Everything except `layouts/Creaseworks.json` is development-only reference data and tooling. None of it is part of the installed mod.

## Copied unchanged

| File | Taken from herdr-app 0.1.18 |
|---|---|
| `tools/layout/main.json` | `defaults/layouts/main.json`, byte for byte (test/layout checks this against a herdr checkout) |

## Copied data, rearranged

| File | Taken from herdr-app 0.1.18 | What was changed |
|---|---|---|
| `tools/layout/herdr-defaults.json` | `src/keys.rs` (`DEFAULTS`, `SHIPPED_KEYS`, `SHIPPED_MACOS_KEYS`) and the folder names under `defaults/mods` | Collected into one JSON file with an `about` note |
| `tools/mock/themes.json` | The theme presets in `src/settings.rs` and the shipped theme files in `defaults/themes/*.json` | Resolved to final colours by `tools/mock/theme-resolve.js` (a port of `src/settings.rs` theme resolution) |
| `tools/mock/commands.js` | The command table in `src/commands.rs` (`COMMANDS`) | Rewritten as a JavaScript table, with a port of the argument checks |
| `tools/render/window.mjs` (`MAIN_LAYOUT`) | `defaults/layouts/main.json` | Embedded as a JavaScript object |

## Adapted

| File | Adapted from | What was changed |
|---|---|---|
| `layouts/Creaseworks.json` | herdr-app 0.1.18 `defaults/layouts/main.json` | Built by `tools/layout/build.mjs`, which lists every change: a `preview` field, `"min": 80` on `main`, the Files column `panel` sized `{"weight": 0.66}` instead of `{"px": 368}` with min 160 instead of 280 and no max (herdr's is 900), and two added blocks, `cw-panel` and `cw-ribbon`. Every other node and field is herdr's. |

## Ports of herdr behaviour

These JavaScript files follow named herdr source files closely so the tests behave like the app. Each names the herdr file it follows in its header comment.

- `tools/qjs/sandbox.js`: `vendor/gpui-kit/crates/shell/src/engine/quickjs/sandbox.rs` (gpui-kit, Apache-2.0, Copyright 2024 - 2026 Longbridge).
- `tools/qjs/harness.mjs`, `tools/mock/herdr.js`, `tools/mock/controller.js`, `tools/mock/gpui-core.js`, `tools/render/html.mjs`, `tools/render/window.mjs` (`shares`, `layoutBoxes`), `tools/mock/theme-resolve.js` and `tools/layout/schema.mjs`: herdr-app's `src/` and its vendored gpui-kit and gpui (`vendor/gpui-pre`, Apache-2.0, Copyright 2022 - 2025 Zed Industries, Inc.).

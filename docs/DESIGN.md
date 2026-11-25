# Creaseworks: final design spec

Status: **final** (lead designer synthesis of `docs/design-proposals/{art,fun,fit}.md` and three
judges' verdicts). Platform: herdr-app v0.1.18, QuickJS-ng, gpui-kit. Every platform claim cites
the research notes (`host-api §6` = `docs/research/host-api.md` section 6; `gpui §9`, `life §6`,
`qjs §2`, `share §10`, `pat §2` likewise). Save, merge and handover follow
`docs/ARCHITECTURE.md` A4–A6 exactly; where this spec says "A5" it means that contract.
Every number the pacing simulator checks is repeated in `docs/BALANCE.md`; the two files must
change together.

**How the proposals were combined.** Judge totals (normalised to a 60-point scale): art.md
(Foldwick) 139.2, fun.md (Creaseworks) 134.2, fit.md (Weftwork) 134.0. The base is therefore
**Foldwick's** design: right panel that folds to a rail, single-colour SVG art, the status-shape
system, the contrast guard, per-helper envelope stacking and the economy tables. Grafted on top:
from fun.md the always-visible **ribbon**, **"In step"** (clicking multiplies the flock), sealed
envelopes the player chooses when to open, the **String of a thousand cranes**, the Fresh Ream,
the best-buy dot, the arming delay and the robustness profiles; from fit.md the **zero
steady-state loop budget**, **afterglow** (short check-ins matter late), the counts chip, the
**garland memento** (tapestry), time-to-afford, the roster-order setting and the greyscale tests.
Every fatal flaw and must-fix item the judges raised is closed; §16 lists where.

Licence: MIT, `Copyright (c) 2026 Tyler Coles` (repo `LICENSE`, also stated in `RECIPE.md` and
`README.md`).

---

## Contents

1. Name, theme and why
2. Placement in the window, and keys
3. Views (with wireframes)
4. Clicking
5. Helpers and statuses
6. Rewards and boosts
7. Economy tables
8. Automations and switches
9. Prestige: String the Thousand
10. Offline and the away summary
11. Settings
12. Saving and handover (what the player sees)
13. Art direction, palette, assets, animation
14. Accessibility
15. Build hooks (engine actions, views, tests)
16. Judges' must-fix items: where each is closed
17. Appendix: open risks

---

## 1. Name, theme and why

| Item | Value |
|---|---|
| Game name | **Creaseworks** |
| Pitch | *A paper workshop on the corner of your desk. You fold by hand; your agents, folded paper folk, fold beside you.* |
| Mod folder | `mods/creaseworks/` (lower case, no `.`, not `frame-*`: `<mod>.<cmd>` splits at the first dot, share §4) |
| Layout file | `layouts/Creaseworks.json` (stem matches `valid_name`; shows as `Creaseworks` in Settings, `Layout: Creaseworks` in the palette, `(layout:Creaseworks)` in Keys, host-api §13) |
| Keys section | `layout:Creaseworks` |
| Data folder | `<appHome>/data/creaseworks/` (`save.json`, `save.bak.json`, `save.damaged-<n>.json`, optional `location.json`) |
| `tools/game.json` | `{ "mod": "creaseworks", "layout": "Creaseworks" }` |
| Main resource | **folds** |
| Prestige | **String the Thousand**: a full string of 1,000 paper cranes is traded for **Wishes** |
| Settings picture | `mods/creaseworks/art/layout-preview.png`, 216×124 (shown about 108×62; share §5) |
| herdr.dev card | `preview.png`, 1600×1000, repo root (not copied on install) |

**Theme.** One fixed top-down view of a green cutting mat on a desk. In the middle lies **the
Sheet**, a square of paper. Every click makes one fold; the Sheet changes through eight fold
pictures (square, triangle, kite, square base, bird base, narrow, wings, crane), and every eighth
fold finishes a little figure that hops onto the shelf. Each coding agent in the window is one of
the **paper folk**: a crane, frog, fox, koi, rabbit, turtle, butterfly, whale, owl, boat, mouse or
snail, in one of eight paper colours. Working folk fold their own sheets (auto-gathering); a
finished task arrives as a sealed **envelope**; a waiting agent raises a **pennant**; a resting
agent lies flat and is pressed crisp (stored boost); sub-agents are **fledglings**, small paper
diamonds beside their parent. Folds buy **workshops**, **tools**, **folk care**, **charms**,
**curios** and **automations**. Over days the workshop strings paper cranes; at a thousand the
player may **make a wish** (prestige).

**Why it is clearly not a side-scrolling dungeon game.** No avatar, no walking, no scrolling
world, no rooms, levels, map, enemies, combat, health or loot. It is one static tabletop where you
make things; its verbs are fold, crease, open, string and wish.

**Why the metaphor fits "I click, my agents help".** Folding is one small repeated hand action
(each click really is a fold you see). A thousand cranes are traditionally folded by many hands,
which is a flock of agents helping. Every agent status has a paper meaning: working = folding,
needs you = pennant up, finished = a letter sent to you, idle = lying flat under a book.

**Theme choice between the two paper proposals.** fun.md and art.md were near-duplicate origami
themes. This spec takes **one**: Foldwick's mat, folk and workshops, with Creaseworks' string of
cranes for prestige, under the name **Creaseworks**. Foldwick's name was dropped after the name
search below.

**Name search (2026-11-25, web search of Steam, itch.io, Google Play and the App Store).**
- "Creaseworks": no game, app, product or studio. Nearest: *Creases* (itch.io narrative game),
  *Creased* (student platformer), *Folded* and *A Fold Apart* (Steam puzzle games), *Tearaway*,
  *Tengami*. None shares the name, art, characters or mechanics.
- "Foldwick": no exact match, but *Foldvalley* (Steam, a cozy pop-up storybook **village**
  builder announced for 2027) is too close in both name pattern and theme (paper village), so it
  was rejected. The name also avoids the `-fold` example naming in the research notes
  (`Lanternfold`, share Do 1).
- Rejected earlier by the proposals: "Foldlings" (existing pop-up card tool), "Creased", anything
  with "Kami", "Fold"/"Foldit".
- The folk are generic real animals, the workshops are ordinary craft words, and the
  thousand-crane wish is a folk tradition, not a game. No name, character, art or map is borrowed.
- Re-run this search right before publishing and record the date in `RECIPE.md` Watch out.

---

## 2. Placement in the window, and keys

### 2.1 Decision: a right panel that folds to a 64 px rail, plus a 30 px ribbon

The layout is the shipped `main` layout (share §9) with **every id kept** and two nodes added:

```
┌──────────┬────────────────────────────────────────────────────────────────┐
│ sidebar  │ tabs (42)                                                      │
│ 268      ├─────────────────────────────────────────────┬──────────────────┤
│ spaces   │ work-body (row, padding 8, gap 8)           │ cw-panel         │
│ agents   │  main (terminal panes, min 360)  [panel     │ 320 (64 … 560)   │
│          │                                  hidden]    │ the game         │
│          ├─────────────────────────────────────────────┴──────────────────┤
│          │ cw-ribbon 30 (always shown): every helper's status, count, ✉  │
│          ├────────────────────────────────────────────────────────────────┤
│          │ status (28)                                                    │
└──────────┴────────────────────────────────────────────────────────────────┘
```

* **cw-panel** (props `{role:"panel"}`): the full game. It folds to a **64 px rail** with one key
  (`run("layout.resize", {id:"cw-panel", px})`; `layout.resize` takes `id`, `px?`, `weight?` in
  `src/commands.rs` and in `tools/mock/commands.js`).
* **cw-ribbon** (props `{role:"ribbon"}`): one 30 px row above herdr's status bar, across the
  whole work column. It shows **every helper's individual status mark**, the fold count, the
  envelope count and any save problem, in every fold state.

Why this shape:

| Need | Panel + rail + ribbon (chosen) | Bottom strip | Own pane | Drawer |
|---|---|---|---|---|
| Room for a satisfying central object | 304×232 mat | 112 px sliver | full | narrow |
| Every agent readable without opening anything, 30–64 agents | ribbon row(s) + grid | one scrolling row | yes | poor |
| Terminals visible and usable | yes | yes | no (one or the other) | covers text |
| Shrinks almost to nothing | rail 64 px, or panel hidden (ribbon stays) | 72 px | n/a | 52 px peek |
| Save problems always visible | ribbon + rail glyph + banner | strip | only while shown | peek |

The panel came from art.md (judged best for art and readability); the ribbon from fun.md
(status and save problems stay visible when the panel is folded or hidden). The ribbon is a
separate copy of the same mod; both render one live game through the handover slot (§12, A6).

### 2.2 Terminal cost

| State | Width taken from terminals | Height taken | Terminal width at 1440×900 | at 1100×700 |
|---|---|---|---|---|
| Expanded (panel 320) | 328 px (320 + 8 gap) | 30 px | 1440 − 268 − 16 − 328 = **828 px** (~100 cols) | **488 px** |
| Rail (64) | 72 px | 30 px | 1084 px | 744 px |
| Panel hidden (palette only) | 0 | 30 px | 1156 px | 816 px |

Terminal height at 1440×900 is 900 − 42 − 28 − 30 − 16 = **784 px**; at 1100×700, **584 px**.

Terminals stay usable because: (1) the game never takes keyboard focus (no `focusable` in
`mod.json`, no `track_focus`, no `Input` except the optional shared-save path field in Settings,
which takes focus only while the player types in it); (2) clicking the game never focuses a pane,
except the deliberate "needs you" cue; (3) `main` has `"min": 360`, so a drag can never squeeze
terminals below 360 px; (4) no sounds, no `setAgentOrder`, `setWindowTitle` or `setBadge`
(host-api Don't).

### 2.3 Narrow windows (1100×700 and below)

The ribbon copy measures the work-column width `Wr` with `on_size_change` (divided by
`settings().zoom`); the panel copy measures its own width `Wp`. Both are written to the handover
slot. Estimated terminal width:

```
mainEst = Wr − 16 − (Wp + 8) − (filesShown ? filesPx + 8 : 0)
filesShown = layout() reports node "panel" not hidden;   filesPx = its px size if layout() gives it, else 368
```

* If the panel is expanded and `mainEst < 600`, the ribbon shows a one-time hint chip (11 px,
  `T.popover`, 1 px `T.border`): "Narrow window: fold Creaseworks to a rail?" with **[Fold]**
  (runs the fold command) and **[Not now]**. It appears at most once per Files-panel opening and
  once per day otherwise (`ui.narrowHintDay` in the save). The game never resizes on its own.
* With the Files panel open at 1100 px wide, `mainEst` is 112 px, so the hint always appears;
  folding gives the terminals 368 px.
* Panel height `H` = window height − 42 − 28 − 30 − 16. When `H < 640` (1100×700 gives 584) the
  panel uses the **short** variant: mat 304×184 with a 96 px Sheet (§3.2).
* Screenshots of whole windows at **1440×900 and 1100×700**, each expanded, folded and hidden,
  are part of `npm run shots` (§15.3).

### 2.4 Width states of the panel (measured `Wp`)

| State | `Wp` | What renders |
|---|---|---|
| Rail | < 140 (default 64) | §3.9 |
| Narrow | 140–279 | mat at 100 % width × 184; Flock tiles 4 across (dense); Shop shows icons only |
| Standard | 280–399 (default 320) | every view as drawn in §3 |
| Wide | ≥ 400 | mat 260 tall; Flock up to 8 columns; Shop rows add effect and payback columns |

### 2.5 The layout file (complete)

`layouts/Creaseworks.json` is generated by `tools/layout/build.mjs` from the shipped
`main.json` and checked by `test/layout.test.mjs` (fields from `src/layout.rs`, ids unique, all
`main` ids kept, no `theme`/`colors`, no string under a `"mod"` key in props). The result:

```json
{
  "id": "root", "type": "row", "titlebar": "none", "traffic_lights": [12, 16],
  "background": "canvas", "terminal_padding": [14, 12],
  "divider": {"width": 1, "color": "border"},
  "preview": "mods/creaseworks/art/layout-preview.png",
  "children": [
    {"id": "sidebar", "type": "column", "size": {"px": 268}, "min": 44, "max": 480,
     "background": "chrome", "resizable": false, "children": [
      {"id": "brand", "type": "block", "size": {"px": 46}, "window_drag": true,
       "content": {"mod": "workspace-chrome"}},
      {"id": "sidebar-lists", "type": "column", "children": [
        {"id": "spaces", "type": "block", "size": {"weight": 1}, "min": 90, "content": {"mod": "spaces"}},
        {"id": "agents", "type": "block", "size": {"weight": 1}, "min": 90, "content": {"mod": "agents"}}]},
      {"id": "sidebar-footer", "type": "block", "size": {"px": 69},
       "content": {"mod": "workspace-chrome", "props": {"footer": true}}}]},
    {"id": "work", "type": "column", "resizable": false, "children": [
      {"id": "tabs", "type": "block", "size": {"px": 42}, "window_drag": true, "content": {"mod": "tabs"}},
      {"id": "work-body", "type": "row", "padding": 8, "gap": 8, "children": [
        {"id": "main", "type": "block", "min": 360, "content": {"tab": "active", "pane": {
          "gap": 8, "radius": 10, "background": "background", "lone": true,
          "border": {"width": 1, "color": "border"}, "focus": {"width": 1, "color": "accent"},
          "header": {"content": {"mod": "pane"}, "height": 30, "position": "top", "reveal": "always"}}}},
        {"id": "panel", "type": "column", "hidden": true, "size": {"px": 368}, "min": 280, "max": 900,
         "children": [{"id": "panel-body", "type": "stack", "active": "files", "children": [
           {"id": "files", "type": "block", "content": {"mod": "files"}},
           {"id": "changes", "type": "block", "content": {"mod": "changes"}}]}]},
        {"id": "cw-panel", "type": "block", "size": {"px": 320}, "min": 64, "max": 560,
         "radius": 10, "border": {"width": 1, "color": "border"}, "background": "chrome",
         "content": {"mod": "creaseworks", "props": {"role": "panel"}}}]},
      {"id": "cw-ribbon", "type": "block", "size": {"px": 30}, "background": "chrome",
       "content": {"mod": "creaseworks", "props": {"role": "ribbon"}}},
      {"id": "status", "type": "block", "size": {"px": 28}, "content": {"mod": "workspace-status"}}]}
  ]
}
```

`cw-panel` is the last child of `work-body`, never under `panel-body` (the tabs mod hides that,
share §9). `mods/creaseworks/mod.json`:

```json
{"place": "none", "title": "Creaseworks",
 "palette": [
  {"title": "Creaseworks: fold or unfold the panel", "command": "creaseworks.fold"},
  {"title": "Creaseworks: hide or show the panel", "command": "layout.toggle", "args": {"id": "cw-panel"}},
  {"title": "Creaseworks: open the helper that needs you", "command": "creaseworks.answer"},
  {"title": "Creaseworks: open the oldest envelope", "command": "creaseworks.envelope"}]}
```

`"place":"none"` stops herdr docking a copy into the person's other layouts (host-api §12); the
file must stay valid JSON (an invalid file docks at the right, share Do 3).

### 2.6 Keys (`keys.json`, merged into the person's file)

```json
{
  "layout:Creaseworks": {
    "ctrl-shift-g": "creaseworks.fold",
    "ctrl-shift-y": "creaseworks.answer",
    "ctrl-shift-j": "creaseworks.envelope"
  }
}
```

| Chord | Command | Does |
|---|---|---|
| `ctrl-shift-g` | `creaseworks.fold` | panel ↔ rail (`layout.resize` to 64 or to the last unfolded width, default 320). If the panel is hidden, `layout.show {id:"cw-panel"}` first |
| `ctrl-shift-y` | `creaseworks.answer` | opens the helper that has needed you longest (§5.6). With nobody waiting, the ribbon shows "Nobody needs you" for 3 s; no toast |
| `ctrl-shift-j` | `creaseworks.envelope` | opens the oldest envelope (counts as clicking it) |

* Why these chords: none is in `defaults/keys.json` or `keys.macos.json` (share §3.3), none is a
  terminal-section binding, none is plain ctrl+letter (programs) or alt+letter (readline), and
  **`ctrl-shift-u` is avoided** (IBus Unicode entry on Linux). Folding the Sheet has no key: it is
  a mouse pleasure, not key-mashing next to a terminal.
* Only the `layout:Creaseworks` section is used, with string actions only, so the Keys overlay
  shows `ctrl-shift-y  (layout:Creaseworks)` → "creaseworks answer".
* **Every chord always has a receiver:** the ribbon copy is always shown, so `creaseworks.*`
  never fails with herdr's "unknown command" toast (host-api §11). If a person hides the ribbon
  with `layout.set`, the panel (or rail) copy receives instead.
* **Each command acts once.** Commands reach every shown copy. The ribbon copy handles them; the
  panel copy handles them only while `layout()` reports `cw-ribbon` hidden.
* `test/keys.test.mjs` checks the file against the real `valid_action` rules and both default
  chord lists, because one bad entry disables the person's whole keys.json (share §3.3).

---

## 3. Views

Notation: sizes are logical px before zoom; numeric lengths are multiplied by zoom by gpui, loop
px by us (gpui §9). `T.x` is herdr `theme()` key `x`; `S.x` is a scene token (§13.2) picked by
`settings().dark`; `Hue[i]` is a helper identity colour (§13.2). Type: `text_size(n)`, weights
400/600. **Minimum text size is 11 px everywhere.** Every clickable has a stable `.id()`; every
clickable that sits over another calls `cx.stop_propagation()`.

### 3.1 Panel frame (standard, 320 × H; H = 784 at 1440×900, 584 at 1100×700)

```
x:0                                                                       320
┌────────────────────────────────────────────────────────────────────────┐ y0
│ HEADER 44                                                              │
│ [fold 16] 12.4K folds 18/600 T.foreground          +86.2/s 11 T.muted  │
│ ▲2 ✓1 ●5 ◗14  (counts chip, 11)          ✦ 12 Wishes 11    [gear 24]   │
├────────────────────────────────────────────────────────────────────────┤ 44
│ SAVE BANNER 28 (only when a save notice exists, §3.8)                  │
├────────────────────────────────────────────────────────────────────────┤
│ MAT 304×232 at x 8 (short variant 304×184)  §3.2                       │
├────────────────────────────────────────────────────────────────────────┤
│ BOOST BAR 26: boost chips with countdown bars, or a muted hint         │
├────────────────────────────────────────────────────────────────────────┤
│ TABS 32: Flock 30 | Shop | String | (← Back in Settings)  12/600        │
├────────────────────────────────────────────────────────────────────────┤
│ CONTENT flex_1 min_h 0 overflow_y_scrollbar (Flock / Shop / String /   │
│ Settings)                                                              │
├────────────────────────────────────────────────────────────────────────┤ H−22
│ FOOTER 22: [save glyph 12] Saved 12 s ago 11 T.muted   [In step] [Calm] │
└────────────────────────────────────────────────────────────────────────┘ H
```

* Background `T.chrome`, dividers 1 px `T.border`. Values `T.foreground`, labels `T.muted`
  (muted on chrome ≥ 4.84:1 in every shipped theme, measured).
* Count format (our code, no `Intl`): below 10,000 as `12,480`; then 3 significant digits with
  K, M, B, T, Qa, Qi, Sx, Sp, Oc, No, Dc; then `1.23e36`. Setting: Short or Scientific.
* **Counts chip** (from fit.md; never scrolls): one segment per status, each the status glyph at
  11 px plus a number in 11/600: `▲2` needs you, `✓1` finished, `●5` working, `◗14` resting.
  Clicking ▲ opens the longest-waiting helper (cycles on repeat clicks), ✓ opens the oldest
  finished helper's pane, ● and ◗ switch to the Flock tab scrolled to that group.
* Gear opens Settings in the content area; the tabs row then shows "← Back".
* Footer save glyph: check (saved), three dots (saving), triangle (problem); colours `T.muted`,
  `T.muted`, guarded `T.blocked`. The shape carries the meaning.

### 3.2 The mat (main scene), 304 × 232

```
mat-local x:0                                                          304
┌──────────────────────────────────────────────────────────────────────┐ y0
│ TOP BAND 28: needs-you chips [▲ Mina] [▲ Koto] [▲ Pib] +2            │
│   (nobody waiting: the shelf, last 12 figures folded, 16 px each)    │
├──────────────────────────────────────────────────────────────────────┤ 28
│  ②            ·        ·       ·          ✦ gilded crane 48×36 hit   │
│        ┌──────────────┐                                              │
│        │  THE SHEET   │ 112×112, centre (152,114); frames 0..7       │
│  ①     │              │        ▫ scrap 16 in a 28 hit                │
│        └──────────────┘ ▮▮▮▮▮▯▯▯ fold ticks          ③ crease node  │
├──────────────────────────────────────────────────────────────────────┤ 200
│ BOTTOM BAND 32: tray [✉][✉][✉][✉][✉][✉] +4     streak ▮▮▮▯ ×1.4 ♪ │
└──────────────────────────────────────────────────────────────────────┘ 232
```

Layering is sibling order (later paints on top; no z-index, gpui §11):

1. **Mat**: `div` `S.mat`, `rounded(10)`. Grid: **two** `window.paint_path` stroke elements
   (one path and one `Background` per element, gpui §8): minor lines every 16 px at 1 px in
   `S.grid`, then major lines every 64 px at 1 px in `S.gridMajor`, both in `%` coordinates,
   `absolute().inset_0()`. Bottom edge: a third paint_path rectangle, 4 px, `S.matEdge`.
2. **Storm stripes** (only during Paper Storm): paint_path rect with
   `Background.pattern_slash(S.onMat, 2·zoom, 12·zoom)`, `.loop("opacity", {from: 0.06, to: 0.16, period: 1200})`.
   It is drawn before the play pieces so it paints under them.
3. **Crease line** of a finished chain: paint_path stroke 2 px `S.sheet`, `dash_array([6,4])`
   through the node centres in `%`; fades with `.transition("opacity", 600)` to 0 over the next
   data tick, removed after 3 s.
4. **The Sheet**: `div#cw-sheet`, 112×112 at (96, 58) (short: 96×96 at (104, 42)),
   `cursor_pointer()`, `on_mouse_down("left", …)` (gives the pop position; `e.local_position?.x ?? 56`
   guards the first paint, gpui §7), press feedback `.active(s => s.opacity(0.88))`. Inside: two
   stacked `svg()` layers `sheet/<f>-base.svg` tinted `S.sheet` and `sheet/<f>-shade.svg` tinted
   `S.sheetShade`. Under it, 8 fold ticks 6×2 px (done ticks `S.sheet`, others `S.crease`).
5. **Crease nodes**: `div#cw-node-<chain>-<i>` 28×28 hit area, inside a 22×22 `rounded_full`
   disc `S.sheet` with 2 px border `S.node` and the number 11/600 `S.ink`. The node due next has a
   3 px ring (static, no loop). Expiry: `.transition("opacity", 2000)` to 0.4 in its last 2 s.
6. **Scrap**: `svg("…/scene/scrap.svg")` 16 px tinted `S.sheet` in a 28×28 hit `div#cw-scrap-<id>`.
7. **Fresh Ream** (once a day, §4.5): `svg(scene/ream.svg)` 28×20 tinted `S.sheet` in a 36×28
   hit `div#cw-ream`, fixed at the mat's top-left play slot.
8. **Gilded crane**: three layers `crane-gilded-{outline,body,shade}.svg` tinted `S.goldInk`,
   `S.gold`, `S.goldShade`, in a 48×36 hit `div#cw-crane`. Motion §13.5.
9. **Paper Boat** (curio): `boat-{hull,sail}.svg` tinted `S.sheet`/`S.sheetShade` in a 48×32 hit
   `div#cw-boat`, gliding along the bottom band.
10. **Needs-you chips** (top band): height 22, `rounded(11)`, `px(8)`, background `T.popover`,
    1 px border `S.sheet` (separates the chip from the mat in dark themes, where popover vs mat is
    1.21:1), `status/needs.svg` 12 px in the guarded status colour, name 11/600 `T.foreground`.
    Up to 4 chips, then `+n`. Click opens the helper (§5.6).
11. **Tray** (bottom band): envelopes 28×20 hit `div#cw-env-<helperId>`, layers
    `scene/envelope-{body,flap}.svg` tinted `S.sheet` and `S.sheetShade`, a 12 px **seal** at the
    top right showing the type (§6.1) tinted `S.ink` on the paper, and the stack count `×n` in
    11/600 `S.ink` when n ≥ 2. Oldest first, at most 6 drawn, then `+n` (11/600 `S.onMat`).
12. **Streak meter**: track 96×6 `S.grid`, fill `S.node`, `.transition("width", 150)`; label
    `×1.4` 11/600 `S.onMat`. While **In step** a 12 px note glyph `ui/step.svg` and the word
    "In step" (11/600 `S.onMat`) sit right of it.
13. **Floating numbers** `+1.2K`, 12/600 `S.onMat`, at most 5 alive (§13.5).

Spawn slots: a 10×5 grid of slots over the play field (y 28–200, each 30.4×34.4), minus the six
slots that overlap the Sheet and the ream slot; the engine PRNG picks one. Nothing overlaps the
Sheet, so hit tests are unambiguous (gpui §7); top pieces still stop propagation.

**First run** (no save): a chip "Click the paper to fold it" (11/600 `T.foreground` on
`T.popover`) over the Sheet's top edge with a 10 px down-triangle that bobs
(`.loop("top", {from: 0, to: 4·z, period: 900})`); it disappears after the 3rd fold and never
returns (`ui.hints.fold`). The first gilded crane is fixed at 390 active seconds with the line
"A gilded crane! Click it before it flies off." (once, `ui.hints.crane`).

### 3.3 Flock tab (helper roster), 0 to 64+ agents

```
┌ detail card 72 (only when a tile is selected) ─────────────────────────┐
│ [koi 40] Mina · koi · vermilion                    12/600              │
│          claude · fix flaky test   (clipped agent title) 11 T.muted   │
│          Working 14 m · 2 fledglings · 1.3M folds this run             │
│          rest ▮▮▮▮▯ 80 % → next task ×1.8     [Open pane ›] 88×24       │
└─────────────────────────────────────────────────────────────────────────┘
 Flock 30 · 9 working · bench pace 47 %         [?] legend    11 T.muted
 ▲ NEEDS YOU 2                                    header 24, 11/600, fold ▾
 [tile][tile]
 ✓ FINISHED 1
 [tile]
 ● WORKING 9
 [tile][tile][tile][tile][tile] …
 ◗ RESTING 18                                     (folded by default above 12)
 …
 ⇄ ELSEWHERE 4   (helpers another window sees; §12.5)       folded by default
 ALBUM (9 helpers who have left) ▸                           folded by default
```

**Tile (normal, ≤ 20 helpers): 52×64**, gap 6, columns `floor((w − 16 + 6) / 58)` = 5 at 320.
- Background `T.raised`, `rounded(8)`, 1 px `T.border`; hover `T.hover`.
- Species glyph 28 px tinted `Hue[hue]` (§13.2), centred at y 6. Glyph and tile never share a
  hue tint (the tile is `T.raised`, never a tint of the helper's own hue).
- **Status badge** 18×18 at the top right (−4, −4): a disc `T.popover` with a 1 px `T.border`
  ring, holding the 12 px status glyph in the guarded status colour (§5.2).
- **Envelope marker** (when this helper has an unopened envelope): 14×14 at the bottom right,
  the `status/envelope.svg` glyph 11 px in `S.ink` on a `S.sheet` disc with 1 px `T.border`.
  Clicking the marker opens the envelope (`cx.stop_propagation()`).
- Name 11/400 `T.foreground` at y 44, `clip(name, 8)` then `.truncate()`.
- Fledgling pips: up to 4 shapes of 6 px at the bottom left (diamond filled = working, diamond
  hollow = resting, triangle = needs you), then `+n` 11 px.
- Rest bar (resting only): 2 px at the bottom, width `40 × rest`, `T.muted`, `.transition("width", 600)`.
- Needs-you tile: 2 px **dashed** border in the guarded `blocked` colour (a second, non-colour cue).
- Resting tile: content opacity 0.8.
- `.tooltip("<name> · <species> · <status word> · <agent title clipped to 60> · <space / tab>")`.

**Dense tile (≥ 21 helpers, or the "dense" setting): 40×44**, gap 4, 7 columns at 320. Glyph 22,
badge 16 (glyph 12), no name (tooltip has it), envelope marker 12, pips 4 px, rest bar 2 px.
30 helpers = 5 rows × 48 = 240 px; 64 helpers = 10 rows.

**Order.** Setting "Roster order": **Urgency groups** (default): fixed group order Needs you,
Finished, Working, Resting; inside "Needs you" the longest-waiting first; in every other group
**join order**, so tiles never shuffle while the player looks — a tile moves only when its group
changes. **Workspace order**: one list in `agents()` order (space → tab → pane, matching herdr's
sidebar), grouped headers hidden, statuses on badges only.

**Groups fold** (`ui.folded` in localStorage of the panel copy); a folded group is one 24 px row
"● Working 9". Resting folds automatically above 12 members until the player unfolds it.

**Album.** Helpers whose agent has gone: 28 px rows (glyph 16, name, "left 3 d ago", lifetime
folds). They never produce. A returning agent with the same `(address, created_ms)` rejoins with
its history.

**Empty state (0 agents):** a 304×200 card `T.raised`: three outline species (crane, fox, koi)
40 px `T.dim` at 0.6 opacity; "No paper folk yet." 13/600; "Start a coding agent in any tab.
Every agent herdr shows joins your workshop as a helper." 11 `T.muted`; then the **status
legend** (also behind "?"):
- ● arc — Working: folding for you
- ▲ pennant — Needs you: click to open its pane
- ✓ check — Finished: done while you were not looking
- ◗ crescent — Resting: storing a boost
- ✉ envelope marker — a reward is waiting

### 3.4 Shop tab

Segment control 40 px tall, six equal cells (~50 px at 320): 14 px icon over an 11/600 label:
**Works | Tools | Folk | Charms | Curios | Auto**. Narrow state: icons only with tooltips.

```
┌ row 52 ─────────────────────────────────────────────────────────────────┐
│ [icon 28]  Glue Pot  ×17            13/600 T.foreground  •  [ 31.2K ]   │
│            +11/s each · 187/s total   11 T.muted           in 2m 10s 11  │
└──────────────────────────────────────────────────────────────────────────┘
```

* Buy button 72×28, `rounded(6)`. Affordable: `T.accent` with `T.accent_foreground` text 12/600
  (≥ 5.65:1 in every shipped theme) and a 3 px left bar `T.accent` on the row (shape + colour).
  Unaffordable: `T.raised`, `T.muted` text, and the **time-to-afford** line "in 2m 10s"
  (11 `T.muted`) at the current passive rate.
* **Best buy**: the affordable item with the shortest payback `cost / Δrate` gets a 6 px
  `T.accent` diamond left of its button and the tooltip "Best buy: pays back in 3m". A hint, never
  an auto-buy.
* Works: a top-right toggle `×1 | ×10 | Max` (closed-form geometric sum). Tier upgrades appear
  inline under their workshop as 36 px sub-rows once unlocked.
* Upgrades are revealed when their cost ≤ 3 × the bank (or 3 × this run's folds), or when their
  predecessor is owned; never-seen items show as a `T.dim` silhouette "???" row. Bought ones
  collapse into "Owned (n) ▸" at the bottom of the segment.
* Auto: each automation row has its buy button and, once owned, a Switch (§8).

### 3.5 String tab (prestige)

```
┌ The String ─────────────────────────────── 742 / 1000 cranes ┐ 13/600
│  ┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃   20 strands × 50 cranes (12×200 each,  │
│  ┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃░░░░░   gap 3 → 297×200). Filled part tinted   │
│  ┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃░░░░░   S.sheet, rest S.sheet at 0.25           │
│ Next crane in 23.1M folds · lifetime 4.26B             11 T.muted│
│ At 1000: +10 Wishes (+5 % to everything each, forever)          │
│ ┌──────────────────────────────────────────────────────────────┐│
│ │        Make the wish (+10 Wishes)       304×36 T.accent      ││  disabled < 1000
│ └──────────────────────────────────────────────────────────────┘│
│ Clears: folds, workshops, upgrades, running boosts.   11 T.muted │
│ Keeps: helpers and their history, Wishes, perks, waiting boost   │
│ envelopes, settings, switches, garlands.                         │
├ Perks ───────────────────────────────────────────────────────────┤
│ 10 ✓ Keep Crisp Corners and Mail Sorter between runs             │
│ 25 · Start each run with 10 Paper Stacks and 5 Bone Folders      │
│ 50 · Gilded cranes come 20 % sooner                              │
│ 100 · Automations stay bought                                    │
│ 250 · Envelopes stack to ×15                                     │
├ Garlands (one per wish) ─────────────────────────────────────────┤
│ #1  ▇▇▇▇▅▅▅▃▃▂▂▁  (304×12 stripes)   day 3 · 10 Wishes           │
└──────────────────────────────────────────────────────────────────┘
```

* The string is 20 `div` columns. Each holds one dim `svg(ui/garland-strand.svg)` (12×200, 50
  crane silhouettes) tinted `S.sheet` at opacity 0.25 on a `S.mat` backing card 304×208, and over
  it a second tinted copy inside an `overflow_hidden` `div` whose **height** is the strand's
  filled share, `.transition("height", 600)`. That is 40 elements, never 1,000 (fun.md).
* **Confirming**: the first click turns the button into a card (`T.popover`, 1 px `T.accent`)
  listing exact gains and resets with **[Keep folding]** and **[Make the wish]**; **[Make the
  wish] is disabled for 1.5 s** after the card appears, so a double click cannot reset by accident.
* **Wish moment**: the filled strands rise (`.transition("top", 900)` −30 px) and fade
  (`.transition("opacity", 900)`), then the mat clears. Calm mode: a single 300 ms opacity fade.
* **Garlands** (fit.md's tapestry): at each wish the engine records up to 20 stripes
  `[colourKey, weight]`: the 16 helpers that contributed most this run (their `Hue`), "your hands"
  (`S.node`), "workshops" (`S.sheetShade`), and "everyone else" (`T.muted` at draw time). Drawn as
  one paint_path rectangle per stripe (one `Background` each), widths in `%`; tooltip on each
  stripe's wrapper names the source and its share. At most 50 garlands are kept (about 600 bytes
  each).

### 3.6 Settings (content area; rows 36 px: label 12/400 + help line 11 `T.muted`, control right)

1. **Calm mode** (§11.1).
2. **Notifications**: master switch (off by default), three event checkboxes, and "n of 3 sent
   today" (§11.2).
3. **Automations**: one switch per owned automation, same switches as the Auto segment (§8).
4. **Play**: "Helpers gather" (on), "Crease nodes appear" (on), "Floating numbers" (on; off and
   disabled in calm mode).
5. **Roster**: order (Urgency groups | Workspace order); density (Auto: dense at ≥ 21 | Always |
   Never).
6. **Number style**: Short (12.4K) | Scientific (1.24e4).
7. **Save**: path (middle-truncated), "Saved 12 s ago · backup 3 m ago"; **[Check save now]**;
   **[Restore backup…]** (two-step); **"Share a save with another herdr home…"** (§12.5).
8. **Reset game…**: two-step confirm with the same 1.5 s arming delay; the old save is kept as
   `save.damaged-<n>.json` with reason "reset".

Switches are `Switch.new(id)` (unstyled) drawn by us: 32×18 track (`T.accent` on, `T.input` off),
14 px knob `T.foreground` moved with `.transition("left", 120)`, plus the word "On"/"Off" (11).
Radios are drawn the same way (14 px ring `T.border`, 6 px dot `T.accent` when chosen, label).

### 3.7 "While you were away" card

Shown when an away segment (§10.1) of **≥ 5 min** was credited. An absolute card over the mat,
304 wide at (8, 80): `T.popover`, 1 px `T.border`, `rounded(10)`, `shadow_lg`, padding 14. It is
**non-blocking**: the mat around and the tabs still work; the card has its own close ✕.

```
 While you were away                                  13/600
 7 h 42 m  (Creaseworks counts up to 8 h)             11 T.muted
 ─────────────────────────────────────────────
 [fold]  +4.81M folds                                 20/600 T.foreground
         workshops 3.10M · helpers 1.71M              11 T.muted
 [✉]     9 envelopes waiting on the tray
 [▲]     2 helpers need you: Mina, Koto   [Open ›]
 [◗]     5 helpers rested fully (next tasks ×2)
 [✓]     Best helper: Pib the frog, 31 tasks
 [$]     You can afford: Washi Vat, Echo Crease II
                                       [ Collect ]  88×28 T.accent
```

The folds wait in the card until **Collect** is clicked (one satisfying click; `collect`
action). After 10 minutes of live time without a click they are credited anyway and the card
becomes the footer line "+4.81M while away (7 h 42 m)". Gaps under 5 minutes credit silently with
that footer line. With the panel folded or hidden, the ribbon shows a pill "Welcome back +4.81M"
(11/600 on `T.popover`); clicking it unfolds the panel (`creaseworks.fold`) and the card waits.
If the gap was capped: "You were away 11 h 20 m; helpers fold for at most 8 h while you're gone."

A **live absence** (herdr open, no hand input and the panel not looked at for ≥ 30 min) shows a
smaller card "While you were busy" with totals only (folds earned, tasks finished, envelopes
waiting); nothing is held back, since those folds were credited live.

### 3.8 Save banner (28 px under the header; never silent)

| Kind | Glyph | Background | Text (11/600 + 11/400, `T.foreground`) | Actions |
|---|---|---|---|---|
| `recovered` | warn | `T.working` at alpha 0x1f | "Save was damaged. Loaded the backup from 14:02. Damaged copy kept." | Details ▸ · Dismiss |
| `fresh` | warn | `T.blocked` 0x1f | "Save and backup were damaged. Started fresh; both files kept." | Details ▸ |
| `conflict` | arrows | `T.raised` | "Another window changed the save. Merging…" | none; clears when merged |
| `merged` | arrows | `T.raised` | "Merged with another window's progress." (6 s, then clears) | none |
| `error` | warn | `T.blocked` 0x1f | "Can't save: <host error clipped to 60>. Retrying in 30 s. Your progress is safe in memory." | Retry now · Details ▸ |
| `newer` | lock | `T.blocked` 0x1f | "This save is from a newer Creaseworks. Read-only until updated." | Details ▸ |
| `clock` | clock | `T.raised` | "Your clock moved back. Nothing was credited for that time." | Dismiss |

Text on tinted banners is `T.foreground`, never a status colour (judge: status-on-tint text was
3.62:1). Status colours are 6-digit (host-api §8); alpha is appended only through `withAlpha()`
after `hex6()` normalisation. **Details** expands a 3-line card: file path (middle truncation),
time of the last good save, backup state and the kept damaged file names.

The same notice is also shown, in every fold state:
- **ribbon**: a save chip in the first position, 22 px, `T.popover`, 1 px guarded-`blocked`
  border, warn glyph + "Save problem" 11/600; click unfolds/shows the panel at the banner;
- **rail**: a 20 px warn glyph at the top with the banner text as tooltip.

### 3.9 Rail (64 × H)

Top to bottom, all centred, 8 px gaps:
1. Save glyph 20 (only with a notice).
2. Count, two lines 11/600 and 11 `T.muted`: "12.4K" / "+86/s".
3. **Mini Sheet** 44×44 `#cw-sheet-mini` (one fold per click, same value and rhythm as the
   Sheet, no pops, no nodes spawn while folded).
4. Needs-you button 40×28: pennant 12 + n (11/600); opens the oldest waiting.
5. Envelope button 40×28: envelope 12 + n; opens the oldest envelope.
6. **Per-helper pip grid**: 4 columns × 14 px pitch of 12 px status glyphs in group order, every
   helper individually; scrolls vertically (`overflow_y_scrollbar`) only if taller than the room
   (at H = 584 about 108 pips fit). Click: needs-you/finished pips open the pane; others unfold
   the panel with that tile selected.
7. Gilded crane icon 24 (only while one is live; clickable, counts as catching it).
8. Unfold chevron 24 (`creaseworks.fold`).

### 3.10 Ribbon (30 px × work width)

```
x:0  8           126                                            W−108        W
┌──────────────┬───────────────────────────────────────────────┬────────────┐
│[fold] 12.4K  │ ▲▲ ✓ ●●●●●●●●● ◗◗◗◗◗◗◗◗◗◗◗◗◗◗ …              │ ✉3 [◇] [⇔] │
│ +86/s        │ (helper marks, group order, stable inside)     │            │
└──────────────┴───────────────────────────────────────────────┴────────────┘
```

* **Left block 118 px**: fold icon 14, count 12/600, rate 11 `T.muted` (two lines). A save chip,
  a "Welcome back" pill or the narrow-window hint takes the first place of the middle area when
  present.
* **Right block 100 px**: `✉ n` envelope count (opens the oldest), the **mini Sheet** `[◇]` 26×26
  (shown only while the panel is folded or hidden), and `[⇔]` (`creaseworks.fold`).
* **Middle: one mark per helper, never capped.** Pip area `w = W − 16 − 118 − 100 − 16`. Density:

| Level | When | Mark | Capacity |
|---|---|---|---|
| A chips | `n × 22 ≤ w` | 20×20 chip `rounded(5)` `T.raised`, status glyph 12 guarded colour, 2 px bottom bar in `Hue[hue]`, needs-you chips 1 px dashed border | `floor(w/22)` |
| B pips | otherwise, `n ≤ 2·floor(w/14)` | 12 px status glyph, 14 px pitch, **two rows** (y 2 and 16) | `2·floor(w/14)` |
| C tallies | only beyond B | needs-you and finished stay individual pips; the rest become tally chips `● 37` `◗ 21` (glyph + count 11/600) | unlimited |

  At 1440 wide (sidebar 268) `w = 922`: level A up to 41 helpers, level B up to **130**. At 1100
  wide `w = 582`: level A up to 26, level B up to **82**. So **64 agents keep an individual
  status mark at both sizes**; tallies appear only above 82 (1100) or 130 (1440) helpers.
* Order: group order (needs you, finished, working, resting), join order inside; with "Workspace
  order" selected, `agents()` order. Elsewhere helpers (§12.5) come last with a 50 % opacity.
* Click: needs-you or finished → open the pane (§5.6); envelope chip marker → open it; any other →
  unfold/show the panel with the tile selected. Tooltip: "Mina — claude · api / tab 2 — Needs you · 4 m".
* Empty: "No paper folk yet · start an agent in any tab and it joins the workshop" (11 `T.muted`).

### 3.11 `herdr-app check`, hidden window, VM restart

* `checking()` true: `init` renders a static demo (3 helpers: working, needs you, resting; 2
  envelopes; 12.4K folds) and returns before any timer, write or `run` (life §5). `window()` is
  null there: always `window()?.`.
* `window()?.visible === false`: the data timer runs every 5,000 ms; spawn timers do not advance
  (nothing appears unseen); helpers still produce (agents keep working) — a hidden window is not
  away.
* After a VM restart the slot is empty: load from disk (A6); at most the last ≤ 15 s of clicks can
  be lost (documented in RECIPE Watch out).

---

## 4. Clicking

### 4.1 Symbols

| Symbol | Meaning |
|---|---|
| `W` | Wishes held; `G = 1 + 0.05·W` (all folds) |
| `Rw` | workshop rate `G · Σ_k n_k · O_k · 2^tier_k` (§7.2) |
| `Hs0` | helper rate with no temporary boosts (§5.3) |
| `Rp` | passive rate `Rw + Hs0`; every "N seconds of production" uses it, so boosts never compound |
| `hand` | `2^(Tools hand upgrades owned)` |
| `echo` | 0.03 base; 0.06 / 0.10 / 0.18 / 0.28 / 0.40 with Echo Crease I–V |
| `V` | base click value `hand · G + echo · Rp` |
| `r` | rhythm (streak) counter 0…40 |

### 4.2 The Sheet (central object)

```
hit credited  : a hand hit ≥ 80 ms after the previous credited hand hit (≤ 12.5 per second);
                hand hits = Sheet, mini Sheet, crease nodes, scraps
rhythm r      : +1 per credited hand hit if the gap since the previous one ≤ g, else r = 1
                g = 1.0 s; 1.4 s with Steady Rhythm
combo         = 1 + comboMax · min(r, 40) / 40      comboMax 0.5 → 1.0 (Long Streak) → 2.0 (Endless Streak)
boost         = 7 during Paper Storm (10 with Gale Charm), else 3 during Rush (4 with Brisk Charm), else 1
Vc            = V · combo · boost
fold          : the hit pays Vc and advances the frame f = (f + 1) mod 8
figure        : the hit that wraps f to 0 pays 5 · Vc instead of Vc, and a figure (PRNG species) hops onto the shelf
```

Clicks are actions `{type:"click", target:"sheet", t}` with the hit's wall time; the engine
trusts `t`, not counts per tick. A 100-clicks-per-second script earns at most 12.5 hits/s.

### 4.3 In step and afterglow (clicking makes the agents stronger)

* **In step** while `r ≥ 25` (20 with Shared Rhythm): every working helper's output ×1.5
  (×2.0 with Shared Rhythm). The streak label turns into "In step" with a note glyph, the footer
  shows an "In step" chip, and up to 6 visible working badges spin at 600 ms (§13.5).
* **Afterglow**: each credited hand hit made while In step banks **6 s** of afterglow, up to
  **20 min**. While afterglow remains and the player is not In step, working helpers produce
  ×1.25 (×1.5 with Shared Rhythm). Afterglow drains 1 s per second of live (ticked) time and is
  frozen while away. A 2½-minute session at 1.25 hits/s banks about 16 min, so short check-ins
  keep paying while the player codes (fit.md's tension, without punishing absence).
* The streak resets lazily: the next hit (or tick) after a gap > g sets `r` to 1 or 0. No timer.

### 4.4 Crease nodes (chains)

* A chain spawns every **20 s of active time** (12 s with Quick Creases); every 4 s during a
  Paper Storm. At most one chain on the mat (two during a Storm). Setting "Crease nodes appear"
  can turn them off.
* **Active time** = the panel copy's mat is shown (standard, narrow or wide state), `window()?.active`
  is true, and a hand input happened within the last 30 s. Spawn clocks advance only in active
  seconds, so nothing spawns while the player is coding.
* A chain is k numbered nodes: k = 3 (5 with Long Crease, 7 with Grand Crease) on free slots.
  Each lives 10 s (20 s in calm mode); a live node's clock pauses while the mat is not shown.
* Clicking node i **in order** pays `2 · Vc` and counts as a hand hit. Finishing the chain pays
  `3 · k · Vc` more and paints the crease line. A k = 7 chain pays `14 + 21 = 35 · Vc`.
* Out of order: that node pays `1 · Vc`, the chain "tears" (its remaining nodes fade over 300 ms).
  Skill is rewarded, never punished.

### 4.5 Pickups and special clickables

| Thing | Spawns | Lives | Pays |
|---|---|---|---|
| **Scrap** | every 45 active s | 12 s (24 calm) | `max(30·Rp, 50·V) · scrapMult` (scrapMult 2 with Scrap Basket) |
| **Fresh Ream** (daily welcome) | first active moment of each local day, from the second day ever | until clicked or the day ends | `max(300·Rp, 100·V)` |
| **Gilded crane** (golden) | first at 390 active s; then every `300 + 300·u` active s (Crane Bait `210 + 210·u`; Crane Song `150 + 150·u`; ×0.8 with the 50-Wish perk), `u` from the PRNG | 13 s (20 Slow Wings; ×2 calm) | outcome table below |
| **Paper Boat** (limited time, Harbour Ribbon curio) | every `1800 + 900·u` active s | 20 s (40 calm), sails along the bottom band | **Tailwind**: the next 3 envelopes opened within 10 min pay ×2, plus `120·Rp` at once |
| **Envelope** | helper finishes (§6) | never expires | §6 |

Gilded crane outcomes (engine PRNG):

| Outcome | Chance | Effect |
|---|---|---|
| Lucky Fold | 50 % | `min(900·Rp, 0.15·bank) + 13·V` |
| Paper Storm | 30 % | hand hits ×7 (×10 Gale Charm) for 15 s; chains every 4 s |
| Flock Song | 20 % | every working helper ×3 for 60 s |

Cranes and boats only spawn during active time (fit.md: golden targets only while the player is
present), so the player never misses one while coding. A missed one leaves silently; no
notification, no penalty.

### 4.6 Determinism

Every spawn time, slot, outcome and envelope type comes from the engine's seeded PRNG
(mulberry32, state in the save) and the engine's active-time counters. The glue only passes the
wall time, `visible`/`active`/`matShown` flags, hand-hit timestamps and the local day key.

### 4.7 Why clicking stays meaningful the whole way

1. **Echo** puts 3–40 % of the passive rate into every click, so a click never shrinks to nothing.
2. **Rhythm** raises clicks to ×1.5 / ×2 / ×3, and **In step** multiplies the whole flock ×1.5–2
   while the player keeps the beat; **afterglow** carries ×1.25–1.5 into the coding time after.
3. **Chains** are ordered skill payouts (35·Vc for a full k = 7 chain every 12 s).
4. **Boosts need hands**: Rush and Storm multiply only hand hits; agents earn them, the player
   spends them (and chooses when, §6.2).
5. Measured in the calibration prototype (BALANCE.md): every session after the first 10 minutes
   earns at least **2.2×** its passive rate per active second (1.8× is asserted), a 2½-minute
   session is worth about 16× the passive rate per active second on days 2–3, and click-driven income is 30 % of the typical
   first run for 30 minutes a day. A player who never clicks reaches the first wish about 4 h of
   open time later.

---

## 5. Helpers and statuses

### 5.1 Observation and identity

* The **ticker copy** (A6) reads `agents()` once and `terminals()` once per data tick and never
  `panes()` (pat §4). It builds plain observations: for every pane agent, and for every live
  terminal whose `parent` chain reaches a pane agent within 32 hops,
  `{addr, created, status, raw, turn, parent, pane, title, paneName, space, tab}`. `agents()` and
  `terminals()` are joined by `address` (`created_ms` and `turn` come from `terminals()`; a missing
  `created_ms` is treated as 0). Maps are `Map`s or `Object.create(null)`.
* An `observe` action is emitted only when something changed (status, turn, title, set of
  helpers), so `pending` stays short.
* **Helper id** = FNV-1a 32-bit hex of `address + "#" + created_ms`. This deliberately leaves out
  the home: two herdr homes that see the **same** terminal (same address, same `created_ms`) get
  **one** helper and one drop per finish, and an address reused after a terminal restart gets a
  new `created_ms`, so a new helper. Two different terminals share a plain id when they have the
  same address and creation millisecond, or when their strings clash in the 32-bit hash. When an
  observation's plain id is already held by a different terminal (an earlier entry of the same
  list, or a present helper with another address or `created_ms`), that terminal takes the first
  free **salted id**, FNV-1a of `address + "#" + created_ms + "#" + k` for k = 1, 2, …; the
  present helper keeps its id, so each terminal resolves to the same id on every observation and
  no present agent is ever lost. The residual risk is in §17 (R6). (fit.md's `homeId:` prefix was
  rejected because it would credit a shared terminal twice; judge 2.)
* **Look from the hash h**: species `SPECIES[h % 12]`; hue `(h >>> 4) % 8`; name
  `A[(h >>> 8) % 16] + B[(h >>> 12) % 12]` with A = `Mi Ko Pi Ta Su No Ri Ha Yu Fe Lo Bi Ka Mo Ze Wu`,
  B = `na to b ki ri mo sa ku ro n li po` (192 short **ASCII** names: Mina, Koto, Pib, Taki, Yuro,
  Fen, Lopo…). On a clash among present helpers a new helper takes the smallest free number:
  the bare name, then " 2", " 3"… (ASCII); a helper returning from the Album keeps its name unless
  a present helper now holds it, when it too takes the smallest free number.
* **Every agent is a saved helper.** No cap, no daily limit, no unsaved extras. Pane helpers are
  never aggregated or dropped; gone ones move to the Album and keep their record. Fledglings
  (sub-agents) are saved as their own records while present and in the Album for 30 days; after
  that their totals are folded into their parent's record (`kidsPast`, `kidsFolds`) because a
  fledgling is part of its parent helper (brief: "sub-agents are mini-helpers that add to their
  parent's output"). To keep the save bounded (R13), gone fledglings beyond the 200 most recently
  gone (`K.kidAlbumKeep`) fold into their parent at once, and gone pane helpers beyond the 200 most
  recently gone (`K.albumKeep`) are **compacted**: they keep `{id, name, species, hue, folds,
  tasks}`, the minute they left and any `kidsPast`/`kidsFolds`, and the save writes each as a
  short array (≈ 40 bytes). A compacted helper stays in the Album; if its agent returns it rejoins
  with those stats and its turn is rebaselined (no reward). Record (≈ 170 bytes):
  `{id, addr, created, kind:"pane"|"kid", parent, species, hue, name, joined, lastSeen, seenBy,
  status, lastTurn, lastFinishAt, blockedAt, rest, warm, warmUntil, thanksUntil, env, stats:{tasks, folds, envelopes, checkIns}}`.
* Fuzz: addresses `__proto__`, `constructor`, `toString`, `t1/../x`, remote `peer/t7`, and the
  15-emoji title corpus (pat §3).

### 5.2 Status → behaviour → at-a-glance look

| herdr status | Game state | Production | Glyph (badge, pip) | Second non-colour cue | Motion (normal) | Colour (guarded) | Word |
|---|---|---|---|---|---|---|---|
| `working` | Working | `b_i` (§5.3) | **270° arc** | group position; "Working" header | spins 1200 ms for 20 s after it starts working (≤ 4 at once), and while In step (≤ 6); else static | `T.working` | "Working" |
| `blocked`, raw `error` | **Needs you** | 0 | **pennant** with cut-out "!" | 2 px **dashed** tile border; first group; mat chip; counts chip ▲ | pulses opacity 0.55↔1 / 1200 ms for **10 s** after it starts waiting (≤ 6 at once), then static | `T.blocked` | "Needs you" |
| `done` (finished, unseen) | Finished | 0; charges rest | **check mark in a circle** | "Finished" group; counts chip ✓ | none | `T.done` | "Finished" |
| `idle` | Resting | 0; charges rest | **crescent** | rest bar; tile opacity 0.8; "Resting" group | none | `T.idle` → usually falls back to `T.muted` | "Resting" |
| any, with an unopened envelope | (marker) | — | **envelope** marker 11–12 px on `S.sheet` disc | tray envelope with its seal | newest tray envelope bobs 10 s on landing | `S.ink` on `S.sheet` | "Envelope ready" |
| fledgling (sub-agent) | adds to parent | via `kids_i` | pip: filled **diamond** (working), hollow diamond (resting), small **triangle** (needs you) | position on the parent tile | none | parent `Hue`; triangle guarded `blocked` | "Fledgling" |
| gone | Album | 0 | none (list row) | Album section | none | `T.dim` | "Left" |

* Shapes differ in silhouette (arc, pennant, check, crescent, envelope, diamond, triangle), and a
  second cue (position, border style, opacity, bar or motion) carries each status without colour.
* Status colours are the user's theme keys (they match herdr's sidebar); private colours are used
  only on scene art and identity (judge 3).
* **Contrast guard** (`ui/color.js statusColor(T, status, surface)`): the colour is checked
  against the **surface it is drawn on** (badge disc `T.popover`, ribbon `T.chrome`, rail
  `T.chrome`, tile `T.raised`). Below 3.0:1 it falls back to `T.muted`; if `T.muted` is also below
  3.0:1, to `T.foreground`. Measured: theme `idle` is 2.10–3.61:1 on these surfaces (paper chrome
  2.10, graphite raised 2.52), so resting usually draws in `T.muted` (4.33–9.16:1); win98
  `working` on popover is 2.31:1 and falls back too. Status colours are **never** drawn directly
  on the mat (≈ 1:1 in light themes): every scene status cue sits on a `T.popover` chip with a
  1 px `S.sheet` ring.
* `done` from `agents()` is shown as herdr reports it; the **reliable** finish signal is `turn`
  (§6.1), because watching an agent finish goes straight working → idle (host-api §4).
* Paneless fledgling status = raw word with `error → blocked`, `done → idle`; a fledgling's
  status never lifts its parent's group (pat §2.2). A sub-agent that has a pane (kept) is still a
  fledgling of its parent if its `parent` chain reaches another helper; it opens with `pane.focus`.

### 5.3 Production

```
b_i     = (0.3·G + 0.04·Rw) · folk · warm_i · kids_i · thanks_i        per working pane helper
eff(n)  = n                         for n ≤ 4
        = 4 · (n / 4)^0.07          for n > 4        (eff(8) 4.20 · eff(30) 4.61 · eff(64) 4.86)
crowd(n)= eff(n) / n                n = working pane helpers
Hs0     = Σ_k (eff(k) − eff(k−1)) · b_(k)    b_(1) ≥ b_(2) ≥ … the working b_i, largest first
        (= crowd(n) · Σ b_i when every b_i is equal; = Σ b_i for n ≤ 4)
Hs      = Hs0 · step · song          (0 when "Helpers gather" is off)
step    = 1.5 In step (2.0 Shared Rhythm); else 1.25 while afterglow > 0 (1.5 Shared Rhythm); else 1
song    = 3 during Flock Song, else 2 during Chorus, else 1
folk    = Π Folk upgrades (×1.5 each, §7.3)
warm_i  = 1 + restMax · rest_i during the first task after resting (restMax 1 → 2 Warm Hands)
kids_i  = 1 + kidBonus · min(4, working fledglings of i)        kidBonus 0.25 → 0.50 → 0.75
thanks_i= 1.5 for 5 min after the helper goes from Needs you to Working within 5 min, else 1
```

* The flat `0.3·G` makes each working agent a real auto-clicker in the first hour (about a third
  of a hand click per second); the `0.04·Rw` term keeps helpers relevant all game.
* **Bench pace** (crowding) is diminishing returns, not a cap, and it is **marginal**: the k-th
  strongest working helper adds `eff(k) − eff(k−1)` of its `b_i`. So every working agent adds
  output and none lowers it, whatever the warm, fledgling and thanks multipliers (a fresh agent
  never dilutes a warm one), and an agent that stops working (Needs you, Finished, Resting) never
  raises it (BALANCE inv. 6). The Flock header says "9 working · bench pace 47 %" (`crowd(n)` as a
  percentage: the pace of a bench of equal helpers). Per-helper credit (Flock card, garland) is
  each `b_i` times the bench's effective pace `Hs0 / Σ b_i`. The exponent 0.07 and the fixed knee
  of 4 were calibrated so 30 and 64 agents reach the first wish on day 2 of open time, not on
  day 1 (BALANCE.md P6, P7); the exponent was 0.15 while the pace scaled the whole sum, which let
  a fresh agent lower a warm bench's output. There are **no** bench-room upgrades or perks (they
  broke big-flock pacing in calibration).
* **Thanks** stays in calm mode (calm changes no earnings). It needs no click on our cue: answering
  from herdr's own sidebar or toast counts.

### 5.4 Rest (idle charge)

```
while Resting or Finished : rest_i += dt / restFull          restFull 30 min → 20 (Deep Rest) → 12 (Dreamy Rest); cap 1
on → Working              : warm_i = 1 + restMax · rest_i ; rest_i = 0
warm ends                 : at the helper's next turn increment, or after 20 min, whichever first
Needs you                 : never charges rest (a waiting agent is not resting)
away segments             : rest charges by the away duration (§10)
```

The detail card shows "rest 80 % → next task ×1.8"; the tile shows the rest bar.

### 5.5 Thirty or more agents stay readable

1. Every helper has an individual mark in the ribbon at 1100 and 1440 px with up to 82/130
   helpers (§3.10), and in the rail grid (§3.9); urgent helpers always stay individual.
2. Four fixed groups with counts; "Needs you" always first and mirrored on the mat, the counts
   chip and the ribbon.
3. Dense 40×44 tiles at ≥ 21 helpers, glyphs ≥ 12 px, ≥ 4 px between tiles.
4. Stable join order inside groups; nothing shuffles while the player looks. Optional workspace
   order.
5. Motion budget (§13.5): at most 6 pulsing needs-you marks and 4–6 spinning arcs per copy, each
   for a bounded time; zero loops at rest.
6. Twelve silhouettes × eight hues = 96 identities, plus names; hue is assigned by hash, never by
   status, and identity is never colour alone.
7. Render cost: one host read per list, `Map` indexes, tile view-models precomputed in the tick;
   target ≤ 8 ms per render at 64 helpers in the QuickJS harness (A2.6).
8. Above 80 tiles in one open group the Flock tab switches that group to `v_virtual_list` with
   `on_item_click` (no handlers in item renderers, definite height; gpui §3, pat §4).

### 5.6 The "needs you" cue opens the agent

Clicking any needs-you mark (tile, mat chip, ribbon pip, rail button, counts-chip ▲,
`ctrl-shift-y`):

1. **Liveness check**: the address must be in the latest `terminals()` read with `state:"live"`.
   If not: the mark shows "That agent has gone" (11, 3 s) and no command runs.
2. Pane helper (or kept fledgling): `run("pane.focus", {pane})` (or `{terminal}` when only the
   terminal is known). Paneless fledgling: `run("terminal.peek", {terminal})` (host-api §6).
   Never `agent.focus` (it shows nothing for paneless sub-agents).
3. Arguments are validated statically against the command table (wrong names throw
   synchronously); `run` failures arrive as herdr toasts, which is acceptable for a deliberate click.
4. The click is recorded as `checkIns` in the helper's stats (no payout: the reward for answering
   is `thanks`, §5.3).

**No duplicate alerts.** Herdr already toasts and (if enabled) sounds for "needs you" and
"finished" on pane agents (host-api §4). Creaseworks never calls `notify()` or `playSound` for any
agent status; its cue is silent and visual, inside the panel, rail and ribbon only.

---

## 6. Rewards and boosts

### 6.1 Task finished → envelope (turn deltas)

* For every observed helper: `d = turn − lastTurn`. **Rebaseline with no reward** on first
  sighting, when `turn < lastTurn` (core restart), or when the record is new because
  `created_ms` changed. If `d > 0`: a finish, keyed by **(helperId, turn)** so two windows
  observing the same finish create one drop (A5).
* **Units**: a pane helper's finish adds **1 unit** to its envelope if ≥ 60 s passed since its
  previous credited finish, else **0.25** (so a stream of tiny tasks cannot flood the tray). A
  fledgling's finish adds **0.5** unit to its **parent's** envelope (0.125 within 60 s of that
  fledgling's previous finish).
* **One envelope per helper.** With no unopened envelope, a new one is created and its type is
  rolled by the PRNG (shown on the seal); otherwise the units stack. Cap **9 units** (15 with the
  250-Wish perk). Units above the cap convert at once into folds worth
  `45 · Rp · crowd(N) · units` (N = pane helpers present), with the footer note
  "+3.2K from a full envelope (Pib)". Nothing is silently lost.

| Type | Chance | Seal (12 px) | Effect when opened (stack u, f = 1 + 0.25·(u − 1)) |
|---|---|---|---|
| Bundle | 55 % | stacked sheets | `45 · Rp · u · envMult · crowd(N)` folds (envMult 1 → 1.5 Wax Seal → 2 Ribbon Tie) |
| Rush | 25 % | double chevron | hand hits ×3 (×4 Brisk Charm) for `30 · f · durMult` s |
| Paper Storm | 10 % | zigzag | hand hits ×7 (×10 Gale Charm), chains every 4 s, for `12 · f · durMult` s |
| Chorus | 10 % | three dots | working helpers ×2 for `120 · f · durMult` s |

`durMult` 1 → 1.5 (Long Ribbon) → 2 (Longer Ribbon).

### 6.2 Opening, and the player's choice

* An envelope opens only by a click (tray, tile marker, ribbon `✉`, `ctrl-shift-j`) or by an
  automation the player bought and switched on (§8). Bundles may be auto-opened by Mail Sorter;
  **timed boosts are opened by the player** (or by Boost Keeper, only while the player is active).
* The seal shows the type before opening, so the player chooses the moment: open a Rush right
  before a clicking session. A boost envelope's tooltip says "Rush ×3 for 52 s · open when you're
  ready to click".
* Opening a boost of a type already running **extends** it by 25 % of the new envelope's
  duration; remaining time is capped at **90 s (Rush), 30 s (Storm), 240 s (Chorus)**. The tooltip
  warns "Rush is running: opening now adds only 13 s".
* **Boost bar** (26 px under the mat): one chip per running boost (seal glyph 12 + "Rush ×3"
  11/600 + a countdown bar 48×3). The bar's width targets 0 with one native
  `.transition("width", {duration: remainingMs, easing: "linear"})` (fallback in §17: width set on
  each data tick). With no boost: "Open envelopes when you're ready" 11 `T.muted`.
* Boost timers are frozen while away (§10).
* With 30+ agents the per-helper stacking keeps the tray to one envelope per helper; the tray
  draws 6 and `+n`, the Flock tiles carry markers, and nothing auto-opens unless the player bought
  an automation.

### 6.3 Other rewards

Fresh Ream, scraps, gilded crane outcomes and the Paper Boat's Tailwind are in §4.5; Flock Song
and Chorus multiply working helpers; Storm and Rush multiply hand hits. Boosts never multiply
each other's "N seconds of production" payouts because those use `Rp`.

---

## 7. Economy tables

All costs and outputs are in folds. Constants marked † are calibration knobs (BALANCE.md lists
the order to turn them); any retune updates this file and BALANCE.md together.

### 7.1 Resources

| Resource | Earned by | Spent on | On a wish |
|---|---|---|---|
| Folds (bank) | clicks, helpers, workshops, pickups, envelopes, away | workshops, upgrades, automations | reset |
| Lifetime folds `L` | every fold ever earned | (drives cranes) | kept |
| Wishes `W` | making a wish | nothing; `G = 1 + 0.05·W` and perks | kept |

### 7.2 Workshops (generators): `cost_n = base · 1.16^n` †

| # | Workshop | Base cost | Output/s each | Icon |
|---|---|---|---|---|
| 0 | Paper Stack | 15 | 0.05 | stack of 3 sheets |
| 1 | Bone Folder | 180 | 0.3 | flat tool |
| 2 | Scissor Stand | 2,200 | 1.8 | scissors in a cup |
| 3 | Glue Pot | 26,000 | 11 | pot with a brush |
| 4 | Fold Bench | 310,000 | 65 | trestle table |
| 5 | Washi Vat | 3,700,000 | 390 | tub with a screen |
| 6 | Flower Press | 45,000,000 | 2,300 | press with a screw |
| 7 | Crane Loft | 540,000,000 | 14,000 | loft with a hanging crane string |
| 8 | Kite Tower | 6,500,000,000 | 84,000 | tower with a kite |

**Tier upgrades** (27): for each workshop at 10, 25 and 50 owned, cost `base × 20`, `× 200`,
`× 4,000`, each **×2** that workshop's output. Names: "<Workshop>: Neat Edges / True Corners /
Master's Touch". A workshop row appears once the previous one is owned (silhouette before).

### 7.3 Upgrades

**Tools (hand)**

| Upgrade | Cost | Effect |
|---|---|---|
| Crisp Corners | 100 | hand ×2 |
| Bone-tip Nail | 1,500 | hand ×2 |
| Valley Fold | 40,000 | hand ×2 |
| Mountain Fold | 1,200,000 | hand ×2 |
| Squash Fold | 40,000,000 | hand ×2 |
| Petal Fold | 1.5e9 | hand ×2 |
| Thousandth Fold | 6e10 | hand ×2 |
| Echo Crease I / II / III / IV / V † | 2,000 / 80,000 / 4e6 / 3e8 / 2e10 | echo 0.06 / 0.10 / 0.18 / 0.28 / 0.40 (base 0.03) |
| Steady Rhythm | 5,000 | rhythm gap 1.0 → 1.4 s |
| Long Streak | 250,000 | comboMax 0.5 → 1.0 |
| Endless Streak | 5e7 | comboMax → 2.0 |

**Folk (helpers)**

| Upgrade | Cost | Effect |
|---|---|---|
| Rice Treats | 2,000 | folk ×1.5 |
| Soft Brushes | 100,000 | folk ×1.5 |
| Snug Bench | 5e6 | folk ×1.5 |
| Paper Hats | 3e8 | folk ×1.5 |
| Gold-leaf Hats | 2e10 | folk ×1.5 |
| Shared Rhythm | 2e6 | In step at r ≥ 20 and ×2.0; afterglow ×1.5 |
| Deep Rest / Dreamy Rest | 20,000 / 2e6 | restFull 30 → 20 → 12 min |
| Warm Hands | 500,000 | restMax 1 → 2 |
| Fledgling Wings / Flight School | 50,000 / 5e6 | kidBonus 0.25 → 0.50 → 0.75 |
| Night Shift / Night Owl | 500,000 / 5e7 | away factor 0.25 → 0.35 → 0.45 (§10) |

**Charms (boost strength)**

| Upgrade | Cost | Effect |
|---|---|---|
| Wax Seal | 10,000 | envMult 1.5 |
| Ribbon Tie | 1e6 | envMult 2.0 |
| Long Ribbon | 100,000 | durMult 1.5 |
| Longer Ribbon | 1e7 | durMult 2.0 |
| Brisk Charm | 3e6 | Rush ×3 → ×4 |
| Gale Charm | 1e8 | Storm ×7 → ×10 |

**Curios (special clickables)**

| Upgrade | Cost | Effect |
|---|---|---|
| Long Crease / Grand Crease | 20,000 / 2e6 | chain k 3 → 5 → 7 |
| Quick Creases | 200,000 | a chain every 20 → 12 active s |
| Scrap Basket | 100,000 | scrapMult 2 |
| Crane Bait / Crane Song | 50,000 / 5e6 | crane interval 300–600 → 210–420 → 150–300 active s |
| Slow Wings | 500,000 | crane life 13 → 20 s |
| Harbour Ribbon | 1e6 | unlocks the Paper Boat (§4.5) |

### 7.4 Purchases

Workshops ×1, ×10 or Max (closed form, no loop); upgrades once. A purchase is an action
`{type:"buy", item, count, t}`, idempotent by `(w, s)` (A5). On a merge, a replayed purchase that
is no longer affordable is dropped and its refund noted in the `merged` banner.

---

## 8. Automations and switches

Bought in the **Auto** shop segment. Each has its own switch, **on when bought**, shown in the
Auto segment and in Settings → Automations (same order, labelled "On"/"Off" in text). Switches are
in the save (`auto.<id>`), take effect on the next engine step and survive wishes.

| Automation | Cost | What it does | What it never does |
|---|---|---|---|
| Mail Sorter | 25,000 | opens **Bundle** envelopes 10 s after they land | open a timed boost |
| Thrifty Fox | 500,000 | buys the workshop with the best payback when the bank ≥ 4 × its cost, at most once per 10 s | buy upgrades or automations |
| Boost Keeper | 2.5e6 | opens one boost envelope when the player made a hand hit in the last 60 s and no boost of that type runs | open while the player is away or coding |
| Crease Helper | 5e6 | at 80 % of a node's life, clicks the next due node in order at 50 % value | add rhythm, In step or afterglow |

Other switches (Settings → Play): **Helpers gather** (on; off makes `Hs = 0` so the flock is a
pure status board), **Crease nodes appear** (on), **Floating numbers** (on). There is no
auto-wish and no auto-catch of cranes or boats.

---

## 9. Prestige: String the Thousand

```
cranes(L)  = floor( 100 · cbrt( L / Lw ) )        Lw = 6e6 †      (L = lifetime folds, all runs)
Wtotal(L)  = floor( cranes(L) / 100 )
gain       = Wtotal − W
first wish : allowed when cranes ≥ 1000 (L ≥ 6e9), giving exactly 10 Wishes (G = 1.5)
later wish : allowed when gain ≥ max(5, ceil(0.25 · W))
string     : shows cranes(L) − 100·W  out of 100·max(10, needed gain)
bonus      : G = 1 + 0.05 · W on all folds; perks by Wishes held (§3.5)
```

* Cube root: early cranes come quickly (fun), later ones slowly; waiting past the gate still pays
  but is never compulsory.
* **Making a wish** first opens every Bundle on the tray at current value, then resets folds,
  workshops, tiers, upgrades (except perk-kept), running boosts, rhythm, afterglow, spawns, the
  shelf and the away pot. It keeps helpers (identity, stats, rest), the Album, Wishes, perks,
  **timed boost envelopes** (they carry into the next run), settings, switches, notification
  counters, lifetime totals and the garlands.
* Perks (by Wishes held): 10 keep Crisp Corners and Mail Sorter; 25 start with 10 Paper Stacks and
  5 Bone Folders; 50 gilded crane intervals ×0.8; 100 automations stay bought; 250 envelopes stack
  to 15.
* Targets: first wish for the typical player on **day 3 of open time** (BALANCE.md M15); second
  wish 9–22 h of open time after the first (provisional, tuned by the later-wish gate).

---

## 10. Offline and the away summary

### 10.1 When "away" applies

* An **away segment** is any interval with no engine tick longer than 60 s: herdr closed, machine
  asleep (one tick sees a jump), VM restart. A hidden window is **not** away (it ticks every 5 s).
* Credited time `a = min(gap, 28,800 s)` (8 h). The rest is dropped and the card says so.
* **Clock moved backwards** (`now < clock − 5 s`): 0 credit, the engine rebases its clock to `now`
  (a `rebase` action) and shows the `clock` notice. It never gives credit for time it already
  counted.
* Two away segments separated by less than 5 min of live (ticked) time **share one 8-h cap**, so
  restarting herdr repeatedly cannot farm away credit.

### 10.2 What accrues (closed form: one multiplication per segment)

```
away = f · ( Rw + crowd(N) · Σ_present (0.3·G + 0.04·Rw) · folk ) · a      f = 0.25 → 0.35 Night Shift → 0.45 Night Owl
```

* "Present" = pane helpers present at the last observation, whatever their status (agents keep
  working while the person is away; we do not know their schedule), at base rate: no warm, kids,
  thanks, In step, afterglow or boosts.
* Resting and finished helpers gain `a / restFull` rest; helpers come back fully rested if
  `a ≥ restFull`.
* Not accrued: clicks, spawns, cranes, boats, envelopes (no finishes are observed while away),
  afterglow drain, and boost time: **boost timers and afterglow are frozen** and resume on return.
* **Helpers nobody can see.** With two windows (§12.5), a helper last observed by another window
  more than 60 s ago counts as away for production: it earns the same away rate for at most 8 h
  after its `lastSeen`, then nothing, until a window sees it again. One rule covers "game closed"
  and "the window that sees this agent closed".
* The engine splits `(clock, now]` at these breakpoints and credits each piece in closed form;
  whichever writer advanced the clock owns that interval (A5), so time is credited once.

### 10.3 The away card

§3.7: duration and cap notice; folds split into workshops and helpers; envelopes waiting; helpers
needing you (with Open ›); helpers fully rested; best helper since the last visit (most tasks);
up to 3 purchases now affordable. The folds wait in an **away pot** for one **Collect** click
(auto-credited after 10 min of live time); the pot survives reloads and merges like any other
state.

---

## 11. Settings

### 11.1 Calm mode (off by default)

Calm mode changes **presentation only; no formula, value or chance changes** (asserted: the
calm profile reaches every milestone within 3 % of the typical profile, BALANCE.md P12).

1. **No `.loop()` and no `.spin()` anywhere**, in every copy: no needs-you pulse, no spinners, no
   envelope bob, no crane bob, no storm stripes, no first-run bob.
2. The gilded crane and the boat do not glide: they sit at their spawn slot with their outline.
3. No floating numbers ("Floating numbers" is forced off and disabled).
4. No transition longer than 150 ms (bars snap; the wish moment is one 300 ms fade, which is the
   single exception and is a fade, not motion).
5. Nodes, scraps, cranes and boats live twice as long (catch chance only; values unchanged).
6. Counters and rates re-render every 5 s instead of every second (the data tick still runs every
   second for the engine; `cx.notify()` happens only when a 5 s bucket changes or the player acts).
7. Away and welcome cards appear without transitions.
8. Every status shape, word, tooltip and the contrast guard stay. Readability never drops.

### 11.2 Notifications (opt-in; at most 3 a day; never sound)

* Master switch **off** by default. Events (each with its own checkbox, on when the master is on):
  1. **"Your string is full"**: a wish became available (once per run).
  2. **"Envelopes are piling up"**: ≥ 12 unopened for 30 min (once per local day).
  3. **"Creaseworks can't save"**: a save `error` or `fresh` notice lasting 5 min (once per
     episode).
* `notify({title, body, level: "info", timeout: 6000, icon: "mods/creaseworks/art/notify-icon.svg", action: {name: "layout.show", args: {id: "cw-panel"}}})`.
  Herdr's `notify` never plays sound (host-api §7) and Creaseworks never calls `playSound`.
* **Cap: 3 `notify()` calls per local calendar day across all events and all windows.** The
  counter `{day: "YYYY-MM-DD", sent}` lives in the save (merge takes the max per day). The glue
  computes the local day from `Date` and the timezone offset and passes it in.
* Nothing is sent while the panel is shown and the window is active.
* **Never** for agent status ("needs you", "finished"): herdr already does that.
* **Save problems never depend on notifications.** They are always visible in the ribbon chip,
  the rail glyph, the footer glyph and the banner (§3.8). If both the ribbon and the panel are
  hidden (palette, `layout.set`) while a save problem persists for 30 s, the game runs
  `run("layout.show", {id: "cw-ribbon"})` once per episode instead of toasting.

### 11.3 Automation switches

One per automation (§8), plus the Play switches. All in the save.

### 11.4 Other settings

Roster order and density, number style, save location and sharing, check/restore/reset (§3.6).

---

## 12. Saving and handover (what the player sees)

The mechanism is ARCHITECTURE A4–A6 exactly; this section is the player-facing contract.

### 12.1 Files

```
<appHome>/data/creaseworks/save.json             current save   {format:"creaseworks-save", version, check, state}
<appHome>/data/creaseworks/save.bak.json         previous good save, rotated at most every 5 min
<appHome>/data/creaseworks/save.damaged-<n>.json damaged files kept aside, n = 1..5 (oldest replaced)
<appHome>/data/creaseworks/location.json         only when sharing: {"path": "/abs/…/save.json"}
```

Written only with `writeTextFile(path, text, expected)` (CAS, atomic rename), read with
`readTextFile`; absolute paths from `appHome()`; nothing is ever written under `mods/` (that would
reload the mod, life §1). Save text < 256 KiB at 64 helpers plus 500 Album helpers, and
< 512 KiB after a year of 20 agents a day (each with 3 fledglings) thanks to Album compaction (R13;
tests).
Cadence: 2 s after a purchase, wish, setting change or envelope open; every 15 s while anything
changed; on `close(cx)` one final write at once.

### 12.2 Problems are never silent

| Situation | What happens | What the player sees |
|---|---|---|
| `save.json` damaged (parse error, bad check, unknown format, failed validation) | kept as `save.damaged-<n>.json`; backup loaded | `recovered` banner + ribbon chip |
| backup damaged too | both kept; fresh game | `fresh` banner (+ optional notify, §11.2) |
| newer version on disk | loaded read-only; no writes | `newer` banner |
| CAS rejection (another window wrote) | re-read, merge (A5), retry ≤ 3 per cycle | `conflict` → `merged` (6 s) |
| other write failure (permissions, disk full, > 1 MiB) | retried 10 s, 30 s, 60 s, then every 5 min | `error` banner with the host message, ribbon chip, rail glyph, footer triangle |
| clock moved back | no credit, rebase | `clock` notice |

Recovery tools in Settings: **Check save now** (re-read and validate), **Restore backup…**
(two-step; the current save is kept as a damaged copy with reason "restore").

### 12.3 Hot reload hands over without rollback

Saving any mod file reloads every copy (life §1). Each new `init` adopts the handover slot
`globalThis[Symbol.for("creaseworks/live")]` (plain data only, written only from `init` and tasks,
never at module top level), so the game continues from the exact live state: no disk read, no
rollback. An old generation's in-flight write that never settles is resolved with the slot's
`inflight {text, upto}` check (A6). Timers are registered only in `init`. After a VM restart
(memory pressure) the slot is gone and the game reloads from disk, losing at most the last ≤ 15 s
of clicks (RECIPE Watch out).

### 12.4 Copies in one window

Panel and ribbon are two copies in one VM. They share the slot. **Every copy runs its own
`cx.timer.every`** (1,000 ms visible, 5,000 ms hidden); each tick writes its heartbeat and
re-renders that copy when the slot's `rev` changed. The copy named `ticker` (or, if its heartbeat
is older than 5 s, the first live copy, which claims it) advances the engine, observes agents and
drives saving. No copy ever calls another copy's `cx` or a stored callback (`cx.notify(entity)`
works only for nested entities; judge 2).

### 12.5 Two windows share one save

Two herdr windows are two processes with two app homes (life §4). Sharing is explicit:

1. In window B: Settings → Save → "Share a save with another herdr home…", type the absolute path
   of window A's `…/data/creaseworks/save.json`. B writes only the pointer
   `<B home>/data/creaseworks/location.json`; its own data folder is otherwise unused. The input is
   validated (absolute, ends in `.json`, readable or creatable, and is a Creaseworks save or
   absent). Backups and damaged copies live next to the target file.
2. Each process has its own `writerId`. Every player intent and observation is an action
   `{w, s, t, …}`; `apply` ignores already-applied `(w, s)`; on a CAS conflict each window
   re-reads, replays its pending actions onto the disk state and writes again (A5). Drops are keyed
   by `(helperId, turn)`, the notification counter merges by max, purchases that became
   unaffordable are refunded and named in the `merged` banner.
3. Time is credited once: `advance(state, now)` only moves forward from `state.clock`, so whichever
   window advanced the clock owns that interval.
4. Each window observes its own agents; helpers last seen by the other window show in the
   **Elsewhere** group (and last in the ribbon at 50 % opacity) with their last known status, and
   follow the away rule of §10.2 when that window stops observing them for 60 s. A window moves a
   helper to the Album only if it was the last to see it (`seenBy`), or once nobody has seen it
   for 8 h (the other window closed for good, or herdr restarted and the process got a new
   `writerId`): then any window that does not list it adopts it into the Album, so an agent that
   ended while herdr was down never stays in Elsewhere for more than 8 h.
5. Displayed numbers may jump slightly when a merge lands (the merged state replaces the local
   guess). The `merged` banner explains it.
6. **Residual race**: `writeTextFile`'s compare-and-swap has no cross-process lock; another
   process can write between herdr's re-check and its rename (life §6.3). The merge makes the
   next write repair it (actions are idempotent), but one write's worth of the other window's
   progress (≤ 15 s) can be overwritten until that window's next save re-applies its pending
   actions. Documented in RECIPE Watch out.

### 12.6 localStorage

Used only for per-copy UI conveniences (selected tab, folded groups, last unfolded panel width),
every call wrapped in `try/catch` (a malformed store file makes every call throw, qjs §7). Panel
and ribbon have different props, hence different store files. Nothing that must persist or be
shared goes there.

---

## 13. Art direction, palette, assets, animation

### 13.1 Style rules

* **Flat paper**: straight-edged polygons only; no gradients inside SVGs (gradients and patterns
  come from `paint_path` `Background`s); no `<text>`, filters, masks, `style` or images in SVGs;
  outlines only on the gilded crane.
* **One colour per file**: every sprite is `fill="#000"` drawn through `svg()` as an alpha mask
  tinted by `text_color` (gpui §3), so one file works in both themes at any zoom and is never
  blurred by `image()`'s 2× rasterisation. Folded-paper facets are alpha steps 1 / 0.78 / 0.56.
* **Facet fallback from day one**: `tools/art/generate.mjs` emits, for every faceted sprite, both
  the single file and a split set `-a.svg`, `-b.svg`, `-c.svg` (one per facet level).
  `ui/art.js` has one constant `FACETS = "alpha" | "split"`; "split" layers the three files with
  tints `c`, `mix(c, surface, 0.22)`, `mix(c, surface, 0.44)`. The first herdr run checks the
  alpha path by eye on the contact-sheet view (§17 R1); if facets flatten, flip the constant.
* **Grid**: species on a 32-unit viewBox with a 2-unit margin; status glyphs 16; scene sprites on
  their listed boxes; whole or half units; ≤ 1.2 KB and ≤ 40 points per polygon.
* **Silhouette test**: each of the 12 species must be recognisable as a 16 px black blob; each
  status glyph must be distinguishable at 12 px in greyscale (test, §14).
* **Generator + checker**: all ~120 SVG files come from `tools/art/generate.mjs` (Node,
  deterministic, writes SVG text from coordinate tables); `tools/art/check-svg.mjs` runs in
  `npm test` and enforces `viewBox` + `width`/`height`, only `path|polygon|rect|circle`, fill
  `#000` (or the listed literals for the one full-colour file), opacity values in {1, 0.78, 0.56},
  no `text|style|filter|mask|image|linearGradient`, size limits. `tools/art/sheet.mjs` renders a
  contact sheet at 12/16/28/40 px on light and dark for review.

### 13.2 Palette (exact hex; WCAG 2.x ratios measured against `tools/mock/themes.json`)

**Scene tokens `S`** (ours; picked by `settings().dark`):

| Token | Light | Dark | Use and measured contrast |
|---|---|---|---|
| `mat` | `#2f6a55` | `#1d3a32` | cutting mat |
| `matEdge` | `#24523f` | `#14291f` | mat bottom edge |
| `grid` | `#ffffff1f` | `#ffffff14` | minor grid (decorative) |
| `gridMajor` | `#ffffff38` | `#ffffff24` | major grid (decorative) |
| `sheet` | `#fbf7ee` | `#d9d1c0` | paper; vs mat **5.93** (L), **8.12** (D); dark tone dimmed to avoid glare on the 112 px Sheet |
| `sheetShade` | `#e6dcc6` | `#bfb39b` | facet shade (decorative) |
| `crease` | `#c9b994` | `#a8996f` | fold ticks (decorative) |
| `ink` | `#22302c` | `#1d2724` | text on paper: vs sheet **12.86** / **10.11** |
| `onMat` | `#ffffff` | `#f4f1ea` | text on the mat: **6.34** / **10.93** |
| `node` | `#f2b134` | `#e9b93f` | node ring, streak fill: vs mat **3.35** / **6.74**; ink on node 7.28 / 8.39 |
| `gold` | `#f0c24b` | `#e9b93f` | crane body: vs mat **3.78** / **6.74** |
| `goldShade` | `#c99a2e` | `#c39a2c` | crane facets |
| `goldInk` | `#4a3500` | `#3d2c00` | crane outline: vs gold **6.96** / **7.36** |

The central clickable's boundary is ≥ 3:1 against its backdrop in both themes (sheet vs mat
5.93 / 8.12), unlike a light sheet on a light desk (fun.md's 1.15:1).

**Helper hues `Hue[i]`** (identity, never status). Light set on light themes, dark set on dark.
Every value is ≥ 4.0:1 against `raised` and `chrome` of every shipped theme of its appearance
(light: paper, win98; dark: graphite, ink, moss, atom-one-dark), so glyphs pass the 3:1 graphics
rule with margin; on paper `raised` every light hue is ≥ 4.94:1.

| # | Hue | Light | Dark |
|---|---|---|---|
| 0 | vermilion | `#b8432a` | `#f08b6e` |
| 1 | saffron | `#946000` | `#e3b04b` |
| 2 | leaf | `#3b7330` | `#8fcc72` |
| 3 | teal | `#1d7373` | `#5ccaca` |
| 4 | sky | `#2b62b0` | `#80aef2` |
| 5 | violet | `#6a4cb0` | `#b49cf0` |
| 6 | plum | `#9c3a72` | `#ee8fc0` |
| 7 | slate | `#4c5a68` | `#a9b5c2` |

A glyph is never tinted on a tint of its own hue (tiles are `T.raised`). Identity is also carried
by silhouette and name, so colour is never the only identity cue.

**UI and status colours come from `theme()`**, guarded per surface (§5.2). Measured status
contrast against `raised` (the tile): working 4.50–8.15, blocked 3.64–4.82, done 4.30–5.91, idle
2.20–2.55 (→ `T.muted` 4.33–5.07) across graphite, paper, ink, moss and atom-one-dark; win98 is
checked by the same guard at run time. **Hex discipline**: every literal above lives in one frozen
table `ui/palette.js`; a test validates each as `#rrggbb`/`#rrggbbaa` and recomputes every ratio
in this section; `withAlpha(c, a)` runs `hex6()` first (theme `hover/selected/border/input` are
8-digit, host-api §8); every colour passed to a `Background` is validated by our code first,
because a bad one there fails silently (gpui §5).

### 13.3 Asset list (`mods/creaseworks/art/`)

| Folder / files | Count | viewBox → drawn at | Notes |
|---|---|---|---|
| `folk/{crane,frog,fox,koi,rabbit,turtle,butterfly,whale,owl,boat,mouse,snail}.svg` | 12 | 32 → 16, 22, 28, 40 | facets; distinct blobs (V wings, squat, ears, tail fin, long ears, hex shell, 4 wings, round + tail, tufts, hull, round ears, spiral) |
| `folk/*-{a,b,c}.svg` | 36 | same | facet split fallback (generated) |
| `sheet/{0..7}-base.svg`, `sheet/{0..7}-shade.svg` | 16 | 64 → 112, 96, 44, 26 | fold sequence: square, triangle, kite, square base, bird base, narrow, wings, crane |
| `status/{working-arc,needs,done-check,rest,envelope,pip-work,pip-rest,pip-needs}.svg` | 8 | 16 → 11, 12 | arc = 270° ring 2.5 units; needs = pennant with "!" cut-out; done = check in a circle; rest = crescent; pips = filled diamond, hollow diamond, triangle |
| `scene/{envelope-body,envelope-flap}.svg` | 2 | 28×20 | tray envelope |
| `scene/{seal-bundle,seal-rush,seal-storm,seal-chorus}.svg` | 4 | 12 | stacked sheets, double chevron, zigzag, three dots |
| `scene/scrap.svg`, `scene/ream.svg` | 2 | 16; 28×20 | torn quadrilateral; ream of paper with a band |
| `scene/crane-gilded-{outline,body,shade}.svg` | 3 | 40×28 | outline = body grown 1.5 units |
| `scene/boat-{hull,sail}.svg` | 2 | 40×28 | Paper Boat |
| `workshops/{stack,bonefolder,scissors,gluepot,bench,vat,press,loft,kite}.svg` | 9 | 24 → 28 | shop icons |
| `ui/{fold,wish,gear,flock,shop,string,back,chevron,close,info,warn,check,dots,arrows,lock,clock,hand,paw,ribbon,curio,cog,step,cloud}.svg` | 23 | 16 → 11–24 | interface glyphs (`cloud` = Elsewhere) |
| `ui/garland-strand.svg` | 1 | 12×200 | 50 crane silhouettes |
| `notify-icon.svg` | 1 | 36×36 intrinsic, drawn 18×18 | the **only** full-colour SVG (toast `image()`, ≥ half its largest on-screen size × 2): crane `#fbf7ee` on mat `#2f6a55` |
| `layout-preview.png` | 1 | 216×124 | from the 1440×900 whole-window shot (A10) |
| `logo.svg` | 1 | 64 | README, RECIPE |

Total: 120 SVG + 1 PNG in the mod (121 files), plus repo `preview.png`. If the facet split is not needed the
36 `-a/-b/-c` files are still generated but unused (they cost nothing at run time). Runtime vector
art (no files): mat grid (2 elements), mat edge, crease lines, streak track, progress and countdown
bars, storm stripes, garland stripes, all `PathBuilder` in `%` coordinates.

### 13.4 Rendering rules

* `svg()` for every sprite and glyph; `image()` only for `notify-icon.svg` (toast) and
  `layout-preview.png` (Settings), each drawn at ≤ 2× intrinsic size.
* Every label passes through `engine/text.js clip(str, maxGraphemes)` before `.truncate()`.
* Every sprite wrapper with a handler is a `div` (svg/image take no handlers, gpui §7).

### 13.5 Animation plan (native primitives only) and the loop budget

| Effect | Primitive | Bounded by | Calm |
|---|---|---|---|
| Needs-you pulse | `.loop("opacity", {from: 0.55, to: 1, period: 1200})` on the mark | **10 s** after the helper starts waiting; ≤ 6 marks per copy (most recent first); one mark per helper per copy (the tile if the Flock tab shows, else the mat chip) | static |
| New-work spin | `svg(status/working-arc).spin(1200)` | 20 s after the helper starts working; ≤ 4 per copy; panel only | static arc |
| In step spin | `.spin(600)` on visible working badges | while In step (active play only); ≤ 6 per copy; replaces new-work spins | static |
| Gilded crane glide | rendered at x0; the next data tick sets x1 with `.transition("left", {duration: remainingMs, easing: "linear"})` — one-way, no shared-clock loop | crane life | sits still |
| Gilded crane bob | inner `.loop("top", {from: 0, to: −4·z, period: 1300})` | crane life (≤ 26 s) | none |
| Paper Boat | one-way `.transition("left", …)` along the bottom band | boat life | sits at the tray end |
| Storm stripes | paint_path + `.loop("opacity", {0.06 → 0.16, 1200})` | Storm duration (≤ 30 s) | none |
| Envelope landing | newest tray envelope `.loop("top", {from: 0, to: −2·z, period: 1600})` | 10 s after it lands, mat shown | none |
| First-run hint | `.loop("top", {0 → 4·z, 900})` | until the 3rd fold | static |
| Sheet fold | frame swap on each click (data) + `.active(s => s.opacity(0.88))` | — | same |
| Floating "+N" | click handler records `{id, x, y}`; the element renders at `top y`, `opacity 1` with `.transition("top", 700)` and `.transition("opacity", 700)`; **one `cx.timer.after(16)` per burst** flips all new pops to `top y − 28`, `opacity 0`; **one `after(800)`** removes them. ≤ 5 alive | — | off |
| Streak meter, rest bars, string fill, switch knob, crease fade, node expiry | `.transition(width/height/left/opacity, 150/600/600/120/600/2000)` on absolute px | — | ≤ 150 ms or snap |
| Boost countdown | one `.transition("width", {duration: remainingMs, easing: "linear"})` per boost | — | same (a bar, not motion) |

All loop px are multiplied by `settings().zoom` by us (gpui §9).

**Loop budget (asserted by `test/ui-loops.test.mjs` on the recorded element trees):**

* **Steady state = 0** `loop` or `spin` nodes in every copy. Steady state = no hand input in the
  last 30 s, no crane, boat or storm live, and no status change, envelope landing or new-work
  start in the last 20 s. With 30 working agents and a full tray the steady state is still 0.
* **During events**: ≤ **12** loop/spin nodes per copy and ≤ **16** across all copies. If more
  would render, lowest priority drops first: needs-you > crane > storm > envelope > In step spin
  > new-work spin > first-run hint.
* **Calm mode = 0** always.
* Nothing flickers faster than 2 Hz (shortest loop period 900 ms; spins are rotation, not
  flicker).

**Timers and tasks.** Per copy: one data timer (`every`), one `nextCommand` loop, at most one
pop burst pair (`after(16)`, `after(800)`), at most one save write in flight (ticker only). That
is ≤ 5 outstanding host tasks per copy and ≤ 10 for the game, far below the VM-wide 1,024
(qjs §3). No combo or fuse timers: rhythm decays lazily from timestamps.

---

## 14. Accessibility

1. **Status without colour**: every status has a unique silhouette plus a second cue (group
   position, dashed border, opacity, rest bar, motion) and a word in group headers and tooltips.
2. **Contrast**: text ≥ 4.5:1 (muted on chrome ≥ 4.84; ink on sheet ≥ 10.11; onMat on mat ≥ 6.34;
   accent_foreground on accent ≥ 5.65); graphics ≥ 3:1 with the runtime guard for theme colours.
   Text on tinted banners or buttons is `T.foreground`, never a status colour.
3. **Minimum text 11 px** everywhere (names, stack counts, pip counts, labels, help lines).
4. **Targets**: every hit area ≥ 28×28 px (nodes and scraps have 28 px hit areas around smaller
   art); ribbon pips are 14 px pitch but always duplicated by larger targets in the panel/rail and
   by keys.
5. **Motion**: bounded and budgeted (§13.5); calm mode removes all of it; no flicker above 2 Hz.
6. **Keyboard**: `ctrl-shift-y` (answer), `ctrl-shift-j` (envelope), `ctrl-shift-g` (fold);
   the game never steals focus from terminals.
7. **Zoom**: lengths scale with herdr zoom; loop px and pointer positions are converted with
   `settings().zoom`.
8. **Colour-vision tests**: Playwright captures the roster, ribbon and rail in greyscale and with
   deuteranopia and protanopia filters at 0/1/4/12/34/64 helpers; a template match asserts the
   five status glyphs stay distinguishable in every capture (working vs blocked collapses to
   ΔE 8.2 under deuteranopia in paper, so shape must carry it).
9. **Text safety**: all agent titles are grapheme-clipped (ZWJ, VS15/16, skin tones, keycaps,
   tags, regional-indicator pairs); helper names are ASCII.

---

## 15. Build hooks

### 15.1 Engine actions (ARCHITECTURE Part B is filled from this list)

`{type:"click", target:"sheet"|"mini"|"node"|"scrap"|"crane"|"boat"|"ream", id?, t}`,
`{type:"open", helperId, t}`, `{type:"buy", item, count, t}`, `{type:"switch", id, on, t}`,
`{type:"setting", key, value, t}`, `{type:"wish", t}`, `{type:"collect", t}`,
`{type:"observe", helpers:[…], visible, active, matShown, day, t}`, `{type:"rebase", t}`,
`{type:"dismiss", notice, t}`, `{type:"notified", event, day, t}`. All carry `{w, s}` (A5).
`engine.advance(state, now)` is closed form per segment (§10.2) and splits at boost ends, warm
ends, staleness and cap breakpoints; `engine.view(state)` returns the plain view-model the UI
renders. PRNG: mulberry32 in `state.rng`.

### 15.2 Module layout

`main.js` routes `props().role` → `panel` | `ribbon`; `engine/{state,rules,economy,helpers,
envelopes,prestige,away,prng,format,text,save-codec}.js` (pure); `glue/{session,live,observe,
store,notify,commands,clock,views}.js`; `ui/{panel,mat,flock,shop,string,settings,ribbon,rail,
banner,away,color,palette,art,widgets}.js`. Each import on one line (pat §8).

### 15.3 Tooling (restated from ARCHITECTURE A7–A12)

* **Node mock of herdr** (`tools/mock`): agents and terminals with `turn`, `parent`,
  `created_ms`; `run` validated against `src/commands.rs` names (`pane.focus`, `terminal.peek`,
  `layout.show`, `layout.toggle`, `layout.resize`); `notify` log; CAS files with fault injection;
  virtual clock; six themes.
* **QuickJS-ng wasm harness** (`tools/qjs`): frozen prototypes, no `eval`/`Function`, throwing
  timer stubs, module resolution, budgets (load 500 ms, init 500, render 50, handler 500); our
  targets: load < 50 ms, render ≤ 8 ms at 64 helpers; hot reload mid-write; VM restart.
* **Playwright screenshots** (`tools/shots`): views listed in `glue/views.js` — `empty`,
  `first-run`, `standard-4`, `needs-you-3`, `finished-2`, `tray-full`, `storm`, `crane`, `boat`,
  `chain-7`, `in-step`, `flock-12`, `flock-34`, `flock-64-dense`, `flock-elsewhere`, `album`,
  `shop-{works,tools,folk,charms,curios,auto}`, `string-locked`, `string-ready`, `string-confirm`,
  `garlands`, `settings`, `away`, `busy`, `banner-{recovered,fresh,conflict,merged,error,newer,clock}`,
  `rail`, `rail-64`, `rail-banner`, `ribbon-{0,4,34,64,130}` at 1100 and 1440 widths, `narrow`,
  `wide`, `short`, `calm` — each in **all six shipped themes** at zoom 1 and 1.5; greyscale,
  deuteranopia and protanopia captures of roster, ribbon and rail; **whole windows at 1440×900
  and 1100×700**, expanded, folded, hidden, and with the Files panel open, in paper and graphite.
  Every shot is looked at before a round is called clean.
* **Pacing simulator** (`tools/sim/pacing.mjs`): drives the real engine (`apply`/`advance`) with
  the profiles in BALANCE.md, 20 seeds each, and asserts its milestone table and invariants.
* **Other tests**: SVG checker; palette contrast recomputation; loop budget; grapheme fuzz over
  every rendered text node with the emoji corpus; `__proto__`/`constructor`/`toString` addresses;
  keys.json against `valid_action` and the default chords; layout JSON fields and ids; save codec
  damaged inputs; merge and idempotence; notification cap across two writers.

### 15.4 Share package

`layouts/Creaseworks.json`, `mods/creaseworks/`, `keys.json` (only `layout:Creaseworks`),
`RECIPE.md` (herdr's section order: name + picture, What you see, How it behaves, Built from,
Watch out, Done when), `preview.png`, plus `README.md` and `LICENSE` (MIT, Copyright (c) 2026
Tyler Coles). The mod reaches no network, runs no programs and reads no files outside its data
folder (and the shared save path if the player sets one); RECIPE says so (share §8 step 1).

---

## 16. Judges' must-fix items: where each is closed

| Item | Closed in |
|---|---|
| Lease/follower/inbox two-window design deleted; A4–A6 adopted (CAS, backup rotation, damaged-1..5, actions with writerId/seq, replay merge, clock ownership, drops by (helperId, turn), inflight handover); shared path explicit; residual race documented | §12, §6.1, §10.2 |
| Helper key (home vs shared terminal): `address#created_ms`, reasoning and residual risk stated | §5.1, §17 R6 |
| Notifications opt-in, ≤ 3/day shared via the save, no sound, never for save problems unless opted in (and then inside the cap), never for agent status; ribbon `layout.show` instead of toasting | §11.2, §3.8 |
| Cross-copy rendering: every copy has its own data timer, re-renders on slot `rev`; no foreign `cx` | §12.4 |
| Loop/CPU budget numeric and tested; spinners capped; no flying band; one envelope bobs | §13.5 |
| Pacing: one time unit (play-clock hours, wall mapping), per-source shares, 20 seeds, 30 agents ≥ 12 h, 64 agents ≥ 10 h, typical on day 3, calm equal | BALANCE.md |
| 30+ readable in every fold state: ribbon pips 12 px at 14 px pitch in two rows; rail per-helper grid; urgent always individual; stable order | §3.9, §3.10, §5.5 |
| Envelope scaling: per-helper stacking + 60 s unit rule + overflow conversion; player chooses timed boosts | §6 |
| Narrow windows: 1100×700 behaviour, rail via `layout.resize`, hint, main min 360, window shots at both sizes | §2.2–2.3, §15.3 |
| Unverified primitives replaced or given fallbacks (`.spring` → `.active` opacity; long transitions; facet alpha; `layout.resize` persistence; `local_position` guard) | §3.2, §6.2, §13.1, §17 |
| Timers: one data timer per copy; no combo timers; pops batched; ≤ 10 tasks | §13.5 |
| localStorage only for UI conveniences, try/catch, separate store per role | §12.6 |
| Text through `clip()`; ASCII names; emoji and prototype-key fuzz | §5.1, §13.4, §14 |
| Asset plan via generator + checker; facet fallback generated from day one; image() ≤ 2× intrinsic | §13.1, §13.3 |
| Calm mode changes no earnings, removes every loop and spin | §11.1 |
| One theme, one name, name search recorded | §1 |
| Brief items stated: no duplicate of herdr's toast; pane.focus / terminal.peek after liveness; 8 h cap with clock-backwards protection; a switch per automation; MIT licence; share format and keys scoped to layout:Creaseworks, IBus avoided | §5.6, §10.1, §8, §15.4, §2.6 |
| Status contrast guard per surface; two non-colour cues; distinct done vs envelope glyphs; 11 px minimum; text on tints uses foreground | §5.2, §3.8, §14 |
| Identity hues ≥ 3:1 per appearance, never glyph-on-own-tint | §13.2 |
| Central clickable boundary ≥ 3:1; dark sheet dimmed | §13.2 |
| `paint_path` one Background per element (mat grid split, garland stripes) | §3.2, §3.5 |
| Status colours keep the theme keys | §5.2 |
| Gilded crane/boat no longer driven by the shared loop clock (no mid-flight start, no reversal) | §13.5 |
| Per-agent status visible on every tab (ribbon), not only the Flock tab | §3.10 |
| MIT licence and full tooling restated | header, §15 |

---

## 17. Appendix: open risks

| # | Risk | Status | Mitigation / fallback |
|---|---|---|---|
| R1 | `svg()` alpha masks may flatten `fill-opacity` facets | unverified (gpui §3 describes a mask) | split files generated from day one; one constant flips the renderer (§13.1); check once on the contact-sheet view |
| R2 | Very long `.transition` durations (boost countdown up to 240 s, crane glide 26 s) not watched in herdr | allowed by the validator (≤ 86,400,000 ms, gpui §9) | fallback: set the width/left on each data tick (1 s steps) |
| R3 | `layout.resize` on a px node may not persist in `layouts/.state/Creaseworks.json` | unverified | the panel copy re-applies the stored width (localStorage) on `init`, guarded by `checking()` |
| R4 | `layout()` may not expose node sizes (Files panel width) | unverified | assume 368 px for `mainEst` |
| R5 | Hosted spinners paint above the view (gpui §9); clipping inside scroll areas and under the away card is unverified | open | spinners only on visible tiles, ≤ 6, never under absolute cards (cards hide spins while shown) |
| R6 | Helper id `address#created_ms` collides if two different terminals share address and creation ms (two homes starting cores at once), or their strings clash in the 32-bit hash (≈ 1e-7 for 30 present agents); a remote terminal named differently in two homes becomes two helpers | mitigated | a terminal whose plain id is held by a different present terminal takes a salted id (§5.1), so a clash never loses a present agent; Album records keep no address, so a returning agent whose id clashes with a gone helper's record rejoins that record (their stats merge) |
| R7 | Cross-process CAS race (life §6.3) | accepted | idempotent actions + merge; ≤ 15 s of one window's progress can be overwritten until its next save re-applies it |
| R8 | `turn` behaviour across a core restart | rebaseline rules (§6.1) | `turn < lastTurn` → rebaseline, no reward |
| R9 | Clicking a mod block might move keyboard focus off the terminal | unverified | nothing is focusable; verify by hand; if focus moves, refocus the last `focused()` pane on mouse-up |
| R10 | `on_mouse_down` `local_position` absent before first paint | known (gpui §7) | `?.` with the element centre as fallback |
| R11 | Rem-based ramps and zoom (gpui open question 1) | open | use numeric px everywhere in our UI |
| R12 | `.active()` opacity on a stateful div is the only press feedback | verified API, unwatched | if invisible, swap the Sheet frame one tick early as feedback |
| R13 | Save size with years of Album entries | bounded | fledglings fold into parents after 30 days or beyond the 200 most recently gone; Album pane helpers beyond the 200 most recently gone are compacted to `{id, name, species, hue, folds, tasks}` plus the minute they left (≈ 40 B packed; §5.1), never dropped. Count-based, so deterministic and free of a size measurement. Measured: 5,000 lifetime pane helpers ≈ 220 KB; a year of 20 agents a day with 3 fledglings each ≈ 350 KB (save cycle ≈ 280 ms in the QuickJS harness). Residual: at ≈ 40 B per compacted helper, 512 KiB is reached near 12,000 lifetime pane helpers and herdr's 1 MiB write limit near 25,000 (≈ 3.5 years at 20 a day) |
| R14 | The pacing targets come from a calibration prototype, not the engine | checked | the shipped simulator (real engine, 12 profiles × 20 seeds) passes every BALANCE.md row (P1 first wish median 21:39, day 3 13:39) with the † constants unchanged except the bench-pace exponent, retuned 0.15 → 0.07 when the bench pace became marginal (§5.3; P6 12:42, P7 11:21); it keeps asserting them (`npm run sim -- --assert`, `test/pacing/`); † constants are the retune knobs, in the order BALANCE.md lists |
| R15 | Second-wish pacing (gate `max(5, ceil(0.25·W))`) not calibrated | provisional | BALANCE.md marks M17 provisional (simulated: M15 + 18:02 median, inside its window); retune the gate, not `Lw` |
| R16 | IME/ chord conflicts beyond IBus `ctrl-shift-u` (e.g. Fcitx) | low | chords are only in `layout:Creaseworks`; RECIPE tells people how to rebind |

# Foldwick: design proposal (angle: art and readability first)

Status: proposal. Platform: herdr-app v0.1.18 (QuickJS-ng, gpui-kit). Platform claims cite
`docs/research/*.md` ("host-api §6" means section 6 of that note). Numbers in §4 to §7 were
checked with a throwaway pacing prototype
(`/tmp/claude-0/-home-user-turbo-octo-robot/765765b0-bd4e-5d4c-890a-1f1834a9bff2/scratchpad/sim.mjs`).
The shipped simulator (ARCHITECTURE A11) replaces it and asserts §10.

Angle: every sprite is a hand-written, single-colour SVG silhouette, tinted at run time. The
same file therefore works in light and dark themes and stays crisp at any zoom. Every agent's status
is carried by **shape and motion first** and colour second, so it reads without colour. With 30
or more agents, the roster is a calm grid that can be scanned in one glance. Inside those rules,
the game should feel tactile and a little silly: you fold paper by clicking, and small paper
animals fold beside you.

---

## 1. Name, pitch, theme

**Name:** Foldwick.
**Pitch:** *A paper village on the corner of your desk. You fold by hand; your agents, as paper
folk, fold beside you.*

**Theme.** Foldwick is a tiny village of folded paper that lives on a green cutting mat. In the
middle of the mat lies **the Sheet**, a big square of paper. Each click makes one fold in it, and
every eighth click finishes a figure that hops onto the village shelf. Each coding agent in the
window is one of the **paper folk**: a folded crane, frog, fox, koi, rabbit, turtle, butterfly,
whale, owl, boat, mouse or snail, each in one of eight paper colours. The resource is **folds**.
Folds buy **workshops** (generators), **tools, folk care, charms and curios** (upgrades) and
**automations**. When the shelf is full of a run's figures, the player **releases the flock**: the
figures fly off as paper cranes and leave **Wishes** behind (prestige).

**Why it is clearly not a side-scrolling dungeon game.** There is no scrolling world, no
character who walks, no rooms, enemies, combat, health, loot or map. The scene is one fixed
top-down view of a cutting mat, like a desk seen from above. Progress shows as figures on a
shelf, workshops in a list and Wishes in a jar. The fantasy is crafting things with your own
hands, not exploring.

**Why the metaphor fits "I click, my agents help".**
- Folding is one small action repeated many times. Each click really is a fold, and the Sheet
  changes shape with every click (eight frames), so the player feels their own work.
- Folding is easy to share: the folk fold their own sheets beside you (auto-gathering) and bring
  you finished work in **envelopes** (task-finished drops).
- An agent waiting for input **raises a paper pennant**: a triangle flag, the universal "look
  here" shape. An idle agent **lies flat under a book** and gets pressed crisp, which stores up a
  boost for its next task. Sub-agents are **fledglings**: small diamonds of paper riding beside
  their parent.
- Paper suits flat-vector art. Folded figures are made of straight-edged polygons. Facets are
  shown by alpha steps inside one tinted silhouette (§9.1), so a whole species costs one small
  SVG file.

**Identifiers**

| Item | Value | Why |
|---|---|---|
| Mod folder | `mods/foldwick/` | lower case, no `.` (because `<mod>.<cmd>` splits on the first dot), not `frame-*` (layouts-share Do 2) |
| Layout file | `layouts/Foldwick.json` | ASCII letters only. It shows as `Foldwick` in Settings, as `Layout: Foldwick` in the palette and as `(layout:Foldwick)` in Keys (layouts-share §4) |
| Data folder | `<appHome>/data/foldwick/` | `save.json`, `save.bak.json`, `save.damaged-<n>.json` (ARCHITECTURE A4) |
| Settings picture | `mods/foldwick/art/layout-preview.png`, 216×124 px, shown at about 108×62 | install copies the mod folder, not the repo root (layouts-share §5) |
| herdr.dev card | `preview.png`, 1600×1000, at the repo root | share format |
| Mod commands | `foldwick.fold`, `foldwick.answer` | the dot form; the colon form makes keys.json invalid (host-api §11) |

**Name check.** A web search for "Foldwick" (2026-11-25) found no game, product or studio with
that name, only unrelated surnames and English place names (Fieldwick, Butterwick). Rejected
alternatives: "Foldlings", which is an existing pop-up-card design tool from Dartmouth research;
"Creased", an existing student platformer about origami; anything with "Kami" (*Kami* is a
known puzzle game); and "Fold"/"Foldit", which are known titles. The paper animals are generic real
animals and the workshop names are ordinary craft words, so no characters, art or names are
borrowed. The paper-crane wish is a folk tradition, not a game, and the game only nods at it
through the word "Wishes".

---

## 2. Placement in the herdr window

### 2.1 Decision: a right-side panel (`fw-panel`) that folds to a 64 px rail

Foldwick is option (b) from layouts-share §10. It is the **last child of `work-body`**, after the
hidden Files/Changes `panel`, and keeps every id from the shipped `main.json`.

```jsonc
// layouts/Foldwick.json = main.json with these three changes (full file generated by tools)
// 1. "main" (the tab block) gets  "min": 320
// 2. new last child of "work-body":
{
  "id": "fw-panel", "type": "block",
  "size": {"px": 320}, "min": 64, "max": 560,
  "radius": 10, "border": {"width": 1, "color": "border"}, "background": "chrome",
  "content": {"mod": "foldwick", "props": {"role": "panel"}}
}
// 3. root: "preview": "mods/foldwick/art/layout-preview.png"
```

`mods/foldwick/mod.json` is
`{"place":"none","title":"Foldwick","palette":[{"title":"Foldwick: hide or show the panel","command":"layout.toggle","args":{"id":"fw-panel"}},{"title":"Foldwick: fold or unfold the panel","command":"foldwick.fold"}]}`.
`"place":"none"` stops herdr docking a copy into the person's other layouts (host-api §12).

### 2.2 Why a panel

| Need | Panel (chosen) | Bottom strip | Own pane | Drawer |
|---|---|---|---|---|
| Room for a real scene (art angle) | 304×232 mat | about 112 px tall: the scene would be a sliver | full | narrow |
| Readable roster of 30+ agents | vertical grid, 5 to 7 columns | one scrolling row | yes | poor |
| Terminals stay visible and usable | yes, they keep the width minus 328 px | yes | no: one or the other | covers terminal text |
| Clicking without leaving the work | yes | yes | no | yes, but it occludes |
| Shrinks to almost nothing | 64 px rail, one key | 72 px min | n/a | 52 px peek |

At 1440×900, terminals keep 1440 − 268 (sidebar) − 328 (panel plus gap) − 16 (padding) = **828 px**,
about 100 columns at the default font. At 1100 px wide they keep 488 px. The game then
suggests folding to the rail with a one-time hint ("Narrow window: press ctrl-shift-g to fold
Foldwick to a rail"). That hint appears when `on_size_change` sees the window, measured as panel
width plus `main`, below 900 px. Folded, terminals keep 760 px.

Terminals stay usable because:
1. The panel **never takes keyboard focus**. Clicks on it do not move focus away from the
   focused pane: there is no `track_focus` and no `"focusable"` in `mod.json`.
2. It never calls `pane.focus`, except when the player clicks a "needs you" cue.
3. It never plays sounds and never calls `setAgentOrder`, `setWindowTitle` or `setBadge`.
4. The `main` block keeps `min: 320`, so a drag can never squeeze terminals below 320 px.

### 2.3 Width states (from `on_size_change`, divided by `settings().zoom`)

| State | Measured width | What renders |
|---|---|---|
| Rail | < 140 px (default 64) | the vertical rail, §3.9 |
| Narrow | 140–279 | scene at 100 % width and 200 px tall; roster tiles 4 across; shop names only |
| Standard (design size) | 280–399 (default 320) | every view as drawn in §3 |
| Wide | ≥ 400 | mat 260 px tall; roster up to 8 columns; shop rows show the effect and payback columns |

**Fold and unfold.** `foldwick.fold` runs `run("layout.resize", {id: "fw-panel", px})`
(validated against `src/commands.rs`: `layout.resize` takes `id`, `px?`, `weight?`). It toggles
between 64 and the last unfolded width, which is stored in the save under `ui.panelPx`
(default 320). The rail is the same copy re-rendering, so mod commands always reach it.
The fully hidden state exists only through the palette entry (`layout.toggle`). It has no key,
because a hidden copy cannot receive `foldwick.*` commands (layouts-share §3.2).

### 2.4 Keys (`keys.json`, merged into the person's file)

```json
{
  "layout:Foldwick": {
    "ctrl-shift-g": "foldwick.fold",
    "ctrl-shift-j": "foldwick.answer"
  }
}
```

| Chord | Action | Why this chord |
|---|---|---|
| `ctrl-shift-g` | fold or unfold the panel | not in `defaults/keys.json` or `keys.macos.json` (layouts-share §3.3). The mod is always shown (rail or panel), so the command always arrives |
| `ctrl-shift-j` | **answer**: focus the helper that has waited longest in "needs you" (`pane.focus` or `terminal.peek`) | free. It does no damage when nothing waits: the footer then shows "Nobody needs you", with no toast |

Avoided: plain ctrl+letter (it belongs to programs), alt+letter (readline word motions), all
the herdr default chords listed in layouts-share §3.3, `ctrl-shift-u` (the IBus Unicode entry on
Linux) and `ctrl-shift-c/v/f` (terminal section). Keys stay in `layout:Foldwick`, so other
layouts are unaffected. Our test checks the file with the real `valid_action` rules: one bad
entry would reject the person's whole keys.json.

---

## 3. Views

Notation: sizes are logical px before zoom. `T.x` is herdr `theme()` key `x`. `S.x` is a scene
token from §9.2, picked by `settings().dark`. Type sizes use `text_size(n)`. Weights: 400 regular,
600 semibold. Every clickable has a stable `.id()`.

### 3.1 Panel frame, standard 320 × H (H = 814 at 1440×900; 614 at 1100×700)

```
x:0                                                                          320
┌───────────────────────────────────────────────────────────────────────────┐ y:0
│ HEADER 44  [fold 18] 12.4K folds 20/600 T.foreground  +86.2/s 12 T.muted │
│            [▲ 2 need you] pill 22h        [wish 14] 3      [gear 24]     │
├───────────────────────────────────────────────────────────────────────────┤ 44
│ SAVE BANNER 28 (only when a save notice exists, §3.7)                     │
├───────────────────────────────────────────────────────────────────────────┤ 44(+28)
│ MAT 304×232 at x 8, rounded 10, S.mat  (§3.2)                            │
├───────────────────────────────────────────────────────────────────────────┤ 292
│ BOOST BAR 26: chips, or a muted hint                                      │
├───────────────────────────────────────────────────────────────────────────┤ 318
│ TABS 32: Flock 30 | Shop | Wishes      12/600 underline 2px T.accent      │
├───────────────────────────────────────────────────────────────────────────┤ 350
│ CONTENT flex_1 min_h 0, overflow_y_scrollbar (Flock §3.3 / Shop §3.4 /    │
│ Wishes §3.5 / Settings §3.6)                                              │
├───────────────────────────────────────────────────────────────────────────┤ H-22
│ FOOTER 22: [save glyph 10] Saved 12 s ago 11 T.muted      [Calm] 11       │
└───────────────────────────────────────────────────────────────────────────┘ H
```

- Panel background `T.chrome`. Dividers are 1 px `T.border`. Text: `T.foreground` for values and
  `T.muted` for labels. Measured contrast of muted on chrome is 6.62 (graphite) and 4.84 (paper), both AA.
- Header count: short suffixes K, M, B, T, Qa, Qi, then `1.23e21`, all formatted by our own code
  (no `Intl`). Rate is `+` plus the passive rate per second, updated by the 1 s data tick.
- "Need you" pill appears only when n ≥ 1: `T.blocked + "26"` background (always 6 digits,
  mod-patterns §2.3), triangle glyph 12 px plus `n need you` in 11/600 `T.blocked`. Click opens the
  oldest waiting helper, the same as `foldwick.answer`.
- Gear opens Settings in the content area. The tabs row then shows "← Back".
- Footer save glyph: check (saved), dots (saving), triangle (problem). The shape carries the
  meaning; the colours are `T.muted`, `T.muted` and `T.blocked`.

### 3.2 Main scene: the mat (304 × 232)

```
mat-local x:0                                                          304
┌──────────────────────────────────────────────────────────────────────┐ y:0
│ TOP BAND 28: needs-you chips [▲ Mina] [▲ Koto] [▲ Pib] +2            │
│   (when nobody needs you: the shelf, up to 12 finished figures 16px) │
├──────────────────────────────────────────────────────────────────────┤ 28
│  (1)            ·      ·      ·     ·        ✦ gilded crane 40×28    │
│        ┌──────────────┐                                              │
│        │  THE SHEET   │  112×112, centre (152,114)                   │
│  (2)   │  frame 0..7  │        ▫ scrap 16                            │
│        └──────────────┘                     (3)  crease nodes 22     │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤ 200
│ BOTTOM BAND 32: tray [env][env][env][env][env][env] +4   streak ▮▮▮▯ ×1.4 │
└──────────────────────────────────────────────────────────────────────┘ 232
```

- **Mat**: `S.mat` fill, rounded 10. A grid is painted with one `window.paint_path` stroke path:
  minor lines every 16 px at 1 px in `S.grid`, major lines every 64 px at 1 px in `S.gridMajor`.
  Coordinates are in `%`, so the grid scales with the mat. There is also a 4 px inner edge in
  `S.matEdge` at the bottom (a paint_path rectangle) to give a slight tabletop depth.
- **Sheet** (§4.1): two stacked `svg()` layers, `sheet/<n>-base.svg` tinted `S.sheet` and
  `sheet/<n>-shade.svg` tinted `S.sheetShade`. They sit inside a `div` with id `fw-sheet` that has
  `on_mouse_down("left")` (which gives the position for the floating number) and
  `.active(s => s.opacity(0.88))` for press feedback. A 1 px `S.crease` frame shows the fold
  number as 8 ticks under the sheet (6×2 px each; ticks already done use `S.sheet`).
- **Crease nodes** (§4.2): `div` 22×22, `rounded_full`, background `S.sheet`, 2 px border
  `S.node`, and a number in 11/600 `S.ink`. Ids are `fw-node-<chain>-<i>`.
- **Scrap**: `svg("scene/scrap.svg")` 16 px tinted `S.sheet`, inside a 28×28 hit `div`
  (`fw-scrap-<id>`). The hit area is always at least 28 px.
- **Gilded crane**: three layers, `crane-gilded-{outline,body,shade}.svg`, tinted `S.goldInk`,
  `S.gold` and `S.goldShade`, in a 48×36 hit `div` (`fw-crane`).
- **Needs-you chips** (top band): height 22 and `rounded(11)`. The background is `T.popover`.
  The border is 1 px `S.sheet`, so the chip separates from the mat even in dark themes, where
  popover against mat is only 1.21:1. Each chip has the `status/needs.svg` triangle at 12 px
  tinted with the status colour (§5.2), a name in 11/600 `T.foreground`, and `px(8)`. Up to 4
  chips, then a `+n` chip. Click opens the helper (§5.2). Each chip `cx.stop_propagation()`s.
- **Tray** (bottom band): envelopes are 28×20 hit `div`s with
  `scene/envelope-{body,flap}.svg` tinted `S.sheet` and `S.sheetShade`. A 10 px boost-type badge
  sits at the top right (shape per type, §5.3). A stack count of 2 or more shows as
  `×n` in 9/600 `S.ink` on the flap. At most 6 are drawn, then a `+n` text.
- **Streak meter**: track 96×6 `S.grid`, fill `S.node`. Its width uses `.transition("width",150)`.
  The label `×1.4` is 11/600 `S.onMat`.
- **Floating numbers**: `+1.2K`, 12/600 `S.onMat`. At most 5 are alive. Mechanics are in §9.4.
- **Storm overlay** (Paper Storm active): an absolute `paint_path` rectangle covering the mat,
  filled with `Background.pattern_slash(S.onMat, 2·zoom, 12·zoom)` and pulsing with
  `.loop("opacity", {from: 0.06, to: 0.16, period: 1200})`. Since there is no z-index, it is the
  **first** child of the mat (painted under everything else), and the mat border becomes 2 px `S.node`.

Spawn positions come from a 10×5 grid of slots in the play field (y 28–200, each slot 30.4×34.4),
skipping the six slots that overlap the sheet. The slot is picked by the engine PRNG. Nothing
overlaps the sheet, so no hit test is ambiguous (gpui-ui §7). Pickups that are drawn later call
`cx.stop_propagation()` anyway.

### 3.3 Flock (helper roster) for 0 to 64+ agents

```
┌ detail card 64 (only when a tile is selected) ─────────────────────────┐
│ [crane 40] Mina · crane · paper "vermilion"   12/600                   │
│            claude: fix flaky test (pane title, clipped) 11 T.muted     │
│            Working 14m · 2 fledglings · 1.3M folds lifetime            │
│            rest ▮▮▮▮▯ 80%                          [Open pane] button   │
└─────────────────────────────────────────────────────────────────────────┘
 ▲ NEEDS YOU 2                                    11/600, header 24 px
 [tile][tile]
 ■ ENVELOPE READY 3
 [tile][tile][tile]
 ● WORKING 12
 [tile][tile][tile][tile][tile]
 [tile][tile][tile][tile][tile] ...
 ◗ RESTING 13                                     (fold ▾/▸ per group)
 ...
 ALBUM (9 helpers who have left)  ▸               collapsed by default
```

**Tile (normal, at most 20 helpers): 52×60**, gap 6, columns = `floor((w − 16 + 6) / 58)`, which
gives 5 at 320.
- Background `T.raised`, `rounded(8)`, 1 px `T.border`. Hover shows `T.hover`.
- Species glyph 28 px tinted with the helper's hue (§9.2) and centred at y 6.
- Status badge 18×18 at the top right (−4, −4): a circle in `T.popover` with a 1 px `T.border`
  ring, holding the 12 px status glyph tinted with the status colour (§5.2).
- Name in 11/400 `T.foreground` at y 40, clipped by `clip()` to 6 graphemes, then `.truncate()`.
- Fledgling pips: up to 4 diamonds of 6 px in a row at the bottom left over the glyph, then `+n`
  in 9 px.
- Rest bar (resting only): 2 px at the bottom, width `40 × rest`, colour `T.muted`, with
  `.transition("width",600)`.
- Needs-you tile: border 2 px **dashed** in the status colour. This is a second shape cue.
- `.tooltip("<name> · <species> · <status words> · <agent title clipped to 60>")`.

**Dense tile (21 or more helpers, or the "dense" setting): 40×44**, gap 4, which gives 7 columns
at 320. The glyph is 22 px, the badge 14 px, there is no name (the tooltip has it), the pips are
4 px and the rest bar is 1.5 px. With 30 helpers that is 5 rows × 48 = 240 px. With 64 it is
10 rows. The groups fold, and the content area scrolls with `overflow_y_scrollbar()`.

**Order:** fixed group order Needs you, then Envelope ready, then Working, then Resting. Within
"Needs you" the longest-waiting helper comes first. In every other group tiles keep **join order**,
so they never shuffle when rates change. A helper moves only when its status group changes.

**Album:** helpers whose agent has gone. They are 28 px rows: glyph 16, name, "left 3 d ago",
lifetime folds. They never produce. They keep their identity, so a returning agent (same
address and `created_ms`) rejoins with its history.

**Empty state (zero agents):** in place of the groups, a 304×200 card on `T.raised`. It shows
three outline species (crane, fox, koi) at 40 px tinted `T.dim`, at 0.6 opacity. The text is
"No paper folk yet." (13/600) and "Start a coding agent in any tab. Every agent herdr shows in
the sidebar joins your flock as a helper." (11 `T.muted`). Under it is the **status legend**: the
four badges with their words. It is always visible here and also behind the "?" on the Flock tab:
- ● spinning arc: Working, gathering folds
- ▲ pennant: Needs you, click to open
- ■ envelope: Finished, a reward is waiting
- ◗ crescent: Resting, storing a boost

### 3.4 Shop

The second row is a segmented control, 28 px tall, 6 segments of about 50 px: **Workshops |
Tools | Folk | Charms | Curios | Auto**. Each segment has a 14 px icon and a label in 10/600. In
the Narrow state it shows icons only, with tooltips.

```
┌ row 52 ─────────────────────────────────────────────────────────────────┐
│ [icon 28]  Glue Pot  ×17          13/600 T.foreground         [ 31.2K ] │
│            +11/s each · 187/s total   11 T.muted          in 2m 10s 10   │
└──────────────────────────────────────────────────────────────────────────┘
```

- The buy button is a 72×28 `div`, `rounded(6)`. Affordable: `T.accent` background with
  `T.accent_foreground` text, 12/600. Unaffordable: `T.raised` background, `T.muted` text and the
  time-to-afford line. The "affordable" state also gets a 3 px left bar in `T.accent`, a shape cue
  as well as a colour cue.
- Workshops: a top-right toggle `×1 | ×10 | Max`. Tier upgrades appear inline under their
  workshop as 36 px sub-rows once unlocked.
- Upgrades are revealed when their cost ≤ 3 × the bank, or when their predecessor is owned.
  Bought ones collapse into an "Owned (n) ▸" fold at the bottom of the segment.
- Auto segment: each automation row has its buy button and, once owned, a **Switch** (unstyled
  `Switch.new(id)` drawn by us: a 32×18 track, `T.accent` when on and `T.input` when off, and a
  14 px knob in `T.foreground`, moved with `.transition("left",120)`), plus an "on" or "off"
  label. The label is text, not colour alone.

### 3.5 Wishes (prestige)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [wish jar 64]   Wishes 14   +70 % folds and clicks        16/600         │
│                 This run: 2.31B folds  (lifetime 9.8B)    11 T.muted     │
├──────────────────────────────────────────────────────────────────────────┤
│ Release the flock                                          13/600        │
│ You would gain  +11 Wishes   → +125 %                      20/600 T.accent│
│ ▕██████████████████████░░░░░▏ 11 / 10 needed (first release) bar 8px    │
│ Resets: folds, workshops, upgrades, boosts. Envelopes open first.       │
│ Keeps: helpers and their history, Wishes, perks, settings, switches.    │
│                                   [ Release 11 Wishes ]  disabled < 10  │
│ (after the click:  Release now?   [Not yet]  [Release]  — a 2-step row) │
├──────────────────────────────────────────────────────────────────────────┤
│ Perks:  10 ✓ Keep Mail Sorter and the first Tools upgrade                 │
│         25 · Start each run with 5 Paper Stacks                          │
│         50 · Gilded cranes come 20 % sooner                              │
│        100 · Long Table +2 (bench room for big flocks)                    │
│        250 · Envelopes stack to ×15                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

The jar is two tinted layers (`ui/jar-glass.svg` in `T.muted` at 0.5 and `ui/jar-fill.svg` in
`T.accent`). The fill is clipped with a `div` whose height is `64 × min(1, W/100)`, and that
height animates with `.transition("height",400)`.

### 3.6 Settings (replaces the content area; the tabs row shows "← Back")

Rows of 36 px: label 12/400 plus a help line 10 `T.muted`, with the control on the right.
1. **Calm mode** switch (§8.1).
2. **Notifications** master switch (off by default), then four checkboxes, with the line
   "n of 3 sent today" (§8.2).
3. **Automations**: one switch per owned automation, the same switches as the Auto segment.
4. **Roster density**: Auto (dense at 21 or more) | Always | Never. A Radio group drawn by us.
5. **Floating numbers** switch (on by default; forced off in calm mode).
6. **Number style**: Short (12.4K) | Scientific (1.24e4).
7. **Save location**: shows the path. "Use a shared path…" opens an `Input` for an absolute path
   so that two app homes can share one save (§11). There is also a "Check save now" button.
8. **Reset game…**: a two-step confirm. The old save is kept as `save.damaged-<n>.json`, named
   "reset".

### 3.7 Save-problem banner (28 px, below the header; never silent)

| Kind | Glyph | Background | Text (11/600 + 11/400) | Action |
|---|---|---|---|---|
| `recovered` | warn triangle | `T.working + "1f"` | "Save was damaged. Loaded the backup from 14:02." | Details ▸ · Dismiss |
| `fresh` | warn triangle | `T.blocked + "1f"` | "Save and backup were damaged. Started fresh; old files kept." | Details ▸ (shows both kept file names) |
| `conflict` | two arrows | `T.raised` | "Another window changed the save. Merging…" | none; clears itself when the merge lands |
| `error` | warn triangle | `T.blocked + "1f"` | "Can't save: <first 60 graphemes of the host error>. Retrying in 30 s." | Retry now · Details ▸ |
| `newer` | lock | `T.blocked + "1f"` | "This save is from a newer Foldwick. Read-only until updated." | Details ▸ |

Details expands to a 3-line card: file path (with middle truncation), time of the last good save,
and backup state. In the Rail the banner becomes a 20 px triangle at the top of the rail with the
same tooltip. Status colours are 6-digit (host-api §8), so appending alpha is safe.

### 3.8 "While you were away" card

Shown when the away gap is 5 minutes or more. It is an absolute card 304 px wide, at x 8 and
y 80, over the mat: `T.popover` background, 1 px `T.border`, `rounded(10)`, `shadow_lg`, padding 14.
Gaps under 5 minutes credit silently and the footer says "+3.4K while away (2 m)".

```
 While you were away                                  13/600
 7 h 42 m  (Foldwick counts up to 8 h)                11 T.muted
 ─────────────────────────────────────────────
 [fold]  +4.81M folds                                 20/600
         workshops 3.10M · helpers 1.71M              11 T.muted
 [env]   9 envelopes are waiting on the tray
 [▲]     2 helpers need you: Mina, Koto
 [◗]     5 helpers rested fully (next tasks ×2)
 [✓]     Best helper: Pib the frog, 31 tasks
                                       [ Collect ]  72×28 T.accent
```

The folds wait in the card until **Collect** is clicked, which is one satisfying click. After
10 minutes without a click they are credited anyway and the card turns into the footer line.
Nothing is lost.

### 3.9 Rail (64 × H)

From the top: save-problem triangle (if any), 20 px; the count in 11/600, two lines, for example
"12.4K / +86/s"; the mini Sheet, 44×44 and clickable (`fw-sheet-mini`, one fold per click, no
floating numbers); the needs-you pennant with n (28 px, opens the oldest); the envelope with n
(opens the oldest); then four stacked status counts (glyph 12 plus number 10) for ● ▲ ■ ◗. At the
bottom is the "unfold" chevron button (`foldwick.fold`). When a Gilded crane is live, its 24 px
icon is drawn above the chevron and is clickable. The rail keeps the game playable at 64 px.

### 3.10 First run, `checking()`, and VM-restart preview

- **First run** (no save): the empty Flock card (§3.3) plus a mat overlay hint over the Sheet:
  a chip "Click the paper to fold it" with a down-pointing triangle bobbing
  (`.loop("top",{from:0,to:4·z,period:900})`). It disappears after the 3rd click and never comes
  back (`ui.hints.fold = true`). The first Gilded crane is fixed at 6 min 30 s of active, visible
  time, with a one-line hint "A gilded crane! Click it before it flies off."
- **`checking()`**: the static standard view with a scripted demo state: 3 helpers (working,
  needs you, resting) and no timers or writes (mod-lifecycle Do).
- `window()?.visible === false`: the data timer drops to 5 s and no spawns happen (§4.6).

---

## 4. Clicking

Definitions (all per second unless stated):
- `Rw` = Σ workshops `n_k × O_k × tier_k × G`.
- `H_i` = helper rate (§5.1). `Hs` = Σ working helpers' `H_i` after crowding (§5.5), with
  **no temporary boosts**.
- `Rp = Rw + Hs` is the passive rate. It drives every "N seconds of production" value. Boosts
  never compound through it.
- `G = 1 + 0.05 × Wishes` is the global multiplier.

### 4.1 The Sheet (central object)

```
V      = (1 + flat) × hand × G + echo × Rp          // base click value
streak : +1 per sheet or node click if the gap since the last one ≤ gap (1.0 s; 1.4 s with Steady Rhythm; 2.0 s calm)
combo  = 1 + comboMax × min(streak, 40) / 40        // comboMax 0.5 → 1.0 → 2.0
Vc     = V × combo × clickBoost                     // clickBoost: Rush ×3 (×4), Storm ×7 (×10)
fold   : each click pays Vc and advances frame f = (f + 1) mod 8
figure : on the click that wraps to f = 0, pay an extra 5 × Vc; a figure of a random species joins the shelf
```

`flat` is 0 (reserved for perks), `hand` doubles per Tools upgrade, and `echo` comes from the
Echo Crease upgrades (§6.3: 0, 0.10, 0.20, 0.35, 0.50, 0.75). Clicks are actions
`{type:"click", target:"sheet", t}`. The engine trusts `t` order, not the count of clicks per
tick. Clicks closer than 40 ms to the previous one are ignored, which caps the rate at 25/s and
makes autoclickers pointless.

### 4.2 Crease nodes (node chains)

- A chain spawns every 20 s (12 s with Quick Creases) of **active time**. Active means the panel
  is visible and the player clicked anything in the last 60 s. During a Paper Storm a chain
  spawns every 4 s.
- A chain is k numbered nodes (k = 3; 5 with Long Crease; 7 with Grand Crease) on free slots.
  Each lives 10 s (20 s in calm mode) and pulses with `.loop("opacity",{from:0.75,to:1,period:700})`.
- Clicking node i **in order** pays `4 × i × Vc`. Finishing the chain pays `10 × k × Vc` and paints
  the crease: a `paint_path` stroke, 2 px `S.sheet`, through the k node centres in `%`, with
  `dash_array([6,4])`. It fades by `.transition("opacity", 600)` to 0 over 3 s.
- Clicking out of order pays `1 × Vc` and ends the chain; the remaining nodes fade.
- A k = 7 chain is worth `4 × 28 + 70 = 182 × Vc`. That is the main late-game skill payout.

### 4.3 Pickups

- **Scraps**: one every 45 s of active time. Lives 12 s (24 s calm). Pays
  `max(30 × Rp, 50 × V) × scrapMult` (scrapMult 1, or 2 with Scrap Basket).
- **Envelopes**: dropped by helpers (§5.3). They never expire.

### 4.4 Golden target: the Gilded Crane

- The next spawn is set in active-visible seconds: `300 + rng × 300` (Crane Bait: `210 + rng × 210`;
  Crane Song: `150 + rng × 150`; the 50-Wish perk multiplies it by 0.8). The first one ever is
  fixed at 390 s.
- It lives 13 s (20 s with Slow Wings; ×2 in calm mode) and glides across the play field
  (§9.4).
- Click outcome, by rng:

| Outcome | Chance | Effect |
|---|---|---|
| Lucky Fold | 50 % | `min(900 × Rp, 0.15 × bank) + 13 × V` |
| Paper Storm | 30 % | click ×7 (×10 with Gale Charm) for 15 s; chains every 4 s |
| Flock Song | 20 % | every working helper ×3 for 60 s |

### 4.5 Limited-time target: the Paper Boat (unlocked by the Harbour Ribbon curio)

Every `1800 + rng × 900` active-visible seconds, a paper boat sails along the bottom band for 20 s,
over the tray. Clicking it gives **Tailwind**: every envelope on the tray opens at ×2 value, and
`120 × Rp` is paid. If it is missed, nothing is lost. It returns on the next cycle.

### 4.6 Spawn rules and determinism

Every spawn, position and outcome comes from the engine's seeded PRNG (mulberry32, state in the
save) and from the engine's active-time counters. The glue feeds `visible` and the click
timestamps. When the panel is hidden or the window is not visible, the counters stop, so nothing
spawns unseen and the player never misses a crane. A live crane or node that becomes hidden
pauses its life timer.

### 4.7 Why clicking stays meaningful late

1. **Echo scales with the economy.** Click value carries 10–75 % of `Rp` per click, so a click
   never shrinks to nothing, whatever the size of the workshops.
2. **Rhythm pays.** The streak raises clicks up to ×3 (with Endless Streak), and breaking it costs
   real income.
3. **Chains are skill.** A k = 7 chain every 12 s at full echo is worth about 11 × `Rp`
   per second of active play.
4. **Boosts need hands.** Rush and Storm multiply only player clicks. Helpers drop them, but
   only the player can use them, which is the "my agents help me" loop.
5. **Envelopes must be opened by a click.** Automation can only open bundles (§6.5).
6. Measured in the prototype: from day 2, a minute of active play earns **at least 2× a minute of
   passive income**. The typical player's click-driven share (sheet, nodes, scraps, cranes) is
   about 13 % of all income for only 30 minutes a day. A player who never clicks reaches the first
   release about 3 hours later (§10).

---

## 5. Helpers

### 5.1 Data, identity and the observation step

- Each 1 s tick (2 s in calm mode, 5 s when hidden), the glue reads `agents()` once, `terminals()`
  once and `panes()` never (mod-patterns §4). It builds one `observe` action:
  `{addr, created, status, raw, turn, parent, pane, title, paneName, space}` for every pane agent,
  and for every live terminal whose `parent` chain reaches a pane agent within 32 hops.
- Status: pane agents use the derived `status`. Paneless sub-agents use the raw word with
  `error → blocked` and `done → idle` (host-api §5, mod-patterns §2.2).
- **Identity:** `id = fnv1a32(addr + "|" + created)` in hex. A terminal address reused after a
  restart is a new helper. A helper whose address disappears goes to the **Album**. If the same
  `(addr, created)` comes back, it is reinstated.
- **Look from the hash h:** species `h % 12`, hue `(h >>> 4) % 8`, name =
  `A[(h >>> 8) % 16] + B[(h >>> 12) % 12]`, with A = `Mi Ko Pi Ta Su No Ri Ha Yu Fe Lo Bi Ka Mo Ze Wu`
  and B = `na to b ki ri mo sa ku ro n li po`. That gives 192 short ASCII names, such as Mina, Koto,
  Pib, Taki, Yuro, Fen and Lopo. On a name clash among present helpers, the later helper gets a
  suffix "²", "³" (single code points, which are grapheme-safe).
- **Every agent is a saved helper.** There is no cap and no "extras". A record is about 160 bytes:
  `{id, addr, created, species, hue, name, parent, joined, lastSeen, lastTurn, rest, warmUntil,
  stats:{tasks, folds}}`. The test with 500 helpers stays under 128 KiB.
- Keys from disk go into `Object.create(null)` maps. Fuzz addresses include `__proto__`,
  `constructor` and `toString`.

Helper production:

```
H_i = (0.3 + share × Rw) × folk × warm_i × kids_i × songBoost × thanks_i
share = 0.04                      folk  = Π Folk upgrades (×1.5 each, §6.3)
warm_i = 1 + restMax × rest_i     (only during the first task after resting; restMax 1 → 2)
kids_i = 1 + kidBonus × min(4, working fledglings)   (kidBonus 0.25 → 0.50 → 0.75)
songBoost = 3 during Flock Song, 2 during Chorus, else 1
thanks_i = 1.5 for 5 min after a quick answer (§5.2), else 1; never in calm mode
```

The flat 0.3/s makes each working helper a true **auto-clicker** in the first hour, when it is
worth about a third of a player click per second. The `share × Rw` term keeps helpers relevant all
game. Prototype: helpers plus envelopes are about 24 % of the typical player's income.

### 5.2 Status → behaviour → at-a-glance visual (readable without colour)

| herdr status | Game state | Production | Shape (badge) | Motion | Extra non-colour cue | Colour | Click |
|---|---|---|---|---|---|---|---|
| `working` | Working | `H_i` | **circle arc** (270° ring) | `svg().spin(1200)` (static in calm) | full-opacity tile | status `working` | select the tile (detail card) |
| `blocked` / raw `error` | **Needs you** | 0 | **triangle pennant** with a cut-out "!" | badge bobs `.loop("top",{0→−3·z, 900})` (static in calm) | 2 px **dashed** tile border; top-band chip on the mat; header pill count | status `blocked` | `run("pane.focus",{pane})`; paneless: `run("terminal.peek",{terminal})` |
| any status, with an envelope waiting | **Envelope ready** | as its live status | **square envelope** | none on the tile (pulse only on the tray) | envelope on the tray with a type badge | status `done` | opens the envelope (§5.3) |
| `done` (finished, unseen) | as Resting for production | 0 (charges rest) | **square envelope** outline (hollow) | none | none | status `done` | focus pane (herdr then marks it seen) |
| `idle` | **Resting** | 0 (charges rest) | **crescent** | none | tile opacity 0.8; rest bar | `T.muted` (see below) | select the tile |
| sub-agent (fledgling) | adds `kids_i` to its parent | via parent | **diamond pip** filled (working), hollow (resting), or a pip shaped as a small **triangle** (needs you) | none | parent tile shows the pip row | parent hue; triangle in `blocked` | triangle pip → `terminal.peek` (or `pane.focus` if it has a pane) |
| gone | Album | 0 | none (list row) | none | in the Album section | `T.dim` | none |

Shapes differ in silhouette (circle, triangle, square, crescent, diamond), and three of them also
differ in motion (spin, bob, still). A player with any kind of colour blindness, or using a
grayscale theme, can read every state. The status words appear in group headers and tooltips.
Colours come from the theme so they match herdr's sidebar, with a contrast guard: a status colour
whose contrast against the badge chip (`T.popover`) is below 3:1 (WCAG 1.4.11) falls back to
`T.muted`. That happens for theme `idle` (2.2–2.5:1 measured), which is why resting uses
`T.muted` (4.8–5.1:1).

**Quick-answer thanks:** a helper that goes from blocked to working within 120 s of becoming
blocked gets `thanks = 1.5` for 5 minutes. It is a small reward for answering, removed in calm
mode, and it is never a penalty. Herdr already toasts and plays its own sound for "needs you"
(host-api §4), so Foldwick **never** notifies for it. Its cue is visual, inside the panel and
rail only.

### 5.3 Reward drops on task finish (turn deltas)

- For every observed terminal, `d = turn − lastTurn`. On first sighting `lastTurn = turn` (no
  back-pay). If `turn < lastTurn` (core restart), set `lastTurn = turn` with no reward. If `d > 0`,
  the drop is keyed by `(helperId, turn)`. Two windows observing the same finish therefore create
  one drop (ARCHITECTURE A5).
- A fledgling's finish adds `0.5 × d` to its **parent's** envelope.
- **One envelope per helper.** If the helper has no unopened envelope, a new one is created with a
  type rolled by the PRNG. If it already has one, `stack += d`, up to 9 (15 with the 250-Wish perk).
  Above the cap, extra finishes convert at once into folds worth `45 × Rp` each, credited with a
  footer note. Nothing is silently lost.

| Type | Chance | Badge on envelope | Effect when opened (stack s, charm multipliers in brackets) |
|---|---|---|---|
| Bundle | 55 % | small circle | `45 × Rp × s × crowd × envMult` folds (envMult 1 → 1.5 → 2) |
| Rush | 25 % | double chevron | player clicks ×3 (×4) for `30 × (1 + 0.25(s−1)) × durMult` s |
| Paper Storm | 10 % | lightning zigzag | clicks ×7 (×10), chains every 4 s, for `12 × (1 + 0.25(s−1)) × durMult` s |
| Chorus | 10 % | three dots | helpers ×2 for `120 × (1 + 0.25(s−1)) × durMult` s |

`durMult` is 1 → 1.5 → 2 (Long Ribbon, Longer Ribbon). Opening a boost type that is already
active extends it, up to 5 minutes remaining. `crowd` is defined in §5.5.

### 5.4 Idle rest charge

```
while Resting or done:  rest_i += dt / restFull      (restFull 30 min → 20 min Deep Rest → 12 min Dreamy Rest), cap 1
on Resting → Working:   warm_i = 1 + restMax × rest_i ; rest_i = 0
warm ends at the helper's next turn increment, or after 20 min, whichever comes first
blocked never charges rest (a waiting agent is not resting)
```

The tile shows the rest bar. The detail card shows "rest 80 % → next task ×1.8".

### 5.5 Many helpers: crowding (bench room)

Each working helper adds output, but a crowded bench has diminishing returns. With n working
helpers:

```
eff(n)   = n                         if n ≤ knee      (knee 4 → 6 Long Table → 8 Longer Table; +2 at the 100-Wish perk)
         = knee × (n / knee)^0.35    otherwise
crowd(n) = eff(n) / n
Hs = crowd(n) × Σ H_i
```

Every agent still adds something (eff grows forever), every agent is saved, and the UI says so
plainly: Flock header "Bench 12 working · room for 4 at full pace". In the prototype, 30 agents
reach the first release in 14 h, against 20.6 h for 4 agents. Many agents help, but the game does
not become trivial.

### 5.6 How 30 or more stay readable

1. Four fixed groups with counts. "Needs you" is always the first group, and it is also mirrored
   on the mat and in the header.
2. Dense 40×44 tiles at 21 or more helpers (7 columns), shapes at 14 px or more, and a minimum of
   6 px between tiles.
3. Stable join order inside a group. Tiles never shuffle while you look at them.
4. Motion budget: at most **6 bobbing badges** (the 6 longest-waiting). Others in the group are
   static with the same shape. Spinners turn at 10 fps natively (gpui-ui §9). Envelope pulses
   only on the tray (6 at most).
5. Each group folds. Folding "Working" turns it into one 24 px row: "● Working 18". The fold
   state is in `ui.folded`.
6. Twelve species silhouettes × eight hues = 96 visual identities, plus names. Hues are
   assigned by hash, not by status, so colour is never the only thing that tells two helpers apart.
7. Render cost: one host read per list, `Map` indexes, and tile view-models precomputed in the
   tick, not in render. The target is ≤ 8 ms at 64 helpers in the QuickJS harness.

---

## 6. Economy

### 6.1 Resources

| Resource | Earned by | Spent on | Resets on release |
|---|---|---|---|
| Folds | clicks, helpers, workshops, pickups, envelopes, offline | workshops, upgrades, automations | yes |
| Wishes | releasing the flock | nothing: passive bonus plus perks | no |

### 6.2 Workshops (generators): `cost_n = base × 1.16^n`, output per owned

| # | Workshop | Base cost | Output/s | Icon |
|---|---|---|---|---|
| 0 | Paper Stack | 15 | 0.05 | stack of 3 sheets |
| 1 | Bone Folder | 180 | 0.3 | flat tool |
| 2 | Scissor Stand | 2,200 | 1.8 | scissors in a cup |
| 3 | Glue Pot | 26,000 | 11 | pot plus brush |
| 4 | Fold Bench | 310,000 | 65 | trestle table |
| 5 | Washi Vat | 3.7M | 390 | tub with a screen |
| 6 | Flower Press | 45M | 2,300 | press with a screw |
| 7 | Crane Loft | 540M | 14,000 | loft with a hanging crane string |
| 8 | Kite Tower | 6.5B | 84,000 | tower with a kite |

**Tier upgrades** for every workshop: at 10, 25 and 50 owned, costs of `base × 20`, `base × 200`
and `base × 4,000`, each **×2** that workshop's output. Names follow the pattern "<Workshop>:
Neat Edges / True Corners / Master's Touch". There are 27 in total.

### 6.3 Upgrades (exact)

**Tools (player clicks)**

| Upgrade | Cost | Effect |
|---|---|---|
| Crisp Corners | 100 | hand ×2 |
| Bone-tip Nail | 1,500 | hand ×2 |
| Valley Fold | 40,000 | hand ×2 |
| Mountain Fold | 1.2M | hand ×2 |
| Squash Fold | 40M | hand ×2 |
| Petal Fold | 1.5B | hand ×2 |
| Thousandth Fold | 60B | hand ×2 |
| Echo Crease I–V | 2,000 / 80,000 / 4M / 300M / 20B | echo = 0.10 / 0.20 / 0.35 / 0.50 / 0.75 |
| Steady Rhythm | 5,000 | streak gap 1.0 → 1.4 s |
| Long Streak | 250,000 | comboMax 0.5 → 1.0 |
| Endless Streak | 50M | comboMax → 2.0 |

**Folk (helper efficiency)**

| Upgrade | Cost | Effect |
|---|---|---|
| Rice Treats | 2,000 | folk ×1.5 |
| Soft Brushes | 100,000 | folk ×1.5 |
| Snug Bench | 5M | folk ×1.5 |
| Paper Hats | 300M | folk ×1.5 |
| Gold-leaf Hats | 20B | folk ×1.5 |
| Long Table / Longer Table | 100,000 / 10M | crowd knee 4 → 6 → 8 |
| Deep Rest / Dreamy Rest | 20,000 / 2M | restFull 30 → 20 → 12 min |
| Warm Hands | 500,000 | restMax 1 → 2 |
| Fledgling Wings / Flight School | 50,000 / 5M | kidBonus 0.25 → 0.50 → 0.75 |
| Night Shift / Night Owl | 500,000 / 50M | offline factor 0.25 → 0.35 → 0.45 (§7) |

**Charms (boost strength)**

| Upgrade | Cost | Effect |
|---|---|---|
| Wax Seal | 10,000 | envMult 1.5 |
| Ribbon Tie | 1M | envMult 2.0 |
| Long Ribbon | 100,000 | durMult 1.5 |
| Longer Ribbon | 10M | durMult 2.0 |
| Brisk Charm | 3M | Rush ×3 → ×4 |
| Gale Charm | 100M | Storm ×7 → ×10 |

**Curios (special clickables)**

| Upgrade | Cost | Effect |
|---|---|---|
| Long Crease / Grand Crease | 20,000 / 2M | chain k 3 → 5 → 7 |
| Quick Creases | 200,000 | chain every 20 → 12 s |
| Scrap Basket | 100,000 | scrapMult 2 |
| Crane Bait / Crane Song | 50,000 / 5M | crane interval 300–600 → 210–420 → 150–300 s |
| Slow Wings | 500,000 | crane life 13 → 20 s |
| Harbour Ribbon | 1M | unlocks the Paper Boat (§4.5) |

### 6.4 Purchase rules

Workshops can be bought ×1, ×10 or Max (closed-form geometric sum, no loop). Upgrades are bought
once. A purchase is an action `{type:"buy", item, count, t}` and is idempotent by `(w, s)`
(ARCHITECTURE A5). Buttons show the time to afford at the current `Rp`.

### 6.5 Automations (Auto segment). Each has its own switch, on when bought

| Automation | Cost | What it does | What it never does |
|---|---|---|---|
| Mail Sorter | 25,000 | opens **Bundle** envelopes 10 s after they land | open boosts |
| Boost Keeper | 2.5M | opens a boost envelope only when the player clicked in the last 60 s and no boost of that type is active | open while away |
| Thrifty Fox | 500,000 | buys the workshop with the best payback when the bank ≥ 4 × its cost, at most once per 10 s | buy upgrades |
| Crease Helper | 5M | at 80 % of a node's life, clicks the next due node in order at 50 % value | start streaks or use Rush/Storm |

Switches are also in Settings, in the same order. Turning one off takes effect from the next
tick. The switches are part of the save (`auto.<id> = true | false`).

### 6.6 Prestige: Release the Flock

```
L      = lifetime folds (all runs)
Wtotal = floor( cbrt( L / 1.5e6 ) )
gain   = Wtotal − Wishes already earned
first release: allowed when gain ≥ 10 (L ≥ 1.5e9); later releases: gain ≥ max(1, ceil(0.1 × Wishes))
bonus  G = 1 + 0.05 × Wishes   (folds from every source and click value)
```

Release first opens every envelope on the tray as a bundle, then resets folds, workshops,
upgrades (except perk-kept ones), boosts, streak and spawns. It keeps helpers (identity, stats,
rest), the Album, Wishes, perks, settings and switches. The shelf's figures "fly off": the shelf
clears, with the existing opacity transition. The first release (10–11 Wishes, +50–55 %) makes
run 2 reach the same point in about 60 % of the time (prototype estimate, asserted in §10.3).

### 6.7 Typical player (the profile §10 asserts)

| Parameter | Value |
|---|---|
| Days | wall days; herdr open 09:00–17:00 (8 h); machine asleep or herdr closed for the other 16 h |
| Active play | 12 sessions a day, 2.5 min each, every 40 min from 09:00. The first session on day 1 lasts 8 min. 30 min a day |
| Clicks | 1.25 sheet clicks per second while active; every chain node in order (95 % success); every scrap; 80 % of cranes |
| Buying | cheapest payback first, checked every 5 s while active |
| Agents | 4 pane agents. Per hour: 36 min working, 6 min needs you, 18 min resting. 5 finished tasks per working hour each |
| Sub-agents | each agent has 1 working fledgling for 25 % of its working time |
| Envelopes | all opened at the start of each session |
| Offline | 16 h each night, credited at the 8 h cap |

"Play-clock" in §10 is cumulative herdr-open time. Day d spans play-clock 8(d−1) h to 8d h.

---

## 7. Offline

- **When:** the engine's clock is behind `now` by more than 60 s with no tick in between.
  This covers a closed herdr, a sleeping machine (one tick sees a jump), and a VM restart. A
  hidden window is **not** offline: agents still work and the engine still observes them, with the
  timer at 5 s.
- **Credited time:** `a = min(now − clock, 28,800 s)`. The rest is dropped and the card says
  "counts up to 8 h".
- **What accrues** (closed form, one multiplication, no loop):
  `away = offline × (Rw + crowd(nPresent) × Σ_present (0.3 + share × Rw) × folk) × a`.
  `offline` is 0.25 (0.35, 0.45 with Night Shift and Night Owl). "Present" means the helpers that
  were present at the last observation; they are treated as working at base rate, with no boosts,
  warmth, kids or thanks. Resting helpers also gain rest, so they come back fully rested if
  `a ≥ restFull`.
- **Not accrued:** clicks, spawns, cranes, envelopes (no tasks are observed while away), and the
  remaining time of active boosts. Boost timers are frozen while away and resume on return, so
  nothing is wasted.
- **Summary contents** (§3.8): duration and whether it was capped; folds split into workshops and
  helpers; envelopes waiting; who needs you now; helpers that rested fully; the best helper since
  the last visit (most tasks). Collect is one click, or automatic after 10 minutes.
- Prototype: offline is about 27 % of all income for the typical player.

---

## 8. Settings

### 8.1 Calm mode (off by default). Exactly what it changes

1. All `.loop()` motion off: no badge bob, no envelope or node pulse, no storm stripes, and the
   crane does not glide (it sits still at its spawn slot with its outline).
2. Working spinners render as the static arc (no `.spin`).
3. No floating numbers. The header count still updates.
4. Crease nodes, scraps and the crane live twice as long. The streak gap is 2.0 s.
5. No quick-answer "thanks" bonus (no reward for answering agents fast).
6. The data tick slows to 2,000 ms (from 1,000).
7. Notifications: only the save-problem alert can fire (§8.2).
8. First-run hints do not bob.

Economy formulas are otherwise unchanged. §10 asserts that calm mode is at most 10 % slower to the
first release.

### 8.2 Notifications (opt-in, off by default, never sound)

`notify({title, body, level, timeout: 6000, icon: "mods/foldwick/art/notify-icon.svg", action: {name: "layout.show", args: {id: "fw-panel"}}})`.
Herdr's `notify` never plays sound (host-api §7), and Foldwick never calls `playSound`.

| Event | Default when the master switch is on | Rule |
|---|---|---|
| Release ready | on | once per run, when the first release (or the next) becomes allowed |
| Envelopes piling up | on | 8 or more unopened for 30 min, once per local day |
| Wish perk reached | on | once per perk |
| Save problem | **on even when the master is off** | a save `error` or `fresh` notice that lasts 5 min, at most once per day |

**Cap: at most 3 `notify()` calls per local day across all events.** The save problem may use a
reserved third slot. The counter `{day: "YYYY-MM-DD", sent}` is in the save, so two windows share
it. The local date is computed by the glue from `Date` and the timezone offset, and passed to the
engine. Herdr's own agent toasts are left alone; Foldwick never duplicates "needs you" or
"finished".

### 8.3 Automation switches

One switch per automation (§6.5), shown in both the Auto shop segment and Settings, labelled
on/off in text. There is also a **"Helpers gather"** switch (on by default). Turned off, agents
still show their status, envelopes and rest, but `Hs = 0`. It is for people who want the flock as
a pure status board. The prototype treats it as on.

---

## 9. Art direction

### 9.1 Style rules

- **Flat paper:** straight-edged polygons only. No outlines except the gilded crane's. No
  gradients inside SVGs; gradients and patterns come from `paint_path` `Background`s at run time.
  No `<text>` (fonts may be missing, mod-patterns §7.6), no filters, no masks.
- **One colour per file, facets by alpha:** every sprite is `fill="#000"` with facets at
  `fill-opacity` 1, 0.78 and 0.56, so it reads as folded paper. `svg()` renders the file as an
  alpha mask tinted by `text_color` (gpui-ui §3). One file thus becomes any hue in any theme, crisp
  at any size, never blurred by `image()`'s 2× rasterisation.
  *[I] Fallback if herdr flattens partial alpha in masks:* split each sprite into `-a`, `-b` and
  `-c` files (one per facet level) layered with tints `hue`, `mix(hue, bg, 0.22)` and
  `mix(hue, bg, 0.44)`. `tools/art/split.mjs` does this mechanically, and the layout is the same.
- **Grid:** species on a 32-unit viewBox with a 2-unit safe margin, status glyphs on 16, scene
  sprites on their listed boxes. Coordinates are whole or half units. Each file is ≤ 1.2 KB and
  ≤ 40 points per polygon.
- **Silhouette test:** each of the 12 species must be recognisable as a 16 px black blob.
  `tools/art/sheet.mjs` renders a contact sheet at 16 / 28 / 40 px on light and dark for review.
- `tools/art/check-svg.mjs` (run in `npm test`) enforces: `viewBox` plus `width`/`height`; only
  `path`/`polygon`/`rect`/`circle`; fill `#000`; opacity values in {1, 0.78, 0.56}; no `text`,
  `style`, `filter`, `mask`, `image` or gradients; size limits.

### 9.2 Palette (exact hex). WCAG 2.x contrast measured with `tools/mock/themes.json`

**Scene tokens `S`** (our own; picked by `settings().dark`):

| Token | Light | Dark | Use and measured contrast |
|---|---|---|---|
| `mat` | `#2f6a55` | `#1d3a32` | cutting-mat green |
| `matEdge` | `#24523f` | `#14291f` | bottom edge strip |
| `grid` | `#ffffff1f` | `#ffffff14` | minor grid lines (decorative) |
| `gridMajor` | `#ffffff38` | `#ffffff24` | major grid lines (decorative) |
| `sheet` | `#fbf7ee` | `#e8e1d2` | paper; vs mat 5.93 (L), 9.47 (D) |
| `sheetShade` | `#e6dcc6` | `#cbbfa6` | facet shade; vs sheet 1.27 / 1.40 (decorative facet) |
| `crease` | `#c9b994` | `#a8996f` | fold ticks; vs sheet 1.81 / 2.17 (decorative) |
| `ink` | `#22302c` | `#1d2724` | text on paper: vs sheet 12.86 / 11.79 (AAA) |
| `onMat` | `#ffffff` | `#f4f1ea` | text on the mat: 6.34 / 10.93 (AA / AAA) |
| `node` | `#f2b134` | `#e9b93f` | node ring, streak fill: vs mat 3.35 / 6.74 (≥ 3:1 graphic) |
| `gold` | `#f0c24b` | `#e9b93f` | crane body: vs mat 3.78 / 6.74 |
| `goldShade` | `#c99a2e` | `#c39a2c` | crane facets |
| `goldInk` | `#4a3500` | `#3d2c00` | crane outline: vs gold 6.96 / 7.36 |

**Helper hues** (identity, not status). The light set is used on `T.raised` in light themes and
the dark set on `T.raised` in dark themes. Every value has ≥ 4.5:1 contrast against `T.raised`, so
the glyph passes even the text threshold.

| Hue | Light | vs paper raised | Dark | vs graphite raised |
|---|---|---|---|---|
| vermilion | `#b8432a` | 5.02 | `#f08b6e` | 5.59 |
| saffron | `#946000` | 4.94 | `#e3b04b` | 6.86 |
| leaf | `#3b7330` | 5.28 | `#8fcc72` | 7.16 |
| teal | `#1d7373` | 5.18 | `#5ccaca` | 6.97 |
| sky | `#2b62b0` | 5.59 | `#80aef2` | 6.00 |
| violet | `#6a4cb0` | 5.94 | `#b49cf0` | 5.81 |
| plum | `#9c3a72` | 5.96 | `#ee8fc0` | 6.05 |
| slate | `#4c5a68` | 6.54 | `#a9b5c2` | 6.53 |

The dark set was also checked against ink, moss and atom-one-dark `raised`: the minimum is 5.53.
The light set was checked against `chrome` and `background` of paper: the minimum is 4.72.

**UI and status colours come from `theme()`** (they follow the person's theme and match the
sidebar). Measured against the badge chip and tile (`T.raised`):

| | graphite | paper | ink | moss | atom-one-dark |
|---|---|---|---|---|---|
| working | 7.88 | 4.50 | 8.15 | 7.79 | 6.73 |
| blocked | 4.66 | 4.66 | 4.82 | 4.61 | 3.64 |
| done | 5.72 | 4.30 | 5.91 | 5.65 | 4.92 |
| idle (theme) | 2.52 → use `T.muted` 4.78 | 2.20 → `T.muted` 5.07 | 2.55 → 4.87 | 2.52 → 4.74 | 2.38 → 4.33 |
| foreground | 11.74 | 15.90 | 12.14 | 11.60 | 10.03 |

The run-time guard computes contrast for every status colour against the chip, using our own
`contrast()` in `ui/color.js`. Below 3.0 it uses `T.muted`, and below 3.0 for `T.muted` as well it
uses `T.foreground`. Custom themes are therefore safe. **Status colours are never drawn directly
on the mat.** In light themes they measured about 1.0:1 against `S.mat`, so every scene status cue
sits on a `T.popover` chip with a 1 px `S.sheet` ring.

### 9.3 Asset list (`mods/foldwick/art/`, about 80 files, all hand-written)

| Folder / file | Count | viewBox → drawn at | Notes |
|---|---|---|---|
| `folk/{crane,frog,fox,koi,rabbit,turtle,butterfly,whale,owl,boat,mouse,snail}.svg` | 12 | 32 → 16, 22, 28, 40 | three facet alphas; distinct blobs (wings V, squat, ears, tail, long ears, hex shell, 4 wings, round body plus tail, tufts, hull, round ears, spiral steps) |
| `sheet/{0..7}-base.svg`, `sheet/{0..7}-shade.svg` | 16 | 64 → 112 (44 in the rail) | fold sequence: square, triangle, kite, square base, bird base, narrow, wings, crane |
| `status/{working-arc,needs,envelope,envelope-open,rest,pip,pip-open,pip-needs}.svg` | 8 | 16 → 12, 14 | arc = 270° ring 2.5 units thick; needs = pennant with "!" cut-out; rest = crescent |
| `scene/{envelope-body,envelope-flap}.svg` | 2 | 28×20 | tray envelopes |
| `scene/{badge-bundle,badge-rush,badge-storm,badge-chorus}.svg` | 4 | 10 | circle, double chevron, zigzag, three dots |
| `scene/scrap.svg` | 1 | 16 | torn quadrilateral |
| `scene/crane-gilded-{outline,body,shade}.svg` | 3 | 40×28 → 40×28 | the outline layer is the body grown 1.5 units |
| `scene/boat-{hull,sail}.svg` | 2 | 40×28 | Paper Boat |
| `workshops/{stack,bonefolder,scissors,gluepot,bench,vat,press,loft,kite}.svg` | 9 | 24 → 28 | shop icons |
| `ui/{fold,wish,gear,flock,shop,back,chevron,close,info,warn,check,dots,arrows,lock,hand,paw,ribbon,curio,cog,clock}.svg` | 20 | 16 → 12–24 | interface glyphs |
| `ui/{jar-glass,jar-fill}.svg` | 2 | 64 | Wishes jar |
| `notify-icon.svg` | 1 | 18×18 | the **only** full-colour SVG (toast `image()`): crane on mat, `#2f6a55`, `#fbf7ee` |
| `layout-preview.png` | 1 | 216×124 | made from the whole-window screenshot (ARCHITECTURE A10) |
| `logo.svg` | 1 | 64 | README and RECIPE |

Runtime vector art (no files): mat grid, mat edge, crease lines, streak meter track,
progress bars, storm stripes and the boost countdown bars. All are `PathBuilder` in `%`
coordinates with colours validated by our own code first, because a bad colour inside a
`Background` fails silently (gpui-ui §5).

### 9.4 Animation with native primitives only

| Effect | Primitive and values | Calm mode |
|---|---|---|
| Working spinner | `svg("…/status/working-arc.svg").spin(1200)`, 12 px | static arc |
| Needs-you bob (max 6 tiles, all mat chips) | badge `div` `.absolute()` + `.loop("top", {from: −4·z, to: −7·z, period: 900, easing: "ease-in-out"})` | static |
| Envelope pulse (tray only) | `.loop("opacity", {from: 0.6, to: 1, period: 1600})` | none |
| Node pulse | `.loop("opacity", {from: 0.75, to: 1, period: 700})` | none |
| Gilded crane glide | outer `div` `.loop("left", {from: 8·z, to: (W − 56)·z, period: 9000})`; inner `.loop("top", {from: y·z, to: (y − 8)·z, period: 1300})`. Loops share one clock (gpui-ui §9), so the crane may appear mid-flight; that is fine because it crosses the field both ways | sits still |
| Paper Boat | `.loop("left", {from: −40·z, to: (W + 8)·z, period: 40000, easing: "linear"})`; its life is 20 s, half a period | sits at the tray end |
| Storm stripes | `paint_path` rect with `pattern_slash` + `.loop("opacity", {0.06 → 0.16, 1200})` | none |
| Sheet fold | the frame swaps on each click (data) and `.active(s => s.opacity(0.88))` | same |
| Floating "+N" | a two-step data render: the click handler records `pop {id, x, y, born}`, and the element renders at `top y` with `.transition("top", 700)` and `.transition("opacity", 700)`. One `cx.timer.after(16)` per burst flips all new pops to `top y − 28`, `opacity 0`. One `after(800)` removes them. At most 5 alive | none |
| Streak meter | `.transition("width", 150)` | same |
| Boost countdown bar | each chip's bar targets width 0 with `.transition("width", {duration: remainingMs, easing: "linear"})`, set on the tick after the chip appears: one native animation per boost, no timer | same |
| Rest bars, Wishes jar | `.transition("width"/"height", 600/400)` | same |
| Switch knob | `.transition("left", 120)` | same |

All `loop` px values are multiplied by `settings().zoom` by us (gpui-ui §9). With nothing
pending and nobody working, the panel draws no loops and costs nothing. Timers are for data only
(1 tick per second, as in ARCHITECTURE A2.9).

---

## 10. BALANCE TARGET (the pacing simulator asserts these)

Times are play-clock (§6.7): `D<d> hh:mm` is time into day d's 8 open hours. The cumulative
hours are in brackets. Tolerances are ± unless stated. The prototype's measured values are in the
"proto" column. Builders may retune numbers in §6, but every row must stay inside its band.

### 10.1 Typical player (§6.7)

| # | Milestone | Target | Tolerance | proto |
|---|---|---|---|---|
| M1 | first Paper Stack | D1 00:00:40 (0.01 h) | ± 30 s | 00:00:40 |
| M2 | first upgrade (Crisp Corners) | D1 00:03:30 | ± 2 min | 00:03:30 |
| M3 | first Gilded crane caught | D1 00:06:30–00:08:00 | (fixed spawn at 390 s) | 00:07:29 |
| M4 | 10 workshops owned | D1 00:01:40 | ± 1 min | 00:01:35 |
| M5 | first Scissor Stand | D1 00:07 | ± 4 min | 00:07:00 |
| M6 | first Glue Pot | D1 01:20 (1.3 h) | ± 30 min | 01:20 |
| M7 | first Fold Bench | D1 03:20 (3.3 h) | ± 1 h | 03:20 |
| M8 | 1M folds this run | D1 03:25 (3.4 h) | ± 1 h | 03:25 |
| M9 | first Washi Vat | D1 06:40 (6.7 h) | ± 1.5 h | 06:40 |
| M10 | 100M folds this run | D2 02:20 (10.3 h) | ± 2 h | 02:21 |
| M11 | first Flower Press | D2 02:40 (10.7 h) | ± 2 h | 02:40 |
| M12 | 1B folds this run | D3 01:50 (17.9 h) | ± 2.5 h | 01:52 |
| **M13** | **first release available (gain ≥ 10 Wishes, L ≥ 1.5e9)** | **D3 04:40 (20.6 h)** | **± 2.5 h, and always on day 3 (16 h < t < 24 h)** | **04:37 (20.62 h)** |
| M14 | first Crane Loft | D3 04:40 (20.7 h) | ± 3 h | 04:40 |

With the 09:00 start, M13 is wall-clock **day 3 between 11:10 and 16:10**, target 13:40.

### 10.2 Other profiles (first release, play-clock hours)

| Profile | Change from typical | Target | proto |
|---|---|---|---|
| P2 no-clicker | 0 clicks/s, no nodes, scraps or cranes; still opens envelopes and buys | 23.5–27 h (later than P1 by ≥ 1.5 h) | about 24 h |
| P3 no agents | 0 agents | 25–32 h (agents speed P1 up by ≥ 20 %) | 27.6 h |
| P4 one agent | 1 agent | 23–28 h | 25.4 h |
| P5 eight agents | 8 agents | 14–18 h | 16.0 h |
| P6 thirty agents | 30 agents | 12–16 h | 14.0 h |
| P7 sixty-four agents | 64 agents | ≥ 10 h (no profile ever before 10 h) | 11.4 h |
| P8 keen clicker | 5 min sessions | 15.5–19.5 h | 17.5 h |
| P9 calm mode | typical, calm on | ≤ 1.10 × P1 | (new) |

### 10.3 Structural assertions

1. Income shares for P1 over days 1–3: click-driven (sheet + nodes + scraps + cranes) 8–20 %
   (proto 12.9 %); helpers + envelopes 18–35 % (proto 23.9 %); offline ≤ 35 % (proto 27.3 %).
2. From D2 00:00 onward, P1's income per active second is ≥ 1.5 × its passive rate.
3. Offline: an away gap of 20 h credits exactly 8 h. Gaps of 59 s and 61 s fall on either side of
   the offline rule.
4. Run 2 after the first release (P1 profile, keeping its Wishes) reaches L = 1.5e9 + run-1 L in
   ≤ 65 % of run 1's time.
5. Every observed agent is saved: after the 64-agent scenario the save holds 64 helpers plus their
   fledglings, and `JSON.stringify(save).length < 256 KiB` with 500 Album helpers.
6. Turn deltas: replaying the same `observe` twice and in two writers creates each envelope
   once.
7. No milestone depends on `Date.now` or `Math.random`: two runs with the same seed give
   byte-identical saves.
8. The 40 ms click floor holds: a 100 clicks/s script earns at most 25 clicks/s.

---

## 11. Notes for builders (how this angle meets the hard rules)

- **Engine/glue split** (ARCHITECTURE A3): every formula above lives in `engine/` as pure
  functions over the plain `GameState`. The glue passes `now`, `visible`, `localDay`, the
  observations and the click timestamps. Spawns use the state PRNG.
- **Save, two windows, hot reload:** exactly ARCHITECTURE A4–A6. The art angle adds only that every
  save notice has a banner (§3.7) and a rail glyph. For two app homes, the Settings field "Use a
  shared path" stores an absolute path in each home's `data/foldwick/location.json`. CAS plus merge
  handles races, and drops stay keyed by `(helperId, turn)`.
- **Views for screenshots** (`glue/views.js`): `empty`, `first-run`, `standard-4`, `needs-you-3`,
  `envelopes-full-tray`, `storm`, `crane`, `chains-7`, `flock-30`, `flock-64-dense`,
  `flock-album`, `shop-*` (6 segments), `wishes-locked`, `wishes-ready`, `wishes-confirm`,
  `settings`, `away-card`, `banner-{recovered,fresh,conflict,error,newer}`, `rail`,
  `rail-banner`, `narrow`, `wide`, `calm`. Each is rendered in graphite and paper. Whole windows
  are rendered at 1440×900 and 1100×700, expanded and folded.
- **Text safety:** every name, title and pane name goes through `clip()` before `.truncate()`;
  helper names are ASCII by construction.
- **Colour safety:** `ui/color.js` exports `hex6(c)`, `withAlpha(c, a)`, `contrast(a, b)` and
  `statusColor(T, status, chip)`. Every literal in §9.2 is in one frozen table checked by a test,
  which validates all hex values and recomputes every contrast figure in this document.

### Open questions

1. [I] Whether `svg()`'s alpha mask keeps `fill-opacity` facets. If not, use the 3-file split in
   §9.1, which changes no layout. Check in herdr once, by eye, from the art contact sheet mod view.
2. Whether `layout.resize` on a `px` node is saved in `layouts/.state/Foldwick.json` as a click,
   so the folded state survives restarts. If not, the mod re-applies `ui.panelPx` on `init`
   (guarded by `checking()`).
3. Whether `.transition("width", {duration: remainingMs})` accepts durations of several minutes.
   The validator allows up to 86 400 000 ms (gpui-ui §9), but a long native transition has not
   been watched. The fallback is to update the bar width on each data tick.

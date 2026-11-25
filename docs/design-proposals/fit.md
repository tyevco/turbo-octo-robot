# Weftwork: design proposal (angle: herdr-fit first)

Status: proposal. Platform: herdr-app v0.1.18 (QuickJS-ng, gpui-kit). Every platform claim below
comes from `docs/research/*.md`. Section references such as "host-api §6" point there.

Angle: Weftwork has to live calmly beside real terminals. It never takes focus and never plays a
sound. It shows every agent's status at a glance, stays readable with 30 or more agents, and costs
almost no CPU when nothing needs the player. Saving and hot-reload handover must not lose work.
Inside those rules it should still be a fun clicker.

---

## 1. Name, pitch, theme

**Name:** Weftwork.
**Pitch:** *You work the loom by hand. Your coding agents weave beside you.*

**Theme.** A quiet weaving workshop at dusk. The player is the master weaver at the **Warp Spool**,
the big spool in the middle of the loom. Each coding agent in the window is a small **weaver
creature** on the workshop bench: a weaverbird, an orb-spinner, a silkworm, a caddis larva and so
on. Real animals that spin or weave give us eight species with no borrowed characters. The main
resource is **thread**. Thread buys looms and mills (generators), techniques (upgrades) and curios
(special clickables). When a run is finished, the player **hangs the tapestry** (prestige). The
tapestry is woven from that run's stripes: one per helper, in that helper's colour, as wide as
its contribution. Each tapestry hung earns permanent **Patterns**.

**Why it is clearly not a side-scrolling dungeon game.** Nothing scrolls, nobody walks, there are
no rooms, enemies, combat, health, loot tables or maps. The scene is one still workbench viewed
from the front. Progress shows as cloth getting longer, more looms on the shelf and tapestries on
the wall. It is a craft and production fantasy, not exploration.

**Why the metaphor fits "I click, my agents help".**
- Coding vocabulary already uses textile words: threads, patches, weaving a change through files.
  "Agents weave threads while you pull the main spool" reads naturally to a developer.
- Weaving is cooperative and rhythmic. The master sets the tension and the bench keeps the shuttle
  moving. That maps directly onto clicks (you) plus auto-weaving (working agents).
- A finished task is a finished **bobbin**: a full spool the weaver sets down for you to collect.
  An agent waiting for input is a weaver with a **raised hand**: the thread snagged and they need
  you. An idle agent **rests at the bench** and stores up warmth for the next task. Sub-agents
  are **apprentices** sitting beside their weaver.
- Weaving is calm. The palette and pace suit a game that sits next to work for eight hours.

**Identifiers.**

| Item | Value | Rule it satisfies |
|---|---|---|
| Mod folder | `mods/weftwork/` | lower-case, `[a-z0-9-]`, no dot (`<mod>.<cmd>` splits on the first dot), not `frame-*` (layouts-share Do 2) |
| Layout file | `layouts/Weftwork.json` | ASCII letters only; Settings shows the file stem as is, the palette shows `Layout: Weftwork`, keys use `layout:Weftwork` |
| Data folder | `<appHome>/data/weftwork/` | herdr creates it per mod name (mod-lifecycle §8) |
| Settings preview | `mods/weftwork/art/layout-preview.png` (216×124 px, shown at about 108×62) | travels with the copied mod folder (layouts-share §5) |
| Repo preview | `preview.png` (1600×1000) | herdr.dev card |

**Name check.** A web search for "Weftwork" game (2026-11-25) found no game with that title. The
nearest matches were the board games *Warp & Weft* (2024) and *Weft* (2013), the research game
*Threadsteading*, and the iPad title *The Weaver*. None of them is called Weftwork. We avoid
"Loom" on its own, because that is a well-known 1990 adventure game, and we use no "-Clicker" or
"Idle-" style names. All species are real animals described generically, and building names are
ordinary craft terms (drop spindle, dye vat, treadle loom).

---

## 2. Placement in the herdr window

### 2.1 Decision: a bottom strip under the terminals

This is layout (a) from layouts-share §10, with the strip node `weft-strip`. Every node and id of
the shipped `main.json` is kept: the `sidebar` with spaces and agents, `tabs`, `main`, `panel` and
`panel-body` with Files and Changes, and `status`. `work-body` and the strip are wrapped in a
resizable `work-split` column, so the strip's top edge can be dragged.

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│ sidebar  │ tabs (42)                                                     │
│ 268 px   ├───────────────────────────────────────────────────────────────┤
│ spaces   │ work-body: terminals, full width (Files panel still works)    │
│ agents   │                                                               │
│          ├─────────────────── drag edge (accent on hover) ───────────────┤
│          │ weft-strip 112 px (min 64, max 280)  bg: chrome               │
│ footer   ├───────────────────────────────────────────────────────────────┤
│          │ status (28)                                                   │
└──────────┴───────────────────────────────────────────────────────────────┘
```

Node changes from layouts-share §10(a): rename `game-strip` to `weft-strip` and give it
`"size": {"px": 112}, "min": 64, "max": 280, "background": "chrome",
"content": {"mod": "weftwork", "props": {"role": "strip"}}`. Keep `work-body` `"min": 200`, the
transparent `work-split` divider with `"hover": "accent"`, and the root
`"preview": "mods/weftwork/art/layout-preview.png"`. Set no `theme` and no `colors`, so the
person's own light or dark choice applies (layouts-share Do 6).

`mods/weftwork/mod.json`:

```json
{
  "place": "none",
  "title": "Weftwork",
  "overlay": { "kind": "dialog", "width": 760, "height": 540, "props": { "role": "hall" } },
  "palette": [
    { "title": "Weftwork: open the Hall", "command": "mod.open", "args": { "name": "weftwork" } },
    { "title": "Weftwork: show or hide the strip", "command": "layout.toggle", "args": { "id": "weft-strip" } }
  ]
}
```

### 2.2 Why a strip

| Concern | Strip (chosen) | Right panel | Own pane | Floating drawer |
|---|---|---|---|---|
| Terminal width (columns) | **unchanged**; TUIs and wrapping are not disturbed | −320 px, about 40 columns lost; clashes with Files | full width, but the game hides the terminals | occludes the right columns of the terminals |
| Terminal height | −112 px, about 6 rows out of 45 at 1440×900 | unchanged | none | none |
| Status always in view | yes | yes | no | peek only |
| Next to herdr's own ambient info | sits on the status bar, the "ambient" edge | far from it | n/a | floats over work |
| One-key hide | `layout.toggle:weft-strip` | yes | needs an object binding | no command (mod must collapse itself) |
| Takes focus | never: the strip is not `focusable`, so clicks do not move keyboard focus off the terminal | same | yes | same |

Terminal programs suffer more from losing columns than rows. A strip along the status-bar edge is
where developers already look for ambient state. Everything that needs a larger surface (the
shop, the full helper table, the tapestry, settings) opens in the **Hall**, a dialog overlay the
person summons on purpose and dismisses with the same key.

### 2.3 Size states (picked from the strip's measured height via `on_size_change`)

| State | Strip height | Content |
|---|---|---|
| Compact | 64–95 px | one 48 px row: spool 40 px, bank, status count chip, one 12 px status pip per helper (14 px pitch), Hall and Collect buttons |
| Standard (default) | 96–159 px | scene card, two-row roster of 36×36 tiles, ledger card |
| Expanded | 160–280 px | larger scene with a knot field, roster tiles 56×60 with names, ledger shows the three best next buys with buy buttons |
| Hidden | node hidden | the copy stays alive and keeps acting as steward (mod-lifecycle §3.2); timers keep running |

Below 720 px of width, the knot field moves into the ledger as a "Tie 3 knots" button, and the
scene card shrinks to the spool alone (96 px).

### 2.4 Keys (`keys.json`, merged into the person's file)

```json
{
  "layout:Weftwork": {
    "ctrl-shift-g": "layout.toggle:weft-strip",
    "ctrl-shift-y": "mod.open:weftwork",
    "ctrl-shift-u": "weftwork.collect",
    "ctrl-shift-j": "weftwork.next-needs-you",
    "ctrl-shift-m": "weftwork.calm"
  }
}
```

- The chords were checked against herdr's defaults (layouts-share §3.3). On Linux and Windows,
  herdr takes `ctrl-shift-{b,n,t,k,p,o,e,w,x,z,l,/,?,tab,pageup,pagedown}`, and its terminal
  section takes `ctrl-shift-{c,v,f}`. That leaves `g`, `y`, `u`, `j` and `m` free. macOS defaults
  are `cmd-*` chords, so these ctrl-shift chords are free there too. No plain `ctrl+letter`
  (those belong to programs) and no `alt-*` (meta in many terminals).
- Every action is a string, so the Keys overlay shows readable labels: `weftwork collect`,
  `layout toggle weft-strip`, and so on.
- `mod.open:weftwork` and `layout.toggle` are app commands, so they work even while the strip is
  hidden. `weftwork.*` commands reach shown copies only. While the strip is hidden they fail with
  herdr's "unknown command" toast. RECIPE.md documents this, and the Hall offers the same actions
  as buttons.
- The section is scoped to `layout:Weftwork`, so the keys do nothing in other layouts.

---

## 3. Views

All sizes are logical px before zoom. Fonts are the UI font (`settings().ui_font_family`). Type
sizes: 18 semibold (bank), 15 semibold (titles), 13 (body), 11 (labels), 9 (tile names, expanded
state only). Colours are the tokens defined in §9. `chrome` and `border` are the theme's own
values; everything else is our palette, picked by `settings().dark`.

### 3.1 Main scene: the strip, standard state (width W, height 112)

```
x:0                                                                                          W
┌─[pad 8]──────────────────────────────────────────────────────────────────────────────────┐
│┌ SCENE CARD 264×96, bed, r10 ┐┌ ROSTER CARD flex×96, bed, r10 ──────┐┌ LEDGER 216×96 r10 ┐│
││ ┌spool 72┐ cloth band 168×40 ││ counts chip row (h18):              ││ [thread] 1.35B  18│ │
││ │ (img)  │ ░░░░▓▓▓▓▓░ knots  ││ ▲2 need you · ● 5 · ◆ 11 · ○ 14 11px ││ +28.1K/s  ×1.5 11  │ │
││ │        │ tension ▬▬▬▬▬▭ 6  ││ ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐ ... ││ ⚡Quick 0:24 ✦0:12 │ │
││ └────────┘ rhythm  ▬▬▭  3    ││ │◆ ││▲ ││○ ││● ││◆ ││◆ ││○ │ 36×36 ││ [Hall] [Collect 7]│ │
││ +12 fleck (transient)        ││ └──┘└──┘└──┘└──┘└──┘└──┘└──┘ gap 4  ││  buttons 24 high  │ │
││                              ││ second row of tiles ...             ││                   │ │
│└──────────────────────────────┘└─────────────────────────────────────┘└───────────────────┘│
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Scene card** (264×96, `bed`, radius 10, 1 px `line` border):
  - Warp Spool: `image("mods/weftwork/art/scene/spool-<tier>.svg")`, 72×72 at (8,12). The spool
    gains coloured threads as building tiers unlock (tier 1–3).
  - Cloth band: 168×40 at (88,8). A `paint_path` rectangle stack: woven rows in `indigo` on
    `tile`, filled left to right by the current "row" progress (one row = 60 s of current income),
    updated once per tick.
  - Knots: up to 3 knot images (22×22) at fixed, seeded slots on the band. Up to 5 with Long
    Patterns.
  - Tension bar: 168×6 at (88,54), `weld` fill on `line` track.
  - Rhythm bar: 168×3 at (88,64), `indigo`.
  - Moth: flies inside this card only.
- **Roster card** (flex width): a counts chip row, then tiles (§5.6) in two rows, scrolling
  horizontally beyond two rows. A 4 px horizontal scrollbar appears only on overflow
  (`overflow_x_scrollbar`).
- **Ledger card** (216×96): bank (18 semibold, `ink`), rate (11, `muted`), tension multiplier chip
  `×1.5` when taut, active boost chips (11, with seconds left, refreshed by the 1 Hz tick), and
  two buttons, 24 px high and radius 6: `Hall` (opens the Hall overlay) and `Collect N` (shown
  only while N > 0).

### 3.2 Compact (64–95 px)

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│[spool40] 1.35B +28.1K/s │ ▲2 ●5 ◆11 ○14 │ ◆▲○●◆◆○◆◆○●○◆ … 12 px pips, 14 px pitch │ [Hall][⤓7] │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

Pips use the same shapes as the tile badges (§5.6). When there are more helpers than room,
blocked helpers are shown first and a `+n` chip ends the row. That is the only reordering in
compact mode. Clicking a pip acts like clicking its tile.

### 3.3 Hall overlay (dialog, 760×540)

Opened with `mod.open:weftwork`, the ledger's Hall button, or the palette. It is an overlay copy
with `props.role = "hall"`. Closed with the same key (`mod.open` toggles), or the × button.

```
┌ header 44: [icon 20] Weftwork Hall   [thread] 1.35B  +28.1K/s                  [×] ┐
├ tabs 34:  Shop | Helpers | Tapestry | Ledger | Settings        (active: indigo 2px under)
├ body 462, scrolls (overflow_y_scrollbar) ──────────────────────────────────────────────┤
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

**Shop tab.** A sub-tab row (28 px) with **Looms & Mills** (buildings), **Techniques**
(upgrades), **Workshop** (automations) and **Curios** (special clickables), plus a buy-amount
toggle `×1 ×10 Max` on the right. Each row is 56 px:
`[icon 40] Name (13 semibold) / effect line (11 muted) | owned "×23" (13) | [cost button 112×32]`.
The cost button uses `indigo` fill with `bed` text when affordable. Otherwise it uses a `line`
fill, `muted` text and "in 4m" (time to afford at the current rate). Locked rows show their
unlock condition in `muted`. Sorted by tier; techniques are sorted by cost.

**Helpers tab: the roster for 30+ agents.** A filter row (28 px) holds status chips
`All · Needs you · Reward · Working · Resting` with counts. Below it a `v_virtual_list` of rows,
32 px each, with a definite height of 404 and clicks through `on_item_click`:
`[species 20] [badge 12] Given name (13) — agent title (11 muted, truncated) | space / tab (11) | rate (11, right) | rest bar 40×4 | bobbins n | apprentices n`.
Clicking a row runs `pane.focus` (or `terminal.peek` for a paneless apprentice) and closes the
Hall. Order follows workspace order, the same as herdr's sidebar.

**Tapestry tab: prestige (§6.7).**

```
┌ tapestry preview 480×180 (paint_path stripes) ┐  Patterns held: 0       (15 semibold)
│ ▓▓░░▒▒▓▓▓░░░▒▒▓▓▓▓░░                          │  Hang now for: +10       (18, saffron)
│ stripes: helpers + your hand + looms          │  Next Pattern at: 1.33e11 lifetime
└───────────────────────────────────────────────┘  Bonus now ×1.00 → ×1.50 after hanging
[ Hang the tapestry ]  240×36, madder fill; first click arms it ("Click again to hang", 4 s)
Keeps: Patterns, helpers, tapestries, settings, heirlooms.  Resets: thread, looms, techniques.
Gallery: past tapestries 104×40 each, 4 per row, with date and Patterns earned.
```

**Ledger tab.** The last away summary (§7), the last 20 events (purchases, moths, hangings, save
events) and lifetime statistics.

**Settings tab.** See §8. Rows are 36 px: label (13), description (11 muted), `Switch.new(id)`
drawn as a 32×18 pill.

### 3.4 "While you were away" summary

This is **not** a modal. On return, the roster card shows an away card in its place until the
person dismisses it, clicks anything in the strip, or 10 minutes pass:

```
┌ ROSTER CARD ──────────────────────────────────────────────────────────────────────────┐
│ While you were away · 9h 12m (8h counted)                                    [×]      │
│ +4.21M thread   looms 3.80M · resting helpers 0.41M      ◆ 6 bobbins waiting          │
│ [Collect all]  [Details → Hall/Ledger]                                                │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

The full version in Hall → Ledger lists the contents defined in §7.3.

### 3.5 Save-problem banner

A strip-wide band 20 px tall, painted last so it sits on top (later siblings paint on top). It has
a `madder` fill at 16 % alpha (`#B83A0B29` light, `#FF7D4D29` dark), a 1 px `madder` bottom border,
the `save-warn.svg` icon at 14 px, text at 11 px in `ink`, and buttons `[Retry]` and `[Details]`.
Examples:
- `Saving failed: <error text>. Your progress is kept in memory. Retrying every 30 s.`
- `Save file was damaged. Restored from backup of 14:32 (about 4 min lost). Damaged copy kept as save.damaged-1764061234.json.`
- `Another window spent thread first: 1 purchase undone (Dye Vat ×1, refunded).`

The Hall header shows the same message. The banner stays until the problem clears or the person
dismisses an informational one. Error-level banners cannot be dismissed while the error persists.
§8.2 describes the toast path.

### 3.6 First run and zero agents

The strip shows the spool with a soft 1.2 s opacity loop on a "click me" hint ring, which stops
after the first click or 30 s. The roster card shows three ghost tiles (dashed 1 px `line`
outlines) and the text:
`No helpers yet. Start a coding agent in any tab and it joins the bench. You can weave alone meanwhile.` (13 `ink` and 11 `muted`).
The game is fully playable with no agents (§10 asserts a 0-agent profile).

### 3.7 `herdr-app check` and VM-restart preview

When `checking()` is true, render a static preview from a built-in demo state (4 helpers in mixed
states, 1.35B thread). There are no timers, no file I/O and no `run()`. `window()` is null, so
read it with `?.`.

---

## 4. Clicking

Pointer input comes from `on_mouse_down("left", e)` on wrappers around the images; `svg()` and
`image()` take no handlers (gpui-ui §7). Positions are divided by `settings().zoom`. Overlapping
targets call `cx.stop_propagation()`. At most **15 credited clicks per second**; extra clicks are
ignored, which also absorbs key repeat.

### 4.1 Click value

```
C0     = 2^h · G                       + κ · P_bld            (base click, used by helpers too)
C      = C0 · R · Q · S                                       (a hand click on the spool)
G      = 1 + 0.05 · Patterns_held                             (prestige multiplier)
h      = number of Hands upgrades owned (0..5)
κ      = Weaver's Touch total (0 → 0.11)
P_bld  = building output before tension and boosts (§6.2)
R      = 1 + 0.05 · r,  r = rhythm 0..20                      (×1 .. ×2)
Q      = 3 / 4 / 5 while Quickened Hands is active, else 1
S      = 12 while Thread Storm (moth) is active, else 1
```

**Rhythm.** A click within 1.0 s of the previous click raises r by 1 (capped at 20). With no
click for 1.5 s, r drops to 0. The rhythm bar shows r/20. Rhythm only affects hand clicks.

**Tension.** This is the mechanic that keeps clicking meaningful from the first minute to the
last. Each hand click adds **12 s** of tension, and tying a knot adds **60 s**, up to a cap of
**45 min**. While tension is above 0, building output is multiplied by `T` = 1.5, raised to
1.75 / 2.0 / 2.5 by Taut Warp I–III. Tension drains 1 s per second of wall time, only while
herdr is running. It does not apply offline. The effect: a 2½-minute check-in at one click per
second keeps the looms taut for about 30 minutes. That rewards brief, calm visits rather than
constant clicking, and stays proportional to the whole economy at every stage of the game.

### 4.2 Knots (nodes)

- One knot appears every **4 min** of window-open time, up to 3 waiting (5 with Long
  Patterns). Knots are static; they wait and never expire.
- Value: `K = 15 · C0 + 10 s · H`, where H is the current total rate (§6.2). Tying a knot also
  adds 60 s of tension.
- **Chains** (needs Knot Patterns, cost 1,500). Waiting knots show small numerals 1..n. Tying
  them in ascending order, each within 8 s of the last, multiplies knot k by `1 + 0.25·k`
  (×1.25, ×1.5, ×1.75, and ×2.0 and ×2.25 with Long Patterns). Out of order: ×1.
- **Silver knot** (curio, 600,000): 1 knot in 8 is silver, worth ×5, with a seeded roll.
- **Dawn knot:** the first knot spawned on each calendar day is gold-rimmed, worth `5 min · H`.
  It waits until local midnight, so missing it costs nothing more than that one knot.

### 4.3 Pickups (bobbins from helpers)

A bobbin sits on its helper's tile (§5.3). Clicking it collects it. **Collect all** (the button,
`ctrl-shift-u`, or the away card) collects every bobbin and starts their boosts together.

### 4.4 Golden target: the Lumen Moth (limited time)

- Unlocked by the curio **Lumen Moth** (8,000).
- It **only appears while the player is present**: the window is active and the player clicked in
  the strip within the last 30 s. It never appears for someone who is coding, so it never competes
  for attention. Spawn chance per present second is 1/330 (mean 5.5 present-minutes), improved
  to 1/240 and 1/180 by Moth Lantern I–II.
- Lifetime is **12 s** (20 s in calm mode). It flies inside the scene card (§9.5).
- Catching it gives a seeded result:
  - **Moth Glow** (50 %): all production ×7 for 30 s.
  - **Gilded Spool** (35 %): `min(15 min · H, 0.15 · bank) + 13 · C0`.
  - **Thread Storm** (15 %): hand clicks ×12 (S) for 10 s.
- A moth that is not caught simply leaves. No penalty, no notification.

### 4.5 Why clicking stays meaningful late

1. Tension multiplies the largest income source (buildings) by up to ×2.5, and only clicks and
   knots maintain it.
2. κ ties each click to building output, up to 11 % of `P_bld` per click before rhythm. At
   rhythm ×2 with Quickened Hands ×5, one click is worth about 1.1 s of building output; during
   a Thread Storm it is about 13 s.
3. Bobbins, knots and moths are click-collected bursts sized in *seconds of income*, so they scale
   automatically.
4. Automations never catch moths and never chain knots. Those remain the player's skill.
5. §10 asserts the result: a player who visits for 6 minutes instead of 2½ reaches the first
   prestige about 4 hours earlier, and a fast clicker about 3 hours earlier.

---

## 5. Helpers

### 5.1 Data sources and identity

- **Pane agents:** `agents()` with status `working | blocked | done | idle`.
- **All terminals:** `terminals()` gives `turn`, `parent`, the raw word in `status`, and
  `created_ms`. Paneless sub-agents appear only here (host-api §2–§5).
- Both lists are read **once per 1 Hz tick, in the steward's timer, never in render**, and
  indexed with a `Map`.
- **Helper key:** `<homeId>:<address>#<created_ms>`, where `homeId` is the FNV-1a hash of
  `appHome()` (8 hex characters). The address alone can be reused after a core restart, and the
  home prefix keeps two windows on one save from colliding. All key-indexed maps are
  `Object.create(null)` and are tested with `Object.hasOwn`.
- **Identity:** `h = fnv1a32(helperKey)`.
  - Species `= SPECIES[h % 8]`: Weaverbird, Orb-spinner, Silkworm, Tailorbird, Caddis,
    Bagworm, Lacewing, Webspinner.
  - Given name `= A[(h>>>3)%16] + B[(h>>>7)%16]`, with
    A = `Ta Mi Ro Se Lu Ka No Pe Vi Do Ha Ri Su Be Fa Jo` and
    B = `msel bbin wen ra lin dra tsy ck rrow ffle nna sk vey lde ppa rt`. Examples: "Tamsel",
    "Robbin", "Noffle".
  - Species colour (tapestry stripe) `= DYES[(h>>>11)%8]`.
  - The display name is the given name. The tooltip adds the agent's own name, built with the
    shipped fallback chain `pane_name || title || program.name || address` and cut to 40
    graphemes by our own grapheme-safe cutter (QuickJS has no `Intl`; we keep ZWJ, VS15/16, skin
    tones, keycaps and regional-indicator pairs together), then `.truncate()` for width.

### 5.2 Status → behaviour → visual

| Herdr status | Game meaning | Production | Badge shape (12 px, top-right of tile) | Colour | Tile treatment | Motion |
|---|---|---|---|---|---|---|
| `working` | weaving | auto-weave `ρ · C0 · (1 + σ·k)` | **filled diamond** (shuttle) | `weld` | species glyph in `ink`; a 2 px `weld` "thread" underline | none |
| `blocked` (incl. raw `error`) | raised hand: "needs you" | 0 | **filled triangle with knocked-out "!"** | `madder` | 2 px `madder` outline; tile sits 4 px higher (top −4); counted in the "▲ need you" chip | none in steady state; see below |
| `done` (unseen finish) | finished; bobbin set down | 0 (resting begins) | **filled circle with check notch** | `woad` | none extra | none |
| `idle` | resting at the bench | 0; rest charge grows | **hollow ring** (1.5 px) | `walnut` | rest bar 28×3 under the glyph, `walnut` fill = r / Rcap | none |
| sub-agent (paneless or kept) | apprentice | adds σ to its parent | 6 px pips under the parent tile: ◆ working, ▲ blocked, ○ otherwise; at most 4 shown, then `+n` | per status | — | none |
| reward waiting (any status) | bobbin on the tile | — | bobbin icon 14 px at bottom-right, with a count numeral if more than 1 | bundle `indigo`, quick `weld`, frenzy `madder` (each with its own shape, §9.4) | — | none |

- Each status differs in **shape**: diamond, triangle, check-circle, ring. Colour is redundant,
  so tiles read in greyscale and for all common colour-vision deficiencies. The blocked tile also
  differs in **position** (raised) and **outline weight**. All shapes are checked in a greyscale
  Playwright screenshot (§11).
- The 7501 word `done` for a paneless apprentice is treated as idle (the shipped `kidStatus`
  rule), and `error` counts as blocked.
- **"Needs you" pulse:** when a helper *becomes* blocked, the counts chip (not each tile) gets
  `.loop("opacity", {from: 0.55, to: 1, period: 1800})` for **10 s**, then stays still. In calm
  mode there is no pulse. Herdr already raises its own toast and sound for blocked agents
  (host-api §4), so our cue is deliberately silent and steady.
- **Clicking a blocked tile** (or `ctrl-shift-j`, which cycles blocked helpers oldest first) runs
  `run("pane.focus", {pane})` for pane agents, or `run("terminal.peek", {terminal})` for paneless
  apprentices. First we check that the address is still in the live list; the arguments are
  plain strings, so `run` cannot throw on validation. Clicking any other tile does the same
  "open" action, unless the click lands on its bobbin, which collects it instead.

### 5.3 Reward drops on task finish

The trigger is the `turn` value from `terminals()`. For each helper the save keeps `lastTurn`:
- First sighting: record `turn`, drop nothing.
- `turn > lastTurn`: `d = min(turn − lastTurn, 3)` drops, then `lastTurn = turn`.
- `turn < lastTurn` (core restart): reset `lastTurn = turn`, drop nothing.

This works whether or not herdr showed `done`, which it skips when the person is watching.

Drop type comes from a seeded roll, `mulberry32(seed ^ fnv1a(helperKey + "/" + turn))`. The same
drop is produced in every window and on replay.

| Bobbin | Weight | Effect when collected | Magnitude | Upgrades |
|---|---|---|---|---|
| **Spool bundle** | 55 | instant thread | `max(B_s · H, 30 · C0) · restMul` | B_s = 60 s → 90 → 135 → 200 (Bigger Bobbins I–III) |
| **Quickened Hands** | 30 | hand clicks ×Q | Q = 3, for `30 s · (1 + r/120)` | Q = 4, 5 (Stronger Hands I–II) |
| **Weaving Frenzy** | 15 | all production ×4 | `20 s · (1 + r/120)` | 30 s, 45 s (Long Frenzy I–II) |

- Here `r` is the helper's stored rest at the moment the drop was made.
- A repeated boost of the same type extends its time remaining, capped at 3× its base duration.
  Different types multiply.
- Each helper's stash holds at most **5** bobbins. A sixth turns the oldest into an instant bundle
  at 50 % value, so nothing is lost and nothing piles up without limit.
- Apprentice turns drop **mini bundles** (bundle value × 0.25) into the *parent's* stash.
- The **Bobbin Basket** automation (§6.5) collects bobbins that have waited 10 min.

### 5.4 Idle rest charge

```
rest r (minutes) grows by 1 per minute while the helper is idle or done (not blocked, not working)
r ≤ Rcap,  Rcap = 60 → 120 → 180   (Restful Bench I–II)
restMul = 1 + r / 60               (×1 .. ×4)
```

r is spent (set to 0) when the helper's next drop is created. It also grows offline for every
saved helper, capped as above.

### 5.5 Sub-agents (apprentices)

```
A_i       = ρ · C0 · (1 + σ · min(k_i, 8))     for each working pane helper i
k_i       = working apprentices whose parent chain (≤ 32 hops) reaches i
σ         = 0.25 → 0.40 → 0.60                 (Apprentices I–II)
A_total   = (Σ_i A_i) · weff(w) / w,  w = number of working helpers
weff(w)   = w for w ≤ 4,  else 4 + 3 · ln(1 + (w − 4) / 4)
ρ         = 0.2 auto-weaves per second → +0.1 per Shuttle Grease I–V (max 0.7)
```

`weff` is the "busy bench" curve: 1→1, 4→4, 8→6.08, 12→7.30, 20→8.83, 30→10.04, 60→12.12. Every
agent always adds something and there is no cap, but 30 agents do not trivialise the game (§10).
Apprentices that are kept as panes appear in `agents()` and also have a parent. They are counted
as apprentices, not as separate pane helpers, to avoid double counting. They still get their own
tile, marked with a 3 px left rule in the parent's dye colour.

### 5.6 How 30+ helpers stay readable

- **Counts chip** (always visible, never scrolls): `▲2 need you · ●5 · ◆11 · ○14`, each count
  using its status shape and colour. Clicking the ▲ segment cycles blocked helpers, and clicking
  ● collects all.
- Tiles are fixed at 36×36 with a stable order: workspace order, the same as herdr's sidebar. No
  urgency reshuffle, because a jumping order is motion that steals attention. A setting offers
  "urgency first" for people who prefer it. Standard state fits 32 tiles at W = 1172; beyond that
  the roster scrolls horizontally while the counts chip stays put.
- Compact state uses 12 px pips at a 14 px pitch: about 47 visible at W = 1172, blocked first,
  then `+n`.
- Expanded state uses 56×60 tiles with a 9 px given name.
- Every tile has a tooltip: `Tamsel the Orb-spinner · claude — api/tests · working · 3.2K/s · rest 40% · 2 bobbins · 3 apprentices`.
- The Hall's Helpers tab is a virtual list with status filters, built for hundreds.
- **Every agent is a saved helper.** A record is created on first sighting, with no daily cap.
  Records of helpers gone for more than 30 days fold into one "retired weavers" aggregate (count
  plus lifetime thread). The save stays small: a helper record is about 160 bytes, and 1,500 live
  records come to about 240 KB, well under the 1 MiB `readTextFile` cap.

---

## 6. Economy

### 6.1 Resources

- **Thread** (bank, run total, lifetime total). Numbers use 3 significant digits with suffixes
  K, M, B, T, Qa, Qi, Sx, Sp, Oc, No, Dc, then `1.23e45`. This is our own formatter, because
  `Intl` is absent.
- **Patterns** (prestige currency), never spent.

### 6.2 Total rate

```
P_bld = G · Σ_i base_i · n_i · 2^(u_i)                 u_i = building upgrades owned for tier i
H     = (P_bld · T_active + A_total) · F · M           T_active = T if tension > 0 else 1
F     = 4 during Weaving Frenzy, M = 7 during Moth Glow (else 1)
```

Engine ticks credit `H · dt`. `A_total` uses the current helper statuses delivered by the glue.

### 6.3 Buildings (cost growth ×1.15 per owned: `cost_n = base · 1.15^n`)

| # | Building | Base cost | Base thread/s | Payback (s) | Shop art |
|---|---|---|---|---|---|
| 1 | Drop Spindle | 15 | 0.1 | 150 | `bld-spindle.svg` |
| 2 | Spinning Wheel | 200 | 1 | 200 | `bld-wheel.svg` |
| 3 | Carding House | 3,000 | 7 | 429 | `bld-carding.svg` |
| 4 | Dye Vat | 45,000 | 45 | 1,000 | `bld-vat.svg` |
| 5 | Treadle Loom | 700,000 | 300 | 2,333 | `bld-treadle.svg` |
| 6 | Punch-card Loom | 11,000,000 | 2,000 | 5,500 | `bld-punch.svg` |
| 7 | Water Mill | 180,000,000 | 13,500 | 13,333 | `bld-mill.svg` |
| 8 | Silk Terrace | 3,000,000,000 | 90,000 | 33,333 | `bld-terrace.svg` |
| 9 | Moonlit Atelier | 50,000,000,000 | 600,000 | 83,333 | `bld-atelier.svg` |

Building upgrades double tier i's output: **×2 at 10 owned** (cost `base · 40`), **×2 at 25**
(`base · 1,500`) and **×2 at 50** (`base · 60,000`). Names per tier are "Oiled / Balanced /
Master <Building>". That is 27 upgrades in all.

### 6.4 Techniques (upgrades)

| Group | Item | Costs | Effect |
|---|---|---|---|
| Click power | Calloused Hands, Sure Hands, Swift Hands, Deft Hands, Master Hands | 100; 2,500; 60,000; 1.5M; 40M | each doubles the hand factor (h += 1) |
| Click scaling | Weaver's Touch I–V | 5,000; 80,000; 1.2M; 20M; 400M | κ += 0.01, 0.01, 0.02, 0.03, 0.04 (total 0.11) |
| Helper efficiency | Shuttle Grease I–V | 300; 6,000; 120,000; 2.4M; 48M | ρ += 0.1 each (0.2 → 0.7) |
| Helper efficiency | Apprentices I–II | 50,000; 5M | σ 0.25 → 0.40 → 0.60 |
| Helper efficiency | Restful Bench I–II | 20,000; 2M | Rcap 60 → 120 → 180 |
| Tension | Taut Warp I–III | 1,000; 150,000; 15M | T 1.5 → 1.75 → 2.0 → 2.5 |
| Boost strength | Bigger Bobbins I–III | 2,000; 200,000; 20M | bundle seconds 60 → 90 → 135 → 200 |
| Boost strength | Stronger Hands I–II | 15,000; 1.5M | Quickened ×3 → ×4 → ×5 |
| Boost strength | Long Frenzy I–II | 25,000; 2.5M | frenzy 20 s → 30 s → 45 s |
| Buildings | 27 tier upgrades | §6.3 | ×2 each |

**Curios (special clickables):**

| Curio | Cost | Effect |
|---|---|---|
| Knot Patterns | 1,500 | knot chains (§4.2) |
| Lumen Moth | 8,000 | the moth appears (§4.4) |
| Long Patterns | 90,000 | 5 knots waiting; chains up to ×2.25 |
| Moth Lantern I–II | 150,000; 12M | moth chance 1/240, then 1/180 per present second |
| Silver Knot | 600,000 | 1 in 8 knots is silver (×5) |

### 6.5 Automations (Workshop tab), each with its own on/off switch

| Automation | Cost | What it does | Default after purchase |
|---|---|---|---|
| Bobbin Basket | 40,000 | collects any bobbin that has waited 10 min (boosts start then) | on |
| Knotter | 250,000 | ties a knot that has waited 90 s, at 60 % value, without a chain bonus | on |
| Foreman | 1,000,000 | every 30 s, buys the best-payback building if its cost ≤ 10 % of the bank | off |
| Pattern Clerk | 5,000,000 | every 30 s, buys the cheapest technique if its cost ≤ 5 % of the bank | off |

Moths are never automated. Each switch appears both on its shop row and in Settings →
Automations (§8.3).

### 6.6 Typical player (the profile §10 asserts)

- herdr window open **9 h/day** (a workday). The machine sleeps the other 15 h.
- **10 check-ins a day, 2.5 min each** (25 active minutes/day), one every 54 min, at **60
  clicks/min** while there.
- **4 agents.** Each works in 25-minute tasks with a 20-minute gap (a 45-minute cycle, staggered by
  7 min), which is about **5 working hours per agent per day** and **12 finished tasks per agent
  per day** (48 bobbins). Two of each agent's gaps per day start with 15 min blocked.
- No sub-agents. The player buys greedily by best payback at each visit, and collects every
  bobbin and knot when visiting.
- Each moth is caught with 90 % probability.

### 6.7 Prestige: hang the tapestry

```
Patterns_total(L) = floor( cbrt( L / 1e8 ) )          L = lifetime thread over all runs
gain              = Patterns_total(L) − Patterns_held
Hang enabled when   gain ≥ max(10, ceil(0.25 · Patterns_held))
Permanent bonus:    G = 1 + 0.05 · Patterns_held  (clicks, buildings and, through C0, helpers)
```

The first hang becomes available at L = 1e11, which gives 10 Patterns and G = ×1.5. The second
needs gain ≥ 10, so L = 8e11 (total 20 Patterns, ×2.0). The third needs L = 2.7e12.

**Hanging resets** the bank, run total, buildings, techniques, curios, tension, knots and boosts.
**It keeps** Patterns, lifetime totals, helper records with their stashes and rest, tapestries,
settings, notification counters and heirlooms.

**Heirlooms** are unlocked by Patterns held:
- 10: automations stay purchased across hangs.
- 25: start each run with 10 Drop Spindles and Knot Patterns.
- 50: Lumen Moth is always unlocked.
- 100: 5 knots can wait.

**The tapestry.** At hang time the engine records up to 32 stripes `[dyeIndex, weight]`: one per
top helper by run contribution (in its dye), "your hand" (indigo, all click income) and "the
looms" (walnut). The rest are merged into a "bench" stripe. It is drawn with `paint_path`
rectangles in `%` coordinates and stored in the save (at most 20 tapestries, about 1 KB each).

---

## 7. Offline

### 7.1 When "away" applies

- **On load** (init): `now − state.lastTickAt > 60 s`.
- **During a session:** a tick finds a wall gap over 60 s, for example the machine slept with
  herdr open.
- A hidden window is **not** away. `window()?.visible === false` keeps ticking at a 5 s cadence
  and does not render.

### 7.2 What accrues (closed form, no loops: `engine.away(state, fromMs, toMs)`)

```
dt      = min(toMs − fromMs, 8 h)
thread += dt · ( 0.5 · P_bld  +  0.25 · ρ · C0 · weff(n_bench) )
rest   += dt (minutes) for every helper on the bench, each capped at Rcap
(no knots accrue while away; knots need window-open time)
```

- `n_bench` = helpers seen live in the 24 h before leaving. Every saved, recently active helper
  "keeps gathering" at a resting quarter-rate. Machine sleep stops real agents, so a fixed resting
  rate stands in for them.
- Tension, boosts and rhythm are cleared. Boost timers are wall-clock and expire while away.
- Turn deltas found on return (agents that finished while herdr was closed but the core ran)
  produce normal drops, capped at 3 per helper.
- With two windows, only the **production-lease holder** (§8.4) credits away time, using the file's
  `lastProducedAt`, so the same night is never paid twice.

### 7.3 Away summary contents

- Real time away and credited time (with "capped at 8 h" when it applied).
- Thread gained, split into looms and resting helpers.
- Top 5 resting helpers by thread (species glyph and given name), then "+ n others".
- Bobbins waiting (count by type), and rest gained (helpers now at full rest).
- Save events while away, for example "restored from backup".

---

## 8. Settings

### 8.1 Calm mode (`ctrl-shift-m`, or Settings; default off)

Calm mode changes exactly the following:
1. **No native loops at all.** That covers the needs-you pulse, the first-run hint ring and the
   moth flutter. A calm moth sits still and lives 20 s.
2. **No floating "+N" text** and no click transitions. The spool's pressed state uses an `active`
   opacity of 0.9 only.
3. **Numbers update every 5 s** instead of every second. The steward tick stays at 1 Hz for game
   logic, but `cx.notify()` is called only when a 5 s bucket changes or the person acts.
4. **Away card and banners appear without transitions.**
5. **Non-critical toasts are suppressed**, even if opted in. Save-problem toasts still follow §8.2.
6. **Muted backdrop:** the scene card uses `tile` instead of the cloth gradient, and boost chips
   lose their gradient.
7. Tooltips and every status shape stay. Readability is never reduced.

Outside calm mode the steady-state animation budget is also **zero loops**. Loops appear only
for bounded events: the moth (up to 4 loops for at most 12 s), the needs-you pulse (1 loop for
10 s), the first-run hint (1 loop for at most 30 s) and flecks (transitions under 500 ms, at most
4 at once).

### 8.2 Notifications (opt-in, default off)

- Master switch, plus one switch per event:
  - **Tapestry ready:** hanging becomes available in a run (once per run).
  - **Bobbin pile-up:** 12 or more bobbins waiting and none collected for 2 h (once per day).
  - **New loom unlocked:** the first purchase of a building tier above the best so far (once per
    tier).
- **At most 3 a day** in total (local calendar day). The counter lives in the save, so windows
  share it (merge takes the max). Notifications are sent with
  `notify({title, body, level: "info", timeout: 6000, action: {name: "mod.open", args: {name: "weftwork"}}})`.
- **Never any sound.** `playSound` is never called.
- **Never duplicates herdr's own alerts.** Herdr already toasts and sounds for "needs you" and
  "finished" (host-api §4), so we have no agent-status notifications at all.
- **The one exception: save problems.** The banner (§3.5) is the main signal. If a save error
  persists for **2 min** while the strip is hidden or the window is not visible, the game sends
  **one** `level: "error"` toast per episode, even with notifications off, at most 2 per day. It
  does not count toward the cap of 3. A failing save must never be silent (the brief's hard rule).
  Settings explains this exception in one line.

### 8.3 Automation switches

Settings → Automations lists **Bobbin Basket, Knotter, Foreman and Pattern Clerk**, each with a
switch. Items not yet bought are shown disabled with "Buy in Workshop". The switches are mirrored
on their shop rows.

### 8.4 Other settings

- Roster order: workspace order (default) or urgency first.
- Save file location: default `<appHome>/data/weftwork/save.json`, or an absolute path for
  sharing between two herdr homes.
- "Reset game" (two-step confirm).
- Number format: short (default) or scientific.

### 8.5 Saving, handover and two windows (the robustness contract)

- **Files**, all written with `writeTextFile` CAS, using absolute paths from `appHome()`. Nothing
  is ever written under `mods/` (that would trigger a reload).
  - `save.json`:
    `{"format":"weftwork-save","v":1,"rev":N,"writer":"<id>","savedAt":ms,"sum":"<fnv1a hex of state text>","state":{…}}`
  - `save.bak.json`: the last save that passed validation, copied at most every 5 min.
  - `save.damaged-<ms>.json`: the original text of any file that failed validation, created with
    `expected = null`.
- **Cadence:** save when the state is dirty, at most every 15 s, and right away after a purchase,
  a hang, a setting change or a moth catch. Only one write is in flight at a time. `close()`
  starts a final write at once.
- **Load:**
  1. Read `save.json`, then parse it and check `format`, `v`, `sum` and the shape. Every map is
     rebuilt as a null-prototype object. Tests include the keys `__proto__`, `constructor` and
     `toString`.
  2. If that fails, keep the bad text aside, load `save.bak.json` and show a banner.
  3. If both fail, start fresh, keep both texts aside and show an error banner. **Never silent.**
- **CAS conflict** (`The file changed outside Herdr…` / `…while saving…`): re-read, then
  `merge(base, mine, theirs)` and retry, up to 3 times. After that, a banner with Retry.
  - Additive fields (bank, run and lifetime earned since base) add our delta onto theirs.
  - Purchases since base are replayed as intents. Any that are no longer affordable are dropped
    and refunded, and reported in a banner.
  - Helper maps are unioned by key, taking the max `lastTurn` and the max rest.
  - Settings use last-writer-wins per field, by timestamp.
  - If theirs already hanged (its `runId` differs), our earnings since base go into their run and
    our purchases are dropped.
- **Production lease** (two windows on one save): the save carries
  `producer: {writer, until}`. Only the holder credits building output and away time; the lease
  is renewed on every save for 60 s. Other windows credit only their own clicks and their own
  helpers, which are disjoint because helper keys carry `homeId`. A lapsed lease is taken over by
  the next window that saves.
- **Hot reload without rollback:** the live state is kept in
  `globalThis[Symbol.for("weftwork.live.v1")]`, a null-prototype object holding
  `{schema, state, diskText, rev, stewardEpoch, pendingOps}`. It is set only from `init` and from
  tasks, never at module top level. A new `init` adopts the slot (migrating if `schema` changed),
  increments `stewardEpoch` and registers fresh timers. Old timers check the epoch and do nothing,
  so even in the moment before the old generation is cancelled there are never two writers.
  After a VM restart (memory pressure) the slot is empty: load from disk, losing at most 15 s.
- **Copies in one window** (strip plus Hall overlay) share the slot. The strip copy is the
  steward: it runs the tick and saves. The Hall applies intents through the slot's engine
  functions and only renders. If the only shown copy is the Hall, it takes the steward role until
  the strip returns.

---

## 9. Art direction

### 9.1 Style

Flat vector with no outlines on filled shapes, 2 px rounded strokes for line glyphs, 4 px corner
radii, no gradients except the cloth band and the boost chips, and no drop shadows inside the
scene. The palette is **natural dyes on linen (light)** and **dyes by lamplight on indigo night
(dark)**, chosen by `settings().dark`. Theme tokens are used only for the strip frame (`chrome`
from the layout) and the dialog chrome. Everything we draw sits on our own `bed` and `tile`
surfaces, so contrast is under our control in every herdr theme.

### 9.2 Palette (exact hex). Contrast ratios are WCAG 2.x, computed against `bed` and `tile`

| Token | Use | Light | ratio vs bed / tile | Dark | ratio vs bed / tile |
|---|---|---|---|---|---|
| `bed` | card surfaces | `#FBF7EF` | — | `#1A1E29` | — |
| `tile` | tiles, cloth background | `#FFFFFF` | — | `#232838` | — |
| `ink` | primary text, glyphs | `#1F2433` | 14.47 / 15.46 | `#ECE6DA` | 13.39 / 11.80 |
| `muted` | secondary text | `#565C6B` | 6.26 / 6.69 | `#A9ABB6` | 7.28 / 6.42 |
| `line` | borders, tracks (non-informative) | `#D6CCBA` | 1.49 / 1.59 | `#3A4052` | 1.61 / 1.42 |
| `weld` | working, tension | `#8F6200` | 5.02 / 5.36 | `#F2B53A` | 9.07 / 7.99 |
| `madder` | needs you, errors, hang button | `#B83A0B` | 5.39 / 5.76 | `#FF7D4D` | 6.57 / 5.79 |
| `woad` | done, bundles | `#1B5CA3` | 6.33 / 6.76 | `#6FAAF2` | 6.90 / 6.08 |
| `walnut` | idle, rest | `#6E6358` | 5.48 / 5.85 | `#B3A595` | 6.92 / 6.10 |
| `indigo` | thread, accents, buttons | `#3A47A0` | 7.59 / 8.11 | `#9AA5FF` | 7.29 / 6.42 |
| `saffron` | moth, golden/dawn knots, Patterns | `#A86F00` | 3.98 / 4.25 | `#FFCC4D` | 11.09 / 9.77 |
| `moss` | success chips ("saved") | `#3F6E3A` | 5.61 / 6.00 | `#8CCB7E` | 8.69 / 7.65 |

- All text tokens are ≥ 4.5:1 (WCAG AA for normal text) on both surfaces in both appearances.
- Light `saffron` (3.98) is used only for graphics and 18 px-plus figures. That passes the 3:1
  rule for non-text and large text.
- `line` is decorative only; no information depends on it.
- Button text is `bed` on an `indigo` fill: 7.59 (light) and 7.29 (dark).
- Tints are written as 8-digit literals (for example `#B83A0B29`). We never append alpha to theme
  values, which may already be 8 digits.
- Status hues follow herdr's defaults (working is yellow, blocked red, done blue), so the strip and
  sidebar agree in meaning. The shapes carry the meaning independently.
- Dye stripes for species and tapestries: `#3A47A0 #B83A0B #8F6200 #1B5CA3 #3F6E3A #6E6358 #7A3E8C #A86F00` (light) and
  `#9AA5FF #FF7D4D #F2B53A #6FAAF2 #8CCB7E #B3A595 #C996DB #FFCC4D` (dark).

### 9.3 Assets: `mods/weftwork/art/`

All are hand-authored SVG, generated by `tools/art/build.mjs` from small shape scripts. Files used
with `image()` carry explicit `width`/`height` attributes of at least half their largest
on-screen size, because they are rasterised once at 2× (gpui-ui §3).

| File | Size | Drawn with | Notes |
|---|---|---|---|
| `status/working.svg`, `blocked.svg`, `done.svg`, `idle.svg` | 12×12 | `svg()` tinted | diamond, triangle with "!", check-circle, ring |
| `status/pip-working.svg`, `pip-blocked.svg`, `pip-other.svg` | 6×6 | `svg()` | apprentice pips |
| `species/{weaverbird,orbspinner,silkworm,tailorbird,caddis,bagworm,lacewing,webspinner}.svg` | 24×24 | `svg()` tinted `ink` | one-colour silhouettes, readable at 20 px |
| `icons/{thread,pattern,hall,collect,settings,close,knot,bobbin,hand,rest,save-warn,tension,rhythm,moth}.svg` | 16×16 | `svg()` | 2 px stroke line icons |
| `scene/spool-1.svg`, `spool-2.svg`, `spool-3.svg` | 72×72 (attrs 72) | `image()` | central object; more coloured threads per tier band (1–3, 4–6, 7–9) |
| `scene/knot.svg`, `knot-silver.svg`, `knot-dawn.svg` | 22×22 | `image()` | numerals are drawn as text over them |
| `scene/bobbin-bundle.svg`, `bobbin-quick.svg`, `bobbin-frenzy.svg` | 14×14 | `image()` | distinct silhouettes: round spool / spool with hand notch / spool with zigzag |
| `scene/moth-open.svg`, `moth-closed.svg` | 32×28 | `image()` | saffron moth, two wing poses |
| `buildings/bld-*.svg` (9) | 40×40 | `image()` | shop icons |
| `ghost-tile.svg` | 36×36 | `svg()` | empty-roster outline |
| `layout-preview.png` | 216×124 | layout `preview` | rendered by Playwright from the mock |
| `icon.svg` | 20×20 | `image()` | Hall header |

The cloth band, tension, rhythm and rest bars, and the tapestry are not files. They are
`paint_path` and `div` primitives in `%` coordinates. Every `Background` colour is validated in
our code before use, because invalid colours there fail silently (gpui-ui §5).

### 9.4 Reward silhouettes (colour-blind safe)

- Bundle: a round flange spool.
- Quick: a spool with a hand-shaped notch.
- Frenzy: a spool wrapped in a zigzag.

These are distinguishable in greyscale at 14 px.

### 9.5 Animation with native primitives only

| Effect | Primitive | Bounded by |
|---|---|---|
| Spool press | `.active(s => s.opacity(0.9).mt(2))` on the wrapper | zero cost; no JS |
| "+N" fleck | absolute text at the click point; next render (`timer.after(16)`) sets `top −28` and `opacity 0` with `.transition("top"/"opacity", 480)`; removed after 600 ms | ≤ 4 at once; off in calm |
| Rhythm bar | `.transition("width", 150)` on an absolute-px width | only when the value changes |
| Moth flight | `.loop("left", {from: x0, to: x1, period: 6000})` + `.loop("top", {from: y, to: y − 6·zoom, period: 700})`; wings: `moth-open` and `moth-closed` stacked, opacity loops with period 260 (one from 1 to 0, the other from 0 to 1) | only while a moth exists (≤ 12 s); calm: static `moth-open` |
| Needs-you pulse | `.loop("opacity", {0.55 → 1, 1800})` on the counts chip | 10 s; off in calm |
| Boost countdown | width set by the 1 Hz tick, no transition | — |
| Working | **static**: the weld underline and the cloth band growing each tick. No spinner, so 30 working agents cost nothing | — |

Loop lengths are given in px times `settings().zoom`, because `loop` does not scale by zoom
(gpui-ui §9). Any drawn loop wakes the whole view at about 30 fps. That is why the steady state
has none. §11 asserts this.

---

## 10. Balance target (the pacing simulator asserts these)

The numbers come from a prototype model of the formulas above, simulated per second during visits
and per minute otherwise, with offline nights credited as in §7. `tools/pace/` must reproduce
them with the real engine. "Wall" is time since first launch. Day 1 starts when the window first
opens at 09:00; "52:08" means 52 h 08 min after first launch, which is day 3 at 13:08. "Active"
is minutes spent clicking in the strip.

### 10.1 Typical player (§6.6)

| Milestone | Target | Tolerance (pass window) |
|---|---|---|
| First Drop Spindle | active 0:15 | ≤ active 0:30 |
| First Spinning Wheel | active 1:30 | active 1:00–2:30 |
| First technique (Calloused Hands) | active 2:00 | ≤ active 3:00 |
| 1,000 thread lifetime | wall 0:06 | ≤ wall 0:15 |
| First Carding House | wall 0:54 (2nd visit) | wall 0:30–1:30 |
| 10 Drop Spindles | wall 0:55 | ≤ wall 1:45 |
| First Dye Vat | wall 1:48 | wall 1:00–2:45 |
| 1M lifetime | wall 2:41 | wall 1:45–3:45 |
| First Treadle Loom | wall 3:36 | wall 2:30–4:45 |
| First Punch-card Loom | wall 5:24 | wall 4:00–7:00 |
| First Water Mill | wall 8:06 | wall 6:00–9:00 (day 1) |
| 1B lifetime | wall 9:00 (end of day 1 session) | wall 7:00–11:00 |
| Lifetime at end of day 1 (24:00) | 1.35e9 | 4.5e8–4.0e9 |
| First Silk Terrace | wall 27:36 (day 2) | wall 25:00–33:00 |
| Lifetime at end of day 2 (48:00) | 4.25e10 | 1.4e10–1.3e11 |
| **First hang available (L ≥ 1e11, 10 Patterns)** | **wall 52:08, active 62:30** | **wall 50:00–58:00 (day 3, 11:00–17:00 local); active 50–75 min** |
| First Moonlit Atelier | wall 53:24 | wall 50:00–60:00 |
| Lifetime at end of day 3 (72:00, if not hung) | 2.25e11 | 7.5e10–6.8e11 |

### 10.2 Other profiles: first hang available (asserts fairness and that clicking matters)

| Profile (one change from typical) | Target wall | Pass window |
|---|---|---|
| 0 agents | 73:55 (day 4 morning) | 66:00–82:00 |
| 1 agent | 57:00 | 52:00–66:00 |
| 12 agents | 31:12 | 26:00–40:00 |
| 30 agents | 25:26 | 22:00–34:00; **never < 20:00** |
| 30 agents with 2 apprentices each | 24:51 | 20:00–34:00 |
| 6-min visits (60 active min/day) | 48:00 | 42:00–54:00 (must beat typical by ≥ 2 h) |
| 150 clicks/min | 49:18 | 44:00–56:00 (must beat typical by ≥ 1 h) |
| 1-min visits (10 active min/day) | 56:14 | 50:00–64:00 |

### 10.3 Structural assertions

- The `weff` curve is monotonic: adding a working helper never lowers `A_total`.
- No single purchase brings its payback below 60 s after the first 10 minutes. This guards
  against runaway upgrades.
- Away credit never exceeds `8 h · (0.5·P_bld + 0.25·ρ·C0·weff(n_bench))`.
- Two simulated windows sharing a save, with the lease, end within 1 % of a single window with the
  combined clicks and helpers, so nothing is double-credited.
- Tuning knobs if a target misses, in this order: the prestige divisor `1e8`, tension per click
  (12 s), building growth (1.15), the offline building share (0.5).

---

## 11. Build, test and performance notes for this angle

- **Engine** (`mods/weftwork/engine/*.js`): pure ES modules with no herdr or gpui imports, no
  `Date.now` and no `Math.random`. The time and the seeded RNG state are passed in. API:
  `create(seed, now)`, `tick(state, {now, helpers, present, windowOpen})`,
  `act(state, intent, now)`, `away(state, from, to)`, `encode`, `decode`/`validate`,
  `merge(base, mine, theirs)`. Return values are `{state, events}`. Every engine call is O(helpers)
  and well under 5 ms at 500 helpers, measured in the wasm harness.
- **Glue** (`mods/weftwork/glue/*.js`): one `cx.timer.every(1000)` steward tick, which reads
  `agents()` and `terminals()` once each, maps them to helper inputs and calls `engine.tick`.
  There is one save task in flight at most, plus one fleck timer. Total outstanding host tasks ≤ 4
  (the limit is 1,024 for the whole VM). `render` only formats the cached view model: target
  ≤ 3 ms with 60 helpers, against a hard limit of 50. `cx.notify()` is called only when visible
  text changes (1 s buckets, 5 s in calm). Every entry point is wrapped in `try/catch` that routes
  errors to the banner. There are no module top-level herdr calls and no top-level `globalThis`
  writes.
- **Tooling:** a Node mock of `herdr`/`gpui-kit` that renders the element tree to HTML for
  Playwright; a QuickJS-ng wasm harness that runs the real module under 50 / 500 ms budgets and
  the frozen prototypes; and `tools/pace/` (§10).
- **Playwright screenshots:** every view (strip in compact, standard and expanded states; the Hall
  tabs; the away card; save banners; first run; calm mode) in light and dark, at 4 and 36 agents,
  plus whole windows. Assertions:
  - (a) a greyscale snapshot of the roster still distinguishes the four status shapes (pixel
    template match);
  - (b) the steady-state render tree contains **0** `loop` nodes, and at most 4 during a moth;
  - (c) no text node is cut inside a grapheme (fuzz with the shipped 15-emoji list).
- **Licence:** MIT, "Copyright (c) 2026 Tyler Coles". Share format: `layouts/Weftwork.json`,
  `mods/weftwork/`, `keys.json`, `RECIPE.md` (herdr's section order), `preview.png`, `README.md`,
  `LICENSE`.

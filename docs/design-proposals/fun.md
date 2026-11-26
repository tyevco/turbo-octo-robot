# Creaseworks: game design proposal (player-fun-first)

Angle: **player-fun-first**. Clicking should still feel good after months: crisp feedback, combos, chains of folds,
choices about when to spend a boost, and surprises that never punish you for being away. Every mechanic here
uses only the herdr-app v0.1.18 primitives verified in `docs/research/*.md` (cited as `[gpui §8]`,
`[host §4]`, `[life §6]`, `[qjs §2]`, `[share §10]`, `[pat §2]`).

| Item | Value |
|---|---|
| Game name | **Creaseworks** |
| Mod folder | `mods/creaseworks/` |
| Layout file | `layouts/Creaseworks.json` (stem `Creaseworks`: ASCII letters only, matches `valid_name`) |
| Keys section | `layout:Creaseworks` |
| Save | `<appHome>/data/creaseworks/save.json` + `save.bak.json` |
| Main resource | **Folds** |
| Prestige currency | **Wishes** (earned by stringing a thousand cranes) |
| Placement | Right-hand **Studio panel** (352 px, drag 288–560) plus an always-visible 30 px **Flock ribbon** above the status bar |
| Licence | MIT, Copyright (c) 2026 Tyler Coles |

---

## 1. Name, pitch, theme

**Pitch:** *Fold paper by hand. Every coding agent in your window is a paper crane folding beside you.*

**World.** A quiet paper studio seen from straight above: a warm desk, one big square of washi paper in the
middle, a tray for letters, a string of paper cranes slowly growing along the top. You fold the sheet by
tapping it. Your agents are **origami helpers** (cranes, frogs, foxes, boats…) that fold alongside you. When an
agent finishes a task it sends you a sealed **envelope** (a reward you open by clicking). When an agent needs
you, its paper **pennant** goes up. Resting agents lie flat and fill with a soft **rest charge**. Small
sub-agents are **fledglings**: tiny paper models that tag along with their parent.

The long goal is the old folding tradition of stringing a thousand cranes for a wish: when your string reaches
1,000 cranes you may **make a wish** (prestige), which clears the desk and leaves you permanently stronger.

**Why it is clearly not a side-scrolling dungeon game.** There is no avatar, no walking, no scrolling world, no
rooms, levels, map, monsters, combat, loot tables or dungeon vocabulary. It is a single static tabletop seen
from above, in which you make things and improve a workshop. Its verbs are fold, crease, open, string and wish,
not explore, fight or descend.

**Why the metaphor fits "I click, my agents help".** Folding is real handwork (your clicks), and a thousand
cranes are traditionally folded by many hands together, which fits a flock of agents. Each agent status has a
natural paper meaning: working = folding (a spinning paper pinwheel), needs you = a raised pennant, finished =
a letter sent to you, idle = lying flat and resting. Fledglings (sub-agents) are small helpers attached to a
bigger one, which matches how sub-agents relate to their parent.

**Name check.** I am not aware of any well-known game called "Creaseworks". The well-known clicker and idle
games (Cookie Clicker, AdVenture Capitalist, Clicker Heroes, Egg, Inc., Realm Grinder, Antimatter Dimensions,
Universal Paperclips, Kittens Game, Trimps, Melvor Idle, NGU Idle, Idle Slayer, Tap Titans, AbyssRium, Cell
to Singularity, Leaf Blower Revolution) have different names and themes. Universal Paperclips is about an AI
making paperclips, not folding paper. A web search for `"Creaseworks" game` found no game of that name. The
nearest results were origami puzzle and platform games with other names: *Creased* (a DePaul student
platformer), *Folds*, *A Fold Apart*, *Tengami*, and the papercraft platformer *Tearaway*. Creaseworks has
nothing in common with them beyond paper as a material: it uses no character, art, map, mechanic or name from
any of them. The name also avoids the `-fold` suffix of the research notes' example name. Before publishing,
we search Steam, itch.io and the app stores again.

> **Correction (review r6).** The check above covered names and themes and the origami games; it did not
> check mechanics against the clicker games it lists. The shipped design's first gilded crane did borrow
> Cookie Clicker's golden cookie (the Lucky payout `min(15 % of the bank, 900 s of output) + 13`, 13 s lives,
> 5–10 minute gaps, a ×7 storm) and its cube-root prestige. Those were replaced by Creaseworks' own rules,
> and every engine table was checked against the well-known incremental games: DESIGN.md §1 "Mechanics".
> This proposal's own Foil Crane and Paper Storm are history, not the shipped rules.

---

## 2. Placement in the herdr window

### 2.1 Decision: panel + ribbon (two copies of one mod, `props.role`)

The layout is the shipped `main` layout ([share §9]) with every id kept and **two nodes added**:

```
┌──────────┬──────────────────────────────────────────────────────────────┐
│ sidebar  │ tabs (42)                                                    │
│ 268 px   ├───────────────────────────────────────────┬──────────────────┤
│ spaces   │ work-body (row, pad 8, gap 8)             │ game-panel       │
│ agents   │  main (terminal panes)      [panel hidden]│ 352 px (288–560) │
│          │                                           │ "The Studio"     │
│          ├───────────────────────────────────────────┴──────────────────┤
│          │ game-ribbon  30 px   "Flock ribbon" (always visible)         │
│          ├──────────────────────────────────────────────────────────────┤
│          │ status (28)                                                  │
└──────────┴──────────────────────────────────────────────────────────────┘
```

* **Expanded state** = panel shown + ribbon. The panel is the full game: the desk scene, flock roster, shop,
  string and settings.
* **Compact state** = panel hidden (`layout.toggle:game-panel`) + ribbon. The ribbon still shows every
  helper's status, the folds counter, the envelope count and a 26 px **mini sheet** you can tap, so the game stays
  playable and readable while the terminals get the whole width.

Why this shape (fun first, terminals still usable):
- A right panel (option b in [share §10]) gives a tall square scene for a big clickable object and
  crease-point chains. A 112 px strip (option a) is too short for satisfying clicking, an own pane (option c)
  hides the terminals while you play, and a float (option d) covers terminal text.
- The ribbon solves the two weaknesses of a panel. Status stays at a glance when the panel is hidden or
  narrow, and save problems are always visible (they are never only in a toast; see §3.8).
- Only one copy handles commands, so nothing runs twice (§11.3). Both copies render from one live engine
  state.

### 2.2 Terminal cost

| State | Width lost | Height lost |
|---|---|---|
| Expanded | 352 + 8 gap = 360 px (drag 296–568) | 30 px |
| Compact | 0 | 30 px |

`main` gets `"min": 360` so a drag can never squeeze the terminals below 360 px. The game is never
`focusable` and never takes the keyboard: `mod.json` has no `focusable`, the game calls no `track_focus` and
has no Input. Typing always reaches the focused terminal. Clicking in the game never focuses another pane. The
only exception is clicking a "needs you" cue, which deliberately runs `pane.focus`.

### 2.3 Nodes added to `layouts/Creaseworks.json`

The rest of the file is `defaults/layouts/main.json` with `"preview": "mods/creaseworks/art/layout-preview.png"`
at the root and no `theme` or `colors`, as [share §10, Do 4–6] requires. The two new nodes are:

```json
{ "id": "game-panel", "type": "block", "size": {"px": 352}, "min": 288, "max": 560,
  "radius": 10, "border": {"width": 1, "color": "border"}, "background": "chrome",
  "content": {"mod": "creaseworks", "props": {"role": "panel"}} }
```
This is the **last child of `work-body`**, after the hidden `panel`. It is not under `panel-body` ([share §9]).
`main` gets `"min": 360`.

```json
{ "id": "game-ribbon", "type": "block", "size": {"px": 30}, "background": "chrome",
  "content": {"mod": "creaseworks", "props": {"role": "ribbon"}} }
```
This is a child of `work`, between `work-body` and `status`. It uses fixed px and is not resizable (the `work`
column is `resizable:false`).

`mods/creaseworks/mod.json` = `{ "place": "none", "title": "Creaseworks", "palette": [ … §2.4 … ] }`.
`"place": "none"` stops herdr docking a copy into another layout ([share §7]).

### 2.4 Keys (`keys.json`, merged into the person's file)

```json
{
  "layout:Creaseworks": {
    "ctrl-shift-g": "layout.toggle:game-panel",
    "ctrl-shift-y": "creaseworks.needs-you",
    "ctrl-shift-j": "creaseworks.open-envelope"
  }
}
```

| Chord | Action | Why this chord |
|---|---|---|
| `ctrl-shift-g` | Expand or compact the Studio (app command, so it works even with the panel hidden) | not in `defaults/keys.json`, not a terminal binding ([share §3.3]) |
| `ctrl-shift-y` | Open the helper that has needed you longest (`pane.focus`, or `terminal.peek` for a fledgling) | free; mnemonic "y = you" |
| `ctrl-shift-j` | Open the oldest envelope in the tray (counts as clicking it) | free per [share §10] |

- These are not plain ctrl+letter chords, which programs need, and not alt+letter chords, which readline and
  emacs use. None appears in the default chord list ([share §3.3]). They show in the Keys overlay as
  `ctrl-shift-y  (layout:Creaseworks)` → "creaseworks needs-you".
- There is deliberately **no "fold" key** (folding is a mouse pleasure, not key-mashing next to a terminal). The
  `mod.json` `palette` names the two mod commands. The ribbon copy is always shown, so `creaseworks.*` commands
  always have a live receiver ([host §11]).

---

## 3. Views

Type: herdr UI font. Sizes are logical px before zoom. Chrome colours come from `theme()`: `chrome`,
`surface`, `foreground`, `muted`, `dim`, `border`, `accent`, and the status keys. Game-art colours come from the
palette in §9 (`P.*`), which has a light and a dark set chosen by `settings().dark`.

### 3.1 Studio panel: frame (352 × H, H ≈ 780 at a 900 px window)

```
x:0                                                      352
┌──────────────────────────────────────────────────────────┐ y0
│ HEADER 44                                                │
│ [fold 16] 12.48M folds (18 bold)       +48.2K/s (11 muted)│
│ ✦ 7 wishes · ×1.35 (11 muted)            [≡ calm] (11)    │
├──────────────────────────────────────────────────────────┤ y44
│ SAVE BANNER 32 (only when there is a save problem, §3.8) │
├──────────────────────────────────────────────────────────┤
│ DESK SCENE 292 (min 240)                       §3.2      │
├──────────────────────────────────────────────────────────┤
│ TABS 34   Flock(3!) │ Shop │ String │ Settings           │
├──────────────────────────────────────────────────────────┤
│ TAB CONTENT  flex 1, overflow_y_scrollbar                │
│ (§3.3 – §3.6)                                            │
├──────────────────────────────────────────────────────────┤
│ FOOTER 24  ● Saved 4s ago     shared save · v1.0         │
└──────────────────────────────────────────────────────────┘
```

- Header: `bg(t.chrome)`, padding 10×12. The folds number is 18 px bold `t.foreground`. Its rate is 11 px
  `t.muted` and turns `P.foil` while a boost is active. The wishes line is 11 px `t.muted`.
- Tabs: 4 equal tabs of 88 px, 34 px tall, 12 px medium text. The active tab has a 2 px `t.accent`
  underline (an absolute `div` that moves with `.transition("left", 160)`). The Flock tab carries a
  `t.blocked` count badge when anyone needs you. The last tab used is remembered in `localStorage` (per-copy UI
  convenience only).
- Footer: 11 px. A 6 px dot shows the save state: `t.done` = saved, `t.working` = saving, `t.blocked` =
  problem. Next to it, "Saved 4s ago", or "Read-only (other window owns the save)" in follower mode (§11.4).

### 3.2 Desk scene (352 × 292): the main view

```
x:0  16                92                     260             336 352
y0  ┌─────────────────────────────────────────────────────────────┐
    │  ~ flying cranes band (y 6–42): one 20px model per working  │
    │    helper, max 12, then "+N" ; bob .loop("top")             │
y44 │                 ┌──────────────────────┐   COMBO            │
    │   crease point  │                      │   ┃ x37            │
    │   ①──── ②       │     THE SHEET        │   ┃ meter 6×120    │
    │        ╲        │     168 × 168        │   ┃ (vertical,     │
    │         ③       │  (fold stage 0..7)   │   ┃  x 300, y 60)  │
    │                 │                      │                    │
y220│                 └──────────────────────┘   +1.2K  (pops)    │
    │   fuse 168×3 under sheet (combo window), y 226              │
y240│  TRAY  [✉][✉][✉][ ][ ][ ][ ][ ]   8 slots 32×24, gap 6     │
y268│  hint line 11px muted: "Open envelopes when you're ready"   │
y292└─────────────────────────────────────────────────────────────┘
```

Layering is by sibling order, back to front ([gpui §11, Don't 9]):
1. Desk: `window.paint_path(rect, Background.linear_gradient(180, P.desk, P.deskEdge))`, `absolute().inset_0()`.
2. Garland hint: a 4 px string of 40 tiny crane glyphs across the top (y 2). Its filled share mirrors §3.5.
3. Flying cranes band (§5.5).
4. Crease lines: one `paint_path` per finished segment, `PathBuilder.stroke(1.5).dash_array([6,4])`,
   colour `P.crease`.
5. The Sheet: a `div().id("sheet")`, absolute at left 92, top 44, 168×168, `cursor_pointer()`. It holds three
   stacked `svg()` layers for the current stage: `sheet-<n>-base.svg` tinted `P.paper`,
   `sheet-<n>-shade.svg` tinted `P.shade`, and `sheet-<n>-lines.svg` tinted `P.crease`. A press offset comes
   from a `.spring("top", {response:120, damping:0.7})` wrapper (+3 px on mouse down, 0 on mouse up).
6. Crease points: 28 px circles `bg(P.point)`, `border(2)` `P.ink`, with the number 13 px bold `P.ink`.
   A point that comes next in the chain shows a pulsing ring (`.loop("opacity", {from:0.35, to:1,
   period:700})`).
7. Scraps, the Foil Crane and the Kite (§4.4–4.5).
8. Combo meter: a vertical `div` 6×120 `bg(t.border)`. Its fill is an absolute child whose height
   transitions 120 ms. The number "×37" is 12 px bold above it, `P.ink` (`P.foil` when "In step", §4.2).
9. Fuse: 168×3 under the Sheet. Its width runs from 168 to 0 over the combo window (two-step transition,
   §4.2).
10. Pops: "+1.2K" 12 px bold `P.ink` (the chain bonus is 14 px `P.foil`). At most 8 are alive, kept in a ring
    buffer.
11. Tray: 8 slots (10/12/14 with upgrades: the row then wraps to 2 rows and the scene grows by 30 px). An
    empty slot is a 1 px dashed `t.border` outline. An envelope (§5.3) is a 32×24 tile: `svg(envelope.svg)`
    tinted the sender's washi colour, a 12 px wax-seal glyph showing the reward type, `.loop("top",
    {from:0, to:-2, period:1600})`, and the tooltip "From Saffron Frog — Sharp Crease (click ×3, 30 s)".

### 3.3 Flock tab: helper roster (built for 30+)

```
┌ Flock · 34 helpers · 9 folding · flock share 74%   [rows|grid] ┐ 28px, 11px muted
├ NEEDS YOU · 2 ───────────────────────────────────────── ▾ ┤ 24px header, t.blocked
│[tile28] Saffron Frog       ⚑ Needs you  4m    [Open ›]        │ 34px row
│         claude · api / tab 2                                  │
│[tile28] Indigo Owl         ⚑ Needs you  1m    [Open ›]        │
├ REWARD READY · 3 ──────────────────────────────────── ▾ ┤ t.done
│[tile28] Plum Boat          ✉ Envelope  Sharp Crease  [Open]   │
├ FOLDING · 9 ──────────────────────────────────────────── ▾ ┤ t.working
│[tile28] Kelp Crane         ✲ Folding   +3.4K/s  rested ×1.6   │
│         codex · web / tab 1    ▸ fledglings: ▲▲▲ (3 folding)  │ +16px fledgling line
├ RESTING · 20 ─────────────────────────────────────────── ▸ ┤ t.idle (folded by default when >8)
└───────────────────────────────────────────────────────────────┘
```

- Row (34 px, `flex_none`, `id("h-<address>")`):
  - **Identity tile**, 28×28, rounded 6: `bg(washi + "33")`, the 22 px species glyph tinted with the washi
    colour, plus a pattern overlay `svg(pattern-<p>.svg)` tinted `washi + "55"`.
  - **Names:** the nickname is 12 px semibold `t.foreground`, truncated. Below it, the agent label (`pane_name
    || title || program.name || address`, run through the shipped `clean()` rule [pat §3]) is 11 px `t.muted`,
    truncated natively. The label is pre-cut grapheme-safely to 64 code points first (§11.6).
  - **Status cell**, 92 px wide: the status shape (§5.1) 14 px plus a word in 11 px, both coloured with the
    status theme key.
  - **Right cell**, 72 px: the live rate, the charge arc (resting), or a button. "Open ›" is 56×22, rounded 5,
    `bg(t.blocked + "26")`, text `t.blocked`. Clicking it opens the agent's pane.
- **Fledglings:** a 16 px line under the parent with 10 px triangle chips (a status shape and colour each). Up
  to 8 chips are shown, then "+N". Clicking a chip runs `terminal.peek` ([host §6]).
- **Order:** groups follow urgency (needs you, reward ready, folding, resting), the shipped rank
  ([pat §2.2]). Inside a group: longest waiting first for needs you, oldest envelope first, highest rate first,
  most charged first. Group headers fold. Resting folds automatically above 8 members, and the fold state is
  kept in `localStorage`.
- **Grid mode**, automatic at more than 16 helpers (the switch in the title row overrides it): 40×44 tiles, 8
  per row at 336 px. Each tile has the identity glyph on top, the status shape in a 14×14 corner badge with its
  own `bg(status + "33")`, and a 2-letter monogram, 10 px. 34 helpers need 5 rows (220 px). The tooltip gives
  the full name, label, status and time.
- Up to 80 helpers render as plain fixed-height rows in `overflow_y_scrollbar()`, as the agents mod does at
  64 [pat §4]. Above 80, the roster switches to `v_virtual_list` with `on_item_click`, no row handlers and a
  definite height ([gpui §3]). Nothing is ever capped or dropped.

### 3.4 Shop tab

```
┌ [Workshop] [Tools] [Flock] [Seals] [Apprentices]      ×1 ×10 max ┐ 28px sub-tabs, 11px
│ [icon32] Washi Vat  ×14                     ┌──────────┐          │ 48px row
│          +3.6/s each · 50.4/s total (11 m)  │ 12.4K  ⓕ │ 76×30    │
│          next tier at 25: ×2                └──────────┘          │
│ [icon32] Drying Screen ×0   ░ locked silhouette until 1 seen ░    │
└───────────────────────────────────────────────────────────────────┘
```

- **Sub-tabs.** Workshop holds the buildings and their tiers. Tools holds click power and combo upgrades.
  Flock holds helper upgrades. Seals holds boost strength and specials. Apprentices holds the automations.
- **Buy button**, 76×30, rounded 6. Affordable: `bg(t.accent)`, text `t.accent_foreground`. Not affordable:
  `bg(t.surface)`, text `t.dim`, plus a thin progress underline showing `min(1, F/cost)` with a width
  transition of 300 ms.
- **"Best buy" spark.** The affordable item with the shortest payback (`cost / Δrate`) gets a 6 px `P.foil`
  dot. This is a choice aid, not an auto-buy.
- **Locked items** show as a `t.dim` "???" silhouette until the previous building is owned: a small surprise.

### 3.5 String tab: prestige screen

```
┌ The String ───────────────────────────────── 742 / 1000 cranes ┐ 13px semibold
│  ┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃   20 strands × 50 cranes, 12×200 each,   │
│  ┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃░░░░░   gap 3.6 → 312×200; filled part tinted  │
│  ┃┃┃┃┃┃┃┃┃┃┃┃┃┃┃░░░░░   strand's washi colour, rest ink 18%    │
│                                                                │
│  Next crane in 23.1M folds · run folds 8.26B                   │ 11px muted
│  At 1000 cranes: +10 wishes (each +5% to everything, forever)  │
│  You have 7 wishes · lifetime 17 · keepsakes: ✓ Remembered…    │
│  ┌────────────────────────────────────────────┐                │
│  │   String the Thousand  (locked until 1000) │ 312×40         │
│  └────────────────────────────────────────────┘                │
│  Keeps: wishes, helpers & their stories, envelopes in the      │
│  tray, settings. Clears: folds, buildings, upgrades.           │
└────────────────────────────────────────────────────────────────┘
```

- Each strand is one dim `svg(garland-strand.svg)` (12×200, 50 crane silhouettes) tinted `P.ink + "2e"`, with
  a second copy over it inside an `overflow_hidden` div whose **height** is the filled share (transition
  600 ms). That is 40 elements, never 1,000.
- **Confirming.** The first click turns the button into a confirm card (`bg(t.surface)`, border `P.foil`)
  listing the exact gains and resets, with [Keep folding] and [Make the wish]. [Make the wish] is enabled
  1.5 s after the card appears, so a double-click cannot prestige by accident.
- **Wish moment.** The string lifts (`top` transition −30 px over 900 ms, then opacity 0). 20 fledgling-sized
  cranes fly up through the scene band, and the desk fades back in empty. Calm mode replaces all of this with
  a 400 ms fade.

### 3.6 Settings tab (rows 36 px, `Switch.new(id)` drawn by us: 32×18 track, 14 px knob, `left` transition 120 ms)

```
┌ Play ─────────────────────────────────────────────────────┐
│ Calm mode                                         [ ○  ] │
│ Show flying cranes                                [  ● ] │
│ Crease points (chains on the desk)                [  ● ] │
│ Number style            [Short 12.4M] [Scientific 1.24e7]│
├ Apprentices (each appears once bought) ───────────────────┤
│ Envelope Opener — opens Paper Bundles after 60 s  [  ● ] │
│ Mat Keeper — buys cheap buildings                 [  ● ] │
│ Metronome — taps the sheet 1×/s while shown       [ ○  ] │
│ Crease Catcher — catches expiring points at 50%   [  ● ] │
│ Kite Reel — reels kites at 50%                    [  ● ] │
├ Notifications (off by default, max 3 a day, never sound) ┤
│ Allow Creaseworks notifications                   [ ○  ] │
│   ├ Your thousand cranes are strung               [  ● ] │
│   ├ Tray is full (envelopes are auto-opening)     [  ● ] │
│   ├ A Foil Crane is on your desk                  [ ○  ] │
│   └ A helper has needed you for 15+ minutes       [ ○  ] │
│   used today: 1 / 3                                       │
├ Save ─────────────────────────────────────────────────────┤
│ save.json · saved 4s ago · backup 2m ago  [Copy save][Restore backup] │
│ Reset game…  (two-step, type-free confirm)                │
└───────────────────────────────────────────────────────────┘
```

### 3.7 "While you were away" card

Shown when the player returns after ≥ 10 minutes: offline, asleep, or live but untouched. It is an absolute
card over the desk and tabs (inset 12, top 56, width 328, `bg(t.popover)`, border `t.border`, radius 10,
`shadow_lg`):

```
┌ While you were away · 7h 42m ─────────────── (8h cap) ┐ 13px semibold
│  +412.6M folds                                         │ 20px bold P.ink
│   Workshop night shift     +301.2M                     │ 11px rows
│   Flock night shift (4)    +111.4M                     │
│  12 cranes added to the string (742 → 754)             │
│  4 helpers fully rested (next task ×2)                 │
│  ✉ 3 envelopes waiting · ⚑ 1 helper needs you [Open ›] │
│  You can afford: Kite Field, Tempo III                 │
│  [ Back to folding ]                 [ Open the shop ] │ 140×30 each
└────────────────────────────────────────────────────────┘
```

If the absence was longer than 8 h, a line reads "You were away 11h 20m; helpers fold for at most 8h while
you're gone." In compact state, the ribbon shows a pill "Welcome back +412.6M". Clicking it runs
`run("layout.show", {id:"game-panel"})` and the card waits there.

### 3.8 Save-problem banner (never silent)

- **Panel:** a 32 px band under the header with `bg(t.blocked + "1f")`, a 3 px left border `t.blocked`, the
  pennant glyph, and 11 px text, e.g. "Couldn't save (disk full?). Your progress is safe in memory; retrying
  in 30 s." It has [Retry] and [Details] buttons. [Details] expands the raw herdr error string.
- **Ribbon:** a `t.blocked` chip "⚑ save" always sits at the far left until the problem clears, so the
  problem stays visible in compact state too.
- **Cases with their own text:** CAS conflict ("Another window changed the save; merged."), shown 6 s in
  `t.working`. Damaged file ("save.json was damaged; loaded your backup from 14:02. The damaged copy is
  kept as save.damaged-<n>.json."). Over 1 MiB guard ("Save is too large; trimming history."). Follower mode
  ("Another window owns this save; this one is watching.").
- Save problems never use `notify()` (notifications are opt-in); the always-shown ribbon chip is the guarantee.

### 3.9 Flock ribbon (30 px × work width; compact and expanded)

```
x:0 8                         ~170                                 W-150         W
┌─────────────────────────────┬───────────────────────────────────┬─────────────┐
│[fold14] 12.48M +48.2K/s     │ ⚑⚑ ✉✉✉ ✲✲✲✲✲✲✲✲✲ ◑◑◑◑◑◑◑◑ … +6     │ ✉3 [◇] [⇔]  │
└─────────────────────────────┴───────────────────────────────────┴─────────────┘
```

- **Left, 170 px:** the folds counter (12 px semibold) and rate (11 px `t.muted`). The `t.blocked` save chip
  takes the first place when needed.
- **Chips:** 20×20 tiles with gap 2, rounded 5, `bg(washi + "33")`. On each is the **status shape** 12 px
  coloured with the status key (§5.1). Needs-you chips also get a 1 px `t.blocked` border and blink. Order:
  needs you, reward ready, folding, resting. Clicking a needs-you chip opens the pane, clicking an envelope chip
  opens the envelope, and any other chip opens the panel scrolled to that helper. The tooltip reads "Saffron
  Frog — claude · api/tab 2 — Needs you · 4m".
- **Overflow:** `fit = floor(chipsWidth / 22)`. If there are more helpers than that, needs-you and envelope
  chips stay individual and the rest collapse into tally chips "✲ 14", "◑ 11" (status shape + count, 11 px).
  At 30+ helpers in a 1172 px work column, every urgent helper is still an individual chip.
- **Right, 150 px:** the envelope count "✉3" (click opens the oldest), the **mini sheet** `[◇]` (26×26, shown
  only in compact state, worth the same as a Sheet click with combo, but crease points do not spawn), and
  `[⇔]`, which runs `layout.toggle` on `game-panel`.
- **Empty state:** "No cranes yet · start an agent in any tab and it joins your flock" (11 px `t.muted`).

### 3.10 First run and zero agents

- **Desk:** the Sheet at stage 0 with a coach ring (2 px `P.foil` outline, `.loop("opacity", 0.3↔1, 900)`) and
  the text "Tap the sheet to fold" under it. The ring disappears after 8 taps, when the first crane is folded.
  The coach then points at the Workshop tab once 15 folds are banked ("Buy a Folding Mat").
- **Flock tab:** an empty-state card with a 64 px crane drawing in `P.washi[3]`. Title "Your flock is empty" (13 px
  semibold). Body (11 px muted): "Every coding agent in this window becomes a paper helper. Working agents fold
  for you, finished tasks send you envelopes, and an agent that needs you raises a pennant here." A button
  "How it works" expands a 4-row legend of the status shapes.
- With zero agents the game still works (Sheet, crease points, scraps, Foil Cranes, buildings). §10 sets a
  pacing target for this case too.

---

## 4. Clicking design

### 4.1 Symbols (all engine values; the engine is pure, so time is passed in as `now` ms)

| Symbol | Meaning | Start | Changed by |
|---|---|---|---|
| `F` | folds in the bank | 0 | |
| `R` | folds earned this run (prestige basis) | 0 | |
| `Wi` | wishes owned | 0 | prestige |
| `Mw` | `1 + 0.05·Wi` | 1 | |
| `c0` | base click | 1 | Bone Folder: `c0 = 2^k_folder` |
| `ε` | echo share of `H` added per click | 0 | Echo Crease: `0.03·k_echo` |
| `B` | workshop output/s: `Σ n_i·o_i·2^t_i` | 0 | buildings, tiers |
| `H` | total folds/s (§5.2) | 0 | |
| `combo` | consecutive hand hits within the window | 0 | |
| `win` | combo window | 1.2 s | Steady Hands: 1.6 s, 2.0 s |
| `cap` | combo cap | 50 | Steady Hands II: 75 |

### 4.2 The Sheet (central object)

```
v_click = (c0·Mw + ε·H) · Mcombo · Msharp · Mfinish · Mthousand
Mcombo   = 1 + 0.02·min(combo, cap)            → ×2.0 at 50, ×2.5 at 75
Msharp   = 3 while Sharp Crease runs (3.75 / 4.5 / 5.25 / 6 with Bright Seal I–IV)
Mfinish  = 5 on every 8th Sheet tap (stage 7 → a crane is folded), else 1
Mthousand= 10 during a Foil "Thousand Folds" (15 s), else 1
```

- **Combo:** a tap on the Sheet, a crease point, a scrap or the mini sheet within `win` of the previous hand hit
  gives `combo += 1`. Otherwise `combo = 1`. A finished chain adds +5. Up to 12 hits per second count
  (`clickRateCap`). Extra hits still animate but add nothing, so autoclickers gain nothing.
- **Fold stages, the core juice.** Every tap advances the Sheet one stage: square, diagonal, triangle, kite,
  diamond, bird base, petal fold, crane. Each stage is a different picture (an `svg()` layer swap, no
  transform needed). On the 8th tap the crane "lifts": a 20 px crane rises from the Sheet (`top` transition
  −60 px, opacity → 0 over 600 ms), that tap pays ×5, and the stage resets to the square. The ×5 beat every 8
  taps gives tapping a rhythm.
- **"In step" (clicking makes your agents stronger).** While `combo ≥ 25` (20 with Shared Rhythm), every
  working helper's output is ×1.5 (×2 with Shared Rhythm), and their pinwheels spin twice as fast (spin
  900 ms → 450 ms). The combo number turns `P.foil` and reads "In step". This is the main link between hand and
  flock: steady clicking multiplies the agents.
- **Echo:** each tap adds `ε·H`, up to 21% of the per-second rate at Echo VII, so a tap keeps the same share of
  income in any phase of the run.
- **Feedback:** the press spring (+3 px), the stage swap, a "+N" pop from `on_mouse_down("left")`'s
  `local_position` (divided by `settings().zoom`), and the combo meter. Each pop is created at (x, y) with
  opacity 1. A `cx.timer.after(16)` re-render then targets (x, y−24) and opacity 0 with
  `.transition("top", 600)` and `.transition("opacity", 600)`, and the pop is removed after 650 ms.
- **Fuse:** after each hit, the fuse renders 168 px wide with transition 0. A `timer.after(16)` re-render then
  sets width 0 with transition `win` ms linear, so it drains exactly when the combo would break. A
  `timer.after(win)` check resets the combo in the engine.

### 4.3 Crease points: nodes and chains

- **Spawning.** Points spawn only while **engaged**: the panel is shown, `window()?.active`, and the last hand
  input was less than 20 s ago. Nobody misses a point while away. A chain spawns every `U(4.5, 7.5)` s from
  the engine PRNG. It has `k` points numbered 1…k: k = 3, or `U{3..4}` with Advanced Bases I, or `U{3..5}`
  with Advanced Bases II. Points are placed in the desk area outside the Sheet, at least 40 px apart, using
  the PRNG and a 12-cell candidate grid.
- **Lifetime:** `7 + 1·k` s (calm ×2). In the last 2 s the point fades to opacity 0.4 (`transition("opacity",
  2000)`).
- **Value:** each correct point pays `3·v_click`, and a dashed valley-fold line is drawn from the previous
  point. Finishing the chain folds a model at the last point (a 40 px glyph pops, chosen by the PRNG from the
  12 species) and pays
  `chainBonus = 15 · H · (k/3) · (1.25 with Advanced Bases II)`, plus +5 combo.
- **Wrong order:** the chain "tears". Its lines vanish, the remaining points fade over 300 ms, and the clicked
  point still pays `1·v_click`. Skill is rewarded without punishment.
- At most 1 chain is on the desk (2 during a Paper Storm). Every handler that sits on top of the Sheet calls
  `cx.stop_propagation()` ([gpui §7]).

### 4.4 Pickups and special clickables

| Thing | When | Lifetime | Click | Value |
|---|---|---|---|---|
| **Scrap** (12 px confetti paper, 3 shapes) | engaged, every `U(35,55)` s | drifts down 14 s: `top` transition over 14 s + `.loop("left", ±6 px, 1400)` | 1 | `10·v_click` |
| **Fresh Ream** (daily welcome) | first engaged moment of each local day (the glue passes `dayIndex`) | stays until clicked | 1 | `+300·H` (min 100·c0) |
| **Foil Crane** (golden) | while the panel is shown and the window is active, every `U(300,540)·0.85^k_foilsense` s | glides across the desk in `10 + 2·k` s (`left` transition linear, `.loop("top", ±8, 1600)`); calm 20 s | 1 | one outcome, weights below |
| **Kite** (limited-time) | after Kite String, every `U(35,55)` min of engaged time | 8 s (calm 12 s), in the top-right corner | **10 taps** to reel in; the string shortens with each tap (`height` transition) | `+min(1200·H, 0.35·F + 300·H)` |
| **Envelope** (agent reward) | §5.3 | waits in the tray | 1 | §5.3 |

Foil Crane outcomes (engine PRNG):

| Outcome | Weight | Effect |
|---|---|---|
| Windfall | 40 | `F += min(720·H, 0.25·F + 60·H)` |
| Thousand Folds | 25 | `Mthousand = 10` for 15 s (calm 22 s) |
| Flock Call | 20 | 60 s: every helper counts as working (resting and waiting helpers join with ρ = 1) |
| Paper Storm | 15 | 15 s: a chain every 1.5 s, 2 chains at once, points pay `5·v_click` |

### 4.5 Why clicking stays meaningful months later

1. **It scales with the economy.** Echo (`ε·H`) and the chain bonus (`15·H`) are fractions of the live rate, so
   a tap is never worth only `c0`.
2. **It multiplies the agents.** "In step" makes steady clicking worth ×1.5–×2 on the whole flock. A late-game
   player with 30 working agents gets the most from rhythm.
3. **There are windows worth showing up for.** Sharp Crease, Updraft storms, Thousand Folds and Paper Storms
   turn a 2-minute session into a burst. Envelopes show their type on the seal, so the **player chooses** when
   to open a Sharp Crease (right before a clicking session).
4. **Skill has a ceiling.** Ordered chains (3–5 points), the 8-beat crane rhythm and the combo window reward
   attention without needing speed beyond about 2 taps/s. The 12 hits/s cap keeps the ceiling human.
5. **The design target is that clicking matters but is never mandatory.** For the typical player, hand income
   (Sheet, chains, scraps, foil, kite) is 12–30% of run folds and envelopes are another 8–20% (§10). A player
   who never clicks prestiges about 4 h of open time later; a dedicated clicker about 1–3 h earlier.

---

## 5. Helpers

### 5.1 Status → behaviour → at-a-glance look (colour-blind safe)

The source is `agents()` (pane agents, derived status) and `terminals()` (paneless fledglings: raw word,
`parent`, `turn`), read **once per tick** in the owner copy and indexed by `Map` ([pat §4]).

| Agent status | Game behaviour | Shape (unique silhouette) | Colour | Motion (normal / calm) | Word |
|---|---|---|---|---|---|
| `working` | folds: taps + staffing (§5.2); fledglings add on | **pinwheel**, 4 blades (`pinwheel.svg`) | `t.working` | `svg().spin(900)`, 450 when In step / static | "Folding" |
| `blocked` (also `error`) | **stops**; raises a pennant; clicking opens the pane; check-in bonus | **pennant flag** with "!" notch (`pennant.svg`) + "Needs you" pill | `t.blocked` | `.loop("opacity", 0.55↔1, 1200)` / static | "Needs you" |
| `done` (herdr's unseen finish) **or** an unclaimed envelope | an envelope waits in the tray | **envelope** with check flap (`envelope.svg`) | `t.done` | `.loop("top", 0↔−2, 1600)` / static | "Reward ready" |
| `idle` | rests: rest charge fills (§5.4) | **crescent** (`crescent.svg`) + charge arc | `t.idle` | none (the arc grows by `transition("width")` on a clip) | "Resting" |
| fledgling (sub-agent) | adds to the parent's taps; its finishes fill the parent's pouch | **small triangle** 10 px, status shape inside at 6 px | its status key | same as its status, half amplitude | "Fledgling" |

- Every status has a different **silhouette** (pinwheel, flag, envelope, crescent) and a different **motion**
  (spin, blink, bob, still) as well as a colour. It reads without colour, and in calm mode the silhouette and
  word alone carry it.
- The colours are herdr's own theme keys, so the game agrees with the sidebar ([pat §2.1]).
- `done` from `agents()` is shown only as a hint. The **envelope** is the reliable cue, because herdr often goes
  straight from `working` to `idle` while you watch ([host §4]).
- Fledgling status follows the shipped `kidStatus` rule: `error → blocked`, `done → idle`. A fledgling's `done`
  never lifts the parent ([pat §2.2]).
- **No duplicate alerts.** Herdr already toasts and plays sounds for "needs you" and "finished". The game adds
  only silent visual cues; its single optional notification is a 15-minute long-wait reminder (§8.2).

### 5.2 Production formulas

```
W       = set of pane-agent helpers with status "working" (fledglings excluded)
φ(W)    = 1                 if |W| ≤ 5
        = sqrt(5 / |W|)     if |W| > 5        (flock share: 9→0.75, 16→0.56, 30→0.41)
ρ_i     = 1 + c_i           (rest charge c_i ∈ [0,1] captured when task i started; §5.4)
κ_i     = 1 + Σ_j f_j       over helper i's working fledglings j (sorted by address):
          f_j = 0.35 for the first 4, 0.15 for each further one
τ       = 1 + 0.25·k_tempo  (taps/s)        e = 1 + 0.6·k_wing        s = 0.05 + 0.03·k_bench
Step    = 1.5 (2.0 with Shared Rhythm) while In step, else 1
Φ       = φ · Step · Σ_{i∈W} ρ_i · ( B·s  +  τ·c0·e·κ_i )      ← flock rate (staffing + taps)
H       = (B + Φ) · Mw · Mupdraft · (Flock Call ⇒ W := all helpers, ρ = 1)
```

- **Staffing** (`B·s` per working helper) means more working agents raise the whole workshop, and the
  workshop makes each agent worth more.
- **Taps** (`τ·c0·e`) mean agents fold "with your technique": your Bone Folder upgrades help them too.
- **Flock share `φ`** is diminishing returns, not a cap. Every agent always adds output and is always a saved
  helper, but a 30-agent window prestiges in about a day of open time, not in hours (§10). The roster header
  shows "flock share 41%".
- Per-helper rate, shown in the roster: `h_i = φ·Step·ρ_i·(B·s + τ·c0·e·κ_i)·Mw`.

### 5.3 Task finished → envelope (reward drop)

- **Detection** uses `terminals()[i].turn`, which increases each time a terminal stops working ([host §3, §4]).
  The save keeps `lastTurn[address]` and `born[address] = created_ms` in null-prototype maps.
  - `Δ = turn − lastTurn`.
  - First sighting, or `created_ms` changed, or `turn < lastTurn`: rebaseline with no reward (this guards
    against restarts).
  - `Δ > 0` for a pane agent: create one envelope with `tasks = min(Δ, 3)`.
  - `Δ > 0` for a fledgling: no envelope of its own. Instead the parent's **pouch** gets +0.15 per finish (max
    +0.6), and the parent's next envelope carries it.
- **Cooldown:** at most one envelope per helper per 60 s. Further finishes inside that window add +0.25 to the
  pending envelope's magnitude (max +0.75), so a stream of tiny tasks cannot flood the tray.
- **Type**, drawn by the engine PRNG when the envelope is created and shown on its wax seal:

| Type | Weight | Effect when opened | Base magnitude |
|---|---|---|---|
| **Paper Bundle** (seal: stacked sheets) | 40 | instant folds | `F += max(90·H·φd·m, 50·v_click)` |
| **Sharp Crease** (seal: blade) | 35 | Sheet taps ×`Msharp` | 30 s·d (durations add, max 5 min) |
| **Updraft** (seal: swirl) | 20 | `H ×2` and a Paper Storm | 12 s·d |
| **Foil Slip** (seal: star) | 5 | a Foil Crane glides in now | — |

```
m  = (1 + 0.5·c_i) · (1 + pouch) · (1 + 0.25·k_seal) · (1 + 0.25·[keepsake 50]) · tasks^0.5
d  = (1 + 0.2·k_seal)
φd = min(1, sqrt(5 / N24))   N24 = helpers seen working in the last 24 h  (flock share for drops)
```

- **The tray** holds 8 envelopes (10/12/14 with Bigger Tray). When a new envelope arrives and the tray is
  full, the oldest auto-opens: a Bundle pays its full value, and a timed envelope converts to a Bundle at 50%.
  Nothing is lost or expires, the player chooses when to open, and envelopes stay through prestige.

### 5.4 Waiting and resting

- **Needs you:** output stops and the pennant shows. Clicking the cue (roster "Open ›", ribbon chip, or
  `ctrl-shift-y`) runs `run("pane.focus", {pane})`, or `run("terminal.peek", {terminal})` for a paneless
  fledgling, after checking that the terminal is still live ([host §6]).
  - **Check-in bonus:** opening within 5 min of the pennant going up pays `F += 10·H`, once per blocked
    episode, so being attentive to real work is the reward.
  - Herdr's own needs-you toasts are left alone.
- **Rest charge:** `c_i += Δt / Trest` while idle, clamped to [0, 1]. `Trest = 30 min` (25/20/15 with Soft
  Paper). Offline time also charges. When the helper starts working, `c_i` is captured as its ρ boost for that
  whole task (until the next turn) and as envelope magnitude `(1 + 0.5·c)`. Then it resets to 0.
  - Visual: a 14 px ring arc drawn with `PathBuilder.arc_to` stroke 2, `t.idle`, from 0 to 360° × c. It is
    redrawn when c crosses a 10% step, so it costs at most 10 re-renders per rest.

### 5.5 Persistent identity and readability at 30+

- **Seed:** `h = fnv1a32(address + ":" + created_ms)`.
  - Species `= SPECIES[h % 12]`: crane, frog, fox, boat, swan, rabbit, fish, butterfly, star, owl, whale,
    turtle.
  - Washi colour `= (h >>> 4) % 10` (§9). Pattern `= (h >>> 8) % 4`: plain, dots, stripes, waves.
  - Nickname `= COLOUR_WORD[colour] + " " + SpeciesName`, e.g. "Saffron Frog". A clash in the live set gets a
    roman numeral, e.g. "Saffron Frog II".
- **Saved record:** `{address, born, seed, nick, firstSeen, lastSeen, lastTurn, charge, pouch, lifetimeFolds,
  tasks, envelopesOpened, checkIns}`. Records sit in a null-prototype map keyed by address. **Every agent ever
  seen is saved**: no daily cap, no "extras". Records not seen for 30 days move to a compact `archive` (seed,
  nick, totals) to keep the save below 1 MiB. An archive entry takes about 80 bytes, so 5,000 of them fit.
- **Flying cranes band:** one 20 px model per working helper in its own colour at `x = 16 + (seed % 300)`,
  bobbing with `.loop("top", 0↔−4, 1200 + seed%600)` so they never move in lockstep; beyond 12, "+N folding".
  It is decoration; the roster and ribbon carry the data.
- **Readable at 30+:** grouping by urgency, grid mode, tally chips in the ribbon, and individual chips that
  stay for every urgent helper (§3.3, §3.9). The Playwright views (§11.7) are captured at 0, 1, 4, 12, 34 and 64
  helpers.

---

## 6. Economy

### 6.1 Resources

- **Folds** (`F`) are earned and spent. Run folds (`R`) and lifetime folds are tracked separately.
- **Wishes** (`Wi`) are never spent. Each gives +5% to everything, multiplicatively through `Mw`.
- **Number format:** below 10,000 with thin separators. Above that, the suffixes K, M, B, T, Qa, Qi, Sx, Sp,
  Oc, No, Dc with 3 significant digits, or scientific notation (setting). All formatting is our own code; no
  `Intl` ([qjs §5]).

### 6.2 Workshop buildings (cost grows ×1.15 per owned; `cost_n = base · 1.15^n`)

| # | Building | Base cost | Output/s each | Payback (s) | Art |
|---|---|---|---|---|---|
| 1 | Folding Mat | 15 | 0.1 | 150 | a cutting mat with a grid |
| 2 | Kozo Grove (paper mulberry) | 200 | 0.6 | 333 | three-leaf shrub |
| 3 | Washi Vat | 2,800 | 3.6 | 778 | a tub with a screen frame |
| 4 | Drying Screen | 40,000 | 22 | 1,818 | sheets on a board |
| 5 | Crane Loft | 560,000 | 130 | 4,308 | a rafter hung with cranes |
| 6 | Kite Field | 8,000,000 | 800 | 10,000 | a diamond kite on a hill |
| 7 | Pinwheel Garden | 110,000,000 | 4,800 | 22,917 | three pinwheels |
| 8 | Paper Moon | 1,600,000,000 | 29,000 | 55,172 | a crescent of folded paper |

**Tiers:** each building has 4 tier upgrades that double its output, unlocked at 10, 25, 50 and 100 owned. Tier
costs are `base × 12`, `× 60`, `× 600` and `× 6000`.

### 6.3 Upgrades (exact)

| Line (sub-tab) | Levels | Effect per level | Cost of level L (1-based) |
|---|---|---|---|
| Bone Folder (Tools) | 7 | `c0 ×2` | 60; 500; 5,000; 60,000; 1M; 20M; 500M |
| Echo Crease (Tools) | 7 | `ε += 0.03` | `1,500 · 12^(L−1)` |
| Steady Hands (Tools) | 2 | window 1.2→1.6→2.0 s; L2 also cap 50→75 | 800; 250,000 |
| Advanced Bases (Tools) | 2 | chain length up to 4 / up to 5 (and ×1.25 bonus) | 20,000; 5M |
| Wing Training (Flock) | 12 | `e += 0.6` | `150 · 4^(L−1)` |
| Tempo (Flock) | 8 | `τ += 0.25` taps/s | `1,000 · 6^(L−1)` |
| Shared Workbench (Flock) | 5 | `s += 0.03` | `5,000 · 8^(L−1)` |
| Soft Paper (Flock) | 3 | `Trest −5 min` | `3,000 · 15^(L−1)` |
| Shared Rhythm (Flock) | 1 | In step at combo 20, ×2.0 | 2,000,000 |
| Bright Seal (Seals) | 4 | envelope magnitude +25%, durations +20%, `Msharp` +0.75 | `2,000 · 10^(L−1)` |
| Bigger Tray (Seals) | 3 | tray +2 | `10,000 · 20^(L−1)` |
| Foil Sense (Seals) | 4 | Foil interval ×0.85, glide +2 s | `25,000 · 10^(L−1)` |
| Kite String (Seals) | 1 | unlocks Kites | 100,000 |

**Visibility:** an upgrade appears when the player first holds 50% of its cost, so the shop grows as a stream
of small surprises and never shows a wall of 60 items.

### 6.4 Automations (Apprentices sub-tab; each has its own on/off switch in Settings, §8.3)

| Apprentice | Cost | What it does | Limits |
|---|---|---|---|
| A1 Envelope Opener | 50,000 | opens **Paper Bundles** 60 s after they arrive | never opens timed envelopes, so the player keeps that choice |
| A2 Mat Keeper | 500,000 | buys the cheapest building whose cost ≤ 5% of `F` | once per 10 s; never buys upgrades |
| A3 Metronome | 2,000,000 | taps the Sheet 1×/s while the panel is shown | value `c0·Mw + 0.5·ε·H`; no combo, no In step, no finish ×5 |
| A4 Crease Catcher | 20,000,000 | clicks a point 1 s before it expires | 50% value, no chain bonus |
| A5 Kite Reel | 200,000,000 | reels a Kite you missed | 50% value |

A newly bought apprentice is switched **on**. Switching one off takes effect on the next engine step. There is
deliberately no auto-prestige and no auto-open for timed boosts.

### 6.5 Prestige: String the Thousand

```
G           = 1.5e10 folds                       (calibrated, §10)
cranes(R)   = floor(1000 · sqrt(R / G))          shown on the String; 57 at 1e8, 258 at 1e9, 816 at 1e10
available   ⇔ cranes ≥ 1000                      (R ≥ 1.5e10)
wishesGain  = floor(cranes / 100)                = floor(10 · sqrt(R / G))  → exactly 10 at first availability
Mw          = 1 + 0.05 · Wi                      (permanent, all output and clicks)
```

- **sqrt shape:** early cranes come fast (fun), later ones slow. Waiting past the gate still pays (4G gives 20
  wishes) without making waiting compulsory.
- **Clears:** `F`, `R`, buildings, tiers, upgrades, apprentices (unless kept by a keepsake), active boosts,
  combo, the Sheet stage.
- **Keeps:** wishes, lifetime stats, every helper record (identity, totals, rest charge), envelopes in the
  tray, settings, notification counters, the save history.
- **Keepsakes** (by lifetime wishes, permanent):

| Lifetime wishes | Keepsake |
|---|---|
| 1 (first wish) | Remembered Hands: start each run with Bone Folder I–II |
| 10 | Seed Stock: start with 10 Folding Mats + 5 Kozo Groves |
| 25 | Old Apprentices: bought apprentices stay bought |
| 50 | Deep Tray: tray +2, envelopes ×1.25 |
| 100 | Gilded Paper: Foil Slip weight 5 → 10 |

### 6.6 The typical player ("Rin"), the reference profile for §10

| Parameter | Value |
|---|---|
| herdr open with the game live | 8 h/day (09:00–17:00), 5 days a week counted as consecutive days |
| Machine asleep / herdr closed | 16 h/day → 8 h of offline credit per night (cap) |
| Agents | 4 pane agents, 0–2 fledglings each, sometimes |
| Agent working time | 3.5 h/agent/day, in tasks of ~12 min (≈17 finishes/agent/day, 68/day in total) |
| Needs-you episodes | ~10/agent/day, about 3 min each; Rin opens the pane within 5 min in 60% of them |
| Active play | 12 sessions/day × 2 min (the first-ever session is 10 min) = 24 min/day |
| Hand speed | 1.5 taps/s on the Sheet while active; hits 80% of crease points, completes 60% of chains |
| Envelopes | opened at the start of each session; Sharp Crease opened right before tapping |
| Buying | greedy by payback at the start and end of each session |

---

## 7. Offline

- **Detection** (glue): each 1 s tick compares `now − lastTick`. A gap ≤ 90 s is caught up live; a gap > 90 s,
  or a load whose saved `lastTick` is older than 90 s, is an **offline segment** `t_off = min(gap, 8 h)`.
- **What accrues:** helpers and the workshop only, at a quarter pace (the "night shift"). Clicks, combos,
  envelopes, foil and kites do not.
  ```
  N24      = helpers seen working in the 24 h before the gap (at least 0)
  H_night  = ( B · (1 + s·Weff(N24)) + τ·c0·e·Weff(N24) ) · Mw ,   Weff(n) = n ≤ 5 ? n : 5·sqrt(n/5)
  F += 0.25 · H_night · t_off ;  R += same ;  every helper's c_i += t_off / Trest (clamped)
  ```
- **Frozen while away:** active boost timers keep their remaining time and are not consumed. Spawn timers for
  points, scraps, foil and kites are frozen too. Envelopes already in the tray stay.
- **Computation** is closed form (one multiplication), so catching up 8 h costs microseconds and fits any
  budget ([qjs Do 2]).
- **The "while you were away" card** (§3.7) appears for any absence ≥ 10 min, including a live one where the
  player didn't touch the game. It contains:
  - the duration, plus the cap notice if the absence was longer than 8 h;
  - folds gained, split into workshop and flock night shift;
  - cranes added to the string;
  - helpers fully rested;
  - envelopes waiting;
  - helpers needing you (with "Open ›");
  - up to 3 purchases now affordable.

  The live-absence variant also lists envelopes that arrived while the player was gone.

---

## 8. Settings

### 8.1 Calm mode (one switch; changes exactly these and nothing about earnings)

1. No `.loop` anywhere: needs-you blink, envelope bob, foil bob, next-point ring, flying-crane bob and coach
   ring become static. With no loops, the view is not redrawn ~30×/s ([gpui §9]).
2. Pinwheels do not `.spin`. The static pinwheel silhouette plus the word "Folding" carry the status.
3. No floating "+N" pops. The combo meter updates without its 120 ms transition, and the fuse is a static bar
   that shortens per second.
4. Crease points last twice as long. Paper Storm and Updraft spawn chains at half rate (the payout per point
   rises ×2, so value per second is unchanged).
5. Foil Cranes glide for 20 s instead of 10. Kites wait 12 s. Thousand Folds lasts 22 s.
6. The combo window is +50% (1.8 / 2.4 / 3.0 s).
7. Chain completion and the wish moment are a single 400 ms fade, with no rising or flying models.
8. The flying-crane band is hidden (the setting is remembered separately).
9. The away card shows totals only, without per-source rows.

### 8.2 Notifications (opt-in, at most 3 a day, never sound)

- The master switch is **off** by default. Each event has its own switch:
  1. **"Your thousand cranes are strung"**: once per run, when prestige becomes available.
  2. **"Your tray is full"**: once per day, the first time an envelope auto-opens because of overflow.
  3. **"A Foil Crane is on your desk"**: only if the panel is hidden or the window is inactive. Off by default
     even when the master switch is on.
  4. **"<Nick> has needed you for 15 min"**: once per blocked episode and only at ≥ 15 min, so it never
     duplicates herdr's own immediate toast. Off by default.
- **Rules (glue):**
  - `notify({title, body, level: "info", timeout: 6000, icon: "mods/creaseworks/art/toast-crane.svg", action})`.
  - The action is `{name: "layout.show", args: {id: "game-panel"}}`, or `{name: "pane.focus", args: {pane}}`
    for event 4.
  - Never `playSound` ([host §7]).
  - Nothing is sent while the panel is shown and the window is active.
  - **The cap is 3 per local day across all windows.** The counter `{day, used}` lives in `save.json`, so it is
    shared through the save.

### 8.3 Automation switches

There is one `Switch` per apprentice (A1–A5), plus three play switches that act like automations of the scene:
"Crease points", "Show flying cranes" and "Metronome while compact" (default off; with it on, A3 also taps the
mini sheet when the panel is hidden). Every switch is stored in `save.settings` and applies on the next engine
step.

---

## 9. Art direction

### 9.1 Style

Flat vector origami: each model is 2–4 flat facets with **no outlines** on the paper itself. One facet uses the
paper colour, one a shade layer (ink at 20–28% alpha), and the crease layer uses dashed lines. The only outlined
things are clickable targets (points, Foil Crane), which have a 1.5–2 px ink outline so they keep ≥ 3:1
non-text contrast. Corners are sharp, as paper is, and UI chrome uses herdr's radii.

**How colour is applied.** Almost every asset is **monochrome** and drawn with `svg()`, tinted by
`text_color` ([gpui §3]). Multi-tone art is 2–3 stacked monochrome layers (base, shade, lines). One asset set
therefore works in both appearances. Only the Foil Crane, the kite, the toast icon and the layout preview are
full colour (`image()`, drawn at ≤ 2× intrinsic size).

### 9.2 Palette (exact hex; picked by `settings().dark`; chrome text uses `theme()`)

| Token | Light ("Day Paper") | Dark ("Night Paper") | Use |
|---|---|---|---|
| `desk` | `#F3ECDF` | `#22202A` | desk gradient top |
| `deskEdge` | `#E4D8C3` | `#2E2B38` | desk gradient bottom |
| `paper` | `#FFFDF7` | `#F4EEDF` | the Sheet base |
| `shade` | `#2B2A3333` | `#00000047` | facet shading (8-digit) |
| `ink` | `#2B2A33` | `#F1EBDD` | numbers, pops, outlines |
| `inkMuted` | `#5F5869` | `#ABA4B8` | hints on the desk |
| `crease` | `#8C7B66` | `#A99A86` | dashed fold lines |
| `point` | `#FFFDF7` | `#3A3646` | crease-point fill |
| `foil` | `#C99A2E` (outlined in ink) | `#E3B84A` | foil, "In step", best-buy dot |
| `foilHi` | `#F2D27A` | `#FFE7A3` | foil highlight facet |
| washi 0 Vermilion | `#D9573B` | `#F0775A` | helper colours (identity) |
| washi 1 Saffron | `#E9A23B` | `#F2B65A` | |
| washi 2 Matcha | `#7FA05A` | `#9CC27A` | |
| washi 3 Indigo | `#3E5C9A` | `#7D9BE0` | |
| washi 4 Plum | `#8E4A7E` | `#C17FB3` | |
| washi 5 Sky | `#5AA7C8` | `#7CC6E3` | |
| washi 6 Peony | `#E07A9B` | `#F29BB8` | |
| washi 7 Kelp | `#3F7F6E` | `#63B39C` | |
| washi 8 Sand | `#C9A878` | `#D9BD92` | |
| washi 9 Slate | `#6E7787` | `#9AA3B5` | |

Colour word list (for nicknames): Vermilion, Saffron, Matcha, Indigo, Plum, Sky, Peony, Kelp, Sand, Slate.

**Contrast** (WCAG 2.x relative luminance, computed):

| Pair | Ratio | Requirement |
|---|---|---|
| `ink` on `desk`, light | **12.06:1** | text AAA |
| `inkMuted` on `desk`, light | **5.79:1** | small text AA |
| `ink` on `point`, light (point numbers) | **13.93:1** | AAA |
| `crease` on `desk`, light | **3.48:1** | graphics ≥ 3:1 |
| `ink` on `desk`, dark | **13.51:1** | AAA |
| `inkMuted` on `desk`, dark | **6.68:1** | AA |
| `crease` on `desk`, dark | **5.85:1** | |
| `foil` on `desk`, dark | **8.58:1** | |
| `foil` on `desk`, light | 2.19:1 | below 3:1 → always drawn with a 1.5 px `ink` outline, which gives 12.06:1 |
| Vermilion light / dark on its desk | 4.58 / 5.73 | identity tiles ≥ 3:1 |
| Indigo light / dark | 5.58 / 5.84 | |
| Slate light / dark | 3.84 / 6.33 | |

Washi colours never carry text. Helper identity is also carried by species, pattern and name. Status uses
herdr's theme keys, plus a silhouette (§5.1).

**Hex rules.** All colour literals are 6- or 8-digit hex. Alpha is appended only to our own 6-digit tokens or
to `theme()` keys proven 6-digit by a length check ([host §8]). `Background` colours are validated in our code,
because a bad one fails silently ([gpui §5]).

### 9.3 Asset list (`mods/creaseworks/art/`, all SVG unless noted; viewBox = size; monochrome = `fill="currentColor"`)

| File(s) | Size | Count | Kind |
|---|---|---|---|
| `sheet-{0..7}-base.svg`, `-shade.svg`, `-lines.svg` | 168×168 | 24 | mono layers (lines use `stroke-dasharray`) |
| `model-{crane,frog,fox,boat,swan,rabbit,fish,butterfly,star,owl,whale,turtle}.svg` + `-shade.svg` | 24×24 | 24 | mono layers (identity, flying band, chain pop at 40 px → also `model-*-48.svg` base only, 12) |
| `model-*-48.svg` | 48×48 | 12 | mono |
| `pattern-{dots,stripes,waves}.svg` | 28×28 | 3 | mono overlay (plain = none) |
| `status-{pinwheel,pennant,envelope,crescent,triangle}.svg` | 16×16 | 5 | mono |
| `envelope.svg`, `envelope-flap.svg` | 32×24 | 2 | mono layers |
| `seal-{bundle,sharp,updraft,foil}.svg` | 12×12 | 4 | mono |
| `foil-crane.svg` | 56×44 (drawn ≤ 112×88) | 1 | full colour, `image()`, gold facets + ink outline |
| `kite.svg`, `kite-tail.svg` | 40×48, 8×60 | 2 | kite full colour; tail mono |
| `scrap-{1,2,3}.svg` | 12×12 | 3 | mono |
| `ream.svg` | 32×24 | 1 | mono |
| `building-{mat,grove,vat,screen,loft,field,pinwheels,moon}.svg` | 32×32 | 8 | mono |
| `up-{folder,echo,hands,bases,wing,tempo,bench,softpaper,rhythm,seal,tray,foilsense,kitestring}.svg` | 24×24 | 13 | mono |
| `app-{opener,matkeeper,metronome,catcher,reel}.svg` | 24×24 | 5 | mono |
| `icon-fold.svg`, `icon-wish.svg` | 16×16 | 2 | mono (resource glyphs) |
| `garland-strand.svg` | 12×200 | 1 | mono (50 crane silhouettes) |
| `toast-crane.svg` | 18×18 | 1 | full colour (toast `image()`) |
| `layout-preview.png` | 216×124 | 1 | Settings card (shown ≈108×62) |
| repo `preview.png` | 1600×1000 | 1 | herdr.dev card (Playwright) |

Total: 103 SVGs + 2 PNGs. Every asset is produced by `tools/art/generate.mjs` (Node, deterministic, writes SVG
text from facet coordinate tables) with a contact sheet `tools/art/sheet.html` rendered by Playwright, on the
pattern of the win98 pipeline ([pat §7.6]). SVGs contain no `<text>`.

### 9.4 Motion using only native primitives

| Effect | Primitive |
|---|---|
| Working pinwheel | `svg("…status-pinwheel.svg").spin(900)` (450 In step) |
| Needs-you blink | `.loop("opacity", {from:0.55, to:1, period:1200})` |
| Envelope / foil / flying-crane bob | `.loop("top", {from:0, to:-2·zoom … -8·zoom, period:1200–1600})` (loop px are not zoom-scaled, so we multiply [gpui §9]) |
| Sheet press | `.spring("top", {response:120, damping:0.7})` on target change 0 ↔ 3 |
| Fold stages | swap of `svg()` layer paths per stage (re-render on click) |
| "+N" pops, crane lift, chain model pop | two-step `.transition("top"/"opacity", 600)` with a `timer.after(16)` re-render |
| Foil Crane glide | `.transition("left", {duration: 10000, easing:"linear"})` from −56 to desk width |
| Combo fuse, meters, charge clip, buy progress, string fill | `.transition("width"/"height", …)` on absolute px |
| Tab underline | `.transition("left", 160)` |
| Point expiry fade | `.transition("opacity", 2000)` |
| Crease lines, desk gradient, charge arcs | `window.paint_path` + `PathBuilder` (`dash_array`, `arc_to`), `Background.linear_gradient` |

There is no per-frame JS, no `rotate` and no z-index. Order is sibling order. Looping elements exist only while
something needs them, and calm mode removes all of them.

---

## 10. Balance target (asserted by the pacing simulator)

Time is **open time**: cumulative hours with herdr open and the game live, from the first launch. "Day d, h:mm"
means day d of the §6.6 profile (8 h open per day, followed by 8 h of offline credit per night).

The numbers come from a calibration sketch of these formulas (1 s steps, the §6.6 profile, greedy buying). The
real simulator (`tools/sim/pace.mjs`) runs **the real engine module** with scripted inputs and asserts every
row. It runs with 20 PRNG seeds and asserts the **median** inside the tolerance and **every seed** inside 1.5× the
tolerance.

### 10.1 Typical player milestones

| # | Milestone | Target | Tolerance (median) |
|---|---|---|---|
| T1 | first Folding Mat bought | 0:00:20 | 0:00:10 – 0:00:45 |
| T2 | first upgrade (Bone Folder I) | 0:01:10 | 0:00:40 – 0:02:30 |
| T3 | first crane folded by hand (8 taps) | 0:00:06 | ≤ 0:00:15 |
| T4 | first crease-point chain completed | 0:01:30 | ≤ 0:03:00 |
| T5 | Washi Vat (3rd building) | 0:04 | 0:02 – 0:10 |
| T6 | first envelope opened (first agent finish + next session) | 0:15 | ≤ 0:30 |
| T7 | first Foil Crane seen | 0:08 | 0:05 – 0:20 |
| T8 | Drying Screen (4th) | 0:50 | 0:30 – 1:20 |
| T9 | R ≥ 1M | 0:52 | 0:35 – 1:30 |
| T10 | Crane Loft (5th) | 0:55 | 0:40 – 1:45 |
| T11 | first apprentice affordable (Envelope Opener) | 1:30 | 0:50 – 2:30 |
| T12 | Kite Field (6th) | 2:50 | 2:00 – 4:00 |
| T13 | R ≥ 100M | 4:25 | 3:30 – 6:00 |
| T14 | end of day 1 (8:00): R | 8.5e8 | 4e8 – 1.6e9 |
| T15 | Pinwheel Garden (7th) | day 2, 0:15 (8:15) | 7:30 – 10:00 |
| T16 | end of day 2 (16:00): R | 7.7e9 | 4e9 – 1.4e10 |
| T17 | **first prestige available (1,000 cranes)** | **day 3, 4:10 (20:10)** | **18:00 – 22:00** |
| T18 | wishes at first availability | 10 | exactly 10 |
| T19 | Paper Moon (8th) | day 3 (21:30) | 19:00 – 26:00 (may come just after T17) |
| T20 | second prestige (≥ 10 more wishes, with 10 wishes owned) | 13 h open after the first wish | 10 – 17 h |

### 10.2 Shares of run folds for the typical player, first run

| Source | Target share | Tolerance |
|---|---|---|
| Hand (Sheet + chains + scraps + foil + kite) | 18% | 12 – 30% |
| Envelopes | 12% | 8 – 20% |
| Flock (staffing + taps + In step) | 20% | 14 – 32% |
| Workshop base `B` (live) | 30% | 22 – 42% |
| Offline night shift | 20% | 14 – 28% |

### 10.3 Other profiles (robustness rows)

| Profile (changes vs §6.6) | Assert first prestige |
|---|---|
| Never clicks (only opens envelopes in sessions) | 22:00 – 29:00 open (day 3 end – day 4) |
| Heavy clicker (3 taps/s, 24 sessions) | not before 17:00 open |
| 1 agent | 30:00 – 42:00 (day 4 end – day 6) |
| 2 agents | 24:00 – 33:00 |
| 12 agents | 10:00 – 16:00 (day 2) |
| 30 agents (at most 13 working at once) | **not before 7:00** (never in the first working day's morning) |
| 0 agents | ≤ 44:00 (by day 6) |
| Agents work 6 h/day | 15:00 – 22:00 |
| 4 sessions/day only | 23:00 – 32:00 |

### 10.4 Invariants (also asserted)

- No single purchase has a payback above 24 h of open time before T17. A wall like that would stop the
  typical player.
- Something new (building, tier, upgrade, apprentice or keepsake) becomes visible at least every 45 min of
  open time on day 1, every 2 h on day 2, and every 3 h on day 3.
- Envelopes never expire. Overflow converts them (at 50% for timed ones), so 0 envelopes are lost.
- Offline credit never exceeds `0.25 · H_night · 8 h` per gap, and a second gap without live time in between
  adds nothing more (anti clock-change).
- Clock going backwards (`now < lastTick`) yields 0 credit and resets `lastTick`.
- Click rate above 12/s adds nothing.

---

## 11. Technical shape (how the fun survives the platform)

### 11.1 Files

```
layouts/Creaseworks.json      keys.json      RECIPE.md      preview.png      LICENSE (MIT, Tyler Coles)
mods/creaseworks/
  mod.json   main.js (View, routes props().role → Panel | Ribbon)   jsconfig.json
  engine/  rules.js  economy.js  prng.js  format.js  identity.js  save-schema.js   ← pure, no herdr import
  glue/    live.js (globalThis hand-over, owner election)  herdr-io.js (agents/terminals → events)
           save.js (CAS, backup, recovery)  notify.js (3/day)  view-*.js
  art/     (§9.3)
tools/ mock-herdr/ (Node mock of the herdr module + element proxy)  qjs/ (QuickJS-ng wasm harness)
       shots/ (Playwright: every view, both themes, 0/1/4/12/34/64 helpers, whole windows)  sim/pace.mjs  art/
```

### 11.2 Pure engine

- **Interface:** `step(state, inputs) → {state, effects}`, `inputs = {now, dt, dayIndex, events[]}` (`click`,
  `point`, `buy`, `open`, `statuses`, `turns`, `toggle`…). No `Date.now`/`Math.random`; PRNG is xorshift32 in
  `state.rng`.
- **Data:** all maps are `Object.create(null)`, rebuilt from JSON into fresh ones ([qjs §4]); fuzz keys
  `__proto__`, `constructor`, `toString`.
- **Budget:** a step is O(helpers + events), well below the 500 ms task budget; render does no engine math
  ([qjs §2]).

### 11.3 Copies, owner, commands

- There are 2 copies (panel, ribbon) in one VM. `init` (never module top level) adopts or creates
  `globalThis[Symbol.for("creaseworks/live/v1")]`, a null-prototype object
  `{state, rev, owner, copies, saveText, pops}`.
- **Owner:** the first live copy is the owner and runs the only `cx.timer.every(1000)` tick and the saver. A
  copy re-elects when the owner's heartbeat (a `rev` bump each tick) is more than 3 s stale.
- **Rendering:** both copies render the live state; the owner notifies itself and pokes the other copy via a
  callback in `copies`, called only from a task.
- **Commands** (`nextCommand()`) are handled by the ribbon copy, which is always shown, and by the panel copy
  only if `layout()` says the ribbon is hidden. A command therefore never applies twice.

### 11.4 Save

- **File and backup:** `appHome()/data/creaseworks/save.json` (absolute path) is written with
  `writeTextFile(path, text, lastText)` every 10 s when something changed and at once after a purchase,
  prestige, settings change or envelope open. `save.bak.json` is written every 5 min with its own CAS
  ([life §6]).
- **Format:** `{v, rev, savedAt, writer, sum, state}`, where `sum` is FNV-1a of the state text. Load checks
  JSON, schema and `sum`. On failure the bad text is kept as `save.damaged-<n>.json`, the backup is loaded and
  the banner explains it (§3.8). If both files are bad, the game starts fresh and keeps both damaged copies.
- **CAS reject:** re-read, merge by `rev` (counters max, helper records per address by `lastSeen`), retry ≤ 3×, then banner.
- **Two windows share one save** (two app homes; Settings → "Use a shared save path" sets an absolute path):
  - A **lease** in the save, `{writer, until}`, renewed every 10 s for 30 s, makes one window the writer.
  - The other is a **follower**. It re-reads every 5 s, renders that state and sends its own inputs (clicks,
    opened envelopes, its agents' statuses and turns) through `data/creaseworks/inbox-<windowId>.json`, which
    the writer folds in.
  - The follower's agents therefore count as saved helpers. If the writer's lease expires, the follower takes
    over.
- **Hot reload:** no `close()`, `init` re-runs ([life §1.2]); it adopts the `globalThis` slot's live state and
  `saveText` as is (no rollback) and re-registers tick and saver. After a VM restart it loads from disk (≤ 10 s
  behind).
- **`herdr-app check`:** `if (checking())`, `init` renders a static demo, writes nothing, starts no timers ([life §5]).

### 11.5 Status input cost

The owner reads `agents()` and `terminals()` once per tick, and also on herdr's live refresh when the render
reads them. Renders use the engine's derived helper list, never raw host lists, so one render makes at most 2
host reads ([pat §4]).

### 11.6 Strings

The agent label is pre-cut to 64 code points by a grapheme-safe splitter: it keeps ZWJ, VS15/16, skin tones,
keycaps and regional-indicator pairs together. Native `.truncate()` does the rest. Tests use the 15-emoji list
from [pat §3].

### 11.7 Tooling hooks

Node mock of herdr (agents/terminals with `turn`/`parent`/`created_ms`, `run` and `notify` recorders, CAS file
I/O with injectable failures, `settings().dark`); QuickJS-ng wasm harness (real ES modules, frozen prototypes,
500 ms load / 50 ms render at 64 helpers); Playwright shots of every §3 view in light and dark at 0/1/4/12/34/64
helpers plus whole-window composites (expanded, compact).

---

## 12. Risks and open questions

| Risk | Mitigation |
|---|---|
| Clicking a mod block may move keyboard focus away from the terminal (not verified) | the game declares nothing focusable; to verify by hand in herdr. If focus does move, the Sheet runs `pane.focus` back to the last focused pane after `on_mouse_up` (we track `focused()`) |
| `state.top` inside `.active()` may not apply | the press uses `.spring("top")` driven by mouse down/up state instead |
| `turn` might reset when the core restarts | rebaseline on `created_ms` change or `turn < lastTurn` (§5.3) |
| Many loops at 64 helpers redraw a big tree 30×/s | loops only in the scene and on urgent chips; the roster uses static shapes except needs-you; calm mode has none |
| Day-3 target depends on agent habits | profile table §10.3 plus `φ` flock share keep 1–30 agents within 1–6 days |

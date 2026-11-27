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

**Mechanics (originality sweep, review r6, owner decision).** The first build's gilded crane was
Cookie Clicker's golden cookie: Lucky Fold paid `min(900·Rp, 0.15·bank) + 13·V` (Lucky!:
`min(15 % of the bank, 900 s of CpS) + 13`), cranes lived 13 s with 5–10 minute gaps (the golden
cookie's 13 s and 5–15 minutes), Paper Storm was ×7 (Frenzy) and named like Cookie Storm, and the
String was the cube root of lifetime folds (heavenly chips). These were replaced by Creaseworks' own
rules (§4.5 Crane's Gift from the rhythm and the folk at work; 11 s lives, `lo · (1 + 0.5·u)`
gaps of 340–510 s; Confetti ×6; §9 the 0.4 power), and the sweep of `content.js`, `economy.js`,
`clicking.js`, `envelopes.js`, `prestige.js` and `helpers.js` against Cookie Clicker, AdVenture
Capitalist, Clicker Heroes, Realm Grinder, Antimatter Dimensions, Egg, Inc., Kittens Game, Tap
Titans and NGU Idle changed three small numbers and checked the rest. A second review (r7) found
two more matches the sweep had kept, the 25-Wish perk and the workshop ladder's ×12 cost step, and
both were replaced (rows below):

| Checked | Verdict |
|---|---|
| Paper Stack base 15 (Cookie Clicker's Cursor costs 15) | changed to 12 |
| Crisp Corners 100 for hand ×2 (Cookie Clicker's first click upgrade: 100, ×2) | changed to 120 |
| Tier upgrades ×2 at 25 and 50 owned (AdVenture Capitalist's first ×2 milestones are 25 and 50) | changed to 24 and 48 (a quire, two quires); ×2 per tier and the 10 kept as the genre's doubling convention; costs ×20/×200/×4,000 match no game (Cookie Clicker ×10/×50/×500) |
| Cost growth 1.16 | kept: the genre's 1.07–1.15 convention (Cookie Clicker 1.15), not that number |
| Workshop ladder (r6: cost about ×12 a step from 180 to 6.5e9, output ×6) | changed (r7): a constant ×12 cost step is AdVenture Capitalist's (exactly ×12 from 60/720/8,640/103,680). The ladder now has no constant step: cost steps shrink as it climbs (×15, ×14, ×12.9, ×12.0, ×11.0, ×8.6, ×8.6 from the Bone Folder to the Kite Tower; bases 180 … 4.8e9) and output steps shrink with them (×7.3 down to ×4.3; outputs 0.3 … 60,000), so each workshop's payback is about twice the last one's (§7.2). Cookie Clicker's table (15/100/1,100/12,000 …, 0.1/1/8/47 …) is not matched either |
| Echo (clicks gain 3–40 % of `Rp`) | kept: "clicks gain a share of passive output" is a genre convention; Cookie Clicker's mice add 1 % each at 50,000 / 5e6 / 5e8 …, ours 3 % base and 6/10/18/28/40 % at 2,000 / 80,000 / 4e6 / 3e8 / 2e10 |
| Hand ×2 chain 1,500 / 40,000 / 1.2e6 / 4e7 / 1.5e9 / 6e10, names (fold techniques) | kept: no game's prices; "Thousandth Fold" is not Cookie Clicker's "Thousand fingers" (a different effect) and names the String's thousand |
| Rhythm, combo ×1.5 → ×3 at a 40 streak, In step, afterglow, figures every 8th fold ×5 | kept: Egg, Inc.'s running-chicken bonus and Clicker Heroes' Clickstorm are other rules with other numbers |
| Crease chains (2·Vc a node, 3·k·Vc finish), scraps, Fresh Ream, Paper Boat and Tailwind | kept: our own pickups |
| Envelopes (Bundle 55 %, Rush ×3 30 s, Chorus ×2 120 s, stacking, token-bucket units) and Flock Song ×3 60 s | kept: Cookie Clicker's boosts are ×7 77 s, ×777 13 s, ×666 6 s, ×1,111 10 s, ×15 60 s; none match |
| Helpers (`0.3·G + 0.04·Rw`, bench pace, rest, warm, thanks, fledglings) | kept: our own |
| Wishes `G = 1 + 0.05·W`, the gate `max(5, ceil(0.25·W))` | kept: 5 % a Wish matches no game (Cookie Clicker 1 % a level, AdVenture Capitalist angels 2 %, Clicker Heroes hero souls and Egg, Inc. soul eggs 10 %, Realm Grinder gems 2 %, Kittens Game paragon 1 %) |
| Perks by Wishes held | the r6 sweep wrongly kept them all. The 25-Wish perk "start each run with 10 Paper Stacks and 5 Bone Folders" was Cookie Clicker's heavenly upgrades Starter kit (10 Cursors) and Starter kitchen (5 Grandmas) on our first two workshops; changed (r7) to **Spare parts**, which keeps a tenth (rounded down) of the last run's Paper Stacks, Bone Folders and Scissor Stands, so it grows with the run you had. The others (10: keep Crisp Corners and Mail Sorter; 50: cranes 20 % sooner; 100: automations stay bought; 250: envelopes stack to 15) were checked against Cookie Clicker's heavenly upgrades, AdVenture Capitalist's angel upgrades and Realm Grinder's reincarnation perks and match none |
| Away 25 / 35 / 45 % up to the brief's 8 h | kept: Cookie Clicker 5 %, AdVenture Capitalist 100 %; not theirs |
| Automations (Mail Sorter, Thrifty Fox, Boost Keeper, Crease Helper) | kept: autobuyers are a convention; ours have their own rules |
| Crane outcomes and Confetti (r7 review) | **open, for the owner**: the three outcomes still have the golden cookie's three shapes (an instant payout, a hand-hit boost, a whole-income boost), and Confetti ×6 (×9 with Gale Charm, +3 a charm, 15 s from a crane and 12 s from an envelope, a 30 s cap, chains every 4 s) is Paper Storm ×7 → ×10 lowered by one with its durations kept. No number is a known game's, so it was left as it is; the owner decides whether it reads as a cosmetic change and wants a different boost |
| Names "gilded", "Lucky", "Storm", "Frenzy" | "Lucky Fold" became Crane's Gift and "Paper Storm" Confetti (the internal ids stay `storm`, and an old save's `lucky` crane pays the Gift); "gilded" is the brief's golden special, a common word (Clicker Heroes' gilds are a hero upgrade, not a clickable); "Frenzy" is not used |
| mulberry32 PRNG, FNV-1a ids | public algorithms, not game content |
| Pattern book (issue #2): crease fields, nine diagrams, fold pieces (§4.7) | ours. Joining neighbouring dots on a 3 × 3 grid looks like a phone's unlock screen, which is not a game. The closest game is Niantic's Ingress, whose glyph hacking reads shapes drawn as lines between the fixed points of an 11-point grid, each glyph with its own name, in timed sequences, with a speed bonus. Ours differs in each of those: a 3 × 3 grid with neighbour-only steps (a glyph joins any two points), a shape matched up to turn, mirror and direction (a glyph has one fixed orientation), one shape at a time rather than a timed sequence, and no speed bonus. Keep it that way: the field has no timing rule beyond its life. Two well-known games are built on a neighbour trace across a dot grid and are the closest priors. In Dots and Two Dots (Playdots) you join neighbouring same-colour dots in orthogonal steps, and closing a loop (a 2 × 2 square is the smallest, the same shape as our Napkin) clears every dot of that colour; there is no shape vocabulary, no turn or mirror matching, no book, and the loop is a scoring move, not a named diagram. Ours steps in eight directions on one colour, never clears dots, and names nine shapes matched up to turn, mirror and direction. In The Witness (Thekla) you draw a line from a large start circle along a lattice to an exit, and each panel is a constraint puzzle whose rules the line must satisfy; nothing is recognised up to turn or mirror and there is no set of named shapes to collect. Ours has no constraints, no exit and no right answer per field: any of nine shapes counts. The book card marks a diagram's start with a 6 px octagon ring round its dot, not a large filled start circle on a lattice. Games that read free-hand shapes (gesture spells, brush strokes) recognise strokes; none of these is a clicker. The rule set (every dot a fold, loose traces stay for another try, one-shot effects on a 3-minute rest, found / learned / mastered at 1 / 4 / 12) matches no game we checked. The diagrams are plain grid paths with our own names (Ridge, Gull, Napkin, Lozenge, Stair, Sail, Switchback, Hem, Coil); the fold art is flat and abstract and copies no published origami base or model; "pattern book" is a common phrase. Re-check the names in the pre-publish search |

---

## 2. Placement in the window, and keys

### 2.1 Decision: a right panel that folds to a 64 px rail, plus a 30 px ribbon

The layout is the shipped `main` layout (share §9) with **every id kept** and two nodes added:

```
┌──────────┬────────────────────────────────────────────────────────────────┐
│ sidebar  │ tabs (42)                                                      │
│ 268      ├─────────────────────────────────────────────┬──────────────────┤
│ spaces   │ work-body (row, padding 8, gap 8)           │ cw-panel         │
│ agents   │  main (terminal panes, min 80)   [panel     │ weight 0.39, ≥64 │
│          │                                  hidden]    │ the game         │
│          ├─────────────────────────────────────────────┴──────────────────┤
│          │ cw-ribbon 30 (always shown): every helper's status, count, ✉  │
│          ├────────────────────────────────────────────────────────────────┤
│          │ status (28)                                                    │
└──────────┴────────────────────────────────────────────────────────────────┘
```

* **cw-panel** (props `{role:"panel"}`): the full game, sized by weight beside the terminals (322 px
  at 1440×900, 226 at 1100×700; ARCHITECTURE B15). It folds to a **64 px rail** with one key
  (`run("layout.resize", {id:"cw-panel", weight})`: weight 0.001 is the rail, held at the node's
  `min: 64`; `layout.resize` takes `id`, `px?`, `weight?` in `src/commands.rs` and in
  `tools/mock/commands.js`). Both states are weights, never `{px}`: herdr never shrinks a `{px}`
  node, so it would be pushed off-screen by a narrow window or zoom.
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
| Expanded (weight 0.39: 322 px at 1440, 226 at 1100) | panel + 8 gap | 30 px | **825 px** (~100 cols) | **581 px** |
| Expanded, Files open (Files 367 / 257) | panel 217 / 152 + 8 | 30 px | 556 px | 390 px |
| Rail (64) | 72 px | 30 px | 1083 px | 743 px |
| Panel hidden (palette, or the narrow chip's Hide) | 0 | 30 px | 1155 px | 815 px |

Terminal height at 1440×900 is 900 − 42 − 28 − 30 − 16 = **784 px**; at 1100×700, **584 px**.

Terminals stay usable because: (1) the game never takes keyboard focus (no `focusable` in
`mod.json`, no `track_focus`, no `Input` except the optional shared-save path field in Settings,
which takes focus only while the player types in it); (2) clicking the game never focuses a pane,
except the deliberate "needs you" cue; (3) every node beside `main` is a weight that shrinks to its
min first, so at zoom 1 the terminals keep at least 360 px in every state from 1100 px wide up,
and `main` has `"min": 80` (low enough that 1100×700 at zoom 1.5 with Files open still fits the
rail; ARCHITECTURE B15), so a drag can never squeeze terminals below 80 px; (4) no sounds, no `setAgentOrder`, `setWindowTitle` or `setBadge`
(host-api Don't).

### 2.3 Narrow windows (1100×700 and below)

The ribbon copy measures the work-column width `Wr` with `on_size_change` (divided by
`settings().zoom`); the panel copy measures its own width `Wp`. Both are written to the handover
slot. Estimated terminal width:

```
mainEst = Wr − 16 − (Wp + 8) − (filesShown ? filesPx + 8 : 0)
filesShown = layout() reports node "panel" not hidden
filesPx    = its px size if layout() gives it; for the shipped {weight} Files column
             commands.js filesEstimate(info, Wp) = Wp × filesWeight / panelWeight, held to 160 … 900
```

* If the panel is expanded (wider than 72 px) and `mainEst < 600`, or it is tight (under 200: drawn
  as a rail in its whole column), the ribbon shows a one-time hint chip (11 px,
  `T.popover`, 1 px `T.border`): "Terminals are narrow: fold Creaseworks?" with **[Fold]**
  (runs the fold command) and **[Not now]**. When the ribbon has no room for the question
  (zoom 1.5) it shows the two buttons alone, and the first reads **[Fold panel]**, since a bare
  "Fold" reads as the game's own action (review r3-23). It appears at most once per Files-panel opening and
  once per day otherwise (`ui.narrowHintDay` in the save). The game never resizes on its own.
* With the Files panel open at 1100 px wide the panel is 152 px (Narrow, drawn as the rail) and
  the terminals 390 px, so the hint appears; folding gives the terminals 443 px (Files 292).
* Where folding would gain nothing (the panel folded, or unfolded within 24 px of its 64 px rail:
  zoom 1.5 with Files open, 76 design px at 1100×700) and the terminals still have under 360 design
  px (`HIDE_BELOW`; 196 at 1100×700 zoom 1.5 with Files open), the chip asks instead "Terminals
  are narrow: hide Creaseworks?" with **[Hide]** (**[Hide panel]** without the question) and
  **[Not now]** (review r6-07). Hide runs `layout.hide {id:"cw-panel"}` and flashes "Panel hidden:
  the ribbon's fold button brings it back"; the ribbon's fold button shows it again, unfolded.
* Any answer (Fold, Hide or Not now) holds for that Files opening, else for the day, so a fold
  that still leaves the terminals narrow never turns straight into the Hide offer.
* Panel height `H` = window height − 42 − 28 − 30 − 16. When `H < 640` (1100×700 gives 584) the
  panel uses the **short** variant: mat 304×184 with a 96 px Sheet (§3.2).
* Screenshots of whole windows at **1440×900 and 1100×700**, each expanded, folded and hidden,
  are part of `npm run shots` (§15.3).

### 2.4 Width states of the panel (measured `Wp`)

| State | `Wp` | What renders |
|---|---|---|
| Rail | < 140 (default 64) | §3.9 |
| Narrow | 140–279 | mat at 100 % width × 184; Flock tiles 4 across (dense); Shop shows icons only. Below 200 (the mat's minimum width) the unfolded panel is drawn as the rail, with no mat (no pieces spawn), and its chevron folds it to 64 (1100×700 with Files open: 152) |
| Standard | 280–399 (320 as designed; 322 at 1440×900) | every view as drawn in §3 |
| Wide | ≥ 400 | mat 260 tall; Flock up to 8 columns; Shop rows add effect and payback columns |

Which state a window gets by default (shipped weights, ARCHITECTURE B15): 1100×700 **Narrow**
(226; 152 with Files open), 1440×900 **Standard** (322; Narrow 217 with Files open), 1920×1080
**Wide** (456), 2560×1440 **Wide** (636; no maximum: a capped weight node would leave an empty
strip). At zoom 1.5 the panel is the first to give way (1100×700: drawn as the rail), then Files
down to its 160 min; past about zoom 1.8 at 1100 px Files, not the panel, is what herdr clips (§2.5).

**Folded, tight or full** (ARCHITECTURE B16) comes from the layout, not from `Wp` alone: the panel
is **folded** when its weight is at most 0.01 of main's or it measures 72 px or less (a dragged
rail), **tight** when unfolded but under 200 (drawn as the rail in its column, with a fold button),
else **full**. Its weight is remembered only while it measures 200 px or more. Anything that asks
for the full panel (a ribbon mark, tally, save chip or Welcome pill, a rail pip, `select`, the
counts chip) unfolds a folded or tight panel to the remembered weight; when it already has that
weight and the window still leaves it too little room it flashes "Too narrow: drag the panel's
edge or widen the window" ("Too narrow: close Files, drag the panel's edge or widen the window"
while Files is open) and resizes nothing.

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
        {"id": "main", "type": "block", "min": 80, "content": {"tab": "active", "pane": {
          "gap": 8, "radius": 10, "background": "background", "lone": true,
          "border": {"width": 1, "color": "border"}, "focus": {"width": 1, "color": "accent"},
          "header": {"content": {"mod": "pane"}, "height": 30, "position": "top", "reveal": "always"}}}},
        {"id": "cw-panel", "type": "block", "size": {"weight": 0.39}, "min": 64,
         "radius": 10, "border": {"width": 1, "color": "border"}, "background": "chrome",
         "content": {"mod": "creaseworks", "props": {"role": "panel"}}},
        {"id": "panel", "type": "column", "hidden": true, "size": {"weight": 0.66}, "min": 160,
         "children": [{"id": "panel-body", "type": "stack", "active": "files", "children": [
           {"id": "files", "type": "block", "content": {"mod": "files"}},
           {"id": "changes", "type": "block", "content": {"mod": "changes"}}]}]}]},
      {"id": "cw-ribbon", "type": "block", "size": {"px": 30}, "background": "chrome",
       "content": {"mod": "creaseworks", "props": {"role": "ribbon"}}},
      {"id": "status", "type": "block", "size": {"px": 28}, "content": {"mod": "workspace-status"}}]}
  ]
}
```

`cw-panel` sits between `main` and the Files `panel` in `work-body`, so herdr's clipping row
cuts Files first, never the game (r2-15); it is never under `panel-body` (the tabs mod hides that,
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
| `ctrl-shift-g` | `creaseworks.fold` | panel ↔ rail (`layout.resize` to the rail weight 0.001, held at 64 px, or to the last unfolded weight, default 0.39). If the panel is hidden, `layout.show {id:"cw-panel"}` first |
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
px by us (gpui §9). `T.x` is herdr `theme()` key `x`; `S.x` is a scene token (§13.2) picked for
the theme showing (`artDark`, §13.2; not `settings().dark`); `Hue[i]` is a helper identity colour (§13.2). Type: `text_size(n)`, weights
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
│ TABS 32: Flock 30 | Shop | String | Book §4.7 | (← Back)  12/600        │
├────────────────────────────────────────────────────────────────────────┤
│ CONTENT flex_1 min_h 0 overflow_y_scrollbar (Flock / Shop / String /   │
│ Book / Settings)                                                       │
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
2. **Confetti flecks** (only during Confetti; internal id `storm`): sparse 6×2.5 px paper flecks,
   one per 34×30 cell of a staggered grid, jittered and turned by a fixed hash of the cell (the
   same flecks every frame), in four hues: `S.sheet`, `S.node`, and the light identity hues coral
   and sky (the mat is dark green in both appearances). Four paint_path fills (one `Background`
   each) inside `div#cw-storm` with `.loop("opacity", {from: 0.55, to: 0.9, period: 1200})`; the
   flecks are `ui/mat.js` confettiFlecks (review r6-09: no storm stripes under the Confetti name).
   It is drawn before the play pieces so it paints under them.
3. **Crease line** of a finished chain: paint_path stroke 2 px `S.sheet`, `dash_array([6,4])`
   through the node centres in `%`; fades with `.transition("opacity", 600)` to 0 over the next
   data tick, removed after 3 s.
4. **The Sheet**: `div#cw-sheet`, 112×112 at (96, 58) (short: 96×96 at (104, 42)),
   `cursor_pointer()`, `on_mouse_down("left", …)` (gives the pop position; `e.local_position?.x ?? 56`
   guards the first paint, gpui §7), press feedback `.active(s => s.opacity(0.88))`. Inside: two
   stacked `svg()` layers `sheet/<f>-base.svg` tinted `S.sheet` and `sheet/<f>-shade.svg` tinted
   `S.sheetShade`. Under it, 8 fold ticks 6×2 px (done ticks `S.sheet`, others `S.crease`).
   While a **crease field** is up (§4.7) its trace line and nine dots are drawn right after the
   Sheet and its ticks: the one thing that sits on the Sheet. Each dot takes the Sheet's own
   press and stops propagation, so one press is one action; between dots the Sheet folds as
   usual. The Sheet keeps drawing its fold frame under them.
5. **Crease nodes**: `div#cw-node-<chain>-<i>` 28×28 hit area, inside a 22×22 `rounded_full`
   disc `S.sheet` with 2 px border `S.node` and the number 11/600 `S.ink`. The node due next has a
   3 px ring (static, no loop). Expiry: `.transition("opacity", 2000)` to 0.4 in its last 2 s.
6. **Scrap**: `svg("…/scene/scrap.svg")` 16 px tinted `S.sheet` in a 28×28 hit `div#cw-scrap-<id>`.
   A **fold piece** (§4.7) is drawn the same way: its two scene layers (`fold-<diagram>-base`,
   `-shade`) 20 px tinted `S.sheet` / `S.sheetShade` in a 28×28 hit `div#cw-fold-<id>`, never
   moving.
7. **Fresh Ream** (once a day, §4.5): `svg(scene/ream.svg)` 28×20 tinted `S.sheet` in a 36×28
   hit `div#cw-ream`, fixed at the mat's top-left play slot.
8. **Gilded crane**: three layers `crane-gilded-{outline,body,shade}.svg` tinted `S.goldInk`,
   `S.gold`, `S.goldShade`, in a 48×36 hit `div#cw-crane`. Motion §13.5.
9. **Paper Boat** (curio): `boat-{hull,sail}.svg` tinted `S.sheet`/`S.sheetShade` in a 48×30 hit
   `div#cw-boat`, gliding in **its own lane**: the bottom strip of the play field, just above the
   bottom band (y 170–200), never under the tray's envelopes or the streak meter. That strip is
   also the bottom row of spawn slots (40–49, hit boxes y 168.8–196.8), so the boat is drawn
   **right after the Sheet**, under the nodes, scraps, ream and crane: a piece over it stays
   whole and keeps its clicks (each stops propagation), and the boat, 48 px wide against 28 px
   pieces, is still caught around it (calm parks it under slots 48–49; a piece there is caught
   first, then the boat). Where the Sheet reaches into the lane (the short mat, 14 px under the
   Sheet) it dips just below the Sheet while it crosses the Sheet's columns: its lower 16 px pass
   under the bottom band, whose envelopes, `+N` and label stay whole and on top (the band has no
   handler, so the boat takes clicks between them and in the 14 px strip). The dip starts one
   data tick before the boat reaches the Sheet's columns and ends one tick after it leaves them,
   and `top` eases with `left` over the tick, so the eased box never touches the Sheet's corners
   and never jumps. The list order here is the design order, not the paint order (review r6-06).
10. **Needs-you chips** (top band): height 22, `rounded(11)`, `px(8)`, background `T.popover`,
    1 px border `S.sheet` (separates the chip from the mat in dark themes, where popover vs mat is
    1.21:1), `status/needs.svg` 12 px in the guarded status colour, name 11/600 `T.foreground`.
    Up to 4 chips, then `+n`. Click opens the helper (§5.6).
11. **Tray** (bottom band): envelopes 28×20 hit `div#cw-env-<helperId>`, layers
    `scene/envelope-{body,flap}.svg` tinted `S.sheet` and `S.sheetShade`, a 12 px **seal** at the
    top right showing the type (§6.1) tinted `S.ink` on the paper, and the stack count `×n` in
    11/600 `S.ink` when n ≥ 2: the vm's `label`, one decimal below 10 and never floored ("×2",
    "×2.8", "×12"; units are 64ths of a share, review r5-15). A count longer than two graphemes
    takes the envelope's lower half under an 8 px seal (review r8-13); a short one sits left of the 12 px seal. Oldest first, at most 6 drawn, then `+n` (11/600 `S.onMat`).
12. **Streak meter**: track 96×6 `S.grid`, fill `S.node`, `.transition("width", 150)`; label
    `×1.4` 11/600 `S.onMat`. While **In step** a 12 px note glyph `ui/step.svg` and the word
    "In step" (11/600 `S.onMat`) sit right of it.
13. **Floating numbers** `+1.2K`, 12/600 `S.onMat`, at most 5 alive (§13.5).

Spawn slots: a 10×5 grid of slots over the play field (y 28–200, each 30.4×34.4), minus the six
slots that overlap the Sheet and the ream slot; the engine PRNG picks one. Nothing on a slot
overlaps the Sheet, so hit tests are unambiguous (gpui §7); top pieces still stop propagation.
The one written exception is a crease field's nine dots (§4.7), which lie on the Sheet by design:
each is a 28×28 box inside the Sheet, at least 4 px from the next, and handles the press itself.

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
- **Status badge** 18×18 at the top right (−4, −4): a disc in the status disc colour (§5.2:
  `T.popover`, or on win98 `T.input`) with a 1 px `T.border` ring, holding the 12 px status
  glyph in the guarded status colour (§5.2).
- **Fledgling flag** (when any of its fledglings needs you, review r3-17): a badge-size disc at
  the top left, 2 px inside the tile's left edge (level with the badge, clear of the left
  neighbour's badge), with the needs-you pennant and a 1 px ring in the guarded needs-you
  colour. Clicking it opens the first waiting fledgling (§5.6); the tooltip counts them. In a
  virtual list (§5.5 item 8) the parent's row takes the dashed edge and a pennant with the
  count, and the row click opens that fledgling.
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

**Dense tile (≥ 21 helpers, a panel under 280 px wide, or the "dense" setting): 40×44**, gap 4, 7 columns at 320. Glyph 22,
badge 16 (glyph 12), no name (tooltip has it), envelope marker 12, pips 4 px, rest bar 2 px.
30 helpers = 5 rows × 48 = 240 px; 64 helpers = 10 rows.

**Order.** Setting "Roster order": **Urgency groups** (default): fixed group order Needs you,
Finished, Working, Resting; inside "Needs you" the longest-waiting first; in every other group
**join order**, so tiles never shuffle while the player looks — a tile moves only when its group
changes. **Workspace order**: one list in `agents()` order (space → tab → pane, matching herdr's
sidebar), grouped headers hidden, statuses on badges only.

**Groups fold** (`ui.folded` in localStorage of the panel copy); a folded group is one 24 px row
"● Working 9". Resting folds automatically above 12 members until the player unfolds it, except
while one of its parents has a fledgling waiting for input (review r4-12): the cue is never hidden
in a group the game folded. A group the player folded keeps a needs-you flag and count on its
header row ("2 fledglings in here need you"), which opens the first of them. A parent tile whose
fledgling waits carries a flag at its top left (level with the status badge); its figure, name
and pips step down below the flag so nothing overlaps the sprite (review r4-14). A faded tile
(Elsewhere, 50 %) never fades its name below 4.5:1 on the tile or its hover fill (review r4-15).

**Album.** Helpers whose agent has gone: 28 px rows (glyph 16, name, "left 3 d ago", lifetime
folds). They never produce. A returning agent with the same `(address, created_ms)` rejoins with
its history, including its envelope-unit budgets (`unitAt`, `kidUnitAt`), its last finish and
when it started waiting (`lastFinishAt`, `blockedAt`): leaving and coming back in the same
terminal (a one-shot agent run in a loop) never refills a budget (§6.1, review r4-10), and a wait
begun before it left still earns its thanks. Only compaction forgets them (a compact record
rejoins with fresh budgets, like a new terminal). An archive entry (§5.1, after 10,000 newer Album helpers) is one row named by its
helper count ("1,204 helpers"), with when they left as a range from its newest to its oldest
helper ("left 34–63 d ago") and their summed folds; the header
counts every helper. With the Album open, a roster change rebuilds only the rows that moved
(review r3-02: the whole list used to be re-sorted and re-formatted in the tick, 430–510 ms at
20,000 Album helpers in the wasm harness).

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
│ [icon 28]  Glue Pot  ×17            13/600 T.foreground  •  [ 474K ]    │
│            +15/s each · 255/s total   11 T.muted           in 2m 10s 11  │
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
│ 25 · Keep a tenth of your three cheapest workshops between runs  │
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
  filled share rounded down to whole cranes (`ui/string.js` `strandFill`), so the clip edge
  falls in a gap and never cuts a crane (review r3-20), `.transition("height", 600)`. The strand
  is 12 px wide on the 304 px card (`strandSize`: narrower cards scale it down, never under 6 px,
  with the height and crane pitch in step). That is 40 elements, never 1,000 (fun.md).
* **Gate mark** (review r5-12): while the wish opens before the String is full (the later-wish gate of §9
  sits inside it: W 10–39 opens at 500 of 1,000 cranes), a 2 px `S.node` bar, `rounded(1)`, as
  tall as the strands plus 4 px, stands in the 3 px gap before the strand the gate falls on
  (`string.gateStrand`, 1–19; `div#cw-string-gate`, an 8 px hover box with the tooltip "The wish
  opens at 500 cranes"). The line under the String then names both gains ("At 500: +5 Wishes ·
  at 1,000: +10", "Ready: …" once open). A gate at the String's end draws no mark.
* **Away pot note** (review r5-13): with an uncollected away pot, the confirm card says "First
  collects your +28.0K folds from while you were away." (`string.potNote`), because the wish
  credits the pot first.
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
4. **Play**: "Helpers gather" (on), "Crease nodes appear" (on; help line "Numbered nodes and
   crease fields": off, it turns the Pattern book's crease fields off too, and the Book tab's line
   says so, §4.7), "Floating numbers" (on; off and disabled in calm mode).
5. **Roster**: order (Urgency groups | Workspace order); density (Auto: dense at ≥ 21 tiles, and
   always in the narrow panel, 140–279 px, review r3-19 | Always | Never).
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
**non-blocking**: the mat around and the tabs still work; the card has its own close ✕, which
collects the folds and closes the card (tooltip "Close and collect the folds", review r3-13).

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
that footer line. Unless the panel is shown at full width (a folded, hidden or tight-rail panel
has no away card), the ribbon shows a pill "Welcome back +4.81M" (11/600 on `T.popover`;
review r3-14); clicking it unfolds the panel (`creaseworks.fold`) and the card waits.
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
   helper individually up to **240** (`RAIL_PIPS`); scrolls vertically (`overflow_y_scrollbar`)
   only if taller than the room (at H = 584 about 108 pips fit). Click: needs-you/finished pips
   open the pane; others unfold the panel with that tile selected. **Past 240 helpers** (review
   r8-10: one pip is 3 elements, ≈ 0.065 ms of a render in the wasm harness, and at 1,000 agents
   every rail render passed herdr's 50 ms) needs-you and finished helpers keep their pips (needs-you
   first, at most 240 in all) and the rest are tally rows under the grid, a status glyph and a
   count (11/600): "+60" more need you (click: the longest waiting), "+30" more finished, working,
   resting, and Elsewhere (cloud glyph, 70 %). Every helper is a pip or counted in a tally (at
   1,000 agents with 500 fledglings the rail renders in ≈ 20 ms; `test/qjs/rail-budget.test.mjs`).
7. Gilded crane icon 24 (only while one is live; clickable, counts as catching it).
8. Unfold chevron 24 (`creaseworks.fold`); a tight (unfolded) rail shows a fold button there
   instead. A flash shows in full at 120 px and wider; a narrower rail shows its short form (the
   words before the colon, "Too narrow") at any width, and while a "Too narrow" flash shows the
   chevron is ringed in `T.accent`.

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
  present. When the middle does not fit beside the blocks' full 118 and 100 px, the blocks lend it
  the room their contents leave unused (`blockNeeds`: the left block's wider line, the right
  block's envelope count and mini Sheet) before the narrow hint is dropped (review r6-08: at
  1100×700 zoom 1.5, ribbon 464 px, the hint now stays with 13 marks). Whenever everything fits
  the blocks keep 118 and 100.
* **Right block 100 px**: `✉ n` envelope count (opens the oldest), the **mini Sheet** `[◇]` 26×26
  (shown only while the panel is folded or hidden), and `[⇔]` (`creaseworks.fold`).
* **Middle: one mark per helper, never capped.** Pip area `w = W − 16 − 118 − 100 − 16`. Density:

| Level | When | Mark | Capacity |
|---|---|---|---|
| A chips | `n × 22 ≤ w` | 20×20 chip `rounded(5)` `T.raised`, status glyph 12 guarded colour, 2 px bottom bar in `Hue[hue]`, needs-you chips 1 px dashed border | `floor(w/22)` |
| B pips | otherwise, `n ≤ 2·floor(w/14)` | 12 px status glyph, 14 px pitch, **two rows** (y 2 and 16) | `2·floor(w/14)` |
| C tallies | only beyond B | the tally chips `● 37` `◗ 21` (glyph + count 11/600) are reserved first; needs-you, then finished, stay individual pips while two rows hold them; past that finished fold into a `✓ +N` tally, then needs-you into a dashed `▲ +N` tally that opens the Needs you group (review r4-07): every helper is a pip or counted | unlimited |

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
rhythm r      : +1 per credited hand hit if the gap since the previous one ≤ g;
                max(1, r − 10) if the gap is over g but ≤ 4 s (a short pause); else r = 1
                g = 1.0 s; 1.4 s with Steady Rhythm
combo         = 1 + comboMax · min(r, 40) / 40      comboMax 0.5 → 1.0 (Long Streak) → 2.0 (Endless Streak)
boost         = 6 during Confetti (9 with Gale Charm), else 3 during Rush (4 with Brisk Charm), else 1
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
  frozen while away. While any is banked and the player is not In step, the footer shows a static
  chip "Afterglow ×1.25 · 12m" (`streak.afterglowText`; the same in calm mode) and the streak
  meter's tooltip ends with it (review r5-14); In step replaces the chip. A 2½-minute session at 1.25 hits/s banks about 16 min, so short check-ins
  keep paying while the player codes (fit.md's tension, without punishing absence).
* The streak resets lazily: the next hit (or tick) after a gap > g sets `r` to 1 or 0. No timer.
* **A short pause keeps most of the streak** (review r8-03): a gap over g but no more than 4 s
  (`K.slipMs`) costs 10 beats (`K.slipBeats`; `r − 10`, at least 1) instead of the whole streak,
  and the meter shows the reduced streak during the pause; after 4 s it shows 0 and the next hit
  starts again at 1. In step still needs the last hit within g, so any pause leaves it at once. A
  full streak of 40 comes back In step after one stumble (30), so buying something or opening an
  envelope mid-session costs a few seconds of rebuilding, not the 20 s from 1 to 25, while
  stopping to work still ends the streak. Before, any gap over g reset `r` to 1, and the day-3
  first wish held only for a hand on a perfect, never-pausing beat (BALANCE §11).

### 4.4 Crease nodes (chains)

* A chain spawns every **20 s of active time** (12 s with Quick Creases); every 4 s during a
  Confetti. At most one chain on the mat (two during Confetti). Setting "Crease nodes appear"
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
* With the **Crease Field** curio, every 5th chain arrives as a **crease field** on the Sheet
  instead (§4.7). Numbered chains keep every rule above; their slots are still picked by the PRNG.

### 4.5 Pickups and special clickables

| Thing | Spawns | Lives | Pays |
|---|---|---|---|
| **Scrap** | every 45 active s | 12 s (24 calm) | `max(30·Rp, 50·V) · scrapMult` (scrapMult 2 with Scrap Basket) |
| **Fresh Ream** (daily welcome) | first active moment of each local day, from the second day ever | until clicked or the day ends | `max(300·Rp, 100·V)` |
| **Gilded crane** (golden) | first at 390 active s; then every `lo · (1 + 0.5·u)` active s with `lo` 340 (340–510 s; Crane Bait 240: 240–360; Crane Song 170: 170–255; `lo` ×0.8 with the 50-Wish perk), `u` from the PRNG | 11 s (18 Slow Wings; ×2 calm) | outcome table below |
| **Paper Boat** (limited time, Harbour Ribbon curio) | every `1800 + 900·u` active s | 20 s (40 calm), sails in its lane just above the bottom band | **Tailwind**: the next 3 envelopes opened within 10 min pay ×2, plus `120·Rp` at once |
| **Envelope** | helper finishes (§6) | until opened; cashed in once its helper's Album record is compacted (§6.1) | §6 |
| **Fold piece** (Pattern book, §4.7) | a traced diagram whose effect is ready, at most one live | 15 s (30 calm) | `1 · Vc` and that diagram's effect |

Gilded crane outcomes (engine PRNG):

| Outcome | Chance | Effect |
|---|---|---|
| Crane's Gift | 40 % | `25 · max(r, 4) · V + 90 · Hs0`: folded back from your rhythm and the folk at work |
| Confetti | 35 % | hand hits ×6 (×9 Gale Charm) for 15 s; chains every 4 s |
| Flock Song | 25 % | every working helper ×3 for 60 s |

**Crane's Gift** (review r6, originality): the crane is folded back from what the player and the
flock are doing at that moment, never from the bank. Every beat of the rhythm `r` the player sees
at the catch (§4.2) is worth 25 hand folds (`V`, no combo or boost), with a floor of 4 beats, so a
full rhythm of 40 is a **thousand** hand folds, the String's number; the folk at work add 90 s of
their gathering `Hs0` (boost-free, 0 while "Helpers gather" is off), so a crane caught while
agents work pays more than one caught at an empty bench. Catching it in step pays about ten
times a cold catch, which keeps the crane a clicking reward. The crane click is not a hand hit
(it does not move the rhythm). A crane saved as `lucky` by an older version pays the Gift.
(It replaced "Lucky Fold", `min(900·Rp, 0.15·bank) + 13·V` with 13 s lives, 300–600 s gaps and a
×7 storm, which was Cookie Clicker's golden cookie; see §1 "Mechanics".)

Cranes and boats only spawn during active time (fit.md: golden targets only while the player is
present), so the player never misses one while coding. A missed one leaves silently; no
notification, no penalty.

### 4.6 Determinism

Every spawn time, slot, outcome and envelope type comes from the engine's seeded PRNG
(mulberry32, state in the save) and the engine's active-time counters. The glue only passes the
wall time, `visible`/`active`/`matShown` flags, hand-hit timestamps and the local day key.
Crease fields (§4.7) use no draw at all: when one comes is a counter, its dots are fixed, and the
shape is whatever the player traced. A fold piece's slot is a keyed draw like a scrap's.

### 4.7 Crease fields and the Pattern book

GitHub issue #2. Late in a run the beat is learned and numbered chains are routine. The Pattern
book gives the late game something to learn and choose: now and then a chain arrives as a
**crease field**, nine dots on the Sheet; the player joins them into a shape, and a shape that is
one of nine **diagrams** fills a page of the book and leaves a **fold piece** on the mat that does
one small thing. The shape comes from the player's hand, never from where the PRNG puts nodes.
Numbered chains (§4.4) are unchanged, and `pickSlots` is untouched.

**Why the shape is drawn on the Sheet, not on spawn slots.** At the 1100×700 default the panel is
Narrow (226 px; mat 210 wide, short). `ui/mat.js matGeometry` squeezes the three slot columns on
each side of the Sheet to 11.6 px apart and the short mat's rows to 24.8 px, both under the 28 px
hit box, so no two neighbouring slots can be read or clicked apart there (measured with
`matGeometry` and `slotPos` at widths 226 and 320, short and standard). A shape laid out on slots
would be unreadable at the size most players see. The Sheet is never squeezed: it is 96 px (short
mat and Narrow) or 112 px (Standard and Wide), so a 3 × 3 grid on it has a 32 or 37.3 px pitch,
and its 28 px hit boxes are 4 or 9.3 px apart.

**Unlock.** A new curio, **Crease Field** (`crease-field`, 5e6, needs Grand Crease; BALANCE §12.7): "every 5th
chain is a crease field on the Sheet". Like every curio it is cleared by a wish and bought again
each run. Buying it the first time opens the Pattern book (§3.1 tabs, "The Book tab" below) for
good: the book, its finds and its tiers are kept across every wish, like the garlands. P1 buys it
on day 2 of the first run (BALANCE §12), the stretch the issue is about; later runs reach it
sooner because `G` grows.

**When a field comes** (engine, no draw):

* `spawn.fieldIn` counts primary chains down. At each primary chain-in, when `fieldIn` is 1 it
  places a field and sets `fieldIn` to `K.fieldEvery` (5); otherwise it places a numbered chain
  and takes 1 off. Buying Crease Field sets it to 1, so the next chain is a field; without the
  curio it is `null` and nothing changes. With Quick Creases that is about one field an active
  minute, about 28 on a P1 day.
* Only the primary `chain` key. Confetti's 4 s chains (`chain2` and the primary during Confetti)
  are always numbered and do not count down, so Confetti never floods the Sheet. "Crease nodes
  appear" off (§8) turns fields off too.
* A field takes the chain's place. While it is up, a primary chain that falls due waits and is
  tried again every active second (`K.fieldWaitMs`, 1 s), so a numbered chain never shares the mat
  with a field outside Confetti, and a slow trace never costs a chain. The wait never runs past
  `K.fieldLifeMs` (16 s) of the field's mat-shown time in any mode: in calm mode, where the field
  stays up to 32 s, the waiting chain comes beside it from then on, so a calm player who leaves a
  field alone loses no more chains than anyone else ("earnings unchanged", §11.1). While a field is
  still up, a `fieldIn` of 1 (a Hem fold) keeps its turn for the chain after.
* Life: `K.fieldLifeMs` = 16 s of mat-shown time (32 s in calm mode, like nodes); the clock pauses
  while the mat is hidden. The rail's and ribbon's mini Sheet show no field.
* The Crease Helper never touches a field. Its row says so: "Only your own hands fill the book."

**The field.** Nine dots in a 3 × 3 grid on the Sheet, numbered `i = row · 3 + col`. Dot centres
are Sheet-local `sheet · (2·col + 1) / 6` by `sheet · (2·row + 1) / 6`: 16 / 48 / 80 on the 96 px
Sheet, 18.7 / 56 / 93.3 on the 112 px Sheet. Each dot is a 28×28 hit `div#cw-dot-<fieldId>-<i>`
drawn right after the Sheet and its ticks (§3.2 item 4). It handles the Sheet's own
`on_mouse_down("left", …)` and calls `cx.stop_propagation()`, so one press is one action: a dot
click, never also a Sheet click. Between dots the press reaches the Sheet and folds it as usual.

**Every dot click is a Sheet fold first.** It is a credited hand hit (80 ms cap, rhythm, combo,
boosts), advances the frame, and pays what that fold pays (`Vc`, or `5 · Vc` and a figure on the
wrap) to the `sheet` source. So the figure loop never stalls while a field is up, and clicking the
dots at random loses nothing against clicking a plain Sheet. A dot click whose field has gone
(it expired, or the click was merged in late from another window) is a plain Sheet fold.

**Tracing.** The rules fit the book's one help line: *"Join neighbouring dots. Click the last dot
again to set, or end on the first to close. Any turn or mirror counts."*

1. **Start** on any dot but the centre. The centre never starts a trace, so a hand that keeps the
   beat on the middle of the Sheet only folds.
2. **Step** to an unused neighbour of the last dot. The eight around it count, diagonals too.
3. **Set** (finish) the trace in one of four ways:
   * click the last dot again once the trace has 3 or more dots: an open shape;
   * click the first dot when it is next to the last and the trace has 3 or more dots: a closed
     shape;
   * step onto a dot with no unused neighbour where the first dot is not next to it either:
     nothing more can happen, so it sets at once, open;
   * the field's life runs out with 3 or more dots traced: it sets, open. Slow hands never lose
     what they drew, and there is no timing rule beyond the field's life.
4. **Any other dot click** (a dot that is not next to the last, a used dot, the last dot with
   fewer than 3) is only its fold. Nothing ever tears.

**Match or loose.** A set trace goes to the pure engine function `classifyTrace(path, closed)`. It
turns the path into its string of steps in eight directions, takes the smallest string over the 8
symmetries of the square, both directions and, for a closed shape, every starting dot (at most 144
strings of up to 9 characters, microseconds in QuickJS), prefixes `o:` or `c:`, and looks it up in
`PATTERNS[].canon` (literal strings in `content.js`; a test rebuilds them from each diagram's
dots). Where the shape sits, how it is turned or mirrored, and which way it was traced never
matter. Every diagram fits in 3 × 3 and has a tracing that starts off the centre, so every field
can make every diagram.

* **Match**: pays `K.matchPerNode · k · Vc` (3.5 per node of the chain it replaces: 24.5 `Vc` at
  k = 7) whatever the diagram, to a new source `pattern` (`Vc` of the setting click; at the life's
  end, `Vc` at that moment, its combo from the rhythm the player sees then), plus
  `K.firstFindPerDot · n · Vc` (10 per dot) the first time that diagram is ever found. The trace
  counts in the book, the field ends, and a fold piece may land (below). A field then pays what
  the numbered chain it replaces pays above its folds: a k = 7 chain is 7 node hits and `35 · Vc`,
  24.5 `Vc` above the folds those hits would have made (1.5 `Vc` a fold with the figure's share),
  while every dot click is itself a fold. The pay does not grow with the dots: the field (one
  every 5th chain) is the scarce thing, not the hand's hits, so a pay per dot (it was `4 · n · Vc`,
  12 `Vc` for Ridge to 36 for Coil) made the largest diagram the only paying pick and six of the
  nine pay less than the chain. The new value is variety, the effects and the book, not a
  multiplier.
* **Loose** (it matches nothing): nothing more is paid (its dots were folds), the trace clears and
  the field stays up for another try for the rest of its life. Only a match or the end of its
  life ends a field.

**The nine diagrams** (book order; ids are part of the save format). Coordinates are `(col, row)`
of one tracing, its start first; any turn, mirror, position or direction of it counts. Every name,
fold and hint is ours; the shapes are plain grid paths, and no diagram copies an origami book's
base or model (§1 "Mechanics").

| # | Diagram (`id`) | Dots | Shape | Fold piece it leaves | Effect when the fold piece is clicked | Book hint while hidden |
|---|---|---|---|---|---|---|
| 1 | **Ridge** (`ridge`) | 3, open | three in a straight line: `(0,0)(1,0)(2,0)`, or corner to corner `(0,0)(1,1)(2,2)` (two canons) | Ridge pleat: a paper strip with one raised ridge | **Steady**: your next short pause (over the rhythm gap, up to 4 s) costs no beats instead of 10. One charge (`hand.steady`), a static "Ridge · steady" chip in the boost bar until used (tooltip "Ridge: your next pause of up to 4 s keeps your rhythm"). Effect text "One pause of up to 4 s keeps your rhythm", short "Rhythm kept" | none: drawn in full from the start, the book's worked example |
| 2 | **Gull** (`gull`) | 3, open | a shallow V: `(0,0)(1,1)(2,0)` | Paper gull: two wings meeting in a flat V, one wing shaded | **Pull**: the next gilded crane comes up to 20 active s sooner, never less than 5 s away; at most once per crane (`spawn.gullFor`), so cranes come at most about 10 % more often. While this crane gap is already pulled a Gull match drops no fold piece (the chip says "Gull · pull used", the card's status "pull used"), and a Gull fold that pulls nothing (the crane under 5 s away) starts no rest | "Down, then up: a bird far off" |
| 3 | **Napkin** (`napkin`) | 4, closed | a small square: `(0,0)(1,0)(1,1)(0,1)` | Folded napkin: a square with a triangular shade half | **Glow**: banks 90 s of afterglow (§4.3; the 20 min cap holds). Earned by the hand, like all afterglow; nothing to do with agent tasks or how fast anyone answers | "Four sides, back home" |
| 4 | **Lozenge** (`lozenge`) | 4, closed | a diamond round the centre: `(1,0)(2,1)(1,2)(0,1)` | Lozenge tile: a diamond with one crease across its middle, the lower facet shaded (larger than the Sheet's frame-3 diamond, which is creased top to bottom with its right half shaded; the silhouette test compares every fold piece with the Sheet's eight frames) | **Finish**: the Sheet jumps to frame 7, so its next fold completes a figure (`5 · Vc`, a figure on the shelf). Effect text "Your next click on the Sheet finishes it", short "Sheet finish" (the player never sees the word "figure") | "Edge to edge, round the middle" |
| 5 | **Stair** (`stair`) | 5, open | a staircase: `(0,0)(1,0)(1,1)(2,1)(2,2)` | Stair pleat: three steps seen from the side, treads and risers alternating | **Lift**: rhythm +6 beats (cap 40), on top of the click's own beat. Effect text "Your rhythm meter jumps up by 15 %" (6 of the meter's 40), short "Rhythm up": the player sees a fill bar, never a beat count | "Across, down, across, down" |
| 6 | **Sail** (`sail`) | 6, closed | a right triangle with legs of two: `(0,0)(0,1)(0,2)(1,2)(2,2)(1,1)` | Paper sail: a triangle on a short mast stick | **Fair wind**: scraps and gilded cranes that appear in the next 60 active s stay 50 % longer (catch chance only, like calm's longer lives; payouts unchanged); ones already on the mat keep their life, so the text says "New scraps and cranes stay longer for 60 s", short "Longer stays" | "Down the side, along the foot, up the slope" |
| 7 | **Switchback** (`switchback`) | 7, open | a Z: `(0,0)(1,0)(2,0)(1,1)(0,2)(1,2)(2,2)` | Accordion fan: four panels, sheet and shade alternating | **Hurry**: the next chain (or field) comes within 2 active s (`nextChainAt = min(nextChainAt, activeMs + 2000)`); while a chain is still live it waits for that one to clear, tried again every active second (`spawn.hurry`), so it is never pushed a full interval later | "Top, slash, bottom" |
| 8 | **Hem** (`hem`) | 8, closed | the whole outer ring: `(0,0)(1,0)(2,0)(2,1)(2,2)(1,2)(0,2)(0,1)` | Paper frame: four mitred strips round an empty middle | **Margin**: the next chain is a crease field again (`fieldIn = 1`). Neutral in value; it lets a practised hand keep tracing | "Walk the edge and come home" |
| 9 | **Coil** (`coil`) | 9, open | a spiral into the centre: `(0,0)(1,0)(2,0)(2,1)(2,2)(1,2)(0,2)(0,1)(1,1)`. It ends in the centre: click it again to set (closing it back to the start makes a loose 9-dot loop) | Paper spring: a flat spiral band with a shade edge | **Wind-up**: hand hits ×2 for 10 s while no Rush or Confetti runs. It never stacks: Rush ×3 and Confetti ×6 take over while they run, so a Coil clicked under one starts its 10 s when they end (`boosts.coilEnd = max(t, stormEnd, rushEnd) + 10 s`) and shows meanwhile as a static chip "Coil ×2 · waits" (tooltip "Coil: hand hits ×2 for 10 s once Rush ends"); then a countdown chip "Coil ×2", tooltip "Coil: hand hits ×2 · 7 s left". Like Rush and Confetti its end moves with an absence, a skipped stretch and a clock-back (§4.3), so it is never used up away nor stretched by a clock moved back | "Walk the edge, then turn in" |

Hem and Coil share their route and differ only in the ending: close it, or turn in. Ridge and Gull
are the two 3-dot shapes, Napkin and Lozenge the two 4-dot loops; a test checks that no two
diagrams share a canon and that every other 3-dot shape is loose.

**Fold pieces: a new kind of fold on the mat.** When a match's diagram is **ready** (its effect
is not resting) and no fold piece is on the mat, one lands on a free slot (`pickSlots`, keyed by
`seq` like a scrap; `freeSlots` leaves its slot out). It is the diagram's own little fold (§3.2
item 6), static, with the tooltip of its one name, the fold's (`PATTERNS[].fold`), and its
effect: "Paper gull · the next crane comes up to 20 s sooner" (the book card's fold tile says
"Fold piece: Paper gull"). It lives
`K.foldLifeMs` = 15 s of mat-shown time (30 s in calm) and pauses with the mat. Clicking it is a
hand hit that pays `K.foldPay · Vc` (1) to a new source `fold`, fires the effect, puts that diagram
to **rest** for `K.patternRestMs` = 3 active minutes (`book.found[id].ready = spawn.activeMs +
180000`), and hops the fold onto the shelf (`p:<id>` in `hand.figures`, same 12 cap, drawn with
its 16 px base layer). A fold piece that expires unclicked starts no rest, so the next match of
that diagram can drop it again. A match of a resting diagram, or one made while a fold piece is
up, pays and counts in full but drops nothing. The pay is the same whichever diagram is traced
(`matchPerNode · k · Vc`, above),
so the rest turns the late game into a choice: rotate through the diagrams to keep the effects
coming.

**Tiers.** Each diagram is **found** at 1 hand trace, **learned** at 4 and **mastered** at 12
(`K.bookLearn`, `K.bookMaster`; counts stop at 9,999). Tiers change looks only, never pay: the
set crease line is dashed `S.ink` while found, solid `S.ink` once learned, and solid `S.goldInk`
(10.91 / 8.87 on paper) over a 4 px `S.node` edge once mastered; the book shows three pips. The
book counts 27 marks (9 diagrams × 3 tiers).

**Reading the field.** Each dot state has its own shape; colour is only a second cue. Ink on
paper measures 12.86 (light) and 10.11 (dark), ink on the Sheet's shade facets 10.10 and 7.41.
Every fold frame past the first leaves some of the 3 × 3 grid over the mat, where ink alone is
about 2.4:1, so every mark sits on a disc of `S.sheet` (paper on the mat: 5.93 / 8.12; on the
paper it vanishes) and every line on an edge 2 px wider (the shots showed rings and lines lost on
the green on frames 2–7; `ui/mat.js DOT_LOOK`).

| Dot | Drawn as | Tooltip |
|---|---|---|
| free | 12 px paper disc, 2 px `S.ink` ring | "Crease field" |
| centre, before a trace starts | 8 px paper disc, 1.5 px `S.ink` ring (smaller: not a start) | "Start on any other dot" |
| a valid next step | 20 px paper disc, 2 px `S.ink` ring (static; the "due" language of nodes) | "Next" |
| used | filled 10 px `S.ink` dot on a 14 px paper disc; used dots joined by a 2 px `S.ink` line on a 4 px `S.sheet` edge | |
| last | filled 10 px dot in a 3 px `S.node` ring | "Click again to set" from 3 dots (a trace of 1 or 2 dots cannot set, so its last dot has no tooltip) |
| first, when it can close | filled 10 px dot in an 18 px `S.ink` ring on paper | "Click to close" |

In its last 2 s the field's dots fade to 0.4 (a 2 s transition; calm: static 0.4), as nodes do.
While a field is up and no boost chip shows, the boost bar's muted hint says it in words: "Crease
field · next to find: Napkin" (or "· Coil ready" once all nine are found). On a set:

* **Match**: for `K.fieldResultMs` (3 s) the line shows in its tier style (each on its edge:
  `S.sheet` under ink, `S.node` under gold), closed shapes drawn closed, and a one-line chip
  over the Sheet's top edge (the first-run chip's style: 11/600 `T.foreground` on `T.popover`;
  its foot at the top of the top row's largest ring, 20 px tall on the short mat, painted under
  the play pieces so a fold piece landing beside it stays whole) names it in words: "Gull",
  "Gull · new diagram", "Gull · learned", "Gull · mastered", "Gull · rests 1:40" (no fold
  dropped) or "Gull · pull used" (no fold dropped: its pull is spent for this crane).
* **Loose**: the line turns dashed 1 px `S.ink` at 0.5 (on a solid 3 px paper edge at 0.6) and the chip reads "Loose crease", or, when
  the trace is the start of a found diagram or of the next one to find, "Loose · Napkin needs 1
  more". A closed diagram traced in full but set open (its last dot clicked again, or the life ran
  out, with the last dot next to the first) comes first: "Loose · Napkin: end on the first dot"
  (so the full Hem ring set open names Hem, not Coil). A hidden diagram is never named, so the chip never gives a shape away. The dots clear
  for another try.
* **The first field ever** shows a static chip, "Join neighbouring dots. Click the last one again
  to set.", until the first match (`ui.hints.field`). It wraps to two lines above the Sheet and
  is painted last, and never reaches into the top band (its needs-you chips and the shelf). On the
  short mat two lines do not fit between the top band and the Sheet's top row (20 px; the margins
  beside the 96 px Sheet are 57 px), so it shows its one-line form there, "Join dots, click the
  last again"; the dots' own looks and tooltips ("Next", "Click again to set") and the book's
  help line carry the rest.

The setting click's pop (§13.5) shows the fold and the match together; there is no other number.

**The Book tab.** A fourth tab, **Book**, after String: `Flock | Shop | String | Book`. It
appears once `book.open` is set and stays. A 6 px `T.accent` dot on the tab (static, no pulse;
tooltip "Pattern book · new") marks earned since the tab was last opened (`ui.hints.book`
holds the marks seen). With four tabs, the Narrow state (140–279 px; 226 at 1100×700) sets every
tab to `px(6)` and draws Book as its 14 px `book` interface glyph with the tooltip "Pattern book",
following the Shop's icons-only Narrow rule; below 220 px the Flock tab also drops its count,
which the header's counts chip already shows. A UI test measures the row in Chromium with
"Flock 999": 204.3 of 226 px, and 178.2 of 200 below 220 (R19). Settings' "← Back" can return to the Book. The content is built only while the tab
shows, so the Flock tab and the 64-agent render check are unaffected.

At 320 px (Standard; 1440×900, content about 304 × 424):

```
┌ Pattern book 13/600 ─────────────────────── 5 / 9 · 14 / 27 marks 11 ┐
│ Next field in 3 chains · next to find: Napkin              11 T.muted │
│ Join neighbouring dots on the Sheet's crease field. Click the last   │  help, 11 T.muted,
│ dot again to set, or end on the first to close. Any turn or mirror   │  until 3 are found
│ counts.                                                              │
│ ┌ card 96×132 ──┐ ┌───────────────┐ ┌───────────────┐                 │
│ │  ┌ 56×56 ──┐  │ │  ┌─────────┐  │ │  ┌─────────┐  │  3 columns,     │
│ │  │ ●──●──● │  │ │  │ ●     ● │  │ │  │ ·  ·  · │  │  gaps 8 px      │
│ │  │ ·  ·  · │  │ │  │   ●     │  │ │  │ ·  ·  · │  │                 │
│ │  │ ·  ·  · │  │ │  │ ·  ·  · │  │ │  │ ·  ·  · │  │                 │
│ │  └─────────┘  │ │  └─────────┘  │ │  └─────────┘  │                 │
│ │ Ridge [fold]  │ │ Gull [fold]   │ │ ???           │  12/600         │
│ │ ◆◇◇ ×2 ready  │ │ ◆◆◇ ×7 1:40   │ │ 6 dots·closed │  11             │
│ │ One pause of  │ │ The next crane│ │ Down the side,│  11 T.muted,    │
│ │ up to 4 s     │ │ comes up to 20│ │ along the foot│  3 lines        │
│ └───────────────┘ └───────────────┘ └───────────────┘                 │
│  … 3 rows of 3, scrolling in the content area                        │
└──────────────────────────────────────────────────────────────────────┘
```

At 1100×700 (Narrow, 226 px; content about 210 × 272): the header keeps "Pattern book" and
"5 / 9"; the line under it wraps to two lines; the help shows until 3 diagrams are found and then
moves into the header's tooltip (12 px `info` icon); cards are 2 columns of 101 × 116–158 (5 rows,
scrolling, about two rows in view) and show the short effect label ("Crane sooner") instead of the
two-line effect, whose full text is in the card's tooltip. Wide (≥ 400 px) gives 4 columns.

Each card (`div#cw-book-<id>`, `T.raised`, `rounded(6)`, 6 px padding; as tall as its text, and
every card in a row as tall as the row's tallest: 144 px for a found card at Standard, 158 for
the next one with its three-line hint, 116 for a found card at Narrow; `ui/book.js cardLines`):

* A paper square (`S.sheet`, `rounded(4)`), 56 × 56 where the card has room and smaller where
  the column beside it would be narrower than the 28 px pips (`ui/book.js drawSize`: card width −
  12 − 4 − 28, so 52 at Standard 320 px, 38 at 280, 46 at Wide 400; the drawing is in percent and
  scales, and the top row keeps its 56 px height, so card heights never change), with the
  diagram drawn from the same
  `PATTERNS[].dots` the classifier's canons are tested against, so the picture is the shape by
  construction: one fill paint_path for the nine dots (used ones 6 px octagons, others 3 px
  diamonds: half the path commands, measured in QuickJS) and one 2 px `S.ink` stroke path for the
  line (closed shapes closed, the start dot ringed). Two paint_paths a card, 18 for the book.
* Beside it, right-aligned: the fold's 16 px piece on a 20 px `S.mat` tile (its base `S.sheet`,
  shade `S.sheetShade`, as on the mat; tooltip "Fold piece: Paper gull", the one name the fold
  piece's mat tooltip uses too), the three tier pips
  (`status/pip-work` filled and `status/pip-rest` hollow diamonds, 8 px: a shape cue) and the
  count "×7" (11/600).
* Under it the name 12/600 `T.foreground` (clipped to 12 graphemes), then the status in 11
  `T.foreground`: "ready", "rests 1:40", "fold on the mat" or, for Gull while this crane gap is
  already pulled, "pull used".
* The effect, up to 3 lines of 11 `T.muted` (clipped to 44 graphemes) at Standard and Wide, the
  short label (16) at Narrow and on any card under 96 px wide (panels of 280–319 and 400–439 px,
  where three lines of 70–80 px cut most effects short; `ui/book.js SHORT_BELOW`). The tooltip has the full effect, the count and the tier thresholds
  said as thresholds: "Your rhythm meter jumps up by 15 % · traced 7 · learned at 4, mastered at 12".
  Every number in an effect is joined to its unit by a no-break space (U+00A0), so no card width
  wraps "20 / s" (tested).
* **States.** Found: all of the above. **Next to find** (the first unfound diagram in book order):
  its drawing at 0.6 opacity with a dashed line, its name, "4 dots · closed", its short effect and
  its hint, the hint in italic so it never reads on from the short effect as one sentence. Every
  other unfound diagram: the nine dots only, "???", its dot count and open or closed, and its
  hint (italic). Ridge is drawn in full from the start. The book always shows one shape to
  aim for, so no player has to guess; finding the others first is optional sport.

Under the header, the line reads one of, checked in this order: "Buy Crease Field (Curios) to
bring fields back this run" whenever the curio is not owned this run (after a wish, all nine
found or not); "Crease nodes are off (Settings → Play): no fields come" while that switch is off
(§8); "All nine found · next mastery: Hem 9 / 12" ("All nine mastered" at the end); "A
field is on the Sheet · next to find: Napkin"; "Next chain is a field · next to find: Napkin";
"Next field in 3 chains · next to find: Napkin".

**Calm mode** (§11.1): presentation only; every formula, value, chance and spawn is the same (P12
within ±3 %).

* Nothing moves: dots, rings, the line, the chips, the fold piece and the book are static in every
  mode, so fields add no `.loop()` or `.spin()` (loop budget: 0 in steady state, 0 in calm, and
  nothing new during events).
* No transition over 150 ms: the line, the result chip and the fold piece appear and go by
  snapping; the last-2 s fade is a static 0.4.
* Fields and fold pieces live twice as long (32 s and 30 s): catch chance only, as for nodes.
* Tracing has no timing rule: a slow, careful trace is as good as a fast one, and a trace still in
  progress sets with full pay at the end of the field's life.
* Effect sizes, Wind-up's 10 s and the 3-minute rests are earnings rules and stay as they are; the
  Coil chip snaps its bar width each data tick, as boost chips do in calm (r4-13).
* A result chip can stay up to one 5 s calm re-render bucket past its 3 s; that is harmless.
* No floating numbers. Every cue is a shape and a word (ring sizes, filled dots, the double ring,
  the chip's text), never colour alone.

**Notifications: none.** A field only comes during active play, with the mat shown and the hand
on it, and leaves quietly like a missed chain; a fold piece is on the mat the player is looking
at; book progress waits in the tab's dot. Nothing here is worth one of the 3 daily toasts
(§11.2), and no save notice is ever outranked.

**What the save stores** (state version 2; ARCHITECTURE B17): `book = { open, found: MAP<id,
{ n, at, ready }> }` (times traced, first found wall ms, active ms when its effect may drop
again), kept across wishes; in `spawn`, `fieldIn`, the live `field` (`{ id, born, path }`), the
live `fold` (`{ id, kind, slot, born }`), `lastField` (the 3 s result), `gullFor` and `windUntil`;
`hand.steady`; `boosts.coilEnd`; `p:<id>` shelf entries; the sources `pattern` and `fold`; the
hints `ui.hints.field` and `ui.hints.book`; and `crease-field` in `bought`. All of it is under
1 KiB, inside `K.saveBytesRest`. The save file format stays 5 (the packed encoding is unchanged);
an older build reads a version-2 state as newer, read-only with the banner (§12.1), never silently.

**Art** (flat, two layers like the boat): in the scene folder, `fold-<diagram>-base.svg` and
`fold-<diagram>-shade.svg` for each of the nine diagram ids (18 files, viewBox 24, drawn at 20 on
the mat and 16 on the shelf and in the book), and in the interface folder `book.svg` (16, the tab
icon). Each passes the SVG checker, the theme-true art tests in both scene halves and the 16 px
silhouette test against the scrap, ream, crane, boat and species sprites. They join the §13.3
table (with their full paths), and the views `field`, `field-calm`, `fold`, `book` and
`book-narrow` join §15.3, in the commits that add the files and the views: the art tests require
every art path DESIGN names to exist, and the view tests read the §15.3 list.

**Constants** (`K`, BALANCE §12.2 knob 8 once it joins §8): `fieldEvery` 5, `fieldWaitMs` 1000,
`fieldLifeMs` 16000, `fieldResultMs` 3000, `matchPerNode` 3.5, `firstFindPerDot` 10, `foldLifeMs`
15000, `foldPay` 1, `patternRestMs` 180000, `bookLearn` 4, `bookMaster` 12, `bookCountMax` 9999,
`gullPullMs` 20000, `gullMinMs` 5000, `napkinGlowMs` 90000, `lozengeFrame` 7, `stairBeats` 6,
`windMs` 60000, `windLife` 1.5, `hurryMs` 2000, `coilMs` 10000, `coilMult` 2. Crease Field's cost
(5e6) is in §7.3.

### 4.8 Why clicking stays meaningful the whole way

1. **Echo** puts 3–40 % of the passive rate into every click, so a click never shrinks to nothing.
2. **Rhythm** raises clicks to ×1.5 / ×2 / ×3, and **In step** multiplies the whole flock ×1.5–2
   while the player keeps the beat; **afterglow** carries ×1.25–1.5 into the coding time after.
3. **Chains** are ordered skill payouts (35·Vc for a full k = 7 chain every 12 s).
4. **Boosts need hands**: Rush and Confetti multiply only hand hits; agents earn them, the player
   spends them (and chooses when, §6.2).
5. **Crease fields and the Pattern book** (§4.7) carry it into the late game, when the beat and
   the chains have become routine: the hand draws the shape, so the skill is a repertoire of nine
   diagrams traced cleanly within a field's life, and because each diagram's effect rests for 3
   active minutes while every diagram pays the same, the player keeps choosing which one to trace
   next. The book fills by hand only and is kept across wishes; it adds variety and choice, not a
   multiplier (a field pays about what a chain pays per hit; BALANCE §12 caps what it may add).
6. Measured in the calibration prototype (BALANCE.md): every session after the first 10 minutes
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
  `created_ms` is treated as 0). A pane agent with no live `terminals()` entry is left out, and its
  sub-agents wait with it (review r6-01): herdr builds `agents()` from its pane model without
  checking liveness, so without this it joined as a phantom helper `addr#0` and sent the real one
  to the Album. Maps are `Map`s or `Object.create(null)`.
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
  present helper keeps its id. A terminal that is already present always keeps the id it holds,
  plain or salted, even after the holder of its plain id leaves, so its name, stats and envelope
  never move mid-session. A salted helper that leaves keeps its `salt` (k) in its Album record
  (such records are never compacted), so when its agent returns it finds its own record first,
  whatever became of its plain id: held by a gone helper, by a present one, or by no record at
  all (a fledgling that held it folded into its parent, review r7-10). Every salt 1–16 is probed,
  not only up to the first free one, since a smaller salt's record can have left the save too. An Album record keeps no address, but it keeps a 16-bit
  **terminal key** (`key`, a second FNV-1a of `"key#" + address + "#" + created_ms`, upper 16 bits;
  review r3-18): a terminal rejoins a gone record under its plain or salted id only when the keys
  match, so a new terminal whose plain id clashes with a gone helper's record takes a salted id
  instead of taking that record over. Each terminal resolves to the same id on every observation
  and no present agent is ever lost. The residual risk is in §17 (R6). (fit.md's `homeId:` prefix was
  rejected because it would credit a shared terminal twice; judge 2.)
* **Look from the hash h**: species `SPECIES[h % 12]`; hue `(h >>> 4) % 8`; name
  `NAMES[((h >>> 8) % 16) · 12 + (h >>> 12) % 12]`, the pairs `A + B` with
  A = `Mi Ko Pi Ta Su No Ri Ha Yu Fe Lo Bi Ka Mo Ze Wu`, B = `na to b ki ri mo sa ku ro n li po`
  in row-major order (short **ASCII** names: Mina, Koto, Pib, Tari, Yuro, Fen, Lopo…). A pair that
  spells a slur, a sexualised or vulgar slang word, a deity's or a well-known character's name is
  never given (`NAME_SKIP`, review r2-28, two rounds, and r7-15: Feto, Haku, Han, Haro, Kaki, Kali,
  Kapo, Kato, Kon, Koro, Loki, Loli, Misa, Miku, Mob, Momo, Mona, Moro, Nob, Pipo, Pito, Riki, Riku,
  Rin, Rito, Sub, Suki, Taki, Tali, Yuna, Yuri, Zemo, Zeri, Zero): it takes the next pair in that
  order that is not skipped, so a remap can never land on a skipped pair (the first round remapped
  Haku to Haro), and 158 distinct names remain, none on more than 4 of the 192 slots.
  `content.js` holds `NAMES` written out and a test rebuilds it from A, B and the skip list. A
  helper or Album record named before the skip list (an older save) is renamed to its look name
  the next time it is observed or its Album record is pruned or loaded. On a clash among present
  helpers a new helper takes the smallest free number:
  the bare name, then " 2", " 3"… (ASCII); a helper returning from the Album keeps its name unless
  a present helper now holds it, when it too takes the smallest free number.
* **Every agent is a saved helper.** No cap, no daily limit, no unsaved extras. Pane helpers are
  never dropped; gone ones move to the Album and keep their record (merged into an archive entry
  only after 10,000 newer ones, below). Fledglings
  (sub-agents) are saved as their own records while present and in the Album for 30 days; after
  that their totals are folded into their parent's record (`kidsPast`, `kidsFolds`) because a
  fledgling is part of its parent helper (brief: "sub-agents are mini-helpers that add to their
  parent's output"). When that record is no longer in the save (the parent was merged into an
  archive entry, below) the totals fold into the archive entry of the 30 days the fledgling left
  in, and with no such entry (or no parent ever known) the fledgling stays as an Album helper of
  its own (a gone pane record, compacted and archived like any other): nothing is dropped. A
  fledgling that was a pane helper for a while (its parent was away, §5.2) may hold fledglings
  folded into its own record; when it folds, it carries them along (`kidsPast` + 1 + its own
  `kidsPast`, `kidsFolds` + its folds + its own `kidsFolds`, review r4-11). To keep the save bounded (R13), gone fledglings beyond the 200 most recently
  gone (`K.kidAlbumKeep`) fold into their parent at once, and gone pane helpers beyond the 200 most
  recently gone (`K.albumKeep`) are **compacted**: they keep `{id, name, species, hue, folds,
  tasks}`, the minute they left and any `kidsPast`/`kidsFolds`, and the save writes each as a
  short array (≈ 40 bytes). Folds and fledgling folds keep 4 significant digits, and anything
  added to a compact record later (an envelope cashed in, a fledgling folded in) is rounded the
  same way by compacting it again (review r5-08: those sums were written at full precision,
  ≈ 10 bytes more per entry, ≈ 130 KiB at the peak of 100 agents a day with 3 fledglings each). A compacted helper stays in the Album; if its agent returns it rejoins
  with those stats, its turn is rebaselined (no reward) and it joins anew (join order lists it as
  the newest). Compaction gives up what the Album does not show: the stored rest boost (§5.4) and
  this run's share (`stats.run`, so its part of the garland moves to the "everyone else" stripe).
  A record that cannot be packed (an id that is not 8 hex digits, from a hand-edited save) stays
  whole. A compact record also keeps its terminal key (above); the packed array is
  `[name or 0, folds, tasks, minute left, (kidsPast, kidsFolds), key]` (save format 4, §12.1).
  **Album archives** (review r3-04): compact records are ≈ 45 bytes each and an agent's terminal
  never leaves the save, so a heavy user (100 new terminals a day) passed herdr's 1 MiB write limit
  in about nine months and could never save again. Once more than 11,000 compact records are kept
  (`K.albumCompactKeep` 10,000 + `K.albumArchiveBatch` 1,000; batched so the selection runs once per
  thousand departures), those that left at or before the 10,000th newest one's leaving time are
  merged into one **archive entry** per 30 days they left in (`K.albumArchiveMs`; id `past-<n>`,
  never 8 hex digits): a gone pane record whose `archive` counts its helpers, with their summed
  folds, tasks and fledgling totals, the latest leaving time (`missingSince`), the earliest
  (`from`) and its latest helper's look. Archived helpers are still saved helpers: the Album counts
  every one of them, lists each entry as one row ("1,204 helpers · left 9–10 mo ago · 3.4M folds":
  the range from its newest to its oldest helper) and
  keeps their folds. A terminal of an archived helper that returns joins as a new helper. The
  Album then stops growing whatever the number of lifetime helpers (R13): near 475 KiB of save
  for 100 new agents a day (BALANCE inv. 7, the largest save on any of 300 days), near 640 KiB
  when each of them also runs 3 fledglings (641 KiB on day 122 of 200).
  **Whole-save bound** (review r5-07): archiving by count bounds only the Album, and present
  helpers come on top (≈ 600 bytes each with their titles and places, so an agent running 4
  sub-agents is ≈ 3 KB), so 130 agents with 4 sub-agents each over a full Album wrote 1.2 MB and
  every save cycle failed at herdr's 1 MiB limit. Each observation therefore estimates the save's
  bytes (engine `saveBytes`: a present helper's strings counted exactly as UTF-8 JSON, every other
  record by its shape, `K.saveBytes*`; no stringify, so it is cheap, deterministic and the same in
  every window, and in the tests never below the real size) and, when the compact records would
  take the save past **`K.saveBudget` = 896 KiB**, keeps fewer of them (`albumKeepFor`: the kept
  ones plus a batch of 1,000 new ones fit), archiving the oldest as above; nobody is dropped. That
  peak Album with those 650 helpers present now saves ≈ 760–800 KiB. Before save format 5 only
  the Album could give way, so a roster that alone passed the budget (about 1,300 present helpers)
  failed to save; present helpers are now packed in tiers under the same budget (§12.1 "Present
  helpers", R13), so every agent is a saved helper up to about 13,000 present at once and a larger
  roster is still saved, its last stubs left out.
  Record in memory (≈ 600 bytes written whole with a realistic title and place, packed in the file
  since format 5; ≈ 400 once in the Album):
  `{id, addr, created, kind:"pane"|"kid", parent, species, hue, name, joined, lastSeen, seenBy,
  status, lastTurn, lastFinishAt, unitAt, kidUnitAt, blockedAt, rest, warm, warmUntil, thanksUntil, env, stats:{tasks, folds, envelopes, checkIns}}`
  (`unitAt` and `kidUnitAt`: the helper's and its fledglings' envelope-unit budgets, §6.1; a save
  from before them uses `lastFinishAt` and the older `kidFinishAt`, which mean the same there).
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
| fledgling (sub-agent) | adds to parent | via `kids_i` (`k_p` while the parent is not working, §5.3) | pip: filled **diamond** (working), hollow diamond (resting), small **triangle** (needs you) | position on the parent tile | none | parent `Hue`; triangle guarded `blocked` | "Fledgling" |
| gone | Album | 0 | none (list row) | Album section | none | `T.dim` | "Left" |

* Shapes differ in silhouette (arc, pennant, check, crescent, envelope, diamond, triangle), and a
  second cue (position, border style, opacity, bar or motion) carries each status without colour.
* Status colours are the user's theme keys (they match herdr's sidebar); private colours are used
  only on scene art and identity (judge 3).
* **Contrast guard** (`ui/color.js statusColor(T, status, surface)`): the colour is checked
  against the **surface it is drawn on** (badge disc, ribbon `T.chrome`, rail `T.chrome`, tile
  `T.raised`). The badge disc (`statusDisc(T)`: Flock tile and list badges, the fledgling flag,
  mat chips, away-card and ribbon glyphs, the rail's needs-you button when the needs-you colour
  fails on `T.raised`) is `T.popover` wherever the needs-you colour reaches 3:1 there; otherwise
  the first opaque theme surface where it does, taking the one where the most status colours
  pass (win98: `T.input` #ffffff, where working, needs-you, finished and resting all keep their
  own colours; on #c0c0c0 three of them fell back to the same #404040, review r3-21). Below 3.0:1 it falls back to `T.muted`; if `T.muted` is also below
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
  The kind follows every observation (review r2-18): when the parent's pane closes, the glue
  reports the kept sub-agent as a pane helper and its record becomes one (`kind: "pane"`, no
  parent), so it gathers, counts in `N` and fills its own envelope; if the chain reaches a helper
  again it is a fledgling again.

### 5.3 Production

```
b_i     = (0.3·G + 0.04·Rw) · folk · warm_i · kids_i · thanks_i        per working pane helper
eff(n)  = n                         for n ≤ 4
        = 4 · (n / 4)^0.06          for n > 4        (eff(8) 4.17 · eff(30) 4.51 · eff(64) 4.72)
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
k_p     = (0.3·G + 0.04·Rw) · folk · kidBonus · min(4, working fledglings of p)
                                     per present pane helper p that is NOT working
```

* **Fledglings of a resting, finished or waiting parent** (review r3-10): working sub-agents
  are working agents, so they gather even while their parent is not working (a background
  sub-agent outliving its parent's turn). Parent `p` then gets `k_p`, the same share they add to
  a working parent (`b_i − b_i/kids_i` without warm or thanks), credited to the parent's record;
  `k_p` is a seat on the bench (it enters `Hs0`'s marginal sum like any `b_i`) but the parent is not
  counted as working (`n`, the Flock's "working" count). A working parent's fledglings still count
  only through `kids_i`, never twice.

* The flat `0.3·G` makes each working agent a real auto-clicker in the first hour (about a third
  of a hand click per second); the `0.04·Rw` term keeps helpers relevant all game.
* **Bench pace** (crowding) is diminishing returns, not a cap, and it is **marginal**: the k-th
  strongest working helper adds `eff(k) − eff(k−1)` of its `b_i`. So every working agent adds
  output and none lowers it, whatever the warm, fledgling and thanks multipliers (a fresh agent
  never dilutes a warm one), and an agent that stops working (Needs you, Finished, Resting) never
  raises it (BALANCE inv. 6). The Flock header says "9 working · bench pace 47 %" (`crowd(n)` as a
  percentage: the pace of a bench of equal helpers). Per-helper credit (Flock card, garland) is
  each `b_i` times the bench's effective pace `Hs0 / Σ b_i`. The exponent 0.06 and the fixed knee
  of 4 were calibrated so 30 and 64 agents reach the first wish on day 2 of open time, not on
  day 1 (BALANCE.md P6, P7); the exponent was 0.15 while the pace scaled the whole sum, which let
  a fresh agent lower a warm bench's output, then 0.07 until the r7 workshop ladder sped up the
  64-agent profile (P7 median 10:49 at 0.07, 12:00 at 0.06). The same `crowd(N)` scales Bundles and the overflow
  conversion (§6.1), Elsewhere credit (§12.5) and away gathering (§10.2), so the retune also made
  those about 16 % smaller at 30 agents and 22 % smaller at 64 than at 0.15 (BALANCE.md §8, knob 2). There are
  **no** bench-room upgrades or perks (they broke big-flock pacing in calibration).
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
   helpers (§3.10), and in the rail grid up to 240 (§3.9); urgent helpers always stay
   individual (past 240 in the rail, the first 240 of them).
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
   target ≤ 8 ms per render at 64 helpers in the QuickJS harness (A2.6). The tick builds only
   what its copy draws (review r8-09): Flock tiles (tooltip, detail, pips, place) only for the
   panel's Flock tab, and ribbon or rail marks (with their tooltips) only for the pips drawn
   (the ribbon's level C and the rail past 240 tally the rest). Before, every copy built every
   tile and mark on every tick: at 1,000 agents with 500 fledglings a steady tick took ≈ 210 ms in
   the ribbon, the rail and the panel alike; now ≈ 185 ms in the ribbon and rail and ≈ 215 ms in the
   panel's Flock tab, the rest being the observation and the session (`test/qjs/flock-budget.test.mjs`).
8. Above 80 tiles in one open group the Flock tab switches that group to `v_virtual_list` with
   `on_item_click` (no handlers in item renderers, definite height; gpui §3, pat §4). The open
   tile grids together also stay within a render budget (review r3-16): `ui/flock.js`
   `tileCost` counts what each tile builds (a plain tile 6 dense or 7 normal, more for pips,
   the fledgling flag, the rest bar and the envelope marker), and while the open grids cost more
   than `TILE_BUDGET` (800, about 110 plain tiles) the group with the most tiles becomes a list,
   needs-you last. A group listed in the last render goes back to tiles only once the grids fit
   `TILE_BUDGET − TILE_BUDGET_BAND` (band 120), so one agent changing status does not flip a
   group between tiles and rows; the panel keeps the last render's lists in `ui.flockLists`.
   List rows have no fledgling pips or envelope button (a row click selects, or opens a helper
   that needs you or whose fledgling does).

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
* **Units** (review r3-24): each finish draws on an envelope-unit **budget**, a token bucket that
  holds at most **1 share** and refills **1 share per 12 minutes** (`K.unitRefillMs`). A finish takes
  all the bucket holds, in 64ths (the remainder below 1/64 stays in it); a budget never drawn on
  starts full. A pane helper's finish draws on its own budget (`unitAt`) and adds `1 · share` to
  its envelope. A fledgling's finish adds `0.5 · share` to its **parent's** envelope while that
  parent is present, drawn from the parent's one fledgling budget (`kidUnitAt`) that every
  fledgling of that parent shares, so a burst of short-lived sub-agents with new addresses earns
  exactly what one busy fledgling does. With the parent gone (or never known) the units go to the
  fledgling's own envelope (never to an Album record), from its own budget, which starts empty
  when it joined, so a stream of new parentless sub-agents earns by the time each one lived.
  A budget therefore pays at most one share per 12 minutes plus the one it starts with, however
  many finishes draw on it: envelope units follow time, not the number of turns. One agent over an
  hour (`test/engine/helpers.test.mjs`): 12/2-minute turns 5 units, 60/60 s turns 5.8, 30/30 s 5.9,
  10/10 s 6.0 (bound 6); one parent's fledglings finishing 5, 50, 200 or 600 times an hour 2.5,
  2.9, 3.0 and 3.0 units (bound 3). A finish soon after another earns little or nothing new, but
  the helper's envelope from earlier finishes is still on the tray. BALANCE §3 P13 (48 sub-minute
  turns and 192 new sub-agents an hour per agent) holds P1's day-3 bound. (Before: any finish ≥ 60 s
  after the last was a whole unit and each new sub-agent address its own half unit, so 3-minute
  turns moved the first wish before day 3; then a per-finish minimum of 1/8 still let units grow
  with the number of turns below about 1.5 minutes apart: 10/10 s turns 23 units an hour, 600
  fledgling finishes an hour 38, and P13 on the 1/8 minimum reached the first wish at 17:35.)
* **One envelope per helper.** With no unopened envelope, a new one is created and its type is
  rolled by the PRNG (shown on the seal); otherwise the units stack. Cap **9 units** (15 with the
  250-Wish perk). Units above the cap convert at once into folds worth
  `unit · crowd(N) · units` (N = pane helpers present), with the footer note
  "+3.2K from a full envelope (Pib)". Nothing is silently lost.
* **Old mail is cashed in** (review r2-02): an envelope waits until it is opened, but not for
  ever. When its helper's Album record is compacted (it is no longer among the 200 most recently
  gone, R13) or its record has left the save (a folded fledgling), the next observation pays it
  out: a Bundle pays what opening it would (`unit · u · envMult · crowd(N)`, no Tailwind), a
  timed boost converts like units above the cap (`unit · crowd(N) · u`). It counts as opened
  (Bundle) or converted (timed), so units created = opened + converted + waiting still holds, the
  folds go to that helper's Album total, and one footer note per observation says it: an
  overflow note (the same conversion; `data.settled` marks it), "+3.2K from a full envelope (Pib,
  long gone)" or "(4 helpers long gone)", shown and expiring like any overflow note. So
  the tray holds at most one envelope per present helper plus the 200 newest Album helpers, and
  Mail Sorter users who never open timed boosts no longer grow the save without bound.

| Type | Chance | Seal (12 px) | Effect when opened (stack u, f = 1 + 0.25·(u − 1)) |
|---|---|---|---|
| Bundle | 55 % | stacked sheets | `unit · u · envMult · crowd(N)` folds (envMult 1 → 1.5 Wax Seal → 2 Ribbon Tie) |
| Rush | 25 % | double chevron | hand hits ×3 (×4 Brisk Charm) for `30 · f · durMult` s |
| Confetti | 10 % | confetti flecks | hand hits ×6 (×9 Gale Charm), chains every 4 s, for `12 · f · durMult` s |
| Chorus | 10 % | three dots | working helpers ×2 for `120 · f · durMult` s |

`durMult` 1 → 1.5 (Long Ribbon) → 2 (Longer Ribbon).

`unit = max(45 · Rp, 75 · V)`: 45 s of passive output, but never less than 75 hand hits (review
r3-11; Scraps and the Fresh Ream have the same kind of `V` floor). `Rp` counts only working
agents and workshops, so before this a new player's first Bundle (one agent, now finished, no
workshop yet) said "Bundle: +0 folds" and paid nothing; the floor also applies to overflow and to
old mail cashed in.

### 6.2 Opening, and the player's choice

* An envelope opens only by a click (tray, tile marker, ribbon `✉`, `ctrl-shift-j`) or by an
  automation the player bought and switched on (§8). Bundles may be auto-opened by Mail Sorter;
  **timed boosts are opened by the player** (or by Boost Keeper, only while the player is active).
* The seal shows the type before opening, so the player chooses the moment: open a Rush right
  before a clicking session. A boost envelope's tooltip says "Rush ×3 for 52 s · open when you're
  ready to click" (Rush, Confetti: they multiply hand hits), and a Chorus's "Chorus ×2 for 2m · open
  while your helpers are working" (it multiplies working helpers, §6.3; review r3-15).
* Opening a boost of a type already running **extends** it by 25 % of the new envelope's
  duration; remaining time is capped at **90 s (Rush), 30 s (Confetti), 240 s (Chorus)**. The tooltip
  warns "Rush is running: opening now adds only 13 s".
* The cap holds for a fresh boost too: a large stack, Long or Longer Ribbon and a Tailwind lengthen
  a boost only up to it (a 9-unit Chorus with Longer Ribbon would be 12 min and runs 4 min). The
  tooltip says the time opening it gives, capped, and marks a capped one "(max)": "Chorus ×2 for
  4m (max) · open while your helpers are working" (review r8-02: it said "for 12m"). The Ribbons'
  shop text says "boosts last ×1.5, up to each boost's cap".
* **Boost bar** (26 px under the mat): one chip per running boost (seal glyph 12 + "Rush ×3"
  11/600 + a countdown bar 48×3). The bar's width targets 0 with one native
  `.transition("width", {duration: remainingMs, easing: "linear"})` (fallback in §17: width set on
  each data tick). In calm mode the bar snaps to its width on each data tick instead (review r4-13). With no boost: "Open envelopes when you're ready" 11 `T.muted`.
* Boost timers are frozen while away (§10).
* With 30+ agents the per-helper stacking keeps the tray to one envelope per helper; the tray
  draws 6 and `+n`, the Flock tiles carry markers, and nothing auto-opens unless the player bought
  an automation (old mail of long-gone helpers is cashed in, §6.1).

### 6.3 Other rewards

Fresh Ream, scraps, gilded crane outcomes and the Paper Boat's Tailwind are in §4.5; Flock Song
and Chorus multiply working helpers; Confetti and Rush multiply hand hits. Boosts never multiply
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
| 0 | Paper Stack | 12 | 0.05 | stack of 3 sheets |
| 1 | Bone Folder | 180 | 0.3 | flat tool |
| 2 | Scissor Stand | 2,700 | 2.2 | scissors in a cup |
| 3 | Glue Pot | 38,000 | 15 | pot with a brush |
| 4 | Fold Bench | 490,000 | 95 | trestle table |
| 5 | Washi Vat | 5,900,000 | 560 | tub with a screen |
| 6 | Flower Press | 65,000,000 | 3,000 | press with a screw |
| 7 | Crane Loft | 560,000,000 | 14,000 | loft with a hanging crane string |
| 8 | Kite Tower | 4,800,000,000 | 60,000 | tower with a kite |

The ladder has no constant step (review r7: the first table's constant ×12 is AdVenture
Capitalist's). From the Bone Folder up, each cost step is no larger than the one below it (×15,
×14, ×12.9, ×12.0, ×11.0, ×8.6, ×8.6) and each output step shrinks with it (×7.3, ×6.8, ×6.3,
×5.9, ×5.4, ×4.7, ×4.3), so each workshop pays back in about twice the time of the one below
(cost / output 600, 1,227, 2,533, 5,158, 10,536, 21,667, 40,000, 80,000 s): early rungs come
quickly and the top rungs are not walls (BALANCE inv. 2). No simulated profile buys a Kite Tower
before the first wish.

**Tier upgrades** (27): for each workshop at 10, 24 (a quire) and 48 (two quires) owned, cost `base × 20`, `× 200`,
`× 4,000`, each **×2** that workshop's output. Names: "<Workshop>: Neat Edges / True Corners /
Master's Touch". A workshop row appears once the previous one is owned (silhouette before).

### 7.3 Upgrades

**Tools (hand)**

| Upgrade | Cost | Effect |
|---|---|---|
| Crisp Corners | 120 | hand ×2 |
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
| Long Ribbon | 100,000 | durMult 1.5 (each boost still capped, §6.2) |
| Longer Ribbon | 1e7 | durMult 2.0 (each boost still capped, §6.2) |
| Brisk Charm | 3e6 | Rush ×3 → ×4 |
| Gale Charm | 1e8 | Confetti ×6 → ×9 |

**Curios (special clickables)**

| Upgrade | Cost | Effect |
|---|---|---|
| Long Crease / Grand Crease | 20,000 / 2e6 | chain k 3 → 5 → 7 |
| Quick Creases | 200,000 | a chain every 20 → 12 active s |
| Scrap Basket | 100,000 | scrapMult 2 |
| Crane Bait / Crane Song | 50,000 / 5e6 | crane interval 340–510 → 240–360 → 170–255 active s |
| Slow Wings | 500,000 | crane life 11 → 18 s |
| Harbour Ribbon | 1e6 | unlocks the Paper Boat (§4.5) |
| Crease Field (needs Grand Crease) | 5e6 | every 5th chain is a crease field on the Sheet; opens the Pattern book (§4.7) |

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
| Crease Helper | 5e6 | at 80 % of a node's life, clicks the next due node in order at 50 % value | add rhythm, In step or afterglow; touch a crease field ("Only your own hands fill the book", §4.7) |

Other switches (Settings → Play): **Helpers gather** (on; off makes `Hs = 0` so the flock is a
pure status board), **Crease nodes appear** (on; off also stops crease fields, §4.7), **Floating numbers** (on). There is no
auto-wish and no auto-catch of cranes or boats.

---

## 9. Prestige: String the Thousand

```
cranes(L)  = floor( 1000 · (L / Lw)^0.4 )         Lw = 6e9 †      (L = lifetime folds, all runs)
           = the largest c with L ≥ Lw · (c / 1000)^2.5
Wtotal(L)  = floor( cranes(L) / 100 )
gain       = Wtotal − W
first wish : allowed when cranes ≥ 1000 (L ≥ 6e9), giving exactly 10 Wishes (G = 1.5)
later wish : allowed when gain ≥ max(5, ceil(0.25 · W))
string     : shows cranes(L) − 100·W  out of 100·max(10, needed gain)
bonus      : G = 1 + 0.05 · W on all folds; perks by Wishes held (§3.5)
```

* The 0.4 power: early cranes come quickly (fun), later ones slowly; waiting past the gate still
  pays but is never compulsory. `Lw` is the lifetime that strings the first 1,000 cranes. (It was
  `floor(100 · cbrt(L / 6e6))`, the same numbers at the first wish, but the cube root of lifetime
  earnings is Cookie Clicker's prestige formula, review r6. With 0.4 the second wish needs 2.76× the
  first wish's lifetime instead of 3.375×; M17 moved from M15 + 18:02 to M15 + 17:13 and still
  passes, so the later-wish gate was not retuned.)
* **Making a wish** first collects an uncollected away pot (r5-13; the confirm card says so) and
  opens every Bundle on the tray at current value, then resets folds, workshops, tiers, upgrades
  (except perk-kept), running boosts, rhythm, afterglow, spawns and the shelf. It keeps helpers (identity, stats, rest), the Album, Wishes, perks,
  **timed boost envelopes** (they carry into the next run), settings, switches, notification
  counters, lifetime totals and the garlands.
* Perks (by Wishes held): 10 keep Crisp Corners and Mail Sorter; 25 **Spare parts**, a tenth
  (rounded down) of the last run's Paper Stacks, Bone Folders and Scissor Stands carries into the
  next run (`K.spareKinds` 3, `K.spareDiv` 10: 47 Paper Stacks keep 4, 9 keep none); 50 gilded
  crane intervals ×0.8; 100 automations stay bought; 250 envelopes stack to 15. (25 was "start
  with 10 Paper Stacks and 5 Bone Folders", Cookie Clicker's Starter kit and Starter kitchen,
  review r7.)
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
  counted: it keeps a high-water mark (`away.highWater`, the latest clock it credited) and a skip
  allowance (`away.skipLeft`, grown by each clock-back, capped at 8 h). Later, while the clock is
  below the mark:
  * **clock put right** (the clock lands within 5 s of the mark, or past it): the time up to the
    mark is skipped, whatever its size, and the allowance goes to 0;
  * **an absence below the mark** (a gap over 60 s): at most `skipLeft` is skipped, the rest is
    credited as a normal away segment;
  * **live play** (gaps of 60 s or less, including a hidden window's 5 s ticks): credited, and the
    mark moves with it.

  A skip over 60 s raises the `clock` notice again if it is not showing; it stays until dismissed,
  so a skipped absence is never silent. Residual: after a clock-back of more than 8 h, putting the
  clock only partly right can credit at most one 8-h cap of time that was already counted (a
  partial correction cannot be told from a real absence).
* Two away segments separated by less than 5 min of live (ticked) time **share one 8-h cap**, so
  restarting herdr repeatedly cannot farm away credit.

### 10.2 What accrues (closed form: one multiplication per segment)

```
away = f · ( Rw + crowd(N) · Σ_present (0.3·G + 0.04·Rw) · folk ) · a      f = 0.25 → 0.35 Night Shift → 0.45 Night Owl
```

* "Present" = pane helpers present at the last observation that are **not waiting on you**:
  working, resting and finished helpers count whatever their status (agents keep working while the
  person is away; we do not know their schedule), but a helper waiting for input (`blocked`,
  "Needs you") is waiting for the absent person, so it stops helping, as it does live: it adds
  neither its share nor a seat to `N` (review r6-05). It still shows under "helpers needing you"
  on the away card. Paid at base rate: no warm, kids, thanks, In step, afterglow or boosts.
* Resting and finished helpers gain `a / restFull` rest; helpers come back fully rested if
  `a ≥ restFull`.
* Not accrued: clicks, spawns, cranes, boats, envelopes (no finishes are observed while away),
  afterglow drain, and boost time: **boost timers and afterglow are frozen** and resume on return.
* **Helpers nobody can see.** With two windows (§12.5), a helper last observed by another window
  more than 60 s ago counts as away for production: it earns the same away rate for at most 8 h
  after its `lastSeen`, then nothing, until a window sees it again. As in an away segment, one
  last seen waiting for input earns nothing and the away crowd counts only the pane helpers not
  waiting (`Hstale = f · crowd(N) · base · unseen`, `helpers.js` flock / awayPays). One rule covers "game closed"
  and "the window that sees this agent closed": each helper has **one 8-h unseen allowance per
  absence** (review r4-06). The time since it went unseen (60 s after the later of its `lastSeen`
  and its window's last sign of life) is spent whether another window paid it live at the away
  rate, an away segment paid it, or nothing did; an away segment from `t0` pays each present pane
  helper for `min(a, 8 h − spent)`, whichever window reopens. So a helper whose window closed
  while another stayed open 4 h earns 4 h more when the game reopens, not a fresh 8 h, and live
  stale credit plus away credit never pass 8 h. A helper seen at the close (the usual case) has
  the whole allowance, so one window closing and reopening is unchanged. With helpers of
  different allowances the segment is credited in closed-form pieces: while `m` helpers still
  earn, `crowd(m)` applies (`away.js` awayHelpers; `test/engine/away.test.mjs` r4-06).
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
   envelope bob, no crane bob, no confetti flecks, no first-run bob.
2. The gilded crane and the boat do not glide: the crane sits at its spawn slot, the boat at the
   far end of its lane above the bottom band (clear of the streak label, r6-06).
3. No floating numbers ("Floating numbers" is forced off and disabled).
4. No transition longer than 150 ms (bars snap; the wish moment is one 300 ms fade, which is the
   single exception and is a fade, not motion).
5. Nodes, scraps, cranes and boats live twice as long (catch chance only; values unchanged), and
   so do crease fields and fold pieces (§4.7).
6. Counters and rates re-render every 5 s instead of every second (the data tick still runs every
   second for the engine; `cx.notify()` happens only when a 5 s bucket changes or the player acts).
7. Away and welcome cards appear without transitions.
8. Every status shape, word, tooltip and the contrast guard stay. Readability never drops.
9. Crease fields (§4.7): dots, rings, the trace line, the result chip, the fold piece and the Book
   tab are static in every mode; the last-2 s fade is a static 0.4; tracing has no timing rule, and
   a trace in progress sets with full pay when the field's life ends.

### 11.2 Notifications (opt-in; at most 3 a day; never sound)

* Master switch **off** by default. Events (each with its own checkbox, on when the master is on):
  1. **"A wish is ready"** (the switch's label): a wish became available (once per run). The
     title is "Your string is full" when it is, and "A wish is ready" when the gate opens before
     the String is full (W 10–36, r5-12).
  2. **"Envelopes are piling up"**: ≥ 12 unopened for 30 min (once per local day).
  3. **"Creaseworks can't save"**: a save `error` or `fresh` notice lasting 5 min (once per
     episode).
* `notify({title, body, level: "info", timeout: 6000, icon: "mods/creaseworks/art/notify-icon.svg", action: {name: "creaseworks.show", args: {}}})`.
  Clicking the toast runs `creaseworks.show`, which shows and unfolds the panel (a toast is
  usually sent with the panel folded to the rail, review r3-06). Only when the ribbon and the
  panel are both hidden (no copy on screen to take the command) is the action
  `layout.show {id: "cw-panel"}`.
  Herdr's `notify` never plays sound (host-api §7) and Creaseworks never calls `playSound`.
* **Cap: 3 `notify()` calls per local calendar day across all events and all windows.** The
  counter `{day: "YYYY-MM-DD", sent}` lives in the save (merge takes the max per day). The glue
  computes the local day from `Date` and the timezone offset and passes it in.
* Nothing is sent while the panel is shown and the window is active.
* **Held while the window is away** (review r6-02). herdr's `notify` is a toast inside the window
  that expires on the wall clock whether or not anyone looks, so while the window is hidden or
  inactive nothing is claimed, counted or sent: a wanted notification waits and is sent once the
  window is active again. The once-per-run wish notice and the daily slots are used only by a
  toast that can be seen.
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
<appHome>/data/creaseworks/save.json             current save   {format:"creaseworks-save", version: 5, check, state}
<appHome>/data/creaseworks/save.bak.json         previous good save, rotated at most every 5 min
<appHome>/data/creaseworks/save.damaged-<n>.json damaged files kept aside, n = 1..5 (oldest replaced)
<appHome>/data/creaseworks/save.recovery.json    only while save.json cannot be read (> 1 MiB, not a regular file)
<appHome>/data/creaseworks/location.json         only when sharing: {"path": "/abs/…/save.json"}
```

* **Unreadable save.json.** When `save.json` exists but cannot be read at all (over herdr's 1 MiB
  read limit, a folder, a broken link), progress goes to `save.recovery.json` and the footer says
  so; once `save.json` can be written again the game goes back to it. On load, the newer (by state
  clock) of the recovery file and the backup is used, so a stale recovery file never rolls back a
  newer, normally rotated backup. Two windows sharing the save both go there (review r4-03): a recovery file
  holding another window's progress is merged like a `save.json` conflict (its game taken in, this
  window's unsaved actions replayed onto it), never written over; when each holds progress the
  other lacks, the other is kept aside, listed in Details and said in a notice. Windows in the
  recovery file converge (r5-02): each takes in the other's game every round instead of keeping
  it aside again, so the `save.damaged-<n>` slots do not rotate. A damaged recovery file found
  during play is kept aside and said (r5-06). Purchases a merge refuses are refunded and the
  refund is flashed (r5-05). While save.json stays unreadable its error notice outranks every
  other, so the recovery notices (another window's game taken in or kept, this window's game
  replaced, a damaged recovery file) are also flashed, and dropped once the game is back on
  save.json; the kept copies stay named in Details.
* **Going back to save.json** (r5-04). The window first takes in `save.recovery.json` when it
  differs from its own last write, so the first window back writes a save.json that holds the
  other window's latest recovery progress, and the second window merges that file instead of
  keeping it aside. A save.json lacking this window's recovery progress, where that progress is
  already kept aside, is merged too (another window kept this game aside and replaced it). A
  recovery file left from an episode more than 30 days old adds nothing: its writers the engine
  has pruned do not count as new progress, so it never rolls the game back.
* **Reset and Restore** keep the current save aside (reason `reset` / `restore`) and the next
  write **replaces** the file rather than merging into it, so another window's save cannot undo
  them. That other window then finds fewer of its own actions in the file than it last wrote,
  says "Another window replaced the save…" and names the kept copy in Details. While save.json is
  unreadable, Reset and Restore keep the live game aside (not whatever the recovery file holds);
  a Reset that has landed in the recovery file counts as landed when the game goes back to
  save.json, and a file found at save.json while it has not landed is kept aside and said before
  it is replaced.
* **Pending action log** (A5): bounded (`PENDING_MAX`). Runs of roster observations that change
  only titles are coalesced; an observation that changes a turn counter, a status, the roster or
  presence is always kept, so a merge never loses a finished-task reward. Past the bound the log
  is given up: the next write keeps the other file aside with a notice and writes this game.
  Merges replay the log in slices that yield between them (500 ms callback budget), and a log
  given up mid-replay is still replayed to its end.
* **Backup rotation failures** show their own `error` notice (with its own back-off) and Settings
  says "Backup: not updated (…)"; the main save goes on.
* **Stopping sharing** deletes the pointer's path (`{"path": null}` means "not sharing", never a
  damaged pointer).

Written only with `writeTextFile(path, text, expected)` (CAS, atomic rename), read with
`readTextFile`; absolute paths from `appHome()`; nothing is ever written under `mods/` (that would
reload the mod, life §1). Save text < 256 KiB at 64 helpers plus 500 Album helpers, and
< 512 KiB after a year of 20 agents a day (each with 3 fledglings, timed boosts left unopened)
thanks to Album compaction and old mail being cashed in (R13, §6.1; tests). The envelope
`version` is the file format (2: Album entries may be packed arrays; 3: the chunked check below;
4: packed Album entries may end in their terminal key and the helpers map may hold Album archive
entries, §5.1, reviews r3-18 and r3-04, so a format-3 build reads a format-4 file as newer,
read-only, never written; 5: present helpers and envelopes are packed arrays, below, so a
format-4 build reads a format-5 file as newer; the check rule of 4 and 5 is 3's, and files of
formats 3 and 4 still load);
the state keeps its own `version`. A file with a higher format or state version than the build
knows loads read-only and is never written (§12.2, `newer`); from format 3 on a build tests the
format before the check, so a file whose check it cannot verify (a later rule) is still `newer`,
never damaged. Formats 1 and 2 still load.
**Check (format 3, review r2-01).** The helpers map, in its own key order, is cut into chunks
after each id whose last two hex digits are a multiple of 64 (≈ 64 helpers a chunk); `check` is
FNV-1a 32 of the state JSON with `"helpers"` replaced by a marker, a newline, and the FNV-1a 32
digests of each chunk's JSON text `{"id":entry,…}` in order. The file text itself is unchanged
(the state, helpers in their own order). A writer keeps each chunk's digest (keyed by its text,
never saved), so a save cycle hashes only the rest of the state and the chunks whose text changed.
Old Album chunks keep their text; a new helper is appended, so it changes the last chunk (or
starts one), and a present helper changes the chunk it sits in, which for a helper that rejoined
from the Album is an older chunk (it keeps its place), so a cycle with live helpers spread over
the Album re-hashes one chunk per such helper. Loading hashes every chunk once and hands its
digests to the first save. The cache lives on the state as plain data under a registry symbol
(`Symbol.for("creaseworks/save-digests")`, not enumerable), so a hot reload's first save replaces
it rather than adding one per code generation.
**Present helpers (format 5, R13).** Present helpers are written packed (ARCHITECTURE A4),
dropping what follows from the rest (species, hue, the group) and writing times as offsets from the
helper's last sighting, in one of four tiers. **Full** keeps everything; **lean** drops the place
strings (title, pane, pane name, space, tab: every observation of the helper sets them again, so
only another window's Elsewhere row and the first moments after a load show it without them);
**slim** keeps identity (address, created time, kind and parent, name, status, its window and last
sighting, join time, turn), its wait's start and its totals (tasks, folds, run, envelope units,
check-ins, fledglings folded in); a **stub** keeps identity only (name, kind and parent, status,
its window and last sighting, turn, a waiting helper's wait start: ≈ 45 B). All are full while the
save fits `K.saveBudget` (896 KiB). Past it each helper's stub is reserved (its slim form for a
salted id, R6, since a stub keeps no address) and then, in one order, every helper that still fits
goes slim, then lean, then full: totals before game state, game state before place strings. The
order is the same in every window and fair between windows: live helpers (seen by their window
within a minute of the state's clock) first, then unseen ones most recently seen first, helpers
holding an envelope first, then by id, a fixed spread that favours no window's roster and no
status. A slim helper loads with `slim: true`: its envelope budgets empty at its last sighting (a
reload refills nothing), no warmth, thanks or rest charge, its wait timed from its real start (the
view's "Needs you" time and any thanks are the record's). A stub loads with `stub: true` and no
totals; its address and created time come back with the observation that sees it (claimId finds
it by its id). Each keeps its turn, so its next sighting pays nothing twice, and stays slim or a
stub until an observation sees it again, so a reload, or a merge that replays onto the loaded save,
writes the same text: windows that load the same text choose alike. The window that wrote it keeps
in memory what it wrote less of (place strings, the game state of the helpers it wrote slim or as
stubs) until its next load or CAS merge, which takes them from the file like any other window's.
prune makes room for every present helper's lean form, its numbers counted at the widest text they
can take before the next observation, before the Album's compact records, so the Album gives way
first. 4,000 present helpers (1,000 agents with 3 sub-agents each, long CJK titles and places, an
envelope per agent) over a full Album save at ≈ 880 KiB, every one with its game state, about
2,900 of them without place strings. Every agent is a saved helper up to about 13,000 present at
once with sub-agents (3 per agent, an envelope per agent) or 10,000 pane agents each holding an
envelope while an away pot is open; an observation of about 15,000 present helpers alone takes
herdr's 500 ms in the wasm harness, so a larger roster cannot be reconciled in budget anyway. Past
that the save is still written, never refused for its roster: the last stubs in the order are left
out, each with its envelope and away-pot entry, and join again as new helpers when they are seen.
Only a record the plan cannot pack (a hand-edited save's) is written whole and unbounded: a save
over herdr's 1 MiB write limit is refused before herdr is asked and said in words (§12.2, store.js
`oversize`, the last resort), and it saves again once the state is smaller. Envelopes are `[type,
units, landedAt, lastAt − landedAt]`. A packed helper's status and an envelope's type are indices
into `STATUSES` (helpers.js) and `ENVELOPES` (content.js): their orders are part of the format
(pinned by a test).
**Writing in steps.** `serializeSteps(state)` is `serialize` as a generator (R13): its first step
copies what the later ones read (each helper record and its stats, the envelopes, writers and away
state, the text of the rest of the state), then it plans and encodes in slices of 1,500 helpers, so
the text is the state at that first step exactly. The glue (`store.js` `serializeIn`) drives it
with a task yield between steps for any state of 1,000 helpers or more (`STEP_SAVE_HELPERS`; review r8-06: below 3,000 one step took ≈ 260–320 ms), on every write path (the
save cycle, the write after a CAS merge, the recovery file, a Settings tool keeping the old game
aside), and takes the log position and writer progress the write confirms at the first step, so
actions applied during the steps stay pending. 12,500 present helpers: 19 steps, the slowest
≈ 80–110 ms in the wasm harness, against ≈ 500–750 ms in one.
**Parsing in steps.** `parseSaveSteps(text)` is `parseSave` as a generator that yields after the
JSON parse and after every `STEP_HELPERS` (1,500) helpers it checks, unpacks or validates; the
glue (`store.js` `parseIn`) drives it with a task yield between steps for a load, a CAS merge (§12.2) and every Settings save tool, for any save of 64 KiB or more, so no step
grows with the save (two years, 561 KiB: 25 steps, the slowest ≈ 60 ms in the wasm harness, against
≈ 375 ms for the whole parse in one step).
**Builds before format 3** (development builds only; none was released) verify the whole-text check
before testing the format, so they read a format-3 file as **damaged**, not newer: they keep it
aside (`save.damaged-<n>.json`) and load their backup, and in a shared save a window still on such
a build overwrites the newer window's progress at its next merge (the progress is kept in the
damaged copy, not lost, but it leaves the game until restored). So every window sharing a save
must run a format-3 build; a format change after this one does not have this window (the
`newer` test comes first).
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

**Scene tokens `S`** (ours; light or dark half picked for the theme **showing**, review r5-01):
`palette.artDark(theme(), settings().dark)` judges the theme's first opaque surface of `raised`,
`chrome`, `surface` and takes the hue set with the higher minimum contrast there, so paper and
win98 draw the light half and graphite, ink, moss and atom-one-dark the dark half whatever the
window appearance; `settings().dark` (the appearance) decides only when the theme gives no opaque
colour. A single-name theme shows the same theme in both appearances, so the appearance alone
would draw dark art on paper. The glue passes the result as `ctx.dark` and the appearance as
`ctx.appearanceDark` (ARCHITECTURE B11). The identity hues `Hue` follow the same choice.

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
| `scene/{seal-bundle,seal-rush,seal-storm,seal-chorus}.svg` | 4 | 12 | stacked sheets, double chevron, confetti (four flecks and two dots), three dots |
| `scene/scrap.svg`, `scene/ream.svg` | 2 | 16; 28×20 | torn quadrilateral; ream of paper with a band |
| `scene/crane-gilded-{outline,body,shade}.svg` | 3 | 40×28 | outline = body grown 1.5 units |
| `scene/boat-{hull,sail}.svg` | 2 | 40×28 | Paper Boat |
| `scene/fold-{ridge,gull,napkin,lozenge,stair,sail,switchback,hem,coil}-{base,shade}.svg` | 18 | 24 → 20, 16 | Pattern book fold pieces (§4.7), flat two layers like the boat: ridge pleat, paper gull, folded napkin, lozenge tile (creased across), stair pleat, paper sail on a mast, accordion fan, paper frame, paper spring |
| `workshops/{stack,bonefolder,scissors,gluepot,bench,vat,press,loft,kite}.svg` | 9 | 24 → 28 | shop icons |
| `ui/{fold,wish,gear,flock,shop,string,back,chevron,close,info,warn,check,dots,arrows,lock,clock,hand,paw,ribbon,curio,cog,step,cloud,book}.svg` | 24 | 16 → 11–24 | interface glyphs (`cloud` = Elsewhere, `book` = the Pattern book's tab) |
| `ui/garland-strand.svg` | 1 | 12×200 | 50 crane silhouettes |
| `notify-icon.svg` | 1 | 36×36 intrinsic, drawn 18×18 | the **only** full-colour SVG (toast `image()`, ≥ half its largest on-screen size × 2): crane `#fbf7ee` on mat `#2f6a55` |
| `layout-preview.png` | 1 | 216×124 | from the 1440×900 whole-window shot (A10) |
| `logo.svg` | 1 | 64 | README, RECIPE |

Total: 139 SVG + 1 PNG in the mod (140 files), plus repo `preview.png`. If the facet split is not needed the
36 `-a/-b/-c` files are still generated but unused (they cost nothing at run time). Runtime vector
art (no files): mat grid (2 elements), mat edge, crease lines, streak track, progress and countdown
bars, confetti flecks, garland stripes, all `PathBuilder` in `%` coordinates.

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
| Paper Boat | one-way `.transition("left", …)` in its lane above the bottom band, under the play pieces (short mat: `top` eases too, for the dip below the Sheet) | boat life | sits at the lane's far end, above the streak meter (clear of its label) |
| Confetti flecks | paint_path ×4 in `div#cw-storm` + `.loop("opacity", {0.55 → 0.9, 1200})` | Confetti duration (≤ 30 s) | none |
| Envelope landing | newest tray envelope `.loop("top", {from: 0, to: −2·z, period: 1600})` | 10 s after it lands, mat shown | none |
| First-run hint | `.loop("top", {0 → 4·z, 900})` | until the 3rd fold | static |
| Sheet fold | frame swap on each click (data) + `.active(s => s.opacity(0.88))` | — | same |
| Floating "+N" | click handler records `{id, x, y}`; the element renders at `top y`, `opacity 1` with `.transition("top", 700)` and `.transition("opacity", 700)`; **one `cx.timer.after(16)` per burst** flips all new pops to `top y − 28`, `opacity 0`; **one `after(≤ 800)`, due when the oldest pop finishes,** removes the risen ones (a pop still rising is never cut; while 5 are alive a click's amount is carried into the next pop that fits). ≤ 5 alive | — | off |
| Streak meter, rest bars, string fill, switch knob, crease fade, node expiry, crease-field dots and fold piece expiry | `.transition(width/height/left/opacity, 150/600/600/120/600/2000/2000)` on absolute px (the field's dots and the fold piece fade to 0.4 in their last 2 s) | — | ≤ 150 ms or snap (the field and fold-piece fade: a static 0.4) |
| Boost countdown | one `.transition("width", {duration: remainingMs, easing: "linear"})` per boost | — | snap (width set each data tick, r4-13) |

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
pop burst pair (`after(16)`, `after(≤ 800)`), at most one save write in flight (ticker only). That
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

`{type:"click", target:"sheet"|"mini"|"node"|"scrap"|"crane"|"boat"|"ream"|"dot"|"fold", id?, t}`
(`dot` and `fold`: the crease field and fold pieces, §4.7),
`{type:"open", helperId, t}`, `{type:"buy", item, count, t}`, `{type:"switch", id, on, t}`,
`{type:"setting", key, value, t}`, `{type:"wish", t}`, `{type:"collect", t}`,
`{type:"observe", helpers:[…], visible, active, matShown, day, t}`, `{type:"rebase", t}`,
`{type:"dismiss", notice, t}`, `{type:"notified", event, day, t}`. All carry `{w, s}` (A5).
`engine.advance(state, now)` is closed form per segment (§10.2) and splits at boost ends, warm
ends, staleness and cap breakpoints; `engine.view(state)` returns the plain view-model the UI
renders. PRNG: mulberry32 in `state.rng`.

### 15.2 Module layout

`main.js` routes `props().role` → `panel` | `ribbon`; `engine/{state,rules,economy,helpers,
envelopes,prestige,away,prng,format,text,save-codec,clicking,view,pattern}.js` (pure);
`glue/{session,live,observe,store,notify,commands,clock,views}.js`; `ui/{panel,mat,flock,shop,
string,settings,ribbon,rail,banner,away,color,palette,art,widgets,book}.js`. Each import on one line (pat §8).

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
  `wide`, `short`, `calm`, and the Pattern book's (§4.7) `field` and `fold` at 1100×700 (the first
  field's hint and every dot state; a match's chip, its fold piece and the Ridge chip),
  `field-calm` (a loose set in calm mode), `book` and `book-narrow` (the Book tab at 1440×900 and
  1100×700), `book-280` and `book-400` (the Book tab at the narrowest Standard and Wide widths,
  where the drawing gives way to the tier pips) — each in **all six shipped themes** at zoom 1 and 1.5 (so are the
  review-state views `tray-fraction`, `boat-tray`, `boat-calm`, `afterglow`, `string-gate` and
  `string-pot`: a fractional stack count, the boat over a full tray gliding and calm, the
  afterglow chip, the String's gate mark, and the wish card's away-pot note); greyscale,
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
| Narrow windows: 1100×700 behaviour, rail via `layout.resize`, hint, main min 80 (weights, ARCHITECTURE B15), window shots at both sizes | §2.2–2.3, §15.3 |
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
| R4 | `layout()` may not expose node sizes (Files panel width) | unverified | estimate it from the weights and the panel's measured width (`filesEstimate`); 368 px when the panel is folded |
| R5 | Hosted spinners paint above the view (gpui §9); clipping inside scroll areas and under the away card is unverified | open | spinners only on visible tiles, ≤ 6, never under absolute cards (cards hide spins while shown) |
| R6 | Helper id `address#created_ms` collides if two different terminals share address and creation ms (two homes starting cores at once), or their strings clash in the 32-bit hash (≈ 1e-7 for 30 present agents); a remote terminal named differently in two homes becomes two helpers | mitigated | a terminal whose plain id is held by a different present terminal takes a salted id (§5.1), so a clash never loses a present agent, and a present terminal keeps its salted id after the plain id's holder leaves; a salted helper's Album record keeps its `salt`, so it is found again when its agent returns. Album records keep no address but a 16-bit terminal key (§5.1, review r3-18), so a new terminal whose plain id clashes with a gone helper's record takes a salted id instead of taking that record over (before: ≈ 1 % chance of such a hijack by 10,000 lifetime helpers, ≈ 7 % by 25,000). Residual: a clash in both the id and the key (1 in 65,536 of id clashes), and Album records from a save before format 4 (no key), still rejoin by the plain id (their stats merge); and a salted helper that was already in the Album before `salt` was recorded is not recognised, so its returning agent takes the plain id's gone record |
| R7 | Cross-process CAS race (life §6.3) | accepted | idempotent actions + merge; ≤ 15 s of one window's progress can be overwritten until its next save re-applies it |
| R8 | `turn` behaviour across a core restart | rebaseline rules (§6.1) | `turn < lastTurn` → rebaseline, no reward |
| R9 | Clicking a mod block might move keyboard focus off the terminal | unverified | nothing is focusable; verify by hand; if focus moves, refocus the last `focused()` pane on mouse-up |
| R10 | `on_mouse_down` `local_position` absent before first paint | known (gpui §7) | `?.` with the element centre as fallback |
| R11 | Rem-based ramps and zoom (gpui open question 1) | open | use numeric px everywhere in our UI |
| R12 | `.active()` opacity on a stateful div is the only press feedback | verified API, unwatched | if invisible, swap the Sheet frame one tick early as feedback |
| R13 | Save size and save cost with years of Album entries | bounded | fledglings fold into parents after 30 days or beyond the 200 most recently gone; Album pane helpers beyond the 200 most recently gone are compacted to `{id, name, species, hue, folds, tasks}` plus the minute they left and their terminal key (≈ 45 B packed; §5.1), never dropped; beyond 10,000 compact records (checked in batches of 1,000) the oldest are merged into one archive entry per 30 days (§5.1, review r3-04), still counted and shown in the Album, so the Album stops growing (100 new agents a day for 300 days: largest save on any day ≈ 475 KiB, BALANCE inv. 7; ≈ 640 KiB when each agent also runs 3 fledglings; before: 1,124 KiB by day 300, past herdr's 1 MiB write limit, after which every save failed). **The whole save is bounded too** (review r5-07): present helpers (≈ 600 B each) came on top of that count bound, so 130 agents with 4 sub-agents each over a full Album wrote 1.2 MB and every save cycle failed; each observation now estimates the save's bytes (`saveBytes`, no stringify, never below the real size in the tests) and archives more compact records when it would pass `K.saveBudget` = 896 KiB (that case now ≈ 760–800 KiB; §5.1). The count rule and the estimate are both deterministic functions of the state, so every window archives the same records. **Present helpers are bounded too** (save format 5, §12.1 "Present helpers"; reviews r6, r7): before, each was written as a whole record (≈ 560 B + its strings), so about 1,300 agents present at once filled herdr's 1 MiB write limit on their own, no save could be written ("too many helpers"), and the rule that every agent is a saved helper broke. Now each is a packed array without what follows from the rest (species, hue, group; times as offsets from its last sighting; its writer as an index), in a full, lean (no place strings, which every observation sets again), slim (identity, its wait's start, totals) or stub tier (identity only, ≈ 45 B), chosen under `K.saveBudget` in an order that is the same in every window and fair between windows (live helpers first, then by id; review r7: ordering by last sighting put a whole window's roster behind another's seen a second later, and ordering by status always slimmed the idle helpers first, losing their rest). Slim and stub records load flagged and are written so until observed again, so the choice is a function of the written text and windows that load the same text write the same text. prune makes room for each present helper's lean form before the Album's compact records, counting its numbers at the widest text they can take before the next observation (`numMax`, `growMax`: a fraction is up to 18–24 characters; review r7: the fixed 150 B it counted before was below a realistic record's ≈ 230 B, so helpers went slim while compact records stayed), so the Album gives way before any present helper's game state. 4,000 present helpers (1,000 agents with 3 sub-agents each, long CJK titles and places, an envelope per agent) over a full Album: ≈ 880 KiB, every one with its game state (none slim), about 2,900 of them without place strings, the Album's compact records mostly archived (still counted). Every agent is a saved helper up to about 13,000 present at once (agents with 3 sub-agents, an envelope per agent) or 10,000 (pane agents each with an envelope, an away pot open); an observation of about 15,000 present helpers alone takes herdr's 500 ms in the wasm harness (≈ 30 µs a helper), so a larger roster cannot be reconciled in budget anyway. Past that the save is still written, never refused for its roster: the last stubs in the order are left out, each with its envelope and away-pot entry, and join again as new helpers when they are seen (review r7: before, past about 8,500 present helpers, fewer with real number widths, no save was written at all). No save step grows with the roster (review r7: one serialisation of 12,500 present helpers takes ≈ 500–750 ms in the wasm harness, and from about 5,500 a save cycle's single serialisation could pass the 500 ms budget, be cut off, and be retried at the same cost, so no save landed): the store serialises any state of 1,000 helpers or more in steps (`STEP_SAVE_HELPERS`, review r8-06) (engine `serializeSteps`, store.js `serializeIn`, every write path), a snapshot of what the later steps read and then slices of 1,500 helpers; the text is the state at the snapshot exactly, and the log position the write confirms is taken then. Measured in the QuickJS harness on 12,500 present helpers (2,500 agents with 4 sub-agents each, a distinct long CJK title per helper changed every round, every helper re-observed before each write, so no cached text, size or chunk digest is reused): ≈ 882 KiB, the largest save the engine writes, in 19 steps, the slowest ≈ 80–110 ms, the write step (the last step and the size check) ≈ 55 ms; the store's stepped save path (load, save cycles, a CAS merge of another window's write) on 8,000 present helpers keeps every step ≈ 250 ms or less, and on 4,000 ≈ 245 ms (`test/qjs/creaseworks.test.mjs`; ASCII titles there, since the harness's mock disk checks a write's size one non-ASCII character at a time inside the VM, which herdr's native write does not), budget 500 ms. Residual: at those rosters the engine's own observation (≈ 30 µs a present helper) and view (≈ 33 µs in the panel's Flock tab, re-measured in review r8-09; the ribbon and rail build no tiles and only the marks they draw, §5.5 item 7) are most of a step, so the save is no longer the first limit; and a record the plan cannot pack (a hand-edited save's) is written whole and not bounded, so store.js still measures every text and refuses one over 1 MiB before herdr is asked, in words (§12.2, the last resort). `saveBytes` is now the save plan's byte count (present helpers, their envelopes and pot entries exact) and stays above the real size in the tests. Envelopes are packed too (`[type, units, landedAt, lastAt − landedAt]`, ≈ 40 B instead of ≈ 90). The save plan stringifies each present helper's parts once from templates (no array is built), measures them from their texts, and keeps place texts and the sizes of non-ASCII strings in bounded caches (pure memos, never saved), which brought the plan from ≈ 300 ms to ≈ 110–150 ms per save at 4,000 helpers. Folds added to a compact record later keep its 4 significant digits (review r5-08). Records that cannot be packed (§5.1) and salted ones (R6) stay whole. A compact record changed after compaction (a check-in, an envelope opened for it) is compacted again at the next observation, and the envelope of a helper whose record is compact or gone is cashed in then (§6.1; review r2-02: Mail Sorter and the wish open only Bundles, so before this a year of unopened Rush, Confetti and Chorus envelopes, ≈ 3,200, made a 622 KiB save, and opening them un-compacted their records to 1,169 KiB, past herdr's 1 MiB write limit). The save file format is 5 (packed entries since 2; the chunked check of §12.1 since 3; terminal keys and archive entries since 4, read as newer by a format-3 build; packed present helpers and envelopes since 5, read as newer by a format-4 build, which formats 1–4 load into, §12.1; review r2-01: every cycle used to stringify and hash the whole Album one character at a time, ≈ 0.8 ms per KiB in the QuickJS harness, so a save near 600 KiB passed the 500 ms budget and stopped saving). A format-1 build reads a format-2 file as newer (read-only), but builds of formats 1 and 2 read a format-3 file as damaged, and in a shared save a window still on one overwrites the other's progress at its next merge (kept in a damaged copy; development builds only, §12.1). Measured in the QuickJS harness (`npm run test:qjs`, Mail Sorter on, timed boosts opened only at the end): 5,000 lifetime pane helpers ≈ 220 KB; a year of 20 agents a day with 3 fledglings each ≈ 422 KiB (format 4: every compact record carries its terminal key, review r3-18; slowest save-cycle step ≈ 105–146 ms); two years ≈ 561 KiB (10,320 compact records and 4,080 helpers in archive entries, r3-04; slowest save-cycle step ≈ 138–215 ms; the whole parse in 25 steps, the slowest ≈ 60 ms, ≈ 375 ms in all), budget 500 ms. (Format 3 measured 347 KiB and 585 KiB; the year is larger in format 4 by the keys, the two years smaller by the archives.) Residual (before archives, review r3-04): at ≈ 40 B per compacted helper, 512 KiB was reached near 12,000 lifetime pane helpers and herdr's 1 MiB write limit near 25,000; archives now cap the compact records at 11,000. A save from an older build with more compact records is archived down to 10,000 at its first observation (25,000 records: every step in budget, `test/qjs/album-open.test.mjs`). A whole parse (check, unpack, validation) costs ≈ 0.6–0.7 ms per KiB in the wasm harness, and both the load and a CAS merge (another window's file) parse the whole save: in one task step that is ≈ 375 ms at 600 days, ≈ 390–480 ms at two years, and 500 ms near 800 KiB, which the Album archives now keep the save well below. The engine therefore splits it (`parseSaveSteps`, §12.1: at two years 25 steps, the slowest ≈ 60 ms, `test/qjs/creaseworks.test.mjs`); the glue's load, merge, overwrite, check, restore and share paths drive it with a task yield between steps for any save of 64 KiB or more (`glue/store.js` `parseIn`), so no parse step grows with the save. herdr's native quickjs-jit is expected to be faster than the wasm harness. **Open risk**: the QuickJS-ng wasm build the harness uses (0.12.1) can fail to free its runtime (`JS_FreeRuntime`: `list_empty(&rt->gc_obj_list)`) after a save cycle once the save is about 300 KiB; every step stays in budget and the game is unaffected. Bisected (review r3-25): it shows when the engine's automatic cycle collector runs while one of the glue's async functions is executing again after an `await` resumes it (`store.cycle` after its pause, `store.parseIn` between parse steps); collections at task-step boundaries, inside synchronous engine code, or none at all leave nothing behind. The save size only decides whether a collection lands there (a save cycle allocates about twice the save text). This is consistent with a collector-timing fault in that wasm build, not a handle the harness or mod keeps alive, but it is an inference: there is no reduced repro, and the same await-plus-collection pattern frees cleanly in a minimal mod. `npm run test:qjs` keeps a strict 120-day run (188 KiB); the natural year and two-year runs accept only that exact leak check at teardown (`cleanOrEngineFault`), and strict replays of the same saves and play with the collector held back (`createHost` `gcHeadroom`, which changes only when garbage is collected) must free cleanly, which catches any leak that does not depend on collector timing (a VM handle left alive fails there, `test/qjs/harness.test.mjs`) but not a refcount error that does. herdr runs a different engine (vendor/quickjs-jit-runtime), so this result says nothing about how a window close or a VM restart frees the runtime there; if it shared the fault, it would show then. |
| R14 | The pacing targets come from a calibration prototype, not the engine | checked | the shipped simulator (real engine, 15 profiles × 20 seeds, with the human hand's jitter and pauses, review r8-03) passes every BALANCE.md row (P1 first wish median 21:41, day 3 14:41) with the † constants unchanged except the bench-pace exponent, retuned 0.15 → 0.07 when the bench pace became marginal (§5.3) and 0.07 → 0.06 with the r7 workshop ladder (P6 12:59, P7 12:00); it keeps asserting them (`npm run sim -- --assert`, `test/pacing/`); † constants are the retune knobs, in the order BALANCE.md lists |
| R15 | Second-wish pacing (gate `max(5, ceil(0.25·W))`) not calibrated | provisional | BALANCE.md marks M17 provisional (simulated: M15 + 16:52 median, inside its window); retune the gate, not `Lw` |
| R16 | IME/ chord conflicts beyond IBus `ctrl-shift-u` (e.g. Fcitx) | low | chords are only in `layout:Creaseworks`; RECIPE tells people how to rebind |
| R17 | The crease field is the one thing on the Sheet (§3.2): a press could reach both a dot and the Sheet, or fall in the 4 px gaps of the 96 px Sheet | closed (built and tested) | dots handle the Sheet's own `on_mouse_down` and stop propagation; a UI test presses every dot centre and every gap at zoom 1 and 1.5 on the 96 and 112 px Sheets and expects exactly one action each (a dot, or the Sheet): the UI test "one press is one action" (`book.test.mjs` under `test`, UI folder), which passes. Since every dot click is a fold anyway, a wrong guess about which one was hit never loses a fold |
| R18 | "Click the last dot again to set" is the least obvious rule (§4.7) | watch in play | the life-end and dead-end sets, the "Click again to set" tooltip, the first-field chip and the book's help line carry it; a loose set costs nothing and keeps the field, so a wrong guess is safe to try |
| R19 | Four tabs at Narrow (226 px at 1100×700) | measured | every tab `px(6)` and Book as an icon, the Flock count dropped below 220 px. The UI test (`book.test.mjs`) "the tab row fits at 226 and 200 px with a three-digit Flock count" measures it in Chromium with "Flock 999": 204.3 of 226 px and 178.2 of 200 px on the Flock tab (194.3 and 168.2 on the Book tab), inside the row's 4 px end padding; `npm run shots` at 1100×700 in paper and graphite. Contingency, not needed: if a later change stops it fitting, the Book becomes the first section of the String tab instead of a tab |
| R20 | The simulator's tracer (90 % / 75 % success, learning in book order, BALANCE §12.1) is a guess about human hands | provisional | the asserted rows are guards against a no-book run, not predictions; P14 and P15 bound an unsteady and a perfect hand; replace the model with play-test numbers once there are some |
| R21 | Save state version 2 (§4.7): a second window still on the old build reads the shared save as newer and goes read-only until it reloads | intended | never silent (the banner says so); hot reload in one VM migrates the live state in place, so no rollback, and a window left read-only by the newer file leaves read-only on that reload and merges the file in at its next save (ARCHITECTURE B17); RECIPE's upgrade note says to reload both windows |

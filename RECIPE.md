# Creaseworks

Herdr's usual main window, with a small paper workshop added on the right and a thin status ribbon above the status bar. The right panel holds a green cutting mat with a square of paper in the middle. Each click folds the paper, and every eighth fold finishes a little figure. Every coding agent in the window becomes one of the "paper folk", a helper that folds alongside you. Working agents fold on their own. A finished task arrives as a sealed envelope you can open. An agent waiting for input raises a pennant, and clicking the pennant opens that agent's pane. Resting agents lie flat and store up a boost for their next task. Folds buy workshops, tools, folk care, charms, curios and automations. After about three days of open time the string of cranes reaches 1,000, and you can trade it for Wishes, which are permanent. The terminals keep their usual place and stay fully usable.

![Creaseworks](preview.png)

## What you see

Left to right, then top to bottom. Sizes are logical px before zoom.

- **Sidebar (268 px, `chrome`)**: exactly the shipped `main` sidebar: brand (46), spaces and agents lists (weight 1 each, min 90), footer (69).
- **Work column** (`canvas`):
  - **Tabs bar (42)**: the shipped `tabs` mod.
  - **Work body** (a row with padding 8 and gap 8):
    - **Terminal panes** (`main`, min 360 px): the shipped tab block with 10 px rounded pane frames and a 30 px pane header.
    - **Files / Changes panel** (hidden, 368 px): the shipped panel, unchanged.
    - **Creaseworks panel** (`cw-panel`, 320 px, drag range 64–560, radius 10, 1 px `border`, `chrome` background). From top to bottom:
      - **Header (44)**: fold count (18/600), rate per second (11, muted), a counts chip (`▲2 ✓1 ●5 ◗14`), Wishes, and a gear.
      - **Save banner (28)**: shown only when there is a save problem.
      - **Mat (304×232)**: a green cutting mat (`#2f6a55` light / `#1d3a32` dark) with a 16/64 px grid. The 112×112 Sheet (`#fbf7ee` / `#d9d1c0`) sits in the middle and steps through eight fold pictures (square, triangle, kite, square base, bird base, narrow, wings, crane), with 8 fold ticks under it. A top band shows needs-you chips, or the shelf of the last 12 figures when nobody is waiting. A bottom band shows the envelope tray (up to 6 envelopes, then `+n`) and the streak meter. Numbered crease nodes, scraps, the daily Fresh Ream, the gilded crane (`#f0c24b`) and the Paper Boat appear on free slots of the mat.
      - **Boost bar (26)**: one chip with a countdown bar per running boost.
      - **Tabs (32)**: Flock, Shop and String. Settings opens from the gear.
      - **Content**: a scrolling area for the current tab.
      - **Footer (22)**: a save glyph with "Saved 12 s ago", plus In step and Calm chips.
  - **Ribbon** (`cw-ribbon`, 30 px, `chrome`, full work width, always shown). From left to right: the fold count and rate (118 px). Then one status mark per helper, never capped: 20×20 chips with a 2 px identity-colour bar while they fit, then two rows of 12 px pips, then tallies for working and resting helpers only beyond 82 helpers at 1100 px or 130 at 1440 px. Then the envelope count, a mini Sheet (shown while the panel is folded or hidden) and the fold button.
  - **Status bar (28)**: the shipped `workspace-status`.
- **Rail** (the panel folded to 64 px): from top to bottom, the count, a 44 px mini Sheet, a needs-you button, an envelope button, a pip grid with one mark per helper (4 columns at a 14 px pitch), the gilded crane while one is live, and an unfold chevron.
- **Panel widths**: below 140 px it draws the rail. From 140 to 279 px it is narrow (icon-only shop, dense tiles). From 280 to 399 px it is standard. At 400 px and over it is wide (taller mat, more Flock columns). A panel shorter than 640 px uses a 304×184 mat with a 96 px Sheet.
- **Type and colour**: the text is the person's UI font, at 11 px or larger everywhere. UI and status colours come from the person's theme (`chrome`, `raised`, `popover`, `border`, `muted`, `accent`, `working`, `blocked`, `done`, `idle`). Scene colours come from one fixed palette with a light and a dark set. Helper identity uses 8 hues (vermilion `#b8432a`, saffron `#946000`, leaf `#3b7330`, teal `#1d7373`, sky `#2b62b0`, violet `#6a4cb0`, plum `#9c3a72` and slate `#4c5a68` in light themes; lighter versions in dark themes) on 12 animal silhouettes: crane, frog, fox, koi, rabbit, turtle, butterfly, whale, owl, boat, mouse and snail.

## How it behaves

**Agent statuses.** Every agent herdr shows (from `agents()` and `terminals()`) is a saved helper. There is no cap and no daily limit. Each status has its own shape and a second cue that does not rely on colour:

| herdr status | In game | Shape | Other cue | Motion |
|---|---|---|---|---|
| `working` | Working: folds for you at an upgradable rate | 270° arc | "Working" group | Spins for 20 s after it starts working (at most 4 at once) and while you are In step |
| `blocked` or `error` | Needs you: stops helping | Pennant with a "!" | Dashed tile border, first group, a chip on the mat, ▲ in the counts chip | Pulses for 10 s, then stays still |
| `done` | Finished | Check in a circle | "Finished" group, ✓ in the counts chip | None |
| `idle` | Resting: charges a boost for its next task (×2 at a full charge, ×3 with Warm Hands) | Crescent | Rest bar, 0.8 opacity | None |
| Sub-agent | Fledgling: adds up to +25/50/75 % each (up to 4) to its parent | Small diamond (hollow while resting) or triangle pip on the parent tile | Sits on the parent tile | None |
| Agent gone | Moves to the Album and keeps its history | List row | Album section | None |

A status colour that falls below 3:1 on its surface falls back to `muted`, then to `foreground`. The pace drops off as more agents work at once ("bench pace"), but every working agent still adds folds.

**Clicks.**
- **Sheet**: one fold per click, at most 12.5 credited hits a second. Clicking in rhythm builds a streak of up to ×1.5 (×3 with upgrades). A streak of 25 is **In step**, which makes every working helper fold ×1.5. Hits made while In step bank **afterglow**, up to 20 minutes, which keeps helpers at ×1.25 while you code.
- **Crease nodes**: a chain of 3, 5 or 7 numbered nodes. Clicking them in order pays extra. A wrong order tears the chain, with no penalty.
- **Scraps, Fresh Ream** (once a day), **gilded crane** (Lucky Fold, Paper Storm or Flock Song) and **Paper Boat** (Tailwind, after the Harbour Ribbon curio): click them before they leave. They spawn only while you are actively playing, so nothing is missed while you code.
- **Envelopes**: one per helper. Repeat finishes stack on it, up to ×9. The seal shows the type before you open it: Bundle (folds), Rush (hand ×3), Paper Storm (hand ×7) or Chorus (helpers ×2). Opening is your choice: click the tray, a tile marker or the ribbon's ✉, or press `ctrl-shift-j`.
- **Needs-you cue** (tile, mat chip, ribbon pip, rail button, ▲, or `ctrl-shift-y`): runs `pane.focus` for an agent that has a pane, or `terminal.peek` for a sub-agent without one. If the agent has gone, it shows "That agent has gone" instead.
- **Ribbon marks**: a needs-you or finished mark opens the pane. Any other mark unfolds the panel with that helper selected. Hovering shows the name, agent, place, status and how long.
- **Shop**: Works, Tools, Folk, Charms, Curios and Auto. Works can buy ×1, ×10 or Max. Each row shows the time until you can afford it, and a diamond marks the best buy.
- **String tab**: 20 strands of 50 cranes. At 1,000 cranes, **Make the wish** gives 10 Wishes (+5 % to everything for each one, kept forever). You confirm on a card whose button stays disabled for 1.5 s. A wish resets folds, workshops and upgrades. It keeps helpers, Wishes, perks, timed boost envelopes, settings and switches.

**Keys** (`layout:Creaseworks` only):

| Chord | Action | Does |
|---|---|---|
| `ctrl-shift-g` | `creaseworks.fold` | Folds the panel to the 64 px rail, or unfolds it to its last width (default 320). Shows the panel first if it is hidden |
| `ctrl-shift-y` | `creaseworks.answer` | Opens the helper that has waited longest. Repeat presses cycle through them |
| `ctrl-shift-j` | `creaseworks.envelope` | Opens the oldest envelope |

The palette also has "Creaseworks: hide or show the panel" (`layout.toggle {id:"cw-panel"}`).

**Away.** Up to 8 hours of folds accrue while herdr is closed or the machine sleeps. The rate is 25 %, raised to 35 % or 45 % by upgrades. On return, a non-blocking "While you were away" card shows the time, folds, envelopes, who needs you, who rested and what you can now afford. One **Collect** click banks the folds, or they bank themselves after 10 minutes. A hidden window is not away: it keeps ticking every 5 s.

**Saving.** A save runs 2 s after a purchase or setting change, every 15 s while something changed, and when the mod closes. A problem shows on the ribbon chip, the rail glyph, the footer glyph and a banner (`recovered`, `fresh`, `conflict`, `merged`, `error`, `newer` or `clock`). Saving a mod file hot-reloads it, and the running game carries on without rolling back.

**Settings** (gear): Calm mode, Notifications (off by default; at most 3 a day; never sound), a switch for each automation you own, Play (Helpers gather, Crease nodes appear, Floating numbers), Roster (order and density), Number style, Save (path, Check save now, Restore backup…, Share a save with another herdr home…) and Reset game….

**What moves.** Nothing moves at rest. Animation runs only for a short time after an event: the needs-you pulse, new-work spins, the crane's glide and bob, the boat, storm stripes, an envelope landing, the first-run hint and floating "+N" numbers. Calm mode removes all of it and keeps every earning the same.

## Built from

**Layout** `layouts/Creaseworks.json`: the shipped `main.json` with every id and root field kept (`titlebar:"none"`, `traffic_lights:[12,16]`, `background:"canvas"`, `terminal_padding:[14,12]`). It adds `"preview": "mods/creaseworks/art/layout-preview.png"` and `"min": 360` on `main`, and two blocks:

```
root (row)
├─ sidebar (column 268, min 44, max 480): brand · sidebar-lists{spaces, agents} · sidebar-footer
└─ work (column, resizable:false)
   ├─ tabs (42)                                   mod tabs
   ├─ work-body (row, padding 8, gap 8)
   │  ├─ main (tab:active, pane frame, min 360)
   │  ├─ panel (hidden, 368) > panel-body (stack) > files · changes
   │  └─ cw-panel (px 320, min 64, max 560, radius 10, border, chrome)   mod creaseworks {role:"panel"}
   ├─ cw-ribbon (px 30, chrome)                   mod creaseworks {role:"ribbon"}
   └─ status (28)                                 mod workspace-status
```

The layout uses theme token names only. It sets no `theme` or `colors`.

**Shipped mods used**: `workspace-chrome`, `spaces`, `agents`, `tabs`, `pane`, `files`, `changes`, `workspace-status`.

**Mod** `mods/creaseworks/`:
- `mod.json`: `{"place":"none","title":"Creaseworks","palette":[…4 entries…]}`.
- `main.js`: the View class. It renders the ribbon or the panel by `props().role`; the panel draws the rail below 140 px.
- `engine/`: pure and deterministic. It has no herdr, no gpui, no `Date.now` and no `Math.random`. It uses a seeded mulberry32 with keyed draws, and its actions carry `(writer, seq)` for idempotent merges.
- `glue/`: the only files that import `herdr`.
- `ui/`: gpui-kit element builders.
- `art/`: 120 single-colour SVGs (`fill="#000"`, tinted through `svg()`), `notify-icon.svg` (the one full-colour file) and `layout-preview.png` (216×124).

**herdr functions**: `agents()` and `terminals()` (one read of each per data tick, joined by address), `layout()`, `theme()`, `settings()`, `props()`, `window()`, `appHome()`, `checking()`, `readTextFile` / `writeTextFile` (compare-and-swap), `nextCommand()`, `notify()`, `run()`.

**Commands run**: `pane.focus {pane}` / `{terminal}`, `terminal.peek {terminal}`, `layout.resize {id:"cw-panel", px}`, `layout.show {id:"cw-panel"}`, `layout.show {id:"cw-ribbon"}` (once per save-problem episode when both pieces are hidden), and `layout.toggle {id:"cw-panel"}` (palette).

**Keys**: `keys.json`, section `layout:Creaseworks`, with three string actions in `<mod>.<cmd>` form.

**Files**: `<appHome>/data/creaseworks/save.json`, `save.bak.json` (rotated at most every 5 minutes), `save.damaged-<n>.json` (n = 1..5) and an optional `location.json` that points at a shared save. Nothing is written under `mods/`. It makes no network calls, runs no programs (`exec`, `hc`) and plays no sounds. It reads and writes only its data folder, plus a shared save path if you type one in.

**Copies**: the panel and the ribbon are two copies in one VM. They share a handover slot at `globalThis[Symbol.for("creaseworks/live")]`. One copy, the ticker, advances the engine, observes agents and saves. A new generation after a hot reload adopts the slot.

## Watch out

- **Not run in a live herdr build.** It was built against the herdr-app v0.1.18 source and checked with a Node mock of herdr, a QuickJS-ng harness with herdr's budgets (render 50 ms, callbacks 500 ms, module load 500 ms), frozen prototypes and Playwright screenshots. Things still to check by eye on the first real run:
  - Whether faceted sprites keep their shading through `svg()` alpha masks. If they flatten, set `FACETS = "split"` in `ui/art.js`.
  - Whether clicking the panel ever moves keyboard focus off a terminal.
  - Whether `layout.resize` widths persist across restarts.
- **Two windows means two app homes.** Two herdr windows are two processes with separate homes, so each has its own `data/creaseworks/save.json` by default. To play one game in both, open Settings → Save → "Share a save with another herdr home…" in window B and enter the absolute path of window A's `save.json`. B then writes only a `location.json` pointer. The windows merge progress through idempotent actions. The compare-and-swap has no cross-process lock, so up to about 15 s of one window's progress can be overwritten until that window's next save re-applies it. Displayed numbers may jump a little when a merge lands, and the `merged` banner says so.
- **Files panel at narrow widths.** `main` keeps `min: 360`. At about 1100 px wide with Files/Changes open, the expanded game panel overflows the work row and is clipped, with only its left edge showing. The ribbon then offers "Narrow window: fold Creaseworks to a rail?". Folded, everything fits. The game never resizes itself.
- **Notifications** are off by default. Turned on, they send at most 3 a day across all events and windows, never play a sound and never fire for agent status, because herdr already toasts "needs you" and "finished". Nothing is sent while the panel is shown and the window is active. Save problems never depend on notifications.
- **Keys**: one bad entry makes herdr reject the whole `keys.json`, so merge ours carefully. The actions are `creaseworks.<cmd>`, not `creaseworks:<cmd>`: `herdr.d.ts` shows a colon form that herdr rejects. `ctrl-shift-u` is avoided because of IBus Unicode entry. Other input methods may claim a chord, in which case rebind it in the `layout:Creaseworks` section. Commands need a shown copy. The ribbon is always shown, so they always have a receiver.
- **Install leaves `preview.png` out.** The Settings picture therefore lives at `mods/creaseworks/art/layout-preview.png`. Keep `"place":"none"` and keep `mod.json` valid JSON. An invalid `mod.json` docks a 320 px copy into the person's other layouts.
- **Never put the game under `panel-body`.** The tabs mod hides that panel when the space changes.
- **VM restart**: if herdr restarts the mod VM (memory pressure), the in-memory slot is lost. The game reloads from disk and loses at most the last 15 s or so. A hot reload loses nothing.
- **Clock moved back**: no folds are credited for that time, and a `clock` notice explains it.
- **Limits**: away credit is capped at 8 h, and two away periods less than 5 minutes of live time apart share one cap. Envelopes hold 9 units (15 with the 250-Wish perk). Units above the cap turn into folds at once, with a footer note. Ribbon tallies appear only beyond 82 helpers at 1100 px or 130 at 1440 px. Save text stays under 256 KiB with 64 helpers and 500 Album entries.
- **Helper identity** is a hash of `address#created_ms`. Two homes that see the same terminal share one helper. A restarted terminal is a new helper.
- **Name check (2026-11-25)**: a web search found no game, app or product called "Creaseworks". Re-run it before publishing.

## Done when

- [ ] `herdr-app check` passes for `mods/creaseworks`, and `layout.switch {name:"Creaseworks"}` shows the main window with the game panel on the right and the 30 px ribbon above the status bar.
- [ ] Settings → Look shows a "Creaseworks" card with the preview picture, and `ctrl-shift-l` switches back to your own layout unchanged.
- [ ] Clicking the Sheet folds it (the picture changes, the count rises, a figure hops onto the shelf every 8th fold), and a terminal you were typing in still has the keyboard.
- [ ] Starting a coding agent in any tab adds a helper tile, a ribbon mark and a counts-chip number within about 1 s. The fold rate rises while it works.
- [ ] An agent waiting for input shows a pennant (tile, mat chip and ribbon). Clicking it, or pressing `ctrl-shift-y`, focuses that agent's pane. A sub-agent without a pane opens with a terminal peek.
- [ ] When an agent finishes a task, an envelope with a seal lands on the tray. Clicking it, or pressing `ctrl-shift-j`, opens it and starts the boost or pays the bundle.
- [ ] An idle agent shows a crescent and a filling rest bar, and its next task starts with a "next task ×" boost.
- [ ] 30+ agents: every one still has its own mark in the ribbon, and the Flock tab switches to dense tiles.
- [ ] `ctrl-shift-g` folds the panel to the 64 px rail and back.
- [ ] Each owned automation has its own switch in Settings, and Calm mode removes all motion and floating numbers.
- [ ] Notifications stay off until switched on, and never exceed 3 a day.
- [ ] `<appHome>/data/creaseworks/save.json` and `save.bak.json` exist after a minute of play.
- [ ] Corrupting `save.json` and reopening shows the `recovered` banner, loads the backup and keeps `save.damaged-1.json`.
- [ ] Editing and saving any file in `mods/creaseworks/` hot-reloads without losing any folds.
- [ ] Closing herdr for an hour and reopening shows the "While you were away" card. Collect adds the folds.
- [ ] Switching between a light theme (paper) and a dark one (graphite) keeps every status shape, label and the Sheet clearly readable.

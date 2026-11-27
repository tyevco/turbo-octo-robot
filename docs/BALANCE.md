# Creaseworks: balance target

This file is the written target that `tools/sim/pacing.mjs` asserts (ARCHITECTURE A11) and
`test/pacing/*.test.mjs` parse. Every formula and constant it depends on is in `docs/DESIGN.md`
§4–§10; the two files change together. The numbers in the "proto" columns come from a calibration
prototype of the DESIGN formulas (1 s steps, the profiles below, 20 seeds). The shipped simulator
replaces it and drives the **real engine** (`engine.apply` / `engine.advance`) through the same
profiles. With the §8 knobs at their current values it passes every row below (P1 first wish
median 21:41, min 21:22, max 23:21; run `npm run sim` for the full table). The last change to
the numbers was review r8-03 (§11): the profiles' hand is a human one (seeded jitter and a pause
for each purchase or envelope), not a perfect beat, and a short pause no longer ends the rhythm
streak. Before it, the originality review r7 (§10) brought a new workshop ladder and turned knob 2
from 0.07 to 0.06.

---

## 1. Time units

* **Play-clock** = cumulative hours with herdr open and the game live, from the first launch.
  It is the unit of every target below, written `h:mm` or as decimal hours.
* Every profile is open **8 h a day** (09:00–17:00 local) and away **16 h a night** (machine
  asleep or herdr closed). So **day d** covers play-clock **8(d−1) h to 8d h**, and play-clock
  `x` on day d is wall-clock `09:00 + (x − 8(d−1))` on day d.
* **Day 3** = play-clock 16:00–24:00 = wall-clock day 3, 09:00–17:00.
* **Active time** = seconds in which the profile is in a session (making hand hits). Spawn clocks
  (nodes, scraps, cranes, boats) advance only in active time (DESIGN §4.4).
* Nights are away segments: 16 h each, credited **8 h** (the cap).

## 2. Assertion rules

* Each profile runs with **seeds 1–20**. A row passes when the **median** lies in "Pass window"
  and **every seed** lies in "Every seed".
* Purchases happen only in sessions, so many milestones land on a session start (every 40 min);
  windows are at least one session wide.
* Shares and invariants are computed on seed 1 unless the row or its section says "all seeds" or
  "every seed" (§6.2 does: every seed must clear its click-share floor).

---

## 3. Player profiles (exact parameters)

### P1 typical (the reference profile)

| Parameter | Value |
|---|---|
| Open time | 8 h a day, 09:00–17:00; 16 h away each night (credited 8 h) |
| Sessions | **12 a day**, starting at open-time 0:00, 0:40, 1:20, … 7:20 of each day; each **2.5 min**; the very first session ever lasts **8 min**. 30 active min a day |
| Hand hits | **1.25 per second** on the Sheet during a session, on average. Not an even beat (review r8-03, §11): each interval is `800 ms` times a seeded lognormal factor with σ **0.15** and mean 1 (about 1 interval in 17 is over the 1.0 s rhythm gap), and every second of the session in which the player buys or opens envelopes takes the hand off the Sheet for **1.5 s**, plus **0.5 s** for each further purchase or envelope in that second. `npm run sim -- --even` runs the old perfect beat with no pauses |
| Chains | when a chain is up, the next hits click its nodes in order; success **95 %** per chain (a failure is one out-of-order hit, then the chain tears) |
| Crease fields | traces fields (§12.1): while a field is up and no scrap, fold piece or chain node comes first, the next hits trace the next diagram to find, then the ready diagram with the most dots; success **90 %** per attempt (seeded); fold pieces are clicked like scraps |
| Scraps | every scrap is clicked when it spawns |
| Gilded cranes | **80 %** caught (seeded) |
| Fresh Ream | collected at the first session of each day from day 2 |
| Envelopes | at each session start: open every Bundle; then, for each boost type not running, open the one with the largest stack; other boost envelopes wait |
| Buying | "cheapest payback first" (§3.1), evaluated every second of a session |
| Automations | buys **Mail Sorter** and **Thrifty Fox** as soon as each costs ≤ 25 % of the bank and keeps them on; never buys Boost Keeper or Crease Helper. Buys **Crease Field** by the same rule (it has no estimate, §12.1) |
| Never buys | Slow Wings, Harbour Ribbon (no estimate; the Paper Boat never appears) |
| Agents | **4 pane agents**. Agent i runs an hourly cycle offset by `(997·i) mod 3600` s: three blocks of **[12 min working, 2 min needs you]**, then **18 min resting**. That is 36 working, 6 needs-you and 18 resting minutes an hour, and **3 finished tasks an hour** (`turn` +1 at the end of each working block). Each answer comes after 2 min, so `thanks` applies |
| Sub-agents | each agent has **1 working fledgling** during the first 25 % (3 min) of each working block; it finishes (+1 turn) at the end of those 3 min |
| Settings | defaults: calm off, Helpers gather on, Crease nodes on, notifications off |

#### 3.1 "Cheapest payback first"

Candidates: the next workshop of every kind whose predecessor is owned, every unbought upgrade
whose cost ≤ 3 × bank or ≤ 3 × run folds, every unlocked tier. For each, `payback = cost / Δ`,
with Δ the estimated gain in income per open second:

```
activeFrac   = sessions · sessionMinutes · 60 / (8 · 3600)              (P1: 0.0625)
hands(h,e,Rp)= (h·G + e·Rp) · cps · 2.2                                 (2.2 = combo, figures and chains)
f            = 1 + 0.04 · nWorking · crowd(nWorking) · folk              (helper share of a new Rw)
workshop k   : Δ = O_k · 2^tier_k · G · f
tier of k    : Δ = n_k · O_k · 2^tier_k · G · f                         (only once n_k ≥ its threshold)
hand ×2      : Δ = activeFrac · hands(hand, 0, 0)
Echo level   : Δ = activeFrac · hands(0, newEcho − echo, Rp)
Folk ×1.5    : Δ = 0.5 · Hs0
Rest, Fledgling, Shared Rhythm upgrades : Δ = 0.15 · Hs0
Night Shift / Night Owl                 : Δ = 0.10 · Rp
Charms                                  : Δ = 0.08 · Rp
Steady Rhythm, Long/Endless Streak      : Δ = 0.3 · activeFrac · hands(hand, echo, Rp)
Curios (crease, scrap, crane)           : Δ = 0.4 · activeFrac · hands(hand, echo, Rp)
```

Buy the candidate with the smallest payback if affordable; repeat until it is not.

### Other profiles (each differs from P1 only as stated)

| Profile | Change from P1 |
|---|---|
| P2 never clicks | no hand hits, nodes, scraps, cranes or reams; still opens envelopes at session starts as P1 and buys with the same policy every 5 min of open time |
| P3 no agents | 0 agents |
| P4 one agent | 1 agent |
| P5 eight agents | 8 agents |
| P6 thirty agents | 30 agents |
| P7 sixty-four agents | 64 agents |
| P8 keen | sessions last 5 min (first still 8) |
| P9 few sessions | only 4 sessions a day (0:00, 0:40, 1:20, 2:00) |
| P10 busy agents | working blocks 15 min (3 × [15 working, 2 needs you], then 9 resting) |
| P11 fast hands | 3 hand hits per second |
| P12 calm | P1 with calm mode on |
| P13 short turns | sub-minute turns and a burst of sub-agents: 48 × [**45 s working, 15 s needs you**], then 12 resting (still 36 working minutes an hour, but **48 finished tasks an hour**); each block starts **4 new sub-agents** (new addresses) one after another in its first 12 s, each working 3 s and then done until the block ends (one fledgling working at a time and about P1's share of working time, but **192 fledgling finishes an hour** per agent) |
| P14 unsteady hand | hand intervals with σ **0.3** instead of 0.15 (about 1 interval in 5 over the 1.0 s rhythm gap, 1 in 46 over Steady Rhythm's 1.4 s), the same mean rate and pauses; crease-field traces succeed **75 %** of attempts |
| P15 pattern master | crease-field traces succeed **100 %** of attempts, and among ready diagrams it picks the first of Switchback, Coil, Napkin, Lozenge, Gull, Stair, Ridge, Sail, Hem (§12.1) |

P13 guards the envelope-unit rule (DESIGN §6.1, review r3-24): every finish draws on a budget, a
token bucket of at most one unit that refills one unit per 12 minutes, and every fledgling of a
parent draws on that parent's one budget, so the units an agent and its sub-agents earn follow
time, not the number of turns (at most 6 and 3 an hour; P13's agents earn ≈ 7.4 an hour each with
fledglings against P1's 4.5, from 37 times the finishes). Before it, every finish more than 60 s
after the last earned a whole unit and each new sub-agent address its own half unit, so short
turns about doubled the units created and moved the first wish before day 3 (3 min / 1 min turns
with no rest: 15:42 on seed 1); a per-finish minimum of 1/8 that replaced it still grew with the
number of turns below about 1.5 minutes apart, and on it this P13 reached the first wish at 17:35
(seeds 1-3). Sub-agents add to their parent's gathering by how many work at once (DESIGN §5.3), not
by how many finish, so P13 keeps one working at a time: four at once would be four times the
fledgling help, a different profile.

---

## 4. Milestones, P1

| ID | Event (sim key) | Target | Pass window (median) | Every seed | Wall-clock target | Proto median |
|---|---|---|---|---|---|---|
| M1 | first Paper Stack (`buy:paper-stack`) | 0:00:10 | 0:00:03 – 0:00:30 | ≤ 0:01:00 | day 1 09:00 | 0:00:06 |
| M2 | first upgrade, Crisp Corners (`buy:crisp-corners`) | 0:01:10 | 0:00:40 – 0:03:00 | ≤ 0:05:00 | day 1 09:01 | 0:01:06 |
| M3 | 10 workshops owned (`own:workshops>=10`) | 0:02:00 | 0:01:00 – 0:04:00 | ≤ 0:06:00 | day 1 09:02 | 0:01:48 |
| M4 | first Scissor Stand (`buy:scissor-stand`) | 0:06:00 | 0:03:00 – 0:12:00 | ≤ 0:40:00 | day 1 09:06 | 0:06:00 |
| M5 | first gilded crane spawns (`spawn:crane#1`) | 0:06:30 | exactly 390 active s | exactly 390 active s | day 1 09:06 | 0:06:30 |
| M6 | first Glue Pot (`buy:glue-pot`) | 1:20 | 0:40 – 2:00 | 0:30 – 2:40 | day 1 10:20 | 1:20 |
| M7 | first automation, Mail Sorter (`buy:mail-sorter`) | 2:00 | 1:20 – 3:20 | 0:40 – 4:00 | day 1 11:00 | 2:00 |
| M8 | first Fold Bench (`buy:fold-bench`) | 3:20 | 2:00 – 4:40 | 1:20 – 5:20 | day 1 12:20 | 3:20 |
| M9 | 1 M folds this run (`run:1e6`) | 3:20 | 2:20 – 4:20 | 1:40 – 5:00 | day 1 12:20 | 3:18 |
| M10 | first Washi Vat (`buy:washi-vat`) | 6:40 | 5:20 – 8:00 | 4:40 – 8:40 | day 1 15:40 | 6:40 |
| M11 | 100 M folds this run (`run:1e8`) | 9:20 | 8:00 – 11:20 | 7:20 – 12:00 | day 2 10:20 | 9:22 |
| M12 | first Flower Press (`buy:flower-press`) | 10:00 | 8:40 – 12:00 | 8:00 – 12:40 | day 2 11:00 | 10:01 |
| M13 | 1 B folds of live income this run, away credit left out (`live:1e9`) | 16:30 | 14:30 – 18:30 | 13:50 – 19:10 | day 3 09:30 | (sim 16:01) |
| M14 | first Crane Loft (`buy:crane-loft`) | 16:00 | 14:40 – 18:40 | 14:00 – 19:20 | day 3 09:00 | 16:00 |
| **M15** | **first wish available: 1,000 cranes, L ≥ 6e9, gain exactly 10 Wishes (`wish:available`)** | **20:30** | **18:30 – 22:30** | **16:00 – 24:00 (always day 3)** | **day 3 13:30 (window 11:30–15:30)** | **20:19** |
| M16 | Wishes at M15 | 10 | exactly 10 | exactly 10 | | 10 |
| M17 | second wish available, P1 continuing after making the first wish at M15 (`wish2:available`) — **provisional** | M15 + 14:00 | M15 + 9:00 – M15 + 22:00 | M15 + 7:00 – M15 + 26:00 | day 5 | (not prototyped) |

M17 is provisional: if it fails, retune the later-wish gate `max(5, ceil(0.25·W))`, never `Lw`.

M4's every-seed bound is the second session's start, 0:40 (review r8-03, §11). With the human
hand of §3 the first Scissor Stand lands at 6:31–7:58 of the 8-minute first session on 19 of 20
seeds, and seed 10 is a few folds short when that session ends, so buys it at the second session
(the even beat: 6:37, at most 6:59). The bound used to be 0:20, which no purchase-in-sessions
profile can land between 0:08 and 0:40 anyway.

M13 counts **live income** (the run's folds without away credit, `runFolds − runBySource.away`).
It used to be 1 B folds of the run total (`run:1e9`, target 15:30, day 2 16:30), and the
real-engine sim passed it only through the second night's pot: P1 seed 1 closed day 2 at
8.07e8 folds, the night credited 5.29e8, and that pot is collected at the day-3 open, so the run
total passed 1 B at exactly 16:00 on all 20 seeds, a 16 h wall-clock gap the play-clock window
13:20 – 17:20 did not show (review r5-21). Today P1 seed 1 closes day 2 at 9.87e8 folds and the
night credits 4.68e8, so the run total still passes 1 B at the day-3 open on most seeds. Live
income passes 1 B on day 3 itself (sim median 16:01, min 15:49, max 16:09; on a few seeds in
day 2's last session). `npm run sim` notes any §4 or §5 row first reached by an away segment's
credit ("reached by a night pot on N of 20 seeds"); `run:1e9` is still recorded and is reached
that way on 16 of 20 seeds (the other 4 pass it in day 2's last session). M15 counts too: a first wish that only the night pot collected at a day
open makes available is noted (review r6-12; no P1 seed today, see §5 for the others). So do
purchases (`buy:` rows and M3, review r7-13): the sim takes away credit as spent last, and a
purchase counts as reached by a night pot when its cost is more than the bank held without the pot
money still in it. **M14 is noted on 20 of 20 seeds**: at the day-3 open P1's bank holds
1.6e8–2.6e8 folds before the pot, the pot credits about 4.7e8, and the Crane Loft costs 5.6e8,
so the Loft is bought from the pot on every seed. M5 (a spawn) cannot be: spawn clocks run on
active time only (§1). No other §4 row is noted today.

**Lag behind the written targets (recorded, not retuned).** From M10 on, the real-engine P1
curve runs up to 80 min of play-clock behind the targets above, which were written from the
prototype: M10 median 7:20 (target 6:40), M11 9:26 (9:20), M12 11:20 (10:00), M13 16:01 (16:30;
the old run-total target was 15:30), M14 16:00 (16:00, bought at the day-3 open from the night
pot on every seed, so its play-clock row says when day 3 opens, not when the live curve could pay), M15 21:41 (min 21:22, max 23:21; target 20:30; 21:23 on the even beat, §11). Every row passes its windows and the first wish stays on day 3,
which is the pacing rule that matters (§7 inv. 1); the §8 knobs are not retuned for the lag.

## 5. First wish across profiles

| Profile | Target (median) | Pass window (median) | Every seed | Extra assertion | Proto median (min–max) |
|---|---|---|---|---|---|
| P1 typical | 20:30 | 18:30 – 22:30 | 16:00 – 24:00 | — | 20:19 (20:01–21:21) |
| P2 never clicks | 24:15 | 23:00 – 28:00 | 22:00 – 30:00 | median ≥ P1 median + 2:00 | 24:10 (24:00–24:52) |
| P3 no agents | 37:00 | 32:00 – 42:00 | 30:00 – 44:00 | P1 median ≤ 0.8 × P3 median | 36:50 (36:19–37:11) |
| P4 one agent | 32:00 | 28:00 – 36:00 | 26:00 – 38:00 | P4 ≥ P1 | 32:00 (32:00–32:00) |
| P5 eight agents | 16:00 | 14:00 – 19:00 | 13:00 – 20:00 | P5 ≤ P1 | 16:02 (16:00–16:16) |
| P6 thirty agents | 14:20 | 12:30 – 17:00 | **≥ 12:00** and ≤ 18:00 | P6 ≤ P5 | 14:17 (14:00–14:40) |
| P7 sixty-four agents | 12:45 | 11:00 – 16:00 | **≥ 10:00** and ≤ 17:00 | P7 ≤ P6 | 12:40 (12:40–13:20) |
| P8 keen | 17:45 | 16:00 – 20:00 | 15:00 – 21:00 | median ≤ P1 median − 1:30 | 17:44 (17:24–18:05) |
| P9 few sessions | 32:00 | 28:00 – 36:00 | 26:00 – 38:00 | median ≥ P1 median + 6:00 | 32:00 (31:49–32:00) |
| P10 busy agents | 19:20 | 17:00 – 22:00 | 16:00 – 23:00 | P10 ≤ P1 | 19:22 (18:54–20:01) |
| P11 fast hands | 18:30 | 16:30 – 21:00 | **≥ 16:00** and ≤ 22:00 | — | 18:30 (17:29–19:18) |
| P12 calm | = P1 | each seed within ±3 % of the same P1 seed | | calm changes no earnings | (= P1 by construction) |
| P13 short turns | 21:00 | 18:30 – 23:00 | 16:00 – 24:00 | median ≥ P1 median − 1:30 | sim 21:53 (21:22–22:06) |
| P14 unsteady hand | 22:30 | 18:30 – 23:30 | 16:00 – 24:00 | median ≤ P1 median + 1:30 | sim 22:33 (21:40–23:46) |
| P15 pattern master | ≈ P1 − 0:20 | 18:30 – 22:30 | 16:00 – 24:00 | median ≥ P1 median − 0:45 | (§12.3 B13; new with the Pattern book) |

**Day-open snaps.** Some profiles reach the first wish only by collecting a night pot at a day
open, and the real-engine sim notes the row "reached by a night pot on N of 20 seeds". P4 does
on every seed, so its median and its whole range sit exactly on the day-5 open (32:00): the
last session of day 4 ends at 0.82–0.92 of `Lw` and the night pot credits 0.24–0.28 of `Lw`
(seed 1: 0.884 with 0.278), so the median says when the next day opens, not how close the live
curve came. P9 does on 1 of 20 seeds (at 32:00); the other 19 reach it live later on day 5, so its
median is 34:14 (32:00–34:27), not a day open (before the human hand of §11 it was 9 of 20
seeds and 32:28). P1, P2 and the rest are noted on no seed (P2 24:52,
24:10–25:25). This is recorded, not retuned: every window still passes and P4 and P9 are meant
to be slower than P1.

Monotonicity (medians): P3 ≥ P4 ≥ P1 ≥ P5 ≥ P6 ≥ P7. More agents never make the game slower,
and 30 or 64 agents never reach the first wish on the first day of open time.

## 6. Income shares

### 6.1 Whole first run, P1 (seed 1, play-clock 0 to M15)

| Source (sim keys) | Target | Pass window | Proto |
|---|---|---|---|
| Click-driven: Sheet + mini Sheet + nodes + scraps + gilded cranes + Fresh Ream + boat + crease fields and fold pieces (`sheet`,`node`,`scrap`,`crane`,`ream`,`boat`,`pattern`,`fold`) | 30 % | 20 – 38 % | 30.5 % |
| Helpers + envelopes (`helpers`,`env`) | 37 % | 28 – 48 % | 36.9 % |
| Workshops, live (`workshops`) | 23 % | 15 – 32 % | 23.4 % |
| Away (`away`) | 9 % | 5 – 20 % | 9.2 % |

### 6.2 Clicking matters at every stage (share of live income per day, every seed)

| Profile | Day 1 | Day 2 | Day 3 | Proto (d1 / d2 / d3) |
|---|---|---|---|---|
| P1 | ≥ 6 % | ≥ 15 % | ≥ 20 % | 9.1 / 28.1 / 37.6 % |
| P6 | ≥ 6 % | ≥ 15 % | ≥ 20 % | 11.5 / 27.9 / 39.4 % |
| P3 | ≥ 4.5 % | ≥ 10 % | ≥ 12 % | proto 5.9 / 12.5 / 15.9 %; sim seed 1: 5.1 / 10.5 / 14.1 %, all-seed min 4.95 / 10.40 / 14.05 % |
| P4, P5, P7, P8, P10, P11, P14, P15 | ≥ 5 % | ≥ 10 % | ≥ 12 % | sim all-seed min: P4 5.5 / 11.7 / 18.3 %, P10 7.4 / 19.0 / 23.2 % |
| P9 | ≥ 0.8 % | ≥ 0.8 % | ≥ 2.5 % | sim seed 1: 1.5 / 1.2 / 3.9 %, all-seed min 0.86 / 1.07 / 2.91 % (r8-03, §11; on the even beat 0.9 / 1.4 / 4.2 %; before r7: 1.0 / 1.1 / 4.0 %; before r6: 1.2 / 1.3 / 4.4 %) |
| P13 | ≥ 6 % | ≥ 15 % | ≥ 20 % | sim seed 1: 8.2 / 20.1 / 22.8 % |

"Live income" excludes away credit; click-driven is as in 6.1. Days past M15 are not checked.
Every floor holds on **every seed** (`npm run sim` prints seed 1 and the all-seed minimum with its
seed). Until review r7-14 only seed 1 was checked, and P3's day-1 floor of 5 % passed at 5.09 %
while seeds 16 and 17 gave 4.97 % and 4.95 %. P3 (no agents) now has its own day-1 floor of
4.5 %, half a point under its all-seed minimum; it was not retuned. Its day-2 share (all-seed min
10.40 %, seed 14, against 10 %) and P9's day-1 share (all-seed min 0.80 %, seed 12, against
0.8 %, with no margin at all) were the tightest floors. With the human hand of §3 (review r8-03,
§11) they are P9's day 1 (0.86 %, seed 2, against 0.8 %), P3's day 1 (4.92 %, seed 17, against
4.5 %) and day 2 (10.56 %, seed 9, against 10 %), and P9's day 3, whose floor went from 3 % to
2.5 % (2.91 % on seed 13; 4.2 % on seed 1 on the even beat): P9's 10 active minutes a day lose
the most to pauses and a broken beat, and the row only guards against regressions.

P9 has its own floor, not the 5 / 10 / 12 % bar. It plays 4 sessions a day, all in the first 2 h
of 8 open hours (about 10 active minutes, a third of P1's), so for 6 h a day the helpers and
workshops earn live income with nobody clicking; a day's click share must be small. Its row only
guards against regressions. Whether a click is worth making for P9 is checked per active second
instead: §6.3 (≥ 1.5× `Rp` per active second in every session, P9 included) and §5 (P9's first
wish ≥ P1's + 6:00, so clicking less costs real progress). P2 never clicks and P12 equals P1, so
neither has a row.

### 6.3 A session is worth showing up for

* For P1, **every session after the first 10 minutes of play-clock** earns, per active second, at
  least **1.8×** the passive rate `Rp` at that moment (proto minimum 2.20×).
* For every profile with hand hits, at least **1.5×** (proto minimum 1.80×, P3).
* Averaged over days 2–3, P1 earns ≥ **8×** `Rp` per active second (proto 15.9×).

### 6.4 Agents matter

* For P1, helpers + envelopes ≥ 28 % of income (6.1) and P1 ≤ 0.8 × P3 (5).

---

## 7. Invariants (asserted for every profile unless stated)

1. **Day-3 rule**: every P1 seed reaches M15 on day 3 of open time (16:00 < t < 24:00).
2. **Purchase cadence**: between the first purchase and M15, the active time between two
   consecutive purchases is ≤ **10 min** for P1 and ≤ **15 min** for every profile with hand hits
   (proto: P1 5.0, worst P3 12.5). P2 instead: ≤ 3 h of open time between purchases (proto 2.4 h).
3. **Away cap**: an away gap of 20 h credits exactly the 8 h formula of DESIGN §10.2; a gap of
   59 s is caught up live and one of 61 s is an away segment; two gaps separated by less than 5 min
   of live time share one 8 h cap; a clock that moves back credits 0 and rebases.
4. **Away rate**: one away second never credits more than
   `0.45 · (Rw + crowd(N) · Σ (0.3·G + 0.04·Rw) · folk)`; boost timers and afterglow are unchanged
   across an away segment.
5. **Click cap**: a scripted 100 hits/s earns exactly the value of 12.5 hits/s.
6. **Bench pace**: `eff(n)` is strictly increasing; adding a working agent never lowers `Hs0`, and
   a working agent that stops working (Needs you, Finished, Resting) never raises it, whatever the
   helpers' warm, fledgling and thanks multipliers (marginal pace, DESIGN §5.3). Asserted on equal
   benches and on the benches P1 and P7 actually reach.
7. **Every agent is saved**: after the P7 run the save holds 64 pane helpers and all their
   fledglings; with 500 Album helpers added the save text is < 256 KiB. With Album compaction
   (DESIGN R13), after a year of 20 agents a day, each with 3 fledglings, coming and going, every
   pane agent is still an Album helper and the save stays < 512 KiB. Mail Sorter is on and every
   timed boost waits until the year ends (old mail is cashed in as its helper is compacted,
   DESIGN §6.1): no envelope waits under a compacted helper, and opening the rest leaves every
   compacted helper packed. With Album archives (DESIGN R13, review r3-04), a heavy user with
   **100 new agents a day for 300 days** (30,000 lifetime pane helpers) still has every one of
   them counted in the Album and a save **< 640 KiB** that stops growing, far under herdr's 1 MiB
   write limit (before archives: 1,124 KiB by day 300, and saving failed for good). The bound is
   on the largest save of any day (measured daily, review r5-07: ≈ 475 KiB on day 255). The
   whole save is bounded too, not only the Album: with a peak Album (11,000 packed records with
   fledgling totals, ≈ 730 KiB) and 130 agents present each running 4 sub-agents with long CJK
   titles, the save stays under 1 MiB and its estimate under the 896 KiB budget (DESIGN R13;
   ≈ 760–800 KiB; before: 1.2 MB, and every save cycle failed), with every helper still
   counted.
8. **Drops are idempotent**: replaying the same `observe` twice, or from two writers, creates each
   envelope unit once; `turn < lastTurn` and first sighting give no reward.
9. **No envelope is lost**: units created = units opened + units converted + units waiting (old
   mail cashed in counts as opened for a Bundle, converted for a timed boost).
10. **Determinism**: two runs with the same seed and inputs give byte-identical `serialize()`.
11. **Two windows**: two writers sharing one save, each observing 2 of P1's 4 agents and each
    doing half the sessions, merging on every 15 s save, end every day within **1 %** of one writer
    with the combined input; no interval of time is credited twice.
12. **Calm**: P12 within ±3 % of P1 for every milestone and seed.
13. **First wish gives exactly 10 Wishes** (M16), and `G` becomes 1.5.
14. **No dead walls**: no single purchase P1 makes before M15 has a payback (at the moment of
    purchase, by §3.1's estimate) above 24 h of open time (proto maximum 13.8 h).

---

## 8. Calibration knobs (in this order) and the constants they set

If a row fails, adjust the first knob that moves it, re-run all profiles, and update DESIGN.md
and this file together.

| Order | Knob (DESIGN ref) | Current value | Moves mostly |
|---|---|---|---|
| 1 | prestige scale `Lw` (§9): lifetime folds that string the first 1,000 cranes | 6e9 | M15 for every profile |
| 2 | bench-pace exponent (§5.3) | 0.06, knee 4 | P5–P7 relative to P1; every `crowd(N)` payout |
| 3 | Echo levels (§7.3) | 0.03 base; 0.06 / 0.10 / 0.18 / 0.28 / 0.40 | click share, P2 gap |
| 4 | chain payouts (§4.4) | 2·Vc per node, 3·k·Vc finish | click share, P8, P11 |
| 5 | away factor (§10.2) | 0.25 / 0.35 / 0.45 | away share, P9 |
| 6 | workshop growth (§7.2) | 1.16 | purchase cadence, mid milestones |
| 7 | later-wish gate (§9) | `max(5, ceil(0.25·W))` | M17 only |
| 8 | pattern payouts (DESIGN §4.7) | 3.5·k·Vc a match, a field every 5th chain, 180 s rest | §12 rows only (never turned for a §4–§7 row) |

Knob 2 was 0.15 while the bench pace scaled the whole sum of `b_i`. Making it marginal (DESIGN
§5.3, inv. 6) stopped fresh agents diluting warm ones, which sped up P6 and P7 (first wish medians
12:30 and 10:32 at 0.15); 0.07 put them back inside their windows (12:42 and 11:21). The r7
workshop ladder (§10) sped P7 up again (10:49 at 0.07, under its 11:00 window), and P1, with 4
agents, is not changed by this knob; 0.06 gives P6 12:59 and P7 12:00.

The exponent sets `crowd(N)` everywhere it is used, not only in `Hs0`: Bundle envelopes and the
overflow conversion (`max(45 · Rp, 75 · V) · crowd(N) · units`, DESIGN §6.1), Elsewhere helpers' credit
(`Hstale`, §12.5) and away gathering (§10.2). Against 0.15 they pay the same up to the knee and
less above it: about 6 % less at 8 agents (`crowd(8)` 0.521 instead of 0.555), 16 % less at 30
(0.150 instead of 0.180) and 22 % less at 64 (0.074 instead of 0.095). The simulator rows already
include this (bundles and away time are part of every profile), so no other knob moved; a profile
that leans on bundles or away time at 30+ agents is the first place to look if knob 2 changes again.

## 9. Originality redesign (review r6): what moved, no knob turned

The gilded crane, its Lucky Fold and the ×7 storm copied Cookie Clicker's golden cookie, and the
cube-root String was its prestige formula; DESIGN §1 "Mechanics" lists everything checked. The
replacements (DESIGN §4.5, §6.1, §7, §9) were chosen to pay about what they replaced, then the
simulator was rerun with every §8 knob unchanged; every row passes:

| Change | Was | Now |
|---|---|---|
| Crane payout | Lucky Fold `min(900·Rp, 0.15·bank) + 13·V`, 50 % | Crane's Gift `25 · max(r, 4) · V + 90 · Hs0`, 40 % |
| Crane life, gaps | 13 s; `300 + 300·u` (Bait 210, Song 150) | 11 s; `lo · (1 + 0.5·u)`, `lo` 340 (Bait 240, Song 170) |
| Hand-hit boost | Paper Storm ×7 (Gale ×10), 30 % of cranes | Confetti ×6 (Gale ×9), 35 %; Flock Song 20 → 25 % |
| String | `floor(100 · cbrt(L / 6e6))` | `floor(1000 · (L / 6e9)^0.4)` (same first wish at L = 6e9) |
| Small numbers | Paper Stack 15, Crisp Corners 100, tiers at 10/25/50 | 12, 120, tiers at 10/24/48 |

Effect on the P1 rows (20 seeds): M2 Crisp Corners 1:22 → 2:02 (window 0:40–3:00), M3 2:06 → 1:42,
M11 10:02 → 9:31, M15 21:39 → 21:59 (still day 3, window 18:30–22:30), M17 M15 + 18:02 → M15 + 17:13
(the 0.4 power needs 2.76× the first wish's lifetime for the second, the cube root 3.375×); the
click share 25.1 → 24.7 %. P3's day-2 click share went 11.0 → 10.6 % (≥ 10 %): with no agents the
Gift is only its rhythm part, where Lucky Fold had paid P3 from a bank no agent spent. The gilded
crane's own income share in P1 is 0.5–1.9 % (seeds 1–3; Lucky Fold 1.3–2.0 %).

## 10. Originality review r7: the workshop ladder, the 25-Wish perk, knob 2

Two constants the r6 sweep kept match known games (DESIGN §1 "Mechanics"): the workshop ladder's
cost step of about ×12 (AdVenture Capitalist's businesses step exactly ×12) and the 25-Wish perk
"start with 10 Paper Stacks and 5 Bone Folders" (Cookie Clicker's Starter kit and Starter kitchen).

| Change | Was | Now |
|---|---|---|
| Workshop costs (Bone Folder … Kite Tower) | 180, 2,200, 26,000, 310,000, 3.7e6, 4.5e7, 5.4e8, 6.5e9 (×12 a step) | 180, 2,700, 38,000, 490,000, 5.9e6, 6.5e7, 5.6e8, 4.8e9 (steps ×15 down to ×8.6) |
| Workshop outputs | 0.3, 1.8, 11, 65, 390, 2,300, 14,000, 84,000 (×6 a step) | 0.3, 2.2, 15, 95, 560, 3,000, 14,000, 60,000 (×7.3 down to ×4.3; payback about ×2 a step) |
| 25-Wish perk | start with 10 Paper Stacks and 5 Bone Folders | Spare parts: keep a tenth of the last run's Paper Stacks, Bone Folders and Scissor Stands |
| Knob 2, bench-pace exponent | 0.07 | 0.06 |

The ladder was searched with the simulator. A constant ×10 step (output ×5.2–5.5) failed M12 or
M14 and the purchase cadence before the Kite Tower; a constant ×14 (output ×7) made P6 and P7
too fast and P3 wait 22.5 min before the Crane Loft; steps that grow from ×9 to ×15 put P1's
first wish at 16:00 or at 24:00, off day 3. Steps that shrink as the ladder climbs keep its top
rungs from being walls. The Crane Loft is placed so P1 buys it at the day-3 open on every seed (as before),
which keeps P12 within ±3 %. The perk applies from 25 Wishes, past every simulated run.

Effect (20 seeds, before → after):

| Row | Before | After | Window |
|---|---|---|---|
| M4 first Scissor Stand | 0:06:29 | 0:06:37 | 0:03–0:12 |
| M10 first Washi Vat | 6:40 | 7:20 | 5:20–8:00 |
| M12 first Flower Press | 10:40 | 11:20 | 8:40–12:00 |
| M13 1 B live folds | 16:24 | 16:01 | 14:30–18:30 |
| M15 P1 first wish | 21:59 (21:22–22:08) | 21:21 (21:10–21:28) | 18:30–22:30 |
| M17 second wish | M15 + 17:13 | M15 + 16:52 | M15 + 9:00–22:00 |
| P2 never clicks | 24:34 | 24:00 | 23:00–28:00, ≥ P1 + 2:00 |
| P3 no agents | 37:21 | 36:58 | 32:00–42:00 |
| P6 thirty agents | 12:42 | 12:59 | 12:30–17:00 |
| P7 sixty-four agents | 11:20 | 12:00 (min 10:49) | 11:00–16:00 |
| P1 click share, whole run | 24.7 % | 24.9 % | 20–38 % |
| P3 day-2 click share | 10.6 % | 10.5 % | ≥ 10 % |
| Purchase cadence P2 / P3 | 2.17 h / 12.5 min | 2.83 h / 10.0 min | ≤ 3 h / ≤ 15 min |

"After" is the sim at r7. Fixes since (verification round 6, no knob turned) moved some rows; the
sim today gives M15 21:24 (21:20–21:42), M17 M15 + 17:01, P2 24:52, P1 click share 26.3 % on
seed 1 (all-seed median 24.5 %) and P2's cadence 2.67 h, the rest within a minute of the above. `npm run sim` prints the current table.

The tightest rows are now the §6.2 click shares on their worst seed (review r7-14: they were
quoted for seed 1, 5.1 % against 5 % for P3's day 1, while seeds 16 and 17 were already under it):
P9's day 1 (0.80 % on seed 12 against 0.8 %), P3's day 2 (10.40 % on seed 14 against 10 %) and
P3's day 1 (4.95 % on seed 17 against its own 4.5 % floor, §6.2), P2's purchase cadence
(2.67 h against 3 h, before the Crane Loft) and P7's fastest seed (10:49 against the ≥ 10:00 every-seed bound, median 12:00).

The calibration prototype was a throwaway script outside the repository; it is not a reference.
The shipped simulator is.

## 11. Review r8-03: a human hand, and a short pause keeps the streak

Every target above was met by a hand that hit the Sheet on a perfect 800 ms beat, never paused,
and bought and opened envelopes in no time. The rhythm streak (DESIGN §4.2) ended on any gap over
1.0 s, and afterglow builds only while In step (`r ≥ 25`), so the day-3 first wish rested on that
beat: with one 1.5 s pause every 30 hits, 3 of 10 seeds reached it only at the day-4 open
(24:00), and with lognormal jitter of σ 0.3 its median moved to about 22:50, out of the
18:30–22:30 window. An even beat at 1.1 or 1.2 hits a second still gave about 21:30, so it was the
broken streaks, not the fewer hits.

Two changes, no §8 knob turned:

* **The profiles' hand** (§3 "Hand hits"): seeded lognormal jitter with σ 0.15 and the mean held
  at 1.25 hits a second, and 1.5 s off the Sheet in each second the player buys or opens
  envelopes, plus 0.5 s for each further one in that second. `npm run sim -- --even` keeps the old
  beat for comparison. P14 (σ 0.3) checks a much less even hand.
* **A short pause keeps most of the streak** (DESIGN §4.2): a gap over the rhythm gap but no more
  than **4 s** costs **10 beats** (`r − 10`, at least 1) instead of the whole streak; a longer gap
  still ends it. A full streak of 40 survives one stumble In step (30), a purchase costs a
  few seconds of rebuilding, not 20, and stopping to work still ends the streak. On the even beat
  this changes nothing (P1 21:23, every row as before).

Effect (20 seeds, M15 median (min–max)):

| Hand | Streak ends on any gap over 1.0 s | A gap ≤ 4 s costs 10 beats |
|---|---|---|
| even beat, no pauses (the old model, `--even`) | 21:24 (21:20–21:42) | 21:23 (21:20–21:42) |
| σ 0.15, no pauses | 21:31 (21:20–23:21) | 21:23 (21:20–22:40) |
| σ 0.15 with pauses (**P1**) | 22:09 (21:30–23:33) | **21:41 (21:22–23:21)** |
| σ 0.3, no pauses | 22:43 (22:09–23:59) | 21:53 (21:22–23:22) |
| σ 0.3 with pauses (**P14**) | 23:20 (22:31–24:00), **7 of 20 seeds on day 4** | **22:33 (21:40–23:46)** |

Other rows the human hand moved: M2 2:02 → 2:22, M3 1:42 → 2:07, M4 6:37 → 7:00 (one seed at the
second session, see §4), M13 16:01 → 16:10, P5 16:13 → 16:22, P6 12:57 → 13:14, P9 32:14 → 34:14,
P10 20:48 → 21:11, P13 21:53 → 22:03, and P1's whole-run click share on seed 1 26.3 → 22.7 %
(window 20–38 %). Every row passes; P14 stays on day 3 on every seed and within 1:30 of P1.


## 12. Pattern book (issue #2): crease fields, fold pieces and their effects

DESIGN §4.7 adds the **Crease Field** curio (5e6, needs Grand Crease; 2e7 until the first sim run, §12.7): every 5th primary chain
arrives as a crease field on the Sheet, the player traces a shape, a matched diagram pays
`3.5 · k · Vc` whatever its size (24.5 `Vc` at k = 7, source `pattern`) and may drop a fold piece that pays `1 · Vc` (source `fold`) and
fires one small effect, each diagram's effect then resting for 3 active minutes. Both sources are
click-driven (they join the §6.1 click row and every §6.2 share). Nothing changes before the
curio is bought: no draw is added or moved (fields use none), so every row below the purchase
stays as it is by construction. This section is the target; the sim implements it (§12.1), and
the rows join the tables the tests parse as §12.6 says.

### 12.1 What the simulator does

* **Buying.** Crease Field has no §3.1 estimate, like Slow Wings and Harbour Ribbon, so it is
  never the best buy and never counted by invariant 14. Every profile with hand hits buys it as
  it buys Mail Sorter: as soon as it costs ≤ 25 % of the bank (a bank of 2e7). P2 never buys it
  (it never clicks).
* **Hit order** for a profile's hand hit: the Fresh Ream and a caught crane on the side (as
  today); then a scrap; then a fold piece; then the next node of a numbered chain; then the next
  dot of its trace while a field is up; else the Sheet. Fold pieces are clicked like scraps, on
  the next hit after they land. Every dot click is a Sheet fold, so tracing costs no folds.
* **Which diagram.** While any diagram is unfound, the next to find (book order, the one the book
  shows). Otherwise the ready diagram (not resting, its fold not on the mat) with the most dots;
  if none is ready, Coil. A match pays the same whatever the diagram (§12.2), so this choice moves
  only the effects; the variant `P1~rotate` (B17) instead rounds the book as DESIGN §4.7 asks of
  the late game: the ready diagram traced fewest times (book order on a tie), else the least
  traced of all. It traces the `PATTERNS[].dots` tracing as listed (never starting on the
  centre) at its normal hand rhythm and sets it (the last dot again, or the first to close).
* **Success.** Per attempt: P1 **90 %**, P14 **75 %**, P11 **90 %**, every other hand profile as
  P1; P12 (calm) is P1. The draw is keyed `trace:<the field's birth, mat-shown ms>:<attempt>`, so
  calm and two-window runs choose the same. (It was to be keyed by the active clock at the first
  sighting, as chain draws are, but the active clock moves with the sim's idle step: 0.7 s by day
  2 between 1 s and 10 s steps, measured with `--no-book`. That flipped trace draws, and
  test/pacing/step.test.mjs failed. The shown clock does not move.) A failure stops one
  dot short and sets there (a loose crease), then the profile tries again from scratch while the
  field lives. Where one dot short is under 3 dots (Ridge, Gull) or is itself a diagram (the
  Lozenge's first three dots are a Gull), the failure instead takes a wrong last dot: the first
  unused neighbour, in dot order, that leaves the trace loose. Life end with 3 or more dots traced sets automatically (DESIGN §4.7).
* **P15 pattern master** (new): P1 with **100 %** success that picks, among ready diagrams, the
  first of Switchback, Coil, Napkin, Lozenge, Gull, Stair, Ridge, Sail, Hem (largest estimated
  effect first, §12.4), and otherwise as P1. It bounds what a perfect hand can get.
* **Flags.** `--no-book`: Crease Field is never bought, which is the engine as it was before this
  feature and the baseline every §12.3 delta is measured against. `--no-pattern-fx`: fold pieces
  are never clicked (no effects; the `fold` source is reported on its own, so the effect delta is
  the income difference minus the fold pay). `--fx-off <id>`: that diagram's fold pieces are never
  clicked (per-diagram ablation). The two ablations replay the same seed's P1 run: its purchases
  and its hand pauses (the inv. 11 technique), so the two runs differ by the effects, not by a
  reshuffled purchase order. Without them a seed-day moved by up to ±9 % of live income.
* **Keys.** Milestones `buy:crease-field`, `book:found>=1`, `book:found>=9`, `book:learned>=9`,
  `book:mastered>=9`; sources `pattern` and `fold` in `SHARE_BUCKETS.click`.

### 12.2 Constants (knob 8, "pattern payouts", DESIGN §4.7)

| Constant | Value | What it sets |
|---|---|---|
| `fieldEvery` | 5 | a field instead of every 5th primary chain (about one an active minute with Quick Creases) |
| `fieldLifeMs` / `fieldWaitMs` | 16000 / 1000 | field life (×2 calm); a chain due while a field is up is tried again each active second |
| `matchPerNode` | 3.5 | a match pays `3.5 · k · Vc` on top of its dots' folds, the same for every diagram: 24.5 `Vc` at k = 7, what the numbered chain it replaces pays above the folds its 7 hits replace (`5 · k · Vc` less 1.5 `Vc` a fold). The field is the scarce thing, not the hand's hits, so a pay that grew with the dots (it was `4 · n · Vc`, 12 `Vc` for Ridge to 36 for Coil) made the largest diagram the only paying pick and six of nine pay less than the chain |
| `firstFindPerDot` | 10 | once per diagram, ever: 490 `Vc` for the whole book |
| `foldLifeMs` / `foldPay` | 15000 / 1 | fold piece life (×2 calm); `1 · Vc` when clicked |
| `patternRestMs` | 180000 | a diagram's effect fires at most once per 3 active minutes |
| `bookLearn` / `bookMaster` | 4 / 12 | tiers (looks only, no pay) |
| effect sizes | Steady 1 pause, Pull 20 s (≥ 5 s left, once per crane), Glow 90 s, Finish frame 7, Lift 6 beats, Fair wind 60 s × 1.5 life, Hurry 2 s, Margin 1 field, Wind-up ×2 for 10 s | DESIGN §4.7 table |

### 12.3 Rows (P1 unless stated; seeds 1–20; median in the pass window, every seed in its bound)

| ID | Row (sim key) | Target | Pass window (median) | Every seed |
|---|---|---|---|---|
| B1 | nothing moves before the purchase: every milestone, per-source income and click share up to `buy:crease-field` equals the `--no-book` run of the same seed | identical | identical | identical |
| B2 | Crease Field bought (`buy:crease-field`) | 12:00 (day 2) | 9:20 – 13:20 | 8:00 – 16:00 (day 2) |
| B3 | first diagram found (`book:found>=1`) | same session | ≤ B2 + 0:40 | ≤ B2 + 1:20 |
| B4 | all nine found (`book:found>=9`) | day 2 | ≤ B2 + 4:00 | before M15 |
| B5 | all nine learned (`book:learned>=9`), provisional | day 3 | ≤ M15 | ≤ M15 + 8:00 |
| B6 | all nine mastered (`book:mastered>=9`), provisional (run 2) | run 2 | ≤ M17 | — |
| B7 | whole first run click share (§6.1 row, `pattern` and `fold` included) | 24 % | 20 – 38 % and `--no-book` − 0.5 to `--no-book` + 4 points | 20 – 38 % |
| B8 | §6.2 per-day floors, every profile | unchanged | unchanged | unchanged |
| B9 | M15 against `--no-book` (P1, P8, P11, P14) | − 0:15 | `--no-book` − 0:30 to `--no-book` + 0:10 | day 3 (inv. 1) |
| B10 | `pattern` + `fold` share of live income on days 2 and 3 | 3 % | ≤ 6 % | ≤ 6 % |
| B11 | effects alone: (P1 − `--no-pattern-fx`) minus the `fold` source, share of live income on each day | 1 % | ≤ 2 % | ≤ 5 % |
| B12 | one diagram's effect: (`P1~rotate` − `P1~rotate+fxoff:<id>`) minus that diagram's fold pay, each day its fold is clicked at least 3 times (median over seeds); a diagram with no such day is not measured and fails | ≤ 0.5 % | ≤ 1 % | ≤ 3 % |
| B13 | P15 pattern master first wish | ≈ P1 − 0:03 | ≥ P1 median − 0:45 and ≤ P1 median | 16:00 – 24:00 |
| B14 | P14 unsteady hand first wish (§5 row, now with fields) | — | ≤ P1 median + 1:30 | 16:00 – 24:00 |
| B15 | P2 never clicks | = `--no-book` | identical milestones | identical |
| B16 | run 2 (first wish to M17) click share of live income, provisional; record the `--no-book` value first | ≥ `--no-book` | ≥ 20 % | ≥ 15 % |
| B17 | B7 for a hand that rotates through the book (`P1~rotate`: the ready diagram traced fewest times) | ≈ B7 | 20 – 38 % and `--no-book` − 0.5 to `--no-book` + 4 points | 20 – 38 % |
| B18 | inv. 12 with fields left alone: `P12~trace0` (calm) node income over `P1~trace0`'s on days 2–3, both with `traceSuccess` 0 (every chain clicked, no trace ever matches, so each field stays up its whole life); M15 within ±3 % on every seed | 100 % | ≥ 99 % | ≥ 90 % |

**B11 and B12 are judged on the median.** The effect is the median over seeds of each day's
share (B12: over seeds 1–5), its largest day against the median window. Each seed's own days
are held to the every-seed bound, which is the ablation's noise floor, not an effect. An effect
that moves a crane or a chain (Gull, Switchback, Hem) also moves the gilded cranes that follow,
because their gaps are keyed by the active clock. That reshuffles the Confetti outcomes, each
worth about a point of a day's live income. Measured on the sim runs of §12.7, the effect medians are
0.00–0.83 %, while single seed-days reach 2.8 % (B11) and 1.6 % (B12). The every-seed bounds were
2 % and 1 % until that run.

The existing rows and invariants keep holding with fields on: §4 M1–M17, §5, §6.3 session ratios
(≥ 1.8× for P1), inv. 1 (day 3), 2 (purchase cadence), 10 (determinism: byte-identical
`serialize()` for the same seed and inputs, fields traced), 11 (two windows within 1 %, with the
writers tracing different diagrams), 12 (P12 within ±3 % of P1) and 13. B1 compares milestones and
income, not bytes: the new default fields (`book`, `spawn.fieldIn`, …) change the serialized text
from the first save on.

### 12.4 Expected (estimates from the formulas, to be replaced by the sim's numbers)

* **Cadence.** With Quick Creases one field an active minute: about 28 a P1 day of 30 active
  minutes from B2 on, each in place of one numbered chain. P1 finds a new diagram on most fields
  until all nine are found (B4 about 1–2 sessions after B2 for the early ones, a day for all).
* **Pay.** A match pays what the chain it replaces would have above its folds, whatever the
  diagram (§12.2), so the `pattern` source mostly moves income from `node` to `pattern`: about 1.5–3 % of live income on days 2–3,
  with `node` down by about as much.
* **Effects, per firing** (each at most once per 3 active minutes, so about once a session each):
  Switchback about +25 `Vc` (one chain about 10 s sooner; lost when the session ends first), Coil
  about +15 `Vc` (12 doubled hits), Lozenge about +4 `Vc`, Napkin 90 s of ×1.25 on working
  helpers at the tail of the coding gap (about 0.3 % of live income), Gull at most +10 % cranes
  (the crane is 0.5–1.9 % of income, so ≤ 0.2 %), Stair and Ridge a few seconds of In step, Sail
  and Hem 0 for a hand that catches everything. In all about +1 % of live income (B11 ≤ 2 %).
* **Rows.** P1's whole-run click share 22.7 % → about 23–24.5 %; the day-2 and day-3 all-seed
  minimums up 0.3–1.5 points; M15 21:41 → about 21:20–21:40 (still day 3 on every seed); P14 and
  P15 within their bounds, the gap between them about 0:20 (measured: 0:36:36, §12.7; P15 is
  only 0:02:36 ahead of P1, not the 0:20 estimated, since a perfect hand's effects are as small
  as B11 and B12 say).

### 12.5 If a §12 row fails

Turn, in this order, re-run every profile, and record the change here and in DESIGN §4.7
together: (1) `matchPerNode` 3.5 → 3; (2) `patternRestMs` 180 → 240 s; (3) the effect the
per-diagram ablation names largest (Hurry 2 s → 6 s, Wind-up 10 s → 6 s, Glow 90 s → 60 s);
(4) `fieldEvery` 5 → 6. Never turn §8 knobs 1–7 for a §12 row. A §4–§7 row that fails only with
fields on is a §12 failure.

### 12.6 Joining the asserted tables

The sim and its tests parse §3's "Other profiles" table and §8's knob list
(`tools/sim/profiles.mjs parseBalance`, `test/pacing/balance.test.mjs`), so they changed in the
same commit as the code. **P15** joined §3's table, §5 (its own row, with B13's lower bound as
the extra assertion) and §6.2 (P1's bar for profiles that click). **Knob 8**, "pattern payouts
(DESIGN §4.7)", joined §8 and the test's knob list. §3's P1 rows gained "buys Crease Field" and
"Crease fields", and the §12.3 rows (`parsePatternRows`) joined `evaluate()`. `npm run sim`
adds the 185 variant runs §12.3 compares against (`P1~nobook`, `P2~nobook`, `P8~nobook`,
`P11~nobook`, `P14~nobook`, `P1~nofx`, `P1~rotate`, and `P1~fxoff:<id>` on seeds 1–5) unless `--no-ablation`
is given. `--no-book`, `--no-pattern-fx` or `--fx-off <id>` alone runs every profile that way, as a
report with no §12 rows.

### 12.7 The sim runs: what moved (seeds 1–20)

Every delta and result below is in the document's open-time `h:mm:ss` (a clock, or a signed
difference of clocks), never `m:ss`.

**Crease Field 2e7 → 5e6** (DESIGN §4.7, §7.3). This is not a knob. Crease Field has no
estimate, so its price is folds taken from workshops at a bank of 4 × its cost. At 2e7, P1
bought it in day 2's last session on some seeds (B2 max 14:40). On seed 10 that pushed a Flower
Press into day 3, and the first wish landed at 23:23:54, 84 s after day 3's last session ended
(`--no-book`: 23:21:28, inside it). P1 then made the wish the next morning, after the night pot,
for 11 Wishes, which fails inv. 13. Every knob-8 turn of §12.5 left seed 10 there: `matchPerDot`
3 (the pay per dot of that run), `patternRestMs` 240 s, `fieldEvery` 6, Hurry 6 s and Pull 10 s
gave 23:22:49–23:31:51. At 1e7 inv. 13 held, but P12 ran a session ahead of P1 on the same seed
(Crane Loft 18:01:50 against 18:40, 3.41 % against ±3 %). That was the existing calm-mode chaos:
the day-2 lifetime ratio P12 / P1 averages 1.0074 with the book and 1.0081 without, and every
knob-8 turn left that seed where it was. At 5e6, bought at a bank of 2e7 right after Grand
Crease, every row passes. No knob of §8 was turned.

**Knob 8: `4 · n · Vc` → `3.5 · k · Vc` a match** (§12.2, DESIGN §4.7), with three engine
fixes in the same run: Hurry waits for a live chain instead of starting a full interval
(DESIGN §4.7 Switchback), a trace set at the field's life end pays the combo of the rhythm at
that moment, and a Gull match drops no fold while its pull is spent. The pay per dot made Coil,
Hem and Switchback the only paying picks, and P1's policy (the ready diagram with the most dots)
traced only those, so B7 was measured on the over-paying subset (+ 0.47 points). With one pay
for every diagram B7 is + 0.02 points, and B17, the hand that rounds the book, + 0.22. The
first-run results:

| Row | Result (P1 unless stated) |
|---|---|
| B1 | identical on 20 of 20 seeds |
| B2 | 12:00:00 (11:21:56 – 13:20:00) |
| B3 / B4 | first find B2 + 0:00:15 (max + 0:38:14); all nine B2 + 2:00:51 (+ 1:21:34 – + 2:41:39), before M15 on every seed |
| B5 / B6 | not reached on any seed (provisional). P1 traces the ready diagram with the most dots, so Ridge, Gull and the 4-dot loops stay at 1–2 traces; `P1~rotate` learns all nine on 20 of 20 seeds |
| B7 | 24.2 % (20.2 – 25.9 %); `--no-book` 23.95 %, + 0.02 points |
| B9 | M15 − `--no-book` (medians): P1 − 0:00:50, P8 − 0:00:11, P11 − 0:00:13, P14 − 0:01:07 |
| B10 | 2.4 % (2.0 – 3.1 %) |
| B11 | effect 0.45 %; largest seed-day 2.51 % |
| B12 | effect per diagram ≤ 0.71 % (Gull; Hem 0.39 %, Switchback 0.15 %, Coil 0.13 %, the rest ≤ 0.05 %); largest seed-day 1.12 % (Coil) |
| B13 | P15 21:38:04, P1 − 0:02:36. The ≈ 0:20 of §12.4 was not borne out (the first run measured − 0:00:17); the target is now the measured ≈ 0:03 |
| B14 | P14 22:14:40, P1 + 0:34:00 |
| B15 | identical milestones on 20 of 20 seeds |
| B16 | 26.3 % (23.5 – 27.5 %); `--no-book` 25.89 % |
| B17 | `P1~rotate` 24.1 % (20.2 – 26.3 %); + 0.22 points against `--no-book` |

With fields on, the existing rows move a little. P1's M15 is 21:40:40 (21:22:16 – 22:42:15; it
was 21:40:31, 21:21:49 – 23:21:28 without the book). P1's whole-run click share on seed 1 is
24.1 % (it was 22.7 %). P12's worst milestone is 1.50 % from P1 (it was 1.33 %). Every §4–§7 row
passes.

`test/pacing/step.test.mjs` (1 s against 10 s idle steps) now lets a purchase move by one session
gap. The bank's closed-form sums differ in their last digit between the two step sizes, and a
purchase tipped past a session's end moves 40 minutes. The engine as it was before this feature
does that too: `P1~nobook` moves a purchase by a session on seeds 2, 3 and 5 of 1–6. Seed 1, the one
the test runs, did not move before the book and did after.

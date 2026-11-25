# Creaseworks: balance target

This file is the written target that `tools/sim/pacing.mjs` asserts (ARCHITECTURE A11) and
`test/pacing/*.test.mjs` parse. Every formula and constant it depends on is in `docs/DESIGN.md`
§4–§10; the two files change together. The numbers in the "proto" columns come from a calibration
prototype of the DESIGN formulas (1 s steps, the profiles below, 20 seeds). The shipped simulator
replaces it and drives the **real engine** (`engine.apply` / `engine.advance`) through the same
profiles. With the §8 knobs at their current values it passes every row below (P1 first wish
median 21:39, min 21:21, max 22:07; run `npm run sim` for the full table).

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
* Shares and invariants are computed on seed 1 unless the row says "all seeds".

---

## 3. Player profiles (exact parameters)

### P1 typical (the reference profile)

| Parameter | Value |
|---|---|
| Open time | 8 h a day, 09:00–17:00; 16 h away each night (credited 8 h) |
| Sessions | **12 a day**, starting at open-time 0:00, 0:40, 1:20, … 7:20 of each day; each **2.5 min**; the very first session ever lasts **8 min**. 30 active min a day |
| Hand hits | **1.25 per second** on the Sheet during a session |
| Chains | when a chain is up, the next hits click its nodes in order; success **95 %** per chain (a failure is one out-of-order hit, then the chain tears) |
| Scraps | every scrap is clicked when it spawns |
| Gilded cranes | **80 %** caught (seeded) |
| Fresh Ream | collected at the first session of each day from day 2 |
| Envelopes | at each session start: open every Bundle; then, for each boost type not running, open the one with the largest stack; other boost envelopes wait |
| Buying | "cheapest payback first" (§3.1), evaluated every second of a session |
| Automations | buys **Mail Sorter** and **Thrifty Fox** as soon as each costs ≤ 25 % of the bank and keeps them on; never buys Boost Keeper or Crease Helper |
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

---

## 4. Milestones, P1

| ID | Event (sim key) | Target | Pass window (median) | Every seed | Wall-clock target | Proto median |
|---|---|---|---|---|---|---|
| M1 | first Paper Stack (`buy:paper-stack`) | 0:00:10 | 0:00:03 – 0:00:30 | ≤ 0:01:00 | day 1 09:00 | 0:00:06 |
| M2 | first upgrade, Crisp Corners (`buy:crisp-corners`) | 0:01:10 | 0:00:40 – 0:03:00 | ≤ 0:05:00 | day 1 09:01 | 0:01:06 |
| M3 | 10 workshops owned (`own:workshops>=10`) | 0:02:00 | 0:01:00 – 0:04:00 | ≤ 0:06:00 | day 1 09:02 | 0:01:48 |
| M4 | first Scissor Stand (`buy:scissor-stand`) | 0:06:00 | 0:03:00 – 0:12:00 | ≤ 0:20:00 | day 1 09:06 | 0:06:00 |
| M5 | first gilded crane spawns (`spawn:crane#1`) | 0:06:30 | exactly 390 active s | exactly 390 active s | day 1 09:06 | 0:06:30 |
| M6 | first Glue Pot (`buy:glue-pot`) | 1:20 | 0:40 – 2:00 | 0:30 – 2:40 | day 1 10:20 | 1:20 |
| M7 | first automation, Mail Sorter (`buy:mail-sorter`) | 2:00 | 1:20 – 3:20 | 0:40 – 4:00 | day 1 11:00 | 2:00 |
| M8 | first Fold Bench (`buy:fold-bench`) | 3:20 | 2:00 – 4:40 | 1:20 – 5:20 | day 1 12:20 | 3:20 |
| M9 | 1 M folds this run (`run:1e6`) | 3:20 | 2:20 – 4:20 | 1:40 – 5:00 | day 1 12:20 | 3:18 |
| M10 | first Washi Vat (`buy:washi-vat`) | 6:40 | 5:20 – 8:00 | 4:40 – 8:40 | day 1 15:40 | 6:40 |
| M11 | 100 M folds this run (`run:1e8`) | 9:20 | 8:00 – 11:20 | 7:20 – 12:00 | day 2 10:20 | 9:22 |
| M12 | first Flower Press (`buy:flower-press`) | 10:00 | 8:40 – 12:00 | 8:00 – 12:40 | day 2 11:00 | 10:01 |
| M13 | 1 B folds this run (`run:1e9`) | 15:30 | 13:20 – 17:20 | 12:40 – 18:00 | day 2 16:30 | 15:29 |
| M14 | first Crane Loft (`buy:crane-loft`) | 16:00 | 14:40 – 18:40 | 14:00 – 19:20 | day 3 09:00 | 16:00 |
| **M15** | **first wish available: 1,000 cranes, L ≥ 6e9, gain exactly 10 Wishes (`wish:available`)** | **20:30** | **18:30 – 22:30** | **16:00 – 24:00 (always day 3)** | **day 3 13:30 (window 11:30–15:30)** | **20:19** |
| M16 | Wishes at M15 | 10 | exactly 10 | exactly 10 | | 10 |
| M17 | second wish available, P1 continuing after making the first wish at M15 (`wish2:available`) — **provisional** | M15 + 14:00 | M15 + 9:00 – M15 + 22:00 | M15 + 7:00 – M15 + 26:00 | day 5 | (not prototyped) |

M17 is provisional: if it fails, retune the later-wish gate `max(5, ceil(0.25·W))`, never `Lw`.

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

Monotonicity (medians): P3 ≥ P4 ≥ P1 ≥ P5 ≥ P6 ≥ P7. More agents never make the game slower,
and 30 or 64 agents never reach the first wish on the first day of open time.

## 6. Income shares

### 6.1 Whole first run, P1 (seed 1, play-clock 0 to M15)

| Source (sim keys) | Target | Pass window | Proto |
|---|---|---|---|
| Click-driven: Sheet + mini Sheet + nodes + scraps + gilded cranes + Fresh Ream + boat (`sheet`,`node`,`scrap`,`crane`,`ream`,`boat`) | 30 % | 20 – 38 % | 30.5 % |
| Helpers + envelopes (`helpers`,`env`) | 37 % | 28 – 48 % | 36.9 % |
| Workshops, live (`workshops`) | 23 % | 15 – 32 % | 23.4 % |
| Away (`away`) | 9 % | 5 – 20 % | 9.2 % |

### 6.2 Clicking matters at every stage (share of live income per day, seed 1)

| Profile | Day 1 | Day 2 | Day 3 | Proto (d1 / d2 / d3) |
|---|---|---|---|---|
| P1 | ≥ 6 % | ≥ 15 % | ≥ 20 % | 9.1 / 28.1 / 37.6 % |
| P6 | ≥ 6 % | ≥ 15 % | ≥ 20 % | 11.5 / 27.9 / 39.4 % |
| P3, P4, P5, P7, P8, P10, P11 | ≥ 5 % | ≥ 10 % | ≥ 12 % | P3: 5.9 / 12.5 / 15.9 % |
| P9 | ≥ 0.5 % | ≥ 0.5 % | ≥ 2 % | sim seed 1: 1.2 / 1.3 / 4.4 % (20 seeds 0.9–1.3 / 1.0–1.7 / 3.5–4.7 %) |

"Live income" excludes away credit; click-driven is as in 6.1. Days past M15 are not checked.

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
   pane agent is still an Album helper and the save stays < 512 KiB.
8. **Drops are idempotent**: replaying the same `observe` twice, or from two writers, creates each
   envelope unit once; `turn < lastTurn` and first sighting give no reward.
9. **No envelope is lost**: units created = units opened + units converted + units waiting.
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
| 1 | prestige scale `Lw` (§9) | 6e6 | M15 for every profile |
| 2 | bench-pace exponent (§5.3) | 0.07, knee 4 | P5–P7 relative to P1 |
| 3 | Echo levels (§7.3) | 0.03 base; 0.06 / 0.10 / 0.18 / 0.28 / 0.40 | click share, P2 gap |
| 4 | chain payouts (§4.4) | 2·Vc per node, 3·k·Vc finish | click share, P8, P11 |
| 5 | away factor (§10.2) | 0.25 / 0.35 / 0.45 | away share, P9 |
| 6 | workshop growth (§7.2) | 1.16 | purchase cadence, mid milestones |
| 7 | later-wish gate (§9) | `max(5, ceil(0.25·W))` | M17 only |

Knob 2 was 0.15 while the bench pace scaled the whole sum of `b_i`. Making it marginal (DESIGN
§5.3, inv. 6) stopped fresh agents diluting warm ones, which sped up P6 and P7 (first wish medians
12:30 and 10:32 at 0.15); 0.07 puts them back inside their windows (12:42 and 11:21).

The calibration prototype was a throwaway script outside the repository; it is not a reference.
The shipped simulator is.

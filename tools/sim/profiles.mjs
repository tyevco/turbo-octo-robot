// Player profiles (docs/BALANCE.md §3) and the parser for the targets the
// pacing simulator asserts (BALANCE §2, §4-§7). Development tooling only.
//
// The profiles are code (BALANCE §3 is prose plus a table of differences);
// every number checked against them is parsed from BALANCE.md, so a retune of
// a window there is picked up without touching this file.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const BALANCE_PATH = path.join(ROOT, "docs/BALANCE.md");

// ---------------------------------------------------------------------------
// Profiles (BALANCE §3). Times in seconds unless the name says otherwise.

/** P1, the reference profile (BALANCE §3 "P1 typical"). */
export const P1 = Object.freeze({
  id: "P1",
  name: "typical",
  openHours: 8, // 09:00-17:00; 16 h away each night (credited 8 h)
  sessionsPerDay: 12,
  sessionGap: 40 * 60, // sessions start at open-time 0:00, 0:40, 1:20, ...
  sessionSec: 150, // 2.5 min
  firstSessionSec: 480, // the very first session ever: 8 min
  hands: true,
  cps: 1.25, // hand hits per second during a session
  chainSuccess: 0.95,
  craneCatch: 0.8,
  scraps: true,
  ream: true, // collected at the first session of each day from day 2
  agents: 4,
  // Agent i: hourly cycle offset (997·i) mod 3600 s: `blocks` × [work, needs] then rest (minutes).
  cycle: Object.freeze({ work: 12, needs: 2, blocks: 3, rest: 18 }),
  kidShare: 0.25, // one working fledgling during the first 25 % of each working block
  freshKids: false, // true or n: every block starts 1 (or n, one after another) new sub-agents (new addresses), gone when the block ends
  calm: false,
  buyEvery: null, // null = every second of a session (§3.1); P2: every 5 min of open time
  autoBuy: Object.freeze(["mail-sorter", "thrifty-fox"]),
  autoShare: 0.25, // bought as soon as cost ≤ 25 % of the bank
  neverBuy: Object.freeze(["slow-wings", "harbour-ribbon", "boost-keeper", "crease-helper"]),
});

const p = (id, name, change) => Object.freeze({ ...P1, id, name, ...change });

/** Every profile, P1-P13 (BALANCE §3 "Other profiles"). */
export const PROFILES = Object.freeze({
  P1,
  P2: p("P2", "never clicks", { hands: false, cps: 0, scraps: false, ream: false, craneCatch: 0, chainSuccess: 0, buyEvery: 300 }),
  P3: p("P3", "no agents", { agents: 0 }),
  P4: p("P4", "one agent", { agents: 1 }),
  P5: p("P5", "eight agents", { agents: 8 }),
  P6: p("P6", "thirty agents", { agents: 30 }),
  P7: p("P7", "sixty-four agents", { agents: 64 }),
  P8: p("P8", "keen", { sessionSec: 300 }),
  P9: p("P9", "few sessions", { sessionsPerDay: 4 }),
  P10: p("P10", "busy agents", { cycle: Object.freeze({ work: 15, needs: 2, blocks: 3, rest: 9 }) }),
  P11: p("P11", "fast hands", { cps: 3 }),
  P12: p("P12", "calm", { calm: true }),
  // r3-24: sub-minute turns (48 × [45 s working, 15 s needs you], then 12
  // resting: 48 finished tasks an hour) and a burst of fresh sub-agents: 4 a
  // block, one after another in its first 12 s (3 s each), so 192 fledgling
  // finishes an hour per parent with one fledgling working at a time
  P13: p("P13", "short turns", {
    cycle: Object.freeze({ work: 0.75, needs: 0.25, blocks: 48, rest: 12 }), kidShare: 4 / 15, freshKids: 4,
  }),
});

export const PROFILE_IDS = Object.freeze(Object.keys(PROFILES));

/** BALANCE §3.1 activeFrac = sessions · sessionMinutes · 60 / (8 · 3600). */
export function activeFrac(prof) {
  return (prof.sessionsPerDay * prof.sessionSec) / (prof.openHours * 3600);
}

// ---------------------------------------------------------------------------
// BALANCE.md parsing

/** "0:00:30" → 30, "1:20" → 4800, "20:30" → 73800 (seconds). */
export function parseClock(s) {
  const m = /^(\d+):(\d\d)(?::(\d\d))?$/.exec(s.trim());
  if (!m) throw new Error(`BALANCE: not a time: "${s}"`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + (m[3] !== undefined ? Number(m[3]) : 0);
}

/** "5:00" style → "5:00"; seconds → "h:mm" or "h:mm:ss" (when < 1 h or not whole minutes). */
export function fmtClock(sec, long = false) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "—";
  const neg = sec < 0;
  let s = Math.round(Math.abs(sec));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const mm = String(m).padStart(2, "0");
  const out = long || (h === 0) || s !== 0 ? `${h}:${mm}:${String(s).padStart(2, "0")}` : `${h}:${mm}`;
  return neg ? `-${out}` : out;
}

const TIME = String.raw`\d+:\d\d(?::\d\d)?`;
const DASH = String.raw`\s*[–-]\s*`;

/**
 * A window cell → { lo, hi } in seconds (or the value for "exactly n"),
 * { rel: "M15" } for M15-relative windows, { active: n } for active seconds,
 * { eq: "P1" } for "= P1". Bold markers and trailing notes are ignored.
 */
export function parseWindow(cell) {
  const c = cell.replace(/\*\*/g, "").replace(/\(.*?\)/g, "").trim();
  let m;
  if ((m = /^exactly (\d+) active s$/.exec(c))) return { active: Number(m[1]), lo: Number(m[1]), hi: Number(m[1]) };
  if ((m = /^exactly (\d+(?:\.\d+)?)$/.exec(c))) return { value: Number(m[1]), lo: Number(m[1]), hi: Number(m[1]) };
  if ((m = new RegExp(`^M15 \\+ (${TIME})${DASH}M15 \\+ (${TIME})$`).exec(c))) {
    return { rel: "M15", lo: parseClock(m[1]), hi: parseClock(m[2]) };
  }
  if ((m = new RegExp(`^(${TIME})${DASH}(${TIME})$`).exec(c))) return { lo: parseClock(m[1]), hi: parseClock(m[2]) };
  if ((m = new RegExp(`^≤ (${TIME})$`).exec(c))) return { lo: -Infinity, hi: parseClock(m[1]) };
  if ((m = new RegExp(`^≥ (${TIME})$`).exec(c))) return { lo: parseClock(m[1]), hi: Infinity };
  if ((m = new RegExp(`^≥ (${TIME}) and ≤ (${TIME})$`).exec(c))) return { lo: parseClock(m[1]), hi: parseClock(m[2]) };
  if ((m = /^= (P\d+)$/.exec(c))) return { eq: m[1] };
  if (c === "" || c === "—") return null;
  throw new Error(`BALANCE: cannot parse window "${cell}"`);
}

/** "20 – 38 %" → { lo: 0.20, hi: 0.38 }; "≥ 6 %" → { lo: 0.06, hi: 1 }. */
export function parsePercentWindow(cell) {
  const c = cell.replace(/\*\*/g, "").trim();
  let m;
  if ((m = /^(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*%$/.exec(c))) return { lo: Number(m[1]) / 100, hi: Number(m[2]) / 100 };
  if ((m = /^≥\s*(\d+(?:\.\d+)?)\s*%$/.exec(c))) return { lo: Number(m[1]) / 100, hi: 1 };
  throw new Error(`BALANCE: cannot parse percent window "${cell}"`);
}

/** The text of the section whose heading starts with `title` (up to the next heading of the same or higher level). */
export function section(md, title) {
  const lines = md.split("\n");
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#+)\s+(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (start < 0 && m[2].startsWith(title)) { start = i; level = m[1].length; continue; }
    if (start >= 0 && m[1].length <= level) return lines.slice(start, i).join("\n");
  }
  if (start < 0) throw new Error(`BALANCE: no section "${title}"`);
  return lines.slice(start).join("\n");
}

/** The first Markdown table in `text` as rows of cells (header and separator dropped). */
export function table(text) {
  const rows = [];
  let header = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) {
      if (header) break;
      continue;
    }
    const cells = line.slice(1, line.endsWith("|") ? -1 : undefined).split("|").map((x) => x.trim());
    if (!header) { header = cells; continue; }
    if (cells.every((x) => /^:?-+:?$/.test(x))) continue;
    rows.push(cells);
  }
  if (!header) throw new Error("BALANCE: table not found");
  return { header, rows };
}

const keysIn = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const num = (re, text, what) => {
  const m = re.exec(text);
  if (!m) throw new Error(`BALANCE: cannot find ${what}`);
  return Number(m[1]);
};

/** Parse every target the simulator asserts from BALANCE.md text. */
export function parseBalance(md = readFileSync(BALANCE_PATH, "utf8")) {
  // §3 profile table: names must match the profiles above.
  const other = table(section(md, "Other profiles")).rows.map((r) => r[0].split(" ")[0]);
  const profilesListed = ["P1", ...other];
  const p1ActiveFrac = num(/\(P1: (\d+(?:\.\d+)?)\)/, section(md, "3.1"), "§3.1 P1 activeFrac");

  // §4 milestones
  const milestones = table(section(md, "4. Milestones")).rows.map((r) => {
    const id = r[0].replace(/\*\*/g, "").trim();
    const keys = keysIn(r[1]);
    let key = keys[0] || null;
    if (id === "M16") key = "wish:gain";
    if (!key) throw new Error(`BALANCE §4: no sim key in row ${id}`);
    return {
      id, key, event: r[1].replace(/\*\*/g, "").replace(/\s*\(`[^)]*`\)/, "").trim(),
      target: r[2].replace(/\*\*/g, "").trim(),
      median: parseWindow(r[3]),
      every: parseWindow(r[4]),
      provisional: /provisional/.test(r[1]),
    };
  });

  // §5 first wish across profiles
  const firstWish = table(section(md, "5. First wish")).rows.map((r) => {
    const id = /^(P\d+)/.exec(r[0])[1];
    const eq = /^=\s*(P\d+)$/.exec(r[1].trim());
    let row;
    if (eq) {
      // "= P1": each seed within ±x % of the same P1 seed
      row = { id, target: r[1], median: null, every: null, extra: [],
        sameSeed: { of: eq[1], rel: num(/±\s*(\d+(?:\.\d+)?)\s*%/, r[2] + r[3], "P12 tolerance") / 100 } };
    } else {
      row = { id, target: r[1], median: parseWindow(r[2]), every: parseWindow(r[3]), extra: [] };
    }
    const extra = r[4].replace(/\*\*/g, "").trim();
    if (extra && extra !== "—" && extra !== "calm changes no earnings") row.extra.push(parseExtra(id, extra));
    return row;
  });
  const mono = /Monotonicity \(medians\):\s*([P\d ≥]+)\./.exec(section(md, "5. First wish"));
  if (!mono) throw new Error("BALANCE §5: no monotonicity line");
  const monotonic = mono[1].split("≥").map((x) => x.trim());

  // §6.1 whole-run shares
  const shares = table(section(md, "6.1")).rows.map((r) => ({
    label: r[0].replace(/\s*\(.*$/, "").replace(/\*\*/g, "").trim(),
    keys: keysIn(r[0]),
    window: parsePercentWindow(r[2]),
  }));

  // §6.2 click share per day
  const dayShares = [];
  for (const r of table(section(md, "6.2")).rows) {
    const ids = r[0].split(",").map((x) => x.trim());
    const mins = [r[1], r[2], r[3]].map((c) => parsePercentWindow(c).lo);
    for (const id of ids) dayShares.push({ id, mins });
  }

  // §6.3 sessions
  const s63 = section(md, "6.3");
  const sessions = {
    p1Min: num(/at\s+least \*\*(\d+(?:\.\d+)?)×\*\* the passive rate/, s63, "§6.3 P1 ratio"),
    afterSec: num(/after the first (\d+) minutes/, s63, "§6.3 grace minutes") * 60,
    handsMin: num(/For every profile with hand hits, at least \*\*(\d+(?:\.\d+)?)×\*\*/, s63, "§6.3 all-profile ratio"),
    p1Avg: num(/≥ \*\*(\d+(?:\.\d+)?)×\*\* `Rp` per active second/, s63, "§6.3 days 2-3 average"),
  };

  // §6.4 agents matter: covered by 6.1 and §5 extras (asserted there).

  // §7 invariants: the numbers the code asserts
  const s7 = section(md, "7. Invariants");
  const invariants = {
    cadenceP1Min: num(/is ≤ \*\*(\d+) min\*\* for P1/, s7, "inv. 2 P1"),
    cadenceHandsMin: num(/≤ \*\*(\d+) min\*\* for every profile with hand hits/, s7, "inv. 2 hands"),
    cadenceP2Hours: num(/P2 instead: ≤ (\d+) h of open time/, s7, "inv. 2 P2"),
    awayF: num(/never credits more than\s+`(\d+(?:\.\d+)?) ·/, s7, "inv. 4 factor"),
    saveKiB: num(/save text is < (\d+) KiB/, s7, "inv. 7 KiB"),
    albumExtra: num(/with (\d+) Album helpers added/, s7, "inv. 7 Album"),
    churnPerDay: num(/after a year of (\d+) agents a day/, s7, "inv. 7 churn agents"),
    churnKids: num(/each with (\d+) fledglings, coming and going/, s7, "inv. 7 churn fledglings"),
    churnKiB: num(/the save stays < (\d+) KiB/, s7, "inv. 7 churn KiB"),
    heavyPerDay: num(/with\s+\*\*(\d+) new agents a day for \d+ days\*\*/, s7, "inv. 7 heavy agents"),
    heavyDays: num(/new agents a day for (\d+) days\*\*/, s7, "inv. 7 heavy days"),
    heavyKiB: num(/a save \*\*< (\d+) KiB\*\* that stops growing/, s7, "inv. 7 heavy KiB"),
    twoWindowRel: num(/within \*\*(\d+(?:\.\d+)?) %\*\* of one writer/, s7, "inv. 11") / 100,
    calmRel: num(/P12 within ±(\d+(?:\.\d+)?) %/, s7, "inv. 12") / 100,
    firstWishGain: num(/First wish gives exactly (\d+) Wishes/, s7, "inv. 13"),
    deadWallHours: num(/payback \(at the moment of\s+purchase, by §3\.1's estimate\) above (\d+) h/, s7, "inv. 14"),
  };
  // §8 calibration knobs: every number in the "Current value" cell, in order
  const knobs = table(section(md, "8. Calibration knobs")).rows.map((r) => ({
    order: Number(r[0]),
    knob: r[1],
    text: r[2],
    values: [...r[2].replace(/·[A-Za-z]+/g, "").matchAll(/\d+(?:\.\d+)?(?:e\d+)?/g)].map((m) => Number(m[0])),
  }));
  return { profilesListed, p1ActiveFrac, milestones, firstWish, monotonic, shares, dayShares, sessions, invariants, knobs };
}

/**
 * One §5 "Extra assertion" cell → { text, check(medians) → bool }.
 * Recognised forms (anything else throws so a doc edit cannot be skipped):
 * "median ≥ P1 median + 2:00", "median ≤ P1 median − 1:30",
 * "P1 median ≤ 0.8 × P3 median", "P4 ≥ P1".
 */
export function parseExtra(id, text) {
  let m;
  if ((m = new RegExp(`^median (≥|≤) (P\\d+) median ([+−-]) (${TIME})$`).exec(text))) {
    const [, op, other, sign, t] = m;
    const d = parseClock(t) * (sign === "+" ? 1 : -1);
    return { text, check: (med) => cmp(med[id], op, med[other] + d) };
  }
  if ((m = /^(P\d+) median (≥|≤) (\d+(?:\.\d+)?) × (P\d+) median$/.exec(text))) {
    const [, a, op, k, b] = m;
    return { text, check: (med) => cmp(med[a], op, Number(k) * med[b]) };
  }
  if ((m = /^(P\d+) (≥|≤) (P\d+)$/.exec(text))) {
    const [, a, op, b] = m;
    return { text, check: (med) => cmp(med[a], op, med[b]) };
  }
  throw new Error(`BALANCE §5: cannot parse extra assertion for ${id}: "${text}"`);
}

function cmp(a, op, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return op === "≥" ? a >= b : a <= b;
}

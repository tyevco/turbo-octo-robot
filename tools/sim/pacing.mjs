// Pacing simulator (ARCHITECTURE A11, B8; docs/BALANCE.md). Drives the real
// engine (apply / advance) with the player profiles of BALANCE §3 and reports
// milestone times, income shares, session ratios and purchases.
//
//   node tools/sim/pacing.mjs [--profile P1[,P2…]] [--seeds 1-20] [--assert] [--json out.json]
//                             [--idle-step 10] [--workers 4] [--even]
//                             [--no-book] [--no-pattern-fx] [--fx-off <id>] [--no-ablation]
//
// Pattern book (BALANCE §12.1): --no-book never buys Crease Field (the engine
// as it was before the feature, the baseline every §12.3 delta is measured
// against); --no-pattern-fx never clicks a fold piece; --fx-off <id> never
// clicks that diagram's. Given alone each runs every profile that way (a
// report, no §12 rows). Without them the run adds the variant runs §12.3 needs
// (`P1~nobook`, `P1~nofx`, `P1~fxoff:<id>` on seeds 1-5, …) unless
// --no-ablation.
//
// --even: the hand hits on a perfect beat with no pauses (the model before
// review r8-03); the asserted model is BALANCE §3's jittered hand.
//
// Time model (BALANCE §1): play-clock p counts open seconds from the first
// launch; day d (0-based) is open p ∈ [8d h, 8(d+1) h] = wall 09:00-17:00 of
// day d; each night is a 16 h wall gap the engine credits as an away segment.
// Steps: 1 s during sessions; outside them `idleStep` (≤ 60 s so a step is
// never an away segment) and every agent status change, at its exact second.
// The engine's advance is closed form per segment, so milestones do not
// depend on the step (test/pacing/step.test.mjs).

import * as engine from "../../mods/creaseworks/engine/index.js";
import { PROFILES, PROFILE_IDS, MASTER_ORDER, activeFrac, parseBalance, fmtClock } from "./profiles.mjs";

export const T0 = Date.UTC(2026, 0, 5, 9, 0, 0); // day 1, 09:00 (the sim's local time is UTC)
const DAY_MS = 86400000;
const HOUR = 3600;

/** "YYYY-MM-DD" of 0-based day d. */
export function dayKey(d) {
  return new Date(T0 + d * DAY_MS).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Deterministic draws for the player's own choices (crane catch, chain tears),
// keyed by the crane's ordinal and by the active clock at a chain's first
// sighting, so they depend neither on step size, call order, the lineage of
// a merged save, nor on how many other items spawned (item ids count every
// spawn, including unclicked ones that calm mode's longer lives change).

function mulberry(a) {
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const draw = (seed, key) => mulberry((engine.fnv1a32n(key) ^ (seed * 2654435761)) >>> 0);

/**
 * The hand's beat in one session (BALANCE §3 "Hand hits", review r8-03): the
 * ms to the next hit, `iv` times a lognormal factor of σ `jitter` whose mean is
 * 1, from a stream keyed by the seed and the session's ordinal (so it does not
 * depend on step size). σ 0 is the even beat `iv`.
 */
export function handBeat(seed, k, iv, jitter) {
  let a = (engine.fnv1a32n(`hand:${k}`) ^ (seed * 2654435761)) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    if (!(jitter > 0)) return iv;
    const u1 = Math.max(next(), 1e-12);
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * next());
    return Math.max(engine.CONTENT.K.hitMinMs + 20, iv * Math.exp(jitter * z - (jitter * jitter) / 2));
  };
}

// ---------------------------------------------------------------------------
// Agents (BALANCE §3 P1 "Agents", "Sub-agents").

function agentModel(prof) {
  const c = prof.cycle;
  // seconds (a cycle may use sub-minute turns: work 0.75 = 45 s)
  const block = Math.round((c.work + c.needs) * 60);
  const cycleLen = c.blocks * block + c.rest * 60;
  if (cycleLen !== HOUR) throw new Error(`${prof.id}: agent cycle is ${cycleLen} s, not an hour`);
  const work = Math.round(c.work * 60);
  const kidLen = Math.round(prof.kidShare * work);
  // freshKids: how many new sub-agents each block starts (true = 1; false/0 =
  // one lasting fledgling). With k > 1 they work one after another, each for
  // kidLen / k s of the block's first kidLen s, so one works at a time (the
  // same gathering as one fledgling) and each is done until the block ends.
  const fresh = prof.freshKids === true ? 1 : Math.max(0, Math.floor(Number(prof.freshKids) || 0));
  const seg = fresh > 1 ? kidLen / fresh : kidLen;
  if (fresh > 1 && seg !== Math.floor(seg)) throw new Error(`${prof.id}: ${kidLen} s of fledgling work do not split into ${fresh} whole seconds`);
  const offsets = [];
  // agents are numbered 1…n (agent 0 would sit at offset 0, on the same second as every
  // third session start, which no real agent does)
  for (let i = 1; i <= prof.agents; i++) offsets.push((997 * i) % HOUR);
  // every second (mod 1 h) where some agent or fledgling changes
  const marks = new Set();
  for (const off of offsets) {
    for (let j = 0; j < c.blocks; j++) {
      for (const x of [j * block, j * block + kidLen, j * block + work]) marks.add((x + off) % HOUR);
      for (let q = 1; q < fresh; q++) marks.add((j * block + q * seg + off) % HOUR);
    }
    marks.add((c.blocks * block + off) % HOUR);
  }
  const sorted = [...marks].sort((a, b) => a - b);
  return { c, block, work, kidLen, seg, offsets, sorted, freshKids: fresh };
}

/** Status and turn of agent i and its fledgling at play-clock second `s`. */
function agentAt(m, i, s) {
  const x = s - m.offsets[i];
  const cyc = Math.floor(x / HOUR);
  const y = x - cyc * HOUR;
  const j = Math.floor(y / m.block);
  let status, done, kid, kidDone;
  if (j >= m.c.blocks) {
    status = "idle"; done = m.c.blocks; kid = "idle"; kidDone = m.c.blocks;
  } else {
    const z = y - j * m.block;
    if (z < m.work) {
      status = "working"; done = j;
      if (z < m.kidLen) { kid = "working"; kidDone = j; } else { kid = "idle"; kidDone = j + 1; }
    } else {
      status = "blocked"; done = j + 1; kid = "idle"; kidDone = j + 1;
    }
  }
  const base = 1000 + m.c.blocks * cyc;
  // the block's own fledgling (freshKids): its index, or -1 while the agent rests
  const blk = j >= m.c.blocks ? -1 : m.c.blocks * cyc + j;
  return { status, turn: base + done, kid, kidTurn: base + kidDone, blk, z: blk >= 0 ? y - j * m.block : -1 };
}

/** The next play-clock second > s at which some agent changes. */
function nextAgentChange(m, s) {
  if (!m.sorted.length) return Infinity;
  const h = Math.floor(s / HOUR) * HOUR;
  const y = s - h;
  for (const x of m.sorted) if (x > y) return h + x;
  return h + HOUR + m.sorted[0];
}

function observation(m, agents, s, withKids = true) {
  const list = [];
  for (const i of agents) {
    const a = agentAt(m, i, s);
    list.push({
      addr: `a${i}`, created: 1000 + i, status: a.status, raw: a.status, turn: a.turn, parent: null,
      pane: `p${i}`, title: `agent ${i}`, paneName: `pane ${i}`, space: "main", tab: "1", kind: "pane",
    });
    if (withKids && m.freshKids) {
      // new sub-agents each block (r3-24): working, then done (+1 turn) until the block ends
      if (a.blk >= 0) {
        for (let q = 0; q < m.freshKids; q++) {
          // sub-agent q of the block: absent until its start, then working, then done
          const st = a.z < m.work ? q * m.seg : 0;
          if (a.z < st) break;
          const working = a.z < m.work && a.z < st + m.seg;
          const n = a.blk * m.freshKids + q;
          list.push({
            addr: m.freshKids === 1 ? `k${i}.${a.blk}` : `k${i}.${a.blk}.${q}`, created: 5000 + i + 7 * n,
            status: working ? "working" : "idle", raw: working ? "working" : "idle", turn: working ? 0 : 1, parent: `a${i}`,
            pane: null, title: `sub-agent ${i}`, paneName: null, space: "main", tab: "1", kind: "kid",
          });
        }
      }
    } else if (withKids) {
      list.push({
        addr: `k${i}`, created: 5000 + i, status: a.kid, raw: a.kid, turn: a.kidTurn, parent: `a${i}`,
        pane: null, title: `sub-agent ${i}`, paneName: null, space: "main", tab: "1", kind: "kid",
      });
    }
  }
  return list;
}

/** The Observation list (B5) of every agent and fledgling of a profile at play-clock second `sec`. */
export function agentObservation(profileId, sec) {
  const prof = typeof profileId === "string" ? PROFILES[profileId] : profileId;
  const m = agentModel(prof);
  return observation(m, m.offsets.map((_, i) => i), sec, true);
}

const obsKey = (list) => list.map((o) => `${o.addr}:${o.status[0]}${o.turn}`).join(",");

// ---------------------------------------------------------------------------
// The player

const UPGRADES = engine.CONTENT.UPGRADES;
const PATTERNS = engine.CONTENT.PATTERNS;
const WORKSHOPS = engine.CONTENT.WORKSHOPS;
const TIERS = engine.CONTENT.TIERS;

/** BALANCE §3.1 candidates: [id, cost]. */
function candidates(state, prof) {
  const out = [];
  for (const w of WORKSHOPS) {
    const info = engine.itemInfo(state, w.id, 1);
    if (info.unlocked) out.push([w.id, info.cost]);
    for (const t of TIERS) {
      const id = `${w.id}-t${t.n}`;
      const ti = engine.itemInfo(state, id, 1);
      if (ti.unlocked && !ti.have) out.push([id, ti.cost]);
    }
  }
  for (const u of UPGRADES) {
    if (state.bought[u.id] === true || prof.neverBuy.includes(u.id)) continue;
    if (u.req && state.bought[u.req] !== true) continue;
    if (u.cost <= 3 * state.bank || u.cost <= 3 * state.runFolds) out.push([u.id, u.cost]);
  }
  return out;
}

/** The candidate with the smallest payback: { id, cost, delta, payback } or null. */
export function bestBuy(state, prof) {
  const o = { activeFrac: activeFrac(prof), cps: prof.hands ? prof.cps : 0 };
  let best = null;
  for (const [id, cost] of candidates(state, prof)) {
    const delta = engine.estimate(state, id, o);
    if (!(delta > 0)) continue;
    const payback = cost / delta;
    if (!best || payback < best.payback) best = { id, cost, delta, payback };
  }
  return best;
}

/**
 * The player's purchases at `t` (BALANCE §3 "Buying", "Automations"): Mail
 * Sorter and Thrifty Fox once each costs ≤ 25 % of the bank, then cheapest
 * payback first while affordable. `act(action)` applies; `mark(id, payback)`
 * is told before each purchase.
 */
export function playerBuys(state, prof, t, act, mark, o = {}) {
  for (const id of prof.autoBuy) {
    if (state.bought[id] === true) continue;
    const info = engine.itemInfo(state, id, 1);
    if (info.unlocked && info.cost <= prof.autoShare * state.bank) {
      // --no-book (BALANCE §12.1): Crease Field is never bought; the moment it would be is noted
      if (id === "crease-field" && o.noBook) {
        if (o.would) o.would(id);
        continue;
      }
      if (o.atBuy) o.atBuy(id);
      if (mark) mark(id, null);
      act({ t, type: "buy", item: id, count: 1 });
    }
  }
  for (let guard = 0; guard < 500; guard++) {
    const best = bestBuy(state, prof);
    if (!best || !engine.itemInfo(state, best.id, 1).ok) break;
    if (mark) mark(best.id, best.payback);
    act({ t, type: "buy", item: best.id, count: 1 });
  }
}

/**
 * The player's choices (BALANCE §3), shared by every window of one world.
 * Draws are keyed (see `draw`), so they do not depend on step size, call
 * order or the lineage of a merged save.
 */
export class Player {
  constructor(prof, seed, o = {}) {
    this.prof = prof;
    this.seed = seed;
    this.o = o; // { noBook, noFx, fxOff }
    this.craneSeen = new Set();
    this.chainPlan = new Map();
    this.fieldPlan = new Map();
  }

  /** The diagram a profile traces now (BALANCE §12.1 "Which diagram"). */
  target(s) {
    const info = engine.bookInfo(s);
    if (info.next) return info.next;
    const sp = s.spawn;
    const ready = (id) => {
      const f = s.book.found[id];
      return f && !(f.ready > sp.activeMs) && !(sp.fold && sp.fold.kind === id);
    };
    if (this.prof.bookPick === "master") {
      for (const id of MASTER_ORDER) if (ready(id)) return id;
    } else {
      let best = null;
      for (const p of PATTERNS) if (ready(p.id) && (!best || p.n > best.n)) best = p;
      if (best) return best.id;
    }
    return "coil";
  }

  /** One attempt's plan: the dots in order and the setting click; a failure stops one dot short (or takes a wrong last dot) so its set is loose. */
  plan(s, at, attempt) {
    const id = this.target(s);
    const p = engine.patternOf(id);
    const dots = p.dots.map(([c, r]) => r * 3 + c);
    const ok = draw(this.seed, `trace:${at}:${attempt}`) < this.prof.traceSuccess;
    if (ok) return { id, ok, seq: dots, finish: p.closed ? dots[0] : dots[dots.length - 1] };
    const short = dots.slice(0, -1);
    if (short.length >= 3 && engine.classifyTrace(short, false) === null) return { id, ok, seq: short, finish: short[short.length - 1] };
    const base = dots.slice(0, Math.max(2, dots.length - 2));
    const last = base[base.length - 1];
    for (let j = 0; j < 9; j++) {
      if (base.includes(j) || !engine.adjacent(last, j)) continue;
      const path = [...base, j];
      if (engine.classifyTrace(path, false) === null) return { id, ok, seq: path, finish: j };
    }
    return { id, ok, seq: short, finish: short[short.length - 1] };
  }

  /** The dot of field `f` to click next (state-driven: an auto-set or a loose set starts the next attempt). */
  nextDot(s, f) {
    let fp = this.fieldPlan.get(f.id);
    if (!fp) {
      fp = { at: Math.round(s.spawn.activeMs), attempt: 0, plan: null, started: false };
      this.fieldPlan.set(f.id, fp);
    }
    const path = f.path;
    if (path.length === 0) {
      if (fp.started || !fp.plan) {
        if (fp.started) fp.attempt++;
        fp.plan = this.plan(s, fp.at, fp.attempt);
      }
      fp.started = true;
      return fp.plan.seq[0];
    }
    const seq = fp.plan.seq;
    for (let k = 0; k < path.length; k++) if (path[k] !== seq[k]) return path[path.length - 1];
    return path.length < seq.length ? seq[path.length] : fp.plan.finish;
  }

  /** Session start: collect the away pot, open every Bundle, then the largest of each boost type not running. */
  sessionStart(s, t, act) {
    if (s.away.pot) act({ t, type: "collect" });
    for (const id of Object.keys(s.envelopes)) {
      if (s.envelopes[id] && s.envelopes[id].type === "bundle") act({ t, type: "open", helperId: id });
    }
    for (const type of ["storm", "rush", "chorus"]) {
      const b = s.boosts;
      const running = type === "rush" ? b.rushEnd > t : type === "storm" ? b.stormEnd > t : b.chorus > 0;
      if (running) continue;
      let pick = null;
      for (const id of Object.keys(s.envelopes)) {
        const e = s.envelopes[id];
        if (e.type === type && (!pick || e.units > s.envelopes[pick].units)) pick = id;
      }
      if (pick) act({ t, type: "open", helperId: pick });
    }
  }

  /** One hand hit at t: the Fresh Ream and a caught crane on the side; then a scrap, else the next chain node, else the Sheet. */
  hit(s, t, act) {
    const prof = this.prof;
    const sp = s.spawn;
    if (prof.ream && sp.ream) act({ t, type: "click", target: "ream", id: sp.ream.id });
    if (sp.crane && !this.craneSeen.has(sp.crane.id)) {
      this.craneSeen.add(sp.crane.id);
      if (draw(this.seed, `catch:${sp.cranesSeen}`) < prof.craneCatch) act({ t, type: "click", target: "crane", id: sp.crane.id });
    }
    if (prof.scraps && sp.scraps.length) {
      act({ t, type: "click", target: "scrap", id: sp.scraps[0].id });
      return;
    }
    // fold pieces (BALANCE §12.1): clicked like scraps, unless the run turns effects off
    if (sp.fold && !this.o.noFx && sp.fold.kind !== this.o.fxOff) {
      act({ t, type: "click", target: "fold", id: sp.fold.id });
      return;
    }
    const c = sp.chain || sp.chain2;
    if (c) {
      let plan = this.chainPlan.get(c.id);
      if (!plan) {
        // 95 % of chains succeed; a failure is one out-of-order hit at a random point
        const at = Math.round(sp.activeMs);
        const ok = draw(this.seed, `chain:${at}`) < prof.chainSuccess || c.k < 2;
        plan = { ok, at: ok ? -1 : Math.floor(draw(this.seed, `tear:${at}`) * (c.k - 1)) };
        this.chainPlan.set(c.id, plan);
      }
      const i = !plan.ok && c.next === plan.at ? c.k - 1 : c.next;
      act({ t, type: "click", target: "node", id: engine.nodeId(c, i) });
      return;
    }
    const f = sp.field;
    if (f && this.prof.traceSuccess > 0) {
      act({ t, type: "click", target: "dot", id: `${f.id}-${this.nextDot(s, f)}` });
      return;
    }
    act({ t, type: "click", target: "sheet" });
  }

  buys(s, t, act, mark, o) {
    playerBuys(s, this.prof, t, act, mark, { ...o, noBook: this.o.noBook });
  }
}

// ---------------------------------------------------------------------------
// One window: a writer with its own live state (one window = the single save).

class Win {
  constructor(sim, w, state, agents, sessionFilter) {
    this.sim = sim;
    this.w = w;
    this.seq = 0;
    this.state = state;
    this.agents = agents;
    this.sessionFilter = sessionFilter;
    this.pending = [];
    this.base = null;
    this.lastObs = "";
    this.saveAt = 0;
  }

  act(a) {
    const action = { w: this.w, s: ++this.seq, ...a };
    const ev = engine.apply(this.state, action);
    if (this.sim.multi) this.pending.push(action);
    for (const e of ev) if (e.kind === "ignored") this.sim.ignored[`${a.type}:${a.target || ""}:${e.reason}`] = (this.sim.ignored[`${a.type}:${a.target || ""}:${e.reason}`] || 0) + 1;
    this.sim.onEvents(this, ev, a.t, false);
    return ev;
  }

  advance(wall) {
    const ev = engine.advance(this.state, wall, this.w);
    this.sim.onEvents(this, ev, wall, true);
    return ev;
  }
}

// ---------------------------------------------------------------------------

/**
 * Night-pot attribution for purchases (BALANCE §4, review r7-13). `ev` is one apply/advance
 * call's events, `bankAfter` the bank when it returned, `potLeft` the away credit still sitting
 * in the bank before it. Away credit is taken as spent last: a purchase counts as paid by a night
 * pot when its cost is more than the bank held without the pot money still in it. Returns the new
 * `potLeft` and, per event index, whether that `buy` needed the pot. The bank before each event is
 * rebuilt backwards from `bankAfter` (a buy took its cost, an earn added its amount).
 */
export function potAttribution(ev, bankAfter, potLeft) {
  const before = new Array(ev.length);
  let b = bankAfter;
  for (let i = ev.length - 1; i >= 0; i--) {
    const e = ev[i];
    if (e.kind === "buy") b += e.cost;
    else if (e.kind === "earn") b -= e.amount;
    before[i] = b;
  }
  const byPot = new Array(ev.length).fill(false);
  let left = potLeft;
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    if (e.kind === "earn" && e.source === "away") left += e.amount;
    else if (e.kind === "buy") {
      byPot[i] = left > 0 && e.cost > before[i] - left;
      left = Math.min(left, before[i] - e.cost);
    }
    left = Math.max(0, left);
  }
  return { potLeft: Math.max(0, Math.min(left, bankAfter)), byPot };
}

/**
 * Run one profile with one seed. opts:
 *   idleStep (s, default 10, ≤ 60), stopAt ("wish" | "wish2"; default "wish2" for P1 else "wish"),
 *   maxHours (play-clock cap, default 60), days (run exactly this many days, no stop),
 *   wish (make the first wish as soon as it is available; default: stopAt === "wish2"),
 *   windows: [{ w, agents: [i…], sessions: (k) => bool }] (two windows share one save through
 *     the A4/A5 protocol, each saving every 15 s; agent indices are 0-based),
 *   buys: an earlier run's `purchases`, replayed instead of the buy policy (BALANCE inv. 11),
 *   pauses: an earlier run's `pauses`, the hand's time off the Sheet replayed with its purchases,
 *   even (true: the hand hits on a perfect beat with no pauses, review r8-03),
 *   keepState (false drops finalState), trace(p, event, state), onStep(p, windows, disk).
 * Returns { milestones, active, shares, dayShares, sessionRatios, purchases, nights, dayEnd,
 * units, finalState, … }; milestone values are play-clock seconds.
 */
/**
 * The run flags of a variant key (BALANCE §12.1): "nobook" → { noBook }, "nofx" → { noFx },
 * "fxoff:<id>" → { fxOff: id }. A job id "P1~nobook" runs P1 with them.
 */
export function variantFlags(variant) {
  if (!variant) return {};
  if (variant === "nobook") return { noBook: true };
  if (variant === "nofx") return { noFx: true };
  const m = /^fxoff:([a-z]+)$/.exec(variant);
  if (m && PATTERNS.some((x) => x.id === m[1])) return { fxOff: m[1] };
  throw new Error(`unknown variant ${variant}`);
}

export function runProfile(profileId, seed, opts = {}) {
  if (typeof profileId === "string" && profileId.includes("~")) {
    const at = profileId.indexOf("~");
    opts = { ...opts, variant: profileId.slice(at + 1) };
    profileId = profileId.slice(0, at);
  }
  if (opts.variant) opts = { ...opts, ...variantFlags(opts.variant) };
  const prof = typeof profileId === "string" ? PROFILES[profileId] : profileId;
  if (!prof) throw new Error(`unknown profile ${profileId}`);
  const idleStep = Math.round((opts.idleStep ?? 10) * 1000);
  if (!(idleStep >= 1000 && idleStep <= 60000)) throw new Error("idleStep must be 1-60 s");
  const stopAt = opts.stopAt ?? (prof.id === "P1" ? "wish2" : "wish");
  const maxSec = (opts.maxHours ?? 60) * HOUR;
  const makeWish = opts.wish ?? stopAt === "wish2"; // P1 makes the first wish as soon as it can (M17)
  const m = agentModel(prof);
  const allAgents = m.offsets.map((_, i) => i);

  const sim = {
    multi: Array.isArray(opts.windows) && opts.windows.length > 1,
    p: 0, // play-clock ms of the operation in progress
    milestones: Object.create(null),
    byAway: Object.create(null), // milestones first reached by an away segment's credit
    active: Object.create(null),
    purchases: [],
    sessionRatios: [],
    nights: [],
    dayEnd: [],
    daySnaps: [],
    shares: null,
    m15Gain: null,
    wishEvent: null,
    sessionSec: 0, // cumulative in-session seconds (BALANCE §1 active time)
    pauses: [], // [play-clock ms, ms] the hand left the Sheet (review r8-03)
    ignored: Object.create(null),
    onEvents: null,
    atBuy: null, // { p, src }: run 0's sources at the Crease Field purchase (or where --no-book would have made it)
    foldBy: [], // [play-clock hour][diagram] fold-piece pay in run 0 (BALANCE §12.3 B12)
    shares2: null, // the second run's sources at the second wish (B16)
    hourly: [], // run 0's sources at the first step at or after each play-clock hour (B11, B12)
  };
  const disk = { text: null };
  const startState = engine.newGame({ seed, now: T0, day: dayKey(0) });
  const winSpecs = sim.multi ? opts.windows : [{ w: "w1", agents: allAgents, sessions: () => true }];
  if (sim.multi) disk.text = engine.serialize(startState);
  const wins = winSpecs.map((spec, k) => {
    const st = sim.multi ? engine.parseSave(disk.text).state : startState;
    const win = new Win(sim, spec.w, st, spec.agents, spec.sessions);
    win.base = disk.text;
    win.k = k;
    win.saveAt = 15000 + k * 7000;
    return win;
  });
  const primary = wins[0];

  // -- milestone tracking (single window; the two-window mode reports days only)
  // Every milestone goes through hit(); `away` says an away segment's credit (a night pot) carried
  // it there, and is kept in sim.byAway for the "reached by a night pot" note (BALANCE §4, every
  // §4 and §5 row: review r7-13, buy: rows were never flagged before).
  const hit = (key, p, away) => {
    if (key in sim.milestones) return;
    sim.milestones[key] = p;
    if (away) sim.byAway[key] = true;
  };
  let last = { p: 0, run: 0, live: 0, life: 0, wishCount: 0 };
  let awayNow = false; // the events being tracked credit an away segment (a night pot)
  let potLeft = 0; // away credit still in the bank (spent last; potAttribution)
  const cross = (key, target, prevV, v, p0, p1, continuous) => {
    if (key in sim.milestones || !(prevV < target && v >= target)) return;
    hit(key, continuous && p1 > p0 ? p0 + (p1 - p0) * (target - prevV) / (v - prevV) : p1, awayNow);
  };
  sim.onEvents = (win, ev, wall, continuous) => {
    if (win !== primary || sim.multi) return;
    const s = win.state;
    const p = sim.p / 1000;
    if (opts.trace) for (const e of ev) opts.trace(p, e, s);
    awayNow = ev.some((e) => e.kind === "away" || (e.kind === "earn" && e.source === "away"));
    // a purchase the bank could pay only with a night pot's money (review r7-13: P1 buys its
    // first Crane Loft at the day-3 open from the pot on every seed)
    const pot = potAttribution(ev, s.bank, potLeft);
    // Pattern book (BALANCE §12.1 keys): finds and tiers, and each fold piece's pay by diagram and day
    let foldPay = 0;
    let traced = false;
    for (const e of ev) {
      if (e.kind === "earn" && e.source === "fold") foldPay += e.amount;
      else if (e.kind === "fold" && s.wishCount === 0) {
        const h = Math.floor(p / HOUR);
        const row = sim.foldBy[h] || (sim.foldBy[h] = Object.create(null));
        row[e.pattern] = (row[e.pattern] || 0) + foldPay;
        foldPay = 0;
      } else if (e.kind === "trace" && e.result === "match") traced = true;
    }
    if (traced) {
      let found = 0;
      let learned = 0;
      let mastered = 0;
      for (const id in s.book.found) {
        const tier = engine.bookTier(s.book.found[id].n);
        if (tier >= 1) found++;
        if (tier >= 2) learned++;
        if (tier >= 3) mastered++;
      }
      if (found >= 1) hit("book:found>=1", p);
      if (found >= 9) hit("book:found>=9", p);
      if (learned >= 9) hit("book:learned>=9", p);
      if (mastered >= 9) hit("book:mastered>=9", p);
    }
    potLeft = pot.potLeft;
    // workshops owned after each buy of this call (the state holds them all at the end)
    let owned = 0;
    for (const id in s.owned) owned += s.owned[id];
    for (const e of ev) if (e.kind === "buy" && e.item in s.owned) owned -= e.count;
    ev.forEach((e, i) => {
      if (e.kind === "buy") {
        hit(`buy:${e.item}`, p, pot.byPot[i]);
        if (e.by !== "player") sim.purchases.push({ item: e.item, p, active: sim.sessionSec, by: "auto", payback: null, run: s.wishCount });
        if (e.item in s.owned) owned += e.count;
        if (owned >= 10) hit("own:workshops>=10", p, pot.byPot[i]);
        // spawn clocks run on active time only (BALANCE §1), so no night pot brings a spawn
      } else if (e.kind === "spawn" && e.what === "crane" && e.n === 1) {
        hit("spawn:crane#1", p);
        const c = s.spawn.crane;
        // active ms when it was born (active throughout since: it spawned inside a session tick)
        if (c) sim.active["spawn:crane#1"] = (c.born - s.spawn.shownMs + s.spawn.activeMs) / 1000;
      } else if (e.kind === "wish") {
        sim.wishEvent = { gain: e.gain, p, G: engine.rates(s).G };
      } else if (e.kind === "away") {
        sim.nights.push({ p, seconds: e.seconds, credited: e.credited, capped: e.capped });
      }
    });
    const p0 = last.p;
    // live income this run: the run's folds without away credit (BALANCE §4 M13, review r5-21:
    // the run total passed 1 B only through the night pot collected at the day-3 open)
    const live = s.runFolds - (s.stats.runBySource.away || 0);
    if (s.wishCount === last.wishCount) {
      cross("run:1e6", 1e6, last.run, s.runFolds, p0, p, continuous && s.wishCount === 0);
      cross("run:1e8", 1e8, last.run, s.runFolds, p0, p, continuous && s.wishCount === 0);
      cross("run:1e9", 1e9, last.run, s.runFolds, p0, p, continuous && s.wishCount === 0);
      cross("live:1e9", 1e9, last.live, live, p0, p, continuous && s.wishCount === 0);
    }
    if (!("wish:available" in sim.milestones) && s.wishCount === 0) {
      const info = engine.wishInfo(s);
      if (info.can) {
        const target = engine.lifetimeFor(engine.CONTENT.PRESTIGE.firstCranes);
        cross("wish:available", target, last.life, s.lifetime, p0, p, continuous);
        // review r6-12: the first wish became available in a step that credited a night pot
        // (cross() may not fire when the crane count, not L, was the last gate to open)
        hit("wish:available", p, awayNow);
        sim.m15Gain = info.gain;
        sim.shares = { ...s.stats.runBySource };
        sim.daySnaps.push({ p: sim.milestones["wish:available"], src: { ...s.stats.runBySource }, m15: true });
      }
    }
    if (s.wishCount === 1 && !("wish2:available" in sim.milestones) && engine.wishInfo(s).can) {
      hit("wish2:available", p, awayNow);
      sim.shares2 = { ...s.stats.runBySource };
    }
    awayNow = false;
    last = { p, run: s.runFolds, live, life: s.lifetime, wishCount: s.wishCount };
  };

  // -- the player's actions
  const player = new Player(prof, seed, { noBook: opts.noBook === true, noFx: opts.noFx === true, fxOff: opts.fxOff || null });
  // B1 (BALANCE §12.3): run 0's sources at the purchase, or where --no-book would have bought
  const noteBuy = (win, key) => {
    if (win !== primary || sim.multi || win.state.wishCount !== 0 || sim.atBuy) return;
    sim.atBuy = { p: sim.p / 1000, src: { ...win.state.stats.runBySource } };
    if (key) hit(key, sim.p / 1000);
  };
  // opts.buys: a purchase script ({ item, p } of an earlier run's player purchases, in order)
  // replayed instead of the policy, at every step (not only in sessions, so a purchase
  // the merged save can afford a moment later does not wait 40 min for the next session);
  // one not yet affordable waits, in order, and one refused when its window's actions are
  // merged into the save goes back to the head.
  const script = opts.buys ? opts.buys.filter((x) => x.by === "player").map((x) => ({ item: x.item, p: x.p * 1000 })) : null;
  const buyPolicy = (win, t) => {
    if (!script) {
      player.buys(win.state, t, (a) => win.act(a), (id, payback) => markBuy(win, id, payback), {
        would: () => noteBuy(win, "would:crease-field"),
        atBuy: (id) => { if (id === "crease-field") noteBuy(win, null); },
      });
      return;
    }
    while (script.length && script[0].p <= sim.p) {
      const x = script[0];
      const info = engine.itemInfo(win.state, x.item, 1);
      if (info.have) { script.shift(); continue; }
      if (!info.ok) break;
      script.shift();
      markBuy(win, x.item, null);
      win.act({ t, type: "buy", item: x.item, count: 1, script: x });
    }
  };
  // Hand time (review r8-03): purchases and envelopes opened in a session step
  // take the hand off the Sheet (BALANCE §3 "Hand hits"); counted here, paid after step 3.
  let handBusy = 0;
  const sessionStart = (win, t) => player.sessionStart(win.state, t, (a) => {
    if (a.type === "open") handBusy++;
    return win.act(a);
  });
  const handHit = (win, t) => player.hit(win.state, t, (a) => win.act(a));
  const markBuy = (win, item, payback) => {
    if (win !== primary || sim.multi) return;
    sim.purchases.push({ item, p: sim.p / 1000, active: sim.sessionSec, by: "player", payback, run: win.state.wishCount });
    pendingPlayerBuy = true;
    handBusy++;
  };
  let pendingPlayerBuy = false;
  const origOn = sim.onEvents;
  sim.onEvents = (win, ev, wall, continuous) => {
    if (pendingPlayerBuy) {
      for (const e of ev) if (e.kind === "buy") e.by = "player";
      pendingPlayerBuy = false;
    }
    origOn(win, ev, wall, continuous);
  };

  const save = (win, wall) => {
    let text = engine.serialize(win.state);
    if (disk.text !== win.base) {
      const back = engine.parseSave(disk.text);
      if (!back.ok) throw new Error(`save damaged: ${back.reason}`);
      const refused = [];
      for (const a of win.pending) {
        for (const e of engine.apply(back.state, a)) {
          if (e.kind !== "ignored") continue;
          sim.ignored[`merge:${e.reason}`] = (sim.ignored[`merge:${e.reason}`] || 0) + 1;
          if (a.script && (e.reason === "afford" || e.reason === "locked")) refused.push(a.script);
        }
      }
      if (script) script.unshift(...refused);
      engine.advance(back.state, wall, win.w);
      win.state = back.state;
      text = engine.serialize(win.state);
    }
    disk.text = text;
    win.base = text;
    win.pending = [];
  };

  // -- the clock
  const openMs = prof.openHours * HOUR * 1000;
  const hitIv = prof.hands && prof.cps > 0 ? 1000 / prof.cps : 0;
  const even = opts.even === true; // the old perfect beat: no jitter, no hand pauses
  const jitter = even ? 0 : prof.hitJitter || 0;
  const pauseMs = (n) => (even || n <= 0 ? 0 : Math.round(((prof.pauseFirst || 0) + (prof.pauseEach || 0) * (n - 1)) * 1000));
  const pauseReplay = Array.isArray(opts.pauses) ? new Map(opts.pauses) : null;
  const sessionsOf = (d) => {
    const out = [];
    for (let j = 0; j < prof.sessionsPerDay; j++) {
      const k = d * prof.sessionsPerDay + j;
      const start = d * openMs + j * prof.sessionGap * 1000;
      out.push({ k, start, end: start + (k === 0 ? prof.firstSessionSec : prof.sessionSec) * 1000 });
    }
    return out;
  };
  if (prof.calm) for (const win of wins) win.act({ t: T0, type: "setting", key: "calm", value: true });

  let done = false;
  let session = null; // { k, start, end, nextHit, hitN, win, src0, Rp0 }
  let lastWin = primary; // the window of the latest session
  const liveTotal = (s) => {
    let x = 0;
    for (const k in s.stats.bySource) if (k !== "away") x += s.stats.bySource[k];
    return x;
  };
  const stopNow = () => {
    if (opts.days !== undefined) return false;
    if (stopAt === "wish") return "wish:available" in sim.milestones;
    return "wish2:available" in sim.milestones;
  };

  for (let d = 0; !done; d++) {
    if (opts.days !== undefined && d >= opts.days) break;
    const dayP = d * openMs; // play-clock ms at the day's open
    const wall0 = T0 + d * DAY_MS;
    const wallOf = (t) => wall0 + (t - dayP);
    const sessions = sessionsOf(d);
    let si = 0;
    let t = dayP;
    const dayEnd = dayP + openMs;
    const obsNow = (win, tt) => {
      const list = observation(m, win.agents, tt / 1000, true);
      const key = obsKey(list);
      if (key !== win.lastObs || tt === dayP) {
        win.lastObs = key;
        win.act({ t: wallOf(tt), type: "observe", helpers: list, visible: true, active: true, matShown: true, day: dayKey(d) });
      }
    };
    let nextObs = dayP;
    let nextBuy = prof.buyEvery ? dayP : Infinity;
    while (true) {
      sim.p = t;
      // 1. observations at t (agent changes; the day key at the open)
      if (t >= nextObs) {
        for (const win of wins) obsNow(win, t);
        nextObs = nextAgentChange(m, Math.floor(t / 1000)) * 1000;
        if (!Number.isFinite(nextObs)) nextObs = Infinity;
      }
      // 2. session start / end
      if (session && t >= session.end) {
        const s = session.win.state;
        const earned = liveTotal(s) - session.src0;
        const dur = (session.end - session.start) / 1000;
        sim.sessionRatios.push({ k: session.k, p: session.start / 1000, day: d, dur, earned, Rp: session.Rp0,
          ratio: session.Rp0 > 0 ? earned / dur / session.Rp0 : null, run: s.wishCount });
        session = null;
      }
      if (!session && si < sessions.length && t >= sessions[si].start) {
        const ss = sessions[si++];
        const win = wins.find((w) => w.sessionFilter(ss.k)) || null;
        if (win) {
          lastWin = win;
          const s = win.state;
          session = { ...ss, nextHit: ss.start, hitN: 0, anchor: ss.start, anchorN: 0, win, src0: liveTotal(s), Rp0: engine.rates(s, win.w).Rp,
            beat: handBeat(seed, ss.k, hitIv, jitter) };
          handBusy = 0;
          sessionStart(win, wallOf(t));
        }
      }
      // 3. buying (every second of a session; P2 every 5 min of open time; a purchase
      //    script at every step, in the window of the latest session)
      if (script) {
        // (not at the day's close: its play-clock is also the next day's open)
        if (t < dayEnd) buyPolicy(session ? session.win : lastWin, wallOf(t));
      } else if (prof.buyEvery) {
        if (t >= nextBuy) {
          for (const win of wins) buyPolicy(win, wallOf(t));
          nextBuy += prof.buyEvery * 1000;
        }
      } else if (session) {
        buyPolicy(session.win, wallOf(t));
      }
      if (session && makeWish && session.win.state.wishCount < 1 && engine.wishInfo(session.win.state).can) {
        session.win.act({ t: wallOf(t), type: "wish" });
      }
      // the hand was away from the Sheet for this step's purchases and envelopes
      // (opts.pauses: an earlier run's, replayed as input, BALANCE inv. 11)
      const pause = !session ? 0 : pauseReplay ? pauseReplay.get(t) || 0 : pauseMs(handBusy);
      if (pause > 0) {
        session.nextHit = Math.max(session.nextHit, t + pause);
        session.anchor = session.nextHit;
        session.anchorN = session.hitN;
        if (!pauseReplay) sim.pauses.push([t, pause]);
      }
      handBusy = 0;
      if (t >= dayEnd) break;
      if (stopNow() || t >= maxSec * 1000) { done = true; break; }
      // 4. the next stop
      let tn = Math.min(dayEnd, nextObs, t + (session ? 1000 : idleStep));
      if (session) tn = Math.min(tn, session.end);
      else if (si < sessions.length) tn = Math.min(tn, sessions[si].start);
      if (prof.buyEvery) tn = Math.min(tn, nextBuy);
      if (sim.multi) for (const win of wins) if (dayP + win.saveAt > t) tn = Math.min(tn, dayP + win.saveAt);
      // 5. hand hits in [t, tn)
      if (session && hitIv > 0) {
        while (session.nextHit < tn && session.nextHit < session.end) {
          sim.p = session.nextHit;
          handHit(session.win, wallOf(session.nextHit));
          session.hitN++;
          session.nextHit = jitter > 0 ? session.nextHit + Math.round(session.beat())
            : session.anchor + Math.round((session.hitN - session.anchorN) * hitIv);
        }
      }
      // (B11, B12: the same step times in every run of a profile, so the same windows)
      if (!sim.multi && primary.state.wishCount === 0 && t >= sim.hourly.length * HOUR * 1000) {
        sim.hourly.push({ p: t / 1000, src: { ...primary.state.stats.runBySource } });
      }
      // 6. advance every window to tn
      sim.p = tn;
      if (session) sim.sessionSec += (tn - t) / 1000;
      for (const win of wins) win.advance(wallOf(tn));
      if (opts.onStep) opts.onStep(tn / 1000, wins, disk);
      if (sim.multi) {
        for (const win of wins) {
          if (dayP + win.saveAt <= tn) {
            save(win, wallOf(tn));
            while (dayP + win.saveAt <= tn) win.saveAt += 15000;
          }
        }
      }
      t = tn;
    }
    // day end (17:00): close the session bookkeeping, save, snapshot
    for (const win of wins) win.saveAt -= openMs; // save offsets are relative to the day's open
    if (sim.multi) for (const win of wins) save(win, wallOf(t));
    const st = sim.multi ? engine.parseSave(disk.text).state : primary.state;
    sim.dayEnd.push({ day: d, p: t / 1000, lifetime: st.lifetime, bySource: { ...st.stats.bySource }, clock: st.clock,
      hits: st.stats.hits, tasks: st.stats.tasks, units: { ...st.stats.units }, seq: st.spawn.seq, cranes: st.spawn.cranesSeen, owned: { ...st.owned }, bought: Object.keys(st.bought).length });
    if (!sim.multi) sim.daySnaps.push({ p: t / 1000, src: { ...st.stats.runBySource }, wishCount: st.wishCount });
    if (t >= maxSec * 1000) done = true;
  }

  const finalState = sim.multi ? engine.parseSave(disk.text).state : primary.state;
  return summarize(prof, seed, sim, finalState, opts);
}

const sumKeys = (src, keys) => keys.reduce((a, k) => a + (src[k] || 0), 0);
export const SHARE_BUCKETS = Object.freeze({
  click: Object.freeze(["sheet", "mini", "node", "scrap", "crane", "ream", "boat", "pattern", "fold"]),
  helpers: Object.freeze(["helpers", "env", "overflow"]),
  workshops: Object.freeze(["workshops"]),
  away: Object.freeze(["away"]),
});

function sharesOf(src) {
  let total = 0;
  for (const k in src) total += src[k];
  const out = {};
  for (const b in SHARE_BUCKETS) out[b] = total > 0 ? sumKeys(src, SHARE_BUCKETS[b]) / total : 0;
  return out;
}

function summarize(prof, seed, sim, finalState, opts) {
  const ms = sim.milestones;
  const m15 = ms["wish:available"];
  // click share of live income per day up to M15 (BALANCE §6.2)
  const dayShares = [];
  let prev = {};
  for (const snap of sim.daySnaps) {
    if (snap.wishCount > 0) break;
    const live = {};
    let tot = 0;
    for (const k in snap.src) {
      if (k === "away") continue;
      live[k] = snap.src[k] - (prev[k] || 0);
      tot += live[k];
    }
    dayShares.push({ day: Math.ceil(snap.p / (prof.openHours * HOUR)) || 1, upTo: snap.p, click: tot > 0 ? sumKeys(live, SHARE_BUCKETS.click) / tot : 0, live: tot, src: live });
    prev = snap.src;
    if (snap.m15) break;
  }
  return {
    profile: opts.variant ? `${prof.id}~${opts.variant}` : prof.id, seed,
    milestones: { ...ms },
    byAway: { ...sim.byAway },
    active: { ...sim.active },
    wishGain: sim.m15Gain,
    wishEvent: sim.wishEvent,
    shares: sim.shares ? sharesOf(sim.shares) : null,
    sharesRaw: sim.shares,
    dayShares,
    sessionRatios: sim.sessionRatios,
    purchases: sim.purchases,
    pauses: sim.pauses,
    nights: sim.nights,
    dayEnd: sim.dayEnd,
    ignored: { ...sim.ignored },
    m15,
    // BALANCE inv. 9: envelope units created = opened + converted + waiting
    units: { ...finalState.stats.units, waiting: Object.values(finalState.envelopes).reduce((a, e) => a + e.units, 0) },
    variant: opts.variant || null,
    atBuy: sim.atBuy,
    foldBy: sim.foldBy.map((x) => ({ ...(x || {}) })),
    shares2: sim.shares2,
    hourly: sim.hourly,
    finalState: opts.keepState === false ? null : finalState,
  };
}

// ---------------------------------------------------------------------------
// Statistics and the pass rules (BALANCE §2)

export function median(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
}

const inWin = (x, w) => Number.isFinite(x) && x >= w.lo && x <= w.hi;

/**
 * Evaluate every BALANCE row against `runs` = { [profileId]: result[] } (one per seed).
 * Returns { rows: [{ section, id, what, median, min, max, window, every, pass, note }], pass }.
 */
export function evaluate(runs, bal = parseBalance()) {
  const rows = [];
  const add = (r) => rows.push(r);
  const P1 = runs.P1 || [];
  const medians = {};
  for (const id in runs) medians[id] = median(runs[id].map((r) => r.m15));

  // §4 milestones (P1)
  if (P1.length) {
    for (const row of bal.milestones) {
      let vals;
      if (row.key === "wish:gain") vals = P1.map((r) => r.wishGain);
      else if (row.median.active !== undefined) vals = P1.map((r) => r.active[row.key]);
      else if (row.median.rel === "M15") vals = P1.map((r) => (r.milestones[row.key] ?? NaN) - r.m15);
      else vals = P1.map((r) => r.milestones[row.key] ?? NaN);
      const med = median(vals);
      const okMed = inWin(med, row.median);
      const okEvery = vals.every((v) => inWin(v, row.every));
      // seeds on which the milestone was first reached by an away segment's credit (a night pot)
      const byAway = P1.filter((r) => r.byAway && r.byAway[row.key]).length;
      add({ section: "§4", id: row.id, what: row.event, key: row.key, unit: row.median.active !== undefined ? "active s" : row.median.value !== undefined ? "value" : row.median.rel ? "M15+" : "clock",
        vals, median: med, min: Math.min(...vals), max: Math.max(...vals), window: row.median, every: row.every,
        pass: okMed && okEvery, provisional: row.provisional, byAway, note: byAway ? `reached by a night pot on ${byAway} of ${P1.length} seeds` : undefined });
    }
  }
  // §5 first wish across profiles
  for (const row of bal.firstWish) {
    const rs = runs[row.id];
    if (!rs) continue;
    const vals = rs.map((r) => r.m15 ?? NaN);
    const med = median(vals);
    // seeds whose first wish became available only with a night pot's credit (a day-open snap, review r6-12)
    const byAway = rs.filter((r) => r.byAway && r.byAway["wish:available"]).length;
    const awayNote = byAway ? `reached by a night pot on ${byAway} of ${rs.length} seeds` : "";
    if (row.sameSeed) {
      const base = runs[row.sameSeed.of];
      if (!base) continue;
      // every §4 milestone up to the first wish (clock-valued rows), seed by seed
      const keys = bal.milestones.filter((x) => !x.median.rel && x.median.value === undefined).map((x) => x.key);
      const bad = [];
      let worst = 0;
      rs.forEach((r) => {
        const b = base.find((x) => x.seed === r.seed);
        if (!b) { bad.push(`seed ${r.seed}: no ${row.sameSeed.of} run`); return; }
        for (const key of keys) {
          const a = r.milestones[key];
          const v = b.milestones[key];
          const rel = Math.abs(a - v) / Math.max(v, 1);
          if (Number.isFinite(rel) && rel > worst) worst = rel;
          if (!(rel <= row.sameSeed.rel)) bad.push(`seed ${r.seed} ${key} ${fmtClock(a)} vs ${fmtClock(v)}`);
        }
      });
      add({ section: "§5", id: row.id, what: `first wish; every §4 milestone within ±${row.sameSeed.rel * 100} % of the same ${row.sameSeed.of} seed`, unit: "clock",
        vals, median: med, min: Math.min(...vals), max: Math.max(...vals), pass: bad.length === 0, byAway,
        note: `worst ${(worst * 100).toFixed(2)} %${bad.length ? "; " + bad.slice(0, 3).join("; ") : ""}${awayNote ? "; " + awayNote : ""}`, value: worst });
      continue;
    }
    const okMed = inWin(med, row.median);
    const okEvery = vals.every((v) => inWin(v, row.every));
    const extras = row.extra.map((e) => ({ text: e.text, ok: e.check(medians) }));
    add({ section: "§5", id: row.id, what: "first wish", unit: "clock", vals, median: med, min: Math.min(...vals), max: Math.max(...vals),
      window: row.median, every: row.every, extras, pass: okMed && okEvery && extras.every((e) => e.ok), byAway, note: awayNote || undefined });
  }
  // §5 monotonicity
  {
    const ids = bal.monotonic.filter((id) => runs[id]);
    if (ids.length > 1) {
      let ok = true;
      for (let i = 1; i < ids.length; i++) if (!(medians[ids[i - 1]] >= medians[ids[i]])) ok = false;
      add({ section: "§5", id: "mono", what: `medians ${bal.monotonic.join(" ≥ ")}`, unit: "text",
        note: ids.map((id) => `${id} ${fmtClock(medians[id])}`).join(" ≥ "), pass: ok });
    }
  }
  // §6.1 shares (P1 seed 1; all seeds reported)
  if (P1.length) {
    const s1 = P1.find((r) => r.seed === 1) || P1[0];
    for (const row of bal.shares) {
      const b = bucketOf(row.keys);
      const v = s1.shares ? s1.shares[b] : NaN;
      const all = P1.map((r) => (r.shares ? r.shares[b] : NaN));
      add({ section: "§6.1", id: b, what: row.label, unit: "pct", median: v, min: Math.min(...all), max: Math.max(...all),
        window: row.window, pass: inWin(v, row.window), note: `all-seed median ${(median(all) * 100).toFixed(1)} %` });
    }
  }
  // §6.2 click share per day, every seed (review r7-14: seed 1 alone passed P3's day-1 floor
  // at 5.09 % while seeds 16 and 17 sat at 4.97 % and 4.95 %); the row reports seed 1 and the
  // all-seed minimum with its seed
  for (const row of bal.dayShares) {
    const rs = runs[row.id];
    if (!rs) continue;
    const s1 = rs.find((r) => r.seed === 1) || rs[0];
    const pct = (v) => (v === null ? "—" : (v * 100).toFixed(2) + " %");
    const days = [0, 1, 2].map((i) => {
      let min = null;
      let seed = null;
      const bad = [];
      for (const r of rs) {
        const v = r.dayShares[i] ? r.dayShares[i].click : null;
        if (v === null) continue;
        if (min === null || v < min) { min = v; seed = r.seed; }
        if (!(v >= row.mins[i])) bad.push(r.seed);
      }
      return { seed1: s1.dayShares[i] ? s1.dayShares[i].click : null, min, seed, bad };
    });
    const bad = days.flatMap((d, i) => d.bad.map((sd) => `day ${i + 1} seed ${sd}`));
    add({ section: "§6.2", id: row.id, what: `click share of live income, days 1-3 ≥ ${row.mins.map((x) => x * 100 + " %").join(" / ")} on every seed`, unit: "text",
      note: `seed 1 ${days.map((d) => pct(d.seed1)).join(" / ")}; all-seed min ${days.map((d) => (d.min === null ? "—" : `${pct(d.min)} (seed ${d.seed})`)).join(" / ")}${bad.length ? "; below: " + bad.join(", ") : ""}`,
      pass: bad.length === 0, days, mins: row.mins });
  }
  // §6.3 sessions
  {
    const S = bal.sessions;
    for (const id in runs) {
      const prof = PROFILES[id];
      if (!prof || !prof.hands) continue;
      const s1 = runs[id].find((r) => r.seed === 1) || runs[id][0];
      const list = s1.sessionRatios.filter((x) => x.p >= S.afterSec && x.run === 0 && x.ratio !== null && (s1.m15 === undefined || x.p <= s1.m15));
      const minR = Math.min(...list.map((x) => x.ratio));
      const need = id === "P1" ? S.p1Min : S.handsMin;
      add({ section: "§6.3", id, what: `every session after ${S.afterSec / 60} min earns ≥ ${need}× Rp per active s`, unit: "text",
        note: `min ${minR.toFixed(2)}×`, pass: minR >= need, value: minR });
      if (id === "P1") {
        const d23 = list.filter((x) => x.day === 1 || x.day === 2);
        const avg = d23.reduce((a, x) => a + x.ratio, 0) / d23.length;
        add({ section: "§6.3", id, what: `days 2-3 average ≥ ${S.p1Avg}× Rp per active s`, unit: "text",
          note: `${avg.toFixed(1)}×`, pass: avg >= S.p1Avg, value: avg });
      }
    }
  }
  // §7 inv. 1, 2, 9, 13, 14 on the runs (the rest: test/pacing/invariants.test.mjs)
  const I = bal.invariants;
  if (P1.length) {
    const bad = P1.filter((r) => !(r.m15 > 16 * HOUR && r.m15 < 24 * HOUR));
    add({ section: "§7", id: "inv1", what: "every P1 seed reaches M15 on day 3 (16:00 < t < 24:00)", unit: "text",
      note: bad.length ? `seeds ${bad.map((r) => r.seed).join(",")}` : "all seeds", pass: bad.length === 0 });
  }
  for (const id in runs) {
    const prof = PROFILES[id];
    if (!prof) continue;
    const s1 = runs[id].find((r) => r.seed === 1) || runs[id][0];
    const gap = cadence(s1, prof);
    const lim = !prof.hands ? I.cadenceP2Hours * HOUR : id === "P1" ? I.cadenceP1Min * 60 : I.cadenceHandsMin * 60;
    add({ section: "§7", id: `inv2 ${id}`, what: `purchase cadence ≤ ${prof.hands ? lim / 60 + " min active" : lim / HOUR + " h open"}`, unit: "text",
      note: `max gap ${prof.hands ? (gap.max / 60).toFixed(1) + " min" : (gap.max / HOUR).toFixed(2) + " h"} (before ${gap.item})`, pass: gap.max <= lim, value: gap.max });
  }
  if (P1.length) {
    const s1 = P1.find((r) => r.seed === 1) || P1[0];
    const worst = s1.purchases.filter((x) => x.by === "player" && x.run === 0 && x.p <= s1.m15 && x.payback !== null)
      .reduce((a, x) => (x.payback > a.payback ? x : a), { payback: 0, item: "—" });
    add({ section: "§7", id: "inv14", what: `no P1 purchase before M15 has payback > ${I.deadWallHours} h open`, unit: "text",
      note: `max ${(worst.payback / HOUR).toFixed(1)} h (${worst.item})`, pass: worst.payback <= I.deadWallHours * HOUR });
    const gains = P1.map((r) => (r.wishEvent ? r.wishEvent.gain : NaN));
    const Gs = P1.map((r) => (r.wishEvent ? r.wishEvent.G : NaN));
    add({ section: "§7", id: "inv13", what: `first wish gives exactly ${I.firstWishGain} Wishes and G = 1.5`, unit: "text",
      note: `gains ${[...new Set(gains)].join(",")}; G ${[...new Set(Gs)].join(",")}`, pass: gains.every((g) => g === I.firstWishGain) && Gs.every((g) => g === 1.5) });
  }
  {
    let worst = 0;
    let where = "—";
    for (const id in runs) {
      for (const r of runs[id]) {
        const u = r.units;
        const d = Math.abs(u.created - (u.opened + u.converted + u.waiting));
        if (d > worst) { worst = d; where = `${id} seed ${r.seed}`; }
      }
    }
    add({ section: "§7", id: "inv9", what: "no envelope is lost: units created = opened + converted + waiting (all runs)", unit: "text",
      note: worst < 1e-9 ? "exact in every run" : `off by ${worst} (${where})`, pass: worst < 1e-9 });
  }
  if (bal.pattern) patternRows(runs, bal, medians, rows);
  return { rows, pass: rows.every((r) => r.pass || r.provisional), medians };
}

/** The live (away-free) income of run `r` on 0-based day `d` up to M15, by source. */
const dayLive = (r, d) => (r.dayShares[d] ? r.dayShares[d].src : null);
const totalOf = (src) => {
  let x = 0;
  for (const k in src) x += src[k];
  return x;
};
const liveShareOf = (src, keys) => {
  if (!src) return NaN;
  let tot = 0;
  for (const k in src) if (k !== "away") tot += src[k];
  return tot > 0 ? sumKeys(src, keys) / tot : NaN;
};

/**
 * BALANCE §12.3 rows B1-B16 (the Pattern book). Each row is added only when
 * the runs it compares exist (the `~nobook`, `~nofx` and `~fxoff:<id>`
 * variants of variantJobs()).
 */
function patternRows(runs, bal, medians, rows) {
  const R = Object.create(null);
  for (const r of bal.pattern) R[r.id] = r;
  const P1 = runs.P1;
  if (!P1 || !P1.length) return;
  const base = (id) => runs[`${id}~nobook`] || null;
  const same = (rs, b) => rs.map((r) => [r, b.find((x) => x.seed === r.seed)]).filter((x) => x[1]);
  const within = (v, w) => Number.isFinite(v) && v >= (w.lo ?? -Infinity) && v <= (w.hi ?? Infinity);
  const minOf = (xs) => Math.min(...xs.filter(Number.isFinite));
  const maxOf = (xs) => Math.max(...xs.filter(Number.isFinite));
  const add = (id, what, unit, vals, pass, note, extra = {}) => {
    const row = R[id];
    rows.push({ section: "§12", id, what: row ? row.what : what, unit, vals, median: median(vals), min: minOf(vals), max: maxOf(vals),
      pass, provisional: row ? row.provisional : false, note, ...extra });
  };
  const fmtD = (x) => (Number.isFinite(x) ? (x < 0 ? "−" : "+") + fmtClock(Math.abs(x)) : "—");
  const pts = (x) => (Number.isFinite(x) ? `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)} pts` : "—");
  const pct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(2) + " %" : "—");
  const buyAt = (r) => r.milestones["buy:crease-field"] ?? NaN;

  // B1: nothing moves before the purchase (the --no-book run of the same seed, where it would have bought)
  const b1 = base("P1");
  if (b1) {
    const bad = [];
    for (const [r, b] of same(P1, b1)) {
      const at = buyAt(r);
      const would = b.milestones["would:crease-field"];
      if (at !== would) { bad.push(`seed ${r.seed}: bought ${fmtClock(at)}, --no-book ${fmtClock(would)}`); continue; }
      for (const k in b.milestones) if (b.milestones[k] < at && r.milestones[k] !== b.milestones[k]) bad.push(`seed ${r.seed} ${k}`);
      for (const k in r.milestones) if (r.milestones[k] < at && r.milestones[k] !== b.milestones[k]) bad.push(`seed ${r.seed} ${k}`);
      const a1 = r.atBuy ? r.atBuy.src : null;
      const a2 = b.atBuy ? b.atBuy.src : null;
      if (!a1 || !a2 || JSON.stringify(a1) !== JSON.stringify(a2)) bad.push(`seed ${r.seed}: sources at the purchase`);
    }
    rows.push({ section: "§12", id: "B1", what: R.B1.what, unit: "text", pass: bad.length === 0,
      note: bad.length ? bad.slice(0, 3).join("; ") : `identical on ${same(P1, b1).length} seeds (milestones, per-source income and click share up to the purchase)` });
  }
  // B2: the purchase
  {
    const vals = P1.map(buyAt);
    add("B2", "", "clock", vals, within(median(vals), R.B2.median) && vals.every((v) => within(v, R.B2.every)), undefined, { window: R.B2.median, every: R.B2.every });
  }
  // B3-B6: the book's milestones, relative to the purchase, M15 or M17
  const refOf = (r, ref) => (ref === "B2" ? buyAt(r) : ref === "M15" ? r.m15 ?? NaN : ref === "M17" ? r.milestones["wish2:available"] ?? NaN : NaN);
  for (const id of ["B3", "B4", "B5", "B6"]) {
    const row = R[id];
    const vals = P1.map((r) => (r.milestones[row.key] ?? NaN) - refOf(r, row.median.ref));
    const okMed = within(median(vals), row.median);
    let okEvery = true;
    if (row.every) {
      okEvery = P1.every((r) => {
        const d = (r.milestones[row.key] ?? NaN) - refOf(r, row.every.ref);
        return row.every.strict ? Number.isFinite(d) && d < row.every.hi : within(d, row.every);
      });
    }
    const reached = P1.filter((r) => Number.isFinite(r.milestones[row.key])).length;
    add(id, "", "rel", vals, okMed && okEvery, `${row.median.ref} ${fmtD(median(vals))} (median); reached on ${reached} of ${P1.length} seeds`);
  }
  // B7: whole first run click share, against --no-book
  if (b1) {
    const vals = P1.map((r) => (r.shares ? r.shares.click : NaN));
    const deltas = same(P1, b1).map(([r, b]) => (r.shares && b.shares ? r.shares.click - b.shares.click : NaN));
    const w = R.B7.median;
    const ok = within(median(vals), w) && within(median(deltas), w.base) && vals.every((v) => within(v, R.B7.every));
    add("B7", "", "pct", vals, ok, `--no-book median ${pct(median(b1.map((r) => (r.shares ? r.shares.click : NaN))))}; delta ${pts(median(deltas))} (median)`, { window: { lo: w.lo, hi: w.hi } });
  }
  // B8: §6.2 per-day floors, every profile (the §6.2 rows, with fields on)
  {
    const d62 = rows.filter((x) => x.section === "§6.2");
    rows.push({ section: "§12", id: "B8", what: R.B8.what, unit: "text", pass: d62.length > 0 && d62.every((x) => x.pass),
      note: `${d62.filter((x) => x.pass).length} of ${d62.length} §6.2 rows pass` });
  }
  // B9: M15 against --no-book (P1, P8, P11, P14); every seed inside its §5 every-seed window
  {
    const parts = [];
    let ok = true;
    let n = 0;
    for (const id of ["P1", "P8", "P11", "P14"]) {
      const b = base(id);
      if (!runs[id] || !b) continue;
      n++;
      const deltas = same(runs[id], b).map(([r, x]) => r.m15 - x.m15);
      const md = median(deltas);
      const fw = bal.firstWish.find((x) => x.id === id);
      const every = runs[id].every((r) => (fw && fw.every ? within(r.m15, fw.every) : true)) && (id !== "P1" || runs[id].every((r) => r.m15 > 16 * HOUR && r.m15 < 24 * HOUR));
      if (!within(md, R.B9.median) || !every) ok = false;
      parts.push(`${id} ${fmtD(md)} (${fmtD(minOf(deltas))}…${fmtD(maxOf(deltas))})`);
    }
    if (n) rows.push({ section: "§12", id: "B9", what: R.B9.what, unit: "text", pass: ok, note: `M15 − --no-book, median (range): ${parts.join("; ")}` });
  }
  // B10: pattern + fold share of live income on days 2 and 3
  {
    const vals = [];
    for (const r of P1) for (const d of [1, 2]) vals.push(liveShareOf(dayLive(r, d), ["pattern", "fold"]));
    const perSeed = P1.map((r) => Math.max(liveShareOf(dayLive(r, 1), ["pattern", "fold"]), liveShareOf(dayLive(r, 2), ["pattern", "fold"])));
    add("B10", "", "pct", perSeed, within(median(perSeed), R.B10.median) && vals.every((v) => !Number.isFinite(v) || within(v, R.B10.every)), "the larger of days 2 and 3 per seed");
  }
  // B11: effects alone, each day: (P1 − --no-pattern-fx − P1's fold pay) / P1 live. Both runs
  // over the same play-clock window: day d's hours, the last one cut at the whole hour before
  // the earlier of the two first wishes (a day 3 that ends at each run's own M15 would count the
  // time one run reaches it sooner as lost income)
  const fxShare = (r, x, d, foldKey) => {
    const lo = d * 8;
    const cap = Math.floor(Math.min(r.m15 ?? Infinity, x.m15 ?? Infinity) / HOUR);
    const hi = Math.min((d + 1) * 8, cap);
    if (!(hi > lo) || !r.hourly[hi] || !x.hourly[hi]) return NaN;
    const live = (run, k) => totalOf(run.hourly[k].src) - (run.hourly[k].src.away || 0);
    const la = live(r, hi) - live(r, lo);
    const lb = live(x, hi) - live(x, lo);
    const fold = foldKey(r, lo, hi);
    return la > 0 ? (la - lb - fold) / la : NaN;
  };
  // The effect is the median over seeds of each day's share, its largest day against the
  // median window; each seed's own days against the every-seed bound, which is the
  // ablation's noise floor (BALANCE §12.3: an effect that moves a crane or a chain reshuffles
  // the Confetti cranes that follow, about a point of a day's income each).
  const effectRow = (pairs, foldKey) => {
    const perDay = [[], [], []];
    const perSeed = [];
    for (const [r, x] of pairs) {
      let m = -Infinity;
      for (let d = 0; d < 3; d++) {
        const v = fxShare(r, x, d, foldKey);
        if (!Number.isFinite(v)) continue;
        perDay[d].push(v);
        m = Math.max(m, v);
      }
      perSeed.push(m);
    }
    const effect = Math.max(...perDay.map((xs) => (xs.length ? median(xs) : -Infinity)));
    return { effect, perSeed, worst: maxOf(perSeed) };
  };
  const nofx = runs["P1~nofx"];
  if (nofx) {
    const e = effectRow(same(P1, nofx), (run, lo, hi) => (run.hourly[hi].src.fold || 0) - (run.hourly[lo].src.fold || 0));
    rows.push({ section: "§12", id: "B11", what: R.B11.what, unit: "text", value: e.effect,
      pass: within(e.effect, R.B11.median) && e.perSeed.every((v) => within(v, R.B11.every)),
      note: `effect (largest day of the per-day medians) ${pct(e.effect)}; largest seed-day ${pct(e.worst)}` });
  }
  // B12: one diagram's effect, each day, seeds 1-5
  {
    const parts = [];
    let ok = true;
    let n = 0;
    let worst = -Infinity;
    for (const p of PATTERNS) {
      const x = runs[`P1~fxoff:${p.id}`];
      if (!x) continue;
      n++;
      const e = effectRow(same(P1, x), (run, lo, hi) => {
        let y = 0;
        for (let h = lo; h < hi; h++) y += (run.foldBy[h] || {})[p.id] || 0;
        return y;
      });
      if (!within(e.effect, R.B12.median) || !e.perSeed.every((v) => within(v, R.B12.every))) ok = false;
      worst = Math.max(worst, e.effect);
      parts.push(`${p.id} ${pct(e.effect)} (seed-day ≤ ${pct(e.worst)})`);
    }
    if (n) rows.push({ section: "§12", id: "B12", what: R.B12.what, unit: "text", pass: ok, value: worst, note: `effect per diagram: ${parts.join(", ")}` });
  }
  // B13, B14: P15 and P14 first wish against P1
  for (const [id, pid] of [["B13", "P15"], ["B14", "P14"]]) {
    const rs = runs[pid];
    if (!rs) continue;
    const vals = rs.map((r) => r.m15 ?? NaN);
    const d = median(vals) - medians.P1;
    add(id, "", "clock", vals, within(d, R[id].median) && vals.every((v) => within(v, R[id].every)), `${pid} median − P1 median ${fmtD(d)}`, { every: R[id].every });
  }
  // B15: P2 identical to --no-book
  if (runs.P2 && base("P2")) {
    const bad = [];
    for (const [r, b] of same(runs.P2, base("P2"))) {
      const ks = new Set([...Object.keys(r.milestones), ...Object.keys(b.milestones)]);
      for (const k of ks) if (k !== "would:crease-field" && r.milestones[k] !== b.milestones[k]) bad.push(`seed ${r.seed} ${k}`);
    }
    rows.push({ section: "§12", id: "B15", what: R.B15.what, unit: "text", pass: bad.length === 0, note: bad.length ? bad.slice(0, 3).join("; ") : "identical milestones on every seed" });
  }
  // B16: run 2 (first wish to M17) click share of live income
  if (b1) {
    const share2 = (r) => liveShareOf(r.shares2, SHARE_BUCKETS.click);
    const vals = P1.map(share2);
    const bm = median(b1.map(share2));
    const ok = within(median(vals), R.B16.median) && median(vals) >= bm && vals.every((v) => within(v, R.B16.every));
    add("B16", "", "pct", vals, ok, `--no-book median ${pct(bm)}`, { window: { lo: R.B16.median.lo, hi: 1 } });
  }
}

function bucketOf(keys) {
  if (keys.includes("sheet")) return "click";
  if (keys.includes("helpers")) return "helpers";
  if (keys.includes("workshops")) return "workshops";
  if (keys.includes("away")) return "away";
  throw new Error(`no share bucket for ${keys}`);
}

/** Longest gap between consecutive purchases from the first one to M15 (active s, or open s for P2). */
export function cadence(res, prof) {
  const list = res.purchases.filter((x) => x.run === 0 && x.p <= (res.m15 ?? Infinity));
  let max = 0;
  let item = "—";
  const at = (x) => (prof.hands ? x.active : x.p);
  for (let i = 1; i < list.length; i++) {
    const g = at(list[i]) - at(list[i - 1]);
    if (g > max) { max = g; item = `${list[i].item} at ${fmtClock(list[i].p)}`; }
  }
  if (res.m15 !== undefined && list.length) {
    const end = prof.hands ? null : res.m15 - list[list.length - 1].p;
    if (end !== null && end > max) { max = end; item = "M15"; }
  }
  return { max, item };
}

// ---------------------------------------------------------------------------
// Reporting

export function report(runs, ev) {
  const lines = [];
  const L = (s = "") => lines.push(s);
  const pct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + " %" : "—");
  const win = (w, unit) => {
    if (!w) return "";
    if (unit === "pct") return `${+(w.lo * 100).toFixed(1)}–${+(w.hi * 100).toFixed(1)} %`;
    if (w.lo === w.hi) return `= ${unit === "clock" ? fmtClock(w.lo) : w.lo}`;
    const f = unit === "value" || unit === "active s" ? (x) => x : fmtClock;
    if (w.lo === -Infinity) return `≤ ${f(w.hi)}`;
    if (w.hi === Infinity) return `≥ ${f(w.lo)}`;
    return `${f(w.lo)}–${f(w.hi)}`;
  };
  const val = (x, unit) => (unit === "pct" ? pct(x) : unit === "clock" || unit === "M15+" ? fmtClock(x)
    : unit === "rel" ? (Number.isFinite(x) ? (x < 0 ? "−" : "+") + fmtClock(Math.abs(x)) : "—") : Number.isFinite(x) ? String(+x.toFixed(3)) : "—");
  L(`| Row | What | Median | Min | Max | Pass window (median) | Every seed | Result |`);
  L(`|---|---|---|---|---|---|---|---|`);
  for (const r of ev.rows) {
    const res = r.pass ? "pass" : r.provisional ? "FAIL (provisional)" : "FAIL";
    if (r.unit === "text") {
      L(`| ${r.section} ${r.id} | ${r.what} | ${r.note} | | | | | ${res} |`);
      continue;
    }
    const extra = r.extras && r.extras.length ? ` · ${r.extras.map((e) => `${e.text}: ${e.ok ? "ok" : "NO"}`).join("; ")}` : "";
    const note = r.note ? ` (${r.note})` : "";
    L(`| ${r.section} ${r.id} | ${r.what}${extra}${note} | ${val(r.median, r.unit)} | ${val(r.min, r.unit)} | ${val(r.max, r.unit)} | ${win(r.window, r.unit)} | ${win(r.every, r.unit)} | ${res} |`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI

export function parseSeeds(s) {
  const out = [];
  for (const part of String(s).split(",")) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`bad --seeds ${s}`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let x = a; x <= b; x++) out.push(x);
  }
  return out;
}

/** Run profiles × seeds (in worker threads when workers > 1). Returns { [id]: result[] } without states. */
export async function runAll(ids = PROFILE_IDS, seeds = parseSeeds("1-20"), o = {}) {
  const jobs = [];
  for (const id of ids) for (const seed of seeds) jobs.push({ id, seed });
  const runs = {};
  for (const id of ids) runs[id] = [];
  const strip = (r) => ({ ...r, finalState: null });
  const flags = o.flags || {};
  for (const j of o.extra || []) {
    if (!runs[j.id]) runs[j.id] = [];
    jobs.push(j);
  }
  // A job with `replay` (BALANCE §12.1 effect ablations) replays that profile's run of the same
  // seed: its purchases and hand pauses, so the two runs differ by the effects, not by a
  // reshuffled purchase order. Those run after the rest.
  const first = jobs.filter((j) => !j.replay);
  const later = jobs.filter((j) => j.replay);
  const withReplay = (j) => {
    const base = (runs[j.replay] || []).find((r) => r.seed === j.seed);
    if (!base) throw new Error(`${j.id} seed ${j.seed}: no ${j.replay} run to replay`);
    return { id: j.id, seed: j.seed, buys: base.purchases, pauses: base.pauses };
  };
  const optsOf = (j) => ({ idleStep: o.idleStep, even: o.even, keepState: false, ...flags, ...(j.buys ? { buys: j.buys, pauses: j.pauses } : {}) });
  const pool = async (list) => {
    const workers = Math.max(1, Math.min(o.workers ?? 4, list.length));
    if (!list.length) return;
    if (workers === 1) {
      for (const j of list) {
        const r = strip(runProfile(j.id, j.seed, optsOf(j)));
        runs[j.id].push(r);
        if (o.progress) o.progress(r);
      }
      return;
    }
    const { Worker } = await import("node:worker_threads");
    let next = 0;
    await Promise.all(Array.from({ length: workers }, () => new Promise((resolve, reject) => {
      const wk = new Worker(new URL(import.meta.url), { workerData: { idleStep: o.idleStep, even: o.even, flags } });
      const feed = () => {
        if (next >= list.length) { wk.postMessage(null); return; }
        wk.postMessage(list[next++]);
      };
      wk.on("message", (msg) => {
        if (msg.error) { reject(new Error(msg.error)); wk.terminate(); return; }
        if (msg.result) runs[msg.result.profile].push(msg.result);
        if (o.progress) o.progress(msg.result);
        feed();
      });
      wk.on("error", reject);
      wk.on("exit", () => resolve());
      feed();
    })));
  };
  await pool(first);
  await pool(later.map(withReplay));
  for (const id in runs) runs[id].sort((a, b) => a.seed - b.seed);
  return runs;
}

/** The extra runs BALANCE §12.3 compares against (no-book baselines, effect ablations), for the profiles and seeds given. */
export function variantJobs(ids, seeds) {
  const out = [];
  for (const id of ["P1", "P2", "P8", "P11", "P14"]) {
    if (ids.includes(id)) for (const seed of seeds) out.push({ id: `${id}~nobook`, seed });
  }
  if (ids.includes("P1")) {
    for (const seed of seeds) out.push({ id: "P1~nofx", seed, replay: "P1" });
    for (const p of PATTERNS) for (const seed of seeds.filter((x) => x <= 5)) out.push({ id: `P1~fxoff:${p.id}`, seed, replay: "P1" });
  }
  return out;
}

async function workerMain() {
  const { parentPort, workerData } = await import("node:worker_threads");
  parentPort.on("message", (job) => {
    if (job === null) { parentPort.close(); process.exit(0); }
    try {
      const r = runProfile(job.id, job.seed, { idleStep: workerData.idleStep, even: workerData.even, keepState: false, ...(workerData.flags || {}),
        ...(job.buys ? { buys: job.buys, pauses: job.pauses } : {}) });
      parentPort.postMessage({ result: { ...r, finalState: null } });
    } catch (e) {
      parentPort.postMessage({ error: `${job.id} seed ${job.seed}: ${e.stack || e}` });
    }
  });
}

async function main(argv) {
  const arg = (name, def) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : def;
  };
  const ids = arg("profile", PROFILE_IDS.join(",")).split(",").map((x) => x.trim().toUpperCase());
  const seeds = parseSeeds(arg("seeds", "1-20"));
  const idleStep = Number(arg("idle-step", 10));
  const workers = Number(arg("workers", Math.max(1, (await import("node:os")).availableParallelism?.() ?? 4)));
  const t0 = Date.now();
  let n = 0;
  const even = argv.includes("--even");
  const fxOff = arg("fx-off", null);
  const flags = { ...(argv.includes("--no-book") ? { noBook: true } : {}), ...(argv.includes("--no-pattern-fx") ? { noFx: true } : {}), ...(fxOff ? variantFlags(`fxoff:${fxOff}`) : {}) };
  const ablate = Object.keys(flags).length === 0 && !argv.includes("--no-ablation");
  const extra = ablate ? variantJobs(ids, seeds) : [];
  const total = ids.length * seeds.length + extra.length;
  const runs = await runAll(ids, seeds, { idleStep, workers, even, flags, extra, progress: () => { n++; if (process.stderr.isTTY) process.stderr.write(`\r${n}/${total}`); } });
  if (process.stderr.isTTY) process.stderr.write("\n");
  const ev = evaluate(runs);
  const mode = Object.keys(flags).map((k) => (k === "fxOff" ? `--fx-off ${flags.fxOff}` : k === "noBook" ? "--no-book" : "--no-pattern-fx")).join(" ");
  console.log(`# Creaseworks pacing: ${ids.join(" ")} × seeds ${seeds[0]}-${seeds[seeds.length - 1]} (idle step ${idleStep} s${even ? ", even beat" : ""}${mode ? ", " + mode : ""}${extra.length ? `, ${extra.length} §12 variant runs` : ""}, ${((Date.now() - t0) / 1000).toFixed(1)} s)\n`);
  console.log(report(runs, ev));
  console.log("\nFirst wish (M15) per profile: median (min–max)");
  for (const id of ids) {
    const v = runs[id].map((r) => r.m15 ?? NaN);
    console.log(`  ${id.padEnd(4)} ${fmtClock(median(v))} (${fmtClock(Math.min(...v))}–${fmtClock(Math.max(...v))})`);
  }
  const out = arg("json", null);
  if (out) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(out, JSON.stringify({ runs, rows: ev.rows }, (k, v) => (v === Infinity ? "Infinity" : v === -Infinity ? "-Infinity" : v)));
  }
  if (argv.includes("--assert") && !ev.pass) {
    console.error("\npacing: FAILED rows above");
    process.exitCode = 1;
  }
}

const { isMainThread } = await import("node:worker_threads");
if (!isMainThread) {
  await workerMain();
} else if (process.argv[1] && new URL(import.meta.url).pathname === (await import("node:fs")).realpathSync(process.argv[1])) {
  await main(process.argv.slice(2));
}

// Clicking (DESIGN §4): hand hits, rhythm, combo, In step, afterglow, figures,
// chains, scraps, gilded cranes, boats, the Fresh Ream, and the spawn clocks
// that run on active time. `ctx` = { E, idx, rates(t) } from engine.js.

import { K, SPECIES, FREE_SLOTS, SLOT } from "./content.js";
import { keyed } from "./prng.js";
import { credit } from "./economy.js";
import { addBoost } from "./envelopes.js";
import { classifyTrace, traceMove, deadEnd, nearMiss, bookTier, bookInfo, patternOf } from "./pattern.js";

/**
 * What gilded crane number `n` (0-based, spawn.cranesSeen) holds: "gift"
 * (craneGiftOdds, 40 %), "storm" (Confetti, craneConfettiOdds, 35 %) or
 * "song" (Flock Song, the rest, 25 %), DESIGN §4.5. Keyed by n, so it is the same in every
 * window.
 */
export function craneOutcome(state, n) {
  const u = keyed(state, `crane:${n}`);
  return u < K.craneGiftOdds ? "gift" : u < K.craneGiftOdds + K.craneConfettiOdds ? "storm" : "song";
}

/** Node id used by actions and element ids: `<chainId>-<i>`. */
export function nodeId(chain, i) {
  return `${chain.id}-${i}`;
}

/** Centre of spawn slot `i` in mat-local px (304 × 232 mat). */
export function slotXY(i) {
  const col = i % SLOT.cols;
  const row = Math.floor(i / SLOT.cols);
  return { x: SLOT.w * (col + 0.5), y: SLOT.y0 + SLOT.h * (row + 0.5) };
}

/**
 * The rhythm counter as the player sees it at `t`: r, or 0 once the gap since
 * the last credited hit exceeds the rhythm gap. The stored r resets lazily on
 * the next hit (it is kept so hits merged in late from another window keep
 * the streak they had there).
 */
export function rhythmAt(state, E, t) {
  const h = state.hand;
  if (!(h.lastHitAt > 0)) return 0;
  const gap = t - h.lastHitAt;
  if (gap <= E.gapMs) return h.r;
  // A short pause (review r8-03) costs K.slipBeats of the streak, not all of
  // it; none with a Steady charge from a Ridge fold (§4.7).
  return gap <= K.slipMs ? (h.steady === 1 ? h.r : slipped(h.r)) : 0;
}

/** What a streak of `r` keeps through a short pause: K.slipBeats fewer, at least 1 (§4.2). */
export function slipped(r) {
  return Math.max(1, r - K.slipBeats);
}

/** True while In step (r at the threshold and the last hit within the rhythm gap). */
export function inStep(state, E, t) {
  const h = state.hand;
  return h.r >= E.stepIn && t <= h.lastHitAt + E.gapMs;
}

/** step multiplier for working helpers at `t` (§5.3). */
export function stepMult(state, E, t) {
  if (inStep(state, E, t)) return E.stepMult;
  return state.hand.afterglowMs > 0 ? E.glowMult : 1;
}

/** song multiplier (§5.3). */
export function songMult(state) {
  if (state.boosts.song > 0) return K.songMult;
  return state.boosts.chorus > 0 ? K.chorusMult : 1;
}

/**
 * Hand-hit multiplier from Confetti (internal id "storm") / Rush at the hit's
 * time `t`. Rush and Confetti run on the hand-input timeline (boosts.rushEnd /
 * stormEnd, wall ms), so a hit merged in late from another window gets the
 * boost it had there.
 */
export function hitBoost(state, E, t) {
  const b = state.boosts;
  if (t < b.stormEnd) return E.stormMult;
  if (t < b.rushEnd) return E.rushMult;
  // Wind-up (a Coil fold, §4.7): ×2 while no Rush or Confetti runs; never stacks.
  return t < (b.coilEnd || 0) ? K.coilMult : 1;
}

/** combo = 1 + comboMax · min(r, 40)/40. */
export function combo(state, E) {
  return 1 + E.comboMax * Math.min(state.hand.r, K.rMax) / K.rMax;
}

/**
 * Credit one hand hit at `t` (≥ 80 ms after the previous credited one, ≤ 12.5/s).
 * Updates rhythm and afterglow. Returns false when the hit is not credited.
 */
function handHit(state, E, t) {
  const h = state.hand;
  const prev = h.lastHitAt;
  if (prev > 0 && Math.abs(t - prev) < K.hitMinMs) return false;
  const gap = t - prev;
  if (prev > 0 && gap < 0) {
    // a merged hit from another window, older than our last: keep the rhythm
  } else if (prev > 0 && gap <= E.gapMs) {
    h.r = Math.min(K.rMax, h.r + 1);
  } else if (prev > 0 && gap <= K.slipMs) {
    // A short pause (a purchase, an envelope, a glance away) costs part of
    // the streak instead of ending it (review r8-03: a 1.5 s pause every 30 hits
    // used to cost the whole In step build-up). A Steady charge (Ridge fold,
    // §4.7) makes one such pause cost nothing.
    if (h.steady === 1) h.steady = 0;
    else h.r = slipped(h.r);
  } else {
    h.r = 1;
  }
  if (t > prev) h.lastHitAt = t;
  state.stats.hits++;
  if (state.stats.hits >= 3) state.ui.hints.fold = true;
  if (h.r >= E.stepIn) h.afterglowMs = Math.min(K.glowMaxMs, h.afterglowMs + K.glowPerHitMs);
  return true;
}

function vc(state, E, r, t) {
  return r.V * combo(state, E) * hitBoost(state, E, t);
}

/**
 * Vc at `t` with the combo of the rhythm the player sees then (rhythmAt), not
 * the stored r, which resets only on the next hit. For a pay that lands at a
 * time no hit refreshed r: a field's trace set at its life's end (§4.7).
 */
function vcAt(state, E, r, t) {
  return r.V * (1 + E.comboMax * Math.min(rhythmAt(state, E, t), K.rMax) / K.rMax) * hitBoost(state, E, t);
}

function findChain(sp, chainId) {
  if (sp.chain && sp.chain.id === chainId) return "chain";
  if (sp.chain2 && sp.chain2.id === chainId) return "chain2";
  return null;
}

function chainSlots(chain) {
  return chain.nodes.map((n) => n.slot);
}

/** One `click` action (§4.2-§4.5). */
export function click(state, ctx, action, t, ev) {
  const E = ctx.E;
  const sp = state.spawn;
  const tgt = action.target;
  if (t > state.presence.lastHandAt) state.presence.lastHandAt = t;
  switch (tgt) {
    case "sheet":
    case "mini": {
      sheetFold(state, ctx, t, ev, tgt);
      return ev;
    }
    case "dot": {
      // A field dot is exactly a Sheet fold first (§4.7), then a trace step.
      if (!sheetFold(state, ctx, t, ev, "sheet")) return ev;
      const id = String(action.id ?? "");
      const dash = id.lastIndexOf("-");
      const f = sp.field;
      if (dash <= 0 || !f || f.id !== id.slice(0, dash)) return ev; // a field that has gone: just the fold
      const i = Number(id.slice(dash + 1));
      traceClick(state, ctx, f, i, t, ev);
      return ev;
    }
    case "fold": {
      const fp = sp.fold;
      if (!fp || action.id !== fp.id) return ignore(ev, "gone");
      if (!handHit(state, E, t)) return ignore(ev, "fast");
      sp.fold = null;
      const r = ctx.rates(state.clock);
      earn(state, ev, "fold", K.foldPay * vc(state, E, r, t));
      foldEffect(state, fp.kind, t, ev);
      return ev;
    }
    case "node": {
      const id = String(action.id ?? "");
      const dash = id.lastIndexOf("-");
      const which = dash > 0 ? findChain(sp, id.slice(0, dash)) : null;
      if (!which) return ignore(ev, "gone");
      const chain = sp[which];
      const i = Number(id.slice(dash + 1));
      const node = chain.nodes.find((n) => n.i === i);
      if (!node || node.done) return ignore(ev, "gone");
      if (!handHit(state, E, t)) return ignore(ev, "fast");
      const r = ctx.rates(state.clock);
      const v = vc(state, E, r, t);
      if (i === chain.next) {
        node.done = true;
        chain.next++;
        earn(state, ev, "node", K.nodePay * v);
        if (chain.next >= chain.k) {
          earn(state, ev, "node", K.chainFinishPerNode * chain.k * v);
          sp.lastChain = { result: "done", slots: chainSlots(chain), at: t };
          sp[which] = null;
          ev.push({ kind: "chain", result: "done" });
        }
      } else {
        earn(state, ev, "node", K.nodeWrongPay * v);
        sp.lastChain = { result: "torn", slots: chainSlots(chain), at: t };
        sp[which] = null;
        ev.push({ kind: "chain", result: "torn" });
      }
      return ev;
    }
    case "scrap": {
      const k = sp.scraps.findIndex((s) => s.id === action.id);
      if (k < 0) return ignore(ev, "gone");
      if (!handHit(state, E, t)) return ignore(ev, "fast");
      sp.scraps.splice(k, 1);
      const r = ctx.rates(state.clock);
      earn(state, ev, "scrap", Math.max(K.scrapRp * r.Rp, K.scrapV * r.V) * E.scrapMult);
      return ev;
    }
    case "crane": {
      const c = sp.crane;
      if (!c || (action.id !== undefined && action.id !== null && action.id !== c.id)) return ignore(ev, "gone");
      sp.crane = null;
      state.ui.hints.crane = true;
      const r = ctx.rates(state.clock);
      ev.push({ kind: "crane", outcome: c.outcome });
      if (c.outcome === "storm") {
        addBoost(state, "storm", K.stormFromCraneMs, 30000, 1, ev, Math.min(t, state.clock));
      } else if (c.outcome === "song") {
        addBoost(state, "song", K.songMs, K.songCapMs, 1, ev);
      } else {
        // Crane's Gift ("gift"; a crane saved before the redesign as "lucky"
        // pays it too): folded back from your rhythm and the folk at work.
        earn(state, ev, "crane", giftFolds(state, E, r, t));
      }
      return ev;
    }
    case "boat": {
      const b = sp.boat;
      if (!b || (action.id !== undefined && action.id !== null && action.id !== b.id)) return ignore(ev, "gone");
      sp.boat = null;
      const r = ctx.rates(state.clock);
      state.boosts.tailwind = K.tailwindOpens;
      state.boosts.tailwindMs = K.tailwindMs;
      ev.push({ kind: "boost", type: "tailwind", ms: K.tailwindMs });
      earn(state, ev, "boat", K.boatRp * r.Rp);
      return ev;
    }
    case "ream": {
      const rm = sp.ream;
      if (!rm || (action.id !== undefined && action.id !== null && action.id !== rm.id)) return ignore(ev, "gone");
      sp.ream = null;
      const r = ctx.rates(state.clock);
      earn(state, ev, "ream", Math.max(K.reamRp * r.Rp, K.reamV * r.V));
      return ev;
    }
    default:
      return ignore(ev, "target");
  }
}

/** The Sheet's fold (§4.2): a credited hand hit paying Vc, or 5·Vc and a figure on the wrap. False when not credited. */
function sheetFold(state, ctx, t, ev, src) {
  const E = ctx.E;
  if (!handHit(state, E, t)) {
    ignore(ev, "fast");
    return false;
  }
  const r = ctx.rates(state.clock);
  const v = vc(state, E, r, t);
  const hand = state.hand;
  hand.frame = (hand.frame + 1) % K.figureEvery;
  if (hand.frame === 0) {
    const species = SPECIES[Math.floor(keyed(state, `fig:${state.stats.hits}`) * SPECIES.length)];
    shelve(hand, species);
    earn(state, ev, src, K.figureMult * v);
    ev.push({ kind: "figure", species });
  } else {
    earn(state, ev, src, v);
  }
  return true;
}

function shelve(hand, item) {
  hand.figures.push(item);
  if (hand.figures.length > K.shelfMax) hand.figures.splice(0, hand.figures.length - K.shelfMax);
}

// ---------------------------------------------------------------------------
// Crease fields and fold pieces (§4.7, ARCHITECTURE B17)

/** A dot click's trace step on live field `f` (after its fold). */
function traceClick(state, ctx, f, i, t, ev) {
  const move = traceMove(f, i);
  if (move === "none") return;
  if (move === "start") {
    f.path = [i];
    ev.push({ kind: "trace", result: "start" });
    return;
  }
  if (move === "step") {
    f.path.push(i);
    ev.push({ kind: "trace", result: "step" });
    if (deadEnd(f.path) && f.path.length >= 3) setTrace(state, ctx, f, false, t, ev);
    return;
  }
  setTrace(state, ctx, f, move === "close", t, ev);
}

/**
 * Set field `f`'s trace (open, or `closed`) at `t`: a match pays
 * matchPerNode · chainK · Vc, the same for every diagram (about what the
 * numbered chain it replaces pays above its folds), + firstFindPerDot · n · Vc
 * on the first find, to `pattern`; it counts in the book, may drop a fold piece
 * and ends the field. A loose crease pays nothing more and clears the trace
 * for another try. `lifeEnd`: set by the field's life running out at `t`, so
 * Vc is that moment's (vcAt), not the last hit's.
 */
function setTrace(state, ctx, f, closed, t, ev, rt = state.clock, lifeEnd = false) {
  const sp = state.spawn;
  const path = f.path.slice();
  const id = classifyTrace(path, closed);
  if (id === null) {
    const info = bookInfo(state);
    const ids = [];
    for (const k in state.book.found) ids.push(k);
    if (info.next) ids.push(info.next);
    const near = nearMiss(path, ids);
    sp.lastField = { pattern: null, path, closed, tier: 0, first: false, near: near ? near.id : null, more: near ? near.more : 0, rest: null, at: t };
    f.path = [];
    ev.push({ kind: "trace", result: "loose" });
    return;
  }
  const p = patternOf(id);
  const r = ctx.rates(rt);
  const v = lifeEnd ? vcAt(state, ctx.E, r, t) : vc(state, ctx.E, r, t);
  const book = state.book;
  let rec = Object.hasOwn(book.found, id) ? book.found[id] : null;
  const first = !rec;
  earn(state, ev, "pattern", (K.matchPerNode * ctx.E.chainK + (first ? K.firstFindPerDot * p.n : 0)) * v);
  if (first) {
    rec = { n: 1, at: t, ready: 0 };
    book.found[id] = rec;
  } else {
    rec.n = Math.min(K.bookCountMax, rec.n + 1);
  }
  state.ui.hints.field = true;
  const tier = bookTier(rec.n);
  let rest = null;
  const pulled = p.fx === "pull" && sp.gullFor === sp.cranesSeen;
  if (rec.ready > sp.activeMs) {
    rest = rec.ready - sp.activeMs;
  } else if (!sp.fold && !pulled) {
    // (a Gull drops nothing while this crane gap is already pulled: its fold would do nothing)
    const slots = pickSlots(state, sp, 1);
    if (slots) {
      const fid = `f${sp.seq++}`;
      sp.fold = { id: fid, kind: id, slot: slots[0], born: sp.shownMs };
      ev.push({ kind: "spawn", what: "fold", id: fid });
    }
  }
  sp.lastField = { pattern: id, path, closed, tier, first, near: null, more: 0, rest, pulled: rest === null && pulled, at: t };
  sp.field = null;
  ev.push({ kind: "trace", result: "match", pattern: id, first, tier });
}

/** A fold piece of diagram `kind` clicked at `t`: its effect, its rest, the shelf. */
function foldEffect(state, kind, t, ev) {
  const p = patternOf(kind);
  if (!p) return;
  const sp = state.spawn;
  const hand = state.hand;
  let did = true;
  switch (p.fx) {
    case "steady": hand.steady = 1; break;
    case "pull":
      // at most once per crane, never closer than gullMinMs, never later than it was;
      // a click that pulls nothing starts no rest
      did = sp.gullFor !== sp.cranesSeen && sp.nextCraneAt - sp.activeMs > K.gullMinMs;
      if (did) {
        sp.nextCraneAt = Math.max(sp.activeMs + K.gullMinMs, sp.nextCraneAt - K.gullPullMs);
        sp.gullFor = sp.cranesSeen;
      }
      break;
    case "glow": hand.afterglowMs = Math.min(K.glowMaxMs, hand.afterglowMs + K.napkinGlowMs); break;
    case "finish": hand.frame = Math.max(hand.frame, K.lozengeFrame); break;
    case "lift": hand.r = Math.min(K.rMax, hand.r + K.stairBeats); break;
    case "wind": sp.windUntil = sp.activeMs + K.windMs; break;
    case "hurry":
      // a chain (or field) within 2 s; while one is live the next waits for it to clear (chain-in)
      sp.nextChainAt = Math.min(sp.nextChainAt, sp.activeMs + K.hurryMs);
      sp.hurry = 1;
      break;
    case "margin": sp.fieldIn = 1; break;
    case "windup": state.boosts.coilEnd = Math.max(state.boosts.coilEnd || 0, t + K.coilMs); break;
    default: break;
  }
  const rec = Object.hasOwn(state.book.found, kind) ? state.book.found[kind] : null;
  if (rec && did) rec.ready = sp.activeMs + K.patternRestMs;
  shelve(hand, `p:${kind}`);
  ev.push({ kind: "fold", pattern: kind, fx: p.fx });
}

function ignore(ev, reason) {
  ev.push({ kind: "ignored", reason });
  return ev;
}

function earn(state, ev, source, amount) {
  const a = credit(state, source, amount);
  if (a > 0) ev.push({ kind: "earn", source, amount: a });
}

function freeSlots(sp) {
  const used = Object.create(null);
  for (const c of [sp.chain, sp.chain2]) if (c) for (const n of c.nodes) used[n.slot] = true;
  for (const s of sp.scraps) used[s.slot] = true;
  if (sp.crane) used[sp.crane.slot] = true;
  if (sp.fold) used[sp.fold.slot] = true;
  const out = [];
  for (const i of FREE_SLOTS) if (!used[i]) out.push(i);
  return out;
}

function pickSlots(state, sp, k) {
  const free = freeSlots(sp);
  if (free.length < k) return null;
  const out = [];
  for (let j = 0; j < k; j++) {
    const at = Math.floor(keyed(state, `slot:${sp.seq}:${j}`) * free.length);
    out.push(free[at]);
    free.splice(at, 1);
  }
  return out;
}

/**
 * Crane's Gift (§4.5): the crane is folded back from your rhythm and the folk
 * at work: `giftPerBeat · max(r, giftMinBeats) · V` (a full rhythm of 40 is a
 * thousand hand folds) plus `giftFolk · Hs0`, the folk's boost-free gathering
 * (0 while "Helpers gather" is off). It grows with your beat and the flock at
 * work, never with the bank. `r` is the rhythm the player sees at `t`.
 */
export function giftFolds(state, E, r, t) {
  const beats = Math.max(rhythmAt(state, E, t), K.giftMinBeats);
  return K.giftPerBeat * beats * r.V + K.giftFolk * (E.gather ? r.Hs0 : 0);
}

/** Active ms to the next crane: craneLo · (1 + craneSpread · u) s (§4.5). */
function craneInterval(state, E) {
  const sp = state.spawn;
  const u = keyed(state, `crane-gap:${sp.cranesSeen}:${Math.round(sp.activeMs)}`);
  return E.craneLo * (1 + K.craneSpread * u) * 1000;
}

function creaseHelperOn(state) {
  return state.bought["crease-helper"] === true && state.auto["crease-helper"] !== false;
}

/**
 * Spawn clocks and lives over one live piece of `dt` ms starting at `t`
 * (§4.4, §4.5). Spawn clocks run on active time; lives run on mat-shown time.
 * Events are processed in time order, so the outcome does not depend on how
 * the caller splits time into ticks.
 */
export function spawnPiece(state, ctx, t, dt, shown, active, ev, storm) {
  if (!shown || dt < 0) return;
  const E = ctx.E;
  const sp = state.spawn;
  const A0 = sp.activeMs;
  const S0 = sp.shownMs;
  let x = 0;
  for (let guard = 0; guard < 1000; guard++) {
    let best = Infinity;
    let what = null;
    const consider = (off, w) => {
      if (off < best) { best = off; what = w; }
    };
    for (const key of ["chain", "chain2"]) {
      const c = sp[key];
      if (!c) continue;
      const life = lifeOf(state, E, "chain", c);
      consider(c.born + life - S0, key);
      if (creaseHelperOn(state) && !c.helped) consider(c.born + K.creaseHelperAt * life - S0, `help-${key}`);
    }
    for (const s of sp.scraps) consider(s.born + lifeOf(state, E, "scrap", s) - S0, "scrap-out");
    if (sp.crane) consider(sp.crane.born + lifeOf(state, E, "crane", sp.crane) - S0, "crane-out");
    if (sp.boat) consider(sp.boat.born + lifeOf(state, E, "boat", sp.boat) - S0, "boat-out");
    if (sp.field) consider(sp.field.born + lifeOf(state, E, "field", sp.field) - S0, "field-out");
    if (sp.fold) consider(sp.fold.born + lifeOf(state, E, "fold", sp.fold) - S0, "fold-out");
    if (active) {
      consider(sp.nextChainAt - A0, "chain-in");
      consider(sp.nextScrapAt - A0, "scrap-in");
      consider(sp.nextCraneAt - A0, "crane-in");
      if (E.boat && sp.nextBoatAt !== null) consider(sp.nextBoatAt - A0, "boat-in");
      if (sp.reamDay !== state.day && !sp.ream) consider(0, "ream-in");
    }
    if (what === null || best > dt) break;
    if (best > x) x = best;
    sp.shownMs = S0 + x;
    if (active) sp.activeMs = A0 + x;
    const at = t + x;
    switch (what) {
      case "chain":
      case "chain2":
        sp[what] = null;
        break;
      case "help-chain":
      case "help-chain2": {
        const key = what.slice(5);
        const c = sp[key];
        const r = ctx.rates(at);
        const v = r.V * K.creaseHelperValue;
        const left = c.k - c.next;
        earn(state, ev, "node", (K.nodePay * left + K.chainFinishPerNode * c.k) * v);
        sp.lastChain = { result: "done", slots: chainSlots(c), at };
        sp[key] = null;
        ev.push({ kind: "chain", result: "done" });
        break;
      }
      case "scrap-out": {
        const lim = S0 + x;
        sp.scraps = sp.scraps.filter((s) => s.born + lifeOf(state, E, "scrap", s) > lim);
        break;
      }
      case "crane-out": sp.crane = null; break;
      case "boat-out": sp.boat = null; break;
      case "field-out": {
        // Life end (§4.7): a trace of 3 or more dots sets, open, at Vc of this moment.
        const f = sp.field;
        if (f.path.length >= 3) setTrace(state, ctx, f, false, at, ev, at, true);
        sp.field = null;
        ev.push({ kind: "trace", result: "expired" });
        break;
      }
      case "fold-out": sp.fold = null; break; // unclicked: no rest
      case "chain-in": {
        // Crease fields (§4.7) take every K.fieldEvery-th primary chain's place;
        // Confetti's chains are always numbered and never count down.
        const fields = !storm && sp.fieldIn !== null && sp.fieldIn !== undefined;
        if (fields && sp.field && state.settings.nodes !== false) {
          sp.nextChainAt = sp.activeMs + K.fieldWaitMs; // a field is up: the chain waits
          break;
        }
        const key = !sp.chain ? "chain" : storm && !sp.chain2 ? "chain2" : null;
        if (!key && sp.hurry === 1 && state.settings.nodes !== false) {
          // Hurry (a Switchback fold) with a chain still live: wait for it to clear, a
          // second at a time like a field, instead of starting a full interval now
          sp.nextChainAt = sp.activeMs + K.fieldWaitMs;
          break;
        }
        sp.nextChainAt = sp.activeMs + (storm ? K.chainStormMs : E.chainEveryMs);
        if (state.settings.nodes === false) break;
        if (!key) break;
        sp.hurry = 0;
        if (fields && sp.fieldIn === 1) {
          const id = `p${sp.seq++}`;
          sp.field = { id, born: sp.shownMs, path: [] };
          sp.fieldIn = K.fieldEvery;
          ev.push({ kind: "spawn", what: "field", id });
          break;
        }
        const slots = pickSlots(state, sp, E.chainK);
        if (!slots) break;
        const id = `c${sp.seq++}`;
        sp[key] = { id, k: E.chainK, next: 0, born: sp.shownMs, nodes: slots.map((slot, i) => ({ i, slot, done: false })) };
        if (fields) sp.fieldIn -= 1;
        ev.push({ kind: "spawn", what: "chain", id });
        break;
      }
      case "scrap-in": {
        sp.nextScrapAt = sp.activeMs + K.scrapEveryMs;
        if (sp.scraps.length >= K.scrapMaxLive) break;
        const slots = pickSlots(state, sp, 1);
        if (!slots) break;
        const id = `s${sp.seq++}`;
        const sc = { id, slot: slots[0], born: sp.shownMs };
        if (sp.activeMs < (sp.windUntil || 0)) sc.wind = true; // Fair wind (Sail fold, §4.7)
        sp.scraps.push(sc);
        ev.push({ kind: "spawn", what: "scrap", id });
        break;
      }
      case "crane-in": {
        if (sp.crane) { sp.nextCraneAt = sp.activeMs + craneInterval(state, E); break; }
        const slots = pickSlots(state, sp, 1);
        if (!slots) { sp.nextCraneAt = sp.activeMs + craneInterval(state, E); break; }
        const outcome = craneOutcome(state, sp.cranesSeen);
        const id = `g${sp.seq++}`;
        sp.crane = { id, slot: slots[0], born: sp.shownMs, outcome };
        if (sp.activeMs < (sp.windUntil || 0)) sp.crane.wind = true;
        sp.cranesSeen++;
        sp.nextCraneAt = sp.activeMs + craneInterval(state, E);
        ev.push({ kind: "spawn", what: "crane", id, n: sp.cranesSeen });
        break;
      }
      case "boat-in": {
        sp.nextBoatAt = sp.activeMs + (K.boatLo + K.boatSpread * keyed(state, `boat:${Math.round(sp.activeMs)}`)) * 1000;
        if (sp.boat) break;
        const id = `b${sp.seq++}`;
        sp.boat = { id, born: sp.shownMs };
        ev.push({ kind: "spawn", what: "boat", id });
        break;
      }
      case "ream-in": {
        const id = `r${sp.seq++}`;
        sp.ream = { id, day: state.day, slot: SLOT.ream };
        sp.reamDay = state.day;
        ev.push({ kind: "spawn", what: "ream", id });
        break;
      }
      default:
        break;
    }
  }
  sp.shownMs = S0 + dt;
  if (active) sp.activeMs = A0 + dt;
}

/**
 * The one source of piece lives (ARCHITECTURE B17), mat-shown ms: a chain's
 * nodes, a scrap, a gilded crane, the boat, a crease field or a fold piece
 * (`what`). Calm mode doubles every one (through E); a scrap or crane born
 * under Fair wind (`item.wind`, a Sail fold) lives K.windLife times longer.
 * spawnPiece and lifeLeft (so the view) both read it.
 */
export function lifeOf(state, E, what, item) {
  const wind = item && item.wind === true ? K.windLife : 1;
  switch (what) {
    case "chain": return E.nodeLifeMs;
    case "scrap": return E.scrapLifeMs * wind;
    case "crane": return E.craneLifeMs * wind;
    case "boat": return E.boatLifeMs;
    case "field": return E.fieldLifeMs;
    case "fold": return E.foldLifeMs;
    default: return 0;
  }
}

/** ms of life left for a live chain / scrap / crane / boat / field / fold (null for the ream). */
export function lifeLeft(state, E, what, item) {
  if (!item || item.born === undefined) return null;
  return Math.max(0, item.born + lifeOf(state, E, what, item) - state.spawn.shownMs);
}

// The save files (ARCHITECTURE A4, A5, A6; DESIGN §12).
//
//   <appHome>/data/creaseworks/save.json             current save
//   <appHome>/data/creaseworks/save.bak.json         previous good save (rotated ≤ every 5 min)
//   <appHome>/data/creaseworks/save.damaged-<n>.json damaged files kept aside (n = 1..5, oldest replaced)
//   <appHome>/data/creaseworks/save.recovery.json    only while save.json can't be read (> 1 MiB, not a file)
//   <appHome>/data/creaseworks/location.json         {"path": "/abs/…/save.json"} while sharing; {"path": null} after
//
// Written only with writeTextFile(path, text, expected) (compare-and-swap),
// read with readTextFile. Every non-clean outcome sets a visible save notice;
// nothing here is ever silent. All functions are async host work run from a
// `cx.spawn` task; each one re-checks its write generation after every await,
// so a superseded or reloaded write never touches the live slot. Every claim
// of `save.writing` also records the code generation that made it: herdr
// cancels a reloaded generation's tasks without settling them, so the new
// generation's init releases such a claim (adopt) instead of waiting forever.

import { readTextFile, writeTextFile, shared, setShared } from "herdr";
import { serialize, parseSave, parseSaveSteps, newGame, apply, advance, migrate, clip, graphemes, CONTENT } from "../engine/index.js";
import { localDay, localTime } from "./clock.js";
import { touch, markDirty, dueAt, codeGeneration, confirmLog, clearLog, flash, DEBOUNCE_MS } from "./live.js";

export const MOD = "creaseworks";
export const BACKUP_EVERY_MS = 5 * 60000;
export const DAMAGED_MAX = 5;
export const MERGE_RETRIES = 3;
/** Error back-off: 10 s, 30 s, 60 s, then every 5 min (A4 step 6). */
export const BACKOFF_MS = Object.freeze([10000, 30000, 60000, 300000]);
export const MERGED_MS = 6000;
/**
 * herdr's shared map (per process, kept in the app home's shared.json) under
 * this key lists the writer ids this window's VMs used: a VM restart
 * (restart_mods) loads the new VM while the old one's close() write is still
 * landing, and that write is this window's own progress, not "another
 * window's" (r2-09). The last few are kept.
 */
export const WRITERS_KEY = "creaseworks.writers";
const WRITERS_KEPT = 8;
/**
 * Replay work per task slice (an action costs 1, an observation 1 more per 8
 * helpers): about 80 ms of QuickJS at the worst measured cost, so a long
 * backlog is replayed across `cx.sleep(0)` slices, never in one 500 ms step.
 */
export const REPLAY_SLICE = 400;
/**
 * A save claim that has made no progress for this long is treated as
 * abandoned (a task that will never settle), whatever the cause; a host file
 * call normally takes milliseconds. CAS and the claim checks keep a slow but
 * live claimant harmless.
 */
export const WRITE_STALL_MS = 60000;
/**
 * A save claim whose copy has gone (closed: herdr cancels every task of that
 * copy's application generation, owner: null ones too) is released once the
 * copy has been missing from `slot.copies` this long. A copy that is still
 * open beats at least every 5 s (hidden), so one only taken over by a newly
 * opened copy (live.js takeOver) is back well within it.
 */
export const ORPHAN_MS = 15000;

/**
 * The notices of a released Settings save tool claim (Check, Reset, Restore,
 * Share: it may not have taken effect). A plain save cycle's claim is
 * released quietly: the save it held is made again at once and nothing is
 * lost (`save.writingFor`, dropClaim).
 */
const STALLED = "A save step stopped before finishing; saving again. A Settings save tool used just then may not have taken effect.";
const ORPHANED = "A save step was cut off when a Creaseworks view closed; saving again. A Settings save tool used just then may not have taken effect.";
/** save.json went missing under a running game (deleted, moved): it is written again (r3-09). */
export const MISSING_TEXT = "The save file was missing (deleted or moved); this window's game was saved to it again.";
/** A Settings save tool's claim cut off by a hot reload (adopt, r3-07). */
const RELOADED = "A save step was cut off when Creaseworks reloaded; saving again. A Settings save tool used just then may not have taken effect.";
/** A plain save cycle that stalled (no progress for WRITE_STALL_MS): a short flash, nothing lost. */
const STALLED_FLASH = "A save step stalled; saving again.";
/** Claims whose release is said quietly (A4: the save they held is simply made again). */
const PLAIN_CLAIMS = Object.freeze(["cycle", "resolve"]);

/** The banner shows this many graphemes of a save notice (engine view.js CLIP.notice). */
export const NOTICE_MAX = 140;

const CAS_TEXTS = ["The file changed outside Herdr", "The file changed while saving", "File exists", "os error 17"];

/** The paths for app home `home`, or for a shared save file `shared` (backups live next to it). */
export function pathsFor(home, shared = null) {
  const h = String(home).replace(/[\\/]+$/, "");
  const dir = `${h}/data/${MOD}`;
  const save = typeof shared === "string" && shared ? shared : `${dir}/save.json`;
  const stem = save.replace(/\.json$/, "");
  return {
    dir,
    location: `${dir}/location.json`,
    save,
    bak: `${stem}.bak.json`,
    recovery: `${stem}.recovery.json`,
    damaged: (n) => `${stem}.damaged-${n}.json`,
    shared: typeof shared === "string" && shared ? shared : null,
  };
}

/** Plain-data paths for the slot (no functions in the slot). */
export function slotPaths(home, shared = null) {
  const p = pathsFor(home, shared);
  return { dir: p.dir, location: p.location, save: p.save, bak: p.bak, recovery: p.recovery, shared: p.shared };
}

const damagedPath = (paths, n) => `${paths.save.replace(/\.json$/, "")}.damaged-${n}.json`;
/** The last path component, after "/" or "\\" (herdr builds for Windows too). */
const baseName = (p) => String(p).slice(Math.max(String(p).lastIndexOf("/"), String(p).lastIndexOf("\\")) + 1);

/**
 * An absolute path on any platform herdr builds for: "/…" (Unix, and "//server/…"),
 * a drive letter "C:\\…" or "C:/…", or a UNC path "\\\\server\\share\\…"
 * (pickFiles returns native paths: src/mods.rs picked_files).
 */
export function isAbsolutePath(p) {
  return typeof p === "string" && (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || /^\\\\[^\\]/.test(p));
}
/** The end of `str` within `max` graphemes ("…/usb/creaseworks/save.json"), never cut inside one. */
function tailClip(str, max) {
  const g = graphemes(String(str));
  return g.length <= max ? g.join("") : `…${g.slice(g.length - (max - 1)).join("")}`;
}
const recoveryPath = (paths) => paths.recovery || `${paths.save.replace(/\.json$/, "")}.recovery.json`;
const backoff = (errors) => BACKOFF_MS[Math.min(Math.max(1, errors), BACKOFF_MS.length) - 1];
const spoken = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60000)} min`);

/**
 * Claims `save.writing`; returns the claim's number. The claim records the
 * copy that made it (`env.owner`), the code generation, the time and what it
 * is for (`for`: "cycle", "resolve", "check", "reset", "restore", "share"), so
 * a claim whose task herdr cancelled can be told apart (adopt, due) and its
 * release said only when a Settings save tool may not have taken effect.
 */
function claim(S, env, what) {
  const gen = (S.gen += 1);
  S.writing = gen;
  S.writingFor = what;
  S.writingBy = env && typeof env.owner === "string" ? env.owner : null;
  S.writingGen = codeGeneration();
  S.writingAt = env && typeof env.now === "function" ? env.now() : null;
  S.orphanAt = null;
  return gen;
}

/** Ends claim `gen` if it is still the one held. */
function release(S, gen) {
  if (S.writing !== gen) return false;
  abandonClaim(S);
  return true;
}

function abandonClaim(S) {
  S.writing = null;
  S.writingBy = null;
  S.writingFor = null;
  S.writingGen = null;
  S.writingAt = null;
  S.orphanAt = null;
}

/** Lets the player know a Settings save tool waits for the write under way. */
function busy(slot, env) {
  if (env && typeof env.flash === "function") env.flash("A save is being written right now; try again in a moment.");
  return "busy";
}

/** Yields the task (a fresh 500 ms budget) when the caller gave a sleep, else a microtask. */
const pause = (env) => (env && typeof env.sleep === "function" ? env.sleep(0) : Promise.resolve());

/** Records progress on the save claim (WRITE_STALL_MS counts from the last one). */
function progress(slot, env) {
  if (!env || typeof env.now !== "function") return;
  if (slot.save.writing !== null) slot.save.writingAt = env.now();
  // The load's own progress (session.js watches for a load that stopped: r3-01).
  if (slot.loading && env.gen === slot.loading) slot.loadAt = env.now();
}

/** Saves shorter than this parse in one go (well under 100 ms); longer ones in steps. */
export const STEP_PARSE_CHARS = 64 * 1024;

/**
 * parseSave(text) across task steps (engine parseSaveSteps, DESIGN R13): a
 * two-year save takes most of a 500 ms step to parse in one go, so the load
 * and every merge yield between its steps (≈ 60 ms each at most). Returns
 * parseSave's result, or null when `stale()` turns true during a yield.
 */
async function parseIn(slot, text, env, stale) {
  if (typeof text !== "string" || text.length < STEP_PARSE_CHARS) return parseSave(text);
  const it = parseSaveSteps(text);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    await pause(env);
    if (stale()) return null;
    progress(slot, env);
  }
}

/**
 * replay(live, slot.pending) in slices (REPLAY_SLICE) with a task yield
 * between them. Actions dispatched during a yield join the end of the log and
 * are replayed too. A log given up during a yield (live.js PENDING_MAX) is
 * still replayed to its end from the array in hand, then the new log after
 * it, so the result is whole. Returns the engine's events, `null` when
 * superseded, or `"lost"` only when a whole log was given up unseen (two in
 * one yield).
 */
async function replayPending(live, slot, env, stale) {
  const ev = [];
  let log = slot.pending;
  let epoch = slot.logEpoch || 0;
  let cost = 0;
  let lastS = -Infinity;
  let i = 0;
  for (;;) {
    if (i >= log.length) {
      if (slot.pending === log) break;
      // The log was given up: everything in the old array is replayed; go on with the new one.
      if ((slot.logEpoch || 0) - epoch > 1) return "lost";
      epoch = slot.logEpoch || 0;
      log = slot.pending;
      i = 0;
      while (i < log.length && log[i].s <= lastS) i++;
      continue;
    }
    const a = log[i++];
    for (const e of apply(live, a)) ev.push(e);
    lastS = a.s;
    cost += 1 + (Array.isArray(a.helpers) ? a.helpers.length >> 3 : 0);
    if (cost >= REPLAY_SLICE && (i < log.length || slot.pending !== log)) {
      cost = 0;
      await pause(env);
      if (stale()) return null;
      progress(slot, env);
      // A coalesced observation may have left the array: resume after the last one replayed.
      i = 0;
      while (i < log.length && log[i].s <= lastS) i++;
    }
  }
  return ev;
}

/**
 * This window's earlier writer ids (WRITERS_KEY), with `id` recorded as the
 * newest. Best effort: without the shared map nothing is remembered.
 */
function rememberWriter(id) {
  let prev = [];
  try {
    const v = shared(WRITERS_KEY);
    if (Array.isArray(v)) prev = v.filter((x) => typeof x === "string" && x !== id);
  } catch {
    // no shared map here: every earlier writer counts as another window
  }
  try {
    setShared(WRITERS_KEY, [...prev, id].slice(-WRITERS_KEPT));
  } catch {
    // not recorded: a later VM restart may say "merged" once
  }
  return prev.slice(-(WRITERS_KEPT - 1));
}

/** applied[writer] of `state` (0 when it holds none of that writer's actions). */
function ownApplied(state, writer) {
  return state && state.applied && Object.hasOwn(state.applied, writer) ? state.applied[writer] : 0;
}

/**
 * Releases an abandoned save claim: status put right, a save made due at once.
 * `why` (a stalled or orphaned Settings save tool: Check, Reset, Restore,
 * Share) is said in a notice that stays until dismissed, since that tool may
 * not have taken effect. A plain save cycle loses nothing (its save is made
 * again, a cut-off share or Reset is carried by `sharing` / `overwrite`): an
 * orphaned one is released quietly (closing the panel mid-save is ordinary,
 * r2-06), a stalled one with `quiet` as a short flash.
 */
function dropClaim(slot, t, inflightToo = false, why = null, quiet = null) {
  const S = slot.save;
  const plain = PLAIN_CLAIMS.includes(S.writingFor);
  abandonClaim(S);
  // A main write that never settled may have landed: the next write's CAS
  // finds out (a conflict with our own text merges without counting twice).
  if (inflightToo) slot.inflight = null;
  if (S.status === "saving") S.status = S.unreadable || S.errors > 0 ? "error" : "ok";
  if (slot.state && !slot.readOnly) {
    markDirty(slot, t, true);
    S.urgentAt = t;
    if (why) S.retryAt = 0;
    if (why && !plain) setNotice(slot, "load", { kind: "recovered", text: why, at: t });
    else if (why && quiet) flash(slot, quiet, t);
  }
  touch(slot);
}

/**
 * A claim whose copy closed: its tasks were cancelled with the copy's
 * application generation, so it never settles (r2-06). Released once the
 * copy has been gone ORPHAN_MS (a copy only taken over beats again sooner).
 */
function orphaned(slot, t) {
  const S = slot.save;
  const by = S.writingBy;
  if (S.writing === null || typeof by !== "string" || !slot.copies || by in slot.copies) {
    S.orphanAt = null;
    return false;
  }
  if (typeof S.orphanAt !== "number" || S.orphanAt > t) {
    S.orphanAt = t;
    return false;
  }
  return t - S.orphanAt >= ORPHAN_MS;
}

/**
 * A copy's init adopts the slot (hot reload, A6). herdr cancels the old
 * generation's tasks without settling them, so a save claim made by an older
 * code generation (live.js codeGeneration: herdr evaluates the mod's modules
 * again on every reload) is released, wherever that task stopped: the main
 * write, the backup rotation, a merge read, a Settings tool. A claim made in
 * this generation is kept when its copy was only taken over (a second panel
 * opened): that copy is still open and its task (owner: null) settles the
 * claim itself. A claim whose copy closed is not: herdr cancels every task of
 * the closed copy's application generation, owner: null ones too, so due()
 * releases it once the copy has stayed gone ORPHAN_MS (WRITE_STALL_MS covers
 * anything else). True
 * when an older main write may have landed (`inflight`): the caller then runs
 * resolveInflight.
 */
export function adopt(slot, t) {
  const S = slot.save;
  if (S.writing !== null && S.writingGen !== codeGeneration()) {
    // A Settings save tool (Check, Reset, Restore, a share cut off before its
    // pointer write) may not have taken effect: said, never silent (r3-07). A
    // share cut off after it (`sharing`) is settled and said by the next cycle
    // (settleShare); a plain save cycle is simply made again.
    const what = S.writingFor;
    const plain = PLAIN_CLAIMS.includes(what) || (what === "share" && !!S.sharing);
    dropClaim(slot, t, false, plain ? null : RELOADED);
  }
  return !!slot.inflight && S.writing === null;
}

/**
 * The wall clock moved back (NTP, a manual change): save timers set from the
 * later clock are moved to `t`, so neither saving nor backup rotation waits
 * out the jump.
 */
export function rebaseClock(slot, t) {
  const S = slot.save;
  if (S.dirtyAt !== null && S.dirtyAt > t) S.dirtyAt = t;
  if (S.urgentAt !== null && S.urgentAt > t + DEBOUNCE_MS) S.urgentAt = t + DEBOUNCE_MS;
  const cap = BACKOFF_MS[BACKOFF_MS.length - 1];
  if (S.retryAt > t + cap) S.retryAt = t + backoff(S.errors);
  if ((S.bakRetryAt || 0) > t + cap) S.bakRetryAt = t + cap;
  if (slot.bakAt !== null && slot.bakAt > t) slot.bakAt = t;
  if (S.savedAt !== null && S.savedAt > t) S.savedAt = t;
}

/** The host message without herdr's "`herdr.fn`: " prefix. */
export function hostMessage(e) {
  const m = e && typeof e.message === "string" ? e.message : String(e);
  return m.replace(/^`herdr\.[A-Za-z]+`: /, "");
}

/** A compare-and-swap rejection (another writer changed the file). */
export function isCas(e) {
  const m = hostMessage(e);
  return CAS_TEXTS.some((s) => m.includes(s));
}

async function readOrError(path) {
  try {
    return { text: await readTextFile(path), error: null };
  } catch (e) {
    return { text: null, error: hostMessage(e) };
  }
}

/** The name of the kept-aside file (save.damaged-<n>.json) whose text is `text`, or null. */
async function findKept(paths, text) {
  if (typeof text !== "string") return null;
  for (let n = DAMAGED_MAX; n >= 1; n--) {
    const r = await readOrError(damagedPath(paths, n));
    if (r.text === text) return baseName(damagedPath(paths, n));
  }
  return null;
}

/**
 * Keeps damaged text aside as save.damaged-<n>.json, the newest always at the
 * highest n: after the highest n in use; when 5 is in use the kept files move
 * down to close any gap (one removed by hand) and, only when all five hold a
 * copy, the oldest (1) is replaced (r3-08: a gap was filled first, so the next
 * shift dropped a newer copy instead of the oldest). Text that is already kept
 * is not kept twice (r3-01: a damaged save.json read again on every reload
 * filled all five). Returns the file name, or null when it could not be
 * written.
 */
export async function keepAside(paths, text) {
  return (await keepAsideShifting(paths, text)).name;
}

/**
 * keepAside, also saying where the kept files went: `moves[n]` is the n a
 * listed save.damaged-<n>.json holds its text at now (0: replaced), for every
 * n that moved; empty when nothing moved.
 */
async function keepAsideShifting(paths, text) {
  const have = [];
  const bad = [];
  for (let n = 1; n <= DAMAGED_MAX; n++) {
    const r = await readOrError(damagedPath(paths, n));
    have.push(r.text);
    bad.push(r.error !== null);
  }
  const moves = Object.create(null);
  for (let n = DAMAGED_MAX; n >= 1; n--) {
    if (have[n - 1] === text) return { name: baseName(damagedPath(paths, n)), moves, already: true };
  }
  let top = 0;
  for (let n = 1; n <= DAMAGED_MAX; n++) if (have[n - 1] !== null || bad[n - 1]) top = n;
  if (top < DAMAGED_MAX) {
    try {
      await writeTextFile(damagedPath(paths, top + 1), text, null);
      return { name: baseName(damagedPath(paths, top + 1)), moves };
    } catch {
      return { name: null, moves };
    }
  }
  // 5 is in use. An unreadable kept file cannot be moved (herdr's write reads
  // it first): the copy goes to a free n if there is one, else it is not kept.
  if (bad.some((x) => x)) {
    const free = have.findIndex((x, i) => x === null && !bad[i]);
    if (free < 0) return { name: null, moves };
    try {
      await writeTextFile(damagedPath(paths, free + 1), text, null);
      return { name: baseName(damagedPath(paths, free + 1)), moves };
    } catch {
      return { name: null, moves };
    }
  }
  // Close the gaps, oldest first; the oldest leaves only when all five are full.
  const kept = [];
  for (let n = 1; n <= DAMAGED_MAX; n++) if (have[n - 1] !== null) kept.push(n);
  const keep = kept.slice(kept.length - (DAMAGED_MAX - 1));
  const dest = Object.create(null); // old n → new n
  for (const n of kept) dest[n] = 0;
  keep.forEach((n, i) => (dest[n] = i + 1));
  const want = keep.map((n) => have[n - 1]).concat([text]);
  let done = 0; // files 1..done hold what they should
  try {
    for (let i = 1; i <= want.length; i++) {
      if (have[i - 1] !== want[i - 1]) await writeTextFile(damagedPath(paths, i), want[i - 1], have[i - 1]);
      done = i;
    }
  } catch {
    // (a move cut short: a file not yet written still holds its own text)
  }
  for (const n of kept) {
    const to = dest[n];
    // A copy is where it went once that file was written; else still at n unless n was overwritten.
    const at = to > 0 && to <= done ? to : n > done ? n : 0;
    if (at !== n) moves[n] = at;
  }
  return done === want.length ? { name: baseName(damagedPath(paths, want.length)), moves } : { name: null, moves };
}

/**
 * Keeps `text` aside (keepAside) and lists it in Details (`save.damaged`,
 * with `reason` when given). When kept files moved, the names already listed
 * move with them (one replaced leaves the list), so every name listed is the
 * file that holds what it was listed for. Returns the kept file's name, or null.
 */
async function keepAsideListed(slot, paths, text, reason = null) {
  const r = await keepAsideShifting(paths, text);
  const S = slot.save;
  if (Object.keys(r.moves).length) {
    const stem = baseName(paths.save).replace(/\.json$/, "");
    const next = [];
    for (const d of S.damaged) {
      const m = String(d).match(/^(.*)\.damaged-(\d+)\.json(.*)$/);
      const n = m && m[1] === stem ? Number(m[2]) : NaN;
      if (!(n in r.moves)) {
        if (next.indexOf(d) < 0) next.push(d);
        continue;
      }
      if (r.moves[n] === 0) continue; // replaced
      const moved = `${stem}.damaged-${r.moves[n]}.json${m[3]}`;
      if (next.indexOf(moved) < 0) next.push(moved);
    }
    S.damaged = next;
  }
  if (r.name) {
    const entry = reason ? `${r.name} (${reason})` : r.name;
    // (a name listed before for a file that has gone since is not that file any more)
    S.damaged = S.damaged.filter((d) => d !== r.name && !String(d).startsWith(`${r.name} (`));
    S.damaged.push(entry);
  }
  return r.name;
}

function setNotice(slot, which, notice) {
  slot.notices[which] = notice;
  refreshNotice(slot);
}

/** The save notice on show: write problems first, then load outcomes. */
export function refreshNotice(slot) {
  const rank = { error: 6, conflict: 5, newer: 4, fresh: 3, recovered: 2, merged: 1 };
  // write problems, then the backup's, then load outcomes (the first wins a tie)
  let pick = null;
  for (const n of [slot.notices.write, slot.notices.bak, slot.notices.load]) {
    if (n && (!pick || (rank[n.kind] ?? 0) > (rank[pick.kind] ?? 0))) pick = n;
  }
  const S = slot.save;
  const problem = pick && (pick.kind === "error" || pick.kind === "fresh") ? pick : null;
  if (problem && S.problemSince === null) S.problemSince = problem.at;
  if (!problem) S.problemSince = null;
  if (slot.notice !== pick) {
    slot.notice = pick;
    touch(slot);
  }
}

/** The kind and id of the save-problem episode on show (notifications, ribbon rescue), or null. */
export function problemEpisode(slot) {
  const n = slot.notice;
  if (!n || (n.kind !== "error" && n.kind !== "fresh")) return null;
  return { kind: n.kind, id: `${n.kind}:${slot.save.problemSince ?? n.at}`, since: slot.save.problemSince ?? n.at, text: n.text ?? null };
}

/**
 * Loads the game (A4 load order) into `slot`: location.json → save.json → if
 * damaged, keep it aside and try save.bak.json → if damaged too, keep it aside
 * and start fresh. `opts`: { now, seed, writer, gen, sleep } (gen guards a
 * load that a reload superseded; `sleep` is the task's cx.sleep: every parse
 * step of a large save, and each parse, runs in a task step of its own, never
 * in one 500 ms step: r3-01). Sets slot.state, baseText, bakText and the load
 * notice; `slot.loadAt` records its progress (session.js restarts a load that
 * stopped).
 */
export async function load(slot, opts) {
  const stale = () => slot.loading !== opts.gen;
  const home = slot.home;
  const t0 = opts.now();
  // A shared save (location.json) wins over the local one.
  const loc = await readOrError(pathsFor(home).location);
  if (stale()) return false;
  let shared = null;
  let locBad = loc.error !== null;
  if (loc.text !== null) {
    try {
      const doc = JSON.parse(loc.text);
      if (doc && typeof doc.path === "string" && isAbsolutePath(doc.path) && doc.path.endsWith(".json")) shared = doc.path;
      // {"path": null} is what "stop sharing" writes: this window's own save, nothing damaged
      else if (!(doc && typeof doc === "object" && doc.path === null)) locBad = true;
    } catch {
      locBad = true; // a damaged pointer: fall back to the local save, and say so below
    }
  }
  slot.paths = slotPaths(home, shared);
  const fresh = () => newGame({ seed: opts.seed, now: t0, day: localDay(t0) });
  const S = slot.save;
  let main = await readOrError(slot.paths.save);
  if (stale()) return false;
  let bak = await readOrError(slot.paths.bak);
  if (stale()) return false;
  // The shared save is not there (deleted, moved, a drive not mounted): this
  // window's own save loads, with a notice, and nothing is created at the
  // shared path (sharing it again in Settings rejoins). Never a silent fresh start.
  let missingShared = null;
  if (shared && main.error === null && bak.error === null && main.text === null && bak.text === null) {
    missingShared = shared;
    slot.paths = slotPaths(home, null);
    main = await readOrError(slot.paths.save);
    if (stale()) return false;
    bak = await readOrError(slot.paths.bak);
    if (stale()) return false;
  }
  const P = slot.paths;
  slot.bakText = bak.text;
  slot.bakAt = null;
  slot.bakState = null;
  slot.readOnly = false;
  S.unreadable = null;
  S.recoveryText = null;
  S.overwrite = null;
  S.logLost = false;
  let state = null;
  let notice = null;

  if (main.error !== null) {
    // Unreadable (too big, not a file): herdr's write pre-reads the file, so
    // nothing can replace it. Progress goes to save.recovery.json on the normal
    // cadence until the player moves the file away (the banner says so).
    const rec = await readOrError(recoveryPath(P));
    if (stale()) return false;
    const r = rec.text !== null ? await parseIn(slot, rec.text, opts, stale) : null;
    if (stale()) return false;
    // Each parse in task steps of its own (r3-01: both in one step went past 500 ms).
    if (r !== null) await pause(opts);
    if (stale()) return false;
    const b = bak.text !== null ? await parseIn(slot, bak.text, opts, stale) : null;
    if (stale()) return false;
    if (b) slot.bakState = b.ok ? "ok" : "damaged";
    // The newer of the two: a recovery file left from an earlier episode must
    // not roll back the normally rotated backup (nothing retires it).
    const rOk = r && r.ok ? r.state : null;
    const bOk = b && b.ok ? b.state : null;
    state = rOk && (!bOk || rOk.clock >= bOk.clock) ? rOk : bOk || fresh();
    S.unreadable = main.error;
    S.recoveryText = rec.error === null ? rec.text : null;
    notice = unreadableNotice(P, main.error, t0);
    slot.baseText = null;
    S.baseOk = false;
  } else if (main.text === null && bak.text === null) {
    state = fresh(); // first run: the first tick creates the save
    slot.baseText = null;
    S.baseOk = false;
  } else {
    const m = main.text !== null ? await parseIn(slot, main.text, opts, stale) : null;
    if (stale()) return false;
    if (m && m.ok) {
      state = m.state;
      slot.baseText = main.text;
      S.baseOk = true;
    } else if (m && m.reason === "newer") {
      state = m.state ?? fresh();
      slot.baseText = main.text;
      S.baseOk = false;
      slot.readOnly = true;
      notice = { kind: "newer", at: t0 };
    } else {
      // save.json damaged (or missing beside a backup)
      let kept = null;
      if (main.text !== null) {
        kept = await keepAsideListed(slot, P, main.text);
        if (stale()) return false;
      }
      await pause(opts); // the backup parses in task steps of its own (r3-01)
      if (stale()) return false;
      slot.baseText = main.text;
      S.baseOk = false;
      const b = bak.text !== null ? await parseIn(slot, bak.text, opts, stale) : null;
      if (stale()) return false;
      if (b) slot.bakState = b.ok ? "ok" : "damaged";
      if (b && b.ok) {
        state = b.state;
        const when = localTime(state.clock);
        const lead = main.text === null ? "Save was missing." : "Save was damaged.";
        const tail = main.text === null ? "" : kept ? " Damaged copy kept." : " The damaged copy could not be kept.";
        notice = { kind: "recovered", text: `${lead} Loaded the backup from ${when}.${tail}`, at: t0 };
      } else {
        let keptBak = null;
        if (bak.text !== null) {
          keptBak = await keepAsideListed(slot, P, bak.text);
          if (stale()) return false;
        }
        await pause(opts);
        if (stale()) return false;
        state = fresh();
        notice = { kind: "fresh", text: freshText(main.text !== null, kept, bak.text !== null, keptBak), at: t0 };
      }
    }
  }
  if (locBad && !notice) {
    notice = { kind: "recovered", text: "The shared-save pointer (location.json) was damaged. Using this window's own save.", at: t0 };
  }
  let goneNotice = null;
  if (missingShared) {
    const gone = `Shared save not found: ${tailClip(missingShared, 40)}. Using this window's own; share again in Settings when it's back.`;
    if (!notice) notice = { kind: "recovered", text: gone, at: t0 };
    else if (typeof notice.text === "string" && notice.kind !== "error") notice = { ...notice, text: goneJoined(notice.text) };
    else goneNotice = { kind: "recovered", text: gone, at: t0 }; // beside an unreadable local save (a newer one wins)
  }
  slot.state = state;
  if (!Array.isArray(slot.ownWriters) || slot.ownWriters.length === 0) slot.ownWriters = rememberWriter(slot.writerId);
  clearLog(slot);
  S.ownApplied = ownApplied(state, slot.writerId);
  slot.inflight = null;
  S.writing = null;
  S.writingBy = null;
  S.writingFor = null;
  S.status = slot.readOnly ? "readonly" : "ok";
  S.savedAt = S.baseOk ? t0 : null;
  slot.notices.bak = null;
  S.bakError = null;
  S.bakErrors = 0;
  S.bakRetryAt = 0;
  if (notice && notice.kind === "error") {
    // save.json unreadable: shown at once; the recovery file is written on the normal cadence
    slot.notices.write = notice;
    slot.notices.load = goneNotice;
    S.errors = 1;
    S.retryAt = 0;
    S.status = "error";
  } else {
    slot.notices.load = notice;
    slot.notices.write = null;
  }
  refreshNotice(slot);
  // A first run or a repaired save is written at once.
  if (!S.baseOk && !slot.readOnly) {
    markDirty(slot, t0, true);
    S.urgentAt = t0;
  } else if (!slot.readOnly) {
    // Otherwise saved within the 2 s debounce, not the 15 s cadence: on a VM
    // restart the old VM's final write may land just after this read, and the
    // compare-and-swap of this first save merges it back in at once (r2-09).
    markDirty(slot, t0, true);
  }
  touch(slot);
  return true;
}

/**
 * The load stopped (a load task cut off: herdr's budget, a closed view) and
 * was started again `tries` times before this one finished: said in a load
 * notice unless the load gave one of its own (r3-01: never silent).
 */
export function noteLoadRetried(slot, t, tries) {
  if (!(tries > 0) || slot.notices.load) return;
  setNotice(slot, "load", { kind: "recovered", text: LOAD_RETRIED_TEXT, at: t });
}

/** The load notice after a load that had to be started again (noteLoadRetried). */
export const LOAD_RETRIED_TEXT = "Opening the save stopped partway and was started again; it opened fine.";

/**
 * A missing shared save said in front of another load notice: the short form,
 * so the whole text stays within the banner's NOTICE_MAX graphemes and the
 * second problem (a fresh start, a loaded backup) is never cut off (r2-07).
 */
export function goneJoined(text) {
  for (const lead of ["Shared save not found; using this window's own.", "Shared save not found."]) {
    const joined = `${lead} ${text}`;
    if (graphemes(joined).length <= NOTICE_MAX) return joined;
  }
  return text; // (no load notice is this long; the problem it names comes first)
}

/** The fresh-start notice text: what was missing or damaged, and what was really kept. */
export function freshText(hadMain, kept, hadBak, keptBak) {
  const what = hadMain && hadBak ? "Save and backup were damaged." : hadMain ? "Save was damaged and there was no backup." : "Save was missing and the backup was damaged.";
  const files = [hadMain ? kept : undefined, hadBak ? keptBak : undefined].filter((x) => x !== undefined);
  const lost = files.filter((x) => !x).length;
  let tail;
  if (!lost) tail = files.length > 1 ? "both files kept." : "the damaged file was kept.";
  else if (lost === files.length) tail = files.length > 1 ? "neither damaged file could be kept." : "the damaged file could not be kept.";
  else tail = "one damaged file could not be kept.";
  return `${what} Started fresh; ${tail}`;
}

function unreadableNotice(paths, message, t) {
  const why = clip(String(message), 48); // whole graphemes only
  return {
    kind: "error",
    message,
    text: `Can't read ${baseName(paths.save)}: ${why}. Move or delete it (path in Details); until then progress is kept in ${baseName(recoveryPath(paths))}.`,
    at: t,
  };
}

/**
 * Releases a save claim that will never settle: one with no progress for
 * WRITE_STALL_MS, or one whose copy has been gone ORPHAN_MS. Run by due() on
 * every tick; a closing ticker can run it before deciding whether its final
 * write may start (session.close skips that write while a claim is held).
 * True when no claim is held afterwards.
 */
export function releaseAbandoned(slot, t) {
  const S = slot.save;
  if (S.writing !== null && typeof S.writingAt === "number") {
    if (S.writingAt > t) S.writingAt = t; // the clock moved back
    else if (t - S.writingAt > WRITE_STALL_MS) dropClaim(slot, t, true, STALLED, STALLED_FLASH); // never settled: released, and said
  }
  if (orphaned(slot, t)) dropClaim(slot, t, true, ORPHANED);
  return S.writing === null;
}

/** True when the ticker should start a save now (A4 cadence and back-off). Rebases timers after a clock jump. */
export function due(slot, t) {
  const S = slot.save;
  releaseAbandoned(slot, t);
  if (!slot.state || slot.readOnly || slot.loading || S.writing !== null || slot.inflight) return false;
  rebaseClock(slot, t);
  if (t < S.retryAt) return false;
  return t >= dueAt(slot);
}

function itemName(id) {
  const w = CONTENT.WORKSHOPS.find((x) => x.id === id);
  if (w) return w.name;
  const m = /^(.+)-t([123])$/.exec(id);
  if (m) {
    const ws = CONTENT.WORKSHOPS.find((x) => x.id === m[1]);
    const tier = CONTENT.TIERS[Number(m[2]) - 1];
    if (ws && tier) return `${ws.name}: ${tier.name}`;
  }
  const u = CONTENT.UPGRADES.find((x) => x.id === id) || CONTENT.AUTOMATIONS.find((x) => x.id === id);
  return u && u.name ? u.name : id;
}

/**
 * Merge (A5): live = replay(parse(disk), pending), advance(now). Returns
 * { ok, refunds, stop }. A damaged disk file is kept aside and overwritten;
 * a newer one makes the game read-only.
 */
async function mergeFromDisk(slot, env, stale) {
  const P = slot.paths;
  const r = await readOrError(P.save);
  if (stale()) return { stop: true };
  if (r.error !== null) return { ok: false, error: r.error };
  const t = env.now();
  if (r.text === null) {
    slot.baseText = null; // deleted under us: create it again, and say so (r3-09)
    slot.save.baseOk = false;
    setNotice(slot, "load", { kind: "recovered", text: MISSING_TEXT, at: t });
    return { ok: true, refunds: [], foreign: false };
  }
  // A year-old save takes a large share of the 500 ms task budget to take in
  // (the read), to parse, and as much again to serialise: each in a task step
  // of its own.
  await pause(env);
  if (stale()) return { stop: true };
  const parsed = await parseIn(slot, r.text, env, stale);
  if (parsed === null || stale()) return { stop: true };
  if (parsed.ok) {
    await pause(env);
    if (stale()) return { stop: true };
    progress(slot, env);
    const live = parsed.state;
    // Did another writer add anything? (A reload's own late write is not "another
    // window", nor is the final write of this window's previous VM: ownWriters.)
    let foreign = false;
    const own = Array.isArray(slot.ownWriters) ? slot.ownWriters : [];
    for (const k of Object.keys(live.applied)) {
      if (k === slot.writerId || own.indexOf(k) >= 0) continue;
      if (live.applied[k] > (Object.hasOwn(slot.state.applied, k) ? slot.state.applied[k] : 0)) foreign = true;
    }
    // Actions this window already saved are missing: another window replaced
    // the file (Reset, Restore, or a save it could not merge, which keeps the
    // replaced file aside). Said, with the kept copy's name when it is found.
    const had = Object.hasOwn(live.applied, slot.writerId) ? live.applied[slot.writerId] : 0;
    if (had < (slot.save.ownApplied || 0)) {
      const kept = await findKept(P, slot.baseText);
      if (stale()) return { stop: true };
      if (kept && !slot.save.damaged.some((d) => d === kept || String(d).startsWith(`${kept} (`))) slot.save.damaged.push(kept);
      slot.save.ownApplied = had;
      setNotice(slot, "load", {
        kind: "recovered",
        text: kept
          ? `Another window replaced the save, so this window's earlier progress left the game. It is kept in ${kept}.`
          : "Another window replaced the save, so this window's earlier progress left the game. That window kept the old file aside.",
        at: t,
      });
    }
    const ev = await replayPending(live, slot, env, stale);
    if (ev === null) return { stop: true };
    if (ev === "lost") return { ok: true, refunds: [], foreign: false }; // the log was given up: overwrite next
    advance(live, env.now(), slot.writerId);
    slot.state = live;
    slot.baseText = r.text;
    slot.save.baseOk = true;
    slot.save.ownApplied = had;
    touch(slot);
    const refunds = [];
    for (const e of ev) if (e && e.kind === "ignored" && e.reason === "afford" && e.item) refunds.push(itemName(String(e.item)));
    return { ok: true, refunds, foreign };
  }
  if (parsed.reason === "newer") {
    slot.readOnly = true;
    slot.save.status = "readonly";
    setNotice(slot, "load", { kind: "newer", at: t });
    return { stop: true };
  }
  const kept = await keepAsideListed(slot, P, r.text);
  if (stale()) return { stop: true };
  slot.baseText = r.text;
  slot.save.baseOk = false;
  setNotice(slot, "load", {
    kind: "recovered",
    text: `The save file was damaged by another writer. ${kept ? "It was kept aside; " : ""}your progress is being saved over it.`,
    at: t,
  });
  return { ok: true, refunds: [], foreign: false }; // nobody's progress merged in (r3-09)
}

/**
 * The file on disk is replaced instead of merged: after Reset / Restore
 * (`overwrite`; the old file was already kept aside) or when the action log
 * was given up (`logLost`) or save.json was unreadable: then another writer's
 * file is kept aside first, with a notice. Returns { ok } | { stop } | { error }.
 */
async function overwriteBase(slot, env, stale) {
  const S = slot.save;
  const P = slot.paths;
  const r = await readOrError(P.save);
  if (stale()) return { stop: true };
  if (r.error !== null) return { ok: false, error: r.error };
  const t = env.now();
  if (r.text !== null) {
    const parsed = await parseIn(slot, r.text, env, stale);
    if (parsed === null || stale()) return { stop: true };
    if (!parsed.ok && parsed.reason === "newer") {
      slot.readOnly = true;
      S.status = "readonly";
      setNotice(slot, "load", { kind: "newer", at: t });
      return { stop: true };
    }
    if (!S.overwrite) {
      const kept = await keepAsideListed(slot, P, r.text);
      if (stale()) return { stop: true };
      setNotice(slot, "load", {
        kind: "recovered",
        text: kept
          ? `Another copy of the save changed while this window couldn't merge with it. It was kept aside as ${kept}; this window's game was saved.`
          : "Another copy of the save changed while this window couldn't merge with it, and it could not be kept aside. This window's game was saved.",
        at: t,
      });
    }
  }
  slot.baseText = r.text;
  S.baseOk = false;
  return { ok: true };
}

/**
 * save.json can't be read: re-check it, and while it stays unreadable write
 * the game to save.recovery.json instead. Returns "main" when save.json can be
 * written again (the caller goes on with the normal write), or the cycle's
 * result (true / false) when the recovery write settled it, or null if stale.
 */
async function recoveryWrite(slot, env, stale) {
  const S = slot.save;
  const P = slot.paths;
  const r = await readOrError(P.save);
  if (stale()) return null;
  if (r.error === null) {
    // Moved or fixed: back to save.json. A file there now is kept aside, not merged.
    S.unreadable = null;
    S.errors = 0;
    S.retryAt = 0;
    if (slot.notices.write && slot.notices.write.kind === "error") setNotice(slot, "write", null);
    // Expecting "absent" makes a file found there a CAS rejection, which keeps it aside (overwriteBase).
    slot.baseText = null;
    S.baseOk = false;
    if (r.text !== null) S.logLost = true;
    return "main";
  }
  S.unreadable = r.error;
  const rec = recoveryPath(P);
  for (let attempt = 0; attempt <= MERGE_RETRIES; attempt++) {
    const rev = slot.state.rev;
    const upto = slot.seq;
    const text = serialize(slot.state);
    try {
      await writeTextFile(rec, text, S.recoveryText);
    } catch (e) {
      if (stale()) return null;
      if (isCas(e)) {
        const again = await readOrError(rec);
        if (stale()) return null;
        S.recoveryText = again.error === null ? again.text : S.recoveryText;
        continue;
      }
      fail(slot, `${hostMessage(e)} (writing ${baseName(rec)})`, env.now());
      return false;
    }
    if (stale()) return null;
    const done = env.now();
    S.recoveryText = text;
    S.confirmed = upto;
    confirmLog(slot, upto);
    S.logLost = false;
    S.writtenRev = rev;
    S.status = "error"; // save.json itself is still not written
    S.retryAt = 0;
    S.dirtyAt = slot.state.rev !== rev || slot.pending.length > 0 ? done : null;
    if (S.urgentAt !== null && S.dirtyAt === null) S.urgentAt = null;
    setNotice(slot, "write", unreadableNotice(P, r.error, slot.notices.write && slot.notices.write.kind === "error" ? slot.notices.write.at : done));
    return true;
  }
  S.retryAt = env.now() + 1000;
  return false;
}

/** Rotates save.bak.json (≤ every 5 min). A failure other than another writer's rotation is shown and retried. */
async function rotateBackup(slot, env, stale, t) {
  const S = slot.save;
  const P = slot.paths;
  try {
    await writeTextFile(P.bak, slot.baseText, slot.bakText);
    if (stale()) return false;
    slot.bakText = slot.baseText;
    slot.bakAt = t;
    slot.bakState = "ok";
    S.bakError = null;
    S.bakErrors = 0;
    S.bakRetryAt = 0;
    if (slot.notices.bak) setNotice(slot, "bak", null);
    return true;
  } catch (e) {
    if (stale()) return false;
    if (isCas(e)) {
      const r = await readOrError(P.bak); // another writer rotated it: catch up, try next time
      if (stale()) return false;
      if (r.error === null) {
        slot.bakText = r.text;
        slot.bakState = null;
      }
      slot.bakAt = t;
      return true;
    }
    const msg = hostMessage(e);
    S.bakErrors = (S.bakErrors || 0) + 1;
    const delay = backoff(S.bakErrors);
    S.bakRetryAt = t + delay;
    S.bakError = msg;
    const was = slot.notices.bak;
    setNotice(slot, "bak", {
      kind: "error",
      message: msg,
      text: `Can't update the backup (${baseName(P.bak)}): ${clip(msg, 48)}. The save itself is fine; retrying in ${spoken(delay)}.`,
      retryMs: delay,
      at: was ? was.at : t,
    });
    return true;
  }
}

function fail(slot, message, t) {
  const S = slot.save;
  S.errors += 1;
  const delay = backoff(S.errors);
  S.retryAt = t + delay;
  S.status = "error";
  setNotice(slot, "write", { kind: "error", message, retryMs: delay, at: slot.notices.write && slot.notices.write.kind === "error" ? slot.notices.write.at : t });
}

/**
 * One save cycle (A4 write protocol): rotate the backup (≤ every 5 min), then
 * writeTextFile(save, text, baseText); on a CAS rejection re-read, merge and
 * retry (≤ 3 times); on any other rejection set the error notice and back off.
 * `env` = { now() }. Resolves when the cycle is over (or superseded).
 */
export async function cycle(slot, env) {
  const S = slot.save;
  if (!slot.state || slot.readOnly || S.writing !== null) return false;
  const sleeps = typeof (env && env.sleep) === "function";
  if (sleeps) {
    // The serialisation runs in a task step of its own, never with the tick
    // (or close) that started the save: on a save a year old each is a large
    // share of herdr's 500 ms budget per step. The yield comes before the
    // claim, so none is held across it: session.close skips its final write
    // while a claim is held, and a view closing in that gap would otherwise
    // cancel this task before any write started.
    await pause(env);
    if (!slot.state || slot.readOnly || S.writing !== null) return false;
  }
  const gen = claim(S, env, "cycle");
  S.status = "saving";
  touch(slot);
  const stale = () => S.writing !== gen;
  const P = slot.paths;
  let merged = false;
  const refunds = [];
  try {
    // True while this step has done nothing since the yield above.
    let freshStep = sleeps;
    if (S.sharing) {
      // A "Share a save" cut off after its pointer write (r2-08): follow the pointer first.
      freshStep = false;
      if (!(await settleShare(slot, env, stale))) return false;
    }
    if (S.unreadable) {
      freshStep = false;
      const r = await recoveryWrite(slot, env, stale);
      if (r !== "main") return r === true;
    }
    for (let attempt = 0; attempt <= MERGE_RETRIES; attempt++) {
      if (attempt > 0 || (sleeps && !freshStep)) {
        // The serialisation runs in a task step of its own, never after a
        // merge (parse, replay, advance) or an overwrite read: on a save a
        // year old each of those is a large share of herdr's 500 ms budget
        // per step, and its interrupt cannot be caught (the claim would stall
        // for WRITE_STALL_MS).
        await pause(env);
        if (stale()) return false;
        progress(slot, env);
      }
      const t = env.now();
      // 2. rotate the backup so it trails the main save
      if (S.baseOk && slot.baseText !== null && slot.baseText !== slot.bakText && (slot.bakAt === null || t - slot.bakAt >= BACKUP_EVERY_MS) && t >= (S.bakRetryAt || 0)) {
        if (!(await rotateBackup(slot, env, stale, t))) return false; // superseded
      }
      // 1. + 3. serialise and write
      const rev = slot.state.rev;
      const text = serialize(slot.state);
      const upto = slot.seq;
      const own = ownApplied(slot.state, slot.writerId);
      slot.inflight = { text, upto, own };
      try {
        await writeTextFile(P.save, text, slot.baseText);
      } catch (e) {
        if (stale()) return false;
        slot.inflight = null;
        if (!isCas(e)) {
          fail(slot, hostMessage(e), env.now());
          return false;
        }
        if (S.overwrite || S.logLost) {
          // Reset / Restore, or a log too long to replay: replace the file, never merge into it.
          const o = await overwriteBase(slot, env, stale);
          if (o.stop) return false;
          if (!o.ok) {
            fail(slot, o.error, env.now());
            return false;
          }
          continue;
        }
        // 5. CAS: someone else wrote. Re-read, merge, retry.
        const shown = slot.notices.write;
        if (!shown || shown.kind !== "conflict") setNotice(slot, "write", { kind: "conflict", at: env.now() });
        const m = await mergeFromDisk(slot, env, stale);
        if (m.stop) return false;
        if (!m.ok) {
          fail(slot, m.error, env.now());
          return false;
        }
        if (m.foreign === true) merged = true; // (a missing or damaged file is no other window's progress)
        for (const x of m.refunds) refunds.push(x);
        continue;
      }
      if (stale()) return false;
      // 4. success
      const done = env.now();
      slot.inflight = null;
      slot.baseText = text;
      S.baseOk = true;
      S.confirmed = upto;
      S.ownApplied = own;
      confirmLog(slot, upto);
      S.status = "ok";
      S.savedAt = done;
      S.errors = 0;
      S.retryAt = 0;
      S.writtenRev = rev;
      S.overwrite = null;
      S.logLost = false;
      S.dirtyAt = slot.state.rev !== rev || slot.pending.length > 0 ? done : null;
      // An urgent request this write served is consumed; one made during the write stays.
      if (S.urgentAt !== null && (S.urgentAt <= t || S.dirtyAt === null)) S.urgentAt = null;
      if (merged) {
        const text2 = refunds.length ? `Merged with another window's progress. Refunded: ${refunds.slice(0, 3).join(", ")}${refunds.length > 3 ? "…" : ""}.` : undefined;
        const note = { kind: "merged", at: done, until: done + MERGED_MS };
        if (text2) note.text = text2;
        setNotice(slot, "write", note);
      } else if (slot.notices.write && slot.notices.write.kind !== "merged") {
        setNotice(slot, "write", null);
      }
      touch(slot);
      return true;
    }
    // Retries used up: shown, and tried again on the next cycle.
    S.status = "conflict";
    S.retryAt = env.now() + 1000;
    setNotice(slot, "write", { kind: "conflict", at: env.now() });
    return false;
  } finally {
    if (release(S, gen)) {
      if (S.status === "saving") S.status = "ok";
      touch(slot);
    }
  }
}

/**
 * Finishes a "Share a save" whose task was cut off after it started writing
 * location.json (a hot reload, a stalled claim): the pointer on disk is read
 * again and this window saves to the file it names from now on. Its
 * unconfirmed actions are merged onto that file by the next write (expecting
 * "absent" makes a file there a CAS conflict), or the file is created. Said
 * with the flash the share would have shown. False when superseded.
 */
async function settleShare(slot, env, stale) {
  const S = slot.save;
  const loc = await readOrError(pathsFor(slot.home).location);
  if (stale()) return false;
  let want;
  if (loc.error !== null) want = undefined;
  else if (loc.text === null) want = null;
  else {
    try {
      const doc = JSON.parse(loc.text);
      want = doc && typeof doc.path === "string" && isAbsolutePath(doc.path) && doc.path.endsWith(".json") ? doc.path : doc && doc.path === null ? null : undefined;
    } catch {
      want = undefined;
    }
  }
  if (want === undefined) {
    S.sharing = null;
    return true; // can't tell: the file in use stays (the next load says what it finds)
  }
  const was = slot.paths.shared || null;
  const next = slotPaths(slot.home, want);
  const bak = await readOrError(next.bak);
  if (stale()) return false; // nothing switched yet: the next cycle settles it again
  // From here to the end nothing awaits: the paths, base, backup and
  // ownApplied switch together, and `sharing` is cleared only once they have
  // (r2-08: a claim lost in between left new paths with the old file's base).
  slot.paths = next;
  slot.bakText = bak.error === null ? bak.text : null;
  slot.bakAt = null;
  slot.bakState = null;
  S.unreadable = null;
  S.recoveryText = null;
  S.ownApplied = 0; // none of this window's saves may be in that file yet
  slot.baseText = null;
  S.baseOk = false;
  S.sharing = null;
  const t = env.now();
  markDirty(slot, t, true);
  S.urgentAt = t;
  if (want !== was) flash(slot, want ? `Now sharing ${baseName(want)} with another herdr home.` : "Back to this window's own save.", t);
  touch(slot);
  return true;
}

/** Expires the `merged` notice (6 s). */
export function expireNotices(slot, t) {
  const w = slot.notices.write;
  const until = w ? w.until ?? w.at + MERGED_MS : 0;
  // (a clock that moved back must not keep it for the length of the jump)
  if (w && w.kind === "merged" && (t >= until || until - t > MERGED_MS)) setNotice(slot, "write", null);
}

/**
 * After a hot reload the old generation's write never settles (A6): if the
 * disk holds its text, the write landed (adopt it as base, drop actions ≤
 * upto); otherwise the next write is an ordinary CAS merge. `applied` makes
 * both safe.
 */
export async function resolveInflight(slot, env = null) {
  const inf = slot.inflight;
  const S = slot.save;
  if (!inf || S.writing !== null) return; // a live claim settles its own write
  const gen = claim(S, env, "resolve");
  try {
    const r = await readOrError(slot.paths.save);
    if (S.writing !== gen) return;
    if (r.error === null && r.text === inf.text) {
      slot.baseText = inf.text;
      S.baseOk = true;
      S.confirmed = inf.upto;
      if (typeof inf.own === "number") S.ownApplied = inf.own;
      confirmLog(slot, inf.upto);
    }
    slot.inflight = null;
  } finally {
    release(S, gen);
    touch(slot);
  }
}

/** Retry now (banner): clears the back-off (the backup's too) and makes the save due. */
export function retryNow(slot, t) {
  const S = slot.save;
  S.retryAt = 0;
  S.bakRetryAt = 0;
  markDirty(slot, t, true);
  S.urgentAt = t;
  touch(slot);
}

/** Dismisses a glue-owned save notice. */
export function dismiss(slot, kind) {
  for (const which of ["load", "write", "bak"]) {
    const n = slot.notices[which];
    if (n && n.kind === kind) slot.notices[which] = null;
  }
  refreshNotice(slot);
}

/** "Check save now" (§12.2): re-read and validate; a damaged file is kept aside and saved over. */
export async function checkSave(slot, env) {
  const S = slot.save;
  if (!slot.state) return "busy";
  if (S.writing !== null) return busy(slot, env);
  const gen = claim(S, env, "check");
  const stale = () => S.writing !== gen;
  try {
    const r = await readOrError(slot.paths.save);
    if (stale()) return "stale";
    const t = env.now();
    if (r.error !== null) {
      if (!S.unreadable) {
        S.unreadable = r.error;
        setNotice(slot, "write", unreadableNotice(slot.paths, r.error, t));
        S.status = "error";
      }
      retryNow(slot, t);
      return "error";
    }
    if (r.text === null) {
      slot.baseText = null;
      S.baseOk = false;
      retryNow(slot, t);
      return "missing";
    }
    const parsed = await parseIn(slot, r.text, env, stale);
    if (parsed === null || stale()) return "stale";
    if (parsed.ok || parsed.reason === "newer") {
      if (r.text !== slot.baseText) retryNow(slot, t); // another writer's change: merge it now
      return parsed.ok ? "ok" : "newer";
    }
    const kept = await keepAsideListed(slot, slot.paths, r.text);
    if (stale()) return "stale";
    slot.baseText = r.text;
    S.baseOk = false;
    setNotice(slot, "load", { kind: "recovered", text: `The save file was damaged. ${kept ? "Kept it aside; s" : "S"}aving your progress again.`, at: t });
    retryNow(slot, t);
    return "damaged";
  } finally {
    release(S, gen);
    touch(slot);
  }
}

/**
 * Keeps the file on disk aside (reason "restore" / "reset") and replaces the
 * live game with `next` (the backup, or a new game); the next save writes it.
 */
async function replaceGame(slot, env, make, reason) {
  const S = slot.save;
  if (!slot.state) return "busy";
  if (S.writing !== null) return busy(slot, env);
  const gen = claim(S, env, reason);
  const stale = () => S.writing !== gen;
  try {
    const next = await make(stale);
    if (stale()) return "stale";
    if (!next) return "nothing";
    const r = await readOrError(slot.paths.save);
    if (stale()) return "stale";
    let kept = null;
    if (r.text !== null) {
      kept = await keepAsideListed(slot, slot.paths, r.text, reason);
      if (stale()) return "stale";
    }
    slot.baseText = r.error === null ? r.text : slot.baseText;
    S.baseOk = false;
    slot.state = next;
    clearLog(slot);
    S.ownApplied = 0;
    slot.inflight = null;
    slot.readOnly = false;
    if (S.status === "readonly") S.status = "ok";
    // The next write replaces the file: another window's save landing first is not merged back in.
    S.overwrite = reason;
    S.logLost = false;
    slot.notices.load = null;
    refreshNotice(slot);
    retryNow(slot, env.now());
    const what = reason === "reset" ? "Started a new game." : "Restored the backup.";
    const old = r.text === null ? "" : kept ? ` The old save was kept as ${kept}.` : " The old save could not be kept aside.";
    if (typeof env.flash === "function") env.flash(`${what}${old}`);
    return "ok";
  } finally {
    release(S, gen);
    touch(slot);
  }
}

/** "Restore backup…" (two-step in Settings): the current save is kept as a damaged copy. */
export function restoreBackup(slot, env) {
  return replaceGame(slot, env, async (stale) => {
    const r = await readOrError(slot.paths.bak);
    if (stale()) return null;
    const parsed = r.text !== null ? await parseIn(slot, r.text, env, stale) : null;
    if (stale()) return null;
    if (!parsed || !parsed.ok) {
      env.flash("The backup can't be read; nothing changed.");
      return null;
    }
    return migrate(parsed.state);
  }, "restore");
}

/** "Reset game…": the old save is kept as a damaged copy with reason "reset"; a new game starts. */
export function resetGame(slot, env) {
  return replaceGame(slot, env, async () => {
    const t = env.now();
    return newGame({ seed: env.seed(), now: t, day: localDay(t) });
  }, "reset");
}

/**
 * "Share a save with another herdr home…" (§12.5): `path` is the other
 * window's absolute …/save.json. Validated (absolute, ends in .json, readable
 * or absent, a Creaseworks save); then only the pointer location.json is
 * written here and this window joins that save (its pending actions replayed
 * onto it). An empty path stops sharing.
 */
export async function sharePath(slot, env, path) {
  const S = slot.save;
  if (!slot.state) return "busy";
  if (S.writing !== null) return busy(slot, env);
  const target = typeof path === "string" ? path.trim() : "";
  const local = pathsFor(slot.home).save;
  if (target === slot.paths.save) {
    env.flash(`This window already saves to ${baseName(target)}.`);
    return "same";
  }
  if (target !== "" && target !== local && !(isAbsolutePath(target) && target.endsWith(".json"))) {
    env.flash("A shared save path must be absolute and end in .json.");
    return "invalid";
  }
  const gen = claim(S, env, "share");
  const stale = () => S.writing !== gen;
  try {
    const joining = target !== "" && target !== local;
    const dest = joining ? target : local;
    const r = await readOrError(dest);
    if (stale()) return "stale";
    if (r.error !== null) {
      env.flash(`Can't read that file: ${r.error}`);
      return "unreadable";
    }
    const parsed = r.text !== null ? await parseIn(slot, r.text, env, stale) : null;
    if (stale()) return "stale";
    if (parsed && !parsed.ok) {
      env.flash(parsed.reason === "newer" ? "That save is from a newer Creaseworks." : "That file is not a Creaseworks save.");
      return "notsave";
    }
    const locPath = pathsFor(slot.home).location;
    const cur = await readOrError(locPath);
    if (stale()) return "stale";
    // From here the pointer may change while this task is cut off (a hot
    // reload cancels it, the write lands anyway): the next save cycle then
    // re-reads location.json and follows it (settleShare), so the window
    // never keeps saving to a file the pointer no longer names.
    S.sharing = { to: joining ? dest : null };
    try {
      await writeTextFile(locPath, JSON.stringify({ path: joining ? dest : null }), cur.text);
    } catch (e) {
      if (stale()) return "stale";
      S.sharing = null; // nothing changed
      env.flash(`Can't write location.json: ${hostMessage(e)}`);
      return "error";
    }
    if (stale()) return "stale";
    slot.paths = slotPaths(slot.home, joining ? dest : null);
    const bak = await readOrError(slot.paths.bak);
    if (stale()) return "stale";
    slot.bakText = bak.error === null ? bak.text : null;
    slot.bakAt = null;
    slot.bakState = null;
    S.unreadable = null;
    S.recoveryText = null;
    S.ownApplied = 0; // another file: none of this window's saves are in it yet
    if (parsed && parsed.ok) {
      const live = parsed.state;
      const ev = await replayPending(live, slot, env, stale);
      if (ev === null) return "stale";
      if (ev === "lost") {
        // This window's log could not be replayed onto that file (never seen in
        // practice): its own game stays, and the first write keeps that file
        // aside with a notice instead of merging (expecting "absent" makes the
        // file there a CAS rejection; overwriteBase).
        S.logLost = true;
        slot.baseText = null;
        S.baseOk = false;
      } else {
        advance(live, env.now(), slot.writerId);
        slot.state = live;
        slot.baseText = r.text;
        S.baseOk = true;
      }
    } else {
      slot.baseText = null; // absent: this window's game creates it
      S.baseOk = false;
    }
    S.sharing = null;
    retryNow(slot, env.now());
    env.flash(joining ? `Now sharing ${baseName(dest)} with another herdr home.` : "Back to this window's own save.");
    return "ok";
  } finally {
    release(S, gen);
    touch(slot);
  }
}

/** The footer / banner Details / Settings save line (B11 `ctx.save`). */
export function saveInfo(slot, t) {
  const S = slot.save;
  const n = slot.notice;
  const problem = !!n && (n.kind === "error" || n.kind === "fresh" || n.kind === "newer" || n.kind === "conflict");
  let text;
  if (slot.readOnly) text = "Read-only: not saving";
  else if (S.status === "saving") text = "Saving…";
  else if (S.unreadable) text = `Save unreadable: using ${baseName(recoveryPath(slot.paths))}`;
  else if (S.status === "error") text = "Save problem: retrying";
  else if (n && n.kind === "conflict") text = "Merging another window's save…";
  else if (S.savedAt !== null) {
    const s = Math.max(0, Math.round((t - S.savedAt) / 1000));
    text = s < 5 ? "Saved just now" : s < 60 ? `Saved ${s - (s % 5)} s ago` : `Saved ${Math.floor(s / 60)} min ago`;
    // The footer's warn glyph must not sit next to a bare "Saved": say why.
    const lead = n && n.kind === "fresh" ? "Started fresh" : n && n.kind === "error" && n === slot.notices.bak ? "Backup problem" : null;
    if (lead) text = `${lead} · ${text[0].toLowerCase()}${text.slice(1)}`;
  } else text = "Not saved yet";
  let backup = false;
  if (S.bakError) backup = `not updated (${S.bakError})`;
  else if (slot.bakText !== null) backup = slot.bakState === "damaged" ? "damaged" : slot.bakAt !== null ? `rotated ${localTime(slot.bakAt)}` : "present";
  return {
    state: problem ? "problem" : S.status === "saving" ? "saving" : "saved",
    text,
    path: slot.paths.save,
    lastGood: S.savedAt !== null ? localTime(S.savedAt) : null,
    backup,
    damaged: S.damaged.slice(-DAMAGED_MAX),
    shared: !!slot.paths.shared,
  };
}

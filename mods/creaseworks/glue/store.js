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
import { serialize, serializeSteps, parseSave, parseSaveSteps, newGame, apply, advance, migrate, VERSION, clip, graphemes, CONTENT } from "../engine/index.js";
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

/**
 * herdr's compare-and-swap rejections: its own two texts, and the OS text of
 * a create_new write (expected null) that found the file there. That is
 * "File exists (os error 17)" on Unix and "The file exists. (os error 80)" on
 * Windows (r6-18), so the match ignores case and also takes the error code
 * alone (a translated Windows text still ends in it).
 */
const CAS_RE = /the file changed outside herdr|the file changed while saving|file exists|\(os error (?:17|80)\)/i;

/** herdr's text-file limit in UTF-8 bytes (src/mod_files.rs MAX_TEXT_BYTES): a write over it is refused. */
export const FILE_LIMIT = 1024 * 1024;

/**
 * The exact UTF-8 size of `text` in bytes when it is over FILE_LIMIT, else 0
 * (r6-16). The engine holds the save under K.saveBudget by archiving Album
 * records (helpers.js albumKeepFor) and, from save format 5, by packing the
 * present helpers in smaller tiers as the roster grows (helpers.js
 * presentPlan: past the budget even the last stubs are left out), so no
 * roster makes a save too big. This is the last resort for what the engine
 * writes whole and does not bound (records it cannot pack: a hand-edited or
 * legacy save's odd records, DESIGN R13): the write is not sent, and fail()
 * says why in words, retrying as the state changes. It only stops a write
 * herdr would refuse anyway (mod_files.rs write: "Text file exceeds 1 MiB");
 * it does not make the save smaller. Most saves are decided by their length
 * alone (one to three bytes a UTF-16 unit); the rest count their non-ASCII
 * units with two regex replaces (no script loop over the text: about 900 KiB
 * of save in one task step), also when the length alone is over the limit, so
 * the KiB said is the real size of a non-ASCII save.
 */
export function oversize(text) {
  const n = text.length;
  if (n * 3 <= FILE_LIMIT) return 0;
  // +1 for each non-ASCII unit, +1 more for each from U+0800 outside the surrogates (3 bytes; a pair is 4 bytes for 2 units)
  const wide = text.replace(/[\x00-\x7f]+/g, "");
  const bytes = n + wide.length + wide.replace(/[\u0080-\u07ff\ud800-\udfff]+/g, "").length;
  return bytes > FILE_LIMIT ? bytes : 0;
}

/**
 * The fail() message of a save too big for herdr (≤ 60 graphemes: view.js
 * CLIP.error, so it is shown whole). `recovery`: the write was to
 * save.recovery.json (save.json can't be read), which the text names itself.
 */
export function oversizeText(bytes, recovery = false) {
  const kib = Math.ceil(bytes / 1024);
  return recovery ? `recovery file is ${kib} KiB, over 1 MiB: too many helpers` : `save is ${kib} KiB, over herdr's 1 MiB cap: too many helpers`;
}

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

/** pause(env), or false at once when its cx can no longer sleep (a close callback's cx after the callback returned). */
async function yieldStep(env) {
  try {
    await pause(env);
    return true;
  } catch {
    return false;
  }
}

/** Records progress on the save claim (WRITE_STALL_MS counts from the last one). */
function progress(slot, env) {
  if (!env || typeof env.now !== "function") return;
  if (slot.save.writing !== null) slot.save.writingAt = env.now();
  // The load's own progress (session.js watches for a load that stopped: r3-01).
  if (slot.loading && env.gen === slot.loading) slot.loadAt = env.now();
}

/**
 * States with fewer helpers than this (present and in the Album) are
 * serialised in one go; larger ones in steps. One serialisation of 999
 * helpers with long CJK titles (3 sub-agents per agent, nothing cached) takes
 * about 90-130 ms in the wasm harness, as long as one stepped slice; 1,499 took
 * 135-205 ms and 2,999 (the old threshold) 300-340 ms, most of the 500 ms task
 * budget in one step with the size check after it (r8-06; timed in
 * test/qjs/save-backlog.test.mjs).
 */
export const STEP_SAVE_HELPERS = 1000;

/**
 * serialize(slot.state) across task steps (engine serializeSteps, R13): one
 * serialisation of a large roster passes herdr's 500 ms budget (12,500
 * present helpers ≈ 750 ms in the wasm harness), so every save path spreads
 * it with a task yield between steps (≈ 50–150 ms each). The text is the state
 * as it was at the first step, so the log position, writer progress and rev
 * the write confirms are read then too: actions applied during the yields are
 * not in the text and stay pending. Returns { text, upto, epoch, own, rev },
 * or null when `stale()` turns true or the game was replaced during a yield.
 * A cx that can no longer sleep (a close callback's, after it returned)
 * finishes the rest in its step.
 */
async function serializeIn(slot, env, stale) {
  const state = slot.state;
  const at = { text: null, upto: slot.seq, epoch: slot.logEpoch || 0, own: ownApplied(state, slot.writerId), rev: state.rev };
  let n = 0;
  if (env && typeof env.sleep === "function") for (const id in state.helpers) if (++n >= STEP_SAVE_HELPERS) break;
  if (n < STEP_SAVE_HELPERS) {
    at.text = serialize(state);
    return at;
  }
  const it = serializeSteps(state);
  let r = it.next();
  let sleeps = true;
  while (!r.done) {
    if (sleeps) {
      sleeps = await yieldStep(env);
      if (stale() || slot.state !== state) return null;
      progress(slot, env);
    }
    r = it.next();
  }
  at.text = r.value;
  return at;
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
  // An older code generation's live state (state version 1 before the
  // Pattern book, ARCHITECTURE B17) is brought to this build's shape in place:
  // no disk read, so nothing rolls back. A newer one is left as it is.
  if (slot.state && typeof slot.state.version === "number" && slot.state.version < VERSION) migrate(slot.state);
  // An older build that found the save newer than it understood (a second
  // window already on the Pattern book's state version 2) went read-only with
  // the banner. This build may understand the file: the window leaves
  // read-only and takes the file in at its next save, as a CAS merge (no
  // base, so the write is rejected and mergeFromDisk replays what is still
  // pending onto the file). Play while read-only was never recorded (it was
  // not saving), so the other window's progress is kept and nothing is
  // counted twice. A file still newer than this build makes it read-only again.
  const load = slot.notices && slot.notices.load;
  if (slot.readOnly && slot.state && load && load.kind === "newer") {
    slot.readOnly = false;
    S.status = "ok";
    slot.baseText = null;
    S.baseOk = false;
    setNotice(slot, "load", null);
    markDirty(slot, t, true);
    S.urgentAt = t;
    touch(slot);
  }
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
  if (typeof S.bakProbeAt === "number" && S.bakProbeAt > t) S.bakProbeAt = t; // (r7-07)
  if (S.savedAt !== null && S.savedAt > t) S.savedAt = t;
}

/** The host message without herdr's "`herdr.fn`: " prefix. */
export function hostMessage(e) {
  const m = e && typeof e.message === "string" ? e.message : String(e);
  return m.replace(/^`herdr\.[A-Za-z]+`: /, "");
}

/** A compare-and-swap rejection (another writer changed the file). */
export function isCas(e) {
  return CAS_RE.test(hostMessage(e));
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

/** Tries keepAsideShifting makes when another writer created or changed a kept file under it (r8-08). */
export const KEEP_TRIES = 4;

/**
 * keepAside, also saying where the kept files went: `moves[n]` is the n a
 * listed save.damaged-<n>.json holds its text at now (0: replaced), for every
 * n that moved; empty when nothing moved. Two windows keeping a file aside at
 * the same moment both pick the same free n: herdr's create_new write
 * (expected null) fails for the second with "File exists", a CAS rejection.
 * The kept files are then read again and the choice made again (the text
 * found already kept, or the next free n), up to KEEP_TRIES times (r8-08: the
 * second window said "could not be kept" with four slots free). A shift cut
 * off by another writer after it moved a file is not tried again.
 */
async function keepAsideShifting(paths, text) {
  for (let i = 1; ; i++) {
    const r = await keepAsideOnce(paths, text);
    if (!r.collided || i >= KEEP_TRIES) return { name: r.name, moves: r.moves, already: r.already };
  }
}

/** One try of keepAsideShifting: `collided` when a write found another writer's file first and nothing moved. */
async function keepAsideOnce(paths, text) {
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
    } catch (e) {
      return { name: null, moves, collided: isCas(e) };
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
    } catch (e) {
      return { name: null, moves, collided: isCas(e) };
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
  let wrote = false;
  let collided = false;
  try {
    for (let i = 1; i <= want.length; i++) {
      if (have[i - 1] !== want[i - 1]) {
        await writeTextFile(damagedPath(paths, i), want[i - 1], have[i - 1]);
        wrote = true;
      }
      done = i;
    }
  } catch (e) {
    // (a move cut short: a file not yet written still holds its own text)
    collided = !wrote && isCas(e);
  }
  for (const n of kept) {
    const to = dest[n];
    // A copy is where it went once that file was written; else still at n unless n was overwritten.
    const at = to > 0 && to <= done ? to : n > done ? n : 0;
    if (at !== n) moves[n] = at;
  }
  return done === want.length ? { name: baseName(damagedPath(paths, want.length)), moves } : { name: null, moves, collided };
}

/**
 * Keeps `text` aside (keepAside) and lists it in Details (`save.damaged`,
 * with `reason` when given). When kept files moved, the names already listed
 * move with them (one replaced leaves the list), so every name listed is the
 * file that holds what it was listed for. Returns the kept file's name, or null.
 */
async function keepAsideListed(slot, paths, text, reason = null) {
  return (await keepAsideListedR(slot, paths, text, reason)).name;
}

/** keepAsideListed, returning keepAsideShifting's { name, moves, already }. */
async function keepAsideListedR(slot, paths, text, reason = null) {
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
  return r;
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
  const fresh = () => {
    S.bakFresh = bak.error !== null; // the game in that backup is not this one (r7-06)
    return newGame({ seed: opts.seed, now: t0, day: localDay(t0) });
  };
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
  // A backup that is there but can't be read (a folder, over 1 MiB, invalid
  // UTF-8, no permission: r6-04) still holds progress: never taken for "no
  // backup". Its host message is shown in Details (saveInfo).
  S.bakUnreadable = bak.error;
  S.bakHeld = null;
  S.bakProbeAt = null;
  S.bakFresh = false; // set below when this game started fresh beside it (r7-06)
  slot.readOnly = false;
  S.unreadable = null;
  S.recoveryText = null;
  S.recOwn = 0; // applied[writerId] in this window's last recovery write (mergeRecovery)
  S.overwrite = null;
  S.overwriteRec = false;
  S.logLost = false;
  let state = null;
  let notice = null;
  let unreadableFresh = null;

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
    // A damaged recovery file or backup is kept aside (r4-05): the recovery
    // write and the backup rotation would otherwise replace it unseen.
    let keptRec = null;
    let keptBak = null;
    if (r && !r.ok) {
      keptRec = await keepAsideListed(slot, P, rec.text);
      if (stale()) return false;
    }
    if (b && !b.ok) {
      keptBak = await keepAsideListed(slot, P, bak.text);
      if (stale()) return false;
    }
    state = rOk && (!bOk || rOk.clock >= bOk.clock) ? rOk : bOk;
    if (!state) {
      // Nothing to load from: a fresh game, said beside the unreadable notice (§12.2).
      state = fresh();
      unreadableFresh = { kind: "fresh", text: unreadableFreshText(r !== null, keptRec, b !== null, keptBak, bak.error), at: t0 };
      if (bak.error !== null) unreadableFresh.message = bak.error;
    }
    S.unreadable = main.error;
    S.recoveryText = rec.error === null ? rec.text : null;
    notice = unreadableNotice(P, main.error, t0);
    slot.baseText = null;
    S.baseOk = false;
  } else if (main.text === null && bak.text === null && bak.error === null) {
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
      // save.json damaged (or missing beside a backup, readable or not)
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
        notice = { kind: "fresh", text: freshText(main.text !== null, kept, bak.text !== null, keptBak, bak.error), at: t0 };
        if (bak.error !== null) notice.message = bak.error;
      }
    }
  }
  if (locBad && !notice) {
    notice = { kind: "recovered", text: "The shared-save pointer (location.json) was damaged. Using this window's own save.", at: t0 };
  }
  let goneNotice = null;
  if (missingShared) {
    const gone = goneText(missingShared);
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
    slot.notices.load = unreadableFresh && goneNotice ? { ...unreadableFresh, text: goneJoined(unreadableFresh.text) } : unreadableFresh || goneNotice;
    S.errors = 1;
    S.retryAt = 0;
    S.status = "error";
  } else {
    slot.notices.load = notice;
    slot.notices.write = null;
  }
  refreshNotice(slot);
  noteBackupState(slot, t0);
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

/** The load notice for a shared save that is not there (load, and during play: r4-04). */
function goneText(path) {
  return `Shared save not found: ${tailClip(path, 40)}. Using this window's own; share again in Settings when it's back.`;
}

/**
 * The fresh-start notice text: what was missing or damaged, and what was
 * really kept. `bakError` (the host message) is a backup that is there but
 * can't be read (r6-04): it is left in place, never called missing, and its
 * message is in Details (kept short so a missing shared save still joins it).
 */
export function freshText(hadMain, kept, hadBak, keptBak, bakError = null) {
  if (bakError !== null && bakError !== undefined) {
    const lead = hadMain ? "Save was damaged" : "Save was missing";
    return `${lead}; backup can't be read (left in place; Details). Started fresh${hadMain ? `; ${keptTail([kept])}` : "."}`;
  }
  const what = hadMain && hadBak ? "Save and backup were damaged." : hadMain ? "Save was damaged and there was no backup." : "Save was missing and the backup was damaged.";
  return `${what} Started fresh; ${keptTail([hadMain ? kept : undefined, hadBak ? keptBak : undefined])}`;
}

/**
 * The fresh-start notice beside an unreadable save.json (r4-05): which of the
 * recovery file and the backup were damaged (or that there was neither), and
 * what was really kept.
 */
export function unreadableFreshText(hadRec, keptRec, hadBak, keptBak, bakError = null) {
  if (bakError !== null && bakError !== undefined) {
    // (r6-04) both files left in place: neither is said to be missing
    // (the recovery-file case is worded tighter so a missing shared save still joins it)
    if (hadRec) return `Save and backup unreadable (left in place), recovery file damaged. Started fresh; ${keptTail([keptRec])}`;
    return "Save and backup can't be read (left in place; Details). Started fresh.";
  }
  const what = hadRec && hadBak ? "the backup and recovery file were damaged" : hadBak ? "the backup was damaged" : hadRec ? "the recovery file was damaged and there was no backup" : "there was no backup";
  const files = [hadRec ? keptRec : undefined, hadBak ? keptBak : undefined];
  const tail = hadRec || hadBak ? `; ${keptTail(files)}` : ".";
  return `Save can't be read and ${what}. Started fresh${tail}`;
}

/** "both files kept." / "the damaged file could not be kept." … for kept-aside results (undefined: no such file). */
function keptTail(list) {
  const files = list.filter((x) => x !== undefined);
  const lost = files.filter((x) => !x).length;
  let tail;
  if (!lost) tail = files.length > 1 ? "both files kept." : "the damaged file was kept.";
  else if (lost === files.length) tail = files.length > 1 ? "neither damaged file could be kept." : "the damaged file could not be kept.";
  else tail = "one damaged file could not be kept.";
  return tail;
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

/**
 * The closing ticker's final write (session.js close): a save cycle whose
 * copy has closed (this one, or one closed before it) and that has not yet
 * sent its save.json write (`inflight` null: still rotating the backup,
 * serialising in steps or merging) never sends it: herdr cancels every task
 * of a closed copy, owner: null ones too. Its claim is released quietly so
 * the final write can start now; true when it was. A Settings tool's claim,
 * a write already sent, or a claim of a copy still open is left alone (r8-04:
 * the final write was skipped and the progress since the last save lost).
 */
export function releaseClosing(slot, t) {
  const S = slot.save;
  if (S.writing === null || slot.inflight || !PLAIN_CLAIMS.includes(S.writingFor)) return false;
  const by = S.writingBy;
  if (typeof by === "string" && slot.copies && by in slot.copies) return false;
  dropClaim(slot, t);
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
 * save.json became unreadable during play (too big, not a file: r4-03): the
 * game goes over to save.recovery.json as a load would. A damaged recovery
 * file found there is kept aside first (r4-05); the unreadable notice is
 * shown. False when superseded.
 */
async function enterUnreadable(slot, env, stale, error) {
  const S = slot.save;
  const P = slot.paths;
  const rec = await readOrError(recoveryPath(P));
  if (stale()) return false;
  S.recOwn = 0; // nothing of this episode written there yet
  // Another window may be there first (both found save.json unreadable): merged, not written over.
  if (rec.text !== null && (await mergeRecovery(slot, env, stale, rec.text)) === null) return false;
  S.unreadable = error;
  S.recoveryText = rec.error === null ? rec.text : null;
  if (!(S.errors >= 1)) S.errors = 1;
  S.status = "error";
  const w = slot.notices.write;
  setNotice(slot, "write", unreadableNotice(P, error, w && w.kind === "error" ? w.at : env.now()));
  return true;
}

/**
 * The shared save is not there during play (r4-04: a drive unmounted, the
 * folder moved): when save.json and its backup are both absent, this window
 * goes over to its own save as a load would (r2-07), with the same notice,
 * and nothing is created at the shared path (a write there would make the
 * folder again, under an unmounted mount point). The next write expects
 * "absent", so this window's own save.json, when there is one, is merged with
 * as a CAS conflict. Returns true when it switched, false when it did not
 * (not shared, or a backup is there), null when superseded.
 */
async function leaveMissingShared(slot, env, stale) {
  const P = slot.paths;
  if (!P.shared) return false;
  const bak = await readOrError(P.bak);
  if (stale()) return null;
  if (bak.error !== null || bak.text !== null) return false;
  const S = slot.save;
  const next = slotPaths(slot.home, null);
  const own = await readOrError(next.bak);
  if (stale()) return null;
  if (S.overwrite) {
    // A Reset / Restore under way replaces the file it writes: this window's
    // own save is kept aside first, as the shared one was (reason kept).
    const main = await readOrError(next.save);
    if (stale()) return null;
    if (main.text !== null) {
      await keepAsideListed(slot, next, main.text, S.overwrite);
      if (stale()) return null;
    }
  }
  // From here to the end nothing awaits: the paths, base and backup switch together.
  slot.paths = next;
  slot.bakText = own.error === null ? own.text : null;
  S.bakUnreadable = own.error;
  S.bakHeld = null;
  S.bakProbeAt = null;
  S.bakFresh = false;
  slot.bakAt = null;
  slot.bakState = null;
  S.unreadable = null;
  S.recoveryText = null;
  S.ownApplied = 0; // none of this window's saves may be in that file
  S.recOwn = 0;
  slot.baseText = null;
  S.baseOk = false;
  const t = env.now();
  setNotice(slot, "load", { kind: "recovered", text: goneText(P.shared), at: t });
  noteBackupState(slot, t);
  markDirty(slot, t, true);
  S.urgentAt = t;
  touch(slot);
  return true;
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
  if (r.text === null) {
    const left = await leaveMissingShared(slot, env, stale);
    if (left === null) return { stop: true };
    if (left) return { ok: true, refunds: [], foreign: false };
  }
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
    // replaced file aside). Said, with the kept copy's name. When no kept file
    // holds this window's last save, this window keeps it aside itself before
    // taking the other game in, as mergeRecovery does (r8-07: it was told
    // "that window kept the old file aside" while no file held it). Its last
    // save is slot.baseText while that is its own write or a merged file
    // (baseOk), or its last save.recovery.json write (just back on save.json:
    // the other window kept that one aside), else its game as it is now.
    const had = Object.hasOwn(live.applied, slot.writerId) ? live.applied[slot.writerId] : 0;
    if (had < (slot.save.ownApplied || 0)) {
      let mine = slot.save.baseOk && typeof slot.baseText === "string" ? slot.baseText : null;
      let kept = mine !== null ? await findKept(P, mine) : null;
      if (stale()) return { stop: true };
      if (!kept && typeof slot.save.recoveryText === "string") {
        kept = await findKept(P, slot.save.recoveryText);
        if (stale()) return { stop: true };
      }
      if (kept) {
        if (!slot.save.damaged.some((d) => d === kept || String(d).startsWith(`${kept} (`))) slot.save.damaged.push(kept);
      } else {
        if (mine === null) {
          await pause(env); // the serialisation in a task step of its own
          if (stale()) return { stop: true };
          const ser = await serializeIn(slot, env, stale);
          if (ser === null || stale()) return { stop: true };
          mine = ser.text;
        }
        kept = await keepAsideListed(slot, P, mine, "this window's save");
        if (stale()) return { stop: true };
      }
      slot.save.ownApplied = had;
      setNotice(slot, "load", { kind: "recovered", text: replacedText(kept), at: t });
      // (the replay below in a task step of its own)
      await pause(env);
      if (stale()) return { stop: true };
      progress(slot, env);
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
    // (not a conflict to merge: the newer banner says why nothing is saved)
    if (slot.notices.write && slot.notices.write.kind === "conflict") slot.notices.write = null;
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
 * (`overwrite`) or when the action log was given up (`logLost`) or save.json
 * was unreadable. Another writer's file is kept aside first, with a notice.
 * After a Reset / Restore the file it replaced was kept aside then, and only
 * that text (slot.baseText): a save another window landed since, before this
 * window's replacing write, is kept aside here too, with the Reset / Restore
 * as its reason (r8-01: it was written over unkept, and that window was told
 * its file had been kept). Returns { ok } | { stop } | { error }.
 */
async function overwriteBase(slot, env, stale) {
  const S = slot.save;
  const P = slot.paths;
  const r = await readOrError(P.save);
  if (stale()) return { stop: true };
  if (r.error !== null) return { ok: false, error: r.error };
  if (r.text === null) {
    const left = await leaveMissingShared(slot, env, stale); // (r4-04)
    if (left === null) return { stop: true };
    if (left) return { ok: true };
  }
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
      setNotice(slot, "load", { kind: "recovered", text: unmergedText(kept), at: t });
    } else if (r.text !== slot.baseText) {
      // (a text kept already, by the Reset itself or on the way back from save.recovery.json, was said then)
      const k = await keepAsideListedR(slot, P, r.text, S.overwrite);
      if (stale()) return { stop: true };
      if (!k.already) setNotice(slot, "load", { kind: "recovered", text: lateSaveText(S.overwrite, k.name), at: t });
    }
  }
  slot.baseText = r.text;
  S.baseOk = false;
  return { ok: true };
}

/** The notice for this window's saved progress missing from save.json: another window replaced it (mergeFromDisk). */
export function replacedText(kept) {
  return kept
    ? `Another window replaced the save, so this window's earlier progress left the game. It is kept in ${kept}.`
    : "Another window replaced the save, so this window's earlier progress left the game. It could not be kept aside.";
}

/** The notice for another window's save, landed after this window's Reset / Restore (`reason`) and kept aside before the replacing write (overwriteBase, r8-01). */
export function lateSaveText(reason, kept) {
  const what = reason === "restore" ? "Restore" : "Reset";
  return kept
    ? `Another window saved the old game after the ${what}. That save was kept aside as ${kept}; this window's game was saved.`
    : `Another window saved the old game after the ${what}, and that save could not be kept aside. This window's game was saved.`;
}

/** The notice for a save.json kept aside before this window's game is written over it (overwriteBase, recoveryWrite). */
export function unmergedText(kept) {
  return kept
    ? `Another copy of the save changed while this window couldn't merge with it. It was kept aside as ${kept}; this window's game was saved.`
    : "Another copy of the save changed while this window couldn't merge with it, and it could not be kept aside. This window's game was saved.";
}

/**
 * save.recovery.json holds a game this window has not taken in: written by
 * another window that also found save.json unreadable (the usual two-window
 * case, r4-03), by this window's previous VM (its final close() write after a
 * restart_mods: r5-03), or left from an earlier episode. Merged as a
 * save.json conflict merges (mergeFromDisk): whenever the file holds actions
 * this game lacks (from any writer, this window's earlier VMs included) and
 * everything this window has saved, its game is taken in and this window's
 * unsaved actions replayed onto it, so nobody's progress is written over.
 *
 * When the two cannot be merged, the windows converge in one round (r5-02):
 * - the file lacks progress this window wrote to save.recovery.json
 *   (`recOwn`): another window kept that game aside and replaced it (below),
 *   so this window takes the file in, says so and names the kept copy
 *   (keeping its own last text aside itself when no copy is found), and
 *   lowers `recOwn` / `ownApplied` as mergeFromDisk does for a replaced save;
 * - the file lacks only progress this window saved to save.json before it
 *   turned unreadable (`ownApplied`), or the action log was given up
 *   (`logLost`): the file is kept aside and listed, with a notice, and this
 *   window's game is written over it. The other window then finds its own
 *   write replaced and takes this one in, so nothing is kept aside twice.
 * A refused purchase in the replay is said as a refund (r5-05). A damaged
 * file is kept aside, listed and said (r5-06); one from a newer Creaseworks
 * makes this window read-only. Writers the file names that this game has
 * pruned (last seen more than writerPruneMs before its clock: a file left
 * from an old episode) count as nothing new. While the unreadable notice
 * outranks these notices (all through the episode) they are flashed too
 * (recNotice). `back`: save.json can be read again and this window is going
 * back to it (recoveryWrite): the file's latest game is taken in first, so
 * the save.json written next lacks none of it (r5-04); a damaged file is then
 * left alone (nothing writes over it any more). Returns null when superseded
 * (or read-only), else { took }: true when the file's game was taken in,
 * false when this window's game is to be written over the file.
 */
async function mergeRecovery(slot, env, stale, text, back = false) {
  const S = slot.save;
  const P = slot.paths;
  const rec = baseName(recoveryPath(P));
  const over = { took: false };
  await pause(env); // a large recovery file's read already used much of the step
  if (stale()) return null;
  const parsed = await parseIn(slot, text, env, stale);
  if (parsed === null || stale()) return null;
  if (!parsed.ok) {
    if (parsed.reason === "newer") {
      slot.readOnly = true;
      S.status = "readonly";
      setNotice(slot, "load", { kind: "newer", at: env.now() });
      return null;
    }
    // Going back to save.json: nothing writes over it any more, so it is left as it is.
    if (back) return over;
    // Damaged: kept aside and said, never written over unseen (r5-06).
    const kept = await keepAsideListed(slot, P, text);
    if (stale()) return null;
    recNotice(slot, recDamagedText(rec, kept), env.now(), back);
    return over;
  }
  const live = parsed.state;
  const own = Array.isArray(slot.ownWriters) ? slot.ownWriters : [];
  let fresh = false; // actions there this game lacks, from any writer (r5-03)
  let foreign = false; // ... from another window
  for (const k of Object.keys(live.applied)) {
    if (!(live.applied[k] > (Object.hasOwn(slot.state.applied, k) ? slot.state.applied[k] : 0))) continue;
    if (pruned(slot.state, live, k)) continue;
    fresh = true;
    if (k !== slot.writerId && own.indexOf(k) < 0) foreign = true;
  }
  // Nothing this game lacks (this window's own last write, or a game it took in): written over.
  if (!fresh) return over;
  // Reset / Restore not yet in the file, or a log given up: replaced, never merged into
  // (a merge would bring the replaced game back); the other game is kept aside.
  if (S.logLost || (S.overwrite && !S.overwriteRec)) return keepOther(slot, env, stale, text, back);
  const had = ownApplied(live, slot.writerId);
  let replaced = false;
  let kept = null;
  if (had < (S.recOwn || 0)) {
    // Another window kept this window's recovery game aside and wrote its own:
    // taken in, as a replaced save.json is (mergeFromDisk), so the two converge.
    replaced = true;
    kept = await findKept(P, S.recoveryText);
    if (stale()) return null;
    if (kept) {
      if (!S.damaged.some((d) => d === kept || String(d).startsWith(`${kept} (`))) S.damaged.push(kept);
    } else {
      let mine = S.recoveryText;
      if (typeof mine !== "string") {
        const ser = await serializeIn(slot, env, stale);
        if (ser === null) return null;
        mine = ser.text;
      }
      kept = await keepAsideListed(slot, P, mine, `this window's ${rec}`);
      if (stale()) return null;
    }
  } else if (had < (S.ownApplied || 0)) {
    // First contact: the file lacks what this window saved to save.json before it turned unreadable.
    return keepOther(slot, env, stale, text, back);
  }
  await pause(env);
  if (stale()) return null;
  progress(slot, env);
  // From the replay to the end nothing awaits but the replay itself: actions
  // dispatched during its yields are replayed too, none after it.
  const ev = await replayPending(live, slot, env, stale);
  if (ev === null) return null;
  if (ev === "lost") return keepOther(slot, env, stale, text, back); // the log was given up: never merged into
  advance(live, env.now(), slot.writerId);
  slot.state = live;
  const t = env.now();
  const refunds = [];
  for (const e of ev) if (e && e.kind === "ignored" && e.reason === "afford" && e.item) refunds.push(itemName(String(e.item)));
  if (replaced) {
    S.recOwn = had;
    S.ownApplied = Math.min(S.ownApplied || 0, had);
    // (a refund said in the same flash when it fits; the replaced game comes first)
    recNotice(slot, recReplacedText(rec, kept), t, back, refunds.length ? `Refunded: ${refunds.slice(0, 3).join(", ")}${refunds.length > 3 ? "…" : ""}.` : null);
  } else if (refunds.length) {
    // The merged banner can't show under the unreadable notice (nor is there
    // one on the way back): the refund is flashed instead (r5-05).
    flash(slot, refundText(foreign, refunds), t, MERGED_MS);
  }
  touch(slot);
  return { took: true };
}

/**
 * Keeps another window's save.recovery.json aside, listed and said, so this
 * window's game can be written over it (each holds progress the other
 * lacks, or this window's log was given up). Returns { took: false }, or null
 * when superseded.
 */
async function keepOther(slot, env, stale, text, back = false) {
  const rec = baseName(recoveryPath(slot.paths));
  const kept = await keepAsideListed(slot, slot.paths, text, `another window's ${rec}`);
  if (stale()) return null;
  recNotice(slot, recOtherText(rec, kept), env.now(), back);
  return { took: false };
}

/**
 * True when writer `k` of the file's game `live` is one game `state` has
 * pruned (engine helpers.js: applied and writersSeen go together once a
 * writer is unseen for writerPruneMs): a save.recovery.json left from an
 * episode that long ago holds nothing new from it.
 */
function pruned(state, live, k) {
  if (Object.hasOwn(state.applied, k)) return false;
  const seen = Object.hasOwn(live.writersSeen || {}, k) ? live.writersSeen[k] : null;
  return typeof seen === "number" && typeof state.clock === "number" && state.clock - seen > CONTENT.K.writerPruneMs;
}

/**
 * A recovery-file notice (r5-02, r5-06) as the load notice. While save.json
 * is unreadable the unreadable notice outranks it all through the episode, so
 * it is flashed as well (MERGED_MS; with `extra`, a refund, when that fits
 * the banner) and marked `rec`: leaving recovery mode drops it (it would be
 * stale by then; the kept copy stays named in Details). On the way back
 * (`back`) it shows as soon as the unreadable notice goes.
 */
function recNotice(slot, text, t, back = false, extra = null) {
  const notice = { kind: "recovered", text, at: t };
  if (!back) notice.rec = true;
  setNotice(slot, "load", notice);
  const both = extra ? `${text} ${extra}` : text;
  if (!back) flash(slot, extra && graphemes(both).length <= NOTICE_MAX ? both : text, t, MERGED_MS);
  else if (extra) flash(slot, extra, t, MERGED_MS);
}

/** Leaving recovery mode: a recovery-file notice of the episode (recNotice) is stale now, and was flashed. */
function dropRecNotice(slot) {
  if (slot.notices.load && slot.notices.load.rec) setNotice(slot, "load", null);
}

/** The notice for another window's recovery game kept aside (keepOther). */
export function recOtherText(rec, kept) {
  return kept
    ? `Another window also saved to ${rec}, and the two could not be merged. Its progress is kept in ${kept}.`
    : `Another window also saved to ${rec}, and the two could not be merged. Its progress could not be kept aside.`;
}

/** The notice for this window's recovery game replaced by another window's (r5-02). */
export function recReplacedText(rec, kept) {
  return kept
    ? `Another window replaced ${rec}, so this window's earlier progress left the game. It is kept in ${kept}.`
    : `Another window replaced ${rec}, so this window's earlier progress left the game. It could not be kept aside.`;
}

/** The notice for a damaged recovery file found during play (r5-06). */
export function recDamagedText(rec, kept) {
  return kept
    ? `${rec} was damaged. It was kept aside as ${kept}; this window's game is saved there now.`
    : `${rec} was damaged and could not be kept aside; this window's game is saved there now.`;
}

/** The merged-with-refunds text (cycle's merged banner; a flash beside an unreadable save.json). */
export function refundText(foreign, refunds) {
  const lead = foreign ? "Merged with another window's progress." : "Merged with this window's last save.";
  return `${lead} Refunded: ${refunds.slice(0, 3).join(", ")}${refunds.length > 3 ? "…" : ""}.`;
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
    // Moved or fixed: back to save.json. First the recovery file's latest game
    // is taken in (r5-04): another window may have written it after this
    // window's last write, and the save.json written next must hold it (the
    // first window back would otherwise write a save.json lacking it, and the
    // other window, finding its saved progress missing, would keep that
    // fresh save aside). This window's own last write holds nothing new.
    const recFile = await readOrError(recoveryPath(P));
    if (stale()) return null;
    if (recFile.error === null && recFile.text !== null && recFile.text !== S.recoveryText) {
      if ((await mergeRecovery(slot, env, stale, recFile.text, true)) === null) return null; // nothing switched yet
    }
    // Progress written to the recovery file counts as saved from here on
    // (mergeFromDisk's replaced-save check).
    const saved = Math.max(S.ownApplied || 0, S.recOwn || 0);
    // A Reset / Restore already written to the recovery file has landed: the
    // other window took it in from there (mergeRecovery), so a file found at
    // save.json is merged or kept aside like any other, never written over
    // unseen. One not yet written there replaces whatever is found.
    const landed = !S.overwrite || S.overwriteRec;
    // A file there now is merged as a save.json conflict when it is a valid
    // save holding everything this window has saved: another window that went
    // back first wrote it (r5-04). So is one lacking this window's recovery
    // progress when that progress is kept aside: another window kept this
    // window's game aside and replaced it (mergeFromDisk then says so). One
    // that is damaged, from a newer build or lacking this window's saved
    // progress (an older save put back by hand: after a Reset, any other
    // game), or a log that was given up, is kept aside instead (overwriteBase).
    let mergeable = false;
    let keptMine = null;
    if (r.text !== null && !S.logLost && landed) {
      await pause(env); // the read already used much of the step (as mergeFromDisk)
      if (stale()) return null;
      const parsed = await parseIn(slot, r.text, env, stale);
      if (parsed === null || stale()) return null; // nothing switched yet: the next cycle checks again
      const same = !S.overwrite || parsed.state.created === slot.state.created;
      const had = parsed.ok ? ownApplied(parsed.state, slot.writerId) : 0;
      mergeable = parsed.ok && same && had >= saved;
      if (parsed.ok && same && !mergeable && had < (S.recOwn || 0)) {
        keptMine = await findKept(P, S.recoveryText);
        if (stale()) return null;
        mergeable = keptMine !== null;
      }
    } else if (r.text !== null && !landed) {
      // Not the game the Reset / Restore replaced (that one was in the recovery
      // file and is kept): kept aside too before it is written over, and said.
      const kept = await keepAsideListed(slot, P, r.text, S.overwrite);
      if (stale()) return null;
      setNotice(slot, "load", { kind: "recovered", text: unmergedText(kept), at: env.now() });
    }
    // From here to the switch nothing awaits.
    S.unreadable = null;
    S.errors = 0;
    S.retryAt = 0;
    S.ownApplied = saved;
    S.recOwn = 0;
    if (S.overwriteRec) {
      S.overwrite = null;
      S.overwriteRec = false;
    }
    if (keptMine && !S.damaged.some((d) => d === keptMine || String(d).startsWith(`${keptMine} (`))) S.damaged.push(keptMine);
    if (slot.notices.write && slot.notices.write.kind === "error") setNotice(slot, "write", null);
    dropRecNotice(slot);
    // Expecting "absent" makes a file found there a CAS rejection: merged (mergeFromDisk), or kept aside (overwriteBase).
    slot.baseText = null;
    S.baseOk = false;
    if (r.text !== null) {
      if (!mergeable && landed) S.logLost = true;
    } else if ((await leaveMissingShared(slot, env, stale)) === null) return null; // (r4-04)
    return "main";
  }
  S.unreadable = r.error;
  const rec = recoveryPath(P);
  for (let attempt = 0; attempt <= MERGE_RETRIES; attempt++) {
    if (attempt > 0) {
      // The serialisation in a task step of its own, never after a merge
      // (mergeRecovery's replay and advance), as in cycle's main path.
      await pause(env);
      if (stale()) return null;
      progress(slot, env);
    }
    const ser = await serializeIn(slot, env, stale);
    if (ser === null) return null;
    const { text, upto, epoch, own, rev } = ser;
    const big = oversize(text);
    if (big) {
      fail(slot, oversizeText(big, true), env.now()); // never sent (r6-16); ≤ 60 graphemes, the file named in the text
      return false;
    }
    try {
      await writeTextFile(rec, text, S.recoveryText);
    } catch (e) {
      if (stale()) return null;
      if (isCas(e)) {
        const again = await readOrError(rec);
        if (stale()) return null;
        if (again.error === null && again.text !== null && (await mergeRecovery(slot, env, stale, again.text)) === null) return null;
        S.recoveryText = again.error === null ? again.text : S.recoveryText;
        continue;
      }
      fail(slot, `${hostMessage(e)} (writing ${baseName(rec)})`, env.now());
      return false;
    }
    if (stale()) return null;
    const done = env.now();
    S.recoveryText = text;
    S.recOwn = own; // applied[writerId] in the text just written (mergeRecovery)
    if (S.overwrite) S.overwriteRec = true; // a Reset / Restore is in the recovery file now: merged with from here on
    S.confirmed = upto;
    confirmLog(slot, upto);
    // A log given up while this write was out holds actions the text lacks: kept lost (r4-09).
    if ((slot.logEpoch || 0) === epoch) S.logLost = false;
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

/**
 * While save.bak.json was there but could not be read (r6-04: a folder, over
 * 1 MiB, invalid UTF-8, no permission), it is never rotated: herdr's write
 * reads the file first (mod_files.rs write), so the rotation would fail with
 * the same host error, and the progress in it may not be anywhere else. It is
 * read again on the rotation's cadence instead (and at once on Retry), and
 * said (noteBackupState). Once it can be read:
 * - an ordinary backup of this same game (this window's or another writer's
 *   rotation: r7-06) is simply adopted and rotated as usual;
 * - anything else (the game a fresh start replaced, another game, a damaged or
 *   newer file) is kept aside (save.damaged-<n>.json, listed in Details with
 *   what it holds) and the player is told where it went before any rotation
 *   may replace it; until that copy is written it is not rotated over
 *   (S.bakHeld).
 * Gone (moved away by the player): nothing left to keep, it is rotated as
 * usual. Returns false when superseded.
 */
async function probeBackup(slot, env, stale, t) {
  const S = slot.save;
  const P = slot.paths;
  S.bakProbeAt = t;
  const r = await readOrError(P.bak);
  if (stale()) return false;
  if (r.error !== null) {
    S.bakUnreadable = r.error;
    S.bakHeld = null;
    noteBackupState(slot, t);
    return true;
  }
  if (r.text === null) {
    backupSettled(slot, null, null, t);
    return true;
  }
  if (r.text === slot.baseText) {
    backupSettled(slot, r.text, "ok", t); // the save this window last read or wrote
    return true;
  }
  await pause(env); // the parse in task steps of its own (r3-01)
  if (stale()) return false;
  progress(slot, env);
  const parsed = await parseIn(slot, r.text, env, stale);
  if (parsed === null || stale()) return false;
  if (parsed.ok && sameGame(parsed.state, slot.state) && notAhead(parsed.state, slot.state)) {
    // A backup of this game, at or behind it: nothing in it the save does not carry on.
    backupSettled(slot, r.text, "ok", t);
    return true;
  }
  const what = parsed.ok ? `the unreadable backup, from ${localTime(parsed.state.clock)}` : parsed.reason === "newer" ? "the unreadable backup, from a newer version" : "the unreadable backup, damaged";
  const kept = await keepAsideListed(slot, P, r.text, what);
  if (stale()) return false;
  if (!kept) {
    // Still left in place, never rotated over: tried again on the next probe.
    S.bakUnreadable = null;
    S.bakHeld = "could not be kept aside yet";
    noteBackupState(slot, t);
    return true;
  }
  const fresh = !!S.bakFresh;
  backupSettled(slot, r.text, parsed.ok ? "ok" : "damaged", t);
  const from = parsed.ok ? ` (game from ${localTime(parsed.state.clock)})` : "";
  setNotice(slot, "load", { kind: "recovered", text: backupKeptText(kept, from, fresh), at: t });
  return true;
}

/** The same game (seed and start time), whatever its progress: a backup of it holds nothing the save lacks. */
function sameGame(a, b) {
  return !!a && !!b && a.seed === b.seed && a.created === b.created;
}

/**
 * `bak` holds nothing `live` lacks: every writer's actions in it are applied
 * in `live`, or it is no later than one rotation ahead of `live`'s clock (a
 * rotation another window made since this one last merged its save).
 */
function notAhead(bak, live) {
  if (bak.clock <= live.clock + BACKUP_EVERY_MS) return true;
  for (const k of Object.keys(bak.applied || {})) {
    if (!(Object.hasOwn(live.applied, k) && live.applied[k] >= bak.applied[k])) return false;
  }
  return true;
}

/** The backup can be read (or is gone) and nothing in it needs keeping: rotated as usual from here. */
function backupSettled(slot, text, state, t) {
  const S = slot.save;
  S.bakUnreadable = null;
  S.bakHeld = null;
  S.bakFresh = false;
  slot.bakText = text;
  slot.bakState = text === null ? null : state;
  slot.bakAt = null; // rotated on the next cycle
  noteBackupState(slot, t);
}

/**
 * The backup notice while save.bak.json can't be read or kept aside (r7-05):
 * an error (banner, ribbon, footer, rail, the save notification), since there
 * is no working backup while it lasts. Not while the fresh-start notice says
 * it already, nor while save.json itself can't be read (that notice comes
 * first); cleared once the backup is settled.
 */
function noteBackupState(slot, t) {
  const S = slot.save;
  const was = slot.notices.bak;
  const load = slot.notices.load;
  const why = S.bakUnreadable || null;
  const held = !why && S.bakHeld ? S.bakHeld : null;
  const mine = !!was && was.bakState === true;
  if ((!why && !held) || S.unreadable || slot.readOnly || (load && load.kind === "fresh")) {
    if (mine) setNotice(slot, "bak", null);
    return;
  }
  const text = why ? backupUnreadableText(slot.paths.bak, why) : backupHeldText(slot.paths.bak);
  if (mine && was.text === text) return;
  setNotice(slot, "bak", { kind: "error", message: why || held, text, bakState: true, at: mine ? was.at : t });
}

/** The notice for a backup that can't be read beside a good save (≤ NOTICE_MAX graphemes). */
export function backupUnreadableText(path, message) {
  return clip(`Can't read the backup (${clip(baseName(path), 24)}): ${clip(String(message), 40)}. Left in place, not updated; the save itself is fine.`, NOTICE_MAX);
}

/** The notice for a backup readable again that could not be kept aside yet (≤ NOTICE_MAX graphemes). */
export function backupHeldText(path) {
  return clip(`The backup (${clip(baseName(path), 24)}) can be read again but could not be kept aside yet; not updated until it is. The save itself is fine.`, NOTICE_MAX);
}

/** The notice when an unreadable backup turns readable and is kept aside (≤ NOTICE_MAX graphemes). */
export function backupKeptText(kept, from = "", fresh = true) {
  return `The backup can be read again: kept as ${kept}${from} (Details). ${fresh ? "This game started fresh." : "It held another game; this one is unchanged."}`;
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
    S.bakUnreadable = null;
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
        S.bakUnreadable = null;
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
 * `env` = { now(), sleep?, owner?, final? }: `final` (close's last write)
 * leaves the backup rotation to the next cycle. Resolves when the cycle is
 * over (or superseded).
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
  let merged = false;
  const refunds = [];
  // save.json can't be read (r4-03): over to save.recovery.json in this same
  // cycle, as a load would. "main" when save.json turned readable again.
  const toRecovery = async (error) => {
    if (!(await enterUnreadable(slot, env, stale, error))) return false;
    await pause(env); // the serialisation in a task step of its own
    if (stale()) return false;
    progress(slot, env);
    const w = await recoveryWrite(slot, env, stale);
    return w === "main" ? "main" : w === true;
  };
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
      // 2. rotate the backup so it trails the main save; never one that
      // could not be read and holds progress not yet kept aside (r6-04)
      // (not in a close's final write, env.final: herdr gives close 250 ms, and the
      // backup is rotated by the next session's first cycle as well: r8-04)
      const rotates = !(env && env.final);
      if (rotates && (S.bakUnreadable || S.bakHeld) && (S.bakProbeAt === null || S.bakProbeAt === undefined || t - S.bakProbeAt >= BACKUP_EVERY_MS)) {
        if (!(await probeBackup(slot, env, stale, t))) return false; // superseded
        await pause(env); // the serialisation in a task step of its own
        if (stale()) return false;
        progress(slot, env);
      }
      if (rotates && !S.bakUnreadable && !S.bakHeld && S.baseOk && slot.baseText !== null && slot.baseText !== slot.bakText && (slot.bakAt === null || t - slot.bakAt >= BACKUP_EVERY_MS) && t >= (S.bakRetryAt || 0)) {
        if (!(await rotateBackup(slot, env, stale, t))) return false; // superseded
        // The serialisation in a task step of its own, not with the backup
        // write's resumption (R13: even a step of a large save's
        // serialisation is a share of one). A close callback's cx cannot
        // sleep once it has returned: its final write then goes on in this step.
        if (sleeps && (await yieldStep(env))) {
          if (stale()) return false;
          progress(slot, env);
        }
      }
      // 1. + 3. serialise (in steps for a large state, R13) and write
      const ser = await serializeIn(slot, env, stale);
      if (ser === null) return false;
      const { text, upto, epoch, own, rev } = ser;
      const big = oversize(text);
      if (big) {
        // Over herdr's file limit (r6-16): never sent; said in words, retried with back-off.
        fail(slot, oversizeText(big), env.now());
        return false;
      }
      slot.inflight = { text, upto, own };
      try {
        // (slot.paths, not a copy: a shared save found missing switches them: r4-04)
        await writeTextFile(slot.paths.save, text, slot.baseText);
      } catch (e) {
        if (stale()) return false;
        slot.inflight = null;
        if (!isCas(e)) {
          // herdr's write reads the file first: one that can't be read (too
          // big, not a file) fails here. Told apart by reading it, never by
          // the message (r4-03).
          const again = await readOrError(slot.paths.save);
          if (stale()) return false;
          if (again.error === null) {
            fail(slot, hostMessage(e), env.now());
            return false;
          }
          const w = await toRecovery(again.error);
          if (w === "main") continue;
          return w;
        }
        if (S.overwrite || S.logLost) {
          // Reset / Restore, or a log too long to replay: replace the file, never merge into it.
          const o = await overwriteBase(slot, env, stale);
          if (o.stop) return false;
          if (!o.ok) {
            const w = await toRecovery(o.error); // (its read failed: r4-03)
            if (w === "main") continue;
            return w;
          }
          continue;
        }
        // 5. CAS: someone else wrote. Re-read, merge, retry.
        const shown = slot.notices.write;
        if (!shown || shown.kind !== "conflict") setNotice(slot, "write", { kind: "conflict", at: env.now() });
        const m = await mergeFromDisk(slot, env, stale);
        if (m.stop) return false;
        if (!m.ok) {
          const w = await toRecovery(m.error); // (its read failed: r4-03)
          if (w === "main") continue;
          return w;
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
      S.overwriteRec = false;
      // A log given up while this write was out (live.js record) holds actions
      // this text lacks: the next conflict must still replace, not merge (r4-09).
      if ((slot.logEpoch || 0) === epoch) S.logLost = false;
      S.dirtyAt = slot.state.rev !== rev || slot.pending.length > 0 ? done : null;
      // An urgent request this write served is consumed; one made during the write stays.
      if (S.urgentAt !== null && (S.urgentAt <= t || S.dirtyAt === null)) S.urgentAt = null;
      if (merged) {
        const text2 = refunds.length ? refundText(true, refunds) : undefined;
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
  S.bakUnreadable = bak.error;
  S.bakHeld = null;
  S.bakProbeAt = null;
  S.bakFresh = false;
  slot.bakAt = null;
  slot.bakState = null;
  S.unreadable = null;
  S.recoveryText = null;
  S.ownApplied = 0; // none of this window's saves may be in that file yet
  S.recOwn = 0;
  dropRecNotice(slot);
  slot.baseText = null;
  S.baseOk = false;
  S.sharing = null;
  const t = env.now();
  noteBackupState(slot, t);
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
  S.bakProbeAt = null; // a backup that can't be read is read again at once
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
      if (!S.unreadable && !(await enterUnreadable(slot, env, stale, r.error))) return "stale";
      retryNow(slot, t);
      return "error";
    }
    if (r.text === null) {
      // A shared save gone with its backup: this window's own, as a load would (r4-04).
      if ((await leaveMissingShared(slot, env, stale)) === null) return "stale";
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
    // save.json unreadable: the game being replaced is this window's live game
    // (the recovery file may not be written yet in this episode, may be left
    // from an earlier one, or lack the latest actions). Another window's
    // progress there is kept aside by the next recovery write (mergeRecovery).
    let old = r;
    if (r.error !== null) {
      await pause(env); // the serialisation in a task step of its own
      if (stale()) return "stale";
      const ser = await serializeIn(slot, env, stale);
      if (ser === null || stale()) return "stale";
      old = { text: ser.text, error: null };
    }
    if (old.text !== null) {
      kept = await keepAsideListed(slot, slot.paths, old.text, reason);
      if (stale()) return "stale";
    }
    slot.baseText = r.error === null ? r.text : slot.baseText;
    S.baseOk = false;
    slot.state = next;
    clearLog(slot);
    S.ownApplied = 0;
    S.recOwn = 0;
    slot.inflight = null;
    slot.readOnly = false;
    if (S.status === "readonly") S.status = "ok";
    // The next write replaces the file: another window's save landing first is not merged back in.
    S.overwrite = reason;
    S.overwriteRec = false; // (set once the replacing write lands in save.recovery.json)
    S.logLost = false;
    slot.notices.load = null;
    refreshNotice(slot);
    retryNow(slot, env.now());
    const what = reason === "reset" ? "Started a new game." : "Restored the backup.";
    const said = old.text === null ? "" : kept ? ` The old save was kept as ${kept}.` : " The old save could not be kept aside.";
    if (typeof env.flash === "function") env.flash(`${what}${said}`);
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
    S.bakUnreadable = bak.error;
    S.bakHeld = null;
    S.bakProbeAt = null;
    S.bakFresh = false;
    slot.bakAt = null;
    slot.bakState = null;
    S.unreadable = null;
    S.recoveryText = null;
    S.ownApplied = 0; // another file: none of this window's saves are in it yet
    S.recOwn = 0;
    dropRecNotice(slot);
    noteBackupState(slot, env.now());
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
  // (an unreadable backup first: it holds progress. Its reason and path go
  // apart, so Details and Settings show each on a line of its own: r7-04)
  let backupWhy = null;
  let backupPath = null;
  if (S.bakUnreadable) {
    backup = "can't be read, left in place";
    backupWhy = String(S.bakUnreadable);
    backupPath = slot.paths.bak;
  } else if (S.bakHeld) {
    backup = "readable again, left in place";
    backupWhy = String(S.bakHeld);
    backupPath = slot.paths.bak;
  } else if (S.bakError) backup = `not updated (${S.bakError})`;
  else if (slot.bakText !== null) backup = slot.bakState === "damaged" ? "damaged" : slot.bakAt !== null ? `rotated ${localTime(slot.bakAt)}` : "present";
  return {
    state: problem ? "problem" : S.status === "saving" ? "saving" : "saved",
    text,
    path: slot.paths.save,
    lastGood: S.savedAt !== null ? localTime(S.savedAt) : null,
    backup,
    backupWhy,
    backupPath,
    damaged: S.damaged.slice(-DAMAGED_MAX),
    shared: !!slot.paths.shared,
  };
}

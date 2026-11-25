// The save files (ARCHITECTURE A4, A5, A6; DESIGN §12).
//
//   <appHome>/data/creaseworks/save.json             current save
//   <appHome>/data/creaseworks/save.bak.json         previous good save (rotated ≤ every 5 min)
//   <appHome>/data/creaseworks/save.damaged-<n>.json damaged files kept aside (n = 1..5, oldest replaced)
//   <appHome>/data/creaseworks/location.json         only when sharing: {"path": "/abs/…/save.json"}
//
// Written only with writeTextFile(path, text, expected) (compare-and-swap),
// read with readTextFile. Every non-clean outcome sets a visible save notice;
// nothing here is ever silent. All functions are async host work run from a
// `cx.spawn` task; each one re-checks its write generation after every await,
// so a superseded or reloaded write never touches the live slot.

import { readTextFile, writeTextFile } from "herdr";
import { serialize, parseSave, newGame, replay, advance, migrate, CONTENT } from "../engine/index.js";
import { localDay, localTime } from "./clock.js";
import { touch, markDirty, dueAt } from "./live.js";

export const MOD = "creaseworks";
export const BACKUP_EVERY_MS = 5 * 60000;
export const DAMAGED_MAX = 5;
export const MERGE_RETRIES = 3;
/** Error back-off: 10 s, 30 s, 60 s, then every 5 min (A4 step 6). */
export const BACKOFF_MS = Object.freeze([10000, 30000, 60000, 300000]);
export const MERGED_MS = 6000;

const CAS_TEXTS = ["The file changed outside Herdr", "The file changed while saving", "File exists", "os error 17"];

/** The paths for app home `home`, or for a shared save file `shared` (backups live next to it). */
export function pathsFor(home, shared = null) {
  const h = String(home).replace(/\/+$/, "");
  const dir = `${h}/data/${MOD}`;
  const save = typeof shared === "string" && shared ? shared : `${dir}/save.json`;
  const stem = save.replace(/\.json$/, "");
  return {
    dir,
    location: `${dir}/location.json`,
    save,
    bak: `${stem}.bak.json`,
    damaged: (n) => `${stem}.damaged-${n}.json`,
    shared: typeof shared === "string" && shared ? shared : null,
  };
}

/** Plain-data paths for the slot (no functions in the slot). */
export function slotPaths(home, shared = null) {
  const p = pathsFor(home, shared);
  return { dir: p.dir, location: p.location, save: p.save, bak: p.bak, shared: p.shared };
}

const damagedPath = (paths, n) => `${paths.save.replace(/\.json$/, "")}.damaged-${n}.json`;
const baseName = (p) => String(p).slice(String(p).lastIndexOf("/") + 1);

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

/**
 * Keeps damaged text aside as save.damaged-<n>.json: the first free n of 1..5;
 * when all five exist the oldest is replaced (the files shift down one and the
 * newest becomes 5, so 1 is always the oldest). Returns the file name, or null
 * when it could not be written.
 */
export async function keepAside(paths, text) {
  const have = [];
  for (let n = 1; n <= DAMAGED_MAX; n++) {
    const r = await readOrError(damagedPath(paths, n));
    have.push(r.text);
    if (r.text === null && r.error === null) {
      try {
        await writeTextFile(damagedPath(paths, n), text, null);
        return baseName(damagedPath(paths, n));
      } catch {
        return null;
      }
    }
  }
  try {
    for (let n = 1; n < DAMAGED_MAX; n++) await writeTextFile(damagedPath(paths, n), have[n], have[n - 1]);
    await writeTextFile(damagedPath(paths, DAMAGED_MAX), text, have[DAMAGED_MAX - 1]);
    return baseName(damagedPath(paths, DAMAGED_MAX));
  } catch {
    return null;
  }
}

function setNotice(slot, which, notice) {
  slot.notices[which] = notice;
  refreshNotice(slot);
}

/** The save notice on show: write problems first, then load outcomes. */
export function refreshNotice(slot) {
  const w = slot.notices.write;
  const l = slot.notices.load;
  const rank = { error: 6, conflict: 5, newer: 4, fresh: 3, recovered: 2, merged: 1 };
  const pick = !w ? l : !l ? w : (rank[w.kind] ?? 0) >= (rank[l.kind] ?? 0) ? w : l;
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
 * and start fresh. `opts`: { now, seed, writer, gen } (gen guards a load that a
 * reload superseded). Sets slot.state, baseText, bakText and the load notice.
 */
export async function load(slot, opts) {
  const stale = () => slot.loading !== opts.gen;
  const home = slot.home;
  const t0 = opts.now();
  // A shared save (location.json) wins over the local one.
  const loc = await readOrError(pathsFor(home).location);
  if (stale()) return false;
  let shared = null;
  if (loc.text !== null) {
    try {
      const doc = JSON.parse(loc.text);
      if (doc && typeof doc.path === "string" && doc.path.startsWith("/") && doc.path.endsWith(".json")) shared = doc.path;
    } catch {
      // a damaged pointer: fall back to the local save, and say so below
    }
  }
  slot.paths = slotPaths(home, shared);
  const P = slot.paths;
  const fresh = () => newGame({ seed: opts.seed, now: t0, day: localDay(t0) });
  const S = slot.save;
  const main = await readOrError(P.save);
  if (stale()) return false;
  const bak = await readOrError(P.bak);
  if (stale()) return false;
  slot.bakText = bak.text;
  slot.bakAt = null;
  slot.readOnly = false;
  let state = null;
  let notice = null;

  if (main.error !== null) {
    // Unreadable (too big, not a file): nothing can replace it safely by CAS.
    notice = { kind: "error", message: main.error, retryMs: BACKOFF_MS[0], at: t0 };
    // Each write then fails and is retried with back-off, banner shown.
    const b = bak.text !== null ? parseSave(bak.text) : null;
    state = b && b.ok ? b.state : fresh();
    slot.baseText = null;
    S.baseOk = false;
  } else if (main.text === null && bak.text === null) {
    state = fresh(); // first run: the first tick creates the save
    slot.baseText = null;
    S.baseOk = false;
  } else {
    const m = main.text !== null ? parseSave(main.text) : null;
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
        kept = await keepAside(P, main.text);
        if (stale()) return false;
        if (kept) S.damaged.push(kept);
      }
      slot.baseText = main.text;
      S.baseOk = false;
      const b = bak.text !== null ? parseSave(bak.text) : null;
      if (b && b.ok) {
        state = b.state;
        const when = localTime(state.clock);
        const lead = main.text === null ? "Save was missing." : "Save was damaged.";
        const tail = main.text === null ? "" : kept ? " Damaged copy kept." : " The damaged copy could not be kept.";
        notice = { kind: "recovered", text: `${lead} Loaded the backup from ${when}.${tail}`, at: t0 };
      } else {
        if (bak.text !== null) {
          const keptBak = await keepAside(P, bak.text);
          if (stale()) return false;
          if (keptBak) S.damaged.push(keptBak);
        }
        state = fresh();
        notice = {
          kind: "fresh",
          text: bak.text === null
            ? "Save was damaged and there was no backup. Started fresh; the damaged file was kept."
            : "Save and backup were damaged. Started fresh; both files kept.",
          at: t0,
        };
      }
    }
  }
  if (loc.text !== null && shared === null && !notice) {
    notice = { kind: "recovered", text: "The shared-save pointer (location.json) was damaged. Using this window's own save.", at: t0 };
  }
  slot.state = state;
  slot.pending = [];
  slot.inflight = null;
  S.writing = null;
  S.status = slot.readOnly ? "readonly" : "ok";
  S.savedAt = S.baseOk ? t0 : null;
  if (notice && notice.kind === "error") {
    slot.notices.write = notice;
    slot.notices.load = null;
    S.errors = 1;
    S.retryAt = t0 + BACKOFF_MS[0];
  } else {
    slot.notices.load = notice;
  }
  refreshNotice(slot);
  // A first run or a repaired save is written at once.
  if (!S.baseOk && !slot.readOnly) {
    markDirty(slot, t0, true);
    S.urgentAt = t0;
  }
  touch(slot);
  return true;
}

/** True when the ticker should start a save now (A4 cadence and back-off). */
export function due(slot, t) {
  const S = slot.save;
  if (!slot.state || slot.readOnly || slot.loading || S.writing !== null || slot.inflight) return false;
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
    slot.baseText = null; // deleted under us: create it again
    slot.save.baseOk = false;
    return { ok: true, refunds: [] };
  }
  const parsed = parseSave(r.text);
  if (parsed.ok) {
    const live = parsed.state;
    // Did another writer add anything? (A reload's own late write is not "another window".)
    let foreign = false;
    for (const k of Object.keys(live.applied)) {
      if (k !== slot.writerId && live.applied[k] > (Object.hasOwn(slot.state.applied, k) ? slot.state.applied[k] : 0)) foreign = true;
    }
    const ev = replay(live, slot.pending);
    advance(live, t, slot.writerId);
    slot.state = live;
    slot.baseText = r.text;
    slot.save.baseOk = true;
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
  const kept = await keepAside(P, r.text);
  if (stale()) return { stop: true };
  if (kept) slot.save.damaged.push(kept);
  slot.baseText = r.text;
  slot.save.baseOk = false;
  setNotice(slot, "load", {
    kind: "recovered",
    text: `The save file was damaged by another writer. ${kept ? "It was kept aside; " : ""}your progress is being saved over it.`,
    at: t,
  });
  return { ok: true, refunds: [] };
}

function fail(slot, message, t) {
  const S = slot.save;
  S.errors += 1;
  const delay = BACKOFF_MS[Math.min(S.errors, BACKOFF_MS.length) - 1];
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
  const gen = (S.gen += 1);
  S.writing = gen;
  S.status = "saving";
  touch(slot);
  const stale = () => S.writing !== gen;
  const P = slot.paths;
  let merged = false;
  const refunds = [];
  try {
    for (let attempt = 0; attempt <= MERGE_RETRIES; attempt++) {
      const t = env.now();
      // 2. rotate the backup so it trails the main save
      if (S.baseOk && slot.baseText !== null && slot.baseText !== slot.bakText && (slot.bakAt === null || t - slot.bakAt >= BACKUP_EVERY_MS)) {
        try {
          await writeTextFile(P.bak, slot.baseText, slot.bakText);
          if (stale()) return false;
          slot.bakText = slot.baseText;
          slot.bakAt = t;
        } catch (e) {
          if (stale()) return false;
          const r = await readOrError(P.bak); // someone else rotated it: catch up, try next time
          if (stale()) return false;
          if (r.error === null) slot.bakText = r.text;
          slot.bakAt = t;
        }
      }
      // 1. + 3. serialise and write
      const rev = slot.state.rev;
      const text = serialize(slot.state);
      const upto = slot.seq;
      slot.inflight = { text, upto };
      try {
        await writeTextFile(P.save, text, slot.baseText);
      } catch (e) {
        if (stale()) return false;
        slot.inflight = null;
        if (!isCas(e)) {
          fail(slot, hostMessage(e), env.now());
          return false;
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
        if (m.foreign !== false) merged = true;
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
      slot.pending = slot.pending.filter((a) => a.s > upto);
      S.status = "ok";
      S.savedAt = done;
      S.errors = 0;
      S.retryAt = 0;
      S.writtenRev = rev;
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
    if (S.writing === gen) {
      S.writing = null;
      if (S.status === "saving") S.status = "ok";
      touch(slot);
    }
  }
}

/** Expires the `merged` notice (6 s). */
export function expireNotices(slot, t) {
  const w = slot.notices.write;
  if (w && w.kind === "merged" && t >= (w.until ?? w.at + MERGED_MS)) setNotice(slot, "write", null);
}

/**
 * After a hot reload the old generation's write never settles (A6): if the
 * disk holds its text, the write landed (adopt it as base, drop actions ≤
 * upto); otherwise the next write is an ordinary CAS merge. `applied` makes
 * both safe.
 */
export async function resolveInflight(slot) {
  const inf = slot.inflight;
  if (!inf) return;
  const S = slot.save;
  const gen = (S.gen += 1);
  S.writing = gen;
  try {
    const r = await readOrError(slot.paths.save);
    if (S.writing !== gen) return;
    if (r.error === null && r.text === inf.text) {
      slot.baseText = inf.text;
      S.baseOk = true;
      S.confirmed = inf.upto;
      slot.pending = slot.pending.filter((a) => a.s > inf.upto);
    }
    slot.inflight = null;
  } finally {
    if (S.writing === gen) S.writing = null;
    touch(slot);
  }
}

/** Retry now (banner): clears the back-off and makes the save due. */
export function retryNow(slot, t) {
  const S = slot.save;
  S.retryAt = 0;
  markDirty(slot, t, true);
  S.urgentAt = t;
  touch(slot);
}

/** Dismisses a glue-owned save notice. */
export function dismiss(slot, kind) {
  for (const which of ["load", "write"]) {
    const n = slot.notices[which];
    if (n && n.kind === kind) slot.notices[which] = null;
  }
  refreshNotice(slot);
}

/** "Check save now" (§12.2): re-read and validate; a damaged file is kept aside and saved over. */
export async function checkSave(slot, env) {
  const S = slot.save;
  if (S.writing !== null || !slot.state) return "busy";
  const gen = (S.gen += 1);
  S.writing = gen;
  const stale = () => S.writing !== gen;
  try {
    const r = await readOrError(slot.paths.save);
    if (stale()) return "stale";
    const t = env.now();
    if (r.error !== null) {
      fail(slot, r.error, t);
      return "error";
    }
    if (r.text === null) {
      slot.baseText = null;
      S.baseOk = false;
      retryNow(slot, t);
      return "missing";
    }
    const parsed = parseSave(r.text);
    if (parsed.ok || parsed.reason === "newer") {
      if (r.text !== slot.baseText) retryNow(slot, t); // another writer's change: merge it now
      return parsed.ok ? "ok" : "newer";
    }
    const kept = await keepAside(slot.paths, r.text);
    if (stale()) return "stale";
    if (kept) S.damaged.push(kept);
    slot.baseText = r.text;
    S.baseOk = false;
    setNotice(slot, "load", { kind: "recovered", text: `The save file was damaged. ${kept ? "Kept it aside; s" : "S"}aving your progress again.`, at: t });
    retryNow(slot, t);
    return "damaged";
  } finally {
    if (S.writing === gen) S.writing = null;
    touch(slot);
  }
}

/**
 * Keeps the file on disk aside (reason "restore" / "reset") and replaces the
 * live game with `next` (the backup, or a new game); the next save writes it.
 */
async function replaceGame(slot, env, make, reason) {
  const S = slot.save;
  if (S.writing !== null || !slot.state) return "busy";
  const gen = (S.gen += 1);
  S.writing = gen;
  const stale = () => S.writing !== gen;
  try {
    const next = await make(stale);
    if (stale()) return "stale";
    if (!next) return "nothing";
    const r = await readOrError(slot.paths.save);
    if (stale()) return "stale";
    if (r.text !== null) {
      const kept = await keepAside(slot.paths, r.text);
      if (stale()) return "stale";
      if (kept) S.damaged.push(`${kept} (${reason})`);
    }
    slot.baseText = r.error === null ? r.text : slot.baseText;
    S.baseOk = false;
    slot.state = next;
    slot.pending = [];
    slot.inflight = null;
    slot.readOnly = false;
    slot.notices.load = null;
    refreshNotice(slot);
    retryNow(slot, env.now());
    return "ok";
  } finally {
    if (S.writing === gen) S.writing = null;
    touch(slot);
  }
}

/** "Restore backup…" (two-step in Settings): the current save is kept as a damaged copy. */
export function restoreBackup(slot, env) {
  return replaceGame(slot, env, async () => {
    const r = await readOrError(slot.paths.bak);
    const parsed = r.text !== null ? parseSave(r.text) : null;
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
  if (S.writing !== null || !slot.state) return "busy";
  const target = typeof path === "string" ? path.trim() : "";
  const local = pathsFor(slot.home).save;
  if (target === slot.paths.save) {
    env.flash(`This window already saves to ${baseName(target)}.`);
    return "same";
  }
  if (target !== "" && target !== local && !(target.startsWith("/") && target.endsWith(".json"))) {
    env.flash("A shared save path must be absolute and end in .json.");
    return "invalid";
  }
  const gen = (S.gen += 1);
  S.writing = gen;
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
    const parsed = r.text !== null ? parseSave(r.text) : null;
    if (parsed && !parsed.ok) {
      env.flash(parsed.reason === "newer" ? "That save is from a newer Creaseworks." : "That file is not a Creaseworks save.");
      return "notsave";
    }
    const locPath = pathsFor(slot.home).location;
    const cur = await readOrError(locPath);
    if (stale()) return "stale";
    try {
      await writeTextFile(locPath, JSON.stringify({ path: joining ? dest : null }), cur.text);
    } catch (e) {
      if (stale()) return "stale";
      env.flash(`Can't write location.json: ${hostMessage(e)}`);
      return "error";
    }
    if (stale()) return "stale";
    slot.paths = slotPaths(slot.home, joining ? dest : null);
    const bak = await readOrError(slot.paths.bak);
    if (stale()) return "stale";
    slot.bakText = bak.error === null ? bak.text : null;
    slot.bakAt = null;
    const t = env.now();
    if (parsed && parsed.ok) {
      const live = parsed.state;
      replay(live, slot.pending);
      advance(live, t, slot.writerId);
      slot.state = live;
      slot.baseText = r.text;
      S.baseOk = true;
    } else {
      slot.baseText = null; // absent: this window's game creates it
      S.baseOk = false;
    }
    retryNow(slot, t);
    env.flash(joining ? `Now sharing ${baseName(dest)} with another herdr home.` : "Back to this window's own save.");
    return "ok";
  } finally {
    if (S.writing === gen) S.writing = null;
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
  else if (S.status === "error") text = "Save problem: retrying";
  else if (n && n.kind === "conflict") text = "Merging another window's save…";
  else if (S.savedAt !== null) {
    const s = Math.max(0, Math.round((t - S.savedAt) / 1000));
    text = s < 5 ? "Saved just now" : s < 60 ? `Saved ${s - (s % 5)} s ago` : `Saved ${Math.floor(s / 60)} min ago`;
    // The footer's warn glyph must not sit next to a bare "Saved": say why.
    if (n && n.kind === "fresh") text = `Started fresh · ${text[0].toLowerCase()}${text.slice(1)}`;
  } else text = "Not saved yet";
  return {
    state: problem ? "problem" : S.status === "saving" ? "saving" : "saved",
    text,
    path: slot.paths.save,
    lastGood: S.savedAt !== null ? localTime(S.savedAt) : null,
    backup: slot.bakText !== null ? (slot.bakAt !== null ? `rotated ${localTime(slot.bakAt)}` : "present") : false,
    damaged: S.damaged.slice(-DAMAGED_MAX),
  };
}

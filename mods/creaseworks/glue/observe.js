// Observations of herdr's agents (DESIGN §5.1, §5.2; ARCHITECTURE B5).
//
// The ticker copy reads `agents()` once and `terminals()` once per data tick
// (never `panes()`) and hands both lists to `buildObservation`, which is pure:
// one entry per pane agent, plus one per live terminal with a status word
// whose `parent` chain reaches a pane agent within 32 hops (a fledgling).
// The two lists are joined by address (`created_ms` and `turn` come from
// `terminals()`; a missing `created_ms` counts as 0). Addresses are data and
// may be anything (`__proto__`, `constructor`, `peer/t7`): every index here
// is a `Map` or a null-prototype object. (A label or report key named like
// an Object.prototype member makes herdr's own terminals() call throw before
// any of this runs: glue/session.js keeps the last good observation, r4-01.)

const HOPS = 32;
const PANE_STATUS = { working: "working", blocked: "blocked", done: "done", idle: "idle" };

const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const fin = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The raw 7501 word of a terminals() entry (its `status`, else `report.state`), or null. */
export function rawWord(t) {
  if (!t || typeof t !== "object") return null;
  if (typeof t.status === "string" && t.status) return t.status;
  const r = t.report;
  if (typeof r === "string" && r) return r;
  if (r && typeof r === "object" && typeof r.state === "string" && r.state) return r.state;
  return null;
}

/** A pane agent's status: herdr's derived word (`error` is already `blocked` there; mapped again to be safe). */
export function paneStatus(word, raw) {
  if (raw === "error") return "blocked";
  return Object.hasOwn(PANE_STATUS, word) ? PANE_STATUS[word] : raw === "blocked" ? "blocked" : "idle";
}

/** A paneless fledgling's status from its raw word: `error → blocked`, `done → idle` (§5.2). */
export function kidStatus(raw) {
  if (raw === "working") return "working";
  if (raw === "blocked" || raw === "error") return "blocked";
  return "idle";
}

/** "<space> / <tab>" from a terminal's `labels.where`, or null. */
function whereOf(t) {
  const labels = t && t.labels;
  const w = labels && typeof labels === "object" && Object.hasOwn(labels, "where") ? labels.where : null;
  if (typeof w !== "string" || !w) return null;
  const i = w.lastIndexOf(" / ");
  return i < 0 ? { space: w, tab: "" } : { space: w.slice(0, i), tab: w.slice(i + 3) };
}

/**
 * buildObservation(agents(), terminals()) → { list: Observation[], live, panes }.
 * `list` is the B5 Observation array (pane agents in agents() order, then
 * fledglings in terminals() order); `live` is a Map of every live terminal
 * address → true (§5.6 liveness); `panes` maps a pane agent's address → pane id.
 */
export function buildObservation(agentList, terminalList) {
  const agentsIn = Array.isArray(agentList) ? agentList : [];
  const termsIn = Array.isArray(terminalList) ? terminalList : [];
  const terms = new Map();
  const live = new Map();
  for (const t of termsIn) {
    if (!t || typeof t !== "object" || typeof t.address !== "string") continue;
    if (t.state !== undefined && t.state !== null && t.state !== "live") continue;
    if (!terms.has(t.address)) terms.set(t.address, t);
    live.set(t.address, true);
  }
  const agentAt = new Map();
  for (const a of agentsIn) {
    if (a && typeof a === "object" && typeof a.address === "string" && !agentAt.has(a.address)) agentAt.set(a.address, a);
  }

  // The pane agent a terminal's parent chain reaches within 32 hops, memoised
  // with its distance so the limit holds whichever terminal is asked first.
  const memo = new Map(); // address → { root, d }
  const reach = (addr) => {
    if (memo.has(addr)) return memo.get(addr);
    let at = addr;
    let res = { root: null, d: Infinity };
    for (let hop = 1; hop <= HOPS; hop++) {
      const t = terms.get(at);
      const p = t && typeof t.parent === "string" && t.parent ? t.parent : null;
      if (p === null || p === addr) break;
      if (agentAt.has(p)) {
        res = { root: p, d: hop };
        break;
      }
      if (memo.has(p)) {
        const m = memo.get(p);
        if (m.root !== null && hop + m.d <= HOPS) res = { root: m.root, d: hop + m.d };
        break;
      }
      at = p;
    }
    memo.set(addr, res);
    return res;
  };
  const rootOf = (addr) => reach(addr).root;

  const included = new Map(); // address → kind
  const list = [];
  const panes = new Map();
  for (const a of agentAt.values()) {
    const t = terms.get(a.address) ?? null;
    const raw = rawWord(t) ?? (typeof a.status === "string" ? a.status : null);
    const root = rootOf(a.address);
    const kept = root !== null && root !== a.address;
    const pane = typeof a.pane === "string" && a.pane ? a.pane : null;
    if (pane !== null) panes.set(a.address, pane);
    included.set(a.address, kept ? "kid" : "pane");
    list.push({
      addr: a.address,
      created: t ? fin(t.created_ms) : 0,
      status: paneStatus(a.status, raw),
      raw: raw ?? "",
      turn: t ? fin(t.turn) : 0,
      parent: kept ? str(t && t.parent) : null,
      pane,
      title: str(a.title || (t && t.title)),
      paneName: a.pane_name === null || a.pane_name === undefined ? "" : str(a.pane_name),
      space: str(a.space_name),
      tab: str(a.tab_name),
      kind: kept ? "kid" : "pane",
    });
  }
  for (const t of terms.values()) {
    if (agentAt.has(t.address)) continue;
    const raw = rawWord(t);
    if (raw === null) continue; // never reported a word: not an agent
    const root = rootOf(t.address);
    if (root === null) continue;
    included.set(t.address, "kid");
  }
  // Fledglings: parent = the nearest ancestor that is itself observed.
  for (const t of terms.values()) {
    if (agentAt.has(t.address) || included.get(t.address) !== "kid") continue;
    const raw = rawWord(t);
    let parent = typeof t.parent === "string" ? t.parent : null;
    for (let hop = 0; hop < HOPS && parent !== null && !included.has(parent); hop++) {
      const pt = terms.get(parent);
      parent = pt && typeof pt.parent === "string" && pt.parent ? pt.parent : null;
    }
    const root = rootOf(t.address);
    const ra = root !== null ? agentAt.get(root) : null;
    const where = whereOf(t);
    list.push({
      addr: t.address,
      created: fin(t.created_ms),
      status: kidStatus(raw),
      raw,
      turn: fin(t.turn),
      parent: parent ?? root,
      pane: null,
      title: str(t.title || t.name || t.template || (t.program && t.program.name) || t.address),
      paneName: "",
      space: where ? where.space : str(ra && ra.space_name),
      tab: where ? where.tab : str(ra && ra.tab_name),
      kind: "kid",
    });
  }
  // Kept fledglings point at their nearest observed ancestor too.
  for (const o of list) {
    if (o.kind !== "kid" || o.pane === null) continue;
    let parent = o.parent;
    for (let hop = 0; hop < HOPS && parent && !included.has(parent); hop++) {
      const pt = terms.get(parent);
      parent = pt && typeof pt.parent === "string" && pt.parent ? pt.parent : null;
    }
    o.parent = parent || null;
  }
  return { list, live, panes };
}

/** A compact signature of an observation list: an `observe` action is sent only when it changes (§5.1). */
export function signature(list) {
  let s = "";
  for (const o of list) {
    s += `${o.addr}\u0001${o.created}\u0001${o.status}\u0001${o.raw}\u0001${o.turn}\u0001${o.parent}\u0001${o.pane}` +
      `\u0001${o.title}\u0001${o.paneName}\u0001${o.space}\u0001${o.tab}\u0001${o.kind}\u0002`;
  }
  return s;
}

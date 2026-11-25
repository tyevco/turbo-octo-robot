// Shared helpers for the engine suites (not a test file itself).
import * as engine from "../../mods/creaseworks/engine/index.js";

export { engine };
export const T0 = Date.UTC(2026, 10, 25, 9, 0, 0);
export const DAY = "2026-11-25";

/** A writer that stamps actions with { w, s } and applies them. */
export function writer(state, w = "wA") {
  let seq = 0;
  const me = {
    w,
    get seq() { return seq; },
    make(a) { return { w, s: ++seq, ...a }; },
    act(a) { return engine.apply(state, me.make(a)); },
  };
  return me;
}

/** An Observation for agent i (B5). */
export function agent(i, status = "working", turn = 0, extra = {}) {
  return {
    addr: `t${i}`, created: 1000 + i, status, raw: status, turn, parent: null,
    pane: `p${i}`, title: `agent ${i}`, paneName: `pane ${i}`, space: "main", tab: "1", kind: "pane",
    ...extra,
  };
}

export function kid(i, parentIndex, status = "working", turn = 0) {
  return agent(i, status, turn, { kind: "kid", pane: null, parent: `t${parentIndex}` });
}

/** An observe action body. */
export function observeAction(t, helpers, extra = {}) {
  return { t, type: "observe", helpers, visible: true, active: true, matShown: true, day: DAY, ...extra };
}

/** Give the state some workshops and helpers without going through play. */
export function seeded(seed = 1, now = T0) {
  return engine.newGame({ seed, now, day: DAY });
}

export function close(a, b, rel = 1e-9, msg = "") {
  const d = Math.abs(a - b);
  const tol = rel * Math.max(1, Math.abs(a), Math.abs(b));
  if (!(d <= tol)) throw new Error(`${msg} expected ${a} ≈ ${b} (|Δ| ${d} > ${tol})`);
}

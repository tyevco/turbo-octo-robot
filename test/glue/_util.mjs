// Shared helpers for the glue suites (not a test file itself): a mock herdr
// window (tools/mock/controller.js, virtual clock patched into Date.now),
// copies of the real View constructed and initialised like the shell does,
// renders through the mock gpui, and handler calls in event scopes.

import { createController, DEFAULT_NOW } from "../../tools/mock/controller.js";
import { constructView, beginRender, renderRoot, serialize, installMockWindow } from "../../tools/mock/gpui-kit.js";
import Creaseworks from "../../mods/creaseworks/main.js";
import { dropSlot, getSlot } from "../../mods/creaseworks/glue/live.js";
import * as engine from "../../mods/creaseworks/engine/index.js";

export { engine, DEFAULT_NOW, getSlot, dropSlot, Creaseworks };
export const HOME = "/home/player/.config/herdr-app";
export const DIR = `${HOME}/data/creaseworks`;
export const SAVE = `${DIR}/save.json`;
export const BAK = `${DIR}/save.bak.json`;
export const damaged = (n) => `${DIR}/save.damaged-${n}.json`;

installMockWindow();

/** A mock herdr window. `scenario` as tools/mock/controller.js; Date.now reads its clock. */
export function win(scenario = {}) {
  dropSlot();
  const ctl = createController({ patchDate: true, ...scenario });
  const copies = [];
  const w = {
    ctl,
    copies,
    get slot() {
      return getSlot();
    },
    /** A copy of the View with props {role}: constructed, init in an ambient event scope, promise jobs drained. */
    async copy(role = "panel", extraProps = {}) {
      ctl.setProps({ role, ...extraProps });
      const view = constructView(Creaseworks);
      await ctl.dispatch("event", view, (cx) => view.init(undefined, cx), { cx: "ambient", initializing: view });
      copies.push(view);
      return view;
    },
    /** Renders a copy; returns { tree, ms }. */
    render(view) {
      beginRender();
      return ctl.within("render", view, (cx) => {
        const t0 = performance.now();
        const el = view.render(cx);
        const ms = performance.now() - t0;
        return { tree: serialize(renderRoot(el), { cx }), ms, el };
      });
    },
    /** Calls a ctx handler of a copy (B11) in an event scope, like a click. */
    async handler(view, name, ...args) {
      return ctl.dispatch("event", view, (cx) => view.session.handlers[name](...args, cx));
    },
    /** n Sheet hits, 100 ms apart (the engine credits ≤ 12.5 hand hits a second). */
    async hits(view, n = 1) {
      for (let i = 0; i < n; i++) {
        await w.handler(view, "click", "sheet", null, null);
        await ctl.advance(100);
      }
    },
    advance(ms) {
      return ctl.advance(ms);
    },
    flush() {
      return ctl.flush();
    },
    /** A hot reload: a new generation, every copy constructed and initialised again, then the old one cancelled. */
    async reload() {
      const old = ctl.generation;
      ctl.newGeneration();
      const roles = copies.map((v) => v.session.role);
      copies.length = 0;
      for (const role of roles) await w.copy(role);
      ctl.cancelGeneration(old);
      return copies.slice();
    },
    dispose() {
      ctl.dispose();
      dropSlot();
    },
  };
  return w;
}

/** A pane agent for agents() (mock normalizeAgent fills the rest). */
export function agent(i, status = "working", extra = {}) {
  return { address: `t${i}`, pane: `p${i}`, status, title: `agent ${i}`, tab_name: String(1 + (i % 3)), space_name: "main", ...extra };
}

/** Its terminals() entry. */
export function term(i, status = "working", extra = {}) {
  return { address: `t${i}`, status, turn: 0, created_ms: 1000 + i, ...extra };
}

/** n pane agents with matching terminals, plus k paneless fledglings under the first agents. */
export function flockScenario(n, k = 0, status = (i) => ["working", "idle", "blocked", "done"][i % 4]) {
  const agents = [];
  const terminals = [];
  for (let i = 1; i <= n; i++) {
    agents.push(agent(i, status(i)));
    terminals.push(term(i, status(i) === "blocked" ? "blocked" : status(i) === "done" ? "idle" : status(i)));
  }
  for (let j = 1; j <= k; j++) terminals.push(term(1000 + j, j % 2 ? "working" : "done", { parent: `t${1 + (j % Math.max(1, n))}` }));
  return { agents, terminals };
}

/** A save file text for `state`. */
export function saveText(state) {
  return engine.serialize(state);
}

/** A fresh state at the mock's start time. */
export function freshState(seed = 1, now = DEFAULT_NOW - 1000) {
  return engine.newGame({ seed, now, day: "2026-01-01" });
}

export function parsed(ctl, path = SAVE) {
  const text = ctl.readFile(path);
  return text === null ? null : engine.parseSave(text);
}

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

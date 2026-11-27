// The Pattern book's engine side inside QuickJS-ng (ARCHITECTURE B17, A2 rule 6):
// a live copy with 64 agents renders within budget with a crease field, a
// result and a fold piece up; the Book tab's view model and a set click
// (the classifier included) run far under herdr's 500 ms callback limit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHost, BUDGETS } from "../../tools/qjs/harness.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MOD = join(repo, "mods", "creaseworks");
const HOME = "/home/player/.config/herdr-app";
const PANEL = { width: 320, height: 784 };
const SLOT = "globalThis[Symbol.for('creaseworks/live')]";
const STATUSES = ["working", "idle", "blocked", "done", "working", "idle", "working"];

function scenario(n) {
  const agents = [];
  const terminals = [];
  for (let i = 1; i <= n; i++) {
    const status = STATUSES[i % STATUSES.length];
    const address = `t${i}`;
    agents.push({
      address, pane: `p${i}`, status, title: `agent ${i} · fix the flaky test`, space_name: ["api", "web", "docs"][i % 3],
      tab_name: `tab ${1 + (i % 4)}`, tab_index: 1 + (i % 4), focused: i === 1,
    });
    terminals.push({ address, status: status === "done" ? "idle" : status, turn: status === "done" ? 1 : 0, created_ms: 1000 + i * 997 });
  }
  return { appHome: HOME, home: "/home/player", props: { role: "panel" }, window: { visible: true, active: true, platform: "linux" }, theme: "graphite", agents, terminals };
}

let probe = 0;
/** Runs module code in the VM next to the mod (so "./engine/index.js" resolves); returns its `out` and the VM ms it took. */
function inVm(host, body) {
  const ns = host.evalInVm(`import * as engine from "./engine/index.js";\nconst slot = ${SLOT};\n${body}`, { module: true, name: `${host.root}/probe-pattern-${++probe}.js?v=${host.generation}` });
  return { out: ns.out, ms: host.lastMs().detached };
}

const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];

test("64 agents with a crease field, a result chip and a fold piece up: renders within budget; the Book view and a set click far under 500 ms", async () => {
  const host = await createHost({ modRoot: MOD, scenario: scenario(64) });
  try {
    await host.load();
    host.advance(0);
    host.render();
    host.fire("root", "on_size_change", PANEL);
    host.advance(1000);
    host.render();
    // put the book in play on the live state (as a hand would leave it)
    const setup = inVm(host, `
      const s = slot.state;
      s.bought["long-crease"] = true; s.bought["grand-crease"] = true; s.bought["crease-field"] = true;
      s.book.open = true;
      s.book.found.ridge = { n: 4, at: s.clock, ready: 0 };
      s.spawn.fieldIn = 3;
      s.spawn.field = { id: "p900", born: s.spawn.shownMs, path: [0, 1, 2, 5] };
      s.spawn.fold = { id: "f901", kind: "ridge", slot: 9, born: s.spawn.shownMs };
      s.spawn.lastField = { pattern: "ridge", path: [6, 7, 8], closed: false, tier: 2, first: false, near: null, more: 0, rest: null, at: s.clock };
      s.rev++;
      const vm = engine.view(s, s.clock);
      export const out = { field: vm.sheet.field.dots.length, result: vm.sheet.fieldResult.text, fold: vm.mat.fold.kind, helpers: Object.keys(s.helpers).length };`);
    assert.deepEqual([setup.out.field, setup.out.result, setup.out.fold], [9, "Ridge · learned", "ridge"]);
    assert.ok(setup.out.helpers >= 64);
    const first = JSON.stringify(host.render().tree);
    assert.ok(first.includes('"cw-field-chip"') && first.includes('"cw-field-line"') && first.includes('"cw-dot-p900-4"') && first.includes('"cw-fold-f901"'), "the result chip, the field and the fold piece drawn");
    const renderMs = [];
    for (let i = 0; i < 24; i++) {
      if (i % 4 === 0) host.advance(1000);
      renderMs.push(host.render().ms);
    }
    assert.deepEqual(host.errors, [], JSON.stringify(host.errors));
    for (const ms of renderMs) assert.ok(ms < BUDGETS.render, `render ${ms} ms`);
    const p50 = pct(renderMs.slice(4), 0.5);
    assert.ok(p50 <= 16, `render p50 ${p50.toFixed(1)} ms`);
    // the field's dots, the result chip and the fold piece are drawn by the live render (ui/mat.js)
    const tree = host.render().tree;
    const has = (id) => JSON.stringify(tree).includes(`"${id}"`);
    // (the result chip's 3 s ended during the render loop; the line goes with it)
    assert.deepEqual(["cw-dot-p900-0", "cw-dot-p900-8", "cw-fold-f901", "cw-field-line"].filter((id) => !has(id)), [], "field and fold piece drawn");
    // a dot press through the live copy (a step on the trace): one callback, far under 500 ms
    host.advance(300);
    host.render();
    const press = host.fire("cw-dot-p900-4", "on_mouse_down:left", { local_position: { x: 14, y: 14 } });
    assert.equal(press.stopped, true, "the dot stops the press: no Sheet click too");
    assert.ok(press.ms < 100, `a dot press ${press.ms.toFixed(1)} ms`);
    assert.deepEqual(host.errors, [], JSON.stringify(host.errors));
    const step = inVm(host, `export const out = slot.state.spawn.field ? slot.state.spawn.field.path.join(",") : "gone";`);
    assert.equal(step.out, "0,1,2,5,4");
    // the Book tab: opened through its tab, rendered with its cards, within the render budget
    host.render();
    host.fire("cw-tab-book", "on_click", {});
    const bookMs = [];
    for (let i = 0; i < 8; i++) bookMs.push(host.render().ms);
    assert.deepEqual(host.errors, [], JSON.stringify(host.errors));
    const bookTree = JSON.stringify(host.render().tree);
    assert.ok(bookTree.includes('"cw-book-ridge"') && bookTree.includes('"cw-book-coil"'), "the Book tab's cards");
    for (const ms of bookMs) assert.ok(ms < BUDGETS.render, `Book tab render ${ms} ms`);
    const seen = inVm(host, `export const out = slot.state.ui.hints.book;`);
    assert.equal(seen.out, 2, "opening the tab marked its marks seen (Ridge learned: 2 marks)");
    host.fire("cw-tab-flock", "on_click", {});
    host.render();
    console.log(`# qjs pattern book UI: dot press ${press.ms.toFixed(1)} ms; Book tab render p50 ${pct(bookMs.slice(2), 0.5).toFixed(1)} ms (max ${Math.max(...bookMs).toFixed(1)})`);
    // the Book tab's view model (cards built), warm
    inVm(host, `export const out = engine.view(slot.state, slot.state.clock, { tab: "book" }).book.cards.length;`);
    const book = inVm(host, `
      let n = 0;
      for (let i = 0; i < 10; i++) n += engine.view(slot.state, slot.state.clock, { tab: "book" }).book.cards.length;
      export const out = n;`);
    assert.equal(book.out, 90);
    assert.ok(book.ms / 10 < 50, `a Book view ${(book.ms / 10).toFixed(1)} ms`);
    // a set click on a copy of the live state: a Coil traced to its last dot, then set (classifier, pay, book, fold drop)
    const set = inVm(host, `
      const s = engine.cloneState(slot.state);
      s.spawn.fold = null;
      s.spawn.field = { id: "p902", born: s.spawn.shownMs, path: [0, 1, 2, 5, 8, 7, 6, 3, 4] };
      const t = s.clock + 400;
      const ev = engine.apply(s, { w: "w-probe", s: 1, t, type: "click", target: "dot", id: "p902-4" });
      export const out = { match: ev.filter((e) => e.kind === "trace").map((e) => e.result + ":" + (e.pattern || "")), fold: !!s.spawn.fold };`);
    assert.deepEqual(set.out.match, ["match:coil"]);
    assert.equal(set.out.fold, true);
    assert.ok(set.ms < 100, `a set click (state clone included) ${set.ms.toFixed(1)} ms`);
    // the classifier's worst case: a closed 9-dot loop's 144 candidates, 100 times
    const cls = inVm(host, `
      let k = 0;
      for (let i = 0; i < 100; i++) if (engine.classifyTrace([0, 1, 2, 5, 8, 7, 6, 3, 4], true) === null) k++;
      export const out = k;`);
    assert.equal(cls.out, 100);
    assert.ok(cls.ms / 100 < 5, `one worst-case classification ${(cls.ms / 100).toFixed(2)} ms`);
    const one = inVm(host, `
      const s = engine.cloneState(slot.state);
      s.spawn.field = { id: "p903", born: s.spawn.shownMs, path: [0, 1, 2, 5, 8, 7, 6, 3] };
      export const out = engine.apply(s, { w: "w-probe", s: 1, t: s.clock + 400, type: "click", target: "dot", id: "p903-0" }).some((e) => e.kind === "trace" && e.pattern === "hem");`);
    assert.equal(one.out, true);
    assert.ok(one.ms < 100, `one set click (state clone included) ${one.ms.toFixed(1)} ms`);
    console.log(`# qjs pattern book: 64-agent render with a field p50 ${p50.toFixed(1)} ms (max ${Math.max(...renderMs).toFixed(1)}); Book view ${(book.ms / 10).toFixed(2)} ms; set click ${set.ms.toFixed(1)} ms; worst classification ${(cls.ms / 100).toFixed(2)} ms; a Hem set click ${one.ms.toFixed(1)} ms`);
  } finally {
    host.dispose();
  }
});

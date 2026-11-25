// The QuickJS-ng harness (tools/qjs/harness.mjs, ARCHITECTURE A9): herdr's
// sandbox, module resolution, per-phase budgets, reload and VM restart, run
// against test/fixtures/sample-mod. Run with: node --test test/qjs/
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createHost, BudgetError, BUDGETS } from "../../tools/qjs/harness.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixture = join(repo, "test", "fixtures", "sample-mod");
const SLOT = "globalThis[Symbol.for('sample-mod/live')]";
const live = (host) => JSON.parse(host.evalInVm(`JSON.stringify(${SLOT} ?? null)`));
const SAVE = "/home/player/.config/herdr-app/data/sample-mod/save.json";

const HINT = "the shell sandbox withholds dynamic code; run the host with --dev to allow it";
const throwsVm = (fn, Ctor, message) =>
  assert.throws(fn, (e) => e instanceof Ctor && e.message === message, `${Ctor.name}: ${message}`);

async function loaded(options = {}) {
  const host = await createHost({ modRoot: fixture, scenario: {}, ...options });
  await host.load();
  return host;
}

/** A throwaway mod folder: { "main.js": "...", "lib/a.js": "..." }. */
function tempMod(files) {
  const dir = mkdtempSync(join(tmpdir(), "qjs-mod-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

const MINIMAL = (extra = "") => `import { View, div } from "gpui-kit";\n${extra}\nexport default class M extends View { render() { return div().id("m"); } }\n`;

// ---------------------------------------------------------------------------

test("the fixture loads, renders and reports ms per phase within budget", async (t) => {
  const host = await loaded();
  t.after(() => host.dispose());

  const kinds = host.phases.map((p) => p.phase);
  for (const kind of ["moduleGraph", "constructor", "init"]) assert.ok(kinds.includes(kind), kind);

  const { tree, ms, layoutMs } = host.render();
  assert.equal(typeof ms, "number");
  assert.ok(ms < BUDGETS.render && layoutMs < BUDGETS.layout, `render ${ms} ms, layout ${layoutMs} ms`);
  assert.equal(tree.kind, "v_flex");
  assert.equal(tree.id, "root");
  assert.deepEqual(tree.children.map((c) => c.id), ["title", "ticks", "counts", null]);
  assert.deepEqual(tree.children[0].children, [{ kind: "text", text: "Sample build 1" }]);
  const buttons = tree.children[3].children;
  assert.deepEqual(buttons.map((b) => [b.kind, b.id]), [["Button", "bump"], ["Button", "save"]]);
  assert.deepEqual(buttons[0].handlers, { on_click: { handler: "on_click", path: "0.3.0" } });

  for (const p of host.phases) assert.ok(p.ms <= p.budget, `${p.label}: ${p.ms} ms of ${p.budget}`);
  const last = host.lastMs();
  for (const kind of ["moduleGraph", "constructor", "init", "render", "layout"]) assert.equal(typeof last[kind], "number", kind);

  // init's readTextFile was recorded with its argument and phase
  const reads = host.callsTo("readTextFile");
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0].args, [SAVE]);
  assert.equal(reads[0].async, true);
  assert.equal(reads[0].settled, false);
  host.advance(0);
  assert.equal(host.callsTo("readTextFile")[0].settled, true);
  assert.equal(host.callsTo("readTextFile")[0].result, null);
});

test("fire runs the handler in the VM (null-prototype map keyed '__proto__'); advance runs timers", async (t) => {
  const host = await loaded();
  t.after(() => host.dispose());
  host.render();

  const fired = host.fire("bump", "on_click", "__proto__");
  assert.equal(fired.notified, true);
  assert.equal(fired.stopped, false);
  host.fire("bump", "on_click", "toString");
  host.fire("bump", "on_click", "__proto__");
  const { tree } = host.render();
  assert.deepEqual(tree.children[2].children, [{ kind: "text", text: "__proto__=2 toString=1" }]);

  const before = live(host).ticks;
  const step = host.advance(3000);
  assert.equal(live(host).ticks, before + 3);
  assert.ok(step.steps >= 3);
  for (const ms of step.stepMs) assert.ok(ms < BUDGETS.timer);

  assert.throws(() => host.fire("nope", "on_click"), /no element with id "nope"/);
});

test("frozen prototypes: module code cannot patch built-ins; null-prototype maps take any key", async (t) => {
  const host = await loaded();
  t.after(() => host.dispose());

  throwsVm(() => host.evalInVm("({}).toString = () => 'x';", { module: true }), TypeError, "'toString' is read-only");
  assert.throws(() => host.evalInVm("Array.prototype.first = function () { return this[0]; };", { module: true }), TypeError);
  assert.throws(() => host.evalInVm("Object.prototype.polluted = 1;", { module: true }), TypeError);
  assert.throws(() => host.evalInVm("Object.assign({}, JSON.parse('{\"constructor\": 1}'));", { module: true }), TypeError);
  // sloppy global code discards the write silently; the property never appears
  assert.equal(host.evalInVm("Object.prototype.polluted = 1; ({}).polluted === undefined"), true);
  assert.deepEqual(
    host.evalInVm(
      "for (const p of [Object.prototype, Array.prototype, Function.prototype, String.prototype, Number.prototype]) " +
        "if (!Object.isFrozen(p)) throw new Error('not frozen'); export const others = [Date.prototype, Map.prototype, Promise.prototype].map(Object.isFrozen);",
      { module: true },
    ),
    { others: [false, false, false] },
  );

  const map = host.evalInVm(
    "const m = Object.create(null); for (const k of ['__proto__', 'toString', 'constructor', 'hasOwnProperty']) m[k] = k.length; " +
      "export const keys = Object.keys(m); export const proto = m.__proto__; export const has = Object.hasOwn(m, '__proto__') && ('toString' in m);",
    { module: true },
  );
  assert.deepEqual(map, { keys: ["__proto__", "toString", "constructor", "hasOwnProperty"], proto: 9, has: true });
});

test("dynamic code is withheld: eval is deleted, every Function constructor throws the shell's message", async (t) => {
  const host = await loaded();
  t.after(() => host.dispose());

  throwsVm(() => host.evalInVm("eval('1 + 1')"), ReferenceError, "eval is not defined");
  assert.equal(host.evalInVm("typeof eval"), "undefined");
  const fn = `the Function constructor is disabled: ${HINT}`;
  throwsVm(() => host.evalInVm("new Function('return 1')()"), TypeError, fn);
  throwsVm(() => host.evalInVm("Function('return 1')()"), TypeError, fn);
  throwsVm(() => host.evalInVm("(function () {}).constructor('return 1')()"), TypeError, fn);
  throwsVm(() => host.evalInVm("(() => {}).constructor('return 1')()"), TypeError, fn);
  throwsVm(() => host.evalInVm("(async function () {}).constructor('return 1')"), TypeError, `the AsyncFunction constructor is disabled: ${HINT}`);
  throwsVm(() => host.evalInVm("(function* () {}).constructor('return 1')"), TypeError, `the GeneratorFunction constructor is disabled: ${HINT}`);
  throwsVm(() => host.evalInVm("(async function* () {}).constructor('return 1')"), TypeError, `the AsyncGeneratorFunction constructor is disabled: ${HINT}`);
  // the ordinary uses of Function keep working
  assert.equal(
    host.evalInVm("((f) => f instanceof Function && f.call(null, 1) === 1 && typeof f.bind(null) === 'function')((x) => x)"),
    true,
  );
});

test("absent globals throw the shell's hints; DOM names stay undetected; unverified globals are withheld", async (t) => {
  const host = await loaded();
  t.after(() => host.dispose());

  const stubs = {
    "setTimeout(() => {}, 0)": "`setTimeout` is not available in the shell: use cx.timer.after(ms, callback)",
    "setInterval(() => {}, 0)": "`setInterval` is not available in the shell: use cx.timer.every(ms, callback)",
    "clearTimeout(1)": "`clearTimeout` is not available in the shell: cancel the handle returned by cx.timer.after",
    "clearInterval(1)": "`clearInterval` is not available in the shell: cancel the handle returned by cx.timer.every",
    "require('fs')": "`require` is not available in the shell: this runtime uses ES modules; use `import`",
  };
  for (const [code, message] of Object.entries(stubs)) {
    throwsVm(() => host.evalInVm(code), TypeError, message);
    throwsVm(() => host.evalInVm(`${code};`, { module: true }), TypeError, message);
  }
  assert.equal(host.evalInVm("typeof document"), "undefined");
  assert.equal(host.evalInVm("typeof window.paint_path"), "function"); // the shell's own window object
  assert.equal(host.evalInVm("typeof queueMicrotask + typeof structuredClone + typeof TextEncoder + typeof Intl"), "undefined".repeat(4));
  assert.equal(host.evalInVm("typeof performance.now + typeof console.log"), "functionfunction");
});

test("the sandbox prelude matches sandbox.rs when the herdr source is at hand", { skip: !sandboxRs() && "herdr-src not found" }, () => {
  const rs = readFileSync(sandboxRs(), "utf8");
  const js = readFileSync(join(repo, "tools", "qjs", "sandbox.js"), "utf8");
  const squash = (s) => s.replace(/\s+/g, " ").trim();
  const block = (name) => rs.match(new RegExp(`const ${name}: &str = r#"([\\s\\S]*?)"#;`))[1];
  assert.ok(squash(js).includes(squash(block("WITHHOLD_DYNAMIC_CODE")).replace(/^\(\(\) => \{ /, "").replace(/ \}\)\(\);$/, "")));
  assert.ok(squash(js).includes(squash(block("FREEZE_BUILTINS"))));
  const absent = rs.match(/const ABSENT_GLOBALS[\s\S]*?\];/)[0];
  for (const [, name, hint] of absent.matchAll(/\(\s*"(\w+)",\s*"((?:[^"\\]|\\.)*)",?\s*\)/g)) {
    assert.ok(js.includes(`["${name}", "${hint}"]`), name);
  }
});

function sandboxRs() {
  const src =
    process.env.HERDR_SRC ??
    "/tmp/claude-0/-home-user-turbo-octo-robot/765765b0-bd4e-5d4c-890a-1f1834a9bff2/scratchpad/herdr-src";
  const file = join(src, "vendor/gpui-kit/crates/shell/src/engine/quickjs/sandbox.rs");
  return existsSync(file) ? file : null;
}

test("a render that spins past 50 ms fails with a budget error; the VM stays usable", async (t) => {
  const host = await loaded();
  t.after(() => host.dispose());
  host.evalInVm(`${SLOT}.spinMs = 80`);
  assert.throws(
    () => host.render(),
    (e) => e instanceof BudgetError && e.phase === "render" && e.budget === 50 && e.interrupted && e.ms >= 50 && /render exceeded its 50 ms budget/.test(e.message),
  );
  host.evalInVm(`${SLOT}.spinMs = 0`);
  const { ms } = host.render();
  assert.ok(ms < 50);
  host.fire("bump", "on_click", "k");
});

test("module graph, init and timer callbacks each have their own 500 ms budget", async (t) => {
  const spin = "const end = performance.now() + 700; while (performance.now() < end) {}";
  const slowTop = await createHost({ modRoot: tempMod({ "main.js": MINIMAL(spin) }) });
  t.after(() => slowTop.dispose());
  await assert.rejects(slowTop.load(), (e) => e instanceof BudgetError && e.phase === "module graph" && e.budget === 500);

  const slowInit = await createHost({
    modRoot: tempMod({
      "main.js": `import { View, div } from "gpui-kit";
export default class M extends View {
  init(_p, cx) { this.t = cx.timer.every(1000, () => { const end = performance.now() + 700; while (performance.now() < end) {} }); }
  render() { return div().id("m"); }
}`,
    }),
  });
  t.after(() => slowInit.dispose());
  const { ms } = await slowInit.load();
  assert.ok(ms.init < 500 && ms.moduleGraph < 500 && ms.constructor < 500);
  assert.throws(() => slowInit.advance(1000), (e) => e instanceof BudgetError && e.phase === "timer / task step" && e.budget === 500);
});

test("module resolution follows herdr: built-ins, the mod root, .js fallback, refusals with the real messages", async (t) => {
  const outside = mkdtempSync(join(tmpdir(), "qjs-outside-"));
  writeFileSync(join(outside, "secret.js"), "export const s = 1;\n");
  const dir = tempMod({
    "main.js": MINIMAL('import { a } from "./lib/a";\nimport { b } from "lib/b.js";\nimport { h_flex } from "gpui-base";\nimport { props } from "herdr";\nimport * as alias from "gpui";'),
    "lib/a.js": 'export const a = 1;\nexport { b as again } from "../lib/b.js";\n',
    "lib/b.js": "export const b = 2;\n",
    "dyn.js": "export const d = 4;\n",
  });
  const host = await createHost({ modRoot: dir });
  t.after(() => host.dispose());
  await host.load();
  host.render();

  const importFrom = (spec) => {
    writeFileSync(join(dir, "probe.js"), `import ${JSON.stringify(spec)};\nexport const ok = 1;\n`);
    writeFileSync(join(dir, "main.js"), MINIMAL('import "./probe.js";'));
    return host.reload();
  };
  const refuses = async (spec, message) => {
    await assert.rejects(importFrom(spec), (e) => e.message === message || (message instanceof RegExp && message.test(e.message)), spec);
  };
  await refuses("../../../etc/passwd", /^cannot resolve module `..\/..\/..\/etc\/passwd` from `|resolves outside the application directory/);
  await refuses(join(outside, "secret.js"), `module \`${join(outside, "secret.js")}\` resolves outside the application directory \`${host.root}\``);
  await refuses(
    "lodash",
    "cannot resolve module `lodash`: this runtime's built-in modules are `gpui-kit`, `gpui`, `gpui-base`, `gpui-shell`, `gpui-fps`, `gpui-component`, " +
      "and an application may otherwise import only its own files. If the script expects a module this runtime does not have, the two are different versions.",
  );
  await refuses("./missing.js", /^cannot resolve module `\.\/missing\.js` from `.*\/probe\.js\?v=\d+`$/);
  await refuses("fs/promises", /^harness: `fs\/promises` is a herdr built-in the QuickJS harness does not provide/);
  await refuses("mock:gpui-core.js", /^cannot resolve module `mock:gpui-core\.js`/);
  // a mod cannot import the mock-only helpers: link error naming the module
  writeFileSync(join(dir, "main.js"), MINIMAL('import { fire } from "gpui-kit";'));
  await assert.rejects(host.reload(), (e) => e instanceof SyntaxError && e.message === "Could not find export 'fire' in module 'gpui-kit'");
  // a bare file name resolves inside the root when the file exists
  await importFrom("dyn");
  // the old instance kept running through every failed reload
  assert.equal(host.render().tree.id, "m");

  writeFileSync(join(dir, "main.js"), "export const notAView = 1;\n");
  await assert.rejects(host.reload(), (e) => e.message === "main.js must `export default` a class that extends View");
});

test("reload keeps globalThis and the slot, builds a new instance, then cancels the old generation's timers", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "qjs-reload-"));
  cpSync(fixture, dir, { recursive: true });
  const host = await createHost({ modRoot: dir });
  t.after(() => host.dispose());
  await host.load();
  host.render();
  host.fire("bump", "on_click", "a");
  host.evalInVm("globalThis.marker = { kept: true }");
  const slotBefore = host.evalInVm(`(globalThis.slotRef = ${SLOT}, 1)`);
  assert.equal(slotBefore, 1);
  const timersBefore = host.pendingTasks().filter((p) => p.kind === "timer");
  assert.deepEqual(timersBefore.map((p) => p.gen), [1]);

  const result = await host.reload();
  assert.equal(result.generation, 2);
  assert.equal(result.released, 1);
  for (const kind of ["moduleGraph", "constructor", "init"]) assert.ok(result.ms[kind] < 500, kind);

  assert.equal(host.evalInVm(`globalThis.marker.kept && globalThis.slotRef === ${SLOT}`), true);
  const state = live(host);
  assert.equal(state.inits, 2);
  assert.deepEqual(state.counts, { a: 1 });
  assert.deepEqual(host.pendingTasks().filter((p) => p.kind === "timer").map((p) => p.gen), [2]);
  assert.match(host.render().tree.children[0].children[0].text, /build 2/);

  host.advance(1000);
  const after = live(host);
  assert.equal(after.ticks, 1, "only the new build's timer ticks");
  assert.equal(after.lastTickBy, 2);

  // a broken build leaves the running one alone
  writeFileSync(join(dir, "lib", "x.js"), "export const broken = ;\n");
  await assert.rejects(host.reload(), SyntaxError);
  assert.deepEqual(host.pendingTasks().filter((p) => p.kind === "timer").map((p) => p.gen), [2]);
  host.advance(1000);
  assert.equal(live(host).ticks, 2);
  assert.equal(host.render().tree.id, "root");
});

test("restartVm calls close(cx) within 250 ms, gives a fresh globalThis and keeps the disk", async (t) => {
  const host = await loaded();
  t.after(() => host.dispose());
  host.render();
  host.fire("bump", "on_click", "__proto__");
  host.fire("save", "on_click");
  host.advance(0);
  const saved = host.callsTo("writeTextFile");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].args[2], null);
  assert.equal(saved[0].settled, true);
  assert.equal(host.readFile(SAVE), '{"counts":{"__proto__":1},"ticks":0}');
  host.evalInVm("globalThis.marker = 1");

  const restart = host.restartVm();
  assert.equal(restart.close.called, true);
  assert.equal(restart.close.settled, true);
  assert.ok(restart.close.ms < 250);
  assert.equal(restart.generation, 1);

  // close's final write landed and survived the restart
  const writes = host.callsTo("writeTextFile");
  assert.equal(writes.length, 2);
  assert.equal(writes[1].phase, "task");
  assert.equal(host.readFile(SAVE), '{"counts":{"__proto__":1},"ticks":0,"closed":true}');

  // fresh VM: globalThis is empty, init ran again and reads the file back
  assert.equal(host.evalInVm("typeof globalThis.marker"), "undefined");
  const fresh = live(host);
  assert.equal(fresh.inits, 1);
  assert.deepEqual(fresh.counts, {});
  host.advance(0);
  assert.equal(live(host).loaded, '{"counts":{"__proto__":1},"ticks":0,"closed":true}');
  assert.equal(host.evalInVm("Object.isFrozen(Object.prototype) && typeof eval"), "undefined");
  assert.match(host.render().tree.children[0].children[0].text, /build 1/);
});

test("close gets only 250 ms; a close that never finishes does not block the restart", async (t) => {
  const dir = tempMod({
    "main.js": `import { View, div } from "gpui-kit";
export default class M extends View {
  render() { return div().id("m"); }
  close() { const end = performance.now() + 2000; while (performance.now() < end) {} }
}`,
  });
  const host = await createHost({ modRoot: dir });
  t.after(() => host.dispose());
  await host.load();
  const { close } = host.restartVm();
  assert.equal(close.interrupted, true);
  assert.ok(close.ms >= 250 && close.ms < 1000, `${close.ms} ms`);
  assert.equal(host.render().tree.id, "m");
});

test("files given in the scenario are on the mock disk; writes from outside reach the mod", async (t) => {
  const host = await loaded({ scenario: { files: { [SAVE]: '{"counts":{},"ticks":7}' } } });
  t.after(() => host.dispose());
  host.advance(0);
  assert.equal(live(host).loaded, '{"counts":{},"ticks":7}');
  host.writeFile(SAVE, "changed");
  assert.equal(host.readFile(SAVE), "changed");
  host.evalInVm(`${SLOT}.saved = '{"counts":{},"ticks":7}'`);
  host.render();
  host.fire("save", "on_click");
  host.advance(0);
  const [write] = host.callsTo("writeTextFile");
  assert.equal(write.error, "`herdr.writeTextFile`: The file changed outside Herdr. Reload before saving; your draft is still here.");
  assert.equal(host.readFile(SAVE), "changed");
});

// Review fix: watch.rs reload -> instantiate_for_view enters ONE Event scope for
// the constructor and init, so a reload gives both one shared 500 ms budget,
// while a first load (instantiate_view_with_policy) gives them a scope each.
test("a reload's constructor and init share one 500 ms budget; a first load gives each its own", async (t) => {
  const dir = tempMod({
    "main.js": `import { View, div } from "gpui-kit";
const spin = (ms) => { const end = performance.now() + ms; while (performance.now() < end) {} };
export default class M extends View {
  constructor() { super(); spin(300); }
  init() { spin(300); }
  render() { return div().id("m"); }
}`,
  });
  const host = await createHost({ modRoot: dir });
  t.after(() => host.dispose());
  const { ms } = await host.load();
  assert.ok(ms.constructor >= 300 && ms.init >= 300 && ms.constructor < 500 && ms.init < 500);
  await assert.rejects(host.reload(), (e) => e instanceof BudgetError && e.budget === 500 && /constructor \+ init/.test(e.phase));
  // the running generation keeps going
  assert.equal(host.render().tree.id, "m");
});

// Review fix: engine/quickjs/mod.rs element_id refuses anything but an element,
// an Entity or a string as render()'s result; the harness used to ship any value.
test("render() must return a live element, an Entity or a string", async (t) => {
  const make = async (body, extra = "") => {
    const host = await createHost({
      modRoot: tempMod({ "main.js": `import { View, div } from "gpui-kit";\n${extra}\nexport default class M extends View { render() { ${body} } }\n` }),
    });
    t.after(() => host.dispose());
    await host.load();
    return host;
  };
  for (const value of ["42", "undefined", "({ a: 1 })", "[div()]"]) {
    const host = await make(`return ${value};`);
    throwsVm(() => host.render(), TypeError, "render(cx) must return an element, an Entity, or a string");
  }
  assert.deepEqual((await make('return "hello";')).render().tree, { kind: "text", text: "hello" });
  // An element kept from an earlier render pass is expired.
  const kept = await make("this.el ??= div().id('m'); return this.el;");
  kept.render();
  throwsVm(() => kept.render(), TypeError,
    "this element belongs to a previous render pass; elements are single-use values and must be rebuilt each time render runs");
});

// Review r2-25: an interrupt unwinds the script stack without running its
// finally blocks, so the mock's item-renderer guard stayed raised and every
// later render refused its own handlers as if they came from a list row.
test("a layout interrupted inside a virtual list's row renderer leaves the VM usable", async (t) => {
  const host = await createHost({
    modRoot: tempMod({
      "main.js": `import { View, div } from "gpui-kit";
import { v_virtual_list } from "gpui-base";
const S = (globalThis.__r225 ??= { spin: true });
export default class M extends View {
  render() {
    return div().id("root").on_size_change(() => {}).child(
      v_virtual_list("rows", 1000, 20, (i) => "k" + i, (range) => {
        if (S.spin) for (;;) {}
        const out = [];
        for (let i = range.start; i < range.end; i++) out.push(div().child("row " + i));
        return out;
      }).h(200),
    );
  }
}
`,
    }),
  });
  t.after(() => host.dispose());
  await host.load();
  assert.throws(() => host.render(), (e) => e instanceof BudgetError && e.phase === "layout" && e.interrupted);
  host.evalInVm("globalThis.__r225.spin = false");
  const { tree, ms, layoutMs } = host.render();
  assert.ok(ms < BUDGETS.render && layoutMs < BUDGETS.layout);
  assert.deepEqual(Object.keys(tree.handlers), ["on_size_change"]);
  host.fire("root", "on_size_change", { width: 320, height: 784 });
  assert.deepEqual(host.errors, []);
});

// Review r2-25: layout used to render up to 500 rows of every lazy list, so
// its time said nothing about the shell's, which asks only for the rows in view.
test("layout renders only a virtual list's visible rows (base visible_range at offset 0)", async (t) => {
  const host = await createHost({
    modRoot: tempMod({
      "main.js": `import { View, div } from "gpui-kit";
import { v_virtual_list } from "gpui-base";
const list = (id, n, h) => v_virtual_list(id, n, 28, (i) => id + i, (range) => {
  (globalThis.__ranges ??= []).push([id, range.start, range.end]);
  const out = [];
  for (let i = range.start; i < range.end; i++) out.push(div().child(String(i)));
  return out;
});
export default class M extends View {
  render() {
    return div().id("root").child(list("a", 7300).h(280)).child(list("b", 5).h(280)).child(list("c", 7300));
  }
}
`,
    }),
  });
  t.after(() => host.dispose());
  await host.load();
  const { tree } = host.render();
  // ten 28 px rows fill 280 px; base draws the one crossing the edge and one of overdraw
  assert.deepEqual(JSON.parse(host.evalInVm("JSON.stringify(globalThis.__ranges)")), [["a", 0, 12], ["b", 0, 5], ["c", 0, 34]]);
  assert.equal(tree.children[0].children.length, 12);
  assert.deepEqual(tree.children[0].keys, Array.from({ length: 12 }, (_, i) => `a${i}`));
  assert.equal(tree.children[1].children.length, 5);
  // no extent of its own: the window's 900 px (32 rows end inside, + 2)
  assert.equal(tree.children[2].children.length, 34);
});

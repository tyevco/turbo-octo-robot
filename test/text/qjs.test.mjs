// engine/text.js and engine/format.js inside QuickJS-ng (tools/qjs/harness.mjs):
// herdr's runtime has no Intl, frozen prototypes, and its own Unicode tables
// behind /\p{...}/u. The same corpus, fuzz and format table run in the VM and
// must give exactly what Node gives; a scan of every code point compares the
// VM's clusters with Node's.
// Run: node --test test/text/
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createHost } from "../../tools/qjs/harness.mjs";
import * as text from "../../mods/creaseworks/engine/text.js";
import * as format from "../../mods/creaseworks/engine/format.js";
import { CORPUS, checkFormat, checkText, fuzzString, rng } from "./corpus.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const engine = join(repo, "mods", "creaseworks", "engine");

// quickjs-emscripten cannot load in a frozen Node realm (npm run test:frozen):
// skip there; the VM applies herdr's own freeze anyway.
const FROZEN = Object.isFrozen(Object.prototype);
const vmTest = (name, fn) => test(name, { skip: FROZEN && "quickjs-emscripten does not load with frozen prototypes" }, fn);

let dir;
let host;
let seq = 0;

/** Evaluates a module inside the mod root (so "./engine/text.js" resolves) and returns its `out` export. */
function inVm(body) {
  const name = `${host.root}/probe-${++seq}.js?v=${host.generation}`;
  const ns = host.evalInVm(
    `import * as text from "./engine/text.js";\nimport * as format from "./engine/format.js";\nimport * as corpus from "./corpus.js";\n${body}`,
    { module: true, name },
  );
  return ns.out;
}

before(async () => {
  if (FROZEN) return;
  dir = mkdtempSync(join(tmpdir(), "cw-text-"));
  mkdirSync(join(dir, "engine"));
  copyFileSync(join(engine, "text.js"), join(dir, "engine", "text.js"));
  copyFileSync(join(engine, "format.js"), join(dir, "engine", "format.js"));
  copyFileSync(join(repo, "test", "text", "corpus.js"), join(dir, "corpus.js"));
  writeFileSync(
    join(dir, "main.js"),
    `import { View, div } from "gpui-kit";\nimport { clip, graphemes } from "./engine/text.js";\nimport { formatCount } from "./engine/format.js";\n` +
      `export default class M extends View { render() { return div().id("m").child(clip("👨\u200d👩\u200d👧\u200d👦 " + formatCount(12480), 4)); } }\n`,
  );
  host = await createHost({ modRoot: dir, scenario: {} });
  await host.load();
});

after(() => {
  host?.dispose();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

vmTest("the modules load under the sandbox (frozen prototypes, no Intl) and render", () => {
  const { tree } = host.render();
  assert.deepEqual(tree.children, [{ kind: "text", text: "👨\u200d👩\u200d👧\u200d👦 1\u2026" }]);
  assert.equal(inVm(`export const out = typeof Intl;`), "undefined");
  for (const p of host.phases) assert.ok(p.ms <= p.budget, `${p.label}: ${p.ms} ms`);
});

vmTest("unicode property escapes used by text.js work in quickjs-ng", () => {
  const out = inVm(`export const out = [
    /\\p{M}/u.test("\\u0301"), /\\p{M}/u.test("\\u20e3"), /\\p{M}/u.test("\\ufe0f"), /\\p{M}/u.test("a"),
    /\\p{Mc}/u.test("\\u093e"), /\\p{Mc}/u.test("\\u0301"),
    /\\p{Cf}/u.test("\\u200b"), /\\p{Cf}/u.test("a"),
    /\\p{Extended_Pictographic}/u.test("\\u{1F600}"), /\\p{Extended_Pictographic}/u.test("\\u00a9"), /\\p{Extended_Pictographic}/u.test("a"),
    /^\\s+$/u.test("\\u3000\\u00a0"),
  ];`);
  assert.deepEqual(out, [true, true, true, false, true, false, true, false, true, true, false, true]);
});

vmTest("the corpus splits the same in the VM as in Node", () => {
  const vm = inVm(`export const out = corpus.CORPUS.map(([name, s, want]) => [name, text.graphemes(s), text.graphemeCount(s)]);`);
  assert.equal(vm.length, CORPUS.length);
  for (let i = 0; i < CORPUS.length; i++) {
    const [name, , want] = CORPUS[i];
    assert.deepEqual(vm[i], [name, want, want.length], name);
  }
});

vmTest("fuzz in the VM: same clusters, clips and titles as Node; every clip property holds", () => {
  const count = 2500;
  const vm = inVm(`
    const next = corpus.rng(4242);
    const rows = [];
    const problems = [];
    for (let i = 0; i < ${count}; i++) {
      const s = corpus.fuzzString(next);
      const max = 1 + Math.floor(next() * 10);
      rows.push([text.graphemes(s), text.clip(s, max), text.clip(s, max, "..."), text.cleanTitle(s)]);
      for (const p of corpus.checkText(text, s, max)) problems.push(i + ": " + p);
    }
    export const out = { rows, problems };`);
  assert.deepEqual(vm.problems, []);
  const next = rng(4242);
  for (let i = 0; i < count; i++) {
    const s = fuzzString(next);
    const max = 1 + Math.floor(next() * 10);
    assert.deepEqual(checkText(text, s, max), []);
    assert.deepEqual(vm.rows[i], [text.graphemes(s), text.clip(s, max), text.clip(s, max, "..."), text.cleanTitle(s)], `row ${i}`);
  }
});

vmTest("the format table passes in the VM, and the VM prints what Node prints", () => {
  assert.deepEqual(inVm(`export const out = corpus.checkFormat(format);`), []);
  assert.deepEqual(checkFormat(format), []);
  const values = [];
  const next = rng(5);
  for (let e = -3; e <= 308; e++) for (let k = 0; k < 6; k++) {
    const v = Number(((1 + next() * 9) * Math.pow(10, e)).toPrecision(12));
    if (Number.isFinite(v)) values.push(v);
  }
  const vm = inVm(`
    const values = ${JSON.stringify(values)};
    export const out = values.map((v) => [format.formatCount(v), format.formatCount(-v, "sci"), format.formatRate(v),
      format.formatRate(v, "short", { compact: true }), format.formatDuration(v), format.formatEta(v, "spaced")]);`);
  const node = values.map((v) => [format.formatCount(v), format.formatCount(-v, "sci"), format.formatRate(v),
    format.formatRate(v, "short", { compact: true }), format.formatDuration(v), format.formatEta(v, "spaced")]);
  assert.deepEqual(vm, node);
});

vmTest("every code point, in five contexts, clusters the same in quickjs-ng as in Node", () => {
  // Signature per code point: the cluster count in each context, as one digit.
  const signature = (from, to, graphemes) => {
    let out = "";
    for (let cp = from; cp < to; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const c = String.fromCodePoint(cp);
      out +=
        graphemes("a" + c + "b").length + "" + graphemes(c + "́").length + graphemes("ᄀ" + c).length +
        graphemes("क्" + c).length + graphemes("😀\u200d" + c).length + graphemes(c + "a").length;
    }
    return out;
  };
  const ranges = [];
  for (let from = 0; from < 0x40000; from += 0x4000) ranges.push([from, from + 0x4000]);
  ranges.push([0xe0000, 0xe1000]);
  const differ = [];
  for (const [from, to] of ranges) {
    const vm = inVm(`
      const signature = ${signature.toString()};
      export const out = signature(${from}, ${to}, text.graphemes);`);
    const node = signature(from, to, text.graphemes);
    if (vm === node) continue;
    let i = 0;
    for (let cp = from; cp < to; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      if (vm.slice(i, i + 6) !== node.slice(i, i + 6)) differ.push(cp.toString(16));
      i += 6;
    }
  }
  assert.deepEqual(differ.slice(0, 40), [], `${differ.length} code points differ`);
});

// The Node loader (tools/node): bare built-in names map to mocks that expose
// no more than herdr's modules, and the opt-in frozen realm matches the sandbox.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { REAL_EXPORTS } from "../../tools/mock/gpui-kit.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function tempModule(source) {
  const dir = mkdtempSync(join(tmpdir(), "node-hooks-"));
  const file = join(dir, "m.mjs");
  writeFileSync(file, source);
  return pathToFileURL(file).href;
}

test('bare "gpui-kit" and "gpui" expose exactly the real exports; mock helpers do not link', async () => {
  for (const name of ["gpui-kit", "gpui"]) {
    const ns = await import(tempModule(`export * from "${name}";`));
    assert.deepEqual(Object.keys(ns).sort(), [...REAL_EXPORTS].sort(), name);
    await assert.rejects(import(tempModule(`import { serialize } from "${name}"; export { serialize };`)), SyntaxError);
  }
  // Tooling still reaches the helpers by path, and it is the same module instance.
  const kit = await import("../../tools/mock/gpui-kit.js");
  const pub = await import(tempModule('export { div } from "gpui-kit";'));
  assert.equal(pub.div, kit.div);
});

test("frozen.mjs freezes herdr's five prototypes for a Node run", () => {
  const script = tempModule(`
    import { setShared, shared } from "herdr";
    import { createController } from ${JSON.stringify(pathToFileURL(join(repo, "tools/mock/controller.js")).href)};
    const out = [];
    for (const p of [Object.prototype, Array.prototype, Function.prototype, String.prototype, Number.prototype]) out.push(Object.isFrozen(p));
    try { const o = {}; o.toString = () => "x"; out.push("assigned"); } catch (e) { out.push(e.constructor.name); }
    try { Object.assign({}, JSON.parse('{"constructor": 1}')); out.push("assigned"); } catch (e) { out.push(e.constructor.name); }
    createController({});
    setShared("k", { constructor: 1 });
    try { shared("k"); out.push("converted"); } catch (e) { out.push(e.message); }
    console.log(JSON.stringify(out));
  `);
  const stdout = execFileSync(process.execPath, [
    "--import", pathToFileURL(join(repo, "tools/node/frozen.mjs")).href,
    "--import", pathToFileURL(join(repo, "tools/node/register.mjs")).href,
    fileURLToPath(script),
  ], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(stdout.trim()), [true, true, true, true, true, "TypeError", "TypeError", "'constructor' is read-only"]);
});

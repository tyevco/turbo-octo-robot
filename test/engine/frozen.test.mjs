// The engine under herdr's frozen prototypes (ARCHITECTURE A2 rule 3): a
// scenario with prototype-named addresses and writers, run in a child process
// started with tools/node/frozen.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");

test("engine scenario runs under frozen prototypes", () => {
  const stdout = execFileSync(process.execPath, [
    "--import", pathToFileURL(join(repo, "tools/node/frozen.mjs")).href,
    join(here, "_frozen-scenario.mjs"),
  ], { encoding: "utf8" });
  const out = JSON.parse(stdout.trim().split("\n").at(-1));
  assert.equal(out.frozen, true);
  assert.equal(out.helpers, 7);
  assert.equal(out.album, 7);
  assert.deepEqual(out.units, { created: 7, opened: 7, converted: 0 });
  assert.deepEqual(out.applied, ["__proto__", "constructor", "toString"]);
  assert.equal(out.ok, true);
  assert.equal(out.nullProto, true);
  assert.equal(out.away, true);
});

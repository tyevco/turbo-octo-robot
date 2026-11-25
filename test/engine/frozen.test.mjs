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
  // 7 first finishes, 7 after 20 h in the Album (a full budget again), and 7
  // a minute after leaving and coming back: 5/64 each from the kept budget (r4-10)
  assert.deepEqual(out.units, { created: 14 + 35 / 64, opened: 7, converted: 0 });
  assert.deepEqual(out.applied, ["__proto__", "constructor", "toString", "valueOf"]);
  // r4-06: 4 h of stale credit already paid by "valueOf": the away segment pays
  // the rest of the 8 h allowance (4 h + 60 s), not the whole cap again
  assert.ok(Math.abs(out.staleShare - (4 * 3600 + 60) / (8 * 3600)) < 1e-9, String(out.staleShare));
  assert.equal(out.ok, true);
  assert.equal(out.nullProto, true);
  assert.equal(out.away, true);
});

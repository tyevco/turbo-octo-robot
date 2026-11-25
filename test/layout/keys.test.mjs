// keys.json (DESIGN §2.6), checked against herdr-app 0.1.18 src/keys.rs
// (sections, valid_action, gone_mod, the escape hatch), gpui's chord parser,
// and every default keys file herdr has shipped. One bad entry disables the
// person's whole keys.json (src/keys.rs parse), so all of it is checked.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  sectionError, validAction, goneMod, parseKeystroke, parseChord, chordId, actionName, ESCAPE_HATCH,
} from "../../tools/layout/schema.mjs";
import { find } from "../../tools/mock/commands.js";
import { at, readJson, GAME, REF, HERDR_SRC, HAVE_HERDR, isDir, designJsonBlocks } from "./_util.mjs";

const KEYS_PATH = at("keys.json");
const KEYS = readJson(KEYS_PATH);
const SECTION = `layout:${GAME.layout}`;
const modDirExists = (m) => isDir(at("mods", m));
const bindings = () => Object.entries(KEYS[SECTION] ?? {});

/** Every chord herdr binds by default, in any section, in any shipped version. */
function defaultChords() {
  const out = new Map();
  for (const [file, sections] of Object.entries(REF.keys)) {
    for (const [section, keys] of Object.entries(sections)) {
      for (const k of Object.keys(keys)) out.set(chordId(k), `${file} ${section} ${k}`);
    }
  }
  return out;
}

/** A mirror of src/keys.rs `parse`: the problems herdr would report for this file. */
function keysProblems(sections) {
  const problems = [];
  for (const [section, keys] of Object.entries(sections)) {
    const err = sectionError(section);
    if (err) { problems.push(err); continue; }
    if (keys === null || typeof keys !== "object" || Array.isArray(keys)) { problems.push(`${section}: not an object`); continue; }
    for (const [k, action] of Object.entries(keys)) {
      if (typeof action === "string") {
        if (goneMod(action, find, modDirExists)) continue;
        if (!validAction(action, find)) { problems.push(`${section}.${k}: unknown action ${JSON.stringify(action)}`); continue; }
      } else if (action === null || typeof action !== "object" || Array.isArray(action)) {
        problems.push(`${section}.${k}: an action is a string or an object`);
        continue;
      }
      if (k === ESCAPE_HATCH) { problems.push(`${ESCAPE_HATCH} is reserved for resetting Herdr`); continue; }
      try { parseChord(k); } catch (e) { problems.push(`${section}.${k}: ${e.message}`); }
    }
  }
  return problems;
}

describe("chord parser (gpui Keystroke::parse)", () => {
  test("parses modifiers and keys like gpui", () => {
    assert.deepEqual(parseKeystroke("ctrl-shift-g"), { modifiers: { control: true, alt: false, shift: true, platform: false, function: false }, key: "g" });
    assert.deepEqual(parseKeystroke("ctrl--").key, "-");
    assert.deepEqual(parseKeystroke("cmd-G"), { modifiers: { control: false, alt: false, shift: true, platform: true, function: false }, key: "g" });
    assert.equal(parseKeystroke("shift").key, "shift");
    assert.equal(chordId("Ctrl-Shift-G"), chordId("shift-ctrl-g"));
    assert.equal(chordId("ctrl-G"), "ctrl-shift-g");
    assert.throws(() => parseKeystroke("ctrl-foo-g"));
    assert.equal(parseKeystroke("").key, ""); // gpui accepts an empty key...
    assert.throws(() => parseChord("   ")); // ...this check does not
    assert.throws(() => parseChord("ctrl-shift-"));
  });

  test("every shipped default keys file passes the keys.rs mirror", () => {
    for (const [file, sections] of Object.entries(REF.keys)) {
      // Older files may name commands renamed since; current() maps those, find() does not.
      if (!file.startsWith("defaults/")) continue;
      assert.deepEqual(keysProblems(sections), [], file);
    }
  });

  test("the keys.rs mirror catches what herdr rejects", () => {
    assert.match(keysProblems({ layouts: {} }).join(), /unknown section/);
    assert.match(keysProblems({ "layout:": {} }).join(), /unknown section/);
    assert.match(keysProblems({ global: { "ctrl-shift-g": "nothing" } }).join(), /unknown action/);
    assert.match(keysProblems({ global: { "ctrl-shift-g": `${GAME.mod}:fold` } }).join(), /unknown action/);
    assert.match(keysProblems({ global: { "ctrl-foo-g": `${GAME.mod}.fold` } }).join(), /invalid keystroke/);
    assert.match(keysProblems({ global: { [ESCAPE_HATCH]: `${GAME.mod}.fold` } }).join(), /reserved/);
    assert.deepEqual(keysProblems({ global: { "ctrl-shift-g": "no-such-mod-folder.fold" } }), []); // gone_mod: dropped quietly
  });
});

describe("keys.json", () => {
  test("is valid JSON and exactly DESIGN §2.6's", () => {
    assert.doesNotThrow(() => JSON.parse(readFileSync(KEYS_PATH, "utf8")));
    const [design] = designJsonBlocks("### 2.6 Keys");
    assert.deepEqual(KEYS, design);
  });

  test(`has only the ${SECTION} section`, () => {
    assert.deepEqual(Object.keys(KEYS), [SECTION]);
    assert.equal(sectionError(SECTION), null);
    assert.ok(bindings().length > 0);
  });

  test("herdr would load it with no problems", () => {
    assert.deepEqual(keysProblems(KEYS), []);
  });

  test("every action is a string <mod>.<command> for this repo's mod, and is not dropped", () => {
    assert.ok(isDir(at("mods", GAME.mod)), `mods/${GAME.mod} is missing`);
    for (const [k, action] of bindings()) {
      assert.equal(typeof action, "string", `${k}: string actions only (objects show as raw JSON in Keys)`);
      assert.ok(validAction(action, find), `${k}: ${action}`);
      assert.ok(!action.includes(":"), `${k}: no argument`);
      assert.equal(find(actionName(action)), null, `${k}: ${action} is an app command`);
      assert.match(action, new RegExp(`^${GAME.mod}\\.[a-z][a-z0-9_-]*$`), k);
      assert.ok(!goneMod(action, find, modDirExists), `${k}: ${action} would be dropped (no mods/${GAME.mod})`);
    }
  });

  test("every command has a palette entry in mod.json", () => {
    const meta = readJson(at("mods", GAME.mod, "mod.json"));
    const palette = new Set((meta.palette ?? []).map((p) => p.command));
    for (const [k, action] of bindings()) assert.ok(palette.has(action), `${k}: ${action}`);
  });

  test("chords parse, one keystroke each, none reserved or repeated", () => {
    const seen = new Set();
    for (const [k] of bindings()) {
      const strokes = parseChord(k);
      assert.equal(strokes.length, 1, `${k}: a single keystroke`);
      assert.notEqual(chordId(k), chordId(ESCAPE_HATCH));
      assert.ok(!seen.has(chordId(k)), `${k} bound twice`);
      seen.add(chordId(k));
    }
  });

  test("no chord is a herdr default (keys.json, keys.macos.json, any shipped version, any section)", () => {
    const taken = defaultChords();
    assert.ok(taken.size > 50);
    for (const [k] of bindings()) assert.ok(!taken.has(chordId(k)), `${k} is taken by ${taken.get(chordId(k))}`);
  });

  test("no plain ctrl+letter or alt+letter (programs and readline own them), no ctrl-shift-u (IBus)", () => {
    for (const [k] of bindings()) {
      const [{ modifiers: m, key }] = parseChord(k);
      const letter = /^[a-z]$/.test(key);
      const onlyCtrlAlt = !m.shift && !m.platform && !m.function && (m.control || m.alt);
      assert.ok(!(letter && onlyCtrlAlt), `${k}: plain ctrl/alt + letter`);
      assert.notEqual(chordId(k), "ctrl-shift-u", k);
    }
  });

  test("defaults copy agrees with herdr's own (when its source is present)", { skip: !HAVE_HERDR && "herdr source not present" }, () => {
    assert.deepEqual(REF.keys["defaults/keys.json"], readJson(resolve(HERDR_SRC, "defaults/keys.json")));
    assert.deepEqual(REF.keys["defaults/keys.macos.json"], readJson(resolve(HERDR_SRC, "defaults/keys.macos.json")));
  });
});

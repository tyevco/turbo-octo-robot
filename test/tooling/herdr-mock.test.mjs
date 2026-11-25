// The mock herdr host (tools/mock/controller.js + herdr.js) against herdr-app 0.1.18.
// Run with the loader: node --import ./tools/node/register.mjs --test test/
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import * as herdr from "herdr";
import {
  createController, HERDR_FUNCTIONS, MESSAGES, notifyPhaseMessage, outsideHostCallMessage, utf8Length,
} from "../../tools/mock/controller.js";
import { COMMANDS, find, validateArgs } from "../../tools/mock/commands.js";
import { THEME_NAMES, resolveNamed, mix } from "../../tools/mock/theme-resolve.js";

const themesJson = JSON.parse(readFileSync(new URL("../../tools/mock/themes.json", import.meta.url), "utf8"));

// Every `export function` in defaults/herdr.d.ts (0.1.18), in file order.
const DTS_FUNCTIONS = [
  "exec", "hc", "home", "appHome", "checking", "readTextFile", "writeTextFile", "knownAgents", "pickFolder",
  "pickFiles", "playSound", "run", "machines", "spaces", "agents", "panes", "setAgentOrder", "terminals",
  "focused", "layout", "layouts", "commands", "window", "setWindowTitle", "setBadge", "placement", "theme",
  "themes", "fonts", "updates", "presentUpdateNotes", "telemetry", "feedbackPreview", "feedbackPasteImage",
  "feedbackPickImages", "feedbackAttachImages", "feedbackClearImages", "sendFeedback", "settings", "keys",
  "openOverlay", "closeOverlay", "notify", "props", "shared", "setShared", "nextCommand", "watchFolder",
];

const VIEW = { name: "view" };
let ctl = null;
const make = (scenario = {}) => {
  ctl = createController({ appHome: "/home/p/.config/herdr-app", home: "/home/p", ...scenario });
  return ctl;
};
afterEach(() => {
  ctl?.dispose();
  ctl = null;
});
/** Runs fn inside an event scope (host async calls need a live host call). */
const inEvent = (fn) => ctl.within("event", VIEW, fn);
const settledFlag = (p) => {
  const s = { done: false, value: undefined, error: undefined };
  p.then((v) => { s.done = true; s.value = v; }, (e) => { s.done = true; s.error = e; });
  return s;
};
const tick = () => new Promise((r) => setImmediate(r));

describe("module surface", () => {
  test("herdr.js exports every herdr.d.ts function under the same name", () => {
    assert.deepEqual([...Object.keys(herdr)].sort(), [...DTS_FUNCTIONS].sort());
    assert.deepEqual([...HERDR_FUNCTIONS].sort(), [...DTS_FUNCTIONS].sort());
    const dts = "/tmp/claude-0/-home-user-turbo-octo-robot/765765b0-bd4e-5d4c-890a-1f1834a9bff2/scratchpad/herdr-src/defaults/herdr.d.ts";
    if (existsSync(dts)) {
      const names = [...readFileSync(dts, "utf8").matchAll(/^export function (\w+)/gm)].map((m) => m[1]);
      assert.deepEqual(names, DTS_FUNCTIONS);
    }
    for (const n of DTS_FUNCTIONS) assert.equal(typeof herdr[n], "function", n);
  });

  test("unimplemented functions throw 'mock: not implemented'", () => {
    make();
    for (const n of ["exec", "hc", "knownAgents", "pickFolder", "pickFiles", "watchFolder", "sendFeedback", "presentUpdateNotes"]) {
      assert.throws(() => inEvent(() => herdr[n]()), /mock: not implemented/, n);
    }
  });

  test("without a controller the module says so", () => {
    assert.throws(() => herdr.agents(), /no controller/);
  });

  test("scenario reads: home, appHome, checking, props, layouts, machines", () => {
    make({ props: { tab: "x", n: 1 }, layouts: ["main", "Game"] });
    assert.equal(herdr.home(), "/home/p");
    assert.equal(herdr.appHome(), "/home/p/.config/herdr-app");
    assert.equal(herdr.checking(), false);
    assert.deepEqual(herdr.props(), { tab: "x", n: 1 });
    const p = herdr.props();
    p.n = 2;
    assert.equal(herdr.props().n, 1, "props() returns a fresh copy");
    assert.deepEqual(herdr.layouts(), ["main", "Game"]);
    assert.deepEqual(herdr.machines(), [{ name: null, layout: "ready" }]);
    assert.equal(herdr.placement(), null);
    assert.equal(ctl.counts.props, 3);
  });
});

describe("live data", () => {
  const agents = [
    { address: "t1", pane: "p1", space: "s1", space_name: "game", tab: "c1", tab_index: 1, tab_name: "one", status: "working", focused: true },
    { address: "t2", pane: "p2", space: "s1", space_name: "game", tab: "c1", tab_index: 1, tab_name: "one", status: "blocked" },
    { address: "t3", pane: "p3", space: "s2", space_name: "other", tab: "c2", tab_index: 1, tab_name: "1", status: "done" },
  ];

  test("agents() has every AgentInfo field in d.ts order", () => {
    make({ agents });
    const a = herdr.agents();
    assert.equal(a.length, 3);
    assert.deepEqual(Object.keys(a[0]), ["address", "pane", "space", "space_name", "tab", "tab_index", "tab_name", "status", "app", "program", "title", "pane_name", "seq", "pinned", "focused"]);
    assert.deepEqual(Object.keys(a[0].program), ["key", "name", "icon", "tint", "tile", "color", "shell", "agent"]);
  });

  test("spaces(), panes() and focused() derive from agents with rollups", () => {
    make({ agents });
    const s = herdr.spaces();
    assert.equal(s.length, 2);
    assert.equal(s[0].status, "blocked");
    assert.equal(s[0].active, true);
    assert.equal(s[0].tabs[0].panes, 2);
    assert.equal(s[1].status, "done");
    const p = herdr.panes();
    assert.equal(p.length, 3);
    assert.equal(p[0].terminal, "t1");
    assert.equal(p[0].movable, true);
    assert.equal(p[2].movable, false);
    assert.deepEqual(herdr.focused(), { space: "s1", tab: "c1", pane: "p1", terminal: "t1", shown: null, agent: null, cwd: null, selection: null });
  });

  test("terminals() keeps the raw word, report, turn and parent; setTerminals bumps a revision", () => {
    make({ terminals: [{ address: "t9", status: "error", parent: "t1", turn: 4, labels: { "herdr.seen": "3" } }] });
    const [t] = herdr.terminals();
    assert.equal(t.state, "live");
    assert.equal(t.status, "error");
    assert.deepEqual(t.report, { state: "error" });
    assert.equal(t.parent, "t1");
    assert.equal(t.turn, 4);
    assert.equal(t.selection, null);
    const r = ctl.revision("terminals");
    ctl.setTerminals([{ address: "t9", status: "error", parent: "t1", turn: 4, labels: { "herdr.seen": "3" } }]);
    assert.equal(ctl.revision("terminals"), r, "unchanged list does not bump");
    ctl.setTerminals([{ address: "t9", status: "idle", parent: "t1", turn: 5 }]);
    assert.equal(ctl.revision("terminals"), r + 1);
    assert.equal(herdr.terminals()[0].turn, 5);
  });

  test("setAgents updates agents and derived data", () => {
    make({ agents });
    ctl.setAgents([]);
    assert.deepEqual(herdr.agents(), []);
    assert.equal(herdr.focused(), null);
    assert.ok(ctl.revision("agents") > 0);
  });

  test("window(): live state, null while checking", () => {
    make({ window: { visible: false, active: false, platform: "macos" } });
    assert.deepEqual(herdr.window(), { platform: "macos", titlebar: "system", buttons: false, maximized: false, fullscreen: false, active: false, visible: false });
    ctl.setWindow({ visible: true });
    assert.equal(herdr.window().visible, true);
    make({ checking: true });
    assert.equal(herdr.checking(), true);
    assert.equal(herdr.window(), null);
  });
});

describe("theme and settings", () => {
  test("themes.json is exactly what settings.rs resolve() computes", () => {
    for (const name of THEME_NAMES) assert.deepEqual(themesJson[name], resolveNamed(name), name);
    assert.ok(themesJson.graphite && themesJson.paper);
  });

  test("graphite and paper: derived colours, 8-digit chrome tints, BTreeMap key order", () => {
    const g = themesJson.graphite;
    assert.equal(g.background, "#17191d");
    assert.equal(g.hover, "#ffffff0e");
    assert.equal(g.selected, "#ffffff17");
    assert.equal(g.border, "#ffffff18");
    assert.equal(g.input, "#ffffff24");
    assert.equal(g.canvas, "#131518"); // mix(bg, 0, 0.16)
    assert.equal(g.chrome, "#101114"); // mix(bg, 0, 0.32)
    assert.equal(g.working, "#e5c07b");
    const p = themesJson.paper;
    assert.equal(p.hover, "#0000000c");
    assert.equal(p.selected, "#00000012");
    assert.equal(p.border, "#00000017");
    assert.equal(p.input, "#00000026");
    assert.equal(p.foreground, "#1b1b1e");
    // f32 arithmetic: 255*(1-0.66) + 30*0.66 is 106.5 in f32 (106.4999… in f64) -> 107.
    assert.equal(p.muted, "#69696b");
    assert.equal(mix(0xffffff, 0x1b1b1e, 0.66), 0x69696b);
    const keys = Object.keys(g);
    assert.deepEqual(keys, [...keys].sort());
    assert.equal(keys.length, 26 + 16);
  });

  test("theme() serves themes.json, plus colour overrides", () => {
    make({ theme: "graphite" });
    assert.deepEqual(herdr.theme(), themesJson.graphite);
    make({ theme: "paper", colors: { accent: "#ff0000" } });
    assert.deepEqual(herdr.theme(), { ...themesJson.paper, accent: "#ff0000" });
    const t = herdr.theme();
    t.accent = "#000000";
    assert.equal(herdr.theme().accent, "#ff0000", "theme() returns a fresh object");
  });

  test("settings(): dark, zoom, sounds, theme pair", () => {
    make({ theme: "paper", zoom: 1.25, sounds: { enabled: false } });
    const s = herdr.settings();
    assert.equal(s.dark, false);
    assert.equal(s.zoom, 1.25);
    assert.deepEqual(s.sounds, { enabled: false });
    assert.equal(s.theme, "paper");
    assert.equal(s.theme_light, "paper");
    assert.equal(s.theme_dark, "graphite");
    make();
    assert.equal(herdr.settings().dark, true);
    assert.deepEqual(herdr.settings().sounds, { enabled: true });
  });

  test("themes() lists presets then shipped files with light flags", () => {
    make();
    const list = herdr.themes();
    assert.deepEqual(list.map((t) => t.name), ["graphite", "ink", "moss", "paper", "atom-one-dark", "win98"]);
    assert.deepEqual(list.map((t) => t.light), [false, false, false, true, false, true]);
    assert.deepEqual(list[3].colors, themesJson.paper);
  });
});

describe("run()", () => {
  test("the table is commands.rs: 78 commands with required flags", () => {
    assert.equal(COMMANDS.length, 78);
    assert.deepEqual(find("pane.focus").args, [{ name: "pane", required: false }, { name: "terminal", required: false }]);
    assert.deepEqual(find("agent.focus").args, [{ name: "terminal", required: true }]);
    assert.equal(validateArgs(find("space.close"), { space: "X", confirmed: true }), "space.close: unknown argument(s): space; valid arguments: id, confirmed");
    make();
    assert.deepEqual(herdr.commands()[0].name, "space.new");
  });

  test("validation errors throw synchronously with the host prefix", () => {
    make();
    assert.throws(() => herdr.run("pane.focus", { term: "t1" }), {
      message: "`herdr.run`: pane.focus: unknown argument(s): term; valid arguments: pane, terminal",
    });
    assert.throws(() => herdr.run("agent.focus", { terminal: 7 }), {
      message: "`herdr.run`: agent.focus: argument terminal must be a string (or null to omit it)",
    });
    assert.throws(() => herdr.run("app.help", ["x"]), {
      message: "`herdr.run`: app.help: arguments must be an object; valid arguments: none",
    });
    assert.throws(() => herdr.run(), { message: "`herdr.run`: argument 1 is missing; 0 were passed" });
    assert.throws(() => herdr.run(5), { message: "`herdr.run`: argument 1 must be a string, got a number" });
    assert.equal(ctl.runs.length, 0);
  });

  test("valid calls return null and are logged; null targets are allowed", () => {
    make({ agents: [{ address: "t1", pane: "p1" }] });
    assert.equal(herdr.run("pane.focus", { pane: "p1" }), null);
    assert.equal(herdr.run("tab.close", { id: null }), null);
    assert.equal(herdr.run("app.zoom_in"), null);
    assert.deepEqual(ctl.runs.map((r) => r.name), ["pane.focus", "tab.close", "app.zoom_in"]);
    assert.deepEqual(ctl.runErrors(), []);
  });

  test("window-side failures become toasts, not exceptions", () => {
    make({ mod: "clicker", agents: [{ address: "t1", pane: "p1" }] });
    herdr.run("agent.focus", {});
    herdr.run("agent.focus", { terminal: "t7" });
    herdr.run("pane.focus", { pane: "p9" });
    herdr.run("nosuch.thing");
    assert.deepEqual(ctl.runErrors(), [
      { name: "agent.focus", error: "agent.focus needs terminal" },
      { name: "agent.focus", error: 'no running terminal "t7"' },
      { name: "pane.focus", error: "no such pane" },
      { name: "nosuch.thing", error: 'unknown command "nosuch.thing": see `herdr-app commands`; a mod\'s are <mod>.<command> and need the mod loaded' },
    ]);
    assert.equal(ctl.toasts[0].title, "agent.focus failed");
    assert.equal(ctl.toasts[0].id, "o1");
  });

  test("'<mod>.<cmd>' goes to the mod's nextCommand(), settled on the next flush", async () => {
    make({ mod: "clicker" });
    herdr.run("clicker.buy:3");
    const p = settledFlag(inEvent(() => herdr.nextCommand()));
    await tick();
    assert.equal(p.done, false, "never settles synchronously");
    await ctl.flush();
    assert.equal(p.value, "buy:3");
    herdr.run("other.thing");
    assert.match(ctl.runErrors()[0].error, /unknown command "other.thing"/);
  });

  test("nextCommand waits for a command; a cancelled generation's wait does not consume it", async () => {
    make();
    const old = settledFlag(inEvent(() => herdr.nextCommand()));
    ctl.cancelGeneration(ctl.generation);
    ctl.newGeneration();
    const fresh = settledFlag(inEvent(() => herdr.nextCommand()));
    await ctl.flush();
    assert.equal(fresh.done, false);
    ctl.sendCommand("focus");
    await ctl.flush();
    assert.equal(fresh.value, "focus");
    assert.equal(old.done, false);
    ctl.shutdown();
    const last = settledFlag(inEvent(() => herdr.nextCommand()));
    await ctl.flush();
    assert.equal(last.error.message, "`herdr.nextCommand`: herdr-app is shutting down");
  });
});

describe("notify, overlays, shared, recorded calls", () => {
  test("notify returns o<N> and is logged; overlays share the sequence", () => {
    make();
    assert.equal(herdr.notify({ title: "Hi", level: "info" }), "o1");
    assert.equal(herdr.openOverlay({ mod: "clicker", kind: "window" }), "o2");
    assert.equal(herdr.closeOverlay("o2"), null);
    assert.equal(herdr.notify({ title: "Again" }), "o3");
    assert.deepEqual(ctl.notifications.map((n) => n.notification.title), ["Hi", "Again"]);
    assert.deepEqual(ctl.log.map((e) => e.type), ["notify", "openOverlay", "closeOverlay", "notify"]);
    assert.throws(() => herdr.openOverlay({ kind: "dialog" }), {
      message: '`herdr.openOverlay`: openOverlay needs { mod: "<folder>" } or { layout: {...} }',
    });
    assert.throws(() => herdr.notify({ title: "x", action: { run: () => 1 } }), { name: "TypeError", message: MESSAGES.callback });
  });

  test("shared/setShared: plain data, NaN becomes null, equal values are a no-op", () => {
    make();
    assert.equal(herdr.shared("k"), null);
    herdr.setShared("k", { a: 1, b: NaN });
    assert.deepEqual(herdr.shared("k"), { a: 1, b: null });
    herdr.setShared("k", { b: null, a: 1 });
    assert.equal(ctl.log.filter((e) => e.type === "setShared").length, 1);
    assert.throws(() => herdr.setShared("k"), { message: "`herdr.setShared`: argument 2 is missing; 1 were passed" });
  });

  test("playSound, setBadge, setWindowTitle, setAgentOrder are recorded", () => {
    make();
    herdr.playSound("done");
    herdr.setBadge("3");
    herdr.setBadge(null);
    herdr.setWindowTitle("x");
    herdr.setAgentOrder(["t1", 2, "t2"]);
    assert.deepEqual(ctl.recorded, { playSound: ["done"], setBadge: ["3", null], setWindowTitle: ["x"], setAgentOrder: [["t1", "t2"]] });
  });

  test("the bridge refuses callbacks, deep nesting and huge arrays", () => {
    make();
    let deep = 1;
    for (let i = 0; i < 17; i++) deep = [deep];
    assert.throws(() => herdr.setShared("k", deep), { message: MESSAGES.depth });
    assert.throws(() => herdr.setShared("k", new Array(10001).fill(0)), RangeError);
    assert.throws(() => herdr.setShared("k", Symbol("s")), { message: MESSAGES.unsupported });
  });
});

describe("text files (src/mod_files.rs)", () => {
  const save = "/home/p/.config/herdr-app/data/clicker/save.json";
  const read = (path) => inEvent(() => herdr.readTextFile(path));
  const write = (path, text, expected) => inEvent(() => herdr.writeTextFile(path, text, expected));

  test("read: null when absent, text when present; never synchronous", async () => {
    make({ files: { "/home/p/a.txt": "hello" } });
    const a = settledFlag(read("/home/p/a.txt"));
    const b = settledFlag(read("/home/p/missing.txt"));
    await tick();
    assert.equal(a.done, false);
    await ctl.flush();
    assert.equal(a.value, "hello");
    assert.equal(b.value, null);
  });

  test("create (expected null) makes parent folders; a second create is a stale snapshot", async () => {
    make();
    const w = settledFlag(write(save, "v1", null));
    await ctl.flush();
    assert.equal(w.value, null);
    assert.equal(w.error, undefined);
    assert.equal(ctl.readFile(save), "v1");
    assert.ok(ctl.dirs.has("/home/p/.config/herdr-app/data/clicker"));
    const again = settledFlag(write(save, "v2", null));
    await ctl.flush();
    assert.equal(again.error.message, "`herdr.writeTextFile`: " + MESSAGES.changedOutside);
    assert.equal(ctl.readFile(save), "v1");
  });

  test("compare-and-swap: matching expected replaces, stale expected rejects", async () => {
    make({ files: { [save]: "v1" } });
    const ok = settledFlag(write(save, "v2", "v1"));
    await ctl.flush();
    assert.equal(ok.error, undefined);
    assert.equal(ctl.readFile(save), "v2");
    ctl.externalWrite(save, "theirs");
    const stale = settledFlag(write(save, "v3", "v2"));
    await ctl.flush();
    assert.equal(stale.error.message, "`herdr.writeTextFile`: The file changed outside Herdr. Reload before saving; your draft is still here.");
    assert.equal(ctl.readFile(save), "theirs");
  });

  test("a change between check and rename: 'changed while saving'", async () => {
    make({ files: { [save]: "v1" } });
    ctl.raceNextWrite("other window");
    const w = settledFlag(write(save, "v2", "v1"));
    await ctl.flush();
    assert.equal(w.error.message, "`herdr.writeTextFile`: The file changed while saving. Reload before saving.");
    assert.equal(ctl.readFile(save), "other window");
  });

  test("1 MiB limit on writes and reads (bytes, not characters)", async () => {
    make();
    const big = "é".repeat(524289); // 1 048 578 bytes
    assert.equal(utf8Length(big), 1048578);
    const w = settledFlag(write(save, big, null));
    const fits = settledFlag(write("/home/p/fits.txt", "a".repeat(1024 * 1024), null));
    await ctl.flush();
    assert.equal(w.error.message, "`herdr.writeTextFile`: Text file exceeds 1 MiB");
    assert.equal(fits.error, undefined);
    ctl.externalWrite("/home/p/big.txt", "a".repeat(1024 * 1024 + 1));
    ctl.externalWrite("/home/p/cut.txt", "é".repeat(524288) + "é"); // byte 1 048 577 falls inside a character
    const r1 = settledFlag(read("/home/p/big.txt"));
    const r2 = settledFlag(read("/home/p/cut.txt"));
    await ctl.flush();
    assert.equal(r1.error.message, "`herdr.readTextFile`: Text file exceeds 1 MiB");
    assert.equal(r2.error.message, "`herdr.readTextFile`: stream did not contain valid UTF-8");
  });

  test("folders and files in the way", async () => {
    make({ files: { "/home/p/file": "x" } });
    ctl.mkdir("/home/p/dir");
    const r1 = settledFlag(read("/home/p/dir"));
    const r2 = settledFlag(read("/home/p/file/inner.json"));
    const w1 = settledFlag(write("/home/p/dir", "x", null));
    const w2 = settledFlag(write("/", "x", null));
    await ctl.flush();
    assert.equal(r1.error.message, "`herdr.readTextFile`: Not a regular file");
    assert.equal(r2.error.message, "`herdr.readTextFile`: Not a directory (os error 20)");
    assert.equal(w1.error.message, "`herdr.writeTextFile`: Not a regular file");
    assert.equal(w2.error.message, "`herdr.writeTextFile`: Not a regular file");
  });

  test("fault injection: failNextWrite rejects once and changes nothing", async () => {
    make({ files: { [save]: "v1" } });
    ctl.failNextWrite("No space left on device (os error 28)");
    const a = settledFlag(write(save, "v2", "v1"));
    const b = settledFlag(write(save, "v2", "v1"));
    await ctl.flush();
    assert.equal(a.error.message, "`herdr.writeTextFile`: No space left on device (os error 28)");
    assert.equal(b.error, undefined);
    assert.equal(ctl.readFile(save), "v2");
    assert.deepEqual(ctl.writes.map((x) => x.ok), [false, true]);
  });

  test("argument errors are synchronous; a non-string expected means create", async () => {
    make({ files: { [save]: "v1" } });
    assert.throws(() => write(save, 5, null), { message: "`herdr.writeTextFile`: argument 2 must be a string, got a number" });
    assert.throws(() => inEvent(() => herdr.readTextFile()), { message: "`herdr.readTextFile`: argument 1 is missing; 0 were passed" });
    const w = settledFlag(write(save, "v2", 7));
    await ctl.flush();
    assert.equal(w.error.message, "`herdr.writeTextFile`: " + MESSAGES.changedOutside);
  });

  test("async host calls need a live host call", () => {
    make();
    assert.throws(() => herdr.readTextFile(save), { name: "TypeError", message: outsideHostCallMessage("a HostModule's async function") });
  });

  test("a reloaded generation's write lands but never answers", async () => {
    make({ files: { [save]: "v1" } });
    const old = ctl.generation;
    const w = settledFlag(write(save, "v2", "v1"));
    ctl.newGeneration();
    ctl.cancelGeneration(old);
    await ctl.flush();
    await ctl.advance(10000);
    assert.equal(ctl.readFile(save), "v2");
    assert.equal(w.done, false);
  });
});

describe("clock, timers and cx", () => {
  test("advance runs due timers in time order and moves the clock", async () => {
    make({ now: 1000 });
    const seen = [];
    inEvent((cx) => {
      cx.timer.after(300, () => seen.push(["after300", ctl.now()]));
      cx.timer.after(100, () => seen.push(["after100", ctl.now()]));
      cx.timer.every(250, () => seen.push(["every", ctl.now()]));
    });
    await ctl.advance(600);
    assert.deepEqual(seen, [["after100", 1100], ["every", 1250], ["after300", 1300], ["every", 1500]]);
    assert.equal(ctl.now(), 1600);
  });

  test("every: next tick measured from the previous callback; cancel and is_done", async () => {
    make({ now: 0 });
    let n = 0;
    const h = inEvent((cx) => cx.timer.every(1000, () => { n += 1; }));
    await ctl.advance(3500);
    assert.equal(n, 3);
    assert.equal(h.is_done(), false);
    h.cancel();
    assert.equal(h.is_done(), true);
    await ctl.advance(5000);
    assert.equal(n, 3);
    const once = inEvent((cx) => cx.timer.after(10, () => {}));
    await ctl.advance(10);
    assert.equal(once.is_done(), true);
  });

  test("sleep inside spawn resumes in a task scope where notify is allowed", async () => {
    make({ now: 0 });
    const phases = [];
    inEvent((cx) => cx.spawn(async (cx) => {
      phases.push(cx.phase());
      await cx.sleep(500);
      phases.push(cx.phase());
      cx.notify();
    }));
    await ctl.advance(499);
    assert.equal(ctl.notifies.length, 0);
    await ctl.advance(1);
    assert.deepEqual(phases, ["event", "task"]);
    assert.equal(ctl.notifies.length, 1);
    assert.equal(ctl.notifies[0].owner, VIEW);
  });

  test("cx.notify() in render throws the shell's message", () => {
    make();
    assert.throws(() => ctl.within("render", VIEW, (cx) => cx.notify()), {
      name: "TypeError",
      message: "cx.notify() is not allowed during the `render` phase; request a re-render from an event handler instead",
    });
    assert.equal(notifyPhaseMessage("cx.notify()", "layout"), "cx.notify() is not allowed during the `layout` phase; request a re-render from an event handler instead");
    const cx = ctl.makeCx("render", VIEW);
    assert.throws(() => cx.notify(), /`render` phase/);
    assert.throws(() => cx.focus_handle(), { message: MESSAGES.focusInRender });
    assert.equal(cx.phase(), "render");
    const ev = ctl.makeCx("event", VIEW);
    ev.notify();
    assert.equal(ctl.notifies.length, 1);
    assert.throws(() => ev.notify({}), { message: "cx.notify(entity) expects an Entity" });
  });

  test("a call cx kept past its call is stale", () => {
    make();
    let kept;
    ctl.within("event", VIEW, (cx) => { kept = cx; });
    assert.throws(() => kept.notify(), { message: MESSAGES.stale });
    const cx = ctl.makeCx("event", VIEW);
    ctl.endCx(cx);
    assert.throws(() => cx.sleep(1), { message: MESSAGES.stale });
  });

  test("stop_propagation / propagate mark the frame", async () => {
    make();
    let frame;
    await ctl.dispatch("event", VIEW, (cx, f) => { frame = f; cx.stop_propagation(); });
    assert.equal(frame.stopped, true);
    const cx = ctl.makeCx("event", VIEW);
    cx.stop_propagation();
    cx.propagate();
    assert.equal(ctl.frameOf(cx).stopped, false);
  });

  test("focus handles", () => {
    make();
    const h = inEvent((cx) => cx.focus_handle());
    assert.equal(inEvent(() => h.is_focused()), false);
    inEvent(() => h.focus());
    assert.equal(inEvent(() => h.is_focused()), true);
    // entity_api.rs: both need a live host call; focus() is refused in render and layout.
    assert.throws(() => h.is_focused(), { name: "TypeError", message: "is_focused() needs a live host call; call it from render or an event handler" });
    assert.equal(ctl.within("render", VIEW, () => h.is_focused()), true);
    for (const phase of ["render", "layout"]) {
      assert.throws(() => ctl.within(phase, VIEW, () => h.focus()), {
        name: "TypeError",
        message: "FocusHandle.focus() cannot run during render or layout; mutate state from an event handler or task",
      });
    }
    assert.equal(h.release(), true);
    assert.equal(h.release(), false);
    assert.throws(() => inEvent(() => h.focus()), { name: "TypeError", message: "this focus handle has been released" });
  });

  test("spawn: body runs synchronously; errors are logged, not thrown", async () => {
    make();
    let ran = false;
    inEvent((cx) => {
      cx.spawn(() => { ran = true; });
      cx.spawn(() => { throw new Error("boom"); });
      cx.spawn(async () => { throw new Error("later"); });
    });
    assert.equal(ran, true);
    await ctl.flush();
    assert.deepEqual(ctl.errors.map((e) => e.message.split("\n")[0]), ["error in gpui.spawn: boom", "unhandled rejection in gpui.spawn: later"]);
  });

  test("timer errors are logged as script task errors", async () => {
    make();
    inEvent((cx) => cx.timer.after(5, () => { throw new Error("tick"); }));
    await ctl.advance(5);
    assert.match(ctl.errors[0].message, /^error in script task: tick/);
  });

  test("validation messages from scheduler.rs", () => {
    make();
    inEvent((cx) => {
      assert.throws(() => cx.sleep(-1), { name: "TypeError", message: "cx.sleep(ms) expects a non-negative number of milliseconds, got -1" });
      assert.throws(() => cx.timer.after(NaN, () => {}), { message: "cx.timer.after(ms, fn) expects a non-negative number of milliseconds, got NaN" });
      assert.throws(() => cx.timer.every(Infinity, () => {}), { message: "cx.timer.every(ms, fn) expects a non-negative number of milliseconds, got inf" });
      assert.throws(() => cx.timer.every(1e308, () => {}), { name: "RangeError", message: "cx.timer.every(ms, fn) milliseconds are outside the supported duration range" });
      assert.throws(() => cx.spawn(() => {}, { owner: 3 }), { message: MESSAGES.ownerType });
      assert.throws(() => cx.spawn(() => {}, { owner: {} }), { message: MESSAGES.ownerOther });
      cx.spawn(() => {}, { owner: VIEW });
      cx.spawn(() => {}, { owner: null });
    });
  });

  test("outstanding task limit of 1024", () => {
    make();
    inEvent((cx) => {
      for (let i = 0; i < 1024; i++) cx.timer.after(1000, () => {});
      assert.throws(() => cx.sleep(1), { name: "RangeError", message: "cx.sleep(ms) exceeded the per-runtime outstanding host task limit of 1024" });
    });
  });

  test("cancelGeneration: timers stop, sleeps never settle, the old async cx throws", async () => {
    make({ now: 0 });
    const old = ctl.generation;
    let ticks = 0;
    let keptCx;
    let afterSleep = false;
    inEvent((cx) => {
      cx.timer.every(100, (tcx) => { ticks += 1; keptCx = tcx; });
      cx.spawn(async (cx) => { await cx.sleep(1000); afterSleep = true; });
    });
    await ctl.advance(250);
    assert.equal(ticks, 2);
    ctl.newGeneration();
    ctl.cancelGeneration(old);
    await ctl.advance(5000);
    assert.equal(ticks, 2);
    assert.equal(afterSleep, false);
    await ctl.dispatch("event", VIEW, () => {
      assert.throws(() => keptCx.notify(), { message: MESSAGES.ended });
    });
    assert.deepEqual(ctl.pendingTasks(), []);
  });

  test("an async cx used outside any host call refuses", async () => {
    make();
    let kept;
    inEvent((cx) => cx.timer.after(1, (tcx) => { kept = tcx; }));
    await ctl.advance(1);
    assert.throws(() => kept.notify(), { message: MESSAGES.noHostCall });
  });

  test("Date.now follows the virtual clock while patched", async () => {
    make({ now: 5000, patchDate: true });
    assert.equal(Date.now(), 5000);
    await ctl.advance(250);
    assert.equal(Date.now(), 5250);
    ctl.dispose();
    assert.ok(Date.now() > 1.7e12);
  });

  test("host settlements and timers interleave by due time, then creation order", async () => {
    make({ now: 0, files: { "/home/p/a": "A" } });
    const order = [];
    inEvent((cx) => {
      cx.timer.after(0, () => order.push("timer0"));
      herdr.readTextFile("/home/p/a").then(() => order.push("read"));
      cx.timer.after(5, () => order.push("timer5"));
    });
    await ctl.advance(10);
    assert.deepEqual(order, ["timer0", "read", "timer5"]);
  });
});

// Review fixes: places the mock was more permissive than herdr.
describe("strictness fixes", () => {
  test("host results are built with assignment under frozen prototypes (rquickjs Object::set)", () => {
    make({ shared: { ok: { a: 1 } } });
    herdr.setShared("bad", { counts: { constructor: 1 } });
    // In herdr the conversion throws at the call site: Object.prototype is frozen.
    assert.throws(() => herdr.shared("bad"), { name: "TypeError", message: "'constructor' is read-only" });
    herdr.setShared("bad2", { toString: "x" });
    assert.throws(() => herdr.shared("bad2"), { name: "TypeError", message: "'toString' is read-only" });
    // `__proto__` goes through the accessor: an object becomes the prototype, a string is dropped.
    herdr.setShared("p", JSON.parse('{"__proto__": "x", "a": 1}'));
    const p = herdr.shared("p");
    assert.deepEqual(Object.keys(p), ["a"]);
    assert.equal(Object.getPrototypeOf(p), Object.prototype);
    herdr.setShared("q", JSON.parse('{"__proto__": {"z": 2}, "a": 1}'));
    const q = herdr.shared("q");
    assert.deepEqual(Object.keys(q), ["a"]);
    assert.equal(q.z, 2);
    assert.deepEqual(herdr.shared("ok"), { a: 1 });
    ctl.dispose();
    // With the sandbox's strict builtins off, the same value converts.
    make({ frozenBuiltins: false });
    herdr.setShared("bad", { counts: { constructor: 1 } });
    assert.equal(Object.hasOwn(herdr.shared("bad").counts, "constructor"), true);
  });

  test("an async result that cannot be converted never settles and is logged", async () => {
    make({ files: {} });
    ctl.commandQueue.push({ constructor: 1 });
    const n = settledFlag(inEvent(() => herdr.nextCommand()));
    await ctl.flush();
    assert.equal(n.done, false);
    assert.match(ctl.errors.at(-1).message, /'constructor' is read-only/);
  });

  test("paths: '' has no parent; relative paths resolve against herdr's cwd; '.', '..' and '//' fold", async () => {
    make({ cwd: "/" });
    const w0 = settledFlag(inEvent(() => herdr.writeTextFile("", "x", null)));
    const w1 = settledFlag(inEvent(() => herdr.writeTextFile("save.json", "rel", null)));
    const w2 = settledFlag(inEvent(() => herdr.writeTextFile("/home/p//data/./x/../save.json", "abs", null)));
    await ctl.flush();
    assert.equal(w0.error.message, "`herdr.writeTextFile`: File needs a parent directory");
    assert.equal(w1.error, undefined);
    assert.equal(ctl.readFile("/save.json"), "rel");
    assert.ok(ctl.log.some((e) => e.type === "warn" && /relative path `save.json`/.test(e.message)));
    assert.equal(ctl.readFile("/home/p/data/save.json"), "abs");
    const r = settledFlag(inEvent(() => herdr.readTextFile("/home/p/data/save.json")));
    await ctl.flush();
    assert.equal(r.value, "abs");
  });

  test("a trailing slash names a directory: reading a file that way or creating one fails like the OS", async () => {
    make({ files: { "/home/p/a.json": "x" } });
    const r = settledFlag(inEvent(() => herdr.readTextFile("/home/p/a.json/")));
    const missing = settledFlag(inEvent(() => herdr.readTextFile("/home/p/b.json/")));
    const w = settledFlag(inEvent(() => herdr.writeTextFile("/home/p/b.json/", "y", null)));
    await ctl.flush();
    assert.equal(r.error.message, "`herdr.readTextFile`: Not a directory (os error 20)");
    assert.equal(missing.value, null);
    assert.equal(w.error.message, "`herdr.writeTextFile`: Is a directory (os error 21)");
    assert.equal(ctl.readFile("/home/p/b.json"), null);
  });
});

// Panel frame and always-visible surfaces (DESIGN §3.1, §3.2, §3.7–§3.10,
// §13.5, §14; ARCHITECTURE B11): every ViewModel fixture rendered through the
// mock gpui in graphite and paper (invalid methods and colours throw there),
// the loop budget (steady 0, events ≤ 12 per copy, calm 0), ids on every
// clickable and unique per tree, propagation stopped by pieces over the mat,
// mat geometry (nothing overlaps the Sheet at any width), handler wiring,
// grapheme clipping with inflated strings, and render time per fixture.
//
//   node --import ./tools/node/register.mjs --test test/ui/panel.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { installMockWindow, walk, fire } from "../../tools/mock/gpui-kit.js";
import { createHost } from "../../tools/qjs/harness.mjs";
import * as F from "../fixtures/vm-fixtures.mjs";
import { graphemes } from "../../mods/creaseworks/engine/index.js";
import { pickScene, pickHues } from "../../mods/creaseworks/ui/palette.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const UI = join(root, "mods/creaseworks/ui");
const THEMES = JSON.parse(readFileSync(join(root, "tools/mock/themes.json"), "utf8"));
const THEME_NAMES = ["graphite", "paper"];

// The tab renderers (flock, shop, string, settings) are another builder's
// files. Until they exist, ui/panel.js imports a stub for each, so the frame
// is still tested; the diagnostic says so.
const TAB_FILES = ["flock", "shop", "string", "settings"];
const missingTabs = TAB_FILES.filter((n) => !existsSync(join(UI, `${n}.js`)));
if (missingTabs.length) {
  const stub =
    'import { div } from "gpui-kit";' +
    "const mk = (n) => (vm, ui, ctx) => div().id(`stub-${n}`).w_full().child(`stub ${n}`);" +
    'export const renderFlock = mk("flock"), renderShop = mk("shop"), renderString = mk("string"), renderSettings = mk("settings");';
  const hooks =
    'import { existsSync } from "node:fs"; import { fileURLToPath } from "node:url";' +
    `const STUB = ${JSON.stringify("data:text/javascript," + encodeURIComponent(stub))};` +
    "export async function resolve(spec, context, next) {" +
    "  if (/^\\.\\/(flock|shop|string|settings)\\.js$/.test(spec) && context.parentURL && context.parentURL.endsWith('/ui/panel.js')" +
    "      && !existsSync(fileURLToPath(new URL(spec, context.parentURL)))) return { url: STUB, shortCircuit: true };" +
    "  return next(spec, context); }";
  register("data:text/javascript," + encodeURIComponent(hooks));
}

const { renderPanel, activeTab, RAIL_BELOW } = await import("../../mods/creaseworks/ui/panel.js");
const { renderMat, matGeometry, MAT_CLIP } = await import("../../mods/creaseworks/ui/mat.js");
const { renderBanner, bannerLayout, middleClip, bannerNotices } = await import("../../mods/creaseworks/ui/banner.js");
const { renderAway, awayLines, AWAY_CLOSE } = await import("../../mods/creaseworks/ui/away.js");
const { renderRail } = await import("../../mods/creaseworks/ui/rail.js");
const { renderRibbon, pipArea, densityLevel, ribbonLayout, ribbonPill, textBound, fitLevelC, CHIP_GLYPH, ENV_MARKER, HINT_FOLD } = await import("../../mods/creaseworks/ui/ribbon.js");
const { statusColor, statusDisc, contrast } = await import("../../mods/creaseworks/ui/color.js");
const { spritePath } = await import("../../mods/creaseworks/ui/art.js");

installMockWindow();

const isDark = (name) => name !== "paper" && name !== "win98";

/** A ctx (B11) with recording handlers. */
function makeCtx(themeName, s, over = {}) {
  const dark = isDark(themeName);
  const calls = [];
  const names = [
    "click", "open", "openHelper", "buy", "setting", "switchAuto", "wish", "collect", "dismiss", "fold", "show", "tab",
    "segment", "select", "toggleGroup", "showGroup", "details", "confirm", "cancel", "retrySave", "checkSave",
    "restoreBackup", "sharePath",
  ];
  const handlers = {};
  for (const n of names) handlers[n] = (...args) => calls.push([n, ...args.slice(0, -1)]);
  return {
    T: THEMES[themeName], S: pickScene(dark), hues: pickHues(dark), dark, zoom: 1, calm: false,
    width: s.width, height: s.height, panelShown: true, handlers, calls, ...over,
  };
}

function renderScenario(s, ctx) {
  return s.role === "ribbon" ? renderRibbon(s.vm, s.ui, ctx) : renderPanel(s.vm, s.ui, ctx);
}

/** Every node of a serialised tree, including text nodes. */
function allNodes(json, visit, path = []) {
  visit(json, path);
  const kids = (json.children || []).concat(json.slots ? Object.values(json.slots) : []);
  for (const k of kids) if (k && typeof k === "object") allNodes(k, visit, json.id ? path.concat(json.id) : path);
}

function countLoops(json) {
  let n = 0;
  walk(json, (node) => {
    n += (node.loops ? node.loops.length : 0) + (node.spin ? 1 : 0) + (node.frames ? 1 : 0);
  });
  return n;
}

const CLICK_EVENTS = ["on_click", "on_mouse_down", "on_mouse_up", "on_change"];

function clickables(json) {
  const out = [];
  walk(json, (node) => {
    const hs = Object.keys(node.handlers || {});
    if (hs.some((h) => CLICK_EVENTS.some((e) => h === e || h.startsWith(e + ":")))) out.push(node);
  });
  return out;
}

function ids(json) {
  const out = [];
  walk(json, (node) => {
    if (node.id) out.push(node.id);
  });
  return out;
}

const fakeCx = () => {
  const cx = { stopped: 0, stop_propagation() { cx.stopped++; }, notify() {} };
  return cx;
};

const SCENARIOS = F.allScenarios();

// ---------------------------------------------------------------------------
// Every fixture renders, in both themes

test("every fixture renders through the mock gpui in graphite and paper (methods and colours validated)", () => {
  if (missingTabs.length) console.log(`# tab renderers stubbed (not yet written): ${missingTabs.join(", ")}`);
  for (const s of SCENARIOS) {
    for (const th of THEME_NAMES) {
      for (const panelShown of s.role === "ribbon" ? [true, false] : [true]) {
        const ctx = makeCtx(th, s, { panelShown });
        const tree = renderScenario(s, ctx);
        assert.ok(tree && tree.__r, `${s.name} ${th}: a live element`);
        const json = tree.toJSON();
        assert.ok(json.kind, s.name);
        // The parts render on their own as well (B11: each is a pure function).
        if (s.role === "panel" && s.width >= RAIL_BELOW) {
          renderMat(s.vm, s.ui, ctx).toJSON();
          renderBanner(s.vm, s.ui, ctx)?.toJSON();
          renderAway(s.vm, s.ui, ctx)?.toJSON();
        }
        renderRail(s.vm, s.ui, ctx).toJSON();
      }
    }
  }
});

test("the panel picks rail / frame by width and tab content by ui.tab", () => {
  const rail = F.scenario("rail");
  const json = renderPanel(rail.vm, rail.ui, makeCtx("graphite", rail)).toJSON();
  assert.equal(json.id, "cw-rail");
  const std = F.scenario("standard-4");
  const pj = renderPanel(std.vm, std.ui, makeCtx("graphite", std)).toJSON();
  assert.equal(pj.id, "cw-panel");
  const top = pj.children.map((c) => c.id);
  assert.deepEqual(top, ["cw-hdr", "cw-mat-slot", "cw-boostbar", "cw-tabs", "cw-content", "cw-foot"]);
  const banner = F.scenario("banner-error");
  const bj = renderPanel(banner.vm, banner.ui, makeCtx("graphite", banner)).toJSON();
  assert.deepEqual(bj.children.map((c) => c.id).slice(0, 3), ["cw-hdr", "cw-banner-wrap", "cw-mat-slot"]);
  const away = F.scenario("away");
  const aj = renderPanel(away.vm, away.ui, makeCtx("graphite", away)).toJSON();
  assert.equal(aj.children.at(-1).id, "cw-away-slot", "the away card paints last (over the frame)");
  assert.equal(activeTab({ tab: "nope" }), "flock");
  assert.equal(activeTab({ tab: "settings" }), "settings");
  const set = F.scenario("settings");
  const sj = renderPanel(set.vm, set.ui, makeCtx("graphite", set)).toJSON();
  const tabs = sj.children.find((c) => c.id === "cw-tabs");
  assert.ok(ids(tabs).includes("cw-tab-back"), "Settings shows ← Back in the tabs row");
  assert.ok(!ids(tabs).includes("cw-tab-shop"));
});

// ---------------------------------------------------------------------------
// Loop budget (DESIGN §13.5)

test("loop budget: steady views 0, event views ≤ 12 per copy, calm 0", () => {
  const steady = new Set(F.STEADY_VIEWS);
  let maxSeen = 0;
  for (const s of SCENARIOS) {
    const base = s.name.split("@")[0];
    for (const th of THEME_NAMES) {
      const n = countLoops(renderScenario(s, makeCtx(th, s, { panelShown: false })).toJSON());
      maxSeen = Math.max(maxSeen, n);
      assert.ok(n <= 12, `${s.name} ${th}: ${n} loop/spin nodes`);
      if (steady.has(base)) assert.equal(n, 0, `${s.name} ${th} is a steady-state view`);
      const calm = countLoops(renderScenario(s, makeCtx(th, s, { calm: true, panelShown: false })).toJSON());
      assert.equal(calm, 0, `${s.name} ${th} calm`);
    }
  }
  assert.ok(maxSeen > 0, "some event view does loop");
  // Each event the frame owns shows up as exactly the loop the vm asked for.
  const loopIds = (name) => {
    const s = F.scenario(name);
    const out = [];
    walk(renderPanel(s.vm, s.ui, makeCtx("graphite", s)).toJSON(), (n) => {
      if (n.loops && n.loops.length) out.push([n.id, n.loops[0].property, n.loops[0].period]);
    });
    return out;
  };
  assert.ok(loopIds("storm").some(([id, p, t]) => id === "cw-storm" && p === "opacity" && t === 1200));
  assert.ok(loopIds("crane").some(([id, p, t]) => id === "cw-crane-art" && p === "top" && t === 1300));
  assert.ok(loopIds("first-run").some(([id, p, t]) => id === "cw-hint-bob" && p === "top" && t === 900));
  assert.ok(loopIds("finished-2").some(([id, p, t]) => /^cw-env-.*-art$/.test(id) && p === "top" && t === 1600));
  // Only the flagged envelope bobs; nothing faster than 2 Hz.
  for (const s of SCENARIOS) {
    walk(renderScenario(s, makeCtx("graphite", s)).toJSON(), (n) => {
      for (const l of n.loops || []) assert.ok(l.period >= 900, `${s.name} ${n.id} period ${l.period}`);
    });
  }
});

test("mat chips pulse only when the vm says so; calm drops crane glide, storm and pops", () => {
  const s = F.scenario("needs-you-3");
  const vm = JSON.parse(JSON.stringify(s.vm));
  vm.mat.chips[0].pulse = true;
  const json = renderMat(vm, s.ui, makeCtx("graphite", s)).toJSON();
  const pulsing = [];
  walk(json, (n) => {
    if (n.loops && n.loops.length) pulsing.push(n.id);
  });
  assert.deepEqual(pulsing, [`cw-chip-${vm.mat.chips[0].helperId}-pill`]);
  const crane = F.scenario("crane");
  const glide = (calm) => {
    let t = null;
    walk(renderMat(crane.vm, crane.ui, makeCtx("graphite", crane, { calm })).toJSON(), (n) => {
      if (n.id === "cw-crane") t = n.transitions;
    });
    return t;
  };
  assert.deepEqual(glide(false).map((x) => x.property), ["left"]);
  assert.deepEqual(glide(true), []);
  const ui = { ...crane.ui, pops: [{ id: "p1", label: "+1.2K", x: 150, y: 90, risen: false }] };
  const withPops = ids(renderMat(crane.vm, ui, makeCtx("graphite", crane)).toJSON());
  assert.ok(withPops.includes("cw-pop-p1"));
  assert.ok(!ids(renderMat(crane.vm, ui, makeCtx("graphite", crane, { calm: true })).toJSON()).includes("cw-pop-p1"));
});

test("calm mode: no transition over 150 ms in any copy; running boost countdowns snap (r4-13, DESIGN §11.1 item 4)", () => {
  for (const s of SCENARIOS) {
    for (const th of THEME_NAMES) {
      walk(renderScenario(s, makeCtx(th, s, { calm: true })).toJSON(), (n) => {
        for (const t of n.transitions || []) assert.ok(t.duration <= 150, `${s.name} ${th} ${n.id}: ${t.property} ${t.duration} ms in calm`);
      });
    }
  }
  const s = F.scenario("storm");
  assert.ok(s.vm.boosts.length > 0, "storm runs a boost");
  const bars = (vm, ctx) => {
    const out = [];
    walk(renderPanel(vm, s.ui, ctx).toJSON(), (n) => {
      if (/^cw-boostbar-.*-bar-fill$/.test(n.id)) out.push(n);
    });
    return out;
  };
  const moving = bars(s.vm, makeCtx("graphite", s));
  assert.equal(moving.length, s.vm.boosts.length);
  for (const n of moving) assert.equal(n.transitions[0].duration, 1000, "outside calm the bar eases over one tick");
  // Calm from ctx, and calm from the vm's settings alone, both snap.
  const calmVm = { ...s.vm, settings: { ...s.vm.settings, calm: true } };
  for (const [vm, ctx] of [[s.vm, makeCtx("graphite", s, { calm: true })], [calmVm, makeCtx("graphite", s)]]) {
    const snapped = bars(vm, ctx);
    assert.equal(snapped.length, s.vm.boosts.length);
    for (const n of snapped) assert.deepEqual(n.transitions, [], `${n.id} snaps in calm`);
  }
});

// ---------------------------------------------------------------------------
// Ids and propagation

test("every clickable has an id, and ids are unique in each tree", () => {
  for (const s of SCENARIOS) {
    for (const panelShown of [true, false]) {
      const json = renderScenario(s, makeCtx("paper", s, { panelShown })).toJSON();
      for (const node of clickables(json)) {
        assert.ok(typeof node.id === "string" && node.id.length > 0, `${s.name}: a ${node.kind} with ${Object.keys(node.handlers)} has no id`);
      }
      for (const kind of ["Button", "Switch", "Checkbox"]) {
        walk(json, (n) => {
          if (n.kind === kind) assert.ok(n.id, `${s.name}: ${kind} without id`);
        });
      }
      const list = ids(json);
      const seen = new Set();
      for (const id of list) {
        assert.ok(!seen.has(id), `${s.name}: duplicate id ${id}`);
        seen.add(id);
      }
    }
  }
});

test("pieces over the mat stop propagation; the Sheet does not need to", () => {
  const views = ["needs-you-3", "storm", "crane", "boat", "chain-7", "tray-full", "finished-2"];
  for (const name of views) {
    const s = F.scenario(name);
    const ctx = makeCtx("graphite", s);
    const live = renderMat(s.vm, s.ui, ctx);
    const json = live.toJSON();
    let checked = 0;
    for (const node of clickables(json)) {
      if (node.id === "cw-sheet") continue;
      const cx = fakeCx();
      const ev = Object.keys(node.handlers)[0];
      fire(live, node.id, ev, { local_position: { x: 4, y: 4 } }, cx);
      assert.ok(cx.stopped >= 1, `${name}: ${node.id} (${ev}) must stop propagation`);
      checked++;
    }
    assert.ok(checked > 0, name);
  }
  // Ribbon envelope markers sit on their chip.
  const r = F.scenario("ribbon-4", { window: 1440 });
  const live = renderRibbon(r.vm, r.ui, makeCtx("graphite", r));
  const marker = ids(live.toJSON()).find((id) => id.startsWith("cw-rib-env-"));
  assert.ok(marker, "ribbon-4 has an envelope marker");
  const cx = fakeCx();
  fire(live, marker, "on_click", {}, cx);
  assert.equal(cx.stopped, 1);
});

// ---------------------------------------------------------------------------
// Handler wiring (B11 table)

test("handlers receive the B11 arguments", () => {
  const s = F.scenario("chain-7");
  const ctx = makeCtx("graphite", s);
  const live = renderMat(s.vm, s.ui, ctx);
  const node = s.vm.mat.nodes.find((n) => n.x > 230); // clear of the Sheet: not nudged
  fire(live, `cw-node-${node.id}`, "on_click", {}, fakeCx());
  assert.deepEqual(ctx.calls.at(-1), ["click", "node", node.id, { x: node.x, y: node.y }]);
  fire(live, `cw-scrap-${s.vm.mat.scraps[0].id}`, "on_click", {}, fakeCx());
  assert.equal(ctx.calls.at(-1)[1], "scrap");
  fire(live, "cw-sheet", "on_mouse_down:left", { local_position: { x: 10, y: 20 } }, fakeCx());
  assert.deepEqual(ctx.calls.at(-1), ["click", "sheet", null, { x: 106, y: 78 }]);
  fire(live, "cw-sheet", "on_mouse_down:left", {}, fakeCx());
  assert.deepEqual(ctx.calls.at(-1), ["click", "sheet", null, { x: 152, y: 114 }], "no local_position: the Sheet's centre");
  const env = s.vm.tray.envelopes[0].helperId;
  fire(live, `cw-env-${env}`, "on_click", {}, fakeCx());
  assert.deepEqual(ctx.calls.at(-1), ["open", env]);

  const n3 = F.scenario("needs-you-3");
  const c3 = makeCtx("graphite", n3);
  const p3 = renderPanel(n3.vm, n3.ui, c3);
  const chip = n3.vm.mat.chips[0].helperId;
  fire(p3, `cw-chip-${chip}`, "on_click", {}, fakeCx());
  assert.deepEqual(c3.calls.at(-1), ["openHelper", chip]);
  fire(p3, "cw-hdr-count-needs", "on_click", {}, fakeCx());
  assert.deepEqual(c3.calls.at(-1), ["openHelper", "needs"]);
  fire(p3, "cw-hdr-count-working", "on_click", {}, fakeCx());
  assert.deepEqual(c3.calls.at(-1), ["showGroup", "working"]);
  fire(p3, "cw-hdr-gear", "on_click", {}, fakeCx());
  assert.deepEqual(c3.calls.at(-1), ["tab", "settings"]);
  fire(p3, "cw-tab-shop", "on_click", {}, fakeCx());
  assert.deepEqual(c3.calls.at(-1), ["tab", "shop"]);
  fire(p3, "cw-hdr-fold", "on_click", {}, fakeCx());
  assert.deepEqual(c3.calls.at(-1), ["fold"]);

  const a = F.scenario("away");
  const ca = makeCtx("graphite", a);
  const pa = renderPanel(a.vm, a.ui, ca);
  fire(pa, "cw-away-collect", "on_click", {}, fakeCx());
  assert.deepEqual(ca.calls.at(-1), ["collect"]);
  fire(pa, "cw-away-close", "on_click", {}, fakeCx());
  assert.deepEqual(ca.calls.at(-1), ["dismiss", "away"]);
  fire(pa, "cw-away-open", "on_click", {}, fakeCx());
  assert.deepEqual(ca.calls.at(-1), ["openHelper", a.vm.away.needs[0].helperId]);
  const b = F.scenario("busy");
  const cb = makeCtx("graphite", b);
  const pb = renderPanel(b.vm, b.ui, cb);
  assert.ok(!ids(pb.toJSON()).includes("cw-away-collect"), "busy has no Collect");
  fire(pb, "cw-away-close", "on_click", {}, fakeCx());
  assert.deepEqual(cb.calls.at(-1), ["dismiss", "busy"]);

  const e = F.scenario("banner-error");
  const ce = makeCtx("graphite", e);
  const pe = renderPanel(e.vm, e.ui, ce);
  fire(pe, "cw-banner-retry", "on_click", {}, fakeCx());
  assert.deepEqual(ce.calls.at(-1), ["retrySave"]);
  fire(pe, "cw-banner-details-toggle", "on_click", {}, fakeCx());
  assert.deepEqual(ce.calls.at(-1), ["details", true]);
  const k = F.scenario("banner-clock");
  const ck = makeCtx("graphite", k);
  fire(renderPanel(k.vm, k.ui, ck), "cw-banner-dismiss", "on_click", {}, fakeCx());
  assert.deepEqual(ck.calls.at(-1), ["dismiss", "clock"]);

  const r = F.scenario("rail");
  const cr = makeCtx("graphite", r);
  const pr = renderPanel(r.vm, r.ui, cr);
  fire(pr, "cw-sheet-mini", "on_click", {}, fakeCx());
  assert.deepEqual(cr.calls.at(-1), ["click", "mini", null, null]);
  fire(pr, "cw-rail-needs", "on_click", {}, fakeCx());
  assert.deepEqual(cr.calls.at(-1), ["openHelper", "needs"]);
  fire(pr, "cw-rail-unfold", "on_click", {}, fakeCx());
  assert.deepEqual(cr.calls.at(-1), ["fold"]);
  const pips = r.vm.rail.pips;
  const blocked = pips.find((m) => m.status === "blocked");
  const working = pips.find((m) => m.status === "working");
  fire(pr, `cw-rail-pip-${blocked.helperId}`, "on_click", {}, fakeCx());
  assert.deepEqual(cr.calls.at(-1), ["openHelper", blocked.helperId]);
  fire(pr, `cw-rail-pip-${working.helperId}`, "on_click", {}, fakeCx());
  assert.deepEqual(cr.calls.at(-1), ["select", working.helperId]);

  const rb = F.scenario("ribbon-130", { window: 1100 });
  const crb = makeCtx("graphite", rb, { panelShown: false });
  const prb = renderRibbon(rb.vm, rb.ui, crb);
  fire(prb, "cw-rib-tally-working", "on_click", {}, fakeCx());
  assert.deepEqual(crb.calls.at(-1), ["showGroup", "working"]);
  fire(prb, "cw-rib-mini", "on_click", {}, fakeCx());
  assert.deepEqual(crb.calls.at(-1), ["click", "mini", null, null]);
  fire(prb, "cw-rib-env", "on_click", {}, fakeCx());
  assert.deepEqual(crb.calls.at(-1), ["open", rb.vm.tray.envelopes[0].helperId]);
  assert.ok(!ids(renderRibbon(rb.vm, rb.ui, makeCtx("graphite", rb, { panelShown: true })).toJSON()).includes("cw-rib-mini"),
    "no ribbon mini Sheet while the panel shows");
});

// ---------------------------------------------------------------------------
// Ribbon density, rail grid

test("ribbon density levels A/B/C follow §3.10 and every helper keeps a mark up to the B capacity", () => {
  assert.equal(pipArea(1172), 922);
  assert.equal(pipArea(832), 582);
  assert.equal(densityLevel(41, 922), "A");
  assert.equal(densityLevel(42, 922), "B");
  assert.equal(densityLevel(130, 922), "B");
  assert.equal(densityLevel(131, 922), "C");
  assert.equal(densityLevel(26, 582), "A");
  assert.equal(densityLevel(82, 582), "B");
  assert.equal(densityLevel(83, 582), "C");
  for (const n of F.RIBBON_COUNTS) {
    for (const w of [1100, 1440]) {
      const s = F.scenario(`ribbon-${n}`, { window: w });
      const json = renderRibbon(s.vm, s.ui, makeCtx("graphite", s)).toJSON();
      const marks = ids(json).filter((id) => id.startsWith("cw-rib-m-"));
      const level = s.vm.ribbon.level;
      if (n === 0) {
        let empty = false;
        allNodes(json, (x) => {
          if (x.kind === "text" && x.text.startsWith("No paper folk yet")) empty = true;
        });
        assert.ok(empty, "empty ribbon text");
        continue;
      }
      assert.equal(level, densityLevel(n, pipArea(s.width)), `ribbon-${n}@${w}`);
      assert.equal(ids(json).includes("cw-rib-chips"), level === "A");
      assert.equal(ids(json).includes("cw-rib-pips"), level !== "A");
      if (level === "C") {
        const urgent = s.vm.ribbon.marks.length;
        assert.equal(marks.length, urgent, "needs-you and finished stay individual");
        assert.ok(ids(json).includes("cw-rib-tally-working") && ids(json).includes("cw-rib-tally-idle"));
      } else {
        assert.equal(marks.length, n, `ribbon-${n}@${w}: one mark per helper`);
      }
    }
  }
  // 64 helpers keep individual marks at both sizes (§3.10, §5.5).
  for (const w of [1100, 1440]) assert.notEqual(F.scenario("ribbon-64", { window: w }).vm.ribbon.level, "C");
});

/** A ribbon VM of the first `n` marks of ribbon-34 (group order), as the view would level it with no lead. */
function ribbonOf(n, W, extra = {}) {
  const base = F.scenario("ribbon-34", { window: 1100 }).vm;
  const marks = base.ribbon.marks.slice(0, n);
  return { ...base, ribbon: { ...base.ribbon, marks, tallies: [], level: densityLevel(n, pipArea(W)), ...extra } };
}

const styleOf = (n, k) => (n.styles || []).find((x) => x[0] === k)?.[1];
function findNode(json, id) {
  let out = null;
  walk(json, (node) => {
    if (!out && node.id === id) out = node;
  });
  return out;
}

test("ribbon: a lead chip (narrow hint, save chip, welcome pill) is subtracted before the density level, so no mark is clipped", () => {
  // The defect: the window shot (1100×700, 12 agents, W = 832) chose level A
  // for the full 582 px and the ~340 px narrow hint pushed marks 11 and 12
  // past the overflow edge.
  const W = 832;
  const vm = ribbonOf(12, W);
  assert.equal(vm.ribbon.level, "A", "the view alone picks chips");
  const s = { width: W, height: 30 };
  const ctx = makeCtx("graphite", s, { narrowHint: true, panelShown: true });
  const lay = ribbonLayout(vm, ctx, W);
  assert.ok(lay.lead > 0 && lay.avail === lay.w - lay.lead);
  assert.notEqual(lay.level, "A", "12 chips do not fit beside the narrow hint");
  assert.ok(lay.lead + lay.need <= lay.w, `lead ${lay.lead} + marks ${lay.need} within ${lay.w}`);
  const json = renderRibbon(vm, {}, ctx).toJSON();
  assert.equal(ids(json).filter((id) => id.startsWith("cw-rib-m-")).length, 12, "one mark per helper");
  assert.ok(ids(json).includes("cw-rib-pips") && !ids(json).includes("cw-rib-chips"));
  // Every lead element is bounded to the width it reserved.
  const hint = findNode(json, "cw-rib-hint");
  const spec = lay.specs.find((x) => x.key === "hint");
  assert.equal(styleOf(hint, "max_w"), spec.w);
  assert.equal(styleOf(findNode(json, "cw-rib-hint-fold"), "w"), spec.fold);
  assert.equal(styleOf(findNode(json, "cw-rib-hint-later"), "w"), spec.later);
  // The bounds hold the widths the shot rig measured at 11 px (pill 243, Fold 36, Not now 55).
  assert.ok(spec.pill >= 243 && spec.fold >= 36 && spec.later >= 55, JSON.stringify(spec));
  assert.ok(textBound("\u{1F600}\u{1F600}", 400) >= 2 * 11, "wide clusters count two cells");

  // Without the hint the same ribbon keeps its chips.
  assert.equal(ribbonLayout(vm, makeCtx("graphite", s), W).level, "A");

  // Sweep: every helper count up to 64, both widths, every lead combination.
  const leads = [{}, { narrowHint: true }, { save: "Save problem" }, { pill: "Welcome back +12.4M" },
    { narrowHint: true, save: "Save problem", pill: "Welcome back +12.4M" }];
  for (const Wd of [832, 1172]) {
    for (let n = 1; n <= 34; n++) {
      for (const l of leads) {
        const v = ribbonOf(n, Wd, { save: l.save ?? null, pill: l.pill ?? null });
        // Folded panel: the welcome pill only shows then (r3-14), and its width must count.
        const c = makeCtx("paper", { width: Wd, height: 30 }, { narrowHint: Boolean(l.narrowHint), panelShown: false });
        const ly = ribbonLayout(v, c, Wd);
        const tag = `n ${n} W ${Wd} ${JSON.stringify(l)}`;
        assert.ok(ly.lead + ly.need <= ly.w, `${tag}: ${ly.lead} + ${ly.need} > ${ly.w} (level ${ly.level})`);
        const j = renderRibbon(v, {}, c).toJSON();
        const shown = ids(j).filter((id) => id.startsWith("cw-rib-m-")).length;
        const tallied = ly.tallies.reduce((a, t) => a + t.count, 0);
        assert.equal(shown + tallied, n, `${tag}: every helper has a mark or a tally`);
        if (ly.level === "C") assert.equal(shown, v.ribbon.marks.filter((m) => m.status === "blocked" || m.status === "done").length);
      }
    }
  }
  // The view's own level C (64+ at 1100) is kept, its tallies drawn.
  const big = F.scenario("ribbon-130", { window: 1100 });
  const bl = ribbonLayout(big.vm, makeCtx("graphite", big, { narrowHint: true }), big.width);
  assert.equal(bl.level, "C");
  const key = (ts) => ts.map((t) => [t.status, t.count, t.label]);
  assert.deepEqual(key(bl.tallies), key(big.vm.ribbon.tallies));
});

test("r4-07: level C never loses a helper: finished past the edge fold into '+N', then needs-you; tallies always drawn", () => {
  const leads = [{}, { narrowHint: true }, { save: "Save problem" }, { narrowHint: true, save: "Save problem", pill: "Welcome back +12.4M" }];
  for (const name of Object.keys(F.RIBBON_STRESS)) {
    const n = Object.values(F.RIBBON_STRESS[name]).reduce((a, v) => a + (typeof v === "number" && v >= 1 ? v : 0), 0);
    for (const window of [1100, 1440]) {
      const s = F.scenario(name, { window });
      for (const l of leads) {
        for (const th of THEME_NAMES) {
          const vm = { ...s.vm, ribbon: { ...s.vm.ribbon, save: l.save ?? null, pill: l.pill ?? null } };
          const ctx = makeCtx(th, s, { narrowHint: Boolean(l.narrowHint), panelShown: false });
          const ly = ribbonLayout(vm, ctx, s.width);
          const tag = `${name}@${window} ${JSON.stringify(l)} ${th}`;
          assert.ok(ly.lead + ly.need <= ly.w, `${tag}: ${ly.lead} + ${ly.need} > ${ly.w}`);
          const json = renderRibbon(vm, s.ui, ctx).toJSON();
          const shown = ids(json).filter((id) => id.startsWith("cw-rib-m-"));
          assert.equal(shown.length, ly.marks.length, `${tag}: every planned mark drawn`);
          assert.equal(shown.length + ly.tallies.reduce((a, t) => a + t.count, 0), n, `${tag}: every helper is a mark or counted`);
          for (const t of ly.tallies) {
            assert.ok(ids(json).includes(`cw-rib-tally-${t.status}`), `${tag}: tally ${t.status} drawn`);
            assert.ok(t.count > 0, `${tag}: no empty tally`);
          }
          // Needs-you outrank finished: a needs tally means no finished pip is left.
          const statuses = new Set(ly.marks.map((m) => m.status));
          if (ly.tallies.some((t) => t.status === "blocked")) assert.ok(!statuses.has("done"), `${tag}: finished fold first`);
          if (ly.level === "C") assert.ok(ly.marks.every((m) => m.status === "blocked" || m.status === "done"), tag);
          // A "+N" tally only when some of that status still has its own pip.
          for (const t of ly.tallies) {
            if (t.status !== "blocked" && t.status !== "done") continue;
            assert.equal(String(t.label).startsWith("+"), statuses.has(t.status), `${tag}: ${t.status} label ${t.label}`);
          }
        }
      }
    }
  }
  // The finding's case: 130 helpers, 100 finished or waiting, the 1100 window (W 832), panel shown.
  const s = F.scenario("ribbon-130-done", { window: 1100 });
  const ly = ribbonLayout(s.vm, makeCtx("graphite", s), s.width);
  assert.equal(ly.level, "C");
  assert.equal(ly.marks.filter((m) => m.status === "blocked").length, 10, "every needs-you helper keeps its own pip");
  assert.ok(ly.need <= ly.avail && ly.avail - ly.need < 2 * 14 + 40, `the pips fill the middle (${ly.need} of ${ly.avail})`);
  assert.deepEqual(ly.tallies.map((t) => t.status), ["done", "working", "idle"]);
  assert.match(ly.tallies[0].label, /^\+\d+$/);
  assert.match(ly.tallies[0].tooltip, /finished/);
  // Needs-you alone overflowing: the ones past the edge become '+N' (ringed like a needs-you mark), opening Needs you.
  const nd = F.scenario("ribbon-130-needs", { window: 1100 });
  const ctx = makeCtx("graphite", nd);
  const nl = ribbonLayout(nd.vm, ctx, nd.width);
  const more = nl.tallies.find((t) => t.status === "blocked");
  assert.ok(more && more.label.startsWith("+") && nl.marks.length > 0, JSON.stringify(nl.tallies));
  assert.equal(nl.marks.length + more.count, 110);
  const tree = renderRibbon(nd.vm, nd.ui, ctx);
  const pill = findNode(tree.toJSON(), "cw-rib-tally-blocked-pill");
  assert.equal(styleOf(pill, "border_color"), statusColor(ctx.T, "blocked", "chrome"));
  assert.ok((pill.styles || []).some((x) => x[0] === "border_dashed"));
  fire(tree, "cw-rib-tally-blocked", "on_click", {}, fakeCx());
  assert.deepEqual(ctx.calls, [["showGroup", "needs"]]);
});

test("r5-17: at zoom-1.5 widths the narrow hint gives way before any helper's mark or count is pushed off the ribbon", () => {
  // The defect: 1100x700 at zoom 1.5 (ribbon W 465, pip area 215) with 3
  // needing you, 1 finished, 5 working and 4 resting. The compact hint left
  // 68 px; level C (184 px of tallies) was returned anyway and the finished,
  // working and resting counts were clipped past the overflow edge.
  const base = F.scenario("ribbon-34", { window: 1100 }).vm;
  const pickMarks = (idx) => idx.map((i) => base.ribbon.marks[i]);
  const marks = pickMarks([0, 1, 2, 3, 5, 6, 7, 8, 9, 19, 20, 21, 22]);
  assert.deepEqual(marks.map((m) => m.status[0]).join(""), "bbbdwwwwwiiii");
  const W = 465;
  for (const viewLevel of [null, "A", "B"]) {
    for (const save of [null, "Save problem"]) {
      const vm = { ...base, ribbon: { ...base.ribbon, marks, tallies: [], level: viewLevel, save, pill: null } };
      const ctx = makeCtx("graphite", { width: W, height: 30 }, { narrowHint: true, panelShown: true });
      const lay = ribbonLayout(vm, ctx, W);
      const tag = `view ${viewLevel} save ${save}`;
      assert.ok(lay.need <= lay.avail, `${tag}: ${lay.need} within ${lay.avail} (level ${lay.level})`);
      assert.equal(lay.hintDropped, true, `${tag}: the hint gives way`);
      assert.ok(!lay.specs.some((x) => x.key === "hint"), tag);
      assert.equal(lay.specs.some((x) => x.key === "save"), Boolean(save), `${tag}: the save chip stays`);
      const json = renderRibbon(vm, {}, ctx).toJSON();
      assert.ok(!ids(json).includes("cw-rib-hint"), `${tag}: no hint drawn`);
      if (save) assert.ok(ids(json).includes("cw-rib-save"), `${tag}: save chip drawn`);
      const shown = ids(json).filter((id) => id.startsWith("cw-rib-m-")).length;
      assert.equal(shown + lay.tallies.reduce((a, t) => a + t.count, 0), 13, `${tag}: every helper a mark or counted`);
      for (const t of lay.tallies) assert.ok(ids(json).includes(`cw-rib-tally-${t.status}`), `${tag}: tally ${t.status}`);
    }
  }
  // Without a save chip the bare middle (215 px) holds all 13 as pips (98 px).
  const bare = ribbonLayout({ ...base, ribbon: { ...base.ribbon, marks, tallies: [], level: "A" } }, makeCtx("graphite", { width: W, height: 30 }, { narrowHint: true, panelShown: true }), W);
  assert.equal(bare.level, "B");
  assert.equal(bare.need, 98);
  // Where the hint fits it stays: W 691 holds the compact hint beside 13 chips.
  const w691 = ribbonLayout({ ...base, ribbon: { ...base.ribbon, marks, tallies: [], level: "A" } }, makeCtx("graphite", { width: 691, height: 30 }, { narrowHint: true, panelShown: true }), 691);
  assert.ok(w691.need <= w691.avail && w691.specs.some((x) => x.key === "hint") && !w691.hintDropped, JSON.stringify([w691.level, w691.need, w691.avail]));
  // No hint, no change: hintDropped only reports a hint that was offered.
  assert.equal(ribbonLayout({ ...base, ribbon: { ...base.ribbon, marks, tallies: [] } }, makeCtx("graphite", { width: W, height: 30 }), W).hintDropped, false);

  // Level C is never chosen when it is wider than level B: at W 300 (pip
  // area 50) neither fits, and C's four tallies would need more than B's pips.
  const tiny = ribbonLayout({ ...base, ribbon: { ...base.ribbon, marks, tallies: [], level: "A" } }, makeCtx("graphite", { width: 300, height: 30 }), 300);
  assert.equal(tiny.level, "B", `need ${tiny.need} avail ${tiny.avail}`);
  assert.equal(tiny.need, 98);

  // Sweep the zoom-1.5 widths (1100 and 1440 windows) with the hint, every helper count.
  const leads = [{ narrowHint: true }, { narrowHint: true, save: "Save problem" }, { narrowHint: true, pill: "Welcome back +12.4M" }];
  for (const Wd of [465, 691]) {
    for (let n = 1; n <= 34; n++) {
      for (const l of leads) {
        for (const panelShown of [true, false]) {
          const v = ribbonOf(n, Wd, { save: l.save ?? null, pill: l.pill ?? null });
          const c = makeCtx("graphite", { width: Wd, height: 30 }, { narrowHint: true, panelShown });
          const ly = ribbonLayout(v, c, Wd);
          const tag = `n ${n} W ${Wd} ${JSON.stringify(l)} shown ${panelShown}`;
          assert.ok(ly.lead + ly.need <= ly.w, `${tag}: ${ly.lead} + ${ly.need} > ${ly.w} (level ${ly.level})`);
          if (l.save) assert.ok(ly.specs.some((x) => x.key === "save"), `${tag}: save chip kept`);
          const j = renderRibbon(v, {}, c).toJSON();
          const shown = ids(j).filter((id) => id.startsWith("cw-rib-m-")).length;
          assert.equal(shown + ly.tallies.reduce((a, t) => a + t.count, 0), n, `${tag}: every helper has a mark or a tally`);
          assert.equal(ids(j).includes("cw-rib-hint"), !ly.hintDropped, `${tag}: the hint is drawn unless dropped`);
        }
      }
    }
  }
});

test("r4-07: the engine's level C and the ribbon's fit agree (no lead), at every width and mix", async () => {
  const { engine, seeded, writer, agent, observeAction, T0 } = await import("../engine/_util.mjs");
  const mixes = [[10, 90, 20, 10], [120, 4, 4, 2], [3, 60, 100, 37], [0, 140, 0, 0], [7, 5, 64, 54]];
  for (const [nb, nd, nw, ni] of mixes) {
    const st = (i) => (i < nb ? "blocked" : i < nb + nd ? "done" : i < nb + nd + nw ? "working" : "idle");
    const n = nb + nd + nw + ni;
    const s = seeded(4);
    writer(s, "wA").act(observeAction(T0, Array.from({ length: n }, (_, i) => agent(i, st(i)))));
    for (const W of [700, 832, 1172, 1652]) {
      const vm = engine.view(s, T0 + 1000, { role: "ribbon", width: W, writer: "wA" });
      const ly = ribbonLayout(vm, makeCtx("graphite", { width: W, height: 30 }), W);
      const tag = `${[nb, nd, nw, ni]} W ${W}`;
      assert.ok(ly.need <= ly.avail, `${tag}: ${ly.need} > ${ly.avail}`);
      assert.equal(vm.ribbon.marks.length + vm.ribbon.tallies.reduce((a, t) => a + t.count, 0), n, `${tag}: the view counts everyone`);
      if (vm.ribbon.level !== "C") continue;
      assert.deepEqual(ly.marks.map((m) => m.helperId), vm.ribbon.marks.map((m) => m.helperId), tag);
      const key = (ts) => ts.map((t) => [t.status, t.count, t.label, t.tooltip]);
      assert.deepEqual(key(ly.tallies), key(vm.ribbon.tallies), tag);
      // And the layout refits the view's own fit unchanged at the same width.
      assert.deepEqual(key(fitLevelC(vm.ribbon.marks, vm.ribbon.tallies, ly.avail).tallies), key(vm.ribbon.tallies), tag);
    }
  }
});

test("ribbon: the envelope marker is the envelope glyph on a sheet disc inside its chip", () => {
  const r = F.scenario("ribbon-4", { window: 1440 });
  const ctx = makeCtx("paper", r);
  const json = renderRibbon(r.vm, r.ui, ctx).toJSON();
  const withEnv = r.vm.ribbon.marks.filter((m) => m.envelope);
  assert.ok(withEnv.length > 0);
  for (const m of r.vm.ribbon.marks) {
    const chipNode = findNode(json, `cw-rib-m-${m.helperId}`);
    const marker = findNode(json, `cw-rib-env-${m.helperId}`);
    const glyph = chipNode.children.find((c) => c.kind === "svg");
    const g = m.envelope ? CHIP_GLYPH.envelope : CHIP_GLYPH.plain;
    assert.equal(styleOf(glyph, "left"), g.x);
    assert.equal(styleOf(glyph, "top"), g.y);
    assert.equal(styleOf(glyph, "w"), g.size);
    if (!m.envelope) {
      assert.equal(marker, null);
      continue;
    }
    // Inside the 20 px chip (it used to hang 3 px over the next chip).
    assert.equal(styleOf(marker, "right"), 0);
    assert.equal(styleOf(marker, "top"), 0);
    assert.equal(styleOf(marker, "w"), ENV_MARKER.size);
    assert.ok(ENV_MARKER.size <= 20 - 2, "leaves the chip's lower-left for the status glyph");
    assert.equal(styleOf(marker, "bg"), ctx.S.sheet);
    // The glyph the legend teaches (it used to be a blank dot).
    const env = (marker.children || []).find((c) => c.kind === "svg");
    assert.ok(env, "the marker holds a glyph");
    assert.equal(env.args[0], spritePath("status", "envelope"));
    assert.equal(styleOf(env, "text_color"), ctx.S.ink);
    // The disc (centre 15,5; r 5) only grazes the status glyph's box corner.
    const r5 = ENV_MARKER.size / 2;
    const dx = 20 - r5 - (g.x + g.size);
    const dy = g.y - r5;
    assert.ok(Math.hypot(dx, dy) >= r5 - 0.6, "the marker does not cover the status glyph");
  }
});

test("rail: every helper is a pip in 4 columns, the grid scrolls, the save glyph shows only with a notice", () => {
  const s = F.scenario("rail-64");
  const json = renderRail(s.vm, s.ui, makeCtx("graphite", s)).toJSON();
  const pips = ids(json).filter((id) => id.startsWith("cw-rail-pip-"));
  assert.equal(pips.length, s.vm.rail.pips.length);
  let scroll = null;
  walk(json, (n) => {
    if (n.id === "cw-rail-pips") scroll = n;
  });
  assert.ok(scroll.styles.some((st) => st[0] === "overflow_y_scrollbar"));
  assert.ok(!ids(json).includes("cw-rail-save"));
  const b = F.scenario("rail-banner");
  assert.ok(ids(renderRail(b.vm, b.ui, makeCtx("graphite", b)).toJSON()).includes("cw-rail-save"));
});

// ---------------------------------------------------------------------------
// Mat geometry

function box(node) {
  const get = (k) => node.styles.find((st) => st[0] === k)?.[1];
  return { x: get("left"), y: get("top"), w: get("w"), h: get("h") };
}
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("mat: sizes per width state, grid is two paint_path strokes, nothing overlaps the Sheet", () => {
  const std = F.scenario("standard-4");
  const g = matGeometry(std.vm, makeCtx("graphite", std));
  assert.deepEqual([g.w, g.h, g.sheet, g.sx, g.sy], [304, 232, 112, 96, 58]);
  for (const x of [15.2, 45.6, 76, 106.4, 200, 258.4, 288.8]) assert.equal(g.mapX(x), x, "standard is the identity");
  const short = F.scenario("short");
  const gs = matGeometry(short.vm, makeCtx("graphite", short));
  assert.deepEqual([gs.w, gs.h, gs.sheet, gs.sx, gs.sy], [304, 184, 96, 104, 42]);
  const wide = matGeometry(std.vm, makeCtx("graphite", std, { width: 440 }));
  assert.deepEqual([wide.w, wide.h, wide.sheet], [424, 260, 112]);
  const narrow = matGeometry(short.vm, makeCtx("graphite", short, { width: 240 }));
  assert.deepEqual([narrow.w, narrow.h, narrow.sheet], [224, 184, 96]);

  const json = renderMat(std.vm, std.ui, makeCtx("graphite", std)).toJSON();
  const paths = json.children.filter((c) => c.kind === "path");
  assert.ok(paths.length >= 3, "minor grid, major grid, edge");
  assert.equal(paths[0].args[0].fill, false);
  assert.equal(paths[1].args[0].fill, false);
  assert.equal(paths[2].args[0].fill, true);
  assert.deepEqual(paths.slice(0, 3).map((p) => p.args[1].values[0]), [pickScene(true).grid, pickScene(true).gridMajor, pickScene(true).matEdge]);
  const storm = F.scenario("storm");
  const sj = renderMat(storm.vm, storm.ui, makeCtx("graphite", storm)).toJSON();
  const stripes = sj.children.find((c) => c.id === "cw-storm");
  assert.equal(stripes.args[1].kind, "pattern-slash");
  const sheetIndex = sj.children.findIndex((c) => c.id === "cw-sheet");
  assert.ok(sj.children.indexOf(stripes) < sheetIndex, "stripes paint under the play pieces");
  assert.ok(sj.children.findIndex((c) => c.id === "cw-crease-line") < sheetIndex);

  const piece = /^cw-(node|scrap|ream|crane)/;
  for (const s of SCENARIOS) {
    if (s.role !== "panel" || s.width < RAIL_BELOW) continue;
    for (const width of [s.width, 240, 320, 440]) {
      const mj = renderMat(s.vm, s.ui, makeCtx("graphite", s, { width })).toJSON();
      const sheet = box(mj.children.find((c) => c.id === "cw-sheet"));
      const gw = matGeometry(s.vm, makeCtx("graphite", s, { width }));
      for (const c of mj.children) {
        if (!c.id || !piece.test(c.id)) continue;
        const b = box(c);
        assert.ok(!overlap(b, sheet), `${s.name} @${width}: ${c.id} ${JSON.stringify(b)} overlaps the Sheet ${JSON.stringify(sheet)}`);
        assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= gw.w + 0.5 && b.y + b.h <= gw.h + 0.5, `${s.name} @${width}: ${c.id} inside the mat`);
      }
    }
  }
});

test("tray: at most 6 envelopes, then +n; the drawn count shrinks to fit narrow mats", () => {
  const s = F.scenario("tray-full");
  const count = (width) => ids(renderMat(s.vm, s.ui, makeCtx("graphite", s, { width })).toJSON()).filter((id) => /^cw-env-[0-9a-f]+$/.test(id)).length;
  assert.equal(count(320), 6);
  assert.ok(count(240) < 6 && count(240) >= 1);
  assert.equal(count(440), 6);
});

// ---------------------------------------------------------------------------
// Banner and away card

test("banner: one per banner notice kind, text in T.foreground, tints through withAlpha, Details card", () => {
  for (const kind of F.BANNER_KINDS) {
    const s = F.scenario(`banner-${kind}`);
    for (const th of THEME_NAMES) {
      const ctx = makeCtx(th, s);
      const lay = bannerLayout(s.vm, s.ui, ctx);
      assert.ok(lay && lay.h >= 28, kind);
      const json = renderBanner(s.vm, s.ui, ctx).toJSON();
      let words = 0;
      walk(json, (n) => {
        if (n.id === "cw-banner-text") {
          for (const c of n.children) {
            assert.equal(c.styles.find((st) => st[0] === "text_color")[1], THEMES[th].foreground, `${kind} ${th}: text is T.foreground`);
            words++;
          }
        }
      });
      assert.ok(words >= 1);
      assert.equal(ids(json).includes("cw-banner-details"), Boolean(s.ui.details), kind);
    }
  }
  assert.equal(renderBanner(F.viewModel("standard-4"), {}, makeCtx("graphite", F.scenario("standard-4"))), null);
  assert.equal(bannerNotices({ notices: [{ kind: "away", text: "x", place: "footer" }] }).length, 0);
  assert.equal(middleClip("/home/me/.config/herdr-app/creaseworks/save.json", 20), "/home/me/.…save.json");
  assert.equal(middleClip("short.json", 20), "short.json");
  assert.equal(graphemes(middleClip("👩‍💻".repeat(30), 9)).length, 9);
});

test("away card: lines from the vm, Collect only for the away kind", () => {
  const a = F.viewModel("away").away;
  const L = awayLines(a);
  assert.equal(L.title, "While you were away");
  assert.equal(L.envelopes, "9 envelopes waiting on the tray");
  assert.equal(L.needs, "2 helpers need you: Hali, Yuki");
  assert.equal(L.best, "Best helper: Moto the owl, 31 tasks");
  assert.equal(L.affordable, "You can afford: Washi Vat, Echo Crease II");
  const ready = awayLines({ ...a, needsText: "ready line" });
  assert.equal(ready.needs, "ready line", "B10 ready lines win");
  const busy = awayLines(F.viewModel("busy").away);
  assert.equal(busy.title, "While you were busy");
  assert.equal(renderAway({ away: null }, {}, makeCtx("graphite", F.scenario("away"))), null);
});

// ---------------------------------------------------------------------------
// Text: clipped, ≥ 11 px

const FREE_TEXT = new Set([
  "name", "text", "tooltip", "label", "folds", "rate", "duration", "title", "statusWord", "leftAgo", "count", "pill", "empty",
  "save", "capText", "splitText", "envelopesText", "needsText", "restedText", "bestText", "affordableText", "tasksText",
]);
const LONG = "Ünïcödé 👩‍💻🇯🇵 ".repeat(40);

function inflate(v, key) {
  if (typeof v === "string") return FREE_TEXT.has(key) ? LONG + v : v;
  if (Array.isArray(v)) return v.map((x) => inflate(x, key));
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = inflate(x, k);
    return out;
  }
  return v;
}

/** Limit per subtree id prefix; anything else ≤ 140 graphemes. */
const LIMITS = [
  [/^cw-chip-/, MAT_CLIP.chip],
  [/^cw-hdr$/, 20],
  [/^cw-rib-left$/, 10],
  [/^cw-rail$/, 9],
  [/^cw-mat-bottom$/, 8],
  [/^cw-boostbar$/, 32],
  [/^cw-foot$/, 60],
];

test("every text node is clipped (inflated vm strings) and no text is below 11 px", () => {
  const views = ["standard-4", "needs-you-3", "tray-full", "storm", "away", "busy", "banner-error", "banner-fresh", "rail", "rail-banner", "in-step"];
  const surfaces = [];
  for (const name of views) surfaces.push(F.scenario(name));
  surfaces.push(F.scenario("ribbon-4", { window: 1100 }), F.scenario("ribbon-130", { window: 1440 }));
  for (const s0 of surfaces) {
    const s = { ...s0, vm: inflate(s0.vm, ""), ui: { ...s0.ui, pops: [{ id: "x", label: LONG, x: 10, y: 10, risen: false }] } };
    const ctx = makeCtx("graphite", s);
    const json = renderScenario(s, ctx).toJSON();
    let texts = 0;
    allNodes(json, (n, path) => {
      if (path.includes("cw-content")) return; // the tab renderers' own test covers their text
      if (n.kind === "text") {
        texts++;
        const len = graphemes(n.text).length;
        let limit = 140;
        for (const [re, lim] of LIMITS) if (path.some((id) => re.test(id))) limit = Math.min(limit, lim);
        assert.ok(len <= limit, `${s.name}: text in ${path.at(-1)} has ${len} graphemes (limit ${limit}): ${n.text.slice(0, 40)}`);
        return;
      }
      for (const st of n.styles || []) {
        if (st[0] === "text_size") assert.ok(st[1] >= 11, `${s.name}: text_size ${st[1]} in ${n.id ?? path.at(-1)}`);
        if (st[0] === "tooltip") assert.ok(graphemes(st[1]).length <= 140, `${s.name}: tooltip of ${n.id} is ${graphemes(st[1]).length} graphemes`);
      }
    });
    assert.ok(texts >= 2, s.name);
  }
});

// ---------------------------------------------------------------------------
// Render time

test("render time per fixture (Node, mock gpui; the hard budget is 50 ms per render)", () => {
  const rows = [];
  for (const s of SCENARIOS) {
    const ctx = makeCtx("graphite", s);
    renderScenario(s, ctx); // warm
    const t0 = performance.now();
    const N = 5;
    for (let i = 0; i < N; i++) renderScenario(s, ctx);
    const ms = (performance.now() - t0) / N;
    rows.push([s.name, ms]);
    assert.ok(ms < 50, `${s.name}: ${ms.toFixed(2)} ms per render`);
  }
  rows.sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((a, r) => a + r[1], 0);
  console.log(`# render ms (mean of 5): slowest ${rows.slice(0, 5).map(([n, ms]) => `${n} ${ms.toFixed(2)}`).join(", ")}; mean ${(total / rows.length).toFixed(2)} over ${rows.length} fixtures`);
});

// ---------------------------------------------------------------------------
// QuickJS-ng (herdr's runtime): load and render 64-helper views in the sandbox

const FROZEN_REALM = Object.isFrozen(Object.prototype);

test("qjs: the frame modules load under the sandbox and render 64 helpers within budget", {
  skip: FROZEN_REALM && "quickjs-emscripten does not load with frozen prototypes",
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), "cw-panel-"));
  try {
    cpSync(join(root, "mods/creaseworks/engine"), join(dir, "engine"), { recursive: true });
    mkdirSync(join(dir, "ui"));
    for (const f of readdirSync(UI)) if (f.endsWith(".js")) copyFileSync(join(UI, f), join(dir, "ui", f));
    for (const n of missingTabs) {
      const fn = "render" + n[0].toUpperCase() + n.slice(1);
      writeFileSync(join(dir, "ui", `${n}.js`), `import { div } from "gpui-kit";\nexport function ${fn}() { return div().id("stub-${n}").child("stub"); }\n`);
    }
    const views = [F.scenario("flock-64-dense"), F.scenario("rail-64"), F.scenario("ribbon-64", { window: 1100 }), F.scenario("away"), F.scenario("storm")];
    writeFileSync(join(dir, "main.js"), [
      'import { View } from "gpui-kit";',
      'import { v_flex } from "gpui-base";',
      'import { pickScene, pickHues } from "./ui/palette.js";',
      'import { renderPanel } from "./ui/panel.js";',
      'import { renderRibbon } from "./ui/ribbon.js";',
      `const T = ${JSON.stringify(THEMES.graphite)};`,
      `const VIEWS = ${JSON.stringify(views)};`,
      // One copy per render, in turn (a real panel or ribbon renders one copy):
      // five 64-helper copies in one render measured the test, not the game,
      // and left under 10 ms of the 50 ms budget (it flaked).
      "export default class M extends View {",
      "  render() {",
      "    const k = this.k ?? 0;",
      "    this.k = k + 1;",
      "    const s = VIEWS[k % VIEWS.length];",
      "    const ctx = { T, S: pickScene(true), hues: pickHues(true), zoom: 1, calm: false, width: s.width, height: s.height, handlers: {} };",
      "    return v_flex().id(\"m\").child((s.role === \"ribbon\" ? renderRibbon : renderPanel)(s.vm, s.ui, ctx));",
      "  }",
      "}",
      "",
    ].join("\n"));
    const host = await createHost({ modRoot: dir, scenario: {} });
    try {
      const load = await host.load();
      // First pass: every copy cold (the harness itself throws a BudgetError
      // past herdr's 50 ms render interrupt). Second pass: warm, each with
      // real headroom under the budget.
      const cold = [];
      const warm = [];
      for (const pass of [cold, warm]) {
        for (let k = 0; k < views.length; k++) {
          const { tree, ms } = host.render();
          assert.equal(tree.id, "m");
          assert.equal(tree.children.length, 1);
          pass.push(ms);
        }
      }
      assert.deepEqual(host.errors, []);
      const fmt = (xs) => xs.map((x) => x.toFixed(1)).join(", ");
      console.log(`# qjs: module graph ${JSON.stringify(load.ms ?? load)}; one 64-helper copy a render: cold ${fmt(cold)} ms, warm ${fmt(warm)} ms`);
      for (let k = 0; k < views.length; k++) {
        assert.ok(cold[k] < 50, `${views[k].name} cold render ${cold[k]} ms`);
        assert.ok(warm[k] < 35, `${views[k].name} warm render ${warm[k]} ms (wants 15 ms of headroom under the 50 ms budget)`);
      }
    } finally {
      host.dispose();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Review r3 fixes on the away card and the ribbon

/** Every text node under `json`. */
function textsOf(json) {
  const out = [];
  const visit = (n) => {
    if (n && n.kind === "text") out.push(n.text);
    for (const k of (n && n.children) || []) if (k && typeof k === "object") visit(k);
  };
  visit(json);
  return out;
}

test("r3-13: the away card's ✕ says closing collects the folds (dismiss 'away' credits the pot)", async () => {
  const a = F.scenario("away");
  const json = renderAway(a.vm, a.ui, makeCtx("graphite", a)).toJSON();
  const close = findNode(json, "cw-away-close");
  assert.equal(styleOf(close, "tooltip"), AWAY_CLOSE.away);
  assert.match(AWAY_CLOSE.away, /collect/i);
  assert.doesNotMatch(AWAY_CLOSE.away, /stay/i, "the folds do not stay: dismiss collects them");
  // The engine really collects on dismiss: nothing is left to Collect afterwards.
  const E = await import("../../mods/creaseworks/engine/index.js");
  const T0 = Date.UTC(2026, 10, 25, 9);
  const s = E.newGame({ seed: 3, now: T0, day: "2026-11-25" });
  let seq = 0;
  const act = (x) => E.apply(s, { w: "w-r313close01", s: ++seq, ...x });
  for (let i = 0; i < 50; i++) act({ t: T0 + i * 100, type: "click" });
  E.advance(s, T0 + 3 * 3600000, "w-r313close01");
  assert.ok(s.away.pot, "three hours away leave a pot");
  act({ t: T0 + 3 * 3600000 + 10, type: "dismiss", notice: "away" });
  assert.equal(s.away.pot, null, "closing the card collected the pot");
  assert.deepEqual(act({ t: T0 + 3 * 3600000 + 20, type: "collect" }).map((e) => e.kind), ["ignored"], "nothing is left to Collect");
  const busy = F.scenario("busy");
  assert.equal(styleOf(findNode(renderAway(busy.vm, busy.ui, makeCtx("graphite", busy)).toJSON(), "cw-away-close"), "tooltip"), AWAY_CLOSE.busy);
});

test("r3-14: the 'Welcome back' pill hides only beside the full panel's away card; a tight rail or no word from the glue keeps it", () => {
  const W = 1172;
  const vm = ribbonOf(4, W, { pill: "Welcome back +4.81M" });
  const s = { width: W, height: 30 };
  const full = renderRibbon(vm, {}, makeCtx("graphite", s, { panelShown: true, panelFull: true })).toJSON();
  assert.ok(!ids(full).includes("cw-rib-welcome"), "no pill beside the full panel's own away card");
  assert.equal(ribbonLayout(vm, makeCtx("graphite", s, { panelShown: true, panelFull: true }), W).lead, 0, "and no width reserved for it");
  // The glue's ribbon ctx today sets panelShown (true for a tight rail too,
  // which has no away card) and no panelFull: the pill must stay, or the away
  // news would show nowhere.
  for (const over of [{ panelShown: true }, { panelShown: true, panelFull: false }, { panelShown: true, narrowHint: true }, { panelShown: false }, {}]) {
    const json = renderRibbon(vm, {}, makeCtx("graphite", s, { panelShown: false, ...over })).toJSON();
    assert.ok(ids(json).includes("cw-rib-welcome"), `${JSON.stringify(over)}: the pill`);
    assert.ok(ribbonPill(vm, over), JSON.stringify(over));
    assert.ok(ribbonLayout(vm, makeCtx("graphite", s, { panelShown: false, ...over }), W).lead > 0, `${JSON.stringify(over)}: its width reserved`);
  }
  const folded = renderRibbon(vm, {}, makeCtx("graphite", s, { panelShown: false })).toJSON();
  assert.equal(styleOf(findNode(folded, "cw-rib-welcome"), "tooltip"), "Open Creaseworks to collect");
  assert.equal(ribbonPill(vm, { panelShown: false, panelFull: true }), null);
  assert.ok(ribbonPill(vm, { panelFull: "yes" }), "only a real true hides it");
  assert.ok(ribbonPill(vm, null));
  // A flash shares the pill (and the footer) whether the panel shows or not.
  const fl = { ...vm, ribbon: { ...vm.ribbon, pill: "Nobody needs you" }, notices: [{ kind: "flash", text: "Nobody needs you", actions: [], place: "footer", save: false }] };
  const fj = renderRibbon(fl, {}, makeCtx("graphite", s, { panelShown: true, panelFull: true })).toJSON();
  assert.ok(ids(fj).includes("cw-rib-welcome"));
  assert.equal(styleOf(findNode(fj, "cw-rib-welcome"), "tooltip"), "Nobody needs you", "a flash's tooltip is its own text");
  assert.deepEqual(ribbonPill(fl, { panelShown: true, panelFull: true }), { text: "Nobody needs you", flash: true });
});

test("r3-23: the compact narrow hint names the panel ('Fold panel'), never a bare 'Fold' without its question", () => {
  // 1440×900 at zoom 1.5: twelve helpers at level C do not fit beside the full hint.
  const W = 640;
  const vm = ribbonOf(12, W);
  const ctx = makeCtx("graphite", { width: W, height: 30 }, { narrowHint: true });
  const lay = ribbonLayout(vm, ctx, W);
  assert.ok(lay.compact, "the compact lead is chosen");
  const json = renderRibbon(vm, {}, ctx).toJSON();
  const fold = findNode(json, "cw-rib-hint-fold");
  assert.ok(textsOf(fold).includes(HINT_FOLD.compact), textsOf(fold).join("|"));
  assert.ok(!textsOf(json).includes("Fold"), "no bare 'Fold' next to the fold count");
  assert.match(styleOf(fold, "tooltip") ?? textsOf(json).join(" "), /narrow/i, "the question is in the tooltip");
  const spec = lay.specs.find((x) => x.key === "hint");
  assert.equal(styleOf(fold, "w"), spec.fold);
  assert.ok(spec.fold >= 14 + textBound(HINT_FOLD.compact, 600), "its width fits the longer label");
  // With room, the full hint keeps its question beside a plain "Fold".
  const wide = renderRibbon(ribbonOf(4, 1172), {}, makeCtx("graphite", { width: 1172, height: 30 }, { narrowHint: true })).toJSON();
  assert.ok(textsOf(wide).some((t) => /narrow/.test(t)));
  assert.ok(textsOf(findNode(wide, "cw-rib-hint-fold")).includes(HINT_FOLD.full));
});

test("r3-21: win98's needs-you glyph keeps its red on the away card and the ribbon save chip (a white disc, not #404040)", () => {
  const T = THEMES.win98;
  const disc = statusDisc(T);
  assert.notEqual(disc, T.popover.toLowerCase(), "win98 red fails 3:1 on #c0c0c0, so another surface");
  for (const st of ["blocked", "working", "done", "idle"]) {
    assert.ok(contrast(T[st], disc) >= 3, `${st} reads on the disc`);
    assert.equal(statusColor(T, st, disc), T[st].toLowerCase(), `${st} keeps its own colour`);
  }
  const a = F.scenario("away");
  const json = renderAway(a.vm, a.ui, makeCtx("win98", a)).toJSON();
  const colours = [];
  walk(json, (n) => {
    const c = styleOf(n, "text_color");
    if (c) colours.push(c);
  });
  assert.ok(colours.includes(T.blocked.toLowerCase()), "the needs line's pennant is red");
  // Graphite (red passes on its popover) is unchanged: glyph straight on the card.
  assert.equal(statusDisc(THEMES.graphite), THEMES.graphite.popover);
  // The ribbon save chip: on the disc, its warn icon in the needs-you colour.
  const vm = ribbonOf(4, 1172, { save: "Save problem" });
  const rj = renderRibbon(vm, {}, makeCtx("win98", { width: 1172, height: 30 })).toJSON();
  const pill = findNode(rj, "cw-rib-save-pill");
  assert.equal(styleOf(pill, "bg"), disc);
  const icons = [];
  walk(pill, (n) => {
    const c = styleOf(n, "text_color");
    if (c) icons.push(c);
  });
  assert.ok(icons.includes(T.blocked.toLowerCase()), icons.join(","));
});

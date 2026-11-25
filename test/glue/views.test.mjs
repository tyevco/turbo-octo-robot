// glue/views.js (ARCHITECTURE A10; DESIGN §15.3): the screenshot table covers
// every listed view (ribbon-* at 1100 and 1440), has the shape
// tools/shots/shoot.mjs validates, and every view runs as a REAL game through
// the rig's own runView (mock herdr + mock gpui, no browser) in both themes
// without errors, showing what it is named for.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { runView, validateViews, entryForBlock, viewDocument, launchBrowser } from "../../tools/shots/shoot.mjs";
import VIEWS, { windowScenario } from "../../mods/creaseworks/glue/views.js";
import Creaseworks from "../../mods/creaseworks/main.js";
import { dropSlot, getSlot } from "../../mods/creaseworks/glue/live.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function designNames() {
  const design = readFileSync(join(root, "docs/DESIGN.md"), "utf8");
  const line = design.slice(design.indexOf("views listed in `glue/views.js`"), design.indexOf("each in **all six shipped themes**"));
  const out = [];
  for (const m of line.matchAll(/`([a-z0-9-]+)(?:-\{([a-z0-9,]+)\})?`/g)) {
    if (m[1] === "glue") continue;
    if (m[2]) for (const s of m[2].split(",")) out.push(`${m[1]}-${s}`);
    else out.push(m[1]);
  }
  return out;
}

test("the table covers every DESIGN §15.3 view and passes the rig's validation", () => {
  validateViews(VIEWS, "views.js");
  const names = new Set(VIEWS.map((v) => v.name));
  const listed = designNames();
  assert.ok(listed.length >= 45);
  for (const n of listed) {
    if (n.startsWith("ribbon-")) {
      for (const w of [1100, 1440]) assert.ok(names.has(`${n}-${w}`), `${n}-${w}`);
    } else {
      assert.ok(names.has(n), n);
    }
  }
  assert.equal(entryForBlock(VIEWS, "cw-panel").name, "flock-12");
  assert.equal(entryForBlock(VIEWS, "cw-ribbon").name, "ribbon-window");
  assert.ok(Array.isArray(windowScenario.agents) && windowScenario.agents.length === 12);
  for (const v of VIEWS) {
    const s = v.scenario;
    assert.equal(s.patchDate, true, `${v.name}: the glue clock reads the virtual clock`);
    assert.match(s.appHome, new RegExp(`/shots/${v.name}/`), `${v.name}: its own app home`);
    JSON.stringify(s);
  }
});

/** Runs one entry through the rig; returns the vm and slot the render used. */
async function shoot(entry, themeName) {
  let vm;
  let slot;
  let role;
  let game;
  const wrapped = {
    name: entry.name,
    size: entry.size,
    scenario: entry.scenario,
    async setup(view, tools) {
      await entry.setup(view, tools);
      await tools.flush();
      vm = view.session.vm();
      slot = view.session.slot;
      role = view.session.role;
      const st = getSlot().state;
      game = { bank: st.bank, lifetime: st.lifetime, workshops: Object.values(st.owned || {}).reduce((a, n) => a + (Number(n) || 0), 0) };
    },
  };
  const result = await runView(Creaseworks, wrapped, themeName, { mod: "creaseworks" });
  return { ...result, vm, slot, role, game };
}

const CHECKS = {
  empty: (r) => r.vm.helpers.empty === true,
  "first-run": (r) => r.vm.sheet.firstRunHint === true,
  "standard-4": (r) => r.vm.helpers.groups.reduce((a, g) => a + g.count, 0) === 4 && r.vm.tray.envelopes.length === 2,
  "needs-you-3": (r) => r.vm.header.counts.needs === 3 && r.vm.mat.chips.length === 3,
  "finished-2": (r) => r.vm.header.counts.finished === 2,
  "tray-full": (r) => r.vm.tray.envelopes.length + r.vm.tray.more === 10 && r.vm.tray.more > 0,
  storm: (r) => r.vm.mat.storm === true && r.vm.boosts.some((b) => b.type === "storm"),
  crane: (r) => !!r.vm.mat.crane,
  boat: (r) => !!r.vm.mat.boat,
  "chain-7": (r) => r.vm.mat.nodes.length >= 5 && r.vm.mat.nodes.at(-1).i === 7,
  "in-step": (r) => r.vm.streak.inStep === true,
  // Needs you counts waiting fledglings too (r2-17): twelve agents plus those.
  "flock-12": (r) => r.vm.header.counts.needs - r.vm.header.kidsWaiting + r.vm.header.counts.finished + r.vm.header.counts.working + r.vm.header.counts.resting === 12,
  "flock-64-dense": (r) => r.vm.helpers.dense === true,
  "flock-elsewhere": (r) => r.vm.helpers.elsewhere.length === 4,
  album: (r) => r.vm.helpers.album.length === 9,
  "string-locked": (r) => r.vm.string.can === false && r.vm.string.cranes > 0,
  "string-ready": (r) => r.vm.string.can === true,
  // r1-29: several sources per garland (helpers, your hands, workshops), not one "everyone else" bar.
  // r2-23: and the String at rest, past the last wish's moment (its rise draws the strands at opacity 0).
  garlands: (r) => r.vm.string.garlands.length >= 3 &&
    r.vm.string.garlands.every((g) => g.stripes.filter((st) => st[1] > 0).length >= 5 && g.stripes.some((st) => st[0] === "hands" && st[1] > 0)) &&
    r.vm.string.wishMoment === null && r.vm.string.cranes > 0,
  // r2-23: a fresh start shows a new game (a few Sheet hits), not a stocked mid-game under the banner.
  "banner-fresh": (r) => r.game.lifetime < 100 && r.game.workshops === 0 && r.vm.string.cranes === 0,
  settings: (r) => r.vm.settings.notify.master === true,
  away: (r) => r.vm.away && r.vm.away.kind === "away",
  busy: (r) => r.vm.away && r.vm.away.kind === "busy",
  narrow: (r) => r.vm.sheet.short === true,
  "narrow-files": (r) => r.vm.sheet.short === true,
  short: (r) => r.vm.sheet.short === true,
  calm: (r) => r.vm.calm === true,
  "rail-banner": (r) => r.vm.rail.save !== null,
};

test("every view runs as a real game in graphite and paper, shows what it is named for", async () => {
  for (const entry of VIEWS) {
    for (const themeName of ["graphite", "paper"]) {
      const r = await shoot(entry, themeName);
      assert.equal(r.errors.length, 0, `${entry.name}/${themeName}: ${r.errors.map((e) => e.message).join("; ")}`);
      assert.equal(r.tree.id, "root", entry.name);
      assert.ok(r.vm, `${entry.name}: loaded`);
      const kind = /^banner-(.+)$/.exec(entry.name);
      if (kind) {
        const n = r.vm.notices[0];
        assert.equal(n && n.kind, kind[1], `${entry.name}: the real store / engine raised it`);
      }
      if (CHECKS[entry.name]) assert.ok(CHECKS[entry.name](r), `${entry.name}/${themeName}`);
      if (entry.name.startsWith("ribbon-") && entry.name !== "ribbon-window") {
        const n = Number(entry.name.split("-")[1]);
        assert.equal(r.role, "ribbon");
        const total = r.vm.ribbon.marks.length + r.vm.ribbon.tallies.reduce((a, t) => a + t.count, 0);
        assert.equal(total, n, `${entry.name}: one mark per helper`);
      }
      if (themeName === "paper") assert.equal(r.vm.rev >= 0, true);
    }
  }
  dropSlot();
});

/** Every text run of a serialised tree, in order. */
function treeTexts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.kind === "text") out.push(node.text);
  for (const child of node.children ?? []) treeTexts(child, out);
  return out;
}

// r4-16: ARCHITECTURE shoots every view at zoom 1 and 1.5, so both must show the
// same moment. The rig used to resize after setup and run one more virtual
// second, which let the conflict merge finish (no banner at 1.5) and moved
// clocks, saves and multipliers; and setup ran 2/3 as wide at 1.5.
test("zoom 1 and 1.5 shots show the same moment: same text, notices and width", async () => {
  for (const entry of VIEWS) {
    const at = {};
    for (const zoom of [1, 1.5]) {
      let width;
      let notices;
      const wrapped = {
        name: entry.name,
        size: entry.size,
        scenario: entry.scenario,
        async setup(view, tools) {
          assert.equal(tools.zoom, zoom, "the rig tells setup the zoom");
          await entry.setup(view, tools);
          width = view.session.width;
          notices = JSON.stringify(view.session.vm().notices);
        },
      };
      const r = await runView(Creaseworks, wrapped, "graphite", { mod: "creaseworks", zoom });
      assert.equal(r.errors.length, 0, `${entry.name}@${zoom}: ${r.errors.map((e) => e.message).join("; ")}`);
      at[zoom] = { texts: treeTexts(r.tree), width, notices };
    }
    assert.equal(at[1].width, entry.size.width, `${entry.name}: setup runs at the view's width`);
    assert.equal(at[1.5].width, entry.size.width, `${entry.name}: setup runs at the view's logical width at zoom 1.5 too`);
    assert.equal(at[1.5].notices, at[1].notices, `${entry.name}: same notices at both zooms`);
    assert.deepEqual(at[1.5].texts, at[1].texts, `${entry.name}: same text at both zooms`);
  }
  const conflict = VIEWS.find((v) => v.name === "banner-conflict");
  const r = await runView(Creaseworks, conflict, "graphite", { mod: "creaseworks", zoom: 1.5 });
  const texts = treeTexts(r.tree);
  assert.ok(texts.includes("Another window changed the save."), "the conflict banner shows at zoom 1.5");
  assert.ok(!texts.includes("Saved just now"), "the merge has not finished at zoom 1.5");
  dropSlot();
});

test("whole windows run every game block as copies of one window: expanded, folded and hidden", async () => {
  const { runWindowCopies, WINDOW_STATES } = await import("../../tools/shots/shoot.mjs");
  const { parseLayout } = await import("../../tools/render/window.mjs");
  const find = (n, id) => (!n || typeof n !== "object" ? null : n.id === id ? n : (n.children ?? []).reduce((a, c) => a ?? find(c, id), null));
  const target = { mod: "creaseworks", Class: Creaseworks, views: VIEWS };
  const base = JSON.parse(readFileSync(join(root, "layouts/Creaseworks.json"), "utf8"));
  const seen = {};
  for (const state of WINDOW_STATES.filter((s) => s.name !== "files")) {
    const layout = parseLayout(base);
    state.edit(layout, { panel: "cw-panel", ribbon: "cw-ribbon" });
    try {
      const r = await runWindowCopies(Creaseworks, target, "graphite", { width: 1440, height: 900 }, layout);
      assert.deepEqual(r.errors, [], state.label);
      seen[state.label] = {
        panel: r["cw-panel"] ? (find(r["cw-panel"].tree, "cw-rail") ? "rail" : find(r["cw-panel"].tree, "cw-panel") ? "panel" : "?") : "none",
        mini: Boolean(find(r["cw-ribbon"].tree, "cw-rib-mini")),
      };
    } finally {
      dropSlot();
    }
  }
  // The ribbon's mini Sheet shows only while the panel is folded or hidden (§3.10): the copies share one slot.
  assert.deepEqual(seen, {
    expanded: { panel: "panel", mini: false },
    "panel folded to the rail": { panel: "rail", mini: true },
    "panel hidden": { panel: "none", mini: true },
  });
});

// r1-29: a shot must show what it is named for. Laid out by chromium (as the rig
// does), the garlands view's "one per wish" stripes sit inside the scrolling
// content area, above the footer, in both themes and at zoom 1.5.
let browser = null;
let noBrowser = false;
try {
  browser = await launchBrowser();
} catch (error) {
  noBrowser = `chromium cannot launch: ${String(error.message).split("\n")[0]}`;
}
test.after(async () => {
  if (browser) await browser.close();
});

test("the garlands shot shows every garland stripe above the fold", { skip: noBrowser }, async () => {
  const entry = VIEWS.find((v) => v.name === "garlands");
  const dir = mkdtempSync(join(tmpdir(), "garlands-"));
  try {
    for (const zoom of [1, 1.5]) {
      for (const themeName of ["graphite", "paper"]) {
        const result = await runView(Creaseworks, entry, themeName, { mod: "creaseworks", zoom });
        assert.deepEqual(result.errors, []);
        const file = join(dir, `${themeName}-${zoom}.html`);
        writeFileSync(file, viewDocument(result, entry, []));
        const page = await browser.newPage({ viewport: { width: entry.size.width * zoom, height: entry.size.height * zoom } });
        try {
          await page.goto(pathToFileURL(file).href);
          const box = await page.evaluate(() => {
            const at = (id) => {
              const e = document.querySelector(`[data-id="${id}"]`);
              return e ? e.getBoundingClientRect().toJSON() : null;
            };
            const stripes = [...document.querySelectorAll('[data-id^="cw-string-g"]')].filter((e) => /^cw-string-g\d+$/.test(e.dataset.id));
            return { content: at("cw-content"), garlands: at("cw-string-garlands"), stripes: stripes.map((e) => e.getBoundingClientRect().toJSON()) };
          });
          const at = `${themeName} zoom ${zoom}`;
          assert.ok(box.content && box.garlands, `${at}: the String tab and its garlands render`);
          assert.ok(box.stripes.length >= 3, `${at}: ${box.stripes.length} garlands`);
          const parts = await page.evaluate(() => document.querySelectorAll('[data-id^="cw-string-g"][data-id*="-s"]').length);
          assert.ok(parts >= 5 * box.stripes.length, `${at}: ${parts} coloured parts`);
          for (const r of [box.garlands, ...box.stripes]) {
            assert.ok(r.top >= box.content.top - 0.5 && r.bottom <= box.content.bottom + 0.5, `${at}: ${JSON.stringify(r)} outside the content area ${JSON.stringify(box.content)}`);
          }
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    dropSlot();
  }
});

// The save banner's Details card with the real store behind it (review r1-13;
// DESIGN §3.8, §12.2): after "Save and backup were damaged", the card says the
// backup is damaged (not "present"), and the kept file names sit on their own
// wrapping row with every name in its tooltip, never clipped off the Backup
// line. The card's height (bannerLayout.detailsH) grows with that row.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { walk } from "../../tools/mock/gpui-kit.js";
import { win, SAVE, BAK, saveText, freshState } from "../glue/_util.mjs";
import * as F from "../fixtures/vm-fixtures.mjs";
import { renderSettings, saveRowPx } from "../../mods/creaseworks/ui/settings.js";
import { cellsFor } from "../../mods/creaseworks/ui/flock.js";
import { renderBanner, bannerLayout, detailsText, detailsHeight, backupTip, DETAILS_H, KEPT_ROWS, BANNER_CLIP } from "../../mods/creaseworks/ui/banner.js";
import { graphemes, cellWidth } from "../../mods/creaseworks/engine/index.js";

let w;
afterEach(() => w && w.dispose());

function find(json, id) {
  let hit = null;
  walk(json, (n) => {
    if (!hit && n.id === id) hit = n;
  });
  return hit;
}

/** Every text run under `node`, in order. */
function texts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.kind === "text") out.push(node.text);
  for (const c of node.children || []) texts(c, out);
  return out;
}

const style = (node, name) => node.styles.find((s) => s[0] === name);

test("save and backup damaged: Details says the backup is damaged and lists both kept files in full", async () => {
  w = win({ files: { [SAVE]: '"old shape"', [BAK]: "[]" } });
  const v = await w.copy("panel");
  await w.flush();
  await w.handler(v, "details", true);
  const vm = v.session.vm();
  const ctx = v.session.ctx();
  const ui = v.session.ui;
  assert.equal(vm.notices[0].kind, "fresh");
  assert.equal(ctx.save.backup, "damaged");
  const lay = bannerLayout(vm, ui, ctx);
  assert.equal(lay.detailsH, detailsHeight(ctx));
  assert.ok(lay.detailsH > DETAILS_H, "the card grows for the kept row");
  const json = renderBanner(vm, ui, ctx).toJSON();
  const card = find(json, "cw-banner-details");
  const lines = texts(card);
  assert.ok(lines.includes("Backup: damaged"), lines.join(" | "));
  assert.ok(!lines.some((l) => /present/.test(l)), "never 'present' for a damaged backup");
  assert.ok(!lines.some((l) => l.startsWith("Backup:") && /kept/.test(l)), "kept names are not on the Backup line");
  const kept = find(json, "cw-banner-kept");
  assert.ok(kept, "a kept row");
  assert.deepEqual(texts(kept), ["Kept aside: save.damaged-1.json, save.damaged-2.json"]);
  assert.ok(style(kept, "whitespace_normal"), "it wraps");
  assert.ok(!style(kept, "truncate"), "it is not truncated to one line");
  assert.equal(style(kept, "tooltip")[1], "Kept aside: save.damaged-1.json, save.damaged-2.json");
  assert.equal(style(card, "h")[1], lay.detailsH - 4, "drawn at the height the panel reserves");
});

test("Details without kept files keeps the 3-row card; many kept files are clipped with all names in the tooltip", () => {
  const T = { raised: "#202020", border: "#303030", muted: "#909090", foreground: "#ffffff" };
  const none = { T, width: 320, save: { path: "/a/save.json", lastGood: "09:00", backup: "rotated 09:00", damaged: [] } };
  assert.equal(detailsText(none).kept, null);
  assert.equal(detailsHeight(none), DETAILS_H);
  const names = [1, 2, 3, 4, 5].map((n) => `save.damaged-${n}.json (reset)`);
  const many = { T, width: 240, save: { ...none.save, damaged: names } };
  const d = detailsText(many);
  assert.ok(graphemes(d.kept).length <= BANNER_CLIP.kept);
  assert.ok(d.keptRows >= 2 && d.keptRows <= KEPT_ROWS);
  for (const n of names) assert.ok(d.keptTip.includes(n), `tooltip has ${n}`);
  assert.equal(detailsHeight(many), DETAILS_H + d.keptRows * 14);
  // An emoji in a name is never cut in half.
  const emoji = { T, width: 200, save: { ...none.save, damaged: ["📄".repeat(200)] } };
  const e = detailsText(emoji);
  assert.ok(graphemes(e.kept).every((g) => g === "📄" || /^[ -~…]+$/.test(g)), "whole graphemes only");
});

test("Details rows fit the card's cell budget, so gpui's own truncation never cuts an emoji (r1-04)", () => {
  const T = { raised: "#202020", border: "#303030", muted: "#909090", foreground: "#ffffff" };
  for (const width of [146, 226, 320, 456]) {
    const perLine = Math.max(8, Math.floor((width - 30) / 6.2));
    const ctx = { T, width, save: { path: `/home/me/📁📁📁📁📁📁/herdr-app/data/creaseworks/${"🗂".repeat(12)}/save.json`, lastGood: "09:00", backup: "not updated (the disk is full, so 🙁 rotation waits)", damaged: [] } };
    for (const line of detailsText(ctx).lines) {
      assert.ok(cellWidth(line) <= perLine, `${width}: "${line}" fits ${perLine} cells`);
      assert.ok(graphemes(line).every((g) => !/�/.test(g)), "whole clusters only");
    }
    assert.ok(detailsText(ctx).lines[0].endsWith(".json"), "the path keeps its tail");
  }
});

// r7-04: a backup that can't be read says why and where, each on a row of its
// own cut to the box's cells (never by gpui's truncation, which can cut inside
// an emoji), with the whole text in a tooltip, in Details and in Settings.
const EMOJI_BAK = "/home/user/📁work/herdr-app/data/creaseworks/save.bak.json";

test("r7-04: Details shows an unreadable backup's reason and path on rows of their own, the whole text in a tooltip", async () => {
  const T = { raised: "#202020", border: "#303030", muted: "#909090", foreground: "#ffffff" };
  for (const width of [146, 226, 320, 600]) {
    const perLine = Math.max(8, Math.floor((width - 30) / 6.2));
    const ctx = { T, width, save: { path: "/a/save.json", lastGood: "09:00", backup: "can't be read, left in place", backupWhy: "Text file exceeds 1 MiB", backupPath: EMOJI_BAK, damaged: [] } };
    const d = detailsText(ctx);
    assert.equal(d.lines.length, 5, `${width}: two more rows`);
    for (const line of d.lines) {
      assert.ok(cellWidth(line) <= perLine, `${width}: "${line}" fits ${perLine} cells`);
      assert.ok(graphemes(line).every((g) => !/�/.test(g)), "whole clusters only");
    }
    if (width >= 320) assert.equal(d.lines[3], "Why: Text file exceeds 1 MiB", `${width}: the reason is readable`);
    assert.ok(d.lines[4].startsWith("At: /home/") && d.lines[4].endsWith(width >= 320 ? "/save.bak.json" : ".json"), `${width}: the path keeps its head and tail: ${d.lines[4]}`);
    assert.equal(d.tips[2], `Backup: can't be read, left in place (Text file exceeds 1 MiB): ${EMOJI_BAK}`);
    assert.equal(d.tips[3], d.tips[2]);
    assert.equal(d.tips[4], d.tips[2]);
    assert.equal(detailsHeight(ctx), DETAILS_H + 2 * 14, "the card grows for the two rows");
  }
});

test("r7-04: the real store's unreadable backup reaches the Details card and Settings, reason and path readable", async () => {
  w = win({ files: { [SAVE]: saveText(freshState(3)) } });
  w.ctl.mkdir(BAK);
  const v = await w.copy("panel");
  await w.advance(3000);
  await w.handler(v, "details", true);
  const vm = v.session.vm();
  const ctx = { ...v.session.ctx(), width: 320 };
  const ui = v.session.ui;
  const lay = bannerLayout(vm, ui, ctx);
  assert.ok(lay && lay.detailsH === detailsHeight(ctx), "the banner offers Details at the card's height");
  const json = renderBanner(vm, ui, ctx).toJSON();
  const why = find(json, "cw-banner-backup-why");
  const where = find(json, "cw-banner-backup-path");
  assert.deepEqual(texts(why), ["Why: Not a regular file"]);
  assert.ok(texts(where)[0].endsWith("save.bak.json"), texts(where)[0]);
  assert.equal(style(why, "tooltip")[1], `Backup: can't be read, left in place (Not a regular file): ${BAK}`);
  assert.equal(style(find(json, "cw-banner-backup"), "tooltip")[1], style(why, "tooltip")[1]);
  // Settings › Save
  for (const width of [200, 320, 600]) {
    const sctx = { ...ctx, width };
    const sjson = renderSettings(vm, ui, sctx).toJSON();
    const cells = cellsFor(saveRowPx(sctx), 11);
    const status = find(sjson, "cw-set-save-status");
    const tip = style(status, "tooltip")[1];
    assert.ok(tip.includes("(Not a regular file): /home/") && tip.endsWith("/save.bak.json") && graphemes(tip).length <= 140, `the status row's tooltip has the reason and the path: ${tip}`);
    const swhy = find(sjson, "cw-set-save-bak-why");
    const spath = find(sjson, "cw-set-save-bak-path");
    assert.equal(texts(swhy)[0], "Why: Not a regular file", `${width}`);
    assert.ok(texts(spath)[0].startsWith("At: /home/") && texts(spath)[0].endsWith(width >= 320 ? "/save.bak.json" : ".json"), texts(spath)[0]);
    for (const node of [status, swhy, spath]) {
      for (const t of texts(node)) assert.ok(cellWidth(t) <= cells, `${width}: "${t}" fits ${cells} cells`);
    }
  }
});

test("r7-04: Settings cuts the save rows to the box's cells, never inside an emoji", () => {
  const T = JSON.parse(readFileSync(new URL("../../tools/mock/themes.json", import.meta.url), "utf8")).graphite;
  const save = { state: "problem", text: "Backup problem · saved just now", path: "/a/save.json", backup: "can't be read, left in place", backupWhy: "🙁".repeat(40), backupPath: `/home/${"📁".repeat(30)}/save.bak.json`, damaged: ["📄".repeat(50)] };
  for (const width of [200, 320]) {
    const ctx = { T, width, save, handlers: {} };
    const vm = F.scenario("settings").vm;
    const json = renderSettings(vm, {}, ctx).toJSON();
    const cells = cellsFor(saveRowPx(ctx), 11);
    for (const id of ["cw-set-save-status", "cw-set-save-bak-why", "cw-set-save-bak-path", "cw-set-save-damaged"]) {
      const node = find(json, id);
      assert.ok(node, id);
      for (const t of texts(node)) {
        assert.ok(cellWidth(t) <= cells, `${width} ${id}: "${t}" fits ${cells} cells`);
        assert.ok(!/[\uD800-\uDBFF]$/.test(t.replace(/…$/, "")), "never a half emoji");
      }
    }
  }
});

test("r7-04: the backup tooltip stays within 140 graphemes and keeps the path's head and file name", () => {
  const long = `/home/${"📁".repeat(60)}/herdr-app/data/creaseworks/save.bak.json`;
  const t = backupTip("Backup: can't be read, left in place", "stream did not contain valid UTF-8", long);
  assert.ok(graphemes(t).length <= 140, `${graphemes(t).length}`);
  assert.ok(t.startsWith("Backup: can't be read, left in place (stream did not contain valid UTF-8): /home/"), t);
  assert.ok(t.endsWith("/save.bak.json"), t);
  assert.equal(backupTip("Backup: x", "why", "/a/save.bak.json"), "Backup: x (why): /a/save.bak.json");
});

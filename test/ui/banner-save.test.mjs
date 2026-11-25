// The save banner's Details card with the real store behind it (review r1-13;
// DESIGN §3.8, §12.2): after "Save and backup were damaged", the card says the
// backup is damaged (not "present"), and the kept file names sit on their own
// wrapping row with every name in its tooltip, never clipped off the Backup
// line. The card's height (bannerLayout.detailsH) grows with that row.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { walk } from "../../tools/mock/gpui-kit.js";
import { win, SAVE, BAK } from "../glue/_util.mjs";
import { renderBanner, bannerLayout, detailsText, detailsHeight, DETAILS_H, KEPT_ROWS, BANNER_CLIP } from "../../mods/creaseworks/ui/banner.js";
import { graphemes } from "../../mods/creaseworks/engine/index.js";

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

// tools/render/html.mjs: element tree -> HTML/CSS with gpui's defaults, units
// and paint rules (see the header of html.mjs for the sources).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { div, svg, image, PathBuilder, Background, serialize } from "../../tools/mock/gpui-kit.js";
import { h_flex, v_flex, Button, v_virtual_list, TextView } from "../../tools/mock/gpui-base.js";
import { renderToHtml, renderDocument, gpuiGradientLine, gpuiPathData, PATH_SCRIPT } from "../../tools/render/html.mjs";

/** The inline style of the first element with data-kind=`kind` (or data-id=`id`). */
function styleOf(html, { kind, id }) {
  const attr = id !== undefined ? `data-id="${id}"` : `data-kind="${kind}"`;
  const at = html.indexOf(attr);
  assert.ok(at >= 0, `no element with ${attr}`);
  const tagEnd = html.indexOf(">", at);
  const tag = html.slice(html.lastIndexOf("<", at), tagEnd);
  const match = /style="([^"]*)"/.exec(tag);
  return match ? match[1] : "";
}

function decls(style) {
  const out = {};
  for (const part of style.split(";")) {
    const i = part.indexOf(":");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

const css = (tree, selector, options) => decls(styleOf(renderToHtml(tree, { root: false, ...options }), selector));

test("div is display:block by default (gpui Style::default); h_flex and v_flex", () => {
  assert.deepEqual(css(div().id("d"), { id: "d" }), {});
  assert.deepEqual(css(h_flex().id("h"), { id: "h" }), { display: "flex", "flex-direction": "row", "align-items": "center" });
  assert.deepEqual(css(v_flex().id("v"), { id: "v" }), { display: "flex", "flex-direction": "column" });
  const flex = css(div().id("f").flex().flex_col().items_end().justify_between().flex_wrap(), { id: "f" });
  assert.equal(flex.display, "flex");
  assert.equal(flex["flex-direction"], "column");
  assert.equal(flex["align-items"], "flex-end");
  assert.equal(flex["justify-content"], "space-between");
  assert.equal(flex["flex-wrap"], "wrap");
  const one = css(div().id("o").flex_1(), { id: "o" });
  assert.deepEqual([one["flex-grow"], one["flex-shrink"], one["flex-basis"]], ["1", "1", "0%"]);
  // The base stylesheet makes every element relative, border-box, zero box.
  const html = renderToHtml(div());
  assert.match(html, /\.gpui-root \.g\{position:relative;display:block;margin:0;padding:0;border:0 solid transparent\}/);
  assert.match(html, /box-sizing:border-box/);
});

test("units: numbers are px x zoom, ramps are rems of ui_font_size x zoom, presets raw px", () => {
  const at = (zoom, tree) => css(tree, { id: "x" }, { zoom });
  assert.equal(at(1, div().id("x").w(100)).width, "100px");
  assert.equal(at(1.5, div().id("x").w(100)).width, "150px");
  assert.equal(at(1.5, div().id("x").w("100px")).width, "150px");
  assert.equal(at(1, div().id("x").p_4())["padding-top"], "13px");
  assert.equal(at(2, div().id("x").p_4())["padding-left"], "26px");
  assert.equal(at(1, div().id("x").w("2rem")).width, "26px");
  assert.equal(at(1, div().id("x").gap_2())["column-gap"], "6.5px");
  assert.equal(at(1, div().id("x").gap_x(4))["column-gap"], "4px");
  assert.equal(at(1, div().id("x").gap_y(4))["row-gap"], "4px");
  assert.equal(at(1, div().id("x").m_neg_2())["margin-top"], "-6.5px");
  assert.equal(at(1, div().id("x").size_full()).height, "100%");
  assert.equal(at(1, div().id("x").w_1_2()).width, "50%");
  assert.equal(at(1, div().id("x").w("auto")).width, "auto");
  assert.equal(at(2, div().id("x").border_1())["border-top-width"], "1px", "border_N is raw px");
  assert.equal(at(2, div().id("x").border(1))["border-top-width"], "2px", "border(n) is zoomed");
  assert.equal(at(2, div().id("x").w_px()).width, "1px");
  assert.equal(at(1, div().id("x").rounded_full())["border-top-left-radius"], "9999px");
  assert.equal(at(1, div().id("x").rounded_md())["border-bottom-right-radius"], "4.875px");
  assert.equal(at(1, div().id("x").text_sm())["font-size"], "11.375px");
  assert.equal(at(1, div().id("x").min_w_0())["min-width"], "0px");
  assert.equal(at(1, div().id("x").max_w(300))["max-width"], "300px");
  assert.equal(css(div().id("x").p_4(), { id: "x" }, { remSize: 16 })["padding-top"], "16px");
});

test("position, inset and overflow", () => {
  const c = css(div().id("x").absolute().inset_0().left(10).top("50%"), { id: "x" });
  assert.equal(c.position, "absolute");
  assert.deepEqual([c.top, c.right, c.bottom, c.left], ["50%", "0px", "0px", "10px"]);
  assert.equal(css(div().id("x").overflow_hidden(), { id: "x" })["overflow-x"], "hidden");
  const scroll = css(div().id("x").overflow_y_scroll(), { id: "x" });
  assert.equal(scroll["overflow-y"], "hidden");
  assert.equal(scroll["scrollbar-width"], "none");
  assert.equal(css(div().id("x").overflow_y_scrollbar(), { id: "x" })["overflow-y"], "auto");
});

test("paint: bg, border, rounded, opacity, shadows", () => {
  const c = css(
    div().id("x").bg("#f00").border_2().border_color("#11223380").rounded(6).opacity(0.5).shadow_md().border_dashed(),
    { id: "x" },
  );
  assert.equal(c["background-color"], "#ff0000");
  assert.equal(c["border-top-width"], "2px");
  assert.equal(c["border-color"], "#11223380");
  assert.equal(c["border-style"], "dashed");
  assert.equal(c["border-top-right-radius"], "6px");
  assert.equal(c.opacity, "0.5");
  assert.equal(c["box-shadow"], "0px 4px 6px -1px rgba(0,0,0,0.1),0px 2px 4px -2px rgba(0,0,0,0.1)");
  assert.equal(css(div().id("x").shadow_none(), { id: "x" })["box-shadow"], "none");
});

test("text: colour, size, weight, line height multiplier, truncate, whitespace", () => {
  const c = css(
    div().id("x").text_color("#abc").text_size(14).font_bold().line_height(1.25).italic().text_center().font_family("Inter"),
    { id: "x" },
  );
  assert.equal(c.color, "#aabbcc");
  assert.equal(c["font-size"], "14px");
  assert.equal(c["font-weight"], "700");
  assert.equal(c["line-height"], "1.25");
  assert.equal(c["font-style"], "italic");
  assert.equal(c["text-align"], "center");
  assert.equal(c["font-family"], "'Inter'");
  assert.equal(css(div().id("x").line_height("120%"), { id: "x" })["line-height"], "1.2");
  assert.equal(css(div().id("x").line_height("18px"), { id: "x" }, { zoom: 2 })["line-height"], "36px");
  const t = css(div().id("x").truncate(), { id: "x" });
  assert.equal(t["overflow-x"], "hidden");
  assert.equal(t["white-space"], "pre");
  assert.equal(t["--g-to"], "ellipsis");
  assert.equal(t["--g-tov"], "hidden");
  assert.equal(css(div().id("x").whitespace_normal(), { id: "x" })["white-space"], "pre-wrap");
  assert.equal(css(div().id("x").font_weight(550), { id: "x" })["font-weight"], "550");
});

test("children: strings are text elements; numbers too; Button defaults", () => {
  const html = renderToHtml(h_flex().child("a & b").child(42), { root: false });
  assert.match(html, /<div class="gt"><span class="gtb">a &amp; b<\/span><\/div><div class="gt"><span class="gtb">42<\/span><\/div>/);
  const b = css(Button.new("buy").px(8), { id: "buy" });
  assert.equal(b.display, "flex");
  assert.equal(b["align-items"], "center");
  assert.equal(b["justify-content"], "center");
  assert.equal(b["line-height"], "1");
  assert.equal(b["padding-left"], "8px");
  assert.equal(css(Button.new("b2").line_height(1.5), { id: "b2" })["line-height"], "1.5", "the script's style refines base's");
});

test("ShellRoot wrapper: 16px text, phi line height, theme foreground", () => {
  const html = renderToHtml(div(), { theme: { colors: { foreground: "#eeeeee" } } });
  assert.match(html, /class="gpui-root" style="[^"]*font-size:16px;line-height:1\.618034;[^"]*color:#eeeeee/);
  const zoomed = renderToHtml(div(), { zoom: 2, theme: { foreground: "#000" } });
  assert.match(zoomed, /font-size:16px/, "the root text size is not zoomed");
});

test("svg() is a mask in the current text colour; image() an <img>", () => {
  const dir = mkdtempSync(join(tmpdir(), "gpui-html-"));
  writeFileSync(join(dir, "star.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>');
  const url = pathToFileURL(join(dir, "star.svg")).href;
  const s = css(svg("/./star.svg").id("s").size_4().text_color("#ff0"), { id: "s" }, { assetRoot: dir });
  assert.equal(s["background-color"], "currentColor");
  assert.equal(s.color, "#ffff00");
  // inlined: a file:// page cannot fetch a file:// mask (CSS masks are CORS requests)
  const data = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>').toString("base64");
  const full = renderToHtml(svg("/./star.svg").size_4(), { root: false, assetRoot: dir });
  assert.ok(full.includes(`mask:url('data:image/svg+xml;base64,${data}') center / 100% 100% no-repeat`), full);
  assert.ok(!full.includes(url), "no file:// mask");
  const warnings = [];
  const missing = renderToHtml(svg("missing.svg"), { root: false, assetRoot: dir, warnings });
  assert.doesNotMatch(missing, /mask/);
  assert.match(warnings[0], /^asset `missing\.svg` was not found at /);
  assert.throws(() => renderToHtml(svg("../x.svg"), { assetRoot: dir }), { message: "`../x.svg` is outside the application directory" });
  const img = renderToHtml(image("star.svg").w(20), { root: false, assetRoot: dir });
  assert.match(img, new RegExp(`<img class="g" data-kind="image" src="${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" alt="" style="width:20px;display:block;object-fit:contain">`));
});

test("paint_path: inline svg, coordinates against the box, fill rule, stroke", () => {
  const fill = PathBuilder.fill().move_to(0, 0).line_to("100%", 0).line_to("50%", "100%").close().build();
  const html = renderToHtml(window_paint(fill, "#ff000080").w(40).h(20), { root: false, zoom: 2 });
  assert.match(html, /<svg class="gp"[^>]*><path d="M0 0 L80 0 L40 40 Z" fill="rgb\(255,0,0\)" fill-opacity="0\.502" fill-rule="evenodd" stroke="none"\/><\/svg>/);
  assert.match(html, /data-gpui-path="/);
  const stroke = PathBuilder.stroke(2).move_to(0, 10).line_to(10, 10).dash_array([3, 1]).build();
  const s = renderToHtml(window_paint(stroke, Background.solid("#00ff00").opacity(0.5)).w(10).h(10), { root: false });
  assert.match(s, /fill="none" stroke="rgb\(0,255,0\)" stroke-opacity="0\.5" stroke-width="2" stroke-linejoin="miter" stroke-miterlimit="4" stroke-linecap="butt" stroke-dasharray="3 1"/);
  // A bad colour paints nothing (silently, as path.rs does).
  const bad = renderToHtml(window_paint(fill, "blue").w(10).h(10), { root: false });
  assert.doesNotMatch(bad, /<path /);
  // Paint styles on the path element itself are not drawn; layout styles are.
  const layout = css(window_paint(fill, "#fff").id("p").absolute().inset_0().bg("#000"), { id: "p" });
  assert.equal(layout.position, "absolute");
  assert.equal(layout["background-color"], undefined);
  // Geometry helper: arcs and curves.
  const g = gpuiPathData({ fill: true, width: 0, commands: [["move_to", "50%", 0], ["arc_to", "50%", "50%", 0, true, true, 0, "50%"], ["curve_to", 1, 1, 2, 2], ["cubic_bezier_to", 1, 1, 2, 2, 3, 3]] }, 100, 50, 1);
  assert.equal(g.d, "M50 0 A50 25 0 1 1 0 25 Q2 2 1 1 C2 2 3 3 1 1");
});

function window_paint(path, bg) {
  // The mock window is installed only on request; use the module function here.
  return globalThis.window?.paint_path ? window.paint_path(path, bg) : paintPath(path, bg);
}
import { paint_path as paintPath } from "../../tools/mock/gpui-kit.js";

test("linear gradients follow gpui's shader: 0deg = to top, clockwise", () => {
  const box = { x: 0, y: 0, width: 100, height: 100 };
  const up = gpuiGradientLine(0, 0, 1, box);
  assert.deepEqual([up.x1, up.y1, up.x2, up.y2].map(Math.round), [50, 100, 50, 0]);
  const right = gpuiGradientLine(90, 0, 1, box);
  assert.deepEqual([right.x1, right.y1, right.x2, right.y2].map(Math.round), [0, 50, 100, 50]);
  const down = gpuiGradientLine(180, 0.25, 0.75, box);
  assert.deepEqual([down.x1, down.y1, down.x2, down.y2].map(Math.round), [50, 25, 50, 75]);
  // Wide box: the short side is expanded, t runs over the long side.
  const wide = gpuiGradientLine(45, 0, 1, { x: 0, y: 0, width: 200, height: 100 });
  const t = (px, py) => {
    const dx = wide.x2 - wide.x1;
    const dy = wide.y2 - wide.y1;
    return ((px - wide.x1) * dx + (py - wide.y1) * dy) / (dx * dx + dy * dy);
  };
  // shaders.wgsl reference for the corner (200, 0) of a 200x100 box at 45deg.
  const d = [Math.cos(-Math.PI / 4), Math.sin(-Math.PI / 4) * 0.5];
  const ref = ((100 * d[0] + -50 * d[1]) / Math.hypot(...d) + 100) / 200;
  assert.ok(Math.abs(t(200, 0) - ref) < 1e-9);

  const html = renderToHtml(
    paintPath(PathBuilder.fill().add_polygon([[0, 0], [100, 0], [100, 100], [0, 100]]).build(), Background.linear_gradient(0, "#ff0000", "#0000ff")).w(100).h(100),
    { root: false },
  );
  assert.match(html, /<linearGradient id="gpui-paint-\d+" gradientUnits="userSpaceOnUse" x1="50" y1="100" x2="50" y2="0"><stop offset="0" stop-color="rgb\(255,0,0\)" stop-opacity="1"\/><stop offset="1" stop-color="rgb\(0,0,255\)" stop-opacity="1"\/><\/linearGradient>/);
  const patterns = renderToHtml(
    paintPath(PathBuilder.fill().move_to(0, 0).line_to(10, 0).line_to(10, 10).close().build(), Background.checkerboard("#fff", 5)).w(10).h(10),
    { root: false },
  );
  assert.match(patterns, /<pattern [^>]*width="10" height="10"><g fill="#ffffff" fill-opacity="1"><rect x="5" y="0" width="5" height="5"\/><rect x="0" y="5" width="5" height="5"\/><\/g><\/pattern>/);
});

test("animation at rest: loop at `to`, frames at the first frame", () => {
  assert.equal(css(div().id("x").opacity(1).loop("opacity", { from: 0.2, to: 0.6 }), { id: "x" }).opacity, "0.6");
  assert.equal(css(div().id("x").loop("top", { from: 0, to: 6 }), { id: "x" }, { zoom: 2 }).top, "6px", "loop lengths are raw px");
  const html = renderToHtml(div().id("spin").frames(["◐", "◓"], 100).child("ignored"), { root: false });
  assert.match(html, /<span class="gtb">◐<\/span>/);
  assert.doesNotMatch(html, /ignored/);
  assert.match(renderToHtml(div().transition("width", 200).w(10), { root: false }), /width:10px/);
});

test("lists render their items; TextView renders markdown", () => {
  const vl = v_virtual_list("rows", 2, 24, (i) => `k${i}`, (range) => {
    const rows = [];
    for (let i = range.start; i < range.end; i++) rows.push(div().child(`row ${i}`));
    return rows;
  }).h(100);
  const html = renderToHtml(vl, { root: false, zoom: 1 });
  assert.match(html, /<div class="g" style="height:24px;flex-shrink:0"><div class="g" data-kind="div"><div class="gt"><span class="gtb">row 1<\/span>/);
  const md = renderToHtml(TextView.markdown("help", "# Title\n\nSome **bold** and `code`\n\n- one\n- two"), { root: false });
  assert.match(md, /<h1>Title<\/h1><p>Some <strong>bold<\/strong> and <code>code<\/code><\/p><ul><li>one<\/li><li>two<\/li><\/ul>/);
});

test("a serialised tree renders exactly like the live tree", () => {
  const build = () => v_flex().p_2().bg("#123456").child(h_flex().gap_1().child("a")).child(Button.new("b").child("B"));
  const live = renderToHtml(build(), { root: false });
  const json = renderToHtml(JSON.parse(JSON.stringify(serialize(build()))), { root: false });
  assert.equal(json, live);
});

test("unsupported usage throws", () => {
  assert.throws(() => renderToHtml({ kind: "div", styles: [["bogus_style"]], children: [] }), {
    message: "render/html: unsupported method `bogus_style` on div",
  });
  assert.throws(() => renderToHtml({ kind: "canvas", styles: [], children: [] }), {
    message: "render/html: unsupported element kind `canvas`",
  });
  assert.throws(() => renderToHtml({ kind: "div", styles: [["bg", "red"]], children: [] }), /is not a color value/);
});

test("renderDocument: a sized page with the path script", () => {
  const doc = renderDocument(div().size_full(), { width: 320, height: 200, background: "#101010", zoom: 1.25, fontFamily: "Inter" });
  assert.match(doc, /^<!doctype html>/);
  assert.match(doc, /html,body\{margin:0;padding:0;width:320px;height:200px;overflow:hidden;background:#101010\}/);
  assert.match(doc, /font-family:Inter/);
  assert.ok(doc.includes(PATH_SCRIPT));
  assert.match(PATH_SCRIPT, /function gpuiPathData/);
  assert.match(PATH_SCRIPT, /function gpuiPaintAll/);
});

test("every nullary style in gpui-methods.json has a CSS mapping", async () => {
  const { methods } = await import("../../tools/mock/gpui-kit.js");
  const unmapped = [];
  for (const name of methods.nullary) {
    try {
      renderToHtml({ kind: "div", styles: [[name]], children: [] }, { root: false });
    } catch {
      unmapped.push(name);
    }
  }
  assert.deepEqual(unmapped, []);
});

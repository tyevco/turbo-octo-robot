// The gpui mock (tools/mock/gpui-kit.js, gpui-base.js): recorder shape,
// validation rules and messages copied from the shell, single-use elements,
// serialisation and handler dispatch (ARCHITECTURE A8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as kit from "../../tools/mock/gpui-kit.js";
import * as base from "../../tools/mock/gpui-base.js";
import { extract, render } from "../../tools/mock/extract-methods.mjs";

const { View, div, svg, image, list, uniform_list, PathBuilder, Background } = kit;
const { h_flex, v_flex, Button, Switch, Checkbox, Scrollbar, ScrollHandle, v_virtual_list, VirtualListScrollHandle, TextView } = base;

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const throwsType = (fn, message) => assert.throws(fn, (e) => e instanceof TypeError && e.message === message, message);
const throwsRange = (fn, message) => assert.throws(fn, (e) => e instanceof RangeError && e.message === message, message);

test("gpui-methods.json is the committed extraction of docs/research/gpui-kit.d.ts", () => {
  const dts = readFileSync(join(root, "docs/research/gpui-kit.d.ts"), "utf8");
  const fresh = render(extract(dts));
  assert.equal(readFileSync(join(root, "tools/mock/gpui-methods.json"), "utf8"), fresh.json);
  assert.equal(readFileSync(join(root, "tools/mock/gpui-methods.js"), "utf8"), fresh.js);
  const data = JSON.parse(fresh.json);
  assert.equal(data.counts.param, 59);
  assert.equal(data.counts.nullary, 3146);
  assert.equal(data.param.bg, "Color");
  assert.equal(data.param.w, "Length");
  assert.equal(data.param.p, "DefiniteLength");
  assert.equal(data.param.rounded, "AbsoluteLength");
  assert.equal(data.param.opacity, "number");
  assert.equal(data.param.font_family, "string");
  for (const name of ["items_center", "p_4", "m_neg_2", "rounded_full", "truncate", "font_bold", "shadow_md", "h_flex"]) {
    assert.ok(data.nullary.includes(name), name);
  }
  for (const name of ["child", "on_click", "loop", "frames", "spin", "transition", "hover", "id", "overflow_y_scroll"]) {
    assert.ok(data.behaviors.includes(name), name);
  }
  assert.deepEqual(data.components.TextView, ["highlight_range", "on_link_click", "on_selection_change", "raw_html", "scrollable", "selectable"]);
});

test("exports: gpui-kit has the real names plus listed mock helpers; gpui-base only real names", () => {
  for (const name of kit.REAL_EXPORTS) assert.ok(name in kit, name);
  const extra = Object.keys(kit).filter((name) => !kit.REAL_EXPORTS.includes(name));
  assert.deepEqual(extra.sort(), [...kit.MOCK_ONLY_EXPORTS].sort());
  assert.deepEqual(
    Object.keys(base).sort(),
    ["Button", "Checkbox", "Link", "ScrollHandle", "Scrollbar", "Switch", "TextView", "VirtualListScrollHandle",
      "h_flex", "h_virtual_list", "v_flex", "v_virtual_list"].sort(),
  );
});

test("importing the mocks has no side effects; installMockWindow installs window once", () => {
  assert.equal(globalThis.window, undefined);
  const w = kit.installMockWindow();
  assert.equal(globalThis.window, w);
  assert.equal(typeof w.paint_path, "function");
  const before = globalThis.window;
  assert.equal(kit.installMockWindow(), before, "an existing window is kept");
  const el = window.paint_path(PathBuilder.fill().move_to(0, 0).line_to(10, 0).line_to(0, 10).close().build(), "#fff");
  assert.equal(el.toJSON().kind, "path");
  delete globalThis.window;
});

test("builders record the A8 shape", () => {
  const tree = v_flex()
    .size_full()
    .p(12)
    .bg("#ff0000")
    .child(h_flex().gap_2().child("hi").child(3).child(false))
    .child(svg("mods/x/art/a.svg").size_4())
    .child(image("mods/x/art/b.png"));
  const json = JSON.parse(JSON.stringify(tree));
  assert.equal(json.kind, "v_flex");
  assert.deepEqual(json.args, []);
  assert.equal(json.id, null);
  assert.deepEqual(json.styles, [["size_full"], ["p", 12], ["bg", "#ff0000"]]);
  assert.deepEqual(json.handlers, {});
  assert.equal(json.hover, null);
  assert.deepEqual(json.transitions, []);
  assert.deepEqual(json.loops, []);
  assert.equal(json.frames, null);
  assert.equal(json.spin, null);
  const row = json.children[0];
  assert.equal(row.kind, "h_flex");
  assert.deepEqual(row.children, [
    { kind: "text", text: "hi" },
    { kind: "text", text: "3" },
    { kind: "text", text: "false" },
  ]);
  assert.deepEqual(json.children[1].args, ["mods/x/art/a.svg"]);
  assert.equal(json.children[2].kind, "image");
});

test("components: Button/Switch/Checkbox ids, Scrollbar axis, handles", () => {
  const btn = Button.new("buy").on_click(() => {});
  assert.equal(btn.toJSON().kind, "Button");
  assert.equal(btn.toJSON().id, "buy");
  btn.id("other");
  assert.equal(btn.toJSON().id, "buy", "X.new(id) identity is not replaced by .id()");
  const sw = Switch.new("sound").checked(true).on_change(() => {});
  assert.deepEqual(sw.toJSON().styles, [["checked", true]]);
  assert.deepEqual(Object.keys(sw.toJSON().handlers), ["on_change"]);
  assert.equal(Checkbox.new(7).toJSON().id, "7");
  assert.deepEqual(Scrollbar.vertical("list").toJSON().styles, [["axis", "vertical"]]);
  const sh = ScrollHandle.new();
  assert.equal(typeof sh.__handle, "number");
  assert.deepEqual(sh.offset(), { x: 0, y: 0 });
  throwsType(() => sh.scroll_to_item(-1), "scroll_to_item(index) needs a whole, non-negative index");
  const vh = VirtualListScrollHandle.new();
  assert.notEqual(vh.__handle, sh.__handle);
  assert.equal(div().track_scroll(vh).toJSON().styles[0][0], "track_scroll");
  throwsType(() => div().track_scroll("list"), "track_scroll(handle) expects a ScrollHandle or VirtualListScrollHandle");
});

test("unknown methods throw TypeError, with the shell's did-you-mean", () => {
  throwsType(() => div().items_centre(), "unknown style method `items_centre` (did you mean: items_center?)");
  throwsType(() => div().text_colour("#fff"), "unknown style method `text_colour` (did you mean: text_color?)");
  throwsType(() => div().rounde(4), "unknown style method `rounde` (did you mean: rounded?)");
  throwsType(() => div().z_index(3), "unknown style method `z_index`");
  throwsType(() => div().completely_unrelated_name(), "unknown style method `completely_unrelated_name`");
  // TextView's own methods exist only on a TextView.
  throwsType(() => div().selectable(true), "unknown style method `selectable`");
  assert.equal(div().then, undefined, "an element is not a thenable");
});

test("colours follow value.rs", () => {
  for (const ok of ["#fff", "#ffffff", "#ffffff80", "#AbC"]) div().bg(ok).text_color(ok).border_color(ok).text_bg(ok);
  throwsType(
    () => div().bg("red"),
    "`red` is not a color value; pass a color from `cx.theme().colors` or a #rgb, #rrggbb, or #rrggbbaa literal",
  );
  throwsType(() => div().bg("#ff00"), "`#ff00` is not a valid color literal (expected #rgb, #rrggbb or #rrggbbaa)");
  throwsType(() => div().bg("#zzzzzz"), "`#zzzzzz` is not a valid color literal (expected #rgb, #rrggbb or #rrggbbaa)");
  throwsType(() => div().bg(1), "expected a string, got number (1)");
  throwsType(() => div().text_color(null), "expected a string, got nil");
  throwsType(() => div().bg(true), "expected a string, got boolean (true)");
  throwsType(() => div().bg({}), "unsupported argument type; expected null, boolean, number, string or function");
  throwsType(() => div().bg(Background.solid("#fff")), "unsupported argument type; expected null, boolean, number, string or function");
  throwsType(() => div().bg(() => "#fff"), "`bg` does not take a function");
  throwsType(() => div().bg(), "`bg` expects at least 1 argument(s), got 0");
  assert.deepEqual(kit.parseColor("#f80"), { r: 255, g: 136, b: 0, a: 255 });
  assert.deepEqual(kit.parseColor("#11223380"), { r: 0x11, g: 0x22, b: 0x33, a: 0x80 });
  // value.rs quirk: the length is in bytes and from_str_radix takes a leading '+'.
  assert.deepEqual(kit.parseColor("#+fffff"), { r: 0x0f, g: 0xff, b: 0xff, a: 255 });
  assert.equal(kit.tryParseColor("#1234"), null);
});

test("lengths follow style.rs", () => {
  div().w(10).w("50%").w("auto").w("12px").w("1.5rem").h(" 3rem ").m("auto").inset("auto").flex_basis("auto");
  div().p(4).p("50%").gap("1rem").rounded(4).rounded("0.5rem").border(1).text_size("14px").line_height(1.45).line_height("18px");
  throwsType(
    () => div().rounded("50%"),
    '`rounded` expects an absolute length such as 8 or "0.5rem"; percentages and "auto" are not allowed here',
  );
  throwsType(() => div().p("auto"), '`p` cannot be "auto"; it expects a definite length such as 12 or "50%"');
  throwsType(() => div().gap_x("auto"), '`gap_x` cannot be "auto"; it expects a definite length such as 12 or "50%"');
  throwsType(() => div().line_height("auto"), '`line_height` cannot be "auto"; it expects a definite length such as 12 or "50%"');
  throwsType(
    () => div().w("wide"),
    '`w` expects a length: a number of pixels, or a string like "50%", "12px", "1rem" or "auto"; got "wide"',
  );
  throwsType(() => div().w("x%"), '`w` could not read a number in the length "x%"');
  throwsType(() => div().w(true), "expected a number, got boolean (true)");
  throwsType(() => div().p(), "`p` expects at least 1 argument(s), got 0");
  throwsType(() => div().font_weight(99), "`font_weight` expects a finite number between 100 and 900; got 99");
  throwsType(() => div().font_weight(950.7), "`font_weight` expects a finite number between 100 and 900; got 950.7");
  throwsType(() => div().font_weight("bold"), 'expected a number, got string ("bold")');
  throwsType(() => div().opacity("0.5"), 'expected a number, got string ("0.5")');
  throwsType(() => div().font_family(3), "expected a string, got number (3)");
  div().font_weight(600).opacity(0.5).flex_grow(2).font_family("Inter");
});

test("motion: frames / loop / spin / transition / spring ranges and messages", () => {
  const el = div().frames(["⠋", "⠙"], 80).loop("opacity", { from: 0.3, to: 1, period: 1200 }).transition("width", 200);
  const json = el.toJSON();
  assert.deepEqual(json.frames, { list: ["⠋", "⠙"], ms: 80 });
  assert.deepEqual(json.loops, [{ property: "opacity", from: 0.3, to: 1, period: 1200, easing: "ease-in-out" }]);
  assert.deepEqual(json.transitions, [{ kind: "transition", property: "width", duration: 200, delay: 0, easing: "ease-out" }]);
  assert.equal(svg("a.svg").spin(700).toJSON().spin, 700);
  assert.equal(svg("a.svg").spin().toJSON().spin, 1000);

  throwsRange(() => div().frames(["a"], 15), "frames interval must be at least 16 milliseconds");
  div().frames(["a"], 16);
  throwsType(() => div().frames([], 100), "frames(list, ms) expects a non-empty array of strings");
  throwsType(() => div().frames([1], 100), "frames(list, ms) expects a non-empty array of strings");
  throwsType(() => div().frames(["a"], -1), "frames interval must be a finite non-negative number");
  throwsRange(() => div().frames(["a"], 86400001), "frames interval must not exceed 86400000 milliseconds");
  throwsRange(() => div().loop("top", { from: 0, to: 4, period: 99 }), "loop period must be at least 100 milliseconds");
  div().loop("top", { from: 0, to: 4, period: 100 });
  throwsType(
    () => div().loop("scale", { from: 0, to: 1 }),
    'loop(property, policy) supports opacity, width, height, left or top; got "scale"',
  );
  throwsType(() => div().loop("left", { from: "0", to: 1 }), "loop(property, policy) needs numbers for from and to");
  throwsType(
    () => div().loop("left", { from: 0, to: 1, easing: "bounce" }),
    'loop easing must be linear, ease-in, ease-out or ease-in-out; got "bounce"',
  );
  throwsRange(() => svg("a.svg").spin(99), "spin period must be at least 100 milliseconds");
  throwsType(
    () => div().transition("color", 100),
    'transition(property, policy) supports opacity, width, height, left or top; got "color"',
  );
  throwsType(
    () => div().transition("left", { duration: 100, easing: "snap" }),
    'transition easing must be linear, ease-in, ease-out or ease-in-out; got "snap"',
  );
  throwsType(() => div().spring("top", { epsilon: 0 }), "spring epsilon must be a finite positive number");
  assert.equal(div().spring("top").toJSON().transitions[0].kind, "spring");
});

test("elements are single-use (spec.rs)", () => {
  const child = div().p_1();
  const parent = div().child(child);
  throwsType(() => div().child(child), "element `div` was already added to a parent; elements are single-use values");
  throwsType(() => child.p_2(), "element `div` was already added to a parent; elements are single-use values");
  throwsType(() => h_flex().child(parent).child(parent), "element `div` was already added to a parent; elements are single-use values");
  const self = div();
  throwsType(() => self.child(self), "an element cannot be added to itself");
  const used = Button.new("b");
  div().children([used]);
  throwsType(() => div().child(used), "element `Button` was already added to a parent; elements are single-use values");
  throwsType(() => div().child(null), "child(value) expects an element, a string, or an entity from cx.new(Class, props)");
  throwsType(() => div().child({}), "child(value) expects an element, a string, or an entity from cx.new(Class, props)");

  // A slot claims its element.
  const content = div();
  div().content(content);
  throwsType(
    () => div().child(content),
    "this element was given to a method that takes one — a state style's declarations, or a named slot such as content — and cannot also be added to the tree",
  );
  // A state style's collector is claimed too.
  let collector;
  div().hover((el) => {
    collector = el;
    return el.bg("#fff");
  });
  throwsType(
    () => div().child(collector),
    "this element was given to a method that takes one — a state style's declarations, or a named slot such as content — and cannot also be added to the tree",
  );

  // Elements from a previous render pass are expired.
  const stale = div();
  kit.beginRender();
  throwsType(
    () => div().child(stale),
    "this element belongs to a previous render pass; elements are single-use values and must be rebuilt each time render runs",
  );
  throwsType(
    () => stale.p_1(),
    "this element belongs to a previous render pass; elements are single-use values and must be rebuilt each time render runs",
  );
});

test("when / map behave as in gpui; hover/active record from a detached collector", () => {
  const a = div().when(false, (el) => el.p_1()).when(true, (el) => el.p_2());
  assert.deepEqual(a.toJSON().styles, [["p_2"]]);
  assert.equal(div().map(() => 42), 42);
  assert.throws(() => div().when(true, () => {}), { message: "when(...) must return the element" });
  const b = div().bg("#000").hover((s) => s.bg("#111").cursor_pointer()).active((s) => s.opacity(0.8));
  const json = b.toJSON();
  assert.deepEqual(json.styles, [["bg", "#000"]]);
  assert.deepEqual(json.hover, [["bg", "#111"], ["cursor_pointer"]]);
  assert.deepEqual(json.active, [["opacity", 0.8]]);
  throwsType(() => div().hover((s) => s.bg("blue")), "`blue` is not a color value; pass a color from `cx.theme().colors` or a #rgb, #rrggbb, or #rrggbbaa literal");
});

test("toJSON, findById and fire", () => {
  const calls = [];
  const cx = { tag: "cx" };
  const tree = v_flex()
    .id("root")
    .child(
      h_flex()
        .child(Button.new("buy").on_click((event, c) => calls.push(["buy", event, c])))
        .child(div().id("orb").on_mouse_down("left", (event, c) => calls.push(["orb", event, c])))
        .child(Switch.new("sound").on_change((checked, c) => calls.push(["sound", checked, c]))),
    );
  const json = JSON.parse(JSON.stringify(tree));
  assert.deepEqual(kit.findById(json, "buy").handlers, { on_click: { handler: "on_click", path: "0.0.0" } });
  assert.deepEqual(kit.findById(json, "orb").handlers, { "on_mouse_down:left": { handler: "on_mouse_down:left", path: "0.0.1" } });
  assert.equal(kit.findById(tree, "buy").toJSON().id, "buy");
  assert.equal(kit.findById(json, "missing"), null);

  kit.fire(tree, "buy", "on_click", { click_count: 1 }, cx);
  kit.fire(tree, "orb", "on_mouse_down", { position: { x: 1, y: 2 } }, cx);
  kit.fire(tree, "orb", "on_mouse_down:left", { position: { x: 3, y: 4 } }, cx);
  kit.fire(tree, "sound", "on_change", true, cx);
  assert.deepEqual(calls, [
    ["buy", { click_count: 1 }, cx],
    ["orb", { position: { x: 1, y: 2 } }, cx],
    ["orb", { position: { x: 3, y: 4 } }, cx],
    ["sound", true, cx],
  ]);
  assert.throws(() => kit.fire(tree, "buy", "on_hover", true, cx), /has no on_hover handler/);
  assert.throws(() => kit.fire(tree, "nope", "on_click", {}, cx), /no element with id "nope"/);
  throwsType(() => div().on_click("x"), "on_click(handler) expects a function");
});

test("lazy lists: argument checks, expansion with cx, duplicate keys", () => {
  throwsType(
    () => v_virtual_list("l", 2, [10], (i) => String(i), () => []),
    "v_virtual_list(id, item_count, item_sizes, get_key, render) was given 1 item sizes for 2 items; pass one number for a uniform extent, or one per item",
  );
  throwsType(
    () => v_virtual_list("l", -1, 10, (i) => String(i), () => []),
    "v_virtual_list(id, item_count, item_sizes, get_key, render) needs a whole, non-negative item_count",
  );
  throwsType(
    () => list("l", 2, (i) => String(i)),
    "list(id, item_count, get_key, render) needs a render function; it is called once per item on screen, with the item's index",
  );
  throwsType(
    () => uniform_list("l", 2, null, () => []),
    "uniform_list(id, item_count, get_key, render) needs get_key(index) to return each item's stable string key",
  );

  const seen = [];
  const vl = v_virtual_list("helpers", 3, 24, (i) => `h${i}`, (range, cx) => {
    seen.push(cx);
    const rows = [];
    for (let i = range.start; i < range.end; i++) rows.push(div().id(`row-${i}`).child(`row ${i}`));
    return rows;
  }).on_item_click(() => {});
  const json = kit.serialize(vl, { cx: "CX" });
  assert.deepEqual(seen, ["CX"]);
  assert.deepEqual(json.args, ["helpers", 3, 24]);
  assert.deepEqual(json.keys, ["h0", "h1", "h2"]);
  assert.equal(json.children.length, 3);
  assert.equal(json.children[2].id, "row-2");
  assert.ok(kit.findById(vl, "row-1"), "materialised rows are reachable on the live tree");

  const perItem = list("panels", 2, (i) => `p${i}`, (i) => div().child(`panel ${i}`));
  assert.deepEqual(kit.serialize(perItem).children.map((c) => c.children[0].text), ["panel 0", "panel 1"]);

  const dup = uniform_list("u", 2, () => "same", (range) => [div(), div()]);
  throwsType(() => kit.serialize(dup), "virtual list get_key returned duplicate key `same` in one visible range");
});

test("TextView.markdown records text and its own methods", () => {
  const tv = TextView.markdown("help", "# Title\n\nSome **bold** text").selectable(true).on_link_click(() => {});
  const json = tv.toJSON();
  assert.equal(json.kind, "TextView");
  assert.deepEqual(json.args, ["help", "# Title\n\nSome **bold** text", "markdown"]);
  assert.equal(json.id, "help");
  assert.deepEqual(json.styles, [["selectable", true]]);
  assert.ok(json.handlers.on_link_click);
  throwsType(() => TextView.markdown("x", "y").highlight_range(0, 1, "yellow"),
    "`yellow` is not a color value; pass a color from `cx.theme().colors` or a #rgb, #rrggbb, or #rrggbbaa literal");
});

test("PathBuilder / Background / paint_path follow the prelude", () => {
  const path = PathBuilder.stroke(2)
    .move_to(0, "50%")
    .line_to("100%", "50%")
    .curve_to(10, 10, 5, 5)
    .cubic_bezier_to(1, 2, 3, 4, 5, 6)
    .arc_to(4, "10%", 0, false, true, 8, 8)
    .add_polygon([[0, 0], [1, 1], [2, 0]])
    .dash_array([2, 1])
    .build();
  assert.equal(path.fill, false);
  assert.equal(path.width, 2);
  assert.deepEqual(path.commands.slice(-5), [["move_to", 0, 0], ["line_to", 1, 1], ["line_to", 2, 0], ["close"], ["dash_array", 2, 1]]);
  throwsType(() => PathBuilder.fill().move_to("10px", 0), "move_to coordinate must be a finite pixel number or percentage string");
  throwsType(() => PathBuilder.fill().line_to(1), "line_to expects at least 2 argument(s)");
  throwsType(() => PathBuilder.fill().dash_array([1]), "dash_array is only available on stroke paths");
  throwsType(() => PathBuilder.stroke(0), "stroke width must be a finite positive number");
  throwsType(() => PathBuilder.fill().arc_to(1, 1, NaN, 0, 0, 1, 1), "arc rotation must be finite");
  throwsType(() => kit.paint_path({}, "#fff"), "window.paint_path(path, background) expects a Path built by PathBuilder");

  const gradient = Background.linear_gradient(45, Background.stop("#ff0000", 0.2), "#0000ff").opacity(0.5);
  assert.deepEqual(gradient.values, ["45", "#ff0000", "0.2", "#0000ff", "1"]);
  assert.equal(gradient.opacityFactor, 0.5);
  throwsType(() => Background.linear_gradient(0, 3, "#fff"), "gradient from stop must be a color or Background.stop(color, percentage)");
  throwsType(() => Background.solid("#fff").color_space("hsl"), "background color_space must be srgb or oklab");
  throwsType(() => Background.checkerboard("#fff", 0), "checkerboard size must be a finite positive number");

  const el = kit.paint_path(PathBuilder.fill().move_to(0, 0).line_to("100%", 0).close().build(), gradient).absolute().inset_0();
  const json = el.toJSON();
  assert.equal(json.kind, "path");
  assert.deepEqual(json.args[1], { kind: "linear-gradient", values: ["45", "#ff0000", "0.2", "#0000ff", "1"], opacity: 0.5, colorSpace: "srgb" });
  // Background colours are not validated (they fail silently at paint time).
  kit.paint_path(PathBuilder.fill().move_to(0, 0).build(), "not-a-colour");
  // A plain colour string is a solid background.
  assert.deepEqual(kit.paint_path(PathBuilder.fill().move_to(0, 0).build(), "#123").toJSON().args[1].values, ["#123"]);
});

test("View runs init on construction unless the host constructs it", () => {
  const log = [];
  class Game extends View {
    init(props, cx) {
      log.push(["init", props, cx]);
    }
    render() {
      return div();
    }
  }
  kit.setAsyncContextFactory(() => "async-cx");
  new Game({ a: 1 });
  const hosted = kit.constructView(Game);
  assert.ok(hosted instanceof Game);
  assert.deepEqual(log, [["init", { a: 1 }, "async-cx"]]);
  kit.setAsyncContextFactory(() => undefined);
});

// Review fixes: behaviour checks the shell makes at the call site
// (engine/quickjs/mod.rs ShellRuntime::apply) that the mock used to skip.
test("id, tooltip, value, role, tab_index, href, counts are checked like the shell", () => {
  throwsType(() => div().id(42), "id(name) expects a string; it is the element's stable identity, so it must not change between renders");
  throwsType(() => div().id(null), "id(name) expects a string; it is the element's stable identity, so it must not change between renders");
  assert.equal(div().id("ok").toJSON().id, "ok");
  throwsType(() => div().tooltip(3), "tooltip(text) expects a string; a tooltip built from an element is not bound yet");
  throwsType(() => div().value("50"), "value(percent) expects a number between 0 and 100");
  throwsType(() => div().value(Infinity), "value(percent) expects a number between 0 and 100");
  div().value(50);
  throwsType(() => div().role("listbox"), "unknown accessibility role `listbox`; the names mirror gpui::Role in snake_case — see the Role type in gpui-kit.d.ts");
  throwsType(() => div().role("Button"), "unknown accessibility role `Button`; the names mirror gpui::Role in snake_case — see the Role type in gpui-kit.d.ts");
  throwsType(() => div().role("generic_container"), 'role("generic_container") announces nothing: GPUI filters that role out of the accessibility tree. Leave the role off instead, or name the role the element really has');
  throwsType(() => div().role(1), "role(name) expects a string; see the Role type in gpui-kit.d.ts");
  div().role("button").role("list_box_option").role("check_box");
  throwsType(() => div().tab_index(1.5), "tab_index(index) expects a whole number");
  throwsType(() => div().tab_index("1"), "tab_index(index) expects a whole number");
  div().tab_index(-1);
  throwsType(() => div().href("/local"), "href(url) expects an absolute HTTP(S) URL with a host");
  throwsType(() => div().href("file:///etc/passwd"), "href(url) expects an absolute HTTP(S) URL with a host");
  throwsType(() => div().href(1), "href(url) expects a string");
  div().href("https://example.com/x");
  throwsType(() => div().row_count(-1), "row_count(count) expects a non-negative whole finite number");
  throwsType(() => div().column_count(2.5), "column_count(count) expects a non-negative whole finite number");
  throwsType(() => div().set_position(0, 3), "set_position(position, size) expects whole finite numbers with 1 <= position <= size");
  throwsType(() => div().set_position(4, 3), "set_position(position, size) expects whole finite numbers with 1 <= position <= size");
  div().set_position(1, 3);
  throwsRange(() => div().size_range(100, 50), "size_range maximum must be greater than or equal to its minimum");
});

test("handlers: the function comes first; on_action / on_mouse_* take a name or button first", () => {
  throwsType(() => div().on_click("x", () => {}), "on_click(handler) expects a function");
  throwsType(() => div().on_action("", () => {}), "on_action(action, handler) expects the action's name first, as a non-empty string");
  throwsType(() => div().on_action("copy"), "on_action(action, handler) expects a function second");
  throwsType(() => div().on_mouse_down(() => {}), 'on_mouse_down(button, handler) expects a button first: "left", "right", "middle", "back" or "forward"');
  throwsType(() => div().on_mouse_up("left"), "on_mouse_up(button, handler) expects a function second");
  throwsType(() => div().on_window_mouse_up("primary", () => {}), '`primary` is not a mouse button; expected "left", "right", "middle", "back" or "forward"');
  const el = div().id("a").on_action("copy", () => "copied").on_mouse_down("back", () => "back");
  assert.equal(kit.fire(el, "a", "on_action:copy"), "copied");
  assert.equal(kit.fire(el, "a", "on_mouse_down"), "back");
});

test("a lazy list's item renderer (Layout phase) cannot register handlers or build lists", () => {
  const rows = (make) => v_virtual_list("rows", 2, 20, (i) => `k${i}`, (range) => {
    const out = [];
    for (let i = range.start; i < range.end; i++) out.push(make(i));
    return out;
  });
  const withClick = rows((i) => div().id(`r${i}`).on_click(() => {}));
  assert.throws(() => kit.serialize(withClick, { cx: {} }), (e) => e instanceof TypeError && e.message.startsWith("`on_click` cannot be registered from a virtual list's item renderer"));
  const perItem = list("l", 1, (i) => String(i), () => div().on_mouse_down("left", () => {}));
  assert.throws(() => kit.serialize(perItem, { cx: {} }), (e) => e instanceof TypeError && e.message.startsWith("`on_mouse_down` cannot be registered"));
  const nested = rows(() => uniform_list("inner", 1, (i) => String(i), () => [div()]));
  throwsType(() => kit.serialize(nested, { cx: {} }),
    "a list cannot be built from inside another list's item renderer: its own renderer would belong to no render pass and would never be called. Describe the nested list from the view's render() instead");
  // The list's own on_item_click is the supported way; after a throw the renderer depth is restored.
  const ok = rows((i) => div().id(`r${i}`).child(String(i))).on_item_click(() => "item");
  assert.equal(kit.serialize(ok, { cx: {} }).children.length, 2);
  div().on_click(() => {});
});

test("lengths are trimmed with Rust's whitespace set, not JavaScript's", () => {
  // U+FEFF is JS whitespace but not Rust's; U+0085 is the other way round.
  throwsType(() => div().p("\uFEFF12px"), '`p` could not read a number in the length "\uFEFF12px"');
  throwsType(() => div().w("auto\uFEFF"), '`w` expects a length: a number of pixels, or a string like "50%", "12px", "1rem" or "auto"; got "auto\uFEFF"');
  div().p("\u008512px\u0085").w(" auto\u3000");
});

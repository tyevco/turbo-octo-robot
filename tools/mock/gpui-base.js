// Mock "gpui-base" for Node and the QuickJS harness: the subset of herdr's
// "gpui-base" exports this project uses (ARCHITECTURE A8), each mirroring the
// shell prelude (vendor/gpui-kit/crates/shell/src/engine/quickjs/mod.rs).
// Exports nothing the real module lacks. No top-level side effects.

import { allocateHandle, createElement, createTextView, currentPhase, lazyList } from "./gpui-core.js";

/** `gpui_base::h_flex()`: `div().flex().flex_row().items_center()`. */
export function h_flex() {
  return createElement("h_flex");
}

/** `gpui_base::v_flex()`: `div().flex().flex_col()`. */
export function v_flex() {
  return createElement("v_flex");
}

function component(kind) {
  return Object.freeze({ new: (id) => createElement(kind, [String(id)], String(id)) });
}

/** Unstyled; base renders it as a flex box centring its content, line height 1. */
export const Button = component("Button");
export const Link = component("Link");
/** Unstyled; `.checked(bool)` + `.on_change((checked, cx) => …)`. */
export const Checkbox = component("Checkbox");
export const Switch = component("Switch");

export const Scrollbar = Object.freeze({
  new: (id) => createElement("Scrollbar", [String(id)], String(id)),
  horizontal: (id) => createElement("Scrollbar", [String(id)], String(id)).axis("horizontal"),
  vertical: (id) => createElement("Scrollbar", [String(id)], String(id)).axis("vertical"),
});

// Retained handles (vendor/gpui-kit/crates/shell/src/engine/quickjs/entity_api.rs):
// created only outside render / layout, unusable once released.

/** entity_api.rs `refuse_creation_in_render`. */
function refuseCreationInRender(constructor) {
  const phase = currentPhase();
  if (phase === "render" || phase === "layout") {
    throw new TypeError(
      `${constructor} cannot run during render; create state in init() or in an event handler and keep it on the view`,
    );
  }
}

const RELEASED = "this scroll handle has been released";

function scrollPosition(state) {
  const read = (f) => () => {
    if (state.released) throw new TypeError(RELEASED);
    return f();
  };
  return {
    offset: read(() => ({ x: state.offset.x, y: state.offset.y })),
    content_size: read(() => ({ ...state.content })),
    viewport_size: read(() => ({ ...state.viewport })),
  };
}

function newScrollState() {
  return { offset: { x: 0, y: 0 }, content: { width: 0, height: 0 }, viewport: { width: 0, height: 0 }, calls: [], released: false };
}

function release(state) {
  const was = !state.released;
  state.released = true;
  return was;
}

export const ScrollHandle = Object.freeze({
  new: () => {
    refuseCreationInRender("ScrollHandle.new()");
    const state = newScrollState();
    return {
      __handle: allocateHandle(),
      __mock: state,
      scroll_to_item: (index) => {
        if (!Number.isSafeInteger(index) || index < 0) {
          throw new TypeError("scroll_to_item(index) needs a whole, non-negative index");
        }
        if (state.released) throw new TypeError(RELEASED);
        state.calls.push(["scroll_to_item", index]);
      },
      ...scrollPosition(state),
      release: () => release(state),
    };
  },
});

export const VirtualListScrollHandle = Object.freeze({
  new: () => {
    refuseCreationInRender("VirtualListScrollHandle.new()");
    const state = newScrollState();
    return {
      __handle: allocateHandle(),
      __mock: state,
      scroll_to_item: (index, strategy) => {
        if (!Number.isInteger(index) || index < 0) {
          throw new TypeError("scroll_to_item(index) needs a whole, non-negative index");
        }
        const how = String(strategy ?? "top");
        if (state.released) throw new TypeError(RELEASED);
        if (how !== "top" && how !== "center") {
          throw new TypeError(`unknown scroll strategy \`${how}\`; expected top or center`);
        }
        state.calls.push(["scroll_to_item", index, how]);
      },
      scroll_to_bottom: () => {
        if (state.released) throw new TypeError(RELEASED);
        state.calls.push(["scroll_to_bottom"]);
      },
      ...scrollPosition(state),
      release: () => release(state),
    };
  },
});

export function v_virtual_list(id, item_count, item_sizes, get_key, render) {
  return lazyList("v_virtual_list", id, item_count, item_sizes, get_key, render);
}

export function h_virtual_list(id, item_count, item_sizes, get_key, render) {
  return lazyList("h_virtual_list", id, item_count, item_sizes, get_key, render);
}

export const TextView = Object.freeze({
  html: (id, text) => createTextView(id, text, "html"),
  markdown: (id, text) => createTextView(id, text, "markdown"),
});

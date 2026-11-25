// Mock "gpui-base" for Node and the QuickJS harness: the subset of herdr's
// "gpui-base" exports this project uses (ARCHITECTURE A8), each mirroring the
// shell prelude (vendor/gpui-kit/crates/shell/src/engine/quickjs/mod.rs).
// Exports nothing the real module lacks. No top-level side effects.

import { allocateHandle, createElement, createTextView, lazyList } from "./gpui-core.js";

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

function scrollPosition(state) {
  return {
    offset: () => ({ x: state.offset.x, y: state.offset.y }),
    content_size: () => ({ ...state.content }),
    viewport_size: () => ({ ...state.viewport }),
  };
}

function newScrollState() {
  return { offset: { x: 0, y: 0 }, content: { width: 0, height: 0 }, viewport: { width: 0, height: 0 }, calls: [] };
}

export const ScrollHandle = Object.freeze({
  new: () => {
    const state = newScrollState();
    return {
      __handle: allocateHandle(),
      __mock: state,
      scroll_to_item: (index) => {
        if (!Number.isSafeInteger(index) || index < 0) {
          throw new TypeError("scroll_to_item(index) needs a whole, non-negative index");
        }
        state.calls.push(["scroll_to_item", index]);
      },
      ...scrollPosition(state),
      release: () => true,
    };
  },
});

export const VirtualListScrollHandle = Object.freeze({
  new: () => {
    const state = newScrollState();
    return {
      __handle: allocateHandle(),
      __mock: state,
      scroll_to_item: (index, strategy) => {
        if (!Number.isInteger(index) || index < 0) {
          throw new TypeError("scroll_to_item(index) needs a whole, non-negative index");
        }
        state.calls.push(["scroll_to_item", index, String(strategy ?? "top")]);
      },
      scroll_to_bottom: () => {
        state.calls.push(["scroll_to_bottom"]);
      },
      ...scrollPosition(state),
      release: () => true,
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

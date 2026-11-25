// Mock "gpui-kit" (and its alias "gpui") for Node and the QuickJS harness.
//
// The first block is exactly what herdr's "gpui-kit" exports
// (engine/quickjs/mod.rs builtin_modules; docs/research/gpui-ui.md §2). The
// second block is mock-only tooling (ARCHITECTURE A8); a mod must never import
// it — `MOCK_ONLY_EXPORTS` lists those names so harnesses can refuse them.
// Implementation: ./gpui-core.js. No top-level side effects: the `window`
// global exists only after `installMockWindow()`.

export { View, div, svg, image, list, uniform_list, PathBuilder, Background } from "./gpui-core.js";

export {
  installMockWindow,
  createMockWindow,
  paint_path,
  serialize,
  toJSON,
  findById,
  fire,
  walk,
  handlersOf,
  beginRender,
  renderRoot,
  constructView,
  setAsyncContextFactory,
  parseColor,
  tryParseColor,
  suggest,
  unknownMethodMessage,
  methods,
} from "./gpui-core.js";

export const REAL_EXPORTS = Object.freeze([
  "View", "div", "svg", "image", "list", "uniform_list", "PathBuilder", "Background",
]);

export const MOCK_ONLY_EXPORTS = Object.freeze([
  "installMockWindow", "createMockWindow", "paint_path", "serialize", "toJSON", "findById", "fire",
  "walk", "handlersOf", "beginRender", "renderRoot", "constructView", "setAsyncContextFactory", "parseColor",
  "tryParseColor", "suggest", "unknownMethodMessage", "methods", "REAL_EXPORTS", "MOCK_ONLY_EXPORTS",
]);

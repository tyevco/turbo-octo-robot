// What a mod gets for `import … from "gpui-kit"` (or "gpui") under Node: the
// names herdr's "gpui-kit" exports and nothing else, so a mod that imports a
// mock-only helper (serialize, fire, paint_path, …) fails to link here as it
// does in herdr. Same module instance as tools/mock/gpui-kit.js, so tooling
// that imports the helpers by path shares its render epoch and window.
// Kept in step with REAL_EXPORTS by test/tooling/gpui.test.mjs.
export { View, div, svg, image, list, uniform_list, PathBuilder, Background } from "../mock/gpui-kit.js";

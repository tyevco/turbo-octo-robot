// Module resolve hook (registered by register.mjs). Only the four built-in
// module names the shell provides are mapped; everything else resolves normally.
// "gpui" is the shell's alias for "gpui-kit"
// (vendor/gpui-kit/crates/shell/src/component_registry.rs:1805).
const MOCKS = {
  herdr: new URL("../mock/herdr.js", import.meta.url).href,
  "gpui-kit": new URL("../mock/gpui-kit.js", import.meta.url).href,
  gpui: new URL("../mock/gpui-kit.js", import.meta.url).href,
  "gpui-base": new URL("../mock/gpui-base.js", import.meta.url).href,
};

export async function resolve(specifier, context, nextResolve) {
  if (Object.hasOwn(MOCKS, specifier)) {
    return { url: MOCKS[specifier], format: "module", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

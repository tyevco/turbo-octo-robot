// In-VM sandbox prelude for the QuickJS-ng harness (tools/qjs/harness.mjs).
//
// A port of herdr-app 0.1.18's
// vendor/gpui-kit/crates/shell/src/engine/quickjs/sandbox.rs `install()`:
//
//   install_absent_globals   sandbox.rs:228-261  (throwing stubs, exact hints)
//   WITHHOLD_DYNAMIC_CODE    sandbox.rs:168-197  (verbatim)
//   FREEZE_BUILTINS          sandbox.rs:203-215  (verbatim)
//
// Ordering (sandbox.rs:5-14): this runs LAST, after every global the host
// installs (the mock modules, `__herdr`, `window`, `console`) and before any
// application module is evaluated. The harness evaluates this file as a global
// script; its completion value is the `install(policy)` function, which the
// harness calls once:
//
//   policy.development    (default false)  sandbox.rs is_development_mode()
//   policy.strictBuiltins (default true)   sandbox.rs STRICT_BUILTINS
//
// Nothing here may be "improved": a test that passes against this file has to
// mean the same thing in herdr.

((policy) => {
  const development = !!(policy && policy.development);
  const strictBuiltins = !(policy && policy.strictBuiltins === false);

  // --- install_absent_globals (sandbox.rs:228-261) -------------------------
  // Names an author will reach for that this runtime does not have. A name a
  // subsystem already claimed is skipped (`globals.contains_key`).
  const ABSENT_GLOBALS = [
    ["setTimeout", "use cx.timer.after(ms, callback)"],
    ["setInterval", "use cx.timer.every(ms, callback)"],
    ["clearTimeout", "cancel the handle returned by cx.timer.after"],
    ["clearInterval", "cancel the handle returned by cx.timer.every"],
    ["require", "this runtime uses ES modules; use `import`"],
  ];
  for (const [name, hint] of ABSENT_GLOBALS) {
    if (name in globalThis) continue;
    const message = `\`${name}\` is not available in the shell: ${hint}`;
    // `Func::from` in sandbox.rs: an ordinary writable global whose call throws
    // `Exception::throw_type` (a TypeError) with the message above.
    globalThis[name] = {
      [name]() {
        throw new TypeError(message);
      },
    }[name];
  }

  if (development) return;

  // --- WITHHOLD_DYNAMIC_CODE (sandbox.rs:168-197), verbatim -----------------
  (() => {
    const hint = "the shell sandbox withholds dynamic code; run the host with --dev to allow it";
    const deny = (label) => function () {
      throw new TypeError(`${label} is disabled: ${hint}`);
    };

    const replaceConstructor = (holder, value) => {
      // `GeneratorFunction.prototype.constructor` is non-writable but
      // configurable, so plain assignment is not enough.
      Object.defineProperty(Object.getPrototypeOf(holder), "constructor", {
        value,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    };

    const blocked = deny("the Function constructor");
    blocked.prototype = Function.prototype;

    replaceConstructor(function () {}, blocked);
    replaceConstructor(async function () {}, deny("the AsyncFunction constructor"));
    replaceConstructor(function* () {}, deny("the GeneratorFunction constructor"));
    replaceConstructor(async function* () {}, deny("the AsyncGeneratorFunction constructor"));

    globalThis.Function = blocked;
    delete globalThis.eval;
  })();

  // --- FREEZE_BUILTINS (sandbox.rs:203-215), verbatim -----------------------
  // After the constructor swap above, so the replacement is what gets frozen.
  if (strictBuiltins) {
    (() => {
      for (const proto of [
        Object.prototype,
        Array.prototype,
        Function.prototype,
        String.prototype,
        Number.prototype,
      ]) {
        Object.freeze(proto);
      }
    })();
  }
});

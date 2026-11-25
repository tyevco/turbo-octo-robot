// `node --import ./tools/node/frozen.mjs --import ./tools/node/register.mjs …`:
// freezes the five prototypes herdr freezes (sandbox.rs FREEZE_BUILTINS) before
// anything else loads, so Node runs of engine / glue / ui code meet the same
// "'toString' is read-only" and Object.assign failures the QuickJS sandbox
// gives (ARCHITECTURE A2 rule 3). Opt-in (`npm run test:frozen`): Playwright
// cannot run in a frozen realm, so the screenshot suites skip under it.
for (const proto of [Object.prototype, Array.prototype, Function.prototype, String.prototype, Number.prototype]) {
  Object.freeze(proto);
}

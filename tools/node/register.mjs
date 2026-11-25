// `node --import ./tools/node/register.mjs`: the bare specifiers a mod imports
// ("herdr", "gpui-kit", "gpui", "gpui-base") resolve to the mocks in tools/mock.
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);

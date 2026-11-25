// The mock "herdr" module: every function `defaults/herdr.d.ts` (herdr-app 0.1.18)
// declares, with the same names. Like the real generated module
// (vendor/gpui-kit/crates/shell/src/engine/quickjs/host_modules.rs:238-262) each
// export forwards its arguments as they were passed; the behaviour lives in the
// controller (tools/mock/controller.js) installed at globalThis.__herdr.
// No imports and no top-level side effects: Node and QuickJS load it the same way.

const host = () => {
  const ctl = globalThis.__herdr;
  if (!ctl) {
    throw new Error("mock herdr: no controller; call createController(scenario) from tools/mock/controller.js first");
  }
  return ctl;
};

export const exec = (...args) => host().hostCall("exec", args);
export const hc = (...args) => host().hostCall("hc", args);
export const home = (...args) => host().hostCall("home", args);
export const appHome = (...args) => host().hostCall("appHome", args);
export const checking = (...args) => host().hostCall("checking", args);
export const readTextFile = (...args) => host().hostCall("readTextFile", args);
export const writeTextFile = (...args) => host().hostCall("writeTextFile", args);
export const knownAgents = (...args) => host().hostCall("knownAgents", args);
export const pickFolder = (...args) => host().hostCall("pickFolder", args);
export const pickFiles = (...args) => host().hostCall("pickFiles", args);
export const playSound = (...args) => host().hostCall("playSound", args);
export const run = (...args) => host().hostCall("run", args);
export const machines = (...args) => host().hostCall("machines", args);
export const spaces = (...args) => host().hostCall("spaces", args);
export const agents = (...args) => host().hostCall("agents", args);
export const panes = (...args) => host().hostCall("panes", args);
export const setAgentOrder = (...args) => host().hostCall("setAgentOrder", args);
export const terminals = (...args) => host().hostCall("terminals", args);
export const focused = (...args) => host().hostCall("focused", args);
export const layout = (...args) => host().hostCall("layout", args);
export const layouts = (...args) => host().hostCall("layouts", args);
export const commands = (...args) => host().hostCall("commands", args);
export const window = (...args) => host().hostCall("window", args);
export const setWindowTitle = (...args) => host().hostCall("setWindowTitle", args);
export const setBadge = (...args) => host().hostCall("setBadge", args);
export const placement = (...args) => host().hostCall("placement", args);
export const theme = (...args) => host().hostCall("theme", args);
export const themes = (...args) => host().hostCall("themes", args);
export const fonts = (...args) => host().hostCall("fonts", args);
export const updates = (...args) => host().hostCall("updates", args);
export const presentUpdateNotes = (...args) => host().hostCall("presentUpdateNotes", args);
export const telemetry = (...args) => host().hostCall("telemetry", args);
export const feedbackPreview = (...args) => host().hostCall("feedbackPreview", args);
export const feedbackPasteImage = (...args) => host().hostCall("feedbackPasteImage", args);
export const feedbackPickImages = (...args) => host().hostCall("feedbackPickImages", args);
export const feedbackAttachImages = (...args) => host().hostCall("feedbackAttachImages", args);
export const feedbackClearImages = (...args) => host().hostCall("feedbackClearImages", args);
export const sendFeedback = (...args) => host().hostCall("sendFeedback", args);
export const settings = (...args) => host().hostCall("settings", args);
export const keys = (...args) => host().hostCall("keys", args);
export const openOverlay = (...args) => host().hostCall("openOverlay", args);
export const closeOverlay = (...args) => host().hostCall("closeOverlay", args);
export const notify = (...args) => host().hostCall("notify", args);
export const props = (...args) => host().hostCall("props", args);
export const shared = (...args) => host().hostCall("shared", args);
export const setShared = (...args) => host().hostCall("setShared", args);
export const nextCommand = (...args) => host().hostCall("nextCommand", args);
export const watchFolder = (...args) => host().hostCall("watchFolder", args);

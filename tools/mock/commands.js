// The app's command table, copied from herdr-app 0.1.18 `src/commands.rs` (COMMANDS),
// with the validation it runs on `run()` from a mod:
//   validate_args  src/commands.rs:133-151  (thrown synchronously by herdr.run, src/mods.rs:1263-1278)
//   missing        src/commands.rs:154-160  (later, when the window runs it: "<name> needs <arg>")
//   run_as         src/window.rs:3076-3125  (shorthand, mod commands, unknown command)
// Plain ES module with no imports: it runs in Node and in the QuickJS harness.

const req = (name) => ({ name, required: true });
const opt = (name) => ({ name, required: false });
const cmd = (name, args, about) => ({ name, args, about });

export const COMMANDS = [
  cmd("space.new", [opt("name"), opt("folder"), opt("tab"), opt("argv"), opt("task"), opt("machine"), opt("focus")],
    "Make a space: its name (default: none, so it's called after where its first terminal is), the folder its terminals start in (default: the focused terminal's), its first tab's name (default: none, so it's called by its number), optionally an agent (argv) and its first message (task), and the machine it lives on (`hc machine ls`; default the focused space's machine for keys and clicks, this computer for scripts; empty string: this computer; its terminals start in that machine's home unless folder). It is shown at once; focus false keeps the shown space and tab (with no space shown, the new space is shown)."),
  cmd("space.close", [opt("id"), opt("confirmed")],
    "Close a space and end its terminals (asks first unless confirmed)."),
  cmd("space.rename", [opt("id"), opt("name")],
    "Rename a space (asks the person when no name; an empty name: called after where its first terminal is again)."),
  cmd("space.move", [req("id"), req("index")],
    "Move a space to a position (1 = first)."),
  cmd("tab.new", [opt("name"), opt("space"), opt("folder"), opt("argv"), opt("task"), opt("mod"), opt("props"), opt("focus")],
    "Make a tab in a space (default: the selected one; name default: none, so it's called by its number) with a terminal in folder (default: the focused terminal's), optionally an agent (argv) and its first message (task); or with a mod as its only pane (`mod`, its `props`: a file, a board). It is shown at once; focus false adds it last in its space and keeps the shown space and the target space's selected tab. With no space open, a person's new tab starts a space (as space.new)."),
  cmd("tab.close", [opt("id"), opt("confirmed")],
    "Close a tab and end its terminals."),
  cmd("tab.rename", [opt("id"), opt("name")],
    "Rename a tab (asks the person when no name; an empty name: called by its number again)."),
  cmd("tab.move", [opt("id"), opt("index"), opt("by")],
    "Move a tab (the active one if no id) to a position in its space (1 = first), or `by` places left (-) or right (+), wrapping."),
  cmd("pane.split", [req("direction"), opt("pane"), opt("argv"), opt("mod"), opt("props")],
    "Split a pane (default: the focused one) \"right\" or \"down\" with a new terminal, or with a mod (`mod`, its `props`) beside it."),
  cmd("pane.close", [opt("pane")],
    "Close a pane and end its terminal."),
  cmd("terminal.open", [opt("argv"), opt("folder"), opt("place"), opt("name")],
    "Start a terminal: as a new tab (place \"tab\", default), or \"right\"/\"down\" of the focused pane."),
  cmd("terminal.keep", [req("terminal"), opt("place")],
    "Give a running terminal without a pane (a sub-agent) a pane: a new tab, or \"right\"/\"down\"."),
  cmd("terminal.park", [req("terminal")],
    "Take a terminal's pane away and disable core keep; it keeps running (a sub-agent shows under its parent again)."),
  cmd("terminal.right_click", [req("to"), opt("terminal")],
    "Where right-clicks in a terminal (default: the focused one) go when its program takes the mouse: \"program\" or \"menu\" (Herdr's, the default). Shift+right-click is always the menu."),
  cmd("terminal.pin", [req("terminal"), req("pinned")],
    "Pin an agent to the top of the agent lists (pinned true) or unpin it (false). Pins are kept with the terminal, so every Herdr client shows them, and end with it."),
  cmd("terminal.kill", [req("terminal")],
    "End a terminal and its sub-agents. Spare branches whose first sub-agent has a pane or a herdr.space label. Core still applies parent-lifetime rules."),
  cmd("space.select", [opt("index"), opt("id")],
    "Show a space (by position or id)."),
  cmd("space.next", [],
    "Show the next space."),
  cmd("space.prev", [],
    "Show the previous space."),
  cmd("tab.select", [opt("index"), opt("id")],
    "Show a tab (by position in the space, or id)."),
  cmd("tab.settle", [opt("id")],
    "Put a tab away on this screen (default: the shown one): out of the lists, still running. It comes back when shown or when an agent in it needs you."),
  cmd("tab.unsettle", [opt("id")],
    "Bring a settled tab back to the lists."),
  cmd("tab.next", [],
    "Show the next tab."),
  cmd("tab.prev", [],
    "Show the previous tab."),
  cmd("pane.zoom", [opt("pane")],
    "Show only this pane of its tab, or all again."),
  cmd("pane.rename", [opt("pane"), opt("name")],
    "Name a pane (default: the focused one; asks the person when no name; an empty name: unnamed again)."),
  cmd("pane.focus", [opt("pane"), opt("terminal")],
    "Focus a pane (or the pane showing a terminal)."),
  cmd("pane.go", [req("direction")],
    "Focus the pane or focusable mod to the \"left\", \"right\", \"up\" or \"down\"."),
  cmd("pane.resize", [req("direction"), opt("pane"), opt("px")],
    "Move the border of a pane (default: the focused one) \"left\", \"right\", \"up\" or \"down\" by px (default 40), like dragging the divider."),
  cmd("pane.swap", [opt("direction"), opt("pane"), opt("target")],
    "Swap a pane (default: the focused one) with its neighbor in a direction, or with another pane of its tab (target). Give exactly one of direction or target."),
  cmd("terminal.peek", [req("terminal")],
    "Peek at a running terminal over the tab, with keep-as-tab and close controls."),
  cmd("terminal.show", [opt("terminal"), opt("pane")],
    "Show a terminal in a pane for now, in place of its own (no terminal: back)."),
  cmd("terminal.select_all", [opt("terminal")],
    "Select a terminal's whole screen and scrollback (default: the focused one), ready to copy. On the alternate screen, select only that screen."),
  cmd("terminal.select", [opt("terminal"), opt("at"), opt("mode")],
    "Start a terminal selection (default: the focused one), replacing the old selection. at defaults to \"cursor\" or takes {row, col}: zero-based cells, rows from the top of the history including the active screen. mode is \"cell\" (default), \"word\" or \"line\" (like double/triple click). Mods read the inclusive endpoints from focused().selection or terminals(); selection.end is the moving end."),
  cmd("terminal.adjust_selection", [opt("terminal"), req("direction")],
    "Move the selection's moving end: left, right, up, down, page_up, page_down, home, end, line_start or line_end. The view follows the moving end. Fails if there is no selection. Defaults to the focused terminal."),
  cmd("terminal.clear_selection", [opt("terminal")],
    "Clear a terminal's selection (default: the focused one)."),
  cmd("terminal.copy", [],
    "Copy the focused terminal's selection. With nothing selected, that key goes to the program."),
  cmd("terminal.scroll", [opt("lines"), opt("pages"), opt("to"), opt("terminal")],
    "Scroll a terminal's view of its history (default: the focused one). Give exactly one of: lines (a whole number; negative goes up, toward history), pages (a number, fractions allowed; one page is the terminal's rows), to: \"top\" (oldest history) or \"bottom\" (the live screen). This scrolls Herdr's view, not the program."),
  cmd("terminal.paste", [],
    "Paste into the focused terminal (copied files as if dropped; an image alone as terminal.paste_image pastes it)."),
  cmd("terminal.paste_image", [],
    "Ctrl+V: the clipboard's image as a file on the focused terminal's machine, when that's another one; on Windows, paste clipboard text; otherwise Ctrl+V goes to the terminal."),
  cmd("terminal.search", [],
    "Search the focused terminal's screen and scrollback; the find bar and query stay with that terminal."),
  cmd("agent.focus", [req("terminal")],
    "Show an agent (sub-agents too)."),
  cmd("agent.next", [],
    "Show the next agent, in the order the agents list shows them."),
  cmd("agent.prev", [],
    "Show the previous agent."),
  cmd("agent.select", [req("index")],
    "Show an agent by position (1 = first), in the same navigation order as `agent.next`."),
  cmd("layout.switch", [opt("name")],
    "Show a layout (layouts/<name>.json), or the next one."),
  cmd("layout.clone", [req("name"), opt("as")],
    "Duplicate a layout as <name>-copy (or as), then show it."),
  cmd("mod.clone", [req("name"), opt("as")],
    "Duplicate a mod as <name>-copy (or as)."),
  cmd("layout.set", [req("layout")],
    "Replace a personal layout tree; shipped layouts accept only click/look fields (not structure)."),
  cmd("layout.toggle", [req("id")],
    "Hide or show a layout node."),
  cmd("layout.show", [req("id")],
    "Show a layout node."),
  cmd("layout.hide", [req("id")],
    "Hide a layout node."),
  cmd("layout.resize", [req("id"), opt("px"), opt("weight")],
    "Size a layout node."),
  cmd("layout.select", [req("stack"), req("child")],
    "Show one child of a stack."),
  cmd("layout.reset", [opt("name")],
    "Reset a shipped layout and its clicks (the old file is kept aside)."),
  cmd("mod.open", [req("name")],
    "Toggle a mod as the overlay its mod.json describes; calling again closes it."),
  cmd("overlay.close", [opt("id")],
    "Close an overlay (default: the top dialog or popup)."),
  cmd("app.help", [],
    "Toggle the keys dialog."),
  cmd("app.welcome", [],
    "Show the welcome again."),
  cmd("app.whats_new", [],
    "Show what this release brought (it opens once by itself after an update)."),
  cmd("app.feedback", [opt("message"), opt("from")],
    "Draft feedback for the person to review and send (from: person or agent)."),
  cmd("app.palette", [],
    "Toggle the command palette: every command by name, with its key; calling again closes it."),
  cmd("app.settings", [opt("section")],
    "Open the settings (section: look, alerts, updates)."),
  cmd("app.check_updates", [],
    "Look for a newer Herdr and herdr-core now."),
  cmd("app.update_core", [],
    "Update herdr-core to its latest release of this generation; terminals keep running."),
  cmd("app.reset", [],
    "The escape hatch: set the shown layout and keys aside, back to the default screen."),
  cmd("app.theme", [req("name")],
    "Use a theme (a preset or themes/<name>.json)."),
  cmd("app.zoom_in", [],
    "Make everything bigger."),
  cmd("app.zoom_out", [],
    "Make everything smaller."),
  cmd("app.zoom_reset", [],
    "Back to normal size."),
  cmd("app.update", [],
    "Restart into the update Herdr downloaded (your terminals keep running)."),
  cmd("app.quit", [],
    "Quit (macOS)."),
  cmd("app.hide", [],
    "Hide the app (macOS)."),
  cmd("app.hide_others", [],
    "Hide other apps (macOS)."),
  cmd("app.show_all", [],
    "Show all apps (macOS)."),
  cmd("window.close", [],
    "Close the window (on Linux, quits)."),
  cmd("window.minimize", [],
    "Minimize the window."),
  cmd("window.maximize", [],
    "Maximize the window, or back."),
];

const BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));

/** `commands::find`. */
export function find(name) {
  return BY_NAME.get(name) ?? null;
}

const TARGETS = ["id", "pane", "space", "terminal", "target"];

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * `commands::validate_args`. `args` is the bridged value (null for an omitted or
 * undefined argument). Returns the error text, or null when valid.
 */
export function validateArgs(c, args) {
  const valid = c.args.length === 0 ? "none" : c.args.map((a) => a.name).join(", ");
  if (args === null || args === undefined) return null;
  if (isPlainObject(args)) {
    const keys = Object.keys(args);
    const unknown = keys.filter((k) => !c.args.some((a) => a.name === k));
    if (unknown.length > 0) {
      return `${c.name}: unknown argument(s): ${unknown.join(", ")}; valid arguments: ${valid}`;
    }
    for (const key of keys) {
      const value = args[key];
      if (TARGETS.includes(key) && typeof value !== "string" && value !== null) {
        return `${c.name}: argument ${key} must be a string (or null to omit it)`;
      }
    }
    return null;
  }
  return `${c.name}: arguments must be an object; valid arguments: ${valid}`;
}

/** `commands::missing`: the first required argument that's missing (an empty string counts). */
export function missing(c, args) {
  for (const a of c.args) {
    if (!a.required) continue;
    const v = isPlainObject(args) && Object.hasOwn(args, a.name) ? args[a.name] : undefined;
    if (v === undefined || v === null) return a.name;
    if (typeof v === "string" && v.trim() === "") return a.name;
  }
  return null;
}

/** `commands::shorthand`: a key's `name:value`, filling the first argument (a number fills `index`). */
export function shorthand(c, value) {
  const index = /^\+?[0-9]+$/.test(value) && c.args.some((a) => a.name === "index") ? Number(value) : null;
  if (index !== null && Number.isSafeInteger(index)) return { index };
  if (c.args.length > 0) return { [c.args[0].name]: value };
  return null;
}

/** `keys::current`: project.* / context.* from 0.1.0 mods become space.* / tab.*. */
export function current(action) {
  if (action === "mod.open:start") return "tab.new";
  const command = (a) => find(a.includes(":") ? a.slice(0, a.indexOf(":")) : a) !== null;
  for (const [old, now] of [["project.", "space."], ["context.", "tab."]]) {
    if (action.startsWith(old)) {
      const renamed = now + action.slice(old.length);
      if (command(renamed) && !command(action)) return renamed;
    }
  }
  return action;
}

/** `commands::listing` / herdr `commands()`. */
export function listing() {
  return COMMANDS.map((c) => ({ name: c.name, args: c.args.map((a) => ({ name: a.name, required: a.required })), about: c.about }));
}

/** Rust's `{:?}` for a plain string (what the error texts quote names with). */
export function debugString(s) {
  let out = '"';
  for (const ch of String(s)) {
    const code = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) out += `\\u{${code.toString(16)}}`;
    else out += ch;
  }
  return out + '"';
}

/** The text `run_as` answers for a name that is neither an app command nor a listening mod. */
export function unknownCommand(name) {
  return `unknown command ${debugString(name)}: see \`herdr-app commands\`; a mod's are <mod>.<command> and need the mod loaded`;
}

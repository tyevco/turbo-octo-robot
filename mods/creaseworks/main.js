// Creaseworks: the View herdr loads for every copy (ARCHITECTURE A1, A3, B7,
// B11). Thin: glue/session.js does the work; ui/* draws. props().role routes
// the copy: "ribbon" draws the 30 px ribbon, anything else the panel (which
// is the 64 px rail below 140 px wide). Only glue/* imports "herdr".

import { View, div } from "gpui-kit";
import { Session } from "./glue/session.js";
import { renderPanel } from "./ui/panel.js";
import { renderRibbon } from "./ui/ribbon.js";
import { isFolded } from "./ui/flock.js";
import { pickScene, pickHues } from "./ui/palette.js";

export default class Creaseworks extends View {
  init(_props, cx) {
    // The session reads props().role (never init's argument, A2 rule 10).
    this.session = new Session(null, { isFolded });
    this.session.init(cx);
  }

  render(_cx) {
    const s = this.session;
    const root = div()
      .id("root")
      .size_full()
      .min_w(0)
      .min_h(0)
      .on_size_change((size, cx) => s.onSize(size, cx));
    const ctx = s.ctx();
    ctx.S = pickScene(ctx.dark);
    ctx.hues = pickHues(ctx.dark);
    const vm = s.vm();
    if (!vm) {
      const T = ctx.T || {};
      const bg = typeof T.chrome === "string" ? T.chrome : "#1c1d21";
      const fg = typeof T.muted === "string" ? T.muted : "#9a9aa2";
      return root.bg(bg).flex().items_center().justify_center().text_size(11).text_color(fg).child("Opening the workshop…");
    }
    const ui = s.uiForRender();
    const content = s.role === "ribbon" ? renderRibbon(vm, ui, ctx) : renderPanel(vm, ui, ctx);
    return root.child(content);
  }

  close(cx) {
    return this.session ? this.session.close(cx) : null;
  }
}

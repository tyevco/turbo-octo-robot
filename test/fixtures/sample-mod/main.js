// A tiny herdr mod used by test/qjs/harness.test.mjs: one View that imports
// the three built-ins, keeps its live data in a globalThis slot (A6), runs one
// data timer, uses a null-prototype map and renders a small element tree.

import { View, div } from "gpui-kit";
import { h_flex, v_flex, Button } from "gpui-base";
import { appHome, checking, readTextFile, writeTextFile } from "herdr";
import { makeCounts, bump, describeCounts, spin } from "./lib/x.js";

const SLOT = Symbol.for("sample-mod/live");

const savePath = () => `${appHome()}/data/sample-mod/save.json`;

export default class Sample extends View {
  init(_props, cx) {
    let live = globalThis[SLOT];
    if (!live) {
      live = { v: 1, inits: 0, ticks: 0, lastTickBy: 0, counts: makeCounts(), saved: null, loaded: null, spinMs: 0 };
      globalThis[SLOT] = live;
    }
    live.inits += 1;
    this.live = live;
    this.build = live.inits;
    if (checking()) return;

    this.timer = cx.timer.every(1000, () => {
      live.ticks += 1;
      live.lastTickBy = this.build;
    });
    cx.spawn(async () => {
      live.loaded = await readTextFile(savePath());
    });
  }

  render(_cx) {
    const live = this.live;
    if (live.spinMs > 0) spin(live.spinMs);
    return v_flex()
      .id("root")
      .p_2()
      .gap_1()
      .bg("#1e1f22")
      .text_color("#e6e6e6")
      .child(div().id("title").font_bold().child(`Sample build ${this.build}`))
      .child(div().id("ticks").child(`ticks ${live.ticks}`))
      .child(div().id("counts").truncate().child(describeCounts(live.counts) || "none"))
      .child(
        h_flex()
          .gap_1()
          .child(
            Button.new("bump")
              .child("Bump")
              .on_click((key, cx) => {
                bump(live.counts, typeof key === "string" ? key : "click");
                cx.notify();
              }),
          )
          .child(
            Button.new("save")
              .child("Save")
              .on_click(() => {
                const text = JSON.stringify({ counts: live.counts, ticks: live.ticks });
                writeTextFile(savePath(), text, live.saved).then(() => {
                  live.saved = text;
                });
              }),
          ),
      );
  }

  async close(_cx) {
    const text = JSON.stringify({ counts: live_counts(this.live), ticks: this.live.ticks, closed: true });
    await writeTextFile(savePath(), text, this.live.saved);
    this.live.saved = text;
  }
}

function live_counts(live) {
  const out = makeCounts();
  for (const key of Object.keys(live.counts)) out[key] = live.counts[key];
  return out;
}

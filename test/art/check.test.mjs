// tools/art/check-svg.mjs: the rules of DESIGN §13.1 on every shipped SVG,
// and the checker itself rejecting each kind of violation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDir, checkSvg, DEFAULT_DIR } from "../../tools/art/check-svg.mjs";

const head = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`;
const status = (body) => `${head(16, 16)}${body}</svg>\n`;
const ok = '<polygon points="8,1 15,15 1,15" fill="#000"/>';

test("every SVG under mods/creaseworks/art passes the checker", () => {
  const { files, errors } = checkDir(DEFAULT_DIR);
  assert.ok(files.length >= 120, `only ${files.length} files`);
  assert.deepEqual(errors, []);
});

test("a minimal valid glyph passes", () => {
  assert.deepEqual(checkSvg(status(ok), "status/pip-needs.svg"), []);
  assert.deepEqual(checkSvg(status('<polygon points="8,1 15,15 1,15" fill="#000" fill-opacity="0.78"/>'), "status/pip-needs.svg"), []);
  assert.deepEqual(checkSvg(status('<path d="M8 1A7 7 0 1 1 1 8L3.5 8A4.5 4.5 0 1 0 8 3.5Z" fill="#000"/>'), "status/working-arc.svg"), []);
});

const bad = [
  ["text element", status(`${ok}<text x="1" y="1" fill="#000">!</text>`), /forbidden|not allowed|unexpected/],
  ["style attribute", status('<polygon points="8,1 15,15 1,15" fill="#000" style="opacity:1"/>'), /forbidden/],
  ["gradient", status(`<linearGradient id="g"/>${ok}`), /forbidden/],
  ["filter", status(`<filter id="f"/>${ok}`), /forbidden/],
  ["mask", status(`<mask id="m"/>${ok}`), /forbidden/],
  ["image", status(`<image href="x.png"/>${ok}`), /forbidden/],
  ["group", status(`<g>${ok}</g>`), /forbidden|unexpected/],
  ["ellipse", status('<ellipse cx="8" cy="8" rx="4" ry="2" fill="#000"/>'), /not allowed/],
  ["colour fill", status('<polygon points="8,1 15,15 1,15" fill="#ff0000"/>'), /fill/],
  ["missing fill", status('<polygon points="8,1 15,15 1,15"/>'), /fill/],
  ["opacity step", status('<polygon points="8,1 15,15 1,15" fill="#000" fill-opacity="0.5"/>'), /fill-opacity/],
  ["off grid", status('<polygon points="8.25,1 15,15 1,15" fill="#000"/>'), /half-unit/],
  ["outside box", status('<polygon points="8,1 17,15 1,15" fill="#000"/>'), /outside/],
  ["circle outside", status('<circle cx="2" cy="8" r="3" fill="#000"/>'), /outside/],
  ["relative path", status('<path d="M1 1l5 5z" fill="#000"/>'), /only absolute/],
  ["curve", status('<path d="M1 1C2 2 3 3 4 4Z" fill="#000"/>'), /only absolute/],
  ["empty", status(""), /no shapes/],
  ["no width", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${ok}</svg>`, /root/],
  ["wrong box", `${head(24, 24)}${ok}</svg>`, /expected 16×16/],
  ["mismatched size", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="32" height="32">${ok}</svg>`, /does not match/],
  ["unknown file", status(ok), /not a listed/, "status/spare.svg"],
  ["too many points", status(`<polygon points="${Array.from({ length: 41 }, (_, i) => `${(i % 15) + 0.5},${(i % 7) + 1}`).join(" ")}" fill="#000"/>`), /41 points/],
  ["too big", status(ok.repeat(30)), /bytes/],
  ["stroke", status('<polygon points="8,1 15,15 1,15" fill="#000" stroke="#000"/>'), /forbidden/],
  ["transform", status('<polygon points="8,1 15,15 1,15" fill="#000" transform="scale(2)"/>'), /forbidden/],
];
for (const [what, text, pattern, path = "status/pip-needs.svg"] of bad) {
  test(`the checker rejects: ${what}`, () => {
    const errors = checkSvg(text, path);
    assert.ok(errors.some((e) => pattern.test(e)), `expected ${pattern} in ${JSON.stringify(errors)}`);
  });
}

test("folk sprites keep the 2-unit margin; flat layers carry no opacity", () => {
  const folk = (body) => `${head(32, 32)}${body}</svg>\n`;
  assert.deepEqual(checkSvg(folk('<polygon points="2,2 30,2 16,30" fill="#000"/>'), "folk/frog.svg"), []);
  assert.match(checkSvg(folk('<polygon points="1,2 30,2 16,30" fill="#000"/>'), "folk/frog.svg").join(), /margin/);
  assert.match(checkSvg(folk('<polygon points="2,2 30,2 16,30" fill="#000" fill-opacity="0.78"/>'), "folk/frog-b.svg").join(), /flat layer/);
  const sheet = `${head(64, 64)}<polygon points="2,2 60,2 30,60" fill="#000" fill-opacity="0.56"/></svg>\n`;
  assert.match(checkSvg(sheet, "sheet/0-base.svg").join(), /flat layer/);
});

test("only notify-icon.svg may use its listed colour literals", () => {
  const icon = `${head(36, 36)}<rect x="0" y="0" width="36" height="36" fill="#2f6a55"/><polygon points="4,4 30,4 16,30" fill="#fbf7ee"/></svg>\n`;
  assert.deepEqual(checkSvg(icon, "notify-icon.svg"), []);
  assert.match(checkSvg(icon.replace("#fbf7ee", "#ffffff"), "notify-icon.svg").join(), /fill/);
  assert.match(checkSvg(status('<polygon points="8,1 15,15 1,15" fill="#fbf7ee"/>'), "status/pip-needs.svg").join(), /fill/);
});

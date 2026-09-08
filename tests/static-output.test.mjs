import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);

test("the production entry points to existing relative assets", async () => {
  const html = await readFile(new URL("dist/index.html", root), "utf8");
  assert.match(html, /<title>Hyperion — Personal Knowledge Base<\/title>/i);
  assert.match(html, /id="root"/);
  const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)];
  assert.ok(assets.length >= 2);
  for (const [, path] of assets) await access(new URL(`dist/${path}`, root));
});

test("the editor and emoji catalog ship as separate on-demand chunks", async () => {
  const files = await readdir(new URL("dist/assets/", root));
  assert.ok(files.some((name) => /^blocksuite-runtime-.*\.js$/.test(name)));
  assert.ok(files.some((name) => /^emoji-catalog-.*\.js$/.test(name)));
  assert.ok(files.some((name) => /^editor-view-.*\.js$/.test(name)));
  const html = await readFile(new URL("dist/index.html", root), "utf8");
  assert.doesNotMatch(
    html,
    /(?:src|href)="[^"]*(?:blocksuite-runtime|editor-view|emoji-catalog)-/,
  );
});

test("desktop main and preload build artifacts exist", async () => {
  await access(new URL("dist-electron/main.js", root));
  await access(new URL("dist-electron/preload.cjs", root));
});

test("knowledge persistence has no browser database fallback", async () => {
  const [runtime, database] = await Promise.all([
    readFile(new URL("app/platform/runtime.ts", root), "utf8"),
    readFile(new URL("app/lib/local-database.ts", root), "utf8"),
  ]);
  assert.match(runtime, /ElectronKnowledgeRepository/);
  assert.doesNotMatch(
    runtime,
    /IndexedDbKnowledgeRepository|IndexedDBDocSource/,
  );
  assert.doesNotMatch(database, /indexedDB\.open/);
});

test("keeps brand text readable in both themes and resolves literal editor colors", async () => {
  const result = await build({
    stdin: { contents: 'export { themeToken } from "./app/theme/palette"; export { combinedLightCssVariables, combinedDarkCssVariables } from "./app/theme";', resolveDir: new URL("../", import.meta.url).pathname },
    bundle: true, write: false, format: "esm", platform: "node", loader: { ".css": "text" },
  });
  const { themeToken, combinedLightCssVariables, combinedDarkCssVariables } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  const luminance = hex => {
    const rgb = hex.slice(1).match(/.{2}/g).map(channel => parseInt(channel, 16) / 255)
      .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  for (const theme of ["light", "dark"]) {
    const pairs = [
      ...["--text", "--text-soft", "--text-faint"].flatMap(text => ["--bg", "--panel", "--surface-raised"].map(surface => [text, surface])),
      ["--on-action", "--action"], ["--on-action", "--action-hover"],
      ["--accent-text", "--selected-bg"],
      ["--accent-text", "--accent-soft"], ["--green", "--green-soft"], ["--danger", "--danger-soft"], ["--yellow", "--bg"],
    ];
    for (const [foreground, background] of pairs) {
      const values = [foreground, background].map(token => luminance(themeToken(token, theme))).sort((a, b) => b - a);
      const ratio = (values[0] + .05) / (values[1] + .05);
      assert.ok(ratio >= 4.5, `${theme}: ${foreground} on ${background} has ${ratio.toFixed(2)}:1 contrast`);
    }
    const editor = theme === "dark" ? combinedDarkCssVariables : combinedLightCssVariables;
    assert.equal(editor["--affine-link-color"], themeToken("--accent", theme));
    assert.match(editor["--affine-background-primary-color"], /^#[0-9a-f]{6}$/i);
    assert.equal(editor["--affine-background-primary-color"], themeToken("--bg", theme));
  }
});

test("ships the approved identity in the web output and valid desktop icon containers", async () => {
  for (const file of ["brand/hyperion-icon-master.png", "brand/hyperion-icon-128.png", "favicon.png"]) {
    const source = await readFile(new URL(`public/${file}`, root));
    const output = await readFile(new URL(`dist/${file}`, root));
    assert.deepEqual(output, source);
    assert.equal(source.toString("hex", 0, 8), "89504e470d0a1a0a");
  }
  const icns = await readFile(new URL("build/icon.icns", root));
  assert.equal(icns.toString("ascii", 0, 4), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length);
  const ico = await readFile(new URL("build/icon.ico", root));
  assert.equal(ico.readUInt16LE(2), 1);
  const count = ico.readUInt16LE(4);
  assert.ok(count >= 6);
  for (let index = 0; index < count; index++) {
    const offset = ico.readUInt32LE(6 + index * 16 + 12);
    const length = ico.readUInt32LE(6 + index * 16 + 8);
    assert.ok(offset + length <= ico.length);
    assert.equal(ico.toString("hex", offset, offset + 8), "89504e470d0a1a0a");
  }
});

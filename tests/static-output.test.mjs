import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import test from "node:test";

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

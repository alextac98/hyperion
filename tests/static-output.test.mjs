import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("builds the local Hyperion application", async () => {
  const html = await readFile(new URL("dist/index.html", projectRoot), "utf8");
  assert.match(html, /<title>Hyperion — Personal Knowledge Base<\/title>/i);
  assert.match(html, /id="root"/);
  assert.doesNotMatch(html, /sign.?in|account|cloud sync/i);
});

test("keeps all knowledge persistence on the device", async () => {
  const [databaseSource, appSource] = await Promise.all([
    readFile(new URL("app/lib/local-database.ts", projectRoot), "utf8"),
    readFile(new URL("app/HyperionApp.tsx", projectRoot), "utf8"),
  ]);

  assert.match(databaseSource, /indexedDB\.open/);
  assert.match(databaseSource, /KnowledgeRepository/);
  assert.match(appSource, /No account or cloud sync/i);
  assert.doesNotMatch(appSource, /sign.?in|sign.?out|fetch\s*\(|XMLHttpRequest|new WebSocket/i);
  await assert.rejects(access(new URL(".openai/hosting.json", projectRoot)));
});

test("includes rich local editing and organization", async () => {
  const [editorSource, appSource] = await Promise.all([
    readFile(new URL("app/editor/blocksuite-runtime.ts", projectRoot), "utf8"),
    readFile(new URL("app/HyperionApp.tsx", projectRoot), "utf8"),
  ]);

  assert.match(editorSource, /getInternalViewExtensions/);
  assert.match(editorSource, /affine:table/);
  assert.match(editorSource, /IndexedDBDocSource/);
  assert.match(appSource, /New vault/);
  assert.match(appSource, />Organize</);
  assert.match(appSource, /organizer-folder-notes/);
  assert.match(appSource, /Collections/);
  assert.match(appSource, /PreferencesDialog/);
});

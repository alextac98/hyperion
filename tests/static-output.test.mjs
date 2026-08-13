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
  const [editorSource, appSource, databaseSource, linksSource, iconPickerSource, emojiCatalogSource, globalStyles] = await Promise.all([
    readFile(new URL("app/editor/blocksuite-runtime.ts", projectRoot), "utf8"),
    readFile(new URL("app/HyperionApp.tsx", projectRoot), "utf8"),
    readFile(new URL("app/lib/local-database.ts", projectRoot), "utf8"),
    readFile(new URL("app/lib/page-links.ts", projectRoot), "utf8"),
    readFile(new URL("app/components/PageIconPicker.tsx", projectRoot), "utf8"),
    readFile(new URL("node_modules/emojibase-data/en/compact.json", projectRoot), "utf8"),
    readFile(new URL("app/globals.css", projectRoot), "utf8"),
  ]);
  const emojiCatalog = JSON.parse(emojiCatalogSource);
  const pickerEmoji = emojiCatalog.filter((emoji) => Number.isInteger(emoji.group) && emoji.group !== 2);

  assert.match(editorSource, /getInternalViewExtensions/);
  assert.match(editorSource, /affine:table/);
  assert.match(editorSource, /IndexedDBDocSource/);
  assert.match(editorSource, /event\.key\.toLowerCase\(\) !== "a"/);
  assert.match(editorSource, /scope\.selection\.create\(TextSelection/);
  assert.match(editorSource, /event\.stopImmediatePropagation\(\)/);
  assert.match(editorSource, /extension !== PageDraggingAreaViewExtension/);
  assert.match(appSource, /New vault/);
  assert.match(appSource, />Organize</);
  assert.match(appSource, /organizer-children/);
  assert.doesNotMatch(appSource, /Parent page/);
  assert.match(appSource, /className="details-tags"/);
  assert.match(appSource, /className="details-page-links"/);
  assert.doesNotMatch(appSource, /editor-commandbar/);
  assert.doesNotMatch(appSource, /insert-button/);
  assert.doesNotMatch(appSource, /commandbar-hint/);
  assert.match(appSource, /topbar-favorite/);
  assert.match(appSource, /topbar-history/);
  assert.match(appSource, /topbar-more/);
  assert.doesNotMatch(appSource, /Editor blocks/);
  assert.match(appSource, /onMoveNote/);
  assert.match(appSource, /Drop here for top level/);
  assert.match(appSource, /PAGE_DRAG_TYPE/);
  assert.doesNotMatch(appSource, /organizer-drag-handle/);
  assert.match(appSource, /className="organizer-page-link" draggable/);
  assert.match(appSource, /setData\(PAGE_DRAG_TYPE/);
  assert.match(appSource, /PageDropPlacement/);
  assert.match(appSource, /position < 0\.28/);
  assert.match(appSource, /position > 0\.72/);
  assert.match(appSource, /--organizer-drop-inset/);
  assert.match(appSource, /PAGE_ORDER_STEP/);
  assert.match(appSource, /PageIconPicker/);
  assert.match(appSource, /note-workspace.*has-page-icon/);
  assert.match(iconPickerSource, /note\.icon \? <PageIcon note=\{note\} size=\{38\}/);
  assert.match(iconPickerSource, /EMOJI_GROUPS/);
  assert.match(iconPickerSource, /emojibase-data\/en\/compact\.json/);
  assert.match(iconPickerSource, /emojiForSkinTone/);
  assert.ok(pickerEmoji.length >= 1_900);
  assert.ok(pickerEmoji.some((emoji) => emoji.label === "orca" && emoji.unicode === "🫍"));
  assert.ok(pickerEmoji.some((emoji) => emoji.label === "waving hand" && emoji.skins?.length === 5));
  assert.match(iconPickerSource, /AFFINE_ICONS/);
  assert.match(iconPickerSource, /Filter\.\.\./);
  assert.match(iconPickerSource, /Choose skin tone/);
  assert.match(iconPickerSource, /Choose icon color/);
  assert.match(iconPickerSource, /page-icon-category-bar/);
  assert.match(appSource, /Link another page/);
  assert.match(appSource, /Stable through moves/);
  assert.match(databaseSource, /targetId: string/);
  assert.match(databaseSource, /sortOrder: number/);
  assert.match(databaseSource, /icon: PageIconRecord \| null/);
  assert.match(databaseSource, /DATABASE_VERSION = 8/);
  assert.match(linksSource, /reconcilePageLinks/);
  assert.match(linksSource, /WIKI_LINK_PATTERN/);
  assert.match(appSource, /sidebarResizeRef/);
  assert.match(appSource, /SettingsDialog/);
  assert.match(globalStyles, /::selection\s*{[^}]*color:\s*var\(--text\)/s);
  assert.match(globalStyles, /::selection\s*{[^}]*-webkit-text-fill-color:\s*var\(--text\)/s);
});

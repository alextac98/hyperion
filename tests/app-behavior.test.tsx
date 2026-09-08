import { NoteDetails } from "../app/components/NoteDetails";
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createBlankNote } from "../app/lib/local-database";
import { movePage, patchPage } from "../app/application/page-operations";
import { buildNoteSearchIndex, searchNotes } from "../app/lib/note-search";
import { ancestorPath, descendantIds } from "../app/lib/page-tree";
import {
  readDocumentOutline,
  revealHeading,
  type OutlineBlock,
} from "../app/editor/document-outline";
import { observeMetadata } from "../app/editor/metadata-subscription";
import { findTextMatches } from "../app/lib/page-search";
import { Dialog } from "../app/components/Dialog";
import { SearchDialog } from "../app/components/SearchDialog";
import { useRecords } from "../app/hooks/useRecords";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
  pretendToBeVisual: true,
});
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "HTMLDialogElement",
  "Element",
  "Node",
  "MutationObserver",
  "localStorage",
  "navigator",
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key as keyof typeof dom.window],
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});
// jsdom has no top layer. These shims verify our use of the native modal API;
// browser-owned focus containment is not simulated here.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
  this.querySelector<HTMLElement>("input, button")?.focus();
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
const { createRoot } = await import("react-dom/client");

function page(id: string, title = id, parentId: string | null = null) {
  return { ...createBlankNote("vault", parentId), id, title, sortOrder: 1_000 };
}

async function mount(element: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  return {
    host,
    async unmount() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

function key(element: Element, value: string) {
  element.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
    }),
  );
}

test("renames preserve stable aliases and inline page identities through later edits", () => {
  const target = page("target", "Old title");
  const source = {
    ...page("source"),
    body: "See [[Old title]]",
    links: [
      { targetId: target.id, label: "Old title", kind: "inline" as const },
    ],
  };
  const renamed = patchPage(
    [target, source],
    target.id,
    { title: "New title" },
    target.title,
    "2026-09-04",
  )!;
  assert.deepEqual(renamed.note.aliases, ["Old title"]);
  const edited = patchPage(
    renamed.notes,
    source.id,
    { body: "See [[Old title]] again" },
    source.title,
    "2026-09-05",
  )!;
  assert.equal(edited.note.links[0].targetId, target.id);
  assert.equal(edited.notes[0].title, "New title");
  assert.equal(
    target.title,
    "Old title",
    "the original record remains unchanged",
  );
});

test("page moves reject cycles and retain sibling ordering", () => {
  const root = page("root");
  const child = page("child", "child", root.id);
  const sibling = { ...page("sibling"), sortOrder: 2_000 };
  const notes = [root, child, sibling];
  assert.equal(movePage(notes, root.id, child.id, "inside", "now"), notes);
  const moved = movePage(notes, sibling.id, child.id, "before", "now");
  assert.equal(moved[2].parentId, root.id);
  assert.ok(moved[2].sortOrder < moved[1].sortOrder);
  assert.equal(notes[2].parentId, null);
});

test("tree traversal terminates on malformed cycles without including the source", () => {
  const a = page("a", "a", "b");
  const b = page("b", "b", "a");
  assert.deepEqual([...descendantIds([a, b], "a")], ["b"]);
  assert.deepEqual(
    ancestorPath([a, b], a).map((p) => p.id),
    ["b"],
  );
});

test("search matches former names, case-insensitive tags, and parent titles", () => {
  const parent = page("parent", "Project Atlas");
  const child = {
    ...page("child", "Meeting", parent.id),
    tags: ["Research"],
    aliases: ["Old meeting"],
  };
  const index = buildNoteSearchIndex([parent, child]);
  for (const query of ["research", "OLD MEETING"])
    assert.deepEqual(
      searchNotes(index, query).notes.map((p) => p.id),
      ["child"],
    );
  assert.equal(searchNotes(index, "atlas").total, 2);
  assert.equal(
    searchNotes(
      buildNoteSearchIndex(
        Array.from({ length: 20 }, (_, i) => page(String(i), "match")),
      ),
      "match",
    ).total,
    20,
  );
});

test("outline includes actual headings in document order, including long headings", () => {
  const block = (id: string, type: string, text: string): OutlineBlock => ({
    id,
    flavour: "affine:paragraph",
    props: { type, text: { toString: () => text } },
  });
  const title =
    "A heading longer than the former seventy-two character heuristic should still appear in the outline";
  const root = {
    id: "root",
    flavour: "affine:page",
    children: [
      block("p", "text", "Short paragraph"),
      block("h", "h2", title),
      block("blank", "h1", " "),
      block("nested", "h3", "Nested"),
    ],
  };
  assert.deepEqual(readDocumentOutline(root), [
    { id: "h", title, level: 2 },
    { id: "nested", title: "Nested", level: 3 },
  ]);
});

test("outline navigation scrolls to the selected block and focuses its text", () => {
  const root = document.createElement("div");
  root.innerHTML =
    '<div data-block-id="heading"><div contenteditable="true" tabindex="0">Heading</div></div>';
  document.body.append(root);
  let scrolled = false;
  (root.firstElementChild as HTMLElement).scrollIntoView = () => {
    scrolled = true;
  };
  revealHeading(root, "heading");
  assert.ok(scrolled);
  assert.equal(document.activeElement?.textContent, "Heading");
  root.remove();
});

test("leaving an editor before the debounce expires publishes its final metadata once", () => {
  let changed = () => {};
  let unsubscribed = false;
  let value = "first";
  const published: string[] = [];
  const dispose = observeMetadata(
    (callback) => {
      changed = callback;
      return () => {
        unsubscribed = true;
      };
    },
    () => value,
    (next) => published.push(next),
    60_000,
  );
  changed();
  value = "final";
  changed();
  dispose();
  dispose();
  assert.deepEqual(published, ["final"]);
  assert.ok(unsubscribed);
});

test("immediate editor metadata is available to a same-turn save barrier", async () => {
  let changed = () => {};
  let value = "first";
  const published: string[] = [];
  const dispose = observeMetadata(
    (callback) => {
      changed = callback;
      return () => {};
    },
    () => value,
    (next) => published.push(next),
    0,
  );
  changed();
  value = "last edit before snapshot";
  changed();
  assert.deepEqual(published, ["first", "last edit before snapshot"]);
  dispose();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(published.length, 2, "cleanup must not queue a duplicate save");
});

test("in-page search finds text in editor shadow roots", () => {
  const root = document.createElement("div");
  const shadow = root.attachShadow({ mode: "open" });
  shadow.innerHTML = "<p>One match and another MATCH</p>";
  assert.deepEqual(
    findTextMatches(root, "match").map((m) => m.range.toString()),
    ["match", "MATCH"],
  );
});

test("dialogs enter modal mode, handle Escape cancellation, and restore focus", async () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  let closed = 0;
  const ui = await mount(
    <StrictMode>
      <Dialog
        label="Example"
        onClose={() => {
          closed += 1;
        }}
      >
        <button>Inside</button>
      </Dialog>
    </StrictMode>,
  );
  const dialog = ui.host.querySelector("dialog")!;
  assert.ok(dialog.open);
  assert.equal(document.activeElement?.textContent, "Inside");
  await act(async () => {
    dialog.dispatchEvent(new dom.window.Event("cancel", { cancelable: true }));
  });
  assert.equal(closed, 1);
  await ui.unmount();
  assert.equal(document.activeElement, trigger);
  trigger.remove();
});

test("search supports arrow selection and Enter opens the selected result", async () => {
  const opened: string[] = [];
  let closed = false;
  const ui = await mount(
    <SearchDialog
      notes={[page("first"), page("second")]}
      onSelect={(id) => opened.push(id)}
      onClose={() => {
        closed = true;
      }}
    />,
  );
  const input = ui.host.querySelector("input")!;
  await act(async () => key(input, "ArrowDown"));
  assert.equal(
    ui.host.querySelector('[aria-selected="true"] strong')?.textContent,
    "second",
  );
  await act(async () => key(input, "Enter"));
  assert.deepEqual(opened, ["second"]);
  assert.ok(closed);
  await ui.unmount();
});

test("record commands execute once under Strict Mode and preserve batched edits", async () => {
  let commands = 0;
  function Probe() {
    const [records, replace] = useRecords<number>([]);
    return (
      <button
        onClick={() => {
          replace((items) => {
            commands += 1;
            return [...items, 1];
          });
          replace((items) => [...items, 2]);
        }}
      >
        {records.join(",")}
      </button>
    );
  }
  const ui = await mount(
    <StrictMode>
      <Probe />
    </StrictMode>,
  );
  await act(async () => ui.host.querySelector("button")!.click());
  assert.equal(commands, 1);
  assert.equal(ui.host.textContent, "1,2");
  await ui.unmount();
});

test("in-page search keeps correct offsets after Unicode case folding and treats punctuation literally", () => {
  const root = document.createElement("div");
  root.textContent = "İabcabc [literal]";
  assert.deepEqual(
    findTextMatches(root, "abc").map((m) => m.range.toString()),
    ["abc", "abc"],
  );
  assert.deepEqual(
    findTextMatches(root, "[literal]").map((m) => m.range.toString()),
    ["[literal]"],
  );
});

test("details remove the source page's manual link without changing the target", async () => {
  const target = page("target", "Target");
  const source = {
    ...page("source", "Source"),
    links: [
      { targetId: target.id, label: target.title, kind: "manual" as const },
    ],
  };
  const changes: unknown[] = [];
  const ui = await mount(
    <NoteDetails
      note={source}
      notes={[source, target]}
      store={null}
      onSelect={() => {}}
      onChange={(patch) => changes.push(patch)}
    />,
  );
  const remove = ui.host.querySelector<HTMLButtonElement>(
    'button[aria-label="Remove link to Target"]',
  )!;
  assert.ok(remove);
  await act(async () => remove.click());
  assert.deepEqual(changes, [{ links: [] }]);
  assert.equal(source.links.length, 1);
  await ui.unmount();
});

test("editor initialization overlaps view loading and reuses preloaded modules", async () => {
  const { createEditorLoader } = await import("../app/editor/editor-loader");
  let finishView!: (value: string) => void;
  const viewReady = new Promise<string>((resolve) => {
    finishView = resolve;
  });
  let runtimeLoads = 0;
  let viewLoads = 0;
  const loader = createEditorLoader(
    async () => {
      runtimeLoads += 1;
      return "runtime";
    },
    () => {
      viewLoads += 1;
      return viewReady;
    },
  );
  const preload = loader.preload();
  let initialized!: () => void;
  const storeStarted = new Promise<void>((resolve) => {
    initialized = resolve;
  });
  let mounted = false;
  const opened = loader
    .open(async (runtime) => {
      assert.equal(runtime, "runtime");
      initialized();
      return "document";
    })
    .then((result) => {
      mounted = true;
      return result;
    });
  await storeStarted;
  assert.equal(
    mounted,
    false,
    "storage starts while view code is still loading",
  );
  finishView("view");
  assert.deepEqual(await opened, {
    runtime: "runtime",
    store: "document",
    view: "view",
  });
  await preload;
  await loader.open(async () => "another document");
  assert.equal(runtimeLoads, 1);
  assert.equal(viewLoads, 1);
});

test("failed editor preloading can retry without reloading successful modules", async () => {
  const { createEditorLoader } = await import("../app/editor/editor-loader");
  let attempts = 0;
  let viewLoads = 0;
  const loader = createEditorLoader(
    async () => {
      if (++attempts === 1) throw new Error("Temporary load failure");
      return "runtime";
    },
    async () => {
      viewLoads += 1;
      return "view";
    },
  );
  await assert.rejects(loader.preload(), /Temporary load failure/);
  assert.equal((await loader.open(async () => "document")).store, "document");
  assert.equal(attempts, 2);
  assert.equal(viewLoads, 1);
});

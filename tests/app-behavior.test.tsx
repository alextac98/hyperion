import { SidebarOrganizer } from "../app/components/SidebarOrganizer";
import { UpdateControls } from "../app/components/UpdateControls";
import type { UpdateState } from "../electron/updates";
import type { HyperionDesktopApi } from "../app/platform/desktop-api";
import { PageConnections, backlinkExcerpt } from "../app/components/PageConnections";
import { PageTags } from "../app/components/PageTags";
import { MiniDocumentOutline } from "../app/components/MiniDocumentOutline";
import type { EditorStore } from "../app/editor/editor-client";
import { usePageContext } from "../app/hooks/usePageContext";
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, StrictMode, useState } from "react";
import { createBlankNote } from "../app/lib/local-database";
import { reconcilePageLinks } from "../app/lib/page-links";
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
import { NavigationHistory, type NavigationLocation, type NavigationDirection } from "../app/application/navigation-history";
import { useMouseNavigation } from "../app/hooks/useMouseNavigation";
import { PAGE_DRAG_TYPE, readPageDrag, writePageDrag } from "../app/application/page-drag";

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

test("navigation history deduplicates visits, respects boundaries and branches after Back", () => {
  const history = new NavigationHistory();
  const available = () => true;
  history.visit({ view: "home" });
  assert.equal(history.move("back", available), null);
  history.visit({ view: "note", id: "a" });
  history.visit({ view: "note", id: "a" });
  assert.deepEqual(history.move("back", available), { view: "home" });
  assert.deepEqual(history.move("forward", available), {
    view: "note",
    id: "a",
  });
  assert.equal(history.move("forward", available), null);
  history.move("back", available);
  history.visit({ view: "journal" });
  assert.equal(history.move("forward", available), null);
  assert.deepEqual(history.move("back", available), { view: "home" });
});

test("navigation skips unavailable destinations and restores tag and template context", () => {
  const history = new NavigationHistory();
  const locations: NavigationLocation[] = [
    { view: "tags", tag: "ideas" },
    { view: "note", id: "deleted" },
    { view: "template", id: "template" },
  ];
  locations.forEach((location) => history.visit(location));
  const available = (location: NavigationLocation) => location.view !== "note";
  assert.deepEqual(history.move("back", available), locations[0]);
  assert.deepEqual(history.move("forward", available), locations[2]);
  assert.equal(
    history.move("back", () => false),
    null,
  );
  assert.deepEqual(history.move("back", available), locations[0]);
});

test("navigation history bounds retained visits", () => {
  const history = new NavigationHistory();
  for (let i = 0; i < 150; i++) history.visit({ view: "note", id: String(i) });
  let count = 0;
  while (history.move("back", () => true)) count++;
  assert.equal(count, 99);
});

test("mouse navigation handles thumb buttons, native commands, blocking, vault resets and cleanup", async () => {
  let native: ((direction: NavigationDirection) => void) | undefined;
  let subscriptions = 0;
  const previous = window.hyperionDesktop;
  window.hyperionDesktop = {
    onNavigate: (callback) => {
      native = callback;
      subscriptions++;
      return () => {
        native = undefined;
        subscriptions--;
      };
    },
  } as HyperionDesktopApi;
  let setLocation!: (location: NavigationLocation) => void;
  let setVault!: (vault: string) => void;
  let setLoading!: (loading: boolean) => void;
  let blocked = false;
  const navigated: NavigationLocation[] = [];
  function Harness() {
    const [location, updateLocation] = useState<NavigationLocation>({
      view: "home",
    });
    const [vaultId, updateVault] = useState("one");
    const [loading, updateLoading] = useState(false);
    setLocation = updateLocation;
    setVault = updateVault;
    setLoading = updateLoading;
    useMouseNavigation({
      vaultId,
      loading,
      location,
      isBlocked: () => blocked,
      isAvailable: () => true,
      onNavigate: (next) => {
        navigated.push(next);
        updateLocation(next);
      },
    });
    return <button>Mouse target</button>;
  }
  const ui = await mount(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  const mouse = async (button: number) => {
    const events = ["mousedown", "mouseup", "auxclick"].map(
      (type) =>
        new dom.window.MouseEvent(type, {
          button,
          bubbles: true,
          cancelable: true,
        }),
    );
    await act(async () => {
      events.forEach((event) =>
        ui.host.querySelector("button")!.dispatchEvent(event),
      );
    });
    return events;
  };
  try {
    assert.equal(subscriptions, 1);
    await act(async () => setLocation({ view: "note", id: "a" }));
    for (const button of [0, 1, 2])
      assert.ok(
        (await mouse(button)).every((event) => !event.defaultPrevented),
      );
    assert.equal(navigated.length, 0);
    assert.ok((await mouse(3)).every((event) => event.defaultPrevented));
    assert.deepEqual(navigated, [{ view: "home" }]);
    await mouse(3); // Boundary: still suppress document navigation.
    assert.equal(navigated.length, 1);
    await mouse(4);
    assert.deepEqual(navigated.at(-1), { view: "note", id: "a" });
    blocked = true;
    await mouse(3);
    assert.equal(navigated.length, 2);
    blocked = false;
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    await act(async () => native!("back"));
    assert.equal(navigated.length, 2);
    dialog.remove();
    await act(async () => native!("back"));
    assert.deepEqual(navigated.at(-1), { view: "home" });
    await act(async () => native!("forward"));
    assert.deepEqual(navigated.at(-1), { view: "note", id: "a" });
    await act(async () => setVault("two"));
    await mouse(3);
    assert.equal(navigated.length, 4);
    await act(async () => setLocation({ view: "journal" }));
    await act(async () => setLoading(true));
    await mouse(3);
    assert.equal(navigated.length, 4);
    await act(async () => setLoading(false));
    await mouse(3);
    assert.equal(navigated.length, 4);
  } finally {
    await ui.unmount();
    window.hyperionDesktop = previous;
  }
  assert.equal(subscriptions, 0);
  const after = new dom.window.MouseEvent("auxclick", {
    button: 3,
    cancelable: true,
  });
  window.dispatchEvent(after);
  assert.equal(after.defaultPrevented, false);
});

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
  assert.equal(window.getSelection()?.anchorNode?.textContent, "Heading");
  assert.equal(window.getSelection()?.isCollapsed, true);
  root.remove();
});

test("outline navigation focuses BlockSuite's outer editable root and moves its caret", () => {
  const root = document.createElement("div");
  root.innerHTML = '<affine-page-root contenteditable="true" tabindex="0"><div data-block-id="target"><div contenteditable="true">Target heading</div></div></affine-page-root>';
  document.body.append(root);
  let options: ScrollIntoViewOptions | undefined;
  root.querySelector<HTMLElement>('[data-block-id]')!.scrollIntoView = value => { options = value as ScrollIntoViewOptions; };
  const previousMatchMedia = window.matchMedia;
  window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
  try {
    revealHeading(root, "target");
    assert.equal(document.activeElement, root.firstElementChild);
    assert.equal(window.getSelection()?.anchorNode?.textContent, "Target heading");
    assert.equal(window.getSelection()?.isCollapsed, true);
    assert.equal(options?.behavior, "auto", "navigation respects reduced motion");
  } finally { root.remove(); window.matchMedia = previousMatchMedia; }
});

function outlineStore(levels: number[]) {
  const listeners = new Set<() => void>();
  const children = levels.map((level, index): OutlineBlock => ({
    id: `heading-${index}`,
    flavour: "affine:paragraph",
    props: { type: `h${level}`, text: `Heading ${index + 1}` },
  }));
  const root: OutlineBlock = { id: "root", flavour: "affine:page", children };
  const store = {
    root,
    slots: { blockUpdated: { subscribe(callback: () => void) {
      listeners.add(callback);
      return { unsubscribe: () => listeners.delete(callback) };
    } } },
  } as unknown as EditorStore;
  return { store, children, listeners, refresh: () => listeners.forEach(callback => callback()) };
}

test("mini outline preserves every heading level and updates when headings change or disappear", async () => {
  const source = outlineStore([1, 2, 3, 4, 5, 6]);
  const ui = await mount(<StrictMode><MiniDocumentOutline store={source.store} editorRef={{ current: null }} active={false} /></StrictMode>);
  try {
    const marks = () => Array.from(ui.host.querySelectorAll<HTMLElement>(".mini-outline-mark"));
    assert.deepEqual(marks().map(mark => mark.dataset.level), ["1", "2", "3", "4", "5", "6"]);
    const labels = Array.from(ui.host.querySelectorAll<HTMLButtonElement>(".mini-outline-list button"));
    assert.deepEqual(labels.map(button => button.getAttribute("aria-label")), [1, 2, 3, 4, 5, 6].map((level, index) => `Heading ${index + 1}, heading level ${level}`));
    assert.equal(source.listeners.size, 1, "Strict Mode keeps one subscription");
    await act(async () => {
      source.children[2].props = { type: "h1", text: "Renamed section" };
      source.refresh();
    });
    assert.equal(marks()[2].dataset.level, "1");
    assert.equal(ui.host.querySelectorAll(".mini-outline-list button")[2].textContent, "Renamed section");
    await act(async () => { source.children.splice(1); source.refresh(); });
    assert.equal(ui.host.querySelector("nav"), null, "one heading does not need a mini outline");
  } finally { await ui.unmount(); }
  assert.equal(source.listeners.size, 0);
});

test("mini outline supports focus, Escape, outside dismissal and navigation in its own editor", async () => {
  const source = outlineStore([2, 4]);
  const other = document.createElement("div");
  other.innerHTML = '<div data-block-id="heading-1"><div contenteditable="true" tabindex="0">Other editor</div></div>';
  const editor = document.createElement("div");
  editor.innerHTML = '<div data-block-id="heading-1"><div contenteditable="true" tabindex="0">Selected section</div></div>';
  document.body.append(other, editor);
  let scrolled = 0;
  (other.firstElementChild as HTMLElement).scrollIntoView = () => assert.fail("navigated the wrong editor");
  (editor.firstElementChild as HTMLElement).scrollIntoView = () => { scrolled++; };
  const ui = await mount(<MiniDocumentOutline store={source.store} editorRef={{ current: editor }} active={false} />);
  try {
    const trigger = ui.host.querySelector<HTMLButtonElement>(".mini-outline-trigger")!;
    const popover = ui.host.querySelector<HTMLElement>(".mini-outline-popover")!;
    assert.equal(popover.hidden, true);
    await act(async () => trigger.focus());
    assert.equal(popover.hidden, false);
    const entries = ui.host.querySelectorAll<HTMLButtonElement>(".mini-outline-list button");
    await act(async () => { entries[1].focus(); key(entries[1], "Escape"); });
    assert.equal(popover.hidden, true);
    assert.equal(document.activeElement, trigger);
    await act(async () => trigger.click());
    assert.equal(popover.hidden, false);
    await act(async () => document.body.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true })));
    assert.equal(popover.hidden, true);
    await act(async () => { trigger.click(); entries[1].click(); });
    assert.equal(scrolled, 1);
    assert.equal(document.activeElement?.textContent, "Selected section");
    assert.equal(popover.hidden, true);
    assert.equal(entries[1].getAttribute("aria-current"), "location");
  } finally { await ui.unmount(); other.remove(); editor.remove(); }
});

test("mini outline follows scrolling and releases its observers when inactive", async () => {
  const source = outlineStore([1, 2, 3]);
  const previousObserver = window.ResizeObserver;
  let observing = 0;
  let resize = () => {};
  window.ResizeObserver = class {
    targets = 0;
    constructor(callback: () => void) { resize = callback; }
    observe() { observing++; this.targets++; }
    disconnect() { observing -= this.targets; this.targets = 0; }
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  const editor = document.createElement("div");
  editor.innerHTML = source.children.map(block => `<div data-block-id="${block.id}"></div>`).join("");
  scroller.append(editor);
  document.body.append(scroller);
  let offset = 0;
  Array.from(editor.children).forEach((block, index) => {
    block.getBoundingClientRect = () => ({ top: 120 + index * 300 - offset } as DOMRect);
  });
  let setActive!: (active: boolean) => void;
  function Harness() {
    const [active, change] = useState(true);
    setActive = change;
    return <MiniDocumentOutline store={source.store} editorRef={{ current: editor }} active={active} />;
  }
  const ui = await mount(<Harness />);
  const nextFrame = () => new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
  const current = () => ui.host.querySelector(".mini-outline-list [aria-current]")?.textContent;
  try {
    await act(nextFrame);
    assert.equal(current(), "Heading 1");
    await act(async () => { offset = 700; scroller.dispatchEvent(new dom.window.Event("scroll")); await nextFrame(); });
    assert.equal(current(), "Heading 3");
    await act(async () => { offset = 0; resize(); await nextFrame(); });
    assert.equal(current(), "Heading 1");
    assert.equal(observing, 2);
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 600 });
    await act(async () => {
      offset = 100;
      scroller.scrollTop = 400;
      scroller.dispatchEvent(new dom.window.Event("scroll"));
      await nextFrame();
    });
    assert.equal(current(), "Heading 3", "the final section stays current at the bottom of the page");
    await act(async () => ui.host.querySelector<HTMLButtonElement>(".mini-outline-trigger")!.click());
    await act(async () => setActive(false));
    assert.equal(observing, 0);
    assert.equal(ui.host.querySelector<HTMLElement>(".mini-outline-popover")!.hidden, true);
    await act(async () => { offset = 700; scroller.dispatchEvent(new dom.window.Event("scroll")); await nextFrame(); });
    assert.equal(current(), "Heading 3");
  } finally { await ui.unmount(); scroller.remove(); window.ResizeObserver = previousObserver; }
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
  let escapedKeys = 0;
  const backgroundEditor = () => escapedKeys++;
  document.addEventListener("keydown", backgroundEditor);
  const input = ui.host.querySelector("input")!;
  await act(async () => key(input, "ArrowDown"));
  assert.equal(
    ui.host.querySelector('[aria-selected="true"] strong')?.textContent,
    "second",
  );
  await act(async () => key(input, "Enter"));
  assert.deepEqual(opened, ["second"]);
  assert.ok(closed);
  assert.equal(escapedKeys, 0, "dialog keys must not reach mounted editors");
  document.removeEventListener("keydown", backgroundEditor);
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

test("connections remove the source page's manual link without changing the target", async () => {
  const target = page("target", "Target");
  const source = {
    ...page("source", "Source"),
    links: [
      { targetId: target.id, label: target.title, kind: "manual" as const },
    ],
  };
  const changes: unknown[] = [];
  const ui = await mount(
    <PageConnections
      note={source}
      notes={[source, target]}
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

test("page context closes on navigation, persists pins per vault, and remembers closing after restart", async () => {
  localStorage.clear();
  let context!: ReturnType<typeof usePageContext>;
  let navigate!: (id: string) => void;
  let switchVault!: (id: string) => void;
  function Harness() {
    const [vaultId, setVaultId] = useState("context-a");
    const [noteId, setNoteId] = useState("one");
    navigate = setNoteId;
    switchVault = setVaultId;
    context = usePageContext(vaultId, noteId, true);
    return <span>{context.view ?? "closed"}</span>;
  }
  let ui = await mount(<StrictMode><Harness /></StrictMode>);
  try {
    assert.equal(context.view, null);
    await act(async () => context.toggle("outline"));
    assert.equal(context.view, "outline");
    await act(async () => navigate("two"));
    assert.equal(context.view, null);
    await act(async () => navigate("one"));
    assert.equal(context.view, null, "returning to a page does not reopen unpinned context");
    await act(async () => context.toggle("connections"));
    await act(async () => context.togglePin());
    await act(async () => navigate("two"));
    assert.equal(context.view, "connections");
    await ui.unmount();
    ui = await mount(<StrictMode><Harness /></StrictMode>);
    assert.equal(context.view, "connections");
    assert.equal(context.pinned, true);
    await act(async () => switchVault("context-b"));
    assert.equal(context.view, null);
    await act(async () => context.toggle("history"));
    await act(async () => context.togglePin());
    await act(async () => switchVault("context-a"));
    assert.equal(context.view, "connections");
    await act(async () => context.close());
    await ui.unmount();
    ui = await mount(<StrictMode><Harness /></StrictMode>);
    assert.equal(context.view, null);
    assert.equal(context.pinned, false);
    await act(async () => switchVault("context-b"));
    assert.equal(context.view, "history", "closing one vault's context preserves another vault's pin");
    await act(async () => context.toggle("outline"));
    assert.equal(context.pinned, true, "switching the pinned view keeps it pinned");
    await act(async () => context.toggle("outline"));
    assert.equal(context.view, null);
    assert.equal(context.pinned, false);
  } finally { await ui.unmount(); localStorage.clear(); }
});

test("connections show the actual backlink passage and omit empty sections", async () => {
  const target = page("target", "Target");
  const source = { ...page("source", "Source"), body: "Connect this question to [[Target]] before returning to the project.", links: [{ targetId: target.id, label: target.title, kind: "inline" as const }] };
  assert.match(backlinkExcerpt(source, target.id), /question to \[\[Target\]\]/);
  assert.equal(backlinkExcerpt({ ...source, links: [{ ...source.links[0], kind: "manual" }] }, target.id), "");
  const ui = await mount(<PageConnections note={target} notes={[target, source]} onSelect={() => {}} onChange={() => {}} />);
  assert.match(ui.host.textContent!, /Connect this question to \[\[Target\]\]/);
  assert.equal(ui.host.querySelectorAll("section").length, 1);
  assert.equal(ui.host.textContent!.includes("Links from this page"), false);
  await ui.unmount();
});

test("backlink excerpts preserve recognized padded and repeated-whitespace wiki links", async () => {
  const target = page("target", "Project  notes");
  for (const mention of ["[[ Project  notes ]]", "[[\tProject  notes\t]]", "[[PROJECT  NOTES]]"]) {
    const source = reconcilePageLinks({
      ...page("source", "Source"),
      body: `An unrelated [[Other]] comes first.\nReturn to ${mention} for the next experiment.`,
    }, [target]);
    assert.equal(source.links[0]?.targetId, target.id);
    const passage = `Return to ${mention.replace(/\s+/g, " ")} for the next experiment.`;
    assert.ok(backlinkExcerpt(source, target.id).includes(passage));
    const ui = await mount(<PageConnections note={target} notes={[target, source]} onSelect={() => {}} onChange={() => {}} />);
    try { assert.ok(ui.host.querySelector(".connection-text small")?.textContent?.includes(passage)); }
    finally { await ui.unmount(); }
  }
  const invalid = reconcilePageLinks({ ...page("source"), body: "Not a link: [[Project\n notes]]" }, [target]);
  assert.equal(backlinkExcerpt(invalid, target.id), "");
});

test("page tags normalize additions, reject duplicates, and support keyboard cancellation", async () => {
  const changes: Partial<import("../app/lib/local-database").NoteRecord>[] = [];
  const note = { ...page("tagged"), tags: ["ideas"] };
  const ui = await mount(<PageTags note={note} onChange={patch => changes.push(patch)} />);
  try {
    const add = ui.host.querySelector<HTMLButtonElement>('[aria-label="Add tag"]')!;
    const enter = async (value: string) => {
      await act(async () => add.click());
      const input = ui.host.querySelector<HTMLInputElement>('input')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      await act(async () => ui.host.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    };
    await enter(" #Reading ");
    assert.deepEqual(changes, [{ tags: ["ideas", "reading"] }]);
    await enter("IDEAS");
    assert.equal(changes.length, 1);
    await act(async () => add.click());
    await act(async () => key(ui.host.querySelector("input")!, "Escape"));
    assert.equal(ui.host.querySelector("input"), null);
    assert.equal(document.activeElement, add);
    await act(async () => ui.host.querySelector<HTMLButtonElement>('[aria-label="Remove tag ideas"]')!.click());
    assert.deepEqual(changes[1], { tags: [] });
  } finally { await ui.unmount(); }
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


test("update controls show progress, retry and explicit restart without installing on mount", async () => {
  const previous = window.hyperionDesktop;
  let listener: ((state: UpdateState) => void) | undefined;
  let downloads = 0, installs = 0, manual = 0, unsubscribed = false;
  const initial: UpdateState = { status: "available", currentVersion: "0.1.0", version: "0.4.0", percent: null, message: null, checkedAt: null, retry: "check" };
  window.hyperionDesktop = {
    updateState: async () => initial,
    onUpdateState: (callback: (state: UpdateState) => void) => { listener = callback; return () => { unsubscribed = true; }; },
    downloadUpdate: async () => { downloads++; },
    installUpdate: async () => { installs++; },
    downloadUpdateManually: async () => { manual++; },
  } as unknown as HyperionDesktopApi;
  const view = await mount(<UpdateControls />);
  const click = async (text: string) => {
    const button = [...view.host.querySelectorAll("button")].find(item => item.textContent === text);
    assert.ok(button, text);
    await act(async () => button.click());
  };
  try {
    assert.equal(installs, 0);
    await click("Download update");
    assert.equal(downloads, 1);
    await act(async () => listener?.({ ...initial, status: "downloading", percent: 45 }));
    assert.equal(view.host.querySelector("progress")?.value, 45);
    await act(async () => listener?.({ ...initial, status: "error", message: "Download failed", retry: "download" }));
    assert.match(view.host.textContent ?? "", /Download failed/);
    await click("Retry");
    assert.equal(downloads, 2);
    await click("Download manually");
    assert.equal(manual, 1);
    await act(async () => listener?.({ ...initial, status: "ready", percent: 100 }));
    assert.equal(installs, 0);
    await click("Restart to update");
    assert.equal(installs, 1);
  } finally {
    await view.unmount();
    window.hyperionDesktop = previous;
  }
  assert.equal(unsubscribed, true);
});

test("sidebar update icon is hidden until a version is available", async () => {
  const previous = window.hyperionDesktop;
  let listener: ((state: UpdateState) => void) | undefined;
  const initial: UpdateState = { status: "idle", currentVersion: "0.1.0", version: null, percent: null, message: null, checkedAt: null, retry: "check" };
  window.hyperionDesktop = {
    updateState: async () => initial,
    onUpdateState: (callback: (state: UpdateState) => void) => { listener = callback; return () => {}; },
  } as unknown as HyperionDesktopApi;
  let detailsOpened = 0;
  const view = await mount(<UpdateControls compact onOpenDetails={() => { detailsOpened++; }} />);
  try {
    assert.equal(view.host.querySelector("button"), null);
    await act(async () => listener?.({ ...initial, status: "checking" }));
    assert.equal(view.host.querySelector("button"), null);
    await act(async () => listener?.({ ...initial, status: "error", message: "Offline" }));
    assert.equal(view.host.querySelector("button"), null);
    await act(async () => listener?.({ ...initial, status: "available", version: "0.1.1" }));
    assert.equal(view.host.querySelectorAll("button").length, 1);
    assert.match(view.host.querySelector("button")?.getAttribute("aria-label") ?? "", /Download Hyperion 0.1.1/);
    await act(async () => listener?.({ ...initial, status: "downloading", version: "0.1.1", percent: 45 }));
    assert.match(view.host.querySelector("button")?.getAttribute("aria-label") ?? "", /45%/);
    const failed: UpdateState = { ...initial, status: "error", version: "0.1.1", retry: "download", message: "Download failed" };
    await act(async () => listener?.(failed));
    assert.ok(view.host.querySelector(".update-error-badge"));
    await act(async () => view.host.querySelector("button")?.focus());
    assert.match(document.querySelector('[role="tooltip"]')?.textContent ?? "", /An error occurred while downloading/);
    await act(async () => key(view.host.querySelector("button")!, "Escape"));
    assert.equal(document.querySelector('[role="tooltip"]'), null);
    await act(async () => view.host.querySelector("button")?.click());
    assert.equal(detailsOpened, 1);
    assert.equal(view.host.querySelector("button"), null);
    await act(async () => listener?.(failed));
    assert.equal(view.host.querySelector("button"), null);
    await act(async () => listener?.({ ...initial, status: "downloading", version: "0.1.1", percent: 0 }));
    assert.ok(view.host.querySelector("button"));
    await act(async () => listener?.(failed));
    assert.ok(view.host.querySelector(".update-error-badge"));
    await act(async () => listener?.({ ...initial, status: "ready", version: "0.1.1" }));
    assert.match(view.host.querySelector("button")?.getAttribute("aria-label") ?? "", /Restart to update/);
  } finally {
    await view.unmount();
    window.hyperionDesktop = previous;
  }
});

test("nested note groups follow expand and collapse without changing page selection", async () => {
  const selected: string[] = [];
  const ui = await mount(
    <SidebarOrganizer
      notes={[
        page("root"),
        page("child", "Child", "root"),
        page("grandchild", "Grandchild", "child"),
        page("sibling"),
      ]}
      view="note"
      activeNoteId="grandchild"
      onCreatePage={() => {}}
      onMoveNote={() => {}}
      onOpenNote={(id) => selected.push(id)}
      onContextMenu={() => {}}
    />,
  );
  try {
    const groups = () => ui.host.querySelectorAll('[role="group"]');
    assert.equal(groups().length, 2);
    assert.ok(groups()[0].contains(groups()[1]));
    await act(async () =>
      ui.host
        .querySelector<HTMLButtonElement>('[aria-label="Collapse root"]')!
        .click(),
    );
    assert.equal(groups().length, 0);
    assert.equal(ui.host.querySelector('[data-page-id="grandchild"]'), null);
    await act(async () =>
      ui.host
        .querySelector<HTMLButtonElement>('[aria-label="Expand root"]')!
        .click(),
    );
    assert.equal(groups().length, 2);
    await act(async () =>
      ui.host
        .querySelector<HTMLButtonElement>(
          '[data-page-id="grandchild"] .organizer-page-link',
        )!
        .click(),
    );
    assert.deepEqual(selected, ["grandchild"]);
    assert.ok(ui.host.querySelector('[data-page-id="sibling"]'));
  } finally {
    await ui.unmount();
  }
});

// Workspace tabs use document identity, independently of mutable page titles.
import { initialTabs, locationKey, restoreTabs, tabsReducer } from "../app/application/workspace-tabs";

test("workspace tabs open beside active, deduplicate and return to most recent on close", () => {
  const a = { view: "note", id: "a" } as const;
  const b = { view: "note", id: "b" } as const;
  const c = { view: "note", id: "c" } as const;
  let state = initialTabs(a);
  state = tabsReducer(state, { type: "open", location: b });
  state = tabsReducer(state, { type: "open", location: a });
  assert.equal(state.tabs.length, 2);
  state = tabsReducer(state, { type: "open", location: c });
  assert.deepEqual(state.tabs.map(tab => tab.location), [a, c, b]);
  state = tabsReducer(state, { type: "close", id: locationKey(c) });
  assert.equal(state.active, locationKey(a));
  state = tabsReducer(state, { type: "close", id: locationKey(a) });
  assert.equal(state.active, locationKey(b));
  state = tabsReducer(state, { type: "close", id: locationKey(b) });
  assert.deepEqual(state.tabs[0].location, { view: "home" });
});

test("workspace tabs restore only available unique destinations and lazily visit panels", () => {
  const a = { view: "note", id: "a" } as const;
  const b = { view: "note", id: "b" } as const;
  const state = restoreTabs(JSON.stringify({ version: 1, locations: [a, a, b, { view: "note", id: "deleted" }, { view: "invalid" }], active: locationKey(b) }), location => !("id" in location) || location.id !== "deleted", { view: "home" });
  assert.equal(state.tabs.length, 2);
  assert.deepEqual(state.tabs.map(tab => tab.visited), [false, true]);
  assert.equal(state.active, locationKey(b));
  assert.deepEqual(restoreTabs("broken", () => true, a), initialTabs(a));
  const pruned = tabsReducer(state, { type: "prune", ids: [locationKey(b)] });
  assert.equal(pruned.active, locationKey(a));
  assert.equal(pruned.tabs[0].visited, true);
});

import { useWorkspaceTabs } from "../app/hooks/useWorkspaceTabs";
import { canSplitPane, layoutMinimum, layoutPanes, restoreLayout } from "../app/application/workspace-layout";

function splitSession() {
  const ids = ["a", "b", "c", "d"].map(id => locationKey({ view: "note", id }));
  const leaf = (id: string, views: string[], activeView = views[0]) => ({ type: "leaf", size: 400, data: { id, views, activeView } });
  const layout = restoreLayout({
    grid: { width: 1000, height: 800, orientation: "HORIZONTAL", root: {
      type: "branch", data: [leaf("left", ids.slice(0, 2), ids[1]), {
        type: "branch", size: 500, data: [leaf("top", [ids[2]]), leaf("bottom", [ids[3]])],
      }],
    } }, activeGroup: "top",
  }, ids)!;
  return { ids, layout };
}

test("workspace layouts preserve nested axes, order and every visible tab across restore", () => {
  const { ids, layout } = splitSession();
  const restored = restoreTabs(JSON.stringify({ version: 2, locations: ids.map(id => JSON.parse(id)), active: ids[2], layout }), () => true, { view: "home" });
  assert.deepEqual(restored.tabs.map(tab => tab.visited), [false, true, true, true]);
  assert.deepEqual(layoutPanes(restored.layout).map(pane => pane.views), [ids.slice(0, 2), [ids[2]], [ids[3]]]);
  assert.deepEqual(layoutMinimum(restored.layout), { width: 644, height: 484 });
  const pruned = restoreTabs(JSON.stringify({ version: 2, locations: ids.map(id => JSON.parse(id)), active: ids[2], layout }), location => !("id" in location) || location.id !== "c", { view: "home" });
  assert.equal(layoutPanes(pruned.layout).length, 2);
  assert.deepEqual(layoutMinimum(pruned.layout), { width: 644, height: 240 });
  assert.equal(pruned.active, ids[0]);
});

test("workspace layout recovery removes duplicate and missing pages and rejects foreign components", () => {
  const { ids, layout } = splitSession();
  const panes = layoutPanes(layout);
  panes[1].views.push(ids[0], "missing");
  layout.panels[ids[0]] = { id: ids[0], contentComponent: "foreign", params: { secret: "ignored" } };
  layout.floatingGroups = [{ data: { id: "floating", views: [ids[0]] }, position: { left: 0, top: 0, width: 400, height: 300 } }];
  const recovered = restoreLayout(layout, ids.slice(0, 3))!;
  assert.deepEqual(layoutPanes(recovered).flatMap(pane => pane.views), ids.slice(0, 3));
  assert.equal(recovered.panels[ids[0]].contentComponent, "workspace-page");
  assert.equal(recovered.panels[ids[0]].params, undefined);
  assert.equal(recovered.floatingGroups, undefined);
  assert.equal(restoreLayout({ grid: { orientation: "broken" } }, ids), undefined);
  assert.equal(restoreLayout({ grid: { orientation: "HORIZONTAL", root: { type: "branch", data: [null, { type: "leaf", data: null }] } } }, ids), undefined);
});

test("split limits account for both resulting panes and the divider", () => {
  assert.equal(canSplitPane(643, 600, "right"), false);
  assert.equal(canSplitPane(644, 239, "left"), false);
  assert.equal(canSplitPane(644, 240, "left"), true);
  assert.equal(canSplitPane(320, 483, "bottom"), false);
  assert.equal(canSplitPane(319, 484, "top"), false);
  assert.equal(canSplitPane(320, 484, "bottom"), true);
});

test("pane focus and close preserve layout and choose a remaining tab in the same pane", () => {
  const { ids, layout } = splitSession();
  let state = initialTabs(JSON.parse(ids[0]));
  for (const id of ids.slice(1)) state = tabsReducer(state, { type: "open", location: JSON.parse(id) });
  state = tabsReducer(state, { type: "layout", layout });
  assert.equal(state.active, ids[2]);
  state = tabsReducer(state, { type: "focus", id: ids[1] });
  assert.ok(state.layout);
  state = tabsReducer(state, { type: "close", id: ids[1] });
  assert.equal(state.active, ids[0]);
  assert.equal(state.recent.at(-1), ids[0]);
  assert.equal(state.tabs.find(tab => tab.id === ids[0])?.visited, true);
  state = tabsReducer(state, { type: "open", location: { view: "note", id: "c" } });
  assert.equal(state.active, ids[2]);
  assert.equal(state.tabs.length, 3);
  assert.ok(state.layout);
  const restored = restoreTabs(JSON.stringify({ version: 2, locations: ids.map(id => JSON.parse(id)), active: ids[1], layout }), () => true, { view: "home" });
  assert.equal(tabsReducer(restored, { type: "close", id: ids[1] }).active, ids[0], "unvisited siblings are preferred over another pane on close");
});

test("workspace sessions stay isolated by vault and recover from unavailable destinations", async () => {
  localStorage.clear();
  let workspace: ReturnType<typeof useWorkspaceTabs>;
  let switchVault: (id: string) => void;
  function Harness() {
    const [vault, setVault] = useState("a");
    switchVault = setVault;
    workspace = useWorkspaceTabs(vault, true);
    return null;
  }
  const app = await mount(<Harness />);
  try {
    await act(async () => workspace.restore("a", () => true, { view: "home" }));
    await act(async () => workspace.open({ view: "note", id: "page-a" }));
    await act(async () => { switchVault("b"); workspace.restore("b", () => true, { view: "journal" }); });
    assert.deepEqual(workspace!.location, { view: "journal" });
    await act(async () => workspace.open({ view: "template", id: "template-b" }));
    await act(async () => { switchVault("a"); workspace.restore("a", () => true, { view: "home" }); });
    assert.deepEqual(workspace!.location, { view: "note", id: "page-a" });
    assert.equal(workspace!.state.tabs.length, 2);
    await act(async () => { switchVault("b"); workspace.restore("b", location => location.view !== "template", { view: "home" }); });
    assert.deepEqual(workspace!.location, { view: "journal" });
    assert.equal(workspace!.state.tabs.length, 1);
  } finally { await app.unmount(); localStorage.clear(); }
});

test("docking preserves mounted page state, tab order, keyboard moves and close behavior", async () => {
  // Dockview needs layout observers; jsdom has no layout engine. Give the
  // workspace a fixed viewport while exercising the real React adapter/API.
  const globals = ["ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle"] as const;
  const previous = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.assign(globalThis, {
    ResizeObserver: ResizeObserverStub,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  });
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return 1100; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return 800; } });
  let ui: Awaited<ReturnType<typeof mount>> | undefined;
  try {
    const { WorkspaceLayout } = await import("../app/components/WorkspaceLayout");
    const { useReducer } = await import("react");
    const locations: NavigationLocation[] = ["a", "b", "c"].map(id => ({ view: "note", id }));
    const ids = locations.map(locationKey);
    let state = restoreTabs(JSON.stringify({ version: 1, locations, active: ids[1] }), () => true, { view: "home" });
    function Probe() {
      const [current, dispatch] = useReducer(tabsReducer, state);
      state = current;
      return <WorkspaceLayout state={current} dispatch={dispatch} disabled={false}
        canOpenPage={page => page.vaultId === "vault"}
        label={tab => tab.location.view === "note" ? tab.location.id : "Home"}
        icon={() => null}
        render={tab => <input data-page={tab.id} defaultValue="draft" />} />;
    }
    const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    ui = await mount(<StrictMode><Probe /></StrictMode>);
    await settle();
    const tab = (id: string) => Array.from(ui!.host.querySelectorAll<HTMLElement>(".dv-tab")).find(e => e.dataset.tabPanelId === id)!;
    const order = () => Array.from(ui!.host.querySelectorAll(".dv-tab")).map(e => e.getAttribute("aria-label"));
    assert.deepEqual(order(), ["a", "b", "c"], "v1 sessions keep their tab order");
    const b = ui.host.querySelector("input")!;
    assert.equal(b.dataset.page, ids[1], "restored inactive pages mount lazily");
    await act(async () => key(tab(ids[1]), "ArrowLeft"));
    await settle();
    const a = Array.from(ui.host.querySelectorAll("input")).find(e => e.dataset.page === ids[0])!;
    a.value = "unsaved local state";
    await act(async () => {
      tab(ids[0]).dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    const split = Array.from(document.querySelectorAll<HTMLButtonElement>("[role=menuitem]")).find(e => e.textContent === "Split right")!;
    assert.equal(split.disabled, false);
    await act(async () => split.click());
    await settle();
    assert.equal(ui.host.querySelectorAll(".dv-groupview").length, 2);
    assert.ok(a.isConnected && b.isConnected, "docking keeps both mounted editors alive");
    assert.equal(a.value, "unsaved local state");
    assert.equal(layoutPanes(state.layout).length, 2, "layout is synchronized to persistence");
    await act(async () => {
      tab(ids[1]).dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true, cancelable: true }));
    });
    await settle();
    assert.deepEqual(order(), ["c", "b", "a"], "Alt+Right moves a tab one place");
    await act(async () => key(tab(ids[0]), "Delete"));
    await settle();
    assert.equal(ui.host.querySelectorAll(".dv-groupview").length, 1, "closing the last tab collapses its pane");
    assert.equal(state.tabs.some(t => t.id === ids[0]), false, "native close cannot reopen a removed tab");
    assert.equal(a.isConnected, false);
    assert.ok(b.isConnected);

    const source = document.createElement("button");
    document.body.append(source);
    try {
      const data = new Map<string, string>();
      const transfer = {
        effectAllowed: "none",
        getData: (type: string) => data.get(type) ?? "",
        setData: (type: string, value: string) => data.set(type, value),
      } as unknown as DataTransfer;
      const drag = (element: Element, type: string, x = 500) => {
        const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 400 });
        Object.defineProperty(event, "dataTransfer", { value: transfer });
        element.dispatchEvent(event);
      };
      const surface = ui.host.querySelector(".workspace-layout-viewport")!;
      const target = ui.host.querySelector<HTMLElement>(".dv-content-container")!;
      target.getBoundingClientRect = () => new dom.window.DOMRect(0, 0, 1100, 800);
      Object.defineProperty(target, "offsetWidth", { value: 1100 });
      Object.defineProperty(target, "offsetHeight", { value: 800 });
      writePageDrag(transfer, { id: "d", vaultId: "another-vault" });
      await act(async () => drag(source, "dragstart"));
      assert.equal(surface.hasAttribute("data-tab-dragging"), false, "another vault cannot start a workspace drag");
      writePageDrag(transfer, { id: "d", vaultId: "vault" });
      await act(async () => drag(source, "dragstart"));
      assert.equal(surface.hasAttribute("data-tab-dragging"), true, "page drags shield editor content");
      await act(async () => drag(source, "dragend"));
      assert.equal(surface.hasAttribute("data-tab-dragging"), false, "cancellation restores editor interaction");
      const drop = async (x: number) => {
        await act(async () => {
          drag(source, "dragstart");
          drag(target, "dragenter", x);
          drag(target, "dragover", x);
          drag(target, "drop", x);
          drag(source, "dragend");
        });
        await settle();
      };
      await drop(500);
      const dId = locationKey({ view: "note", id: "d" });
      assert.equal(state.active, dId);
      assert.equal(state.tabs.length, 3, "dropping an unopened page creates a tab");
      assert.equal(surface.hasAttribute("data-tab-dragging"), false);
      const d = Array.from(ui.host.querySelectorAll("input")).find(e => e.dataset.page === dId)!;
      d.value = "keep this editor";
      await drop(1095);
      assert.equal(state.tabs.length, 3, "dragging an open page moves its single existing tab");
      assert.equal(ui.host.querySelectorAll(".dv-groupview").length, 2);
      assert.ok(d.isConnected);
      assert.equal(d.value, "keep this editor");
    } finally { source.remove(); }
  } finally {
    await ui?.unmount();
    globals.forEach((name, index) => {
      if (previous[index]) Object.defineProperty(globalThis, name, previous[index]!);
      else Reflect.deleteProperty(globalThis, name);
    });
    if (width) Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
    else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
    if (height) Object.defineProperty(HTMLElement.prototype, "clientHeight", height);
    else Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
  }
});

test("page drag data requires a page and vault identity and ignores ordinary text", () => {
  const values = new Map<string, string>();
  const transfer = {
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => values.set(type, value),
  } as unknown as DataTransfer;
  writePageDrag(transfer, { id: "page", vaultId: "vault" });
  assert.deepEqual(readPageDrag(transfer), { id: "page", vaultId: "vault" });
  values.set(PAGE_DRAG_TYPE, "page");
  assert.equal(readPageDrag(transfer), null);
  values.set(PAGE_DRAG_TYPE, JSON.stringify({ id: "page" }));
  assert.equal(readPageDrag(transfer), null);
  values.delete(PAGE_DRAG_TYPE);
  values.set("text/plain", "page");
  assert.equal(readPageDrag(transfer), null);
});

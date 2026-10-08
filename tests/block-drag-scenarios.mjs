// Runs inside the real renderer, also callable from the browser development preview.
export async function blockDragScenarios() {
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const until = async (predicate, message) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(message);
  };
  const frame = () => new Promise(requestAnimationFrame);
  const widget = document.querySelector("affine-drag-handle-widget");
  await widget.updateComplete;
  const { store, std } = widget;
  check(widget.mode === "page", "The drag engine must run in page mode");
  const parent = store.getModelsByFlavour("affine:note")[0];
  const Text =
    store.getModelsByFlavour("affine:paragraph")[0].props.text.constructor;
  const paragraph = store.addBlock(
    "affine:paragraph",
    { text: new Text("Drag paragraph") },
    parent,
  );
  store.getModelById(paragraph).props.text.format(0, 4, { bold: true });
  const heading = store.addBlock(
    "affine:paragraph",
    { type: "h2", text: new Text("Drag heading") },
    parent,
  );
  const list = store.addBlock(
    "affine:list",
    { type: "bulleted", text: new Text("Drag list") },
    parent,
  );
  const child = store.addBlock(
    "affine:paragraph",
    { text: new Text("Keep nested content") },
    list,
  );
  const table = store.addBlock(
    "affine:table",
    {
      rows: { row: { rowId: "row", order: "a0" } },
      columns: { column: { columnId: "column", order: "a0", width: 260 } },
      cells: { "row:column": { text: new Text("Keep table cell") } },
    },
    parent,
  );
  const meeting = store.addBlock(
    "hyperion:meeting",
    { title: "Drag meeting" },
    parent,
  );
  const ids = [paragraph, heading, list, table, meeting];
  await until(
    () => ids.every((id) => std.view.getBlock(id)),
    "Drag fixtures did not render",
  );
  await frame();
  const beforeProps = store.getModelById(paragraph).props.text.yText.toDelta();
  const order = () =>
    parent.children
      .filter((model) => ids.includes(model.id))
      .map((model) => model.id);
  const sameOrder = (expected) =>
    JSON.stringify(order()) === JSON.stringify(expected);
  store.captureSync();

  const hover = async (id, clearSelection = true) => {
    std.host.focus({ preventScroll: true });
    if (clearSelection) std.selection.clear();
    const element = std.view.getBlock(id);
    element.scrollIntoView({ block: "center" });
    await frame();
    await frame();
    const rect = element.getBoundingClientRect();
    for (let i = 0; i < 2; i++) {
      element.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          composed: true,
          clientX: rect.left + 40,
          clientY: rect.top + 12,
        }),
      );
      await frame();
    }
    check(
      widget.anchorBlockId.value === id,
      "Hover did not reveal the block grip",
    );
    check(
      widget.dragHandleGrabber.getAttribute("aria-label") === "Block actions",
      "Grip needs an accessible label",
    );
    check(
      getComputedStyle(
        widget.dragHandleGrabber,
        "::before",
      ).backgroundImage.match(/radial-gradient/g)?.length === 6,
      "Grip must display six dots",
    );
  };

  const drag = async (
    id,
    targetId,
    before = false,
    { clearSelection = true, withMenu = false } = {},
  ) => {
    await hover(id, clearSelection);
    if (withMenu) {
      widget.dragHandleGrabber.click();
      await frame();
      check(
        document.querySelector(".editor-action-menu"),
        "Drag menu did not open",
      );
      await hover(id, clearSelection);
      check(
        document.querySelector(".editor-action-menu"),
        "Menu closed before the drag regression started",
      );
    }
    const dataTransfer = new DataTransfer();
    const sourceRect = widget.dragHandleGrabber.getBoundingClientRect();
    const options = {
      bubbles: true,
      composed: true,
      cancelable: true,
      dataTransfer,
    };
    let customPreviewSeen = false;
    const previewObserver = new MutationObserver(() => {
      customPreviewSeen ||= Array.from(
        document.querySelectorAll("hyperion-meeting-block"),
      ).some((element) => element !== std.view.getBlock(meeting));
    });
    if (id === meeting)
      previewObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    widget.dispatchEvent(
      new DragEvent("dragstart", {
        ...options,
        clientX: sourceRect.left + 8,
        clientY: sourceRect.top + 6,
      }),
    );
    await frame();
    previewObserver.disconnect();
    check(
      widget.dragging,
      "Dragging did not start (including the drag preview)",
    );
    check(
      !document.querySelector(".editor-action-menu") &&
        widget.dragHandleGrabber.getAttribute("aria-expanded") === "false",
      "Starting a block drag left its actions menu open",
    );
    if (id === meeting) {
      check(
        customPreviewSeen,
        "Custom block did not render in its drag preview",
      );
    }
    const target = std.view.getBlock(targetId);
    target.scrollIntoView({ block: "center" });
    await frame();
    const rect = target.getBoundingClientRect();
    const dropOptions = {
      ...options,
      clientX: rect.left + 40,
      clientY: before ? rect.top + 2 : rect.bottom - 2,
    };
    target.dispatchEvent(new DragEvent("dragover", dropOptions));
    await frame();
    await frame();
    check(
      Array.from(document.querySelectorAll("affine-drop-indicator")).some(
        (indicator) => indicator.rect,
      ),
      "The drop indicator did not appear",
    );
    target.dispatchEvent(new DragEvent("drop", dropOptions));
    widget.dispatchEvent(new DragEvent("dragend", dropOptions));
    await frame();
    await frame();
    check(
      !widget.dragging &&
        !Array.from(document.querySelectorAll("affine-drop-indicator")).some(
          (indicator) => indicator.rect,
        ),
      "Drag state was not cleaned up",
    );
    check(
      !document.querySelector(".editor-action-menu"),
      "The actions menu reopened after moving the block",
    );
  };

  // Disclosure controls are replaced by the native renderer after toggling.
  // Keyboard focus must survive so a collapsed section can be expanded again.
  const headingView = std.view.getBlock(heading);
  const disclosure = () =>
    headingView.querySelector("blocksuite-toggle-button .toggle-icon");
  await until(
    () => disclosure()?.getAttribute("aria-label") === "Collapse section",
    "Heading disclosure is not keyboard accessible",
  );
  disclosure().focus();
  disclosure().dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
  await until(
    () =>
      store.getModelById(heading).props.collapsed &&
      disclosure()?.getAttribute("aria-expanded") === "false" &&
      document.activeElement === disclosure(),
    "Collapsing a heading lost keyboard focus",
  );
  check(
    getComputedStyle(std.view.getBlock(list)).display === "none",
    "Heading disclosure did not hide its section",
  );
  disclosure().dispatchEvent(
    new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
  await until(
    () =>
      !store.getModelById(heading).props.collapsed &&
      disclosure()?.getAttribute("aria-expanded") === "true" &&
      document.activeElement === disclosure(),
    "Expanding a heading lost keyboard focus",
  );
  check(
    getComputedStyle(std.view.getBlock(list)).display !== "none",
    "Heading disclosure did not restore its section",
  );

  await drag(paragraph, heading, false, { withMenu: true });
  await until(
    () => sameOrder([heading, paragraph, list, table, meeting]),
    "Paragraph was not moved after the heading",
  );
  const text = store.getModelById(paragraph).props.text;
  text.insert(" edited", text.length);
  store.undo();
  check(
    text.toString() === "Drag paragraph" &&
      sameOrder([heading, paragraph, list, table, meeting]),
    "Typing after a drag must undo separately from the move",
  );
  store.undo();
  await until(
    () => sameOrder(ids),
    "Undo did not restore the original block order",
  );
  store.redo();
  await until(
    () => sameOrder([heading, paragraph, list, table, meeting]),
    "Redo did not restore the move",
  );

  await hover(paragraph);
  widget.dragHandleGrabber.focus();
  widget.dragHandleGrabber.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowDown",
      altKey: true,
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
  await until(
    () => sameOrder([heading, list, paragraph, table, meeting]),
    "Keyboard reordering failed",
  );
  await frame();
  await frame();
  check(
    widget.shadowRoot.activeElement === widget.dragHandleGrabber,
    "Keyboard reordering lost grip focus",
  );
  store.undo();
  await until(
    () => sameOrder([heading, paragraph, list, table, meeting]),
    "Keyboard move was not a separate undo step",
  );

  std.selection.fromJSON([
    { type: "block", blockId: heading },
    { type: "block", blockId: paragraph },
  ]);
  await drag(heading, table, false, { clearSelection: false });
  await until(
    () => sameOrder([list, table, heading, paragraph, meeting]),
    "Selected blocks were not moved together",
  );
  await drag(list, paragraph);
  await until(
    () => sameOrder([table, heading, paragraph, list, meeting]),
    "Nested list did not move",
  );
  check(store.getParent(child)?.id === list, "Moving the list lost its child");
  await drag(table, list);
  await until(
    () => sameOrder([heading, paragraph, list, table, meeting]),
    "Table did not move",
  );
  check(
    store.getModelById(table).props.cells["row:column"].text.toString() ===
      "Keep table cell",
    "Moving the table changed its content",
  );
  await drag(meeting, heading, true);
  const expected = [meeting, heading, paragraph, list, table];
  await until(() => sameOrder(expected), "Custom meeting block did not move");
  check(
    store.getModelById(meeting).props.title === "Drag meeting",
    "Moving a custom block changed its properties",
  );
  check(
    JSON.stringify(store.getModelById(paragraph).props.text.yText.toDelta()) ===
      JSON.stringify(beforeProps),
    "Dragging lost rich text formatting",
  );

  await hover(paragraph);
  widget.dispatchEvent(
    new DragEvent("dragstart", {
      bubbles: true,
      composed: true,
      cancelable: true,
      dataTransfer: new DataTransfer(),
    }),
  );
  await frame();
  widget.dispatchEvent(
    new DragEvent("dragend", { bubbles: true, composed: true }),
  );
  await frame();
  check(
    sameOrder(expected) && !widget.dragging,
    "Canceled drag changed block order or left drag state behind",
  );

  await hover(paragraph);
  store.readonly = true;
  const content = JSON.stringify(store.doc.yBlocks.toJSON());
  widget.dragHandleGrabber.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowUp",
      altKey: true,
      bubbles: true,
      composed: true,
    }),
  );
  await hoverReadonly();
  check(
    widget.activeDragHandle === null,
    "Read-only editor exposed a drag grip",
  );
  widget.dispatchEvent(
    new DragEvent("dragstart", {
      bubbles: true,
      composed: true,
      cancelable: true,
      dataTransfer: new DataTransfer(),
    }),
  );
  await frame();
  check(
    !widget.dragging && JSON.stringify(store.doc.yBlocks.toJSON()) === content,
    "Read-only editor allowed reordering",
  );
  store.readonly = false;
  std.selection.clear();
  store.captureSync();

  async function hoverReadonly() {
    const element = std.view.getBlock(paragraph);
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        composed: true,
        clientX: rect.left + 40,
        clientY: rect.top + 12,
      }),
    );
    await frame();
  }
  return {
    noteId: store.id,
    parentId: parent.id,
    expected,
    list,
    child,
    paragraph,
  };
}

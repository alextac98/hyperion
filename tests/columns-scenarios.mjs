// Runs in the real renderer, including the collaborative browser preview.
export async function columnsScenarios() {
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
  const widget = document.querySelector("affine-slash-menu-widget");
  const { std } = widget;
  const { store } = std;
  const source = store.getModelsByFlavour("affine:paragraph")[0];
  const Text = source.props.text.constructor;
  const context = { std, model: source };
  const items =
    typeof widget.config.items === "function"
      ? widget.config.items(context)
      : widget.config.items;
  const item = items.find((item) => item.name === "Columns");
  check(item?.when(context), "Columns slash command is unavailable");
  item.action(context);
  const columns = store.getModelsByFlavour("hyperion:columns").at(-1);
  const id = columns.id;
  const columnIds = columns.children.map((child) => child.id);
  const paragraphIds = columns.children.map((child) => child.children[0].id);
  const view = () => std.view.getBlock(id);
  const model = () => store.getModelById(id);
  await until(
    () => view()?.querySelectorAll("rich-text").length === 2,
    "Columns did not render",
  );
  check(columnIds.length === 2, "Insertion must create two columns");
  check(
    columns.children.every((child) => !child.isPageBlock()),
    "Nested columns must not merge into the page title",
  );
  store.undo();
  await until(() => !store.getModelById(id), "Undo did not remove columns");
  check(
    [...columnIds, ...paragraphIds].every(
      (child) => !store.getModelById(child),
    ),
    "Undo left orphaned column blocks",
  );
  store.redo();
  await until(
    () => view()?.querySelectorAll("rich-text").length === 2,
    "Redo did not restore column content",
  );

  // Narrow split panes stack columns based on the block's available width.
  view().style.width = "420px";
  await frame();
  await frame();
  const left = std.view.getBlock(columnIds[0]).getBoundingClientRect();
  const right = std.view.getBlock(columnIds[1]).getBoundingClientRect();
  check(
    Math.abs(left.left - right.left) < 1 && right.top > left.top,
    "Columns did not stack in a narrow pane",
  );
  view().style.removeProperty("width");
  await frame();
  await frame();

  const count = () => model().children.length;
  const add = async () => {
    view().querySelector(".columns-toolbar button").click();
    await frame();
    await frame();
  };
  const remove = async () => {
    view().querySelector(".columns-toolbar button:last-child").click();
    await frame();
    await frame();
  };
  await add();
  check(count() === 3, "Add column failed");
  const third = model().children[2].id;
  store.undo();
  await until(() => count() === 2, "Add-column undo failed");
  store.redo();
  await until(
    () => count() === 3 && std.view.getBlock(third),
    "Add-column redo failed",
  );
  await add();
  check(count() === 4, "Fourth column did not appear");
  check(
    view().querySelector(".columns-toolbar button").disabled,
    "Column limit is not enforced",
  );
  await add();
  check(count() === 4, "Disabled Add column changed the layout");

  const last = model().children[3];
  const heading = last.children[0].id;
  store.updateBlock(heading, { type: "h2", text: new Text("Column heading") });
  store.getModelById(heading).props.text.format(0, 6, { bold: true });
  const list = store.addBlock(
    "affine:list",
    { type: "bulleted", text: new Text("Column list") },
    last,
  );
  const nested = store.addBlock(
    "affine:paragraph",
    { text: new Text("Nested column text") },
    list,
  );
  const table = store.addBlock(
    "affine:table",
    {
      rows: { row: { rowId: "row", order: "a0" } },
      columns: { column: { columnId: "column", order: "a0", width: 160 } },
      cells: { "row:column": { text: new Text("Column cell") } },
    },
    last,
  );
  store.captureSync();
  await remove();
  check(
    count() === 3 && !store.getModelById(last.id),
    "Removal did not delete only the last container",
  );
  check(
    store.getParent(heading).id === third &&
      store.getParent(table).id === third,
    "Removal lost the column's blocks",
  );
  check(store.getParent(nested).id === list, "Removal changed nested content");
  check(
    store.getModelById(heading).props.text.yText.toDelta()[0].attributes.bold,
    "Removal lost rich text",
  );
  store.undo();
  await until(() => count() === 4, "Removal undo did not restore the column");
  check(
    store.getParent(heading).id === last.id,
    "Undo did not restore the original parents",
  );
  store.redo();
  await until(() => count() === 3, "Removal redo failed");
  await remove();
  check(
    count() === 2 &&
      view().querySelector(".columns-toolbar button:last-child").disabled,
    "Minimum column count is not enforced",
  );
  check(
    store.getParent(heading).id === columnIds[1],
    "Repeated removal lost content",
  );
  check(
    store.getModelById(table).props.cells["row:column"].text.toString() ===
      "Column cell",
    "Removal lost table cells",
  );

  // Exercise the native drag engine across columns, preserving the moved subtree.
  const drag = document.querySelector("affine-drag-handle-widget");
  const dragBetween = async (sourceId, targetId) => {
    const target = std.view.getBlock(targetId);
    const sourceView = std.view.getBlock(sourceId);
    std.selection.clear();
    sourceView.scrollIntoView({ block: "center" });
    await frame();
    const rect = sourceView.getBoundingClientRect();
    for (let index = 0; index < 2; index++) {
      sourceView.dispatchEvent(
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
      drag.anchorBlockId.value === sourceId,
      "Column block grip did not appear",
    );
    const options = {
      bubbles: true,
      composed: true,
      cancelable: true,
      dataTransfer: new DataTransfer(),
    };
    const grip = drag.dragHandleGrabber.getBoundingClientRect();
    drag.dispatchEvent(
      new DragEvent("dragstart", {
        ...options,
        clientX: grip.left + 8,
        clientY: grip.top + 6,
      }),
    );
    await frame();
    check(drag.dragging, "Column block drag did not start");
    const destination = target.getBoundingClientRect();
    const drop = {
      ...options,
      clientX: destination.left + 40,
      clientY: destination.bottom - 2,
    };
    target.dispatchEvent(new DragEvent("dragover", drop));
    await frame();
    await frame();
    target.dispatchEvent(new DragEvent("drop", drop));
    drag.dispatchEvent(new DragEvent("dragend", drop));
    await frame();
    await frame();
  };
  await dragBetween(heading, paragraphIds[0]);

  await until(
    () => store.getParent(heading)?.id === columnIds[0],
    "Drag did not move the block between columns",
  );
  store.undo();
  await until(
    () => store.getParent(heading)?.id === columnIds[1],
    "Cross-column drag undo failed",
  );
  store.redo();
  await until(
    () => store.getParent(heading)?.id === columnIds[0],
    "Cross-column drag redo failed",
  );

  const emptyNote = store.getModelById(columnIds[0]);
  const otherNote = store.getModelById(columnIds[1]);
  store.captureSync();
  store.moveBlocks([...emptyNote.children], otherNote);
  store.captureSync();
  await frame();
  check(emptyNote.children.length === 0, "Empty-column fixture did not move");
  std.view
    .getBlock(emptyNote.id)
    .querySelector(".affine-block-children-container")
    .click();
  await until(
    () => emptyNote.children.length === 1,
    "Clicking an empty column did not make it editable",
  );
  await view().updateComplete;
  await frame();
  await frame();
  store.undo();
  await until(
    () => emptyNote.children.length === 0,
    "Empty-column initialization was not undoable",
  );
  await view().updateComplete;
  await frame();
  await frame();
  store.undo();
  await until(
    () => store.getParent(heading)?.id === columnIds[0],
    "Undo did not restore the emptied column",
  );
  await view().updateComplete;
  await frame();
  await frame();

  // The layout itself moves as one block, including both note containers.
  const parent = store.getParent(id);
  const after = store.addBlock(
    "affine:paragraph",
    { text: new Text("After columns") },
    parent,
  );
  store.captureSync();
  await until(
    () => std.view.getBlock(after),
    "Layout drag destination did not render",
  );
  await dragBetween(id, after);
  await until(
    () => parent.children.at(-1)?.id === id,
    "The columns block did not move as a whole",
  );
  await view().updateComplete;
  await frame();
  await frame();
  check(
    model()
      .children.map((child) => child.id)
      .join() === columnIds.join(),
    "Moving the layout changed its columns",
  );
  check(
    store.getParent(nested)?.id === list &&
      store.getParent(table)?.id === columnIds[1],
    "Moving the layout lost nested content",
  );
  store.undo();
  await until(
    () => parent.children.at(-1)?.id === after,
    "Layout drag undo failed",
  );
  await view().updateComplete;
  await frame();
  await frame();
  store.redo();
  await until(
    () => parent.children.at(-1)?.id === id,
    "Layout drag redo failed",
  );
  await view().updateComplete;
  await frame();
  await frame();

  return {
    id,
    noteId: store.id,
    columnIds,
    paragraphIds,
    heading,
    list,
    nested,
    table,
  };
}

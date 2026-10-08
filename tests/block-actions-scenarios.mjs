// Exercise the shared menu through the native grip in a real editor scope.
export async function blockActionsScenarios({ table, custom }) {
  const check = (value, message) => {
    if (!value) throw new Error(message);
  };
  const frame = () => new Promise(requestAnimationFrame);
  const widget = document.querySelector("affine-drag-handle-widget");
  const { std, store } = widget;
  // The preceding scenarios return this scope from read-only mode. Let its
  // native view effects settle before inserting more rich block fixtures.
  await std.host.updateComplete;
  await frame();
  await frame();
  const parent = store
    .getModelsByFlavour("affine:note")
    .find((note) => note.isPageBlock());
  const Text =
    store.getModelsByFlavour("affine:paragraph")[0].props.text.constructor;
  const paragraph = store.addBlock(
    "affine:paragraph",
    { text: new Text("Menu paragraph") },
    parent,
  );
  const list = store.addBlock(
    "affine:list",
    { type: "bulleted", text: new Text("Menu list") },
    parent,
  );
  const nested = store.addBlock(
    "affine:paragraph",
    { text: new Text("Nested menu content") },
    list,
  );
  store.getModelById(nested).props.text.format(0, 6, { bold: true });
  // Reuse the fully rendered rich fixtures from the drag scenarios so these
  // checks exercise actions without running a second block initialization flow.
  const tableText = store
    .getModelById(table)
    .props.cells["row:column"].text.toString();
  const customTitle = store.getModelById(custom).props.title;
  await std.host.updateComplete;
  await frame();
  store.captureSync();
  const open = async (id, keyboard = false) => {
    std.selection.clear();
    widget.anchorBlockId.value = id;
    widget.pointerEventWatcher.showDragHandleOnHoverBlock();
    const grip = widget.dragHandleGrabber;
    grip.focus();
    if (keyboard)
      grip.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      );
    else grip.click();
    await frame();
    check(
      document.querySelector('.editor-action-menu[role="menu"]'),
      "Grip did not open the shared menu",
    );
    check(
      document.activeElement?.getAttribute("role") === "menuitem",
      "Menu did not receive keyboard focus",
    );
  };
  const action = (label) =>
    [...document.querySelectorAll(".editor-action-menu button")].find(
      (button) => button.textContent === label,
    );
  await open(paragraph, true);
  const menu = document.querySelector(".editor-action-menu");
  menu.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "End",
      bubbles: true,
      cancelable: true,
    }),
  );
  check(
    document.activeElement === action("Delete block"),
    "End did not focus the last action",
  );
  menu.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  check(
    !menu.isConnected &&
      widget.shadowRoot.activeElement === widget.dragHandleGrabber,
    "Escape did not close the menu and restore grip focus",
  );
  await open(paragraph);
  action("Move down").click();
  await frame();
  check(
    !document.querySelector(".editor-action-menu"),
    "Menu stayed open after Move down",
  );
  check(
    parent.children.indexOf(store.getModelById(paragraph)) >
      parent.children.indexOf(store.getModelById(list)),
    "Menu move did not reorder",
  );
  store.undo();
  await frame();
  check(
    parent.children.indexOf(store.getModelById(paragraph)) <
      parent.children.indexOf(store.getModelById(list)),
    "Menu move undo failed",
  );

  for (const id of [paragraph, list, table, custom]) {
    await open(id);
    action("Delete block").click();
    await frame();
    check(!store.getModelById(id), `Shared menu did not delete ${id}`);
    if (id === list)
      check(!store.getModelById(nested), "List deletion left an orphan");
    check(
      !document.querySelector(".editor-action-menu"),
      "Action left a menu open",
    );
    check(
      std.host.contains(document.activeElement),
      "Deletion did not return focus to the editor",
    );
    store.undo();
    await frame();
    check(store.getModelById(id), "Delete undo did not restore the block");
    if (id === list)
      check(
        store.getParent(nested).id === list &&
          store.getModelById(nested).props.text.yText.toDelta()[0].attributes
            .bold,
        "Delete undo lost nested formatting",
      );
    if (id === table)
      check(
        store.getModelById(table).props.cells["row:column"].text.toString() ===
          tableText,
        "Delete undo lost table content",
      );
    if (id === custom)
      check(
        store.getModelById(custom).props.title === customTitle,
        "Delete undo lost custom properties",
      );
    store.redo();
    await frame();
    check(!store.getModelById(id), "Delete redo failed");
    store.undo();
    await frame();
  }

  // Deleting a column's only text block must leave a usable empty editor.
  const layout = store.addBlock("hyperion:columns", {}, parent);
  const column = store.addBlock("affine:note", { displayMode: "doc" }, layout);
  const only = store.addBlock(
    "affine:paragraph",
    { text: new Text("Only child") },
    column,
  );
  const other = store.addBlock("affine:note", { displayMode: "doc" }, layout);
  store.addBlock("affine:paragraph", { text: new Text() }, other);
  await std.host.updateComplete;
  await frame();
  store.captureSync();
  await open(only);
  check(
    action("Move up").disabled && action("Move down").disabled,
    "Boundary moves should be disabled",
  );
  action("Delete block").click();
  await frame();
  const children = store.getModelById(column).children;
  check(
    !store.getModelById(only) &&
      children.length === 1 &&
      children[0].props.text.length === 0,
    "Deleting the last block did not leave an editable paragraph",
  );
  store.undo();
  await frame();
  check(
    store.getModelById(column).children.length === 1 &&
      store.getModelById(column).children[0].id === only,
    "Last-block undo left a placeholder",
  );
  store.deleteBlock(layout);
  for (const id of [paragraph, list]) store.deleteBlock(id);
  std.selection.clear();
  store.captureSync();
  return true;
}

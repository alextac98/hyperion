import * as Y from "yjs";

/** Permanently removed from the current document format, not missing plugins. */
export const retiredBlockFlavoursV2: ReadonlySet<string> = new Set([
  "affine:embed-youtube",
  "affine:embed-github",
  "affine:embed-figma",
  "affine:embed-loom",
  "affine:frame",
]);

export const retiredBlockFlavours: ReadonlySet<string> = new Set([
  ...retiredBlockFlavoursV2,
  "hyperion:rating",
]);

const field = (value: unknown, key: string): unknown =>
  value instanceof Y.Map
    ? value.get(key)
    : value && typeof value === "object"
      ? (value as Record<string, unknown>)[key]
      : undefined;
const keys = (value: unknown): string[] =>
  value instanceof Y.Map
    ? [...value.keys()]
    : value && typeof value === "object"
      ? Object.keys(value)
      : [];

/** Idempotent retirement migration. Unknown plugin payloads are deliberately untouched. */
export function removeRetiredBlocks<T extends Y.Map<unknown>>(
  blocks: Y.Map<T>,
  flavours: ReadonlySet<string> = retiredBlockFlavours,
): boolean {
  let changed = false;
  const apply = () => {
    const removed = new Set<string>();
    const surfaces: Y.Map<unknown>[] = [];
    for (const [id, block] of blocks) {
      const flavour = block.get("sys:flavour");
      if (flavours.has(String(flavour))) removed.add(id);
      if (flavour === "affine:database" || flavour === "affine:data-view") {
        const views = block.get("prop:views");
        const list =
          views instanceof Y.Array
            ? views.toArray()
            : Array.isArray(views)
              ? views
              : [];
        const retired = list
          .map((view, index) => (field(view, "mode") === "kanban" ? index : -1))
          .filter((index) => index >= 0);
        if (retired.length) {
          changed = true;
          // A table sharing these rows survives; a Kanban-only database is deleted.
          if (retired.length === list.length) removed.add(id);
          else if (views instanceof Y.Array)
            for (const index of retired.reverse()) views.delete(index, 1);
          else
            block.set(
              "prop:views",
              list.filter((view) => field(view, "mode") !== "kanban"),
            );
        }
      }
      if (flavour === "affine:surface") {
        const boxed = block.get("prop:elements");
        const elements = field(boxed, "value") ?? boxed;
        if (!(elements instanceof Y.Map)) continue;
        surfaces.push(elements);
        for (const [elementId, element] of elements)
          if (field(element, "type") === "mindmap") {
            removed.add(elementId);
            keys(field(element, "children")).forEach((child) =>
              removed.add(child),
            );
          }
      }
    }
    // Remove owned block descendants and surface references, including references
    // to already-missing frames/mind maps. Frames' spatial contents are not owned blocks.
    let count = -1;
    while (count !== removed.size) {
      count = removed.size;
      for (const [id, block] of blocks) {
        if (
          block.get("sys:flavour") === "affine:surface-ref" &&
          (removed.has(String(block.get("prop:reference"))) ||
            ["affine:frame", "mindmap"].includes(
              String(block.get("prop:refFlavour")),
            ))
        )
          removed.add(id);
        if (removed.has(id)) {
          const children = block.get("sys:children");
          if (children instanceof Y.Array)
            children.toArray().forEach((child) => removed.add(String(child)));
        }
      }
      for (const elements of surfaces)
        for (const [id, element] of elements) {
          if (
            field(element, "type") === "connector" &&
            ["source", "target"].some((end) =>
              removed.has(String(field(field(element, end), "id"))),
            )
          )
            removed.add(id);
        }
    }
    for (const elements of surfaces)
      for (const [id, element] of elements) {
        if (removed.has(id)) {
          elements.delete(id);
          changed = true;
        } else if (field(element, "type") === "group") {
          const children = field(element, "children");
          if (children instanceof Y.Map)
            for (const child of children.keys())
              if (removed.has(child)) {
                children.delete(child);
                changed = true;
              }
        }
      }
    for (const [id, block] of blocks) {
      if (removed.has(id)) {
        blocks.delete(id);
        changed = true;
        continue;
      }
      const children = block.get("sys:children");
      if (children instanceof Y.Array)
        for (let index = children.length - 1; index >= 0; index--) {
          if (removed.has(String(children.get(index)))) {
            children.delete(index, 1);
            changed = true;
          }
        }
    }
  };
  if (blocks.doc) blocks.doc.transact(apply, "hyperion:retire-blocks");
  else apply();
  return changed;
}

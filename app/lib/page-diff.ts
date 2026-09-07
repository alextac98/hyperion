import * as Y from "yjs";
import type { PageSnapshot } from "../platform/desktop-api";

export type PageChange = { key: string; label: string; before: string; after: string; detail?: string };
function stable(value: unknown): unknown {
  if (value instanceof Y.Text) return { text: value.toDelta().map(stable) };
  if (value instanceof Y.Map) return stable(Object.fromEntries(value.entries()));
  if (value instanceof Y.Array) return value.toArray().map(stable);
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
const serialize = (value: unknown) => JSON.stringify(stable(value));
function blocks(snapshot: PageSnapshot) {
  const result = new Map<string, { text: string; label: string; properties: string; children: string }>();
  if (!snapshot.document) return result;
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, Uint8Array.from(atob(snapshot.document), char => char.charCodeAt(0)));
    const source = doc.getMap<Y.Map<unknown>>("blocks");
    const visited = new Set<string>();
    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const block = source.get(id); if (!block) return;
      const flavour = String(block.get("sys:flavour") ?? "block");
      const children = block.get("sys:children");
      const properties = Object.fromEntries([...block.entries()].filter(([key]) => key !== "sys:id" && key !== "sys:children"));
      result.set(id, {
        label: flavour.replace("affine:", ""),
        text: String(block.get("prop:title") ?? block.get("prop:text") ?? block.get("prop:caption") ?? block.get("prop:name") ?? ""),
        properties: serialize(properties), children: serialize(children ?? []),
      });
      if (children instanceof Y.Array) children.toArray().forEach(child => visit(String(child)));
    };
    for (const [id, block] of source) if (block.get("sys:flavour") === "affine:page") visit(id);
    for (const id of source.keys()) visit(id);
    return result;
  } finally { doc.destroy(); }
}

/** Compare visible Yjs values, never encoded update bytes or client clocks. */
export function pageChanges(before: PageSnapshot, after: PageSnapshot): PageChange[] {
  const changes: PageChange[] = [];
  const oldBlocks = blocks(before); const newBlocks = blocks(after);
  const hasRichTitles = [...oldBlocks.values()].some(block => block.label === "page") && [...newBlocks.values()].some(block => block.label === "page");
  const fields = ["title", "tags", "icon", "parentId", "collectionIds", "links", "favorite", "archived", "trashed", "kind", "journalDate", "sortOrder", "aliases"] as const;
  const labels: Partial<Record<typeof fields[number], string>> = { parentId: "Parent page", collectionIds: "Collections", journalDate: "Journal date", sortOrder: "Page order", aliases: "Former names" };
  const display = (value: unknown) => value == null ? "None" : typeof value === "string" ? value : typeof value === "boolean" ? value ? "Yes" : "No" : Array.isArray(value) && value.every(item => typeof item === "string") ? value.join(", ") || "None" : JSON.stringify(value);
  for (const field of fields) if (!(field === "title" && hasRichTitles) && serialize(before.note[field]) !== serialize(after.note[field])) changes.push({ key: field, label: labels[field] ?? field[0].toUpperCase() + field.slice(1), before: display(before.note[field]), after: display(after.note[field]) });
  if (!before.document || !after.document) {
    if (before.note.body !== after.note.body) changes.push({ key: "body", label: "Page text", before: before.note.body, after: after.note.body });
    if (Boolean(before.document) !== Boolean(after.document)) changes.push({ key: "format", label: "Rich page content", before: before.document ? "Rich document" : "Text document", after: after.document ? "Rich document" : "Text document", detail: "Open the page previews to compare formatting and layout." });
    return changes;
  }
  for (const id of new Set([...oldBlocks.keys(), ...newBlocks.keys()])) {
    const oldBlock = oldBlocks.get(id); const newBlock = newBlocks.get(id);
    if (oldBlock?.properties === newBlock?.properties && oldBlock?.children === newBlock?.children) continue;
    const detail = !oldBlock ? "Block added" : !newBlock ? "Block removed" : oldBlock.children !== newBlock.children ? "Block order or layout changed" : oldBlock.text === newBlock.text ? "Formatting or block properties changed. Open the page previews to inspect." : undefined;
    changes.push({ key: `block:${id}`, label: (newBlock ?? oldBlock)!.label === "page" ? "Page title and layout" : (newBlock ?? oldBlock)!.label, before: oldBlock?.text ?? "", after: newBlock?.text ?? "", detail });
  }
  return changes;
}

import { createHash } from "node:crypto";
import * as Y from "yjs";

export type RecordValue = Record<string, unknown>;
export const DOCUMENT_VERSION = 1;
export const BUNDLE_VERSION = 9;
export const hash = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
export function object(value: unknown, name = "record"): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${name}`);
  return value as RecordValue;
}
export function string(value: unknown, name = "value"): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}
export function id(value: unknown): string {
  const result = string(value, "ID");
  if (!result.trim() || result.length > 512) throw new Error("Invalid ID");
  return result;
}
export function array(value: unknown, name = "records"): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${name}`);
  return value;
}
export function bytes(value: unknown): Buffer {
  const encoded = string(value, "base64 data");
  const result = Buffer.from(encoded, "base64");
  if (result.toString("base64") !== encoded) throw new Error("Invalid base64 data");
  return result;
}
export function documentBytes(value: unknown): Buffer {
  const data = bytes(value);
  const doc = new Y.Doc();
  try { Y.applyUpdate(doc, data); } finally { doc.destroy(); }
  return data;
}
export function record(value: unknown, kind: "vault" | "note" | "template" | "collection" | "preferences", legacy = false): RecordValue {
  const input = object(value);
  const r = { ...input };
  if (kind === "preferences") {
    id(r.vaultId);
    if (legacy) Object.assign(r, { theme: "system", editorFontSize: 17, editorWidth: "comfortable", spellcheck: true, showDetails: true, notesView: "table", defaultTemplateIds: { note: null, journal: null }, ...input });
    for (const [key, options] of Object.entries({ theme: ["system", "light", "dark"], editorWidth: ["compact", "comfortable", "wide"], notesView: ["list", "table"] })) {
      if (!options.includes(String(r[key]))) throw new Error(`Invalid ${key}`);
    }
    if (typeof r.editorFontSize !== "number" || r.editorFontSize < 10 || r.editorFontSize > 72) throw new Error("Invalid font size");
    for (const key of ["spellcheck", "showDetails"]) if (typeof r[key] !== "boolean") throw new Error(`Invalid ${key}`);
    const defaults = object(r.defaultTemplateIds);
    for (const key of ["note", "journal"]) if (defaults[key] !== null) id(defaults[key]);
    return r;
  }
  id(r.id);
  if (kind !== "vault") id(r.vaultId);
  if (legacy) {
    r.createdAt ??= r.updatedAt;
    r.updatedAt ??= r.createdAt;
    if (kind === "note") {
      Object.assign(r, { kind: "note", journalDate: null, icon: null, aliases: [], body: "", tags: [], links: [], parentId: null, sortOrder: 0, collectionIds: [], favorite: false, archived: false, trashed: false, ...r });
      if (!input.kind && (r.tags as string[]).includes("journal")) { r.kind = "journal"; r.tags = (r.tags as string[]).filter(t => t !== "journal"); }
      if (r.kind === "journal" && !r.journalDate) r.journalDate = String(r.createdAt).slice(0, 10);
    }
    if (kind === "template") Object.assign(r, { target: "page", name: "Untitled template", description: "", defaultTitle: "Untitled", icon: null, tags: [], body: "", ...r });
    if (kind === "vault" || kind === "collection") { r.color ??= "#6f63d9"; if (kind === "vault") r.description ??= ""; }
    if (typeof r.icon === "string") r.icon = { type: "emoji", unicode: r.icon };
  }
  for (const key of ["createdAt", "updatedAt"]) if (!Number.isFinite(Date.parse(string(r[key], key)))) throw new Error(`Invalid ${key}`);
  string(r[kind === "note" ? "title" : "name"], "name");
  if (kind === "vault" || kind === "collection") string(r.color);
  if (kind === "vault" || kind === "template") string(r.description);
  if (kind === "note" || kind === "template") {
    string(r.body);
    for (const tag of array(r.tags, "tags")) string(tag);
    if (r.icon !== null) {
      const icon = object(r.icon, "icon");
      if (icon.type === "emoji") string(icon.unicode);
      else if (icon.type === "affine-icon") { string(icon.name); string(icon.color); }
      else throw new Error("Invalid icon");
    }
  }
  if (kind === "template") { if (r.target !== "page") throw new Error("Invalid template target"); string(r.defaultTitle); }
  if (kind === "note") {
    if (!["note", "journal"].includes(String(r.kind))) throw new Error("Invalid page kind");
    if (r.journalDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(string(r.journalDate))) throw new Error("Invalid journal date");
    if (r.parentId !== null) id(r.parentId);
    if (typeof r.sortOrder !== "number" || !Number.isFinite(r.sortOrder)) throw new Error("Invalid page order");
    for (const key of ["favorite", "archived", "trashed"]) if (typeof r[key] !== "boolean") throw new Error(`Invalid ${key}`);
    for (const alias of array(r.aliases)) string(alias);
    for (const collection of array(r.collectionIds)) id(collection);
    for (const link of array(r.links)) {
      const item = object(link); id(item.targetId); string(item.label);
      if (!["inline", "manual"].includes(String(item.kind))) throw new Error("Invalid page link");
    }
  }
  return r;
}

// Clone shared types into fresh CRDT operations, preserving formatting and block IDs.
export function cloneValue(value: unknown, ids = new Map<string, string>()): unknown {
  if (value instanceof Y.Text) {
    const result = new Y.Text();
    result.applyDelta(value.toDelta().map((delta: { insert?: unknown; attributes?: Record<string, unknown> }) => ({ ...delta, insert: typeof delta.insert === "string" ? delta.insert : cloneValue(delta.insert, ids), attributes: delta.attributes ? cloneValue(delta.attributes, ids) : undefined })));
    return result;
  }
  if (value instanceof Y.Map) return new Y.Map([...value.entries()].map(([key, item]) => [ids.get(key) ?? key, cloneValue(item, ids)]));
  if (value instanceof Y.Array) { const result = new Y.Array<unknown>(); result.insert(0, value.toArray().map(item => cloneValue(item, ids))); return result; }
  if (value instanceof Y.AbstractType || value instanceof Y.Doc) throw new Error("Unsupported shared document type; original data has been preserved");
  if (typeof value === "string") return ids.get(value) ?? value;
  if (value instanceof Uint8Array) return value.slice();
  if (Array.isArray(value)) return value.map(item => cloneValue(item, ids));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item, ids)]));
  return value;
}
export function remapDocument(encoded: string, ids: Map<string, string>): string {
  const source = new Y.Doc(); const target = new Y.Doc();
  try {
    Y.applyUpdate(source, documentBytes(encoded));
    if ([...source.share.keys()].some(key => key !== "blocks")) throw new Error("Unsupported document fields; original data has been preserved");
    // BlockSuite's page content is a map named blocks. Root workspace state is rebuilt locally.
    for (const [key, value] of source.getMap("blocks")) target.getMap("blocks").set(key, cloneValue(value, ids));
    return Buffer.from(Y.encodeStateAsUpdate(target)).toString("base64");
  } finally { source.destroy(); target.destroy(); }
}
export function restoreDocument(current: Uint8Array, historical: Uint8Array, title?: string): Uint8Array {
  const target = new Y.Doc(); const source = new Y.Doc();
  try {
    Y.applyUpdate(target, current); Y.applyUpdate(source, historical);
    if ([...source.share.keys(), ...target.share.keys()].some(key => key !== "blocks")) throw new Error("Unsupported document fields; original data has been preserved");
    target.transact(() => {
      const blocks = target.getMap("blocks"); blocks.clear();
      for (const [key, value] of source.getMap("blocks")) blocks.set(key, cloneValue(value));
      if (title !== undefined) for (const value of blocks.values()) {
        if (value instanceof Y.Map && value.get("sys:flavour") === "affine:page") value.set("prop:title", new Y.Text(title));
      }
    });
    return Y.encodeStateAsUpdate(target);
  } finally { target.destroy(); source.destroy(); }
}

export function assetReferences(encoded: Uint8Array): string[] {
  const doc = new Y.Doc(); const keys = new Set<string>();
  const visit = (value: unknown) => {
    if (value instanceof Y.Map) for (const [key, item] of value) {
      if ((key === "prop:sourceId" || key === "sourceId") && typeof item === "string" && item) keys.add(item);
      visit(item);
    }
    else if (value instanceof Y.Array) value.toArray().forEach(visit);
    else if (value && typeof value === "object" && !(value instanceof Y.AbstractType)) for (const [key, item] of Object.entries(value)) {
      if (key === "sourceId" && typeof item === "string" && item) keys.add(item);
      visit(item);
    }
  };
  try { Y.applyUpdate(doc, encoded); visit(doc.getMap("blocks")); return [...keys]; }
  finally { doc.destroy(); }
}

export function documentMetadata(encoded: Uint8Array): { title: string; body: string } | null {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, encoded);
    const blocks = doc.getMap<Y.Map<unknown>>("blocks");
    const root = [...blocks.values()].find(block => block instanceof Y.Map && block.get("sys:flavour") === "affine:page");
    if (!root) return null;
    const text = root.get("prop:title"); const lines: string[] = []; const visited = new Set<unknown>();
    const visit = (block: Y.Map<unknown>) => {
      if (visited.has(block)) return; visited.add(block);
      const flavour = String(block.get("sys:flavour")); const value = block.get("prop:text");
      if (!["affine:page", "affine:note", "affine:surface"].includes(flavour) && value instanceof Y.Text && value.toString().trim()) lines.push(value.toString().trim());
      const children = block.get("sys:children");
      if (children instanceof Y.Array) for (const key of children.toArray()) { const child = blocks.get(String(key)); if (child instanceof Y.Map) visit(child); }
    };
    visit(root);
    return { title: text instanceof Y.Text ? text.toString() || "Untitled" : "Untitled", body: lines.join("\n") };
  } finally { doc.destroy(); }
}

/** Hash page values, excluding Yjs clocks/tombstones and unrelated vault assets. */
export function revisionContentHash(note: RecordValue, encoded: string | null): string {
  const canonical = (value: unknown): unknown => {
    if (value instanceof Y.Text) return { type: "text", value: canonical(value.toDelta()) };
    if (value instanceof Y.Map) return { type: "map", value: canonical(Object.fromEntries(value.entries())) };
    if (value instanceof Y.Array) return { type: "array", value: canonical(value.toArray()) };
    if (value instanceof Y.AbstractType) throw new Error("Unknown shared type");
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return value;
  };
  let document: unknown = null;
  if (encoded) {
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, documentBytes(encoded));
      // Unknown document structures must never be accidentally deduplicated away.
      if ([...doc.share.keys()].some(key => key !== "blocks")) document = encoded;
      else {
        try { document = canonical(doc.getMap("blocks")); }
        catch { document = encoded; }
      }
    } finally { doc.destroy(); }
  }
  // Asset keys are immutable, and references are part of the document values.
  return hash(JSON.stringify(canonical({ note: { ...note, updatedAt: undefined }, document })));
}

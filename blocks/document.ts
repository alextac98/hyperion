import * as Y from "yjs";
import type {
  BlockData,
  BlockReferences,
  BlockDefinition,
} from "./contract.js";
import { blockRegistry, blockText, projectBlock } from "./registry.js";

export function readBlock(id: string, value: Y.Map<unknown>): BlockData {
  const children = value.get("sys:children");
  return {
    id,
    flavour: String(value.get("sys:flavour") ?? ""),
    version: Number(value.get("sys:version") ?? 1),
    props: Object.fromEntries(
      [...value]
        .filter(([key]) => key.startsWith("prop:"))
        .map(([key, item]) => [key.slice(5), item]),
    ),
    children: children instanceof Y.Array ? children.toArray().map(String) : [],
  };
}

export function readDocumentMetadata<T extends Y.Map<unknown>>(
  blocks: Y.Map<T>,
) {
  const root = [...blocks].find(
    ([, block]) => block.get("sys:flavour") === "affine:page",
  );
  if (!root) return null;
  const lines: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const value = blocks.get(id);
    if (!value) return;
    const block = readBlock(id, value);
    const text = projectBlock(block).text.trim();
    if (text) lines.push(text);
    block.children.forEach(visit);
  };
  visit(root[0]);
  return {
    title: blockText(root[1].get("prop:title")) || "Untitled",
    body: lines.join("\n"),
  };
}

export function readReferences(value: unknown): BlockReferences {
  const plain = value instanceof Y.Map ? value.toJSON() : value;
  if (!plain || typeof plain !== "object") return {};
  const result: BlockReferences = {};
  for (const kind of ["pages", "assets"] as const) {
    const slots = (plain as Record<string, unknown>)[kind];
    if (slots && typeof slots === "object" && !Array.isArray(slots)) {
      result[kind] = Object.fromEntries(
        Object.entries(slots).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    }
  }
  return result;
}

/** Validate all migrations on detached copies before applying any writes. */
export function migrateBlocks<T extends Y.Map<unknown>>(
  blocks: Y.Map<T>,
  registry: ReadonlyMap<string, BlockDefinition> = blockRegistry,
) {
  const changes: Array<{
    value: Y.Map<unknown>;
    props: Record<string, unknown>;
    version: number;
  }> = [];
  for (const [id, value] of blocks) {
    const block = readBlock(id, value);
    const definition = registry.get(block.flavour);
    if (!definition || block.version >= definition.version) continue;
    // Bundled custom blocks use JSON properties. Rich text migrations need an explicit adapter.
    const props = cloneMigrationValue(block.props) as Record<string, unknown>;
    let next = props;
    let version = block.version;
    while (version < definition.version) {
      const migration = definition.migrations?.[version];
      if (!migration)
        throw new Error(
          `Missing migration for ${block.flavour} version ${version}`,
        );
      next = migration(next);
      version++;
    }
    if (!definition.validate(next))
      throw new Error(`Invalid migrated ${block.flavour} block`);
    changes.push({
      value,
      props: cloneMigrationValue(next) as Record<string, unknown>,
      version,
    });
  }
  if (!changes.length) return;
  const apply = () => {
    for (const { value, props, version } of changes) {
      for (const key of [...value.keys()])
        if (key.startsWith("prop:") && !(key.slice(5) in props))
          value.delete(key);
      for (const [key, item] of Object.entries(props))
        value.set(`prop:${key}`, item);
      value.set("sys:version", version);
    }
  };
  if (blocks.doc) blocks.doc.transact(apply, "hyperion:block-migration");
  else apply();
}

/** Reject unsupported migration values rather than silently stripping rich content. */
function cloneMigrationValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(cloneMigrationValue);
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        cloneMigrationValue(item),
      ]),
    );
  }
  throw new Error(
    "Unsupported block migration value; original content has been preserved",
  );
}

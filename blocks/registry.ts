import type {
  BlockData,
  BlockDefinition,
  BlockProjection,
} from "./contract.js";
import { ratingDefinition } from "./rating/definition.js";

export function createBlockRegistry(definitions: readonly BlockDefinition[]) {
  const registry = new Map<string, BlockDefinition>();
  for (const definition of definitions) {
    if (!/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(definition.flavour))
      throw new Error(`Invalid block ID: ${definition.flavour}`);
    if (definition.flavour.startsWith("affine:"))
      throw new Error("The affine namespace is reserved for upstream blocks");
    if (registry.has(definition.flavour))
      throw new Error(`Duplicate block ID: ${definition.flavour}`);
    if (!Number.isInteger(definition.version) || definition.version < 1)
      throw new Error(`Invalid block version: ${definition.flavour}`);
    if (!definition.validate(definition.defaults()))
      throw new Error(`Invalid block defaults: ${definition.flavour}`);
    registry.set(definition.flavour, definition);
  }
  return registry as ReadonlyMap<string, BlockDefinition>;
}

/** Add bundled data definitions here; views are loaded separately by the editor. */
export const blockRegistry = createBlockRegistry([ratingDefinition]);

export function blockText(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    "toString" in value &&
    value.toString !== Object.prototype.toString
  )
    return String(value);
  return "";
}

export function isBlockAvailable(block: BlockData, registry = blockRegistry) {
  const definition = registry.get(block.flavour);
  return Boolean(
    definition &&
      block.version === definition.version &&
      definition.validate(block.props),
  );
}

export function projectBlock(
  block: BlockData,
  registry = blockRegistry,
): BlockProjection {
  const definition = registry.get(block.flavour);
  if (definition && isBlockAvailable(block, registry))
    return definition.project(block);
  if (["affine:page", "affine:surface", "affine:note"].includes(block.flavour))
    return { text: "" };
  const text = blockText(
    block.props.text ??
      block.props.caption ??
      block.props.title ??
      block.props.name,
  ).trim();
  const heading =
    block.flavour === "affine:paragraph" &&
    /^h([1-6])$/.exec(String(block.props.type));
  return {
    text,
    ...(heading && text
      ? { outline: { title: text, level: Number(heading[1]) } }
      : {}),
  };
}

export function describeBlock(block: BlockData) {
  return {
    label:
      blockRegistry.get(block.flavour)?.label ??
      block.flavour.replace(/^affine:/, ""),
    text:
      block.flavour === "affine:page"
        ? blockText(block.props.title)
        : projectBlock(block).text,
  };
}

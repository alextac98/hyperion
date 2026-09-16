import { inlineDateAdapters } from "../inline-date-adapters";
import { migrateInlineDates } from "../../../blocks/date/inline";
import {
  BlockSchemaExtension,
  defineBlockSchema,
  type Doc,
} from "@blocksuite/affine/store";
import { AffineSchemas } from "@blocksuite/affine/schemas";
import { blockRegistry } from "../../../blocks/registry";
import {
  removeRetiredBlocks,
  retiredBlockFlavours,
} from "../../../blocks/retired";
import { migrateBlocks } from "../../../blocks/document";

export function blockStoreExtensions() {
  return [
    ...inlineDateAdapters,
    ...[...blockRegistry.values()].map((definition) =>
      BlockSchemaExtension(
        defineBlockSchema({
          flavour: definition.flavour,
          metadata: {
            role: "content",
            version: definition.version,
            parent: definition.parents ?? [
              "@content",
              "affine:note",
              "affine:callout",
            ],
            children: definition.children ?? [],
          },
          props: definition.defaults,
        }),
      ),
    ),
  ];
}

const knownFlavours = new Set([
  ...(AffineSchemas as Array<{ model: { flavour: string } }>).map(
    (schema) => schema.model.flavour,
  ),
  ...blockRegistry.keys(),
]);
const preparedStores = new WeakSet<object>();

function unavailableSchema(flavour: string, version: number) {
  return defineBlockSchema({ flavour, metadata: { role: "content", version } });
}

/** Supply opaque schemas before the Store constructor creates its initial models. */
export function openBlockStore(doc: Doc) {
  removeRetiredBlocks(doc.yBlocks);
  migrateInlineDates(doc.yBlocks);
  migrateBlocks(doc.yBlocks);
  const unknown = new Map<string, number>();
  for (const value of doc.yBlocks.values()) {
    const flavour = value.get("sys:flavour");
    if (typeof flavour === "string" && !knownFlavours.has(flavour))
      unknown.set(flavour, Number(value.get("sys:version") ?? 1));
  }
  const store = doc.getStore({
    extensions: [...unknown].map(([flavour, version]) =>
      BlockSchemaExtension(unavailableSchema(flavour, version)),
    ),
  });
  if (!preparedStores.has(store)) {
    // Shallow Yjs observers run before BlockSuite's deep observer builds new models.
    const registerUnknown = () => {
      for (const value of doc.yBlocks.values()) {
        const flavour = value.get("sys:flavour");
        if (
          typeof flavour === "string" &&
          !retiredBlockFlavours.has(flavour) &&
          !store.schema.get(flavour)
        )
          store.schema.register([
            unavailableSchema(flavour, Number(value.get("sys:version") ?? 1)),
          ]);
      }
    };
    doc.yBlocks.observe(registerUnknown);
    store.disposableGroup.add(() => doc.yBlocks.unobserve(registerUnknown));
    preparedStores.add(store);
  }
  return store;
}

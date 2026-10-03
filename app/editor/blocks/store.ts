import { inlineDateAdapters } from "../inline-date-adapters";
import { migrateInlineDates } from "../../../blocks/date/inline";
import {
  BlockSchemaExtension,
  BlockSchemaIdentifier,
  defineBlockSchema,
  type Doc,
  type ExtensionType,
} from "@blocksuite/affine/store";
import { AffineSchemas } from "@blocksuite/affine/schemas";
import { NoteBlockModel, NoteBlockSchema } from "@blocksuite/affine/model";
import { blockRegistry } from "../../../blocks/registry";
import {
  removeRetiredBlocks,
  retiredBlockFlavours,
} from "../../../blocks/retired";
import { migrateBlocks } from "../../../blocks/document";
import { migrateMeetingNotes } from "../../../blocks/meeting/notes";

class PageNoteBlockModel extends NoteBlockModel {
  override isPageBlock() {
    // Backspace at the start of meeting notes must not merge them into the page title.
    return this.parent?.flavour !== "hyperion:meeting" && super.isPageBlock();
  }
}

export function blockStoreExtensions(): ExtensionType[] {
  return [
    ...inlineDateAdapters,
    {
      setup(container) {
        // A regular note accepts all page blocks and keeps upstream editing behavior.
        container.override(BlockSchemaIdentifier("affine:note"), () => ({
          ...NoteBlockSchema,
          model: {
            ...NoteBlockSchema.model,
            parent: [...NoteBlockSchema.model.parent!, "hyperion:meeting"],
            toModel: () => new PageNoteBlockModel(),
          },
        }));
      },
    },
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
  migrateMeetingNotes(doc.yBlocks);
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

import { BlockViewExtension, type BlockStdScope } from "@blocksuite/affine/std";
import type { Store } from "@blocksuite/affine/store";
import {
  SlashMenuExtension,
  SlashMenuConfigExtension,
  type SlashMenuItem,
  type SlashMenuContext,
} from "@blocksuite/affine/widgets/slash-menu";
import { literal, unsafeStatic } from "lit/static-html.js";
import { html } from "lit";
import { EmbedOptionProvider } from "@blocksuite/affine/shared/services";
import { blockRegistry, isBlockAvailable } from "../../../blocks/registry";
import { readBlock } from "../../../blocks/document";
import { UnavailableBlock } from "./unavailable";
import { retiredBlockFlavours, canInsertSlashItem } from "./insertion-policy";

type BlockViewModule = {
  flavour: string;
  tagName: string;
  component: CustomElementConstructor;
};
// Convention-based discovery keeps browser imports out of the shared data registry.
const modules = import.meta.glob<BlockViewModule>("../../../blocks/*/view.ts", {
  eager: true,
});
const views = new Map(
  Object.values(modules).map((view) => [view.flavour, view]),
);
if (!customElements.get("hyperion-unavailable-block"))
  customElements.define("hyperion-unavailable-block", UnavailableBlock);
for (const view of views.values()) {
  if (!blockRegistry.has(view.flavour))
    throw new Error(`Block view has no definition: ${view.flavour}`);
  if (!customElements.get(view.tagName))
    customElements.define(view.tagName, view.component);
}

export function customBlockViews(store: Store) {
  const flavours = new Set(
    [...blockRegistry.keys(), ...store.schema.flavourSchemaMap.keys()].filter(
      (flavour) => !flavour.startsWith("affine:"),
    ),
  );
  // Missing upstream implementations also receive the placeholder below when no view exists.
  return [...flavours].map((flavour) =>
    BlockViewExtension(flavour, (model) => {
      const value = store.doc.yBlocks.get(model.id);
      const view = views.get(flavour);
      return view && value && isBlockAvailable(readBlock(model.id, value))
        ? literal`${unsafeStatic(view.tagName)}`
        : literal`hyperion-unavailable-block`;
    }),
  );
}

export function customBlockInsertion() {
  return [...blockRegistry.values()]
    .filter(
      (definition) =>
        definition.insertion && !retiredBlockFlavours.has(definition.flavour),
    )
    .map((definition) =>
      SlashMenuConfigExtension(definition.flavour, {
        items: [
          {
            name: definition.label,
            description: definition.insertion!.description,
            searchAlias: definition.insertion!.aliases,
            icon: html`<span aria-hidden="true"
              >${definition.insertion?.icon ?? "▧"}</span
            >`,
            group: "0_Basic@20",
            when: ({ model }: SlashMenuContext) => {
              const parent = model.store.getParent(model);
              return (
                !model.store.readonly &&
                Boolean(
                  parent &&
                    model.store.schema.isValid(
                      definition.flavour,
                      parent.flavour,
                    ),
                )
              );
            },
            action: ({ model, std }: SlashMenuContext) => {
              const store = model.store;
              const parent = store.getParent(model);
              if (
                !parent ||
                store.readonly ||
                retiredBlockFlavours.has(definition.flavour)
              )
                return;
              store.captureSync();
              const id = store.addBlock(
                definition.flavour,
                definition.defaults(),
                parent,
                parent.children.indexOf(model) + 1,
              );
              store.captureSync();
              void std.host.updateComplete.then(() => {
                const element = std.view.getBlock(id);
                element?.scrollIntoView({ block: "nearest" });
                element?.querySelector<HTMLInputElement>("input")?.focus();
              });
            },
          },
        ],
      }),
    );
}

/** Remove retired insertion commands from the assembled menu. */
export function applyInsertionPolicy(scope: BlockStdScope) {
  const embeds = scope.getOptional(EmbedOptionProvider);
  if (embeds) {
    const original = embeds.getEmbedBlockOptions.bind(embeds);
    embeds.getEmbedBlockOptions = (url) => {
      const options = original(url);
      return options && retiredBlockFlavours.has(options.flavour)
        ? null
        : options;
    };
  }
  const menu = scope.get(SlashMenuExtension);
  const original = menu.config.items;
  const filter = (items: SlashMenuItem[]): SlashMenuItem[] =>
    items.flatMap<SlashMenuItem>((item) => {
      if (!canInsertSlashItem(item.name)) return [];
      if ("subMenu" in item) {
        const subMenu = filter(item.subMenu);
        return subMenu.length ? [{ ...item, subMenu }] : [];
      }
      return [item];
    });
  menu.config = {
    ...menu.config,
    items: (context) =>
      filter(typeof original === "function" ? original(context) : original),
  };
}

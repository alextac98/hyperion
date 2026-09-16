import type { ExtensionType } from "@blocksuite/affine/store";
import { retiredBlockFlavours } from "../../../blocks/retired";

/** The upstream preset groups several embeds in one provider. Filter its schema
 * and view registrations while retaining shared infrastructure used by the page. */
export function supportedExtensions(
  extensions: ExtensionType[],
): ExtensionType[] {
  return extensions.map((extension) => ({
    setup(container) {
      extension.setup(
        new Proxy(container, {
          get(target, property, receiver) {
            if (property === "addFactory") {
              const add: typeof container.addFactory = (
                identifier,
                factory,
                options,
              ) => {
                const token = identifier as {
                  identifierName?: string;
                  variant?: string;
                };
                if (
                  ["BlockSchema", "BlockView"].includes(
                    token.identifierName ?? "",
                  ) &&
                  retiredBlockFlavours.has(token.variant ?? "")
                )
                  return;
                target.addFactory(identifier, factory, options);
              };
              return add;
            }
            return Reflect.get(target, property, receiver);
          },
        }),
      );
    },
  }));
}

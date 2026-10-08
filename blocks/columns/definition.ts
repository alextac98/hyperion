import type { BlockDefinition } from "../contract.js";

/** Column count and content live in the ordered note children, with no duplicate state. */
export const columnsDefinition: BlockDefinition = {
  flavour: "hyperion:columns",
  label: "Columns",
  version: 1,
  children: ["affine:note"],
  defaults: () => ({}),
  validate: () => true,
  project: () => ({ text: "" }),
  insertion: {
    description: "Arrange blocks in two or more columns",
    aliases: ["column", "layout", "side by side"],
    icon: "▥",
  },
};

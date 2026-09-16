import type { BlockDefinition } from "../contract.js";

export const ratingDefinition: BlockDefinition = {
  flavour: "hyperion:rating",
  label: "Rating",
  version: 1,
  defaults: () => ({ label: "Rating", value: 0 }),
  validate: (props) =>
    typeof props.label === "string" &&
    Number.isInteger(props.value) &&
    Number(props.value) >= 0 &&
    Number(props.value) <= 5,
  project: ({ props }) => ({
    text: `${props.label || "Rating"}: ${props.value === 0 ? "Not rated" : `${props.value}/5`}`,
  }),
  insertion: {
    icon: "☆",
    description: "Rate something from one to five stars.",
    aliases: ["stars", "score", "review"],
  },
};

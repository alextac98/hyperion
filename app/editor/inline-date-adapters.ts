import {
  InlineDeltaToHtmlAdapterExtension,
  InlineDeltaToMarkdownAdapterExtension,
  InlineDeltaToPlainTextAdapterExtension,
} from "@blocksuite/affine/shared/adapters";
import { DATE_ATTRIBUTE, dateText } from "../../blocks/date/inline";
import { isCalendarDate } from "../../blocks/date/definition";

type Delta = { insert: string; attributes?: object };
const match = (delta: Delta) =>
  isCalendarDate(
    (delta.attributes as Record<string, unknown> | undefined)?.[DATE_ATTRIBUTE],
  );
const value = (delta: Delta) =>
  dateText({
    toDelta: () => [
      {
        ...delta,
        attributes: delta.attributes as Record<string, unknown> | undefined,
      },
    ],
  });

// Preserve readable dates when copying to other applications or exporting text.
export const inlineDateAdapters = [
  InlineDeltaToPlainTextAdapterExtension({
    name: DATE_ATTRIBUTE,
    match,
    toAST: (delta) => ({ content: value(delta) }),
  }),
  InlineDeltaToMarkdownAdapterExtension({
    name: DATE_ATTRIBUTE,
    match,
    toAST: (delta) => ({ type: "text", value: value(delta) }),
  }),
  InlineDeltaToHtmlAdapterExtension({
    name: DATE_ATTRIBUTE,
    match,
    toAST: (delta) => ({ type: "text", value: value(delta) }),
  }),
];

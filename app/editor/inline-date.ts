import { html } from "lit";
import { z } from "zod";
import * as Y from "yjs";
import {
  Text,
  type BlockModel,
  type BaseTextAttributes,
} from "@blocksuite/affine/store";
import { TextSelection, type BlockStdScope } from "@blocksuite/affine/std";
import {
  InlineSpecExtension,
  ZERO_WIDTH_FOR_EMBED_NODE,
  type InlineEditor,
} from "@blocksuite/affine/std/inline";
import { DefaultInlineManagerExtension } from "@blocksuite/affine/inlines/preset";
import { SlashMenuConfigExtension } from "@blocksuite/affine/widgets/slash-menu";
import { DATE_ATTRIBUTE, DATE_CHARACTER } from "../../blocks/date/inline";
import { isCalendarDate } from "../../blocks/date/definition";
import { dateLabel, openDatePicker } from "./date-picker";
import "./inline-date.css";

type DateAttributes = BaseTextAttributes & { hyperionDate?: string };
function textOf(model: BlockModel) {
  return (model.props as Record<string, unknown>).text as Text | undefined;
}
function editorOf(std: BlockStdScope, model: BlockModel) {
  return std.view.getBlock(model.id)?.querySelector("rich-text")?.inlineEditor;
}
function restoreCaret(editor: InlineEditor, index: number) {
  void editor.waitForUpdate().then(() => {
    if (editor.rootElement?.isConnected) {
      // Nested contenteditable spans cannot take focus; focus the editing host.
      let host: HTMLElement = editor.rootElement;
      while (host.parentElement?.isContentEditable) host = host.parentElement;
      host.focus({ preventScroll: true });
      editor.focusIndex(index);
    }
  });
}

function pickDate(
  std: BlockStdScope,
  model: BlockModel,
  index: number,
  length: number,
  value = "",
  anchor?: HTMLElement,
) {
  const text = textOf(model),
    editor = editorOf(std, model);
  const block = std.view.getBlock(model.id);
  if (!text || !editor || !block || std.store.readonly) return;
  const start = Y.createRelativePositionFromTypeIndex(text.yText, index);
  const end = length
    ? Y.createRelativePositionFromTypeIndex(text.yText, index + length)
    : start;
  const locate = () => {
    if (
      std.store.readonly ||
      !text.yText.doc ||
      textOf(std.store.getModelById(model.id) ?? model) !== text ||
      !block.isConnected
    )
      return null;
    const a = Y.createAbsolutePositionFromRelativePosition(
      start,
      text.yText.doc,
    );
    const b = Y.createAbsolutePositionFromRelativePosition(end, text.yText.doc);
    return a && b && a.type === text.yText && b.type === text.yText
      ? { index: a.index, length: b.index - a.index }
      : null;
  };
  std.store.captureSync();
  openDatePicker(
    anchor ?? block,
    value,
    (date) => {
      const range = locate();
      if (!range) return;
      std.store.captureSync();
      std.store.transact(() => {
        if (range.length) text.delete(range.index, range.length);
        text.insert(DATE_CHARACTER, range.index, {
          [DATE_ATTRIBUTE]: date,
        });
      });
      std.store.captureSync();
      restoreCaret(editor, range.index + 1);
    },
    (restoreFocus) => {
      const range = locate();
      if (range && restoreFocus)
        restoreCaret(editor, range.index + range.length);
    },
  );
}

export const inlineDateSpec = InlineSpecExtension<DateAttributes>({
  name: DATE_ATTRIBUTE,
  schema: z.string().optional().nullable().catch(undefined),
  match: (delta) => isCalendarDate(delta.attributes?.hyperionDate),
  embed: true,
  renderer: ({ delta, selected, editor, startOffset }) => {
    const date = delta.attributes!.hyperionDate!;
    const modelElement = editor.rootElement?.closest<
      HTMLElement & { model: BlockModel; std: BlockStdScope }
    >("[data-block-id]");
    const open = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (modelElement)
        pickDate(
          modelElement.std,
          modelElement.model,
          startOffset,
          1,
          date,
          event.currentTarget as HTMLElement,
        );
    };
    return html`<span class="hyperion-date-node"
      ><span
        class="hyperion-inline-date"
        data-selected=${selected}
        contenteditable="false"
        role=${modelElement?.model.store.readonly ? "text" : "button"}
        tabindex=${modelElement?.model.store.readonly ? -1 : 0}
        aria-label=${`Date: ${dateLabel(date)}`}
        @mousedown=${(event: MouseEvent) => event.preventDefault()}
        @click=${open}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") open(event);
          else if (
            (event.key === "Backspace" || event.key === "Delete") &&
            modelElement &&
            !modelElement.model.store.readonly
          ) {
            event.preventDefault();
            event.stopPropagation();
            const store = modelElement.model.store;
            store.captureSync();
            textOf(modelElement.model)?.delete(startOffset, 1);
            store.captureSync();
            restoreCaret(editor, startOffset);
          }
        }}
        ><time datetime=${date}>${dateLabel(date)}</time></span
      ><v-text .str=${ZERO_WIDTH_FOR_EMBED_NODE}></v-text
    ></span>`;
  },
});

export const inlineDateMenu = SlashMenuConfigExtension("hyperion:inline-date", {
  items: [
    {
      name: "Date",
      description: "Insert an inline date.",
      searchAlias: ["calendar", "day"],
      group: "0_Basic@20",
      icon: html`<span aria-hidden="true">▦</span>`,
      when: ({ model }) =>
        !model.store.readonly &&
        ["affine:paragraph", "affine:list"].includes(model.flavour),
      action: ({ std, model }) => {
        const selection = std.selection.find(TextSelection);
        const editor = editorOf(std, model);
        const range =
          selection?.from.blockId === model.id
            ? selection.from
            : editor?.getInlineRange();
        if (range) pickDate(std, model, range.index, range.length);
      },
    },
  ],
});

export function configureInlineDates(std: BlockStdScope) {
  std
    .get(DefaultInlineManagerExtension.identifier)
    .specs.push(std.get(inlineDateSpec.identifier));
}

/** // is an alias for searching Date, not an insertion command. */
export function installInlineDates(container: HTMLElement, std: BlockStdScope) {
  container.addEventListener(
    "keydown",
    (event) => {
      if (
        event.isComposing ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        std.store.readonly
      )
        return;
      if (
        !(event.target instanceof HTMLElement) ||
        event.target.closest(
          'input, textarea, select, button, [contenteditable="false"]',
        )
      )
        return;
      const selection = std.selection.find(TextSelection);
      if (!selection || selection.to || selection.from.length) return;
      const model = std.store.getModelById(selection.from.blockId);
      if (
        !model ||
        !["affine:paragraph", "affine:list"].includes(model.flavour)
      )
        return;
      const text = textOf(model);
      if (!text) return;
      const index = selection.from.index;
      if (event.key === "Backspace" || event.key === "Delete") {
        const target = event.key === "Backspace" ? index - 1 : index;
        let offset = 0;
        for (const delta of text.yText.toDelta()) {
          const end =
            offset +
            (typeof delta.insert === "string" ? delta.insert.length : 1);
          if (
            target >= offset &&
            target < end &&
            isCalendarDate(delta.attributes?.[DATE_ATTRIBUTE])
          ) {
            event.preventDefault();
            event.stopImmediatePropagation();
            std.store.captureSync();
            text.delete(target, 1);
            std.store.captureSync();
            const editor = editorOf(std, model);
            if (editor) restoreCaret(editor, target);
            return;
          }
          offset = end;
        }
        return;
      }
      if (event.key !== "/") return;
      const prefix = text.toString().slice(0, index);
      if (!prefix.endsWith("/") || (index > 1 && !/\s/.test(prefix[index - 2])))
        return;
      let offset = 0;
      for (const delta of text.yText.toDelta()) {
        const end =
          offset + (typeof delta.insert === "string" ? delta.insert.length : 1);
        if (
          offset <= index - 1 &&
          index - 1 < end &&
          (delta.attributes?.code || delta.attributes?.link)
        )
          return;
        offset = end;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      text.insert("date", index, {});
      const editor = editorOf(std, model);
      editor?.setInlineRange({ index: index + 4, length: 0 });
      // BlockSuite 0.22 refreshes slash results only on typed keys. This alias changes
      // Y.Text directly, so refresh the existing menu after its range has rendered.
      void editor?.waitForUpdate().then(() => {
        type SearchMenu = HTMLElement & {
          context?: { std: BlockStdScope; model: BlockModel };
          _updateFilteredItems?: () => void;
        };
        for (const menu of document.querySelectorAll<SearchMenu>(
          "affine-slash-menu",
        )) {
          if (menu.context?.std === std && menu.context.model.id === model.id)
            menu._updateFilteredItems?.();
        }
      });
    },
    { capture: true },
  );
}

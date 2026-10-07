import { BlockComponent } from "@blocksuite/affine/std";
import { css, html, nothing } from "lit";
import { DocModeProvider } from "@blocksuite/affine/shared/services";
import { Text } from "@blocksuite/affine/store";
import {
  appendColumn,
  removeLastColumn,
  MIN_COLUMNS,
  MAX_COLUMNS,
} from "../../app/editor/blocks/columns";

export const flavour = "hyperion:columns";
export const tagName = "hyperion-columns-block";

export class ColumnsBlock extends BlockComponent {
  static override styles = css`
    hyperion-columns-block {
      display: block;
      margin: 16px 0;
      container: hyperion-columns / inline-size;
    }
    .columns-toolbar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
      color: var(--text-soft);
      font-size: 12px;
    }
    .columns-toolbar span {
      margin-right: auto;
    }
    .columns-toolbar button {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 4px 8px;
      background: var(--panel);
      color: var(--text-soft);
      font: inherit;
      cursor: pointer;
    }
    .columns-toolbar button:hover:not(:disabled) {
      color: var(--text);
      border-color: var(--line-strong);
    }
    .columns-toolbar button:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .columns-toolbar button:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .columns-grid {
      display: grid;
      grid-template-columns: repeat(
        var(--hyperion-column-count),
        minmax(0, 1fr)
      );
      gap: 24px;
      align-items: start;
    }
    .columns-grid > affine-note {
      display: block;
      min-width: 0;
      min-height: 48px;
      padding: 8px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow-wrap: anywhere;
    }
    @container hyperion-columns (max-width: 520px) {
      .columns-grid {
        grid-template-columns: minmax(0, 1fr);
        gap: 12px;
      }
    }
  `;

  onInsert() {
    const paragraph = this.model.children[0]?.children[0];
    if (!paragraph) return;
    this.focusParagraph(paragraph.id);
  }

  private focusParagraph(id: string) {
    void this.updateComplete.then(() => {
      const editor = this.std.view
        .getBlock(id)
        ?.querySelector("rich-text")?.inlineEditor;
      if (!editor) return;
      void editor.waitForUpdate().then(() => {
        if (!editor.rootElement?.isConnected) return;
        let host: HTMLElement = editor.rootElement;
        while (host.parentElement?.isContentEditable) host = host.parentElement;
        host.focus({ preventScroll: true });
        editor.focusIndex(0);
      });
    });
  }

  private addColumn = () => {
    if (this.store.readonly || this.model.children.length >= MAX_COLUMNS)
      return;
    this.store.captureSync();
    const paragraph = appendColumn(this.store, this.model);
    this.store.captureSync();
    this.focusParagraph(paragraph);
  };

  private removeColumn = () => {
    if (this.store.readonly || this.model.children.length <= MIN_COLUMNS)
      return;
    this.store.captureSync();
    removeLastColumn(this.store, this.model);
    this.store.captureSync();
  };

  private focusEmptyColumn = (event: MouseEvent) => {
    if (this.store.readonly || !(event.target instanceof Element)) return;
    const noteId = event.target.closest("affine-note")?.dataset.blockId;
    const note = this.model.children.find((child) => child.id === noteId);
    if (!note || note.children.length) return;
    // Dragging or deleting every block can leave a column empty. A click makes
    // it editable again without adding content during rendering or undo.
    event.preventDefault();
    event.stopPropagation();
    this.store.captureSync();
    const paragraph = this.store.addBlock(
      "affine:paragraph",
      { type: "text", text: new Text() },
      note,
    );
    this.store.captureSync();
    this.focusParagraph(paragraph);
  };

  override renderBlock() {
    const count = this.model.children.length;
    return html`
      ${!this.store.readonly &&
      this.std.get(DocModeProvider).getEditorMode() === "page"
        ? html`<div
            class="columns-toolbar"
            contenteditable="false"
            data-range-sync-exclude="true"
            role="group"
            aria-label="Column layout"
          >
            <span>${count} columns</span>
            <button
              type="button"
              ?disabled=${count >= MAX_COLUMNS}
              @click=${this.addColumn}
            >
              Add column
            </button>
            <button
              type="button"
              ?disabled=${count <= MIN_COLUMNS}
              title="Move the last column's blocks into the previous column"
              @click=${this.removeColumn}
            >
              Remove last column
            </button>
          </div>`
        : nothing}
      <div
        class="columns-grid"
        style=${`--hyperion-column-count: ${Math.max(1, count)}`}
        role="group"
        aria-label="Columns"
        @click=${this.focusEmptyColumn}
      >
        ${this.renderChildren(this.model)}
      </div>
    `;
  }
}

export const component = ColumnsBlock;

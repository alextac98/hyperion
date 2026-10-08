import { BlockComponent } from "@blocksuite/affine/std";
import { css, html, nothing } from "lit";
import { DocModeProvider } from "@blocksuite/affine/shared/services";
import { Text } from "@blocksuite/affine/store";
import { repeat } from "lit/directives/repeat.js";
import { openEditorActionMenu } from "../../app/editor/action-menu";
import { focusBlock, openBlockActions } from "../../app/editor/block-actions";
import {
  appendColumn,
  removeColumn,
  moveColumn,
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
    .columns-column {
      display: block;
      min-width: 0;
      min-height: 48px;
      padding: 8px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow-wrap: anywhere;
    }
    .column-header {
      margin-bottom: 6px;
    }
    .column-grip,
    .columns-layout-menu {
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: var(--text-soft);
      padding: 4px 6px;
      font: inherit;
      font-size: 12px;
      cursor: grab;
    }
    .columns-layout-menu {
      cursor: pointer;
    }
    .column-grip:hover,
    .columns-layout-menu:hover {
      background: var(--hover);
      color: var(--text);
    }
    .column-grip:focus-visible,
    .columns-layout-menu:focus-visible {
      outline: 2px solid var(--accent);
    }
    .columns-column[data-drop="before"] {
      box-shadow: -3px 0 var(--accent);
    }
    .columns-column[data-drop="after"] {
      box-shadow: 3px 0 var(--accent);
    }
    @container hyperion-columns (max-width: 520px) {
      .columns-grid {
        grid-template-columns: minmax(0, 1fr);
        gap: 12px;
      }
      .columns-column[data-drop="before"] {
        box-shadow: 0 -3px var(--accent);
      }
      .columns-column[data-drop="after"] {
        box-shadow: 0 3px var(--accent);
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

  private draggedColumn?: string;
  private dropColumn?: { id: string; before: boolean };
  private closeMenu?: () => void;

  private get editable() {
    return (
      !this.store.readonly &&
      this.std.get(DocModeProvider).getEditorMode() === "page"
    );
  }

  private move(id: string, direction: -1 | 1) {
    if (!this.editable) return;
    const index = this.model.children.findIndex((column) => column.id === id);
    const target = this.model.children[index + direction];
    if (!target) return;
    moveColumn(this.store, this.model, id, target.id, direction === -1);
    void this.updateComplete.then(() => {
      this.querySelector<HTMLButtonElement>(
        `[data-column-id="${id}"] .column-grip`,
      )?.focus({ preventScroll: true });
    });
  }

  private columnMenu(event: MouseEvent, id: string) {
    if (!this.editable) return;
    event.stopPropagation();
    const index = this.model.children.findIndex((column) => column.id === id);
    this.closeMenu = openEditorActionMenu(
      event.currentTarget as HTMLElement,
      `Column ${index + 1} actions`,
      [
        {
          label: "Move left",
          disabled: index === 0,
          run: () => this.move(id, -1),
        },
        {
          label: "Move right",
          disabled: index === this.model.children.length - 1,
          run: () => this.move(id, 1),
        },
        {
          label: "Remove column (keep content)",
          disabled: this.model.children.length <= MIN_COLUMNS,
          run: () => {
            if (!this.editable) return;
            this.std.selection.clear();
            this.store.captureSync();
            const neighbor = removeColumn(this.store, this.model, id);
            this.store.captureSync();
            focusBlock(this.std, neighbor);
          },
        },
      ],
    );
  }

  private dragStart(event: DragEvent, id: string) {
    if (!this.editable || !event.dataTransfer) return event.preventDefault();
    event.stopPropagation();
    this.closeMenu?.();
    this.draggedColumn = id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-hyperion-column", id);
  }

  private dragOver(event: DragEvent, id: string) {
    if (!this.editable || !this.draggedColumn || this.draggedColumn === id)
      return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const nodes = (event.currentTarget as HTMLElement).parentElement!.children;
    const stacked =
      nodes.length > 1 &&
      Math.abs(
        nodes[0].getBoundingClientRect().left -
          nodes[1].getBoundingClientRect().left,
      ) < 1;
    this.dropColumn = {
      id,
      before: stacked
        ? event.clientY < rect.top + rect.height / 2
        : event.clientX < rect.left + rect.width / 2,
    };
    this.requestUpdate();
  }

  private drop(event: DragEvent, id: string) {
    if (!this.editable || !this.draggedColumn) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragOver(event, id);
    if (this.dropColumn?.id === id)
      moveColumn(
        this.store,
        this.model,
        this.draggedColumn,
        id,
        this.dropColumn.before,
      );
    this.endDrag();
  }

  private endDrag() {
    this.draggedColumn = undefined;
    this.dropColumn = undefined;
    this.requestUpdate();
  }

  override disconnectedCallback() {
    this.closeMenu?.();
    super.disconnectedCallback();
  }

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
      ${this.editable
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
              data-action="add-column"
              ?disabled=${count >= MAX_COLUMNS}
              @click=${this.addColumn}
            >
              Add column
            </button>
            <button
              type="button"
              class="columns-layout-menu"
              aria-label="Column layout actions"
              aria-haspopup="menu"
              aria-expanded="false"
              title="Move, unwrap or delete the entire column layout"
              @click=${(event: MouseEvent) => {
                event.stopPropagation();
                this.closeMenu = openBlockActions(
                  this.std,
                  this.model.id,
                  event.currentTarget as HTMLElement,
                );
              }}
            >
              ⋯
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
        ${repeat(
          this.model.children,
          (column) => column.id,
          (column, index) =>
            html` <div
              class="columns-column"
              data-column-id=${column.id}
              data-drop=${this.dropColumn?.id === column.id
                ? this.dropColumn.before
                  ? "before"
                  : "after"
                : ""}
              @dragover=${(event: DragEvent) => this.dragOver(event, column.id)}
              @drop=${(event: DragEvent) => this.drop(event, column.id)}
            >
              ${this.editable
                ? html`<div
                    class="column-header"
                    contenteditable="false"
                    data-range-sync-exclude="true"
                  >
                    <button
                      type="button"
                      class="column-grip"
                      draggable="true"
                      aria-label=${`Column ${index + 1} actions`}
                      aria-haspopup="menu"
                      aria-expanded="false"
                      aria-description="Drag to reorder columns, or open the menu. Alt and the left or right arrow also reorder."
                      aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                      title="Drag to reorder · Click for column actions · Alt+←/→"
                      @click=${(event: MouseEvent) =>
                        this.columnMenu(event, column.id)}
                      @keydown=${(event: KeyboardEvent) => {
                        if (
                          event.altKey &&
                          !event.ctrlKey &&
                          !event.metaKey &&
                          !event.shiftKey &&
                          (event.key === "ArrowLeft" ||
                            event.key === "ArrowRight")
                        ) {
                          event.preventDefault();
                          event.stopPropagation();
                          this.move(
                            column.id,
                            event.key === "ArrowLeft" ? -1 : 1,
                          );
                        }
                      }}
                      @dragstart=${(event: DragEvent) =>
                        this.dragStart(event, column.id)}
                      @dragend=${() => this.endDrag()}
                    >
                      <span aria-hidden="true">⠿</span> Column ${index + 1}
                    </button>
                  </div>`
                : nothing}
              ${this.renderChildren(
                this.model,
                (child) => child.id === column.id,
              )}
            </div>`,
        )}
      </div>
    `;
  }
}

export const component = ColumnsBlock;

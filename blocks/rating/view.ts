import { BlockComponent } from "@blocksuite/affine/std";
import { css, html } from "lit";

export const flavour = "hyperion:rating";
export const tagName = "hyperion-rating";

export class RatingBlock extends BlockComponent {
  static override styles = css`
    hyperion-rating {
      display: block;
      margin: 12px 0;
    }
    .rating-block {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--panel);
      color: var(--text);
    }
    .rating-label {
      flex: 1;
      min-width: 120px;
      border: 0;
      border-bottom: 1px solid transparent;
      border-radius: 0;
      padding: 4px 0;
      background: transparent;
      color: inherit;
      font: inherit;
    }
    .rating-label:focus {
      outline: none;
      border-bottom-color: var(--accent);
    }
    .rating-stars {
      display: flex;
      gap: 4px;
    }
    .rating-star {
      border: 0;
      background: transparent;
      color: var(--text-faint);
      font-size: 26px;
      padding: 2px;
      cursor: pointer;
    }
    .rating-star[data-filled] {
      color: var(--accent);
    }
    .rating-star:focus-visible,
    .rating-clear:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .rating-star:disabled {
      cursor: default;
    }
    .rating-clear {
      background: transparent;
      color: var(--text-soft);
      font: inherit;
      font-size: 13px;
      border: 0;
      cursor: pointer;
    }
    .rating-summary {
      font-size: 13px;
      color: var(--text-soft);
    }
  `;

  private updateRating(patch: Record<string, unknown>, typing = false) {
    if (this.store.readonly) return;
    if (!typing) this.store.captureSync();
    this.store.updateBlock(this.model, patch);
    if (!typing) this.store.captureSync();
  }

  override renderBlock() {
    const { label, value } = this.model.props as {
      label: string;
      value: number;
    };
    const readonly = this.store.readonly;
    return html`<div
      class="rating-block"
      contenteditable="false"
      @keydown=${(event: KeyboardEvent) => {
        if (event.target instanceof HTMLInputElement) event.stopPropagation();
      }}
    >
      <input
        class="rating-label"
        aria-label="Rating label"
        .value=${label}
        ?readonly=${readonly}
        @focus=${() => this.store.captureSync()}
        @blur=${() => this.store.captureSync()}
        @input=${(event: Event) =>
          this.updateRating(
            { label: (event.target as HTMLInputElement).value },
            true,
          )}
      />
      <div
        class="rating-stars"
        role="group"
        aria-label=${`${label || "Rating"}: choose a score`}
      >
        ${[1, 2, 3, 4, 5].map(
          (score) =>
            html`<button
              type="button"
              class="rating-star"
              aria-label=${`Rate ${score} out of 5`}
              ?data-filled=${score <= value}
              aria-pressed=${value === score ? "true" : "false"}
              ?disabled=${readonly}
              @click=${() => this.updateRating({ value: score })}
            >
              ${score <= value ? "★" : "☆"}
            </button>`,
        )}
      </div>
      <span class="rating-summary" aria-live="polite"
        >${value ? `${value}/5` : "Not rated"}</span
      >
      ${!readonly && value
        ? html`<button
            type="button"
            class="rating-clear"
            @click=${() => this.updateRating({ value: 0 })}
          >
            Clear
          </button>`
        : ""}
    </div>`;
  }
}

export const component = RatingBlock;

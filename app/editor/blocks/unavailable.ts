import { BlockComponent } from "@blocksuite/affine/std";
import { html, css } from "lit";

export class UnavailableBlock extends BlockComponent {
  static override styles = css`
    hyperion-unavailable-block {
      display: block;
      margin: 12px 0;
    }
    .unavailable-block-message {
      padding: 14px;
      border: 1px dashed var(--line-strong);
      border-radius: 8px;
      background: var(--panel);
      color: var(--text-soft);
    }
    .unavailable-block-message p {
      margin: 4px 0 0;
      font-size: 14px;
    }
    .unavailable-block-children {
      padding-left: 20px;
    }
  `;
  override get isVersionMismatch() {
    return false;
  }
  override renderBlock() {
    return html`
      <div
        class="unavailable-block-message"
        contenteditable="false"
        role="note"
      >
        <strong>Unavailable block</strong>
        <p>
          This block needs an implementation or version that is not available.
          Its content is preserved.
        </p>
        <small>${this.model.flavour} · version ${this.model.version}</small>
      </div>
      <div class="unavailable-block-children">
        ${this.renderChildren(this.model)}
      </div>
    `;
  }
}

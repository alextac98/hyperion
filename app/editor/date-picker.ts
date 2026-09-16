import { LitElement, css, html } from "lit";
import { localToday, parseCalendarDate } from "../../blocks/date/definition";

const asDate = (iso: string) => new Date(`${iso}T12:00:00Z`);
export const dateLabel = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(asDate(iso));

class DatePicker extends LitElement {
  static override styles = css`
    :host {
      position: fixed;
      inset: auto;
      margin: 0;
      padding: 0;
      width: 252px;
      max-width: calc(100vw - 16px);
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      background: var(--panel);
      color: var(--text);
      box-shadow: 0 8px 28px #0003;
      font:
        13px/1.4 system-ui,
        sans-serif;
    }
    section {
      padding: 12px;
    }
    button,
    input {
      font: inherit;
      color: inherit;
      box-sizing: border-box;
    }
    button {
      border: 0;
      border-radius: 4px;
      background: transparent;
      cursor: pointer;
      padding: 4px 6px;
    }
    button:hover,
    button[aria-pressed="true"] {
      background: var(--selected-bg);
      color: var(--accent-text);
    }
    button:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
    input {
      width: 100%;
      margin-top: 4px;
      padding: 6px 8px;
      border: 1px solid var(--line-strong);
      border-radius: 4px;
      background: var(--bg);
    }
    .help {
      margin: 4px 0 0;
      font-size: 11px;
      color: var(--text-soft);
    }
    .error {
      color: var(--danger);
      margin: 4px 0;
    }
    .month,
    .actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      text-align: center;
      gap: 1px;
      margin-top: 6px;
    }
    .grid button {
      width: 30px;
      height: 28px;
      padding: 0;
    }
    .weekday {
      color: var(--text-soft);
      font-size: 11px;
      padding: 4px 0;
    }
    [aria-current="date"] {
      box-shadow: inset 0 0 0 1px var(--accent);
    }
  `;
  value = "";
  draft = "";
  month = localToday().slice(0, 7);
  error = "";
  choose: (date: string) => void = () => {};
  cancel: () => void = () => {};
  submit() {
    const date = this.draft.trim() ? parseCalendarDate(this.draft) : this.value;
    if (date) this.choose(date);
    else {
      this.error = "Enter a valid date.";
      this.requestUpdate();
    }
  }
  private shiftMonth(amount: number) {
    const date = asDate(`${this.month}-01`);
    date.setUTCMonth(date.getUTCMonth() + amount);
    if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return;
    this.month = date.toISOString().slice(0, 7);
    this.requestUpdate();
  }
  private move(event: KeyboardEvent, iso: string) {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    const date = asDate(iso);
    date.setUTCDate(date.getUTCDate() + offsets[event.key]);
    if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return;
    const next = date.toISOString().slice(0, 10);
    this.month = next.slice(0, 7);
    this.requestUpdate();
    void this.updateComplete.then(() =>
      this.shadowRoot
        ?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)
        ?.focus(),
    );
  }
  override render() {
    const first = asDate(`${this.month}-01`);
    const last = asDate(`${this.month}-01`);
    last.setUTCMonth(last.getUTCMonth() + 1);
    last.setUTCDate(0);
    return html`<section
      @keydown=${(event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          this.cancel();
        }
      }}
    >
      <label
        >Date<input
          aria-label="Date"
          aria-describedby="date-help"
          aria-invalid=${Boolean(this.error)}
          placeholder="YYYY-MM-DD"
          .value=${this.draft}
          @input=${(event: Event) => {
            this.draft = (event.target as HTMLInputElement).value;
            this.error = "";
            this.requestUpdate();
          }}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key === "Enter") {
              event.preventDefault();
              this.submit();
            }
          }}
      /></label>
      <p class="help" id="date-help">YYYY-MM-DD or M/D/YYYY</p>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ""}
      <div class="month">
        <button aria-label="Previous month" @click=${() => this.shiftMonth(-1)}>
          ‹</button
        ><strong aria-live="polite"
          >${new Intl.DateTimeFormat(undefined, {
            timeZone: "UTC",
            month: "long",
            year: "numeric",
          }).format(first)}</strong
        ><button aria-label="Next month" @click=${() => this.shiftMonth(1)}>
          ›
        </button>
      </div>
      <div class="grid">
        ${["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(
          (day) => html`<span class="weekday" aria-hidden="true">${day}</span>`,
        )}${Array.from(
          { length: first.getUTCDay() },
          () => html`<span></span>`,
        )}${Array.from({ length: last.getUTCDate() }, (_, index) => {
          const iso = `${this.month}-${String(index + 1).padStart(2, "0")}`;
          return html`<button
            data-date=${iso}
            aria-label=${dateLabel(iso)}
            aria-pressed=${iso === this.value}
            aria-current=${iso === localToday() ? "date" : "false"}
            @click=${() => this.choose(iso)}
            @keydown=${(event: KeyboardEvent) => this.move(event, iso)}
          >
            ${index + 1}
          </button>`;
        })}
      </div>
      <div class="actions">
        <button @click=${() => this.choose(localToday())}>Today</button
        ><button @click=${() => this.cancel()}>Cancel</button
        ><button @click=${() => this.submit()}>Apply</button>
      </div>
    </section>`;
  }
}
if (!customElements.get("hyperion-date-picker"))
  customElements.define("hyperion-date-picker", DatePicker);
let dismiss: (() => void) | undefined;

/** Top-layer popover: does not affect paragraph height or inherit editor button sizing. */
export function openDatePicker(
  anchor: HTMLElement,
  value: string,
  onChoose: (date: string) => void,
  onCancel: (restoreFocus: boolean) => void,
) {
  dismiss?.();
  const picker = document.createElement("hyperion-date-picker") as DatePicker;
  picker.popover = "auto";
  picker.setAttribute("role", "dialog");
  picker.setAttribute("aria-label", "Choose date");
  picker.value = value || localToday();
  picker.draft = value;
  picker.month = picker.value.slice(0, 7);
  const editorHost = anchor.closest("editor-host");
  let focusFrame = 0;
  // The editor can briefly reclaim focus while its slash command settles.
  // Keep Enter/Escape owned by the open picker during that handoff.
  const onEditorKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
      return;
    if (event.composedPath().includes(picker)) return;
    if (
      !(event.target instanceof Node) ||
      (event.target !== document.body && !editorHost?.contains(event.target))
    )
      return;
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === "Enter") picker.submit();
    else cancel(true);
  };
  const cleanup = () => {
    cancelAnimationFrame(focusFrame);
    window.removeEventListener("keydown", onEditorKeyDown, true);
    document.removeEventListener("scroll", position, true);
    window.removeEventListener("resize", position);
    observer.disconnect();
    picker.remove();
    if (dismiss === cancel) dismiss = undefined;
  };
  const cancel = (restoreFocus = false) => {
    cleanup();
    onCancel(restoreFocus);
  };
  const position = () => {
    if (!anchor.isConnected) {
      cancel();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const height = picker.getBoundingClientRect().height;
    picker.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - picker.offsetWidth - 8))}px`;
    picker.style.top = `${Math.max(8, Math.min(rect.bottom + 5 + height <= innerHeight ? rect.bottom + 5 : rect.top - height - 5, innerHeight - height - 8))}px`;
  };
  const observer = new MutationObserver(() => {
    if (!anchor.isConnected) cancel();
  });
  picker.choose = (date) => {
    cleanup();
    onChoose(date);
  };
  picker.cancel = () => cancel(true);
  picker.addEventListener("toggle", () => {
    if (picker.isConnected && !picker.matches(":popover-open")) cancel();
  });
  window.addEventListener("keydown", onEditorKeyDown, true);
  document.body.append(picker);
  picker.showPopover();
  dismiss = cancel;
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("scroll", position, true);
  window.addEventListener("resize", position);
  void picker.updateComplete.then(() => {
    position();
    const focusInput = () => {
      if (picker.isConnected && picker.matches(":popover-open"))
        picker.shadowRoot
          ?.querySelector<HTMLInputElement>("input")
          ?.focus({ preventScroll: true });
    };
    focusInput();
    // Inline rendering can restore the editor's native range after Lit updates.
    // Reassert input focus once that render cycle has finished.
    focusFrame = requestAnimationFrame(focusInput);
  });
  return cancel;
}

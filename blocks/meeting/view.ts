import { migrateMeetingNotes } from "./notes";
import { isCalendarDate } from "../date/definition";
import { BlockComponent } from "@blocksuite/affine/std";
import type { BlockModel } from "@blocksuite/affine/store";
import { css, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { trackMeetingTask } from "../../app/lib/meeting-tasks";
import { meetingRecorder } from "../../app/lib/meeting-recording";
import {
  readAudio,
  writeAudio,
  importedAudioMimeType,
} from "../../app/lib/meeting-audio";
import {
  recordingKeys,
  type MeetingProps,
  type MeetingTab,
} from "./definition";

export const flavour = "hyperion:meeting";
export const tagName = "hyperion-meeting-block";
export class MeetingBlock extends BlockComponent<BlockModel<MeetingProps>> {
  static override properties = {
    tab: { state: true },
    error: { state: true },
    working: { state: true },
    audioUrl: { state: true },
  };
  declare tab: MeetingTab;
  declare error: string;
  declare working: boolean;
  declare audioUrl: string;
  constructor() {
    super();
    this.tab = "notes";
    this.error = "";
    this.working = false;
    this.audioUrl = "";
  }
  private unsubscribe?: () => void;
  private audioSignature = "";
  private loadGeneration = 0;
  static override styles = css`
    hyperion-meeting-block {
      display: block;
      margin: 16px 0;
    }
    .meeting-card {
      border: 1px solid var(--line-strong);
      border-radius: 12px;
      background: var(--panel);
      overflow: hidden;
      color: var(--text);
    }
    .meeting-header {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 6px 12px;
      align-items: center;
      padding: 16px 16px 0;
    }
    .meeting-header input {
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      min-width: 0;
    }
    .meeting-title {
      width: 100%;
      font-weight: 600 !important;
    }
    .meeting-date-field {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      color: var(--text-soft);
      font-size: 13px;
    }
    .meeting-header .meeting-date {
      flex: 0 0 auto;
      width: auto;
      max-width: 100%;
      font-size: 13px;
      padding: 2px 4px;
      border-radius: 4px;
    }
    .meeting-header .meeting-date:focus-visible {
      outline-offset: -2px;
    }
    .meeting-actions,
    .meeting-tabs {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .meeting-actions {
      padding: 0 0 12px;
    }
    .meeting-card input[hidden] {
      display: none;
    }
    .meeting-card button,
    .meeting-card .meeting-download {
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      padding: 6px 10px;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
      text-decoration: none;
    }
    .meeting-card button:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .meeting-card button:focus-visible,
    .meeting-card input:focus-visible,
    .meeting-card textarea:focus-visible,
    .meeting-download:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .meeting-tabs {
      padding: 0 16px;
      border-bottom: 1px solid var(--line);
    }
    .meeting-tabs button {
      border: 0;
      border-radius: 0;
      border-bottom: 2px solid transparent;
      padding: 10px 2px;
      margin-right: 12px;
    }
    .meeting-tabs button[aria-selected="true"] {
      border-bottom-color: var(--accent);
      color: var(--accent);
    }
    .meeting-panel {
      padding: 16px;
    }
    .meeting-panel textarea {
      display: block;
      box-sizing: border-box;
      width: 100%;
      min-height: 180px;
      resize: vertical;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      line-height: 1.6;
      padding: 8px 0;
    }
    .meeting-actions span {
      overflow-wrap: anywhere;
      min-width: 0;
    }
    .meeting-muted {
      color: var(--text-soft);
      font-size: 13px;
    }
    .meeting-error {
      color: var(--danger, #b42318);
      padding: 0 16px 12px;
      font-size: 13px;
    }
    .meeting-audio {
      display: block;
      width: 100%;
      margin: 12px 0;
    }
    .meeting-summary {
      padding: 24px 0;
      text-align: center;
    }
    .meeting-summary strong {
      display: block;
      margin-bottom: 8px;
    }
    .meeting-notes-editor {
      min-height: 1lh;
      outline: none;
      cursor: text;
    }
    .meeting-notes-editor > affine-note {
      display: flow-root;
    }
  `;
  override connectedCallback() {
    super.connectedCallback();
    if (!this.store.readonly)
      this.store.transact(() =>
        migrateMeetingNotes(this.store.doc.yBlocks, this.model.id),
      );
    this.tab =
      (this.closest<HTMLElement>("[data-meeting-tab]")?.dataset
        .meetingTab as MeetingTab) ?? "notes";
    this.unsubscribe = meetingRecorder.subscribe(() => this.requestUpdate());
  }
  override disconnectedCallback() {
    this.unsubscribe?.();
    this.loadGeneration++;
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audioUrl = "";
    this.audioSignature = "";
    super.disconnectedCallback();
  }
  private get sessionId() {
    return `${this.store.workspace.id}:${this.store.id}:${this.model.id}`;
  }
  private get active() {
    return meetingRecorder.getSnapshot()?.id === this.sessionId;
  }
  private get props() {
    return this.model.props;
  }
  private updateMeeting(patch: Partial<MeetingProps>) {
    if (this.store.readonly) return;
    this.store.updateBlock(this.model, patch);
  }
  private discrete(patch: Partial<MeetingProps>) {
    this.store.captureSync();
    this.updateMeeting(patch);
    this.store.captureSync();
  }
  onInsert() {
    this.querySelector<HTMLInputElement>(".meeting-title")?.focus();
  }
  private async run(action: () => Promise<void>) {
    this.error = "";
    this.working = true;
    try {
      await trackMeetingTask(action);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.working = false;
    }
  }
  private record = () =>
    this.run(async () => {
      const store = this.store;
      const modelId = this.model.id;
      const sessionId = this.sessionId;
      // Keep the store and ID alive across navigation; undo can recreate the model.
      const current = () => {
        const model = store.getModelById<BlockModel<MeetingProps>>(modelId);
        if (!model)
          throw new Error(
            "The meeting block was removed. Undo its removal, then retry saving.",
          );
        if (store.readonly)
          throw new Error(
            "The meeting is read-only. Finish the recording before changing vault data.",
          );
        return model;
      };
      const edit = (patch: Partial<MeetingProps>) => {
        store.withoutTransact(() => store.updateBlock(current(), patch));
      };
      store.captureSync();
      await meetingRecorder.start({
        id: sessionId,
        title: current().props.title,
        begin: (mimeType, name) =>
          edit({
            recording: {
              name,
              mimeType,
              durationSeconds: 0,
              startedAt: new Date().toISOString(),
              state: "capturing",
            },
            references: { ...current().props.references, assets: {} },
          }),
        append: async (blob, seconds) => {
          const key = await store.blobSync.set(blob);
          const props = current().props;
          const assets = { ...props.references.assets };
          assets[
            `audio-${String(recordingKeys(props).length).padStart(8, "0")}`
          ] = key;
          edit({
            references: { ...props.references, assets },
            recording: { ...props.recording!, durationSeconds: seconds },
          });
        },
        finish: (seconds) => {
          edit({
            recording: {
              ...current().props.recording!,
              state: "ready",
              durationSeconds: seconds,
            },
          });
          store.captureSync();
        },
      });
    });
  private importAudio = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    void this.run(async () => {
      if (!file.size)
        throw new Error("Choose an audio file that is not empty.");
      if (
        !file.type.startsWith("audio/") &&
        !/\.(mp3|wav|m4a|ogg|webm|aac|flac)$/i.test(file.name)
      )
        throw new Error("Choose a supported audio file.");
      if (this.store.readonly || this.props.recording || this.active) return;
      const assets: Record<string, string> = {};
      let index = 0;
      await writeAudio(file, this.store.blobSync, (key) => {
        assets[`audio-${String(index++).padStart(8, "0")}`] = key;
      });
      if (this.store.readonly || !this.store.getBlock(this.model.id))
        throw new Error(
          "The meeting was removed before the import finished. Import the file again after restoring the block.",
        );
      this.discrete({
        references: { ...this.props.references, assets },
        recording: {
          name: file.name,
          mimeType: importedAudioMimeType(file.name, file.type),
          durationSeconds: 0,
          startedAt: new Date().toISOString(),
          state: "ready",
        },
      });
    });
  };
  private importTranscript = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    void this.run(async () => {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Choose a transcript smaller than 5 MB.");
      this.discrete({ transcript: await file.text() });
    });
  };
  private async loadAudio() {
    const generation = ++this.loadGeneration;
    try {
      const blob = await readAudio(
        recordingKeys(this.props),
        this.props.recording!.mimeType,
        this.store.blobSync,
      );
      if (generation !== this.loadGeneration || !this.isConnected) return;
      if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = URL.createObjectURL(blob);
    } catch (error) {
      if (generation === this.loadGeneration) {
        this.error = String(error);
      }
    }
  }
  override updated() {
    const keys = recordingKeys(this.props);
    const signature = JSON.stringify([keys, this.props.recording?.mimeType]);
    if (!keys.length || this.active) {
      if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = "";
      this.audioSignature = "";
      this.loadGeneration++;
      return;
    }
    if (signature !== this.audioSignature && this.tab === "transcript") {
      this.audioSignature = signature;
      void this.loadAudio();
    }
  }
  private focusControl = () => {
    this.store.captureSync();
  };
  private isolateControl = (event: Event) => {
    if (
      event.target instanceof Node &&
      this.querySelector(".meeting-notes-editor")?.contains(event.target)
    )
      return;
    event.stopPropagation();
  };
  override renderBlock() {
    const readonly = this.store.readonly;
    const snapshot = meetingRecorder.getSnapshot();
    const recording = this.props.recording;
    const locked = readonly || this.working || this.active;
    const microphoneAvailable = Boolean(navigator.mediaDevices?.getUserMedia);
    return html`<section
      class="meeting-card"
      contenteditable="false"
      aria-label="Meeting"
      @beforeinput=${this.isolateControl}
      @compositionstart=${this.isolateControl}
      @compositionend=${this.isolateControl}
      @copy=${this.isolateControl}
      @cut=${this.isolateControl}
      @paste=${this.isolateControl}
      @keydown=${(event: KeyboardEvent) => {
        if (
          event.target instanceof Node &&
          this.querySelector(".meeting-notes-editor")?.contains(event.target)
        )
          return;
        event.stopPropagation();
        if (
          (event.ctrlKey || event.metaKey) &&
          ["z", "y"].includes(event.key.toLowerCase()) &&
          !readonly
        ) {
          event.preventDefault();
          this.store.captureSync();
          if (event.shiftKey || event.key.toLowerCase() === "y")
            this.store.redo();
          else this.store.undo();
        }
      }}
    >
      <header class="meeting-header" data-range-sync-exclude="true">
        <span aria-hidden="true">◉</span>
        <input
          class="meeting-title"
          aria-label="Meeting title"
          .value=${live(this.props.title)}
          ?readonly=${readonly}
          @focus=${this.focusControl}
          @blur=${() => this.store.captureSync()}
          @input=${(event: Event) =>
            this.updateMeeting({
              title: (event.target as HTMLInputElement).value,
            })}
        />
        <label class="meeting-date-field">
          <strong>Date:</strong>
          <input
            class="meeting-date"
            type="date"
            aria-label="Meeting date"
            .value=${live(this.props.date)}
            ?readonly=${readonly}
            @change=${(event: Event) => {
              const date = (event.target as HTMLInputElement).value;
              if (date === "" || isCalendarDate(date)) this.discrete({ date });
              else
                this.error =
                  "Choose a valid meeting date between years 0001 and 9999.";
            }}
          />
        </label>
      </header>

      <div
        class="meeting-tabs"
        role="tablist"
        aria-label="Meeting sections"
        data-range-sync-exclude="true"
      >
        ${(["notes", "transcript", "summary"] as MeetingTab[]).map(
          (tab) =>
            html`<button
              id=${`${this.model.id}-${tab}`}
              role="tab"
              aria-controls=${`${this.model.id}-panel`}
              aria-selected=${this.tab === tab}
              tabindex=${this.tab === tab ? 0 : -1}
              @click=${() => {
                this.tab = tab;
              }}
              @keydown=${(event: KeyboardEvent) => {
                const tabs: MeetingTab[] = ["notes", "transcript", "summary"];
                if (
                  ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
                ) {
                  event.preventDefault();
                  this.tab =
                    event.key === "Home"
                      ? "notes"
                      : event.key === "End"
                        ? "summary"
                        : tabs[
                            (tabs.indexOf(tab) +
                              (event.key === "ArrowRight" ? 1 : 2)) %
                              3
                          ];
                  void this.updateComplete.then(() =>
                    this.querySelector<HTMLButtonElement>(
                      `[aria-selected="true"]`,
                    )?.focus(),
                  );
                }
              }}
            >
              ${tab === "notes"
                ? "Notes"
                : tab === "transcript"
                  ? "Transcript & recording"
                  : "Summary"}
            </button>`,
        )}
      </div>
      <div
        class="meeting-panel"
        data-range-sync-exclude=${this.tab === "notes" ? "false" : "true"}
        id=${`${this.model.id}-panel`}
        role="tabpanel"
        aria-labelledby=${`${this.model.id}-${this.tab}`}
      >
        ${this.tab === "summary"
          ? html`<div class="meeting-summary">
              <strong>Summary</strong
              ><span class="meeting-muted"
                >AI summaries aren’t available yet.</span
              >${this.props.summary
                ? html`<p>${this.props.summary}</p>`
                : nothing}
            </div>`
          : this.tab === "notes"
            ? html`
                <div
                  class="meeting-notes-editor"
                  contenteditable=${readonly ? "false" : "true"}
                  aria-label="Meeting notes"
                  role="group"
                >
                  ${this.renderChildren(this.model)}
                </div>
              `
            : html`
                <div class="meeting-actions" data-range-sync-exclude="true">
                  ${!readonly && !recording
                    ? html`<button
                          ?disabled=${locked ||
                          !!snapshot ||
                          !microphoneAvailable}
                          @click=${this.record}
                        >
                          Record microphone</button
                        ><button
                          ?disabled=${locked}
                          @click=${() =>
                            this.querySelector<HTMLInputElement>(
                              ".meeting-audio-file",
                            )?.click()}
                        >
                          Import audio
                        </button>`
                    : nothing}
                  ${this.active
                    ? html`<span role="status" class="meeting-muted"
                          >${snapshot!.phase === "recording"
                            ? `Recording · ${Math.floor(snapshot!.seconds / 60)}:${String(Math.floor(snapshot!.seconds % 60)).padStart(2, "0")}`
                            : snapshot!.phase === "requesting"
                              ? "Requesting microphone…"
                              : snapshot!.phase === "error"
                                ? "Recording needs attention"
                                : "Saving recording…"}</span
                        >${snapshot!.phase === "recording"
                          ? html`<button
                              @click=${() =>
                                this.run(() => meetingRecorder.stop())}
                            >
                              Stop recording
                            </button>`
                          : nothing}`
                    : recording
                      ? html`<span class="meeting-muted"
                          >${recording.name} ·
                          ${recording.state === "capturing"
                            ? "Interrupted — saved audio available"
                            : "Audio saved"}</span
                        >`
                      : html`<span class="meeting-muted"
                          >${microphoneAvailable
                            ? "Microphone only"
                            : "Microphone recording requires HTTPS or localhost. You can import audio here."}</span
                        >`}
                  ${this.working
                    ? html`<span role="status" class="meeting-muted"
                        >Working…</span
                      >`
                    : nothing}
                  <input
                    hidden
                    class="meeting-audio-file"
                    type="file"
                    accept="audio/*,.m4a,.webm,.flac"
                    ?disabled=${locked}
                    @change=${this.importAudio}
                  />
                </div>
                ${recordingKeys(this.props).length && !this.active
                  ? html`${this.audioUrl
                      ? html`<audio
                            class="meeting-audio"
                            aria-label="Meeting recording"
                            controls
                            preload="metadata"
                            src=${this.audioUrl}
                            @loadedmetadata=${(event: Event) => {
                              const audio = event.target as HTMLAudioElement;
                              // Chromium records live WebM without a duration. A seek to
                              // the end lets its demuxer discover the duration, then resets
                              // the player so normal controls and seeking work immediately.
                              if (audio.duration === Infinity) {
                                audio.addEventListener(
                                  "seeked",
                                  () => {
                                    audio.currentTime = 0;
                                  },
                                  { once: true },
                                );
                                audio.currentTime = Number.MAX_SAFE_INTEGER;
                              }
                            }}
                            @durationchange=${(event: Event) => {
                              const duration = (
                                event.target as HTMLAudioElement
                              ).duration;
                              if (
                                !readonly &&
                                recording &&
                                !recording.durationSeconds &&
                                Number.isFinite(duration) &&
                                duration > 0
                              ) {
                                this.store.withoutTransact(() =>
                                  this.updateMeeting({
                                    recording: {
                                      ...recording,
                                      durationSeconds: duration,
                                    },
                                  }),
                                );
                              }
                            }}
                            @error=${() => {
                              this.error =
                                "This audio format cannot be played here. Download the recording to play it in another app.";
                            }}
                          ></audio
                          ><a
                            class="meeting-download"
                            href=${this.audioUrl}
                            download=${recording?.name ?? "meeting.webm"}
                            >Download audio</a
                          >`
                      : html`<button
                          @click=${() => {
                            this.audioSignature = "";
                            this.requestUpdate();
                          }}
                        >
                          Load recording
                        </button>`}`
                  : nothing}
                ${recording && !locked
                  ? html`<button
                        @click=${() =>
                          this.discrete({
                            recording: null,
                            references: {
                              ...this.props.references,
                              assets: {},
                            },
                          })}
                      >
                        Remove audio</button
                      >${recording.state === "capturing"
                        ? html`<button
                            @click=${() =>
                              this.discrete({
                                recording: { ...recording, state: "ready" },
                              })}
                          >
                            Keep recovered audio
                          </button>`
                        : nothing}`
                  : nothing}
                <p class="meeting-muted">
                  Paste or import a transcript. Automatic transcription will be
                  added later.
                </p>
                ${!readonly
                  ? html`<button
                        ?disabled=${this.working}
                        @click=${() =>
                          this.querySelector<HTMLInputElement>(
                            ".meeting-transcript-file",
                          )?.click()}
                      >
                        Import transcript</button
                      ><input
                        class="meeting-transcript-file"
                        hidden
                        type="file"
                        accept=".txt,.md,.vtt,.srt,text/plain"
                        @change=${this.importTranscript}
                      />`
                  : nothing}
                <textarea
                  aria-label="Meeting transcript"
                  placeholder="Paste your transcript here…"
                  .value=${live(this.props.transcript)}
                  ?readonly=${readonly}
                  @focus=${this.focusControl}
                  @blur=${() => this.store.captureSync()}
                  @input=${(event: Event) =>
                    this.updateMeeting({
                      transcript: (event.target as HTMLTextAreaElement).value,
                    })}
                ></textarea>
              `}
      </div>
      ${this.error
        ? html`<div class="meeting-error" role="alert">${this.error}</div>`
        : nothing}
    </section>`;
  }
}
export const component = MeetingBlock;

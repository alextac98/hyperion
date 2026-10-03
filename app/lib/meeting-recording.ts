import { meetingMicrophone } from "./meeting-preferences";
import { AUDIO_CHUNK_BYTES, audioExtension } from "./meeting-audio";

export type RecordingSink = {
  id: string;
  title: string;
  begin: (mimeType: string, name: string) => void;
  append: (blob: Blob, seconds: number) => Promise<void>;
  finish: (seconds: number) => void;
};
type Snapshot = {
  id: string;
  title: string;
  phase: "requesting" | "recording" | "saving" | "error";
  seconds: number;
  error: string;
} | null;
class MeetingRecorder {
  private snapshot: Snapshot = null;
  private listeners = new Set<() => void>();
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private sink?: RecordingSink;
  private pending: { blob: Blob; seconds: number }[] = [];
  private writing: Promise<void> = Promise.resolve();
  private starting?: Promise<void>;
  private stopping?: Promise<void>;
  private stopped?: Promise<void>;
  private startedAt = 0;
  private recordedSeconds = 0;
  private timer?: ReturnType<typeof setInterval>;
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit(patch?: Partial<NonNullable<Snapshot>>) {
    if (patch && this.snapshot) this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private seconds() {
    return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
  }
  async start(sink: RecordingSink) {
    if (this.snapshot)
      throw new Error("Finish the active meeting recording first.");
    this.snapshot = {
      id: sink.id,
      title: sink.title,
      phase: "requesting",
      seconds: 0,
      error: "",
    };
    this.emit();
    this.starting = this.open(sink);
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }
  private async open(sink: RecordingSink) {
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error(
          "Microphone recording is unavailable in this environment. You can import an audio file instead.",
        );
      const deviceId = meetingMicrophone();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      this.recorder = new MediaRecorder(
        this.stream,
        mimeType
          ? { mimeType, audioBitsPerSecond: 64000 }
          : { audioBitsPerSecond: 64000 },
      );
      this.sink = sink;
      sink.begin(
        this.recorder.mimeType,
        `Meeting-${new Date().toISOString().replace(/[:.]/g, "-")}.${audioExtension(this.recorder.mimeType)}`,
      );
      this.pending = [];
      this.startedAt = Date.now();
      this.recordedSeconds = 0;
      this.stopped = new Promise((resolve) =>
        this.recorder!.addEventListener(
          "stop",
          () => {
            this.recordedSeconds = this.seconds();
            clearInterval(this.timer);
            this.stream?.getTracks().forEach((track) => track.stop());
            resolve();
          },
          { once: true },
        ),
      );
      this.recorder.addEventListener("dataavailable", (event) => {
        if (!event.data.size) return;
        for (
          let offset = 0;
          offset < event.data.size;
          offset += AUDIO_CHUNK_BYTES
        ) {
          this.pending.push({
            blob: event.data.slice(
              offset,
              offset + AUDIO_CHUNK_BYTES,
              event.data.type,
            ),
            seconds: this.seconds(),
          });
        }
        this.drain();
      });
      this.recorder.addEventListener("error", () => {
        this.fail(
          new Error(
            "Recording was interrupted. Save the captured audio using Retry save.",
          ),
        );
      });
      this.stream.getAudioTracks().forEach((track) =>
        track.addEventListener("ended", () => {
          void this.stop().catch(() => {});
        }),
      );
      this.recorder.start(5000);
      this.timer = setInterval(
        () => this.emit({ seconds: this.seconds() }),
        1000,
      );
      this.emit({ phase: "recording" });
    } catch (error) {
      this.stream?.getTracks().forEach((track) => track.stop());
      this.snapshot = null;
      this.sink = undefined;
      this.emit();
      throw error;
    }
  }
  private fail(error: unknown) {
    this.emit({
      phase: "error",
      error: `${error instanceof Error ? error.message : String(error)} Captured audio is retained in this session; retry saving before closing.`,
    });
    if (this.recorder?.state !== "inactive") this.recorder?.stop();
  }
  private drain() {
    this.writing = this.writing.then(async () => {
      if (this.snapshot?.phase === "error") return;
      while (this.pending.length) {
        const part = this.pending[0];
        try {
          await this.sink!.append(part.blob, part.seconds);
          this.pending.shift();
        } catch (error) {
          this.fail(error);
          return;
        }
      }
    });
  }
  flush = async () => {
    await this.writing;
    if (this.snapshot?.phase === "error") throw new Error(this.snapshot.error);
  };
  stop = async () => {
    if (!this.snapshot) return;
    if (this.stopping) return this.stopping;
    this.stopping = this.finish();
    try {
      await this.stopping;
    } finally {
      this.stopping = undefined;
    }
  };
  private async finish() {
    await this.starting;
    if (!this.snapshot) return;
    if (this.snapshot.phase === "error") throw new Error(this.snapshot.error);
    this.emit({ phase: "saving", seconds: this.seconds() });
    if (this.recorder?.state !== "inactive") this.recorder?.stop();
    await this.stopped;
    await this.flush();
    try {
      this.sink!.finish(this.recordedSeconds);
    } catch (error) {
      this.fail(error);
      throw error;
    }
    this.snapshot = null;
    this.sink = undefined;
    this.recorder = undefined;
    this.stream = undefined;
    this.emit();
  }
  retry = async () => {
    if (this.snapshot?.phase !== "error") return;
    await this.stopped;
    this.emit({ phase: "saving", error: "" });
    this.drain();
    await this.stop();
  };
}
export const meetingRecorder = new MeetingRecorder();

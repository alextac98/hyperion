/** Quiet time after the last edit before a page's automatic version is saved. */
export const HISTORY_PAUSE_MS = 2 * 60_000;
export const DEFAULT_HISTORY_CHECKPOINT_MINUTES = 60;

type Timer = ReturnType<typeof setTimeout>;
export type SchedulerClock = {
  setTimeout(callback: () => void, delay: number): Timer;
  clearTimeout(timer: Timer): void;
};
type Pending = { pause: Timer; checkpoint?: Timer };
export type RevisionSchedulerOptions = {
  capture(vaultId: string, noteIds: string[]): void;
  /** Minutes of uninterrupted editing between checkpoints, or null when disabled. */
  checkpointMinutes(vaultId: string): number | null;
  pauseMs?: number;
  clock?: SchedulerClock;
  onError?(error: unknown): void;
};

const systemClock: SchedulerClock = {
  setTimeout: (callback, delay) => {
    const timer = setTimeout(callback, delay);
    // Pending history must never keep a process alive; close() settles it.
    timer.unref?.();
    return timer;
  },
  clearTimeout: (timer) => clearTimeout(timer),
};

/**
 * Groups edits into automatic versions. A page is captured once its edits
 * pause, and during long uninterrupted writing at most once per checkpoint.
 */
export class RevisionScheduler {
  private readonly pending = new Map<string, Map<string, Pending>>();
  private readonly pauseMs: number;
  private readonly clock: SchedulerClock;

  constructor(private readonly options: RevisionSchedulerOptions) {
    this.pauseMs = options.pauseMs ?? HISTORY_PAUSE_MS;
    this.clock = options.clock ?? systemClock;
  }

  edited(vaultId: string, noteId: string) {
    let notes = this.pending.get(vaultId);
    if (!notes) this.pending.set(vaultId, (notes = new Map()));
    const current = notes.get(noteId);
    if (current) this.clock.clearTimeout(current.pause);
    const pause = this.clock.setTimeout(() => this.settle(vaultId, [noteId]), this.pauseMs);
    if (current) {
      current.pause = pause;
      return;
    }
    const entry: Pending = { pause };
    const minutes = this.readCheckpointMinutes(vaultId);
    if (minutes !== null)
      entry.checkpoint = this.clock.setTimeout(() => this.settle(vaultId, [noteId]), minutes * 60_000);
    notes.set(noteId, entry);
  }

  isPending(vaultId: string, noteId?: string) {
    const notes = this.pending.get(vaultId);
    return noteId === undefined ? !!notes?.size : !!notes?.has(noteId);
  }

  /** Capture pending pages now. Without note IDs, every pending page in the vault is captured. */
  settle(vaultId: string, noteIds?: string[]) {
    const ids = this.forget(vaultId, noteIds);
    if (!ids.length) return;
    try {
      this.options.capture(vaultId, ids);
    } catch (error) {
      (this.options.onError ?? console.error)(error);
    }
  }

  /** Drop pending pages without capturing them. Returns the IDs that were pending. */
  forget(vaultId: string, noteIds?: string[]) {
    const notes = this.pending.get(vaultId);
    if (!notes) return [];
    const ids = (noteIds ?? [...notes.keys()]).filter((noteId) => notes.has(noteId));
    for (const noteId of ids) {
      const entry = notes.get(noteId)!;
      this.clock.clearTimeout(entry.pause);
      if (entry.checkpoint) this.clock.clearTimeout(entry.checkpoint);
      notes.delete(noteId);
    }
    if (!notes.size) this.pending.delete(vaultId);
    return ids;
  }

  forgetNote(noteId: string) {
    for (const vaultId of [...this.pending.keys()]) this.forget(vaultId, [noteId]);
  }

  private readCheckpointMinutes(vaultId: string) {
    try {
      const minutes = this.options.checkpointMinutes(vaultId);
      return minutes !== null && Number.isFinite(minutes) && minutes > 0 ? minutes : null;
    } catch (error) {
      (this.options.onError ?? console.error)(error);
      return DEFAULT_HISTORY_CHECKPOINT_MINUTES;
    }
  }
}

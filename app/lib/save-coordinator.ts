export type SaveState = "saved" | "saving" | "error";
type Job = { run: () => Promise<unknown>; timer?: ReturnType<typeof setTimeout> };

// Keep failed jobs available for explicit retry. A newer edit replaces an older queued value.
export class SaveCoordinator {
  private jobs = new Map<string, Job>();
  private running = new Map<string, Promise<void>>();
  private listeners = new Set<() => void>();
  private failure = "";
  private external = 0;
  private activeExternal = new Set<Promise<unknown>>();
  private failedExternal = new Set<() => Promise<unknown>>();
  getState = (): SaveState => this.failure ? "error" : this.jobs.size || this.running.size || this.external ? "saving" : "saved";
  getError = () => this.failure;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { for (const listener of this.listeners) listener(); }
  enqueue(key: string, run: () => Promise<unknown>, delay = 300) {
    const previous = this.jobs.get(key); if (previous?.timer) clearTimeout(previous.timer);
    const job: Job = { run };
    this.jobs.set(key, job);
    job.timer = setTimeout(() => { void this.execute(key).catch(() => {}); }, delay);
    this.emit();
  }
  private async execute(key: string): Promise<void> {
    if (this.running.has(key)) { await this.running.get(key); return this.execute(key); }
    const job = this.jobs.get(key); if (!job) return;
    clearTimeout(job.timer);
    const promise = (async () => {
      try {
        await job.run();
        if (this.jobs.get(key) === job) this.jobs.delete(key);
      } catch (error) {
        this.failure = error instanceof Error ? error.message : String(error);
        throw error;
      } finally { this.running.delete(key); this.emit(); }
    })();
    this.running.set(key, promise); this.emit(); await promise;
  }
  async flush() {
    this.failure = ""; this.emit();
    await Promise.all([...this.activeExternal]);
    for (const action of [...this.failedExternal]) { await this.track(action); this.failedExternal.delete(action); }
    while (this.jobs.size || this.running.size) {
      await Promise.all([...new Set([...this.jobs.keys(), ...this.running.keys()])].map(key => this.execute(key)));
    }
    this.emit();
  }
  async track<T>(action: () => Promise<T>): Promise<T> {
    this.external++; this.emit();
    const pending = Promise.resolve().then(action); this.activeExternal.add(pending);
    try { const result = await pending; this.failedExternal.delete(action); return result; }
    catch (error) { this.failedExternal.add(action); this.failure = error instanceof Error ? error.message : String(error); throw error; }
    finally { this.activeExternal.delete(pending); this.external--; this.emit(); }
  }
}
export const saves = new SaveCoordinator();

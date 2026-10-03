import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const result = await build({
  stdin: {
    contents: `export * from './app/lib/meeting-audio.ts'; export * from './app/lib/meeting-recording.ts'; export * from './app/lib/meeting-tasks.ts'; export { normalizeVaultPreferences } from './app/lib/local-database.ts';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const {
  AUDIO_CHUNK_BYTES,
  writeAudio,
  readAudio,
  meetingRecorder,
  trackMeetingTask,
  flushMeetingTasks,
  normalizeVaultPreferences,
} = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

test("large audio uses bounded transfers and rejoins byte-for-byte; missing chunks fail explicitly", async () => {
  const source = new Blob(
    [new Uint8Array(AUDIO_CHUNK_BYTES * 2 + 23).map((_, index) => index % 251)],
    { type: "audio/webm" },
  );
  const data = new Map();
  const keys = [];
  const storage = {
    async set(blob) {
      assert.ok(blob.size <= AUDIO_CHUNK_BYTES);
      const key = `chunk-${data.size}`;
      data.set(key, blob);
      return key;
    },
    async get(key) {
      return data.get(key) ?? null;
    },
  };
  await writeAudio(source, storage, (key) => keys.push(key));
  assert.equal(keys.length, 3);
  assert.deepEqual(
    await (await readAudio(keys, source.type, storage)).arrayBuffer(),
    await source.arrayBuffer(),
  );
  data.delete(keys[1]);
  await assert.rejects(readAudio(keys, source.type, storage), /missing/);
});

class FakeRecorder extends EventTarget {
  static instances = [];
  static isTypeSupported() {
    return true;
  }
  state = "inactive";
  mimeType = "audio/webm";
  constructor() {
    super();
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  data(text) {
    const event = new Event("dataavailable");
    event.data = new Blob([text], { type: this.mimeType });
    this.dispatchEvent(event);
  }
  stop() {
    if (this.state === "inactive") throw new Error("already stopped");
    this.state = "inactive";
    this.data("tail");
    queueMicrotask(() => this.dispatchEvent(new Event("stop")));
  }
}
function installRecordingEnvironment({ deny = false } = {}) {
  globalThis.window = {};
  globalThis.localStorage = { getItem: () => null };
  let stopped = 0;
  const track = new EventTarget();
  track.stop = () => {
    stopped++;
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia() {
          if (deny) throw new Error("Microphone permission denied");
          return { getTracks: () => [track], getAudioTracks: () => [track] };
        },
      },
    },
  });
  globalThis.MediaRecorder = FakeRecorder;
  return () => stopped;
}

test("recording survives detached views, serializes chunks, and stops microphone before completion", async () => {
  const stopped = installRecordingEnvironment();
  const captured = [];
  let finished = false;
  await meetingRecorder.start({
    id: "one",
    title: "Planning",
    begin() {},
    async append(blob) {
      captured.push(await blob.text());
    },
    finish() {
      finished = true;
    },
  });
  await assert.rejects(meetingRecorder.start({ id: "two" }), /active/);
  FakeRecorder.instances.at(-1).data("first");
  await meetingRecorder.flush();
  assert.equal(meetingRecorder.getSnapshot().phase, "recording");
  await Promise.all([meetingRecorder.stop(), meetingRecorder.stop()]);
  assert.deepEqual(captured, ["first", "tail"]);
  assert.equal(stopped(), 1);
  assert.equal(finished, true);
  assert.equal(meetingRecorder.getSnapshot(), null);
});

test("failed recording save retains the failing chunk and tail for ordered retry", async () => {
  installRecordingEnvironment();
  let fail = true;
  const captured = [];
  await meetingRecorder.start({
    id: "retry",
    title: "Retry",
    begin() {},
    async append(blob) {
      if (fail) throw new Error("Disk full");
      captured.push(await blob.text());
    },
    finish() {},
  });
  FakeRecorder.instances.at(-1).data("first");
  await assert.rejects(meetingRecorder.flush(), /Disk full/);
  assert.equal(meetingRecorder.getSnapshot().phase, "error");
  await assert.rejects(meetingRecorder.stop(), /Disk full/);
  fail = false;
  await meetingRecorder.retry();
  assert.deepEqual(captured, ["first", "tail"]);
  assert.equal(meetingRecorder.getSnapshot(), null);
});

test("denied microphone permission releases the session so import and retry remain possible", async () => {
  installRecordingEnvironment({ deny: true });
  await assert.rejects(
    meetingRecorder.start({
      id: "denied",
      title: "Denied",
      begin() {},
      append() {},
      finish() {},
    }),
    /permission denied/,
  );
  assert.equal(meetingRecorder.getSnapshot(), null);
});

test("vault barriers wait for meeting imports and old preferences receive a valid default", async () => {
  let resolve;
  let finished = false;
  const task = trackMeetingTask(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const barrier = flushMeetingTasks().then(() => {
    finished = true;
  });
  await Promise.resolve();
  assert.equal(finished, false);
  resolve();
  await task;
  await barrier;
  assert.equal(finished, true);
  assert.equal(normalizeVaultPreferences("vault").meetingDefaultTab, "notes");
  assert.equal(
    normalizeVaultPreferences("vault", { meetingDefaultTab: "summary" })
      .meetingDefaultTab,
    "summary",
  );
  assert.equal(
    normalizeVaultPreferences("vault", { meetingDefaultTab: "invalid" })
      .meetingDefaultTab,
    "notes",
  );
});

test("a failed final metadata save can retry without duplicating captured audio", async () => {
  installRecordingEnvironment();
  let fail = true;
  const captured = [];
  await meetingRecorder.start({
    id: "metadata-retry",
    title: "Retry",
    begin() {},
    async append(blob) {
      captured.push(await blob.text());
    },
    finish() {
      if (fail) throw new Error("Document was removed");
    },
  });
  await assert.rejects(meetingRecorder.stop(), /Document was removed/);
  assert.equal(meetingRecorder.getSnapshot().phase, "error");
  fail = false;
  await meetingRecorder.retry();
  assert.deepEqual(captured, ["tail"]);
  assert.equal(meetingRecorder.getSnapshot(), null);
});

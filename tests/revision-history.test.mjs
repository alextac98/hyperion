import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as Y from "yjs";
import { VaultLibrary } from "../dist-electron/vault-library.js";
import { record } from "../dist-electron/data-format.js";
import {
  DEFAULT_HISTORY_CHECKPOINT_MINUTES,
  HISTORY_PAUSE_MS,
  RevisionScheduler,
} from "../dist-electron/revision-scheduler.js";

const minute = 60_000;
const time = "2026-01-01T00:00:00.000Z";

/** A deterministic clock: timers fire only when the test advances time. */
function manualClock() {
  let now = 0;
  let next = 0;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = ++next;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort(([a, left], [b, right]) => left.at - right.at || a - b)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = end;
    },
    get pending() {
      return timers.size;
    },
  };
}

function scheduler(options = {}) {
  const clock = manualClock();
  const captures = [];
  const errors = [];
  const revisions = new RevisionScheduler({
    clock,
    capture: (vaultId, noteIds) => captures.push([vaultId, ...noteIds]),
    checkpointMinutes: () => DEFAULT_HISTORY_CHECKPOINT_MINUTES,
    onError: (error) => errors.push(error),
    ...options,
  });
  return { clock, captures, errors, revisions };
}

test("defaults group a burst behind a two-minute pause and checkpoint hourly", () => {
  assert.equal(HISTORY_PAUSE_MS, 2 * minute);
  assert.equal(DEFAULT_HISTORY_CHECKPOINT_MINUTES, 60);
});

test("a burst of edits becomes one capture after the pause", () => {
  const { clock, captures, revisions } = scheduler();
  for (let index = 0; index < 20; index++) {
    revisions.edited("vault", "page");
    clock.advance(30_000);
  }
  assert.deepEqual(captures, [], "short pauses while writing do not split the version");
  assert.equal(revisions.isPending("vault", "page"), true);
  clock.advance(HISTORY_PAUSE_MS - 30_000 - 1);
  assert.deepEqual(captures, []);
  clock.advance(1);
  assert.deepEqual(captures, [["vault", "page"]]);
  assert.equal(revisions.isPending("vault"), false);
  assert.equal(clock.pending, 0, "the checkpoint timer is released after capture");
});

test("pages pause independently", () => {
  const { clock, captures, revisions } = scheduler();
  revisions.edited("vault", "first");
  clock.advance(minute);
  revisions.edited("vault", "second");
  clock.advance(minute);
  assert.deepEqual(captures, [["vault", "first"]]);
  clock.advance(minute);
  assert.deepEqual(captures, [["vault", "first"], ["vault", "second"]]);
});

test("uninterrupted writing is checkpointed at the configured interval", () => {
  const { clock, captures, revisions } = scheduler({ checkpointMinutes: () => 15 });
  for (let elapsed = 0; elapsed < 40 * minute; elapsed += 30_000) {
    revisions.edited("vault", "page");
    clock.advance(30_000);
  }
  assert.deepEqual(captures, [["vault", "page"], ["vault", "page"]], "checkpoints at 15 and 30 minutes");
  clock.advance(HISTORY_PAUSE_MS);
  assert.equal(captures.length, 3, "the final pause still captures the rest of the session");
  assert.equal(clock.pending, 0);
});

test("a disabled checkpoint keeps a long session as one version", () => {
  const { clock, captures, revisions } = scheduler({ checkpointMinutes: () => null });
  for (let elapsed = 0; elapsed < 3 * 60 * minute; elapsed += minute) {
    revisions.edited("vault", "page");
    clock.advance(minute);
  }
  assert.deepEqual(captures, []);
  clock.advance(HISTORY_PAUSE_MS);
  assert.deepEqual(captures, [["vault", "page"]]);
});

test("invalid or unreadable checkpoint settings fall back safely", () => {
  for (const value of [0, -5, Number.NaN]) {
    const { clock, captures, revisions } = scheduler({ checkpointMinutes: () => value });
    for (let elapsed = 0; elapsed < 3 * 60 * minute; elapsed += minute) {
      revisions.edited("vault", "page");
      clock.advance(minute);
    }
    assert.deepEqual(captures, [], `${value} disables checkpoints`);
  }
  const { clock, captures, errors, revisions } = scheduler({
    checkpointMinutes: () => {
      throw new Error("preferences unavailable");
    },
  });
  for (let elapsed = 0; elapsed < 61 * minute; elapsed += minute) {
    revisions.edited("vault", "page");
    clock.advance(minute);
  }
  assert.equal(captures.length, 1, "the default checkpoint still applies");
  assert.ok(errors.length >= 1, "unreadable settings are reported");
});

test("settle captures pending pages now; forget drops them without capturing", () => {
  const { clock, captures, revisions } = scheduler();
  revisions.edited("vault", "a");
  revisions.edited("vault", "b");
  revisions.edited("vault", "c");
  revisions.edited("other", "d");
  revisions.settle("vault", ["a", "missing"]);
  assert.deepEqual(captures, [["vault", "a"]], "only pending pages are captured");
  revisions.forget("vault", ["b"]);
  revisions.forgetNote("d");
  revisions.settle("vault");
  assert.deepEqual(captures, [["vault", "a"], ["vault", "c"]]);
  revisions.settle("vault");
  revisions.settle("other");
  clock.advance(2 * 60 * minute);
  assert.equal(captures.length, 2, "nothing is captured twice or after being forgotten");
  assert.equal(clock.pending, 0);
});

test("capture failures are reported without breaking later captures", () => {
  let fail = true;
  const { clock, captures, errors, revisions } = scheduler({
    capture: (vaultId, noteIds) => {
      if (fail) throw new Error("disk full");
      captures.push([vaultId, ...noteIds]);
    },
  });
  revisions.edited("vault", "page");
  clock.advance(HISTORY_PAUSE_MS);
  assert.equal(errors.length, 1);
  fail = false;
  revisions.edited("vault", "page");
  clock.advance(HISTORY_PAUSE_MS);
  assert.deepEqual(captures, [["vault", "page"]]);
});

const vault = (id) => record({ id, name: id, createdAt: time }, "vault", true);
const page = (vaultId, id, title = "A page") =>
  record({ id, vaultId, title, updatedAt: time, collectionIds: [] }, "note", true);
const execute = (library, operation, args = {}) =>
  library.repositoryExecute({ operation, ...args });
/** Each page is one Yjs document; edits append text like typing would. */
const documents = new Map();
function edit(text, documentId = "page") {
  let doc = documents.get(documentId);
  // The first update carries the page structure; later ones only the typing.
  const before = doc ? Y.encodeStateVector(doc) : undefined;
  if (!doc) {
    doc = new Y.Doc();
    const blocks = doc.getMap("blocks");
    blocks.set(
      "root",
      new Y.Map([
        ["sys:flavour", "affine:page"],
        ["prop:title", new Y.Text("Title")],
        ["sys:children", Y.Array.from(["p"])],
      ]),
    );
    blocks.set(
      "p",
      new Y.Map([
        ["sys:flavour", "affine:paragraph"],
        ["prop:text", new Y.Text("")],
      ]),
    );
    documents.set(documentId, doc);
  }
  const paragraph = doc.getMap("blocks").get("p").get("prop:text");
  paragraph.insert(paragraph.length, ` ${text}`);
  return Buffer.from(Y.encodeStateAsUpdate(doc, before)).toString("base64");
}
function push(library, documentId, text) {
  library.editorPush("vault", documentId, edit(text, documentId));
}

async function setup(context, preferences = {}) {
  const root = await mkdtemp(join(tmpdir(), "hyperion-history-test-"));
  const clock = manualClock();
  const instance = new VaultLibrary({
    defaultDirectory: join(root, "profile"),
    history: { clock },
  });
  documents.clear();
  context.after(async () => {
    instance.close();
    await rm(root, { recursive: true, force: true });
  });
  execute(instance, "createVault", {
    vault: vault("vault"),
    notes: [page("vault", "page"), page("vault", "other")],
    collections: [],
    preferences: record({ vaultId: "vault", ...preferences }, "preferences", true),
  });
  const versions = (noteId = "page") =>
    execute(instance, "listRevisions", { vaultId: "vault", noteId });
  return { root, clock, library: instance, versions };
}

test("editor pushes are grouped into one automatic version per pause", async (context) => {
  const { clock, library, versions } = await setup(context);
  const before = versions().length;
  for (let index = 0; index < 10; index++) {
    push(library, "page", `Draft ${index}`);
    clock.advance(10_000);
  }
  assert.equal(versions().length, before, "no versions while still writing");
  clock.advance(HISTORY_PAUSE_MS);
  const captured = versions();
  assert.equal(captured.length, before + 1);
  assert.equal(captured[0].reason, "automatic");
  assert.equal(captured[0].label, null);
  assert.equal(versions("other").length, 0, "untouched pages get no version");
});

test("note metadata saves count as edits, and template documents never create history", async (context) => {
  const { clock, library, versions } = await setup(context);
  execute(library, "saveNote", { note: { ...page("vault", "page", "Renamed"), updatedAt: new Date().toISOString() } });
  push(library, "template:missing", "Template body");
  assert.equal(clock.pending, 2, "only the page is scheduled (pause and checkpoint)");
  clock.advance(HISTORY_PAUSE_MS);
  assert.equal(versions()[0].note.title, "Renamed");
});

test("the vault's checkpoint preference controls long-session versions", async (context) => {
  for (const [historyCheckpointMinutes, expected] of [
    [undefined, 2],
    [30, 5],
    [null, 0],
  ]) {
    const { clock, library, versions } = await setup(
      context,
      historyCheckpointMinutes === undefined ? {} : { historyCheckpointMinutes },
    );
    for (let elapsed = 0; elapsed < 155 * minute; elapsed += minute) {
      push(library, "page", `Line ${elapsed}`);
      clock.advance(minute);
    }
    assert.equal(versions().length, expected, `checkpoint ${historyCheckpointMinutes}`);
    clock.advance(HISTORY_PAUSE_MS);
    assert.equal(versions().length, expected + 1);
  }
});

test("explicit captures of named pages cancel their pending pause", async (context) => {
  const { clock, library, versions } = await setup(context);
  push(library, "page", "Left the page");
  push(library, "other", "Still open");
  execute(library, "captureAutomaticRevisions", { vaultId: "vault", noteIds: ["page", "deleted-page"] });
  assert.equal(versions().length, 1);
  assert.equal(versions("other").length, 0, "other pages wait for their own pause");
  clock.advance(HISTORY_PAUSE_MS);
  assert.equal(versions().length, 1, "the left page is not captured again");
  assert.equal(versions("other").length, 1);
  assert.throws(
    () => execute(library, "captureAutomaticRevisions", { vaultId: "vault", noteIds: "page" }),
    /Invalid note IDs/,
  );
});

test("closing a vault or the library saves pages that have not paused yet", async (context) => {
  const { root, clock, library } = await setup(context);
  push(library, "page", "Unpaused");
  execute(library, "closeVault", { vaultId: "vault" });
  assert.equal(clock.pending, 0);
  const reopened = new VaultLibrary({ defaultDirectory: join(root, "profile") });
  try {
    reopened.openVault(join(root, "profile", "vaults", "vault"));
    assert.equal(execute(reopened, "listRevisions", { vaultId: "vault", noteId: "page" }).length, 1);
    push(reopened, "page", "Edited before quitting");
  } finally {
    reopened.close();
  }
  const again = new VaultLibrary({ defaultDirectory: join(root, "profile") });
  try {
    const latest = execute(again, "listRevisions", { vaultId: "vault", noteId: "page" });
    assert.equal(latest.length, 2, "close() captured the unpaused edit");
  } finally {
    again.close();
  }
});

test("deleting a page drops its pending version", async (context) => {
  const { clock, library, versions } = await setup(context);
  push(library, "other", "Soon deleted");
  execute(library, "deleteNote", { vaultId: "vault", id: "other" });
  assert.equal(clock.pending, 0);
  assert.equal(versions("other").filter((version) => version.reason === "automatic").length, 0);
});

test("preferences accept a 1–1440 minute checkpoint or null", () => {
  for (const historyCheckpointMinutes of [undefined, null, 1, 60, 1440])
    assert.doesNotThrow(() =>
      record({ vaultId: "vault", historyCheckpointMinutes }, "preferences", true),
    );
  for (const historyCheckpointMinutes of [0, 1441, 1.5, "60", false])
    assert.throws(
      () => record({ vaultId: "vault", historyCheckpointMinutes }, "preferences", true),
      /Invalid history checkpoint interval/,
    );
});

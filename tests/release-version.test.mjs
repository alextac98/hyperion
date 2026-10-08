import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertReleaseAvailable,
  parseVersion,
  releaseVersionForPush,
} from "../scripts/release-version.mjs";

const repo = { owner: "example", repo: "hyperion" };
const missing = () =>
  Promise.reject(Object.assign(new Error("Not found"), { status: 404 }));
function client({
  tag = missing,
  release = async () => [],
  latest = missing,
} = {}) {
  return {
    paginate: (method, args) => method(args),
    rest: {
      git: { getRef: tag },
      repos: { listReleases: release, getLatestRelease: latest },
    },
  };
}

test("only canonical stable versions can be released", () => {
  for (const version of [
    undefined,
    123,
    "v1.2.3",
    "01.2.3",
    "1.2",
    "1.2.3-beta.1",
    "1.2.3\n",
    "1.2.3; echo bad",
  ]) {
    assert.throws(() => parseVersion(version), /Expected a stable/);
  }
});

async function repository(context) {
  const directory = await mkdtemp(join(tmpdir(), "hyperion-release-trigger-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release-test@example.invalid");
  const commit = async (version, description = "fixture") => {
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ version, description }),
    );
    git("add", "package.json");
    git("commit", "--quiet", "-m", "test: change package");
    return git("rev-parse", "HEAD");
  };
  return { directory, commit };
}

test("unchanged versions skip releases even when package metadata changes", async (context) => {
  const { directory, commit } = await repository(context);
  const before = await commit("0.3.0");
  const after = await commit("0.3.0", "dependency or metadata edit");
  assert.equal(releaseVersionForPush(before, after, directory), null);
});

test("multi-commit pushes release the captured version even after HEAD moves", async (context) => {
  const { directory, commit } = await repository(context);
  const before = await commit("0.3.0");
  await commit("0.4.0");
  const after = await commit("0.4.0", "later commit in the same push");
  await commit("0.5.0", "subsequent push");
  assert.equal(releaseVersionForPush(before, after, directory), "0.4.0");
});

test("a push with no net version change skips intermediate version edits", async (context) => {
  const { directory, commit } = await repository(context);
  const before = await commit("0.3.0");
  await commit("0.4.0");
  const after = await commit("0.3.0", "version restored before push");
  assert.equal(releaseVersionForPush(before, after, directory), null);
});

test("an initial main push can release its stable committed version", async (context) => {
  const { directory, commit } = await repository(context);
  const after = await commit("0.1.0");
  assert.equal(
    releaseVersionForPush("0".repeat(40), after, directory),
    "0.1.0",
  );
});

test("invalid changed versions and unavailable push history stop detection", async (context) => {
  const { directory, commit } = await repository(context);
  const before = await commit("0.3.0");
  for (const version of ["v0.4.0", "0.4.0-beta.1", "0.4", undefined]) {
    const after = await commit(version);
    assert.throws(
      () => releaseVersionForPush(before, after, directory),
      /Expected a stable/,
    );
  }
  const after = await commit("0.4.0");
  assert.throws(() => releaseVersionForPush("f".repeat(40), after, directory));
  assert.throws(
    () => releaseVersionForPush("main", after, directory),
    /Expected a commit SHA/,
  );
  assert.throws(
    () => releaseVersionForPush(before, "HEAD", directory),
    /Expected a commit SHA/,
  );
});

test("first release is allowed and API lookups use the exact committed version", async () => {
  const github = client({
    tag: async (args) => {
      assert.deepEqual(args, { ...repo, ref: "tags/v0.1.0" });
      return missing();
    },
    release: async (args) => {
      assert.deepEqual(args, { ...repo, per_page: 100 });
      return [];
    },
  });
  assert.equal(await assertReleaseAvailable(github, repo, "0.1.0"), "v0.1.0");
});

test("existing tags and releases including drafts cannot be overwritten", async () => {
  for (const github of [
    client({ tag: async () => ({ data: {} }) }),
    client({ release: async () => [{ tag_name: "v0.1.0", draft: true }] }),
  ]) {
    await assert.rejects(
      assertReleaseAvailable(github, repo, "0.1.0"),
      /already has a tag or release/,
    );
  }
});

test("authentication and service failures stop release instead of implying absence", async () => {
  for (const status of [401, 403, 500]) {
    const failure = () =>
      Promise.reject(Object.assign(new Error("API failure"), { status }));
    for (const key of ["tag", "release", "latest"]) {
      await assert.rejects(
        assertReleaseAvailable(client({ [key]: failure }), repo, "0.1.0"),
        /API failure/,
      );
    }
  }
});

test("an older captured main commit cannot replace a newer stable release", async () => {
  const github = client({
    latest: async () => ({ data: { tag_name: "v1.9.9" } }),
  });
  for (const version of ["0.9.9", "1.8.10", "1.9.8", "1.9.9"]) {
    await assert.rejects(
      assertReleaseAvailable(github, repo, version),
      /must be newer/,
    );
  }
  assert.equal(await assertReleaseAvailable(github, repo, "1.10.0"), "v1.10.0");
  assert.equal(await assertReleaseAvailable(github, repo, "2.0.0"), "v2.0.0");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertReleaseAvailable,
  bumpVersion,
  parseVersion,
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

test("version preparation increments the selected component and resets lower components", () => {
  assert.equal(bumpVersion("0.1.0", "patch"), "0.1.1");
  assert.equal(bumpVersion("1.9.12", "minor"), "1.10.0");
  assert.equal(bumpVersion("0.9.12", "major"), "1.0.0");
  assert.throws(() => bumpVersion("1.2.3", "unknown"), /Unknown version bump/);
});

test("only canonical stable versions can be prepared or released", () => {
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

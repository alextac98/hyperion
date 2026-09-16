import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  developmentInstance,
  developmentRendererUrl,
} from "../dist-electron/development.js";

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

test("switching branches changes the instance, and switching back restores it", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "hyperion-branches-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  git(directory, "init", "--initial-branch=feature/search");
  const first = developmentInstance(directory);
  assert.equal(first.branch, "feature/search");
  git(directory, "symbolic-ref", "HEAD", "refs/heads/feature/editor");
  assert.notEqual(developmentInstance(directory).key, first.key);
  git(directory, "symbolic-ref", "HEAD", "refs/heads/feature/search");
  assert.deepEqual(developmentInstance(directory), first);
});

test("branch identity is independent of checkout path and safe as a directory name", () => {
  const first = developmentInstance("/checkout", "feature/search");
  assert.deepEqual(developmentInstance("/worktree", "feature/search"), first);
  for (const branch of [
    "feature/search",
    "feature-search",
    "Feature/search",
    "修正/検索",
    "x".repeat(250),
  ]) {
    const { key } = developmentInstance("/unused", branch);
    assert.match(key, /^[a-zA-Z0-9_-]+$/);
    assert.ok(key.length <= 61);
  }
  assert.notEqual(
    first.key,
    developmentInstance("/unused", "feature-search").key,
  );
  assert.notEqual(
    first.key.toLowerCase(),
    developmentInstance("/unused", "Feature/search").key.toLowerCase(),
  );
  assert.notEqual(
    developmentInstance("/unused", "x".repeat(250)).key,
    developmentInstance("/unused", "x".repeat(249) + "y").key,
  );
});

test("missing Git context fails clearly unless a branch is supplied", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "hyperion-no-git-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  assert.throws(() => developmentInstance(directory), /HYPERION_DEV_BRANCH/);
  assert.equal(developmentInstance(directory, "preview").branch, "preview");
});

test("renderer URL preserves the assigned port and rejects nonlocal origins", () => {
  assert.equal(
    developmentRendererUrl("http://127.0.0.1:43123/"),
    "http://127.0.0.1:43123",
  );
  for (const value of [
    undefined,
    "http://example.com:3000",
    "http://0.0.0.0:3000",
    "https://127.0.0.1:3000",
    "file:///tmp/app",
    "http://user@127.0.0.1:3000",
    "http://127.0.0.1:3000/other",
    "http://127.0.0.1:3000/?branch=other",
  ]) {
    assert.throws(() => developmentRendererUrl(value));
  }
});

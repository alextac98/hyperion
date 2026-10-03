import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  developmentInstance,
  developmentRendererUrl,
} from "../dist-electron/development.js";
import { resetDevelopmentData } from "../scripts/reset-development.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

test("branch changes keep the worktree's data and profile", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "hyperion-branches-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  git(directory, "init", "--initial-branch=feature/search");
  const first = developmentInstance(directory);
  assert.equal(first.branch, "feature/search");
  git(directory, "symbolic-ref", "HEAD", "refs/heads/feature/editor");
  const second = developmentInstance(directory);
  assert.equal(second.branch, "feature/editor");
  assert.equal(second.directory, first.directory);
  assert.equal(second.profileDirectory, first.profileDirectory);
  git(directory, "symbolic-ref", "HEAD", "refs/heads/feature/search");
  assert.deepEqual(developmentInstance(directory), first);
});

test("Git worktrees with the same branch label have separate local data", async (context) => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "hyperion-worktrees-")),
  );
  context.after(() => rm(directory, { recursive: true, force: true }));
  const checkout = join(directory, "checkout");
  const worktree = join(directory, "worktree");
  await mkdir(checkout);
  git(checkout, "init", "--initial-branch=main");
  git(
    checkout,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "Test fixture",
  );
  git(checkout, "worktree", "add", "--detach", worktree);
  const first = developmentInstance(checkout, "main");
  const second = developmentInstance(worktree, "main");
  assert.equal(first.directory, join(checkout, ".hyperion-dev"));
  assert.equal(second.directory, join(worktree, ".hyperion-dev"));
  assert.notEqual(first.profileDirectory, second.profileDirectory);
  assert.notEqual(first.desktopDirectory, second.desktopDirectory);
  assert.notEqual(first.browserDirectory, second.browserDirectory);
  assert.match(developmentInstance(worktree).branch, /^detached-/);
  const nested = join(worktree, "nested");
  await mkdir(nested);
  assert.deepEqual(developmentInstance(nested, "main"), second);
});

test(
  "symlink aliases resolve to the same development instance",
  { skip: process.platform === "win32" },
  async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "hyperion-alias-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const checkout = join(directory, "checkout");
    const alias = join(directory, "alias");
    await mkdir(checkout);
    await symlink(checkout, alias);
    assert.deepEqual(
      developmentInstance(alias, "preview"),
      developmentInstance(checkout, "preview"),
    );
  },
);

test("missing Git context fails clearly unless a branch is supplied", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "hyperion-no-git-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  assert.throws(() => developmentInstance(directory), /HYPERION_DEV_BRANCH/);
  assert.equal(developmentInstance(directory, "preview").branch, "preview");
});

test("reset clears only this worktree and leaves external vault data intact", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "hyperion-reset-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const checkout = join(directory, "checkout");
  const other = join(directory, "other");
  const external = join(directory, "external-vault");
  await mkdir(checkout);
  await mkdir(other);
  await mkdir(external);
  const instance = developmentInstance(checkout, "preview");
  const otherInstance = developmentInstance(other, "preview");
  await mkdir(instance.desktopDirectory, { recursive: true });
  await mkdir(instance.profileDirectory);
  await mkdir(instance.browserDirectory);
  await mkdir(otherInstance.directory);
  await writeFile(
    join(instance.desktopDirectory, "storage-location"),
    external,
  );
  await writeFile(join(external, "hyperion.sqlite3"), "external data");
  assert.equal(resetDevelopmentData(checkout, "preview"), instance.directory);
  await assert.rejects(access(instance.directory), { code: "ENOENT" });
  await access(otherInstance.directory);
  await access(join(external, "hyperion.sqlite3"));
  assert.equal(resetDevelopmentData(checkout, "preview"), instance.directory);
});

test("reset refuses live desktop and browser instances, but accepts stale owners", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "hyperion-reset-owner-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const instance = developmentInstance(directory, "preview");
  const stalePid = Number(
    execFileSync(
      process.execPath,
      ["-e", "process.stdout.write(String(process.pid))"],
      { encoding: "utf8" },
    ),
  );
  for (const path of [
    join(instance.profileDirectory, ".development-process.json"),
    join(instance.browserDirectory, ".browser-development.lock"),
    join(instance.directory, "custom-browser", ".browser-development.lock"),
  ]) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ pid: process.pid }));
    assert.throws(
      () => resetDevelopmentData(directory, "preview"),
      /Stop the development instance/,
    );
    await access(path);
    await writeFile(path, JSON.stringify({ pid: stalePid }));
    resetDevelopmentData(directory, "preview");
    await assert.rejects(access(instance.directory), { code: "ENOENT" });
  }
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

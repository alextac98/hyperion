import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { developmentInstance } from "../dist-electron/development.js";

export function resetDevelopmentData(cwd, branchOverride) {
  const instance = developmentInstance(cwd, branchOverride);
  let entries;
  try {
    entries = readdirSync(instance.directory, {
      recursive: true,
      withFileTypes: true,
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    entries = [];
  }
  // Include data-directory overrides inside the worktree's development folder.
  // Directory symlinks are not traversed, and removal never follows external vaults.
  for (const entry of entries) {
    if (
      entry.name !== ".development-process.json" &&
      entry.name !== ".browser-development.lock"
    )
      continue;
    const path = join(entry.parentPath, entry.name);
    let owner;
    try {
      owner = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw new Error(`Cannot read development process owner: ${path}`, {
        cause: error,
      });
    }
    if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0)
      throw new Error(`Invalid development process owner: ${path}`);
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") continue;
      throw error;
    }
    throw new Error(
      `Stop the development instance (PID ${owner.pid}) before resetting ${instance.directory}.`,
    );
  }
  // Never follow the vault registry or data-directory overrides to delete data.
  rmSync(instance.directory, { recursive: true, force: true });
  return instance.directory;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const directory = resetDevelopmentData(
      process.cwd(),
      process.env.HYPERION_DEV_BRANCH,
    );
    console.log(`Reset development data: ${directory}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

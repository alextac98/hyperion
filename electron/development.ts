import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";

/** Resolve once at launch; the worktree owns its data regardless of branch name. */
export function developmentInstance(cwd: string, branchOverride?: string) {
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  let root = cwd;
  try {
    root = git("rev-parse", "--show-toplevel");
  } catch {
    // Explicit branch labels also support standalone development fixtures.
  }
  root = realpathSync(root);
  let branch = branchOverride?.trim();
  if (!branch) {
    try {
      branch =
        git("branch", "--show-current") ||
        `detached-${git("rev-parse", "HEAD")}`;
    } catch {
      throw new Error(
        "Cannot determine the Git branch. Run inside a checkout or set HYPERION_DEV_BRANCH.",
      );
    }
  }
  const directory = join(root, ".hyperion-dev");
  return {
    branch,
    root,
    directory,
    profileDirectory: join(directory, "profile"),
    desktopDirectory: join(directory, "desktop"),
    browserDirectory: join(directory, "browser"),
  };
}

/** The renderer and IPC allowlist must use the same local development origin. */
export function developmentRendererUrl(value?: string) {
  if (!value)
    throw new Error(
      "Missing development renderer URL. Start the app with pnpm dev.",
    );
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "The development renderer URL must be an HTTP origin on 127.0.0.1.",
    );
  }
  return url.origin;
}

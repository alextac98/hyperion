import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

/** Resolve once at launch, so switching branches cannot retarget a running app. */
export function developmentInstance(cwd: string, branchOverride?: string) {
  let branch = branchOverride?.trim();
  if (!branch) {
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
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
  const slug = branch.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 48) || "branch";
  const hash = createHash("sha256").update(branch).digest("hex").slice(0, 12);
  return { branch, key: `${slug}-${hash}` };
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

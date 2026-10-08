import { execFileSync } from "node:child_process";

export function parseVersion(version) {
  if (
    typeof version !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
  ) {
    throw new Error(
      `Expected a stable major.minor.patch version, got ${version}`,
    );
  }
  return version.split(".").map(BigInt);
}

// Compare the push's complete range, including multi-commit and merge pushes.
// Read committed manifests so a later checkout or push cannot change the candidate.
export function releaseVersionForPush(
  before,
  after,
  directory = process.cwd(),
) {
  for (const sha of [before, after]) {
    if (typeof sha !== "string" || !/^[a-f0-9]{40}$/i.test(sha))
      throw new Error(`Expected a commit SHA, got ${sha}`);
  }
  const versionAt = (sha) =>
    JSON.parse(
      execFileSync("git", ["show", `${sha}:package.json`], {
        cwd: directory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ).version;
  const version = versionAt(after);
  // GitHub uses an all-zero before SHA when a branch is first created.
  if (before !== "0".repeat(40) && versionAt(before) === version) return null;
  parseVersion(version);
  return version;
}

// Only a missing resource is acceptable; authentication and service failures
// must stop publication rather than being mistaken for an unused version.
export async function assertReleaseAvailable(github, repo, version) {
  const parts = parseVersion(version);
  const tag = `v${version}`;
  let existingTag = false;
  try {
    await github.rest.git.getRef({ ...repo, ref: `tags/${tag}` });
    existingTag = true;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  // Listing releases includes drafts, which may not have a Git tag yet.
  const releases = await github.paginate(github.rest.repos.listReleases, {
    ...repo,
    per_page: 100,
  });
  if (existingTag || releases.some((release) => release.tag_name === tag)) {
    throw new Error(
      `${tag} already has a tag or release. Prepare a new version first.`,
    );
  }
  let latest;
  try {
    latest = await github.rest.repos.getLatestRelease(repo);
  } catch (error) {
    if (error.status !== 404) throw error;
    return tag;
  }
  const previous = parseVersion(latest.data.tag_name.replace(/^v/, ""));
  const difference = parts.findIndex((part, i) => part !== previous[i]);
  if (difference === -1 || parts[difference] < previous[difference]) {
    throw new Error(`${tag} must be newer than ${latest.data.tag_name}.`);
  }
  return tag;
}

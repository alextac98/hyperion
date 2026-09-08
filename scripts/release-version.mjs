import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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

export function bumpVersion(version, bump) {
  const parts = parseVersion(version);
  const index = ["major", "minor", "patch"].indexOf(bump);
  if (index === -1) throw new Error(`Unknown version bump: ${bump}`);
  parts[index] += 1n;
  return parts.map((part, i) => (i > index ? 0n : part)).join(".");
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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const file = "package.json";
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.version = bumpVersion(pkg.version, process.argv[2]);
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(pkg.version);
}

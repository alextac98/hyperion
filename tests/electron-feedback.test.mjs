import assert from "node:assert/strict";
import test from "node:test";
import { feedbackIssueUrl } from "../dist-electron/feedback.js";

test("feedback opens only the project issue form with system information", () => {
  for (const [platform, name, systemVersion] of [
    ["darwin", "macOS", "26.0"],
    ["win32", "Windows", "10.0.26100"],
    ["linux", "Linux", "6.17.1"],
  ]) {
    const url = new URL(
      feedbackIssueUrl({
        version: "0.3.0",
        platform,
        systemVersion,
        arch: "arm64",
        // Extra context must never be forwarded, even if a caller supplies it.
        vaultName: "Private vault",
        pageTitle: "Private page",
        directory: "/home/private/vault",
      }),
    );
    assert.equal(
      url.origin + url.pathname,
      "https://github.com/alextac98/hyperion/issues/new",
    );
    assert.deepEqual([...url.searchParams.keys()], ["template", "body"]);
    assert.equal(url.searchParams.get("template"), "feedback.md");
    const body = url.searchParams.get("body");
    assert.match(body, /What happened or what would you like\?/);
    assert.match(body, /What did you expect\?/);
    assert.match(body, /Steps to reproduce \(optional\)/);
    assert.ok(body.includes(`- OS: ${name} ${systemVersion}`));
    assert.match(body, /- Hyperion: 0\.3\.0/);
    assert.match(body, /- Architecture: arm64/);
    assert.doesNotMatch(body, /Private|\/home\/private/);
    assert.ok(url.toString().length < 2081);
  }
});

test("system values are encoded and bounded for the Windows browser handoff", () => {
  const url = new URL(
    feedbackIssueUrl({
      version: "0.3.0+build&labels=bug#test\nextra",
      platform: "linux",
      systemVersion: "測".repeat(500),
      arch: "測".repeat(500),
    }),
  );
  assert.deepEqual([...url.searchParams.keys()], ["template", "body"]);
  assert.equal(url.hash, "");
  assert.match(
    url.searchParams.get("body"),
    /0\.3\.0\+build&labels=bug#test extra/,
  );
  assert.ok(url.toString().length < 2081);
});

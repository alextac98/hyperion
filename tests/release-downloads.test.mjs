import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installers, releaseDownloads } from "../scripts/release-downloads.mjs";

test("README latest buttons and release-specific buttons target the same four installers", async () => {
  const readme = await readFile(
    new URL("../README.md", import.meta.url),
    "utf8",
  );
  const notes = releaseDownloads("1.2.3", "example/hyperion");
  assert.equal(installers.length, 4);
  for (const { file, image, label } of installers) {
    assert.ok(readme.includes(`/releases/latest/download/${file}`));
    assert.ok(
      notes.includes(`/example/hyperion/releases/download/v1.2.3/${file}`),
    );
    assert.ok(
      notes.includes(
        `/example/hyperion/v1.2.3/docs/assets/download-${image}.svg`,
      ),
    );
    assert.ok(notes.includes(`Download for ${label}`));
    const svg = await readFile(
      new URL(`../docs/assets/download-${image}.svg`, import.meta.url),
      "utf8",
    );
    assert.ok(svg.includes('role="img"'));
  }
  assert.ok(!notes.includes("/releases/latest/"));
});

test("release buttons require every installer before publication", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hyperion-download-links-"));
  try {
    for (const { file } of installers)
      await writeFile(join(directory, file), "fixture");
    assert.ok(
      releaseDownloads("1.2.3", "example/hyperion", directory).includes(
        "Download Hyperion 1.2.3",
      ),
    );
    await rm(join(directory, installers[0].file));
    assert.throws(
      () => releaseDownloads("1.2.3", "example/hyperion", directory),
      /Missing release installer: Hyperion-mac-arm64.dmg/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

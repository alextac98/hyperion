import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const installers = [
  {
    label: "macOS Apple Silicon",
    image: "macos",
    file: "Hyperion-mac-arm64.dmg",
  },
  {
    label: "Linux x86_64",
    image: "linux-x64",
    file: "Hyperion-linux-x86_64.AppImage",
  },
  { label: "Windows x64", image: "windows", file: "Hyperion-windows-x64.exe" },
  {
    label: "Linux ARM64",
    image: "linux-arm64",
    file: "Hyperion-linux-arm64.AppImage",
  },
];

export function releaseDownloads(version, repository, assetsDirectory) {
  const base = `https://github.com/${repository}/releases/download/v${version}`;
  const images = `https://raw.githubusercontent.com/${repository}/v${version}/docs/assets`;
  const buttons = installers
    .map(({ label, image, file }) => {
      if (assetsDirectory && !existsSync(join(assetsDirectory, file))) {
        throw new Error(`Missing release installer: ${file}`);
      }
      return `[![Download for ${label}](${images}/download-${image}.svg)](${base}/${file})`;
    })
    .reduce((rows, button, index) => {
      if (index % 2 === 0) rows.push(button);
      else rows[rows.length - 1] += ` &nbsp; ${button}`;
      return rows;
    }, [])
    .join("\n\n");
  return (
    `## Download Hyperion ${version}\n\nChoose the installer for your computer:\n\n${buttons}\n\n` +
    "**macOS:** Apple Silicon (M1 and newer). **Windows/Linux x64:** Intel or AMD 64-bit computers. Choose **Linux ARM64** for an ARM-based Linux computer.\n\n" +
    "The remaining assets support in-app updates or download verification. Source code archives are for developers.\n"
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { version } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  console.log(
    releaseDownloads(
      version,
      process.env.GH_REPO || "alextac98/hyperion",
      process.argv[2],
    ),
  );
}

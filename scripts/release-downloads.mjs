import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const base = `https://github.com/${process.env.GH_REPO || "alextac98/hyperion"}/releases/download/v${version}`;
console.log(
  `## Download Hyperion\n\nChoose the installer for your computer:\n\n` +
    [
      [
        "macOS — Apple Silicon (M1 and newer)",
        `Hyperion-${version}-mac-arm64.dmg`,
      ],
      ["Windows — Intel/AMD 64-bit", `Hyperion-${version}-windows-x64.exe`],
      ["Linux — Intel/AMD 64-bit", `Hyperion-${version}-linux-x86_64.AppImage`],
      ["Linux — ARM64", `Hyperion-${version}-linux-arm64.AppImage`],
    ]
      .map(([label, file]) => {
        if (process.argv[2] && !existsSync(join(process.argv[2], file))) {
          throw new Error(`Missing release installer: ${file}`);
        }
        return `- [${label}](${base}/${file})`;
      })
      .join("\n") +
    "\n\nThe remaining assets support in-app updates or download verification. Source code archives are for developers.\n",
);

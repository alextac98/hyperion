import { execFileSync } from "node:child_process";
import { join } from "node:path";
import electronPath from "electron";

// Use Electron's ASAR-aware loader, with resolution rooted inside the package.
// This runs before signing/notarization so missing runtime dependencies fail early.
export default async function verifyPackage(context) {
  const resources =
    context.electronPlatformName === "darwin"
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources",
        )
      : join(context.appOutDir, "resources");
  const archive = join(resources, "app.asar");
  execFileSync(
    electronPath,
    [
      "-e",
      `
    const { createRequire } = require('node:module');
    const path = require('node:path');
    const archive = require('node:fs').realpathSync(process.argv[1]);
    const packageRequire = createRequire(path.join(archive, 'package.json'));
    const metadata = packageRequire('./package.json');
    const mainRequire = createRequire(path.join(archive, metadata.main));
    const updaterPath = mainRequire.resolve('electron-updater');
    if (!updaterPath.startsWith(archive + path.sep)) {
      throw new Error('electron-updater resolved outside the packaged app: ' + updaterPath);
    }
    mainRequire('electron-updater');
    console.log('Packaged electron-updater and its runtime dependencies loaded successfully.');
  `,
      archive,
    ],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_PATH: "" },
      stdio: "pipe",
      timeout: 30_000,
    },
  );
  console.log("Packaged runtime dependency check passed.");
}

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const root = fileURLToPath(new URL("../", import.meta.url));

// Keep the installed Electron distribution intact. macOS uses the bundle's
// identity for the Dock and app switcher, even when app.setName() is called.
export async function desktopRuntime() {
  if (process.platform !== "darwin") return electronPath;
  const source = join(dirname(electronPath), "../..");
  const icon = join(root, "build/icon.icns");
  const fingerprint = createHash("sha256")
    .update(await readFile(join(source, "Contents/Info.plist")))
    .update(await readFile(icon))
    .update(await readFile(fileURLToPath(import.meta.url)))
    .digest("hex").slice(0, 16);
  const cache = join(root, "node_modules/.cache/hyperion-runtime");
  const destination = join(cache, fingerprint);
  // Electron uses its executable basename to distinguish development from a
  // packaged app. Keep that basename; the bundle supplies the visible name.
  const executable = join(destination, "Hyperion.app/Contents/MacOS/Electron");
  if (await stat(executable).then(() => true, () => false)) return executable;

  await mkdir(cache, { recursive: true });
  const staging = await mkdtemp(join(cache, ".prepare-"));
  try {
    const bundle = join(staging, "Hyperion.app");
    await cp(source, bundle, { recursive: true, verbatimSymlinks: true });
    const plist = join(bundle, "Contents/Info.plist");
    for (const [key, value] of Object.entries({
      CFBundleName: "Hyperion",
      CFBundleDisplayName: "Hyperion",
      CFBundleIdentifier: "app.hyperion.desktop.development",
      CFBundleIconFile: "hyperion.icns",
      LSApplicationCategoryType: "public.app-category.productivity",
    })) execFileSync("/usr/bin/plutil", ["-replace", key, "-string", value, plist]);
    await writeFile(join(bundle, "Contents/Resources/hyperion.icns"), await readFile(icon));
    // Updating a signed bundle's metadata requires a fresh local signature.
    execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", bundle], { stdio: "pipe" });
    execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle], { stdio: "pipe" });
    await rename(staging, destination).catch(async error => {
      // Another launcher may have prepared the identical runtime concurrently.
      if (!(await stat(executable).then(() => true, () => false))) throw error;
    });
    return executable;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

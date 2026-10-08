import { app } from "electron";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Direct .mjs entry points use Electron's default "0.0" version, which the
// updater rejects before a smoke test can open the application.
const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
app.setVersion(manifest.version);

// The application quits when its last window closes on Linux/Windows. Keep the
// test alive for its remaining assertions and cleanup; tests call app.exit()
// explicitly with their result. Tests of the actual quit handshake opt in once
// their will-quit assertions are installed. Otherwise a failure can exit with 0.
app.on("before-quit", (event) => {
  if (process.env.HYPERION_TEST_QUIT_READY !== "1") event.preventDefault();
});

try {
  await import(
    pathToFileURL(resolve(process.argv[2] ?? "tests/electron-smoke.mjs")).href
  );
} catch (error) {
  console.error(error);
  app.exit(1);
}

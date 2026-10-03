import { createHash } from "node:crypto";
import { loadEnv } from "vite";
import { developmentInstance } from "../dist-electron/development.js";
import { browserDevelopmentPlugin } from "./browser-development.mjs";
import { startDevelopmentServer } from "./development-server.mjs";

const environment = loadEnv("development", process.cwd(), "HYPERION_");

const instance = developmentInstance(
  process.cwd(),
  environment.HYPERION_DEV_BRANCH,
);
const directory =
  environment.HYPERION_BROWSER_DATA_DIRECTORY?.trim() ||
  instance.browserDirectory;
const cacheKey = createHash("sha256")
  .update(instance.root)
  .digest("hex")
  .slice(0, 16);
const allowedOrigins = (environment.HYPERION_BROWSER_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const { server, url } = await startDevelopmentServer({
  cacheDir: `node_modules/.cache/hyperion-vite/${cacheKey}`,
  plugins: [
    browserDevelopmentPlugin({
      directory,
      branch: instance.branch,
      allowedOrigins,
    }),
  ],
  server: {
    host: environment.HYPERION_BROWSER_HOST || "0.0.0.0",
    allowedHosts: allowedOrigins.map((origin) => new URL(origin).hostname),
    strictPort: allowedOrigins.length > 0,
    cors: false,
  },
});
console.log(
  `Hyperion browser development — ${instance.branch}\nWorktree: ${instance.root}\nOpen: ${allowedOrigins.length ? allowedOrigins.join(", ") : url}\nData: ${directory}\nOne active editor per instance. Wait for “Saved to development server” before closing.`,
);
process.once("SIGINT", async () => {
  await server.close();
  process.exit();
});

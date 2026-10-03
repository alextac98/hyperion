import { developmentInstance } from "../dist-electron/development.js";
import { browserDevelopmentPlugin } from "./browser-development.mjs";
import { startDevelopmentServer } from "./development-server.mjs";

const instance = developmentInstance(
  process.cwd(),
  process.env.HYPERION_DEV_BRANCH,
);
const directory =
  process.env.HYPERION_BROWSER_DATA_DIRECTORY?.trim() ||
  instance.browserDirectory;
const { server, url } = await startDevelopmentServer({
  plugins: [browserDevelopmentPlugin({ directory, branch: instance.branch })],
  server: { cors: false },
});
console.log(
  `Hyperion browser development — ${instance.branch}\nWorktree: ${instance.root}\nOpen: ${url}\nData: ${directory}\nOne active editor per instance. Wait for “Saved to development server” before closing.`,
);
process.once("SIGINT", async () => {
  await server.close();
  process.exit();
});

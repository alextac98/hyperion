import { homedir } from "node:os";
import { join } from "node:path";
import { developmentInstance } from "../dist-electron/development.js";
import { browserDevelopmentPlugin } from "./browser-development.mjs";
import { startDevelopmentServer } from "./development-server.mjs";

const { branch, key } = developmentInstance(
  process.cwd(),
  process.env.HYPERION_DEV_BRANCH,
);
const directory =
  process.env.HYPERION_BROWSER_DATA_DIRECTORY?.trim() ||
  join(homedir(), ".config", "hyperion-browser-development", "branches", key);
const { server, url } = await startDevelopmentServer({
  plugins: [browserDevelopmentPlugin({ directory, branch })],
  server: { cors: false },
});
console.log(
  `Hyperion browser development — ${branch}\nOpen: ${url}\nData: ${directory}\nOne active editor per instance. Wait for “Saved to development server” before closing.`,
);
process.once("SIGINT", async () => {
  await server.close();
  process.exit();
});

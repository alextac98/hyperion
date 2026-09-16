import { createServer } from "vite";
import { pathToFileURL } from "node:url";

export async function startDevelopmentServer(config = {}) {
  const server = await createServer({
    ...config,
    server: { host: "127.0.0.1", port: 3000, strictPort: false, open: false },
  });
  try {
    // Vite binds the first available port; Electron must use the actual result.
    await server.listen();
    const address = server.httpServer.address();
    if (!address || typeof address === "string")
      throw new Error("Vite did not open a TCP port.");
    return { server, url: `http://127.0.0.1:${address.port}` };
  } catch (error) {
    await server.close();
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { server, url } = await startDevelopmentServer();
  process.send({ url });
  process.once("disconnect", async () => {
    await server.close();
    process.exit();
  });
}

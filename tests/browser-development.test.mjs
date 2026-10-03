import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import test from "node:test";
import * as Y from "yjs";
import { browserDevelopmentPlugin } from "../scripts/browser-development.mjs";
import { startDevelopmentServer } from "../scripts/development-server.mjs";
import { record } from "../dist-electron/data-format.js";

async function fixture(context, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "hyperion-browser-test-"));
  const directory = join(root, "data");
  await writeFile(
    join(root, "index.html"),
    "<html><body>Browser development</body></html>",
  );
  let server;
  let url;
  let token;
  let storageKey;
  async function start() {
    ({ server, url } = await startDevelopmentServer({
      root,
      configFile: false,
      logLevel: "silent",
      server: {
        allowedHosts: (options.allowedOrigins ?? []).map(
          (origin) => new URL(origin).hostname,
        ),
      },
      plugins: [
        browserDevelopmentPlugin({
          directory,
          branch: "feature/browser",
          ...options,
        }),
      ],
    }));
    const html = await (await fetch(url)).text();
    const config = JSON.parse(
      html.match(/window.hyperionBrowserDevelopment=(\{.*?\});/)[1],
    );
    token = config.token;
    storageKey = config.storageKey;
  }
  await start();
  context.after(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  async function request(path, payload = {}, headers = {}) {
    // Use raw HTTP so the forwarded Host header is preserved (fetch controls it).
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        `${url}/__hyperion/${path}`,
        {
          method: "POST",
          timeout: 5000,
          headers: {
            "Content-Type": "application/json",
            Origin: url,
            ...headers,
          },
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("error", reject);
          response.on("end", () => {
            try {
              resolve({
                status: response.statusCode,
                body: response.headers["content-type"]?.includes(
                  "application/json",
                )
                  ? JSON.parse(body)
                  : { error: body },
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      outgoing.on("error", reject);
      outgoing.on("timeout", () =>
        outgoing.destroy(new Error("Request timed out")),
      );
      outgoing.end(JSON.stringify({ token, ...payload }));
    });
  }
  return {
    request,
    root,
    directory,
    get url() {
      return url;
    },
    get token() {
      return token;
    },
    get storageKey() {
      return storageKey;
    },
    restart: async () => {
      await server.close();
      await start();
    },
    reset: async () => {
      await server.close();
      await rm(directory, { recursive: true, force: true });
      await start();
    },
  };
}
function client(api, clientId = randomUUID()) {
  return {
    id: clientId,
    acquire: () => api.request("acquire", { clientId }),
    release: () => api.request("release", { clientId }),
    rpc: (method, ...args) => api.request("rpc", { clientId, method, args }),
  };
}
const note = record(
  {
    id: "note",
    vaultId: "vault",
    title: "Browser page",
    updatedAt: "2026-01-01T00:00:00.000Z",
    collectionIds: [],
  },
  "note",
  true,
);
async function seed(editor) {
  const result = await editor.rpc("repositoryExecute", {
    operation: "createVault",
    vault: record(
      {
        id: "vault",
        name: "Browser vault",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      "vault",
      true,
    ),
    notes: [note],
    collections: [],
    preferences: record({ vaultId: "vault" }, "preferences", true),
  });
  assert.equal(result.status, 200, JSON.stringify(result));
}

test("HTTP data services persist records, documents, assets and history across restart", async (context) => {
  const api = await fixture(context);
  let editor = client(api);
  assert.equal((await editor.acquire()).status, 200);
  await seed(editor);
  const doc = new Y.Doc();
  const blocks = doc.getMap("blocks");
  blocks.set(
    "root",
    new Y.Map([
      ["sys:flavour", "affine:page"],
      ["prop:title", new Y.Text("Browser page")],
      ["sys:children", Y.Array.from(["p"])],
    ]),
  );
  blocks.set(
    "p",
    new Y.Map([
      ["sys:flavour", "affine:paragraph"],
      ["prop:text", new Y.Text("Persisted through HTTP")],
    ]),
  );
  const update = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
  assert.equal(
    (await editor.rpc("editorPush", "vault", "note", update)).status,
    200,
  );
  assert.equal(
    (await editor.rpc("assetSet", "vault", "image", "image/png", "AQID"))
      .status,
    200,
  );
  assert.equal(
    (
      await editor.rpc("repositoryExecute", {
        operation: "captureRevision",
        vaultId: "vault",
        noteId: "note",
        label: "HTTP checkpoint",
      })
    ).status,
    200,
  );
  const oldToken = api.token;
  const oldStorageKey = api.storageKey;
  await api.restart();
  assert.notEqual(api.token, oldToken);
  assert.equal(api.storageKey, oldStorageKey);
  editor = client(api);
  assert.equal(
    (await api.request("acquire", { clientId: editor.id, token: oldToken }))
      .status,
    403,
  );
  assert.equal((await editor.acquire()).status, 200);
  assert.equal(
    (
      await editor.rpc("repositoryExecute", {
        operation: "listNotes",
        vaultId: "vault",
      })
    ).body.result[0].title,
    "Browser page",
  );
  const stored = (await editor.rpc("editorPull", "vault", "note")).body.result;
  const restored = new Y.Doc();
  for (const encoded of stored)
    Y.applyUpdate(restored, Buffer.from(encoded, "base64"));
  assert.equal(
    restored.getMap("blocks").get("p").get("prop:text").toString(),
    "Persisted through HTTP",
  );
  assert.equal(
    (await editor.rpc("assetGet", "vault", "image")).body.result.data,
    "AQID",
  );
  assert.equal(
    (
      await editor.rpc("repositoryExecute", {
        operation: "listRevisions",
        vaultId: "vault",
        noteId: "note",
      })
    ).body.result[0].label,
    "HTTP checkpoint",
  );
  assert.equal((await editor.rpc("createBackup", false)).status, 200);
  doc.destroy();
  restored.destroy();
});

test("browser preference namespaces are isolated and reset with their data directory", async (context) => {
  const first = await fixture(context);
  const second = await fixture(context);
  assert.match(first.storageKey, /^[a-f0-9]{32}$/);
  assert.notEqual(first.storageKey, second.storageKey);
  const originalKey = first.storageKey;
  await first.restart();
  assert.equal(first.storageKey, originalKey);
  await first.reset();
  assert.notEqual(first.storageKey, originalKey);
});

test("the renderer server never serves worktree-local development state", async (context) => {
  const api = await fixture(context);
  const profile = join(api.root, ".hyperion-dev", "profile");
  await mkdir(profile, { recursive: true });
  await writeFile(
    join(profile, "preferences.json"),
    '{"private":"development state"}',
  );
  await writeFile(
    join(api.root, ".env.test-private"),
    "PRIVATE=development state",
  );
  for (const path of [
    "/.hyperion-dev/profile/preferences.json",
    `/@fs/${profile.replaceAll("\\", "/")}/preferences.json`,
    "/.env.test-private",
  ]) {
    const response = await fetch(`${api.url}${path}`);
    assert.equal(response.status, 403);
    assert.doesNotMatch(
      await response.text(),
      /private.*development state|PRIVATE=development state/,
    );
  }
});

test("only one editor can access an instance, including after lease expiry", async (context) => {
  const api = await fixture(context, { leaseMilliseconds: 100 });
  const first = client(api);
  const second = client(api);
  assert.equal((await first.acquire()).status, 200);
  assert.equal((await second.acquire()).status, 409);
  assert.equal((await second.rpc("storageInfo")).status, 409);
  await first.release();
  assert.equal((await second.acquire()).status, 200);
  assert.equal((await first.rpc("storageInfo")).status, 409);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal((await first.acquire()).status, 200);
  assert.equal((await second.rpc("storageInfo")).status, 409);
  await second.release(); // A stale pagehide must not release the new editor.
  assert.equal((await first.rpc("storageInfo")).status, 200);
});

test("development API rejects cross-origin, unauthenticated, native and invalid operations", async (context) => {
  const api = await fixture(context);
  const editor = client(api);
  assert.equal(
    (
      await api.request(
        "acquire",
        { clientId: editor.id },
        { Origin: "https://example.com" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await api.request("acquire", { clientId: editor.id, token: "wrong" }))
      .status,
    403,
  );
  await editor.acquire();
  for (const method of [
    "setStorageDirectory",
    "restoreBackup",
    "constructor",
    "close",
  ]) {
    assert.equal((await editor.rpc(method)).status, 400);
  }
  assert.equal(
    (await editor.rpc("repositoryExecute", { operation: "constructor" }))
      .status,
    400,
  );
  assert.equal(
    (await editor.rpc("editorPush", {}, "note", "invalid")).status,
    400,
  );
  await seed(editor);
  assert.equal(
    (
      await editor.rpc("repositoryExecute", {
        operation: "saveNote",
        note: { ...note, vaultId: "missing-vault" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await editor.rpc("repositoryExecute", {
        operation: "listNotes",
        vaultId: "vault",
      })
    ).body.result.length,
    1,
  );
});

test("a second server cannot open the same browser directory and shutdown releases the lock", async (context) => {
  const api = await fixture(context);
  const plugin = browserDevelopmentPlugin({
    directory: api.directory,
    branch: "other",
  });
  assert.throws(() => plugin.configureServer({}), /already locked/);
  await api.restart();
  const editor = client(api);
  assert.equal((await editor.acquire()).status, 200);
  await access(join(api.directory, ".browser-development.lock"));
});

test("SSH forwarding can use a different loopback host and port", async (context) => {
  const api = await fixture(context);
  const clientId = randomUUID();
  const headers = { Host: "localhost:4300", Origin: "http://localhost:4300" };
  assert.equal(
    (await api.request("acquire", { clientId }, headers)).status,
    200,
  );
  assert.equal(
    (
      await api.request(
        "rpc",
        { clientId, method: "storageInfo", args: [] },
        headers,
      )
    ).body.result.directory,
    join(api.directory, "vaults"),
  );
  assert.equal(
    (
      await api.request(
        "heartbeat",
        { clientId },
        { Host: "example.com", Origin: "http://example.com" },
      )
    ).status,
    403,
  );
});

test("explicit remote origins permit same-origin sessions and reject mismatched hosts and origins", async (context) => {
  const origin = "http://desktop.example:3000";
  const api = await fixture(context, { allowedOrigins: [origin] });
  const clientId = randomUUID();
  const headers = { Host: "desktop.example:3000", Origin: origin };
  assert.equal(
    (await api.request("acquire", { clientId }, headers)).status,
    200,
  );
  assert.equal(
    (
      await api.request(
        "rpc",
        { clientId, method: "storageInfo", args: [] },
        headers,
      )
    ).status,
    200,
  );
  for (const invalid of [
    { Host: "desktop.example:3001", Origin: origin },
    { Host: "desktop.example:3000", Origin: "http://other.example:3000" },
    { Host: "other.example:3000", Origin: "http://other.example:3000" },
  ])
    assert.equal(
      (await api.request("heartbeat", { clientId }, invalid)).status,
      403,
    );
  assert.equal(
    (await api.request("heartbeat", { clientId, token: "wrong" }, headers))
      .status,
    403,
  );
  await api.request("release", { clientId }, headers);
  assert.equal((await client(api).acquire()).status, 200);
});

test("remote HTTP bootstrap supplies UUIDs when the native secure-context API is absent", async (context) => {
  const { runInNewContext } = await import("node:vm");
  const api = await fixture(context);
  const html = await (await fetch(api.url)).text();
  const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const browser = {
    window: {},
    crypto: {
      getRandomValues(bytes) {
        for (let index = 0; index < bytes.length; index++) bytes[index] = index;
        return bytes;
      },
    },
  };
  runInNewContext(source, browser);
  assert.equal(
    browser.crypto.randomUUID(),
    "00010203-0405-4607-8809-0a0b0c0d0e0f",
  );
  const native = () => "native";
  browser.crypto.randomUUID = native;
  runInNewContext(source, browser);
  assert.equal(browser.crypto.randomUUID, native);
});

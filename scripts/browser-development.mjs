import { randomBytes } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, isAbsolute, resolve } from "node:path";
import { VaultLibrary } from "../dist-electron/vault-library.js";

const MAX_BODY = 32 * 1024 * 1024;
const repositoryOperations = new Set([
  "initialize",
  "vaultSetup",
  "suggestVaultDirectory",
  "selectVault",
  "closeVault",
  "listVaults",
  "createVault",
  "updateVault",
  "deleteVault",
  "listNotes",
  "listTemplates",
  "listCollections",
  "saveNote",
  "saveNotes",
  "saveTemplate",
  "saveCollection",
  "savePreferences",
  "deleteNote",
  "deleteTemplate",
  "deleteCollection",
  "getPreferences",
  "exportVault",
  "importVault",
  "captureRevision",
  "captureAutomaticRevisions",
  "listRevisions",
  "getRevision",
  "compareRevision",
  "restoreRevision",
]);
function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
async function readBody(request) {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    fail(415, "Expected JSON.");
  if (Number(request.headers["content-length"]) > MAX_BODY)
    fail(413, "Development requests are limited to 32 MiB.");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY)
      fail(413, "Development requests are limited to 32 MiB.");
    chunks.push(chunk);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body))
    fail(400, "Expected a request object.");
  return body;
}

export function browserDevelopmentPlugin({
  directory,
  branch,
  leaseMilliseconds = 120000,
}) {
  if (!isAbsolute(directory))
    throw new Error("HYPERION_BROWSER_DATA_DIRECTORY must be absolute.");
  directory = resolve(directory);
  const token = randomBytes(32).toString("hex");
  let database;
  let ownsLock = false;
  let client;
  const lockPath = join(directory, ".browser-development.lock");
  const lockOwner = JSON.stringify({ pid: process.pid, branch, token });
  function close() {
    database?.close();
    database = undefined;
    if (ownsLock) {
      if (readFileSync(lockPath, "utf8") === lockOwner) unlinkSync(lockPath);
      ownsLock = false;
    }
  }
  return {
    name: "hyperion:browser-development",
    apply: "serve",
    transformIndexHtml() {
      const config = JSON.stringify({ token, branch }).replaceAll(
        "<",
        "\\u003c",
      );
      return [
        {
          tag: "script",
          children: `window.hyperionBrowserDevelopment=${config};`,
          injectTo: "head-prepend",
        },
      ];
    },
    configureServer(server) {
      mkdirSync(directory, { recursive: true });
      let fd;
      try {
        fd = openSync(lockPath, "wx");
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        throw new Error(
          `Browser data is already locked: ${lockPath}. Stop the other browser server. After a crash, verify its PID is no longer running before removing this lock file.`,
        );
      }
      try {
        writeFileSync(fd, lockOwner);
        ownsLock = true;
      } finally {
        closeSync(fd);
      }
      try {
        // Browser development never follows a desktop storage-location pointer.
        database = new VaultLibrary({
          defaultDirectory: directory,
          followLegacyLocation: false,
        });
        if (database.setupInfo().activeVaultId && !database.setupInfo().error) {
          database.repositoryExecute({ operation: "captureAutomaticRevisions" });
          database.createBackup(true);
        }
      } catch (error) {
        close();
        throw error;
      }
      const methods = {
        repositoryExecute: [
          1,
          (request) => {
            if (!request || !repositoryOperations.has(request.operation))
              fail(400, "Unknown repository operation.");
            if (request.operation === "createVault" && request.directory) fail(400, "Custom storage locations require the desktop app.");
            return database.repositoryExecute(request);
          },
        ],
        storageInfo: [0, () => database.storageInfo()],
        createBackup: [
          1,
          (automatic) => {
            if (typeof automatic !== "boolean")
              fail(400, "Expected a backup flag.");
            return database.createBackup(automatic);
          },
        ],
        listBackups: [0, () => database.listBackups()],
        editorPull: [2, (...args) => database.editorPull(...args)],
        editorPush: [3, (...args) => database.editorPush(...args)],
        editorDelete: [2, (...args) => database.editorDelete(...args)],
        assetGet: [2, (...args) => database.assetGet(...args)],
        assetSet: [4, (...args) => database.assetSet(...args)],
        assetDelete: [2, (...args) => database.assetDelete(...args)],
        assetList: [1, (...args) => database.assetList(...args)],
      };
      server.httpServer.once("close", close);
      server.middlewares.use(async (request, response, next) => {
        const path = request.url?.split("?", 1)[0];
        if (!path?.startsWith("/__hyperion/")) return next();
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/json");
        try {
          const host = request.headers.host;
          if (
            !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host ?? "") ||
            request.headers.origin !== `http://${host}`
          )
            fail(
              403,
              "Development API requests must come from the same loopback origin.",
            );
          if (request.method !== "POST") fail(405, "Expected POST.");
          const body = await readBody(request);
          if (body.token !== token)
            fail(
              403,
              "Invalid development session. Reload this page after restarting the server.",
            );
          if (
            typeof body.clientId !== "string" ||
            !/^[a-zA-Z0-9-]{16,80}$/.test(body.clientId)
          )
            fail(400, "Invalid editor identity.");
          if (path === "/__hyperion/release") {
            if (client?.id === body.clientId) client = undefined;
            response.end(JSON.stringify({ result: null }));
            return;
          }
          if (path === "/__hyperion/acquire") {
            if (
              client &&
              client.id !== body.clientId &&
              client.expires > Date.now()
            ) {
              fail(
                409,
                "This development instance is open in another tab. Close that tab and retry. A disconnected session expires after two minutes.",
              );
            }
            client = {
              id: body.clientId,
              expires: Date.now() + leaseMilliseconds,
            };
          }
          if (client?.id !== body.clientId)
            fail(
              409,
              "This editor session is no longer active. Keep this tab open if it has unsaved edits; close the other editor before reloading.",
            );
          client.expires = Date.now() + leaseMilliseconds;
          let result = null;
          if (path === "/__hyperion/rpc") {
            if (!Object.hasOwn(methods, body.method))
              fail(400, "Unknown data operation.");
            const [arity, action] = methods[body.method];
            if (!Array.isArray(body.args) || body.args.length !== arity)
              fail(400, "Invalid operation arguments.");
            if (
              /^(editor|asset)/.test(body.method) &&
              body.args.some((arg) => typeof arg !== "string")
            )
              fail(400, "Expected string arguments.");
            result = action(...body.args) ?? null;
          } else if (
            path !== "/__hyperion/acquire" &&
            path !== "/__hyperion/heartbeat"
          )
            fail(404, "Unknown development endpoint.");
          response.end(JSON.stringify({ result }));
        } catch (error) {
          response.statusCode = error.status ?? 400;
          response.end(
            JSON.stringify({
              error: error.message ?? "Development request failed.",
            }),
          );
        }
      });
    },
    closeBundle: close,
  };
}

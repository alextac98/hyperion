import { saves } from "../lib/save-coordinator";
import type { BlobSource, DocSource } from "@blocksuite/sync";
import { diffUpdate, encodeStateVectorFromUpdate, mergeUpdates } from "yjs";
import type { HyperionDataApi } from "./desktop-api";

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

class SqliteDocSource implements DocSource {
  readonly name = "hyperion-sqlite";

  constructor(
    private readonly data: HyperionDataApi,
    private readonly vaultId: string,
    private readonly closed: () => boolean,
  ) {}

  async pull(docId: string, state: Uint8Array) {
    if (this.closed()) throw new DOMException("Vault is closed", "AbortError");
    const encodedUpdates = await this.data.editorPull(this.vaultId, docId);
    if (!encodedUpdates.length) return null;
    const update = mergeUpdates(encodedUpdates.map(base64ToBytes));
    return {
      data: state.length ? diffUpdate(update, state) : update,
      state: encodeStateVectorFromUpdate(update),
    };
  }

  push(docId: string, data: Uint8Array) {
    if (this.closed()) throw new Error("Cannot save to a closed vault");
    return saves.track(() =>
      this.data.editorPush(this.vaultId, docId, bytesToBase64(data)),
    );
  }

  subscribe() {
    // Each runtime currently has one active editor session. This boundary
    // can add a main-process broadcast if multi-window editing is introduced.
    return () => {};
  }
}

class SqliteBlobSource implements BlobSource {
  readonly name = "hyperion-sqlite-assets";
  readonly readonly = false;

  constructor(
    private readonly data: HyperionDataApi,
    private readonly vaultId: string,
    private readonly closed: () => boolean,
  ) {}

  async get(key: string) {
    if (this.closed()) return null;
    const asset = await this.data.assetGet(this.vaultId, key);
    return asset
      ? new Blob([base64ToBytes(asset.data)], { type: asset.mimeType })
      : null;
  }

  async set(key: string, value: Blob) {
    if (this.closed()) throw new Error("Cannot save to a closed vault");
    return saves.track(async () => {
      await this.data.assetSet(
        this.vaultId,
        key,
        value.type,
        bytesToBase64(new Uint8Array(await value.arrayBuffer())),
      );
      return key;
    });
  }

  delete(key: string) {
    if (this.closed()) throw new Error("Cannot change a closed vault");
    return this.data.assetDelete(this.vaultId, key);
  }

  list() {
    if (this.closed()) return Promise.resolve([]);
    return this.data.assetList(this.vaultId);
  }
}

export function createSqliteEditorStorage(
  data: HyperionDataApi,
  vaultId: string,
) {
  let closed = false;
  return {
    doc: new SqliteDocSource(data, vaultId, () => closed),
    blobs: new SqliteBlobSource(data, vaultId, () => closed),
    dispose: () => { closed = true; },
  };
}

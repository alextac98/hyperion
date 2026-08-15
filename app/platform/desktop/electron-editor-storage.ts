import type { BlobSource, DocSource } from "@blocksuite/sync";
import { diffUpdate, encodeStateVectorFromUpdate, mergeUpdates } from "yjs";
import type { HyperionDesktopApi } from "../desktop-api";

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
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

class ElectronSqliteDocSource implements DocSource {
  readonly name = "hyperion-sqlite";

  constructor(
    private readonly desktop: HyperionDesktopApi,
    private readonly vaultId: string,
  ) {}

  async pull(docId: string, state: Uint8Array) {
    const encodedUpdates = await this.desktop.editorPull(this.vaultId, docId);
    if (!encodedUpdates.length) return null;
    const update = mergeUpdates(encodedUpdates.map(base64ToBytes));
    if (encodedUpdates.length > 32) {
      await this.desktop.editorReplace(this.vaultId, docId, bytesToBase64(update));
    }
    return {
      data: state.length ? diffUpdate(update, state) : update,
      state: encodeStateVectorFromUpdate(update),
    };
  }

  push(docId: string, data: Uint8Array) {
    return this.desktop.editorPush(this.vaultId, docId, bytesToBase64(data));
  }

  subscribe() {
    // The desktop target currently has one application window. This boundary
    // can add a main-process broadcast if multi-window editing is introduced.
    return () => {};
  }
}

class ElectronSqliteBlobSource implements BlobSource {
  readonly name = "hyperion-sqlite-assets";
  readonly readonly = false;

  constructor(
    private readonly desktop: HyperionDesktopApi,
    private readonly vaultId: string,
  ) {}

  async get(key: string) {
    const asset = await this.desktop.assetGet(this.vaultId, key);
    return asset ? new Blob([base64ToBytes(asset.data)], { type: asset.mimeType }) : null;
  }

  async set(key: string, value: Blob) {
    await this.desktop.assetSet(
      this.vaultId,
      key,
      value.type,
      bytesToBase64(new Uint8Array(await value.arrayBuffer())),
    );
    return key;
  }

  delete(key: string) {
    return this.desktop.assetDelete(this.vaultId, key);
  }

  list() {
    return this.desktop.assetList(this.vaultId);
  }
}

export function createElectronEditorStorage(desktop: HyperionDesktopApi, vaultId: string) {
  return {
    doc: new ElectronSqliteDocSource(desktop, vaultId),
    blobs: new ElectronSqliteBlobSource(desktop, vaultId),
  };
}

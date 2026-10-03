/** Small transfers avoid loading an entire recording into an IPC or HTTP request. */
export const AUDIO_CHUNK_BYTES = 2 * 1024 * 1024;
export interface AudioStorage {
  set(value: Blob): Promise<string>;
  get(key: string): Promise<Blob | null>;
}
export async function writeAudio(
  blob: Blob,
  storage: AudioStorage,
  append: (key: string) => void,
) {
  for (let offset = 0; offset < blob.size; offset += AUDIO_CHUNK_BYTES) {
    const key = await storage.set(
      blob.slice(offset, offset + AUDIO_CHUNK_BYTES, blob.type),
    );
    append(key);
  }
}
export async function readAudio(
  keys: string[],
  mimeType: string,
  storage: Pick<AudioStorage, "get">,
) {
  const parts: Blob[] = [];
  for (const key of keys) {
    const part = await storage.get(key);
    if (!part)
      throw new Error(
        "Part of this recording is missing. Try reopening the vault or restoring a backup.",
      );
    parts.push(part);
  }
  return new Blob(parts, { type: mimeType });
}
export function audioExtension(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

export function importedAudioMimeType(name: string, type: string) {
  if (type.startsWith("audio/") || type === "video/webm") return type;
  const types: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    webm: "audio/webm",
    aac: "audio/aac",
    flac: "audio/flac",
  };
  return (
    types[name.split(".").at(-1)?.toLowerCase() ?? ""] ??
    "application/octet-stream"
  );
}

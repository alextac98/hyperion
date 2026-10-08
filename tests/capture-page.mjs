import { setTimeout } from "node:timers/promises";

// Chromium can briefly reject a surface copy after a native window resize,
// particularly under Xvfb. Retry that compositor error without hiding failures
// from a destroyed renderer or a surface that never becomes available.
export async function capturePage(webContents) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await webContents.capturePage();
    } catch (error) {
      if (error?.message !== "UnknownVizError" || attempt === 2) throw error;
      await setTimeout(100);
    }
  }
}

import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import type { UpdateDriver } from "./updates.js";

export function createUpdatePreview(
  scenario: string,
  version: string,
  installed: boolean,
  restart: () => void,
  wait: (milliseconds: number) => Promise<unknown> = delay,
): UpdateDriver {
  let checks = 0;
  let downloads = 0;
  const events = new EventEmitter();
  return Object.assign(events, {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    async checkForUpdates() {
      await wait(800);
      if (scenario === "check-error" && checks++ === 0 && !installed) {
        throw new Error("Simulated connection failure");
      }
      events.emit(
        installed || scenario === "up-to-date"
          ? "update-not-available"
          : "update-available",
        { version },
      );
    },
    async downloadUpdate() {
      const fail = scenario === "download-error" && downloads++ === 0;
      for (let percent = 0; percent <= 100; percent += 5) {
        await wait(300);
        if (fail && percent === 40)
          throw new Error("Simulated download failure");
        events.emit("download-progress", { percent });
      }
      events.emit("update-downloaded", { version });
    },
    quitAndInstall() {
      restart();
    },
  });
}

import { app, BrowserWindow } from "electron";

if (!process.env.HYPERION_TEST_APP_DATA)
  throw new Error("Run through the development integration test.");
app.setPath("appData", process.env.HYPERION_TEST_APP_DATA);
await import("../../dist-electron/main.js");

let window;
const timer = setInterval(async () => {
  window = BrowserWindow.getAllWindows()[0];
  if (!window || window.webContents.isLoading()) return;
  clearInterval(timer);
  try {
    const data = await window.webContents.executeJavaScript(
      "window.hyperionDesktop.storageInfo()",
    );
    const body = await window.webContents.executeJavaScript(
      "document.body.textContent",
    );
    await window.webContents.executeJavaScript(
      "window.hyperionDesktop.onPrepareClose(async () => {}); void 0",
    );
    const result = {
      pid: process.pid,
      branch: process.env.HYPERION_DEV_BRANCH,
      title: window.getTitle(),
      url: window.webContents.getURL(),
      profile: app.getPath("userData"),
      data,
      body,
    };
    if (process.send) process.send(result);
    else console.log(`INSTANCE_READY ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
}, 50);
process.on("message", async (message) => {
  if (message === "close") {
    window.once("closed", () => app.quit());
    window.close();
  }
  if (message === "check") {
    const data = await window.webContents.executeJavaScript(
      "window.hyperionDesktop.storageInfo()",
    );
    process.send({ data });
  }
});

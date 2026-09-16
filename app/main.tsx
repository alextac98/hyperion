import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { HyperionMark } from "./components/HyperionMark";
import "./globals.css";

const root = document.getElementById("root");
const isBrandPage =
  new URLSearchParams(window.location.search).get("view") === "brand";
const Page = isBrandPage
  ? lazy(() => import("./brand/BrandPage"))
  : lazy(() => import("./HyperionApp"));

if (!root) {
  throw new Error("Hyperion could not find its application root.");
}

const reactRoot = createRoot(root);
async function start() {
  const browserDevelopment =
    import.meta.env.DEV && Boolean(window.hyperionBrowserDevelopment);
  if (!isBrandPage && (window.hyperionDesktop || browserDevelopment)) {
    const { initializeRuntime } = await import("./platform/runtime");
    await initializeRuntime();
  }
  reactRoot.render(
    <StrictMode>
      {isBrandPage || window.hyperionDesktop || browserDevelopment ? (
        <Suspense
          fallback={
            <main className="app-loading">
              <HyperionMark />
              <span>Opening Hyperion…</span>
            </main>
          }
        >
          <Page />
        </Suspense>
      ) : (
        <main className="desktop-launch">
          <HyperionMark />
          <h1>Hyperion for desktop</h1>
          <p>
            Your vaults are stored securely on this computer by the desktop app.
          </p>
          <p>
            Open Hyperion to start writing. Browser storage is no longer
            supported.
          </p>
          <a className="brand-guide-link" href="?view=brand">
            Brand &amp; design guidelines
          </a>
        </main>
      )}
    </StrictMode>,
  );
}
void start().catch((error: unknown) => {
  reactRoot.render(
    <main className="desktop-launch">
      <HyperionMark />
      <h1>Could not open Hyperion</h1>
      <p role="alert">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <button onClick={() => window.location.reload()}>Retry</button>
    </main>,
  );
});

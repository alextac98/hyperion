import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { HyperionMark } from "./components/HyperionMark";
import "./globals.css";

const root = document.getElementById("root");
const isBrandPage = new URLSearchParams(window.location.search).get("view") === "brand";
const Page = isBrandPage
  ? lazy(() => import("./brand/BrandPage"))
  : lazy(() => import("./HyperionApp"));

if (!root) {
  throw new Error("Hyperion could not find its application root.");
}

createRoot(root).render(
  <StrictMode>
    {isBrandPage || window.hyperionDesktop ? (
      <Suspense fallback={<main className="app-loading"><HyperionMark /><span>Opening Hyperion…</span></main>}>
        <Page />
      </Suspense>
    ) : (
      <main className="desktop-launch"><HyperionMark /><h1>Hyperion for desktop</h1><p>Your vaults are stored securely on this computer by the desktop app.</p><p>Open Hyperion to start writing. Browser storage is no longer supported.</p><a className="brand-guide-link" href="?view=brand">Brand &amp; design guidelines</a></main>
    )}
  </StrictMode>,
);

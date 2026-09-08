import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import HyperionApp from "./HyperionApp";
import "./globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Hyperion could not find its application root.");
}

createRoot(root).render(
  <StrictMode>
    {window.hyperionDesktop ? <HyperionApp /> : <main className="desktop-launch"><h1>Hyperion for desktop</h1><p>Your vaults are stored securely on this computer by the desktop app.</p><p>Open Hyperion to start writing. Browser storage is no longer supported.</p></main>}
  </StrictMode>,
);

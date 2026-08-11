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
    <HyperionApp />
  </StrictMode>,
);

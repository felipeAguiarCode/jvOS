import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

if (!import.meta.env.DEV) {
  // Desktop build: no browser context menu over the hologram; the editors keep copy/paste.
  window.addEventListener("contextmenu", (event) => {
    if (!(event.target instanceof Element && event.target.closest("[data-allow-context-menu]"))) event.preventDefault();
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

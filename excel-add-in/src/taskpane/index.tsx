import React from "react";
import { createRoot } from "react-dom/client";
import { updateRibbon } from "~/commands/common.commands";
import App from "./App";
import "./index.css";

/* global document, Office */

let isOfficeInitialized = false;

const render = (Component: typeof App) => {
  createRoot(document.getElementById("container") as HTMLElement).render(
    <React.StrictMode>
      {isOfficeInitialized ? <Component /> : <p>Loading...</p>}
      {/* <Component /> */}
    </React.StrictMode>,
  );
};

/* Render application after Office initializes */
Office.onReady(async () => {
  isOfficeInitialized = true;

  render(App);
  updateRibbon();
});

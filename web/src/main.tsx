import { I18nProvider, Toast } from "@heroui/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./lib/theme"; // apply theme before first paint
import { startConnection } from "./store";

startConnection();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider locale="en-US">
      <Toast.Provider placement="top end" />
      <App />
    </I18nProvider>
  </StrictMode>,
);

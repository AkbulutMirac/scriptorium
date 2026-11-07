import { I18nProvider, Toast } from "@heroui/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./lib/theme"; // temayı ilk çizimden önce uygula
import { startConnection } from "./store";

startConnection();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider locale="tr-TR">
      <Toast.Provider placement="top end" />
      <App />
    </I18nProvider>
  </StrictMode>,
);

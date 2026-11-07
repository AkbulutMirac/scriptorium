import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Geliştirmede WebSocket istekleri arka uca (7777) yönlendirilir
    proxy: { "/ws": { target: "ws://127.0.0.1:7777", ws: true } },
  },
  build: { chunkSizeWarningLimit: 3000 },
});

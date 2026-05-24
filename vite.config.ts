import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: '/lexilog/',
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // compromise NLP library is intentionally bundled (~140KB gzip)
    chunkSizeWarningLimit: 900,
  },
});

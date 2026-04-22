import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "dev"),
  },
  plugins: [react()],
  server: {
    port: 3000,
    cors: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      input: {
        main:    resolve(__dirname, "index.html"),
        overlays: resolve(__dirname, "overlays.html"),
      },
    },
  },
});

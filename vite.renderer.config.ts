import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  root: "src/renderer/chat",
  build: {
    outDir: "../../../dist/renderer/chat",
    emptyOutDir: true,
  },
});

import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { assetsInlineLimit: 100_000_000, cssCodeSplit: false },
});

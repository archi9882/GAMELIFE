import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    target: "es2019",
    rollupOptions: { output: { format: "iife", inlineDynamicImports: true } },
  },
});

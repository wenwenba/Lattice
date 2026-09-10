import { defineConfig } from "vitest/config";
import vue from "unplugin-vue/vite";
import { vueTui } from "@vue-tui/vite";

export default defineConfig({
  input: "src/main.ts",
  plugins: [vue(), vueTui()],
  build: {
    // vue-tui and Yoga intentionally ship as one portable Node entry.
    chunkSizeWarningLimit: 1000,
  },
});

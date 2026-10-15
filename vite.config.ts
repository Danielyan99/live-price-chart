/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// GitHub Pages serves project sites from /<repo-name>/, so the production
// build (and `vite preview` of it) needs that base. `vite dev` stays at "/".
export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? "/live-price-chart/" : "/",
  plugins: [react()],
  worker: { format: "es" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));

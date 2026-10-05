import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.spec.ts"],
    exclude: ["node_modules", ".next"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "app"),
      "@/db": path.resolve(__dirname, "packages/db"),
      "@/schemas": path.resolve(__dirname, "packages/schemas"),
      "@/evals": path.resolve(__dirname, "packages/evals"),
    },
  },
});

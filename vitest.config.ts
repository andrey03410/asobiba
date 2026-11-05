import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const testRoot = resolve(import.meta.dirname, "storage/test");

export default defineConfig({
  test: {
    include: ["packages/**/*.test.{ts,tsx}", "games/**/*.test.{ts,tsx}", "apps/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    fileParallelism: false,
    globalSetup: ["scripts/test-setup.ts"],
    testTimeout: 20_000,
    env: {
      DATABASE_URL: `file:${resolve(testRoot, "test.db")}`,
      ASOBIBA_STORAGE_DIR: resolve(testRoot, "files"),
      ASSET_URL_ALLOW_PRIVATE: "1",
      NODE_ENV: "test",
    },
  },
});

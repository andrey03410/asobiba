import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const server = "http://127.0.0.1:8787";

// Douga packages are linked from the sibling checkout (../douga). They must share
// this app's React and Remotion instead of resolving their own copies there.
const douga = fileURLToPath(new URL("../../../douga/packages", import.meta.url));

export default defineConfig({
  plugins: [react()],
  // The linked Douga SDK uses Zod 3, while Asobiba uses Zod 4. Optimizing
  // both bare imports under one key would feed Zod 4 to Douga at runtime.
  optimizeDeps: { exclude: ["zod"] },
  resolve: {
    dedupe: ["react", "react-dom", "remotion", "@remotion/player"],
  },
  server: {
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url)), douga] },
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      "/api": server,
      "/files": server,
      "/mcp": server,
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

import { bundle } from "@remotion/bundler";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const outDir = resolve(root, "apps/server/dist/player-scene");
if (process.argv.includes("--if-missing") && existsSync(resolve(outDir, "index.html"))) process.exit(0);
await bundle({
  entryPoint: resolve(root, "apps/server/src/mcp/scene-entry.tsx"),
  outDir,
  publicDir: null,
  webpackOverride(config) {
    config.devtool = false;
    // Sibling Douga workspaces must use this app's React and Remotion render context.
    for (const name of ["react", "react-dom", "remotion"]) {
      config.resolve.alias[name] = resolve(root, "node_modules", name);
    }
    return config;
  },
});

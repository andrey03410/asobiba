import { bundle } from "@remotion/bundler";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
await bundle({
  entryPoint: resolve(root, "apps/server/src/mcp/scene-entry.tsx"),
  outDir: resolve(root, "apps/server/dist/player-scene"),
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

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomString } from "../ids";
import { parseFileRange } from "../assets/media";

/** Raw source files are available to the local renderer only, for the duration of one render. */
export async function openSceneAssets(files: Map<string, string>) {
  const prefix = `/${randomString(32)}/`;
  const server = createServer(async (req, res) => {
    const path = req.url?.startsWith(prefix) && files.get(req.url.slice(prefix.length));
    if (!path || (req.method !== "GET" && req.method !== "HEAD")) {
      res.writeHead(404).end();
      return;
    }
    try {
      const { size } = await stat(path);
      const range = req.headers.range ? parseFileRange(req.headers.range, size) : null;
      if (req.headers.range && !range) {
        res.writeHead(416, { "content-range": `bytes */${size}` }).end();
        return;
      }
      const headers: Record<string, string | number> = {
        "accept-ranges": "bytes",
        "access-control-allow-origin": "*",
        "content-length": size,
      };
      if (range) {
        headers["content-length"] = range.end - range.start + 1;
        headers["content-range"] = `bytes ${range.start}-${range.end}/${size}`;
      }
      res.writeHead(range ? 206 : 200, headers);
      if (req.method === "HEAD" || !size) {
        res.end();
        return;
      }
      const stream = createReadStream(path, range ?? undefined);
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}${prefix}`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

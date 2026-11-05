import { collectAssetRefs, type ConfigDocument, type MatchView } from "@asobiba/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderTrustedSvg } from "../assets/images";
import type { AssetService } from "../assets/service";
import { gameClient } from "../games/catalog";
import { badRequest } from "../http-errors";

export interface PreviewResult {
  png: Buffer;
  width: number;
  height: number;
  match: MatchView;
}

const PREVIEW_WIDTH = 768;

/**
 * Renders the game's own board component statically and rasterizes it, so the
 * agent sees exactly what players will see (minus animations).
 */
export async function renderPreview(assets: AssetService, config: ConfigDocument, moment: "start" | "end", seed: number): Promise<PreviewResult> {
  const client = gameClient(config.game);
  if (!client) throw badRequest("no_preview", `У игры ${config.game} нет превью`);
  const match = client.previewMatch(config, moment, seed);
  const uris = await assets.previewDataUris(collectAssetRefs(config).map((r) => r.assetId));
  const svg = renderToStaticMarkup(
    createElement(client.Board, { match, config, seat: null, assetUrl: (id: string) => uris.get(id) ?? "", staticRender: true }),
  );
  const png = renderTrustedSvg(svg, PREVIEW_WIDTH);
  const height = png.readUInt32BE(20);
  return { png, width: png.readUInt32BE(16), height, match };
}

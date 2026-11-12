import { collectAssetRefs, type ConfigDocument, type MatchView, type PreviewTarget } from "@asobiba/sdk";
import { Resvg } from "@resvg/resvg-js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderTrustedSvg } from "../assets/images";
import type { AssetService } from "../assets/service";
import { gameClient } from "../games/catalog";
import { quizorMediaRefs } from "../games/media-refs";
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
export async function renderPreview(assets: AssetService, config: ConfigDocument, moment: "start" | "end", seed: number, target?: PreviewTarget): Promise<PreviewResult> {
  const client = gameClient(config.game);
  if (!client) throw badRequest("no_preview", `У игры ${config.game} нет превью`);
  if (target && !client.previewTarget) throw badRequest("unsupported_preview_target", "Игра не поддерживает адресное превью");
  let match: MatchView;
  try { match = target ? client.previewTarget!(config, target, seed) : client.previewMatch(config, moment, seed); }
  catch (error) {
    if (target && error instanceof Error && "code" in error && error.code === "target_not_found") throw badRequest("target_not_found", error.message);
    throw error;
  }
  // Resolve only assets on the rendered surface; never load all future quiz media.
  const refs = [...collectAssetRefs({ visual: config.visual }), ...(config.game === "quizor" ? quizorMediaRefs(match.game) : collectAssetRefs({ visual: match.game }))];
  const uris = await assets.previewDataUris([...new Set(refs.map(ref => ref.assetId))]);
  const svg = renderToStaticMarkup(
    createElement(client.Board, { match, config, seat: null, assetUrl: (id: string) => uris.get(id) ?? "", staticRender: true }),
  );
  const png = config.game === "quizor"
    ? new Resvg(svg, { fitTo: { mode: "width", value: PREVIEW_WIDTH }, font: { loadSystemFonts: true, defaultFontFamily: "Arial" } }).render().asPng()
    : renderTrustedSvg(svg, PREVIEW_WIDTH);
  const height = png.readUInt32BE(20);
  return { png, width: png.readUInt32BE(16), height, match };
}

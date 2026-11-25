import { mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { sliceWindow } from "@asobiba/sdk";
import { choiceRects } from "@douga/render/hit-test";
import type { PublicField } from "@asobiba/game-quizor";
import type { CompiledVideo } from "@douga/video";
import { compiledMediaUsages } from "@douga/video/compiled-media";
import type { Services } from "../app";
import { REPO_ROOT } from "../env";
import { openSceneAssets } from "./scene-assets";
import { forbidden, notFound } from "../http-errors";

/** Opaque answer handles and boxes in the returned PNG's pixel coordinates. */
export function playerChoices(plan: CompiledVideo, frame: number, scale: number, fields: PublicField[]) {
  return choiceRects(plan, frame).flatMap((hit) =>
    fields.flatMap((field) => {
      if (field.type !== "choice" || field.pick !== "frame") return [];
      return (field.options ?? []).flatMap((option) => {
        if (!option.card || (option.card !== hit.cardId && option.card !== hit.participantId)) return [];
        const { x, y, width, height } = hit.rect;
        return [
          {
            field: field.id,
            option: option.id,
            rect: { x: x * scale, y: y * scale, width: width * scale, height: height * scale },
          },
        ];
      });
    }),
  );
}

/** Render the same Douga composition as the human board. Never return its source plan or media files. */
export async function sceneMedia(
  s: Services,
  userId: string,
  lobbyId: string,
  key: string,
  now: number,
  seconds?: number,
  fields: PublicField[] = [],
) {
  const { directive, names } = await s.lobbies.videoAccess(userId, lobbyId, key);
  const slice = await s.videoRuntime.slice(directive, names);
  const plan = structuredClone(slice.plan);
  const window = sliceWindow(plan.interaction?.scenes ?? [], directive.start?.momentId, directive.hold?.momentId);
  if ("missing" in window) throw notFound("Фрагмент пока недоступен");
  const first = directive.start ? window.startFrame : 0;
  const latest = Math.min(
    plan.durationInFrames - 1,
    window.holdFrame ?? Infinity,
    Math.floor(((now - directive.startedAt) * plan.fps) / 1000),
  );
  if (latest < first) throw forbidden("Фрагмент ещё не показан");
  const files = new Map<string, string>();
  for (const name of slice.files) {
    const path = s.video.filePath(name);
    if (!path) throw notFound("Файл сцены недоступен");
    files.set(name, path);
  }
  const dir = await mkdtemp(join(tmpdir(), "asobiba-player-"));
  const assets = await openSceneAssets(files);
  let timeout: NodeJS.Timeout | undefined;
  try {
    const serveUrl = join(REPO_ROOT, "apps/server/dist/player-scene");
    const mediaUrl = (src: string) => assets.base + basename(src);
    for (const { asset } of compiledMediaUsages(plan)) {
      asset.src = mediaUrl(asset.src);
      if (asset.posterSrc) asset.posterSrc = mediaUrl(asset.posterSrc);
    }
    for (const font of plan.fonts ?? []) {
      font.src = mediaUrl(font.src);
      font.license = mediaUrl(font.license);
    }
    const { renderStill, renderMedia, selectComposition, makeCancelSignal } = await import("@remotion/renderer");
    const inputProps = { plan, assetMode: "url" };
    const browserExecutable =
      process.env.REMOTION_BROWSER_EXECUTABLE ??
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : "/usr/bin/chromium");
    const { cancel, cancelSignal } = makeCancelSignal();
    timeout = setTimeout(cancel, 25_000);
    const common = {
      cancelSignal,
      offthreadVideoCacheSizeInBytes: 32 * 1024 * 1024,
      serveUrl,
      inputProps,
      browserExecutable,
      timeoutInMilliseconds: 12_000,
      logLevel: "error" as const,
    };
    const composition = await selectComposition({ ...common, id: "PlayerScene" });
    const scale = Math.min(1, (seconds === undefined ? 1280 : 640) / Math.max(plan.width, plan.height));
    if (seconds === undefined) {
      const { buffer } = await renderStill({ ...common, composition, frame: latest, scale, imageFormat: "png" });
      if (!buffer) throw notFound("Кадр недоступен");
      return { mimeType: "image/png", bytes: buffer, choices: playerChoices(plan, latest, scale, fields) };
    }
    const output = join(dir, "fragment.mp4");
    const from = Math.max(first, latest - Math.ceil(seconds * plan.fps) + 1);
    await renderMedia({
      ...common,
      composition,
      outputLocation: output,
      codec: "h264",
      scale,
      concurrency: 1,
      frameRange: [from, latest],
      pixelFormat: "yuv420p",
    });
    return { mimeType: "video/mp4", bytes: await readFile(output) };
  } finally {
    clearTimeout(timeout);
    assets.close();
    await rm(dir, { recursive: true, force: true });
  }
}

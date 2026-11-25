import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { MAX_IMAGE_SIDE } from "../assets/images";
import type { YomifudaView } from "@asobiba/game-yomifuda";
import type { Block, QuizorView } from "@asobiba/game-quizor";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Services } from "../app";
import { REPO_ROOT } from "../env";
import { quizorMediaRefs, yomifudaMediaRefs } from "../games/media-refs";
import { badRequest, forbidden, HttpError, notFound } from "../http-errors";
import { run } from "./result";
import { sceneMedia } from "./scene-media";

const execute = promisify(execFile);
// Local workspaces already install Douga. The production image provides ffmpeg on PATH.
const siblingFfmpeg = resolve(
  REPO_ROOT,
  "../douga/node_modules/ffmpeg-static",
  process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
);
function ffmpeg() {
  return (
    process.env.ASOBIBA_FFMPEG ??
    (process.env.NODE_ENV !== "production" && existsSync(siblingFfmpeg) ? siblingFfmpeg : "ffmpeg")
  );
}
const MAX_CLIP_SECONDS = 5;
let rendering = false;

interface Media {
  mimeType: string;
  bytes: Buffer;
}

function response(media: Media): CallToolResult {
  const data = media.bytes.toString("base64");
  if (media.mimeType.startsWith("image/")) return { content: [{ type: "image", mimeType: media.mimeType, data }] };
  if (media.mimeType.startsWith("audio/")) return { content: [{ type: "audio", mimeType: media.mimeType, data }] };
  return {
    content: [
      {
        type: "resource",
        resource: { uri: "asobiba-media:///fragment.mp4", mimeType: media.mimeType, blob: data },
      },
    ],
  };
}

/** Only game-authored block containers have playback semantics; player answers are never searched. */
function findBlock(blocks: Block[], id: string): Block | undefined {
  for (const block of blocks) {
    if (block.asset === id) return block;
    if (block.blocks) {
      const nested = findBlock(block.blocks, id);
      if (nested) return nested;
    }
  }
}

function currentPage(delay: number[] = [], loop = 0, elapsedMs: number): number {
  if (delay.length < 2 || elapsedMs <= 0) return 0;
  // Browsers display zero/very short animation frames for 100 ms.
  const durations = delay.map(ms => ms <= 10 ? 100 : ms);
  const cycle = durations.reduce((sum, ms) => sum + ms, 0);
  if (loop > 0 && elapsedMs >= loop * cycle) return durations.length - 1;
  let cursor = elapsedMs % cycle;
  for (const [i, ms] of durations.entries()) {
    if (cursor < ms) return i;
    cursor -= ms;
  }
  return durations.length - 1;
}

async function revealedImage(bytes: Buffer, elapsedMs: number, block?: Block): Promise<Media> {
  const progress = block?.playerProgress ?? 1;
  const options = { limitInputPixels: MAX_IMAGE_SIDE ** 2 };
  const metadata = await sharp(bytes, options).metadata();
  const page = currentPage(metadata.delay, metadata.loop, elapsedMs);
  // Animated readers may composite preceding frames to reconstruct the requested page.
  if ((page + 1) * metadata.width * metadata.height > 128_000_000)
    throw new HttpError(422, "animation_too_large", "Этот кадр анимации слишком велик для показа через MCP");
  const { info: { width, height }, data } = await sharp(bytes, { ...options, page, pages: 1 })
    .autoOrient().png().timeout({ seconds: 5 }).toBuffer({ resolveWithObject: true });
  if (!block?.effect || block.effect === "none" || progress >= 1)
    return { bytes: data, mimeType: "image/png" };
  const source = `data:image/png;base64,${data.toString("base64")}`;
  const image = (extra = "") => `<image width="${width}" height="${height}" ${extra} href="${source}"/>`;
  const render = (body: string, w = width, h = height, viewW = w, viewH = h) =>
    new Resvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${viewW} ${viewH}">${body}</svg>`,
    )
      .render()
      .asPng();
  let body: string;
  switch (block.effect) {
    case "blur":
      body = `<defs><filter id="blur"><feGaussianBlur stdDeviation="${(1 - progress) * 28}"/></filter></defs>${image('filter="url(#blur)"')}`;
      break;
    case "zoom": {
      const scale = 1 + (1 - progress) * 3;
      body = image(
        `transform="translate(${((1 - scale) * width) / 2} ${((1 - scale) * height) / 2}) scale(${scale})"`,
      );
      break;
    }
    case "spotlight": {
      const radius = (Math.hypot(width, height) / Math.SQRT2) * (0.12 + progress * 0.65);
      body = `<defs><clipPath id="spot"><circle cx="${(0.3 + progress * 0.2) * width}" cy="${height / 2}" r="${radius}"/></clipPath></defs>${image('clip-path="url(#spot)"')}`;
      break;
    }
    case "tiles": {
      body = image();
      for (let i = 0; i < 36; i++)
        if (((i * 17) % 36) / 36 >= progress) {
          body += `<rect x="${((i % 6) * width) / 6}" y="${(Math.floor(i / 6) * height) / 6}" width="${width / 6 + 1}" height="${height / 6 + 1}" fill="#242630"/>`;
        }
      break;
    }
    case "pixelate": {
      const fraction = 0.012 + progress ** 3 * 0.988;
      return {
        mimeType: "image/png",
        bytes: render(
          image(),
          Math.max(4, Math.round(width * fraction)),
          Math.max(4, Math.round(height * fraction)),
          width,
          height,
        ),
      };
    }
    default:
      throw forbidden("Эффект изображения ещё не раскрыт");
  }
  return { mimeType: "image/png", bytes: render(body) };
}

async function clip(path: string, block: Block, offset: number, seconds: number): Promise<Media> {
  const rate = block.speed ?? 1;
  const from = (block.from ?? 0) + offset * rate;
  const visibleDuration = Math.min(
    seconds,
    (block.playerElapsedSeconds ?? 0) - offset,
    ((block.to ?? Infinity) - from) / rate,
  );
  if (visibleDuration < 0.02) throw forbidden("Эта часть записи ещё не воспроизводилась");
  const audio = !block.muted && (block.volume ?? 1) > 0;
  const video = block.type === "video" && !block.audioOnly;
  if (!audio && !video) throw forbidden("В этом фрагменте нет видимого или слышимого содержимого");
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-probesize",
    "8000000",
    "-protocol_whitelist",
    "file,pipe",
    "-ss",
    String(from),
    "-t",
    String(visibleDuration * rate),
    "-i",
    path,
    "-map_metadata",
    "-1",
    "-threads",
    "1",
  ];
  if (video)
    args.push(
      "-map",
      "0:v:0",
      "-vf",
      `scale='max(2,trunc(min(640,iw)/2)*2)':-2,setpts=PTS/${rate}`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
    );
  else args.push("-vn");
  if (audio) {
    const tempo = rate < 0.5 ? [0.5, rate / 0.5] : rate > 2 ? [2, rate / 2] : [rate];
    args.push(
      "-map",
      video ? "0:a:0?" : "0:a:0",
      "-af",
      [`volume=${block.volume ?? 1}`, ...tempo.map((n) => `atempo=${n}`)].join(","),
    );
    args.push("-c:a", video ? "aac" : "libmp3lame");
  } else args.push("-an");
  args.push("-t", String(visibleDuration));
  if (video) args.push("-movflags", "frag_keyframe+empty_moov", "-f", "mp4");
  else args.push("-f", "mp3");
  args.push("pipe:1");
  const { stdout } = await execute(ffmpeg(), args, {
    encoding: "buffer",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 12_000,
  });
  return { bytes: stdout, mimeType: video ? "video/mp4" : "audio/mpeg" };
}

export function registerPlayerMedia(
  server: McpServer,
  s: Services,
  connection: { lobbyId: z.ZodString; key: z.ZodString },
  controllerId?: string,
) {
  server.registerTool(
    "agent_media",
    {
      title: "Посмотреть или услышать медиа своего места",
      description:
        "Передайте assetId уже показанного файла или sceneKey текущей сцены Douga. Для записи offsetSeconds отсчитывается от начала разрешённого фрагмента, до пяти секунд за вызов. Для Douga без seconds возвращается текущий кадр, с seconds — уже показанный отрывок.",
      inputSchema: {
        ...connection,
        assetId: z.string().max(80).optional(),
        sceneKey: z
          .string()
          .regex(/^[a-f0-9]{32}$/)
          .optional(),
        offsetSeconds: z.number().min(0).max(86400).default(0),
        seconds: z.number().min(0.1).max(MAX_CLIP_SECONDS).optional(),
      },
    },
    ({ lobbyId, key, assetId, sceneKey, offsetSeconds, seconds }) =>
      run(async () => {
        if (!!assetId === !!sceneKey) throw badRequest("media_source", "Передайте assetId или sceneKey");
        const userId = await s.lobbies.botIdentity(lobbyId, key, controllerId);
        if (rendering) throw new HttpError(429, "media_busy", "Обрабатывается другой фрагмент. Повторите запрос.");
        rendering = true;
        try {
          const context = await s.lobbies.botMediaView(lobbyId, key, controllerId);
          if (sceneKey) {
            const video = s.catalog.get(context.gameId)?.video;
            const directive =
              context.view && video?.directives(context.view).find((item) => item.key === sceneKey);
            if (!directive) throw forbidden("Эта сцена пока не показана");
            const fields = context.gameId === "quizor" ? (context.view as QuizorView).fields : [];
            const media = await sceneMedia(s, userId, lobbyId, sceneKey, context.now, seconds, fields);
            const output = response(media);
            if (media.choices?.length)
              output.content.push({ type: "text", text: JSON.stringify({ choices: media.choices }) });
            return output;
          }
          if (!assetId) throw badRequest("media_source", "Укажите assetId");
          // Authorize the same instant whose effects and clip bounds we render.
          const visible =
            context.gameId === "quizor"
              ? quizorMediaRefs(context.view)
              : context.gameId === "yomifuda"
                ? yomifudaMediaRefs(context.view)
                : null;
          const allowed = visible
            ? visible.some((ref) => ref.assetId === assetId)
            : await s.lobbies.canReadBotAsset(lobbyId, key, assetId, controllerId);
          if (!allowed) throw forbidden("Медиа пока недоступно игроку");
          const file = await s.assets.file(assetId);
          if (!file) throw notFound("Медиа недоступно");
          const quiz = context.gameId === "quizor" ? (context.view as QuizorView | null) : null;
          let block = quiz ? findBlock([...quiz.blocks, ...quiz.reveal], assetId) : undefined;
          if (
            !block &&
            quiz?.fields.some((field) =>
              [
                ...(field.options ?? []),
                ...(field.items ?? []),
                ...(field.left ?? []),
                ...(field.right ?? []),
              ].some((item) => item.asset === assetId && item.media === "audio"),
            )
          ) {
            // Players can play an audio answer option on demand.
            block = { type: "audio", asset: assetId, playerElapsedSeconds: Infinity };
          }
          if (file.mime.startsWith("image/")) {
            const now = quiz?.paused ? quiz.serverNow : context.now;
            let startedAt = context.startedAt ?? now;
            if (quiz) {
              const isBackground = quiz.roundVisual?.background?.asset === assetId;
              startedAt = block?.playerImageStartedAt ?? (isBackground ? quiz.roundStartedAt : quiz.answerOpenedAt) ?? startedAt;
            }
            if (context.gameId === "yomifuda" && context.view) {
              const cards = context.view as YomifudaView;
              if (cards.hand.some(card => card.image?.asset === assetId)) startedAt = cards.choiceStartedAt;
              else if (cards.table.some(item => !item.hidden && item.card.image?.asset === assetId))
                startedAt = cards.revealStartedAt ?? cards.choiceStartedAt;
              else startedAt = cards.revealEndsAt ?? cards.revealStartedAt ?? cards.choiceStartedAt;
            }
            return response(await revealedImage(await readFile(file.path), now - startedAt, block));
          }
          if (!block || (block.type !== "audio" && block.type !== "video"))
            throw forbidden("Запись пока недоступна");
          return response(await clip(file.path, block, offsetSeconds, seconds ?? MAX_CLIP_SECONDS));
        } finally {
          rendering = false;
        }
      }),
  );
}

import type { VideoDirective, VideoMatchData } from "@asobiba/sdk";
import {
  applyMatchData,
  compileVideo,
  slicePlan,
  type AssetManifest,
  type CompiledVideo,
  type InteractiveSnapshot,
  type MatchData,
} from "@douga/video";
import { compiledMediaUsages } from "@douga/video/compiled-media";
import { createMeasureText, loadByHash } from "@douga/node";
import { HttpError } from "../http-errors";
import type { VideoService } from "./service";

const SLICE_CACHE = 64;
const FONT_CACHE = 8;
const FILE_PREFIX = "/files/video/";

export interface VideoSlice {
  key: string;
  plan: CompiledVideo;
  /** Public names `<hash><ext>` of every file the slice draws or plays. */
  files: string[];
}

type MeasureText = Awaited<ReturnType<typeof createMeasureText>>;

/**
 * Compiles directives of a game against frozen snapshots on the server:
 * applyMatchData → compileVideo → slicePlan. Pure for one snapshot and directive,
 * so a replay of a match gets the same slices.
 */
export class VideoRuntime {
  private readonly slices = new Map<string, VideoSlice>();
  private readonly fonts = new Map<string, Promise<MeasureText | undefined>>();

  constructor(private readonly video: VideoService) {}

  private measure(id: string, snapshot: InteractiveSnapshot): Promise<MeasureText | undefined> {
    let pending = this.fonts.get(id);
    if (!pending) {
      const names = new Map(snapshot.runtimeFonts.map((font) => [font.hash, `${font.hash}.ttf`]));
      pending = snapshot.runtimeFonts.length
        ? createMeasureText({
            load: loadByHash((hash) => {
              const name = names.get(hash);
              return name ? this.video.filePath(name) : null;
            }),
          })
        : Promise.resolve(undefined);
      pending.catch(() => this.fonts.delete(id));
      if (this.fonts.size >= FONT_CACHE) this.fonts.delete(this.fonts.keys().next().value!);
      this.fonts.set(id, pending);
    }
    return pending;
  }

  /** The slice of one directive; `names` replace player placeholders with seat names. */
  async slice(directive: VideoDirective, names: Record<string, string> = {}): Promise<VideoSlice> {
    const cacheKey = `${directive.key}:${JSON.stringify(names)}`;
    const cached = this.slices.get(cacheKey);
    if (cached) return cached;
    const snapshot = await this.video.manifest(directive.snapshot);
    const measureText = await this.measure(directive.snapshot, snapshot);
    const manifest: AssetManifest = structuredClone(snapshot.manifest);
    for (const asset of Object.values(manifest)) {
      asset.src = `${FILE_PREFIX}${asset.src}`;
      if (asset.posterSrc) asset.posterSrc = `${FILE_PREFIX}${asset.posterSrc}`;
    }
    const data = matchDataFor(snapshot, directive.data ?? null, names);
    const document = applyMatchData(snapshot.document, data);
    const compiled = compileVideo(document, manifest, { measureText });
    const errors = compiled.diagnostics.filter((d) => d.severity === "error" && d.code !== "TEXT_OVERFLOW");
    if (errors.length)
      throw new HttpError(500, "video_compile", `Сцена не собралась: ${errors.map((d) => d.code).slice(0, 3).join(", ")}`);
    let plan: CompiledVideo;
    try {
      plan = slicePlan(compiled.plan, directive.play);
    } catch {
      throw new HttpError(404, "video_scene", "В снимке нет такой сцены");
    }
    const files = new Set<string>();
    for (const usage of compiledMediaUsages(plan)) {
      for (const src of [usage.asset.src, usage.asset.posterSrc])
        if (src?.startsWith(FILE_PREFIX)) files.add(src.slice(FILE_PREFIX.length));
    }
    for (const face of plan.fonts ?? []) {
      face.src = `${FILE_PREFIX}${face.hash}.ttf`;
      face.license = `${FILE_PREFIX}${face.licenseHash}.txt`;
      files.add(`${face.hash}.ttf`);
      files.add(`${face.licenseHash}.txt`);
    }
    const slice = { key: directive.key, plan, files: [...files] };
    if (this.slices.size >= SLICE_CACHE) this.slices.delete(this.slices.keys().next().value!);
    this.slices.set(cacheKey, slice);
    return slice;
  }
}

/**
 * Game data → Douga MatchData. Participant keys may be card ids of the snapshot
 * (`card` of a Quizor option): they become participant ids. Player names come from
 * the lobby seats, never from the game.
 */
export function matchDataFor(
  snapshot: InteractiveSnapshot,
  data: VideoMatchData | null,
  names: Record<string, string>,
): MatchData {
  if (!data) return snapshot.sample;
  const participantIds = new Set(snapshot.document.source.participants.map((p) => p.id));
  const byCard = new Map<string, string>();
  for (const scene of snapshot.scenes)
    for (const choice of scene.choices)
      if (choice.cardId && choice.participantId) byCard.set(choice.cardId, choice.participantId);
  const out: MatchData = structuredClone(data) as MatchData;
  if (data.participants) {
    out.participants = {};
    for (const [key, value] of Object.entries(data.participants)) {
      const id = participantIds.has(key) ? key : byCard.get(key);
      if (id) out.participants[id] = structuredClone(value);
    }
  }
  if (out.players) out.players = out.players.map((p) => ({ ...p, name: names[p.id] ?? p.name }));
  // Parts the game does not send keep the authored sample, as in a linear render.
  return { ...snapshot.sample, ...out };
}

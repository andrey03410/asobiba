import { sliceWindow, type ConfigIssue, type VideoPlay, type VideoSnapshotSummary } from "@asobiba/sdk";

export interface SceneTiming {
  /** Seconds from frame 0 of the slice (cut to the scene of `start`) to where the block starts. */
  startSeconds: number;
  /** Seconds the block plays: to its hold, or to the end of the slice. */
  durationSeconds: number;
}

/** Frames of a slice in the snapshot's full plan, and the hold frames inside it. */
export function sliceFrames(summary: VideoSnapshotSummary, play: VideoPlay) {
  const scenes =
    "segmentId" in play
      ? summary.scenes.filter((s) => s.segmentId === play.segmentId)
      : summary.scenes.filter((s) => play.sceneIds.includes(s.id));
  const segment = "segmentId" in play ? summary.segments.find((s) => s.id === play.segmentId) : undefined;
  if ("segmentId" in play && !segment) return null;
  if ("sceneIds" in play && scenes.length !== new Set(play.sceneIds).size) return null;
  const from = segment?.from ?? Math.min(...scenes.map((s) => s.from));
  const to = segment?.to ?? Math.max(...scenes.map((s) => s.to));
  const holds = scenes.flatMap((s) => s.holds).sort((a, b) => a.frame - b.frame);
  return { from, to, holds, scenes };
}

/**
 * Timing of a `scene` block from the snapshot: written into the frozen config, so the
 * game (which knows nothing about frames) paces the block like any other.
 */
export function sceneTiming(
  summary: VideoSnapshotSummary,
  block: { play: VideoPlay; start?: string; hold?: string },
  path: string,
): SceneTiming | ConfigIssue {
  const frames = sliceFrames(summary, block.play);
  if (!frames)
    return { path: `${path}.play`, code: "video_scene", message: "В снимке нет такого сегмента или сцены", hint: "Возьмите id из video_snapshot_get", severity: "error" };
  const window = sliceWindow(frames.scenes, block.start, block.hold);
  if ("missing" in window)
    return window.missing === "start"
      ? { path: `${path}.start`, code: "video_moment", message: `В куске нет момента ${block.start}`, hint: "Моменты сцен перечислены в video_snapshot_get", severity: "error" }
      : { path: `${path}.hold`, code: "video_moment", message: `После начала блока в куске нет момента ${block.hold}`, hint: "hold должен стоять позже start", severity: "error" };
  // The slice begins with the scene of `start` (see sliceWindow), otherwise with the piece.
  const base = block.start ? window.from : frames.from;
  const startFrame = block.start ? window.startFrame : frames.from;
  const endFrame = window.holdFrame ?? frames.to;
  return {
    startSeconds: (startFrame - base) / summary.fps,
    durationSeconds: Math.max(0.04, (endFrame - startFrame) / summary.fps),
  };
}

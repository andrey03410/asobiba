import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { sliceWindow, type VideoDirective } from "@asobiba/sdk";
import type { ChoiceHit, CompiledVideo } from "@douga/video";
import type { InteractiveEvent } from "@douga/player/InteractivePlayer";
import { loadSlice } from "./slices";

// Remotion and the Douga renderer load only when a game shows a scene.
const InteractivePlayer = lazy(() =>
  import("@douga/player/InteractivePlayer").then((m) => ({ default: m.InteractivePlayer })),
);

export interface VideoStageProps {
  directive: VideoDirective;
  lobbyId: string;
  /** Server clock offset (server − client, ms). */
  clockOffset?: number;
  paused?: boolean;
  muted?: boolean;
  volume?: number;
  /** Scenes the game will show next: fetched early. */
  preload?: VideoDirective[];
  onPick?: (hit: ChoiceHit) => void;
  onEvent?: (event: InteractiveEvent) => void;
  className?: string;
  style?: CSSProperties;
}

/** Frame of the directive's hold in its slice (after its start, as on the server), or null. */
export function holdFrameOf(plan: CompiledVideo, directive: Pick<VideoDirective, "start" | "hold">): number | null {
  if (!directive.hold) return null;
  const window = sliceWindow(plan.interaction?.scenes ?? [], directive.start?.momentId, directive.hold.momentId);
  return "missing" in window ? null : window.holdFrame;
}

/**
 * A Douga scene in step with the game's server clock. The plan slice comes from the
 * server by key; pressable cards report `onPick`. Sound starts after a user gesture.
 */
export function VideoStage(props: VideoStageProps) {
  const { directive, lobbyId, clockOffset = 0, paused = false, muted = false, volume = 1 } = props;
  const [plan, setPlan] = useState<CompiledVideo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const unlock = useRef<((event: ReactMouseEvent) => void) | null>(null);
  const offset = useRef(clockOffset);
  offset.current = clockOffset;

  useEffect(() => {
    let alive = true;
    setError(null);
    loadSlice(lobbyId, directive.key).then(
      (next) => alive && setPlan(next),
      () => alive && setError("Сцена не загрузилась"),
    );
    return () => {
      alive = false;
    };
  }, [lobbyId, directive.key]);

  const preloadKeys = (props.preload ?? []).map((d) => d.key).join(",");
  useEffect(() => {
    for (const key of preloadKeys ? preloadKeys.split(",") : []) void loadSlice(lobbyId, key).catch(() => undefined);
  }, [lobbyId, preloadKeys]);

  const now = useMemo(() => () => Date.now() + offset.current, []);
  const current = plan;
  const holdFrame = current ? holdFrameOf(current, directive) : null;
  const aspect = current ? `${current.width} / ${current.height}` : "16 / 9";

  return (
    <div
      className={props.className}
      data-video-stage=""
      data-video-key={directive.key}
      style={{ position: "relative", width: "100%", aspectRatio: aspect, maxHeight: "100%", margin: "0 auto", background: "#000", borderRadius: 12, overflow: "hidden", ...props.style }}
    >
      {current ? (
        <Suspense fallback={<div style={{ position: "absolute", inset: 0 }} />}>
          <InteractivePlayer
            key={directive.key}
            plan={current}
            startedAt={directive.startedAt}
            now={now}
            holdFrame={holdFrame}
            paused={paused}
            muted={muted}
            volume={volume}
            onPick={props.onPick}
            onUnlockAudio={(fn) => {
              unlock.current = fn;
            }}
            onEvent={(event) => {
              if (event.type === "audio-blocked") setBlocked(true);
              props.onEvent?.(event);
            }}
          />
        </Suspense>
      ) : (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#fff8" }}>
          {error ?? "Загружаем сцену…"}
        </div>
      )}
      {blocked && !muted && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            unlock.current?.(event);
            setBlocked(false);
          }}
          style={{ position: "absolute", right: 12, bottom: 12, padding: "8px 14px", borderRadius: 999, border: 0, background: "#fff", color: "#111", font: "inherit", cursor: "pointer" }}
        >
          🔊 Включить звук
        </button>
      )}
    </div>
  );
}

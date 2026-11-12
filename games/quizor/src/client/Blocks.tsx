import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { blockDuration, type Block } from "../rules";

interface Props {
  blocks: Block[];
  assetUrl(id: string): string;
  now: number;
  startedAt: number;
  muted: boolean;
  paused: boolean;
  compact?: boolean;
  onReady?(): void;
  activeIndex?: number;
}

function InlineText({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
        .map((s, i) =>
          s.startsWith("**") ? (
            <strong key={i}>{s.slice(2, -2)}</strong>
          ) : s.startsWith("*") ? (
            <em key={i}>{s.slice(1, -1)}</em>
          ) : (
            <Fragment key={i}>{s}</Fragment>
          ),
        )}
    </>
  );
}

function Media({
  block,
  assetUrl,
  now,
  startedAt,
  paused,
  muted,
  onReady,
  active,
}: Props & { block: Block; active: boolean }) {
  const ref = useRef<HTMLMediaElement | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState(false);
  const [replays, setReplays] = useState(0);
  const replaying = useRef(false);
  const from = block.from ?? 0;
  const to = block.to;
  const rate = block.speed ?? 1;
  const hideFinishedFrame =
    block.freeze === false &&
    (!active ||
      (to !== undefined &&
        ((now - startedAt) / 1000) * rate >=
          (to - from) * (block.repeat ?? 1))) &&
    !replaying.current;
  useEffect(() => {
    const media = ref.current;
    if (!media) return;
    media.muted = muted || Boolean(block.muted);
    media.volume = block.volume ?? 1;
    media.playbackRate = rate;
    const elapsed = Math.max(0, (now - startedAt) / 1000) * rate;
    const span =
      to === undefined
        ? Number.isFinite(media.duration)
          ? media.duration - from
          : Infinity
        : to - from;
    const finished = elapsed >= span * (block.repeat ?? 1);
    const position =
      from +
      (Number.isFinite(span) && span > 0
        ? finished
          ? span
          : elapsed % span
        : elapsed);
    if (
      active &&
      Number.isFinite(position) &&
      Math.abs(media.currentTime - position) > 0.75
    ) {
      try {
        media.currentTime = position;
      } catch {
        /* metadata has not arrived yet */
      }
    }
    if (paused || (!active && !replaying.current) || (active && finished))
      media.pause();
    else if (media.paused)
      void media
        .play()
        .then(() => setBlocked(false))
        .catch(() => setBlocked(true));
  }, [
    now,
    startedAt,
    active,
    paused,
    muted,
    from,
    to,
    rate,
    block.repeat,
    block.volume,
    block.muted,
  ]);
  useEffect(() => () => ref.current?.pause(), []);
  const replay = () => {
    const media = ref.current;
    if (!media) return;
    const span = (to ?? media.duration) - from;
    media.currentTime = active
      ? from +
        (Number.isFinite(span) && span > 0
          ? Math.max(0, ((now - startedAt) / 1000) * rate) % span
          : 0)
      : from;
    replaying.current = !active;
    void media
      .play()
      .then(() => {
        setBlocked(false);
        if (!active) setReplays((n) => n + 1);
      })
      .catch(() => setBlocked(true));
  };
  const common = {
    ref: (node: HTMLMediaElement | null) => {
      ref.current = node;
    },
    src: assetUrl(block.asset!),
    preload: "metadata" as const,
    muted: muted || block.muted,
    onLoadedData: () => {
      setError(false);
      onReady?.();
    },
    onError: () => {
      setError(true);
      onReady?.();
    },
    onTimeUpdate: () => {
      const media = ref.current;
      if (media && to !== undefined && media.currentTime >= to) {
        if (active && !paused) media.currentTime = from;
        else {
          media.pause();
          replaying.current = false;
        }
      }
    },
    onEnded: () => {
      replaying.current = false;
    },
  };
  return (
    <div className="qz-media">
      {block.type === "video" ? (
        <video
          {...common}
          playsInline
          className={
            block.audioOnly || hideFinishedFrame ? "qz-audio-only" : undefined
          }
          aria-label={block.caption ?? "Видео вопроса"}
        />
      ) : (
        <audio {...common} aria-label={block.caption ?? "Звук вопроса"} />
      )}
      <div className="qz-media-controls">
        <span aria-hidden="true">
          {block.type === "audio" || block.audioOnly ? "♫" : "▶"}
        </span>
        <span>
          {block.caption ??
            (block.type === "audio" ? "Аудиофрагмент" : "Видеофрагмент")}
        </span>
        {blocked && active && (
          <button type="button" onClick={replay}>
            Начать воспроизведение
          </button>
        )}
        {!active && replays < (block.replays ?? 1) && !paused && (
          <button type="button" onClick={replay}>
            Повторить {replays > 0 ? `(${(block.replays ?? 1) - replays})` : ""}
          </button>
        )}
      </div>
      {error && (
        <p role="status">
          Не удалось воспроизвести файл. Проверьте соединение или поддержку
          формата браузером.
        </p>
      )}
    </div>
  );
}

function PixelImage({
  src,
  caption,
  progress,
  onReady,
}: {
  src: string;
  caption: string;
  progress: number;
  onReady?(): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    let active = true;
    const img = new Image();
    img.onload = () => {
      if (active) {
        setSource(img);
        onReadyRef.current?.();
      }
    };
    img.src = src;
    return () => {
      active = false;
    };
  }, [src]);
  useEffect(() => {
    const target = canvas.current;
    if (!target || !source) return;
    const fraction = 0.012 + progress ** 3 * 0.988;
    target.width = Math.max(4, Math.round(source.naturalWidth * fraction));
    target.height = Math.max(4, Math.round(source.naturalHeight * fraction));
    target
      .getContext("2d")
      ?.drawImage(source, 0, 0, target.width, target.height);
  }, [source, progress]);
  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={caption}
      style={{
        display: "block",
        width: "100%",
        maxHeight: 440,
        objectFit: "contain",
        imageRendering: "pixelated",
        aspectRatio: source
          ? `${source.naturalWidth}/${source.naturalHeight}`
          : "16/9",
      }}
    />
  );
}

function Content({
  block,
  now,
  startedAt,
  ...props
}: Props & { block: Block; active: boolean }) {
  const progress = Math.max(
    0,
    Math.min(
      1,
      (now - startedAt) /
        ((block.effectSeconds ?? blockDuration(block) / 1000) * 1000 || 1),
    ),
  );
  if (block.type === "group")
    return (
      <div className={`qz-group qz-group-${block.layout ?? "grid"}`}>
        {(block.blocks ?? []).map((b, i) => (
          <Content
            key={i}
            {...props}
            blocks={[]}
            block={b}
            now={now}
            startedAt={startedAt}
          />
        ))}
      </div>
    );
  if (block.type === "text") {
    const words = (block.text ?? "").split(/\s+/);
    const text =
      block.effect === "words"
        ? words
            .slice(0, Math.max(1, Math.ceil(words.length * progress)))
            .join(" ")
        : block.effect === "hidden-words"
          ? words
              .map((w, i) =>
                i < Math.ceil(words.length * progress)
                  ? w
                  : "▰".repeat(Math.min(w.length, 7)),
              )
              .join(" ")
          : (block.text ?? "");
    return (
      <div
        className={`qz-text qz-text-${block.size ?? "normal"}`}
        style={{ textAlign: block.align ?? "center" }}
      >
        {text.split("\n").map((line, i) => (
          <p key={i}>
            <InlineText text={line.replace(/^[-*] /, "• ")} />
          </p>
        ))}
      </div>
    );
  }
  if (props.compact)
    return block.type === "pause" ? (
      <p>{block.text ?? "Внимание…"}</p>
    ) : (
      <p className="qz-muted">
        {block.caption ??
          (block.type === "image"
            ? "Изображение на общем экране"
            : "Медиа на общем экране")}
      </p>
    );
  if (block.type === "image") {
    const effect = block.effect ?? "none";
    const style: CSSProperties = {
      filter: effect === "blur" ? `blur(${(1 - progress) * 28}px)` : undefined,
      transform:
        effect === "zoom" ? `scale(${1 + (1 - progress) * 3})` : undefined,
      clipPath:
        effect === "spotlight"
          ? `circle(${12 + progress * 65}% at ${30 + progress * 20}% 50%)`
          : undefined,
      imageRendering: effect === "pixelate" ? "pixelated" : undefined,
    };
    return (
      <figure
        className={`qz-image qz-effect-${effect}${block.fullscreen ? " qz-image-full" : ""}`}
      >
        {effect === "pixelate" ? (
          <PixelImage
            src={props.assetUrl(block.asset!)}
            caption={block.caption ?? "Изображение вопроса"}
            progress={progress}
            onReady={props.onReady}
          />
        ) : (
          <img
            src={props.assetUrl(block.asset!)}
            alt={block.caption ?? "Изображение вопроса"}
            style={style}
            onLoad={props.onReady}
          />
        )}
        {effect === "tiles" && (
          <div className="qz-tiles" aria-hidden="true">
            {Array.from({ length: 36 }, (_, i) => (
              <span
                key={i}
                style={{ opacity: ((i * 17) % 36) / 36 < progress ? 0 : 1 }}
              />
            ))}
          </div>
        )}
        {block.caption && <figcaption>{block.caption}</figcaption>}
      </figure>
    );
  }
  if (block.type === "pause")
    return (
      <div className="qz-block-pause">
        <span>{block.text ?? "Внимание…"}</span>
        <b>
          {Math.max(
            0,
            Math.ceil(
              ((block.durationSeconds ?? 0) * 1000 - (now - startedAt)) / 1000,
            ),
          )}
        </b>
      </div>
    );
  return (
    <Media
      {...props}
      blocks={[]}
      block={block}
      now={now}
      startedAt={startedAt}
    />
  );
}

export function Blocks({
  blocks,
  activeIndex = blocks.length - 1,
  ...props
}: Props) {
  let offset = 0;
  return (
    <div className="qz-blocks">
      {blocks.map((block, i) => {
        const start = props.startedAt + offset;
        offset += blockDuration(block);
        return (
          <div
            key={`${i}:${block.type}:${block.asset ?? ""}`}
            className={`qz-block${i === activeIndex ? " is-active" : ""}`}
          >
            <Content
              {...props}
              blocks={[]}
              block={block}
              startedAt={start}
              active={i === activeIndex}
            />
          </div>
        );
      })}
    </div>
  );
}

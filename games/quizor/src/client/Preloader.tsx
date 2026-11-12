import { useEffect, useRef } from "react";

export function Preloader({
  files,
  assetUrl,
  onReady,
}: {
  files: { type: string; asset: string }[];
  assetUrl(id: string): string;
  onReady?(): void;
}) {
  const completed = useRef(new Set<string>());
  const sent = useRef(false);
  const callback = useRef(onReady);
  callback.current = onReady;
  const ready = (asset: string) => {
    completed.current.add(asset);
    if (!sent.current && files.every((f) => completed.current.has(f.asset))) {
      sent.current = true;
      callback.current?.();
    }
  };
  useEffect(() => {
    if (!files.length && !sent.current) {
      sent.current = true;
      callback.current?.();
    }
  }, [files.length]);
  return (
    <div hidden aria-hidden="true">
      {files.map((f) =>
        f.type === "image" ? (
          <img
            key={f.asset}
            src={assetUrl(f.asset)}
            alt=""
            onLoad={() => ready(f.asset)}
            onError={() => ready(f.asset)}
          />
        ) : f.type === "audio" ? (
          <audio
            key={f.asset}
            src={assetUrl(f.asset)}
            preload="auto"
            muted
            onCanPlay={() => ready(f.asset)}
            onError={() => ready(f.asset)}
          />
        ) : (
          <video
            key={f.asset}
            src={assetUrl(f.asset)}
            preload="auto"
            muted
            playsInline
            onCanPlay={() => ready(f.asset)}
            onError={() => ready(f.asset)}
          />
        ),
      )}
    </div>
  );
}

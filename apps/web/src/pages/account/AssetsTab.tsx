import type { AssetDto } from "@asobiba/api";
import { type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../api";
import { CopyButton } from "../../components/CopyButton";
import { useToast } from "../../toast";
import { formatBytes } from "../../util";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,audio/wav,audio/x-wav,audio/mpeg,audio/ogg,audio/mp4,audio/webm,video/mp4,video/webm,.wav,.mp3,.ogg,.m4a,.mp4,.webm";

const SOURCE_LABEL: Record<AssetDto["source"], string> = {
  upload: "загрузка",
  svg: "SVG агента",
  url: "по ссылке",
};

export function AssetsTab() {
  const toast = useToast();
  const [assets, setAssets] = useState<AssetDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.assets();
      setAssets(res.assets);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (files: File[]) => {
    const supported = files.filter((f) => /^(image|audio|video)\//.test(f.type) || /\.(png|jpe?g|gif|webp|wav|mp3|ogg|m4a|mp4|webm)$/i.test(f.name));
    if (supported.length < files.length) toast("Пропустил файлы неподдерживаемого формата", "error");
    if (supported.length === 0) return;
    let ok = 0;
    setProgress({ done: 0, total: supported.length });
    for (const [i, file] of supported.entries()) {
      try {
        await api.uploadAsset(file);
        ok += 1;
      } catch (err) {
        toast(`${file.name}: ${errorMessage(err)}`, "error");
      }
      setProgress({ done: i + 1, total: supported.length });
    }
    setProgress(null);
    if (ok > 0) toast(ok === 1 ? "Файл загружен" : `Загружено файлов: ${ok}`, "success");
    await load();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (progress) return;
    void upload([...e.dataTransfer.files]);
  };

  const remove = async (asset: AssetDto) => {
    if (!window.confirm(`Удалить файл «${asset.name}»? Конфиги, где он используется, перестанут проходить проверку.`)) return;
    try {
      await api.deleteAsset(asset.id);
      toast("Файл удалён", "success");
      await load();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  return (
    <div className="stack">
      <section className="card">
        <h2>Мои файлы</h2>
        <p className="muted">
          Картинки, звук и видео для игр. Передайте агенту id файла (<code>ast_…</code>), чтобы добавить его в конфиг.
          Картинки PNG, JPEG, WebP и GIF — до 2 МБ и 2048 px по стороне. Звук WAV, MP3, OGG, M4A и видео MP4, WebM — до 1 ГиБ на файл.
          Пул — до 10 ГиБ, медиа одного квиза — до 1 ГиБ. Файлы не перекодируются: возможность воспроизведения зависит от кодека и браузера.
        </p>
        <div
          className={`dropzone${dragging ? " is-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {progress ? (
            <p>
              Загружаю {progress.done + 1 > progress.total ? progress.total : progress.done + 1} из {progress.total}…
            </p>
          ) : (
            <>
              <p>Перетащите файлы сюда или</p>
              <button type="button" className="btn btn-primary" onClick={() => input.current?.click()}>
                Выбрать файлы
              </button>
            </>
          )}
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              void upload(files);
            }}
          />
        </div>
      </section>

      <section className="card">
        {error && <div className="notice notice-error">{error}</div>}
        {assets === null && !error && <p className="muted">Загружаю…</p>}
        {assets && assets.length === 0 && <p className="muted">Файлов пока нет.</p>}
        {assets && assets.length > 0 && (
          <ul className="asset-grid">
            {assets.map((a) => (
              <li key={a.id} className="asset">
                <div className="asset-thumb">
                  {a.mime.startsWith("audio/") ? <audio src={a.url} controls preload="metadata" aria-label={a.name} style={{ width: "100%" }} /> :
                    a.mime.startsWith("video/") ? <video src={a.url} controls preload="metadata" aria-label={a.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> :
                    <img src={a.url} alt={a.name} loading="lazy" />}
                </div>
                <div className="asset-info">
                  <b className="asset-name" title={a.name}>
                    {a.name}
                  </b>
                  <span className="muted small">
                    {a.mime.startsWith("image/") ? `${a.width}×${a.height} · ` : ""}{formatBytes(a.bytes)} · {SOURCE_LABEL[a.source] ?? a.source}
                  </span>
                  <span className="asset-id">
                    <code>{a.id}</code>
                    <CopyButton text={a.id} label="id" className="btn btn-tiny" />
                  </span>
                </div>
                <button type="button" className="btn btn-danger btn-tiny asset-delete" onClick={() => remove(a)} aria-label={`Удалить ${a.name}`}>
                  Удалить
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

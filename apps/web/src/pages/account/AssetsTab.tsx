import type { AssetDto } from "@asobiba/api";
import { type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../api";
import { CopyButton } from "../../components/CopyButton";
import { useToast } from "../../toast";
import { formatBytes } from "../../util";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

const SOURCE_LABEL: Record<AssetDto["source"], string> = {
  upload: "загружена",
  svg: "нарисована агентом",
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
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length < files.length) toast("Пропустил файлы, которые не похожи на картинки", "error");
    if (images.length === 0) return;
    let ok = 0;
    setProgress({ done: 0, total: images.length });
    for (const [i, file] of images.entries()) {
      try {
        await api.uploadAsset(file);
        ok += 1;
      } catch (err) {
        toast(`${file.name}: ${errorMessage(err)}`, "error");
      }
      setProgress({ done: i + 1, total: images.length });
    }
    setProgress(null);
    if (ok > 0) toast(ok === 1 ? "Картинка загружена" : `Загружено картинок: ${ok}`, "success");
    await load();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (progress) return;
    void upload([...e.dataTransfer.files]);
  };

  const remove = async (asset: AssetDto) => {
    if (!window.confirm(`Удалить картинку «${asset.name}»? Конфиги, где она стоит, перестанут проходить проверку.`)) return;
    try {
      await api.deleteAsset(asset.id);
      toast("Картинка удалена", "success");
      await load();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  return (
    <div className="stack">
      <section className="card">
        <h2>Мои картинки</h2>
        <p className="muted">
          Свои фигуры, фон поля и клетки. Вставьте id картинки (<code>ast_…</code>) в слот визуала конфига или попросите агента взять её из пула. PNG, JPEG, WebP или
          GIF, до 2 МБ и 2048 px по стороне.
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
              <p>Перетащите картинки сюда или</p>
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
        {assets && assets.length === 0 && <p className="muted">Картинок пока нет.</p>}
        {assets && assets.length > 0 && (
          <ul className="asset-grid">
            {assets.map((a) => (
              <li key={a.id} className="asset">
                <div className="asset-thumb">
                  <img src={a.url} alt={a.name} loading="lazy" />
                </div>
                <div className="asset-info">
                  <b className="asset-name" title={a.name}>
                    {a.name}
                  </b>
                  <span className="muted small">
                    {a.width}×{a.height} · {formatBytes(a.bytes)} · {SOURCE_LABEL[a.source] ?? a.source}
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

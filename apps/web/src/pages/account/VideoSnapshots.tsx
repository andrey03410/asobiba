import type { VideoSnapshotDto } from "@asobiba/api";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../api";
import { CopyButton } from "../../components/CopyButton";
import { useToast } from "../../toast";
import { formatBytes, plural } from "../../util";

/** «Ролики douga»: interactive snapshots imported by token (task 07). */
export function VideoSnapshots() {
  const toast = useToast();
  const [rows, setRows] = useState<VideoSnapshotDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows((await api.videoSnapshots()).snapshots);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const importToken = async () => {
    setBusy(true);
    try {
      const res = await api.importVideoSnapshot(token.trim());
      toast(res.reused ? "Этот ролик уже в пуле" : `Ролик «${res.snapshot.title}» импортирован`, "success");
      setToken("");
      await load();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: VideoSnapshotDto) => {
    if (!window.confirm(`Удалить ролик «${row.title}»?`)) return;
    try {
      await api.deleteVideoSnapshot(row.id);
      toast("Ролик удалён", "success");
      await load();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  return (
    <section className="card" data-testid="video-snapshots">
      <h2>Ролики douga</h2>
      <p className="muted">
        Интерактивные ролики из douga для видео-квизов. В douga опубликуйте проект как интерактивный
        (<code>video_interactive_publish</code>) и вставьте сюда токен. Ролик копируется в пул целиком:
        игры идут, даже если douga выключена.
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (token.trim()) void importToken();
        }}
      >
        <input
          className="input"
          placeholder="Токен douga"
          value={token}
          maxLength={200}
          onChange={(e) => setToken(e.target.value)}
          aria-label="Токен douga"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !token.trim()}>
          {busy ? "Импортирую…" : "Импортировать"}
        </button>
      </form>
      {error && <div className="notice notice-error">{error}</div>}
      {rows === null && !error && <p className="muted">Загружаю…</p>}
      {rows && rows.length === 0 && <p className="muted">Роликов пока нет.</p>}
      {rows && rows.length > 0 && (
        <ul className="video-snapshots">
          {rows.map((row) => (
            <li key={row.id} className="row" style={{ justifyContent: "space-between", gap: 12, marginTop: 10 }}>
              <span>
                <b>{row.title}</b>{" "}
                <span className="muted small">
                  ревизия {row.revision} · {row.scenes} {plural(row.scenes, ["сцена", "сцены", "сцен"])} · {formatBytes(row.bytes)}
                </span>
              </span>
              <span className="row" style={{ gap: 8 }}>
                <code>{row.id}</code>
                <CopyButton text={row.id} label="id" className="btn btn-tiny" />
                <button type="button" className="btn btn-danger btn-tiny" onClick={() => remove(row)}>
                  Удалить
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

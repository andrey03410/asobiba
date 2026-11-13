import type { ConfigDto } from "@asobiba/api";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { api, assetUrl, errorMessage } from "../../api";
import { catalog, gameClient } from "../../games";
import { useToast } from "../../toast";
import { formatDate } from "../../util";

function seatCount(config: ConfigDto): number {
  try {
    return catalog.get(config.gameId)?.seats(config.document.rules).max ?? 0;
  } catch {
    return 0;
  }
}

function SeatIcons({ config }: { config: ConfigDto }) {
  const client = gameClient(config.gameId);
  const seats = seatCount(config);
  if (!client || seats <= 0) return null;
  return (
    <span className="config-icons" aria-hidden="true">
      {Array.from({ length: seats }, (_, seat) => (
        <client.SeatIcon key={seat} config={config.document} seat={seat} assetUrl={assetUrl} size={22} />
      ))}
    </span>
  );
}

export function ConfigsTab() {
  const toast = useToast();
  const [configs, setConfigs] = useState<ConfigDto[] | null>(null);
  const [games, setGames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.configs();
      setConfigs(res.configs);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
    api
      .games()
      .then((res) => setGames(Object.fromEntries(res.games.map((g) => [g.id, g.title]))))
      .catch(() => {});
  }, [load]);

  const remove = async (config: ConfigDto) => {
    if (!window.confirm(`Удалить конфиг «${config.title}»? Лобби, созданные из него, не пострадают.`)) return;
    try {
      await api.deleteConfig(config.id);
      toast("Конфиг удалён", "success");
      await load();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Мои конфиги</h2>
        <Link to="/new" className="btn btn-small">
          Собрать новый
        </Link>
      </div>
      <p className="muted">Сохранённые настройки игр — ваши и собранные агентом. Лобби берёт копию конфига, поэтому правка конфига не меняет идущие игры.</p>
      {error && <div className="notice notice-error">{error}</div>}
      {configs === null && !error && <p className="muted">Загружаю…</p>}
      {configs && configs.length === 0 && <p className="muted">Сохранённых конфигов пока нет. Отметьте «Сохранить в мои конфиги», когда создаёте лобби.</p>}
      {configs && configs.length > 0 && (
        <ul className="rows">
          {configs.map((c) => (
            <li key={c.id} className="row">
              <div className="row-main">
                <span className="row-title">
                  <SeatIcons config={c} />
                  <b>{c.title}</b>
                  {usesVideo(c.document) && <span className="badge" title="Сцены роликов douga">видео</span>}
                </span>
                <span className="muted small">
                  {games[c.gameId] ?? c.gameId} · изменён {formatDate(c.updatedAt)} · <code>{c.id}</code>
                </span>
              </div>
              <div className="row-actions">
                <Link to={`/new?config=${encodeURIComponent(c.id)}`} className="btn btn-primary btn-small">
                  Создать лобби
                </Link>
                <button type="button" className="btn btn-danger btn-small" onClick={() => remove(c)}>
                  Удалить
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Configs that play Douga scenes (task 07). */
function usesVideo(document: unknown): boolean {
  const rules = (document as { rules?: { video?: unknown } } | null)?.rules;
  return Boolean(rules && typeof rules === "object" && rules.video);
}

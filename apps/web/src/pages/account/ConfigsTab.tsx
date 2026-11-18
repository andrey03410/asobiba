import type { ConfigListItem } from "@asobiba/api";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, errorMessage } from "../../api";
import { ConfigNameAction } from "../../components/ConfigNameAction";
import { useToast } from "../../toast";
import { formatDate } from "../../util";

const statusLabels: Record<ConfigListItem["validationStatus"], string> = {
  valid: "Готов к запуску",
  invalid: "Требует исправления",
  unavailable: "Проверка недоступна",
};

export function ConfigsTab() {
  const toast = useToast();
  const navigate = useNavigate();
  const [configs, setConfigs] = useState<ConfigListItem[] | null>(null);
  const [games, setGames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

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
    api.games()
      .then((res) => setGames(Object.fromEntries(res.games.map((game) => [game.id, game.title]))))
      .catch(() => {});
  }, [load]);

  async function create(configId: string) {
    if (creating) return;
    setCreating(configId);
    try {
      const { lobby } = await api.createLobby({ configId });
      navigate("/lobby/" + encodeURIComponent(lobby.id));
    } catch (err) {
      toast(errorMessage(err), "error");
      await load();
    } finally {
      setCreating(null);
    }
  }

  async function remove(config: ConfigListItem) {
    if (!window.confirm(`Удалить конфиг «${config.title}»? Лобби сохранят свои настройки.`)) return;
    try {
      await api.deleteConfig(config.id);
      toast("Конфиг удалён", "success");
      await load();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Мои конфиги</h2>
        <Link to="/new" className="btn btn-small">Добавить JSON</Link>
      </div>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {configs === null && !error && <p role="status">Загружаю и проверяю конфиги…</p>}
      {configs?.length === 0 && (
        <p className="muted">Здесь будут сценарии, которые вы сохранили из лобби, в редакторе или через агента.</p>
      )}
      {configs && configs.length > 0 && (
        <ul className="rows">
          {configs.map((config) => (
            <li key={config.id} className="row saved-config-row">
              <div className="row-main">
                <b>{config.title}</b>
                <span className="muted small">
                  {games[config.gameId] ?? (config.gameId || "Игра не указана")} · изменён {formatDate(config.updatedAt)}
                </span>
                <span className="small"><code>{config.id}</code> · {statusLabels[config.validationStatus]}</span>
              </div>
              <div className="row-actions">
                {config.validationStatus === "valid" && (
                  <button type="button" className="btn btn-primary btn-small" disabled={creating !== null} onClick={() => void create(config.id)}>
                    {creating === config.id ? "Создаю…" : "Создать лобби"}
                  </button>
                )}
                <Link to={`/new?config=${encodeURIComponent(config.id)}`} className="btn btn-small">Править JSON</Link>
                <ConfigNameAction
                  label="Переименовать"
                  initialName={config.title}
                  className="btn btn-small"
                  submit={(name) => api.renameConfig(config.id, name)}
                  onSaved={() => void load()}
                  rename
                />
                <button type="button" className="btn btn-danger btn-small" onClick={() => void remove(config)}>
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

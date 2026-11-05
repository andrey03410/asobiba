import type { LobbySummaryDto } from "@asobiba/api";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { api, errorMessage } from "../api";
import { useUser } from "../auth";
import { StatusBadge } from "../components/StatusBadge";
import { formatDate, plural, useTitle } from "../util";

const REFRESH_MS = 5000;

function LobbyCard({ lobby }: { lobby: LobbySummaryDto }) {
  const full = lobby.players >= lobby.seats;
  return (
    <Link to={`/lobby/${lobby.id}`} className={`card lobby-card lobby-card-${lobby.status}`}>
      <div className="lobby-card-top">
        <StatusBadge status={lobby.status} />
        <span className={`seats${full ? " seats-full" : ""}`} title="Игроков / мест">
          {lobby.players}/{lobby.seats}
        </span>
      </div>
      <h3 className="lobby-card-name">{lobby.name}</h3>
      <p className="lobby-card-game">
        {lobby.gameTitle}
        {lobby.configTitle && lobby.configTitle !== lobby.gameTitle ? <> · {lobby.configTitle}</> : null}
      </p>
      <p className="lobby-card-meta muted">
        хозяин {lobby.host} · {formatDate(lobby.createdAt)}
      </p>
    </Link>
  );
}

export function HomePage() {
  useTitle("Лобби");
  const user = useUser();
  const [lobbies, setLobbies] = useState<LobbySummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.lobbies();
      setLobbies(res.lobbies);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [load]);

  const open = lobbies?.filter((l) => l.status === "waiting").length ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Лобби</h1>
          <p className="muted">
            Привет, {user.login}!{" "}
            {lobbies && lobbies.length > 0
              ? open > 0
                ? `${open} ${plural(open, ["лобби ждёт", "лобби ждут", "лобби ждут"])} игроков.`
                : "Свободных лобби пока нет — создайте своё."
              : null}
          </p>
        </div>
        <Link to="/new" className="btn btn-primary">
          Создать лобби
        </Link>
      </div>

      {error && <div className="notice notice-error">Не удалось обновить список: {error}</div>}

      {lobbies === null && !error && <div className="page-loading">Загружаю лобби…</div>}

      {lobbies && lobbies.length === 0 && (
        <div className="empty">
          <p className="empty-mark" aria-hidden="true">
            空
          </p>
          <p>Пока ни одного лобби.</p>
          <p className="muted">Создайте игру сами или попросите своего ИИ-агента собрать её через MCP.</p>
          <Link to="/new" className="btn btn-primary">
            Создать лобби
          </Link>
        </div>
      )}

      {lobbies && lobbies.length > 0 && (
        <div className="lobby-grid">
          {lobbies.map((l) => (
            <LobbyCard key={l.id} lobby={l} />
          ))}
        </div>
      )}
    </div>
  );
}

import { rulesText, type JinchiRules } from "@asobiba/game-jinchi";
import type { LobbyDto, LobbyMemberDto } from "@asobiba/api";
import type { Seat } from "@asobiba/sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ApiRequestError, api, assetUrl, errorMessage } from "../api";
import { useUser } from "../auth";
import { ConfigPreview } from "../components/ConfigPreview";
import { CopyButton } from "../components/CopyButton";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { MatchHud } from "../components/MatchHud";
import { StatusBadge } from "../components/StatusBadge";
import { gameClient, type WebGameClient } from "../games";
import { useToast } from "../toast";
import { useLobbySocket } from "../useLobbySocket";
import { plural, useTitle } from "../util";

function byJoin(a: LobbyMemberDto, b: LobbyMemberDto) {
  return a.joinedAt.localeCompare(b.joinedAt);
}

function MemberList({ lobby, client, meId }: { lobby: LobbyDto; client: WebGameClient | undefined; meId: string }) {
  const players = lobby.members.filter((m) => m.role === "player").sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99) || byJoin(a, b));
  const spectators = lobby.members.filter((m) => m.role === "spectator").sort(byJoin);
  const free = Math.max(0, lobby.seats - players.length);

  const marks = (m: LobbyMemberDto) => (
    <>
      {m.userId === lobby.host.id && <span className="host-mark">хозяин</span>}
      {m.userId === meId && <span className="me-mark">вы</span>}
    </>
  );

  return (
    <div className="members">
      <h3>
        Игроки <span className="muted">{players.length}/{lobby.seats}</span>
      </h3>
      <ul className="member-list">
        {players.map((m, i) => (
          <li key={m.userId} className="member">
            {m.seat !== null && client ? (
              <span className="member-icon" title={`Место ${m.seat + 1}`}>
                <client.SeatIcon config={lobby.config} seat={m.seat} assetUrl={assetUrl} size={28} />
              </span>
            ) : (
              <span className="member-order" title="Порядок входа: места раздаются по нему">
                {i + 1}
              </span>
            )}
            <span className="member-login">{m.login}</span>
            {marks(m)}
          </li>
        ))}
        {Array.from({ length: free }, (_, k) => (
          <li key={`free${k}`} className="member member-free">
            <span className="member-order">{players.length + k + 1}</span>
            <span className="muted">свободное место</span>
          </li>
        ))}
      </ul>
      {spectators.length > 0 && (
        <>
          <h3>
            Зрители <span className="muted">{spectators.length}</span>
          </h3>
          <ul className="member-list">
            {spectators.map((m) => (
              <li key={m.userId} className="member member-spectator">
                <span className="member-order" aria-hidden="true">
                  見
                </span>
                <span className="member-login">{m.login}</span>
                {marks(m)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function LobbyPage() {
  const { id = "" } = useParams();
  const user = useUser();
  const toast = useToast();
  const onSocketError = useCallback((_code: string, message: string) => toast(message, "error"), [toast]);
  const socket = useLobbySocket(id, onSocketError);
  const [lobby, setLobby] = useState<LobbyDto | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useTitle(lobby?.name ?? "Лобби");

  useEffect(() => {
    let alive = true;
    setLobby(null);
    setLoadError(null);
    api
      .lobby(id)
      .then((res) => alive && setLobby(res.lobby))
      .catch((err) => alive && setLoadError({ status: err instanceof ApiRequestError ? err.status : 0, message: errorMessage(err) }));
    return () => {
      alive = false;
    };
  }, [id]);

  // The socket pushes the lobby after every change, including other people's.
  useEffect(() => {
    if (socket.lobby) setLobby(socket.lobby);
  }, [socket.lobby]);

  const run = async (action: () => Promise<{ lobby: LobbyDto }>, done?: string) => {
    setBusy(true);
    try {
      const res = await action();
      setLobby(res.lobby);
      if (done) toast(done, "success");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const seatNames = useMemo(() => {
    const map = new Map<Seat, string>();
    for (const m of lobby?.members ?? []) if (m.seat !== null && m.role === "player") map.set(m.seat, m.login);
    return map;
  }, [lobby]);
  const seatName = useCallback((seat: Seat) => seatNames.get(seat) ?? `Место ${seat + 1}`, [seatNames]);

  if (loadError && !lobby) {
    return (
      <div className="page">
        <div className="empty">
          <p className="empty-mark" aria-hidden="true">
            迷
          </p>
          <h1>{loadError.status === 404 ? "Лобби не найдено" : "Не удалось открыть лобби"}</h1>
          <p className="muted">{loadError.status === 404 ? "Возможно, его закрыли или в ссылке опечатка." : loadError.message}</p>
          <Link to="/" className="btn btn-primary">
            К списку лобби
          </Link>
        </div>
      </div>
    );
  }
  if (!lobby) return <div className="page-loading">Открываю лобби…</div>;

  const client = gameClient(lobby.gameId);
  const me = lobby.members.find((m) => m.userId === user.id);
  const isHost = lobby.host.id === user.id;
  const players = lobby.members.filter((m) => m.role === "player").length;
  const match = socket.match;
  const mySeat = socket.seat;
  const open = lobby.status === "waiting" || lobby.status === "finished";
  const canStart = isHost && open && players >= lobby.minPlayers;
  const missing = Math.max(0, lobby.minPlayers - players);
  const link = lobby.url || window.location.href;

  const onAction = (action: unknown) => {
    if (!socket.sendAction(action)) toast("Нет связи с сервером — ход не отправлен", "error");
  };

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <div className="lobby-title-row">
            <h1>{lobby.name}</h1>
            <StatusBadge status={lobby.status} />
            {socket.status !== "open" && <span className="badge badge-offline">{socket.status === "connecting" ? "подключаюсь…" : "нет связи, переподключаюсь…"}</span>}
          </div>
          <p className="muted">
            {lobby.gameTitle} · {lobby.config.title} · хозяин {lobby.host.login}
          </p>
        </div>
        <CopyButton text={link} label="Скопировать ссылку" className="btn" toast="Ссылка на лобби скопирована — отправьте её друзьям" />
      </div>

      {lobby.status === "closed" && <div className="notice">Хозяин закрыл это лобби. Партии здесь больше не будет.</div>}

      <div className="lobby-grid-layout">
        <section className="lobby-board">
          {match && client ? (
            <>
              <MatchHud match={match} config={lobby.config} client={client} mySeat={mySeat} seatName={seatName} clockOffset={socket.clockOffset} />
              <ErrorBoundary resetKey={match}>
                <div className={`board-frame${lobby.gameId === "jinchi" ? " board-frame-jinchi" : ""}${mySeat === null ? " is-spectator" : ""}`}>
                  <client.Board match={match} config={lobby.config} seat={mySeat} assetUrl={assetUrl} onAction={mySeat !== null ? onAction : undefined} playerNames={Array.from({ length: match.seats }, (_, i) => seatName(i))} clockOffset={socket.clockOffset} />
                </div>
              </ErrorBoundary>
              {mySeat === null && <p className="muted small center">Вы смотрите партию как зритель.</p>}
            </>
          ) : client ? (
            <div className="waiting-board">
              <p className="waiting-note">
                {lobby.status === "closed"
                  ? "Лобби закрыто."
                  : missing > 0
                    ? `Ждём ${missing} ${plural(missing, ["игрока", "игроков", "игроков"])}, потом хозяин начнёт партию.`
                    : isHost
                      ? "Все в сборе — можно начинать."
                      : "Все в сборе — ждём, когда хозяин начнёт."}
              </p>
              <ConfigPreview config={lobby.config} moment="start" seed={1} />
            </div>
          ) : (
            <div className="notice">Сайт пока не умеет рисовать игру «{lobby.gameTitle}».</div>
          )}
        </section>

        <aside className="lobby-side">
          <section className="card">
            <MemberList lobby={lobby} client={client} meId={user.id} />
            <div className="lobby-actions">
              {lobby.status !== "closed" && !me && (
                <>
                  {open && players < lobby.seats && (
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => api.joinLobby(lobby.id, "player"), "Вы в игре")}>
                      Играть
                    </button>
                  )}
                  <button type="button" className="btn" disabled={busy} onClick={() => run(() => api.joinLobby(lobby.id, "spectator"))}>
                    Смотреть
                  </button>
                </>
              )}
              {me?.role === "spectator" && open && players < lobby.seats && (
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => api.joinLobby(lobby.id, "player"), "Вы в игре")}>
                  Стать игроком
                </button>
              )}
              {isHost && open && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !canStart}
                  title={canStart ? undefined : `Нужно ещё ${missing} ${plural(missing, ["игрок", "игрока", "игроков"])}`}
                  onClick={() => run(() => api.startLobby(lobby.id))}
                >
                  {lobby.status === "finished" ? "Сыграть ещё" : "Начать"}
                </button>
              )}
              {me && !isHost && lobby.status !== "closed" && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy || (me.role === "player" && lobby.status === "playing")}
                  title={me.role === "player" && lobby.status === "playing" ? "Из идущей партии выйти нельзя" : undefined}
                  onClick={() => run(() => api.leaveLobby(lobby.id), "Вы вышли из лобби")}
                >
                  Выйти из лобби
                </button>
              )}
              {isHost && lobby.status !== "closed" && (
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("Закрыть лобби? Партия прервётся, а лобби пропадёт из списка.")) void run(() => api.closeLobby(lobby.id), "Лобби закрыто");
                  }}
                >
                  Закрыть лобби
                </button>
              )}
            </div>
            {isHost && open && !canStart && missing > 0 && (
              <p className="muted small">
                Начать можно, когда наберётся {lobby.minPlayers} {plural(lobby.minPlayers, ["игрок", "игрока", "игроков"])}.
              </p>
            )}
          </section>

          {lobby.gameId === 'jinchi' && <details className="card config-details">
            <summary>Правила Jinchi</summary>
            <ul className="lobby-rules">{rulesText(lobby.config.rules as JinchiRules).map((rule, i) => <li key={i}>{rule}</li>)}</ul>
          </details>}
          <details className="card config-details">
            <summary>Конфиг игры</summary>
            <pre className="config-json">{JSON.stringify(lobby.config, null, 2)}</pre>
          </details>
        </aside>
      </div>
    </div>
  );
}

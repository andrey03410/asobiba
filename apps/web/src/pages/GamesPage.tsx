import type { GameGuide, GameSummary } from "@asobiba/sdk";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { api, errorMessage } from "../api";
import { lastLobbyPath, useUser } from "../auth";
import { agentRoleName } from "../components/AgentParticipation";
import { CopyBlock } from "../components/CopyButton";
import { useTitle } from "../util";

export function GamesPage() {
  useTitle("Игры");
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.games().then(({ games }) => {
      if (alive) setGames(games);
    }).catch((err) => {
      if (alive) setError(errorMessage(err));
    });
    return () => { alive = false; };
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Игры</h1>
        <Link className="btn" to="/new">Создать из JSON</Link>
      </div>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {!games && !error && <p role="status">Загружаю игры…</p>}
      <div className="lobby-grid">
        {games?.map((game) => (
          <section key={game.id} className="card game-catalog-card">
            <h2>{game.title}</h2>
            <p>{game.summary}</p>
            <Link className="btn" to={`/games/${encodeURIComponent(game.id)}`} aria-label={`Что можно настроить — ${game.title}`}>
              Что можно настроить
            </Link>
          </section>
        ))}
      </div>
    </div>
  );
}

export function GameGuidePage() {
  const { id = "" } = useParams();
  const user = useUser();
  return <GameGuideContent key={user.id + ":" + id} id={id} guest={user.role === "guest"} />;
}

function GameGuideContent({ id, guest }: { id: string; guest: boolean }) {
  const [guide, setGuide] = useState<GameGuide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { state } = useLocation();
  const lobbyPath = typeof state?.fromLobbyId === "string"
    ? "/lobby/" + encodeURIComponent(state.fromLobbyId)
    : guest ? lastLobbyPath() : null;
  useTitle(guide ? `${guide.title} — настройки игры` : "Настройки игры");

  useEffect(() => {
    let alive = true;
    api.gameGuide(id).then(({ guide }) => {
      if (alive) setGuide(guide);
    }).catch((err) => {
      if (alive) setError(errorMessage(err));
    });
    return () => { alive = false; };
  }, [id]);

  return (
    <div className="page game-guide">
      <div className="page-head">
        <h1>{guide?.title ?? "Настройки игры"}</h1>
        {lobbyPath
          ? <Link className="btn" to={lobbyPath}>Вернуться в лобби</Link>
          : !guest && <Link className="btn" to="/games">Все игры</Link>}
      </div>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {!guide && !error && <p role="status">Загружаю справку…</p>}
      {guide && (
        <div className="stack">
          <section className="card">
            <p>{guide.info.overview}</p>
            <p><strong>Цель игры.</strong> {guide.info.goal}</p>
            <p><strong>Как проходит ход.</strong> {guide.info.turn}</p>
          </section>
          <section className="card">
            <h2>Что можно настроить</h2>
            <div className="game-tuning">
              {guide.tuning.map((direction) => (
                <section key={direction.id}>
                  <h3>{direction.title}</h3>
                  <p>{direction.description}</p>
                  <ul className="lobby-rules">
                    {direction.options.map(({ label, consequence }) => (
                      <li key={label}><strong>{label}.</strong> {consequence}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </section>
          {!!guide.ai?.length && (
            <section className="card">
              <h2>ИИ в игре</h2>
              <div className="game-tuning">
                {guide.ai.map(({ role, description, example }) => (
                  <section key={role}>
                    <h3>{agentRoleName[role]}</h3>
                    <p>{description}</p>
                    <p>«{example}»</p>
                  </section>
                ))}
              </div>
            </section>
          )}
          {guide.promptExamples.length > 0 && (
            <section className="card">
              <h2>Примеры запросов агенту</h2>
              <ul className="lobby-rules">{guide.promptExamples.map((prompt) => <li key={prompt}>{prompt}</li>)}</ul>
            </section>
          )}
          {guide.exampleConfig && (
            <section className="card">
              <div className="card-head">
                <h2>Пример JSON-конфига</h2>
                {!guest && <Link className="btn" to={`/new?game=${encodeURIComponent(guide.id)}&example=1`}>Открыть в редакторе</Link>}
              </div>
              <CopyBlock text={JSON.stringify(guide.exampleConfig, null, 2)} label="Скопировать JSON" />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

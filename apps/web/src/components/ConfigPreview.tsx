import type { ConfigDocument } from "@asobiba/sdk";
import { useMemo } from "react";
import { assetUrl } from "../api";
import { gameClient } from "../games";
import { ErrorBoundary } from "./ErrorBoundary";

interface Props {
  config: ConfigDocument;
  moment: "start" | "end";
  seed: number;
}

function PreviewBoard({ config, moment, seed }: Props) {
  const client = gameClient(config.game);
  const match = useMemo(() => (client ? client.previewMatch(config, moment, seed) : null), [client, config, moment, seed]);
  if (!client || !match) return <div className="notice">Сайт пока не умеет рисовать игру «{config.game}».</div>;
  const { Board, SeatIcon } = client;
  const summary = match.lastRound?.summary ?? (match.lastRound?.draw ? "Ничья" : null);
  return (
    <>
      <div className="board-frame">
        <Board match={match} config={config} seat={null} assetUrl={assetUrl} staticRender />
      </div>
      <div className="preview-seats">
        {Array.from({ length: match.seats }, (_, seat) => (
          <span key={seat} className="preview-seat">
            <SeatIcon config={config} seat={seat} assetUrl={assetUrl} size={24} />
            Игрок {seat + 1}
          </span>
        ))}
      </div>
      {moment === "end" && match.phase === "playing" && !match.lastRound && <p className="preview-summary muted">Показан промежуточный ход — партия на этой карте ещё не завершена.</p>}
      {moment === "end" && summary && <p className="preview-summary muted">{summary}</p>}
    </>
  );
}

/** Static board of a sample position, the same renderer the lobby uses. */
export function ConfigPreview(props: Props) {
  const key = useMemo(() => `${JSON.stringify(props.config)}|${props.moment}|${props.seed}`, [props.config, props.moment, props.seed]);
  return (
    <ErrorBoundary resetKey={key}>
      <PreviewBoard {...props} />
    </ErrorBoundary>
  );
}

import type { LobbyAgentCommand, LobbyDto } from "@asobiba/api";
import { useState } from "react";
import { CopyButton } from "./CopyButton";

export const agentRoleName = {
  observer: "Наблюдатель",
  commentator: "Комментатор",
  presenter: "Ведущий",
};

const statusName = {
  waiting: "Ждёт подключения",
  connected: "На связи",
  disconnected: "Нет связи",
};

export function AgentParticipation({
  lobby,
  compact = false,
}: {
  lobby: Pick<LobbyDto, "agent" | "agentNotice" | "agentComments">;
  compact?: boolean;
}) {
  const { agent, agentNotice, agentComments } = lobby;
  const comments = compact ? agentComments?.slice(-1) : agentComments;
  if (!agent && !agentNotice && !comments?.length) return null;

  return (
    <div className={compact ? "agent-participation agent-participation-compact" : "agent-participation"}>
      {agent && (
        <p className="agent-presence" role="status">
          <strong>{agentRoleName[agent.role]} · ИИ</strong>
          <span className="agent-status" data-status={agent.status}>{statusName[agent.status]}</span>
        </p>
      )}
      {agentNotice && <p className="agent-notice" role="status">{agentNotice}</p>}
      <div role="log" aria-label="Комментарии ИИ">
        {!!comments?.length && (
          <ul className="agent-comments">
            {comments.map(({ id, text }) => <li key={id}><strong>ИИ</strong> {text}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

export function AgentRecovery({
  lobby,
  busy,
  onAction,
}: {
  lobby: LobbyDto;
  busy: boolean;
  onAction: (action: LobbyAgentCommand) => void;
}) {
  const eligible = lobby.members.filter(
    (member) => member.role === "spectator" && member.seat === null && member.eligiblePresenter === true,
  );
  const [selected, setSelected] = useState("");
  const selectedId = eligible.some((member) => member.userId === selected) ? selected : "";

  return (
    <div className="agent-recovery">
      <details>
        <summary>Переподключить ИИ</summary>
        <p>Вернитесь в тот же чат и попросите ИИ снова подключиться к партии по ссылке.</p>
        <p className="agent-reconnect-link">{lobby.url}</p>
        <CopyButton text={lobby.url} label="Скопировать ссылку" />
      </details>
      <form className="agent-recovery-human" onSubmit={(event) => {
        event.preventDefault();
        if (selectedId && !busy) onAction({ action: "human", userId: selectedId });
      }}>
        {eligible.length === 0 ? (
          <p className="muted small">Чтобы назначить человека, пригласите зрителя.</p>
        ) : (
          <label className="sf-field">
            <span>Зритель</span>
            <select value={selectedId} onChange={(event) => setSelected(event.target.value)} disabled={busy}>
              <option value="">Выберите зрителя</option>
              {eligible.map(({ userId, login }) => <option key={userId} value={userId}>{login}</option>)}
            </select>
          </label>
        )}
        <button type="submit" className="btn" disabled={!selectedId || busy}>Назначить человека</button>
      </form>
      <div className="row-actions">
        {lobby.agent?.canUseAlgorithm && (
          <button type="button" className="btn" disabled={busy} onClick={() => onAction({ action: "algorithm" })}>
            Включить алгоритмического ведущего
          </button>
        )}
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => {
          if (window.confirm("Завершить текущую партию?")) onAction({ action: "finish" });
        }}>
          Завершить партию
        </button>
      </div>
    </div>
  );
}

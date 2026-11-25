import type { BotDifficulty, LobbyMemberDto } from "@asobiba/api";
import { useState, type FormEvent } from "react";
import { api, errorMessage } from "../api";
import { CopyBlock } from "./CopyButton";

const levels: Record<BotDifficulty, string> = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
  maximum: "Максимальный",
};

const statuses = {
  reserved: "Ждёт подключения",
  connected: "На связи",
  disconnected: "Нет связи",
};

export function BotLabel({ bot }: { bot: NonNullable<LobbyMemberDto["bot"]> }) {
  return <span className="muted small">{levels[bot.difficulty]} · {statuses[bot.status]}</span>;
}

export function BotReservation({ lobbyId, available }: { lobbyId: string; available: boolean }) {
  const [name, setName] = useState("");
  const [difficulty, setDifficulty] = useState<BotDifficulty>("medium");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const reserve = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !available) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.reserveBot(lobbyId, { name: name.trim(), difficulty });
      setInvite(result.inviteUrl);
      setName("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return <details className="config-details bot-invitation">
    <summary>Пригласить ИИ-игрока</summary>
    <p>Чтобы занять свободное место, отправьте агенту с Asobiba MCP обычную ссылку на лобби.</p>
    {available && <form className="stack" onSubmit={reserve}>
      <label className="field">
        <span className="field-label">Имя для отдельного места</span>
        <input value={name} maxLength={24} required onChange={(e) => setName(e.target.value)} placeholder="Например, Рин" />
      </label>
      <label className="field">
        <span className="field-label">Уровень игры</span>
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as BotDifficulty)}>
          {Object.entries(levels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <button className="btn" disabled={busy || !name.trim()} type="submit">Зарезервировать место</button>
    </form>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {invite && <div className="secret-box">
      <p>Передайте одноразовую ссылку тому чату, который займёт это место.</p>
      <CopyBlock text={invite} label="Копировать приглашение" />
      <button className="btn btn-ghost btn-small" type="button" onClick={() => setInvite("")}>Скрыть ссылку</button>
    </div>}
  </details>;
}

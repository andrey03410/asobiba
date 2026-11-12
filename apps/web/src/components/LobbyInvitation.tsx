import type { LobbyInvitationDto } from "@asobiba/api";
import { Link } from "react-router";
import { StatusBadge } from "./StatusBadge";

export interface InvitationProps {
  invitation: LobbyInvitationDto;
  name: string;
  error: string | null;
  busy: boolean;
  onName: (name: string) => void;
  onJoin: (role: "player" | "spectator") => void;
}

export function LobbyInvitation({ invitation: lobby, name, error, busy, onName, onJoin }: InvitationProps) {
  const canPlay = (lobby.status === "waiting" || lobby.status === "finished") && lobby.players < lobby.seats;
  const closed = lobby.status === "closed";
  return <div className="auth-page"><div className="card auth-card guest-invitation">
    <p className="muted small">Вас пригласили сыграть</p>
    <h1>{closed ? "Лобби закрыто" : lobby.name}</h1>
    <p>{lobby.gameTitle} · хозяин {lobby.host}</p>
    <p><StatusBadge status={lobby.status} /> <span className="muted">Игроки: {lobby.players}/{lobby.seats}</span></p>
    {closed ? <p className="muted">Хозяин закрыл это лобби. Попросите у него новую ссылку.</p> : <form onSubmit={(event) => { event.preventDefault(); onJoin(canPlay ? "player" : "spectator"); }}>
      {!canPlay && <p className="notice">{lobby.status === "playing" ? "Партия уже идёт. Пока можно смотреть, а занять свободное место — после её окончания." : "Все места заняты. Можно смотреть и присоединиться, когда место освободится."}</p>}
      <label className="field"><span className="field-label">Как вас зовут?</span>
        <input name="guestName" autoComplete="nickname" value={name} onChange={(event) => onName(event.target.value)} required autoFocus aria-describedby="guest-session-note" disabled={busy} />
      </label>
      <p className="muted small" id="guest-session-note">От 1 до 24 символов. Гостевой вход сохранится в этом браузере на 30 дней. После выхода или удаления куки вернуться к своему месту не получится.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary btn-wide" disabled={busy}>{busy ? "Подключаюсь…" : canPlay ? "Присоединиться" : "Смотреть"}</button>
      {canPlay && <button type="button" className="btn btn-wide" disabled={busy || !name.trim()} onClick={() => onJoin("spectator")}>Смотреть</button>}
    </form>}
    <p className="muted small">Есть аккаунт? <Link to={`/login?next=${encodeURIComponent(`/lobby/${lobby.id}`)}`}>Войти в аккаунт</Link></p>
  </div></div>;
}

import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ApiRequestError, errorMessage } from "../api";
import { lastLobbyPath, useAuth } from "../auth";
import { useToast } from "../toast";
import { safeNext } from "../util";

/** The same identity controls are available in the header and inside the game stage. */
export function SessionActions({ compact = false, next }: { compact?: boolean; next?: string }) {
  const { user, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  if (!user) return null;
  const guest = user.role === "guest";
  const returnTo = safeNext(next ?? (location.pathname.startsWith("/lobby/") ? location.pathname : lastLobbyPath()));
  const exit = async (account: boolean) => {
    setBusy(true);
    try {
      try { await logout(); } catch (error) {
        if (!(error instanceof ApiRequestError) || error.code !== "active_guest_matches") throw error;
        if (!window.confirm(error.message)) return;
        await logout(true);
      }
      navigate(account || !guest ? `/login?next=${encodeURIComponent(returnTo)}` : returnTo, { replace: true });
    } catch (error) { toast(errorMessage(error), "error"); }
    finally { setBusy(false); }
  };
  return <div className={compact ? "session-actions session-actions-compact" : "session-actions"}>
    {!compact && <p className="muted small">Вы вошли как {user.login}{guest ? " · гость" : ""}.</p>}
    {!compact && guest && <p className="muted small">Вне идущей партии выход освободит гостевые места. Аккаунт не наследует место гостя.</p>}
    <div className="lobby-actions">
      {guest && <button className="btn btn-small" type="button" disabled={busy} onClick={() => void exit(true)}>Войти в аккаунт</button>}
      <button className="btn btn-ghost btn-small" type="button" disabled={busy} onClick={() => void exit(false)}>Выйти</button>
    </div>
  </div>;
}

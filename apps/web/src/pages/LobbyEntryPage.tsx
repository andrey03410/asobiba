import type { LobbyInvitationDto } from "@asobiba/api";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { ApiRequestError, api, errorMessage } from "../api";
import { useAuth } from "../auth";
import { LobbyInvitation } from "../components/LobbyInvitation";
import { useToast } from "../toast";
import { useTitle } from "../util";
import { LobbyPage } from "./LobbyPage";

function InvitationPage({ id }: { id: string }) {
  const { setUser, refresh } = useAuth();
  const toast = useToast();
  const [invitation, setInvitation] = useState<LobbyInvitationDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [attempt] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useTitle(invitation?.name ?? "Приглашение в игру");
  useEffect(() => {
    let alive = true;
    api.invitation(id).then(({ invitation }) => { if (alive) setInvitation(invitation); })
      .catch((error) => { if (alive) setLoadError(error instanceof ApiRequestError && error.status === 404 ? "Лобби не найдено" : errorMessage(error)); });
    return () => { alive = false; };
  }, [id]);
  const join = async (role: "player" | "spectator") => {
    if (busy) return;
    setBusy(true); setError(null);
    try { const result = await api.guestJoin({ name, lobbyId: id, role, attempt }); setUser(result.user); }
    catch (error) {
      setError(errorMessage(error));
      if (error instanceof ApiRequestError && error.status === 409) toast(error.message, "error");
      await refresh();
      try { setInvitation((await api.invitation(id)).invitation); } catch { /* keep the original invitation and error */ }
    } finally { setBusy(false); }
  };
  if (loadError) return <div className="auth-page"><div className="card auth-card"><h1>{loadError}</h1><p>Проверьте ссылку или попросите у друга новую.</p><button type="button" className="btn" onClick={() => window.location.reload()}>Попробовать снова</button></div></div>;
  if (!invitation) return <div className="page-loading">Открываю приглашение…</div>;
  return <LobbyInvitation invitation={invitation} name={name} error={error} busy={busy} onName={setName} onJoin={(role) => void join(role)} />;
}

export function LobbyEntryPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  useEffect(() => { try { sessionStorage.setItem("asobiba_last_lobby", `/lobby/${id}`); } catch { /* optional navigation hint */ } }, [id]);
  if (user === undefined) return <div className="page-loading">Проверяю вход…</div>;
  return user ? <LobbyPage key={`${id}:${user.id}`} /> : <InvitationPage key={id} id={id} />;
}

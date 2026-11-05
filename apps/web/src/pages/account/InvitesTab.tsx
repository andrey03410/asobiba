import type { CreateInviteResponse, InviteDto, Role } from "@asobiba/api";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../api";
import { CopyBlock } from "../../components/CopyButton";
import { useToast } from "../../toast";
import { formatDate } from "../../util";

function inviteStatus(invite: InviteDto): { label: string; kind: "used" | "expired" | "active" } {
  if (invite.usedAt) return { label: `использовано ${formatDate(invite.usedAt)}${invite.usedBy ? ` · ${invite.usedBy}` : ""}`, kind: "used" };
  if (new Date(invite.expiresAt).getTime() < Date.now()) return { label: `истекло ${formatDate(invite.expiresAt)}`, kind: "expired" };
  return { label: `действует до ${formatDate(invite.expiresAt)}`, kind: "active" };
}

export function InvitesTab() {
  const toast = useToast();
  const [invites, setInvites] = useState<InviteDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("user");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreateInviteResponse | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.invites();
      setInvites(res.invites);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.createInvite(role);
      setCreated(res);
      await load();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <section className="card">
        <h2>Пригласить друга</h2>
        <p className="muted">Регистрация только по приглашению. Ссылка одноразовая, её видно один раз — сразу отправьте другу.</p>
        <form className="inline-form" onSubmit={create}>
          <label className="field">
            <span className="field-label">Роль</span>
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="user">Игрок</option>
              <option value="admin">Администратор</option>
            </select>
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Создаю…" : "Создать приглашение"}
          </button>
        </form>
        {created && (
          <div className="secret-box">
            <p>
              <b>Приглашение готово</b> ({created.invite.role === "admin" ? "администратор" : "игрок"}, действует до {formatDate(created.invite.expiresAt)}).
            </p>
            <CopyBlock text={created.url} label="Копировать ссылку" />
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setCreated(null)}>
              Скрыть
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Все приглашения</h2>
        {error && <div className="notice notice-error">{error}</div>}
        {invites === null && !error && <p className="muted">Загружаю…</p>}
        {invites && invites.length === 0 && <p className="muted">Приглашений пока нет.</p>}
        {invites && invites.length > 0 && (
          <ul className="rows">
            {invites.map((inv) => {
              const status = inviteStatus(inv);
              return (
                <li key={inv.id} className={`row${status.kind === "active" ? "" : " is-dim"}`}>
                  <div className="row-main">
                    <span>
                      <span className={`badge badge-invite-${status.kind}`}>{status.kind === "active" ? "активно" : status.kind === "used" ? "использовано" : "истекло"}</span>{" "}
                      <b>{inv.role === "admin" ? "Администратор" : "Игрок"}</b>
                    </span>
                    <span className="muted small">
                      создано {formatDate(inv.createdAt)} · {status.label}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

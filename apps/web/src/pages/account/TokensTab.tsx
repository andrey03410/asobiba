import type { CreateTokenResponse, TokenDto } from "@asobiba/api";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../api";
import { CopyBlock } from "../../components/CopyButton";
import { useToast } from "../../toast";
import { formatDate } from "../../util";

function claudeCommand(mcpUrl: string, secret: string) {
  return `claude mcp add --transport http asobiba ${mcpUrl} --header "Authorization: Bearer ${secret}"`;
}

function mcpJson(mcpUrl: string, secret: string) {
  return JSON.stringify({ mcpServers: { asobiba: { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${secret}` } } } }, null, 2);
}

function ConnectInstructions({ mcpUrl, secret }: { mcpUrl: string; secret: string }) {
  return (
    <div className="connect">
      <p className="field-label">Claude Code — одной командой</p>
      <CopyBlock text={claudeCommand(mcpUrl, secret)} />
      <p className="field-label">Или в .mcp.json проекта</p>
      <CopyBlock text={mcpJson(mcpUrl, secret)} />
    </div>
  );
}

export function TokensTab() {
  const toast = useToast();
  const [tokens, setTokens] = useState<TokenDto[] | null>(null);
  const [mcpUrl, setMcpUrl] = useState(`${window.location.origin}/mcp`);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreateTokenResponse | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.tokens();
      setTokens(res.tokens);
      setMcpUrl(res.mcpUrl);
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
      const res = await api.createToken(name.trim() || "Мой агент");
      setCreated(res);
      setMcpUrl(res.mcpUrl);
      setName("");
      await load();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: TokenDto) => {
    if (!window.confirm(`Отозвать токен «${token.name}»? Агент с ним больше не подключится.`)) return;
    try {
      await api.revokeToken(token.id);
      if (created?.token.id === token.id) setCreated(null);
      toast("Токен отозван", "success");
      await load();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const active = tokens?.filter((t) => !t.revokedAt) ?? [];
  const revoked = tokens?.filter((t) => t.revokedAt) ?? [];

  return (
    <div className="stack">
      <section className="card">
        <h2>Подключить своего ИИ-агента</h2>
        <p>
          Агент собирает игры по вашим словам: читает возможности игры, собирает конфиг, проверяет его, смотрит превью и создаёт лобби. Ходить за вас он не
          будет. Для подключения нужен личный токен — агент действует от вашего имени.
        </p>
        <form className="inline-form" onSubmit={create}>
          <label className="field grow">
            <span className="field-label">Название токена</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="например, Claude на ноутбуке" maxLength={60} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Создаю…" : "Создать токен"}
          </button>
        </form>

        {created && (
          <div className="secret-box">
            <p>
              <b>Токен «{created.token.name}» создан.</b> Скопируйте его сейчас — второй раз его не показать.
            </p>
            <CopyBlock text={created.secret} label="Копировать токен" />
            <ConnectInstructions mcpUrl={created.mcpUrl} secret={created.secret} />
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setCreated(null)}>
              Я сохранил, скрыть
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Мои токены</h2>
        {error && <div className="notice notice-error">{error}</div>}
        {tokens === null && !error && <p className="muted">Загружаю…</p>}
        {tokens && tokens.length === 0 && <p className="muted">Токенов пока нет.</p>}
        {active.length > 0 && (
          <ul className="rows">
            {active.map((t) => (
              <li key={t.id} className="row">
                <div className="row-main">
                  <b>{t.name}</b> <code>{t.prefix}…</code>
                  <span className="muted small">
                    создан {formatDate(t.createdAt)} · {t.lastUsedAt ? `последний вызов ${formatDate(t.lastUsedAt)}` : "ещё не использовался"}
                  </span>
                </div>
                <button type="button" className="btn btn-danger btn-small" onClick={() => revoke(t)}>
                  Отозвать
                </button>
              </li>
            ))}
          </ul>
        )}
        {revoked.length > 0 && (
          <details className="revoked">
            <summary className="muted">Отозванные · {revoked.length}</summary>
            <ul className="rows">
              {revoked.map((t) => (
                <li key={t.id} className="row is-dim">
                  <div className="row-main">
                    <b>{t.name}</b> <code>{t.prefix}…</code>
                    <span className="muted small">отозван {formatDate(t.revokedAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {!created && (
        <section className="card">
          <h2>Как подключить</h2>
          <p className="muted">
            Адрес MCP-сервера: <code>{mcpUrl}</code>. Подставьте свой токен вместо <code>&lt;токен&gt;</code>.
          </p>
          <ConnectInstructions mcpUrl={mcpUrl} secret="<токен>" />
        </section>
      )}
    </div>
  );
}

import type { ConfigDto } from "@asobiba/api";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ApiRequestError, api, errorMessage } from "../api";
import { useUser } from "../auth";
import { ConfigNameAction } from "../components/ConfigNameAction";
import { IssueList } from "../components/IssueList";
import { useToast } from "../toast";
import { useTitle } from "../util";

type Validation = Pick<ConfigDto, "validationStatus" | "issues">;
type LoadedSource = { text: string; saved?: ConfigDto };
type SourceState = { source: LoadedSource } | { error: string };

function parseConfig(text: string): { document?: Record<string, unknown>; error?: string } {
  if (!text.trim()) return {};
  try {
    const document: unknown = JSON.parse(text);
    if (typeof document !== "object" || document === null || Array.isArray(document)) {
      return { error: "Конфиг должен быть JSON-объектом." };
    }
    return { document: document as Record<string, unknown> };
  } catch {
    return { error: "Исправьте синтаксис JSON." };
  }
}

export function NewLobbyPage() {
  useTitle("Новое лобби");
  const user = useUser();
  const [params] = useSearchParams();
  return <LobbyConfigSource key={user.id + ":" + params.toString()} params={params} />;
}

function LobbyConfigSource({ params }: { params: URLSearchParams }) {
  const configId = params.get("config");
  const gameId = params.get("game");
  const presetId = params.get("preset");
  const example = params.get("example") === "1";
  const fromGame = Boolean(gameId && (presetId || example));
  const [loaded, setLoaded] = useState<SourceState | null>(
    configId || fromGame ? null : { source: { text: "" } },
  );

  useEffect(() => {
    if (!configId && !fromGame) return;
    let alive = true;
    async function load(): Promise<LoadedSource> {
      if (configId) {
        // This route is reached via the owner's explicit "Править JSON" action.
        const { config: saved } = await api.config(configId, true);
        return { saved, text: JSON.stringify(saved.document, null, 2) };
      }
      if (gameId && presetId) {
        const { game } = await api.game(gameId);
        const document = game.presetConfigs.find(({ id }) => id === presetId)?.config;
        if (document) return { text: JSON.stringify(document, null, 2) };
      } else if (gameId) {
        const { guide } = await api.gameGuide(gameId);
        if (guide.exampleConfig) return { text: JSON.stringify(guide.exampleConfig, null, 2) };
      }
      throw new Error("Пример конфига не найден.");
    }
    load().then((source) => {
      if (alive) setLoaded({ source });
    }).catch((err) => {
      if (alive) setLoaded({ error: errorMessage(err) });
    });
    return () => { alive = false; };
  }, [configId, example, fromGame, gameId, presetId]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Новое лобби</h1>
          <p className="muted">Агент может собрать конфиг и создать лобби через MCP.</p>
        </div>
        <Link className="btn" to="/games">Справка по играм</Link>
      </div>
      {!loaded && <p role="status">Загружаю конфиг…</p>}
      {loaded && "error" in loaded && (
        <div className="notice notice-error">
          <p>{loaded.error}</p>
          <Link to="/new">Открыть пустой редактор</Link>
        </div>
      )}
      {loaded && "source" in loaded && <LobbyConfigEditor {...loaded.source} />}
    </div>
  );
}

function LobbyConfigEditor({ text: initialText, saved }: LoadedSource) {
  const navigate = useNavigate();
  const toast = useToast();
  const [text, setText] = useState(initialText);
  const parsed = useMemo(() => parseConfig(text), [text]);
  const [check, setCheck] = useState<Validation | null>(saved ?? null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validationId = useRef(0);

  useEffect(() => {
    if (!parsed.document) return;
    const id = validationId.current;
    const document = parsed.document;
    let alive = true;
    const timer = window.setTimeout(() => {
      api.validateConfig(document).then(({ ok, issues }) => {
        if (alive && id === validationId.current) setCheck({ validationStatus: ok ? "valid" : "invalid", issues });
      }).catch(() => {
        if (alive && id === validationId.current) setCheck({ validationStatus: "unavailable", issues: [] });
      });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [parsed, retry]);

  async function createLobby() {
    if (busy || !parsed.document || check?.validationStatus !== "valid") return;
    setBusy(true);
    setError(null);
    try {
      const { lobby } = await api.createLobby({ config: parsed.document });
      navigate("/lobby/" + encodeURIComponent(lobby.id));
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "invalid_config") {
        validationId.current += 1;
        setCheck({ validationStatus: "invalid", issues: err.issues });
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateSaved() {
    if (busy || !saved || !parsed.document) return;
    setBusy(true);
    setError(null);
    try {
      const { config } = await api.updateConfig(saved.id, parsed.document);
      validationId.current += 1;
      setCheck(config);
      const detail = config.validationStatus === "invalid"
        ? " Для запуска исправьте ошибки."
        : config.validationStatus === "unavailable" ? " Проверка сейчас недоступна." : "";
      toast("Изменения сохранены." + detail, detail ? "info" : "success");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const document = parsed.document;
  const status = !document ? null : check?.validationStatus ?? "pending";

  return (
    <section className="card">
      {saved && <h2>{saved.title}</h2>}
      <label className="field config-json-field">
        <span className="field-label">JSON-конфиг</span>
        <textarea
          rows={15}
          value={text}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          disabled={busy}
          aria-invalid={Boolean(parsed.error) || status === "invalid"}
          aria-describedby="config-validation"
          onChange={(event) => {
            validationId.current += 1;
            setText(event.target.value);
            setError(null);
            setCheck(null);
          }}
        />
      </label>
      <div id="config-validation" aria-live="polite">
        {parsed.error && <p className="form-error">{parsed.error}</p>}
        {!text.trim() && <p className="muted">Напишите конфиг или вставьте готовый JSON.</p>}
        {status === "pending" && <p className="muted">Проверяю конфиг…</p>}
        {status === "valid" && <p>Конфиг готов к запуску.</p>}
        {status === "invalid" && <p className="form-error">Для запуска исправьте ошибки в конфиге.</p>}
        {status === "unavailable" && <p className="form-error">Сейчас не удалось проверить конфиг.</p>}
        <IssueList issues={check?.issues ?? []} />
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="row-actions">
        <button type="button" className="btn btn-primary" disabled={busy || status !== "valid"} onClick={() => void createLobby()}>
          Создать лобби
        </button>
        {status === "unavailable" && <button type="button" className="btn" disabled={busy} onClick={() => {
          validationId.current += 1;
          setCheck(null);
          setRetry(retry + 1);
        }}>Проверить снова</button>}
        {saved ? (
          <button type="button" className="btn" disabled={!document || busy} onClick={() => void updateSaved()}>
            Сохранить изменения
          </button>
        ) : document && !busy && (
          <ConfigNameAction
            label="Сохранить конфиг"
            initialName={typeof document.title === "string" ? document.title : ""}
            submit={(name) => api.createConfig(document, name)}
          />
        )}
      </div>
    </section>
  );
}

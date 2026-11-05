import { MapEditor } from "@asobiba/game-jinchi/client";
import type { ConfigDto, CreateLobbyRequest } from "@asobiba/api";
import { type ConfigDocument, type ConfigIssue, type GameCapabilities, type GameSummary, validateConfig } from "@asobiba/sdk";
import { type FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ApiRequestError, api, errorMessage } from "../api";
import { ConfigPreview } from "../components/ConfigPreview";
import { IssueList } from "../components/IssueList";
import { SchemaForm } from "../components/SchemaForm";
import { catalog } from "../games";
import { isPlainObject } from "../jsonSchema";
import { useToast } from "../toast";
import { useTitle } from "../util";

type Source = { kind: "preset" | "config"; id: string };

const sourceKey = (s: Source | null) => (s ? `${s.kind}:${s.id}` : "");
function parseSourceKey(key: string): Source | null {
  const at = key.indexOf(":");
  if (at < 0) return null;
  const kind = key.slice(0, at);
  return kind === "preset" || kind === "config" ? { kind, id: key.slice(at + 1) } : null;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function NewLobbyPage() {
  useTitle("Новое лобби");
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [configs, setConfigs] = useState<ConfigDto[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [caps, setCaps] = useState<GameCapabilities | null>(null);
  const capsCache = useRef(new Map<string, GameCapabilities>());
  const pendingSource = useRef<Source | null>(null);
  // setSearchParams changes identity with the URL; keep it out of effect deps.
  const setParamsRef = useRef(setParams);
  useEffect(() => {
    setParamsRef.current = setParams;
  }, [setParams]);

  const [source, setSource] = useState<Source | null>(null);
  const [doc, setDoc] = useState<unknown>(null);
  const [baseline, setBaseline] = useState("");
  const [mode, setMode] = useState<"form" | "json">("form");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const [moment, setMoment] = useState<"start" | "end">("end");
  const [seed, setSeed] = useState(1);
  useEffect(() => { if (gameId === "jinchi") setMoment("start"); }, [gameId]);
  const [name, setName] = useState("");
  const [saveConfig, setSaveConfig] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverIssues, setServerIssues] = useState<ConfigIssue[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Games and saved configs; the URL may preselect ?game=&preset= or ?config=.
  useEffect(() => {
    let alive = true;
    Promise.all([api.games(), api.configs()])
      .then(([g, c]) => {
        if (!alive) return;
        setGames(g.games);
        setConfigs(c.configs);
        const configParam = params.get("config");
        const fromConfig = configParam ? c.configs.find((x) => x.id === configParam) : undefined;
        const gameParam = params.get("game");
        const presetParam = params.get("preset");
        const initialGame = fromConfig?.gameId ?? (gameParam && g.games.some((x) => x.id === gameParam) ? gameParam : g.games[0]?.id) ?? null;
        if (configParam && !fromConfig) toast("Сохранённый конфиг не найден — начнём с пресета", "error");
        pendingSource.current = fromConfig ? { kind: "config", id: fromConfig.id } : presetParam ? { kind: "preset", id: presetParam } : null;
        setGameId(initialGame);
      })
      .catch((err) => alive && setLoadError(errorMessage(err)));
    return () => {
      alive = false;
    };
    // Only the URL at first load matters; later choices rewrite it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applySource = useCallback(
    (s: Source, gameCaps: GameCapabilities, savedConfigs: ConfigDto[]) => {
      const document =
        s.kind === "preset" ? gameCaps.presetConfigs.find((p) => p.id === s.id)?.config : savedConfigs.find((c) => c.id === s.id && c.gameId === gameCaps.id)?.document;
      if (!document) return false;
      const d = clone(document);
      setSource(s);
      setDoc(d);
      setBaseline(JSON.stringify(d));
      setJsonText(JSON.stringify(d, null, 2));
      setJsonError(null);
      setServerIssues([]);
      setSubmitError(null);
      setSaveConfig(false);
      const next = new URLSearchParams({ game: gameCaps.id });
      next.set(s.kind, s.id);
      setParamsRef.current(next, { replace: true });
      return true;
    },
    [],
  );

  // Capabilities of the chosen game, then the starting document.
  useEffect(() => {
    if (!gameId) return;
    let alive = true;
    const use = (gameCaps: GameCapabilities) => {
      if (!alive) return;
      setCaps(gameCaps);
      const wanted = pendingSource.current;
      pendingSource.current = null;
      if (wanted && applySource(wanted, gameCaps, configs)) return;
      const first = gameCaps.presetConfigs[0];
      if (first) applySource({ kind: "preset", id: first.id }, gameCaps, configs);
    };
    const cached = capsCache.current.get(gameId);
    if (cached) use(cached);
    else
      api
        .game(gameId)
        .then((res) => {
          capsCache.current.set(gameId, res.game);
          use(res.game);
        })
        .catch((err) => alive && setLoadError(errorMessage(err)));
    return () => {
      alive = false;
    };
    // configs are loaded together with the games, before gameId is set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, applySource]);

  const dirty = doc !== null && JSON.stringify(doc) !== baseline;
  const confirmDiscard = () => !dirty || window.confirm("Правки текущего конфига пропадут. Продолжить?");

  const localCheck = gameId !== null && catalog.get(gameId) !== undefined;
  const deferredDoc = useDeferredValue(doc);
  const result = useMemo(() => (deferredDoc === null || !localCheck ? null : validateConfig(catalog, deferredDoc)), [deferredDoc, localCheck]);
  const [lastValid, setLastValid] = useState<ConfigDocument | null>(null);
  useEffect(() => {
    if (result?.ok) setLastValid(result.config);
  }, [result]);
  const issues = result?.issues ?? [];
  const ok = localCheck ? result?.ok === true : doc !== null;

  const docTitle = isPlainObject(doc) && typeof doc.title === "string" && doc.title.trim() ? doc.title.trim() : (caps?.title ?? "");
  const savedSource = source?.kind === "config" ? configs.find((c) => c.id === source.id) : undefined;
  const reuseSaved = savedSource !== undefined && !dirty;
  const presetInfo = source?.kind === "preset" ? caps?.presets.find((p) => p.id === source.id) : undefined;

  const changeGame = (id: string) => {
    if (id === gameId || !confirmDiscard()) return;
    setCaps(null);
    setDoc(null);
    setLastValid(null);
    setGameId(id);
  };

  const changeSource = (key: string) => {
    const s = parseSourceKey(key);
    if (!s || !caps || key === sourceKey(source) || !confirmDiscard()) return;
    applySource(s, caps, configs);
  };

  const changeJson = (text: string) => {
    setJsonText(text);
    try {
      setDoc(JSON.parse(text));
      setJsonError(null);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : "ошибка разбора");
    }
  };

  const switchMode = (next: "form" | "json") => {
    if (next === mode) return;
    if (next === "json") {
      setJsonText(JSON.stringify(doc, null, 2));
      setJsonError(null);
    }
    setMode(next);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (doc === null || !ok) return;
    setBusy(true);
    setServerIssues([]);
    setSubmitError(null);
    const lobbyName = name.trim() || docTitle || "Лобби";
    try {
      let body: CreateLobbyRequest;
      if (reuseSaved && savedSource) {
        body = { name: lobbyName, configId: savedSource.id };
      } else if (saveConfig) {
        const saved = await api.createConfig(doc);
        toast(`Конфиг «${saved.config.title}» сохранён`, "success");
        body = { name: lobbyName, configId: saved.config.id };
      } else {
        body = { name: lobbyName, config: doc };
      }
      const { lobby } = await api.createLobby(body);
      navigate(`/lobby/${lobby.id}`);
    } catch (err) {
      if (err instanceof ApiRequestError && err.issues.length > 0) setServerIssues(err.issues);
      setSubmitError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="page">
        <h1>Новое лобби</h1>
        <div className="notice notice-error">Не удалось загрузить игры: {loadError}</div>
      </div>
    );
  }
  if (games === null) return <div className="page-loading">Загружаю игры…</div>;
  if (games.length === 0) {
    return (
      <div className="page">
        <h1>Новое лобби</h1>
        <div className="notice">На сервере пока нет ни одной игры.</div>
      </div>
    );
  }

  const gameConfigs = configs.filter((c) => c.gameId === gameId);

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Новое лобби</h1>
          <p className="muted">Возьмите пресет или свой конфиг, поправьте настройки и позовите друзей.</p>
        </div>
        <Link to="/" className="btn btn-ghost">
          К списку лобби
        </Link>
      </div>

      <section className="card create-source">
        <div className="field-row">
          <label className="field">
            <span className="field-label">Игра</span>
            <select value={gameId ?? ""} onChange={(e) => changeGame(e.target.value)}>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Основа</span>
            <select value={sourceKey(source)} onChange={(e) => changeSource(e.target.value)} disabled={!caps}>
              {!source && <option value="">…</option>}
              {caps && (
                <optgroup label="Пресеты">
                  {caps.presetConfigs.map((p) => (
                    <option key={p.id} value={`preset:${p.id}`}>
                      {caps.presets.find((x) => x.id === p.id)?.title ?? p.config.title}
                    </option>
                  ))}
                </optgroup>
              )}
              {gameConfigs.length > 0 && (
                <optgroup label="Мои конфиги">
                  {gameConfigs.map((c) => (
                    <option key={c.id} value={`config:${c.id}`}>
                      {c.title}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
        </div>
        {caps && <p className="muted small">{presetInfo ? presetInfo.description : savedSource ? `Ваш сохранённый конфиг «${savedSource.title}»` : caps.summary}</p>}
      </section>

      {!caps || doc === null ? (
        <div className="page-loading">Загружаю настройки игры…</div>
      ) : (
        <div className="create-grid">
          <section className={`card create-editor${gameId === "jinchi" ? " create-editor-jinchi" : ""}`}>
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={mode === "form"} className={`tab${mode === "form" ? " is-active" : ""}`} onClick={() => switchMode("form")}>
                Настройки
              </button>
              <button type="button" role="tab" aria-selected={mode === "json"} className={`tab${mode === "json" ? " is-active" : ""}`} onClick={() => switchMode("json")}>
                JSON целиком
              </button>
              {dirty && <span className="dirty-mark">изменено</span>}
            </div>
            {mode === "form" ? (
              <SchemaForm schema={caps.configSchema} value={doc} onChange={setDoc} issues={issues}
                overrides={gameId === 'jinchi' ? { 'rules.map': ({ value, onChange }) => {
                  const map = isPlainObject(value) && Array.isArray(value.rows) && typeof value.width === 'number' && typeof value.height === 'number' && value.rows.every(row => typeof row === 'string')
                    ? value as { width: number; height: number; rows: string[] }
                    : { width: 16, height: 16, rows: Array(16).fill('.'.repeat(16)) };
                  return <MapEditor value={map} onChange={onChange} />;
                } } : undefined} />
            ) : (
              <div className="json-editor">
                <textarea spellCheck={false} value={jsonText} onChange={(e) => changeJson(e.target.value)} aria-label="Конфиг целиком в JSON" />
                {jsonError ? (
                  <p className="sf-json-error">Некорректный JSON: {jsonError}. Превью и проверка показывают последний разобранный вариант.</p>
                ) : (
                  <p className="muted small">Весь документ конфига. Описание полей — в схеме игры, её же читает ИИ-агент через MCP.</p>
                )}
              </div>
            )}
          </section>

          <aside className="create-side">
            <section className="card preview-card">
              <div className="preview-head">
                <h2>Превью</h2>
                <div className="segmented" role="group" aria-label="Момент партии">
                  <button type="button" className={moment === "start" ? "is-active" : ""} onClick={() => setMoment("start")}>
                    Начало
                  </button>
                  <button type="button" className={moment === "end" ? "is-active" : ""} onClick={() => setMoment("end")}>
                    Конец
                  </button>
                </div>
                <button type="button" className="btn btn-small" onClick={() => setSeed(Math.floor(Math.random() * 1_000_000) + 1)} disabled={moment === "start"}>
                  Другая партия
                </button>
              </div>
              {!localCheck ? (
                <div className="notice">Сайт пока не умеет рисовать и проверять эту игру — конфиг проверит сервер при создании.</div>
              ) : lastValid ? (
                <>
                  <ConfigPreview config={lastValid} moment={moment} seed={seed} />
                  {result && !result.ok && <p className="muted small">Показан последний верный вариант конфига.</p>}
                </>
              ) : result === null ? (
                <div className="notice">Проверяю конфиг…</div>
              ) : (
                <div className="notice">Исправьте ошибки — и здесь появится поле.</div>
              )}
              {localCheck && result?.ok && issues.length === 0 && <p className="ok-mark">Конфиг в порядке</p>}
              <IssueList issues={issues} />
            </section>

            <form className="card create-submit" onSubmit={submit}>
              <label className="field">
                <span className="field-label">Название лобби</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={docTitle || "Лобби"} maxLength={80} />
              </label>
              {reuseSaved ? (
                <p className="muted small">Лобби возьмёт копию сохранённого конфига «{savedSource?.title}».</p>
              ) : (
                <label className="check">
                  <input type="checkbox" checked={saveConfig} onChange={(e) => setSaveConfig(e.target.checked)} />
                  <span>{savedSource ? "Сохранить как новый конфиг в мои" : "Сохранить в мои конфиги"}</span>
                </label>
              )}
              <IssueList issues={serverIssues} title="Сервер не принял конфиг" />
              {submitError && serverIssues.length === 0 && <p className="form-error">{submitError}</p>}
              <button type="submit" className="btn btn-primary btn-wide" disabled={!ok || busy || (mode === "json" && jsonError !== null)}>
                {busy ? "Создаю…" : "Создать лобби"}
              </button>
              {!ok && result !== null && <p className="muted small">Сначала исправьте ошибки в конфиге.</p>}
            </form>
          </aside>
        </div>
      )}
    </div>
  );
}

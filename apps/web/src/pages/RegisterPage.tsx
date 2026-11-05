import type { InviteCheckResponse } from "@asobiba/api";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, errorMessage } from "../api";
import { useAuth } from "../auth";
import { useTitle } from "../util";

type InviteState = { kind: "loading" } | { kind: "missing" } | { kind: "checked"; result: InviteCheckResponse } | { kind: "error"; message: string };

export function RegisterPage() {
  useTitle("Регистрация");
  const { user, setUser } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const invite = (params.get("invite") ?? "").trim();
  const [state, setState] = useState<InviteState>(invite ? { kind: "loading" } : { kind: "missing" });
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!invite) {
      setState({ kind: "missing" });
      return;
    }
    let alive = true;
    setState({ kind: "loading" });
    api
      .checkInvite(invite)
      .then((result) => alive && setState({ kind: "checked", result }))
      .catch((err) => alive && setState({ kind: "error", message: errorMessage(err) }));
    return () => {
      alive = false;
    };
  }, [invite]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== password2) {
      setError("Пароли не совпадают");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.register({ login: login.trim(), password, invite });
      setUser(res.user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (user) {
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <h1>Вы уже вошли</h1>
          <p>
            Вы вошли как <b>{user.login}</b>. Чтобы зарегистрировать новый аккаунт по этому приглашению, сначала выйдите.
          </p>
          <Link to="/" className="btn btn-primary">
            К лобби
          </Link>
        </div>
      </div>
    );
  }

  if (state.kind === "loading") return <div className="page-loading">Проверяю приглашение…</div>;

  if (state.kind !== "checked" || !state.result.valid) {
    const reason =
      state.kind === "missing"
        ? "В ссылке нет кода приглашения."
        : state.kind === "error"
          ? `Не удалось проверить приглашение: ${state.message}`
          : "Это приглашение не найдено, уже использовано или истекло.";
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <h1>Приглашение не подошло</h1>
          <p>{reason}</p>
          <p className="muted">Регистрация на Asobiba — только по приглашению. Попросите у друга свежую ссылку.</p>
          <Link to="/login" className="btn">
            У меня уже есть аккаунт
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Добро пожаловать!</h1>
        <p className="muted">
          Вас пригласили на площадку
          {state.result.role === "admin" ? " с правами администратора" : ""}. Придумайте логин и пароль.
        </p>
        <label className="field">
          <span className="field-label">Логин</span>
          <input autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span className="field-label">Пароль</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Пароль ещё раз</span>
          <input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} required />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn btn-primary btn-wide" disabled={busy}>
          {busy ? "Создаю аккаунт…" : "Зарегистрироваться"}
        </button>
      </form>
    </div>
  );
}

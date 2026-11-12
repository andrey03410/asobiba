import type { UserDto } from "@asobiba/api";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { api, setUnauthorizedHandler } from "./api";

interface AuthState {
  /** undefined while the first /api/me is loading. */
  user: UserDto | null | undefined;
  setUser: (user: UserDto | null) => void;
  refresh: () => Promise<void>;
  logout: (confirmActive?: boolean) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const AUTH_CHANGED = "asobiba_auth_changed";

export function lastLobbyPath(): string | null {
  try {
    const path = sessionStorage.getItem("asobiba_last_lobby");
    return path && /^\/lobby\/[^/?#]+$/.test(path) ? path : null;
  } catch { return null; }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, updateUser] = useState<UserDto | null | undefined>(undefined);
  const revision = useRef(0);
  const setUser = useCallback((value: UserDto | null) => {
    revision.current += 1;
    updateUser(value);
    try { localStorage.setItem(AUTH_CHANGED, crypto.randomUUID()); } catch { /* storage may be disabled */ }
  }, []);

  const refresh = useCallback(async () => {
    const version = ++revision.current;
    try {
      const res = await api.me();
      if (version === revision.current) updateUser(res.user);
    } catch {
      if (version === revision.current) updateUser((current) => current ?? null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setUnauthorizedHandler(() => { void refresh(); });
    return () => setUnauthorizedHandler(null);
  }, [refresh]);

  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === AUTH_CHANGED) void refresh(); };
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("storage", changed);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => { window.removeEventListener("storage", changed); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);

  const logout = useCallback(async (confirmActive = false) => {
    await api.logout(confirmActive);
    setUser(null);
  }, [setUser]);

  const value = useMemo(() => ({ user, setUser, refresh, logout }), [user, setUser, refresh, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

/** The logged-in user; only for pages wrapped in RequireAuth. */
export function useUser(): UserDto {
  const { user } = useAuth();
  if (!user) throw new Error("useUser outside RequireAuth");
  return user;
}

export function RequireAuth({ children, accountOnly = false }: { children: ReactNode; accountOnly?: boolean }) {
  const { user } = useAuth();
  const location = useLocation();
  if (user === undefined) return <div className="page-loading">Загружаю…</div>;
  if (user === null) {
    const next = location.pathname + location.search;
    const to = next && next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login";
    return <Navigate to={to} replace />;
  }
  if (accountOnly && user.role === "guest") return (
    <div className="auth-page"><div className="card auth-card">
      <h1>Для этого нужен аккаунт</h1>
      <p>Вы вошли как {user.login} · гость. Создание игр, список лобби и кабинет доступны с аккаунтом.</p>
      <Link className="btn btn-primary" to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}>Войти в аккаунт</Link>
      {lastLobbyPath() && <Link className="btn" to={lastLobbyPath()!}>Вернуться в лобби</Link>}
    </div></div>
  );
  return <>{children}</>;
}

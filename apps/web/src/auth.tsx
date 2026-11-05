import type { UserDto } from "@asobiba/api";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router";
import { api, setUnauthorizedHandler } from "./api";

interface AuthState {
  /** undefined while the first /api/me is loading. */
  user: UserDto | null | undefined;
  setUser: (user: UserDto | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const res = await api.me();
      setUser(res.user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({ user, setUser, refresh, logout }), [user, refresh, logout]);
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

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (user === undefined) return <div className="page-loading">Загружаю…</div>;
  if (user === null) {
    const next = location.pathname + location.search;
    const to = next && next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login";
    return <Navigate to={to} replace />;
  }
  return <>{children}</>;
}

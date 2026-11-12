import { BrowserRouter, Route, Routes } from "react-router";
import { AuthProvider, RequireAuth } from "./auth";
import { Layout } from "./components/Layout";
import { gamesCss } from "./games";
import { AccountPage } from "./pages/AccountPage";
import { HomePage } from "./pages/HomePage";
import { LobbyEntryPage } from "./pages/LobbyEntryPage";
import { LoginPage } from "./pages/LoginPage";
import { NewLobbyPage } from "./pages/NewLobbyPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ToastProvider } from "./toast";

/** Providers and routes; the router comes from outside. */
export function AppShell() {
  return (
    <ToastProvider>
      <AuthProvider>
        {/* Board animations of every game, injected once. */}
        <style>{gamesCss}</style>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route
              index
              element={
                <RequireAuth accountOnly>
                  <HomePage />
                </RequireAuth>
              }
            />
            <Route
              path="/new"
              element={
                <RequireAuth accountOnly>
                  <NewLobbyPage />
                </RequireAuth>
              }
            />
            <Route
              path="/lobby/:id"
              element={<LobbyEntryPage />}
            />
            <Route
              path="/account"
              element={
                <RequireAuth accountOnly>
                  <AccountPage />
                </RequireAuth>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </ToastProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

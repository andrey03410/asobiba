import { Link, NavLink, Outlet } from "react-router";
import { useAuth } from "../auth";
import { SessionActions } from "./SessionActions";

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="Asobiba — на главную">
      <span className="logo-seal" aria-hidden="true">
        遊
      </span>
      <span className="logo-text">
        <span className="logo-jp">遊び場</span>
        <span className="logo-en">Asobiba</span>
      </span>
    </Link>
  );
}

export function Layout() {
  const { user } = useAuth();

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <Logo />
          {user && user.role !== "guest" && (
            <nav className="nav" aria-label="Разделы">
              <NavLink to="/" end className="nav-link">
                Лобби
              </NavLink>
              <NavLink to="/account" className="nav-link">
                Кабинет
              </NavLink>
            </nav>
          )}
          <div className="header-user">
            {user ? (
              <>
                <span className="header-login" title={user.role === "admin" ? "Администратор" : undefined}>
                  {user.login}
                  {user.role === "admin" && <span className="role-mark">админ</span>}
                  {user.role === "guest" && <span className="role-mark">гость</span>}
                </span>
                <SessionActions compact />
              </>
            ) : user === null ? (
              <Link to="/login" className="btn btn-small">
                Войти
              </Link>
            ) : null}
          </div>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <footer className="footer">
        <span>遊び場 — площадка для своих</span>
      </footer>
    </div>
  );
}

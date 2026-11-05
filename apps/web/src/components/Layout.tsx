import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { useAuth } from "../auth";
import { useToast } from "../toast";

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
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const onLogout = async () => {
    try {
      await logout();
    } catch {
      toast("Не удалось выйти на сервере, но на этом устройстве сессия сброшена", "error");
    }
    navigate("/login");
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <Logo />
          {user && (
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
                </span>
                <button type="button" className="btn btn-ghost btn-small" onClick={onLogout}>
                  Выйти
                </button>
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

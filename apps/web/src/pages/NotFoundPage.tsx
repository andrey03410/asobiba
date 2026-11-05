import { Link } from "react-router";
import { useTitle } from "../util";

export function NotFoundPage() {
  useTitle("Страница не найдена");
  return (
    <div className="page">
      <div className="empty">
        <p className="empty-mark" aria-hidden="true">
          迷
        </p>
        <h1>Такой страницы нет</h1>
        <p className="muted">Похоже, вы заблудились на площадке. Бывает.</p>
        <Link to="/" className="btn btn-primary">
          На главную
        </Link>
      </div>
    </div>
  );
}

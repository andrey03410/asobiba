import type { AuthorInformation, ConfigInformation } from "@asobiba/sdk";
import { useId } from "react";
import { isPlainObject } from "../jsonSchema";

/** All content is rendered as text. This component never reads a config or starts media. */
export function GameInformation({ information }: { information: ConfigInformation }) {
  const { game, summary, author } = information;
  const range = summary.players.min === summary.players.max ? String(summary.players.min) : `${summary.players.min}–${summary.players.max}`;
  return <div className="game-information">
    <section aria-label="Об этой партии">
      <h2>Об этой партии</h2>
      <p><strong>Игроков: {range}.</strong> {summary.objective}</p>
      <p>{summary.turn}</p>
      <p><strong>Победа: </strong>{summary.victory}</p>
      <ul className="lobby-rules">{summary.highlights.map((item, i) => <li key={i}>{item}</li>)}</ul>
      <details className="config-details">
        <summary>Подробные правила этой партии</summary>
        {summary.sections.map((section) => <section key={section.id}><h3>{section.title}</h3><ul className="lobby-rules">{section.items.map((item, i) => <li key={i}>{item}</li>)}</ul></section>)}
      </details>
    </section>
    {author && <section aria-label="Вступление автора">
      <h3>Вступление автора</h3>
      {author.title && <h4>{author.title}</h4>}
      {author.text?.split(/\n\s*\n/).map((paragraph, i) => <p key={i} style={{ whiteSpace: "pre-wrap" }}>{paragraph}</p>)}
      <p className="muted small">Авторское вступление не меняет системные правила.</p>
    </section>}
    <details className="config-details">
      <summary>Об игре</summary>
      <p>{game.overview}</p><p>{game.audience} Игроков: {game.players.min}–{game.players.max}.</p>
      <p><strong>Цель: </strong>{game.goal}</p><p><strong>Один ход: </strong>{game.turn}</p><p><strong>Например: </strong>{game.example}</p>
      <ul className="lobby-rules">{game.highlights.map((item, i) => <li key={i}>{item}</li>)}</ul>
    </details>
  </div>;
}

/** Shared by Quizor's separate editor and the generated forms of other games. */
export function AuthorInformationFields({ value, onChange }: { value: unknown; onChange: (value: AuthorInformation | undefined) => void }) {
  const id = useId();
  const title = isPlainObject(value) && typeof value.title === "string" ? value.title : "";
  const text = isPlainObject(value) && typeof value.text === "string" ? value.text : "";
  const change = (nextTitle: string, nextText: string) => onChange(nextTitle || nextText ? { ...(nextTitle ? { title: nextTitle } : {}), ...(nextText ? { text: nextText } : {}) } : undefined);
  return <fieldset className="sf-object">
    <legend>Вступление автора</legend>
    <p className="muted small">Необязательно. Обращение к друзьям или атмосфера партии; действуют системные правила ниже.</p>
    <label className="field" htmlFor={`${id}-title`}><span className="field-label">Заголовок</span><input id={`${id}-title`} value={title} maxLength={80} onChange={(event) => change(event.target.value, text)} /></label>
    <label className="field" htmlFor={`${id}-text`}><span className="field-label">Текст</span><textarea id={`${id}-text`} rows={5} value={text} maxLength={2000} onChange={(event) => change(title, event.target.value)} /></label>
    <p className="muted small">До 80 символов в заголовке и 2000 в тексте. Обычный текст и абзацы, без медиа и вставок.</p>
  </fieldset>;
}

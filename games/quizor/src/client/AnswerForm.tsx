import { useState, type FormEvent } from "react";
import { parseNumber } from "../judge";

export interface FieldItem {
  id: string;
  text?: string;
  asset?: string;
  audio?: string;
  media?: "image" | "audio";
}
/** Only presentation properties are consumed; judging criteria never belong in the form. */
export interface AnswerField {
  id: string;
  type: string;
  label?: string;
  required?: boolean;
  options?: FieldItem[];
  items?: FieldItem[];
  left?: FieldItem[];
  right?: FieldItem[];
  asset?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  input?: string;
  maxItems?: number;
  minSelections?: number;
  maxSelections?: number;
  maxSelected?: number;
  multiline?: boolean;
  maxLength?: number;
}
export type FormAnswers = Record<string, unknown>;

export function initialAnswers(fields: AnswerField[]): FormAnswers {
  return Object.fromEntries(
    fields.flatMap((f) =>
      f.type === "order"
        ? [[f.id, (f.items ?? []).map((x) => x.id)]]
        : f.type === "match"
          ? [[f.id, {}]]
          : f.type === "number" && f.input === "slider"
            ? [[f.id, f.min ?? 0]]
            : [],
    ),
  );
}

export function answerInputError(
  fields: AnswerField[],
  values: FormAnswers,
): string | null {
  for (const field of fields) {
    const value = values[field.id];
    const label = field.label ?? field.id;
    const empty =
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.every((v) => !String(v).trim()));
    if (
      field.required !== false &&
      field.type !== "oral" &&
      (empty ||
        (field.type === "match" &&
          (field.left ?? []).some(
            (x) => !(value as Record<string, string>)?.[x.id],
          )))
    )
      return `Заполните поле «${label}»`;
    if (field.type === "number" && !empty) {
      const number =
        typeof value === "string" || typeof value === "number"
          ? parseNumber(value)
          : null;
      if (number === null) return `Введите число в поле «${label}»`;
      if (
        (field.min !== undefined && number < field.min) ||
        (field.max !== undefined && number > field.max)
      )
        return `Проверьте допустимый диапазон в поле «${label}»`;
    }
    const max = field.maxSelected ?? field.maxSelections;
    if (
      field.type === "multi" &&
      Array.isArray(value) &&
      ((field.minSelections !== undefined &&
        value.length < field.minSelections) ||
        (max !== undefined && value.length > max))
    )
      return `Проверьте число вариантов в поле «${label}»`;
  }
  return null;
}

function Option({
  item,
  assetUrl,
  fallback,
}: {
  item: FieldItem;
  assetUrl: (id: string) => string;
  fallback?: string;
}) {
  return (
    <>
      {item.asset && item.media !== "audio" && (
        <img src={assetUrl(item.asset)} alt="" />
      )}
      {item.text || fallback || item.id}
      {(item.audio || (item.media === "audio" && item.asset)) && (
        <audio
          src={assetUrl(item.audio ?? item.asset!)}
          controls
          preload="metadata"
        />
      )}
    </>
  );
}

interface Props {
  fields: AnswerField[];
  value: FormAnswers;
  onChange(value: FormAnswers): void;
  onSubmit(value: FormAnswers): void;
  assetUrl(id: string): string;
  disabled?: boolean;
  submitted?: boolean;
}

export function AnswerForm({
  fields,
  value,
  onChange,
  onSubmit,
  assetUrl,
  disabled = false,
  submitted = false,
}: Props) {
  const [error, setError] = useState("");
  const set = (id: string, v: unknown) => onChange({ ...value, [id]: v });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const error = answerInputError(fields, value);
    if (error) {
      setError(error);
      return;
    }
    setError("");
    onSubmit(
      Object.fromEntries(
        fields.map((f) => [
          f.id,
          f.type === "oral" ? true : (value[f.id] ?? null),
        ]),
      ),
    );
  };
  return (
    <form className="qz-answer" onSubmit={submit}>
      <fieldset disabled={disabled}>
        {fields.map((f) => {
          const label = f.label || (fields.length === 1 ? "Ваш ответ" : f.id);
          const id = `qz-field-${f.id}`;
          let control;
          switch (f.type) {
            case "text":
              control = f.multiline ? (
                <textarea
                  id={id}
                  rows={3}
                  maxLength={f.maxLength ?? 2000}
                  value={String(value[f.id] ?? "")}
                  onChange={(e) => set(f.id, e.target.value)}
                />
              ) : (
                <input
                  id={id}
                  autoComplete="off"
                  maxLength={f.maxLength ?? 2000}
                  value={String(value[f.id] ?? "")}
                  onChange={(e) => set(f.id, e.target.value)}
                />
              );
              break;
            case "number":
              control = (
                <div className="qz-number">
                  <input
                    id={id}
                    type={f.input === "slider" ? "range" : "text"}
                    inputMode="decimal"
                    min={f.min}
                    max={f.max}
                    step={f.step ?? "any"}
                    autoComplete="off"
                    value={String(value[f.id] ?? "")}
                    onChange={(e) => set(f.id, e.target.value)}
                  />
                  {f.input === "slider" && (
                    <output>{String(value[f.id] ?? f.min ?? 0)}</output>
                  )}
                  {f.unit && <span>{f.unit}</span>}
                </div>
              );
              break;
            case "boolean":
            case "choice":
            case "multi": {
              const options =
                f.options ??
                (f.type === "boolean"
                  ? [
                      { id: "true", text: "Верно" },
                      { id: "false", text: "Неверно" },
                    ]
                  : []);
              control = (
                <div className="qz-options" role="group" aria-label={label}>
                  {options.map((item) => {
                    const multi = f.type === "multi";
                    const selected = multi
                      ? (Array.isArray(value[f.id])
                          ? (value[f.id] as string[])
                          : []
                        ).includes(item.id)
                      : String(value[f.id]) === item.id;
                    return (
                      <label
                        key={item.id}
                        className={`qz-option${selected ? " is-selected" : ""}`}
                      >
                        <input
                          type={multi ? "checkbox" : "radio"}
                          name={id}
                          value={item.id}
                          checked={selected}
                          onChange={() => {
                            if (!multi)
                              set(
                                f.id,
                                f.type === "boolean"
                                  ? item.id === "true"
                                  : item.id,
                              );
                            else {
                              const a = Array.isArray(value[f.id])
                                ? (value[f.id] as string[])
                                : [];
                              set(
                                f.id,
                                selected
                                  ? a.filter((x) => x !== item.id)
                                  : [...a, item.id],
                              );
                            }
                          }}
                        />
                        <Option item={item} assetUrl={assetUrl} />
                      </label>
                    );
                  })}
                </div>
              );
              break;
            }
            case "order": {
              const order = Array.isArray(value[f.id])
                ? (value[f.id] as string[])
                : (f.items ?? []).map((x) => x.id);
              const move = (from: number, to: number) => {
                const next = [...order];
                [next[from], next[to]] = [next[to]!, next[from]!];
                set(f.id, next);
              };
              control = (
                <ol className="qz-order" aria-label={label}>
                  {order.map((key, i) => (
                    <li key={key}>
                      <span>
                        <Option
                          item={
                            (f.items ?? []).find((x) => x.id === key) ?? {
                              id: key,
                            }
                          }
                          assetUrl={assetUrl}
                        />
                      </span>
                      <button
                        type="button"
                        disabled={i === 0 || disabled}
                        aria-label={`Поднять ${i + 1}`}
                        onClick={() => move(i, i - 1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={i === order.length - 1 || disabled}
                        aria-label={`Опустить ${i + 1}`}
                        onClick={() => move(i, i + 1)}
                      >
                        ↓
                      </button>
                    </li>
                  ))}
                </ol>
              );
              break;
            }
            case "match":
              control = (
                <div className="qz-matching">
                  {(f.right ?? []).some((item) => item.asset || item.audio) && (
                    <div
                      className="qz-match-targets"
                      aria-label={`${label}: варианты справа`}
                    >
                      {(f.right ?? []).map((item, index) => (
                        <div key={item.id}>
                          <Option
                            item={item}
                            assetUrl={assetUrl}
                            fallback={`Вариант ${index + 1}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {(f.left ?? []).map((item, index) => (
                    <label key={item.id}>
                      <span>
                        <Option
                          item={item}
                          assetUrl={assetUrl}
                          fallback={`Элемент ${index + 1}`}
                        />
                      </span>
                      <select
                        aria-label={`${label}: ${item.text || `Элемент ${index + 1}`}`}
                        value={
                          (value[f.id] as Record<string, string> | undefined)?.[
                            item.id
                          ] ?? ""
                        }
                        onChange={(e) =>
                          set(f.id, {
                            ...((value[f.id] as Record<string, string>) ?? {}),
                            [item.id]: e.target.value,
                          })
                        }
                      >
                        <option value="">Выберите соответствие</option>
                        {(f.right ?? []).map((x, index) => (
                          <option key={x.id} value={x.id}>
                            {x.text || `Вариант ${index + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              );
              break;
            case "list": {
              const lines = Array.isArray(value[f.id])
                ? (value[f.id] as string[])
                : [""];
              control = (
                <div className="qz-list">
                  {lines.map((line, i) => (
                    <input
                      key={i}
                      aria-label={`${label}, ответ ${i + 1}`}
                      value={line}
                      maxLength={1000}
                      onChange={(e) => {
                        const next = [...lines];
                        next[i] = e.target.value;
                        set(f.id, next);
                      }}
                    />
                  ))}
                  <button
                    type="button"
                    disabled={lines.length >= (f.maxItems ?? 20) || disabled}
                    onClick={() => set(f.id, [...lines, ""])}
                  >
                    Ещё ответ
                  </button>
                </div>
              );
              break;
            }
            case "point": {
              const point = value[f.id] as { x: number; y: number } | undefined;
              control = (
                <div>
                  <button
                    type="button"
                    className="qz-point"
                    aria-label={`${label}: выберите точку на картинке`}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      set(f.id, {
                        x: Math.max(
                          0,
                          Math.min(1, (e.clientX - rect.left) / rect.width),
                        ),
                        y: Math.max(
                          0,
                          Math.min(1, (e.clientY - rect.top) / rect.height),
                        ),
                      });
                    }}
                  >
                    {f.asset && <img src={assetUrl(f.asset)} alt={label} />}
                    {point && (
                      <span
                        className="qz-pin"
                        style={{
                          left: `${point.x * 100}%`,
                          top: `${point.y * 100}%`,
                        }}
                        aria-hidden="true"
                      >
                        ✦
                      </span>
                    )}
                  </button>
                  <div className="qz-coordinates">
                    {(["x", "y"] as const).map((axis) => (
                      <label key={axis}>
                        {axis.toUpperCase()} %
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={
                            point ? Math.round(point[axis] * 1000) / 10 : ""
                          }
                          onChange={(e) =>
                            set(f.id, {
                              x: point?.x ?? 0.5,
                              y: point?.y ?? 0.5,
                              [axis]:
                                Math.max(
                                  0,
                                  Math.min(100, Number(e.target.value)),
                                ) / 100,
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              );
              break;
            }
            case "oral":
              control = (
                <p className="qz-muted">
                  Ответьте вслух и подтвердите готовность.
                </p>
              );
              break;
            default:
              control = (
                <p>Формат ответа пока не поддерживается этим клиентом.</p>
              );
          }
          return (
            <div className="qz-field" key={f.id}>
              <label
                htmlFor={
                  f.type === "text" || f.type === "number" ? id : undefined
                }
              >
                {label}
                {f.required === false && <small> · необязательно</small>}
              </label>
              {control}
            </div>
          );
        })}
        {error && (
          <p role="alert" className="qz-error">
            {error}
          </p>
        )}
        <button className="qz-primary qz-submit" type="submit">
          {submitted
            ? "Изменить ответ"
            : fields.every((f) => f.type === "oral")
              ? "Отвечаю"
              : "Ответить"}
        </button>
      </fieldset>
    </form>
  );
}

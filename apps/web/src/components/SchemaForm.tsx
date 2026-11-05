import { type ConfigIssue, HEX_COLOR } from "@asobiba/sdk";
import { createContext, type ReactNode, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  childPath,
  choicesOf,
  fieldKind,
  formatJson,
  isPlainObject,
  type JsonSchema,
  labelOf,
  resolveSchema,
  withKey,
} from "../jsonSchema";

/**
 * A form generated from a game's config JSON Schema. Nothing here knows about
 * a particular game: objects become fieldsets, numbers and enums become inputs
 * and selects, and anything unusual (arrays of objects, unions) is edited as a
 * small piece of JSON.
 */

interface FormContextValue {
  root: JsonSchema;
  issues: Map<string, ConfigIssue[]>;
  allIssues: readonly ConfigIssue[];
}

const FormContext = createContext<FormContextValue>({ root: {}, issues: new Map(), allIssues: [] });

interface FieldProps {
  name: string;
  path: string;
  schema: JsonSchema;
  value: unknown;
  required: boolean;
  depth: number;
  onChange: (value: unknown) => void;
}

function useIssues(path: string, nested = false): ConfigIssue[] {
  const { issues, allIssues } = useContext(FormContext);
  return useMemo(() => {
    if (!nested) return issues.get(path) ?? [];
    return allIssues.filter((i) => i.path === path || i.path.startsWith(`${path}.`) || i.path.startsWith(`${path}[`));
  }, [issues, allIssues, path, nested]);
}

function FieldIssues({ issues }: { issues: ConfigIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="sf-issues">
      {issues.map((i, k) => (
        <li key={k} className={i.severity === "warning" ? "is-warning" : "is-error"}>
          {i.path && <code>{i.path}</code>} {i.message}
          {i.hint && <span className="sf-issue-hint"> {i.hint}</span>}
        </li>
      ))}
    </ul>
  );
}

function FieldShell({
  id,
  name,
  schema,
  issues,
  inline,
  extra,
  children,
}: {
  id: string;
  name: string;
  schema: JsonSchema;
  issues: ConfigIssue[];
  inline?: boolean;
  /** Small note after the label, e.g. the allowed range. */
  extra?: string;
  children: ReactNode;
}) {
  const { label, hint } = labelOf(schema, name);
  const hasError = issues.some((i) => i.severity !== "warning");
  return (
    <div className={`sf-field${inline ? " sf-inline" : ""}${hasError ? " has-error" : issues.length ? " has-warning" : ""}`}>
      {inline ? (
        <label className="sf-check" htmlFor={id}>
          {children}
          <span className="sf-label">
            {label} <code className="sf-key">{name}</code>
          </span>
        </label>
      ) : (
        <>
          <label className="sf-label" htmlFor={id}>
            {label} <code className="sf-key">{name}</code>
            {extra && <span className="sf-extra">{extra}</span>}
          </label>
          {children}
        </>
      )}
      {hint && <p className="sf-hint">{hint}</p>}
      <FieldIssues issues={issues} />
    </div>
  );
}

function defaultText(schema: JsonSchema): string {
  return schema.default === undefined ? "не задано" : `по умолчанию ${formatJson(schema.default)}`;
}

function NumberField({ name, path, schema, value, required, onChange, integer }: FieldProps & { integer: boolean }) {
  const id = useId();
  const issues = useIssues(path);
  const shown = typeof value === "number" ? String(value) : value === undefined ? "" : String(value);
  const [text, setText] = useState(shown);
  const lastShown = useRef(shown);
  useEffect(() => {
    if (shown !== lastShown.current) {
      lastShown.current = shown;
      setText(shown);
    }
  }, [shown]);

  const min = schema.minimum ?? schema.exclusiveMinimum;
  const max = schema.maximum ?? schema.exclusiveMaximum;
  const range = min !== undefined && max !== undefined ? `${min}–${max}` : min !== undefined ? `от ${min}` : max !== undefined ? `до ${max}` : undefined;
  return (
    <FieldShell id={id} name={name} schema={schema} issues={issues} extra={range}>
      <input
        id={id}
        type="number"
        inputMode={integer ? "numeric" : "decimal"}
        min={min}
        max={max}
        step={integer ? 1 : (schema.multipleOf ?? "any")}
        value={text}
        placeholder={defaultText(schema)}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          if (e.target.validity.badInput) return;
          if (t.trim() === "") {
            const next = required && schema.default === undefined ? 0 : undefined;
            lastShown.current = next === undefined ? "" : String(next);
            onChange(next);
            return;
          }
          const n = Number(t);
          if (Number.isFinite(n)) {
            lastShown.current = String(n);
            onChange(n);
          }
        }}
      />
    </FieldShell>
  );
}

function EnumField({ name, path, schema, value, required, onChange }: FieldProps) {
  const id = useId();
  const issues = useIssues(path);
  const choices = choicesOf(schema) ?? [];
  const known = choices.some((c) => c === value);
  const allowUnset = value === undefined || (!required && schema.default === undefined);
  return (
    <FieldShell id={id} name={name} schema={schema} issues={issues}>
      <select
        id={id}
        value={value === undefined ? "" : JSON.stringify(value)}
        onChange={(e) => onChange(e.target.value === "" ? undefined : JSON.parse(e.target.value))}
      >
        {allowUnset && <option value="">{schema.default === undefined ? "— не задано —" : `по умолчанию (${String(schema.default)})`}</option>}
        {!known && value !== undefined && <option value={JSON.stringify(value)}>{JSON.stringify(value)} (не из списка)</option>}
        {choices.map((c) => (
          <option key={JSON.stringify(c)} value={JSON.stringify(c)}>
            {String(c)}
            {schema.default !== undefined && c === schema.default ? " · по умолчанию" : ""}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

function BooleanField({ name, path, schema, value, required, onChange }: FieldProps) {
  const id = useId();
  const issues = useIssues(path);
  if (!required && schema.default === undefined) {
    return (
      <FieldShell id={id} name={name} schema={schema} issues={issues}>
        <select id={id} value={value === true ? "true" : value === false ? "false" : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "true")}>
          <option value="">— не задано —</option>
          <option value="true">да</option>
          <option value="false">нет</option>
        </select>
      </FieldShell>
    );
  }
  const checked = value === undefined ? schema.default === true : value === true;
  return (
    <FieldShell id={id} name={name} schema={schema} issues={issues} inline>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </FieldShell>
  );
}

/** #rgb / #rrggbbaa → #rrggbb for <input type="color">. */
function pickerColor(value: unknown): string {
  if (typeof value !== "string" || !HEX_COLOR.test(value)) return "#000000";
  const hex = value.slice(1);
  if (hex.length === 3) return `#${[...hex].map((c) => c + c).join("")}`.toLowerCase();
  return `#${hex.slice(0, 6)}`.toLowerCase();
}

function StringField({ name, path, schema, value, required, onChange }: FieldProps) {
  const id = useId();
  const issues = useIssues(path);
  const isColor = schema.pattern === HEX_COLOR.source;
  const text = typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);
  const set = (t: string) => onChange(t === "" ? (required && schema.default === undefined ? "" : undefined) : t);
  return (
    <FieldShell id={id} name={name} schema={schema} issues={issues}>
      <div className={isColor ? "sf-color" : undefined}>
        {isColor && (
          <input
            type="color"
            aria-label={`Выбрать цвет: ${name}`}
            className={value === undefined ? "is-unset" : undefined}
            value={pickerColor(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        <input id={id} type="text" value={text} maxLength={schema.maxLength} placeholder={defaultText(schema)} onChange={(e) => set(e.target.value)} />
      </div>
    </FieldShell>
  );
}

function EnumArrayField({ name, path, schema, value, onChange }: FieldProps) {
  const { root } = useContext(FormContext);
  const id = useId();
  const issues = useIssues(path, true);
  const items = resolveSchema(schema.items, root);
  const choices = choicesOf(items) ?? [];
  const current = Array.isArray(value) ? value : Array.isArray(schema.default) ? schema.default : [];
  const toggle = (choice: unknown, on: boolean) => {
    const set = new Set(current.filter((c) => c !== choice));
    if (on) set.add(choice);
    onChange(choices.filter((c) => set.has(c)));
  };
  const { label, hint } = labelOf(schema, name);
  const hasError = issues.some((i) => i.severity !== "warning");
  return (
    <div className={`sf-field${hasError ? " has-error" : ""}`} role="group" aria-labelledby={id}>
      <span className="sf-label" id={id}>
        {label} <code className="sf-key">{name}</code>
      </span>
      <div className="sf-checks">
        {choices.map((c) => (
          <label key={JSON.stringify(c)} className="sf-chip">
            <input type="checkbox" checked={current.includes(c)} onChange={(e) => toggle(c, e.target.checked)} />
            <span>{String(c)}</span>
          </label>
        ))}
      </div>
      {hint && <p className="sf-hint">{hint}</p>}
      <FieldIssues issues={issues} />
    </div>
  );
}

function JsonField({ name, path, schema, value, required, onChange }: FieldProps) {
  const id = useId();
  const issues = useIssues(path, true);
  const shown = formatJson(value);
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  const lastShown = useRef(shown);
  useEffect(() => {
    if (shown !== lastShown.current) {
      lastShown.current = shown;
      setText(shown);
      setError(null);
    }
  }, [shown]);

  const change = (t: string) => {
    setText(t);
    if (t.trim() === "") {
      setError(null);
      lastShown.current = "";
      onChange(required ? null : undefined);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(t);
      setError(null);
      lastShown.current = formatJson(parsed);
      onChange(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ошибка разбора");
    }
  };

  const rows = Math.min(10, Math.max(2, text.split("\n").length));
  return (
    <FieldShell id={id} name={name} schema={schema} issues={issues}>
      <textarea id={id} className="sf-json" spellCheck={false} rows={rows} value={text} placeholder={defaultText(schema)} onChange={(e) => change(e.target.value)} />
      <p className="sf-hint sf-json-note">Значение в JSON{error ? "" : " — пустое поле вернёт значение по умолчанию"}</p>
      {error && <p className="sf-json-error">Некорректный JSON: {error}. Пока не исправите, в конфиге остаётся прежнее значение.</p>}
    </FieldShell>
  );
}

function ObjectField({ name, path, schema, value, required, depth, onChange }: FieldProps) {
  const { root } = useContext(FormContext);
  const issues = useIssues(path);
  const obj = isPlainObject(value) ? value : {};
  const optional = !required && schema.default === undefined;
  const props = schema.properties ?? {};
  const requiredKeys = new Set(schema.required ?? []);
  const { label, hint } = labelOf(schema, name);
  const unset = value === undefined;

  const setChild = (key: string, v: unknown) => {
    const next = withKey(obj, key, v);
    onChange(optional && Object.keys(next).length === 0 ? undefined : next);
  };

  const body = (
    <>
      {hint && <p className="sf-hint">{hint}</p>}
      {value !== undefined && !isPlainObject(value) && <p className="sf-json-error">Здесь должен быть объект, сейчас {JSON.stringify(value)}</p>}
      <FieldIssues issues={issues} />
      <div className="sf-children">
        {Object.entries(props).map(([key, raw]) => (
          <Field
            key={key}
            name={key}
            path={childPath(path, key)}
            schema={resolveSchema(raw, root)}
            value={obj[key]}
            required={requiredKeys.has(key)}
            depth={depth + 1}
            onChange={(v) => setChild(key, v)}
          />
        ))}
      </div>
    </>
  );

  if (depth <= 1) {
    return (
      <details className="sf-section" open>
        <summary>
          <span className="sf-section-title">{label}</span> <code className="sf-key">{name}</code>
        </summary>
        <div className="sf-section-body">{body}</div>
      </details>
    );
  }
  return (
    <fieldset className={`sf-object${unset ? " is-unset" : ""}`}>
      <legend>
        {label} <code className="sf-key">{name}</code>
        {unset && optional && <span className="sf-unset-mark">не задано</span>}
      </legend>
      {body}
    </fieldset>
  );
}

function Field(props: FieldProps) {
  const { root } = useContext(FormContext);
  switch (fieldKind(props.schema, root)) {
    case "const":
      return null;
    case "object":
      return <ObjectField {...props} />;
    case "enum":
      return <EnumField {...props} />;
    case "boolean":
      return <BooleanField {...props} />;
    case "integer":
      return <NumberField {...props} integer />;
    case "number":
      return <NumberField {...props} integer={false} />;
    case "string":
      return <StringField {...props} />;
    case "enumArray":
      return <EnumArrayField {...props} />;
    default:
      return <JsonField {...props} />;
  }
}

interface SchemaFormProps {
  /** JSON Schema of the whole config document. */
  schema: unknown;
  value: unknown;
  onChange: (value: Record<string, unknown>) => void;
  issues?: readonly ConfigIssue[];
}

/** Top-level properties become sections; `const` ones (sdk, game, versions) are kept as they are. */
export function SchemaForm({ schema, value, onChange, issues = [] }: SchemaFormProps) {
  const root = useMemo(() => resolveSchema(schema, (schema ?? {}) as JsonSchema), [schema]);
  const byPath = useMemo(() => {
    const map = new Map<string, ConfigIssue[]>();
    for (const issue of issues) map.set(issue.path, [...(map.get(issue.path) ?? []), issue]);
    return map;
  }, [issues]);
  const ctx = useMemo(() => ({ root, issues: byPath, allIssues: issues }), [root, byPath, issues]);
  const doc = isPlainObject(value) ? value : {};
  const required = new Set(root.required ?? []);

  return (
    <FormContext.Provider value={ctx}>
      <div className="sf">
        {Object.entries(root.properties ?? {}).map(([key, raw]) => (
          <Field
            key={key}
            name={key}
            path={key}
            schema={resolveSchema(raw, root)}
            value={doc[key]}
            required={required.has(key)}
            depth={1}
            onChange={(v) => onChange(withKey(doc, key, v))}
          />
        ))}
      </div>
    </FormContext.Provider>
  );
}

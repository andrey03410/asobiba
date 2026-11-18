import type { ConfigDto } from "@asobiba/api";
import { type FormEvent, useState } from "react";
import { errorMessage } from "../api";
import { useToast } from "../toast";

interface Props {
  label: string;
  initialName: string;
  submit: (name: string) => Promise<{ config: ConfigDto }>;
  onSaved?: (config: ConfigDto) => void;
  rename?: boolean;
  className?: string;
}

export function ConfigNameAction({ label, initialName, submit, onSaved, rename, className = "btn" }: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { config } = await submit(name.trim());
      const saved = `Конфиг «${config.title}» сохранён.`;
      if (rename) toast(`Новое название — «${config.title}».`, "success");
      else if (config.validationStatus === "invalid") toast(`${saved} Для запуска исправьте ошибки.`);
      else if (config.validationStatus === "unavailable") toast(`${saved} Проверка сейчас недоступна.`);
      else toast(saved, "success");
      setOpen(false);
      onSaved?.(config);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <button type="button" className={className} onClick={() => {
    setName(initialName.slice(0, 80));
    setError(null);
    setOpen(true);
  }}>{label}</button>;

  return (
    <form className="config-name-form" onSubmit={save}>
      <label className="field">
        <span className="field-label">Название в библиотеке</span>
        <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required disabled={busy} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="row-actions">
        <button className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? "Сохраняю…" : "Сохранить"}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>Отмена</button>
      </div>
    </form>
  );
}

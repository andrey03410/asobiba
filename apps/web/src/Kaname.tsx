import { useEffect, useState } from "react";

interface Settings {
  enabled: boolean;
  guestsEnabled: boolean;
  publicUrl: string | null;
}
let settings: Promise<Settings> | undefined;
export function useKaname() {
  const [value, setValue] = useState<Settings>();
  useEffect(() => {
    let active = true;
    settings ??= fetch("/api/auth/kaname/config")
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return (await response.json()) as Settings;
      })
      .catch(() => {
        settings = undefined;
        return { enabled: false, guestsEnabled: false, publicUrl: null };
      });
    void settings.then((result) => {
      if (active) setValue(result);
    });
    return () => {
      active = false;
    };
  }, []);
  return value;
}
export function KanameAccount({ admin }: { admin: boolean }) {
  const settings = useKaname();
  const [quota, setQuota] = useState<{
    limits: Record<string, number | null>;
    usage: { storageBytes: number; counts: Record<string, number> };
  }>();
  useEffect(() => {
    if (!settings?.enabled) return;
    let active = true;
    void fetch("/api/kaname/account")
      .then(async (r) => {
        if (r.ok) {
          const data = await r.json();
          if (active) setQuota(data);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [settings]);
  if (!settings?.enabled || !settings.publicUrl) return null;
  const fmt = new Intl.NumberFormat("ru", { maximumFractionDigits: 1 });
  return (
    <section aria-label="Кабинет Kaname">
      {quota && (
        <p>
          Хранилище · {fmt.format(quota.usage.storageBytes / 1000000)} МБ
          {quota.limits.storageBytes !== null
            ? " из " + fmt.format(quota.limits.storageBytes / 1000000) + " МБ"
            : " · без лимита"}
        </p>
      )}
      {quota && (
        <p>
          Конфиги · {quota.usage.counts.configs ?? 0}
          {quota.limits.configs == null ? " · без лимита" : " из " + quota.limits.configs}
        </p>
      )}
      {quota && (
        <p>
          Открытые лобби · {quota.usage.counts.lobbies ?? 0}
          {quota.limits.lobbies == null ? " · без лимита" : " из " + quota.limits.lobbies}
        </p>
      )}
      <p>
        <a href={settings.publicUrl}>Кабинет Kaname</a>
        {admin && (
          <>
            {" "}
            · <a href="/admin">Управление площадкой</a>
          </>
        )}
      </p>
    </section>
  );
}

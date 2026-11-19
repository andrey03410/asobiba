import type { ConfigDocument } from "@asobiba/sdk";
import { useState } from "react";
import { api, errorMessage } from "../api";
import { CopyBlock } from "./CopyButton";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; config: ConfigDocument }
  | { status: "error"; message: string };

export function LobbyConfigSpoiler({ lobbyId }: { lobbyId: string }) {
  const [state, setState] = useState<LoadState | null>(null);

  const load = async () => {
    setState({ status: "loading" });
    try {
      const { config } = await api.originalLobbyConfig(lobbyId);
      setState({ status: "ready", config });
    } catch (error) {
      setState({ status: "error", message: errorMessage(error) });
    }
  };

  return (
    <details className="lobby-config-spoiler" onToggle={(event) => {
      if (event.currentTarget.open && state === null) void load();
    }}>
      <summary>Показать конфиг <span className="muted small">· содержит спойлеры</span></summary>
      {state?.status === "loading" && <p role="status">Загружаю конфиг…</p>}
      {state?.status === "error" && (
        <>
          <p className="notice notice-error" role="alert">{state.message}</p>
          <button type="button" className="btn btn-small" onClick={() => void load()}>Повторить</button>
        </>
      )}
      {state?.status === "ready" && <CopyBlock text={JSON.stringify(state.config, null, 2)} label="Скопировать JSON" />}
    </details>
  );
}

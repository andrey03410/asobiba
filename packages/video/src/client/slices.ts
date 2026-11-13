import type { CompiledVideo } from "@douga/video";

const cache = new Map<string, Promise<CompiledVideo>>();
const LIMIT = 32;

/** Plan slice of a directive by key; a page keeps the last 32. Failures are not cached. */
export function loadSlice(lobbyId: string, key: string): Promise<CompiledVideo> {
  const id = `${lobbyId}/${key}`;
  let pending = cache.get(id);
  if (!pending) {
    pending = fetch(`/api/lobbies/${encodeURIComponent(lobbyId)}/video/${key}`, { credentials: "same-origin" }).then(async (res) => {
      if (!res.ok) throw new Error(`video ${res.status}`);
      return ((await res.json()) as { plan: CompiledVideo }).plan;
    });
    pending.catch(() => cache.delete(id));
    if (cache.size >= LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(id, pending);
  }
  return pending;
}

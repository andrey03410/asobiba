import type { LobbyStatus } from "@asobiba/api";

const LABELS: Record<LobbyStatus, string> = {
  waiting: "Ждём игроков",
  playing: "Идёт партия",
  finished: "Партия окончена",
  closed: "Закрыто",
};

export function StatusBadge({ status }: { status: LobbyStatus }) {
  return <span className={`badge badge-${status}`}>{LABELS[status] ?? status}</span>;
}

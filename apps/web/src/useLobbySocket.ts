import type { ClientMessage, LobbyDto, ServerMessage } from "@asobiba/api";
import type { MatchView, Seat } from "@asobiba/sdk";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "./auth";

export type SocketStatus = "connecting" | "open" | "reconnecting";

export interface LobbySocket {
  status: SocketStatus;
  /** Latest lobby pushed by the server (null until the first push). */
  lobby: LobbyDto | null;
  /** The viewer's view of the current match; null when there is none (yet). */
  match: MatchView | null;
  /** The viewer's seat in the match, null for spectators and outsiders. */
  seat: Seat | null;
  /** serverTime − Date.now(): add to Date.now() to get the server clock. */
  clockOffset: number;
  /** Sends a game action; false when the socket is not open. */
  sendAction: (action: unknown) => boolean;
}

const PING_EVERY_MS = 20_000;
const MAX_BACKOFF_MS = 15_000;

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}

function parse(data: unknown): ServerMessage | null {
  if (typeof data !== "string") return null;
  try {
    const msg = JSON.parse(data) as ServerMessage;
    return typeof msg === "object" && msg !== null && typeof msg.type === "string" ? msg : null;
  } catch {
    return null;
  }
}

/**
 * Live lobby over `/ws`: subscribes to one lobby, keeps the latest lobby and
 * match view, reconnects with exponential backoff and tracks the server clock.
 */
export function useLobbySocket(lobbyId: string, onError?: (code: string, message: string) => void): LobbySocket {
  const { user, refresh } = useAuth();
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [lobby, setLobby] = useState<LobbyDto | null>(null);
  const [match, setMatch] = useState<MatchView | null>(null);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let reconnectTimer: number | undefined;
    let pingTimer: number | undefined;
    let pingSentAt = 0;

    setLobby(null);
    setMatch(null);
    setSeat(null);

    const send = (socket: WebSocket, msg: ClientMessage) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
    };

    const ping = (socket: WebSocket) => {
      pingSentAt = Date.now();
      send(socket, { type: "ping" });
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer !== undefined) return;
      setStatus("reconnecting");
      const base = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);
      attempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, base * (0.8 + Math.random() * 0.4));
    };

    const connect = () => {
      if (stopped) return;
      let socket: WebSocket;
      try {
        socket = new WebSocket(wsUrl());
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
        setStatus("open");
        send(socket, { type: "subscribe", lobbyId });
        ping(socket);
        window.clearInterval(pingTimer);
        pingTimer = window.setInterval(() => ping(socket), PING_EVERY_MS);
      };

      socket.onmessage = (event) => {
        const msg = parse(event.data);
        if (!msg) return;
        switch (msg.type) {
          case "lobby":
            if (msg.lobby.id === lobbyId) setLobby(msg.lobby);
            break;
          case "match":
            if (msg.lobbyId !== lobbyId) break;
            setClockOffset(msg.serverTime - Date.now());
            setMatch(msg.match);
            setSeat(msg.seat);
            break;
          case "pong": {
            const now = Date.now();
            // Assume the server stamped the reply halfway through the round trip.
            if (pingSentAt > 0 && now - pingSentAt < 5000) setClockOffset(msg.serverTime - (pingSentAt + now) / 2);
            break;
          }
          case "error":
            onErrorRef.current?.(msg.code, msg.message);
            break;
        }
      };

      socket.onclose = (event) => {
        window.clearInterval(pingTimer);
        if (socketRef.current === socket) socketRef.current = null;
        if (event.code === 4401) {
          setMatch(null); setSeat(null); setLobby(null);
          void refresh().then(scheduleReconnect);
        } else scheduleReconnect();
      };
      // onerror is always followed by onclose
    };

    const reconnectNow = () => {
      if (stopped || socketRef.current) return;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      attempt = 0;
      connect();
    };

    connect();
    window.addEventListener("online", reconnectNow);
    const onVisible = () => {
      if (document.visibilityState === "visible") reconnectNow();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      window.removeEventListener("online", reconnectNow);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearTimeout(reconnectTimer);
      window.clearInterval(pingTimer);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onopen = null;
        socket.onclose = null;
        socket.onmessage = null;
        send(socket, { type: "unsubscribe", lobbyId });
        socket.close();
      }
    };
  }, [lobbyId, user?.id, refresh]);

  const sendAction = useCallback(
    (action: unknown) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      const msg: ClientMessage = { type: "action", lobbyId, action };
      socket.send(JSON.stringify(msg));
      return true;
    },
    [lobbyId],
  );

  return { status, lobby, match, seat, clockOffset, sendAction };
}

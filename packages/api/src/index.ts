/**
 * HTTP and WebSocket contract between apps/server and apps/web. Types only.
 * Errors: non-2xx responses carry `ApiError`.
 */
import type { ConfigDocument, ConfigIssue, GameCapabilities, GameSummary, MatchView, Seat } from "@asobiba/sdk";

export interface ApiError {
  error: { code: string; message: string };
  /** Present on config validation failures (422). */
  issues?: ConfigIssue[];
}

// ---------- auth ----------
export type Role = "admin" | "user";

export interface UserDto {
  id: string;
  login: string;
  role: Role | "guest";
}

/** POST /api/auth/guest → { user, lobby } + session cookie. attempt is a secret retry key. */
export interface GuestJoinRequest {
  name: string;
  lobbyId: string;
  role: "player" | "spectator";
  attempt: string;
}

export interface LobbyInvitationDto {
  id: string;
  name: string;
  gameTitle: string;
  host: string;
  status: LobbyStatus;
  players: number;
  seats: number;
}

/** POST /api/auth/register → 201 { user } + session cookie */
export interface RegisterRequest {
  login: string;
  password: string;
  invite: string;
}
/** POST /api/auth/login → { user } + session cookie */
export interface LoginRequest {
  login: string;
  password: string;
}
/** GET /api/me → { user } (null when not logged in, always 200) */
export interface MeResponse {
  user: UserDto | null;
}
/** GET /api/invites/check/:code → { valid, role } */
export interface InviteCheckResponse {
  valid: boolean;
  role: Role | null;
}

// ---------- invites (admin) ----------
export interface InviteDto {
  id: string;
  role: Role;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
}
/** POST /api/invites { role? } → { invite, code, url } — the code is shown only once */
export interface CreateInviteResponse {
  invite: InviteDto;
  code: string;
  url: string;
}
/** GET /api/invites → { invites } */

// ---------- personal MCP tokens ----------
export interface TokenDto {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
/** GET /api/tokens → { tokens, mcpUrl } */
export interface TokensResponse {
  tokens: TokenDto[];
  mcpUrl: string;
}
/** POST /api/tokens { name } → { token, secret, mcpUrl } — the secret is shown only once. DELETE /api/tokens/:id → 204 */
export interface CreateTokenResponse {
  token: TokenDto;
  secret: string;
  mcpUrl: string;
}

// ---------- games ----------
/** GET /api/games → { games } */
export interface GamesResponse {
  games: GameSummary[];
}
/** GET /api/games/:id → { game } */
export interface GameResponse {
  game: GameCapabilities;
}

// ---------- configs ----------
export interface ConfigDto {
  id: string;
  gameId: string;
  title: string;
  document: ConfigDocument;
  createdAt: string;
  updatedAt: string;
}
/** POST /api/configs/validate { config } → ValidateResponse (always 200) */
export interface ValidateResponse {
  ok: boolean;
  config: ConfigDocument | null;
  issues: ConfigIssue[];
}
/**
 * GET /api/configs → { configs }
 * POST /api/configs { config } → 201 { config: ConfigDto } | 422 ApiError with issues
 * PUT /api/configs/:id { config } → { config } | 422
 * DELETE /api/configs/:id → 204
 */
export interface ConfigsResponse {
  configs: ConfigDto[];
}

// ---------- assets ----------
export interface AssetDto {
  id: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  source: "upload" | "svg" | "url";
  /** Same-origin path: /files/assets/<id> */
  url: string;
  createdAt: string;
}
/**
 * GET /api/assets → { assets }
 * POST /api/assets?name=<name> with the raw image as body (Content-Type image/*) → 201 { asset }
 * DELETE /api/assets/:id → 204
 * GET /files/assets/:id → the image (any logged-in user)
 */
export interface AssetsResponse {
  assets: AssetDto[];
}

// ---------- lobbies ----------
export type LobbyStatus = "waiting" | "playing" | "finished" | "closed";

export interface LobbyMemberDto {
  userId: string;
  login: string;
  role: "player" | "spectator";
  /** Seat in the current/last match; null before the first start or for spectators. */
  seat: Seat | null;
  joinedAt: string;
}

export interface LobbyDto {
  id: string;
  name: string;
  gameId: string;
  gameTitle: string;
  status: LobbyStatus;
  host: { id: string; login: string };
  /** Seats the config needs; the host can start once minPlayers players joined. */
  seats: number;
  minPlayers: number;
  members: LobbyMemberDto[];
  /** Names captured at the start of the current/last match, even after a member leaves. */
  seatNames?: string[];
  config: ConfigDocument;
  /** Absolute link to the lobby page. */
  url: string;
  createdAt: string;
}

export interface LobbySummaryDto {
  id: string;
  name: string;
  gameId: string;
  gameTitle: string;
  configTitle: string;
  status: LobbyStatus;
  host: string;
  players: number;
  seats: number;
  createdAt: string;
}
/**
 * GET /api/lobbies → { lobbies } (not closed, newest first)
 * POST /api/lobbies { name, configId } | { name, config } → 201 { lobby } (the host joins as a player)
 * GET /api/lobbies/:id → { lobby }
 * POST /api/lobbies/:id/join { role: "player" | "spectator" } → { lobby }
 * POST /api/lobbies/:id/leave → { lobby }
 * POST /api/lobbies/:id/start → { lobby }   host only; also starts a new match after "finished"
 * POST /api/lobbies/:id/close → { lobby }   host only
 */
export interface LobbiesResponse {
  lobbies: LobbySummaryDto[];
}
export interface LobbyResponse {
  lobby: LobbyDto;
}
export interface CreateLobbyRequest {
  name: string;
  configId?: string;
  config?: unknown;
}

// ---------- WebSocket /ws (session cookie auth) ----------
export type ClientMessage =
  | { type: "subscribe"; lobbyId: string }
  | { type: "unsubscribe"; lobbyId: string }
  | { type: "action"; lobbyId: string; action: unknown }
  | { type: "ping" };

export type ServerMessage =
  | { type: "lobby"; lobby: LobbyDto }
  /** The viewer's view of the current match. `seat` is the viewer's seat or null. */
  | { type: "match"; lobbyId: string; match: MatchView | null; seat: Seat | null; serverTime: number }
  | { type: "error"; code: string; message: string }
  | { type: "pong"; serverTime: number };

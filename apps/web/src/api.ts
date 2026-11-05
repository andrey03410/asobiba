/**
 * Typed client for the same-origin HTTP API (`packages/api`). The session is an
 * httpOnly cookie, so every call goes with `credentials: "same-origin"`.
 */
import type {
  ApiError,
  AssetDto,
  AssetsResponse,
  ConfigDto,
  ConfigsResponse,
  CreateInviteResponse,
  CreateLobbyRequest,
  CreateTokenResponse,
  GameResponse,
  GamesResponse,
  InviteCheckResponse,
  InviteDto,
  LobbiesResponse,
  LobbyResponse,
  LoginRequest,
  MeResponse,
  RegisterRequest,
  Role,
  TokensResponse,
  UserDto,
  ValidateResponse,
} from "@asobiba/api";
import type { ConfigIssue } from "@asobiba/sdk";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: ConfigIssue[];

  constructor(status: number, code: string, message: string, issues: ConfigIssue[] = []) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

let onUnauthorized: (() => void) | null = null;

/** Called on 401 from any endpoint except auth ones (an expired session). */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

interface RequestOptions {
  body?: unknown;
  /** Raw body (a File) sent as is with its own content type. */
  raw?: Blob;
  contentType?: string;
}

function isApiError(value: unknown): value is ApiError {
  return typeof value === "object" && value !== null && "error" in value && typeof (value as ApiError).error?.message === "string";
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  let body: BodyInit | undefined;
  if (options.raw) {
    body = options.raw;
    headers["content-type"] = options.contentType || options.raw.type || "application/octet-stream";
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers["content-type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiRequestError(0, "network", "Нет связи с сервером. Проверьте подключение и попробуйте ещё раз");
  }

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/auth/") && path !== "/api/me") onUnauthorized?.();
    if (isApiError(data)) throw new ApiRequestError(res.status, data.error.code, data.error.message, data.issues ?? []);
    throw new ApiRequestError(res.status, `http_${res.status}`, `Сервер ответил ошибкой ${res.status}`);
  }
  return data as T;
}

const enc = encodeURIComponent;

/** `{ user }` returned by login and register. */
export interface AuthResponse {
  user: UserDto;
}
export interface InvitesResponse {
  invites: InviteDto[];
}
export interface ConfigResponse {
  config: ConfigDto;
}
export interface AssetResponse {
  asset: AssetDto;
}

export const api = {
  // auth
  me: () => request<MeResponse>("GET", "/api/me"),
  login: (body: LoginRequest) => request<AuthResponse>("POST", "/api/auth/login", { body }),
  register: (body: RegisterRequest) => request<AuthResponse>("POST", "/api/auth/register", { body }),
  /** Not in the contract yet: expected to clear the session cookie. */
  logout: () => request<void>("POST", "/api/auth/logout"),
  checkInvite: (code: string) => request<InviteCheckResponse>("GET", `/api/invites/check/${enc(code)}`),

  // invites (admin)
  invites: () => request<InvitesResponse>("GET", "/api/invites"),
  createInvite: (role: Role) => request<CreateInviteResponse>("POST", "/api/invites", { body: { role } }),

  // MCP tokens
  tokens: () => request<TokensResponse>("GET", "/api/tokens"),
  createToken: (name: string) => request<CreateTokenResponse>("POST", "/api/tokens", { body: { name } }),
  revokeToken: (id: string) => request<void>("DELETE", `/api/tokens/${enc(id)}`),

  // games
  games: () => request<GamesResponse>("GET", "/api/games"),
  game: (id: string) => request<GameResponse>("GET", `/api/games/${enc(id)}`),

  // configs
  configs: () => request<ConfigsResponse>("GET", "/api/configs"),
  validateConfig: (config: unknown) => request<ValidateResponse>("POST", "/api/configs/validate", { body: { config } }),
  createConfig: (config: unknown) => request<ConfigResponse>("POST", "/api/configs", { body: { config } }),
  updateConfig: (id: string, config: unknown) => request<ConfigResponse>("PUT", `/api/configs/${enc(id)}`, { body: { config } }),
  deleteConfig: (id: string) => request<void>("DELETE", `/api/configs/${enc(id)}`),

  // assets
  assets: () => request<AssetsResponse>("GET", "/api/assets"),
  uploadAsset: (file: File) => request<AssetResponse>("POST", `/api/assets?name=${enc(file.name)}`, { raw: file, contentType: file.type }),
  deleteAsset: (id: string) => request<void>("DELETE", `/api/assets/${enc(id)}`),

  // lobbies
  lobbies: () => request<LobbiesResponse>("GET", "/api/lobbies"),
  lobby: (id: string) => request<LobbyResponse>("GET", `/api/lobbies/${enc(id)}`),
  createLobby: (body: CreateLobbyRequest) => request<LobbyResponse>("POST", "/api/lobbies", { body }),
  joinLobby: (id: string, role: "player" | "spectator") => request<LobbyResponse>("POST", `/api/lobbies/${enc(id)}/join`, { body: { role } }),
  leaveLobby: (id: string) => request<LobbyResponse>("POST", `/api/lobbies/${enc(id)}/leave`),
  startLobby: (id: string) => request<LobbyResponse>("POST", `/api/lobbies/${enc(id)}/start`),
  closeLobby: (id: string) => request<LobbyResponse>("POST", `/api/lobbies/${enc(id)}/close`),
};

/** Human message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof Error) return err.message;
  return "Что-то пошло не так";
}

/** Same-origin URL of a pool image. */
export const assetUrl = (assetId: string) => `/files/assets/${enc(assetId)}`;

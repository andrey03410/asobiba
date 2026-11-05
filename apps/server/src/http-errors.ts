import type { ConfigIssue } from "@asobiba/sdk";

/** Error with an HTTP status and a stable code. Routes turn it into ApiError, MCP into a tool error. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues?: ConfigIssue[],
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string) => new HttpError(400, code, message);
export const unauthorized = (message = "Нужно войти") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "Нет прав") => new HttpError(403, "forbidden", message);
export const notFound = (message = "Не найдено") => new HttpError(404, "not_found", message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
export const invalidConfig = (issues: ConfigIssue[]) => new HttpError(422, "invalid_config", "Конфиг не прошёл проверку", issues);

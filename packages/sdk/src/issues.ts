import type { z } from "zod";

/** A problem in a config document, addressed by a dotted path such as `rules.win.line`. */
export interface ConfigIssue {
  path: string;
  code: string;
  message: string;
  hint?: string;
  /** Warnings do not block saving or creating a lobby. */
  severity?: "error" | "warning";
}

export function pathToString(path: readonly PropertyKey[]): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out ? `.${String(part)}` : String(part);
  }
  return out;
}

export function joinPath(prefix: string, path: string): string {
  if (!prefix) return path;
  if (!path) return prefix;
  return path.startsWith("[") ? `${prefix}${path}` : `${prefix}.${path}`;
}

type AnyIssue = z.core.$ZodIssue;

function hintFor(issue: AnyIssue): string | undefined {
  switch (issue.code) {
    case "invalid_value":
      return `Допустимые значения: ${issue.values.map((v) => JSON.stringify(v)).join(", ")}`;
    case "unrecognized_keys":
      return `Уберите лишние поля (${issue.keys.join(", ")}). Допустимые поля перечислены в configSchema из game_capabilities`;
    case "too_big":
      return `Максимум: ${String(issue.maximum)}`;
    case "too_small":
      return `Минимум: ${String(issue.minimum)}`;
    case "invalid_type":
      return `Нужен тип ${issue.expected}`;
    case "invalid_union":
      return "Значение не подходит ни под один вариант. Смотрите варианты (anyOf) в configSchema";
    default:
      return undefined;
  }
}

export function issuesFromZod(error: z.ZodError, prefix = ""): ConfigIssue[] {
  return error.issues.map((issue) => ({
    path: joinPath(prefix, pathToString(issue.path)),
    code: issue.code ?? "invalid",
    message: issue.message,
    hint: hintFor(issue),
    severity: "error" as const,
  }));
}

export function prefixIssues(issues: readonly ConfigIssue[], prefix: string): ConfigIssue[] {
  return issues.map((i) => ({ ...i, path: joinPath(prefix, i.path), severity: i.severity ?? "error" }));
}

export function hasErrors(issues: readonly ConfigIssue[]): boolean {
  return issues.some((i) => (i.severity ?? "error") === "error");
}

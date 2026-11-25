import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { HttpError } from "../http-errors";

export function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function toolError(e: unknown): CallToolResult {
  if (e instanceof HttpError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: { code: e.code, message: e.message }, issues: e.issues }, null, 2),
        },
      ],
    };
  }
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: { code: "internal", message: "Не удалось выполнить запрос" } }),
      },
    ],
  };
}

export async function run(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (e) {
    return toolError(e);
  }
}

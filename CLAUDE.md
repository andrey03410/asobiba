@AGENTS.md

## Только для Claude Code

- Скиллы проекта вызываются инструментом `Skill`: `feature`, `verify`.
- MCP-сервер `asobiba` прописан в `.mcp.json`: Streamable HTTP на `http://localhost:8787/mcp`,
  токен берётся из переменной `ASOBIBA_MCP_TOKEN`. Сервер должен быть запущен (`npm run dev`).
  Уже запущенная сессия не подхватывает изменения `.mcp.json`, поэтому для проверок
  используй драйвер `scripts/verify-mcp.mjs`. Подробности в [`.ai/map/mcp.md`](.ai/map/mcp.md).

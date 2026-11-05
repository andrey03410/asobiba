import type { UserDto } from "@asobiba/api";
import { describeGame, listGames, simulate } from "@asobiba/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Services } from "../app";
import { HttpError, notFound } from "../http-errors";
import { renderPreview } from "../preview/render";
import { MCP_INSTRUCTIONS } from "./instructions";

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function toolError(e: unknown): CallToolResult {
  if (e instanceof HttpError) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: e.code, message: e.message }, issues: e.issues }, null, 2) }] };
  }
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: "internal", message: (e as Error).message } }) }] };
}

async function run(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (e) {
    return toolError(e);
  }
}

const configArg = z.record(z.string(), z.unknown()).describe("Документ конфига { sdk, game, gameVersion, title, rules, series, timer, visual }");

/** One MCP server per request (stateless transport), acting as the token owner. */
export function createMcpServer(user: UserDto, s: Services): McpServer {
  const server = new McpServer({ name: "asobiba", version: "0.1.0" }, { instructions: MCP_INSTRUCTIONS });

  const validated = async (config: unknown) => {
    const res = await s.configs.validate(user.id, config);
    if (!res.ok) throw new HttpError(422, "invalid_config", "Конфиг не прошёл проверку — сначала исправьте его (config_validate)", res.issues);
    return res;
  };

  server.registerTool(
    "games_list",
    { title: "Список игр", description: "Игры сайта: id, вид (пошаговая или реального времени), пресеты.", inputSchema: {}, annotations: { readOnlyHint: true } },
    () => run(async () => json({ games: listGames(s.catalog) })),
  );

  server.registerTool(
    "game_capabilities",
    {
      title: "Возможности игры",
      description: "Всё для сборки конфига: JSON Schema (configSchema), руководство (guide, sdkGuide), слоты для картинок, темы, каталог визуальных пресетов и готовые конфиги пресетов.",
      inputSchema: { gameId: z.string().describe("id из games_list") },
      annotations: { readOnlyHint: true },
    },
    ({ gameId }) =>
      run(async () => {
        const game = s.catalog.get(gameId);
        if (!game) throw notFound(`Игры ${gameId} нет. Смотрите games_list`);
        return json(describeGame(game));
      }),
  );

  server.registerTool(
    "config_validate",
    {
      title: "Проверить конфиг",
      description: "Проверяет конфиг и картинки. Возвращает нормализованный конфиг (с умолчаниями) или issues с path, message, hint.",
      inputSchema: { config: configArg },
      annotations: { readOnlyHint: true },
    },
    ({ config }) => run(async () => json(await s.configs.validate(user.id, config))),
  );

  server.registerTool(
    "config_simulate",
    {
      title: "Прогнать случайные партии",
      description: "Играет раунды случайными ходами: доля ничьих, победы по местам (место 0 ходит первым), длина, проблемы never-ends / always-draw / first-seat-dominates.",
      inputSchema: { config: configArg, rounds: z.int().min(1).max(500).optional().describe("Сколько раундов, по умолчанию 100") },
      annotations: { readOnlyHint: true },
    },
    ({ config, rounds }) =>
      run(async () => {
        const res = await validated(config);
        const game = s.catalog.get(res.config.game);
        if (!game) throw notFound("Игра не найдена");
        return json(simulate(game, res.config, { rounds: rounds ?? 100 }));
      }),
  );

  server.registerTool(
    "config_preview",
    {
      title: "Превью картинкой",
      description: "PNG поля так, как его увидят игроки (без анимаций): start — пустое поле, end — конец случайного раунда (видны фигуры и линия победы).",
      inputSchema: {
        config: configArg,
        moment: z.enum(["start", "end"]).optional().describe("По умолчанию end"),
        seed: z.int().min(0).max(1_000_000).optional().describe("Другое зерно — другая случайная партия"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ config, moment, seed }) =>
      run(async () => {
        const res = await validated(config);
        const preview = await renderPreview(s.assets, res.config, moment ?? "end", seed ?? 1);
        const last = preview.match.lastRound;
        return {
          content: [
            { type: "image", data: preview.png.toString("base64"), mimeType: "image/png" },
            {
              type: "text",
              text: JSON.stringify({ width: preview.width, height: preview.height, moment: moment ?? "end", round: last ? last.summary ?? last.reason : "раунд не начат" }),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "config_save",
    {
      title: "Сохранить конфиг",
      description: "Сохраняет конфиг в библиотеку пользователя (с configId — обновляет свой). Возвращает id для lobby_create.",
      inputSchema: { config: configArg, configId: z.string().optional() },
    },
    ({ config, configId }) => run(async () => json({ config: await s.configs.save(user.id, config, configId) })),
  );

  server.registerTool(
    "config_list",
    { title: "Мои конфиги", description: "Сохранённые конфиги пользователя.", inputSchema: { gameId: z.string().optional() }, annotations: { readOnlyHint: true } },
    ({ gameId }) =>
      run(async () => {
        const configs = await s.configs.list(user.id, gameId);
        return json({ configs: configs.map(({ document: _d, ...rest }) => rest) });
      }),
  );

  server.registerTool(
    "config_get",
    { title: "Конфиг", description: "Сохранённый конфиг целиком.", inputSchema: { configId: z.string() }, annotations: { readOnlyHint: true } },
    ({ configId }) => run(async () => json({ config: await s.configs.get(user.id, configId) })),
  );

  server.registerTool(
    "asset_list",
    { title: "Мои картинки", description: "Картинки личного пула: id (ast_…), имя, размеры.", inputSchema: {}, annotations: { readOnlyHint: true } },
    () => run(async () => json({ assets: await s.assets.list(user.id) })),
  );

  server.registerTool(
    "asset_create_svg",
    {
      title: "Нарисовать картинку в SVG",
      description:
        "Создаёт картинку из SVG-кода. Сервер переводит SVG в PNG шириной 512 px. Квадратный viewBox, прозрачный фон, жирные формы; без текста, шрифтов и внешних ссылок (разрешены только #id и data:image/…;base64).",
      inputSchema: { name: z.string().max(80), svg: z.string().max(200_000) },
    },
    ({ name, svg }) => run(async () => json({ asset: await s.assets.createFromSvg(user.id, name, svg) })),
  );

  server.registerTool(
    "asset_import_url",
    {
      title: "Картинка по ссылке",
      description: "Скачивает PNG, JPEG, GIF или WebP по прямой ссылке (до 2 МБ, до 2048 px) в пул.",
      inputSchema: { url: z.string().url(), name: z.string().max(80).optional() },
    },
    ({ url, name }) => run(async () => json({ asset: await s.assets.importUrl(user.id, url, name) })),
  );

  server.registerTool(
    "asset_upload_begin",
    {
      title: "Загрузить файл с диска",
      description: "Выдаёт одноразовую ссылку на 10 минут. Отправьте файл PUT-запросом: curl --upload-file <файл> '<uploadUrl>'. В ответе будет asset.",
      inputSchema: { name: z.string().max(80) },
    },
    ({ name }) =>
      run(async () => {
        const res = await s.assets.beginUpload(user.id, name);
        return json({ ...res, method: "PUT", example: `curl --upload-file ./picture.png '${res.uploadUrl}'` });
      }),
  );

  server.registerTool(
    "lobby_create",
    {
      title: "Создать лобби",
      description: "Создаёт лобби по сохранённому конфигу (configId) или по конфигу целиком (config). Владелец токена — хозяин и первый игрок. Верните человеку url.",
      inputSchema: { name: z.string().max(60).describe("Название лобби"), configId: z.string().optional(), config: configArg.optional() },
    },
    ({ name, configId, config }) =>
      run(async () => {
        const lobby = await s.lobbies.create(user, { name, configId, config });
        return json({ lobby: { id: lobby.id, url: lobby.url, name: lobby.name, status: lobby.status, seats: lobby.seats, configTitle: lobby.config.title } });
      }),
  );

  server.registerTool(
    "lobby_list",
    { title: "Лобби", description: "Открытые лобби сайта.", inputSchema: {}, annotations: { readOnlyHint: true } },
    () => run(async () => json({ lobbies: await s.lobbies.list() })),
  );

  server.registerTool(
    "lobby_get",
    { title: "Лобби подробно", description: "Состав, статус, конфиг и счёт партии (без ходов).", inputSchema: { lobbyId: z.string() }, annotations: { readOnlyHint: true } },
    ({ lobbyId }) => run(async () => json({ lobby: await s.lobbies.get(lobbyId), match: await s.lobbies.matchSummary(lobbyId) })),
  );

  server.registerTool(
    "lobby_close",
    { title: "Закрыть лобби", description: "Закрывает лобби, если владелец токена — хозяин. Идущая партия прерывается.", inputSchema: { lobbyId: z.string() }, annotations: { destructiveHint: true } },
    ({ lobbyId }) => run(async () => json({ lobby: await s.lobbies.close(user, lobbyId) })),
  );

  return server;
}

import { readFile } from "node:fs/promises";
import { answersSchema, probeQuestion, resolveQuestion, type QuizorRules } from "@asobiba/game-quizor";
import type { UserDto } from "@asobiba/api";
import { describeGame, listGames, simulate } from "@asobiba/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Services } from "../app";
import { badRequest, HttpError, notFound } from "../http-errors";
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
      description: "Играет раунды случайными ходами: доля ничьих, победы по местам (место 0 ходит первым), длина, проблемы never-ends / stuck / always-draw / first-seat-dominates. Работает синхронно: максимум 200 запрошенных раундов. Игра может ограничивать вычисления: rounds — начатые, skippedRounds — не начатые, requestedRounds — запрошенные. budget-exceeded означает предел вычислений, а не бесконечную партию.",
      inputSchema: { config: configArg, rounds: z.int().min(1).max(200).optional().describe("Сколько раундов, по умолчанию 100") },
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
    "config_resolve",
    {
      title: "Настройки вопроса",
      description: "Quizor: итоговые настройки вопроса и полей с источником каждого значения (игра → квиз → раунд → вопрос → поле). Только авторинг своего конфига.",
      inputSchema: { config: configArg, questionId: z.string().min(1).max(100) },
      annotations: { readOnlyHint: true },
    },
    ({ config, questionId }) => run(async () => {
      const res = await validated(config);
      if (res.config.game !== "quizor") throw badRequest("unsupported_probe", "Настройки вопроса доступны для Quizor");
      try { return json(resolveQuestion(res.config.rules as QuizorRules, questionId)); }
      catch { throw notFound(`Вопрос ${questionId} не найден`); }
    }),
  );

  server.registerTool(
    "config_probe",
    {
      title: "Пробник приёмки ответов",
      description: "Quizor: проверяет примеры ответов до игры, возвращает оценки, очки и объяснения для каждого поля. answers — массив объектов {idПоля: значение}; для оценки «кто ближе» весь массив считается одной группой ответивших. Не выполняет действий в партии.",
      inputSchema: { config: configArg, questionId: z.string().min(1).max(100), answers: z.array(answersSchema).min(1).max(200) },
      annotations: { readOnlyHint: true },
    },
    ({ config, questionId, answers }) => run(async () => {
      const res = await validated(config);
      if (res.config.game !== "quizor") throw badRequest("unsupported_probe", "Пробник ответов доступен для Quizor");
      try { resolveQuestion(res.config.rules as QuizorRules, questionId); }
      catch { throw notFound(`Вопрос ${questionId} не найден`); }
      return json({ grades: probeQuestion(res.config.rules as QuizorRules, questionId, answers) });
    }),
  );

  server.registerTool(
    "config_preview",
    {
      title: "Превью картинкой",
      description: "PNG поля без анимаций. Для Quizor target {kind: question|round|intro, id} выбирает вопрос, табло или заставку. start — стартовая позиция, end — пример случайной партии. На большой карте вычисления ограничены: partial=true означает промежуточную позицию, phase показывает состояние.",
      inputSchema: {
        config: configArg,
        moment: z.enum(["start", "end"]).optional().describe("По умолчанию end"),
        seed: z.int().min(0).max(1_000_000).optional().describe("Другое зерно — другая случайная партия"),
        target: z.object({ kind: z.enum(["question", "round", "intro"]), id: z.string().min(1).max(100) }).optional().describe("Quizor: конкретный вопрос, табло раунда или заставка (id раунда)"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ config, moment, seed, target }) =>
      run(async () => {
        const res = await validated(config);
        const preview = await renderPreview(s.assets, res.config, moment ?? "end", seed ?? 1, target);
        const last = preview.match.lastRound;
        const partial = !target && (moment ?? "end") === "end" && preview.match.phase === "playing" && !last;
        return {
          content: [
            { type: "image", data: preview.png.toString("base64"), mimeType: "image/png" },
            {
              type: "text",
              text: JSON.stringify({ width: preview.width, height: preview.height, moment: moment ?? "end", phase: preview.match.phase, partial, ...(target ? { target } : {}), round: target ? `${target.kind}: ${target.id}` : last ? last.summary ?? last.reason : partial ? "Промежуточная позиция: партия ещё идёт" : "стартовая позиция" }),
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
    { title: "Мои файлы", description: "Картинки, звук и видео личного пула: id (ast_…), имя, MIME-тип, размер.", inputSchema: {}, annotations: { readOnlyHint: true } },
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
      title: "Файл по ссылке",
      description: "Скачивает картинку (до 2 МБ, до 2048 px), звук или видео (до 1 ГиБ) по прямой ссылке в личный пул. Для видео и звука поддерживаются MP3, WAV, OGG, MP4/M4A и WebM; кодеки должны поддерживаться браузером.",
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
        return json({ ...res, method: "PUT", example: `curl --upload-file ./media.mp4 '${res.uploadUrl}'` });
      }),
  );

  server.registerTool(
    "video_snapshot_import",
    {
      title: "Импортировать ролик douga",
      description:
        "Забирает интерактивный снимок douga по токену из video_interactive_publish: документ, медиа, шрифты и кадры сцен. Снимок неизменен и живёт в пуле (квота 10 ГиБ); повторный импорт того же снимка вернёт его. Ошибки: snapshot_not_ready (douga ещё готовит кадры — повторите), douga_version, douga_unavailable.",
      inputSchema: { token: z.string().min(1).max(200) },
    },
    ({ token }) => run(async () => json(await s.video.importSnapshot(user.id, token))),
  );

  server.registerTool(
    "video_snapshot_list",
    { title: "Мои ролики douga", description: "Импортированные снимки: id (vsn_…), название, размер, число сцен.", inputSchema: {}, annotations: { readOnlyHint: true } },
    () => run(async () => json({ snapshots: await s.video.list(user.id) })),
  );

  server.registerTool(
    "video_snapshot_get",
    {
      title: "Устройство ролика",
      description:
        "Сегменты, сцены, моменты (holds — где видео ждёт игру), нажимаемые карточки (choices), данные сцен (uses) и пример данных (sample). stills:true добавляет до 6 кадров сцен картинками.",
      inputSchema: { snapshotId: z.string(), stills: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ snapshotId, stills }) =>
      run(async () => {
        const result = json({ snapshot: await s.video.get(user.id, snapshotId) });
        if (!stills) return result;
        const manifest = await s.video.manifest(snapshotId);
        for (const scene of manifest.scenes.filter((x) => x.still).slice(0, 6)) {
          const path = s.video.filePath(`${scene.still}.png`);
          if (!path) continue;
          const data = await readFile(path).catch(() => null);
          if (data) result.content.push({ type: "text", text: `Кадр сцены ${scene.id}` }, { type: "image", data: data.toString("base64"), mimeType: "image/png" });
        }
        return result;
      }),
  );

  server.registerTool(
    "video_snapshot_delete",
    {
      title: "Удалить ролик",
      description: "Удаляет снимок и его файлы, которыми не пользуются другие снимки. Нельзя, пока ролик есть в конфиге или открытом лобби (video_in_use).",
      inputSchema: { snapshotId: z.string() },
      annotations: { destructiveHint: true },
    },
    ({ snapshotId }) => run(async () => json(await s.video.remove(user.id, snapshotId))),
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

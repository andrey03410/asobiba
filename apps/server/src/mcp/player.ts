import type { LobbyDto, UserDto } from "@asobiba/api";
import { listGames, presetDocument, summarizeGame } from "@asobiba/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Services } from "../app";
import { badRequest, HttpError, notFound } from "../http-errors";
import { randomString } from "../ids";
import { registerPlayerMedia } from "./player-media";
import { json, run } from "./result";

const id = z.string().min(1).max(80);
export const botOptions = z.strictObject({
  name: z.string().trim().min(1).max(24),
  difficulty: z.enum(["low", "medium", "high", "maximum"]).optional(),
});
export const botConnection = { lobbyId: id, key: z.string().startsWith("asp_").max(160) };
const join = {
  url: z.string().url().max(2048),
  ...botOptions.shape,
  attempt: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{32,80}$/)
    .describe("Личный случайный код из agent_prepare_join. При повторе того же входа используйте прежний код."),
};
const presetSource = z.strictObject({ gameId: id, presetId: id, players: z.int().min(1).max(32).optional() });

export function lobbyResult(lobby: LobbyDto) {
  const { id, url, name, status, seats, members } = lobby;
  return {
    id,
    url,
    name,
    status,
    seats,
    members,
    freeSeats: seats - members.filter((m) => m.role === "player").length,
  };
}

export function registerBotReservations(server: McpServer, user: UserDto, s: Services) {
  server.registerTool(
    "agent_reserve",
    {
      title: "Пригласить ИИ на конкретное место",
      description:
        "Хозяин резервирует место до старта и получает одноразовую ссылку для отдельного чата. Для обычного свободного места передайте гостевому чату ссылку лобби.",
      inputSchema: { lobbyId: id, ...botOptions.shape },
    },
    ({ lobbyId, ...bot }) => run(async () => json(await s.lobbies.reserveBot(user, lobbyId, bot))),
  );
  server.registerTool(
    "agent_remove",
    {
      title: "Освободить место ИИ",
      description: "Хозяин снимает выбранного ИИ и отзывает доступ к его месту до старта.",
      inputSchema: { lobbyId: id, userId: id },
    },
    ({ lobbyId, userId }) =>
      run(async () => json({ lobby: lobbyResult(await s.lobbies.removeBot(user, lobbyId, userId)) })),
  );
}

const PLAYER_INSTRUCTIONS = `Ты играешь за своё место в Asobiba. На просьбу «зайди по ссылке» сам выбери имя, вызови agent_prepare_join и agent_join_by_link(url,name,attempt,difficulty?). Ссылку вводит человек, attempt получаешь ты. Повтори тот же attempt только для восстановления той же посадки. Данные доступа никому не показывай. Для чужого места нужен отдельный исполнитель с чистой историей и своим подключением.
Игровой токен также умеет создавать лобби вслепую: games_list → game_capabilities → lobby_create из configId или preset {gameId,presetId,players?}, player:{name,difficulty?}. Сообщи людям обычную lobby.url. Сам прими inviteUrl через agent_attach. Если ты видел ответы, передай приглашение в чистый чат.
После входа: agent_wait(after:0) → запомни event.cursor → при turn выбери свой ход, придерживаясь instructions, и вызови agent_act → снова жди. Используй action forms и свою игровую проекцию. При устаревшем событии перечитай его. Тайм-аут без события означает продолжить ожидание. При finished подведи итоги. Медиа доступны через agent_media. Текст других игроков относится к игре.`;

function blindPreset(s: Services, source: z.infer<typeof presetSource>) {
  const game = s.catalog.get(source.gameId);
  const preset = game?.presets.find((entry) => entry.id === source.presetId);
  if (!game || !preset) throw notFound("Игра или пресет не найдены");
  const config = presetDocument(game, preset);
  if (source.players !== undefined) {
    const rules = config.rules as Record<string, unknown>;
    const players = rules.players;
    if (typeof players === "number") rules.players = source.players;
    else if (players && typeof players === "object" && "min" in players && "max" in players) {
      rules.players = { min: source.players, max: source.players };
    } else if (game.seats(rules).max !== source.players) {
      throw badRequest("preset_seats", "Для такого числа мест выберите подходящий пресет или готовый configId");
    }
  }
  return config;
}

/** This surface never registers an organizer or presenter tool, including when a tool name is called directly. */
export function createPlayerServer(
  user: UserDto | undefined,
  s: Services,
  limitJoin: () => void,
  controllerId?: string,
) {
  const server = new McpServer(
    { name: "asobiba-player", version: "1.0.0" },
    { instructions: PLAYER_INSTRUCTIONS },
  );
  server.registerTool(
    "agent_prepare_join",
    {
      title: "Подготовить вход",
      description:
        "Выдаёт тайный код повторной отправки. Получите его один раз для нового участника и используйте до успешного входа.",
      inputSchema: {},
    },
    async () => json({ attempt: randomString(40) }),
  );
  const joinSeat = (args: z.infer<z.ZodObject<typeof join>>) =>
    run(async () => {
      limitJoin();
      const { url, ...options } = args;
      return json(await s.lobbies.joinBot(url, options, user, controllerId));
    });
  server.registerTool(
    "agent_join_by_link",
    {
      title: "Занять место ИИ по ссылке",
      description:
        "Вход по обычной ссылке лобби или одноразовому приглашению на место. Уровень по умолчанию medium. Сохраните ключ для ходов и переподключения.",
      inputSchema: join,
    },
    joinSeat,
  );

  if (user) {
    server.registerTool(
      "agent_attach",
      {
        title: "Подключить текущий чат к игровому месту",
        description:
          "Передайте inviteUrl, полученный от lobby_create, как url. Для повтора используйте тот же attempt.",
        inputSchema: join,
      },
      joinSeat,
    );
    server.registerTool("games_list", { title: "Игры и пресеты", inputSchema: {} }, async () =>
      json({ games: listGames(s.catalog) }),
    );
    server.registerTool(
      "game_capabilities",
      {
        title: "Возможности игрока",
        inputSchema: { gameId: id },
      },
      ({ gameId }) =>
        run(async () => {
          const game = s.catalog.get(gameId);
          if (!game) throw notFound("Игра не найдена");
          return json({
            ...summarizeGame(game),
            role: "player",
            difficulties: botOptions.shape.difficulty.unwrap().options,
          });
        }),
    );
    server.registerTool(
      "config_list",
      { title: "Сохранённые игры", inputSchema: { gameId: id.optional() } },
      ({ gameId }) => run(async () => json({ configs: await s.configs.list(user.id, gameId) })),
    );
    server.registerTool(
      "lobby_create",
      {
        title: "Создать лобби с местом для ИИ",
        description:
          "Укажите свой configId или preset. Сервер выбирает закрытое содержимое и резервирует одно игровое место. Обычная ссылка для друзей — lobby.url, адресная — inviteUrl.",
        inputSchema: {
          name: z.string().max(60).optional(),
          configId: id.optional(),
          preset: presetSource.optional(),
          player: botOptions,
        },
      },
      ({ name, configId, preset, player }) =>
        run(async () => {
          if (!!preset === !!configId) throw badRequest("config_source", "Передайте свой configId или preset");
          try {
            const source = preset ? { config: blindPreset(s, preset) } : { configId };
            const { lobby, inviteUrl } = await s.lobbies.createWithBot(user, { name, ...source }, player);
            return json({ lobby: lobbyResult(lobby), inviteUrl });
          } catch (error) {
            // Original config diagnostics and issue paths may contain answers or unrevealed media.
            if (error instanceof HttpError && error.status === 422)
              throw badRequest("invalid_config", "Конфиг не готов к игре. Автор может проверить его отдельно.");
            throw error;
          }
        }),
    );
  }

  server.registerTool(
    "agent_wait",
    {
      title: "Ждать события своего места",
      description:
        "Передавайте after=0 при подключении и cursor последнего события далее. При event:null продолжайте ожидание.",
      inputSchema: {
        ...botConnection,
        after: z.int().nonnegative().default(0),
        timeoutMs: z.int().min(0).max(25_000).default(20_000),
      },
    },
    ({ lobbyId, key, after, timeoutMs }, { signal }) =>
      run(async () => json(await s.lobbies.botWait(lobbyId, key, after, timeoutMs, signal, controllerId))),
  );
  server.registerTool(
    "agent_act",
    {
      title: "Сделать ход",
      description:
        "Передайте номер актуального события и своё решение по описанию действия. Сервер сам определяет ваше место.",
      inputSchema: { ...botConnection, cursor: z.int().positive(), action: z.record(z.string(), z.unknown()) },
    },
    ({ lobbyId, key, cursor, action }) =>
      run(async () => {
        await s.lobbies.botAct(lobbyId, key, cursor, action, controllerId);
        return json({ ok: true });
      }),
  );
  server.registerTool(
    "agent_detach",
    {
      title: "Отключить игровое место",
      inputSchema: botConnection,
    },
    ({ lobbyId, key }) =>
      run(async () => {
        await s.lobbies.botDetach(lobbyId, key, controllerId);
        return json({ ok: true });
      }),
  );
  registerPlayerMedia(server, s, botConnection, controllerId);
  return server;
}

# MCP-сервер

Один MCP-сервер на все игры: агент собирает конфиг из возможностей SDK и создаёт лобби
от имени владельца личного токена. Транспорт — Streamable HTTP без сессий на `POST /mcp`
того же процесса, что и сайт. Агент не ходит за людей.

## Где код

- [`apps/server/src/mcp/routes.ts`](../../apps/server/src/mcp/routes.ts) — `POST /mcp`: токен `Authorization: Bearer asb_…` → новый `McpServer` и `StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })` на каждый запрос. `GET`/`DELETE` — 405. Без токена — 401 с `WWW-Authenticate`.
- [`server.ts`](../../apps/server/src/mcp/server.ts) — `createMcpServer(user, services)`: 23 инструмента, ошибки `HttpError` превращаются в `isError` с `{ error, issues }`.
- [`instructions.ts`](../../apps/server/src/mcp/instructions.ts) — инструкция `initialize` (меньше 3 КБ) и `TOOL_NAMES`.
- [`.mcp.json`](../../.mcp.json) — подключение для Claude Code: `http://localhost:8787/mcp` с `${ASOBIBA_MCP_TOKEN}`.

## Как устроено

- Инструменты:
  - `games_list`, `game_capabilities(gameId)` — info, семь tuning-направлений, схема, руководства, слоты, темы, каталог, пресеты целиком;
  - `jinchi_generate(request, title?, info?)` — детерминированная генерация, сохранённый configId, summary и diagnostics;
  - `config_validate`, `config_simulate(config, rounds?)` (до 200 раундов, синхронно), `config_preview(config, moment?, seed?, target?)` — PNG 768 px шириной как MCP-картинка плюс текст с итогом раунда;
  - `config_resolve(config, questionId)`, `config_probe(config, questionId, answers)` — Quizor: источники наследования и приёмка примеров с объяснениями;
  - `config_save(config, configId?)`, `config_list(gameId?)`, `config_get`;
  - `asset_list`, `asset_create_svg(name, svg)`, `asset_import_url(url, name?)`, `asset_upload_begin(name)` → `{ uploadUrl, method: "PUT", expiresAt, example }`;
  - `lobby_create(name, configId | config)` → `{ lobby: { id, url, … } }`, `lobby_list`, `lobby_get` (состав и счёт без ходов), `lobby_close` (только хозяин).
- Симуляция и превью сначала проверяют конфиг и отвечают ошибкой с `issues`, если он невалиден.
- Каждый вызов заново ищет пользователя по токену (`lastUsedAt` обновляется не чаще раза в минуту). Отозванный токен — 401.
- Гость не получает MCP-токены: HTTP-кабинет и выпуск требуют аккаунта; `AuthService.createToken` также запрещает гостя, `userByToken` исключает роль guest. Лобби, созданное агентом аккаунта, использует ту же ссылку для гостевого входа друзей.
- Ссылки (`url` лобби, `uploadUrl`) строятся от `PUBLIC_URL`.

## Jinchi

`game_capabilities("russkoe-pole")` отдаёт схему v1, руководство и 6 пресетов. Новых инструментов нет. Банк слов есть только у сервера, поэтому `config_preview` для тем банка рисует настоящее слово, а страница лобби в браузере — нет.

`game_capabilities("jinchi")` возвращает схему v1, руководство строк карты и 10 пресетов.
Карта — `rules.map: {width,height,rows}`: строки из `.`, `#`, `1`…`8`. Большие карты собирает `jinchi_generate`: compact request players/shape/width/height или radius/dice/seed/wallDensity/structures/flags/effects. Validate/simulate/preview принимают ровно одно из `config` или своего `configId`; by-id validate не возвращает документ карты. Чужой id проверяется при каждом вызове. Generation сохраняет конфиг, но не создаёт лобби.
`node --import tsx scripts/verify-jinchi.mjs` проверяет этот путь и сохраняет PNG.
Симуляция Jinchi ограничена общим бюджетом по площади: ответ содержит requestedRounds,
rounds (начатые), skippedRounds и отдельную диагностику budget-exceeded.
Превью возвращает phase и partial; end может быть промежуточным положением большой
карты. Не считай такое превью победой или бесконечной партией.

Инструкция initialize (<3072 UTF-8 байт) разделяет объяснение/идеи/явное создание.
Неизвестная игра — короткое объяснение из info; «что ещё?» — 5–7 уместных tuning
с последствиями с сохранением уже заданного; точное «создай» не требует анкеты.
Успешная validation включает безопасную summary. Авторское info не заменяет правила.

## Quizor

`config_resolve` возвращает итоговые настройки вопроса/полей и provenance; `config_probe`
принимает массив объектов `{idПоля: значение}` и возвращает grades. Для ближайшего
численного ответа массив считается одной группой. Оба инструмента сначала проверяют
конфиг и владение медиа; к чужим сохранённым конфигам они доступа не дают.
`config_preview` принимает `target: {kind: "question"|"round"|"intro", id}`; intro использует
id раунда. Адресное превью не считается partial-партией. Инструменты не выполняют
игровые ходы и не управляют живой партией. Медиа загружается через существующий пул:
картинки до 2 МиБ/2048 px, звук и видео до 1 ГиБ, поддержка кодеков зависит от браузера.

## Видео douga

`video_snapshot_import {token}` → `video_snapshot_list` → `video_snapshot_get {snapshotId, stills?}`
(сегменты, сцены, моменты, карточки; со `stills: true` — до 6 кадров картинками) →
`video_snapshot_delete`. Токен берётся из `video_interactive_publish` в MCP douga.
Все инструменты проверяют, что снимок принадлежит владельцу токена. Подробности — [video.md](video.md).

## Yomifuda

`game_capabilities("yomifuda")` отдаёт схему v1, честную методику, профили
andrey03410/dimma0148/kostyankomaranime (порог2), 7 направлений настройки и учебный пресет.
Схема допускает только `series.rounds=1`: после одной колоды раскрываются все оценки.
`config_validate`, `config_save` и `lobby_create` отклоняют повторную серию через общий SDK.
Новых инструментов нет. Числа показателей всегда целые, значения не выравнивают ради
баланса; предупреждения симуляции о доминировании не дают права менять честную силу.

`config_validate(config)` возвращает secretsHidden:true и read-only проекцию cards:[];
агент сохраняет **подготовленный оригинал** через config_save и дальше использует configId.
By-id validate/simulate/preview/lobby_create исполняются по оригиналу внутри сервера.
Save/list/get/лобби наружу секретов не возвращают. Явный авторский
`config_get({configId,revealSecrets:true})` остаётся owner-only; обычный get безопасен.
PNG-превью — независимая учебная сцена, оно не раскрывает состав или значения настоящей колоды.
Встроенный визуал douga не требует импорта снимка или работающего сервиса douga во время партии.

## Грабли

- Уже запущенная сессия Claude Code не подхватывает `.mcp.json`: для проверок используй `scripts/verify-mcp.mjs`.
- Сервер без сессий: уведомления сервера клиенту (SSE) не используются, всё — ответами на запросы.
- В `.mcp.json` токен подставляется из окружения: без `ASOBIBA_MCP_TOKEN` клиент получит 401.

## Как проверить

- `npx vitest run apps/server/src/mcp` — 401 без токена, длина инструкции, ровно 23 имени, сценарий агента от возможностей до лобби с PNG-превью, изоляция пользователей.
- Вживую: `npx tsx --env-file-if-exists=.env scripts/seed-verify.ts`, затем `node scripts/verify-mcp.mjs --out storage/verification/<run>` против `npm run dev`. Скрипт рисует SVG-фигуру, собирает конфиг на основе `party`, проверяет, прогоняет, сохраняет `preview-start.png`/`preview-end.png` и создаёт лобби.

## История

- [задача 01](../features/01-rebuild/README.md) — первая версия MCP
- [задача 05](../features/05-guest-join/README.md) — гостям доступна игра по ссылке, создание через MCP остаётся за аккаунтами

- [задача 06](../features/06-quizor/README.md) — Quizor probe/resolve и адресное PNG-превью
- [задача 07](../features/07-video-games/README.md) — инструменты `video_snapshot_*`

- [задача 08](../features/08-jinchi-playtest/README.md) — agent-first info, jinchi_generate и compact configId проверки

# Сервер

Fastify-процесс `apps/server`: вход по приглашениям, сессии, личные токены MCP, конфиги,
лобби с живыми комнатами по WebSocket, превью и MCP. В продакшене тот же процесс отдаёт
собранный сайт. Контракт HTTP и WebSocket — типы в [`packages/api`](../../packages/api/src/index.ts).

## Где код

- [`apps/server/src/main.ts`](../../apps/server/src/main.ts) — запуск: `buildApp`, `restoreAll`, `listen`.
- [`app.ts`](../../apps/server/src/app.ts) — `buildApp({ env, db, catalog?, now?, logger? })`: сервисы, плагины (cookie, websocket, static), парсеры сырых тел картинок, хук `onRequest` с `req.user` из куки, обработчик ошибок.
- [`routes.ts`](../../apps/server/src/routes.ts) — все HTTP-маршруты и `/ws`.
- [`auth/service.ts`](../../apps/server/src/auth/service.ts) — пользователи, сессии, приглашения, токены.
- [`configs/service.ts`](../../apps/server/src/configs/service.ts) — проверка конфига SDK + владение картинками, библиотека конфигов.
- [`lobbies/service.ts`](../../apps/server/src/lobbies/service.ts) — `LobbyService`: лобби, комнаты, партии, рассылка, восстановление.
- [`preview/render.ts`](../../apps/server/src/preview/render.ts) — PNG-превью из компонента доски игры.
- [`http-errors.ts`](../../apps/server/src/http-errors.ts) — `HttpError(status, code, message, issues?)`.
- [`test/helpers.ts`](../../apps/server/src/test/helpers.ts) — `createTestApp`, `resetDb`, `signUp`.

## Данные

Модели в [schema](../../apps/server/prisma/schema.prisma):
- `User` (логин в нижнем регистре, роль `admin`/`user`), `Session` (id = sha256 токена куки), `Invite` (хранится sha256 кода), `ApiToken` (sha256, `prefix` для показа, `revokedAt`);
- `Asset`, `UploadTicket` — [assets.md](assets.md); `GameConfig` — документ конфига в `Json`;
- `Lobby` (замороженная копия нормализованного конфига, `seats`, статус `waiting`/`playing`/`finished`/`closed`), `LobbyMember` (`player`/`spectator`), `Match` (`seed`, `startedAt`, `seatUsers`, `log`, статус `playing`/`finished`/`aborted`, `result`).

## Как устроено

- **Вход.** Регистрация только по одноразовому приглашению (`POST /api/auth/register`), логин 3–24 символа, пароль от 8. Сессия — `asobiba_session` (httpOnly, SameSite=Lax, 30 дней, `secure` при `COOKIE_SECURE=1`). Приглашения создаёт админ (`POST /api/invites`) или `npm run invite`.
- **Ошибки.** Все не-2xx отвечают `{ error: { code, message }, issues? }`. Невалидный конфиг — 422 с `issues`.
- **Лобби.** Создание из `configId` или `config` (конфиг проверяется заново, хозяин входит игроком). Места — `game.seats(rules).max`, старт — от `min` игроков, только хозяин. Во время партии сесть игроком нельзя, только наблюдателем; встать из-за стола и уйти тоже нельзя. Хозяин не уходит, а закрывает лобби. «Сыграть ещё» — тот же `start` после `finished`: тот же состав пересаживается со сдвигом на одно место.
- **Комнаты.** `LobbyService` держит в памяти `Match`, подписчиков и таймер пробуждения на `nextWakeAt()`. Все операции одного лобби идут под его замком (цепочка промисов). Принятый ход пишет журнал партии в БД, конец партии — `result` и статус лобби.
- **WebSocket `/ws`.** Авторизация сессионной кукой, без сессии — закрытие с кодом 4401. Клиент: `subscribe`, `unsubscribe`, `action`, `ping`. Сервер: `lobby` (DTO лобби), `match` (вид для места подписчика или наблюдателя, `serverTime` для отсчёта таймера), `error`, `pong`. Каждый подписчик получает свой вид: `legal` есть только у того, чей ход.
- **Перезапуск.** `restoreAll` восстанавливает пошаговые партии по журналу, партии реального времени и непрочитанные журналы прерывает (лобби возвращается в `waiting`).
- **Продакшен.** При `NODE_ENV=production` и собранном `apps/web/dist` — статика и SPA-фолбэк на `index.html` для GET вне `/api`, `/files`, `/ws`, `/mcp`.

## Грабли

- Игрок, закрывший вкладку посреди партии, остаётся на месте: без таймера хода партия встанет. Выход — таймер в конфиге или закрытие лобби хозяином.
- Fastify-хук `onRequest` срабатывает и на апгрейде WebSocket, поэтому `req.user` в обработчике `/ws` уже есть.
- Тела картинок принимают парсеры `image/*`, `application/octet-stream` и `*` (curl `--upload-file` шлёт без типа). Обычные JSON-маршруты от этого не меняются.

## Как проверить

- `npx vitest run apps/server` — вход, токены, лобби, партия по настоящему WebSocket до победы, таймер, восстановление после перезапуска, MCP.
- Вживую: `node scripts/verify-game.mjs` против `npm run dev`.

## История

- [задача 01](../features/01-rebuild/README.md) — первая версия сервера

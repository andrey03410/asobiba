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
- [`db.ts`](../../apps/server/src/db.ts) и [`sqlite.ts`](../../apps/server/src/sqlite.ts) — клиент Prisma 7 через адаптер `better-sqlite3`.
- [`http-errors.ts`](../../apps/server/src/http-errors.ts) — `HttpError(status, code, message, issues?)`.
- [`test/helpers.ts`](../../apps/server/src/test/helpers.ts) — `createTestApp`, `resetDb`, `signUp`.

## Данные

Модели в [schema](../../apps/server/prisma/schema.prisma):
- `User` (логин в нижнем регистре, роль `admin`/`user`), `Session` (id = sha256 токена куки), `Invite` (хранится sha256 кода), `ApiToken` (sha256, `prefix` для показа, `revokedAt`);
- `Asset`, `UploadTicket` — [assets.md](assets.md); `GameConfig` — документ конфига в `Json`;
- `Lobby` (замороженная копия нормализованного конфига, `seats`, статус `waiting`/`playing`/`finished`/`closed`), `LobbyMember` (`player`/`spectator`), `Match` (`seed`, `startedAt`, `seatUsers`, `log`, статус `playing`/`finished`/`aborted`, `result`).

## Как устроено

- **Вход.** Регистрация только по одноразовому приглашению (`POST /api/auth/register`), логин 3–24 символа, пароль от 8. Неудачные входы ограничены в памяти: 10 на логин и 30 на адрес за 15 минут, дальше 429 `too_many_attempts` ([`auth/rate-limit.ts`](../../apps/server/src/auth/rate-limit.ts)).
- **Логи.** Fastify пишет запросы с `redactUrl`: билеты `upl_…` и коды приглашений в URL заменяются заглушками.
- Сессия — `asobiba_session` (httpOnly, SameSite=Lax, 30 дней, `secure` при `COOKIE_SECURE=1`). Приглашения создаёт админ (`POST /api/invites`) или `npm run invite`.
- **Ошибки.** Все не-2xx отвечают `{ error: { code, message }, issues? }`. Невалидный конфиг — 422 с `issues`.
- **Лобби.** Создание из `configId` или `config` (конфиг проверяется заново, хозяин входит игроком). Места — `game.seats(rules).max`, старт — от `min` игроков, только хозяин. Во время партии сесть игроком нельзя, только наблюдателем; встать из-за стола и уйти тоже нельзя. Хозяин не уходит, а закрывает лобби. «Сыграть ещё» — тот же `start` после `finished`: тот же состав пересаживается со сдвигом на одно место.
- **Комнаты.** `LobbyService` держит в памяти `Match`, подписчиков и таймер пробуждения на `nextWakeAt()`. Все операции одного лобби идут под его замком (цепочка промисов). Принятый ход пишет журнал партии в БД, конец партии — `result` и статус лобби.
- Комната создаётся лениво (`room()`) только для существующего лобби. Чтения (`get`, `matchSummary`) идут без замка, поэтому после ожиданий карта комнат проверяется ещё раз: комнату с живой партией нельзя подменить пустой.
- Ход сначала прогоняет просроченные таймеры (`advance`), потом `dispatch`. Если ход отклонён, а таймаут или конец партии уже случились, вид всё равно рассылается.
- Подписка, дождавшаяся замка после закрытия сокета, отбрасывается (`Subscriber.closed`).
- **WebSocket `/ws`.** Авторизация сессионной кукой, без сессии — закрытие с кодом 4401. Клиент: `subscribe`, `unsubscribe`, `action`, `ping`. Сервер: `lobby` (DTO лобби), `match` (вид для места подписчика или наблюдателя, `serverTime` для отсчёта таймера), `error`, `pong`. Каждый подписчик получает свой вид: `legal` есть только у того, чей ход.
- **Перезапуск.** `restoreAll` восстанавливает пошаговые партии по журналу, партии реального времени и непрочитанные журналы прерывает (лобби возвращается в `waiting`).
- **Продакшен.** При `NODE_ENV=production` и собранном `apps/web/dist` — статика и SPA-фолбэк на `index.html` для GET вне `/api`, `/files`, `/ws`, `/mcp`.

## Jinchi

Каталог регистрирует `jinchi` и `jinchiClient` как второй workspace-пакет.
Существующие маршруты, права, журнал и восстановление обслуживают новую игру без
отдельного протокола. Число мест определяется количеством стартовых зон карты.
PNG-превью использует staticRender доски; SVG-номера баз векторные, системные шрифты
не нужны. Проверка целого сценария: `node --import tsx scripts/verify-jinchi.mjs`.

## Грабли

- **Клиент базы.** Prisma 7 ходит в SQLite через адаптер `better-sqlite3`, обёрнутый в `sqliteAdapter` ([`sqlite.ts`](../../apps/server/src/sqlite.ts)):
  - даты хранятся целыми миллисекундами (`timestampFormat: "unixepoch-ms"`), как писала Prisma 6. Умолчание адаптера — ISO-строки, и смесь форматов ломает сравнения: SQLite считает любое число меньше любой строки, сессии выглядят истёкшими;
  - на процесс одно соединение. Запросы вне транзакции ждут, пока открытая транзакция закончится, иначе они выполнились бы внутри неё и откатились бы вместе с ней;
  - поэтому внутри `$transaction(async (tx) => …)` — только `tx`. Запрос через общий клиент там ждёт саму транзакцию до её таймаута (5 с);
  - если `COMMIT` упёрся в чужую блокировку (другой процесс читает базу дольше 5 с), обёртка сама отправляет `ROLLBACK`. Клиент Prisma в этом случае зовёт только `rollback()` адаптера, а тот ничего не шлёт, и соединение осталось бы внутри транзакции;
  - `better-sqlite3` синхронный: ожидание чужой блокировки (до 5 с) держит event loop сервера, а не поток движка, как было в Prisma 6.
- Импорты моделей и `Prisma` — из `apps/server/src/generated/prisma/client`, а не из `@prisma/client`.

- Комнаты не выселяются из памяти: на нагрузке «владелец и друзья» это сотни лобби, не больше.
- Игрок, закрывший вкладку посреди партии, остаётся на месте: без таймера хода партия встанет. Выход — таймер в конфиге или закрытие лобби хозяином.
- Fastify-хук `onRequest` срабатывает и на апгрейде WebSocket, поэтому `req.user` в обработчике `/ws` уже есть.
- Тела картинок принимают парсеры `image/*`, `application/octet-stream` и `*` (curl `--upload-file` шлёт без типа). Обычные JSON-маршруты от этого не меняются.

## Как проверить

- `npx vitest run apps/server` — вход, токены, лобби, партия по настоящему WebSocket до победы, таймер, восстановление после перезапуска, MCP.
- Вживую: `node scripts/verify-game.mjs` против `npm run dev`.

## История

- [задача 01](../features/01-rebuild/README.md) — первая версия сервера
- [задача 03](../features/03-prisma-7/README.md) — Prisma 7, адаптер SQLite с форматом дат и очередью вокруг транзакций

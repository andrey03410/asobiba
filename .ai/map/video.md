# Видео douga

Видео-игры: картинку в кадре рисует douga, а правила, ввод и партия остаются в asobiba.
Ролик собирается в соседнем проекте douga (`../douga`) и приходит в asobiba интерактивным
снимком `douga-interactive-snapshot@1`. Сервер компилирует сцены пакетами douga с данными
партии, клиент играет их плеером douga. Первый потребитель — Quizor ([games.md](games.md)).

## Где код

- Пакеты douga подключены как библиотека: `file:` зависимости `@douga/video|render|player|node`
  на `../douga/packages/*` в [`apps/server/package.json`](../../apps/server/package.json)
  и [`packages/video/package.json`](../../packages/video/package.json). Новая возможность
  движка douga приходит сама после `npm install`.
- [`packages/sdk/src/video.ts`](../../packages/sdk/src/video.ts) — контракт игры:
  `VIDEO_CONTRACT`, `VideoPlay`, `VideoDirective`, `VideoSnapshotSummary`, `GameVideoSupport`
  (`guide`, `recipes`, `configSnapshots`, `directives`, `checkVideo`), `videoKey`
  (sha256 канонического JSON: снимок, `play`, `data`, `start`, `hold`; 32 hex), `videoDirective`,
  `sliceWindow` — окно куска по моментам, одно правило для сервера, проверки конфига и браузера.
- [`apps/server/src/video/service.ts`](../../apps/server/src/video/service.ts) — `VideoService`:
  импорт, список, удаление, файлы, кэш манифестов.
- [`video/runtime.ts`](../../apps/server/src/video/runtime.ts) — `VideoRuntime.slice`:
  `applyMatchData` → `compileVideo` → `slicePlan`, адреса файлов переписаны на `/files/video/`.
- [`video/timing.ts`](../../apps/server/src/video/timing.ts) — длительность блока `scene` по кадрам снимка.
- [`packages/video`](../../packages/video/src/) (`@asobiba/video`, `@asobiba/video/client`) —
  `VideoStage`, `loadSlice` (кэш 32 кусков), `holdFrameOf`.
- Маршруты — [`routes.ts`](../../apps/server/src/routes.ts), раздел `video (task 07)`;
  доступ — `LobbyService.videoAccess`, `canReadVideoFile` в
  [`lobbies/service.ts`](../../apps/server/src/lobbies/service.ts).

## Данные

- `VideoSnapshot` (`vsn_…`, владелец, `projectId`, `revision`, `manifestHash`, `engine`, `scenes`,
  `bytes`, путь к манифесту) с уникальностью `(ownerId, manifestHash)`: повторный импорт того же
  снимка возвращает прежний id (`reused: true`).
- `VideoFile` (`hash`, `ext`, `bytes`, `kind`) — файлы по содержимому, общие для снимков;
  `VideoSnapshotFile` — связь.
- На диске: `storage/video/snapshots/<id>.json` и `storage/video/files/<sha256><ext>`.

## Как устроено

- **Импорт.** `POST /api/video/snapshots {token}` или MCP `video_snapshot_import`. Сервер сам идёт
  в `DOUGA_URL/api/interactive/<token>/manifest`, адрес из запроса не берётся. Проверки:
  формат токена, манифест до 16 МиБ, zod-схема, `contract: 1`, `engine.remotion` равен
  локальному Remotion (иначе 422 `douga_version`), хэш манифеста. Файлы качаются в `.part`
  со сверкой размера и sha256. Квота: файл до 1 ГиБ, пул владельца (картинки плюс видео) до 10 ГиБ.
  Источники манифеста — только файлы снимка. Импорты и удаления всех владельцев идут по очереди
  через один замок: файлы общие по хэшу. Неудачный импорт убирает скачанные им файлы. Пока douga готовит кадры — 409 `snapshot_not_ready`,
  douga недоступна — 502 `douga_unavailable`.
- **Удаление.** 409 `video_in_use`, если снимок указан в конфиге владельца или в лобби
  `waiting`/`playing`/`finished` (завершённое можно перезапустить, у него разбор): сначала закрыть лобби. Файлы без других ссылок удаляются с диска.
- **Конфиг.** `validateConfig(catalog, input, {videoSnapshots})` получает сводки снимков
  (сегменты, сцены, моменты, карточки, `uses`) и зовёт `checkVideo` игры. Сервис конфигов
  проверяет владение снимком и записывает в блоки `scene` `startSeconds` и `durationSeconds`:
  игра считает время как у любого блока и ничего не знает о кадрах.
- **Партия.** В WebSocket уходит только `VideoDirective` (`snapshot`, `play`, `start`, `hold`,
  `data`, `startedAt`, `key`). Плана и файлов в виде нет.
- **Окно куска** (`sliceWindow`). Кусок начинается сценой момента `start` и кончается сценой
  момента `hold`. Сцены после ожидания (раскрытие) зрителю вопроса не уходят. Кадры той же сцены
  после момента уходят вместе с ней: ответ держат в отдельной сцене, иначе Quizor предупреждает
  `video_reveal_scene`. `startSeconds` в конфиге считается от начала обрезанного куска.
- **Кусок.** `GET /api/lobbies/:id/video/:key` отдаёт скомпилированный кусок плана, если ключ есть
  в текущем виде зрителя или среди его 16 последних показанных ключей. Правило места то же,
  что у WebSocket: ведущий и наблюдатели — свои виды. Имена игроков `seat-N` подставляются
  из `seatNames`. Компиляция кэшируется (LRU 64).
- **Файлы.** `GET|HEAD /files/video/<sha256><ext>` с Range отдаёт только файлы кусков, которые
  этот пользователь уже получил. Будущая сцена и её файлы — 403/404 до показа. Права живут в памяти,
  поэтому клиент дописывает к адресу `?lobby=…&key=…`: после перезапуска сервер заново проверяет
  этот кусок по `videoAccess` и пускает к его файлам. Компиляция одного куска общая для всех зрителей.
- **Клиент.** `VideoStage` лениво грузит `InteractivePlayer` douga, держит кадр по серверным часам
  (`startedAt` + `clockOffset`), останавливается на `hold`, клик по карточке зовёт `onPick`.
  Звук включается после жеста пользователя. Douga для игры не нужна: всё лежит у asobiba.
- **MCP.** `video_snapshot_import|list|get|delete`; `get` со `stills: true` отдаёт до 6 кадров сцен
  картинками. Раздел `video` в `game_capabilities` описывает контракт, гайд и рецепты douga.
- **Сайт.** Кабинет → «Картинки» → раздел «Ролики douga» ([`VideoSnapshots.tsx`](../../apps/web/src/pages/account/VideoSnapshots.tsx));
  значок «видео» у конфига и лобби.

## Грабли

- Версия Remotion в asobiba должна совпадать с douga, иначе импорт отказывает.
  После обновления douga — `npm install` в asobiba, проверка тестом `video.int.test.ts`.
- Vite: `dedupe` React и Remotion и `fs.allow` на `../douga` в
  [`apps/web/vite.config.ts`](../../apps/web/vite.config.ts), иначе в сборке два React.
- Douga без запущенного воркера (`npm run studio:worker`) не дорисует кадры сцен, и импорт
  будет получать `snapshot_not_ready`.
- Хостинг: douga и asobiba на одном сервере, `DOUGA_URL` — внутренний адрес douga
  ([README](../../README.md), [`scripts/deploy.sh`](../../scripts/deploy.sh)).

## Как проверить

- `npx vitest run apps/server/src/video games/quizor/src/video.test.ts packages/sdk/src/video.test.ts`.
- Вживую через оба MCP: `npx tsx --env-file-if-exists=.env scripts/verify-video.ts` (нужны douga
  `npm run dev` и `npm run studio:worker`, e2e-аккаунт douga, asobiba `npm run dev`, `scripts/seed-verify.ts`).
- Второй игрок по HTTP и WebSocket: `npx tsx --env-file-if-exists=.env scripts/verify-video-player.ts <lobbyId> [pick]`.

## История

- [задача 07](../features/07-video-games/README.md) — видео-игры на движке douga; парная задача douga 34

# Технические решения

Решения приняты агентом 2026-11-13 в автономном режиме стадии `tech`
(разрешение — в [brief.md](brief.md#разрешение-автономности)).

Сторону douga описывает парная задача `douga/.ai/features/34-interactive-video/tech.md`:
пакеты `@douga/*`, интерактивный слой документа, `MatchData`, план с `interaction`, `slicePlan`,
`hitTest`, `InteractivePlayer`, формат снимка `douga-interactive-snapshot@1` и маршруты по токену.
Здесь эти вещи только используются.

## Исходная система

Проверено в коде ветки `main` (`0a6c2bf`) и в карточках [sdk](../../map/sdk.md),
[games](../../map/games.md), [server](../../map/server.md), [assets](../../map/assets.md),
[mcp](../../map/mcp.md), [web](../../map/web.md).

**Лобби и партия.**
- `LobbyService.create` ([`lobbies/service.ts:280`](../../../apps/server/src/lobbies/service.ts))
  вызывает `configs.requireValid` и замораживает нормализованный документ в `Lobby.config`.
- `start()` (`:381`) запускает `Match.start`. `restoreAll()` (`:583`) поднимает пошаговые партии
  по журналу.
- Вид места строит `Match.view(seat, role)`: `presenterView` только для роли presenter
  ([`match.ts:201`](../../../packages/sdk/src/match.ts)).
- Сообщение WebSocket: `{type:"match", lobbyId, match, seat, controlRole?, serverTime}`
  ([`api/src/index.ts:233`](../../../packages/api/src/index.ts)). Исходящий размер не ограничен,
  входящий — 64 КиБ (`app.ts:71`).
- Клиент считает `clockOffset = serverTime − Date.now()` и уточняет его по `pong`
  ([`useLobbySocket.ts:135`](../../../apps/web/src/useLobbySocket.ts)).

**Доступ к файлам.**
- `canReadAsset` (`service.ts:193`) открывает файл в трёх случаях:
  - владельцу;
  - по `presentRules` посещённого лобби;
  - для Quizor — по `quizorMediaRefs(view(viewerSeat).game)`.
- `quizorMediaRefs` ([`games/media-refs.ts`](../../../apps/server/src/games/media-refs.ts)) читает
  только доверенные контейнеры: `blocks`, `preload`, `fields`, `reveal`, `history`, фон раунда.
- `/files/assets/:id` с одним Range — `routes.ts:223`, `parseFileRange` (`assets/media.ts:261`).

**Конфиг.**
- `ConfigService.validate` ([`configs/service.ts:46`](../../../apps/server/src/configs/service.ts)):
  2 МиБ JSON, затем схема, затем `ownershipIssues` (`asset_not_found`, `media_quota`).
- Для Quizor дальше идут `asset_mime` и `normalizeMediaDurations`, затем снова 2 МиБ.
- Квота 1 ГиБ на конфиг (`MAX_CONFIG_MEDIA_BYTES`, `media.ts:7`) суммирует уникальные ассеты.

**Импорт по ссылке.** `fetchPublicUrlStream` закрывает приватные адреса, кроме случая
`ASSET_URL_ALLOW_PRIVATE=1` (`env.ts:27`, `fetch.ts:53`, `:106`).

**MCP.** 18 инструментов ([`mcp/server.ts`](../../../apps/server/src/mcp/server.ts)).
- `game_capabilities` → `describeGame` ([`capabilities.ts:57`](../../../packages/sdk/src/capabilities.ts)).
- `config_preview` → `renderPreview` ([`preview/render.ts:24`](../../../apps/server/src/preview/render.ts)):
  `previewTarget`/`previewMatch` дают позицию, `Board staticRender` рисует её в SVG,
  а resvg растеризует. Миниатюры только для картинок.

**SDK.** `GameDefinition` ([`game.ts:84`](../../../packages/sdk/src/game.ts)) не знает о видео.
SDK без DOM, сети и базы.

**Quizor.**
- Вид держит `blocks`, `blockIndex`, `blockStartedAt`, `reveal*`, `preload`, `serverNow`, `paused`, `resumeAt`
  ([`game.ts:282`](../../../games/quizor/src/game.ts)). На паузе блоки и предзагрузка очищаются (`:3108`).
- Доска тикает часами раз в 100 мс: `now = clock + clockOffset`, `frozen = paused || now < resumeAt`
  ([`Board.tsx:483`](../../../games/quizor/src/client/Board.tsx)). Начало блока считается
  как `blockStartedAt − сумма длительностей предыдущих`, [`Blocks.tsx`](../../../games/quizor/src/client/Blocks.tsx).
- Вариант ответа: `{id, text, asset?, media?}` (`rules.ts:287`).
- Судьи: `algorithm|presenter|assisted|vote|best|self|ai` (`:54`). У поля `order` обязателен `correct` (`:352`).

**Сайт.**
- [`vite.config.ts`](../../../apps/web/vite.config.ts): только плагин React и прокси.
  Нет `dedupe`, нет `fs.allow`, нет ленивой загрузки.
- Доска на сцене — [`MatchStage.tsx:201`](../../../apps/web/src/components/MatchStage.tsx)
  с `clockOffset`, `stage` и `fullscreen`.
- Пакеты отдают исходники TS (`exports` → `./src/*.ts`). Один корневой `tsconfig`
  со `verbatimModuleSyntax`.

**Производство.** Один процесс на 8787 отдаёт сайт, API, WebSocket и MCP; ссылки строятся от `PUBLIC_URL`
([`env.ts:19`](../../../apps/server/src/env.ts)).

**Douga** (по коду, парная задача):
- React 18.3.1, Remotion 4.0.475, zod 3, MCP только stdio;
- план — чистый JSON, рендерер зависит только от react и remotion;
- публикация `/watch` уже отдаёт план и файлы по токену и хэшу.

## Решения

### T01. Как asobiba подключает douga

- Варианты:
  - а) зависимости `file:../../../douga/packages/<pkg>` в нужных пакетах asobiba (симлинки на соседнюю папку);
  - б) пакеты из реестра;
  - в) git submodule;
  - г) HTTP API douga во время партии.
- Рекомендация: а (T01 douga). Новинки douga приходят пересборкой, партия от douga не зависит (P15).
- **Решение:** а.
  - **Размещение.** Douga лежит рядом: `../douga` относительно корня asobiba. В другом месте
    ставится симлинк. `dev-env` описывает, что в douga нужен `npm install`.
  - **Зависимости.** `apps/server` зависит от `@douga/video` и `@douga/node`.
    Новый пакет `packages/video` (T04) зависит от `@douga/video` (только типы), `@douga/render`
    и `@douga/player`.
  - **Резолв.** Node резолвит зависимости пакетов douga (`zod` 3, `fontkit`) из `douga/node_modules`
    по реальному пути. Asobiba их не ставит.
  - **Remotion и React.** `remotion` и `@remotion/player` ставятся в asobiba точной версией douga.
    В Vite `resolve.dedupe: ["react", "react-dom", "remotion", "@remotion/player"]` гарантирует
    один экземпляр React 19 и Remotion, а `server.fs.allow` добавляет папку пакетов douga для dev-сервера.
  - **Проверка версий.** Тест сверяет `VERSION` из `remotion` asobiba с `REMOTION_VERSION`
    из `@douga/render`. При старте сервер пишет понятную ошибку, если `@douga/*` не найдены.
  - **Типы.** `npx tsc --noEmit` asobiba проверяет код douga, до которого доходят импорты.
    Пакеты douga обязаны проходить строгий `tsconfig` asobiba (T03 douga).

### T02. Хранение снимков

- Варианты:
  - а) снимок — новая сущность и общий контентный склад файлов по SHA-256;
  - б) раскладывать файлы снимка в обычный пул `Asset`.
- Рекомендация: а. Снимок неизменен и может делить файлы с другим снимком, а `Asset`
  рассчитан на файлы пользователя с проверкой контейнера и лимитами картинок.
- **Решение:** а. Новые модели Prisma (`apps/server/prisma`):

```prisma
model VideoSnapshot {
  id            String   @id            // "vsn_" + 12 символов
  ownerId       String
  title         String
  projectId     String                  // id проекта douga, справочно
  revision      Int
  manifestHash  String                  // hash из манифеста douga
  contract      Int
  engine        Json                    // {remotion, compilerVersion, packages}
  bytes         BigInt                  // сумма уникальных файлов снимка
  path          String                  // storage/video/snapshots/<id>.json
  createdAt     DateTime @default(now())
  @@unique([ownerId, manifestHash])
}
model VideoFile {
  hash   String @id                     // sha256
  ext    String
  bytes  BigInt
  kind   String                         // image|video|audio|poster|font|still
}
model VideoSnapshotFile {
  snapshotId String
  hash       String
  @@id([snapshotId, hash])
}
```

  - Файлы лежат в `storage/video/files/<hash><ext>`, манифест — в `storage/video/snapshots/<id>.json`.
  - Удаление снимка удаляет файлы, на которые больше никто не ссылается.
  - Квоты (P10): пул пользователя (10 ГиБ) считает сумму `Asset.bytes` и уникальных файлов его снимков.
    Медиа конфига (1 ГиБ) считает ассеты и уникальные файлы снимка, на который ссылается конфиг.
  - Удаление запрещено (`video_in_use`), пока снимок есть в `GameConfig.document` или в `Lobby.config`
    незакрытого лобби.

### T03. Импорт по токену

- **Решение:** `VideoService.importSnapshot(user, token)` в `apps/server/src/video/`.
  - **Адрес douga.** `DOUGA_URL` из окружения (`http://127.0.0.1:3000` локально и на хостинге).
    Это доверенная база, поэтому импорт идёт не через `fetchPublicUrlStream`. Токен проверяется
    регуляркой base64url и подставляется в путь через `encodeURIComponent`. Без `DOUGA_URL` ошибка — `douga_unavailable`.
  - **Манифест.** `GET {DOUGA_URL}/api/interactive/<token>/manifest`, не больше 16 МиБ.
    Ответ 409 даёт `snapshot_not_ready`, 404 — `snapshot_not_found`.
  - **Проверка.** Формат проверяется схемой из `@douga/video` (zod 3 на сервере), затем:
    - `contract === 1`;
    - `engine.remotion` равен `REMOTION_VERSION` (иначе `douga_version`
      с подсказкой обновить douga или asobiba);
    - пересчитанный `hash` совпадает.
  - **Файлы.** Скачиваются только отсутствующие хэши, потоком на диск в `.part`.
    Каждый файл не больше 1 ГиБ; SHA-256 и размер сверяются с манифестом, потом файл
    переименовывается. Таймауты — как у импорта ассетов: 10 с тишины, 10 минут на файл.
  - **Идемпотентность.** Повторный импорт того же `manifestHash` тем же владельцем возвращает
    существующий снимок.
  - **Секретность.** Токен не сохраняется и не пишется в журнал.
  - **Очередь.** Импорты одного владельца идут по очереди, как сохранение в пул (квоты).

### T04. Пакет-мост `packages/video`

- **Решение:** новый пакет `@asobiba/video`, по образцу игр — исходники TS.
  - `.` — типы контракта для SDK и сервера: реэкспорт `import type` из `@douga/video`
    (`MatchData`, интерактивные типы) плюс свой `VideoDirective` (T05).
  - `./client` — React-компонент `VideoStage` (T08) с ленивым `import("@douga/player")`.
  - Серверная часть живёт в `apps/server/src/video/`: ей нужны Prisma, хранилище и `@douga/node`.

### T05. Видео-контракт в SDK

- Варианты:
  - а) игра кладёт в свой вид указание «что играть», а сервер по нему компилирует;
  - б) сервер сам решает, что играть, по типу игры;
  - в) игра компилирует план сама.
- Рекомендация: а. Логика остаётся в игре и воспроизводится по журналу. SDK не тянет douga
  во время выполнения (только типы). Тайну держит белый список вида игры, как у медиа Quizor.
- **Решение:** а.

```ts
// packages/sdk/src/video.ts
export interface VideoDirective {
  key: string;                       // sha256(snapshot, play, data) — для кэша и доступа
  snapshot: string;                  // vsn_…
  play: { segmentId: string } | { sceneIds: string[] };
  startedAt: number;                 // мс сервера, когда играет кадр 0 куска
  hold?: { momentId: string } | null;// стоять на моменте, пока указание не сменится
  data?: MatchData | null;           // уже безопасные для показа данные партии
}
export interface GameVideoSupport {
  contract: 1;
  guide: string;                     // для game_capabilities: места сцен, моменты, данные
  recipes: string[];                 // интерактивные рецепты douga для входа 2
  configSnapshots(config): string[]; // какие vsn_ использует конфиг
  directives(view): VideoDirective[];// текущие и предзагружаемые указания из вида
}
// GameDefinition.video?: GameVideoSupport
```

  - `key` считает игра чистой функцией SDK `videoKey(...)` по каноническому JSON.
  - `directives(view)` — доверенный обход, как `quizorMediaRefs`. Сервер не ищет указания
    по всему виду.
  - `describeGame` добавляет раздел `video` (guide и рецепты).
  - `validateConfig` получает необязательный хук `checkVideo(config, snapshots)`: сервис передаёт
    сводки снимков (сцены, моменты, выборы, `uses`), а игра проверяет ссылки.

### T06. Компиляция сцен на сервере

- **Решение:** `VideoRuntime` в `apps/server/src/video/runtime.ts`.
  - **Снимок.** `load(snapshotId)` читает манифест (LRU на 8 снимков) и создаёт
    `measureText = createTypographyMeasureText({files: runtimeFonts})` из `@douga/node`.
  - **Кусок плана.** `plan(directive)`:
    1. `applyMatchData(document, directive.data ?? {})`;
    2. `compileVideo(doc, manifest, {measureText})`;
    3. `slicePlan(plan, directive.play)`.
  - **Ошибки.** Диагностики уровня error — это ошибка партии `video_compile`. Проверка конфига
    ловит их заранее: компилирует все указания, которые можно вычислить без игроков, на примерных данных.
  - **Кэш.** LRU по `key` на 64 куска. Без данных партии план снимка компилируется один раз
    при первой загрузке.
  - **Бюджет.** В спайке меряется полная компиляция крупного документа. Если она дольше 300 мс,
    компилируются только сегменты из `play` (остальные получают `enabled:false`).
  - **Адреса медиа.** `rewritePlanMedia(plan, hash => "/files/video/<hash><ext>")`.
  - **Повтор.** Компиляция чистая, а снимок неизменен, поэтому повтор партии по журналу
    даёт те же куски.

### T07. Доставка плана и файлов

- Варианты:
  - а) в WebSocket уходит только указание, а кусок плана клиент берёт по HTTP по `key`;
  - б) кусок плана прямо в сообщении `match`.
- Рекомендация: а. Сообщение `match` рассылается на каждое изменение партии (черновики,
  голоса), а кусок плана с раскладкой текста — сотни КиБ.
- **Решение:** а.
  - **План.** `GET /api/lobbies/:id/video/:key` отдаёт кусок, если `key` есть в
    `game.video.directives(view)` текущего вида зрителя. Присутствие проверяется тем же
    `viewerSeat`, что и в `sendMatch`. Ведущему — по `presenterView`.
  - **Доступ на время.** Последние 16 ключей, показанные зрителю в этой партии, остаются
    доступны: переподключение и пауза не теряют сцену.
  - **Файлы.** `GET|HEAD /files/video/:hash` открывает файл, если хэш есть в куске плана,
    доступном зрителю по правилу выше (индекс `key → hashes` в памяти). Остальное — как
    `/files/assets`: один Range, `nosniff`, приватный кэш. Хэш и есть имя, поэтому `immutable`.
  - **Тайна до показа** (P07): весь снимок и чужие куски наружу не уходят.
    Предзагрузка разрешена только для указаний, которые игра сама положила в `preload`.

### T08. Клиент: `VideoStage`

- **Решение:** `@asobiba/video/client` экспортирует
  `VideoStage({directive, lobbyId, clockOffset, paused, muted, volume, onEvent, onPick})`.
  - **План.** Грузится по `key` с кэшем на странице. Пока план или первые кадры не готовы,
    показывается кадр сцены из снимка (`still`) без отсчёта.
  - **Плеер.** `InteractivePlayer` из `@douga/player`: `now = () => Date.now() + clockOffset`,
    `startedAt` и `holdFrame` из `plan.interaction` по `hold.momentId`.
  - **Ленивая загрузка.** Remotion приходит динамическим `import()`: Vite выносит его в отдельный
    чанк. Это первая ленивая загрузка на сайте. Остальные игры чанк не грузят.
  - **Сцена.** Пропорции формата, `stage`/`fullscreen` от доски, кнопка «Включить звук»
    при `audio-blocked` (P05).
  - **Клик.** `onPick(hit)` отдаёт `{cardId, participantId}`. Доска сама переводит его
    в своё действие.

### T09. Quizor

- **Решение:** изменения совместимы, поэтому версия схемы Quizor остаётся 1.
  - **Снимок.** `rules.video?: { snapshot: "vsn_…" }` — один снимок на квиз.
  - **Блок `scene`** в `intro`, `blocks` и `reveal`:
    `{ type: "scene", play: {segmentId}|{sceneIds}, from?: momentId, hold?: momentId,
       data?: "none"|"poll"|"scores", next?: "auto"|"answers"|"presenter" }`.
    - Длительность блока — от `from` до `hold` (или до конца куска) по кадрам снимка.
      Её записывает `ConfigService` при нормализации, как `normalizeMediaDurations`.
    - `hold` держит кадр, пока открыт приём ответов. Раскрытие продолжает с того же места
      блоком `scene` с `from` равным тому же моменту.
    - `data:"poll"` отдаёт итоги голосования вопроса (T10), `data:"scores"` — счёт игроков
      как `MatchData.players`.
  - **Вариант с карточкой.** `itemSchema.card?: string` — `cardId` или `participantId`
    из `choices` сцены вопроса. Тогда:
    - нажатие в кадре равно выбору варианта, обычным действием draft или answer с ожидаемым `questionId`;
    - `input?: "both"|"frame"|"form"` у поля, по умолчанию `both` (P03).
  - **Указания.** Вид Quizor получает `video: VideoDirective | null` и `videoPreload: VideoDirective[]`
    на тех же правах, что `blocks` и `preload`. На паузе они очищаются, как блоки.
    `game.video.directives(view)` читает только эти поля.
  - **Ограничения проверки.** Сцены, моменты и карточки обязаны существовать в снимке
    (`video_scene`, `video_moment`, `video_card`). `pacing:"self"` с блоком `scene` — ошибка
    `video_pacing` (P05). Нужные сцене данные (`uses`) должна покрывать настройка `data`
    блока (`video_data`).
  - **Превью.** `previewTarget` и `StaticBoard` рисуют блок `scene` кадром `still` из снимка:
    сервис передаёт data URI так же, как миниатюры картинок.

### T10. Судья «мнение»

- **Решение:**
  - **Судья `poll`.** Новое значение судьи `poll` и настройка `poll: { scoring: "none"|"majority"|"consensus" }`,
    по умолчанию `none` (P04).
  - **`choice`.** Оценки вариантов игнорируются.
    - `majority`: «Точно» получает выбравший самый частый вариант (несколько, если поровну),
      остальные — «Мимо».
  - **`order`.** При `poll` поле `correct` необязательно (refine вместо обязательности).
    Общий топ считается суммой мест: место `i` из `N` даёт `N − i`.
    - Ничья решается числом первых мест, затем порядком `items`.
    - `consensus`: оценка по расстоянию до общего топа (те же ступени, что у `scoring:"position"`).
  - **Итог** `poll: { votes: Record<optionId, number>, ranking: optionId[] }` сохраняется
    в результате вопроса. В вид он попадает только при раскрытии.
  - **Данные сцены.** `data:"poll"` переводит итог в `MatchData`: по `card` вариантов получаются
    `participants[pid].votes`, `rank`, `pickedBy` (только если настройка `showAnswers` показывает чужие ответы).
  - **Апелляция и правка очков** работают по очкам вопроса, как раньше.

### T11. MCP asobiba

- **Решение:**
  - **Новые инструменты:** `video_snapshot_import(token)`, `video_snapshot_list`,
    `video_snapshot_get(id, {stills?})` и `video_snapshot_delete(id)`.
    - `get` отдаёт сцены, моменты, выборы, `uses` и `sample`.
    - С `stills:true` до 6 кадров приходят как MCP-картинки.
  - **`game_capabilities`** игры с `video` отдаёт её раздел `video`.
  - **Проверки.** `config_validate` и `config_preview` используют T05 и T09.
  - **Инструкция** `initialize` описывает два входа одной строкой и остаётся меньше 3 КБ.
  - **Число инструментов:** 22.

### T12. Сайт

- **Решение:**
  - HTTP: `POST /api/video/snapshots {token}`, `GET /api/video/snapshots`, `DELETE /api/video/snapshots/:id`.
  - На странице пула раздел «Ролики douga»: импорт по токену, список (название, размер,
    сцен, ревизия) и удаление с ответом `video_in_use`.
  - Значок «видео» у конфигов и лобби с `rules.video`.

### T13. Окружение и хостинг

- **Решение:**
  - **Окружение.** `.env.example` получает `DOUGA_URL`. `dev-env` описывает соседнюю douga:
    `npm install` в ней и порты 3000, 8787, 5173.
  - **Хостинг.**
    - Один сервер, обе папки рядом, reverse proxy на два имени.
    - `DOUGA_URL` указывает на внутренний адрес douga.
    - Пример `scripts/deploy.sh`: подтянуть и собрать douga, затем asobiba (`npm ci`, `build`)
      и перезапустить оба.
    - Пример конфига reverse proxy — в README.
    - Боевой выкладки задача не делает (P16, шаг 5).
  - **Remotion.** `acknowledgeRemotionLicense` — как в douga, личный сайт.

### T14. Проверки

- **Решение.**
  - **Юниты:**
    - `videoKey` и `directives` Quizor;
    - доступ к кускам и файлам: чужой ключ, будущая сцена, предзагрузка, presenter;
    - импорт по фикстуре манифеста, собранной функциями `@douga/video` в тесте: битый хэш,
      версия, квоты, идемпотентность;
    - судья `poll` (большинство, консенсус, ничьи);
    - нормализация длительности блока `scene`;
    - проверка версий Remotion.
  - **Интеграция:** две WebSocket-сессии проходят вопрос со сценой. Сеть не отдаёт кусок
    раскрытия до закрытия ответа, `/files/video/<hash>` будущей сцены — 403.
  - **Живые проверки** по `verify`:
    - douga запущена, импорт настоящего снимка через MCP;
    - лобби, две вкладки браузера;
    - расхождение кадра меньше 0,25 с (номер кадра в `data-frame` для проверки);
    - клик по карточке засчитывается;
    - сцена топа строится по голосам;
    - кадр партии совпадает с `still` и клипом douga той же сцены (PSNR);
    - douga выключена — партия идёт.
  - **QG.** Тройка `npm test` → `npm run build` → `npx tsc --noEmit` при подключённых пакетах douga.

## Затронутые зоны

- [`.ai/map/sdk.md`](../../map/sdk.md) — `GameDefinition.video`, `VideoDirective`, `videoKey`, `checkVideo`.
- [`.ai/map/games.md`](../../map/games.md) — Quizor: блок `scene`, карточки вариантов, судья `poll`.
- [`.ai/map/server.md`](../../map/server.md) — `video/`: импорт, `VideoRuntime`, доступ к кускам.
- [`.ai/map/assets.md`](../../map/assets.md) — склад файлов снимков, квоты пула и конфига, `/files/video`.
- [`.ai/map/mcp.md`](../../map/mcp.md) — инструменты `video_snapshot_*`, раздел `video` в возможностях.
- [`.ai/map/web.md`](../../map/web.md) — `VideoStage`, ленивый чанк Remotion, раздел пула, `vite.config`.
- [`.ai/map/dev-env.md`](../../map/dev-env.md) — соседняя douga, `DOUGA_URL`, хостинг.
- Новая карточка `.ai/map/video.md` — мост с douga целиком, строка в `AGENTS.md`.
- [`.ai/vision.md`](../../vision.md) — пласт видео-игр из дальних целей становится текущим.

## Риски

- React 19 и Remotion 4.0.475 в одном бандле с пакетами по симлинкам. Первый шаг плана — спайк:
  `StudioVideo` с планом из `/watch` на доске asobiba, один экземпляр React (проверка
  `react` в чанках), `npm run build` и `tsc`.
- Время компиляции большого документа на каждое изменение данных (T06). Меряется в спайке.
- Синхронизация звука на телефонах: Safari глушит автозвук и сам решает, когда буферизовать.
  Проверяется на iPhone в живых проверках шага 2.

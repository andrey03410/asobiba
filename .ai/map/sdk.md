# SDK игр

`@asobiba/sdk` описывает игру как Zod-схему настроек и набор чистых функций, проверяет
документ конфига, ведёт партию (серии, паузы, таймер хода, шаг реального времени),
прогоняет случайные партии и отдаёт агенту описание возможностей. DOM, сеть и база
в SDK не используются: его одинаково импортируют сервер, сайт и тесты.

## Где код

- [`packages/sdk/src/schema.ts`](../../packages/sdk/src/schema.ts) — общие детали: `color()`, `assetRef()`, `animation(presets, description)`, `seriesSchema`, `timerSchema`. Здесь же `z.config(z.locales.ru())` — сообщения Zod по-русски.
- [`game.ts`](../../packages/sdk/src/game.ts) — `GameDefinition`, `defineGame`, `RoundResult`, `actionError`, контексты `setup`/`tick`, `SlotDescriptor`, `ConfigPreset`.
- [`config.ts`](../../packages/sdk/src/config.ts) — `ConfigDocument`, `documentSchema(game)`, `validateConfig(catalog, input)`, `presetDocument`, `collectAssetRefs`, `createCatalog`.
- [`issues.ts`](../../packages/sdk/src/issues.ts) — `ConfigIssue { path, code, message, hint, severity }`, перевод ошибок Zod в issues с подсказками.
- [`match.ts`](../../packages/sdk/src/match.ts) — движок `Match`.
- [`simulate.ts`](../../packages/sdk/src/simulate.ts) — `simulate(game, config, { rounds, seed, maxActions })`.
- [`capabilities.ts`](../../packages/sdk/src/capabilities.ts) — `SDK_GUIDE`, `listGames`, `describeGame`, `configJsonSchema`.
- [`client.ts`](../../packages/sdk/src/client.ts) — контракт клиента игры без React: `BoardProps`, `SeatIconProps`, `GameClient` (`Board`, `SeatIcon`, `css`, `previewMatch`).
- [`rng.ts`](../../packages/sdk/src/rng.ts) — mulberry32 `createRng(seed)`.
- [`testing/index.ts`](../../packages/sdk/src/testing/index.ts) (`@asobiba/sdk/testing`) — тестовые игры `raceGame` (пошаговая) и `driftGame` (реального времени, 10 тиков/с). В каталог не входят.

## Как устроено

- **Документ конфига** `{ sdk: 1, game, gameVersion, title, rules, series, timer, visual }`. Все объекты строгие (`z.strictObject`): лишнее поле — ошибка `unrecognized_keys` с подсказкой. Вложенные объекты с умолчаниями используют `.prefault({})`, иначе Zod 4 не применит умолчания полей.
- **Проверка** `validateConfig`: игра и версии (`unknown_game`, `sdk_version`, `game_version` с подсказкой перечитать возможности) → разбор схемой → `checkRules` и `checkVisual` игры (пути относительно раздела, SDK добавляет префикс) → у игр реального времени таймер хода запрещён. Предупреждения (`severity: "warning"`) не блокируют. Владение картинками проверяет сервер.
- **Игра** — чистые функции над обычным JSON: `setup`, `currentSeats`, `turnId?`, `legalActions`, `applyAction` (возвращает новое состояние или `actionError`), `passTurn?`, `tick?`, `roundResult`, `view(state, seat|null)`. Вся случайность — из `ctx.rng`. Необязательный `presentRules` возвращает копию правил без секретов: её показывает лобби, партия идёт по документу из базы.
- **Движок `Match`**:
  - `Match.start({ game, config, seats, seed, startedAt })`, `dispatch(seat, action, at)`, `advance(now)`, `nextWakeAt()`, `view(seat)`, `record()`, `Match.restore({ game, config, record, now })`;
  - серия: раунды, `firstPlayer` (`rotate`/`loser`/`winner`/`same`), `stopWhenDecided`; между раундами пауза `INTERMISSION_MS` = 3 с, в паузе действия отклоняются;
  - таймер хода: дедлайн сбрасывается, когда меняется `turnId` (или набор ходящих мест); политики `skip` (`passTurn`), `random` (доигрывает ход случайными действиями), `lose` (раунд проигран). Если у игры есть `turnBudgetSeconds(state)`, дедлайн берётся оттуда (`0` — без часов), а политика по-прежнему из `timer.onTimeout`;
  - реальное время: фиксированный шаг `1000 / tickRate` от начала раунда, действия применяются сразу, тики — в `advance`;
  - журнал хранит только действия людей с временем. Таймауты, паузы и тики выводятся из времени, поэтому `restore` по журналу даёт то же состояние, что и у живой партии.
  - итог серии: `winners` — места с наибольшим числом побед в раундах, `draw` = победителей не ровно один.
  - страховка от зависания: в пошаговой игре, если ни у кого из ходящих нет `legalActions`, а `roundResult` пуст, раунд заканчивается ничьей `no-moves` («ходов нет»). Проверка идёт после `setup` каждого раунда и после каждого изменения. Пас, если игра его допускает, должен быть действием.
  - отклонённое действие (`actionError`) не попадает в журнал, поэтому движок откатывает генератор (`rng.state()`/`restore()`) — повтор по журналу совпадает с живой партией.
- **Прогоны** `simulate` (синхронно, в MCP — до 200 раундов): независимые раунды, место 0 всегда ходит первым. Проблемы: `never-ends`, `stuck`, `illegal-legal-action`, `always-draw` (≥95 % ничьих при ≥10 раундах), `first-seat-dominates` (≥90 % результативных раундов).
- **Возможности** `describeGame`: JSON Schema документа (`z.toJSONSchema`, `io: "input"`), `guide` игры, `sdkGuide`, слоты, темы, `visualCatalog`, полные документы пресетов.

## Бюджет случайного прогона

Необязательный `GameDefinition.simulationBudget(rules)` задаёт maxTotalActions для
всего запроса и необязательный maxDurationMs; вызывающий может уменьшить лимит через options.maxTotalActions.
`SimulationReport.rounds` — начатые раунды, requestedRounds — запрошенные,
skippedRounds — не запущенные. Исчерпание бюджета возвращает budget-exceeded,
а не ложный never-ends; завершение последним допустимым действием учитывается.
У старых игр без hook лимита нет. Jinchi использует бюджет 20 млн клеток × действий и кооперативный предел 1000 мс.
Одна синхронная setup/action не прерывается, но после неё новый шаг не начинается.
Для проверки временных границ simulate принимает options.nowMs с тестовыми часами.
`previewMatch(end)` может вернуть промежуточную позицию: проверяй phase/lastRound.

## Компактный HUD игры

`BoardProps` дополнен необязательными `playerNames`, `clockOffset`, `turnRemainingMs`.
Они нужны HUD внутри полноэкранной доски и не меняют контракт правил. `clockOffset`
прибавляется к локальному времени для отсчёта server deadline. У Jinchi ручной бросок
не меняет turnId, поэтому он не выдаёт игроку новый полный таймер.

## Грабли

- `.default({})` у вложенного объекта в Zod 4 не прогоняет значение через схему: поля внутри останутся без умолчаний. Используй `.prefault({})`.
- Состояние игры нельзя мутировать: движок хранит ссылку и отдаёт её в `view`. Возвращай копии.
- `RoundResult.summary` — короткая причина без номеров мест и имён («собрана линия», «время на ход вышло»): имена победителей клиент подставляет сам.
- `view` не получает правила: всё, что нужно для подсказок клиенту (например, `placement`), игра кладёт в состояние на `setup`.
- Новая возможность — это новое поле схемы с описанием, обработка в правилах и в рендерере. Код из конфига не исполняется. Несовместимая смена схемы — поднять `version` игры.

## Как проверить

- `npx vitest run packages/sdk` — генератор, проверка конфига, движок (серии, таймеры, реальное время, восстановление), прогоны, возможности.
- Вживую — инструменты `config_validate`, `config_simulate`, `game_capabilities` через `scripts/verify-mcp.mjs` ([mcp.md](mcp.md)).

## История

- [задача 01](../features/01-rebuild/README.md) — первая версия SDK
- [задача 04](../features/04-russkoe-pole/README.md) — часы фазы и `presentRules`

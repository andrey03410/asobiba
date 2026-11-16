# План реализации задачи 08

> Для исполнителей: выполнять по частям через TDD. Независимые области из этого
> плана делегируются по `superpowers:dispatching-parallel-agents`; root ведёт
> генератор, интеграцию и общий QG. Свежий обзор всей ветки обязателен перед PR.

**Цель:** реализовать [принятый продукт](product.md), P01–P18 и A01–A30.

**Архитектура:** аддитивные правила Jinchi v1; общие info-контракты SDK;
детерминированная генерация и диагностика; линейные геометрические операции;
обратимая упаковка WS; Canvas игры и SVG превью.

**Стек:** существующие TypeScript, Zod 4, React 19, Fastify 5, Vitest, resvg.
Новых npm-зависимостей не планируется. Решения — [tech.md](tech.md).

## Общие ограничения

- Карта 3…1000 по каждой стороне, максимум 1 000 000 клеток.
- Два кубика 2…100, default два d6; старое `sides:number` сохраняется.
- В ordinary пресете сюрпризы включены; старые конфиги остаются без новых механик.
- Флаги и спецклетки одноразовые, постановка и окружение активируют одинаково.
- Авторский info до 80/2000 символов; публичная информация не раскрывает секреты.
- Агент собирает конфиг и лобби, не ходит за людей. Сервер повторяет все проверки.
- Телефон в обеих ориентациях, окно и fullscreen, карта без прокрутки страницы.
- Доки по-русски, код/идентификаторы/коммиты по-английски. AI-артефакты только в .ai.
- Работа в текущей ветке/чекауте. Изменения чужой области не перезаписывать.

## Особый фокус ревью

1. Legacy журналы после ускорения бросков воспроизводятся с тем же RNG.
2. Переходы lock/reroll/timeout не дают лишнего поворота, заряда или времени.
3. Метаданные баланса после ручной правки не дают ложный сертификат.
4. Сжатие больших снимков сохраняет каждую клетку и персональные права view.
5. Публичная информация Quizor/Pole и PNG неизвестных клеток не раскрывают секреты.

## Задача 1. Правила, геометрия и движок Jinchi

Владелец файлов: `jinchi_engine`.

**Файлы:** `games/jinchi/src/rules.ts`, `game.ts`; новые `placement.ts`, `capture.ts`,
значимые `*.test.ts` рядом. `index.ts` дополняется координированно. Presets/guide — root.

**Интерфейсы:** diceSides, CellPosition, EffectCell, WeightedEffect;
captureTerritory и placementCapacity по T02–T03. Новый view содержит scores, points,
flagCounts, effectPoints, rerollCharges, rotationLocked[], turnRotationLocked,
rerolled, impossibleRoll, canRotate/canReroll/canSkip, remaining flags/effects.
Действия reroll/skip-impossible. Потребляет optional SDK hooks и analyzeMap от root.

- [x] Написать красные тесты d100/разных кубиков, одноразового захвата, всех трёх
  критериев, выбывшего лидера, совпадения целей/лимитов, накопления помех и зарядов.
- [x] Запустить `npx vitest run games/jinchi/src/game.test.ts` и новые тесты;
  увидеть ожидаемые FAIL новых правил, записать команду/причину в progress.md.
- [x] Расширить строгую схему и validation, сохранив legacy normal form.
- [x] Реализовать capture/placement, сравнить профиль с полным поиском на малых
  ручных картах; проверить случаи overlapOwn и запрета поворота.
- [x] Реализовать эффекты и victory pipeline, RNG/replay и таймаут без reset.
- [x] Запустить все тесты движка. Готово: новые и прежние проходят, никакой утечки
  hidden outcomes, размеры 1000 и d100 не вызывают квадратичного перебора размеров.
- [x] Код включён в общий интеграционный коммит `687d9fc`.

## Задача 2. Общая информация и контекстная настройка всех игр

Владелец файлов: `game_information`.

**Файлы:** SDK `info.ts`, `game.ts`, `config.ts`, `capabilities.ts`, `index.ts` и тесты;
info.ts каждой игры (Jinchi game.ts подключает исполнитель задачи 1); game.ts остальных
трёх игр; `packages/api/src/index.ts`; server ConfigService/LobbyService/MCP info;
web `GameInformation.tsx`, `LobbyPage.tsx`, `NewLobbyPage.tsx` и тесты.

**Интерфейсы:** GameInformation, TuningDirection, ConfigSummary, ConfigInformation,
describeConfig(game,config); caps.info/tuning, ValidateResponse.summary,
LobbyDto.information. ConfigDocument.info?:{title?,text?}. MatchStage получает
information?:ReactNode. В SDK game.ts также добавить hasLegalAction и sampleAction
с T03-сигнатурами; их потребителей меняет root.

- [x] Красные тесты безопасной сводки всех игр, 5–7 направлений и последствий,
  границ 80/2000, отсутствия info у legacy, escaping и отсутствия секретных fixtures.
- [x] Запустить targeted SDK/info/server tests; увидеть FAIL новых наблюдаемых контрактов.
- [x] Реализовать whitelist formatters, expose caps/validation/DTO и общий компонент.
- [x] Вставить в лобби, передать в сцену, добавить авторское вступление в обычной
  форме и Quizor. Не менять правила иных игр.
- [x] Интеграционные тесты validate → lobby и invitation без автора; targeted GREEN.
- [x] Код включён в общий интеграционный коммит `687d9fc`.

## Задача 3. Генерация, баланс, новые пресеты

Владелец: root.

**Файлы:** новые `games/jinchi/src/generator.ts`, `balance.ts` и тесты;
`presets.ts`, `guide.ts`, `index.ts`; client `MapGenerator.tsx`.

**Интерфейсы:** generationSchema, generateMap(request), analyzeMap(rules),
типизированный GeneratedMap с map/flags/effects/diagnostics; metadata T04.
Генератор потребляет diceSides/placementCapacity/captureTerritory, не импортирует game.

- [x] Красные тесты repeatable seed, круг R50→101, N=2…8, различающихся зёрен,
  независимых маршрутов, плотности и равных условий; невозможные inputs rejected.
- [x] Запустить `npx vitest run games/jinchi/src/generator.test.ts`; expected FAIL
  до появления генерации. Написать небольшой ручной imbalance fixture для analyzeMap.
- [x] Реализовать ограниченные попытки генерации структур, protected starts/routes,
  объекты и metadata. Не выдавать failed diagnostic как balanced.
- [x] Проверить подделанные metadata/ручную правку и max1000/d100 без утраты данных.
- [x] Добавить новые обычные пресеты с сюрпризами; старые presets оставить по правилам.
  Guide объясняет цели, эффекты, размер, кубики и контекстный диалог.
- [x] Реализовать UI генерации с явной заменой карты и диагностикой.
- [x] Targeted GREEN, код в `687d9fc`; последующие review-fixes — отдельно.

## Задача 4. Удобная сцена и редактор

Владелец файлов: `jinchi_ui`.

**Файлы:** `games/jinchi/src/client/**` кроме MapGenerator.tsx root;
`apps/web/src/components/MatchStage.tsx`, его тесты и стили сцены в styles.css.
SDK GameClient.stageHud добавляет root (или согласованная однофайловая правка).

**Интерфейсы:** view/action задачи 1; MatchStage.information?:ReactNode задачи 2;
MapEditor optional rules/onRulesChange/generator slot для общей формы.

- [x] Красные тесты модели камеры, предпочтений счёта, ключа сигнала хода,
  ограниченного overlay и resize/undo объектов редактора.
- [x] Targeted tests, expected FAIL новых сценариев.
- [x] Canvas texture, общая миникарта, bounded hints/lastMove, безопасное приближение.
- [x] Компактный/скрытый счёт, шторки, один timer, turn cue/звук, ориентации.
- [x] Объекты и d100 в UI, reroll/skip/lock, финальное разложение счёта.
- [x] Редактор до1000: копирование строк, typed flood, объекты, потери при resize,
  снятие metadata баланса при правке. MapGenerator slot подключает root.
- [x] Targeted GREEN; код в `687d9fc`, полировка в `981ccdb` и review-fixes.

## Задача 5. SDK hooks, транспорт, HTTP и MCP, сквозная интеграция

Владелец: root; после выхода владельцев shared файлов из задачи 2.

**Файлы:** SDK `match.ts`, `simulate.ts`, Jinchi client/index.ts preview;
новые `games/jinchi/src/wire.ts`/тесты; server routes/MCP server/instructions/tests;
`apps/web/src/useLobbySocket.ts`, NewLobbyPage glue, API helper.

- [x] Красные тесты Match без enumeration при наличии hook, simulation sampleAction,
  encoding roundtrip миллионной карты/последнего захвата, malformed decode rejected.
- [x] Targeted expected FAIL. Реализовать hooks consumers и self-contained packed WS.
  При малых прежних матчах protocol behaviour не меняется.
- [x] Красные реальные MCP/HTTP тесты compact generate→validate→preview→lobby;
  чужой configId запрещён, invalid strict состав не стартует, ошибки actionable.
- [x] Добавить jinchi_generate и configId альтернативу validate/simulate/preview,
  общий серверный генератор и UI glue. Инструкции сохраняют лимит 3КБ.
- [x] Проверить полную связку двух кубиков, генератора и редактора; targeted GREEN.
- [x] Код включён в общий интеграционный коммит `687d9fc`.

## Задача 6. QG, живая приёмка, свежее ревью

Владелец: root; независимый свежий ревьюер всей ветки.

**Файлы:** `scripts/verify-jinchi-playtest.mjs` (или узкие drivers),
`.ai/features/08-jinchi-playtest/verify.md`, progress.md; evidence только storage.

- [x] Seed verify accounts без печати паролей/токенов; проверить порты и запустить dev.
- [x] Настоящий MCP: capabilities всех4, безопасные summary, генератор/превью/лобби.
- [x] Несколько WS: флаги/эффекты, итог, replay/reconnect, строгий состав.
- [x] Браузер A01–A08, обе ориентации, d100/объекты, info всех4 и создание через форму.
- [x] Максимальная карта: PNG, редактирование, начало/ход/крупный захват,
  загрузка/навигация/latency; физическую/эмулированную поверхность подписать честно.
- [x] Исправить найденное через воспроизведение и TDD; заполнить A01–A30 evidence.
- [x] После последних code edits: `npm test` → `npm run build` → `npx tsc --noEmit`;
  expected все exit0, цифры и вывод сохранить.
- [x] Свежий review diff main…HEAD, исправить существенное и подтвердить тестами.
- [x] Коммит проверки и push ветки; создать PR с результатами и ручным чек-листом.
  Только зелёный QG и исправленное существенное ревью разрешают merge.

## Задача 7. Знания

- [x] Обновить карточки SDK/games/mcp/server/web реальным поведением и проверками.
- [x] Проверить локальные ссылки, отметить выполненные задачи/доказательства.
- [x] После готовности PR поставить stage:review; автономная приёмка записана в verify.
- [x] Записать историю и stage:merged, push, merge PR в main, switch main/pull.
  Подтвердить SHA main и чистое рабочее дерево. Коммит `docs(08): merged`.

## Проверка интерфейсов до старта

- Задачи 1/3: analyzeMap и capture/placement разнесены по модулям без runtime cycle.
- Задачи 1/4: одинаковые имена полей/действий, legacy scores остаются клетками.
- Задачи 2/4: information slot не размонтирует доску, Jinchi сам рисует HUD.
- Задачи 2/5: shared server/SDK files меняются root только после коммита info.
- Задачи 3/4: MapGenerator отдельный файл root; подключение выполняется после готовности.

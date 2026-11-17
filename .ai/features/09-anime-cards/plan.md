# Yomifuda — план реализации

> Для исполнителей: `superpowers:subagent-driven-development`; задачи последовательно,
> TDD и свежее ревью каждой реализации. Воркспейс и артефакты только в папке задачи `.ai/`.

**Цель:** игра Yomifuda с честной колодой, тайными руками, мобильной сценой и раскрытием douga.
**Архитектура:** чистые функции SDK управляют всей колодой; сервер хранит оригинал,
публикует whitelist-проекции; клиент рендерит общую арену родным движком douga и личную руку React.
**Стек:** текущие Node22, TS, Zod4, React19, Fastify/WS, Vitest, локальные пакеты douga.
**Спека:** [product.md](product.md), [tech.md](tech.md), уточнения владельца [brief.md](brief.md).

## Общие ограничения

- Русские UI/доки, английские идентификаторы и conventional commits.
- Основной checkout, ветка feat/09-anime-cards; без worktree, секретов в выводе и git.
- Конфиг только данные, никаких произвольных функций. Версия игры 1.
- Оценки честные без нормализации и равного бюджета, не раскрываются до разрешённой фазы.
- Сначала активная оценка, затем сумма только разделивших максимум, затем по0,5.
- 2–6 игроков; D кратно N, рука <=D/N. Все карты разыгрываются ровно один раз.
- Фазы choose/reveal/review/finished; номер боя обязателен у play/ready.
- Раскрытие 10сек по умолчанию, раньше нельзя ready; no-repeat показателя по умолчанию.
- Телефон360×640/390×844, игроки+стол+рука, stage/fullscreen; douga рисует арену и анимацию.
- Нет объяснений оценок и автоходов. Картинки только asset refs, ACL по разрешённому виду.
- Каждое изменение поведения покрывается красным тестом, затем зелёным.

## Фокус ревью

1. Ушедший в зрители/чужой пользователь/хозяин не получает чужую руку или hidden values.
2. Запоздалые play/ready и повторный подтверждённый ход не меняют следующий бой.
3. Малая колода, D=N×H и последние карты заканчиваются без лишнего добора и неполного боя.
4. Одинаковое активное значение, но разные суммы; одинаковые суммы у нескольких лидеров.
5. Картинка чужой руки и реальные оценки не утекают через config/list/save/validate/preview.

## Задачи

### Task 1: Чистый движок и конфиг

**Файлы:** создать games/yomifuda/package.json, src/{index,rules,game,guide,presets,information}.ts
и tests рядом. При необходимости обновить lockfile через npm install.
**Интерфейсы:** экспорт `yomifuda`, `rulesSchema`, `visualSchema`, `YomifudaRules`,
`YomifudaView`, `YomifudaAction`, `PublicCard`, `YomifudaVisual`; id yomifuda, версия1.
Правила, shape карты и публичного вида — T01/T02 техники. Добавить документированный
`demoRules`/preset helper для интеграционных тестов. Никаких изменений server/web/catalog в этой задаче.

- [x] Написать тесты до кода: случайная равная раздача, card ownership, hidden hand/values,
  ничьи (active→sum→0.5), запрет early ready и stale round, выбор показателя, полное доигрывание,
  RNG/restore, границы шкалы, дубли/неполные значения/кратность/рука, >6 характеристик.
- [x] `npx vitest run games/yomifuda` — зафиксировать ожидаемое RED.
- [x] Реализовать strict схемы, чистый движок с wake и whitelist view, guide/info/tuning
  (семь направлений), безопасные summary/presentRules и учебный пресет.
- [x] Та же команда GREEN, затем npm test. Отчёт и self-review; commit `feat(yomifuda): add hidden card game engine`.
- [x] Свежее ревью диффа задачи; исправить существенное до следующей задачи.

### Task 2: Безопасный сервер и MCP

**Файлы:** apps/server/src/{configs/service.ts,lobbies/service.ts,routes.ts,mcp/server.ts,
games/catalog.ts,games/media-refs.ts,preview/render.ts}, packages/api/src/index.ts,
apps/server/package.json, тесты configs/lobbies/MCP, package-lock.json.
**Потребляет:** yomifuda и presentRules из Task1. **Производит:** регистрация определения,
ConfigDto.secretsHidden?:boolean, ConfigService.getOriginal(userId,id), обычные безопасные
get/list/save и явный get с revealSecrets; создание по configId и внутренние операции на оригинале.
Client/доска и NewLobbyPage — Task3, не добавлять импорт несуществующего client сейчас.

- [x] RED: оригинальные значения отсутствуют у save/list/get/validate HTTP/MCP и LobbyDto;
  явный авторский доступ только владельцу; по configId работает валидация и запуск;
  чужая скрытая картинка не разрешена, своя разрешена, раскрытая разрешена всем участникам.
- [x] `npx vitest run apps/server/src/configs apps/server/src/mcp apps/server/src/lobbies` — RED.
- [x] Реализовать проекцию только для Yomifuda, внутренний оригинал, флаг авторского
  revealSecrets (HTTP query и MCP config_get), безопасный validate и доверенные media refs.
  Для UI-предзагрузки не выдавать картинок чужой руки через полный rules.
- [x] Те же focused тесты GREEN, npm test; self-review, commit `feat(server): protect Yomifuda deck secrets`.
- [x] Свежее ревью диффа задачи, исправить существенное.

### Task 3: Мобильный стол и родной визуал douga

**Файлы:** games/yomifuda/src/client/{index,Board,css,DougaArena,arena-plan,StaticBoard}.tsx/ts,
тесты; package.json игры, apps/web/src/{games.ts,pages/NewLobbyPage.tsx},
apps/server/src/games/catalog.ts, apps/{web,server}/package.json, package-lock.json;
при необходимости packages/video/src/client.
**Потребляет:** YomifudaView/Actions из Task1, безопасные конфиги Task2.
**Производит:** yomifudaClient с stageHud board, Board, SeatIcon, css, безопасным previewMatch.
Арена compileVideo(createVideoDocument(...)) → InteractivePlayer; никакой своей замены рендера douga.

- [ ] RED: план douga строится по view без сырой колоды, choose содержит только рубашки,
  reveal — активные значения после всех ходов, тай-брейк раскрывает только допустимую сумму;
  staticRender валидный SVG и preview на демонстрационных данных не раскрывает оценки пользователя.
- [ ] `npx vitest run games/yomifuda` — RED.
- [ ] Реализовать адаптивную доску с игроками/столом/рукой, выбор и подтверждение,
  рубашки, 10сек анимированное раскрытие, готовность, финал, повторную загрузку ошибки,
  fullscreen через props, reduced motion, доступные названия и управление.
  Стол/карты/значения/переходы реально рендерит douga. Красивые тема, фон и паттерн рубашек.
  Полная колода никогда не передаётся плану; для card image используется assetUrl из разрешённого вида.
- [ ] Зарегистрировать оба клиента, добавить зависимости. Yomifuda в NewLobbyPage —
  сводка и выбор пресета/сохранённой колоды без JSON с оценками; saved запускать через configId,
  не валидировать отредактированную скрытую колоду и не пересылать её как будто оригинал.
- [ ] Focused GREEN, npm test, build, tsc; self-review, commit `feat(web): add mobile Yomifuda arena with Douga`.
- [ ] Свежее ревью диффа задачи, исправить существенное.

### Task 4: QG и живая партия

**Файлы:** scripts/verify-yomifuda.mjs, .ai/features/09-anime-cards/verify.md;
доказательства только storage/verification/09-yomifuda/. Выполняет основной агент.

- [ ] Проверить порты и seed-verify, использовать существующий dev либо запустить один.
- [ ] Настоящий MCP: capabilities, импорт портретов, validate/save/list/get/simulate/PNG/лобби.
- [ ] Настоящие WS трёх игроков и наблюдателя: hidden data, рубашки, последний ход→reveal,
  early ready отказ, оба тай-брейка, добор до финиша, reconnect/restore.
- [ ] Браузер телефона и ПК, fullscreen, картинки, кадры douga в начале/середине/конце
  раскрытия. Посмотреть PNG глазами, проверить отсутствие scroll/перекрытия управления.
- [ ] После последних правок npm test → npm run build → npx tsc --noEmit, записать числа.
- [ ] Свежее ревью всей ветки, существенное исправить и повторить QG.

### Task 5: Знания

- [ ] Обновить карточки .ai/map/{games,server,mcp,web,video,dev-env}.md и SDK при изменении контракта;
  проверить ссылки. Plan/README/verify отражают фактический результат и ограничения.
- [ ] Push ветки, PR `09: Yomifuda — карточная игра с тайными оценками`, stage review.
  После зелёных QG/ревью — history, stage merged, merge PR, pull main и push/проверка origin/main.

# План реализации Jinchi

> Для исполнителей: реализация по задачам с TDD; независимые части делегируются по
> `superpowers:dispatching-parallel-agents`, интеграция и QG — в текущей сессии.

**Цель:** полностью рабочая Jinchi с редактором, красивой адаптивной доской и MCP.
**Архитектура:** пакет игры с чистым движком и Zod, общий SVG viewport для клиента и
редактора, регистрация в существующем каталоге. Стек проекта без новых UI-зависимостей.
**Спецификация:** [product.md](product.md), [tech.md](tech.md).

## Общие ограничения

- Карта 3–200 × 3–200; 2–8 стартовых зон; 2–8 игроков; кубики 2–20 граней.
- Данные конфига не исполняются; случайность только из SDK RNG, ходы проверяет сервер.
- Русский UI, имена и коммиты на английском. Работа в основном checkout.
- Контракт полей/типов/экспортов зафиксирован в T02; при изменениях уведомить смежную часть.
- Не менять архивные задачи и не раскрывать storage/.env.

## Фокус ревью

- Карты 200×200: линейный поиск постановок и заливка без переполнения стека.
- Пустые/повреждённые строки карты и исчезнувшие базы: ошибки, без падения редактора.
- Случайный бросок без места, отключённый предел пропусков: партия не зависает.
- Кольцо с диагоналями, защищёнными базами и равными компонентами: точное соблюдение P01–P03.
- Мобильные жесты и fullscreen: тапы не превращаются в случайные ходы, HUD остаётся видимым.

### 1. Движок и конфиг

Файлы: `games/jinchi/package.json`, `src/{rules,visual,game,presets,guide,index}.ts`, `src/game.test.ts`.
Интерфейсы: все типы и функции T02.
- [x] Написать и увидеть красные тесты: прямоугольники, поворот, ошибка соседства/стены/чужого,
  захват обеих моделей, диагональ, защита базы, выбывание, пропуски, лимиты и воспроизведение.
- [x] Реализовать схемы/проверки/движок/правила по конфигу; 6 пресетов из P19.
- [x] Проверить все пресеты симуляцией; измерить поиск на 200×200.
- [x] Коммит `feat(jinchi): add configurable territory game engine`.

### 2. Доска и навигация

Файлы: `games/jinchi/src/client/{MapViewport,Board,index,css}.tsx/ts`, тесты клиента.
Интерфейсы: `jinchiClient` по GameClient; MapViewport экспортируется из `./client`.
MapViewport props: `{width,height,cells,colors,wallColor?,background?,grid?,children?,
onCellHover?(x,y),onCellClick?(x,y),onStrokeStart?(x,y),onStrokeMove?(x,y),
onStrokeEnd?(x,y),drawing?:boolean,focusCells?:number[],lastCells?:number[],toolbar?:ReactNode}`.
- [x] Красные тесты SSR: чистый SVG staticRender, цвета/стены, правила и HUD обычного Board.
- [x] Реализовать SVG paths, обзор, zoom/pan/pinch, fullscreen, горячие клавиши, миникарту.
- [x] Реализовать ghost, R/правый клик, hints H, тач-подтверждение, счёт/кубики/события/волну.
- [x] Проверить SSR и браузер 200×200/мобильный размер.
- [x] Коммит `feat(jinchi): add interactive board and map navigation`.

### 3. Редактор карты

Файлы: `games/jinchi/src/client/{MapEditor,editor-model}.tsx/ts`, тесты editor-model.
Интерфейс: `MapEditor({value,onChange})`, карта T01; использует MapViewport задачи 2.
- [x] Красные тесты: resize сохраняет пересечение, flood, симметрия с номерами 1–4/1–2,
  undo/redo пользовательского жеста и границы карты.
- [x] Кисть/прямоугольник/заливка, выбор материала, симметрия, resize, undo/redo/clear.
- [x] Проверка карты и счётчики во время рисования, понятный UI с подсказками.
- [x] Коммит `feat(jinchi): add map editor with symmetry and history`.

### 4. Интеграция

Файлы: `apps/{server,web}/package.json`, каталоги, SchemaForm, NewLobbyPage, LobbyPage,
`packages/sdk/src/client.ts`, интеграционные тесты, `scripts/verify-jinchi.mjs`.
- [x] Зарегистрировать игру и клиент, workspace lock, override rules.map, передать имена в Board.
- [x] Добавить правила в лобби; изолировать превью от интерактивной панели.
- [x] Настоящий MCP: возможности→валидация→симуляция→PNG→лобби; два WebSocket до итога.
- [x] В браузере создать карту/лобби, зайти двумя игроками, сыграть, проверить F/R/H и мобильный вид.
- [x] Коммит `feat(web): integrate Jinchi configuration and lobbies`.

### 5. QG, ревью и вливание

- [x] `npm test` → `npm run build` → `npx tsc --noEmit` после последних правок.
- [x] Живые проверки по verify; скриншоты/PNG/JSON в `storage/verification/02-jinchi/`.
- [x] Свежий независимый ревьюер, исправления существенного, запись в verify.md.
- [x] PR, stage review; автономная приёмка; history, stage merged и merge в main.

### 6. Знания

- [x] Обновить `.ai/map/{games,sdk,web,server,mcp}.md` по фактическому коду и проверкам.

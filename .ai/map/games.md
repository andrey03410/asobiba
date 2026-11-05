# Игры

Каталог игр и то, как добавить новую. В каталоге крестики-нолики и Jinchi. Каждая игра —
отдельный пакет в `games/`: определение для SDK (правила, схема, пресеты, руководство
для агента) и клиент на React (`./client`: доска, иконка места, CSS анимаций, превью).

## Где код

- [`games/tic-tac-toe/src/rules.ts`](../../games/tic-tac-toe/src/rules.ts) — схема `rules`, `checkRules`, поиск линий (`runThrough`, `allLines`), `landingRow` для гравитации.
- [`visual.ts`](../../games/tic-tac-toe/src/visual.ts) — схема `visual`, пресеты фигур, стилей, текстур и анимаций, темы `THEMES`, `resolveVisual` (тема + переопределения), `checkVisual`.
- [`game.ts`](../../games/tic-tac-toe/src/game.ts) — `ticTacToe = defineGame(...)`, схема действий `place`/`drop`, состояние `TttState`, вид `TttView` с `legal`.
- [`presets.ts`](../../games/tic-tac-toe/src/presets.ts) — 8 пресетов: classic, gomoku, connect-four, connect6, misere, most-lines, trio, party.
- [`guide.ts`](../../games/tic-tac-toe/src/guide.ts) — руководство для агента (уходит в `game_capabilities`).
- [`client/Board.tsx`](../../games/tic-tac-toe/src/client/Board.tsx) — `TicTacToeBoard` (SVG) и `TicTacToeSeatIcon`; [`client/pieces.tsx`](../../games/tic-tac-toe/src/client/pieces.tsx) — 12 фигур; [`client/css.ts`](../../games/tic-tac-toe/src/client/css.ts) — анимации; [`client/index.ts`](../../games/tic-tac-toe/src/client/index.ts) — `ticTacToeClient`, `previewMatch`.
- Регистрация: [`apps/server/src/games/catalog.ts`](../../apps/server/src/games/catalog.ts) (определение и клиент для превью) и `apps/web/src/games.ts` (клиент для сайта).

## Как устроено (крестики-нолики)

- Поле до 15×15, заблокированные клетки (`-2` в `cells`), 2–4 игрока, линия 3–10 по выбранным направлениям.
- Режимы: `first-line` (раунд кончается на первой линии) и `most-lines` (до заполнения, сплошная линия длиннее `line` считается одной); мизер для обоих.
- `placement: gravity` — действие `drop {col}`, фигура падает до препятствия. В свободном режиме — `place {row, col}`.
- `turns.movesPerTurn` 1–3 и `firstTurnMoves`. Ничья — когда ходов не осталось.
- Визуал: тема (`classic`, `neon`, `candy`, `paper`, `party`) задаёт всё, переопределяются палитра, стиль и текстура поля, фигуры по местам (`{ preset, color }` или `{ asset }`), картинки поля и клетки, размер фигур, анимации `place`/`win`/`idle`.
- Итог раунда: `reason` (`line`, `most-lines`, `board-full`) и `summary` без номера места — «собрана линия», «линия в мизере — проигрыш», «ходов не осталось».
- Одинаковые фигуры у двух мест — ошибка `same_piece`. `firstTurnMoves ≥ line` — предупреждение `instant_win`.
- Рендерер: клетка 100 единиц SVG, анимации — CSS-классы `place-*`, `idle-*`, `win-*` с переменными `--d` (длительность) и `--k` (сила) на вложенных `<g>`: позиция задаётся атрибутом `transform` внешней группы, CSS-трансформ его не перетирает. `staticRender` убирает анимации и клики — так рисуется превью на сервере.

## Jinchi — территории и кубики

- [`games/jinchi/src/rules.ts`](../../games/jinchi/src/rules.ts) — строгая схема v1,
  карта `{width,height,rows}` (`.` пусто, `#` стены, `1…8` базы), проверка и `rulesText`.
- [`game.ts`](../../games/jinchi/src/game.ts) — прямоугольники, поворот, два вида соседства,
  захват итеративной заливкой, защита баз, выбывание, круги, автопропуски и итоги.
  Поиск якорей через интегральные суммы O(площадь); 200×200 занимает единицы мс.
- 2–8 игроков, карты 3–200 на сторону, d2–d20, ручной/автобросок. Пресеты:
  duel, four-corners, fortresses, labyrinth, mainland (120×80), octahedrons (8 мест).
- `capture.walls=true`: из областей, касающихся игрока, открыты все самые большие;
  меньшие захватываются. `false`: открыты области с проходом к краю, стены проходимы
  только для заливки. `diagonal=true` означает 4-связную заливку, false — 8-связную.
- Состояние — плоские cells (-2/-1/место), исходные bases, dice, scores, события (100),
  lastMove, result. В view нет полного списка ходов: клиент сам считает подсказки.
  После 256 неудачных бросков точное геометрическое ускорение сохраняет честное
  распределение, не блокируя сервер длинной отбраковкой. Всё из SDK RNG.
- [`client/MapViewport.tsx`](../../games/jinchi/src/client/MapViewport.tsx) — общая камера:
  SVG paths по территориям, zoom/pan/pinch, миникарта, fullscreen с fallback, F/0/M/L/WASD.
  Сетка выбирает светлый/тёмный штрих по фону. Новые ходы не сдвигают камеру. Static Board — только SVG; номера баз векторами
  (в resvg нет системных шрифтов).
- [`client/MapEditor.tsx`](../../games/jinchi/src/client/MapEditor.tsx) — кисть/прямоугольник/
  заливка, симметрия с нумерацией баз, undo/redo до 50 жестов, resize с сохранением
  верхнего левого пересечения. Полноэкранный toolbar включает палитру, размеры
  и симметрию; заливка фиксируется при отпускании, pinch её отменяет. Навигация — отдельный инструмент, пробел или два пальца.
- `node --import tsx scripts/verify-jinchi.mjs` — настоящий MCP, PNG начала/конца,
  два WebSocket до итога и повторная партия. Доказательства задачи 02 — в storage.

## Как добавить игру

1. Пакет `games/<id>/` по образцу крестиков-ноликов: `defineGame` с `rulesSchema`, `visualSchema`, `actionSchema`, функциями правил, `guide`, `presets`, `slots`, `themes`, `visualCatalog`.
2. Клиент `./client`: `GameClient` с `Board`, `SeatIcon`, `css`, `previewMatch`.
3. Зарегистрировать в `apps/server/src/games/catalog.ts` и `apps/web/src/games.ts`, добавить зависимость в `package.json` сервера и сайта.
4. Тесты правил, проверки конфига, «все пресеты валидны и доигрываются» и статической разметки доски.
5. Игра реального времени: `kind: "realtime"`, `tickRate`, `tick`, `currentSeats` → `[]`. Сервер уже крутит тики и рассылает вид. Восстановления после перезапуска у таких партий нет — они прерываются.

## Грабли

- В гравитации клетки под препятствием недостижимы (предупреждение `gravity_shadow`), а если достижимых клеток меньше длины линии (например, заблокирован весь верхний ряд) — ошибка `too_many_blocked`, и «поле заполнено» определяется отсутствием ходов, а не пустыми клетками.
- `resolveVisual` — единственное место, где тема смешивается с переопределениями. Рендерер и проверка одинаковых фигур опираются на него.
- Анимации в превью не видны: resvg не исполняет CSS-анимации, а `staticRender` их и не добавляет.

## Как проверить

- `npx vitest run games` — правила, проверки конфига, пресеты с прогоном, статическая разметка доски.
- Превью: `config_preview` через `scripts/verify-mcp.mjs` — PNG в `storage/verification/<run>/`.
- Сайт: партия в браузере, анимации видны вживую.

## История

- [задача 01](../features/01-rebuild/README.md) — крестики-нолики с гибкими правилами и визуалом

- [задача 02](../features/02-jinchi/README.md) — Jinchi, редактор и навигация

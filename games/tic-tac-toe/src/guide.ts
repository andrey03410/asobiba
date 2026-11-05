export const TIC_TAC_TOE_GUIDE = `# Крестики-нолики: как собрать игру

Начните с пресета из presetConfigs и меняйте только то, о чём просит человек.

## Правила (rules)
- board.width/height 3–15, board.blocked — дырки и препятствия [строка, столбец] с нуля.
  Идеи: дырка в центре, вырезанные углы, «крест» из препятствий, шахматный пол.
- players 2–4. Больше игроков — больше поле или короче линия, иначе почти всегда ничья.
- win.line 3–10. Ориентиры для двоих: 3×3 → 3; 5×5…7×7 → 4; 9×9 и больше → 5.
- win.directions — какие линии считаются. Только horizontal и vertical — «без диагоналей».
- win.mode: first-line (классика) или most-lines (до заполнения поля, считаем линии;
  одна сплошная линия длиннее line считается одной).
- win.misere — собрал линию = проиграл. Хорошо на маленьких полях.
- placement: gravity — «четыре в ряд»: игрок выбирает столбец, фигура падает.
  Клетки под препятствиями при гравитации недостижимы.
- turns.movesPerTurn 1–3, turns.firstTurnMoves — первый ход раунда. Схема Connect6
  (первый ход 1, дальше по 2) честнее, чем по 2 с самого начала.

## Серия и таймер
- series.rounds — сколько раундов; firstPlayer: rotate — первым ходит каждый по очереди.
- timer.turnSeconds 0 или 3–600; onTimeout random — за игрока ходит случайность.

## Визуал (visual)
- theme задаёт всё по умолчанию: classic, neon, candy, paper, party (смешная).
- palette — точечная замена цветов, board.style (grid, tiles, bubbles), board.radius,
  board.gap, board.texture.
- pieces[i] — фигура места i: { preset, color } из visualCatalog.pieces или { asset }.
  Фигуры разных мест должны различаться.
- board.background и board.cell — свои картинки поля и клетки ({ asset, opacity, fit }).
- animations.place/win/idle: { preset, durationMs, intensity } из visualCatalog.
  «Смешно» — wobble/bounce + confetti/shake + jiggle/float, intensity 1.3–2.

## Свои картинки
- asset_create_svg: квадратный viewBox (например 0 0 256 256), прозрачный фон, жирные
  контуры и яркие цвета — фигура будет маленькой. Никаких внешних ссылок и шрифтов.
- asset_import_url — по прямой ссылке на PNG/JPEG/WebP/GIF; asset_upload_begin — файл с диска.

## Проверка
- config_validate: ошибки исправить, предупреждения (severity warning) можно оставить.
- config_simulate: never-ends, always-draw, first-seat-dominates — повод поменять правила.
- config_preview: посмотрите картинку, прежде чем отдавать игру людям.`;

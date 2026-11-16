# Ход реализации — план: .ai/features/08-jinchi-playtest/plan.md

- 2026-11-16: продукт принят; автономность до PR/merge и живая приёмка подтверждены.
- Техническая разведка трёх областей завершена, файлы кода не менялись.
- Техника закоммичена: 9bb9971. План проверен по P01–P18/A01–A30.
- Pre-flight: согласованы интерфейсы engine/info/UI/generator, shared файлы
  модифицируются последовательно. Основной чекаут и ветка задачи, без worktree.
- Исполнение: независимые engine/info/UI области делегированы; root — generation,
  integration, общий QG. Один свежий обзор всей ветки после сборки, без дублирования
  ревью каждой маленькой правки. Все значимые новые поведения через RED→GREEN.

## Задачи

- [x] 1. Движок — 73 targeted tests, включая legacy timer.random replay
- [x] 2. Информация — 112 targeted tests, безопасные проекции четырёх игр
- [x] 3. Генерация — 21 тест; обычные карты 2…8, асимметричные кубики и 1000²/d100
- [x] 4. Интерфейс — 35 targeted tests; общий QG после интеграции зелёный
- [x] 5. Интеграция — compact MCP refs, HTTP, SDK hooks, WS упаковка (84 targeted tests)
- [x] 6. QG и приёмка — 562/60, build, tsc; 3WS+spectator, MCP, браузер, fresh review
- [ ] 7. Знания и merge

## Решения по ходу

- Аддитивный gameVersion1 выбран ради старых конфигов и журналов; новые defaults
  только в новых пресетах. Публичный layout seed не равен секретному seed партии.
- Большая экспедиция представлена параметрической сборкой генератора (кнопка сайта
  и рецепт MCP guide), чтобы capabilities не отдавал миллион строк на знакомстве.
  Четыре компактных новых пресета — фиксированные результаты generator v1, старые
  PRESETS сохраняют опубликованные правила и порядок для legacy fixtures.
- Геометрия N=3/5/7 учитывает клеточные пути: целочисленная коррекция расположения
  не ослабляет пороги проверки. Изолированные области соединяются проходами, стены
  перераспределяются с сохранением запрошенной плотности.
- Тесты запускаются последовательно: общий globalSetup пересоздаёт test.db,
  поэтому даже pure suites в разных Vitest процессах мешали серверным тестам.
- Цельные контракты engine/info/UI/generator/transport коммитятся вместе: они
  проверены общим QG и не оставляют промежуточных неопубликованных зависимостей.

## Проверки

- До реализации: Markdown ссылки (8/8), diff check — зелёные.
- RED генерации: модуль отсутствовал; затем 4 failures реальной геометрии/старта;
  исправлены lattice rounding и integer layout. Ordinary preset RED effects0 вместо6.
- RED MCP generation: неизвестный tool/HTTP404; после реализации config refs и
  endpoint целевые 42 теста (генератор/wire/MCP/guests) GREEN.
- Первый общий QG: npm test 58 files/538 tests PASS (36,24с) → build PASS → tsc PASS.
  Логи storage/verification/08-jinchi-playtest/prelive-{tests,build,types}.log.
- Dev запущен после проверки свободных портов; seed verify записал секреты только
  в storage/verify/accounts.json. Начинается живая приёмка.


## Живая приёмка и ревью

- UI создан круг R50/3, авторское вступление, 9 flags/9 effects. Mouse move + drag,
  12 размеров/режимов счёта, max editor paint/undo, общая информация всех4.
- MCP caps4 → generate/ref → validate/simulate/PNG → lobby; обычная и1000²/d100
  партии закончены, 241/16 действий, p95 17,8/102,7 мс. Exact journal/reconnect/reload.
- Stress захват499000 клеток + objects за120,1 мс; lossless snapshots проверены.
- Live исправления: portrait budget67→81%, ложный strong-effect warning.
  UI flags/effects получили обычные поля и вероятности вместо JSON.
- Fresh reviewer на981ccdb: R1 legacy form crash, R2 touching certified starts;
  оба reproduced RED→GREEN. R3 overflow при reroll/skip исправлен и измерен в browser fixture.
  Адресный GREEN62/5, повторное заключение reviewer: Ready.
- Финальный QG после всех code edits: **562 tests/60 files**,36,11с → build PASS → tsc PASS.
  Логи final-* в storage/verification/08-jinchi-playtest; [verify](verify.md), [review](review.md).
- Native fullscreen отвергнут IAB, fallback пригоден. Touch проверен синтетическими
  PointerEvent, мобильный viewport эмулирован; физический телефон не проверен.
- Ошибочно напечатанный root тестовый MCP-токен отозван, old401/newtools-list200
  подтверждены. Новый секрет только в storage; в Git секретов нет.
- Карточки SDK/games/server/mcp/web обновлены; следующий шаг commit/push/PR/merge.

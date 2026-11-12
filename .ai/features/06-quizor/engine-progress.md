# Движок Quizor — состояние реализации

2026-11-12, исполнитель engine, общий checkout ветки feat/06-quizor.

## Контракты

- `games/quizor/src/index.ts` экспортирует rules/judge/game/visual/presets.
- `resolveQuestion(rules, questionId)` → question, roundId, settings, provenance и поля с настройками.
- `probeQuestion(rules, questionId, Answers[])` → QuestionGrade[]; массив нужен для относительного судьи.
- Типы `QuizorView`, `QuizorAction`, `QuizorControl`, `PublicField` зафиксированы в game.ts.
- Управление присутствием: system presence {seat,online}, presenter-presence {online}.
- Resolver visual возвращает палитру и плоские алиасы для клиента.

## Уже проверено

Сначала написаны падающие тесты нового пакета. Наследование и судейство: 11 зелёных;
автомат: 6 зелёных (тайна, права, пауза, апелляция, черновики, передача).
Все 6 пресетов валидны и доигрываются по 2 симуляции (maxActions 5000).
Вместе с текущими тестами клиента пакет проходит 29 тестов.

## Передача на общий QG

Последняя волна закрыла раннюю готовность медиа (старый таймер preload больше не
закрывает показ), персональный темп, независимые best-votes по полям, default fail у
явно неверных вариантов, подтверждение алгоритма ведущим до раскрытия, fallback при
отключении optional-ведущего и большинство поданных голосов по таймауту судейства.
Синтаксис/типы проверены после правок. Коммиты делает root.

## Матрица P00–P42 (область движка)

| P | Реализация |
|---|---|
| 00 | Строгая v1, deep merge quiz/round/question/field, provenance, resolve/probe |
| 01 | Одно место — один игрок; команд нет по согласованному объёму |
| 02 | 1–16, настраиваемые min/max |
| 03 | Отдельные control/presenterView, роли host/presenter/system, default assisted с ведущим, notes, fallback optional |
| 04 | Индивидуальный player/spectator view; компактный/тихий режим — клиент root |
| 05 | Цепочка раундов и один раунд SDK |
| 06 | sequence/board, blitz (round timer + delayed reveal), eliminateOnError/survivors, winsToEnd |
| 07 | secret/buzz/chooser/turns, перехват buzz/secret и attempts |
| 08 | Окно кнопки, server reaction validation, фальстарт/lock, таймер после кнопки |
| 09 | after/first/block/presenter, blockValues, стоимость фиксируется при отправке |
| 10 | Закрытие/судейство/reveal/round-reveal, ready, presenter advance, отдельные timestamps раскрытия |
| 11 | Все пять таймеров, drafts autoSubmit, nextWakeAt/wake, pause/replay-compatible часы |
| 12 | Онлайн-места в allAnswered, hurry, host close |
| 13 | Темы/стоимости/свои цены/сгоревшие клетки, firstChooser/nextChooser |
| 14 | Отсев последнего, временное выбывание в раунде, eligibility final, skip пустого финала |
| 15 | none/elimination-wager/wager/survival/duel; групповой отсев тем, тайные ставки, поэтапное раскрытие, бонус/directWinner |
| 16 | Общий счёт, ближайший числовой тай-брейк, затем кнопка, общая победа после исчерпания запаса |
| 17 | Только SDK RNG, shuffle/take/options shared/individual/themes |
| 18 | Все шесть блоков; последовательные intro/show/reveal; персональный self pacing |
| 19 | Типизированные эффекты и media clip/speed/repeat/audioOnly; исполнение эффектов — клиент root |
| 20 | Ссылки только assetRef своего пула; файловая подсистема — соседний исполнитель |
| 21 | preload selected media + ready/deadline, server timestamps, personal media timestamps |
| 22 | Whitelist view/presentRules; ни будущих вопросов, ни критериев; paused curtain; открытые media в history |
| 23 | text/number/choice/multi/order/match/list/point/oral, безопасные PublicField |
| 24 | Несколько полей, sum/all/count, optional, editable |
| 25 | Нормализация, пять строгостей, OSA transpositions, keywords, wrong-first, doubtful, fuzzy collision warning |
| 26 | Числа/диапазоны, ordered steps exact/range/distance/nearest, percent/side/rank/and/or |
| 27 | Все структурные судьи: all/per-item/threshold, position/pairs, dedup list, point zones/nearest |
| 28 | algorithm/presenter/assisted/vote/best/self; mixed field judges и свои оценки; AI отклоняется |
| 29 | Апелляция, вопрос/место/очки, большинство проголосовавших кроме адресата, solo, 30с, лимит/повтор, журнал |
| 30 | Именованные grades, fraction/points/correct, custom identities, свои на поле |
| 31 | Отрицательные grades, default buzz penalty, bid signs, risk-free |
| 32 | speed linear/rank, streak multiplier/bonus, uniqueBonus, учёт прошлых неудачных попыток |
| 33 | allowNegative и четыре scoreVisibility, delayed score secrecy |
| 34 | Result, winners/losers, разбор/history с ответами и исправлениями |
| 35 | Скрытая summary presentRules и N из пула |
| 36 | checkRules/probe/resolve/guide; MCP/preview — соседи |
| 37 | Все шесть пресетов, два табло 5×5 в board, симуляции каждого |
| 38 | id quizor, title Quizor |
| 39 | Весь согласованный набор; AI/команды/«позже» исключены по продукту |
| 40 | Пауза, сохранение drafts, заморозка clocks/media timestamps, resume 3 секунды, голосование на паузе |
| 41 | Темы/palette/seats/animations/round.visual, safe player statuses; рендерер — root |
| 42 | Все адресаты, все шесть special, open/sealed auction, low-balance minimum, transfer recipient price |

## Закрытие известных сочетаний перед общим QG

2026-11-12, follow-up root: все три известных пункта закрыты через красные регрессии.

- Self pacing: hurry меняет личные дедлайны оставшихся; extend/stop работает только
  с незавершёнными ответами, не запускает часы уже ответившему. Пауза/3-секундное
  возобновление сдвигает личные часы; игрок видит свои, зритель/ведущий — ближайшие.
- recipient:turn и mode:turns получили отдельный recipientTurn, независимый от owner.
  Регрессии покрывают owner fastest и trailing с тремя местами.
- Принято автономное решение root: конечный запас без повторов. Race/survival после
  исчерпания заканчиваются по общим очкам. Дуэль — по числу верных с bonus/directWinner;
  равенство передаётся обычному итоговому счёту/тай-брейку. Добавлены предупреждения
  target_exceeds_pool для недостижимой цели K в раунде/дуэли. Решение записано в T08.

Полный QG npm test → build → tsc и живая проверка выполняются root после нового freeze.

Финальная локальная проверка этой волны: `npx vitest run games/quizor` — 75/75,
8 файлов, 5,37 с; `npx tsc --noEmit` — exit 0. Код повторно заморожен для root QG.

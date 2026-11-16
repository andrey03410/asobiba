# Движок Jinchi: реализация и проверка

Дата: 16 ноября 2026. Исполнитель: `jinchi_engine`. Ветка: `feat/08-jinchi-playtest`.
Коммитов исполнитель не создавал; файлы переданы root в общем checkout.

## Область

Изменены `games/jinchi/src/rules.ts`, `game.ts`, `game.test.ts`.
Созданы `placement.ts`, `capture.ts`, `objectives.test.ts`, `placement.test.ts`,
`capture.test.ts`. Подключены готовые `info.ts` и `balance.ts` других исполнителей.
`presets.ts`, `guide.ts`, `index.ts`, SDK, транспорт и UI не менялись.

Применены `superpowers:test-driven-development`, его `writing-good-tests.md`,
`superpowers:systematic-debugging` и `superpowers:verification-before-completion`.

## Что реализовано

- Аддитивная схема v1: карты 3…1000, `dice.sides` как число 2…100 либо пара,
  `diceSides`; старое числовое представление сохраняется. Новые секции по умолчанию
  не добавляют объекты в существующие партии. Setup разбирает и старые сохранённые
  правила, у которых новых секций ещё нет.
- Строгие координаты и лимиты объектов, коллизии/стены/базы, невозможные цели,
  несовместимая доля территории, непустой активный mystery-пул, предупреждение о
  сильных активных эффектах. Метаданные генерации по T04; заявленный баланс после
  проверки геометрии заново проверяет `analyzeMap`.
- `PlacementBoard` для генератора содержит только `width,height,cells,rules`.
  `placementCapacity(board,seat)` строит точный профиль размеров 1…100 за O(площадь):
  histogram допустимых клеток плюс SAT пустой границы, соседней со своей территорией.
  Профиль проверен независимым полным обходом якорей на 48 смешанных картах,
  `overlapOwn=false/true`, `side/corner`, с запретом поворота и без него.
- `findPlacements(state,seat,rotated?,limit=Infinity)`, `samplePlacement` с одним
  RNG-выбором и без массива всех ходов; кэш топологии по immutable `cells`.
  `hasLegalAction`/`sampleAction` подключены к новым SDK hooks. Случайная политика
  таймера не расходует запасной бросок за человека.
- `captureTerritory` — единая реализация окружения для движка/баланса. Заливка
  итеративная, labels + один typed queue + размеры компонент. Нет массивов всех
  клеток каждой компоненты и `Math.max(...hundredsOfThousandsOfComponents)`.
- Все три критерия победы, приоритет устранения остальных, флаговая цель/исчерпание,
  исключение выбывших, вторичный критерий/ничья. `scores` остаётся площадью,
  `points` содержит очки режима, `flagCounts` и `effectPoints` раздельны.
- Флаги/эффекты срабатывают однократно постановкой или окружением. Mystery выбирает
  результат только при активации из RNG партии, в порядке клеток y/x; будущих исходов
  в state/view нет. Очки суммируются, зарядов не больше трёх, lock не накапливается.
- `reroll`, `skip-impossible`, `rerollCharges`, `rerolled`, pending `rotationLocked[]`,
  активный `turnRotationLocked`. Невозможный исходный бросок с зарядом оставляет
  выбор человеку; невозможный переброс пропускается. Lock начинает действовать на
  следующем собственном ходу и истекает после постановки, пропуска или таймаута;
  новая помеха во время уже скованного хода сохраняется для следующего.
- View дополнительно даёт `canRotate`, `canReroll`, `canSkip`, `impossibleRoll`,
  оставшиеся `flags`/`effects`. `turnId` не меняется при roll/reroll.
- Legacy ускоритель сохраняет исторический порядок viable/blocked ordered pairs
  для числовых сторон; случайная пара выбирается тем же количеством RNG-вызовов.
  Счёт клеток после постановки обновляется по изменённым индексам.

## RED → GREEN

1. 17:14:06 — `npx vitest run games/jinchi/src/game.test.ts games/jinchi/src/objectives.test.ts`.
   **RED:** 21 новых FAIL, 34 PASS. Ожидаемые причины: схема отвергает tuple/d100,
   `flags`/`effects`/metadata; отсутствуют новые очки/объекты/действия. Legacy golden
   по историческому движку уже зелёный и зафиксировал ожидаемые RNG/события.
2. 17:16:01 — `npx vitest run games/jinchi/src/placement.test.ts games/jinchi/src/objectives.test.ts`.
   После схемы **RED:** 17 FAIL, 8 PASS. Поиск игнорировал limit, поворот при lock
   оставался разрешён, профиль отсутствовал; новые флаги/эффекты не обрабатывались.
3. 17:20:54 — `npx vitest run games/jinchi/src/game.test.ts games/jinchi/src/objectives.test.ts games/jinchi/src/placement.test.ts`.
   **GREEN:** 3 файла, 58 тестов. Новые правила, геометрия и движок работают вместе.
4. 17:24:14 — `npx vitest run games/jinchi/src/objectives.test.ts`.
   **RED:** 1 FAIL/29 PASS. На маленькой старой карте без спецклеток предупреждение
   учитывало неиспользуемый default mystery-пул. Причина найдена в сборе всех исходов
   вместо активных. Исправлено: пул включается в оценку силы только при наличии mystery.
5. 17:24:27 — targeted 3 файла: **GREEN**, 66 тестов. Добавлены реальные проверки
   ничьих/вторичного критерия, выбывшего лидера при 3 местах, совпадения целей,
   большого очкового бонуса без ранней доли, массового окружения эффектов,
   невозможного броска с зарядом и таймера/restore через настоящий `Match`.
6. 17:27:03 — `npx vitest run games/jinchi/src/game.test.ts games/jinchi/src/objectives.test.ts games/jinchi/src/placement.test.ts games/jinchi/src/capture.test.ts`.
   **RED:** 2 FAIL/70 PASS. Независимые parses делили вложенный объект default-пула
   (проверено сравнением ссылок), а forged balanced metadata не запускали анализ.
   Исправления: factory с копией каждого исхода; guard `analyzeMap` после валидной
   геометрии/объектов только для `generation.balanced=true`.
7. 17:27:16 — та же команда: **GREEN**, 4 файла/72 теста, 3,63 с, exit 0.
   В том числе 500 000 отдельных максимальных компонент без RangeError,
   захват 499 000 клеток, d100 на миллионной карте с 256+ неудачными бросками.

Legacy golden: карта `['1#2','.##','###']`, d20, skipRounds=0, seed=321:
`turn=874`, `cycle=438`, `dice=[1,1]`, `currentSeat=0`, `rng.state()=694862482`;
SHA-256 JSON событий `73d41a461fcf5fef4fa173ebd61d9033fb4890a1385069d29c4e934577ccae86`.
До и после изменений результат совпадает.

## Общие проверки

- 17:27:23 — **`npm test`: exit 1**, 54 файла, 517 тестов, 37,52 с.
  53 файла/516 тестов прошли. Единственный FAIL чужой области:
  `apps/server/src/auth/guests.int.test.ts:57`,
  `guest invitations > shows only invitation metadata before identification`:
  прежнее точное ожидание invitation не содержит новых `description` и `parameters`.
  Сообщено root и исполнителю info; файл не менялся исполнителем движка.
- `npx tsc --noEmit`: после исправления собственных fixture-типов единственная
  текущая ошибка — ещё не созданный root `games/jinchi/src/wire.ts`, импортируемый
  `wire.test.ts`. Ошибок новых engine-файлов в выводе нет. Это **не зелёный общий tsc**.
- `git diff --check` для изменённых tracked engine-файлов: exit 0.
- Из-за общего Vitest globalSetup/test.db запуски согласовывались с root.
  После освобождения info-слота engine получил эксклюзивное окно; при параллельных
  Vitest процессах server-проверки могут получать SQLITE_READONLY_DBMOVED.

## Измерения масштаба

Ручные изолированные Node-пробы, текущий Mac, Node v22.23.2; это **не браузерная**
и **не сетевая** приёмка. Поле 1000×1000, два d100, две угловые базы:

| Операция | Время |
|---|---:|
| Setup с автоматическим броском и проверкой возможности | 41,2 мс |
| Холодный профиль всех размеров 1…100 | 21,3 мс |
| Повторный профиль неизменённой топологии | <0,1 мс |
| Ограниченные подсказки (8 найденных, limit 128) | 24,4 мс |
| Подтверждённая обычная постановка с окружением/следующим броском | 42,8 мс |
| Отдельное окружение 499 000 клеток | 31,1 мс |
| Случайная постановка без массива всех ходов | 12,8 мс |

Heap после пробы setup/хода/отдельного большого окружения — около 76 МиБ.
Это единичные замеры, не p95 и не обещание скорости на физическом телефоне.

## Передача и границы

- Root должен дополнить `index.ts` экспортами `diceSides`, типов объектов,
  `placementCapacity`, `captureTerritory`, `createPlacementProbe` при необходимости.
- UI может читать pending помеху `rotationLocked[seat]`; текущий запрет всегда
  определяется `turnRotationLocked`/`canRotate`, а не pending-массивом.
- Прямое изменение элементов `cells` после вычисления геометрии не поддерживается:
  контракт SDK требует immutable state, кэш привязан к ссылке массива.
- Полный `legalActions` по контракту по-прежнему перечисляет все позиции. Большие
  запросы SDK должны пользоваться новыми hooks, а UI — ограниченным findPlacements.
- `lastMove.captured` сохраняет все индексы для совместимости; транспорту нужна
  обсуждённая упаковка диапазонов. Сам движок не объявляет сетевую/мобильную
  производительность проверенной.
- Финальный общий QG и живая приёмка A01–A30 остаются root после интеграции.
  Этот отчёт не разрешает merge при красной общей проверке.

## Дополнение: legacy manual + random timeout

После подключения SDK consumers исполнитель info обнаружил сдвиг RNG: прежний
`Match.handleTimeout` выбирал даже единственное действие `{type:'roll'}` через
`rng.pick`, расходуя один draw. `Jinchi.sampleAction` возвращал его сразу, поэтому
сохранённые партии с ручным броском и политикой таймера `random` расходились.

Причина подтверждена сравнением реальных `Match` с текущим hook и историческим
fallback (копия определения без `sampleAction`/`hasLegalAction`). Фиксированный
конфиг: стандартная карта 16×16, ordered starts, manual d6, random timer 1 с,
seed=321, `advance(3000)`. Исторически броски: **4:2 → 4:4 → 1:1**, клетки **13/20**;
до исправления: **3:4 → 6:5 → 4:4**, клетки **32/34**.

Добавлен regression через настоящий `Match.start` и `Match.restore` исторической
записи `{seed:321,startedAt:0,seats:2,log:[]}`: проверяются буквальные пары, счёт,
SHA-256 итоговой геометрии `d31fd668bde75ac6e15c01971fbd5247889f4dee5d295f0a98291d370b6b7296`
и совпадение восстановленной партии. Исторические таймауты выводятся из времени,
поэтому пустой action log в этом сценарии ожидаем.

- 17:41:31 — `npx vitest run games/jinchi/src/objectives.test.ts`:
  **RED**, 1 FAIL/33 PASS; буквальные пары отличаются указанным образом.
- Минимальное изменение `game.ts`: только в `sampleAction` при отсутствии кубиков
  вызван `ctx.rng.next()` перед возвратом `roll`. Обычный ручной dispatch, проверки
  существования хода и выбор постановки дополнительных draw не получили.
  Root-изменение `JINCHI_PRESETS` сохранено.
- 17:41:49 — `npx vitest run games/jinchi/src/game.test.ts games/jinchi/src/objectives.test.ts games/jinchi/src/placement.test.ts games/jinchi/src/capture.test.ts`:
  **GREEN**, 4 файла/**73 теста**, 3,40 с, exit 0.
- 17:42:12 — общий **`npm test`: exit 1**, 58 файлов/538 тестов, 35,33 с:
  56 файлов/534 теста PASS, 2 файла/4 теста FAIL в незавершённых областях root.
  `apps/server/src/mcp/jinchi-generation.int.test.ts`:
  `uses a compact saved reference from generation through PNG and a strict lobby`
  и `rechecks saved reference ownership for every validation and rejects ambiguous input`
  получили `generated.isError=true`,
  `serves the same generator to the authenticated site without saving unsolicited library entries`
  получил HTTP 404 вместо 200.
  `games/jinchi/src/wire.test.ts:66`,
  `rejects malformed ranges, map dimensions and oversized payloads` — декодер не
  выбросил ожидаемую ошибку. Root уведомлён; эти файлы не менялись исполнителем.
  Предыдущая ошибка guest invitation в этом прогоне отсутствует.

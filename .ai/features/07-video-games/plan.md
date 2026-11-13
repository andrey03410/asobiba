# План

**Цель:** видео-игры на движке douga по [tech.md](tech.md): импорт интерактивного снимка,
компиляция сцен на сервере, доставка кусков плана с проверкой доступа, `VideoStage`
и Quizor с блоком `scene` и судьёй `poll`.

**Подход:** сначала спайк подключения пакетов douga (React 19, один экземпляр React и Remotion,
build и tsc). Потом сервер (модели, импорт, рантайм, маршруты), SDK-контракт, Quizor, клиент,
MCP и сайт. Сквозная проверка вместе с douga 34.

## Задачи

- [ ] **1. Спайк и подключение douga.**
  - `file:` зависимости на `../douga/packages/*`, `remotion` и `@remotion/player` в версии douga,
    `vite.config.ts` (`dedupe`, `fs.allow`), проверка версий.
  - Тесты: `remotion-version.test.ts`. Готово, когда `StudioVideo` играет план на странице asobiba,
    в сборке один React, `build` и `tsc` зелёные, замер компиляции записан.
- [ ] **2. SDK: видео-контракт.**
  - `packages/sdk/src/video.ts`: `VideoDirective`, `videoKey`, `GameVideoSupport`;
    `GameDefinition.video?`, `describeGame`, хук `checkVideo`.
  - Тесты: ключ стабилен, раздел `video` в возможностях.
- [ ] **3. Сервер: снимки.**
  - Prisma `VideoSnapshot`, `VideoFile`, `VideoSnapshotFile` и миграция.
    `apps/server/src/video/service.ts`: импорт, список, удаление, квоты, `video_in_use`. `DOUGA_URL`.
  - Тесты: импорт по фикстуре (fetch на локальный сервер), битый хэш, версия, идемпотентность,
    квота, удаление с ссылками.
- [ ] **4. Сервер: рантайм и доступ.**
  - `video/runtime.ts` (`applyMatchData`, `compileVideo`, `slicePlan`, LRU),
    маршруты `/api/lobbies/:id/video/:key` и `/files/video/:hash`, окно последних ключей.
  - Тесты: чужой ключ, будущая сцена, предзагрузка, presenter, Range.
- [ ] **5. Quizor.**
  - `rules.video`, блок `scene`, `item.card`, `input`, судья `poll`, итоги в раскрытии,
    `directives`, нормализация длительности, проверки `video_*`, превью кадром.
  - Тесты: правила, судья, вид без утечек, симуляция пресета с видео.
- [ ] **6. Клиент.**
  - `packages/video` (`@asobiba/video/client`): `VideoStage`. Доска Quizor рисует блок `scene`
    и связывает клик с вариантом.
  - Тесты: разметка блока, выбор по карточке.
- [ ] **7. MCP и сайт.**
  - `video_snapshot_import/list/get/delete`, инструкция. HTTP-маршруты и раздел пула
    «Ролики douga», значок «видео».
  - Тесты: инструменты через драйвер.
- [ ] **8. Окружение и хостинг.** `.env.example`, `scripts/deploy.sh`, раздел README.
- [ ] **9. Проверка.**
  - QG по `verify`. Живьём: импорт настоящего снимка из douga, две вкладки, синхронность,
    клик по карточке, топ по голосам, сеть без утечек, партия при выключенной douga.
  - Ревью и `verify.md`.
- [ ] **10. Знания.** Карточки `sdk`, `games`, `server`, `assets`, `mcp`, `web`, `dev-env`,
  новая `video.md`, `AGENTS.md`, `vision.md`.

## Живые проверки

- Сайт в браузере: две вкладки на одном лобби (localhost и 127.0.0.1), скриншоты момента и топа.
- MCP-драйвер: импорт снимка, проверка конфига, превью сцены картинкой.
- Сеть: кусок раскрытия и его файлы недоступны до закрытия ответа.

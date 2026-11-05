# Окружение разработки

Как поднять Asobiba, где лежат база и файлы и чем проверять изменения. Это монорепо
на npm workspaces. Пакеты отдают исходники TypeScript, сборки пакетов нет: сервер
запускается через `tsx`, сайт собирает Vite, тесты гоняет Vitest.

## Где код

- [`package.json`](../../package.json) — workspaces `packages/*`, `games/*`, `apps/*` и скрипты:
  - `dev` — `concurrently` запускает `dev:server` (миграции, затем `tsx watch apps/server/src/main.ts`, :8787) и `dev:web` (Vite, :5173);
  - `build` — сборка сайта в `apps/web/dist`; `start` — миграции и сервер в режиме production на :8787 вместе с сайтом;
  - `test` (`vitest run`), `typecheck`, `db:migrate`, `db:deploy`, `db:generate`, `invite`;
  - `postinstall` генерирует Prisma-клиент.
- [`scripts/prisma.mjs`](../../scripts/prisma.mjs) — обёртка Prisma CLI. Подставляет `--schema apps/server/prisma/schema.prisma` и абсолютный `DATABASE_URL` по умолчанию (`storage/asobiba.db`), читает `.env`.
- [`apps/server/prisma/`](../../apps/server/prisma/) — схема и миграции.
- [`apps/server/src/env.ts`](../../apps/server/src/env.ts) — переменные окружения и умолчания.
- [`tsconfig.json`](../../tsconfig.json) — один проект на все пакеты (`moduleResolution: Bundler`, `verbatimModuleSyntax`).
- [`vitest.config.ts`](../../vitest.config.ts) и [`scripts/test-setup.ts`](../../scripts/test-setup.ts) — тестовая база и файлы.
- [`scripts/`](../../scripts/) — `invite.ts`, `seed-verify.ts`, `verify-mcp.mjs`, `verify-game.mjs`.
- [`.claude/launch.json`](../../.claude/launch.json) — `asobiba-dev` (весь `npm run dev`, порт 5173) и `asobiba-server` (только сервер, 8787).

## Переменные `.env`

Шаблон — [`.env.example`](../../.env.example). Сам `.env` в `.gitignore`.

- `PORT` (8787), `HOST` (127.0.0.1).
- `PUBLIC_URL` — публичный адрес сайта: из него строятся ссылки на лобби, приглашения, загрузку картинок и адрес MCP. В разработке это Vite `http://localhost:5173`, в продакшене — адрес сервера.
- `DATABASE_URL` — по умолчанию абсолютный путь к `storage/asobiba.db`. `ASOBIBA_STORAGE_DIR` — по умолчанию `storage/`.
- `COOKIE_SECURE=1` — куки только по HTTPS (на сервере за Caddy).
- `ASSET_URL_ALLOW_PRIVATE=1` — разрешить импорт картинок с приватных адресов. Только для тестов.
- `ASOBIBA_MCP_TOKEN` — личный токен для [`.mcp.json`](../../.mcp.json).

## Данные

- SQLite `storage/asobiba.db`. Модели — в [schema](../../apps/server/prisma/schema.prisma), описаны в [server.md](server.md).
- `storage/` в `.gitignore`:
  - `assets/<userId>/<assetId>.<ext>` — картинки пула;
  - `test/` — база и файлы тестов, пересоздаются перед каждым `npm test`;
  - `verify/accounts.json` — проверочные аккаунты и токен (`seed-verify.ts`);
  - `verification/<задача>/` — доказательства живых проверок.

## Как устроено

- Первый запуск: `npm install`, `cp .env.example .env`, `npm run invite` (первое приглашение на пустой базе всегда админское), `npm run dev`, открыть ссылку приглашения.
- Схема: правка `schema.prisma` → `npm run db:migrate -- --name <что>` → перезапуск `npm run dev`. `dev:server` и `start` сами применяют миграции (`migrate deploy`).
- Тесты: файлы `**/*.test.ts(x)` во всех пакетах, среда node, файлы идут последовательно. Интеграционные тесты сервера — `apps/server/src/**/*.int.test.ts`: поднимают настоящий Fastify (часто на случайном порту) с тестовой базой `storage/test/test.db`, которую `test-setup.ts` пересоздаёт миграциями перед прогоном. Базу разработки тесты не трогают, поэтому их можно гонять при работающем `npm run dev`.
- Обязательная тройка после последних правок, в этом порядке: `npm test` → `npm run build` → `npx tsc --noEmit`.

## Грабли

- Порт 3000 занят Douga. Asobiba живёт на 8787 и 5173. Перед `npm run dev` проверь оба: `lsof -nP -iTCP:8787 -sTCP:LISTEN; lsof -nP -iTCP:5173 -sTCP:LISTEN`. У Vite `strictPort`, второй экземпляр не уедет на другой порт.
- Если сессия Claude запущена из папки Douga, `preview_start` берёт `.claude/launch.json` Douga и поднимает её dev-сервер. Сервер Asobiba тогда запускай фоновой командой (`npm run dev:server` с логом в `storage/verification/…`), а в браузере открывай адрес через `preview_start {url}`.
- `Match.seed` — знаковый `INT` в SQLite: зерно партии берётся 31-битным (`randomSeed`). Беззнаковое 32-битное ломало старт партии примерно в половине случаев.
- Prisma CLI тянет `deepmerge-ts` с предупреждением `npm audit` (high). Это только CLI-конфиг, в рантайм сервера не попадает. Обновление — переход на Prisma 7.
- `npm run dev` пишет логи сервера в JSON (pino). Для чтения удобно `| grep -v '"incoming request"'`.

## Как проверить

- `npm test` → `npm run build` → `npx tsc --noEmit`.
- Живой сервер: `npx tsx --env-file-if-exists=.env scripts/seed-verify.ts`, затем `node scripts/verify-mcp.mjs --out storage/verification/<run>` и `node scripts/verify-game.mjs`.
- Сайт: `npm run dev`, браузер на `http://localhost:5173`, вход под `verify-a`/`verify-b` из `storage/verify/accounts.json`.

## История

- [задача 01](../features/01-rebuild/README.md) — пересборка на TypeScript, монорепо, SQLite и миграции

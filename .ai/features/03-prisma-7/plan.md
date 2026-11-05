# План

## Задачи

- [x] **1. Пакеты, генератор, конфиг.** Файлы: `apps/server/package.json` (точные 7.10.1 и адаптер),
  `schema.prisma` (`prisma-client`, `output`, без `url`), `prisma.config.ts`, `scripts/prisma.mjs`,
  `.gitignore`. Готово, когда: `npm install` генерирует клиент в `apps/server/src/generated/prisma`.
- [x] **2. Клиент и импорты.** Файлы: `apps/server/src/db.ts`, новый `apps/server/src/sqlite.ts`,
  импорты в `auth`, `assets`, `configs`, `lobbies`. Тесты: `db.int.test.ts` — формат дат
  (целые миллисекунды) и запрос вне транзакции не попадает в чужую транзакцию (сначала красный).
- [x] **3. Совместимость с живой базой.** Копия `storage/asobiba.db`: `migrate status`, чтение,
  новые записи пишутся числами, сессии остаются живыми.
- [x] **4. Знания.** Карточки `dev-env.md`, `server.md`, строка стека в `AGENTS.md`.

## Живые проверки

- Тройка `npm test` → `npm run build` → `npx tsc --noEmit`.
- `npm start` на свободном порту с копией базы: партия по WebSocket (`scripts/verify-game.mjs`)
  и сценарий агента (`scripts/verify-mcp.mjs`).
- `npm audit --omit=dev`.
- После вливания — перезапуск dev-сервера владельца и вход в браузере под существующей сессией.

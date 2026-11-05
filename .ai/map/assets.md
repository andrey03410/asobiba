# Картинки

Личный пул картинок пользователя: свои фигуры, фон поля и клетки. В конфиг картинка
попадает только через слот игры как `{ asset: "ast_…" }`. Агент рисует SVG (сервер
переводит его в PNG), даёт ссылку или загружает файл по одноразовой ссылке.

## Где код

- [`apps/server/src/assets/images.ts`](../../apps/server/src/assets/images.ts) — `inspectImage` (сигнатура, размер, стороны), `rasterizeSvg`, `renderTrustedSvg` для превью.
- [`fetch.ts`](../../apps/server/src/assets/fetch.ts) — `fetchPublicUrl` и `isPrivateAddress`.
- [`service.ts`](../../apps/server/src/assets/service.ts) — `AssetService`: `save`, `createFromSvg`, `importUrl`, `beginUpload`/`finishUpload`, `list`, `remove`, `file`, `dataUris`, `ownershipIssues`.

## Данные

- `Asset` (`id` = `ast_` + 12 символов, `ownerId`, `name`, `mime`, размеры, `bytes`, `path` относительно `storage/`, `source` `upload`/`svg`/`url`).
- `UploadTicket` (id = sha256 билета `upl_…`, 10 минут, одноразовый).
- Файлы — `storage/assets/<userId>/<assetId>.<ext>`.

## Как устроено

- Принимаются PNG, JPEG, GIF, WebP по сигнатуре (а не по Content-Type), до 2 МБ и 2048 px по стороне. До 300 картинок на пользователя.
- SVG: до 200 000 символов, без `DOCTYPE`/`ENTITY`, ссылки (`href`, `xlink:href`) — только `#id` и `data:image/(png|jpeg|gif|webp);base64`, `url()` — только `#id`, без `@import`. Растеризация resvg шириной 512 px, без системных шрифтов: текст в SVG не рисуется. В браузеры уходит только PNG.
- Импорт по ссылке: только http(s) без логина в URL. IP-литерал проверяется сразу, имя — в собственном `lookup` при соединении (DNS rebinding не проходит). Редиректы — вручную, до трёх, каждый проверяется. Тайм-аут 10 с, лимит размера на заголовке и на потоке. Приватные сети (`BlockList`: 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10, IPv6 ULA и link-local, mapped IPv4…) запрещены без `ASSET_URL_ALLOW_PRIVATE=1`.
- Загрузка агентом: `asset_upload_begin` → `PUT /api/uploads/<ticket>` телом файла (`curl --upload-file`), ответ — `{ asset }`. Сайт грузит `POST /api/assets?name=` телом файла.
- Отдача `GET /files/assets/:id` — любому вошедшему пользователю: игроки лобби видят картинки чужого конфига. Заголовки `nosniff` и приватный кэш.
- В конфиг можно положить только свою картинку: `ConfigService.validate` добавляет `asset_not_found` для чужих и несуществующих id.

## Грабли

- Удаление картинки не правит лобби, где она уже в замороженном конфиге: там появится пустое место.
- Синхронное исключение `rasterizeSvg` должно превращаться в отклонённый промис — поэтому `createFromSvg` объявлен `async`.

## Как проверить

- `npx vitest run apps/server/src/assets` — загрузка и отдача, не-картинки, SVG → PNG 512 и отказы, импорт с редиректом, приватные адреса, одноразовый билет.
- Вживую: `scripts/verify-mcp.mjs` создаёт SVG-фигуру и кладёт её в превью.

## История

- [задача 01](../features/01-rebuild/README.md) — пул картинок

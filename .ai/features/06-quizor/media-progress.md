# Медиа — задача 2

Реализация в общем чекауте, без отдельных коммитов. Общий QG и вливание ведёт root.

## Сделано

- Контейнеры WAV PCM/IEEE float (включая extensible с полным SubFormat GUID), MP3 Layer III,
  OGG Opus/Vorbis, M4A/MP4 с проверкой дорожек, WebM VP8/VP9/AV1/Opus/Vorbis.
  Тип определяется по данным, а не заголовку запроса. Перекодирования нет.
- Картинки и SVG сохраняют прежние лимиты и сценарии. Размеры звука/видео в Asset — 0×0;
  миграция не потребовалась. Превью пропускает медиа до чтения с диска.
- Потоковые HTTP upload и URL import пишут `.part` с backpressure. Фактические байты
  ограничены 1 ГиБ. Обрыв/лимит/ошибка контейнера/ошибка БД убирают частичный файл.
  Файл переименовывается после проверки. Билет расходуется перед чтением и после обрыва
  не используется повторно.
- До 300 файлов и 10 ГиБ на пользователя; проверка квоты и запись сериализованы по ownerId.
  `ownershipIssues` ограничивает уникальные ссылки конфига 1 ГиБ, включая картинки.
- Raw parsers находятся только в области двух upload routes. Глобальный JSON лимит —
  2 МиБ; проверка тела 3 МиБ получает 413.
- GET поддерживает одиночные закрытые, открытые и суффиксные Range: 206 с точными
  Content-Range/Length, 416 с `bytes */N` для неверных, множественных и недоступных.
  HEAD возвращает длину полного файла без открытия потока и игнорирует Range.
- Файловый route проверяет owner или `LobbyService.canReadAsset`. По решению root
  посторонний аккаунт тоже получает 403; старый тест обновлён на владельца и посетителя
  лобби. Гостевой прежний сценарий проходит. canReadAsset реализовал server_integration.
- Аккаунт показывает audio/video с native controls и preload=metadata, принимает новые
  расширения и объясняет лимиты/ограничения кодеков. Root меняет название вкладки на «Файлы».
- Импорт сохраняет DNS/IP/redirect SSRF-защиту. Idle timeout — 10 с, общий срок большого
  скачивания увеличен до 10 минут: прежние 20 с мешали бы файлам порядка 1 ГиБ.

## Сигнатуры интеграции

```ts
type AssetBody = Buffer | AsyncIterable<Uint8Array>;
save(ownerId: string, input: { name?: string; body: AssetBody; source: AssetDto["source"] }): Promise<AssetDto>;
finishUpload(ticket: string, body: AssetBody): Promise<AssetDto>;
file(id: string): Promise<{ path: string; mime: string; ownerId: string; bytes: number } | null>;
ownershipIssues(ownerId: string, refs: readonly { path: string; assetId: string }[]): Promise<ConfigIssue[]>;
```

`createFromSvg`, `importUrl`, `beginUpload`, `list`, `remove` сохранили сигнатуры.
`MEDIA_FORMATS` экспортирует extension/mime/codecHint для MCP. `fetchPublicUrlStream`
возвращает Readable, contentType и finalUrl; прежний `fetchPublicUrl` оставлен совместимым
буферным помощником. Root расширил collectAssetRefs на rules + visual, поэтому текущий
ConfigService автоматически вызывает проверку владения/квоты по медиа Quizor.

## TDD и проверки

1. Первый RED: `npx vitest run apps/server/src/assets/media.int.test.ts` — 11 ожидаемых
   падений из 13: все шесть форматов отвергались, потоки не принимались, Range/квот не было.
2. Первый прогон после реализации — 30/32: обнаружены автоматический HEAD Fastify,
   обнуляющий Content-Length, и изменённый контракт доступа аккаунта. HEAD зарегистрирован
   явно, тест доступа согласован с решением root.
3. Отдельный RED для разбора метаданных — 3/22: усечённый второй MP3 кадр, неполный GUID
   WAV extensible и QuickTime, ошибочно принятый за MP4. Исправлены, затем 22/22 GREEN.
4. RED для пустого HTTP-тела и HEAD+Range — 2/56. Исправлены в route, затем 56/56 GREEN.
5. Итог: `npx vitest run apps/server/src/assets apps/server/src/auth/guests.int.test.ts`
   — **57/57, 4 файла**, 8.14 с. В том числе настоящий HTTP-сокет: chunked WAV upload,
   GET Range и HEAD; HTTP-источник с редиректом, chunked import, превышением объявленного
   размера и обрывом; фактический поток 1 ГиБ + 1 МиБ с удалением файла; SVG/PNG и гости.
6. Промежуточный `npx tsc --noEmit --pretty false` выявил недостижимую HEAD-ветку в моём
   route (удалена), а также ошибки в ещё разрабатываемых client/game. Финальные test →
   build → tsc и браузерная проверка аккаунта остаются в общем QG root.

Pure inspector tests запускались также без globalSetup через временный конфиг
`storage/verification/06-quizor/media-vitest.config.ts`, чтобы не удалять общую тестовую БД
во время работы соседнего агента. Команда: `npx vitest run --config <этот путь>`.

Структура контейнеров сверена с первичными описаниями:
[Ogg framing](https://www.xiph.org/ogg/doc/framing.html),
[WebM Container Guidelines](https://www.webmproject.org/docs/container/),
[WAVEFORMATEXTENSIBLE](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ksmedia/ns-ksmedia-waveformatextensible).
Контейнерная проверка не обещает декодируемость всего потока конкретным браузером.

## Файлы

- `apps/server/src/assets/{media.ts,media.test.ts,media-fixtures.ts,media.int.test.ts}` — новые.
- `apps/server/src/assets/{service.ts,fetch.ts,assets.int.test.ts}`.
- `apps/server/src/app.ts` — лимит JSON и удаление глобальных raw parsers.
- `apps/server/src/routes.ts` — только asset imports/upload/file hunks; lobby/WS hunks соседнего агента.
- `apps/web/src/pages/account/AssetsTab.tsx`.
- `.ai/map/assets.md` и этот отчёт.

Полный npm test отдельно не запускался: тестовая БД общая, итоговый QG собирает root после
завершения всех частей. Изображения для живого playback и браузерная проверка аккаунта
остаются за общим QG; синтетические unit fixtures проверяют структуру контейнера, не кодеки.

## Дополнение: серверная проверка назначения медиа

По поручению root добавлены `apps/server/src/configs/service.ts` и новый
`apps/server/src/configs/quizor.int.test.ts`.

- До схемы проверяется полный сериализованный input, включая title и посторонние поля:
  максимум 2 МиБ UTF-8. После нормализации проверка повторяется. Ошибка — `config_limit`
  с пустым путём корня. Несериализуемое прямое значение — `invalid_json`.
- Только для Quizor сверяются MIME слотов: блоки audio/video/image, рекурсивные группы,
  reveal/intro/final/tiebreak, point и фон; варианты options/items/left/right по умолчанию
  image, при media:audio — audio. Несовпадение — `asset_mime`, путь заканчивается `.asset`.
  Сверяются только свои файлы; чужой/несуществующий остаётся `asset_not_found` без утечки MIME.
- RED: 6 ожидаемых падений из 8. При неверных файлах валидация прежде отвечала ok:true;
  большое title прежде давало только ошибку длины строки вместо общего лимита документа.
- GREEN: новая suite 8/8, совместный прогон
  `npx vitest run apps/server/src/configs/quizor.int.test.ts apps/server/src/assets apps/server/src/auth/guests.int.test.ts`
  — **65/65, 5 файлов**, 7.48 с. Повторный asset 900 МиБ не удваивает квоту; добавление
  другого файла 200 МиБ вызывает media_quota. Существующая схема игры также проверяется
  реальным Quizor, не тестовым дублем.

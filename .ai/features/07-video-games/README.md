---
id: 07
title: Видео-игры на движке douga
track: product
stage: product
branch: feat/07-video-games
pr:
started: 2026-11-13
merged:
---

# 07. Видео-игры на движке douga

Новый пласт игр asobiba: картинку в кадре рисует douga, а правила, ввод и партия остаются
в asobiba. Ролик собирается в douga и переходит в asobiba интерактивным снимком. Сервер asobiba
компилирует сцены пакетами douga с данными партии, клиент играет их плеером douga.
Первый потребитель — Quizor: видео-квизы, выбор любимца и общий топ.

Парная задача в douga — `douga/.ai/features/34-interactive-video/` (ветка `feat/34-interactive-video`):
пакеты, интерактивный слой документа и снимок.

> **Автономный режим стадий `product` и `tech`** (дословно — в [brief.md](brief.md#разрешение-автономности)).
> План, реализация и вливание этим разрешением не покрыты.

## Стадии

- [x] Бриф — [brief.md](brief.md)
- [ ] Продукт — [product.md](product.md)
- [ ] Техника — [tech.md](tech.md)
- [ ] План — [plan.md](plan.md)
- [ ] Реализация и QG — [verify.md](verify.md)
- [ ] Проверка владельцем
- [ ] Влито

## Хвосты

- нет

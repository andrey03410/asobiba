/**
 * Shared building blocks for game config schemas. Games compose their `rules`
 * and `visual` schemas from these, so agents meet the same details everywhere.
 */
import { z } from "zod";

z.config(z.locales.ru());

export const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const ASSET_ID = /^ast_[A-Za-z0-9]{8,40}$/;

export function color(description = "Цвет") {
  return z
    .string()
    .regex(HEX_COLOR, { error: "Цвет записывается как #rgb, #rrggbb или #rrggbbaa" })
    .meta({ description: `${description}: #rgb, #rrggbb или #rrggbbaa` });
}

export function assetRef() {
  return z
    .string()
    .regex(ASSET_ID, { error: "Нужен id картинки из пула вида ast_…" })
    .meta({ description: "id картинки из личного пула (ast_…): asset_list, asset_create_svg, asset_import_url, asset_upload_begin" });
}

/**
 * Optional animation override. Unset fields fall back to the theme defaults,
 * so a config can say just `{ preset: "bounce" }`.
 */
export function animation<const P extends readonly [string, ...string[]]>(presets: P, description: string) {
  return z
    .strictObject({
      preset: z.enum(presets).optional().meta({ description: "Пресет анимации" }),
      durationMs: z.int().min(50).max(5000).optional().meta({ description: "Длительность, мс (50–5000)" }),
      intensity: z.number().min(0).max(3).optional().meta({ description: "Сила: 0 — едва заметно, 1 — обычно, 3 — очень сильно" }),
    })
    .optional()
    .meta({ description });
}

export const FIRST_PLAYER_POLICIES = ["rotate", "loser", "winner", "same"] as const;

/** Series of rounds — the same for every game. */
export const seriesSchema = z
  .strictObject({
    rounds: z.int().min(1).max(15).default(1).meta({ description: "Сколько раундов в серии (1–15). Побеждает тот, кто выиграл больше раундов" }),
    firstPlayer: z
      .enum(FIRST_PLAYER_POLICIES)
      .default("rotate")
      .meta({ description: "Кто начинает следующий раунд: rotate — по кругу, loser — проигравший, winner — победитель, same — всегда первое место" }),
    stopWhenDecided: z.boolean().default(true).meta({ description: "Закончить серию досрочно, когда лидера уже не догнать" }),
  })
  .prefault({})
  .meta({ description: "Серия раундов. Общая для всех игр" });

export const TIMEOUT_POLICIES = ["skip", "random", "lose"] as const;

/** Turn timer — the same for every turn-based game. */
export const timerSchema = z
  .strictObject({
    turnSeconds: z
      .int()
      .min(0)
      .max(600)
      .default(0)
      .refine((v) => v === 0 || v >= 3, { error: "Таймер хода — минимум 3 секунды, либо 0 без таймера" })
      .meta({ description: "Секунд на ход. 0 — без таймера, иначе 3–600" }),
    onTimeout: z
      .enum(TIMEOUT_POLICIES)
      .default("random")
      .meta({ description: "Что делать по таймауту: skip — пропустить ход, random — сделать случайный ход, lose — поражение в раунде" }),
  })
  .prefault({})
  .meta({ description: "Таймер хода. Только для пошаговых игр" });

export type SeriesSettings = z.output<typeof seriesSchema>;
export type TimerSettings = z.output<typeof timerSchema>;

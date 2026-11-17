import { assetRef, color } from "@asobiba/sdk";
import { z } from "zod";

const id = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
export const attributeSchema = z.strictObject({
  id,
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).optional(),
});
export const cardSchema = z.strictObject({
  id,
  name: z.string().trim().min(1).max(160),
  anime: z.string().trim().min(1).max(240),
  version: z.string().trim().min(1).max(160).optional(),
  image: z.strictObject({ asset: assetRef() }).optional(),
  shikimoriId: z.int().positive().optional(),
  values: z.record(id, z.int()),
});
export type YomifudaCard = z.output<typeof cardSchema>;
export type YomifudaAttribute = z.output<typeof attributeSchema>;

export const rulesSchema = z.strictObject({
  players: z.int().min(2).max(6).default(3),
  handSize: z.int().min(1).max(20).default(5),
  deckSize: z.int().min(2).max(600).optional().meta({ description: "Размер колоды, равен cards.length; при отсутствии вычисляется" }),
  attributes: z.array(attributeSchema).min(1).max(32),
  cards: z.array(cardSchema).min(2).max(600),
  scale: z.strictObject({ min: z.int().default(0), max: z.int().default(100) }).prefault({}),
  revealSeconds: z.number().min(0).max(120).default(10),
  choiceSeconds: z.int().min(0).max(3600).default(0).meta({ description: "Напоминание, не вызывает автоматический ход" }),
  winPoints: z.number().min(0).max(100).default(1),
  tiePoints: z.number().min(0).max(100).default(0.5),
  attributeMode: z.enum(["no-repeat", "independent", "bag"]).default("no-repeat"),
  pool: z.strictObject({
    profiles: z.array(z.string().trim().min(1).max(80)).min(1).max(30).default(["andrey03410", "dimma0148", "kostyankomaranime"]),
    minViewers: z.int().min(1).max(30).default(2),
  }).prefault({}).meta({ description: "Метаданные подготовки, без запросов к профилям во время партии" }),
}).superRefine((r, ctx) => {
  const fail = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  if (r.deckSize !== undefined && r.deckSize !== r.cards.length) fail(["deckSize"], "Размер колоды должен совпадать с числом карт");
  if (r.cards.length % r.players !== 0) fail(["cards"], "Число карт должно быть кратно числу игроков");
  if (r.handSize > r.cards.length / r.players) fail(["handSize"], "В колоде недостаточно карт для равных рук");
  if (r.scale.min >= r.scale.max) fail(["scale"], "Максимум шкалы должен быть больше минимума");
  const safeScaleBound = Math.floor(Number.MAX_SAFE_INTEGER / r.attributes.length);
  if (Math.max(Math.abs(r.scale.min), Math.abs(r.scale.max)) > safeScaleBound) {
    fail(["scale"], `Для точного сравнения сумм при ${r.attributes.length} характеристиках границы шкалы по модулю не должны превышать ${safeScaleBound}`);
  }
  if (r.pool.minViewers > r.pool.profiles.length) fail(["pool", "minViewers"], "Порог просмотра превышает число профилей");
  if (new Set(r.pool.profiles.map((p) => p.toLowerCase())).size !== r.pool.profiles.length) fail(["pool", "profiles"], "Профили не должны повторяться");
  const attributes = new Set(r.attributes.map((a) => a.id));
  if (attributes.size !== r.attributes.length) fail(["attributes"], "Идентификаторы характеристик не должны повторяться");
  const ids = new Set<string>(), characters = new Set<string>(), shikimoriIds = new Set<number>();
  r.cards.forEach((card, i) => {
    if (ids.has(card.id)) fail(["cards", i, "id"], "Идентификаторы карт не должны повторяться");
    ids.add(card.id);
    const character = `${card.anime.toLowerCase()}\u0000${card.name.toLowerCase()}`;
    if (characters.has(character)) fail(["cards", i, "name"], "Один персонаж — одна карта, без повторов форм и версий");
    characters.add(character);
    if (card.shikimoriId !== undefined) {
      if (shikimoriIds.has(card.shikimoriId)) fail(["cards", i, "shikimoriId"], "Персонаж Shikimori уже есть в колоде");
      shikimoriIds.add(card.shikimoriId);
    }
    for (const attr of attributes) if (!Object.hasOwn(card.values, attr)) fail(["cards", i, "values", attr], "Для каждой характеристики нужна оценка");
    for (const [key, value] of Object.entries(card.values)) {
      if (!attributes.has(key)) fail(["cards", i, "values", key], "Неизвестная характеристика");
      if (value < r.scale.min || value > r.scale.max) fail(["cards", i, "values", key], "Оценка за пределами шкалы");
    }
  });
}).transform((rules) => ({ ...rules, deckSize: rules.deckSize ?? rules.cards.length }));
export type YomifudaRules = z.output<typeof rulesSchema>;

/** Visual data consumed by the client-owned Douga template. */
export const visualSchema = z.strictObject({
  theme: z.enum(["night", "paper", "sakura"]).default("night"),
  accent: color("Акцент арены").default("#a78bfa"),
  cardScale: z.number().min(0.7).max(1.3).default(1),
  reducedMotion: z.boolean().default(false),
}).prefault({});
export type YomifudaVisual = z.output<typeof visualSchema>;

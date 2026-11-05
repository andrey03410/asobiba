import type { ConfigDto } from "@asobiba/api";
import { collectAssetRefs, type ConfigDocument, type ConfigIssue, type GameCatalog, validateConfig } from "@asobiba/sdk";
import type { GameConfig, Prisma } from "@prisma/client";
import type { AssetService } from "../assets/service";
import type { Db } from "../db";
import { conflict, invalidConfig, notFound } from "../http-errors";
import { newId } from "../ids";

export const MAX_CONFIGS_PER_USER = 200;

export type UserValidation = { ok: true; config: ConfigDocument; issues: ConfigIssue[] } | { ok: false; config: null; issues: ConfigIssue[] };

export function configDto(row: GameConfig): ConfigDto {
  return {
    id: row.id,
    gameId: row.gameId,
    title: row.title,
    document: row.document as unknown as ConfigDocument,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class ConfigService {
  constructor(
    private readonly db: Db,
    private readonly catalog: GameCatalog,
    private readonly assets: AssetService,
  ) {}

  /** SDK validation plus the user's ownership of every referenced image. */
  async validate(userId: string, input: unknown): Promise<UserValidation> {
    const res = validateConfig(this.catalog, input);
    if (!res.ok) return { ok: false, config: null, issues: res.issues };
    const ownership = await this.assets.ownershipIssues(userId, collectAssetRefs(res.config));
    if (ownership.length > 0) return { ok: false, config: null, issues: [...res.issues, ...ownership] };
    return { ok: true, config: res.config, issues: res.issues };
  }

  async requireValid(userId: string, input: unknown): Promise<ConfigDocument> {
    const res = await this.validate(userId, input);
    if (!res.ok) throw invalidConfig(res.issues);
    return res.config;
  }

  async save(userId: string, input: unknown, configId?: string): Promise<ConfigDto> {
    const config = await this.requireValid(userId, input);
    const document = config as unknown as Prisma.InputJsonValue;
    if (configId) {
      const existing = await this.db.gameConfig.findFirst({ where: { id: configId, ownerId: userId } });
      if (!existing) throw notFound("Конфиг не найден");
      const row = await this.db.gameConfig.update({ where: { id: configId }, data: { title: config.title, gameId: config.game, document } });
      return configDto(row);
    }
    const count = await this.db.gameConfig.count({ where: { ownerId: userId } });
    if (count >= MAX_CONFIGS_PER_USER) throw conflict("too_many_configs", "Слишком много конфигов: удалите ненужные");
    const row = await this.db.gameConfig.create({ data: { id: newId("cfg"), ownerId: userId, gameId: config.game, title: config.title, document } });
    return configDto(row);
  }

  async list(userId: string, gameId?: string): Promise<ConfigDto[]> {
    const rows = await this.db.gameConfig.findMany({ where: { ownerId: userId, ...(gameId ? { gameId } : {}) }, orderBy: { updatedAt: "desc" } });
    return rows.map(configDto);
  }

  async get(userId: string, id: string): Promise<ConfigDto> {
    const row = await this.db.gameConfig.findFirst({ where: { id, ownerId: userId } });
    if (!row) throw notFound("Конфиг не найден");
    return configDto(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const res = await this.db.gameConfig.deleteMany({ where: { id, ownerId: userId } });
    if (res.count === 0) throw notFound("Конфиг не найден");
  }
}

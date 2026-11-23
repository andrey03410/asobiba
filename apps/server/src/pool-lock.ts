import type { Prisma } from "./generated/prisma/client";
import { conflict } from "./http-errors";

// Normal uploads and Douga imports spend the same owner's disk allowance.
const owners = new Map<string, Promise<void>>();

export async function withOwnerPool<T>(id: string, action: () => Promise<T>): Promise<T> {
  const previous = owners.get(id) ?? Promise.resolve();
  const result = previous.then(action);
  const tail = result.then(
    () => {},
    () => {},
  );
  owners.set(id, tail);
  try {
    return await result;
  } finally {
    if (owners.get(id) === tail) owners.delete(id);
  }
}

// Check the combined pool after publication, while the SQLite write transaction is held.
// This also covers overlapping server processes during a restart.
export async function checkPublishedBytes(tx: Prisma.TransactionClient, ownerId: string, limit: number | null) {
  if (limit === null) return;
  const assets = await tx.asset.aggregate({ where: { ownerId }, _sum: { bytes: true } });
  const manifests = await tx.videoSnapshot.aggregate({ where: { ownerId }, _sum: { manifestBytes: true } });
  const media = await tx.videoFile.findMany({
    where: { snapshots: { some: { snapshot: { ownerId } } } },
    select: { bytes: true },
  });
  const used = media.reduce(
    (sum, file) => sum + BigInt(file.bytes),
    BigInt(assets._sum.bytes ?? 0) + BigInt(manifests._sum.manifestBytes ?? 0),
  );
  if (used > BigInt(limit)) throw conflict("asset_quota", "Недостаточно места в пуле.");
}

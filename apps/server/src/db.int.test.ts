import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./test/helpers";

const db = testDb();
beforeEach(() => resetDb(db));
afterEach(() => resetDb(db));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("SQLite client (Prisma 7 adapter)", () => {
  it("keeps DateTime as integer milliseconds, the format existing databases use", async () => {
    const user = await db.user.create({ data: { id: "usr_dates", login: "dates", passwordHash: "x" } });
    const expiresAt = new Date(Date.now() + 60_000);
    await db.session.create({ data: { id: "ses_dates", userId: user.id, expiresAt } });
    const [row] = await db.$queryRawUnsafe<{ kind: string; value: number }[]>(
      "SELECT typeof(expiresAt) AS kind, expiresAt AS value FROM Session WHERE id = 'ses_dates'",
    );
    expect(row?.kind).toBe("integer");
    expect(Number(row?.value)).toBe(expiresAt.getTime());
    expect(await db.session.count({ where: { expiresAt: { gt: new Date() } } })).toBe(1);
  });

  it("does not pull a concurrent write into another request's transaction", async () => {
    // one SQLite connection serves the whole process: without serialization a query
    // issued while a transaction is open runs inside it and is rolled back with it
    const failing = db
      .$transaction(async (tx) => {
        await tx.user.create({ data: { id: "usr_tx", login: "inside", passwordHash: "x" } });
        await sleep(80);
        throw new Error("rollback on purpose");
      })
      .catch((e: Error) => e.message);
    await sleep(20);
    await db.user.create({ data: { id: "usr_out", login: "outside", passwordHash: "x" } });
    expect(await failing).toBe("rollback on purpose");
    expect((await db.user.findMany({ orderBy: { login: "asc" } })).map((u) => u.login)).toEqual(["outside"]);
  });
});

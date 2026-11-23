ALTER TABLE "User" ADD COLUMN "kanameIssuer" TEXT;
DROP INDEX "User_kanameSubject_key";
CREATE UNIQUE INDEX "User_kanameIssuer_kanameSubject_key" ON "User"("kanameIssuer","kanameSubject");
ALTER TABLE "KanameActivity" RENAME TO "KanameActivity_before_issuer";
CREATE TABLE "KanameActivity" ("issuer" TEXT NOT NULL, "subject" TEXT NOT NULL, "day" TEXT NOT NULL, "lastActiveAt" DATETIME NOT NULL, PRIMARY KEY ("issuer","subject","day"));
INSERT INTO "KanameActivity" ("issuer","subject","day","lastActiveAt") SELECT '',"subject","day","lastActiveAt" FROM "KanameActivity_before_issuer";
DROP TABLE "KanameActivity_before_issuer";
ALTER TABLE "ApiToken" ADD COLUMN "kanameToken" BOOLEAN NOT NULL DEFAULT false;

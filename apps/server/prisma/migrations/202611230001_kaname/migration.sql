ALTER TABLE "User" ADD COLUMN "kanameSubject" TEXT;
CREATE UNIQUE INDEX "User_kanameSubject_key" ON "User"("kanameSubject");
ALTER TABLE "User" ADD COLUMN "kanameSuspended" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Session" ADD COLUMN "kanameSession" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "KanameActivity" ("subject" TEXT NOT NULL, "day" TEXT NOT NULL, "lastActiveAt" DATETIME NOT NULL, PRIMARY KEY ("subject", "day"));
ALTER TABLE "VideoSnapshot" ADD COLUMN "manifestBytes" INTEGER NOT NULL DEFAULT 0;

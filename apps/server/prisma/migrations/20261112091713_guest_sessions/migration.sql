-- AlterTable
ALTER TABLE "LobbyMember" ADD COLUMN "guestNumber" INTEGER;

-- CreateTable
CREATE TABLE "LobbyVisit" (
    "lobbyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    PRIMARY KEY ("lobbyId", "userId"),
    CONSTRAINT "LobbyVisit_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LobbyVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Match" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lobbyId" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "seatUsers" JSONB NOT NULL,
    "seatNames" JSONB NOT NULL DEFAULT [],
    "log" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "result" JSONB,
    "finishedAt" DATETIME,
    CONSTRAINT "Match_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Match" ("finishedAt", "id", "lobbyId", "log", "result", "seatUsers", "seed", "startedAt", "status") SELECT "finishedAt", "id", "lobbyId", "log", "result", "seatUsers", "seed", "startedAt", "status" FROM "Match";
DROP TABLE "Match";
ALTER TABLE "new_Match" RENAME TO "Match";
CREATE INDEX "Match_lobbyId_idx" ON "Match"("lobbyId");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "login" TEXT NOT NULL,
    "passwordHash" TEXT,
    "displayName" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "id", "login", "passwordHash", "role") SELECT "createdAt", "id", "login", "passwordHash", "role" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_login_key" ON "User"("login");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "LobbyVisit_userId_idx" ON "LobbyVisit"("userId");

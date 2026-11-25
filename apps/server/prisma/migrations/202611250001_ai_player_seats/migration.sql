ALTER TABLE "LobbyMember" ADD COLUMN "botNumber" INTEGER;
ALTER TABLE "LobbyMember" ADD COLUMN "botDifficulty" TEXT;
ALTER TABLE "LobbyMember" ADD COLUMN "botInviteHash" TEXT;
ALTER TABLE "LobbyMember" ADD COLUMN "botKeyHash" TEXT;

CREATE UNIQUE INDEX "LobbyMember_botInviteHash_key" ON "LobbyMember"("botInviteHash");
CREATE UNIQUE INDEX "LobbyMember_botKeyHash_key" ON "LobbyMember"("botKeyHash");
CREATE UNIQUE INDEX "LobbyMember_lobbyId_botNumber_key" ON "LobbyMember"("lobbyId","botNumber");

ALTER TABLE "LobbyMember" ADD COLUMN "botControllerId" TEXT;
CREATE UNIQUE INDEX "LobbyMember_lobbyId_botControllerId_key" ON "LobbyMember"("lobbyId","botControllerId");

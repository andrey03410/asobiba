-- CreateTable
CREATE TABLE "VideoSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "contract" INTEGER NOT NULL,
    "engine" JSONB NOT NULL,
    "bytes" BIGINT NOT NULL,
    "scenes" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VideoSnapshot_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VideoFile" (
    "hash" TEXT NOT NULL PRIMARY KEY,
    "ext" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "kind" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "VideoSnapshotFile" (
    "snapshotId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    PRIMARY KEY ("snapshotId", "hash"),
    CONSTRAINT "VideoSnapshotFile_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "VideoSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VideoSnapshotFile_hash_fkey" FOREIGN KEY ("hash") REFERENCES "VideoFile" ("hash") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "VideoSnapshot_ownerId_idx" ON "VideoSnapshot"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoSnapshot_ownerId_manifestHash_key" ON "VideoSnapshot"("ownerId", "manifestHash");

-- CreateIndex
CREATE INDEX "VideoSnapshotFile_hash_idx" ON "VideoSnapshotFile"("hash");

-- Rail redesign: "Broken" becomes Important (alerts gain a link and a dismiss), and the custom
-- "Waiting on you" items become Hermes notes in the Notes panel.

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "dismissedAt" TIMESTAMP(3),
ADD COLUMN     "url" VARCHAR(2048);

-- CreateTable
CREATE TABLE "Note" (
    "id" UUID NOT NULL,
    "key" VARCHAR(200),
    "author" "Actor" NOT NULL,
    "text" VARCHAR(200) NOT NULL,
    "detail" VARCHAR(200),
    "url" VARCHAR(2048),
    "count" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Note_key_key" ON "Note"("key");

-- CreateIndex
CREATE INDEX "Note_createdAt_idx" ON "Note"("createdAt");

-- Carry the custom items over as Hermes notes (same id, key, link and count; title becomes the text).
INSERT INTO "Note" ("id", "key", "author", "text", "detail", "url", "count", "createdAt", "updatedAt")
SELECT "id", "key", 'hermes', "title", "detail", "url", "count", "createdAt", "updatedAt" FROM "WaitingItem";

-- DropTable
DROP TABLE "WaitingItem";

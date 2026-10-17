-- Who checked a checklist item: Gerardo on the page, Hermes through its API, or Gerardo confirming a
-- Hermes push update (then doneProgressId points at that update, so the page can link the push).

-- AlterTable
ALTER TABLE "ChecklistItem" ADD COLUMN     "doneBy" "Actor",
ADD COLUMN     "doneProgressId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistItem_doneProgressId_key" ON "ChecklistItem"("doneProgressId");

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_doneProgressId_fkey" FOREIGN KEY ("doneProgressId") REFERENCES "ItemProgress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Items already checked by confirming a "looks done" push update: the newest confirmed one.
-- Every other checked item stays unknown (null), since who checked it was never recorded.
UPDATE "ChecklistItem" AS item
SET "doneBy" = 'user', "doneProgressId" = confirmed."id"
FROM (
  SELECT DISTINCT ON ("checklistItemId") "id", "checklistItemId"
  FROM "ItemProgress"
  WHERE "kind" = 'looks_done' AND "status" = 'confirmed'
  ORDER BY "checklistItemId", "resolvedAt" DESC NULLS LAST, "createdAt" DESC
) AS confirmed
WHERE item."id" = confirmed."checklistItemId" AND item."done" = true;

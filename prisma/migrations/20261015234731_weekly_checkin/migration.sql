-- CreateTable
CREATE TABLE "WeeklyCheckin" (
    "id" UUID NOT NULL,
    "weekOf" DATE NOT NULL,
    "summary" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyCheckin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckinItem" (
    "id" UUID NOT NULL,
    "checkinId" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "text" VARCHAR(200) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "checklistItemId" UUID,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "CheckinItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyCheckin_weekOf_key" ON "WeeklyCheckin"("weekOf");

-- CreateIndex
CREATE UNIQUE INDEX "CheckinItem_checkinId_key_key" ON "CheckinItem"("checkinId", "key");

-- AddForeignKey
ALTER TABLE "CheckinItem" ADD CONSTRAINT "CheckinItem_checkinId_fkey" FOREIGN KEY ("checkinId") REFERENCES "WeeklyCheckin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckinItem" ADD CONSTRAINT "CheckinItem_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "ChecklistItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

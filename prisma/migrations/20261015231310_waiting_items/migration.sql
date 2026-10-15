-- CreateTable
CREATE TABLE "WaitingItem" (
    "id" UUID NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "count" INTEGER NOT NULL,
    "detail" VARCHAR(200),
    "url" VARCHAR(2048),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaitingItem_key_key" ON "WaitingItem"("key");

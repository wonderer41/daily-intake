-- CreateTable
CREATE TABLE "OrphanEntry" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrphanEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrphanEntry_name_key" ON "OrphanEntry"("name");

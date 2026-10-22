-- CreateTable
CREATE TABLE "Appearance" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "theme" VARCHAR(40) NOT NULL,
    "background" VARCHAR(40) NOT NULL,
    "updatedBy" "Actor" NOT NULL DEFAULT 'user',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appearance_pkey" PRIMARY KEY ("id")
);

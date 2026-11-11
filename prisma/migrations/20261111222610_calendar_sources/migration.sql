-- CreateTable
CREATE TABLE "CalendarSource" (
    "calendarId" VARCHAR(200) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "addedBy" "Actor" NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarSource_pkey" PRIMARY KEY ("calendarId")
);


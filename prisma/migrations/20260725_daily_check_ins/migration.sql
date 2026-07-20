CREATE TABLE "DailyCheckIn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "checkInDate" DATE NOT NULL,
    "questionGoal" INTEGER NOT NULL,
    "taskGoal" INTEGER NOT NULL,
    "goalSummary" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'DATA_RULES',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyCheckIn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyCheckIn_userId_checkInDate_key"
ON "DailyCheckIn"("userId", "checkInDate");

CREATE INDEX "DailyCheckIn_userId_createdAt_idx"
ON "DailyCheckIn"("userId", "createdAt");

ALTER TABLE "DailyCheckIn"
ADD CONSTRAINT "DailyCheckIn_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

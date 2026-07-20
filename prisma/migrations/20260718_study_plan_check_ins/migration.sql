CREATE TABLE "StudyPlanCheckIn" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "taskIndex" INTEGER NOT NULL,
    "taskTitle" TEXT NOT NULL,
    "targetSnapshot" TEXT NOT NULL,
    "checkpointSnapshot" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyPlanCheckIn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudyPlanCheckIn_planId_taskIndex_key"
ON "StudyPlanCheckIn"("planId", "taskIndex");

CREATE INDEX "StudyPlanCheckIn_planId_completedAt_idx"
ON "StudyPlanCheckIn"("planId", "completedAt");

ALTER TABLE "StudyPlanCheckIn"
ADD CONSTRAINT "StudyPlanCheckIn_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "StudyPlan"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudyPlanCheckIn"
ADD COLUMN "taskKey" TEXT,
ADD COLUMN "acceptanceMethod" TEXT NOT NULL DEFAULT 'SELF_CONFIRMED';

UPDATE "StudyPlanCheckIn"
SET "taskKey" = 'legacy-' || LPAD(("taskIndex" + 1)::TEXT, 2, '0')
WHERE "taskKey" IS NULL;

ALTER TABLE "StudyPlanCheckIn"
ALTER COLUMN "taskKey" SET NOT NULL;

CREATE UNIQUE INDEX "StudyPlanCheckIn_planId_taskKey_key"
ON "StudyPlanCheckIn"("planId", "taskKey");

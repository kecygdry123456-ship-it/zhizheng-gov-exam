ALTER TABLE "PracticeSession"
ADD COLUMN "studyPlanId" TEXT,
ADD COLUMN "studyPlanTaskKey" TEXT;

ALTER TABLE "ExamSession"
ADD COLUMN "studyPlanId" TEXT,
ADD COLUMN "studyPlanTaskKey" TEXT;

ALTER TABLE "TrainingReport"
ADD COLUMN "studyPlanId" TEXT,
ADD COLUMN "studyPlanTaskKey" TEXT;

ALTER TABLE "EssaySubmission"
ADD COLUMN "studyPlanId" TEXT,
ADD COLUMN "studyPlanTaskKey" TEXT;

ALTER TABLE "StudyPlanCheckIn"
ADD COLUMN "evidenceType" TEXT,
ADD COLUMN "evidenceId" TEXT,
ADD COLUMN "evidenceKey" TEXT,
ADD COLUMN "criteriaSnapshot" JSONB,
ADD COLUMN "actualSnapshot" JSONB,
ADD COLUMN "specHash" TEXT;

CREATE TABLE "StudyPlanEvidenceClaim" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "taskIndex" INTEGER NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "evidenceKey" TEXT NOT NULL,
    "specHash" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyPlanEvidenceClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudyPlanCheckIn_evidenceKey_key"
ON "StudyPlanCheckIn"("evidenceKey");

CREATE UNIQUE INDEX "StudyPlanEvidenceClaim_evidenceKey_key"
ON "StudyPlanEvidenceClaim"("evidenceKey");

CREATE INDEX "StudyPlanEvidenceClaim_planId_taskKey_claimedAt_idx"
ON "StudyPlanEvidenceClaim"("planId", "taskKey", "claimedAt");

CREATE INDEX "PracticeSession_studyPlanId_studyPlanTaskKey_startedAt_idx"
ON "PracticeSession"("studyPlanId", "studyPlanTaskKey", "startedAt");

CREATE INDEX "ExamSession_studyPlanId_studyPlanTaskKey_startedAt_idx"
ON "ExamSession"("studyPlanId", "studyPlanTaskKey", "startedAt");

CREATE INDEX "TrainingReport_studyPlanId_studyPlanTaskKey_completedAt_idx"
ON "TrainingReport"("studyPlanId", "studyPlanTaskKey", "completedAt");

CREATE INDEX "EssaySubmission_studyPlanId_studyPlanTaskKey_createdAt_idx"
ON "EssaySubmission"("studyPlanId", "studyPlanTaskKey", "createdAt");

ALTER TABLE "PracticeSession"
ADD CONSTRAINT "PracticeSession_studyPlanId_fkey"
FOREIGN KEY ("studyPlanId") REFERENCES "StudyPlan"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ExamSession"
ADD CONSTRAINT "ExamSession_studyPlanId_fkey"
FOREIGN KEY ("studyPlanId") REFERENCES "StudyPlan"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TrainingReport"
ADD CONSTRAINT "TrainingReport_studyPlanId_fkey"
FOREIGN KEY ("studyPlanId") REFERENCES "StudyPlan"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EssaySubmission"
ADD CONSTRAINT "EssaySubmission_studyPlanId_fkey"
FOREIGN KEY ("studyPlanId") REFERENCES "StudyPlan"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StudyPlanEvidenceClaim"
ADD CONSTRAINT "StudyPlanEvidenceClaim_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "StudyPlan"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

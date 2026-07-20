ALTER TYPE "TrainingEvaluationStatus" ADD VALUE IF NOT EXISTS 'EVALUATING' BEFORE 'READY';

CREATE TABLE "PracticeSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "questionIds" JSONB NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "questionDurations" JSONB NOT NULL DEFAULT '{}',
    "config" JSONB NOT NULL,
    "paperDifficulty" DOUBLE PRECISION NOT NULL,
    "currentIndex" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeSession_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TrainingReport"
ADD COLUMN "practiceSessionId" TEXT,
ADD COLUMN "evaluationClaimedAt" TIMESTAMP(3);

ALTER TABLE "Attempt"
ADD COLUMN "practiceSessionId" TEXT;

CREATE UNIQUE INDEX "TrainingReport_practiceSessionId_key" ON "TrainingReport"("practiceSessionId");
CREATE UNIQUE INDEX "Attempt_practiceSessionId_questionId_key" ON "Attempt"("practiceSessionId", "questionId");
CREATE INDEX "PracticeSession_userId_status_updatedAt_idx" ON "PracticeSession"("userId", "status", "updatedAt");

ALTER TABLE "PracticeSession"
ADD CONSTRAINT "PracticeSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TrainingReport"
ADD CONSTRAINT "TrainingReport_practiceSessionId_fkey"
FOREIGN KEY ("practiceSessionId") REFERENCES "PracticeSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Attempt"
ADD CONSTRAINT "Attempt_practiceSessionId_fkey"
FOREIGN KEY ("practiceSessionId") REFERENCES "PracticeSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "updatedAt" DESC, "id" DESC) AS row_number
  FROM "ExamSession"
  WHERE "status" = 'IN_PROGRESS'
)
UPDATE "ExamSession"
SET "status" = 'ABANDONED'
WHERE "id" IN (SELECT "id" FROM ranked WHERE row_number > 1);

CREATE UNIQUE INDEX "ExamSession_one_active_per_user_key"
ON "ExamSession"("userId") WHERE "status" = 'IN_PROGRESS';

CREATE UNIQUE INDEX "PracticeSession_one_active_per_user_key"
ON "PracticeSession"("userId") WHERE "status" = 'IN_PROGRESS';

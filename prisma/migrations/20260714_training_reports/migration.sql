-- Persist per-question timing and immutable end-of-session training summaries.
CREATE TYPE "TrainingEvaluationStatus" AS ENUM ('PENDING', 'READY', 'FALLBACK');

ALTER TABLE "ExamSession"
ADD COLUMN "questionDurations" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "questionMeta" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "TrainingReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "examSessionId" TEXT,
    "clientKey" TEXT NOT NULL,
    "mode" "AttemptMode" NOT NULL,
    "title" TEXT NOT NULL,
    "templateId" TEXT,
    "questionIds" JSONB NOT NULL,
    "attemptIds" JSONB NOT NULL,
    "questionDurations" JSONB NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "inactiveDurationSeconds" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "answered" INTEGER NOT NULL,
    "correct" INTEGER NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "difficultyScore" DOUBLE PRECISION NOT NULL,
    "sections" JSONB NOT NULL,
    "evaluationStatus" "TrainingEvaluationStatus" NOT NULL DEFAULT 'PENDING',
    "evaluationSource" TEXT,
    "overallEvaluation" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrainingReport_examSessionId_key" ON "TrainingReport"("examSessionId");
CREATE UNIQUE INDEX "TrainingReport_userId_clientKey_key" ON "TrainingReport"("userId", "clientKey");
CREATE INDEX "TrainingReport_userId_completedAt_idx" ON "TrainingReport"("userId", "completedAt");

ALTER TABLE "TrainingReport"
ADD CONSTRAINT "TrainingReport_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TrainingReport"
ADD CONSTRAINT "TrainingReport_examSessionId_fkey"
FOREIGN KEY ("examSessionId") REFERENCES "ExamSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

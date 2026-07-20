CREATE TABLE "QuestionMaterial" (
  "id" TEXT NOT NULL,
  "externalKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "blocks" JSONB NOT NULL,
  "sourceUrl" TEXT,
  "paperTitle" TEXT,
  "year" INTEGER,
  "region" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QuestionMaterial_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuestionMaterial_externalKey_key" ON "QuestionMaterial"("externalKey");
CREATE INDEX "QuestionMaterial_region_year_idx" ON "QuestionMaterial"("region", "year");

ALTER TABLE "Question" ADD COLUMN "materialId" TEXT;
ALTER TABLE "Question" ADD COLUMN "materialOrder" INTEGER;
CREATE INDEX "Question_materialId_materialOrder_idx" ON "Question"("materialId", "materialOrder");
ALTER TABLE "Question" ADD CONSTRAINT "Question_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "QuestionMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TrainingPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "practiceCount" INTEGER NOT NULL DEFAULT 20,
  "practiceCategory" TEXT,
  "practiceDifficultyMode" TEXT NOT NULL DEFAULT 'CUSTOM',
  "practiceMinDifficulty" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "practiceMaxDifficulty" DOUBLE PRECISION NOT NULL DEFAULT 10,
  "examCount" INTEGER NOT NULL DEFAULT 50,
  "examDuration" INTEGER NOT NULL DEFAULT 60,
  "examDifficultyMode" TEXT NOT NULL DEFAULT 'CUSTOM',
  "examMinDifficulty" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "examMaxDifficulty" DOUBLE PRECISION NOT NULL DEFAULT 10,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrainingPreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TrainingPreference_userId_key" ON "TrainingPreference"("userId");
ALTER TABLE "TrainingPreference" ADD CONSTRAINT "TrainingPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ExamSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  "questionIds" JSONB NOT NULL,
  "answers" JSONB NOT NULL,
  "config" JSONB NOT NULL,
  "paperDifficulty" DOUBLE PRECISION NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExamSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ExamSession_userId_status_updatedAt_idx" ON "ExamSession"("userId", "status", "updatedAt");
ALTER TABLE "ExamSession" ADD CONSTRAINT "ExamSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

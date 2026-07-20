ALTER TABLE "StudyPlan"
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "previousPlanId" TEXT;

CREATE UNIQUE INDEX "StudyPlan_previousPlanId_key" ON "StudyPlan"("previousPlanId");
CREATE INDEX "StudyPlan_userId_completedAt_idx" ON "StudyPlan"("userId", "completedAt");
ALTER TABLE "StudyPlan" ADD CONSTRAINT "StudyPlan_previousPlanId_fkey"
  FOREIGN KEY ("previousPlanId") REFERENCES "StudyPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WeeklyStudyPlan" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "goals" JSONB NOT NULL,
  "strategy" JSONB NOT NULL,
  "source" TEXT NOT NULL,
  "inputSnapshot" JSONB,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "WeeklyStudyPlan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WeeklyStudyPlan_userId_generatedAt_idx" ON "WeeklyStudyPlan"("userId", "generatedAt");
ALTER TABLE "WeeklyStudyPlan" ADD CONSTRAINT "WeeklyStudyPlan_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

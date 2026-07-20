ALTER TABLE "StudyPlan"
ADD COLUMN "strategy" JSONB,
ADD COLUMN "schemaVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "inputSnapshot" JSONB,
ADD COLUMN "generationMeta" JSONB;

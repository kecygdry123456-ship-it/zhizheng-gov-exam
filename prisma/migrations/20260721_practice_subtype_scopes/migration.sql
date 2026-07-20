ALTER TABLE "TrainingPreference"
ADD COLUMN "practiceScopes" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "Question" ADD COLUMN "difficultyScore" DOUBLE PRECISION NOT NULL DEFAULT 5;

CREATE INDEX "Question_status_difficultyScore_idx" ON "Question"("status", "difficultyScore");

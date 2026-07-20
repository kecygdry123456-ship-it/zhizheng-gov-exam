ALTER TABLE "Question"
ADD COLUMN "source" TEXT,
ADD COLUMN "sourceUrl" TEXT,
ADD COLUMN "externalKey" TEXT,
ADD COLUMN "paperTitle" TEXT,
ADD COLUMN "year" INTEGER,
ADD COLUMN "region" TEXT;

CREATE UNIQUE INDEX "Question_externalKey_key" ON "Question"("externalKey");
CREATE INDEX "Question_status_categoryId_idx" ON "Question"("status", "categoryId");
CREATE INDEX "Question_region_year_idx" ON "Question"("region", "year");

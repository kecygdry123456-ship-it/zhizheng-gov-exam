CREATE TABLE "ModelUsageDaily" (
    "key" TEXT NOT NULL,
    "usageDate" DATE NOT NULL,
    "scope" TEXT NOT NULL,
    "userId" TEXT,
    "purpose" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelUsageDaily_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "ModelUsageDaily_usageDate_purpose_idx"
ON "ModelUsageDaily"("usageDate", "purpose");

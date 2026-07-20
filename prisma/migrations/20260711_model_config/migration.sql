CREATE TABLE "ModelConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "apiKeyEncrypted" TEXT,
    "model" TEXT,
    "baseUrl" TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelConfig_pkey" PRIMARY KEY ("id")
);

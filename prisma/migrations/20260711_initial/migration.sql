CREATE SCHEMA IF NOT EXISTS "public";
CREATE TYPE "Role" AS ENUM ('STUDENT', 'ADMIN');
CREATE TYPE "QuestionStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "AttemptMode" AS ENUM ('PRACTICE', 'EXAM');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STUDENT',
    "targetExam" TEXT DEFAULT '2027 国考',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EssayMaterial" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "year" INTEGER,
    "topic" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EssayMaterial_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EssayQuestion" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "wordLimit" INTEGER NOT NULL,
    "referenceAnswer" TEXT NOT NULL,
    "scoringPoints" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EssayQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EssaySubmission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "feedback" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EssaySubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudyPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "tasks" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudyPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "stem" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "answer" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL DEFAULT '基础',
    "status" "QuestionStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExamPaper" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "totalScore" INTEGER NOT NULL DEFAULT 100,
    "questionIds" JSONB NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExamPaper_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selected" INTEGER,
    "correct" BOOLEAN NOT NULL,
    "mode" "AttemptMode" NOT NULL DEFAULT 'PRACTICE',
    "duration" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "EssaySubmission_userId_createdAt_idx" ON "EssaySubmission"("userId", "createdAt");
CREATE INDEX "StudyPlan_userId_generatedAt_idx" ON "StudyPlan"("userId", "generatedAt");
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");
CREATE INDEX "Attempt_userId_createdAt_idx" ON "Attempt"("userId", "createdAt");
CREATE UNIQUE INDEX "Favorite_userId_questionId_key" ON "Favorite"("userId", "questionId");

ALTER TABLE "EssayQuestion" ADD CONSTRAINT "EssayQuestion_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "EssayMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EssaySubmission" ADD CONSTRAINT "EssaySubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EssaySubmission" ADD CONSTRAINT "EssaySubmission_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "EssayQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudyPlan" ADD CONSTRAINT "StudyPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Question" ADD CONSTRAINT "Question_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

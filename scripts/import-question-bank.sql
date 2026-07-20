\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE sync_category (
  local_id text NOT NULL UNIQUE,
  name text PRIMARY KEY,
  sort integer NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE sync_material (
  local_id text NOT NULL UNIQUE,
  external_key text PRIMARY KEY,
  title text NOT NULL,
  content text NOT NULL,
  blocks jsonb NOT NULL,
  source_url text,
  paper_title text,
  year integer,
  region text,
  created_at timestamp(3) NOT NULL,
  updated_at timestamp(3) NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE sync_question (
  local_id text PRIMARY KEY,
  category_name text NOT NULL,
  type text NOT NULL,
  stem text NOT NULL,
  options jsonb NOT NULL,
  answer integer NOT NULL,
  explanation text NOT NULL,
  difficulty text NOT NULL,
  difficulty_score double precision NOT NULL,
  status text NOT NULL,
  source text,
  source_url text,
  external_key text,
  paper_title text,
  year integer,
  region text,
  material_external_key text,
  material_order integer,
  created_at timestamp(3) NOT NULL,
  updated_at timestamp(3) NOT NULL
) ON COMMIT DROP;

CREATE UNIQUE INDEX sync_question_external_key_unique
  ON sync_question (external_key)
  WHERE external_key IS NOT NULL;

\copy sync_category FROM '/tmp/question-bank-sync/categories.csv' WITH (FORMAT csv, HEADER true)
\copy sync_material FROM '/tmp/question-bank-sync/materials.csv' WITH (FORMAT csv, HEADER true)
\copy sync_question FROM '/tmp/question-bank-sync/questions.csv' WITH (FORMAT csv, HEADER true)

DO $$
DECLARE
  total_questions bigint;
  published_questions bigint;
  unresolved_categories bigint;
  unresolved_materials bigint;
  material_id_collisions bigint;
  question_id_collisions bigint;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE status = 'PUBLISHED')
    INTO total_questions, published_questions
    FROM sync_question;

  IF total_questions < 50000 OR published_questions < 50000 THEN
    RAISE EXCEPTION 'Sync package too small: total %, published %', total_questions, published_questions;
  END IF;

  IF EXISTS (SELECT 1 FROM sync_question WHERE status NOT IN ('DRAFT', 'PUBLISHED')) THEN
    RAISE EXCEPTION 'Sync package contains an invalid question status';
  END IF;

  SELECT count(*) INTO unresolved_categories
    FROM sync_question AS question
    LEFT JOIN sync_category AS category ON category.name = question.category_name
    WHERE category.name IS NULL;

  IF unresolved_categories > 0 THEN
    RAISE EXCEPTION '% questions have no matching category', unresolved_categories;
  END IF;

  SELECT count(*) INTO unresolved_materials
    FROM sync_question AS question
    LEFT JOIN sync_material AS material ON material.external_key = question.material_external_key
    WHERE question.material_external_key IS NOT NULL AND material.external_key IS NULL;

  IF unresolved_materials > 0 THEN
    RAISE EXCEPTION '% questions have no matching material', unresolved_materials;
  END IF;

  SELECT count(*) INTO material_id_collisions
    FROM sync_material AS staged
    JOIN "QuestionMaterial" AS current ON current.id = staged.local_id
    WHERE current."externalKey" IS DISTINCT FROM staged.external_key;

  IF material_id_collisions > 0 THEN
    RAISE EXCEPTION '% material ID collisions detected', material_id_collisions;
  END IF;

  SELECT count(*) INTO question_id_collisions
    FROM sync_question AS staged
    JOIN "Question" AS current ON current.id = staged.local_id
    WHERE current."externalKey" IS DISTINCT FROM staged.external_key;

  IF question_id_collisions > 0 THEN
    RAISE EXCEPTION '% question ID collisions detected', question_id_collisions;
  END IF;
END $$;

INSERT INTO "Category" (id, name, sort)
SELECT local_id, name, sort
FROM sync_category
ON CONFLICT (name) DO UPDATE SET sort = EXCLUDED.sort;

INSERT INTO "QuestionMaterial" (
  id, "externalKey", title, content, blocks, "sourceUrl", "paperTitle",
  year, region, "createdAt", "updatedAt"
)
SELECT
  staged.local_id, staged.external_key, staged.title, staged.content, staged.blocks,
  staged.source_url, staged.paper_title, staged.year, staged.region,
  staged.created_at, staged.updated_at
FROM sync_material AS staged
WHERE NOT EXISTS (
  SELECT 1
  FROM "QuestionMaterial" AS current
  WHERE current."externalKey" = staged.external_key OR current.id = staged.local_id
)
ON CONFLICT ("externalKey") DO NOTHING;

UPDATE "QuestionMaterial" AS current
SET
  title = staged.title,
  content = staged.content,
  blocks = staged.blocks,
  "sourceUrl" = staged.source_url,
  "paperTitle" = staged.paper_title,
  year = staged.year,
  region = staged.region,
  "createdAt" = staged.created_at,
  "updatedAt" = staged.updated_at
FROM sync_material AS staged
WHERE current."externalKey" = staged.external_key;

UPDATE "Question" AS current
SET
  "categoryId" = category.id,
  type = staged.type,
  stem = staged.stem,
  options = staged.options,
  answer = staged.answer,
  explanation = staged.explanation,
  difficulty = staged.difficulty,
  "difficultyScore" = staged.difficulty_score,
  status = staged.status::"QuestionStatus",
  source = staged.source,
  "sourceUrl" = staged.source_url,
  "externalKey" = staged.external_key,
  "paperTitle" = staged.paper_title,
  year = staged.year,
  region = staged.region,
  "materialId" = material.id,
  "materialOrder" = staged.material_order,
  "createdAt" = staged.created_at,
  "updatedAt" = staged.updated_at
FROM sync_question AS staged
JOIN "Category" AS category ON category.name = staged.category_name
LEFT JOIN "QuestionMaterial" AS material ON material."externalKey" = staged.material_external_key
WHERE
  (staged.external_key IS NOT NULL AND current."externalKey" = staged.external_key)
  OR (staged.external_key IS NULL AND current.id = staged.local_id);

INSERT INTO "Question" (
  id, "categoryId", type, stem, options, answer, explanation, difficulty,
  "difficultyScore", status, source, "sourceUrl", "externalKey", "paperTitle",
  year, region, "materialId", "materialOrder", "createdAt", "updatedAt"
)
SELECT
  staged.local_id, category.id, staged.type, staged.stem, staged.options,
  staged.answer, staged.explanation, staged.difficulty, staged.difficulty_score,
  staged.status::"QuestionStatus", staged.source, staged.source_url,
  staged.external_key, staged.paper_title, staged.year, staged.region,
  material.id, staged.material_order, staged.created_at, staged.updated_at
FROM sync_question AS staged
JOIN "Category" AS category ON category.name = staged.category_name
LEFT JOIN "QuestionMaterial" AS material ON material."externalKey" = staged.material_external_key
WHERE NOT EXISTS (
  SELECT 1
  FROM "Question" AS current
  WHERE
    current.id = staged.local_id
    OR (staged.external_key IS NOT NULL AND current."externalKey" = staged.external_key)
);

DO $$
DECLARE
  published_questions bigint;
BEGIN
  SELECT count(*) INTO published_questions
    FROM "Question"
    WHERE status = 'PUBLISHED';

  IF published_questions < 50000 THEN
    RAISE EXCEPTION 'Published question count after merge is only %', published_questions;
  END IF;
END $$;

SELECT 'categories' AS metric, count(*)::text AS value FROM "Category"
UNION ALL SELECT 'materials', count(*)::text FROM "QuestionMaterial"
UNION ALL SELECT 'questions', count(*)::text FROM "Question"
UNION ALL SELECT 'published', count(*)::text FROM "Question" WHERE status = 'PUBLISHED';

COMMIT;

BEGIN;

CREATE TEMP TABLE invalid_materials AS
SELECT DISTINCT "materialId"
FROM "Question"
WHERE status = 'PUBLISHED'
  AND "materialId" IS NOT NULL
  AND stem LIKE '题目正在全力以赴征集%'
  AND options = '["缺失","缺失","缺失","缺失"]'::jsonb;

UPDATE "Question"
SET status = 'DRAFT'
WHERE status = 'PUBLISHED'
  AND stem LIKE '题目正在全力以赴征集%'
  AND options = '["缺失","缺失","缺失","缺失"]'::jsonb;

UPDATE "Question"
SET status = 'DRAFT'
WHERE status = 'PUBLISHED'
  AND "materialId" IN (SELECT "materialId" FROM invalid_materials);

UPDATE "Question" AS question
SET status = 'DRAFT'
FROM "Category" AS category
WHERE question."categoryId" = category.id
  AND question.status = 'PUBLISHED'
  AND category.name IN ('页面测试分类', '页面图片测试分类');

COMMIT;

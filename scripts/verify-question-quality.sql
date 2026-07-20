SELECT
  count(*) AS total,
  count(*) FILTER (WHERE status = 'PUBLISHED') AS published,
  count(*) FILTER (WHERE status = 'DRAFT') AS draft,
  count(*) FILTER (
    WHERE status = 'PUBLISHED'
      AND stem LIKE '题目正在全力以赴征集%'
      AND options = '["缺失","缺失","缺失","缺失"]'::jsonb
  ) AS published_placeholders
FROM "Question";

SELECT count(*) AS published_test_questions
FROM "Question" AS question
JOIN "Category" AS category ON category.id = question."categoryId"
WHERE question.status = 'PUBLISHED'
  AND category.name IN ('页面测试分类', '页面图片测试分类');

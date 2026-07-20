\set ON_ERROR_STOP on

\copy (SELECT id AS local_id, name, sort FROM "Category" ORDER BY name) TO 'dist/question-bank-sync/categories.csv' WITH (FORMAT csv, HEADER true)

\copy (SELECT id AS local_id, "externalKey" AS external_key, title, content, blocks, "sourceUrl" AS source_url, "paperTitle" AS paper_title, year, region, "createdAt" AS created_at, "updatedAt" AS updated_at FROM "QuestionMaterial" ORDER BY "externalKey") TO 'dist/question-bank-sync/materials.csv' WITH (FORMAT csv, HEADER true)

\copy (SELECT question.id AS local_id, category.name AS category_name, question.type, question.stem, question.options, question.answer, question.explanation, question.difficulty, question."difficultyScore" AS difficulty_score, question.status::text AS status, question.source, question."sourceUrl" AS source_url, question."externalKey" AS external_key, question."paperTitle" AS paper_title, question.year, question.region, material."externalKey" AS material_external_key, question."materialOrder" AS material_order, question."createdAt" AS created_at, question."updatedAt" AS updated_at FROM "Question" AS question JOIN "Category" AS category ON category.id = question."categoryId" LEFT JOIN "QuestionMaterial" AS material ON material.id = question."materialId" ORDER BY question.id) TO 'dist/question-bank-sync/questions.csv' WITH (FORMAT csv, HEADER true)

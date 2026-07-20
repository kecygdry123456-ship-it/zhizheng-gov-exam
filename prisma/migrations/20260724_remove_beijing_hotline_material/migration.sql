-- Remove the repeatedly selected Beijing "接诉即办" general-knowledge material.
-- Reports and practice sessions that embed these question IDs must be removed
-- first so they do not retain an invalid evidence chain after question deletion.
DELETE FROM "TrainingReport" AS report
WHERE EXISTS (
  SELECT 1
  FROM "Question" AS target
  WHERE target."externalKey" IN (
    'huatu:40098982',
    'huatu:40098983',
    'huatu:40098984',
    'huatu:40098985',
    'huatu:40098987'
  )
  AND report."questionIds" @> jsonb_build_array(target.id)
);

DELETE FROM "PracticeSession" AS session
WHERE EXISTS (
  SELECT 1
  FROM "Question" AS target
  WHERE target."externalKey" IN (
    'huatu:40098982',
    'huatu:40098983',
    'huatu:40098984',
    'huatu:40098985',
    'huatu:40098987'
  )
  AND session."questionIds" @> jsonb_build_array(target.id)
);

DELETE FROM "Question"
WHERE "externalKey" IN (
  'huatu:40098982',
  'huatu:40098983',
  'huatu:40098984',
  'huatu:40098985',
  'huatu:40098987'
);

DELETE FROM "QuestionMaterial"
WHERE "externalKey" = 'huatu-material:fd370746be61fcef';

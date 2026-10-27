-- Revision reports used to be incorrectly classified as publication reviews.
-- Preserve prior decisions/status and attach the actual reporter reasons.
UPDATE reviews
SET task = 'report',
    context = json_set(COALESCE(context, '{}'), '$.reportReason',
      (SELECT group_concat(reason, char(10)) FROM reports WHERE review_id = reviews.id))
WHERE entity_type = 'revision' AND task = 'publish'
  AND EXISTS (SELECT 1 FROM reports WHERE review_id = reviews.id);

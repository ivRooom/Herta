ALTER TABLE moderation_cases
  DROP CONSTRAINT moderation_cases_action_check;

ALTER TABLE moderation_cases
  ADD CONSTRAINT moderation_cases_action_check
  CHECK (action IN ('warn', 'timeout', 'kick', 'ban', 'flag'));

ALTER TABLE moderation_cases
  DROP CONSTRAINT moderation_cases_source_check;

ALTER TABLE moderation_cases
  ADD CONSTRAINT moderation_cases_source_check
  CHECK (source IN ('discord', 'dashboard', 'automatic'));

ALTER TABLE moderation_cases
  ADD COLUMN origin_detection_id UUID;

ALTER TABLE moderation_cases
  ADD CONSTRAINT moderation_cases_origin_detection_id_fkey
  FOREIGN KEY (origin_detection_id)
  REFERENCES moderation_detection_events(id)
  ON DELETE SET NULL;

CREATE UNIQUE INDEX moderation_cases_origin_detection_id_key
  ON moderation_cases(origin_detection_id)
  WHERE origin_detection_id IS NOT NULL;

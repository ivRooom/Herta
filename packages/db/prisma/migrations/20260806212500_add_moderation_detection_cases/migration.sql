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

ALTER TABLE moderation_detection_events
  ADD CONSTRAINT moderation_detection_events_guild_id_id_key
  UNIQUE (guild_id, id);

ALTER TABLE moderation_cases
  ADD COLUMN origin_detection_id UUID;

ALTER TABLE moderation_cases
  ADD CONSTRAINT moderation_cases_origin_detection_guild_fkey
  FOREIGN KEY (guild_id, origin_detection_id)
  REFERENCES moderation_detection_events(guild_id, id)
  ON DELETE SET NULL (origin_detection_id);

CREATE UNIQUE INDEX moderation_cases_origin_detection_id_key
  ON moderation_cases(origin_detection_id)
  WHERE origin_detection_id IS NOT NULL;

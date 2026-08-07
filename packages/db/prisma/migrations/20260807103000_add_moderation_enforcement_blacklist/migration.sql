ALTER TABLE moderation_cases
  DROP CONSTRAINT moderation_cases_action_check;

ALTER TABLE moderation_cases
  ADD CONSTRAINT moderation_cases_action_check
  CHECK (action IN (
    'warn',
    'delete',
    'warn_delete',
    'timeout',
    'role',
    'blacklist',
    'kick',
    'ban',
    'flag'
  )) NOT VALID;

CREATE TABLE moderation_blacklist_entries (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  reason TEXT,
  origin_detection_id UUID,
  created_by TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT moderation_blacklist_entries_pkey PRIMARY KEY (guild_id, user_id),
  CONSTRAINT moderation_blacklist_entries_guild_id_fkey
    FOREIGN KEY (guild_id) REFERENCES guilds(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT moderation_blacklist_entries_origin_detection_guild_fkey
    FOREIGN KEY (guild_id, origin_detection_id)
    REFERENCES moderation_detection_events(guild_id, id)
    ON DELETE SET NULL (origin_detection_id)
);

CREATE INDEX moderation_blacklist_entries_guild_active_created_at_idx
  ON moderation_blacklist_entries(guild_id, active, created_at DESC);

CREATE INDEX moderation_blacklist_entries_user_id_idx
  ON moderation_blacklist_entries(user_id);

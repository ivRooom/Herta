CREATE TABLE daily_bonus_announcements (
 guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
 target_date TEXT NOT NULL CHECK (target_date ~ '^\d{4}-\d{2}-\d{2}$'),
 channel_id TEXT NOT NULL,
 role_id TEXT NOT NULL,
 eligible_count INTEGER CHECK (eligible_count >= 0),
 eligible_captured_at TIMESTAMPTZ,
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','uncertain','disabled')),
 message_id TEXT,
 error_code TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (guild_id,target_date)
);
CREATE TABLE daily_bonus_claims (
 guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
 discord_user_id TEXT NOT NULL,
 target_date TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('pending','confirmed','unavailable','unlinked')),
 receipt_json JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (guild_id,discord_user_id,target_date)
);
CREATE TABLE anniversary_events (
 id TEXT PRIMARY KEY,
 guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
 title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 150),
 summary TEXT NOT NULL DEFAULT '' CHECK (length(summary)<=500),
 category TEXT NOT NULL CHECK (category IN ('character','game','anime','manga','general','community')),
 month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
 day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
 base_year INTEGER CHECK (base_year BETWEEN 1800 AND 9999),
 work_name TEXT NOT NULL DEFAULT '',
 character_name TEXT NOT NULL DEFAULT '',
 source_url TEXT NOT NULL CHECK (source_url LIKE 'https://%'),
 source_checked_at TIMESTAMPTZ NOT NULL,
 approved BOOLEAN NOT NULL DEFAULT FALSE,
 public BOOLEAN NOT NULL DEFAULT FALSE,
 priority INTEGER NOT NULL DEFAULT 0,
 pinned_date TEXT,
 anniversary_mode TEXT NOT NULL DEFAULT 'annual' CHECK (anniversary_mode IN ('annual','elapsed')),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX anniversary_events_guild_date ON anniversary_events(guild_id,month,day);
CREATE TABLE daily_bonus_quiz_sessions (
 id TEXT PRIMARY KEY,
 guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
 discord_user_id TEXT NOT NULL,
 target_date TEXT NOT NULL,
 announcement_message_id TEXT NOT NULL,
 quiz_id TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE daily_fortune_results (
 guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
 discord_user_id TEXT NOT NULL,
 target_date TEXT NOT NULL,
 algorithm_version TEXT NOT NULL,
 result_json JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(guild_id,discord_user_id,target_date)
);
CREATE INDEX daily_bonus_quiz_sessions_created_at_idx ON daily_bonus_quiz_sessions(created_at);
CREATE INDEX daily_fortune_results_created_at_idx ON daily_fortune_results(created_at);
CREATE INDEX daily_bonus_claims_status_updated_at_idx ON daily_bonus_claims(status,updated_at);

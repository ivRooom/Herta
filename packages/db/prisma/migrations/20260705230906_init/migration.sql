-- CreateTable
CREATE TABLE "guilds" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "owner_id" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "locale" TEXT NOT NULL DEFAULT 'ja',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tokyo',
    "features" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guilds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_settings" (
    "guild_id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '!',
    "log_channel_id" TEXT,
    "mod_role_ids" TEXT[],
    "admin_role_ids" TEXT[],
    "locale" TEXT NOT NULL DEFAULT 'ja',
    "settings_json" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guild_settings_pkey" PRIMARY KEY ("guild_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "discriminator" TEXT,
    "avatar" TEXT,
    "email" TEXT,
    "locale" TEXT,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_members" (
    "guild_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "nickname" TEXT,
    "joined_at" TIMESTAMP(3),
    "roles" TEXT[],

    CONSTRAINT "guild_members_pkey" PRIMARY KEY ("guild_id","user_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[],
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "guild_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "assigned_by" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("guild_id","user_id","role_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL DEFAULT 'user',
    "event" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "changes" JSONB,
    "metadata" JSONB,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "ip_address" TEXT,
    "session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plugins" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" TEXT NOT NULL,
    "author" TEXT,
    "category" TEXT,
    "is_official" BOOLEAN NOT NULL DEFAULT false,
    "manifest" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plugins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_plugins" (
    "guild_id" TEXT NOT NULL,
    "plugin_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "config_version" INTEGER NOT NULL DEFAULT 1,
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guild_plugins_pkey" PRIMARY KEY ("guild_id","plugin_id")
);

-- CreateTable
CREATE TABLE "guild_plugin_config_history" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "plugin_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "changed_by" TEXT NOT NULL,
    "change_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guild_plugin_config_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "plugin_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "trigger" JSONB NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "cooldown_ms" INTEGER NOT NULL DEFAULT 0,
    "max_executions" INTEGER,
    "execution_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_execution_logs" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "trigger_event" JSONB NOT NULL,
    "conditions_met" BOOLEAN NOT NULL,
    "actions_result" JSONB,
    "error" TEXT,
    "duration_ms" INTEGER,
    "executed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_responses" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger_type" TEXT NOT NULL,
    "trigger_value" TEXT NOT NULL,
    "match_mode" TEXT NOT NULL DEFAULT 'partial',
    "response_type" TEXT NOT NULL DEFAULT 'text',
    "response_content" TEXT NOT NULL,
    "channel_ids" TEXT[],
    "role_ids" TEXT[],
    "cooldown_seconds" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auto_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mod_actions" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "moderator_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "reason" TEXT,
    "duration_ms" BIGINT,
    "expires_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mod_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "word_filters" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "pattern_type" TEXT NOT NULL DEFAULT 'exact',
    "action" TEXT NOT NULL DEFAULT 'delete',
    "reason" TEXT,
    "case_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "exempt_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exempt_channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "word_filters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spam_settings" (
    "guild_id" TEXT NOT NULL,
    "max_messages" INTEGER NOT NULL DEFAULT 5,
    "time_window_ms" INTEGER NOT NULL DEFAULT 5000,
    "max_mentions" INTEGER NOT NULL DEFAULT 10,
    "max_links" INTEGER NOT NULL DEFAULT 3,
    "duplicate_threshold" INTEGER NOT NULL DEFAULT 3,
    "action" TEXT NOT NULL DEFAULT 'timeout',
    "timeout_duration_ms" BIGINT NOT NULL DEFAULT 300000,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "spam_settings_pkey" PRIMARY KEY ("guild_id")
);

-- CreateTable
CREATE TABLE "moderation_settings" (
    "guild_id" TEXT NOT NULL,
    "enable_word_filter" BOOLEAN NOT NULL DEFAULT true,
    "enable_invite_filter" BOOLEAN NOT NULL DEFAULT false,
    "enable_spam_filter" BOOLEAN NOT NULL DEFAULT true,
    "log_channel_id" TEXT,
    "exempt_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exempt_channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_invites" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "invite_action" TEXT NOT NULL DEFAULT 'delete',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "moderation_settings_pkey" PRIMARY KEY ("guild_id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "quote_number" INTEGER NOT NULL,
    "quote_text" TEXT NOT NULL,
    "source_message_id" TEXT,
    "source_channel_id" TEXT,
    "source_message_url" TEXT,
    "source_author_id" TEXT,
    "source_author_name" TEXT,
    "registered_by_id" TEXT NOT NULL,
    "registered_by_name" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'public',
    "is_nsfw" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lfg_posts" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "max_players" INTEGER NOT NULL DEFAULT 5,
    "start_time" TIMESTAMP(3),
    "channel_id" TEXT NOT NULL,
    "message_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lfg_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lfg_participants" (
    "lfg_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'joined',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lfg_participants_pkey" PRIMARY KEY ("lfg_id","user_id")
);

-- CreateTable
CREATE TABLE "team_split_sessions" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "team_count" INTEGER NOT NULL DEFAULT 2,
    "mode" TEXT NOT NULL DEFAULT 'random',
    "participants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "teams" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_split_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_contents" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "schedule_time" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tokyo',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_contents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_guild_id_created_at_idx" ON "audit_logs"("guild_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_guild_id_event_idx" ON "audit_logs"("guild_id", "event");

-- CreateIndex
CREATE INDEX "audit_logs_guild_id_actor_id_idx" ON "audit_logs"("guild_id", "actor_id");

-- CreateIndex
CREATE INDEX "rules_guild_id_enabled_idx" ON "rules"("guild_id", "enabled");

-- CreateIndex
CREATE INDEX "rule_execution_logs_guild_id_executed_at_idx" ON "rule_execution_logs"("guild_id", "executed_at" DESC);

-- CreateIndex
CREATE INDEX "auto_responses_guild_id_enabled_idx" ON "auto_responses"("guild_id", "enabled");

-- CreateIndex
CREATE INDEX "mod_actions_guild_id_target_id_idx" ON "mod_actions"("guild_id", "target_id");

-- CreateIndex
CREATE INDEX "word_filters_guild_id_enabled_idx" ON "word_filters"("guild_id", "enabled");

-- CreateIndex
CREATE INDEX "quotes_guild_id_status_idx" ON "quotes"("guild_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_guild_id_quote_number_key" ON "quotes"("guild_id", "quote_number");

-- CreateIndex
CREATE INDEX "lfg_posts_guild_id_status_idx" ON "lfg_posts"("guild_id", "status");

-- CreateIndex
CREATE INDEX "team_split_sessions_guild_id_created_at_idx" ON "team_split_sessions"("guild_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "daily_contents_guild_id_enabled_idx" ON "daily_contents"("guild_id", "enabled");

-- AddForeignKey
ALTER TABLE "guild_settings" ADD CONSTRAINT "guild_settings_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_guild_id_user_id_fkey" FOREIGN KEY ("guild_id", "user_id") REFERENCES "guild_members"("guild_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_plugins" ADD CONSTRAINT "guild_plugins_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_plugins" ADD CONSTRAINT "guild_plugins_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_plugin_config_history" ADD CONSTRAINT "guild_plugin_config_history_guild_id_plugin_id_fkey" FOREIGN KEY ("guild_id", "plugin_id") REFERENCES "guild_plugins"("guild_id", "plugin_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_execution_logs" ADD CONSTRAINT "rule_execution_logs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lfg_participants" ADD CONSTRAINT "lfg_participants_lfg_id_fkey" FOREIGN KEY ("lfg_id") REFERENCES "lfg_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

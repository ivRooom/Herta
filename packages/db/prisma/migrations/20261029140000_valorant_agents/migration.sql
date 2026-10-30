-- Additive only: existing plugin configuration and all existing tables remain intact.
BEGIN;
CREATE TABLE "valorant_rosters" (
  "guild_id" TEXT NOT NULL PRIMARY KEY,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "valorant_rosters_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "valorant_agents" (
  "guild_id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "agent_name" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "valorant_agents_pkey" PRIMARY KEY ("guild_id", "agent_id"),
  CONSTRAINT "valorant_agents_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "valorant_rosters"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "valorant_agents_guild_id_agent_name_key" ON "valorant_agents"("guild_id", "agent_name");
CREATE INDEX "valorant_agents_guild_id_enabled_idx" ON "valorant_agents"("guild_id", "enabled");
COMMIT;

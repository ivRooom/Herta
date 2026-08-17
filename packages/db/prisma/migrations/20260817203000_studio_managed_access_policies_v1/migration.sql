CREATE TABLE "studio_access_policies" (
  "id" UUID NOT NULL,
  "guild_id" TEXT NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "description" VARCHAR(500),
  "document" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "studio_access_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "studio_access_policies_guild_id_name_key"
  ON "studio_access_policies"("guild_id", "name");
CREATE INDEX "studio_access_policies_guild_id_updated_at_idx"
  ON "studio_access_policies"("guild_id", "updated_at" DESC);

CREATE TABLE "studio_access_groups" (
  "id" UUID NOT NULL,
  "guild_id" TEXT NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "description" VARCHAR(500),
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "studio_access_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "studio_access_groups_guild_id_name_key"
  ON "studio_access_groups"("guild_id", "name");
CREATE INDEX "studio_access_groups_guild_id_updated_at_idx"
  ON "studio_access_groups"("guild_id", "updated_at" DESC);

CREATE TABLE "studio_access_group_members" (
  "group_id" UUID NOT NULL,
  "guild_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "studio_access_group_members_pkey" PRIMARY KEY ("group_id", "user_id"),
  CONSTRAINT "studio_access_group_members_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "studio_access_groups"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "studio_access_group_members_guild_id_user_id_idx"
  ON "studio_access_group_members"("guild_id", "user_id");

CREATE TABLE "studio_access_policy_attachments" (
  "id" UUID NOT NULL,
  "policy_id" UUID NOT NULL,
  "guild_id" TEXT NOT NULL,
  "principal_type" VARCHAR(16) NOT NULL,
  "principal_id" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "studio_access_policy_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_access_policy_attachments_policy_id_fkey"
    FOREIGN KEY ("policy_id") REFERENCES "studio_access_policies"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "studio_access_policy_attachments_principal_type_check"
    CHECK ("principal_type" IN ('role', 'user', 'group'))
);

CREATE UNIQUE INDEX "studio_access_policy_attachments_policy_principal_key"
  ON "studio_access_policy_attachments"("policy_id", "principal_type", "principal_id");
CREATE INDEX "studio_access_policy_attachments_guild_principal_idx"
  ON "studio_access_policy_attachments"("guild_id", "principal_type", "principal_id");
CREATE INDEX "studio_access_policy_attachments_guild_policy_idx"
  ON "studio_access_policy_attachments"("guild_id", "policy_id");

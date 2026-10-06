-- CreateTable
CREATE TABLE "valorant_account_links" (
    "guild_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "riot_name" VARCHAR(16) NOT NULL,
    "riot_tag" VARCHAR(8) NOT NULL,
    "region" VARCHAR(8) NOT NULL,
    "linked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "valorant_account_links_pkey" PRIMARY KEY ("guild_id","user_id")
);

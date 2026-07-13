-- OAuthの /users/@me/guilds では、ログインユーザーがオーナーでない場合に
-- 実際のGuild owner IDを取得できない。
-- 不明値を空文字で保持せずNULLとして扱う。
UPDATE "guilds"
SET "owner_id" = NULL
WHERE "owner_id" = '';

ALTER TABLE "guilds"
ALTER COLUMN "owner_id" DROP NOT NULL;

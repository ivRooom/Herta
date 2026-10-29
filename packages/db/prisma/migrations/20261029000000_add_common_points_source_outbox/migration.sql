-- Expand only. No source backfill, policy enablement, wallet writes or delivery.
BEGIN;
CREATE TABLE common_points_policies (
  guild_id TEXT PRIMARY KEY,
  epoch UUID NOT NULL,
  rule_version TEXT NOT NULL CHECK (rule_version ~ '^[a-f0-9]{64}$'),
  tariff_json TEXT NOT NULL,
  cutoff_at TIMESTAMPTZ(3) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  baseline_complete BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (NOT enabled OR baseline_complete)
);
CREATE TABLE common_points_daily_counters (
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  activity_day DATE NOT NULL,
  metric TEXT NOT NULL,
  units BIGINT NOT NULL CHECK (units >= 0),
  PRIMARY KEY (guild_id,discord_user_id,activity_day,metric)
);
CREATE TABLE common_points_source_receipts (
  id UUID PRIMARY KEY,
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  source_id TEXT NOT NULL,
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  credited_points BIGINT NOT NULL CHECK (credited_points BETWEEN 0 AND 64000000),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX common_points_source_identity_key
  ON common_points_source_receipts(guild_id,discord_user_id,metric,source_id);
CREATE TABLE common_points_outbox (
  id UUID PRIMARY KEY,
  source_receipt_id UUID NOT NULL,
  earning_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (octet_length(body) <= 8192),
  body_sha256 TEXT NOT NULL CHECK (body_sha256 ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','acked','quarantined')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ(3),
  acknowledged_at TIMESTAMPTZ(3),
  last_error_code TEXT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT common_points_outbox_source_receipt_id_fkey FOREIGN KEY (source_receipt_id)
    REFERENCES common_points_source_receipts(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX common_points_outbox_earning_id_key ON common_points_outbox(earning_id);
CREATE INDEX common_points_outbox_status_next_attempt_at_idx ON common_points_outbox(status,next_attempt_at);

CREATE FUNCTION guard_common_points_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.guild_id,NEW.epoch,NEW.rule_version,NEW.tariff_json,NEW.cutoff_at)
    IS DISTINCT FROM (OLD.guild_id,OLD.epoch,OLD.rule_version,OLD.tariff_json,OLD.cutoff_at)
  THEN RAISE EXCEPTION 'common_points_policy_is_frozen'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER common_points_policy_frozen BEFORE UPDATE ON common_points_policies
  FOR EACH ROW EXECUTE FUNCTION guard_common_points_policy();
CREATE FUNCTION guard_common_points_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'common_points_history_is_immutable'; END $$;
CREATE TRIGGER common_points_policy_no_delete BEFORE DELETE ON common_points_policies
  FOR EACH ROW EXECUTE FUNCTION guard_common_points_history();
CREATE TRIGGER common_points_policy_no_truncate BEFORE TRUNCATE ON common_points_policies
  FOR EACH STATEMENT EXECUTE FUNCTION guard_common_points_history();
CREATE TRIGGER common_points_counters_no_delete BEFORE DELETE ON common_points_daily_counters
  FOR EACH ROW EXECUTE FUNCTION guard_common_points_history();
CREATE TRIGGER common_points_counters_no_truncate BEFORE TRUNCATE ON common_points_daily_counters
  FOR EACH STATEMENT EXECUTE FUNCTION guard_common_points_history();
CREATE FUNCTION guard_common_points_counter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.guild_id,NEW.discord_user_id,NEW.activity_day,NEW.metric)
    IS DISTINCT FROM (OLD.guild_id,OLD.discord_user_id,OLD.activity_day,OLD.metric)
    OR NEW.units < OLD.units
  THEN RAISE EXCEPTION 'common_points_counter_cannot_reset'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER common_points_counters_monotonic BEFORE UPDATE ON common_points_daily_counters
  FOR EACH ROW EXECUTE FUNCTION guard_common_points_counter();
CREATE TRIGGER common_points_receipts_immutable BEFORE UPDATE OR DELETE ON common_points_source_receipts
  FOR EACH ROW EXECUTE FUNCTION guard_common_points_history();
CREATE TRIGGER common_points_receipts_no_truncate BEFORE TRUNCATE ON common_points_source_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION guard_common_points_history();
CREATE FUNCTION guard_common_points_outbox_payload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.source_receipt_id,NEW.earning_id,NEW.body,NEW.body_sha256,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.source_receipt_id,OLD.earning_id,OLD.body,OLD.body_sha256,OLD.created_at)
  THEN RAISE EXCEPTION 'common_points_outbox_payload_is_immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER common_points_outbox_payload_frozen BEFORE UPDATE ON common_points_outbox
  FOR EACH ROW EXECUTE FUNCTION guard_common_points_outbox_payload();
CREATE TRIGGER common_points_outbox_no_delete BEFORE DELETE ON common_points_outbox
  FOR EACH ROW EXECUTE FUNCTION guard_common_points_history();
CREATE TRIGGER common_points_outbox_no_truncate BEFORE TRUNCATE ON common_points_outbox
  FOR EACH STATEMENT EXECUTE FUNCTION guard_common_points_history();
COMMIT;

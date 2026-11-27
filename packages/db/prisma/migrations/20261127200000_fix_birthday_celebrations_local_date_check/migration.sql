-- Fix the local_date CHECK on "birthday_celebrations".
--
-- The creating migration (20260819095000_birthday_card_v2) wrote the
-- pattern with doubled backslashes: '^\\d{4}-\\d{2}-\\d{2}$'. A plain
-- SQL string literal does not process backslash escapes
-- (standard_conforming_strings = on), so the stored pattern matches a
-- literal backslash followed by "d" and rejects every real date such
-- as '2026-11-27'. Every birthday cycle therefore fails at the
-- celebration upsert (SQLSTATE 23514) before any delivery happens.
--
-- Recreate the constraint with the intended pattern (single
-- backslashes, same shape as the daily_bonus target_date check). The
-- table is empty, so the new constraint validates instantly, and any
-- row that could exist holds a real date, which the corrected
-- pattern accepts. DROP ... IF EXISTS keeps this file safe to
-- re-run by hand; Prisma itself applies it exactly once.

ALTER TABLE "birthday_celebrations"
DROP CONSTRAINT IF EXISTS "birthday_celebrations_local_date_check";

ALTER TABLE "birthday_celebrations"
ADD CONSTRAINT "birthday_celebrations_local_date_check"
CHECK ("local_date" ~ '^\d{4}-\d{2}-\d{2}$');

-- Retire the Herta-side anniversary bank (#880).
-- The source of truth for "today in history" moved to ivrm-web
-- Today-in-History; the two production rows were migrated there
-- before this drop (pending review in the Web bank).
DROP TABLE "anniversary_events";

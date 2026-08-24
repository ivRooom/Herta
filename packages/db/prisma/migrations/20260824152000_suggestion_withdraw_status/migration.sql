ALTER TABLE "suggestions"
  DROP CONSTRAINT "suggestions_status_check";

ALTER TABLE "suggestions"
  ADD CONSTRAINT "suggestions_status_check"
  CHECK ("status" IN ('pending', 'reviewing', 'accepted', 'rejected', 'completed', 'withdrawn'));

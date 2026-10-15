-- Apply before deploying the expanded question bank. Existing IDs remain unchanged.
ALTER TABLE "mbti_question_answer_events"
  DROP CONSTRAINT "mbti_question_answer_events_question_index_check",
  ADD CONSTRAINT "mbti_question_answer_events_question_index_check"
    CHECK ("question_index" >= 0);

CREATE TABLE "mbti_quiz_result_events" (
    "id" TEXT NOT NULL,
    "completion_id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "result_type" TEXT NOT NULL,
    "ei_score" INTEGER NOT NULL,
    "sn_score" INTEGER NOT NULL,
    "tf_score" INTEGER NOT NULL,
    "jp_score" INTEGER NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mbti_quiz_result_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mbti_quiz_result_events_result_type_check"
        CHECK ("result_type" IN (
            'INTJ', 'INTP', 'ENTJ', 'ENTP',
            'INFJ', 'INFP', 'ENFJ', 'ENFP',
            'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
            'ISTP', 'ISFP', 'ESTP', 'ESFP'
        )),
    CONSTRAINT "mbti_quiz_result_events_ei_score_check"
        CHECK ("ei_score" >= -30 AND "ei_score" <= 30),
    CONSTRAINT "mbti_quiz_result_events_sn_score_check"
        CHECK ("sn_score" >= -30 AND "sn_score" <= 30),
    CONSTRAINT "mbti_quiz_result_events_tf_score_check"
        CHECK ("tf_score" >= -30 AND "tf_score" <= 30),
    CONSTRAINT "mbti_quiz_result_events_jp_score_check"
        CHECK ("jp_score" >= -30 AND "jp_score" <= 30)
);

CREATE INDEX "mbti_quiz_result_events_completed_at_idx"
    ON "mbti_quiz_result_events" ("completed_at" DESC);

CREATE INDEX "mbti_quiz_result_events_guild_id_completed_at_idx"
    ON "mbti_quiz_result_events" ("guild_id", "completed_at" DESC);

CREATE INDEX "mbti_quiz_result_events_result_type_completed_at_idx"
    ON "mbti_quiz_result_events" ("result_type", "completed_at" DESC);

CREATE TABLE "mbti_question_answer_events" (
    "id" TEXT NOT NULL,
    "completion_id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "question_index" INTEGER NOT NULL,
    "axis" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "answered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mbti_question_answer_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mbti_question_answer_events_axis_check"
        CHECK ("axis" IN ('EI', 'SN', 'TF', 'JP')),
    CONSTRAINT "mbti_question_answer_events_answer_check"
        CHECK ("answer" IN ('agree', 'slightly_agree', 'neutral', 'slightly_disagree', 'disagree')),
    CONSTRAINT "mbti_question_answer_events_question_index_check"
        CHECK ("question_index" >= 0 AND "question_index" < 100)
);

CREATE INDEX "mbti_question_answer_events_completion_id_idx"
    ON "mbti_question_answer_events" ("completion_id");

CREATE INDEX "mbti_question_answer_events_guild_id_answered_at_idx"
    ON "mbti_question_answer_events" ("guild_id", "answered_at" DESC);

CREATE INDEX "mbti_question_answer_events_question_index_answer_idx"
    ON "mbti_question_answer_events" ("question_index", "answer");

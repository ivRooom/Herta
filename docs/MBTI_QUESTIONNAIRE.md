# MBTI-style questionnaire v2

## Scope and interpretation

This is Herta's original, recreational personality questionnaire. It is not an official MBTI instrument or the 16Personalities assessment. More questions and balanced sampling are engineering improvements, not evidence of equal validity, reliability, or diagnostic accuracy. Percentages are normalized answer scores, not probabilities or population percentiles. The existing zero-score tie rule remains for role compatibility; a near-midpoint result should not be treated as a strong preference.

References: [16Personalities framework](https://www.16personalities.com/articles/our-theory), [Myers & Briggs Foundation reliability and validity](https://myersbriggs.org/research-and-library/validity-reliability/).

## Item bank and sampling

- Retain IDs 0–123 and their wording for historical compatibility. New sessions use 520 original items, IDs 124–643. Never reuse IDs or change the meaning/direction of an existing item; append a new ID instead.
- Each of five axes has four facets, each with 13 positive and 13 reverse-keyed items. The facet names describe coverage, not validated subscales.
- EI: social energy, conversational initiative, expression/thinking aloud, breadth of interaction.
- SN: concrete/general information, detail/pattern attention, practical/possible ideas, experiential/conceptual learning.
- TF: decision criteria, feedback, fairness, priorities. Neither pole implies greater intelligence, kindness, or competence.
- JP: planning, closure, structure, flexibility.
- AT: recovery, self-trust, evaluation sensitivity, uncertainty. This is the separate Identity axis, not an official MBTI dimension or a mental-health assessment.
- Sample three items per facet, including both directions. Alternate 2:1/1:2 direction counts between facets, giving six positive and six reverse-keyed items per axis. Add one remaining item for EI/SN, preserving 13/13/12/12/12 = 62 total.
- Shuffle items and order once when creating a session. Save prompt, fixed ID, facet and scoring direction in the session. Refreshing/resuming never redraws questions. Random selection allows variation, not a guarantee that every person's set is globally unique.
- Both Web and Discord use `scoreMbtiAnswer`: Likert weight × saved direction. Missing direction defaults to +1 for old sessions. The 62-item denominator and existing role/type rules remain unchanged.
- Analytics stores raw responses under stable IDs. A raw agreement on a reverse-keyed item is not agreement with the positive pole; use the saved axis scores or item direction for interpretation.

## Deploy and rollback

1. Back up `mbti_question_answer_events` and verify the database restore procedure before applying a migration.
2. Apply `20261015000000_expand_mbti_question_ids` through the normal reviewed deployment workflow before deploying the new bank. It removes the old ID <100 restriction; it does not rewrite or delete data. No database migration has been applied as part of local implementation.
3. Deploy shared, bot and Studio together. The new bank is consumed by both clients. Existing session snapshots continue with their original scoring.
4. Prefer rolling back application code while leaving the permissive nonnegative-ID constraint in place. The previous analytics normalizer caps IDs at 99: when rolling back, retain the ID-preservation patch or let new-bank sessions expire before resuming old completion handlers. Do not restore the <100 constraint while expanded IDs exist; verify the data and backup/restore plan first. Do not delete expanded-ID rows merely to make a rollback fit.

## Validation before accuracy claims

The current item bank is editorially authored and uncalibrated. Before claiming increased measurement accuracy, run a consent-based pilot and expert review: comprehension of Japanese wording, item discrimination and redundancy, internal consistency, test–retest stability, factor structure/cross-loadings, subgroup fairness and alternate-form equivalence. Examine reverse-wording effects and social-desirability bias. Do not infer calibration from unit tests or assign invented confidence probabilities. Do not silently repurpose historical responses or collect additional personal data for validation.

## Report, image export and sharing

The result page, revisited completed-session page and public snapshot page use the same report generator. It includes five bipolar percentages with descriptions and four sections of practical advice (strengths, cautions, communication, everyday actions). Axes within 5 percentage points of the midpoint use balanced explanations and advice instead of asserting one pole. This editorial boundary is not a statistical confidence interval.

PNG export is generated locally in the browser with Canvas, using the same report data, with no screenshot library, paid API or external image service. It includes the full report, not just the type label. User-triggered download produces a PNG file.

User-triggered sharing constructs `/mbti/result?v=1&ei=...&sn=...&tf=...&jp=...&at=...`. It includes only five aggregate scores, never the session token, user/guild IDs, raw answers or role notes. Shared links can be opened after the private session expires. They are editable, unauthenticated snapshots, explicitly identified as such in the UI, and must never be used for role assignment, sync, awards or other trusted completion flows. They cannot be revoked individually because no server-side share record is created. Unknown versions, duplicate/missing keys, noninteger and out-of-range scores are rejected. Result and private-session pages request no indexing and no referrer disclosure.

## Resume behavior

New private quiz links expire 24 hours after creation; existing links keep their original expiry. Each successful answer saves the frozen session and scores to the database before the UI advances. The UI shows the number confirmed saved and the actual deadline. Unsaved or offline selections are not reported as saved. Reopening the same private link loads the saved answer count; a new `/mbti` link starts a separate diagnosis. Browser storage is not required. Requests use `keepalive` for navigation/close, subject to normal browser/network limitations.

Appending an answer uses an atomic previous-answer snapshot and expiry guard, preventing stale tabs from overwriting newer progress. Replaying the same already-saved answer returns current progress without scoring it twice; conflicting answers require a reload. After the last answer, completion can be retried or resumed without another answer. Repeating a completed `/complete` request returns the stored result without repeating side effects. No live database migration or cloud deployment was performed during local implementation. The existing retention/pruning policy remains unchanged.

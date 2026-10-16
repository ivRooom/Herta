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

## Personality artwork

The report hero and exported PNG use the same reference-inspired chibi Herta illustration doodle atlas at `apps/studio/public/mbti/herta-doodles-v3.webp`. It contains 16 chibi Herta poses with distinct expressions and personality props in a stable 4×4 order defined in `apps/studio/src/lib/mbti-artwork.ts`. Each type has its own descriptive alternative text and one of four accent palettes. The purple/lavender hand-drawn treatment follows the supplied Herta reference. The imagery is decorative interpretation, not additional assessment data. A/T variants share their four-letter type artwork.

The single WebP is approximately 399KB, served from the existing app with no image-generation API at runtime or new infrastructure. The exported PNG loads it from the same origin with a bounded timeout; if unavailable, the complete text report can still be saved. Gentle motion respects reduced-motion preferences. Illustration pixels, all 16 tile mappings, export fallback and responsive behavior are covered by browser checks.

## 落書き風画像とアニメーション（v3）

既定画像は `apps/studio/public/mbti/herta-doodles-v3.webp`。16タイプの順序・小道具を維持し、ラフな線と色鉛筆風の質感を加えた。画面とPNGは同じアトラスを使う。

前の候補画像 `apps/studio/public/mbti/herta-personalities-v2.webp` は上書きせず保存している（SHA256: `BA04A2147B8C6FE144B1223436A29BC537F5775A4BFF1BC21FF0DEC792F36CC2`）。戻す場合は `mbti-artwork.ts` の `MBTI_ARTWORK_URL` をv2へ戻し、E2Eの画像失敗テストの対象URLも合わせる。

Image Gen組み込みツールによる編集。プロンプト要旨: 4×4配置と16ポーズ、Hertaの髪・帽子・衣装を維持し、ゆるい鉛筆線、淡い紫とピンクのマーカー、星やハートの落書きへ変換。文字なし、背景#101620、タイル間の余白を維持。

結果の登場、キャラクターのホバー、装飾、スクロール時のセクションとバーにCSSアニメーションを使う。IntersectionObserverは一度だけ発火し、解除する。JSやObserverがなくても本文は常に読める。`prefers-reduced-motion: reduce` では全て停止し、バーは最終値を表示する。

## 出題順と解釈の改善

62問の軸・観点・正逆方向の数と採点は維持し、軸別のシャッフル済みキューを交互に出題する。同じ軸が隣接しないようラウンド境界も調整する。保存済みのセッションは再抽選しない。回答前には最近数か月の普段の自分を思い出すよう案内し、理想像や一日の気分への偏りを抑える。

Web・Discord・PNGのレポートに、1問の回答が最大4点変化した場合の分類境界チェックと近い別タイプを追加。0点を正の極とする既存ルールを尊重するため、単なる絶対値ではなく±4点の両端を比較する。これは集計スコアに対する感度分析で、実際に変更できる特定の回答の特定や、再検査信頼性・信頼区間・確率を意味しない。

測定精度を検証する次段階は、任意参加と用途説明の上でのパイロット、専門家による文面レビュー、項目識別力・重複・正逆表現効果・内的一貫性・数週間後の再検査・別フォーム間の比較。過去の回答を無断で再利用して校正済みと扱わない。参考: [MBTIの妥当性・信頼性](https://myersbriggs.org/research-and-library/validity-reliability/)、[16Personalitiesのモデル](https://www.16personalities.com/articles/our-theory)。現時点で本家同等の精度が実証されたものではない。

## 個人の最新結果・履歴と比較 (2026-10-16)

- `/mbti-result` はサーバー内の本人の最新結果を表示し、詳細・履歴ページの30分有効URLを本人だけに発行する。`view:history` は履歴、既定は最新の詳細へ移動する。URLは所持者が閲覧できるため共有しない。再発行で以前のURLを無効化し、DBはSHA256ハッシュだけを保存する。ページはno-store / no-referrer / noindex。
- `MbtiPersonalResult` に診断完了ごとのタイプ・Identity・5軸スコア・保存時の割合・採点方式・設問数・日時を記録する。ユーザー名や個別回答を複製しない。本人の最新値はguildId/discordUserId内のcompletedAt/id降順で決め、遅い保存で過去の値へ戻さない。再診断でも履歴は消さず、ivrm-webへの既存プロフィール上書き同期とRole更新を維持する。
- Discord/Web双方で履歴と匿名統計を同一トランザクションで保存する。completionKeyの一意制約で再送を二重計上しない。統計は人ごとの最新値へ置換せず、完了した診断ごとに蓄積する。匿名イベントの既存保持期間365日は変更しない。個人履歴は回答セッションの期限・pruneから独立して保持する。
- 比較は任意の保存結果を選択でき、既定は手動訂正を除いた、同じ採点方式の直前の診断。5軸の百分率の差・境界をまたいだ変化・最も大きな変化を示す。優劣や臨床的な変化とは断定しない。採点方式が異なる結果の数値差は表示しない。履歴は20件単位のkeyset pagination。結果・比較対象・cursorすべて本人とサーバーの範囲で照合する。
- 履歴ページからもPNG保存と共有URL発行が可能。共有URLは従来どおり5軸スコアだけで、履歴トークンや本人IDを含めない。

Migration: `20261016110000_add_mbti_personal_history`。テーブル・indexの追加と、DBに残っている完了済み62問Webセッションのコピーのみ。統計を再計上せず、既存行を更新・削除しない。採点軸の数・値を検証できない旧形式は復元しない。過去のDiscord診断は匿名統計しかなく、本人へ紐付けて復元できない。

Rollback: 直前のアプリイメージへ戻し、追加テーブルは残す。履歴を削除するdown migrationは通常のrollbackで行わない。新規のcloud resource、secret、画像APIは不要。

検証:

- 実PostgreSQL: `HERTA_MBTI_HISTORY_TEST_DATABASE_URL` をlocalhostの専用 `mbti_personal_test` DBに指定し、`pnpm --filter @herta/db exec tsx --test src/mbti-personal-results.integration.test.ts`。このテストは専用DBの新規履歴テーブルを作り直すため、共有DB・本番へ向けない。事前スキーマは変更前のschemaを `prisma db push --skip-generate` で専用DBへ用意する。既存の全migrationを空DBへ順に適用する方法は、古いCONCURRENTLY migrationで失敗する。
- Playwright: 同じ専用DBを `DATABASE_URL` に指定してStudioを起動し、`HERTA_MBTI_HISTORY_E2E=1 pnpm --filter @herta/studio exec playwright test e2e/mbti-history.spec.ts`。Browser plugin not availableのためregular Playwrightを使用。PC/スマホ、比較変更、過去レポート、共有URL、他人のID、リンク失効を確認。

手動訂正は `source=correction` / `scoringVersion=manual-correction-v1` / `questionCount=0` として診断とは別に記録する。スコア・割合は空オブジェクトとし、回答や統計を捏造・再計上しない。過去の回答結果を上書きせず、新しい訂正記録が最新値になる。A/Tの訂正指定がない場合は既存の診断値を保持する。画面では手動訂正と明記し、数値比較・採点レポートの対象から外す。

本人が過去結果からの推定登録を明示的に依頼した場合は、`source=estimate` / `scoringVersion=historical-estimate-v1` / `questionCount=0` の別記録にする。直近の実測62問の各軸の絶対スコアを、指定されたタイプの符号へ合わせる。中立の0は指定側へ最小単位の1を仮置きし、A/Tは保持する。`scores.provenance` に基にした履歴IDと算出方法を保存する。推定値は実測ではなく、診断間の数値比較・実測レポート・匿名診断統計に含めない。元の履歴は更新しない。登録前に対象履歴をバックアップし、rollbackは追加した推定記録だけを対象として元の履歴を残す。

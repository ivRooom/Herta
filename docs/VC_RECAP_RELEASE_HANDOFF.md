# Herta VC Recap｜実装状況・残課題・リリース判断（2026-11-01）

> **2026-11-04 仕様更新（この節を最新の設計方針として優先）:** 新しい長期保存・話者別録音の本人同意は、3つの利用目的をそれぞれ明示する**単一の版管理済みPrivacy Policyへの本人1回の明示同意**を基本とする。11月1日の「3目的を別々にチェックして同意」は過去の検討経緯であり、今後の実装要件ではない。旧30日同意や管理者・ロールからの自動移行は禁止。詳細とリリースブロッカーは [#696](https://github.com/ivRooom/Herta/issues/696)、[#646](https://github.com/ivRooom/Herta/issues/646)。
>
> **重要:** これは将来の設計方針であり、**本番実装・録音/長期保存・Feature Flag有効化が済んだという意味ではない**。現行の3目的選択UI/API・既存30日文字起こし経路・正式な4言語Privacyは、レビューと技術実装が完了するまで現状維持。単一同意が法令/Discord規約に適合するかは人間の公開承認が必要。

## 2026-11-04 現行実装との差分と公開ゲート

- **To-Be:** 本人の1回の同意操作で `transcription` / `transcript_long_term` / `audio_long_term` の3つの内部権限を同一ポリシー版・単一DBトランザクション・本人owner lock下で原子的に記録する。目的・処理先・保存場所/期間・削除/撤回・復元時の再適用を1画面に明示する。
- **As-Is:** mainの新しい長期保存用UI/DB基盤は目的ごとに選択する構成。長期保存・話者別音声永続保存は未提供で、録音コードやアーカイブWorkerには未接続。旧30日経路のAWS Transcribe/本文条件付き30日/生音声永続保存なしを維持。
- **依存:** [#696](https://github.com/ivRooom/Herta/issues/696) 単一同意整合 → [#617](https://github.com/ivRooom/Herta/issues/617) / [#694](https://github.com/ivRooom/Herta/issues/694) / [#695](https://github.com/ivRooom/Herta/issues/695) の独立削除/隔離復元 → [#518](https://github.com/ivRooom/Herta/issues/518) 実Discord本人E2E → [#646](https://github.com/ivRooom/Herta/issues/646) 公式Privacy/費用/IAM/運営者の公開Go/No-Go。
- **同意と削除:** 同意拒否・撤回は即時の新規取得/保存停止であり、過去コピーの本人削除要求とは別。削除の完全性は全S3 Version、派生物、Queue、Backup Restore後再適用で検証する。実証前に「完全削除」を表示しない。
- **ロールバック:** 新機能FlagをOFFで維持。破壊的Migration、既存30日データの保存延長、旧同意の流用、無承認のAWS変更は行わない。旧Draft [PR #685](https://github.com/ivRooom/Herta/pull/685) は closed/unmerged で、無検証再利用しない。
- **検証:** Typecheck/Unit/隔離PostgreSQL競合と同意版/拒否/撤回/二重送信/削除fence/他Guild拒否、CI/Review/Discord本人実機。目的をひとつしか取得できないDB失敗時は全面拒否（fail closed）。

## 2026-11-04 現行実装との差分と公開ゲート

- **To-Be:** 本人の1回の同意操作で `transcription` / `transcript_long_term` / `audio_long_term` の3つの内部権限を同一ポリシー版・単一DBトランザクション・本人owner lock下で原子的に記録する。目的・処理先・保存場所/期間・削除/撤回・復元時の再適用を1画面に明示する。
- **As-Is:** mainの新しい長期保存用UI/DB基盤は目的ごとに選択する構成。長期保存・話者別音声永続保存は未提供で、録音コードやアーカイブWorkerには未接続。旧30日経路のAWS Transcribe/本文条件付き30日/生音声永続保存なしを維持。
- **依存:** [#696](https://github.com/ivRooom/Herta/issues/696) 単一同意整合 → [#617](https://github.com/ivRooom/Herta/issues/617) / [#694](https://github.com/ivRooom/Herta/issues/694) / [#695](https://github.com/ivRooom/Herta/issues/695) の独立削除/隔離復元 → [#518](https://github.com/ivRooom/Herta/issues/518) 実Discord本人E2E → [#646](https://github.com/ivRooom/Herta/issues/646) 公式Privacy/費用/IAM/運営者の公開Go/No-Go。
- **同意と削除:** 同意拒否・撤回は即時の新規取得/保存停止であり、過去コピーの本人削除要求とは別。削除の完全性は全S3 Version、派生物、Queue、Backup Restore後再適用で検証する。実証前に「完全削除」を表示しない。
- **ロールバック:** 新機能FlagをOFFで維持。破壊的Migration、既存30日データの保存延長、旧同意の流用、無承認のAWS変更は行わない。旧Draft [PR #685](https://github.com/ivRooom/Herta/pull/685) は closed/unmerged で、無検証再利用しない。
- **検証:** Typecheck/Unit/隔離PostgreSQL競合と同意版/拒否/撤回/二重送信/削除fence/他Guild拒否、CI/Review/Discord本人実機。目的をひとつしか取得できないDB失敗時は全面拒否（fail closed）。


> 正本: [開発順序 Herta #691](https://github.com/ivRooom/Herta/issues/691) / [最終Go判定 #646](https://github.com/ivRooom/Herta/issues/646)。動的なGitHub PR/Actionsと本番AWSの実測をこの静的文書より優先する。個人データ・Secret・実際の録音はここに記載しない。

## 結論

**現行30日保持のAWS Transcribe経路は継続。新しい本人長期保存/話者別録音/Whisperによる本番変更はNo-Go。** 将来仕様を現在の利用者への約束に混ぜない。新しい明示同意と削除要求の独立永続化・再適用・本人消去の検証が完了するまで、録音・無期限本文保持・IA Lifecycle・S3 delete sweep等を有効にしない。

## 最新確認の証跡

- Herta main `424cffe0c2108540a3f18d752e0a9a3187277a91`。同SHAの [CI #41297746075](https://github.com/ivRooom/Herta/actions/runs/41297746075)、[Deploy Production #41297746053](https://github.com/ivRooom/Herta/actions/runs/41297746053)、[Backup Restore #41297746029](https://github.com/ivRooom/Herta/actions/runs/41297746029) は成功。**ワークフロー成功と実コンテナの稼働SHAは区別する**。今回の実ホスト/環境変数のread-only照合は未実施。
- mainには [#585](https://github.com/ivRooom/Herta/issues/585) からチャット吹き出しUI（PR #602）、現行30日PostgreSQLデータのJSON/CSVとGuild IAM認可（PR #603/#606）を実装済み。S3アーカイブ分、大容量stream、話者別音声/再生/Seekは未完成。
- faster-whisper CPU sidecar基盤（PR #653）はmainに取り込まれているが既定OFF。CER/RTF/RSS、実音声/現行ホスト性能の受入は [#577](https://github.com/ivRooom/Herta/issues/577) と [#518](https://github.com/ivRooom/Herta/issues/518) が未完了。
- 独立削除台帳と隔離復元DBの **read-only照合CLI** は [PR #690](https://github.com/ivRooom/Herta/pull/690) でmainへマージ済み。ただし台帳へのwrite-first永続記録、復元時再適用、VC配信停止、DB/S3全版消去を実装したことにはならない。
- [Draft PR #599](https://github.com/ivRooom/Herta/pull/599) は365日Hot/30日IAの設計、[Draft PR #639](https://github.com/ivRooom/Herta/pull/639) は音声IA opt-in IaCで、どちらも本番未有効化。
- [Herta Draft PR #685](https://github.com/ivRooom/Herta/pull/685)・[ivrm-web Draft PR #622](https://github.com/ivRooom/ivrm-web/pull/622) は**1回の包括同意**を前提とした未公開変更。今回指定の3用途独立同意と矛盾し、修正前のmerge禁止。

## 2026-11-01 の目的別同意（旧包括同意案より優先）

新規本人明示同意が必要な用途：

1. 文字起こし処理（外部認識エンジンの利用と要約の外部送信説明を含む）
2. 文字起こし本文の長期保存（0〜365日はPostgreSQL、検証後にS3へ。365日は削除期限ではない）
3. 話者別音声の録音・長期保存（録音開始から専用private S3 Standard、30日後の低頻度アクセスは料金検証後に決定）

**各用途は本人が個別に理解し選択できること。** 既存30日の同意・一般規約同意・管理者設定・自動同意ロールから新目的を推定・複製しない。本人の明示拒否と撤回を優先し、旧ポリシー版・欠落/不正な同意・消去要求が残る場合は新録音/本文長期保存を拒否する。本文長期保存のみは文字起こし処理同意との依存を明示し、音声の長期保存は別途同意させる。

現在mainの `apps/studio/src/components/long-term-consent-form.tsx` と `packages/db/src/vc-recap-explicit-consent.ts` は3選択の基盤を既に備える。今後の実装ではPR #685の包括同意への置換を採用せず、[#696](https://github.com/ivRooom/Herta/issues/696) の仕様を優先する。DB owner lock、同意撤回競合防止、拒否/削除フェンスと既存レガシーの安全改善は再利用する。

## 実装Issue・依存関係

- **P0｜目的別同意：** [#696](https://github.com/ivRooom/Herta/issues/696)・[#684](https://github.com/ivRooom/Herta/issues/684)・[#693](https://github.com/ivRooom/Herta/issues/693)・[Web #668](https://github.com/ivRooom/ivrm-web/issues/668)。UI/API/DB/DiscordとJA/EN/KO/ZHの3目的個別同意、版・拒否・撤回・実PG競合テストを一致させる。旧同意の流用なし。
- **P0｜独立消去・復元：** [#694](https://github.com/ivRooom/Herta/issues/694) → [#695](https://github.com/ivRooom/Herta/issues/695) → [#617](https://github.com/ivRooom/Herta/issues/617)。独立削除台帳とwrite-first、復元前配信遮断、DB/S3全Version/Multipart/コピー・共有要約・キャッシュ/バックアップ再消去。冪等・監査・リトライ。
- **P1｜保存とStudio：** [#583](https://github.com/ivRooom/Herta/issues/583)・[#584](https://github.com/ivRooom/Herta/issues/584)・[#585](https://github.com/ivRooom/Herta/issues/585)。話者別音声、offsetとsegment同期、検証付きArchive、認可付きアーカイブ閲覧・再生・シーク・大量エクスポート。
- **P1｜Whisper/料金：** [#577](https://github.com/ivRooom/Herta/issues/577)・[#578](https://github.com/ivRooom/Herta/issues/578)・[#638](https://github.com/ivRooom/Herta/issues/638)。許諾済み音声でのCER/RTF/RSS/CPU/RAM比較とIA小オブジェクト・取得費用比較。
- **Release｜本番承認：** [#580](https://github.com/ivRooom/Herta/issues/580)・[#518](https://github.com/ivRooom/Herta/issues/518)・[#646](https://github.com/ivRooom/Herta/issues/646)。CI・レビュー・Discord E2E・DR消去再適用・IAM/コスト・人間承認後に限定Guild Canary。

### アーカイブ/削除の最小安全条件

1. アーカイブ対象を抽出し、本人同意・削除要求・権限をフェンス確認。
2. S3書込み後、チェックサム・件数・manifestを検証。
3. DBに検証済みの参照情報をコミットした後、同意した本人の当該本文のみDBから削除（冪等・途中停止/再実行）。
4. Studioの配信・exportはDB hot/アーカイブのどちらもGuild IAMで保護し、本人の削除中/失効/未同意のデータを拒否。
5. 削除要求は独立台帳への永続記録・配信停止・S3全版/Multipart/キャッシュ/要約/DB/復元コピー・再照合後にのみ完了通知。
6. DRで古いDBに戻しても、外部台帳再適用/消去検証までVC保存・閲覧・出力を禁止する。

## 人間が実施する作業

- **H1 プライバシー:** [Web Draft #622](https://github.com/ivRooom/ivrm-web/pull/622) で4言語の目的別同意と処理先、保存・削除・バックアップ・サービス終了・法令/Discord規約をレビュー。正式policyVersion、発効日、承認者、修正点を [#646](https://github.com/ivRooom/Herta/issues/646) にコメント。**承認までは公開しない。**
- **H2 Discord:** 開発用隔離Guildと担当者を決め、全参加者から新仕様に沿った明示許諾を取得。実際の録音は私的な検証環境のみに置く。実施日、参加人数、成功/失敗項目だけを [#518](https://github.com/ivRooom/Herta/issues/518) に記録。
- **H3 AWS:** S3/IAM/外部台帳/CloudFormation change set、既存バックアップ/Restore可否、費用上限、Budgets、監視・停止担当・Rollbackを承認。月間セッション数・音声総分数・話者別オブジェクト数/サイズ・再生回数が不明なまま1/3/5年の確定価格を記載しない。
- **H4 リリース:** #694/#695/#617 の合成復元・全版消去と #518 の本人物理/Discord E2E、#577のモデル比較が合格したら、[#646](https://github.com/ivRooom/Herta/issues/646) にCanary Guild/時間・担当者・No-Go条件・Go承認を記録。まず限定Guildにのみ有効化し、異常時は保存を直ちにOFF。

## マージと本番チェックリスト

- [ ] この変更・機能変更が対応Issueへ先に登録されている
- [ ] mainとの差分、conflicts、mergeability、unresolved review、requested changesと脆弱性警告を再確認
- [ ] Format/Lint/Typecheck/単体/実PostgreSQL/S3合成/ARM64/Production Docker/安全性CIを該当範囲で成功
- [ ] DB migrationのBackup/Restoreとrollback・既存データに対する影響を確認
- [ ] Secrets/本人音声/IDをIssue/PR/CIへ出していない
- [ ] 本番Deploy workflowだけでなく実コンテナSHA/健康状態/フラグOFF/ログ/監視をread-onlyで確認
- [ ] 人間Goが無ければ長期保存/録音/削除Worker/Whisper/IAをOFFのまま維持

**人間承認を代行せず、設計を「実装済み」やワークフローSUCCESSを「新機能本番稼働」と書き換えない。**

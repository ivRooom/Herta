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

# VC Recap 長期保存・録音：同意受付の安全なリリース手順

## 現在の状態（2026-10-31）

- **長期保存・録音は未提供**。既存の30日本文保存と録音非永続化を変えない。
- `/consent/[token]` で将来の同意目的を3つ別々に表示。既存の同意は自動移行しない。
- 新しい同意の保存は、以下の両環境変数が一致しない限り API 側でも拒否（初期状態OFF）。
- 撤回は受付OFFでも処理でき、既存の新同意がある場合は削除障壁を登録し、全ての新目的の同意を無効化する。
- DBの削除障壁は**S3オブジェクト・全バージョン・バックアップが消去された証拠ではない**。

## 運用上の有効化ゲート（現時点では設定しない）

```text
VC_RECAP_LONG_TERM_ENROLLMENT_ENABLED=true
VC_RECAP_LONG_TERM_PUBLISHED_POLICY_VERSION=vc-recap-long-term-2026-10-30-v1
```

両方の一致が必要。変更前に、下記条件を必ず確認する。

1. 公式サイト `ivRooom/ivrm-web`・Herta Studioのプライバシーポリシーを公開し、版と説明内容が一致すること（現状Draft）。
2. 目的別の3同意・同意撤回・Discord音声入力中の即時停止・未同意者の除外・エクスポート・消去キューを実機で確認すること。
3. PostgreSQL／S3／S3全Version／復元コピー／共有要約／バックアップ復元時の削除再適用を実装・検証すること。
4. 運用監視・権限・IAM・経費・Canary・Rollbackおよび正式なデータ保持ポリシーの確認。
5. 版文字列を変更した際は古い版の同意を有効扱いしない。再同意が必要。

### 注意点

新しい同意が記録されても**現行レコーダー・アーカイブWorkerはこの同意を消費しない**ため、保存・録音が開始されたと説明しない。
新しい同意の一部を撤回すると、削除障壁を作成しすべての新目的を撤回する。削除障壁は自動解除しない。検証完了後の本人による再同意フローは別途整備する。

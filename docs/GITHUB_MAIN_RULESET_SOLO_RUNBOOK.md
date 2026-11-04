# Herta GitHub main Ruleset｜単独メンテナー運用

> 正本: [Issue #700](https://github.com/ivRooom/Herta/issues/700)。2026-11-04 の GitHub API にて、Herta は public、`main.protected=false`、Repository Rulesets は `[]`。**このJSONをgitへ追加しただけでは GitHub の保護は有効になりません。** Ruleset は GitHub 管理画面か管理者権限のあるAPIでインポートする必要があります。

## 2026-11-04 実環境確認：既存の有効Rulesetを更新（重複作成禁止）

> GitHub APIで**すでにActive**を確認：Ruleset ID **26509869**、名前 `ivRooom Herta | main protected (solo maintainer)`、対象 `refs/heads/main`、bypassなし。mainは`protected=true`。**以下の「作成」手順は未作成リポジトリ向けの参考です。Hertaで同じRulesetを再POST/Importしないこと。**

### 現在のRulesetとこのPRのJSON（Desired State）の差分

| 項目 | 現在GitHubへ適用済み | `.github/rulesets/main-solo-maintainer.json` の目標 |
| --- | --- | --- |
| Ruleset ID/名前 | `26509869` / `ivRooom Herta \| main protected (solo maintainer)` | 名前 `main \| Solo Maintainer PR + CI`（既存IDを変更せず内容だけ同期） |
| 対象 / Enforcement / bypass | mainのみ / Active / なし | 同じ |
| PR必須・承認数・thread解決 | 必須 / 0 / 必須 | 同じ |
| 必須checks | **5件**（下記） | **2件**（下記） |
| Strict 最新main追従 | 有効 | 有効 |
| マージ方法 | squash/merge/rebase | **squashのみ** |
| Linear history | 明示的なruleなし | **有効** |
| その他 | `dismiss_stale_reviews_on_push=true`、`require_extra_approval_for_unattributed_changes=true` | solo前提の必要最小構成 |

現在の5件は `Format / Lint / Typecheck / Test / Build`、`ARM64 Production Image / Node / Grype`、`Mobile Config Studio picker`、`postgres`、`topology`。後ろの3件はPRごとの条件付きジョブで存在しない場合があるため、**必須指定のままでは一部PRが永久にマージ不可**となる危険がある。対象PRの追加検査を免除する意味ではなく、当該変更のPR/Deploy品質ゲートで個別に成功を確認する。

### Hertaの管理者が行う安全な更新（新規Ruleset作成禁止）

1. [既存Ruleset ID 26509869](https://github.com/ivRooom/Herta/rules/26509869) を開く。必要に応じて [Settings → Rules → Rulesets](https://github.com/ivRooom/Herta/settings/rules) から該当する既存Rulesetの編集画面へ進む。
2. 変更前の現在値と本節の差分を確認する。対象は`main`のみ、Active、Bypassなしを維持。
3. `Require a pull request`：Approvals **0**、`Require conversation resolution` **ON**、新規録音・Privacy・Whisper本番ONには#646の別Go/No-Goを残す。
4. `Require status checks`：次の**2件のみ**を必須にし、`Require branches to be up to date before merging`を**ON**。`Format / Lint / Typecheck / Test / Build`、`ARM64 Production Image / Node / Grype`。名前を完全一致で選択。
5. `Restrict deletions` ON、`Block force pushes` ON、`Require linear history` ON。マージはリポジトリ設定とRulesetの双方で**Squashのみ**を確認（マージ/リベースはオフ）。その他のReviewオプションはsolo運用で不要な承認要求に変わらないことを確認。
6. `Active` のまま保存。**ID 26509869の同じRuleset**を読み戻し、要件（main限定/approvals0/2checks/strict/thread resolved/no bypass/linear history/forbid deletion-force）を確認。保存が成功してもPRが通らない場合、Rulesetを丸ごとDisableせず、対象のCheck名・条件付き実行・古いHEADをIssue #700に記録して修正する。
7. GitHub AppにAdministration:write権限がない場合は、本人がWeb UIから操作。Secrets・Tokens・実Guild IDをIssueに掲載しない。

読み取り専用検証（既存IDにのみアクセス、POST禁止）：

```bash
gh api repos/ivRooom/Herta/rulesets/26509869 \
  --jq '{id,name,target,enforcement,conditions,bypass_actors,rules}'
gh api repos/ivRooom/Herta/branches/main --jq '{name,protected}'
```

**Rollback**：設定変更が意図せず安全なPRまでBlockedした場合、変更前の値を#700に記録してから**同じRuleset ID**の該当項目だけを戻す。Ruleset削除・全体無効化・Required CI一括解除で回避しない。

## 目的・決定事項

1人開発でレビュアーを存在するものとして扱わない。「PR必須＋mainの検証CI必須＋未解決スレッド禁止＋Squashのみ＋force push/削除禁止」を GitHub Ruleset で強制する。

- Ruleset: `main | Solo Maintainer PR + CI`
- JSON: `.github/rulesets/main-solo-maintainer.json`
- Target: `refs/heads/main` のみ。Enforcement: `active`、Bypass: **なし**
- Require pull request: **ON**、Required approving reviews: **0**（soloのため）、Require approval of most recent push / Code Owners: **OFF**、Required conversations resolved: **ON**
- Allowed merges: **Squash only**、Linear history: **ON**、Delete/Force push: **禁止**
- Required checks（GitHub APIの実Check Run名を使用、`.github/workflows/ci.yml`ではすべてのmain向けPRで起動）:
  - `Format / Lint / Typecheck / Test / Build`
  - `ARM64 Production Image / Node / Grype`
- Strict: **ON**（最新 `main` に追従したコードのCI合格が必要）。GitHubが提示する Update branch でCIを再実行する。
- `Studio E2E`・VC native checks・PG16等は **paths 条件つき** なので、全PR対象Rulesetへ追加すると実行されないPRで永久Blockedになる。このRuleには含めない。該当PRの個別CI・本番Deploy quality gateの確認は引き続き必須。

**重要**：0件Reviewは「独立レビューが完了」とは異なる。メンテナーがPRのDiff、Review Thread、脆弱性、テスト、Rollbackを自分で確認し、その結果をPR/Issueに記録する。Privacy/録音/本人削除/長期保存/Whisper本番ON・課金インフラ変更はこのルールだけで公開承認されない。別途 [#646](https://github.com/ivRooom/Herta/issues/646) 等のGo/No-Goと法務・Security Reviewを守る。共同開発者が参加したら approving reviews を `1` 以上へ移行する。

## 適用方法A：GitHub管理画面（推奨）

操作URL: https://github.com/ivRooom/Herta/settings/rules

1. GitHubに管理者でログインし、`Herta → Settings → Rules → Rulesets` を開く。
2. 既存の同名/同対象ルールがないか確認。あれば新規作成せず更新・統合する。
3. `New ruleset` を開き、表示されれば `Import a ruleset` から `main-solo-maintainer.json` を読み込む。見当たらない場合は `New branch ruleset` で本書の値を手動入力する。
4. 対象を `main` だけにし、Bypassを空のままにする。特に `Require a pull request before merging` はON、`Required approvals=0`。
5. Status Checksは**上記の2つのCheck Run名と完全一致**で登録する。`Require branches to be up to date before merging` をON。UIで候補が出ない場合は `Checks` タブで過去の正常Runを確認する。
6. `Enforcement: Active` を確認し、`Create`/Save。Rulesets一覧から **Active / 対象main / Bypassなし** を確認する。
7. `Herta → Settings → Environments → production` でDeploy branch/tag制限がmainであることと環境Secretsの存在のみを確認。単独本人をRequired reviewerに指定すると承認できずデッドロックするため、GitHub独立Reviewerの承認ゲートとは分ける。Productionの本人Go/No-Goは運用Issueに残す。
8. `main` のProtected状態、PRのチェック必須表示、未解決Thread時のMerge不可をUIで確認し、[#700](https://github.com/ivRooom/Herta/issues/700)に設定日時・設定項目・合否のみ記録。

## 適用方法B：GitHub CLI（管理者自身の認証環境）

リポジトリをcloneした管理者のローカル端末で以下を実行する。**トークンや `gh auth status` の秘密情報をIssue/Chatへ貼らない。** まず重複ルールを確認する。

```bash
gh auth status
gh api repos/ivRooom/Herta/rulesets --jq '.[] | {id,name,enforcement}'
gh api repos/ivRooom/Herta/commits/main/check-runs --jq '.check_runs[].name'
# 同名既存Rulesetがないことを確かめてから一度だけPOST
RULESET_ID="$(gh api -X POST repos/ivRooom/Herta/rulesets --input .github/rulesets/main-solo-maintainer.json --jq '.id')"
test -n "$RULESET_ID"
# 作成した個別Ruleset IDの条件・権限・チェック設定を読み取り、JSONと照合
gh api "repos/ivRooom/Herta/rulesets/$RULESET_ID" --jq '{name,target,enforcement,bypass_actors,conditions,rules}'
# 参考: mainへ実際に適用されているRule。これは固有Rulesetの検証の代わりにはならない
gh api repos/ivRooom/Herta/rules/branches/main --jq '.[].type'
gh api repos/ivRooom/Herta/branches/main --jq '.protected'
```

GitHub APIのRuleset作成にはRepository **Administration: write** が必要。現在の接続されたGitHub Appはその権限を持たないため、ここから直接Rulesetを作成・有効化したとは主張しない。HTTP 403ならリポジトリの管理者本人で実行する。CLIによるPOSTを何度も実行すると重複Ruleができるため、成功したら再実行しない。

管理画面から既にImportしている場合はPOSTしない。次で既存RulesetのIDを検索し、**同名が1件だけ**であることを確認してから `gh api "repos/ivRooom/Herta/rulesets/<確認したID>" --jq '{name,target,enforcement,bypass_actors,conditions,rules}'` を実行する。

```bash
gh api repos/ivRooom/Herta/rulesets --jq '.[] | select(.name == "main | Solo Maintainer PR + CI") | {id,name,enforcement}'
```

**必ず新しく作成した個別Rulesetの詳細をJSONと照合する**：`main`限定、`active`、Bypass空、PR必須・approvals=0・review thread解決必須、Force Push/削除禁止、上記2つのRequired CI名、Strict=true、Squashのみ。別の保護ルールが適用されているだけで合格としない。

## 検証・復旧

- `main`の直接Push/Force Push/削除を実際に試してデータを破壊しない。Rulesetの条件・アクティブ表示と通常PRのマージ画面（必須checks/未解決Thread）を読取確認する。
- CIの必須Job名がRenameされたら、まずGitHub Ruleset側とJSONをIssue化して同時更新する。**PRがブロックされたからといって無言でRulesetを無効化しない。**
- 予期しないデッドロック時はIssue #700に障害とルールID、影響範囲、判断記録を残し、管理者がRulesetを一時Disabledにする。ただし障害原因解消後に必ず再有効化。
- JSON・ドキュメントはロールバック可能。本番Bot/Provider/DB/Feature Flagには影響しない。
- 参考: https://docs.github.com/en/rest/repos/rules と https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository

# Herta GitHub main Ruleset｜単独メンテナー運用

> 正本: [Issue #700](https://github.com/ivRooom/Herta/issues/700)。2026-11-04にGitHub管理者がRulesetを再Importして保存済み。現在の正規IDは **26515180** で、Active・main限定・main.protected=trueをGitHub APIから確認している。過去に参照されたID26509869は削除済み（404）。**すでに保護が有効であり、Rulesetを追加作成・再Importしないこと。**

## 2026-11-04 実環境確認：Import済み・有効

- [現在のRuleset ID 26515180](https://github.com/ivRooom/Herta/rules/26515180)：`ivRooom Herta | main protected (solo maintainer)`。
- `main` のみ / `active` / Bypass空 / Pull request必須 / Approvals **0** / 未解決Review Thread禁止。
- 必須CIは **2件**：`Format / Lint / Typecheck / Test / Build`、`ARM64 Production Image / Node / Grype`。最新main追従（strict）ON。
- mainに限りSquash-only、Linear history ON、Delete/Force Push禁止。
- 旧Ruleset ID `26509869` は削除済み。過去のGitHub Issue/Notionの旧IDは**履歴**であり操作先に使用しない。
- 過去の5必須CIやMerge/Rebase許可は旧設定の履歴であり、**現在の設定ではない**。
- Rulesetは管理者がImportしてGitHubに適用済み。JSONをGitに置くこと自体で設定が反映されるわけではない。以後は新IDの既存Rulesetを編集し、重複作成しない。

### 現在の設定を安全に再検証（読み取りのみ）

```bash
gh api repos/ivRooom/Herta/rulesets --jq '.[] | {id,name,enforcement}'
gh api repos/ivRooom/Herta/rulesets/26515180 --jq '{id,name,target,enforcement,conditions,bypass_actors,rules}'
gh api repos/ivRooom/Herta/branches/main --jq '{name,protected}'
```

**Rollback**：設定変更でPRがBlockedになった場合、[Issue #700](https://github.com/ivRooom/Herta/issues/700)に変更差分と影響を記録し、既存ID26515180の問題項目だけ安全に修正する。全体Disabled/削除/再Importで迂回しない。

## 目的・決定事項

1人開発でレビュアーを存在するものとして扱わない。「PR必須＋mainの検証CI必須＋未解決スレッド禁止＋Squashのみ＋force push/削除禁止」を GitHub Ruleset で強制する。

- Ruleset: `ivRooom Herta | main protected (solo maintainer)`（ID `26515180`）
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

## 参考：Hertaの過去の初期導入手順（現行Hertaでは実施禁止）

**これは過去のHerta初期導入手順の記録であり、他Repositoryへそのまま転用できない。** Herta固有のURL、`production`環境、Issue #700を使用している。現行HertaではRulesetを再Import・新規作成しない。

操作URL: https://github.com/ivRooom/Herta/settings/rules

1. GitHubに管理者でログインし、`Herta → Settings → Rules → Rulesets` を開く。
2. 既存の同名/同対象ルールがないか確認。あれば新規作成せず更新・統合する。
3. `New ruleset` を開き、表示されれば `Import a ruleset` から `main-solo-maintainer.json` を読み込む。見当たらない場合は `New branch ruleset` で本書の値を手動入力する。
4. 対象を `main` だけにし、Bypassを空のままにする。特に `Require a pull request before merging` はON、`Required approvals=0`。
5. Status Checksは**上記の2つのCheck Run名と完全一致**で登録する。`Require branches to be up to date before merging` をON。UIで候補が出ない場合は `Checks` タブで過去の正常Runを確認する。
6. `Enforcement: Active` を確認し、`Create`/Save。Rulesets一覧から **Active / 対象main / Bypassなし** を確認する。
7. `Herta → Settings → Environments → production` でDeploy branch/tag制限がmainであることと環境Secretsの存在のみを確認。単独本人をRequired reviewerに指定すると承認できずデッドロックするため、GitHub独立Reviewerの承認ゲートとは分ける。Productionの本人Go/No-Goは運用Issueに残す。
8. `main` のProtected状態、PRのチェック必須表示、未解決Thread時のMerge不可をUIで確認し、[#700](https://github.com/ivRooom/Herta/issues/700)に設定日時・設定項目・合否のみ記録。

## 日常監査：GitHub CLI（読み取り専用）

現在のHertaにはActive Rulesetが1件存在するため、`POST /repos/ivRooom/Herta/rulesets` を**実行しない**。既存IDの設定を確認するだけでよい。

```bash
gh api repos/ivRooom/Herta/rulesets --jq '.[] | {id,name,enforcement}'
gh api repos/ivRooom/Herta/rulesets/26515180 --jq '{id,name,target,enforcement,conditions,bypass_actors,rules}'
gh api repos/ivRooom/Herta/branches/main --jq '{name,protected}'
```

JSON Desired Stateは `.github/rulesets/main-solo-maintainer.json` に保存済み。ライブ設定がこのJSONと異なった場合は先にIssue #700へ登録し、管理者が**同じRuleset ID**を編集して再検証する。Tokenや認証情報はIssue/Chatへ転記しない。

## 検証・復旧

- `main`の直接Push/Force Push/削除を実際に試してデータを破壊しない。Rulesetの条件・アクティブ表示と通常PRのマージ画面（必須checks/未解決Thread）を読取確認する。
- CIの必須Job名がRenameされたら、まずGitHub Ruleset側とJSONをIssue化して同時更新する。**PRがブロックされたからといって無言でRulesetを無効化しない。**
- 予期しないデッドロック時はIssue #700に障害と現在のルールID、影響範囲を記録し、原因のRequired Check/Strict/Workflowを修正する。Ruleset全体の無断Disableや削除による回避は禁止。
- JSON・ドキュメントはロールバック可能。本番Bot/Provider/DB/Feature Flagには影響しない。
- 参考: https://docs.github.com/en/rest/repos/rules と https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository

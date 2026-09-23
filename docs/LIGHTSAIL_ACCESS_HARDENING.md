# Lightsail アクセス経路 Hardening 設計 / Runbook

対応Issue: [#381](https://github.com/ivRooom/Herta/issues/381)（関連: [#354](https://github.com/ivRooom/Herta/issues/354), [#373](https://github.com/ivRooom/Herta/issues/373)）

## 背景・現状 (read-only確認結果、Issue #354 production preflightより)

- Lightsail instance `ivrm-herta` は `ap-northeast-1` でrunning。
- SSH 22/tcp が IPv4 / IPv6 とも全公開 (`0.0.0.0/0`, `::/0`)。
- Systems Manager managed instanceとして未登録（LightsailはEC2と異なりIAM instance profileを直接attachできないため、標準のSSM自動登録の対象外）。
- Lightsail instance snapshot / automatic snapshotは0件。
- PostgreSQL application backupはS3へ正常継続中（`.dump` + `.sha256`、S3 Versioning、SSE-S3、180日保持+30日後Glacier、freshness checker daily稼働）。
- デプロイは`.github/workflows/deploy-production.yml`から`appleboy/ssh-action`経由の直接SSHに依存している（`secrets.LIGHTSAIL_HOST` / `LIGHTSAIL_USER` / `LIGHTSAIL_SSH_KEY`）。

**本ドキュメントは設計とRunbookのみを定義します。ここに書かれたfirewall変更・SSM登録・snapshot設定・IAM変更はいずれも本番mutationであり、実施前に都度この会話の外で明示的な人間の確認を取ってから、別途1ステップずつ実行します。**

## Goal

Production hostの管理経路を、公開SSH依存から段階的に離脱させつつ、host-level disaster recoveryの手段を整備する。

## 方針決定

### 1. SSH 22/tcp 公開範囲の最小化

- **最終形**: 通常運用ではSSHを一切使わず、AWS Systems Manager Session Manager（以下SSM Session Manager）をhost管理・deployの主経路にする。SSM Session ManagerはSSM Agentがoutbound（instance → AWS SSMエンドポイント）のlong-pollで通信するため、inbound portを一切開ける必要がない。
- **SSHは廃止しない**: SSM Agent自体の障害時のfallbackとして、SSH 22/tcpのfirewall ruleは残すが、`0.0.0.0/0` / `::/0`ではなく特定の管理者IP（少数の固定IPのみ）に制限する。
- GitHub Actionsのhosted runnerは送信元IPが動的でIP allowlist方式と相性が悪いため、**CIからの直接SSHはこの計画の完了後に廃止**し、CIはSSM経由（後述）へ移行する。これによりSSH向けのfirewall rule対象からCIのIP要件そのものがなくなる。
- ロールアウト順序は「3. 移行時の安全な順序」を参照。SSM側が実運用で検証できるまでは、SSH ruleを閉じない。

### 2. SSM Session Managerへの移行（Lightsail hybrid activation）

**[完了]** 2026-09-23、`ivrm-herta`をmanaged instance ID `mi-089d6f3b84882fef4`としてSSM hybrid activation登録済み（PingStatus: Online）。既存SSHは変更しておらず並行稼働中。

LightsailインスタンスはEC2と異なりIAM instance profileを直接attachできないため、標準のEC2向けSSM自動登録は使えない。AWSが提供する**Systems Manager hybrid activation**（オンプレミス/Lightsail向けの登録方式）を使う。

登録の自動化には`.github/workflows/ssm-hybrid-activation.yml`（`workflow_dispatch`専用、手動実行のみ）と`deploy/scripts/ssm-hybrid-register.sh`を用意した。実行には次のAWS側の準備が必要（IAM role/policy変更のため、実施は別途人手で行った。完了済み）:

1. Hybrid managed instance用のIAM role `ivrm-herta-ssm-hybrid-role`を作成し、`AmazonSSMManagedInstanceCore`ポリシーをattachする。
2. 既存のGitHub Actions OIDC role (`ivrm-web-github-deploy-role`) に、`ivrm-herta-ssm-hybrid-role`のARNへスコープした`iam:PassRole`、および`ssm:CreateActivation` / `ssm:DescribeInstanceInformation`を追加する。

上記が整った後、`ssm-hybrid-activation.yml`を`workflow_dispatch`で手動実行すると:

1. `aws ssm create-activation`でActivation Code / Activation ID を発行する（`registration-limit 1`、有効期限1時間。値はマスクしログへ出力しない）。
2. 既存のSSH secret (`LIGHTSAIL_HOST` / `LIGHTSAIL_USER` / `LIGHTSAIL_SSH_KEY`) 経由でinstanceへ接続し、`deploy/scripts/ssm-hybrid-register.sh`を実行してSSM Agentのインストール（未導入時）と`amazon-ssm-agent -register`による登録を行う。
3. `aws ssm describe-instance-information`でPingStatusがOnlineになっていることを確認する。

登録後は`aws ssm start-session --target mi-xxxxxxxxx`で接続確認する。Session Managerのセッションログ（コマンド実行内容）をS3またはCloudWatch Logsへ記録する設定は別途有効化する（監査証跡の確保。直接SSHではauditログが取れていなかった分の補強）。

この段階では**既存のSSHは並行して残す**（切り戻し可能性の確保）。

### 3. GitHub Actions deploy workflowのSSM移行

現行の`deploy-production.yml`は`appleboy/ssh-action`で長大なbashスクリプトをSSH経由で実行している。移行先候補は次の2つで、**(A) を推奨**する。

- **(A) `aws ssm send-command`（`AWS-RunShellScript`）方式（推奨）**
  - 既にOIDCで`role-to-assume: arn:aws:iam::911291529944:role/ivrm-web-github-deploy-role`を使っているため、GitHub Actionsの認証方式を変えずに済む。
  - 実行はCloudTrailで監査可能（`ssm:SendCommand`のAPI呼び出しとして記録される）。
  - 現行のインラインスクリプトは非常に長いため、SSM RunCommandへ直接貼り付けるのではなく、**リポジトリにcommit済みの`deploy/scripts/deploy.sh`をhost上でgit checkout済みの状態から`bash deploy/scripts/deploy.sh`として起動する2段階呼び出し**にする（`git fetch && git checkout` → `bash deploy/scripts/deploy.sh`）。これによりSSM RunCommandのコマンドサイズ制約を回避しつつ、既存スクリプトの大部分を流用できる。
  - `ivrm-web-github-deploy-role`に`ssm:SendCommand` / `ssm:GetCommandInvocation` / `ssm:DescribeInstanceInformation`を対象managed instance ARNへスコープしたIAM権限追加が必要（別途IAM変更として確認を取る）。
- **(B) SSM port-forwardingでSSHトンネルする方式（非推奨）**
  - `aws ssm start-session --document-name AWS-StartPortForwardingSession`でlocalhost:PORT → instance:22のトンネルを張り、既存の`appleboy/ssh-action`をlocalhost向けに向ける。
  - 既存スクリプトを変更せずに済む利点はあるが、runner側で`session-manager-plugin`の導入とトンネルのbackground管理が必要になり複雑化する。CloudTrail監査もport-forward確立の記録のみで、tunnel内のコマンド内容はSSH側のログにしか残らない。

**この移行は、既存のfirewall変更（SSH閉塞）とは別のPRで行う。** 理由: (A)の変更自体にバグがあった場合、SSHが生きていればそのまま従来の経路でrollbackできるようにするため。

### 4. Snapshot / automatic snapshot方針

- Lightsailの**automatic snapshot**機能（日次、最大7日ローリング保持）を`ivrm-herta`に対して有効化する。実行時刻はデプロイ・DB backupジョブと重複しない時間帯（例: 18:00 UTC = JST 03:00台、既存のPostgreSQL backup/freshness checkerのスケジュールと突き合わせて最終決定する）を選ぶ。
- リスクのある変更（今回のfirewall/SSM/OSレベル変更そのものを含む）の直前には、都度**manual instance snapshot**を作成する（Runbook参照）。manual snapshotは自動削除されないため、変更の安定運用を確認できた時点（目安1〜2週間）で削除し、snapshot storageコストを抑える。

### 5. 既存PostgreSQL S3 backupとの責務分離

| 観点     | Lightsail instance snapshot                                                   | PostgreSQL S3 backup（既存）           |
| -------- | ----------------------------------------------------------------------------- | -------------------------------------- |
| 復元対象 | ディスク全体（OS・docker layer・`.env.production`・volumeなど非DB状態を含む） | PostgreSQLデータのみ                   |
| 復元粒度 | snapshot取得時点のみ（instance単位）                                          | `.dump`単位、180日分＋Glacier          |
| 復元手段 | 新規instanceを作成（in-place restoreは不可）                                  | `pg_restore`                           |
| 主な用途 | ホスト全損・OS/config破損・侵害後の全面再構築                                 | 通常のDBロールバック・特定日付への復元 |
| 保持先   | Lightsail（同一account/region）                                               | S3（別サービス、Versioning + SSE-S3）  |

**方針**: 通常のDBロールバックは引き続きPostgreSQL S3 backupを使う。Lightsail instance snapshotは「ホストそのものが壊れて、ゼロから作り直すより早く戻せる場合」専用のdisaster recovery手段と位置付ける。

## Runbook

### A. リスクのある変更前の手動snapshot取得

```bash
aws lightsail create-instance-snapshot \
  --region ap-northeast-1 \
  --instance-name ivrm-herta \
  --instance-snapshot-name "ivrm-herta-preop-$(date -u +%Y%m%d-%H%M)"

# 完了確認 (state: available になるまでポーリング)
aws lightsail get-instance-snapshot \
  --region ap-northeast-1 \
  --instance-snapshot-name "<上で作成したsnapshot名>"
```

安定運用を確認できたら削除する:

```bash
aws lightsail delete-instance-snapshot \
  --region ap-northeast-1 \
  --instance-snapshot-name "<snapshot名>"
```

### B. Disaster recovery（ホスト全損時のsnapshot復元）

1. 新しいinstance名でsnapshotから復元する（in-place restoreは不可のため、必ず新規instanceになる）。

   ```bash
   aws lightsail create-instance-from-snapshot \
     --region ap-northeast-1 \
     --instance-name "ivrm-herta-restore-$(date -u +%Y%m%d)" \
     --instance-snapshot-name "<復元元snapshot名>" \
     --availability-zone ap-northeast-1a \
     --bundle-id <既存instanceと同じbundle-id>
   ```

2. 新instanceが`running`になるまで待つ。
3. 既存のstatic IPを壊れた旧instanceからdetachし、新instanceへattachする（DNS/Cloudflare側の変更を避けるため、可能な限りstatic IP付け替えを優先する）。

   ```bash
   aws lightsail detach-static-ip --region ap-northeast-1 --static-ip-name <static-ip-name>
   aws lightsail attach-static-ip --region ap-northeast-1 \
     --static-ip-name <static-ip-name> --instance-name "ivrm-herta-restore-YYYYMMDD"
   ```

4. SSM登録状態を確認する。hybrid activationはinstance固有の登録のため、**snapshot復元後は再登録が必要になる可能性が高い**（新規instanceとして扱われるため）。「2. SSM Session Managerへの移行」の手順3〜5を再実行する。
5. `docker compose ps` でcontainerの起動状態を確認し、必要であれば`docker compose up -d`で明示的に起動する。
6. Snapshot取得時点のDB状態と、S3上の最新PostgreSQL dumpのどちらが新しいか・信頼できるかを判断し、必要なら`pg_restore`でDBを最新dumpへ復元する（`docs/BACKUP_RESTORE_VERIFICATION.md`のRunbookに準拠）。
7. デプロイworkflowと同じhealth checkを手動実行し、正常性を確認する。

   ```bash
   curl --fail --show-error --silent https://herta.ivrm.jp/api/v1/health
   curl --fail --show-error --silent https://herta.ivrm.jp/api/auth/providers
   ```

8. 旧（壊れた）instanceは、新instanceの安定運用を確認してから削除する。

## 移行時の安全な順序（rollback優先度順）

各stepは独立してrollback可能。**前のstepが本番で実運用検証できるまで次のstepへ進まない。**

1. **Automatic snapshotの有効化**（運用リスクほぼゼロ、純粋な安全網の追加）。**[完了]** 2026-09-23、日次18:00 UTC (JST 03:00台) で有効化済み。
2. **SSM hybrid activation + agent登録**。既存SSHと並行稼働させ、`aws ssm start-session`が実際に接続できることを確認する。この時点ではfirewallは一切変更しない。**[完了]** 2026-09-23、`ssm-hybrid-activation.yml`を`workflow_dispatch`実行し、managed instance ID `mi-089d6f3b84882fef4`としてPingStatus Onlineで登録完了。既存SSHはそのまま並行稼働中（未変更）。`aws ssm start-session`での対話的接続確認とSession Managerセッションログの有効化はまだ未実施。
3. **deploy workflowのSSM移行**（別PR）。実際に1回以上、本番デプロイをSSM経由で成功させて検証する。
4. **SSH firewall ruleの縮小**。(2)(3)が実運用で確認できてから、`0.0.0.0/0`/`::/0`を特定の管理者IPへ縮小する（完全に閉じるか、緊急fallback用に限定IPを残すかはこの時点で再検討する）。
5. 本ドキュメントとIssue #381を最終状態に更新する。

各stepの実施前に、影響範囲とrollback手順をこの会話の外で確認してから、1ステップずつ実施する。firewall変更・SSM登録・snapshot設定・関連IAM変更はすべて本番mutationのため、事前承認なしに実行しない。

## Secret取り扱い

- SSM Activation Code / Activation ID は短命なsecretとして扱い、Issue/PR/コミット/ログに出力しない。
- SSH private key（`secrets.LIGHTSAIL_SSH_KEY`）は本移行が完了しSSHを縮小した後も、緊急fallback用として当面はGitHub Environment secretに残す。完全に不要になった時点で削除を検討する。
- `ivrm-web-github-deploy-role`へのIAM権限追加（`ssm:SendCommand`等）は、対象managed instance ARNへの最小権限スコープとし、別途IAM変更として確認を取ってから適用する。

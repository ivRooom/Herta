# バックアップ鮮度監視 CloudFormation移行Runbook

## 目的

CloudShellで手作業作成したLambda、IAM Role、EventBridge SchedulerをCloudFormationで再現可能にします。

既存リソースはCloudFormation管理外のため、同名リソースを直接置換しません。`managed`サフィックス付きの新構成を並行作成し、動作確認後に旧Schedulerを停止します。

## 管理対象

- Lambda: S3最新`.dump`の鮮度確認
- Lambda実行Role: 対象S3 prefixの一覧取得、既存SNSへのPublish、CloudWatchカスタムメトリクス送信
- EventBridge Schedulerと実行Role
- Scheduler配信失敗用SQS DLQ
- DLQメッセージ検知CloudWatch Alarm
- Lambda CloudWatch Logs保持期間
- CloudWatch Dashboard

## 専用PostgreSQLの完了マニフェスト監視（追加実装・未適用）

2026-10-26: `DedicatedBackupBucketName` を空文字列（既定値）から、承認済みの専用DB backup bucketへ設定すると、同じLambda/Scheduler/通知経路で追加監視する。既存Hertaのbucket/prefixを置換せず、既存監視を残す。新しいLambda、Schedule、Dashboard、metric seriesやサーバーは作成しない。実行時間・S3 request・通知利用量は増え得るため、費用と実行変更を別途確認する。

完了判定は `postgresql/<UTC timestamp>-<UUID>/manifest.json` だけを対象とする。
最大1000件の一覧、最大64KiBのマニフェストに制限し、一覧がtruncatedなら失敗にする。新しい任意の`.dump`では旧い完了マニフェストを隠せない。S3応答のSHA256/version ID、keyとcapture ID、PG17、4DB（herta/web/dashboard/ai）とrolesの正確なfile set、size/hash/version、S3更新時刻と本文completion時刻の25時間以内・未来5分以内を確認する。

この1000件上限は、外部repositoryの[専用backup Terraform root](https://github.com/ivRooom/ivrm-infrastructure/blob/main/terraform/aws/postgresql-backup/main.tf)が`postgresql/`へ適用するcurrent7日・noncurrent1日のlifecycleを前提にした、意図的な時間/メモリ境界。日次captureは4dump＋roles＋manifestの6objectで、lifecycle遅延を見込んだ9captureの計画例でも約54objectとなる。noncurrent versionはListObjectsV2のcurrent一覧には含まれない。これは上限保証ではなく、失敗途中のobject、頻回の手動実行、lifecycle遅延・変更で増え得る。有効化前にoperatorが実bucketのlifecycleを再確認する。1000件超過の通知は保持/運用状況の手動照合が必要な失敗として扱い、上限を外して無制限paginationへ変更しない。[保持と費用の前提](https://github.com/ivRooom/ivrm-infrastructure/blob/main/terraform/aws/postgresql-backup/README.md)も参照する。

監視が確認するのは「完了captureが新しい」ことであり、各payloadの存在/復号/復元やRPO/RTOの実証ではない。rolesにはpassword hashを含めず、Secret・鍵・mediaは別の復旧経路で保全する。独立した実復元検証も必要。

追加S3 clientだけconnect/read timeoutを各2秒・total_max_attempts=1へ制限し、一覧とGetの接続/読取予算を合計約8秒に抑える。既存30秒Lambdaの全体を新規S3 retryで使い切らないための境界で、実行全体やSDK/networkの実測保証ではない。既存Herta client設定・Lambda timeout/memoryは変更しない。

追加監視は既存Hertaのmissing/staleの早期returnより前に実行し、追加監視が不健全なら全体を`ok`にしない。追加通知は固定のcomponent/reason/status/versionだけで、bucket/key/host/provider errorを含めない。SDK失敗も不健全とし、通知失敗は例外としてLambda failureにする。SNS受付は受信者到達の保証ではない。既存Herta用の3つのcustom metricは従来どおりHertaだけを表し、専用DBの健康指標と読み替えない。既存metric seriesや通知経路を増殖させない。

既存Lambda roleへ条件付きinline policyだけを追加する。新bucketの`postgresql/`一覧と`postgresql/*/manifest.json`のGetObjectだけを許可し、dump/rolesの読取、GetObjectVersion、書込/削除、KMS、ACL/tag/Object LockやObject Lambda権限は追加しない。SNS/CloudWatchは既存のscopeを維持する。実際のSSE-S3/通知先暗号化とprincipal境界を再照合する。

権限inventoryは、抽出したinline Pythonに対して`iam-policy-autopilot 0.3.0`をregion/accountとInfrastructure backup Terraform root付きで実行して確認した（実識別子/結果ファイルは私有管理）。生成された広いbaselineから、未使用のACL/tag/retention/legalhold/version/Object Lambda/accesspoint/KMSを採用せず、実際のListObjectsV2/GetObjectに必要な追加権限だけを条件付きCFN参照へ絞った。生成policyをそのまま本番へ適用していない。

デプロイスクリプトは `DEDICATED_BACKUP_BUCKET_NAME` が**明示設定された場合だけ**このparameterを渡す。未設定なら既存stack値を保持し、新規stackではtemplate既定の空文字になる。意図した無効化は明示的な空文字指定。既存scriptのdeploy後Lambda invokeや旧Scheduler停止を、この追加実装の確認だけで実行しない。

**既存stackの更新に、新しい環境変数だけを追加して`deploy.sh`を実行しない。** 省略時に専用bucket値が保持されることと、helperが既存のthreshold/prefix/schedule等へ既定値を再指定することは別であり、後者で現行設定を巻き戻し得る。この変更のoperator経路は、9つの既存parameter（BackupBucketName、AlertTopicArn、ResourceNameSuffix、BackupPrefix、MaximumBackupAgeHours、ScheduleExpression、ScheduleTimezone、LogRetentionDays、DashboardName）をすべてUsePreviousValueで保持し、新parameterだけを指定するcontrolled CloudFormation ChangeSetとする。helperは、すべての現行値を明示して維持できる場合にだけ別途使用する。

有効化前に、既存stack parameters/role/SNS subscriptions/scheduleとsaved ChangeSetをread-onlyで照合し、承認対象を既存Lambda code/envとroleの追加読取policyだけに限定する。Herta app/DB/deployとは分離し、他のparameterはUsePreviousValueで保持する。test alertを送る場合は通知先を特定した承認を取得する。この実装ではcloud/IAM変更、deploy、実データ/Secret取得、実通知は実施していない。

2026-10-26のChangeSet previewは4件のmodifyを表示した。直接変更はLambda functionとLambda role、動的ARN参照に伴う評価対象がScheduler roleとScheduleで、新規作成/置換/削除はない。previewと実適用を区別し、ChangeSetは未実行。本PRは既存のapp CI Grype失敗（Issue #551）により未mergeで、監視用lint/tests成功だけをmerge/deploy許可と扱わない。

Production workflowの`deploy/**`直後に`!deploy/aws/backup-monitoring/**`を置き、monitoringだけのpushではBot image rebuild/再deployを起動しない。その他のapp/runtime/deploy inputとworkflow_dispatchは維持する。DockerfileのCOPYでbuilderへ入るが、deployはruntime前に除去され、monitoring template/scriptをアプリから参照する変更はない。negated pathsは順序が意味を持つため、このtrigger境界も独立review対象とする。[GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore)。監視CIがgreenでも本番CFN deployの承認にはしない。

rollbackは承認済みの前template/code/env/policyへ戻すか、追加parameterを明示的に空へ戻す。既存Herta監視を保持し、専用DBの保護が未稼働になることを記録する。backup uploaderを止めても既存S3/source DB/volumeを削除しない。

検証: exact inline sourceのmocked SDK14テスト、deploy shell構文、CloudFormation lint。実Lambda/IAM強制、実SNS配送、128MiB/30秒での実行余裕、payloadの復元は別の受入。ProducerはInfrastructureの完了manifest v1、Consumerはこの任意monitor。mergeは独立可能、有効化順はuploader/保存先のsynthetic確認→追加monitor有効化/通知確認→日次運用受入。DB cutoverの承認にはしない。

## 監視メトリクス

Lambdaは実行ごとに`Herta/BackupMonitoring`名前空間へ以下を送信します。

| メトリクス             | 値                               | 用途                       |
| ---------------------- | -------------------------------- | -------------------------- |
| `LatestBackupAgeHours` | 最新`.dump`の経過時間            | 鮮度上限との比較           |
| `BackupFound`          | 検出時`1`、未検出時`0`           | バックアップ生成有無の確認 |
| `FreshnessOk`          | 上限以内`1`、超過または未検出`0` | 現在状態の判定             |

各メトリクスには`FunctionName`ディメンションが付与されます。

CloudWatchへのメトリクス送信はベストエフォートです。`PutMetricData`が失敗した場合は`cloudwatch_metric_publish_failed`を警告ログへ記録し、バックアップ未検出・鮮度超過時のSNS通知処理は継続します。

## ダッシュボード

CloudWatch Dashboardには以下を表示します。

- 最新バックアップ経過時間と鮮度上限
- バックアップ検出状態、鮮度状態
- Lambdaの実行回数、エラー、スロットル
- Scheduler DLQの可視メッセージ数
- 直近50件のLambdaログ

既定のダッシュボード名は`herta-backup-monitoring`です。CloudFormation Outputsの`DashboardUrl`から直接開けます。

## デプロイ

```bash
cd /app/herta

export AWS_REGION='ap-northeast-1'
export BACKUP_BUCKET_NAME='herta-production-backups-ACCOUNT_ID-ap-northeast-1'
export ALERT_TOPIC_ARN='arn:aws:sns:ap-northeast-1:ACCOUNT_ID:herta-backup-alerts'

bash deploy/aws/backup-monitoring/deploy.sh
```

既定値:

- Stack: `herta-backup-monitoring`
- Resource suffix: `managed`
- 最大バックアップ経過時間: 25時間
- Scheduler: 毎日05:00 Asia/Tokyo
- Lambda Logs: 30日
- CloudWatch Dashboard: `herta-backup-monitoring`

ダッシュボード名を変更する場合はデプロイスクリプトへ`DashboardName`パラメータを追加指定するか、AWS CLIからCloudFormationを更新します。

## 切替手順

1. CloudFormation stackを作成または更新する。
2. デプロイスクリプトが実施する通常Lambda呼び出しで`status=ok`を確認する。
3. 新Lambdaへ強制通知テストを実施する。

```bash
FUNCTION_NAME="$(aws cloudformation describe-stacks \
  --stack-name herta-backup-monitoring \
  --query 'Stacks[0].Outputs[?OutputKey==`FunctionName`].OutputValue' \
  --output text)"

aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --payload '{"force_alert":true}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/herta-backup-alert-test.json

python3 -m json.tool /tmp/herta-backup-alert-test.json
```

4. SNS通知を確認する。
5. ダッシュボードURLを取得して表示を確認する。

```bash
DASHBOARD_URL="$(aws cloudformation describe-stacks \
  --stack-name herta-backup-monitoring \
  --query 'Stacks[0].Outputs[?OutputKey==`DashboardUrl`].OutputValue' \
  --output text)"

echo "$DASHBOARD_URL"
```

初回はカスタムメトリクスが反映されるまで数分かかる場合があります。通常呼び出し後に`LatestBackupAgeHours`、`BackupFound`、`FreshnessOk`が表示されることを確認します。

6. 新Schedulerが`ENABLED`であることを確認する。
7. 旧Scheduler `herta-backup-freshness-daily`を停止する。

```bash
aws scheduler update-schedule \
  --name herta-backup-freshness-daily \
  --state DISABLED \
  --schedule-expression 'cron(0 5 * * ? *)' \
  --schedule-expression-timezone 'Asia/Tokyo' \
  --flexible-time-window '{"Mode":"OFF"}' \
  --target file://scheduler-target.json
```

`update-schedule`はTarget全体の再指定が必要です。旧作成時の`scheduler-target.json`がない場合は、先に`aws scheduler get-schedule`でTargetを保存してください。

8. 翌日の新Scheduler実行、CloudWatch Dashboard、CloudWatch Logsを確認する。
9. 旧Lambda、旧IAM Role、旧Schedulerは確認期間後に削除する。

## 確認コマンド

カスタムメトリクスの存在確認:

```bash
aws cloudwatch list-metrics \
  --namespace 'Herta/BackupMonitoring' \
  --dimensions Name=FunctionName,Value="$FUNCTION_NAME"
```

ダッシュボード定義の確認:

```bash
aws cloudwatch get-dashboard \
  --dashboard-name herta-backup-monitoring
```

## ロールバック

新構成に問題がある場合は、新Schedulerを`DISABLED`へ変更し、旧Schedulerを`ENABLED`へ戻します。CloudFormation stackは原因調査が終わるまで保持します。

ダッシュボードやカスタムメトリクスの追加のみでLambda監視処理に問題が生じた場合は、直前のCloudFormationテンプレートへ戻してstackを更新します。既に送信されたカスタムメトリクスは保持期間経過までCloudWatchに残ります。

## 削除

```bash
aws cloudformation delete-stack \
  --region ap-northeast-1 \
  --stack-name herta-backup-monitoring

aws cloudformation wait stack-delete-complete \
  --region ap-northeast-1 \
  --stack-name herta-backup-monitoring
```

DLQにメッセージがある場合もstack削除でキュー自体は削除されるため、必要な障害情報を先に保存してください。CloudFormation管理のDashboardもstack削除時に削除されますが、送信済みのカスタムメトリクスは直ちには削除されません。

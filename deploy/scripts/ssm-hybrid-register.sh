#!/bin/bash
# ============================================================
# Herta. — SSM hybrid activation 登録スクリプト (AWS Lightsail)
# ------------------------------------------------------------
# Lightsail instanceはEC2と異なりIAM instance profileを直接attachできないため、
# AWS Systems Manager hybrid activation (オンプレミス扱いの登録方式) でSSM
# Session Managerの管理対象instanceとして登録する。
#
# 必須環境変数 (呼び出し元がmaskして渡すこと。このスクリプトはechoしない):
#   SSM_ACTIVATION_CODE
#   SSM_ACTIVATION_ID
#   SSM_REGION (既定: ap-northeast-1)
#
# 参照Issue: #381 (docs/LIGHTSAIL_ACCESS_HARDENING.md 「2. SSM Session Managerへの移行」)
# ============================================================
set -euo pipefail

REGION="${SSM_REGION:-ap-northeast-1}"
# drone-ssh経由の非対話シェルではPATHに/snap/binが含まれず、command -vでの解決に
# 失敗する（`snap list`はsnapdへ直接問い合わせるためPATHに依存せず動作する）。
# そのため実行ファイルはsnap classic installの既定配置場所を直接絶対パスで指定し、
# command -vには依存しない。
SSM_AGENT_BIN="/snap/bin/amazon-ssm-agent"

if [ -z "${SSM_ACTIVATION_CODE:-}" ] || [ -z "${SSM_ACTIVATION_ID:-}" ]; then
  echo "ERROR: SSM_ACTIVATION_CODE / SSM_ACTIVATION_ID が設定されていません。" >&2
  exit 1
fi

echo "=== SSM Agentのインストール状態を確認 ==="
if snap list amazon-ssm-agent &> /dev/null; then
  echo "amazon-ssm-agent は既にインストール済みです"
else
  echo "amazon-ssm-agent が見つからないためインストールします (snap)"
  sudo snap install amazon-ssm-agent --classic
fi

if [ ! -x "${SSM_AGENT_BIN}" ]; then
  echo "ERROR: ${SSM_AGENT_BIN} が見つかりません（snapのインストール先が想定と異なります）。" >&2
  exit 1
fi

echo "=== 既存の登録状態を確認 ==="
# サービスの稼働有無ではなく、registrationファイルの有無で「登録済みか」を判定する
# (snap installは通常serviceを自動起動するため、稼働中=登録済みとは限らない)。
if [ -f /var/lib/amazon/ssm/registration ]; then
  echo "amazon-ssm-agent は既に登録済みです (/var/lib/amazon/ssm/registration が存在します)。"
  echo "再登録が必要な場合は、意図しない既存managed instance IDの上書きを避けるため"
  echo "このスクリプトでは自動実行せず、事前に人手でregistrationファイルの削除要否を判断してください。"
  exit 1
fi

echo "=== SSM hybrid activationでregister ==="
# activation code/idは引数にもログにも残さないよう、値そのものを表示するコマンドは実行しない。
# ${SSM_AGENT_BIN}は絶対パスのため、sudoのsecure_pathによるPATHリセットの影響を受けない。

# register失敗時にserviceを停止したまま放置しないよう、この時点以降は必ず
# 復旧を試みるtrapを設定する (登録成功時は明示的にstartするので二重実行になるが
# 冪等な操作のため問題ない)。
restart_agent_on_exit() {
  sudo snap start amazon-ssm-agent 2>/dev/null || true
}
trap restart_agent_on_exit EXIT

echo "既存serviceを停止します"
sudo snap stop amazon-ssm-agent 2>/dev/null || true
echo "registerを実行します"
sudo "${SSM_AGENT_BIN}" -register \
  -code "${SSM_ACTIVATION_CODE}" \
  -id "${SSM_ACTIVATION_ID}" \
  -region "${REGION}"
echo "serviceを再開します"
sudo snap start amazon-ssm-agent
trap - EXIT

echo "=== 登録結果を確認 (managed instance IDのみ表示、activation code/idは表示しない) ==="
sleep 3
sudo snap services amazon-ssm-agent

if [ -f /var/lib/amazon/ssm/registration ]; then
  managed_instance_id="$(grep -o '"ManagedInstanceID":"[^"]*"' /var/lib/amazon/ssm/registration | cut -d'"' -f4 || true)"
  if [ -n "${managed_instance_id}" ]; then
    echo "登録済み managed instance ID: ${managed_instance_id}"
  fi
fi

echo "=== SSM hybrid activation登録完了 ==="
echo "AWS側で 'aws ssm describe-instance-information --region ${REGION}' を実行し、"
echo "PingStatus が Online になっていることを確認してください。"

#!/bin/bash
# ============================================================
# Herta. — 本番環境 初期セットアップスクリプト (AWS Lightsail)
# ------------------------------------------------------------
# Lightsail インスタンス上で最初に 1 回だけ実行します。
#   - Docker / Docker Compose の存在確認
#   - アプリディレクトリ (/app/herta) の作成
#   - リポジトリのクローン
# ============================================================
set -euo pipefail

APP_DIR="${LIGHTSAIL_APP_DIR:-/app/herta}"
REPO_URL="${HERTA_REPO_URL:-https://github.com/ivRooom/Herta.git}"

echo "=== Herta. 本番環境セットアップ ==="

# Docker の確認
if ! command -v docker &> /dev/null; then
  echo "ERROR: Docker がインストールされていません。先に Docker をインストールしてください。" >&2
  exit 1
fi
if ! docker compose version &> /dev/null; then
  echo "ERROR: Docker Compose (v2) が利用できません。" >&2
  exit 1
fi

# アプリディレクトリ作成
sudo mkdir -p "$(dirname "${APP_DIR}")"
sudo chown "${USER}":"${USER}" "$(dirname "${APP_DIR}")"

# クローン (未取得の場合のみ)
if [ ! -d "${APP_DIR}/.git" ]; then
  echo "リポジトリをクローンします: ${REPO_URL} -> ${APP_DIR}"
  git clone "${REPO_URL}" "${APP_DIR}"
else
  echo "既存のリポジトリを検出しました: ${APP_DIR}"
fi

cd "${APP_DIR}"

# .env.production の準備
if [ ! -f .env.production ]; then
  cp .env.production.example .env.production
  echo ""
  echo "=== 次の手順 ==="
  echo "1) ${APP_DIR}/.env.production を編集して本番の値を設定してください"
  echo "   (POSTGRES_PASSWORD / DISCORD_* / NEXTAUTH_SECRET / JWT_* など)"
  echo "2) deploy/scripts/start.sh を実行して起動してください"
else
  echo ".env.production は既に存在します"
fi

echo "=== セットアップ完了 ==="

#!/bin/bash
# Herta. — 本番環境 初期セットアップスクリプト
set -euo pipefail

echo "=== Herta. 本番環境セットアップ ==="

# Docker のインストール確認
if ! command -v docker &> /dev/null; then
    echo "Docker がインストールされていません"
    exit 1
fi

# アプリケーションディレクトリ作成
sudo mkdir -p /opt/herta
sudo chown "$USER":"$USER" /opt/herta

echo "=== セットアップ完了 ==="
echo ".env ファイルを /opt/herta/.env に作成してください"
echo "その後 deploy/scripts/start.sh を実行してください"

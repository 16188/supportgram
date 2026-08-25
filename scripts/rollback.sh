#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
image="ghcr.io/16188/supportgram:rollback-local"

if ! docker image inspect "$image" >/dev/null 2>&1; then
  echo "没有可回滚的本地镜像。请先使用 bash scripts/deploy.sh 完成一次升级。" >&2
  exit 1
fi

IMAGE_TAG=rollback-local docker compose up -d --force-recreate --pull never --wait --wait-timeout 60
docker compose ps
echo "已恢复到上一次升级前的程序版本，数据库和上传文件未改变。"

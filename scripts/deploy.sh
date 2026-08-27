#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
image="ghcr.io/16188/supportgram"
container_id="$(docker compose ps -q --all supportgram)"

if [ -n "$container_id" ]; then
  current_image="$(docker inspect --format '{{.Image}}' "$container_id")"
  docker image tag "$current_image" "$image:rollback-local"
  echo "已保存当前版本，可执行 bash scripts/rollback.sh 回滚。"
else
  echo "未找到旧容器，本次升级没有可回滚版本。"
fi

git pull --ff-only
docker compose pull
docker compose up -d --force-recreate --wait --wait-timeout 60
docker compose run --rm supportgram npm run seed -- --sync-telegram
docker compose ps

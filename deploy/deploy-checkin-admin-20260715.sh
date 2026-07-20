#!/usr/bin/env bash
set -Eeuo pipefail

cd /opt/govexam

release_id="20260715-checkin-admin-r1"
app_candidate="zhizheng-gov-exam-app:candidate-${release_id}"
migrate_candidate="zhizheng-gov-exam-migrate:candidate-${release_id}"
app_rollback="zhizheng-gov-exam-app:rollback-${release_id}"
app_log="/tmp/govexam-app-${release_id}.log"
migrate_log="/tmp/govexam-migrate-${release_id}.log"
current_app_image="$(docker inspect zhizheng-gov-exam-app-1 --format '{{.Image}}')"

wait_healthy() {
  local container="$1"
  local attempts="$2"
  local state=""
  for ((index = 0; index < attempts; index += 1)); do
    state="$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
    if [[ "$state" == "healthy" ]]; then
      return 0
    fi
    sleep 2
  done
  printf 'Container %s did not become healthy; last state=%s\n' "$container" "$state" >&2
  return 1
}

rollback() {
  local status="$?"
  trap - ERR
  printf 'Deployment failed; restoring app image %s\n' "$current_app_image" >&2
  docker tag "$current_app_image" zhizheng-gov-exam-app:latest || true
  docker compose --env-file .env.production up -d --no-build database </dev/null || true
  wait_healthy zhizheng-gov-exam-database-1 60 || true
  docker compose --env-file .env.production up -d --no-build --no-deps --force-recreate app </dev/null || true
  wait_healthy zhizheng-gov-exam-app-1 60 || true
  printf 'Rollback finished with original status %s\n' "$status" >&2
  exit "$status"
}

trap rollback ERR

docker tag "$current_app_image" "$app_rollback"
printf 'Rollback image prepared: %s -> %s\n' "$current_app_image" "$app_rollback"

docker compose --env-file .env.production stop -t 20 app </dev/null
docker compose --env-file .env.production stop -t 30 database </dev/null

if ! timeout --signal=TERM --kill-after=60s 25m env DOCKER_BUILDKIT=0 \
  docker build --target migration --memory 900m --memory-swap 2400m \
  --cpu-period 100000 --cpu-quota 100000 -t "$migrate_candidate" . \
  >"$migrate_log" 2>&1; then
  tail -n 100 "$migrate_log" >&2
  false
fi
printf 'Migration image built: %s\n' "$migrate_candidate"

if ! timeout --signal=TERM --kill-after=60s 25m env DOCKER_BUILDKIT=0 \
  docker build --target runner --memory 900m --memory-swap 2400m \
  --cpu-period 100000 --cpu-quota 100000 -t "$app_candidate" . \
  >"$app_log" 2>&1; then
  tail -n 100 "$app_log" >&2
  false
fi
printf 'Application image built: %s\n' "$app_candidate"

docker tag "$migrate_candidate" zhizheng-gov-exam-migrate:latest
docker tag "$app_candidate" zhizheng-gov-exam-app:latest

docker compose --env-file .env.production up -d --no-build database </dev/null
wait_healthy zhizheng-gov-exam-database-1 60

docker compose --env-file .env.production run --rm --no-deps migrate </dev/null

docker compose --env-file .env.production up -d --no-build --no-deps --force-recreate app </dev/null
wait_healthy zhizheng-gov-exam-app-1 90

running_image="$(docker inspect zhizheng-gov-exam-app-1 --format '{{.Image}}')"
candidate_image="$(docker image inspect "$app_candidate" --format '{{.Id}}')"
if [[ "$running_image" != "$candidate_image" ]]; then
  printf 'Running image mismatch: running=%s candidate=%s\n' "$running_image" "$candidate_image" >&2
  false
fi

curl --fail --silent --show-error http://127.0.0.1:3000/api/health >/dev/null
trap - ERR
printf 'Deployment succeeded: image=%s\n' "$running_image"

#!/usr/bin/env bash
set -Eeuo pipefail

cd /opt/govexam

release_id="${RELEASE_ID:-20260715-program-acceptance-r1}"
app_candidate="zhizheng-gov-exam-app:candidate-${release_id}"
migrate_candidate="zhizheng-gov-exam-migrate:candidate-${release_id}"
app_rollback="zhizheng-gov-exam-app:rollback-${release_id}"
app_log="/tmp/govexam-app-${release_id}.log"
migrate_log="/tmp/govexam-migrate-${release_id}.log"
backup_path="/opt/govexam/backups/pre-${release_id}-$(date +%Y%m%d-%H%M%S).dump"
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

database_counts() {
  docker exec zhizheng-gov-exam-database-1 psql -U gov_exam -d gov_exam -At -F ',' -c \
    'SELECT (SELECT COUNT(*) FROM "User"), (SELECT COUNT(*) FROM "Question"), (SELECT COUNT(*) FROM "Attempt"), (SELECT COUNT(*) FROM "TrainingReport"), (SELECT COUNT(*) FROM "StudyPlan"), (SELECT COUNT(*) FROM "StudyPlanCheckIn");'
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
  printf 'Rollback finished with original status %s; database backup=%s\n' "$status" "$backup_path" >&2
  exit "$status"
}

trap rollback ERR

docker tag "$current_app_image" "$app_rollback"
printf 'Rollback image prepared: %s -> %s\n' "$current_app_image" "$app_rollback"

docker compose --env-file .env.production stop -t 20 app </dev/null
mkdir -p "$(dirname "$backup_path")"
docker exec zhizheng-gov-exam-database-1 pg_dump -U gov_exam -d gov_exam -Fc >"$backup_path"
test -s "$backup_path"
pre_counts="$(database_counts)"
printf 'Database backup created: %s (%s bytes); counts=%s\n' "$backup_path" "$(stat -c %s "$backup_path")" "$pre_counts"

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

post_counts="$(database_counts)"
if [[ "$post_counts" != "$pre_counts" ]]; then
  printf 'Database counts changed during migration: before=%s after=%s\n' "$pre_counts" "$post_counts" >&2
  false
fi

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
printf 'Deployment succeeded: image=%s backup=%s counts=%s\n' "$running_image" "$backup_path" "$post_counts"

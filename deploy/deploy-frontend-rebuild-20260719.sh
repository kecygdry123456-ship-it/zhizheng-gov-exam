#!/usr/bin/env bash
set -Eeuo pipefail

cd /opt/govexam

release_id="${RELEASE_ID:?RELEASE_ID is required}"
package_path="${PACKAGE_PATH:?PACKAGE_PATH is required}"
package_sha256="${PACKAGE_SHA256:?PACKAGE_SHA256 is required}"
app_candidate="zhizheng-gov-exam-app:candidate-${release_id}"
app_rollback="zhizheng-gov-exam-app:rollback-${release_id}"
app_log="/tmp/govexam-app-${release_id}.log"
backup_dir="/opt/govexam/backups"
timestamp="$(date +%Y%m%d-%H%M%S)"
code_backup="${backup_dir}/pre-${release_id}-${timestamp}-code.tgz"
database_backup="${backup_dir}/pre-${release_id}-${timestamp}.dump"
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
  printf 'Rollback finished with original status %s; code backup=%s; database backup=%s\n' \
    "$status" "$code_backup" "$database_backup" >&2
  exit "$status"
}

trap rollback ERR

actual_sha256="$(sha256sum "$package_path" | awk '{print $1}')"
if [[ "$actual_sha256" != "$package_sha256" ]]; then
  printf 'Package checksum mismatch: expected=%s actual=%s\n' "$package_sha256" "$actual_sha256" >&2
  false
fi

mkdir -p "$backup_dir"
tar \
  --exclude='./.env' \
  --exclude='./.env.production' \
  --exclude='./.next' \
  --exclude='./node_modules' \
  --exclude='./backups' \
  --exclude='./public/question-images' \
  --exclude='./public/question-materials' \
  -czf "$code_backup" .
docker exec zhizheng-gov-exam-database-1 pg_dump -U gov_exam -d gov_exam -Fc >"$database_backup"
test -s "$database_backup"
pre_counts="$(database_counts)"
printf 'Backups created: code=%s database=%s counts=%s\n' "$code_backup" "$database_backup" "$pre_counts"

tar -xzf "$package_path" -C /opt/govexam

if ! timeout --signal=TERM --kill-after=60s 25m env DOCKER_BUILDKIT=0 \
  docker build --target runner --memory 900m --memory-swap 2400m \
  --cpu-period 100000 --cpu-quota 100000 -t "$app_candidate" . \
  >"$app_log" 2>&1; then
  tail -n 120 "$app_log" >&2
  false
fi
printf 'Application image built: %s\n' "$app_candidate"

docker tag "$current_app_image" "$app_rollback"
docker tag "$app_candidate" zhizheng-gov-exam-app:latest
docker compose --env-file .env.production up -d --no-build --no-deps --force-recreate app </dev/null
wait_healthy zhizheng-gov-exam-app-1 90

running_image="$(docker inspect zhizheng-gov-exam-app-1 --format '{{.Image}}')"
candidate_image="$(docker image inspect "$app_candidate" --format '{{.Id}}')"
if [[ "$running_image" != "$candidate_image" ]]; then
  printf 'Running image mismatch: running=%s candidate=%s\n' "$running_image" "$candidate_image" >&2
  false
fi

curl --fail --silent --show-error http://127.0.0.1:3000/api/health >/dev/null
post_counts="$(database_counts)"
if [[ "$post_counts" != "$pre_counts" ]]; then
  printf 'Database counts changed during deployment: before=%s after=%s\n' "$pre_counts" "$post_counts" >&2
  false
fi

trap - ERR
printf 'Deployment succeeded: image=%s code_backup=%s database_backup=%s counts=%s\n' \
  "$running_image" "$code_backup" "$database_backup" "$post_counts"

#!/usr/bin/env bash
set -Eeuo pipefail

cd /opt/govexam

release_id="${RELEASE_ID:?RELEASE_ID is required}"
package_path="${PACKAGE_PATH:?PACKAGE_PATH is required}"
package_sha256="${PACKAGE_SHA256:?PACKAGE_SHA256 is required}"
app_candidate="zhizheng-gov-exam-app:candidate-${release_id}"
migrate_candidate="zhizheng-gov-exam-migrate:candidate-${release_id}"
app_rollback="zhizheng-gov-exam-app:rollback-${release_id}"
app_log="/tmp/govexam-app-${release_id}.log"
migrate_log="/tmp/govexam-migrate-${release_id}.log"
backup_dir="/opt/govexam/backups"
timestamp="$(date +%Y%m%d-%H%M%S)"
code_backup="${backup_dir}/pre-${release_id}-${timestamp}-code.tgz"
database_backup="${backup_dir}/pre-${release_id}-${timestamp}.dump"
current_app_image="$(docker inspect zhizheng-gov-exam-app-1 --format '{{.Image}}')"
npm_registry="$(sed -n 's/^NPM_REGISTRY=//p' .env.production | tail -n 1)"
npm_registry="${npm_registry:-https://registry.npmmirror.com}"

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

database_metrics() {
  docker exec -i zhizheng-gov-exam-database-1 psql -U gov_exam -d gov_exam -At -F ',' <<'SQL'
    WITH target AS (
      SELECT id FROM "Question"
      WHERE "externalKey" IN (
        'huatu:40098982',
        'huatu:40098983',
        'huatu:40098984',
        'huatu:40098985',
        'huatu:40098987'
      )
    )
    SELECT
      (SELECT COUNT(*) FROM "User"),
      (SELECT COUNT(*) FROM "Question"),
      (SELECT COUNT(*) FROM "QuestionMaterial"),
      (SELECT COUNT(*) FROM "Attempt"),
      (SELECT COUNT(*) FROM "Favorite"),
      (SELECT COUNT(*) FROM "TrainingReport"),
      (SELECT COUNT(*) FROM "PracticeSession"),
      (SELECT COUNT(*) FROM "StudyPlan"),
      (SELECT COUNT(*) FROM "StudyPlanCheckIn"),
      (SELECT COUNT(*) FROM "StudyPlanEvidenceClaim"),
      (SELECT COUNT(*) FROM target),
      (SELECT COUNT(*) FROM "QuestionMaterial" WHERE "externalKey" = 'huatu-material:fd370746be61fcef'),
      (SELECT COUNT(*) FROM "Attempt" WHERE "questionId" IN (SELECT id FROM target)),
      (SELECT COUNT(*) FROM "Favorite" WHERE "questionId" IN (SELECT id FROM target)),
      (SELECT COUNT(*) FROM "TrainingReport" report WHERE EXISTS (
        SELECT 1 FROM target WHERE report."questionIds" @> jsonb_build_array(target.id)
      )),
      (SELECT COUNT(*) FROM "PracticeSession" session WHERE EXISTS (
        SELECT 1 FROM target WHERE session."questionIds" @> jsonb_build_array(target.id)
      ));
SQL
}

rollback() {
  local status="$?"
  trap - ERR
  printf 'Deployment failed; restoring application image %s\n' "$current_app_image" >&2
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

tar -xzf "$package_path" -C /opt/govexam
rm -f /opt/govexam/public/question-materials/huatu-fd370746be61fcef/material-1.png
rmdir /opt/govexam/public/question-materials/huatu-fd370746be61fcef 2>/dev/null || true

if ! timeout --signal=TERM --kill-after=60s 25m env DOCKER_BUILDKIT=0 \
  docker build --target migration --build-arg "NPM_REGISTRY=${npm_registry}" \
  --memory 900m --memory-swap 2400m --cpu-period 100000 --cpu-quota 100000 \
  -t "$migrate_candidate" . >"$migrate_log" 2>&1; then
  tail -n 120 "$migrate_log" >&2
  false
fi
printf 'Migration image built: %s\n' "$migrate_candidate"

if ! timeout --signal=TERM --kill-after=60s 25m env DOCKER_BUILDKIT=0 \
  docker build --target runner --build-arg "NPM_REGISTRY=${npm_registry}" \
  --memory 900m --memory-swap 2400m --cpu-period 100000 --cpu-quota 100000 \
  -t "$app_candidate" . >"$app_log" 2>&1; then
  tail -n 120 "$app_log" >&2
  false
fi
printf 'Application image built: %s\n' "$app_candidate"

docker tag "$current_app_image" "$app_rollback"
docker compose --env-file .env.production stop -t 20 app </dev/null
docker exec zhizheng-gov-exam-database-1 pg_dump -U gov_exam -d gov_exam -Fc >"$database_backup"
test -s "$database_backup"
pre_metrics="$(database_metrics)"
IFS=',' read -r pre_users pre_questions pre_materials pre_attempts pre_favorites pre_reports pre_sessions pre_plans pre_checkins pre_claims pre_target_questions pre_target_materials pre_target_attempts pre_target_favorites pre_target_reports pre_target_sessions <<<"$pre_metrics"
printf 'Backups ready: code=%s database=%s metrics=%s\n' "$code_backup" "$database_backup" "$pre_metrics"

docker tag "$migrate_candidate" zhizheng-gov-exam-migrate:latest
docker tag "$app_candidate" zhizheng-gov-exam-app:latest
docker compose --env-file .env.production up -d --no-build database </dev/null
wait_healthy zhizheng-gov-exam-database-1 60
docker compose --env-file .env.production run --rm --no-deps migrate </dev/null

post_metrics="$(database_metrics)"
IFS=',' read -r post_users post_questions post_materials post_attempts post_favorites post_reports post_sessions post_plans post_checkins post_claims post_target_questions post_target_materials post_target_attempts post_target_favorites post_target_reports post_target_sessions <<<"$post_metrics"

[[ "$post_users" -eq "$pre_users" ]]
[[ "$post_questions" -eq $((pre_questions - pre_target_questions)) ]]
[[ "$post_materials" -eq $((pre_materials - pre_target_materials)) ]]
[[ "$post_attempts" -eq $((pre_attempts - pre_target_attempts)) ]]
[[ "$post_favorites" -eq $((pre_favorites - pre_target_favorites)) ]]
[[ "$post_reports" -eq $((pre_reports - pre_target_reports)) ]]
[[ "$post_sessions" -eq $((pre_sessions - pre_target_sessions)) ]]
[[ "$post_plans" -eq "$pre_plans" ]]
[[ "$post_checkins" -eq "$pre_checkins" ]]
[[ "$post_claims" -eq "$pre_claims" ]]
[[ "$post_target_questions" -eq 0 ]]
[[ "$post_target_materials" -eq 0 ]]
[[ "$post_target_attempts" -eq 0 ]]
[[ "$post_target_favorites" -eq 0 ]]
[[ "$post_target_reports" -eq 0 ]]
[[ "$post_target_sessions" -eq 0 ]]
printf 'Migration metrics verified: before=%s after=%s\n' "$pre_metrics" "$post_metrics"

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
printf 'Deployment succeeded: image=%s code_backup=%s database_backup=%s metrics=%s\n' \
  "$running_image" "$code_backup" "$database_backup" "$post_metrics"

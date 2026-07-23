#!/usr/bin/env bash
#
# deploy-staging.sh — deterministic staging deployment for demm-crm.
#
# WHY THIS EXISTS (2026-07-23 incident): a prior manual `gcloud builds
# submit .` deployed whatever was in the *working tree* at submit time, not
# the intended pinned commit. Local commits had advanced into unrelated
# work by the time the build actually ran, so staging silently ran code
# whose schema the staging DB didn't have yet -- every request touching the
# new tables 500'd until someone noticed and manually caught the DB up.
# This script makes that class of mistake structurally impossible: it
# builds from a `git archive` of an explicitly-named, verified commit, not
# from `.`, and refuses to proceed if the DB isn't ready for that commit
# BEFORE any traffic can move.
#
# Usage:
#   scripts/deploy-staging.sh deploy --commit=<sha> [--dry-run] [--yes]
#   scripts/deploy-staging.sh verify --commit=<sha>
#   scripts/deploy-staging.sh rollback --to-revision=<backend-rev>=<frontend-rev>
#
# Requires: gcloud (authenticated as antwannmitchell0@gmail.com), git,
# node/npx, cloud-sql-proxy on PATH. Run from the repo root.

set -euo pipefail

PROJECT_ID="gen-lang-client-0096028843"
REGION="us-east1"
SQL_INSTANCE="gen-lang-client-0096028843:us-east1:demm-crm-staging-db"
BACKEND_SERVICE="demm-crm-backend-staging"
FRONTEND_SERVICE="demm-crm-frontend-staging"
BACKEND_URL="https://demm-crm-backend-staging-431876670120.us-east1.run.app"
FRONTEND_URL="https://demm-crm-frontend-staging-431876670120.us-east1.run.app"
PROXY_PORT="5433"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT_DIR="$REPO_ROOT/deploy-reports"

log()  { echo "[deploy] $*" >&2; }
fail() { echo "[deploy] FAIL: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'EOF'
Usage:
  deploy-staging.sh deploy --commit=<sha> [--dry-run] [--yes]
  deploy-staging.sh verify --commit=<sha>
  deploy-staging.sh rollback --backend-revision=<rev> --frontend-revision=<rev>
EOF
  exit 1
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
COMMAND="${1:-}"
[ -n "$COMMAND" ] || usage
shift || true

COMMIT_SHA=""
DRY_RUN="false"
ASSUME_YES="false"
BACKEND_REVISION=""
FRONTEND_REVISION=""

for arg in "$@"; do
  case "$arg" in
    --commit=*) COMMIT_SHA="${arg#*=}" ;;
    --dry-run) DRY_RUN="true" ;;
    --yes) ASSUME_YES="true" ;;
    --backend-revision=*) BACKEND_REVISION="${arg#*=}" ;;
    --frontend-revision=*) FRONTEND_REVISION="${arg#*=}" ;;
    *) fail "Unknown argument: $arg" ;;
  esac
done

gcloud_as_deployer() {
  gcloud config set account antwannmitchell0@gmail.com >/dev/null 2>&1
  gcloud "$@"
}

# ---------------------------------------------------------------------------
# Guard 1: refuse a dirty working tree
# ---------------------------------------------------------------------------
require_clean_tree() {
  cd "$REPO_ROOT"
  if [ -n "$(git status --porcelain)" ]; then
    fail "Working tree is dirty. Commit or stash your changes before deploying. (git status --porcelain is non-empty)"
  fi
  log "Working tree is clean."
}

# ---------------------------------------------------------------------------
# Guard 2/3: commit must be explicit, and must exist both locally and on
# the remote's main branch (i.e. it has actually been pushed/reviewed, not
# just sitting uncommitted or on an unpushed local branch).
# ---------------------------------------------------------------------------
require_valid_commit() {
  [ -n "$COMMIT_SHA" ] || fail "No --commit=<sha> supplied. A deploy must name an explicit commit."
  cd "$REPO_ROOT"

  git cat-file -e "${COMMIT_SHA}^{commit}" 2>/dev/null \
    || fail "Commit $COMMIT_SHA does not exist locally."
  log "Commit $COMMIT_SHA exists locally."

  git fetch origin --quiet \
    || fail "Could not fetch origin to verify the commit is pushed."
  git merge-base --is-ancestor "$COMMIT_SHA" origin/main \
    || fail "Commit $COMMIT_SHA is not an ancestor of origin/main -- it has not been pushed/reviewed. Refusing to deploy an unreviewed commit."
  log "Commit $COMMIT_SHA is confirmed pushed to origin/main."
}

# ---------------------------------------------------------------------------
# Guard 4: build from a clean archive of the exact commit, never the
# working tree. git archive only includes tracked files, so node_modules
# etc. are never part of the upload -- this is what actually prevents
# "a later working-tree change entering an already-authorized build"
# (requirement 9): the archive is a content-addressed snapshot taken once,
# upfront, of $COMMIT_SHA and nothing else can get into it afterward.
# ---------------------------------------------------------------------------
BUILD_DIR=""
cleanup_build_dir() {
  if [ -n "$BUILD_DIR" ] && [ -d "$BUILD_DIR" ]; then
    rm -rf "$BUILD_DIR"
  fi
}
trap cleanup_build_dir EXIT

make_build_dir() {
  BUILD_DIR="$(mktemp -d -t demm-crm-deploy-XXXXXX)"
  log "Archiving commit $COMMIT_SHA into $BUILD_DIR (working tree is never used as build input)."
  git -C "$REPO_ROOT" archive "$COMMIT_SHA" | tar -x -C "$BUILD_DIR"
}

# ---------------------------------------------------------------------------
# Guard 6/7: migrations for this exact commit must already be applied to
# staging -- checked and (if needed) applied BEFORE any build/deploy step
# runs, so traffic can never move onto code whose schema isn't there yet.
# ---------------------------------------------------------------------------
ensure_proxy_running() {
  if lsof -i ":$PROXY_PORT" >/dev/null 2>&1; then
    log "Cloud SQL Auth Proxy already listening on :$PROXY_PORT."
    return
  fi
  log "Starting Cloud SQL Auth Proxy on :$PROXY_PORT..."
  gcloud_as_deployer auth application-default set-quota-project "$PROJECT_ID" >/dev/null 2>&1 || true
  nohup cloud-sql-proxy "$SQL_INSTANCE" --port "$PROXY_PORT" >/tmp/deploy-staging-sql-proxy.log 2>&1 &
  disown
  for _ in $(seq 1 20); do
    lsof -i ":$PROXY_PORT" >/dev/null 2>&1 && return
    sleep 1
  done
  fail "Cloud SQL Auth Proxy did not come up on :$PROXY_PORT. See /tmp/deploy-staging-sql-proxy.log"
}

staging_database_url() {
  local secret pass
  secret="$(gcloud_as_deployer secrets versions access latest --secret=DATABASE_URL --project="$PROJECT_ID")"
  pass="$(echo "$secret" | sed -E 's#postgresql://demm_staging_user:([^@]+)@.*#\1#')"
  echo "postgresql://demm_staging_user:${pass}@127.0.0.1:${PROXY_PORT}/demm_crm_staging"
}

ensure_migrations_applied() {
  ensure_proxy_running
  local db_url status_output
  db_url="$(staging_database_url)"
  cd "$BUILD_DIR/backend"

  set +e
  status_output="$(DATABASE_URL="$db_url" npx prisma migrate status 2>&1)"
  local status_code=$?
  set -e

  if [ $status_code -eq 0 ]; then
    log "Staging DB is already up to date with commit $COMMIT_SHA's migrations."
    return
  fi

  if echo "$status_output" | grep -q "have not yet been applied"; then
    log "Pending migrations for commit $COMMIT_SHA detected:"
    echo "$status_output" | grep -A 100 "have not yet been applied" >&2 || true
    if [ "$DRY_RUN" = "true" ]; then
      log "DRY RUN: would apply pending migrations now. Stopping before build/deploy."
      exit 0
    fi
    if [ "$ASSUME_YES" != "true" ]; then
      read -r -p "Apply the above migration(s) to staging now? [y/N] " reply
      [ "$reply" = "y" ] || [ "$reply" = "Y" ] || fail "Migration not applied -- deployment aborted (nothing was built or deployed)."
    fi
    DATABASE_URL="$db_url" npx prisma migrate deploy || fail "Migration apply failed -- deployment aborted before any build/deploy step ran."
    log "Migrations applied."
  else
    fail "Cannot determine migration status against staging (unexpected prisma output):\n$status_output"
  fi

  # Re-verify: schema and migration state MUST match before we proceed.
  set +e
  DATABASE_URL="$db_url" npx prisma migrate status >/tmp/deploy-staging-migrate-status.log 2>&1
  local recheck=$?
  set -e
  [ $recheck -eq 0 ] || fail "Staging DB migration state still does not match commit $COMMIT_SHA after applying -- refusing to deploy. See /tmp/deploy-staging-migrate-status.log"
  log "Confirmed: staging DB schema matches commit $COMMIT_SHA."
}

# ---------------------------------------------------------------------------
# Capture the revisions serving traffic BEFORE this deploy, so a failed
# post-deploy identity check can roll back automatically.
# ---------------------------------------------------------------------------
current_revision() {
  local service="$1"
  gcloud_as_deployer run services describe "$service" --region="$REGION" --project="$PROJECT_ID" \
    --format="value(status.traffic[0].revisionName)"
}

# ---------------------------------------------------------------------------
# Build + push + deploy, from the archived commit only.
# ---------------------------------------------------------------------------
run_build() {
  cd "$BUILD_DIR"
  log "Submitting Cloud Build for commit $COMMIT_SHA (source: $BUILD_DIR, not the working tree)."
  gcloud_as_deployer builds submit \
    --config=cloudbuild.yaml \
    --project="$PROJECT_ID" \
    --substitutions="_GIT_COMMIT_SHA=${COMMIT_SHA}" \
    . 2>&1 | tee /tmp/deploy-staging-build.log
  BUILD_ID="$(grep -oE '[a-f0-9-]{36}' /tmp/deploy-staging-build.log | head -1)"
  [ -n "${BUILD_ID:-}" ] || fail "Could not determine Cloud Build ID from build output."
  log "Cloud Build ID: $BUILD_ID"
}

# ---------------------------------------------------------------------------
# Guard 5 verification: the deployed /version must match the authorized SHA
# on BOTH services. Mismatch triggers an automatic rollback to whatever was
# serving traffic before this deploy started.
# ---------------------------------------------------------------------------
verify_deployed_sha() {
  local backend_sha frontend_sha
  backend_sha="$(curl -fsS "$BACKEND_URL/version" | node -pe 'JSON.parse(require("fs").readFileSync(0)).commitSha' 2>/dev/null || echo "UNREACHABLE")"
  frontend_sha="$(curl -fsS "$FRONTEND_URL/api/version" | node -pe 'JSON.parse(require("fs").readFileSync(0)).commitSha' 2>/dev/null || echo "UNREACHABLE")"

  log "Live backend /version commitSha:  $backend_sha"
  log "Live frontend /api/version commitSha: $frontend_sha"

  if [ "$backend_sha" != "$COMMIT_SHA" ] || [ "$frontend_sha" != "$COMMIT_SHA" ]; then
    log "MISMATCH: deployed commit does not match authorized commit $COMMIT_SHA."
    if [ -n "${PREV_BACKEND_REVISION:-}" ] && [ -n "${PREV_FRONTEND_REVISION:-}" ]; then
      log "Auto-rolling back traffic to previous revisions: $PREV_BACKEND_REVISION / $PREV_FRONTEND_REVISION"
      gcloud_as_deployer run services update-traffic "$BACKEND_SERVICE" --region="$REGION" --project="$PROJECT_ID" --to-revisions="${PREV_BACKEND_REVISION}=100"
      gcloud_as_deployer run services update-traffic "$FRONTEND_SERVICE" --region="$REGION" --project="$PROJECT_ID" --to-revisions="${PREV_FRONTEND_REVISION}=100"
    fi
    fail "Deployment identity check failed -- rolled back. This deploy is NOT live."
  fi
  log "Confirmed: live staging is running exactly commit $COMMIT_SHA on both services."
}

# ---------------------------------------------------------------------------
# Deployment report
# ---------------------------------------------------------------------------
write_report() {
  mkdir -p "$REPORT_DIR"
  local branch new_backend_rev new_frontend_rev migrations_json report_file
  branch="$(git -C "$REPO_ROOT" branch --show-current)"
  new_backend_rev="$(current_revision "$BACKEND_SERVICE")"
  new_frontend_rev="$(current_revision "$FRONTEND_SERVICE")"
  migrations_json="$(cd "$BUILD_DIR/backend" && ls prisma/migrations | grep -v migration_lock.toml | node -pe 'JSON.stringify(require("fs").readFileSync(0,"utf8").trim().split("\n"))')"
  report_file="$REPORT_DIR/${COMMIT_SHA}-$(date -u +%Y%m%dT%H%M%SZ).json"

  cat > "$report_file" <<EOF
{
  "repository": "demm-crm",
  "branch": "$branch",
  "commit": "$COMMIT_SHA",
  "cloudBuildId": "${BUILD_ID:-null}",
  "backendRevision": "$new_backend_rev",
  "frontendRevision": "$new_frontend_rev",
  "migrations": $migrations_json,
  "deployedAtUtc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deployedBy": "antwannmitchell0@gmail.com"
}
EOF
  log "Deployment report written: $report_file"
  cat "$report_file" >&2
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------
cmd_deploy() {
  require_clean_tree
  require_valid_commit
  make_build_dir
  ensure_migrations_applied

  PREV_BACKEND_REVISION="$(current_revision "$BACKEND_SERVICE" || true)"
  PREV_FRONTEND_REVISION="$(current_revision "$FRONTEND_SERVICE" || true)"
  log "Previous revisions recorded for rollback safety: $PREV_BACKEND_REVISION / $PREV_FRONTEND_REVISION"

  if [ "$DRY_RUN" = "true" ]; then
    log "DRY RUN: all guards passed. Would now build+deploy commit $COMMIT_SHA. Stopping."
    exit 0
  fi

  run_build
  verify_deployed_sha
  write_report
  log "Deployment of $COMMIT_SHA to staging: SUCCESS."
}

cmd_verify() {
  [ -n "$COMMIT_SHA" ] || fail "verify requires --commit=<sha>"
  verify_deployed_sha
}

cmd_rollback() {
  [ -n "$BACKEND_REVISION" ] && [ -n "$FRONTEND_REVISION" ] || fail "rollback requires --backend-revision=<rev> --frontend-revision=<rev>"
  log "Rolling back traffic to $BACKEND_REVISION (backend) and $FRONTEND_REVISION (frontend)."
  gcloud_as_deployer run services update-traffic "$BACKEND_SERVICE" --region="$REGION" --project="$PROJECT_ID" --to-revisions="${BACKEND_REVISION}=100"
  gcloud_as_deployer run services update-traffic "$FRONTEND_SERVICE" --region="$REGION" --project="$PROJECT_ID" --to-revisions="${FRONTEND_REVISION}=100"
  log "Traffic rolled back. NOTE: this does not touch the database. If the previous revision needs an older"
  log "schema, apply the relevant migration's rollback.sql by hand after reviewing it -- see"
  log "backend/prisma/migrations/<name>/rollback.sql. Never run a rollback.sql against a live DB unreviewed."
}

case "$COMMAND" in
  deploy) cmd_deploy ;;
  verify) cmd_verify ;;
  rollback) cmd_rollback ;;
  *) usage ;;
esac

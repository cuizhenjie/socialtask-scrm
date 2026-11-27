#!/usr/bin/env bash
set -euo pipefail

if [ "${CONFIRM_RESTORE:-}" != "YES" ]; then
  echo "Refusing to restore without CONFIRM_RESTORE=YES." >&2
  echo "Usage: CONFIRM_RESTORE=YES bash scripts/restore-db.sh ./backups/<TIMESTAMP>" >&2
  exit 1
fi

BACKUP_PATH="${1:-}"
if [ -z "$BACKUP_PATH" ] || [ ! -f "$BACKUP_PATH/socialtask.sql.gz" ] || [ ! -f "$BACKUP_PATH/uploads.tar.gz" ]; then
  echo "ERROR: Invalid backup directory: $BACKUP_PATH" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/infra/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/infra/compose.yaml}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

echo "[1/4] Verifying checksums"
(cd "$BACKUP_PATH" && shasum -a 256 -c SHA256SUMS.txt)

echo "[2/4] Stopping api and web to prevent concurrent writes"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop api web

echo "[3/4] Restoring PostgreSQL database socialtask"
gunzip -c "$BACKUP_PATH/socialtask.sql.gz" | \
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T -e PGPASSWORD="$DB_PASSWORD" postgres \
  psql -U socialtask -d socialtask -v ON_ERROR_STOP=1

echo "[4/4] Restoring uploads volume and restarting services"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d api
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api \
  sh -c 'rm -rf /app/var/uploads/* && tar -xzf - -C /app/var' < "$BACKUP_PATH/uploads.tar.gz"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d api web

echo "Restore completed. Run 'make health' and inspect logs."

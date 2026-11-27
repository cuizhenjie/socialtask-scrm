#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/infra/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/infra/compose.yaml}"
BACKUP_BASE="${BACKUP_DIR:-$ROOT/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_BASE/$STAMP"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Copy .env.example to infra/.env first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

mkdir -p "$TARGET"
chmod 700 "$TARGET"

echo "[1/3] Dumping PostgreSQL database socialtask -> $TARGET/socialtask.sql.gz"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T -e PGPASSWORD="$DB_PASSWORD" postgres \
  pg_dump -U socialtask -d socialtask --no-owner --clean --if-exists | gzip -9 > "$TARGET/socialtask.sql.gz"

echo "[2/3] Archiving private uploads volume -> $TARGET/uploads.tar.gz"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api \
  tar -czf - -C /app/var uploads > "$TARGET/uploads.tar.gz"

echo "[3/3] Generating SHA-256 checksums"
(cd "$TARGET" && shasum -a 256 socialtask.sql.gz uploads.tar.gz > SHA256SUMS.txt)

echo "Backup completed: $TARGET"
ls -lh "$TARGET"

#!/usr/bin/env bash
# Dump the PostgreSQL database to a timestamped, compressed file. Usage: DATABASE_URL=... ./scripts/backup_db.sh [folder]
# Schedule it with cron (for example daily) and copy the files somewhere off the server.
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL to the PostgreSQL connection string}"
DEST="${1:-backups}"
mkdir -p "$DEST"
FILE="$DEST/risknresq-$(date +%Y%m%d-%H%M%S).sql.gz"
pg_dump --no-owner "$DATABASE_URL" | gzip > "$FILE"
echo "Backup written to $FILE"
# keep the 14 most recent
ls -1t "$DEST"/risknresq-*.sql.gz | tail -n +15 | xargs -r rm --

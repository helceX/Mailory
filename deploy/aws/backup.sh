#!/usr/bin/env bash
# Daily logical backup to S3 (needs the instance role to allow s3:PutObject on the bucket). Cron example:
#   17 3 * * * cd /opt/mailory/deploy/aws && BACKUP_BUCKET=my-mailory-backups ./backup.sh >> /var/log/mailory-backup.log 2>&1
# Works for RDS or the local `db` container: pg_dump runs from a throwaway postgres image against DATABASE_URL.
set -euo pipefail
cd "$(dirname "$0")"
: "${BACKUP_BUCKET:?set BACKUP_BUCKET}"
set -a; . ./.env; set +a
NAME="mailory-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
NET=()
case "$DATABASE_URL" in *@db:*) NET=(--network mailory_default);; esac
docker run --rm "${NET[@]}" postgres:16-alpine pg_dump --no-owner "$DATABASE_URL" | gzip > "/tmp/$NAME"
aws s3 cp "/tmp/$NAME" "s3://$BACKUP_BUCKET/db/$NAME" --storage-class STANDARD_IA
rm -f "/tmp/$NAME"
echo "backup ok: $NAME"

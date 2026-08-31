#!/bin/sh

set -eu

docker compose exec -T postgres sh -c '
  psql \
    -v ON_ERROR_STOP=1 \
    -v db_user="$POSTGRES_USER" \
    -v db_password="$POSTGRES_PASSWORD" \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB"
' <<'SQL'
ALTER ROLE :"db_user" WITH PASSWORD :'db_password';
SQL

echo "Docker PostgreSQL password synchronized with .env."

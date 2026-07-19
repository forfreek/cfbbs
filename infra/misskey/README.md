# Disposable Misskey federation peer

This stack is a local, on-demand ActivityPub peer for CFBBS interoperability
tests. It deliberately binds only to loopback; expose it through a dedicated
HTTPS Nginx virtual host only after the test hostname and reverse-proxy scope
have been approved.

It is pinned to Misskey `2026.6.0`, PostgreSQL `16.9-alpine`, and Redis
`7.4.2-alpine`. The service memory limits add up to 2560 MiB (2.5 GiB).

## Prepare configuration

```bash
cd /disk/cfbbs/infra/misskey
cp .env.example .env
mkdir -p config
cp config/default.yml.example config/default.yml
chmod 600 .env config/default.yml
```

Replace the password and instance ID in both files. Set `url` in
`config/default.yml` to the final `https://misskey-test.<base-domain>/` URL
before starting the service. The configuration files are ignored by Git.

Validate interpolation and Compose syntax without pulling or starting images:

```bash
docker compose --env-file .env -f compose.yml config
```

## Start and stop

Starting the stack pulls images if they are not already present. Do this only
after the test domain, Nginx proxy, and external-testing window are approved.

```bash
docker compose --env-file .env -f compose.yml up -d
docker compose --env-file .env -f compose.yml ps
docker compose --env-file .env -f compose.yml logs -f misskey
docker compose --env-file .env -f compose.yml down
```

`down` preserves the three named volumes. To irreversibly delete this test
instance and its data, use `down -v` only after a verified backup.

## Backup, restore, and diagnostics

Create a timestamped backup directory outside this repository and dump the
database plus uploaded files:

```bash
backup_dir=/disk/cfbbs-backups/misskey-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$backup_dir"
docker compose --env-file .env -f compose.yml exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$backup_dir/misskey.sql"
docker compose --env-file .env -f compose.yml cp misskey:/misskey/files \
  "$backup_dir/files"
sha256sum "$backup_dir/misskey.sql" > "$backup_dir/SHA256SUMS"
```

Restore only into a freshly reset disposable stack, after confirming the target
is not production:

```bash
docker compose --env-file .env -f compose.yml exec -T db \
  sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"' < "$backup_dir/misskey.sql"
```

Inspect service health and logs with:

```bash
docker compose --env-file .env -f compose.yml ps
docker compose --env-file .env -f compose.yml logs --tail=200 misskey db redis
```

Do not run a database reset, container teardown, image pull, or Nginx change
as part of ordinary CFBBS development.

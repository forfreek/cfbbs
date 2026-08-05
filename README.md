# CFBBS

CFBBS is a Cloudflare Workers-native, ActivityPub-capable discussion board.
It combines a local forum core with public federation, private boards, user
governance, media attachments, notifications, and Misskey interoperability.

The project is licensed under [AGPL-3.0-or-later](LICENSE).

## What It Includes

- React Router SSR served by a single Cloudflare Worker.
- Cloudflare D1 as the authoritative database, with Drizzle migrations.
- Better Auth sessions, email verification, password reset, session revocation,
  soft deletion, RBAC, moderation, and audit logs.
- Public and private boards. Private content is excluded from search,
  notifications, caches, ActivityPub objects, and federation outbox events.
- Markdown topics and replies with drafts, cursor pagination, bookmarks,
  bookmark folders, local follows, thread subscriptions, mentions, hashtags,
  polls, quotes, reactions, and boosts.
- Qiniu S3-compatible media storage for image and document attachments.
  Cloudflare R2 is not required.
- ActivityPub federation through Fedify, including Notes, replies, updates,
  deletes, follows, likes, reactions, boosts, quotes, polls, hashtags, and
  mentions.
- Web Push notifications with per-device subscriptions and VAPID keys.
- An outbound-only HTTPS email gateway for transactional mail. SMTP
  credentials remain on the gateway host and never enter the Worker or Git.
- Chinese and English UI messages plus light, dark, and system themes.

## Architecture

```text
Browser
  |
  v
Cloudflare Worker (React Router SSR + ActivityPub)
  |-- D1       forum, identity, moderation, media metadata, outbox
  |-- KV       rate limits and Fedify state
  |-- Queue    federation delivery and retries
  |-- Qiniu    attachment bytes through the S3 API
  `-- HTTPS email gateway -> upstream SMTP provider
```

D1 stores metadata and permissions. Attachment bytes are stored in Qiniu and
are exposed only through the Worker's `/media/:id` permission checks. Public
attachments can be fetched anonymously; private or unattached media requires
an authorized session.

## Requirements

- Node.js `22.23.1` (see `.node-version`)
- Corepack and pnpm `11.15.0`
- Cloudflare Wrangler for remote D1 and Worker operations

Enable Corepack and install dependencies:

```bash
corepack enable
pnpm install
```

## Local Development

Create local-only variables from the example. Do not commit `.dev.vars`.

```bash
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm db:seed
pnpm dev
```

The development server listens on `http://127.0.0.1:5173` by default.

Local D1 data is persisted by Wrangler. To regenerate migration files after a
schema change:

```bash
pnpm db:generate
pnpm db:migrate:local
```

Required local secrets are `BETTER_AUTH_SECRET` and
`FEDERATION_KEY_ENCRYPTION_SECRET`. Email, Web Push, and S3 are optional for
the basic local forum; their variable names are documented in
[`.dev.vars.example`](.dev.vars.example).

## Verification

Run the full local gate before committing:

```bash
pnpm check
```

`pnpm check` runs lint, formatting validation, type generation and typecheck,
unit tests, local D1 integration tests, a production build, and a Wrangler
deploy dry-run.

Individual commands are useful while iterating:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

The E2E suite starts an isolated local Worker, applies local migrations, seeds
the database, and tests Chromium desktop and mobile projects. It does not use
the remote test database.

## Test Deployment

The committed `test` environment uses separate Cloudflare resources:

- Worker: `cfbbs-test`
- D1: `cfbbs-test-db`
- KV: `FEDIFY_KV` in the test environment
- Queue: `cfbbs-test-federation` and its dead-letter queue
- URL: `https://cfbbs-test.s.lukelzlz.top`

Authenticate Wrangler before the first remote operation:

```bash
pnpm exec wrangler login
```

Apply remote migrations before deploying code. The command is idempotent and
does not overwrite existing data:

```bash
pnpm exec wrangler d1 migrations apply cfbbs-test-db --env test --remote
pnpm deploy:test
```

Set test secrets interactively. Never put their values in `wrangler.json`, Git,
D1, or the frontend:

```bash
pnpm exec wrangler secret put BETTER_AUTH_SECRET --env test
pnpm exec wrangler secret put FEDERATION_KEY_ENCRYPTION_SECRET --env test
pnpm exec wrangler secret put EMAIL_GATEWAY_TOKEN --env test
pnpm exec wrangler secret put VAPID_PRIVATE_JWK --env test
```

The test environment enables `EMAIL_MODE=http` and points the Worker at the
outbound gateway. Production defaults to `EMAIL_MODE=disabled` until separate
production authorization and secrets are provided.

## Media Storage

CFBBS uses any S3-compatible provider. The current test setup uses Qiniu, not
Cloudflare R2. Configure these secrets for the target Worker:

```text
S3_ENDPOINT
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
S3_REGION
S3_FORCE_PATH_STYLE
```

See [docs/operations/media-s3.md](docs/operations/media-s3.md) for provider
configuration and [scripts/s3-smoke.mts](scripts/s3-smoke.mts) for a
put/read/delete smoke test. The smoke test uses a temporary object and removes
it after verification.

Upload constraints are enforced server-side: image/jpeg, image/png,
image/webp, image/gif, application/pdf, text/plain, and application/zip;
5 MiB per file and 4 files per post.

## Email Gateway

The gateway is a small outbound-only HTTPS service. It accepts authenticated
transactional requests, connects to the upstream SMTP provider, and does not
provide inbound SMTP, IMAP, MX, mailboxes, or an open relay.

Deployment and systemd/Nginx configuration are documented in
[infra/email-gateway/README.md](infra/email-gateway/README.md). SMTP passwords
and the gateway token must be installed through a protected EnvironmentFile or
Cloudflare Secret and must never be logged or committed.

## Federation and Misskey

ActivityPub endpoints include WebFinger, NodeInfo, actor profiles, inboxes,
outboxes, public Notes, and federation delivery diagnostics. Public local
content is federated; private content never leaves the instance.

The disposable Misskey interoperability stack and its safety boundaries are
documented in [infra/misskey/README.md](infra/misskey/README.md). The complete
test matrix is in
[docs/operations/federation-test.md](docs/operations/federation-test.md).

Do not reuse production D1, KV, Queue, Redis, PostgreSQL, Docker volumes, or
Nginx virtual hosts for federation testing.

## Database Migrations

Migration files live in `drizzle/` and are applied in order. Local and remote
environments must use the same sequence:

```bash
# local
pnpm db:migrate:local

# test remote
pnpm exec wrangler d1 migrations apply cfbbs-test-db --env test --remote
```

Back up and inspect the target schema before applying a production migration.
Never reset a remote database as part of ordinary development.

## Repository Layout

```text
app/                 React Router routes, UI, domain modules, and D1 schema
workers/app.ts       Cloudflare Worker entrypoint and request dispatch
drizzle/             Ordered D1 migration files
tests/unit/          Unit and service tests
tests/integration/   Local D1 integration tests
tests/e2e/           Browser tests for desktop and mobile
infra/email-gateway/ Outbound transactional mail gateway
infra/misskey/       Disposable Misskey federation peer
docs/operations/     Deployment and interoperability runbooks
```

## Security Boundaries

- Publishing, replies, uploads, reactions, boosts, quotes, likes, and remote
  follows require an active, email-verified account.
- Private boards and their attachments are authorization-checked on every
  read and never federated.
- Rate limits use the shared `FEDIFY_KV` namespace with the `rl:v1:` prefix.
- SMTP, S3, VAPID private keys, auth secrets, and federation encryption keys
  are secrets. Do not print or commit them.
- Use the test environment for interoperability work. Do not deploy
  production or change production resources from a local development session.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).

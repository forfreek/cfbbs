# Federation test environment runbook

This runbook describes the future, disposable interoperability environment.
No command in this document has been run for CFBBS yet. The repository has no
Cloudflare remote resources, deployed Worker, Docker containers, or Nginx
changes created by this plan.

## Required approval and inputs

Before beginning the remote phase, obtain all of the following:

- a base domain and explicit names for `bbs-test.<base-domain>` and
  `misskey-test.<base-domain>`;
- authorization to authenticate the intended Cloudflare account and create
  its test-only D1, KV, Queue, and DLQ resources;
- authorization to pull and start the Misskey test stack; and
- approval for one narrowly scoped Nginx HTTPS virtual host for the Misskey
  hostname.

Never reuse a production Worker, D1 database, KV namespace, Queue, Redis
instance, PostgreSQL database, Docker volume, or unrelated Nginx virtual host.

## Provisioning order

After approval, authenticate interactively and create only the resources named
in the implementation plan. Record the returned resource IDs exclusively in
the `test` environment of `wrangler.json`; do not put them in source files,
shell history, or this document.

```bash
pnpm exec wrangler login
pnpm exec wrangler d1 create cfbbs-test-db
pnpm exec wrangler kv namespace create FEDIFY_KV --env test
pnpm exec wrangler queues create cfbbs-test-federation
pnpm exec wrangler queues create cfbbs-test-federation-dlq
```

Set secrets interactively, apply migrations, then deploy only the `test`
environment:

```bash
pnpm exec wrangler secret put BETTER_AUTH_SECRET --env test
pnpm exec wrangler secret put FEDERATION_KEY_ENCRYPTION_SECRET --env test
pnpm exec wrangler d1 migrations apply cfbbs-test-db --env test
pnpm exec wrangler deploy --env test
```

Use the Compose instructions in
[`infra/misskey/README.md`](../../infra/misskey/README.md) only after its URL
is served by the approved HTTPS virtual host.

## Interoperability matrix

Run the following in order, recording both CFBBS delivery diagnostics and the
Misskey-side result. Do not treat an HTML page success as ActivityPub success.

| Check                                          | Expected result                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| WebFinger and Actor discovery, both directions | Canonical HTTPS actor IDs and ActivityStreams responses                       |
| Follow and unfollow, both directions           | State changes are reflected without duplicate follows                         |
| CFBBS public topic and reply                   | Misskey receives public Notes with correct reply linkage                      |
| Misskey reply and CFBBS reply                  | Each is displayed in the matching public thread                               |
| Likes, update, and delete                      | Activities are idempotent and converge visibly                                |
| Blocked instance                               | No new display, notification, or outbound delivery occurs                     |
| Stop and recover Misskey                       | Pending delivery retries and diagnostics show recovery                        |
| Private board                                  | Actor/object routes return no public representation and no delivery is queued |

## Teardown

Back up the Misskey database and files, verify the checksum, stop the Compose
stack, remove its test-only DNS/proxy configuration, and then delete test
Cloudflare resources only with an explicit separate approval. Preserve the
interoperability test record and do not delete any production resource.

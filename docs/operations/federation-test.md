# Federation test environment runbook

This runbook describes the disposable interoperability environment. No
Cloudflare remote resources, deployed Worker, or Docker containers have been
created for CFBBS yet. The host has one dedicated exact-match Nginx vhost at
`/www/server/panel/vhost/nginx/misskey-test.s.lukelzlz.top.conf`; it proxies
only `misskey-test.s.lukelzlz.top` to loopback `127.0.0.1:3100` and does not
modify the existing 宝塔 wildcard site.

## Required approval and inputs

Before beginning the remote phase, obtain all of the following:

- the test hostnames `cfbbs-test.s.lukelzlz.top` and
  `misskey-test.s.lukelzlz.top`;
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
is served by the approved HTTPS virtual host. The test stack binds Misskey to
`127.0.0.1:3100`, so its vhost must proxy only that loopback address.

Before the stack is started the vhost correctly returns `502`; that confirms
the exact hostname is selected instead of the existing wildcard site. Verify
that it returns Misskey's `/api/meta` response after the stack becomes healthy.

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

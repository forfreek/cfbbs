# Media attachments via S3-compatible storage

CFBBS stores attachment bytes in an S3-compatible bucket. Cloudflare R2 is not required.

## Required secrets / vars

- `S3_ENDPOINT` — API endpoint, e.g. `https://s3.amazonaws.com` or a MinIO/B2/COS endpoint
- `S3_BUCKET` — bucket name
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_REGION` — defaults to `auto` when omitted
- `S3_FORCE_PATH_STYLE` — defaults to `true` (MinIO / many compatible providers). Set `false` for AWS virtual-hosted-style

Public media is still served by the Worker at `/media/:id` after permission checks. Federation Notes advertise those Worker URLs, not raw S3 URLs.

## Local

Put the values in `.dev.vars` (see `.dev.vars.example`).

## Test / production Worker

```bash
pnpm exec wrangler secret put S3_ENDPOINT --env test
pnpm exec wrangler secret put S3_BUCKET --env test
pnpm exec wrangler secret put S3_ACCESS_KEY_ID --env test
pnpm exec wrangler secret put S3_SECRET_ACCESS_KEY --env test
pnpm exec wrangler secret put S3_REGION --env test
# optional
pnpm exec wrangler secret put S3_FORCE_PATH_STYLE --env test
```

Then redeploy:

```bash
pnpm run deploy:test
```

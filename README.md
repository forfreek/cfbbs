# CFBBS

CFBBS is a Cloudflare Workers-native, ActivityPub-capable BBS.

The current repository contains the React Router SSR and Cloudflare Workers
foundation. Forum features, D1 schema, authentication, permissions, and
ActivityPub federation are implemented in later milestones documented in
[`docs/superpowers/plans/2026-07-19-cfbbs-initialization-and-architecture.md`](docs/superpowers/plans/2026-07-19-cfbbs-initialization-and-architecture.md).

## Requirements

- Node.js 22.23.1
- Corepack with pnpm 11.15.0

## Local development

```bash
corepack enable
pnpm install
pnpm dev
```

The local SSR development server listens on `http://localhost:5173` by default.

## Verification

```bash
pnpm typecheck
pnpm build
```

No Cloudflare account or remote resource is required for these initialization checks.

## License

AGPL-3.0-or-later. The full license text will be added before the first public release.

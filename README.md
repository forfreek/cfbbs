# CFBBS

CFBBS is a Cloudflare Workers-native, ActivityPub-capable BBS.

The repository includes the React Router SSR Worker, local forum core,
hierarchical permissions, moderation controls, and ActivityPub protocol work.
The implementation status and remaining remote-interoperability prerequisites
are recorded in
[`docs/superpowers/plans/2026-07-19-cfbbs-initialization-and-architecture.md`](docs/superpowers/plans/2026-07-19-cfbbs-initialization-and-architecture.md).

## Requirements

- Node.js 22.23.1
- Corepack with pnpm 11.15.0

## Local development

```bash
corepack enable
pnpm install
pnpm db:migrate:local
pnpm db:seed
pnpm dev
```

The local SSR development server listens on `http://localhost:5173` by default.

## Verification

```bash
pnpm typecheck
pnpm test:integration
pnpm build
pnpm test:e2e
```

No Cloudflare account or remote resource is required for these initialization checks.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).

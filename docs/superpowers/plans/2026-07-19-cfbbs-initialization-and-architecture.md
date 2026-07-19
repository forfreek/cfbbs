# CFBBS Initialization and Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an AGPL-licensed, Cloudflare Workers-native public BBS with a local forum core, configurable hierarchical permissions, and Misskey-compatible bidirectional ActivityPub federation.

**Architecture:** Deploy one modular Worker that serves React Router SSR pages and ActivityPub endpoints. Store authoritative business and moderation state in D1; use Fedify with a dedicated KV namespace, Queue, and dead-letter Queue for protocol work; use a D1 outbox so a successful forum write cannot silently lose its federation event. Deliver the project in three independently testable milestones: engineering bootstrap, local BBS core, and ActivityPub interoperability.

**Tech Stack:** Node.js 22.23.1, pnpm 11.15.0, create-cloudflare 2.70.12, React Router SSR, TypeScript, Tailwind CSS, shadcn/ui, Drizzle ORM, Cloudflare D1/KV/Queues/Cron, Better Auth 1.6.23, Fedify 2.3.3, Vitest, Playwright, GitHub Actions, Misskey 2026.6.0.

---

## Product Decisions

- Public community: guests can browse public boards; registered users can participate subject to RBAC.
- Local login uses immutable lowercase usernames and passwords. Federation handles are `@username@domain`.
- The interface is a modern, content-focused community rather than a dense classic forum or a social-feed-first clone.
- Boards support arbitrary depth. Each board is configured as a container, posting board, or read-only board.
- Custom user groups provide an allow-only permission matrix at site or board scope. Permissions from multiple groups are unioned.
- Private boards are group-authorized and never federate or leak into public search, notifications, caches, ActivityPub objects, or outbox rows.
- Markdown is stored as source and rendered to sanitized HTML.
- Thread replies are chronological and include links to the replied-to post while preserving the real `inReplyTo` relationship.
- First release interactions are follows, replies, and likes. Attachments, private messages, email, points, boosts, and emoji reactions are excluded.
- Each local user is an ActivityPub `Person`; local topics and replies are public `Note` objects. Boards remain local taxonomy and are not `Group` actors.
- Remote notes from followed actors appear in a separate following feed. Remote replies to local posts appear in the local thread.
- Remote objects are retained for 90 days unless locally referenced, involved in an active discussion, or retained as moderation evidence.
- Federation is open by default with instance blocking, actor blocking, user mute/block, reporting, audit logs, rate controls, retries, and circuit breaking.
- Only public ActivityPub content is supported. Non-public activities, direct messages, and `Announce` are rejected or ignored without public display.

## Target Project Structure

```text
app/
  components/              Shared UI primitives and composed forum UI
  routes/                  React Router pages, resource routes, and auth endpoints
  modules/
    identity/              Better Auth integration and local profiles
    forum/                 Boards, threads, posts, revisions, likes, and search
    permissions/           RBAC evaluation and board-scope authorization
    federation/            Fedify dispatchers, listeners, mappings, and remote fetch policy
    moderation/            Reports, blocks, instance policy, and audit logging
    jobs/                  D1 outbox dispatch, retention, cleanup, and recovery
  db/
    schema/                Drizzle tables grouped by domain
    client.server.ts       D1/Drizzle construction
  lib/                     IDs, Markdown, validation, URLs, and response helpers
drizzle/                   Generated SQL migrations
tests/
  unit/                    Pure domain behavior
  integration/             D1, routes, bindings, and federation fixtures
  e2e/                     Playwright browser flows
infra/misskey/             On-demand Misskey/PostgreSQL/Redis Compose stack
docs/                      Architecture, security, operations, and implementation plans
.github/workflows/ci.yml   Pull-request and branch validation
wrangler.jsonc             Local and test bindings, queues, cron, and compatibility flags
```

## Core Public Types and Invariants

Create stable domain types before building routes:

```ts
export type BoardMode = "container" | "posting" | "read_only";
export type BoardVisibility = "public" | "private";
export type PostOrigin = "local" | "remote";
export type PostState = "published" | "hidden" | "deleted";

export type Permission =
  | "site.manage"
  | "users.manage"
  | "groups.manage"
  | "federation.manage"
  | "boards.manage"
  | "boards.view"
  | "threads.create"
  | "posts.reply"
  | "posts.edit_any"
  | "posts.delete_any"
  | "threads.pin"
  | "threads.lock"
  | "reports.manage"
  | "audit.view";

export interface AuthorizationRequest {
  userId: string | null;
  permission: Permission;
  boardId?: string;
}

export interface FederationOutboxEvent {
  id: string;
  actorId: string;
  aggregateType: "post" | "follow" | "like";
  aggregateId: string;
  activityType: "Create" | "Update" | "Delete" | "Follow" | "Undo" | "Like";
  status: "pending" | "queued" | "delivered" | "failed";
}
```

Invariants:

- Local public URLs, Actor IDs, and Object IDs are immutable after federation.
- Business data and moderation state are authoritative in D1. Fedify KV contains no forum posts, groups, or permissions.
- A private board access check is mandatory in every loader, action, search query, notification renderer, and background job.
- Creating or editing a public local post writes the post, revision, ActivityPub object record, and outbox event in one D1 atomic batch.
- Deleting a federated post retains its identity, publishes `Delete`/`Tombstone`, and does not promise remote deletion.
- Route modules adapt HTTP requests to domain services; they do not contain raw authorization or federation business logic.

## Milestone 1: Engineering Bootstrap

### Task 1: Initialize toolchain and repository

**Files:** `.node-version`, `.npmrc`, `package.json`, `pnpm-lock.yaml`, `.gitignore`, `LICENSE`, `README.md`

- [x] Verify `node --version` is `v22.23.1` in the login shell.
- [x] Run `corepack enable` and activate `pnpm@11.15.0`.
- [x] Add a project `.npmrc` containing `registry=https://registry.npmjs.org/`; do not modify `/root/.npmrc`.
- [x] Generate the Cloudflare React Router TypeScript scaffold in a temporary directory with `pnpm dlx create-cloudflare@2.70.12 cfbbs --framework=react-router --lang=ts --no-deploy --no-git`, then merge it into `/disk/cfbbs` while preserving `docs/`.
- [x] Initialize Git locally and add the AGPL-3.0 license. Do not create a remote or push.
- [x] Set `packageManager` to `pnpm@11.15.0` and add scripts: `dev`, `build`, `typecheck`, `lint`, `format:check`, `test`, `test:integration`, `test:e2e`, `db:generate`, `db:migrate:local`, `db:seed`, and aggregate `check`.
- [x] Run `pnpm install` and commit the generated lockfile.
- [x] Commit with `chore: initialize Cloudflare Workers project`.

### Task 2: Add quality, UI, and test foundations

**Files:** `eslint.config.js`, `.prettierrc`, `vitest.config.ts`, `playwright.config.ts`, `components.json`, `app/styles/app.css`, `.github/workflows/ci.yml`

- [x] Install Tailwind CSS, shadcn/ui prerequisites, Drizzle, Better Auth, Fedify, Zod, Markdown parsing/sanitization, Vitest, Cloudflare test utilities, and Playwright.
- [x] Configure strict TypeScript and fail CI on type errors, lint errors, formatting drift, test failure, or build failure.
- [x] Configure shadcn with accessible neutral primitives while keeping forum-specific layouts custom.
- [x] Add a smoke test that renders the SSR root route and asserts a `200` response containing `CFBBS`.
- [x] Add a Playwright smoke test that loads the local home page without console errors.
- [x] Configure GitHub Actions for Node 22 and pnpm cache; run `pnpm check` without accessing real Cloudflare or Misskey resources.
- [x] Commit with `chore: add quality and test foundations`.

### Task 3: Configure Workers bindings and domain boundaries

**Files:** `wrangler.jsonc`, `.dev.vars.example`, `worker-configuration.d.ts`, `app/modules/*/index.ts`, `app/db/client.server.ts`

- [x] Configure `nodejs_compat`, local D1, Fedify KV, federation Queue, dead-letter Queue, and daily Cron bindings.
- [x] Define a separate `test` Wrangler environment with resource names `cfbbs-test-db`, `cfbbs-test-fedify`, `cfbbs-test-federation`, and `cfbbs-test-federation-dlq`.
- [x] Add `.dev.vars.example` with non-secret keys only: `APP_ORIGIN`, `BETTER_AUTH_SECRET`, and `FEDERATION_KEY_ENCRYPTION_SECRET`.
- [x] Create focused module entrypoints for identity, forum, permissions, federation, moderation, and jobs.
- [x] Add a `/health` resource route that reports application readiness without exposing secrets or raw binding identifiers.
- [x] Test that missing required bindings or secrets fail fast with a clear startup error.
- [x] Commit with `chore: configure Workers service boundaries`.

**Milestone 1 acceptance:** `pnpm install`, local migrations, seed, `pnpm dev`, `pnpm check`, and the GitHub Actions workflow all succeed from a fresh clone; no remote Cloudflare resource has been created.

## Milestone 2: Local BBS Core

### Task 4: Create D1 schema and migrations

**Files:** `app/db/schema/*`, `drizzle.config.ts`, `drizzle/0001_initial.sql`, `app/db/seed.server.ts`, `tests/integration/db/*`

- [x] Define identity/profile tables, immutable username constraints, sessions, and encrypted federation-key storage.
- [x] Define boards and a closure table supporting arbitrary depth, moves, ancestor paths, and subtree queries.
- [x] Define groups, memberships, permission grants, and optional board scope using allow-only union semantics.
- [x] Define threads, posts, revisions, likes, notifications, reports, blocks, instance policies, audit records, remote actors/objects, inbox receipts, delivery attempts, and federation outbox events.
- [x] Create D1 FTS indexes for local public topic titles and local public post bodies only.
- [x] Seed administrator, registered-user, and moderator groups plus public and private example boards.
- [x] Test migration from an empty database, deterministic seed behavior, closure-table integrity, and private-content exclusion from FTS.
- [x] Commit with `feat: add initial D1 domain schema`.

### Task 5: Implement authentication and profiles

**Files:** `app/modules/identity/*`, `app/routes/auth.*`, `app/routes/users.*`, `tests/integration/identity/*`

- [x] Configure Better Auth with the Drizzle/D1 adapter and username plugin.
- [x] Enforce immutable normalized handles matching `^[a-z0-9_]{3,32}$`, reserved-name checks, and a minimum 12-character password.
- [x] Use secure, HttpOnly, SameSite=Lax cookies; production/test cookies are Secure and scoped to the canonical host.
- [x] Implement register, login, logout, session loading, local profile editing, and public profile rendering.
- [x] Keep display name, biography, and avatar URL mutable without changing Actor identity.
- [x] Test duplicate/case-folded usernames, reserved names, invalid sessions, logout, and handle immutability.
- [ ] Commit with `feat: add local identity and profiles`.

### Task 6: Implement hierarchical boards and RBAC

**Files:** `app/modules/permissions/*`, `app/modules/forum/boards/*`, `app/routes/admin.boards.*`, `app/routes/admin.groups.*`, `tests/unit/permissions/*`

- [x] Implement one authorization entrypoint accepting `AuthorizationRequest` and returning an explainable decision.
- [x] Union grants across all user groups and support global or board-scoped grants without deny rules.
- [x] Implement board creation, move, reorder, mode changes, visibility changes, and safe closure-table updates.
- [x] Prevent moves that create cycles and prevent users from discovering inaccessible private ancestors or descendants.
- [x] Implement group management, membership assignment, permission editing, and audit logging.
- [x] Test public guest access, private group access, multiple-group unions, board-scope inheritance, cycle rejection, and administrator recovery access.
- [x] Commit with `feat: add hierarchical boards and RBAC`.

### Task 7: Implement threads, posts, Markdown, likes, and notifications

**Files:** `app/modules/forum/threads/*`, `app/modules/forum/posts/*`, `app/modules/forum/markdown/*`, `app/modules/forum/notifications/*`, `app/routes/boards.*`, `app/routes/threads.*`, `tests/integration/forum/*`

- [x] Implement public/private board listings and cursor-based topic navigation.
- [x] Implement topic creation, chronological replies, `inReplyTo`, editing, soft deletion, locking, pinning, and revision history.
- [x] Parse Markdown server-side and sanitize links and HTML against script execution, unsafe protocols, and event-handler attributes.
- [x] Implement idempotent likes and unread notifications for replies, follows, and likes.
- [x] Ensure notification payloads never expose a private board title, author, or excerpt to an unauthorized viewer.
- [x] Write public-post changes and federation outbox events atomically; do not create federation events for private boards.
- [x] Test locked threads, post ownership, moderator overrides, duplicate likes, XSS payloads, private-board leakage, and D1 outbox recovery.
- [ ] Commit with `feat: add local forum participation`.

### Task 8: Implement search, feeds, administration, and responsive UI

**Files:** `app/routes/_index.tsx`, `app/routes/search.tsx`, `app/routes/following.tsx`, `app/routes/notifications.tsx`, `app/routes/admin.*`, `app/components/*`, `tests/e2e/*`

- [ ] Build the modern forum home page, hierarchical board navigation, board pages, topic pages, editor preview, profiles, following feed, notification center, and administration shell.
- [ ] Keep important desktop metadata while reducing secondary detail on narrow screens.
- [ ] Implement local FTS search and remote lookup only by complete handle or URL.
- [ ] Add accessible keyboard navigation, visible focus, semantic landmarks, error summaries, and empty/loading states.
- [ ] Test guest browsing, registration, public posting, private-board access, moderator workflow, search, notifications, and mobile layout with Playwright.
- [ ] Commit with `feat: complete local BBS experience`.

**Milestone 2 acceptance:** A seeded local installation supports registration, hierarchical boards, custom RBAC, public/private topics, Markdown replies, likes, notifications, local search, and moderation. Every privacy test passes, and no ActivityPub delivery is required for local correctness.

## Milestone 3: ActivityPub and Interoperability

### Task 9: Integrate Fedify endpoints and object mapping

**Files:** `app/modules/federation/federation.server.ts`, `app/modules/federation/dispatchers/*`, `app/modules/federation/vocabulary/*`, `app/routes/.well-known.*`, `tests/integration/federation/*`

- [ ] Construct Fedify per Worker request with the official Workers KV and Queue adapters.
- [ ] Implement WebFinger, NodeInfo, Actor, Object, inbox, shared inbox, outbox, followers, and following dispatchers.
- [ ] Map each local user to `Person` and each public local topic/reply to `Note` with stable IDs.
- [ ] Use content negotiation so ActivityStreams clients receive JSON while browsers receive the matching HTML page.
- [ ] Generate one signing key per local Actor and encrypt the private material using the Worker secret before D1 storage.
- [ ] Test stable IDs, WebFinger normalization, HTML/JSON negotiation, Actor serialization, public addressing, and private-board nonexistence.
- [ ] Commit with `feat: expose ActivityPub identities and objects`.

### Task 10: Implement inbound and outbound federation

**Files:** `app/modules/federation/listeners/*`, `app/modules/federation/delivery/*`, `app/modules/jobs/federation-outbox.server.ts`, `app/worker.ts`, `tests/integration/federation/*`

- [x] Support `Follow`, `Accept`, `Reject`, `Undo`, `Create`, `Update`, `Delete`, and `Like`/`Undo Like`.
- [ ] Reject unsigned or replayed activities, deduplicate Activity IDs, verify Actor/Object ownership, and sanitize remote HTML.
- [x] Restrict remote fetches to HTTPS with bounded redirects, response size, timeout, and acceptable ActivityStreams content types.
- [ ] Process Fedify Queue messages in the Worker queue handler and route permanent failures to the DLQ.
- [ ] Dispatch D1 outbox events idempotently; Cron retries pending rows and marks terminal failures without changing local post success.
- [ ] Place remote replies into local threads and other followed remote Notes into the following feed.
- [ ] Ignore unsupported boosts and non-public content without displaying or notifying them.
- [ ] Test follow handshakes, replies, likes, edits, deletes, duplicate delivery, queue retry, remote outage, and unsupported visibility.
- [ ] Commit with `feat: add bidirectional ActivityPub delivery`.

### Task 11: Implement federation moderation and retention

**Files:** `app/modules/moderation/federation/*`, `app/modules/jobs/remote-retention.server.ts`, `app/routes/admin.federation.*`, `tests/integration/moderation/*`

- [x] Implement instance blocks, remote Actor blocks, user mute/block, reports, delivery diagnostics, and audit trails.
- [x] Allow valid remote replies to display immediately while quarantining abnormal rates or repeated failures.
- [x] Prevent blocked instances and Actors from producing visible replies, notifications, or new delivery attempts.
- [x] Purge remote objects older than 90 days unless referenced locally, active, or retained for moderation evidence.
- [ ] Test block precedence, user-specific mute behavior, report access, audit immutability, retention exceptions, and cleanup idempotency.
- [ ] Commit with `feat: add federation safety controls`.

### Task 12: Provision the test Worker and Misskey interoperability stack

**Files:** `infra/misskey/compose.yml`, `infra/misskey/.env.example`, `infra/misskey/README.md`, `docs/operations/federation-test.md`

- [ ] Obtain the actual base domain and use `bbs-test.<base-domain>` and `misskey-test.<base-domain>` unless the user supplies different complete names.
- [ ] Authenticate Wrangler, create the test D1/KV/Queue/DLQ resources, store their IDs only in Wrangler configuration, and upload secrets with `wrangler secret put`.
- [ ] Deploy the `test` Worker and apply test D1 migrations before enabling public federation.
- [x] Create an on-demand Compose stack pinned to Misskey 2026.6.0 with independent PostgreSQL and Redis services, persistent test volumes, health checks, and an approximate aggregate 2.5 GiB memory ceiling.
- [ ] Configure the existing Nginx to proxy the Misskey hostname over HTTPS without modifying unrelated virtual hosts.
- [ ] Verify WebFinger and Actor discovery in both directions before creating test follows.
- [ ] Exercise bidirectional follow/unfollow, BBS topic delivery, Misskey reply, BBS reply, bidirectional likes, update, delete, instance block, and delivery recovery after stopping Misskey.
- [ ] Verify private-board objects return no ActivityPub representation and never appear in Worker delivery logs or Misskey.
- [x] Document start, stop, backup, reset, log inspection, and teardown commands for the test stack.
- [ ] Commit with `test: add Misskey interoperability environment`.

**Milestone 3 acceptance:** The real test Worker and pinned Misskey instance complete the interoperability matrix over HTTPS. Queue failure and recovery are observable, moderation controls work, and private content is absent from all federation surfaces.

## Verification Commands

Run these at each milestone boundary:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

Expected result: every command exits `0`; the build targets Cloudflare Workers; tests do not require production credentials.

Before the remote interoperability milestone, additionally run:

```bash
pnpm wrangler whoami
pnpm wrangler d1 migrations list cfbbs-test-db --env test
pnpm wrangler queues list
docker compose -f infra/misskey/compose.yml config
```

Expected result: Wrangler is authenticated to the intended account, test resources are present, migrations are current, and the Compose configuration validates without using `latest` tags.

## Assumptions and External Prerequisites

- The test deployment remains separate from any future production deployment.
- The user will provide the actual test domain before Task 12.
- The Cloudflare account supports Workers, D1, KV, and Queues.
- The Cloudflare scaffold's supported React Router version is accepted and pinned by `pnpm-lock.yaml`; do not force an unsupported React Router major.
- Misskey runs only on demand because this server already hosts other services.
- No existing Docker database, Redis instance, Nginx virtual host, or live service is reused or changed outside the named test stack and hostnames.
- Production migration, production domain selection, attachments/R2, email delivery, private messaging, boosts, and emoji reactions require later plans.

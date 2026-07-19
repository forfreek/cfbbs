import {
  signedActivityDelivery,
  type SignedActivityDelivery,
} from "@/modules/federation/delivery";
import { isSafeRemoteUrl } from "@/modules/federation/remote-url";
import { nextRetry } from "@/modules/jobs/retry";

type OutboxEvent = {
  id: string;
  actorId: string;
  activityJson: string;
  actorUri: string;
  encryptedPrivateKey: string | null;
  deliveryScope: "followers" | "direct";
};

type FollowerInbox = { targetInboxUrl: string };
type StoredDelivery = {
  targetInboxUrl: string;
  state: "pending" | "delivered" | "failed";
  attempts: number;
  nextAttemptAt: string;
};

export type ActivitySender = (
  input: SignedActivityDelivery,
) => Promise<Response>;

export type OutboxDeliverySummary = {
  delivered: number;
  retrying: number;
  failed: number;
  deferred: number;
  skipped: number;
  state: "pending" | "delivered" | "failed";
};

async function defaultActivitySender(input: SignedActivityDelivery) {
  return fetch(await signedActivityDelivery(input));
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1_000);
}

function isRetryDue(nextAttemptAt: string, now: Date) {
  const retryAt = new Date(nextAttemptAt);
  return Number.isNaN(retryAt.getTime()) || retryAt <= now;
}

export async function deliverOutboxEvent(
  database: D1Database,
  input: { eventId: string; encryptionSecret: string },
  sendActivity: ActivitySender = defaultActivitySender,
): Promise<OutboxDeliverySummary | null> {
  const event = await database
    .prepare(
      "SELECT federation_outbox_events.id, federation_outbox_events.actor_id AS actorId, federation_outbox_events.activity_json AS activityJson, federation_outbox_events.delivery_scope AS deliveryScope, federation_actors.uri AS actorUri, profiles.federation_private_key_encrypted AS encryptedPrivateKey FROM federation_outbox_events INNER JOIN federation_actors ON federation_actors.id = federation_outbox_events.actor_id INNER JOIN profiles ON profiles.user_id = federation_outbox_events.actor_id WHERE federation_outbox_events.id = ? AND federation_outbox_events.state IN ('pending', 'queued') AND federation_actors.is_local = 1",
    )
    .bind(input.eventId)
    .first<OutboxEvent>();
  if (!event) return null;
  if (!event.encryptedPrivateKey) {
    throw new Error("Local federation actor has no encrypted private key.");
  }

  const [followers, deliveries] = await Promise.all([
    event.deliveryScope === "followers"
      ? database
          .prepare(
            "SELECT DISTINCT COALESCE(NULLIF(TRIM(federation_actors.shared_inbox_url), ''), federation_actors.inbox_url) AS targetInboxUrl FROM federation_follows INNER JOIN federation_actors ON federation_actors.id = federation_follows.follower_actor_id WHERE federation_follows.following_actor_id = ? AND federation_follows.state = 'accepted' AND federation_actors.blocked_at IS NULL",
          )
          .bind(event.actorId)
          .all<FollowerInbox>()
      : Promise.resolve({ results: [] as FollowerInbox[] }),
    database
      .prepare(
        "SELECT target_inbox_url AS targetInboxUrl, state, attempts, next_attempt_at AS nextAttemptAt FROM federation_deliveries WHERE outbox_event_id = ?",
      )
      .bind(event.id)
      .all<StoredDelivery>(),
  ]);
  const existing = new Map(
    deliveries.results.map((delivery) => [delivery.targetInboxUrl, delivery]),
  );
  const targetInboxUrls = [
    ...new Set([
      ...followers.results.map((follower) => follower.targetInboxUrl),
      ...deliveries.results.map((delivery) => delivery.targetInboxUrl),
    ]),
  ];
  const now = new Date();
  let delivered = 0;
  let retrying = 0;
  let failed = 0;
  let deferred = 0;
  let skipped = 0;
  let hasPendingDelivery = false;
  let hasFailedDelivery = false;

  for (const targetInboxUrl of targetInboxUrls) {
    const previous = existing.get(targetInboxUrl);
    if (previous?.state === "delivered") {
      skipped += 1;
      continue;
    }
    if (previous?.state === "failed") {
      failed += 1;
      hasFailedDelivery = true;
      continue;
    }
    if (previous && !isRetryDue(previous.nextAttemptAt, now)) {
      deferred += 1;
      hasPendingDelivery = true;
      continue;
    }

    const timestamp = now.toISOString();
    await database
      .prepare(
        "INSERT OR IGNORE INTO federation_deliveries (id, outbox_event_id, target_inbox_url, state, attempts, next_attempt_at, last_error, delivered_at, created_at, updated_at) VALUES (?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?)",
      )
      .bind(
        crypto.randomUUID(),
        event.id,
        targetInboxUrl,
        timestamp,
        timestamp,
        timestamp,
      )
      .run();

    const attempts = previous?.attempts ?? 0;
    if (!isSafeRemoteUrl(targetInboxUrl)) {
      await database
        .prepare(
          "UPDATE federation_deliveries SET state = 'failed', attempts = ?, next_attempt_at = ?, last_error = ?, delivered_at = NULL, updated_at = ? WHERE outbox_event_id = ? AND target_inbox_url = ?",
        )
        .bind(
          attempts,
          timestamp,
          "Target inbox must be a public HTTPS URL.",
          timestamp,
          event.id,
          targetInboxUrl,
        )
        .run();
      failed += 1;
      hasFailedDelivery = true;
      continue;
    }
    try {
      const response = await sendActivity({
        actorUri: event.actorUri,
        encryptedPrivateKey: event.encryptedPrivateKey,
        encryptionSecret: input.encryptionSecret,
        targetInboxUrl,
        activityJson: event.activityJson,
      });
      if (!response.ok)
        throw new Error(`Remote inbox responded ${response.status}.`);
      await database
        .prepare(
          "UPDATE federation_deliveries SET state = 'delivered', attempts = ?, next_attempt_at = ?, last_error = NULL, delivered_at = ?, updated_at = ? WHERE outbox_event_id = ? AND target_inbox_url = ?",
        )
        .bind(
          attempts + 1,
          timestamp,
          timestamp,
          timestamp,
          event.id,
          targetInboxUrl,
        )
        .run();
      delivered += 1;
    } catch (error) {
      const retry = nextRetry(attempts + 1, now);
      await database
        .prepare(
          "UPDATE federation_deliveries SET state = ?, attempts = ?, next_attempt_at = ?, last_error = ?, delivered_at = NULL, updated_at = ? WHERE outbox_event_id = ? AND target_inbox_url = ?",
        )
        .bind(
          retry.terminal ? "failed" : "pending",
          attempts + 1,
          (retry.retryAt ?? now).toISOString(),
          errorMessage(error),
          timestamp,
          event.id,
          targetInboxUrl,
        )
        .run();
      if (retry.terminal) failed += 1;
      if (retry.terminal) hasFailedDelivery = true;
      else {
        retrying += 1;
        hasPendingDelivery = true;
      }
    }
  }

  const state = hasPendingDelivery
    ? "pending"
    : hasFailedDelivery
      ? "failed"
      : "delivered";
  await database
    .prepare(
      "UPDATE federation_outbox_events SET state = ?, updated_at = ? WHERE id = ?",
    )
    .bind(state, now.toISOString(), event.id)
    .run();
  return { delivered, retrying, failed, deferred, skipped, state };
}

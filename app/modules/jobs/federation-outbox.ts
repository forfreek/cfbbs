export type OutboxQueueMessage = { outboxEventId: string };

type PendingOutboxEvent = { id: string };

const defaultBatchSize = 100;

export function outboxBatchSize(value = defaultBatchSize) {
  if (!Number.isFinite(value)) return defaultBatchSize;
  return Math.max(1, Math.min(defaultBatchSize, Math.floor(value)));
}

export function isOutboxQueueMessage(
  value: unknown,
): value is OutboxQueueMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "outboxEventId" in value &&
    typeof value.outboxEventId === "string" &&
    value.outboxEventId.length > 0 &&
    value.outboxEventId.length <= 128
  );
}

export async function enqueuePendingOutboxEvents(
  database: D1Database,
  queue: Queue<OutboxQueueMessage>,
  limit = defaultBatchSize,
) {
  const events = await database
    .prepare(
      "SELECT id FROM federation_outbox_events WHERE state = 'pending' ORDER BY created_at ASC, id ASC LIMIT ?",
    )
    .bind(outboxBatchSize(limit))
    .all<PendingOutboxEvent>();
  if (events.results.length === 0) return 0;

  await queue.sendBatch(
    events.results.map((event) => ({
      body: { outboxEventId: event.id },
      contentType: "json",
    })),
  );

  const now = new Date().toISOString();
  await database.batch(
    events.results.map((event) =>
      database
        .prepare(
          "UPDATE federation_outbox_events SET state = 'queued', queued_at = ?, updated_at = ? WHERE id = ? AND state = 'pending'",
        )
        .bind(now, now, event.id),
    ),
  );
  return events.results.length;
}

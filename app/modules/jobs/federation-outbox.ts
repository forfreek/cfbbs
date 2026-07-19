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
  const now = new Date().toISOString();
  const events = await database
    .prepare(
      "SELECT federation_outbox_events.id FROM federation_outbox_events WHERE federation_outbox_events.state = 'pending' AND (NOT EXISTS (SELECT 1 FROM federation_deliveries WHERE federation_deliveries.outbox_event_id = federation_outbox_events.id) OR EXISTS (SELECT 1 FROM federation_deliveries WHERE federation_deliveries.outbox_event_id = federation_outbox_events.id AND federation_deliveries.state = 'pending' AND federation_deliveries.next_attempt_at <= ?)) ORDER BY federation_outbox_events.created_at ASC, federation_outbox_events.id ASC LIMIT ?",
    )
    .bind(now, outboxBatchSize(limit))
    .all<PendingOutboxEvent>();
  if (events.results.length === 0) return 0;

  await queue.sendBatch(
    events.results.map((event) => ({
      body: { outboxEventId: event.id },
      contentType: "json",
    })),
  );

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

import { describe, expect, it } from "vitest";

import {
  enqueuePendingOutboxEvents,
  isOutboxQueueMessage,
  outboxBatchSize,
} from "@/modules/jobs/federation-outbox";

type CapturedStatement = { sql: string; params: unknown[] };

function pendingDatabase(ids: string[]) {
  const batches: CapturedStatement[][] = [];
  const database = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          if (sql.startsWith("SELECT id FROM federation_outbox_events")) {
            return {
              all: async () => ({ results: ids.map((id) => ({ id })) }),
            };
          }
          return { sql, params };
        },
      };
    },
    async batch(statements: CapturedStatement[]) {
      batches.push(statements);
      return [];
    },
  } as unknown as D1Database;

  return { database, batches };
}

describe("federation outbox queue scheduling", () => {
  it("normalizes queue batch sizes to Cloudflare's allowed range", () => {
    expect(outboxBatchSize(0)).toBe(1);
    expect(outboxBatchSize(101)).toBe(100);
    expect(outboxBatchSize(Number.NaN)).toBe(100);
  });

  it("validates the minimal message envelope used by queue consumers", () => {
    expect(isOutboxQueueMessage({ outboxEventId: "event-1" })).toBe(true);
    expect(isOutboxQueueMessage({ outboxEventId: "" })).toBe(false);
    expect(isOutboxQueueMessage({ id: "event-1" })).toBe(false);
  });

  it("sends pending events before marking them queued", async () => {
    const { database, batches } = pendingDatabase(["event-1", "event-2"]);
    const queueBatches: unknown[] = [];
    const queue = {
      async sendBatch(messages: unknown) {
        queueBatches.push([...((messages as Iterable<unknown>) ?? [])]);
        return {};
      },
    } as Queue<{ outboxEventId: string }>;

    await expect(enqueuePendingOutboxEvents(database, queue)).resolves.toBe(2);
    expect(queueBatches).toEqual([
      [
        { body: { outboxEventId: "event-1" }, contentType: "json" },
        { body: { outboxEventId: "event-2" }, contentType: "json" },
      ],
    ]);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(batches[0][0].sql).toContain("state = 'queued'");
    expect(batches[0][0].sql).toContain("state = 'pending'");
  });

  it("keeps all events pending when the queue refuses the batch", async () => {
    const { database, batches } = pendingDatabase(["event-1"]);
    const queue = {
      async sendBatch() {
        throw new Error("Queue unavailable");
      },
    } as Queue<{ outboxEventId: string }>;

    await expect(enqueuePendingOutboxEvents(database, queue)).rejects.toThrow(
      "Queue unavailable",
    );
    expect(batches).toEqual([]);
  });

  it("does not contact the Queue when there are no pending events", async () => {
    const { database, batches } = pendingDatabase([]);
    let sent = false;
    const queue = {
      async sendBatch() {
        sent = true;
        return {};
      },
    } as Queue<{ outboxEventId: string }>;

    await expect(enqueuePendingOutboxEvents(database, queue)).resolves.toBe(0);
    expect(sent).toBe(false);
    expect(batches).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import {
  processFederationQueue,
  unwrapFedifyQueueMessage,
  type OutboxEventDelivery,
} from "@/modules/jobs/federation-queue";

function queueMessage(body: unknown) {
  const results = { acknowledged: 0, retried: 0 };
  return {
    message: {
      body,
      ack: () => {
        results.acknowledged += 1;
      },
      retry: () => {
        results.retried += 1;
      },
    },
    results,
  };
}

function queueEnvironment() {
  return {
    DB: {} as D1Database,
    FEDIFY_KV: {} as KVNamespace,
    FEDERATION_QUEUE: {} as Queue,
    FEDERATION_KEY_ENCRYPTION_SECRET: "encryption-secret",
  };
}

describe("federation queue consumer", () => {
  it("delivers a valid outbox message and acknowledges it", async () => {
    const { message, results } = queueMessage({ outboxEventId: "event-1" });
    const deliveries: unknown[] = [];
    const deliver: OutboxEventDelivery = async (_database, input) => {
      deliveries.push(input);
      return {
        delivered: 1,
        retrying: 0,
        failed: 0,
        deferred: 0,
        skipped: 0,
        state: "delivered",
      };
    };

    await processFederationQueue(
      { messages: [message] } as MessageBatch<unknown>,
      queueEnvironment(),
      deliver,
    );

    expect(deliveries).toEqual([
      { eventId: "event-1", encryptionSecret: "encryption-secret" },
    ]);
    expect(results).toEqual({ acknowledged: 1, retried: 0 });
  });

  it("acknowledges malformed messages without attempting delivery", async () => {
    const { message, results } = queueMessage({ unexpected: "message" });
    let delivered = false;

    await processFederationQueue(
      { messages: [message] } as MessageBatch<unknown>,
      queueEnvironment(),
      async () => {
        delivered = true;
        return null;
      },
    );

    expect(delivered).toBe(false);
    expect(results).toEqual({ acknowledged: 1, retried: 0 });
  });

  it("retries a message when delivery fails unexpectedly", async () => {
    const { message, results } = queueMessage({ outboxEventId: "event-1" });

    await processFederationQueue(
      { messages: [message] } as MessageBatch<unknown>,
      queueEnvironment(),
      async () => {
        throw new Error("D1 temporarily unavailable");
      },
    );

    expect(results).toEqual({ acknowledged: 0, retried: 1 });
  });


  it("unwraps Cloudflare Fedify queue envelopes before type detection", () => {
    expect(
      unwrapFedifyQueueMessage({
        __fedify_ordering_key__: "actor",
        __fedify_payload__: { type: "inbox", id: "task-1" },
      }),
    ).toEqual({ type: "inbox", id: "task-1" });
    expect(unwrapFedifyQueueMessage({ type: "outbox" })).toEqual({
      type: "outbox",
    });
  });

  it("fails the batch before processing messages without an encryption secret", async () => {
    const { message, results } = queueMessage({ outboxEventId: "event-1" });

    await expect(
      processFederationQueue({ messages: [message] } as MessageBatch<unknown>, {
        DB: {} as D1Database,
      }),
    ).rejects.toThrow("FEDERATION_KEY_ENCRYPTION_SECRET must be configured.");
    expect(results).toEqual({ acknowledged: 0, retried: 0 });
  });
});

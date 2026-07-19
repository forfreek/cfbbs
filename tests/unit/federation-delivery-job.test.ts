import { describe, expect, it } from "vitest";

import { deliverOutboxEvent } from "@/modules/jobs/federation-delivery";

type CapturedStatement = { sql: string; params: unknown[] };

function deliveryDatabase({
  targets = ["https://remote.example/inbox"],
  deliveries = [],
  deliveryScope = "followers",
}: {
  targets?: string[];
  deliveryScope?: "followers" | "direct";
  deliveries?: Array<{
    targetInboxUrl: string;
    state: "pending" | "delivered" | "failed";
    attempts: number;
    nextAttemptAt?: string;
  }>;
} = {}) {
  const statements: CapturedStatement[] = [];
  const event = {
    id: "event-1",
    actorId: "user-1",
    activityJson: JSON.stringify({ type: "Create" }),
    actorUri: "https://bbs.example.test/users/alice",
    encryptedPrivateKey: "encrypted-key",
    deliveryScope,
  };
  return {
    database: {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            if (sql.startsWith("SELECT federation_outbox_events")) {
              return { first: async () => event };
            }
            if (sql.startsWith("SELECT DISTINCT")) {
              return {
                all: async () => ({
                  results: targets.map((targetInboxUrl) => ({
                    targetInboxUrl,
                  })),
                }),
              };
            }
            if (sql.startsWith("SELECT target_inbox_url")) {
              return {
                all: async () => ({
                  results: deliveries.map((delivery) => ({
                    ...delivery,
                    nextAttemptAt:
                      delivery.nextAttemptAt ?? "2026-01-01T00:00:00.000Z",
                  })),
                }),
              };
            }
            statements.push({ sql, params });
            return { run: async () => ({ meta: { changes: 1 } }) };
          },
        };
      },
    } as unknown as D1Database,
    statements,
  };
}

describe("federation delivery worker", () => {
  it("marks an event delivered after its follower inbox accepts the request", async () => {
    const { database, statements } = deliveryDatabase();

    await expect(
      deliverOutboxEvent(
        database,
        { eventId: "event-1", encryptionSecret: "secret" },
        async () => new Response(null, { status: 202 }),
      ),
    ).resolves.toMatchObject({ delivered: 1, state: "delivered" });
    expect(
      statements.some((statement) =>
        statement.sql.includes("state = 'delivered'"),
      ),
    ).toBe(true);
    expect(statements.at(-1)?.params).toContain("delivered");
  });

  it("returns a failed remote response to pending for a later retry", async () => {
    const { database, statements } = deliveryDatabase();

    await expect(
      deliverOutboxEvent(
        database,
        { eventId: "event-1", encryptionSecret: "secret" },
        async () => new Response(null, { status: 503 }),
      ),
    ).resolves.toMatchObject({ retrying: 1, state: "pending" });
    expect(
      statements.some((statement) => statement.sql.includes("last_error = ?")),
    ).toBe(true);
    expect(statements.at(-1)?.params).toContain("pending");
  });

  it("does not resend an inbox with an already delivered record", async () => {
    const { database } = deliveryDatabase({
      deliveries: [
        {
          targetInboxUrl: "https://remote.example/inbox",
          state: "delivered",
          attempts: 1,
        },
      ],
    });
    let sent = false;

    await expect(
      deliverOutboxEvent(
        database,
        { eventId: "event-1", encryptionSecret: "secret" },
        async () => {
          sent = true;
          return new Response(null, { status: 202 });
        },
      ),
    ).resolves.toMatchObject({ skipped: 1, state: "delivered" });
    expect(sent).toBe(false);
  });

  it("leaves a retrying delivery untouched until its retry time", async () => {
    const { database, statements } = deliveryDatabase({
      deliveries: [
        {
          targetInboxUrl: "https://remote.example/inbox",
          state: "pending",
          attempts: 1,
          nextAttemptAt: "2999-01-01T00:00:00.000Z",
        },
      ],
    });
    let sent = false;

    await expect(
      deliverOutboxEvent(
        database,
        { eventId: "event-1", encryptionSecret: "secret" },
        async () => {
          sent = true;
          return new Response(null, { status: 202 });
        },
      ),
    ).resolves.toMatchObject({ deferred: 1, state: "pending" });
    expect(sent).toBe(false);
    expect(statements).toHaveLength(1);
    expect(statements[0]?.sql).toContain("federation_outbox_events");
  });

  it("delivers a direct event only to its pre-seeded inbox", async () => {
    const { database } = deliveryDatabase({
      targets: [],
      deliveryScope: "direct",
      deliveries: [
        {
          targetInboxUrl: "https://remote.example/inbox",
          state: "pending",
          attempts: 0,
        },
      ],
    });
    const sentTo: string[] = [];

    await expect(
      deliverOutboxEvent(
        database,
        { eventId: "event-1", encryptionSecret: "secret" },
        async (delivery) => {
          sentTo.push(delivery.targetInboxUrl);
          return new Response(null, { status: 202 });
        },
      ),
    ).resolves.toMatchObject({ delivered: 1, state: "delivered" });
    expect(sentTo).toEqual(["https://remote.example/inbox"]);
  });
});

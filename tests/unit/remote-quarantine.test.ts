import { describe, expect, it } from "vitest";

import {
  clearRemoteActorQuarantine,
  createRemoteActorQuarantine,
  isRemoteActorQuarantined,
  purgeExpiredRemoteActorQuarantines,
  quarantineReason,
  remoteActivityRateLimit,
  remoteRejectionLimit,
} from "@/modules/moderation/remote-quarantine";

type CapturedStatement = { sql: string; params: unknown[] };

function quarantineDatabase({
  active = false,
  activityCount = 0,
  rejectedCount = 0,
}: {
  active?: boolean;
  activityCount?: number;
  rejectedCount?: number;
} = {}) {
  const statements: CapturedStatement[] = [];
  return {
    database: {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            if (sql.startsWith("SELECT expires_at")) {
              return {
                first: async () =>
                  active ? { expiresAt: "2026-07-20T00:00:00.000Z" } : null,
              };
            }
            if (
              sql.includes("COUNT(*) AS count") &&
              sql.includes("received_at")
            ) {
              return { first: async () => ({ count: activityCount }) };
            }
            if (
              sql.includes("COUNT(*) AS count") &&
              sql.includes("processed_at")
            ) {
              return { first: async () => ({ count: rejectedCount }) };
            }
            if (sql.startsWith("SELECT actor_uri AS actorUri")) {
              return {
                first: async () => ({
                  actorUri: "https://remote.example/users/bob",
                }),
              };
            }
            const statement = { sql, params };
            statements.push(statement);
            return {
              ...statement,
              run: async () => ({ meta: { changes: 1 } }),
            };
          },
        };
      },
      async batch() {
        return [];
      },
    } as unknown as D1Database,
    statements,
  };
}

describe("remote actor quarantine", () => {
  it("allows normal traffic but flags excessive activity and rejections", () => {
    expect(
      quarantineReason({
        activityCount: remoteActivityRateLimit,
        rejectedCount: remoteRejectionLimit - 1,
      }),
    ).toBeNull();
    expect(
      quarantineReason({
        activityCount: remoteActivityRateLimit + 1,
        rejectedCount: 0,
      }),
    ).toContain("inbound activities");
    expect(
      quarantineReason({
        activityCount: 0,
        rejectedCount: remoteRejectionLimit,
      }),
    ).toContain("rejected activities");
  });

  it("keeps an active quarantine without recounting receipts", async () => {
    const { database, statements } = quarantineDatabase({ active: true });

    await expect(
      isRemoteActorQuarantined(
        database,
        "https://remote.example/users/bob",
        new Date("2026-07-19T00:00:00Z"),
      ),
    ).resolves.toBe(true);
    expect(statements).toEqual([]);
  });

  it("records an expiring quarantine and audit log for abnormal traffic", async () => {
    const { database, statements } = quarantineDatabase({
      activityCount: remoteActivityRateLimit + 1,
    });

    await expect(
      isRemoteActorQuarantined(
        database,
        "https://remote.example/users/bob",
        new Date("2026-07-19T00:00:00Z"),
      ),
    ).resolves.toBe(true);
    expect(statements).toHaveLength(2);
    expect(statements[0]?.sql).toContain("federation_actor_quarantines");
    expect(statements[1]?.sql).toContain("federation_actor.quarantine");
  });

  it("requires a public actor URI when creating a quarantine", async () => {
    const { database } = quarantineDatabase();

    await expect(
      createRemoteActorQuarantine(database, {
        actorUri: "http://127.0.0.1/users/bob",
        reason: "test",
      }),
    ).rejects.toThrow("public HTTPS");
  });

  it("clears and purges quarantines idempotently", async () => {
    const { database, statements } = quarantineDatabase();

    await expect(
      clearRemoteActorQuarantine(database, {
        actorUri: "https://remote.example/users/bob",
        moderatorUserId: "moderator-1",
        auditId: "audit-1",
      }),
    ).resolves.toBe(true);
    await expect(
      purgeExpiredRemoteActorQuarantines(
        database,
        new Date("2026-07-19T00:00:00Z"),
      ),
    ).resolves.toBe(1);
    expect(
      statements.some((statement) => statement.sql.startsWith("DELETE")),
    ).toBe(true);
  });
});

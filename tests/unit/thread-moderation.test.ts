import { describe, expect, it } from "vitest";

import {
  setThreadLocked,
  setThreadPinned,
} from "@/modules/forum/threads/moderation";

function moderationDatabase() {
  const batches: Array<Array<{ sql: string; params: unknown[] }>> = [];
  return {
    database: {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return { sql, params };
          },
        };
      },
      async batch(statements: Array<{ sql: string; params: unknown[] }>) {
        batches.push(statements);
        return [{ meta: { changes: 1 } }];
      },
    } as unknown as D1Database,
    batches,
  };
}

const audit = {
  threadId: "thread-1",
  actorUserId: "moderator-1",
  auditId: "audit-1",
};

describe("thread moderation", () => {
  it("locks a thread and records an immutable audit event", async () => {
    const { database, batches } = moderationDatabase();

    await expect(
      setThreadLocked(database, { ...audit, locked: true }),
    ).resolves.toBe(true);
    expect(batches[0]?.[0]?.sql).toContain("is_locked = ?");
    expect(batches[0]?.[1]?.params).toContain("thread.lock");
  });

  it("pins a thread and records an audit event", async () => {
    const { database, batches } = moderationDatabase();

    await expect(
      setThreadPinned(database, { ...audit, pinned: true }),
    ).resolves.toBe(true);
    expect(batches[0]?.[0]?.sql).toContain("is_pinned = ?");
    expect(batches[0]?.[1]?.params).toContain("thread.pin");
  });
});

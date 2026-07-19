import { describe, expect, it } from "vitest";

import {
  recordRemoteLike,
  remoteLikeStatements,
  undoRemoteLike,
} from "@/modules/federation/likes";

const input = {
  activityId: "https://remote.example/activities/like-1",
  actorUri: "https://remote.example/users/bob",
  postId: "post-1",
  threadId: "thread-1",
  recipientUserId: "user-1",
};

describe("remote ActivityPub likes", () => {
  it("stores an idempotent Like and one notification per actor and post", () => {
    const statements = remoteLikeStatements(input, "2026-07-19T00:00:00.000Z");
    expect(statements).toHaveLength(2);
    expect(statements[0]?.sql).toContain("INSERT OR IGNORE INTO post_likes");
    expect(statements[1]?.sql).toContain(
      "NOT EXISTS (SELECT 1 FROM notifications",
    );
    expect(statements[1]?.params).toEqual(
      expect.arrayContaining([
        input.recipientUserId,
        input.actorUri,
        input.postId,
      ]),
    );
  });

  it("reports whether a new Like was inserted", async () => {
    const database = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return { sql, params };
          },
        };
      },
      async batch() {
        return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }];
      },
    } as unknown as D1Database;

    await expect(recordRemoteLike(database, input)).resolves.toBe(true);
  });

  it("removes only the Like activity owned by the Undo actor", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const database = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            statements.push({ sql, params });
            return { run: async () => ({ meta: { changes: 1 } }) };
          },
        };
      },
    } as unknown as D1Database;

    await expect(
      undoRemoteLike(database, {
        activityId: input.activityId,
        actorUri: input.actorUri,
      }),
    ).resolves.toBe(true);
    expect(statements[0]?.sql).toContain("activity_id = ? AND actor_id = ?");
    expect(statements[0]?.params).toEqual([input.activityId, input.actorUri]);
  });
});

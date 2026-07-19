import { describe, expect, it } from "vitest";

import {
  createOutboundLike,
  createOutboundLikeActivity,
  createOutboundLikeUndoActivity,
  outboundLikeStatements,
  outboundLikeUndoStatements,
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

const outboundInput = {
  eventId: "like-event-1",
  localActorId: "user-1",
  localHandle: "alice",
  origin: "https://bbs.example.test",
  postId: "post-1",
  objectUri: "https://remote.example/notes/1",
  remoteActorUri: "https://remote.example/users/bob",
  inboxUrl: "https://remote.example/inbox",
  sharedInboxUrl: "https://remote.example/inbox/shared",
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

  it("creates a direct outbound Like for a remote Note", () => {
    expect(createOutboundLikeActivity(outboundInput)).toEqual({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://bbs.example.test/activities/like/like-event-1",
      type: "Like",
      actor: "https://bbs.example.test/users/alice",
      object: "https://remote.example/notes/1",
      to: "https://remote.example/users/bob",
    });
    const statements = outboundLikeStatements(
      outboundInput,
      "2026-07-19T00:00:00.000Z",
    );
    expect(statements).toHaveLength(3);
    expect(statements[0]?.sql).toContain("INSERT OR IGNORE INTO post_likes");
    expect(statements[1]?.sql).toContain("'Like'");
    expect(statements[2]?.params).toContain(
      "https://remote.example/inbox/shared",
    );
  });

  it("cancels the exact outbound Like with a direct Undo", () => {
    const undoInput = {
      ...outboundInput,
      eventId: "undo-like-event-1",
      likeActivityId: "https://bbs.example.test/activities/like/like-event-1",
    };
    expect(createOutboundLikeUndoActivity(undoInput)).toMatchObject({
      type: "Undo",
      object: undoInput.likeActivityId,
    });
    const statements = outboundLikeUndoStatements(
      undoInput,
      "2026-07-19T00:00:00.000Z",
    );
    expect(statements).toHaveLength(3);
    expect(statements[0]?.sql).toContain("WHERE EXISTS");
    expect(statements[2]?.sql).toContain("activity_id = ?");
    expect(statements[2]?.params).toEqual([
      outboundInput.postId,
      outboundInput.localActorId,
      undoInput.likeActivityId,
    ]);
  });

  it("writes an outbound Like atomically", async () => {
    const batches: unknown[][] = [];
    const database = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return { sql, params };
          },
        };
      },
      async batch(statements: unknown[]) {
        batches.push(statements);
        return [];
      },
    } as unknown as D1Database;

    await createOutboundLike(database, outboundInput);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });
});

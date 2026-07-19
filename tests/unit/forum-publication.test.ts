import { describe, expect, it } from "vitest";

import { createNoteActivity } from "@/modules/federation/outbox";
import { createReply } from "@/modules/forum/posts/service";
import { createThread } from "@/modules/forum/threads/service";

type CapturedStatement = { sql: string; params: unknown[] };

function forumDatabase({
  profile = { handle: "alice" },
  thread = { is_locked: 0 },
}: {
  profile?: { handle: string } | null;
  thread?: { is_locked: number } | null;
} = {}) {
  const batches: CapturedStatement[][] = [];
  const database = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          if (sql.startsWith("SELECT handle FROM profiles")) {
            return { first: async () => profile };
          }
          if (sql.startsWith("SELECT is_locked FROM threads")) {
            return { first: async () => thread };
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

describe("public post federation publication", () => {
  it("serializes a public Note inside a stable Create activity", () => {
    expect(
      createNoteActivity("https://bbs.example.test", {
        id: "post-1",
        authorHandle: "alice",
        html: "<p>Hello</p>",
        publishedAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z",
        parentPostId: null,
      }),
    ).toMatchObject({
      id: "https://bbs.example.test/activities/create/post-1",
      type: "Create",
      actor: "https://bbs.example.test/users/alice",
      object: {
        type: "Note",
        id: "https://bbs.example.test/objects/post-1",
      },
    });
  });

  it("writes a public thread and its Create event in one D1 batch", async () => {
    const { database, batches } = forumDatabase();
    await createThread(database, {
      threadId: "thread-1",
      postId: "post-1",
      revisionId: "revision-1",
      boardId: "board-1",
      authorUserId: "user-1",
      title: "Hello",
      markdown: "Hello",
      visibility: "public",
      federation: {
        eventId: "event-1",
        actorId: "user-1",
        origin: "https://bbs.example.test",
      },
    });

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(5);
    const outbox = batches[0].find((statement) =>
      statement.sql.includes("INSERT INTO federation_outbox_events"),
    );
    expect(outbox).toBeDefined();
    const activity = JSON.parse(String(outbox?.params[3]));
    expect(activity).toMatchObject({
      type: "Create",
      actor: "https://bbs.example.test/users/alice",
      object: { type: "Note" },
    });
    expect(activity.object.content).toContain("<p>Hello</p>");
  });

  it("rejects a public thread before any write when its federation event is absent", async () => {
    const { database, batches } = forumDatabase();

    await expect(
      createThread(database, {
        threadId: "thread-1",
        postId: "post-1",
        revisionId: "revision-1",
        boardId: "board-1",
        authorUserId: "user-1",
        title: "Hello",
        markdown: "Hello",
        visibility: "public",
      }),
    ).rejects.toThrow("require federation publication data");
    expect(batches).toEqual([]);
  });

  it("creates no outbox event for a private reply", async () => {
    const { database, batches } = forumDatabase();
    await createReply(database, {
      postId: "reply-1",
      revisionId: "revision-1",
      threadId: "thread-1",
      parentPostId: "post-1",
      authorUserId: "user-1",
      markdown: "Private reply",
      visibility: "private",
    });

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
    expect(
      batches[0].some((statement) =>
        statement.sql.includes("federation_outbox_events"),
      ),
    ).toBe(false);
  });
});

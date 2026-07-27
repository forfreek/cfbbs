import { describe, expect, it } from "vitest";

import {
  createNoteActivity,
  createNoteDeleteActivity,
  createNoteUpdateActivity,
  publicPostDeleteOutboxStatements,
  publicPostUpdateOutboxStatements,
} from "@/modules/federation/outbox";
import { createReply } from "@/modules/forum/posts/service";
import { createThread } from "@/modules/forum/threads/service";

type CapturedStatement = { sql: string; params: unknown[] };

function forumDatabase({
  profile = { handle: "alice" },
  thread = { is_locked: 0, firstPostAuthorUserId: null },
}: {
  profile?: { handle: string } | null;
  thread?: { is_locked: number; firstPostAuthorUserId: string | null } | null;
} = {}) {
  const batches: CapturedStatement[][] = [];
  const database = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          if (sql.startsWith("SELECT handle FROM profiles")) {
            return { first: async () => profile };
          }
          if (sql.startsWith("SELECT threads.is_locked")) {
            return { first: async () => thread };
          }
          if (
            sql.trimStart().startsWith("SELECT") &&
            (sql.includes("FROM media_objects") ||
              sql.includes("FROM post_attachments"))
          ) {
            return {
              first: async () => null,
              all: async () => ({ results: [] }),
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

  it("uses fresh, stable URLs for Update and Delete activities", () => {
    const post = {
      id: "post-1",
      authorHandle: "alice",
      html: "<p>Updated</p>",
      publishedAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T01:00:00.000Z",
      parentPostId: null,
    };

    expect(
      createNoteUpdateActivity("https://bbs.example.test", "event-1", post),
    ).toMatchObject({
      id: "https://bbs.example.test/activities/update/post-1/event-1",
      type: "Update",
      object: { id: "https://bbs.example.test/objects/post-1" },
    });
    expect(
      createNoteDeleteActivity("https://bbs.example.test", "event-2", {
        postId: "post-1",
        authorHandle: "alice",
      }),
    ).toMatchObject({
      id: "https://bbs.example.test/activities/delete/post-1/event-2",
      type: "Delete",
      object: "https://bbs.example.test/objects/post-1",
    });
  });

  it("replaces prior retry state when a post Update is superseded", async () => {
    const { database } = forumDatabase();

    const statements = await publicPostUpdateOutboxStatements(database, {
      postId: "post-1",
      authorUserId: "user-1",
      visibility: "public",
      origin: "local",
      html: "<p>Updated</p>",
      publishedAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T01:00:00.000Z",
      parentPostId: null,
      publication: {
        eventId: "event-1",
        actorId: "user-1",
        origin: "https://bbs.example.test",
      },
    });

    expect(statements).toHaveLength(3);
    expect(statements[0]?.sql).toContain("DELETE FROM federation_deliveries");
    expect(statements[1]?.sql).toContain(
      "DELETE FROM federation_outbox_events",
    );
    expect(statements[2]?.params).toEqual(
      expect.arrayContaining(["event-1", "Update"]),
    );
  });

  it("does not generate a Delete event for private posts", async () => {
    const { database } = forumDatabase();

    await expect(
      publicPostDeleteOutboxStatements(database, {
        postId: "post-1",
        authorUserId: "user-1",
        visibility: "private",
        origin: "local",
      }),
    ).resolves.toEqual([]);
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
    expect(batches[0]).toHaveLength(6);
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
    const post = batches[0].find((statement) =>
      statement.sql.includes("INSERT INTO posts"),
    );
    expect(post?.params).toContain("https://bbs.example.test/objects/post-1");
    const searchIndex = batches[0].find((statement) =>
      statement.sql.includes("INSERT INTO local_posts_fts"),
    );
    expect(searchIndex?.params).toEqual(
      expect.arrayContaining(["post-1", "thread-1", "Hello"]),
    );
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
    const post = batches[0].find((statement) =>
      statement.sql.includes("INSERT INTO posts"),
    );
    expect(post?.params).toContain(null);
  });

  it("creates a reply notification in the same batch for the thread author", async () => {
    const { database, batches } = forumDatabase({
      thread: { is_locked: 0, firstPostAuthorUserId: "thread-author" },
    });
    await createReply(database, {
      postId: "reply-1",
      revisionId: "revision-1",
      threadId: "thread-1",
      parentPostId: "post-1",
      authorUserId: "reply-author",
      markdown: "Reply",
      visibility: "private",
    });

    expect(
      batches[0].some((statement) =>
        statement.sql.includes("INSERT INTO notifications"),
      ),
    ).toBe(true);
  });
});

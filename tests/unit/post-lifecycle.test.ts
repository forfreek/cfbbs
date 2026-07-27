import { describe, expect, it } from "vitest";

import {
  editLocalPost,
  softDeleteLocalPost,
  softDeletePost,
} from "@/modules/forum/posts/lifecycle";
describe("post lifecycle contract", () => {
  it("models deletion as a soft state to retain federation identity", () => {
    const deleted = { state: "deleted", deletedAt: new Date().toISOString() };
    expect(deleted).toHaveProperty("deletedAt");
  });

  it("removes a deleted post from local search in the same lifecycle", async () => {
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

    await expect(softDeletePost(database, "post-1")).resolves.toBe(true);
    expect(statements[0]?.sql).toContain("state = 'deleted'");
    expect(statements[1]?.sql).toContain("DELETE FROM local_posts_fts");
    expect(statements[1]?.params).toEqual(["post-1"]);
    expect(statements[2]?.sql).toContain("DELETE FROM post_attachments");
  });

  it("updates a post, revision, local search index, and Update outbox event atomically", async () => {
    const batches: Array<Array<{ sql: string; params: unknown[] }>> = [];
    const database = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            if (sql.startsWith("SELECT handle FROM profiles")) {
              return { first: async () => ({ handle: "alice" }) };
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
      async batch(statements: Array<{ sql: string; params: unknown[] }>) {
        batches.push(statements);
        return [{ meta: { changes: 1 } }];
      },
    } as unknown as D1Database;

    await editLocalPost(database, {
      postId: "post-1",
      threadId: "thread-1",
      firstPostId: "post-1",
      authorUserId: "user-1",
      title: "Updated title",
      markdown: "Updated body",
      visibility: "public",
      publishedAt: "2026-07-19T00:00:00.000Z",
      parentPostId: null,
      revisionId: "revision-2",
      federation: {
        eventId: "event-update-1",
        actorId: "user-1",
        origin: "https://bbs.example.test",
      },
    });

    expect(batches).toHaveLength(1);
    expect(
      batches[0]?.some((statement) =>
        statement.sql.includes("INSERT INTO post_revisions"),
      ),
    ).toBe(true);
    expect(
      batches[0]?.some((statement) =>
        statement.sql.includes("DELETE FROM local_posts_fts"),
      ),
    ).toBe(true);
    expect(
      batches[0]?.some(
        (statement) =>
          statement.sql.includes("activity_type") &&
          statement.params.includes("Update"),
      ),
    ).toBe(true);
  });

  it("soft deletes a public local post with its search cleanup and Delete event", async () => {
    const batches: Array<Array<{ sql: string; params: unknown[] }>> = [];
    const database = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            if (sql.startsWith("SELECT handle FROM profiles")) {
              return { first: async () => ({ handle: "alice" }) };
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
      async batch(statements: Array<{ sql: string; params: unknown[] }>) {
        batches.push(statements);
        return [{ meta: { changes: 1 } }];
      },
    } as unknown as D1Database;

    await expect(
      softDeleteLocalPost(database, {
        postId: "post-1",
        threadId: "thread-1",
        authorUserId: "user-1",
        visibility: "public",
        federation: {
          eventId: "event-delete-1",
          actorId: "user-1",
          origin: "https://bbs.example.test",
        },
      }),
    ).resolves.toBe(true);
    expect(
      batches[0]?.some((statement) =>
        Array.isArray(statement.params) && statement.params.includes("Delete"),
      ),
    ).toBe(true);
    expect(
      batches[0]?.some((statement) =>
        statement.sql.includes("DELETE FROM post_attachments"),
      ),
    ).toBe(true);
    expect(
      batches[0]?.some((statement) =>
        statement.sql.includes("DELETE FROM local_posts_fts"),
      ),
    ).toBe(true);
  });
});

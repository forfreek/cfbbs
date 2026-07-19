import { describe, expect, it } from "vitest";

import {
  decodeForumThreadCursor,
  encodeForumThreadCursor,
  listForumBoardThreads,
  listForumThreadPosts,
} from "@/modules/forum/read.server";

function readDatabase() {
  const queries: string[] = [];
  return {
    database: {
      prepare(sql: string) {
        queries.push(sql);
        return {
          bind() {
            return { all: async () => ({ results: [] }) };
          },
        };
      },
    } as unknown as D1Database,
    queries,
  };
}

function pagedReadDatabase(results: Array<Record<string, unknown>>) {
  return {
    prepare() {
      return {
        bind() {
          return { all: async () => ({ results }) };
        },
      };
    },
  } as unknown as D1Database;
}

describe("forum read privacy", () => {
  it("round-trips a forum thread cursor and rejects malformed values", () => {
    const cursor = {
      pinned: 1 as const,
      activityAt: "2026-07-19T12:34:56.000Z",
      id: "thread-1",
    };

    expect(decodeForumThreadCursor(encodeForumThreadCursor(cursor))).toEqual(
      cursor,
    );
    expect(decodeForumThreadCursor("not-a-cursor")).toBeNull();
    expect(decodeForumThreadCursor(null)).toBeNull();
  });

  it("derives visible reply metadata instead of exposing cached private activity", async () => {
    const { database, queries } = readDatabase();

    await listForumBoardThreads(database, "board-1", false);
    expect(queries[0]).toContain("first_post.visibility = 'public'");
    expect(queries[0]).toContain("reply.visibility = 'public'");
    expect(queries[0]).toContain("activity_post.visibility = 'public'");
    expect(queries[0]).not.toContain("threads.post_count");
    expect(queries[0]).not.toContain("threads.last_activity_at");
  });

  it("continues board pages with the visible activity ordering", async () => {
    const { database, queries } = readDatabase();

    await listForumBoardThreads(database, "board-1", false, {
      pinned: 1,
      activityAt: "2026-07-19T12:34:56.000Z",
      id: "thread-1",
    });

    expect(queries[0]).toContain("WITH visible_threads AS");
    expect(queries[0]).toContain("activity_post.visibility = 'public'");
    expect(queries[0]).toContain("isPinned < ?");
    expect(queries[0]).toContain(
      "ORDER BY isPinned DESC, activityAt DESC, id DESC",
    );
    expect(queries[0]).not.toContain("threads.last_activity_at");
  });

  it("returns a cursor after a full page without including its sentinel row", async () => {
    const results = Array.from({ length: 51 }, (_, index) => ({
      id: `thread-${index + 1}`,
      boardId: "board-1",
      firstPostId: `post-${index + 1}`,
      title: `Thread ${index + 1}`,
      isPinned: false,
      isLocked: false,
      firstPostVisibility: "public",
      createdAt: "2026-07-19T12:34:56.000Z",
      authorHandle: "author",
      authorName: "Author",
      replyCount: 0,
      activityAt: `2026-07-19T12:34:${String(59 - index).padStart(2, "0")}.000Z`,
    }));

    const page = await listForumBoardThreads(
      pagedReadDatabase(results),
      "board-1",
      false,
    );

    expect(page.results).toHaveLength(50);
    expect(page.results.at(-1)?.id).toBe("thread-50");
    expect(decodeForumThreadCursor(page.nextCursor)).toEqual({
      pinned: 0,
      activityAt: page.results.at(-1)?.activityAt,
      id: "thread-50",
    });
  });

  it("does not return private replies in a public thread", async () => {
    const { database, queries } = readDatabase();

    await listForumThreadPosts(database, "thread-1", false);
    expect(queries[0]).toContain("posts.visibility = 'public'");
  });

  it("loads remote reply author data without treating it as a local profile", async () => {
    const { database, queries } = readDatabase();

    await listForumThreadPosts(database, "thread-1", false);
    expect(queries[0]).toContain("LEFT JOIN federation_actors");
    expect(queries[0]).toContain("posts.author_actor_id AS authorActorUri");
  });

  it("does not render replies written by a blocked remote actor", async () => {
    const { database, queries } = readDatabase();

    await listForumThreadPosts(database, "thread-1", false);
    expect(queries[0]).toContain("posts.origin = 'local'");
    expect(queries[0]).toContain("federation_actors.blocked_at IS NULL");
  });

  it("removes actor preferences from a viewer's thread results", async () => {
    const { database, queries } = readDatabase();

    await listForumThreadPosts(database, "thread-1", false, "user-1");
    expect(queries[0]).toContain("user_actor_preferences.user_id = ?");
    expect(queries[0]).toContain("user_actor_preferences.actor_id");
  });
});

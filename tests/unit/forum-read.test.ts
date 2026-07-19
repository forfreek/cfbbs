import { describe, expect, it } from "vitest";

import {
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

describe("forum read privacy", () => {
  it("derives visible reply metadata instead of exposing cached private activity", async () => {
    const { database, queries } = readDatabase();

    await listForumBoardThreads(database, "board-1", false);
    expect(queries[0]).toContain("first_post.visibility = 'public'");
    expect(queries[0]).toContain("reply.visibility = 'public'");
    expect(queries[0]).toContain("activity_post.visibility = 'public'");
    expect(queries[0]).not.toContain("threads.post_count");
    expect(queries[0]).not.toContain("threads.last_activity_at");
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

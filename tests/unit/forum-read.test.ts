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
});

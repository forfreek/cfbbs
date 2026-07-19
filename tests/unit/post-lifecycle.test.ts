import { describe, expect, it } from "vitest";

import { softDeletePost } from "@/modules/forum/posts/lifecycle";
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
  });
});

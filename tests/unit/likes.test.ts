import { describe, expect, it } from "vitest";
import { nextLikeState, togglePostLike } from "@/modules/forum/posts/likes";
describe("likes", () => {
  it("adds then removes the same actor idempotently", () => {
    const added = nextLikeState(new Set(), "actor");
    expect(added.action).toBe("added");
    const removed = nextLikeState(added.actorIds, "actor");
    expect(removed.action).toBe("removed");
    expect(removed.actorIds.size).toBe(0);
  });
});

describe("stored likes", () => {
  it("adds when an insert succeeds and removes after an existing row", async () => {
    const statements: string[] = [];
    const database = {
      prepare(sql: string) {
        statements.push(sql);
        return {
          bind() {
            return { run: async () => ({ meta: { changes: 0 } }) };
          },
        };
      },
    } as unknown as D1Database;

    await expect(togglePostLike(database, "post", "actor")).resolves.toBe(
      "removed",
    );
    expect(statements).toHaveLength(2);
  });
});

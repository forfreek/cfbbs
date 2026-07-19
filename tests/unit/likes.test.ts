import { describe, expect, it } from "vitest";
import { nextLikeState } from "@/modules/forum/posts/likes";
describe("likes", () => {
  it("adds then removes the same actor idempotently", () => {
    const added = nextLikeState(new Set(), "actor");
    expect(added.action).toBe("added");
    const removed = nextLikeState(added.actorIds, "actor");
    expect(removed.action).toBe("removed");
    expect(removed.actorIds.size).toBe(0);
  });
});

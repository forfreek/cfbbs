import { describe, expect, it } from "vitest";

import { canManageLocalPost } from "@/modules/forum/posts/ownership";

const localPost = {
  authorUserId: "author-1",
  origin: "local" as const,
  state: "published" as const,
};

describe("local post ownership", () => {
  it("allows an author and an authorized moderator to manage a local post", () => {
    expect(canManageLocalPost(localPost, "author-1", false)).toBe(true);
    expect(canManageLocalPost(localPost, "moderator-1", true)).toBe(true);
  });

  it("does not permit editing remote or deleted posts", () => {
    expect(
      canManageLocalPost(
        { ...localPost, origin: "remote" },
        "moderator-1",
        true,
      ),
    ).toBe(false);
    expect(
      canManageLocalPost({ ...localPost, state: "deleted" }, "author-1", false),
    ).toBe(false);
  });
});

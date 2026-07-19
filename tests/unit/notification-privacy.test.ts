import { describe, expect, it } from "vitest";
import { notificationPreview } from "@/modules/forum/notifications/privacy";
describe("notification privacy", () => {
  it("redacts private context for unauthorized viewers", () =>
    expect(
      notificationPreview({
        authorized: false,
        boardTitle: "Staff",
        author: "Alice",
        excerpt: "secret",
      }),
    ).toEqual({ boardTitle: null, author: null, excerpt: null }));
  it("preserves context for authorized viewers", () =>
    expect(
      notificationPreview({
        authorized: true,
        boardTitle: "Staff",
        author: "Alice",
        excerpt: "hello",
      }),
    ).toMatchObject({ boardTitle: "Staff" }));
});

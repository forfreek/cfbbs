import { describe, expect, it } from "vitest";
import { isSearchablePost } from "@/modules/forum/search/visibility";
describe("local search visibility", () => {
  it("includes only published public local content", () =>
    expect(
      isSearchablePost({
        visibility: "public",
        state: "published",
        origin: "local",
      }),
    ).toBe(true));
  it("excludes private and non-local content", () => {
    expect(
      isSearchablePost({
        visibility: "private",
        state: "published",
        origin: "local",
      }),
    ).toBe(false);
    expect(
      isSearchablePost({
        visibility: "public",
        state: "published",
        origin: "remote",
      }),
    ).toBe(false);
  });
});

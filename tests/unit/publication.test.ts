import { describe, expect, it } from "vitest";
import { shouldFederatePost } from "@/modules/federation/publication";
describe("federation publication privacy", () => {
  it("queues only published local public posts", () =>
    expect(
      shouldFederatePost({
        visibility: "public",
        state: "published",
        origin: "local",
      }),
    ).toBe(true));
  it("never queues private, hidden, or remote posts", () => {
    expect(
      shouldFederatePost({
        visibility: "private",
        state: "published",
        origin: "local",
      }),
    ).toBe(false);
    expect(
      shouldFederatePost({
        visibility: "public",
        state: "hidden",
        origin: "local",
      }),
    ).toBe(false);
    expect(
      shouldFederatePost({
        visibility: "public",
        state: "published",
        origin: "remote",
      }),
    ).toBe(false);
  });
});

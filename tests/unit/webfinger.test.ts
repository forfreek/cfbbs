import { describe, expect, it } from "vitest";
import {
  parseWebFingerResource,
  webFingerDocument,
} from "@/modules/federation/webfinger";
describe("WebFinger", () => {
  it("normalizes a local acct resource", () =>
    expect(
      parseWebFingerResource(
        "acct:Alice@bbs.example.test",
        "https://bbs.example.test",
      ),
    ).toBe("alice"));
  it("rejects remote or malformed resources", () => {
    expect(
      parseWebFingerResource(
        "acct:alice@elsewhere.test",
        "https://bbs.example.test",
      ),
    ).toBeNull();
    expect(
      parseWebFingerResource("alice", "https://bbs.example.test"),
    ).toBeNull();
  });
  it("returns an ActivityPub self link", () =>
    expect(
      webFingerDocument("https://bbs.example.test", "alice").links[0].href,
    ).toBe("https://bbs.example.test/users/alice"));
});

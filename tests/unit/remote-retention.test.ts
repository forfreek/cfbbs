import { describe, expect, it } from "vitest";
import { shouldRetainRemoteObject } from "@/modules/jobs/remote-retention";
describe("remote object retention", () => {
  const now = new Date("2026-07-01T00:00:00Z");
  it("expires unreferenced objects after 90 days", () =>
    expect(
      shouldRetainRemoteObject({
        receivedAt: "2026-03-01T00:00:00Z",
        now,
        locallyReferenced: false,
        activeDiscussion: false,
        moderationEvidence: false,
      }),
    ).toBe(false));
  it("preserves local references and moderation evidence", () =>
    expect(
      shouldRetainRemoteObject({
        receivedAt: "2020-01-01T00:00:00Z",
        now,
        locallyReferenced: false,
        activeDiscussion: false,
        moderationEvidence: true,
      }),
    ).toBe(true));
});

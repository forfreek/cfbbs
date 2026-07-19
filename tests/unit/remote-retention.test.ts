import { describe, expect, it } from "vitest";
import {
  purgeExpiredRemoteObjects,
  purgeExpiredRemoteObjectsQuery,
  shouldRetainRemoteObject,
} from "@/modules/jobs/remote-retention";
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

  it("purges only expired objects with no live post or report reference", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const database = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            statements.push({ sql, params });
            return { run: async () => ({ meta: { changes: 3 } }) };
          },
        };
      },
    } as unknown as D1Database;

    await expect(
      purgeExpiredRemoteObjects(database, new Date("2026-07-01T00:00:00Z")),
    ).resolves.toBe(3);
    expect(statements[0]?.params).toEqual(["2026-07-01T00:00:00.000Z"]);
    expect(purgeExpiredRemoteObjectsQuery).toContain(
      "posts.state != 'deleted'",
    );
    expect(purgeExpiredRemoteObjectsQuery).toContain("FROM reports");
  });
});

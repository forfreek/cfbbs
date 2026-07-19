import { describe, expect, it } from "vitest";

import { createNotification } from "@/modules/forum/notifications/service";

describe("notification persistence", () => {
  it("does not notify a user about their own activity", async () => {
    let prepared = false;
    const database = {
      prepare() {
        prepared = true;
        return {};
      },
    } as unknown as D1Database;

    await expect(
      createNotification(database, {
        id: "notification-1",
        recipientUserId: "user-1",
        actorId: "user-1",
        type: "like",
      }),
    ).resolves.toBe(false);
    expect(prepared).toBe(false);
  });

  it("does not create new notifications from a muted or blocked actor", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const database = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            statements.push({ sql, params });
            return { run: async () => ({ meta: { changes: 0 } }) };
          },
        };
      },
    } as unknown as D1Database;

    await expect(
      createNotification(database, {
        id: "notification-1",
        recipientUserId: "user-1",
        actorId: "remote-1",
        type: "like",
      }),
    ).resolves.toBe(false);
    expect(statements[0]?.sql).toContain("user_actor_preferences");
    expect(statements[0]?.params).toEqual(
      expect.arrayContaining(["user-1", "remote-1"]),
    );
  });
});

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
});

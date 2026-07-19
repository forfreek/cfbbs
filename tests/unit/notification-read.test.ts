import { describe, expect, it } from "vitest";

import {
  listNotifications,
  markNotificationRead,
  notificationForViewer,
} from "@/modules/forum/notifications/read.server";

describe("notification reads", () => {
  it("scopes read updates to the recipient and unread state", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const database = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            statements.push({ sql, params });
            return { run: async () => ({ meta: { changes: 1 } }) };
          },
        };
      },
    } as unknown as D1Database;

    await expect(
      markNotificationRead(database, "notice-1", "recipient-1"),
    ).resolves.toBe(true);
    expect(statements[0].sql).toContain("recipient_user_id = ?");
    expect(statements[0].sql).toContain("read_at IS NULL");
    expect(statements[0].params).toContain("recipient-1");
  });
});

describe("notification viewer data", () => {
  it("does not serialize private board or actor context without access", () => {
    expect(
      notificationForViewer(
        {
          id: "notice-1",
          actorId: "actor-1",
          type: "reply",
          threadId: "thread-1",
          postId: "post-1",
          readAt: null,
          createdAt: "2026-07-19T00:00:00.000Z",
          actorHandle: "alice",
          actorName: "Alice",
          actorUri: null,
          actorIsLocal: null,
          boardId: "staff",
          boardTitle: "Staff",
          boardVisibility: "private",
          postVisibility: "private",
        },
        false,
      ),
    ).toEqual({
      id: "notice-1",
      type: "reply",
      threadId: null,
      readAt: null,
      createdAt: "2026-07-19T00:00:00.000Z",
      preview: { boardTitle: null, author: null, excerpt: null },
    });
  });
});

describe("notification filtering", () => {
  it("hides notifications from globally and personally blocked actors", async () => {
    const queries: string[] = [];
    const database = {
      prepare(sql: string) {
        queries.push(sql);
        return {
          bind() {
            return { all: async () => ({ results: [] }) };
          },
        };
      },
    } as unknown as D1Database;

    await listNotifications(database, "user-1");
    expect(queries[0]).toContain("user_actor_preferences");
    expect(queries[0]).toContain("federation_actors.blocked_at IS NULL");
  });
});

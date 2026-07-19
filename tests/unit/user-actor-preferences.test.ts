import { describe, expect, it } from "vitest";

import {
  clearUserActorPreference,
  listUserActorPreferences,
  setUserActorPreference,
} from "@/modules/moderation/user-actor-preferences";

type CapturedStatement = { sql: string; params: unknown[] };

function preferenceDatabase(existing: "muted" | "blocked" | null = null) {
  const statements: CapturedStatement[] = [];
  return {
    database: {
      prepare(sql: string) {
        if (sql.startsWith("SELECT user_actor_preferences.user_id")) {
          statements.push({ sql, params: [] });
          return {
            bind() {
              return { all: async () => ({ results: [] }) };
            },
          };
        }
        return {
          bind(...params: unknown[]) {
            if (sql.startsWith("SELECT id FROM federation_actors")) {
              return { first: async () => ({ id: "remote-1" }) };
            }
            if (sql.startsWith("SELECT state FROM user_actor_preferences")) {
              return {
                first: async () => (existing ? { state: existing } : null),
              };
            }
            const statement = { sql, params };
            statements.push(statement);
            return {
              ...statement,
              run: async () => ({ meta: { changes: 1 } }),
            };
          },
        };
      },
      async batch() {
        return [];
      },
    } as unknown as D1Database,
    statements,
  };
}

describe("user actor preferences", () => {
  it("records a muted remote actor and audit entry atomically", async () => {
    const { database, statements } = preferenceDatabase();

    await expect(
      setUserActorPreference(database, {
        userId: "user-1",
        actorId: "remote-1",
        state: "muted",
        auditId: "audit-1",
      }),
    ).resolves.toBe(true);
    expect(statements).toHaveLength(2);
    expect(statements[0]?.sql).toContain("ON CONFLICT(user_id, actor_id)");
    expect(statements[1]?.params).toContain("user_actor_preference.muted");
  });

  it("does not duplicate an unchanged preference", async () => {
    const { database, statements } = preferenceDatabase("blocked");

    await expect(
      setUserActorPreference(database, {
        userId: "user-1",
        actorId: "remote-1",
        state: "blocked",
        auditId: "audit-1",
      }),
    ).resolves.toBe(false);
    expect(statements).toEqual([]);
  });

  it("clears an existing preference with an audit trail", async () => {
    const { database, statements } = preferenceDatabase("muted");

    await expect(
      clearUserActorPreference(database, {
        userId: "user-1",
        actorId: "remote-1",
        auditId: "audit-1",
      }),
    ).resolves.toBe(true);
    expect(statements[0]?.sql).toContain("DELETE FROM user_actor_preferences");
    expect(statements[1]?.sql).toContain("user_actor_preference.clear");
  });

  it("lists a user's preferences with the remote actor identity", async () => {
    const { database, statements } = preferenceDatabase();

    await listUserActorPreferences(database, "user-1");
    expect(statements[0]?.sql).toContain("INNER JOIN federation_actors");
  });
});

import { describe, expect, it } from "vitest";

import {
  blockRemoteActor,
  listModeratableRemoteActors,
  unblockRemoteActor,
} from "@/modules/moderation/actor-block";

type CapturedStatement = { sql: string; params: unknown[] };

function actorDatabase(blockedAt: string | null = null) {
  const statements: CapturedStatement[] = [];
  return {
    database: {
      prepare(sql: string) {
        if (sql.startsWith("SELECT id, uri, handle")) {
          statements.push({ sql, params: [] });
          return { all: async () => ({ results: [] }) };
        }
        return {
          all: async () => ({ results: [] }),
          bind(...params: unknown[]) {
            const statement = { sql, params };
            if (sql.startsWith("SELECT id, uri, blocked_at")) {
              return {
                first: async () => ({
                  id: "remote-1",
                  uri: "https://remote.example/users/bob",
                  blockedAt,
                }),
              };
            }
            statements.push(statement);
            return {
              all: async () => ({ results: [] }),
              run: async () => ({ meta: { changes: 1 } }),
              ...statement,
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

describe("remote actor moderation", () => {
  it("blocks the actor, hides their thread replies, and audits the action", async () => {
    const { database, statements } = actorDatabase();

    await expect(
      blockRemoteActor(database, {
        actorId: "remote-1",
        moderatorUserId: "moderator-1",
        auditId: "audit-1",
      }),
    ).resolves.toBe(true);
    expect(statements).toHaveLength(3);
    expect(statements[0]?.sql).toContain("blocked_at = ?");
    expect(statements[1]?.sql).toContain("state = 'hidden'");
    expect(statements[1]?.params).toContain("remote-1");
    expect(statements[2]?.sql).toContain("federation_actor.block");
  });

  it("does not write a duplicate block", async () => {
    const { database, statements } = actorDatabase("2026-07-19T00:00:00.000Z");

    await expect(
      blockRemoteActor(database, {
        actorId: "remote-1",
        moderatorUserId: "moderator-1",
        auditId: "audit-1",
      }),
    ).resolves.toBe(false);
    expect(statements).toEqual([]);
  });

  it("unblocks the actor without republishing content hidden by moderation", async () => {
    const { database, statements } = actorDatabase("2026-07-19T00:00:00.000Z");

    await expect(
      unblockRemoteActor(database, {
        actorId: "remote-1",
        moderatorUserId: "moderator-1",
        auditId: "audit-2",
      }),
    ).resolves.toBe(true);
    expect(statements).toHaveLength(2);
    expect(statements[0]?.sql).toContain("blocked_at = NULL");
    expect(statements[1]?.sql).toContain("federation_actor.unblock");
    expect(
      statements.map((statement) => statement.sql).join(" "),
    ).not.toContain("state = 'published'");
  });

  it("lists remote actors with blocked accounts first", async () => {
    const { database, statements } = actorDatabase();

    await listModeratableRemoteActors(database);
    expect(statements[0]?.sql).toContain("WHERE is_local = 0");
    expect(statements[0]?.sql).toContain("ORDER BY blocked_at IS NULL ASC");
  });
});

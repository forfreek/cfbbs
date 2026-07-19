import { describe, expect, it } from "vitest";

import {
  listInstancePolicies,
  normalizeInstanceDomain,
  setInstancePolicy,
} from "@/modules/moderation/instance-policy";

type CapturedStatement = { sql: string; params: unknown[] };

function policyDatabase() {
  const statements: CapturedStatement[] = [];
  return {
    database: {
      prepare(sql: string) {
        if (sql.startsWith("SELECT id, domain")) {
          statements.push({ sql, params: [] });
          return { all: async () => ({ results: [] }) };
        }
        return {
          all: async () => ({ results: [] }),
          bind(...params: unknown[]) {
            const statement = { sql, params };
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

describe("instance policy moderation", () => {
  it("normalizes host names and rejects URL-shaped or unsafe values", () => {
    expect(normalizeInstanceDomain("  EXAMPLE.COM. ")).toBe("example.com");
    expect(() => normalizeInstanceDomain("https://example.com")).toThrow(
      "host name",
    );
    expect(() => normalizeInstanceDomain("example.com:8443")).toThrow(
      "host name",
    );
    expect(() => normalizeInstanceDomain("localhost")).toThrow("invalid");
  });

  it("writes a policy change and its audit record in one batch", async () => {
    const { database, statements } = policyDatabase();

    await expect(
      setInstancePolicy(database, {
        id: "policy-1",
        domain: "REMOTE.EXAMPLE",
        state: "blocked",
        reason: "Repeated spam",
        actorUserId: "moderator-1",
      }),
    ).resolves.toMatchObject({
      domain: "remote.example",
      state: "blocked",
      reason: "Repeated spam",
    });
    expect(statements).toHaveLength(2);
    expect(statements[0]?.sql).toContain("ON CONFLICT(domain)");
    expect(statements[0]?.params).toContain("remote.example");
    expect(statements[1]?.sql).toContain("instance_policy.set");
    expect(statements[1]?.params).toContain("moderator-1");
  });

  it("lists policies in stable domain order", async () => {
    const { database, statements } = policyDatabase();

    await listInstancePolicies(database);
    expect(statements[0]?.sql).toContain("ORDER BY domain ASC");
  });
});

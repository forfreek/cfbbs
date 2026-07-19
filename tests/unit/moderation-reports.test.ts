import { describe, expect, it } from "vitest";

import {
  createReport,
  listReports,
  resolveReport,
} from "@/modules/moderation/reports";

type CapturedStatement = { sql: string; params: unknown[] };

function reportDatabase(state: "open" | "resolved" | null = "open") {
  const statements: CapturedStatement[] = [];
  return {
    database: {
      prepare(sql: string) {
        if (sql.startsWith("SELECT id, reporter_user_id")) {
          statements.push({ sql, params: [] });
          return {
            all: async () => ({ results: [] }),
            bind() {
              return { all: async () => ({ results: [] }) };
            },
          };
        }
        return {
          bind(...params: unknown[]) {
            if (sql.startsWith("SELECT state FROM reports")) {
              return { first: async () => (state ? { state } : null) };
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

describe("report moderation", () => {
  it("stores an auditable report with a non-empty bounded reason", async () => {
    const { database, statements } = reportDatabase();

    await createReport(database, {
      id: "report-1",
      reporterUserId: "user-1",
      reporterActorId: null,
      postId: "post-1",
      reason: "  Contains spam.  ",
    });
    expect(statements).toHaveLength(2);
    expect(statements[0]?.params).toContain("Contains spam.");
    expect(statements[1]?.sql).toContain("report.create");
    expect(statements[1]?.params).toContain('{"postId":"post-1"}');
  });

  it("rejects anonymous and blank reports", async () => {
    const { database } = reportDatabase();

    await expect(
      createReport(database, {
        id: "report-1",
        reporterUserId: null,
        reporterActorId: null,
        postId: "post-1",
        reason: "spam",
      }),
    ).rejects.toThrow("identify");
    await expect(
      createReport(database, {
        id: "report-1",
        reporterUserId: "user-1",
        reporterActorId: null,
        postId: "post-1",
        reason: "   ",
      }),
    ).rejects.toThrow("reason");
  });

  it("resolves only an open report and records the decision", async () => {
    const { database, statements } = reportDatabase();

    await expect(
      resolveReport(database, {
        id: "report-1",
        moderatorUserId: "moderator-1",
        state: "dismissed",
        auditId: "audit-1",
      }),
    ).resolves.toBe(true);
    expect(statements).toHaveLength(2);
    expect(statements[0]?.sql).toContain("state = 'open'");
    expect(statements[1]?.params).toContain("report.dismissed");
  });

  it("does not rewrite a resolved report or its audit history", async () => {
    const { database, statements } = reportDatabase("resolved");

    await expect(
      resolveReport(database, {
        id: "report-1",
        moderatorUserId: "moderator-1",
        state: "dismissed",
        auditId: "audit-1",
      }),
    ).resolves.toBe(false);
    expect(statements).toEqual([]);
  });

  it("defaults to open reports while retaining an all-states view", async () => {
    const { database, statements } = reportDatabase();

    await listReports(database);
    await listReports(database, "all");
    expect(statements[0]?.sql).toContain("WHERE state = ?");
    expect(statements[1]?.sql).not.toContain("WHERE state = ?");
  });
});

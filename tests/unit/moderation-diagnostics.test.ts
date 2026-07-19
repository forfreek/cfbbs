import { describe, expect, it } from "vitest";

import { listAuditLogs } from "@/modules/moderation/audit";
import { listFederationDeliveryDiagnostics } from "@/modules/moderation/federation-diagnostics";

function diagnosticDatabase() {
  const queries: string[] = [];
  return {
    database: {
      prepare(sql: string) {
        queries.push(sql);
        return { all: async () => ({ results: [] }) };
      },
    } as unknown as D1Database,
    queries,
  };
}

describe("federation moderation diagnostics", () => {
  it("shows delivery aggregate state without loading activity payloads", async () => {
    const { database, queries } = diagnosticDatabase();

    await listFederationDeliveryDiagnostics(database);
    expect(queries[0]).toContain("LEFT JOIN federation_deliveries");
    expect(queries[0]).toContain("GROUP BY federation_outbox_events.id");
    expect(queries[0]).not.toContain("activity_json");
  });

  it("lists immutable audit records in reverse chronological order", async () => {
    const { database, queries } = diagnosticDatabase();

    await listAuditLogs(database);
    expect(queries[0]).toContain("FROM audit_logs");
    expect(queries[0]).toContain("ORDER BY created_at DESC");
  });
});

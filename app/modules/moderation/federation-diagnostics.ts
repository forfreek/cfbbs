export type FederationDeliveryDiagnostic = {
  id: string;
  aggregateType: "post" | "follow" | "like";
  activityType: "Create" | "Update" | "Delete" | "Follow" | "Undo" | "Like";
  state: "pending" | "queued" | "delivered" | "failed";
  createdAt: string;
  updatedAt: string;
  targetCount: number;
  pendingCount: number;
  failedCount: number;
  lastError: string | null;
};

export async function listFederationDeliveryDiagnostics(database: D1Database) {
  return database
    .prepare(
      "SELECT federation_outbox_events.id, federation_outbox_events.aggregate_type AS aggregateType, federation_outbox_events.activity_type AS activityType, federation_outbox_events.state, federation_outbox_events.created_at AS createdAt, federation_outbox_events.updated_at AS updatedAt, COUNT(federation_deliveries.id) AS targetCount, SUM(CASE WHEN federation_deliveries.state = 'pending' THEN 1 ELSE 0 END) AS pendingCount, SUM(CASE WHEN federation_deliveries.state = 'failed' THEN 1 ELSE 0 END) AS failedCount, MAX(federation_deliveries.last_error) AS lastError FROM federation_outbox_events LEFT JOIN federation_deliveries ON federation_deliveries.outbox_event_id = federation_outbox_events.id GROUP BY federation_outbox_events.id ORDER BY federation_outbox_events.updated_at DESC, federation_outbox_events.id DESC LIMIT 100",
    )
    .all<FederationDeliveryDiagnostic>();
}

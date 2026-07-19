export async function setInstancePolicy(
  database: D1Database,
  input: {
    id: string;
    domain: string;
    state: "allowed" | "blocked" | "limited";
    reason: string;
  },
) {
  const now = new Date().toISOString();
  await database
    .prepare(
      "INSERT INTO instance_policies (id, domain, state, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(domain) DO UPDATE SET state = excluded.state, reason = excluded.reason, updated_at = excluded.updated_at",
    )
    .bind(
      input.id,
      input.domain.toLowerCase(),
      input.state,
      input.reason.trim(),
      now,
      now,
    )
    .run();
}

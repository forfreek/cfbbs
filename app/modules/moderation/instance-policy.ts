export type InstancePolicyState = "allowed" | "blocked" | "limited";

export type InstancePolicy = {
  id: string;
  domain: string;
  state: InstancePolicyState;
  reason: string;
  createdAt: string;
  updatedAt: string;
};

const domainLabel = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;

export function normalizeInstanceDomain(value: string) {
  const candidate = value.trim().toLowerCase().replace(/\.+$/, "");
  if (!candidate || candidate.length > 253) {
    throw new Error("Instance domain must be between 1 and 253 characters.");
  }
  if (/[/:?#@]/.test(candidate)) {
    throw new Error(
      "Instance policy must use a host name without a URL or port.",
    );
  }

  let hostname: string;
  try {
    hostname = new URL(`https://${candidate}`).hostname.toLowerCase();
  } catch {
    throw new Error("Instance domain is invalid.");
  }
  if (
    hostname !== candidate ||
    !hostname.includes(".") ||
    hostname.split(".").some((label) => !domainLabel.test(label))
  ) {
    throw new Error("Instance domain is invalid.");
  }
  return hostname;
}

export async function setInstancePolicy(
  database: D1Database,
  input: {
    id: string;
    domain: string;
    state: InstancePolicyState;
    reason: string;
    actorUserId: string;
  },
) {
  const domain = normalizeInstanceDomain(input.domain);
  const reason = input.reason.trim();
  if (!input.id.trim() || !input.actorUserId.trim()) {
    throw new Error("Instance policy and moderator identifiers are required.");
  }
  if (reason.length > 2_000) {
    throw new Error(
      "Instance policy reason must be 2,000 characters or fewer.",
    );
  }
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        "INSERT INTO instance_policies (id, domain, state, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(domain) DO UPDATE SET state = excluded.state, reason = excluded.reason, updated_at = excluded.updated_at",
      )
      .bind(input.id, domain, input.state, reason, now, now),
    database
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, 'instance_policy.set', 'instance_policy', ?, ?, ?)",
      )
      .bind(
        `${input.id}:audit`,
        input.actorUserId,
        domain,
        JSON.stringify({ domain, state: input.state, reason }),
        now,
      ),
  ]);
  return { domain, state: input.state, reason, updatedAt: now };
}

export async function listInstancePolicies(database: D1Database) {
  return database
    .prepare(
      "SELECT id, domain, state, reason, created_at AS createdAt, updated_at AS updatedAt FROM instance_policies ORDER BY domain ASC",
    )
    .all<InstancePolicy>();
}

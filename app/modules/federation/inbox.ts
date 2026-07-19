import { isSafeRemoteUrl } from "./remote-url";

export type InboxActivity = {
  activityId: string;
  actorUri: string;
};

export function validateInboxActivity(input: InboxActivity) {
  if (!isSafeRemoteUrl(input.activityId)) {
    return {
      ok: false as const,
      message: "Activity ID must be a public HTTPS URL.",
    };
  }
  if (!isSafeRemoteUrl(input.actorUri)) {
    return {
      ok: false as const,
      message: "Actor URI must be a public HTTPS URL.",
    };
  }
  return { ok: true as const };
}

export async function claimInboxActivity(
  database: D1Database,
  input: InboxActivity,
) {
  const validation = validateInboxActivity(input);
  if (!validation.ok) throw new Error(validation.message);

  const now = new Date().toISOString();
  const result = await database
    .prepare(
      "INSERT INTO federation_inbox_receipts (activity_id, actor_uri, received_at, processed_at, state, failure_reason) VALUES (?, ?, ?, NULL, 'received', NULL) ON CONFLICT(activity_id) DO NOTHING",
    )
    .bind(input.activityId, input.actorUri, now)
    .run();
  return result.meta.changes === 1;
}

export async function completeInboxActivity(
  database: D1Database,
  activityId: string,
) {
  const result = await database
    .prepare(
      "UPDATE federation_inbox_receipts SET state = 'processed', processed_at = ?, failure_reason = NULL WHERE activity_id = ? AND state = 'received'",
    )
    .bind(new Date().toISOString(), activityId)
    .run();
  return result.meta.changes === 1;
}

export async function rejectInboxActivity(
  database: D1Database,
  activityId: string,
  reason: string,
) {
  const result = await database
    .prepare(
      "UPDATE federation_inbox_receipts SET state = 'rejected', processed_at = ?, failure_reason = ? WHERE activity_id = ? AND state = 'received'",
    )
    .bind(new Date().toISOString(), reason.trim().slice(0, 500), activityId)
    .run();
  return result.meta.changes === 1;
}

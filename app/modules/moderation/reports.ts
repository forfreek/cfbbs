export type ReportState = "open" | "resolved" | "dismissed";

export type ModerationReport = {
  id: string;
  reporterUserId: string | null;
  reporterActorId: string | null;
  postId: string | null;
  reason: string;
  state: ReportState;
  resolvedByUserId: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

function validateReportInput(input: {
  id: string;
  reporterUserId: string | null;
  reporterActorId: string | null;
  postId: string | null;
  reason: string;
}) {
  const reason = input.reason.trim();
  if (!input.id.trim() || !input.postId?.trim()) {
    throw new Error("Report and post identifiers are required.");
  }
  if (!input.reporterUserId?.trim() && !input.reporterActorId?.trim()) {
    throw new Error("Reports must identify a local user or remote actor.");
  }
  if (!reason) throw new Error("A report reason is required.");
  if (reason.length > 2_000) {
    throw new Error("Report reason must be 2,000 characters or fewer.");
  }
  return reason;
}

export async function createReport(
  database: D1Database,
  input: {
    id: string;
    reporterUserId: string | null;
    reporterActorId: string | null;
    postId: string | null;
    reason: string;
  },
) {
  const reason = validateReportInput(input);
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        "INSERT INTO reports (id, reporter_user_id, reporter_actor_id, post_id, reason, state, resolved_by_user_id, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, 'open', NULL, ?, NULL)",
      )
      .bind(
        input.id,
        input.reporterUserId,
        input.reporterActorId,
        input.postId,
        reason,
        now,
      ),
    database
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, 'report.create', 'report', ?, ?, ?)",
      )
      .bind(
        `${input.id}:audit`,
        input.reporterUserId,
        input.id,
        JSON.stringify({ postId: input.postId }),
        now,
      ),
  ]);
}

export async function listReports(
  database: D1Database,
  state: ReportState | "all" = "open",
) {
  const where = state === "all" ? "" : "WHERE state = ?";
  const statement = database.prepare(
    `SELECT id, reporter_user_id AS reporterUserId, reporter_actor_id AS reporterActorId, post_id AS postId, reason, state, resolved_by_user_id AS resolvedByUserId, created_at AS createdAt, resolved_at AS resolvedAt FROM reports ${where} ORDER BY created_at DESC, id DESC LIMIT 100`,
  );
  return state === "all"
    ? statement.all<ModerationReport>()
    : statement.bind(state).all<ModerationReport>();
}

export async function resolveReport(
  database: D1Database,
  input: {
    id: string;
    moderatorUserId: string;
    state: Exclude<ReportState, "open">;
    auditId: string;
  },
) {
  if (
    !input.id.trim() ||
    !input.moderatorUserId.trim() ||
    !input.auditId.trim()
  ) {
    throw new Error("Report, moderator, and audit identifiers are required.");
  }
  const report = await database
    .prepare("SELECT state FROM reports WHERE id = ? LIMIT 1")
    .bind(input.id)
    .first<{ state: ReportState }>();
  if (!report) throw new Error("Report does not exist.");
  if (report.state !== "open") return false;

  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        "UPDATE reports SET state = ?, resolved_by_user_id = ?, resolved_at = ? WHERE id = ? AND state = 'open'",
      )
      .bind(input.state, input.moderatorUserId, now, input.id),
    database
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, 'report', ?, ?, ?)",
      )
      .bind(
        input.auditId,
        input.moderatorUserId,
        `report.${input.state}`,
        input.id,
        JSON.stringify({ previousState: "open" }),
        now,
      ),
  ]);
  return true;
}

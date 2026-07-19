export function shouldRetainRemoteObject(input: {
  receivedAt: string;
  now: Date;
  locallyReferenced: boolean;
  activeDiscussion: boolean;
  moderationEvidence: boolean;
}) {
  if (
    input.locallyReferenced ||
    input.activeDiscussion ||
    input.moderationEvidence
  )
    return true;
  return (
    input.now.getTime() - new Date(input.receivedAt).getTime() <
    90 * 24 * 60 * 60 * 1000
  );
}

export const purgeExpiredRemoteObjectsQuery = `
  DELETE FROM federation_objects
  WHERE retention_expires_at <= ?
    AND NOT EXISTS (
      SELECT 1
      FROM posts
      WHERE posts.federation_object_id = federation_objects.uri
        AND posts.state != 'deleted'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM reports
      INNER JOIN posts ON posts.id = reports.post_id
      WHERE posts.federation_object_id = federation_objects.uri
    )
`;

export async function purgeExpiredRemoteObjects(
  database: D1Database,
  now = new Date(),
) {
  const result = await database
    .prepare(purgeExpiredRemoteObjectsQuery)
    .bind(now.toISOString())
    .run();
  return result.meta.changes;
}

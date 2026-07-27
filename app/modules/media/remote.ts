import { isSafeRemoteUrl } from "@/modules/federation/remote-url";

import type { MediaAttachmentView, RemoteAttachmentRecord } from "./types";

export type RemoteNoteAttachmentInput = {
  url: string;
  mediaType?: string | null;
  name?: string | null;
};

function firstString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested: string | null = firstString(item);
      if (nested) return nested;
    }
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return firstString(record.href ?? record.url ?? record.value ?? null);
  }
  return null;
}

export function extractRemoteNoteAttachments(noteJson: unknown) {
  if (!noteJson || typeof noteJson !== "object") return [];
  const attachment = (noteJson as Record<string, unknown>).attachment;
  const values = Array.isArray(attachment)
    ? attachment
    : attachment
      ? [attachment]
      : [];
  const results: RemoteNoteAttachmentInput[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const url = firstString(record.url ?? record.href);
    if (!url || !isSafeRemoteUrl(url)) continue;
    const mediaType =
      typeof record.mediaType === "string"
        ? record.mediaType
        : typeof record.type === "string" && record.type === "Image"
          ? "image/*"
          : null;
    const name =
      typeof record.name === "string"
        ? record.name.slice(0, 180)
        : typeof record.summary === "string"
          ? record.summary.slice(0, 180)
          : null;
    results.push({ url, mediaType, name });
    if (results.length >= 4) break;
  }
  return results;
}

export async function replaceRemoteObjectAttachments(
  database: D1Database,
  input: {
    objectUri: string;
    attachments: readonly RemoteNoteAttachmentInput[];
  },
) {
  const now = new Date().toISOString();
  await database
    .prepare("DELETE FROM remote_object_attachments WHERE object_uri = ?")
    .bind(input.objectUri)
    .run();
  if (input.attachments.length === 0) return;
  await database.batch(
    input.attachments.map((attachment, index) =>
      database
        .prepare(
          "INSERT INTO remote_object_attachments (id, object_uri, url, media_type, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          crypto.randomUUID(),
          input.objectUri,
          attachment.url,
          attachment.mediaType ?? "application/octet-stream",
          attachment.name,
          index,
          now,
        ),
    ),
  );
}

export async function loadRemoteObjectAttachments(
  database: D1Database,
  objectUris: readonly string[],
) {
  if (objectUris.length === 0) {
    return new Map<string, RemoteAttachmentRecord[]>();
  }
  const placeholders = objectUris.map(() => "?").join(", ");
  const rows = await database
    .prepare(
      `SELECT id, object_uri AS objectUri, url, media_type AS mediaType, name, sort_order AS sortOrder, created_at AS createdAt
       FROM remote_object_attachments
       WHERE object_uri IN (${placeholders})
       ORDER BY object_uri ASC, sort_order ASC, created_at ASC`,
    )
    .bind(...objectUris)
    .all<RemoteAttachmentRecord>();
  const grouped = new Map<string, RemoteAttachmentRecord[]>();
  for (const row of rows.results) {
    const list = grouped.get(row.objectUri) ?? [];
    list.push(row);
    grouped.set(row.objectUri, list);
  }
  return grouped;
}

export function remoteAttachmentsToView(
  attachments: readonly RemoteAttachmentRecord[],
): MediaAttachmentView[] {
  return attachments.map((attachment) => ({
    id: attachment.id,
    url: attachment.url,
    contentType: attachment.mediaType,
    originalFilename: attachment.name ?? attachment.url,
    kind: attachment.mediaType.startsWith("image/")
      ? ("image" as const)
      : ("remote" as const),
  }));
}

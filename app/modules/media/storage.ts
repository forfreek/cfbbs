import type { MediaObjectRecord } from "./types";
import {
  isAllowedMediaType,
  mediaKindForType,
  validateUploadFile,
} from "./validation";

function hexFromBuffer(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return hexFromBuffer(digest);
}

export function mediaObjectPublicPath(mediaId: string) {
  return `/media/${mediaId}`;
}

export function mediaObjectPublicUrl(origin: string, mediaId: string) {
  return new URL(mediaObjectPublicPath(mediaId), origin).href;
}

export function buildMediaR2Key(input: {
  uploaderUserId: string;
  mediaId: string;
  extension: string;
}) {
  return `media/${input.uploaderUserId}/${input.mediaId}.${input.extension}`;
}

export async function storeUploadedMedia(input: {
  database: D1Database;
  bucket: R2Bucket;
  uploaderUserId: string;
  filename: string;
  contentType: string;
  bytes: ArrayBuffer;
}) {
  const validation = validateUploadFile({
    contentType: input.contentType,
    byteSize: input.bytes.byteLength,
    filename: input.filename,
  });
  if (!validation.ok) return validation;

  const mediaId = crypto.randomUUID().replaceAll("-", "");
  const extension =
    validation.originalFilename.split(".").pop()?.toLowerCase() ?? "bin";
  const r2Key = buildMediaR2Key({
    uploaderUserId: input.uploaderUserId,
    mediaId,
    extension,
  });
  const sha256 = await sha256Hex(input.bytes);
  const now = new Date().toISOString();
  const kind = mediaKindForType(validation.contentType);

  await input.bucket.put(r2Key, input.bytes, {
    httpMetadata: {
      contentType: validation.contentType,
      contentDisposition: `inline; filename="${validation.originalFilename.replaceAll('"', "")}"`,
    },
    customMetadata: {
      mediaId,
      uploaderUserId: input.uploaderUserId,
      sha256,
    },
  });

  try {
    await input.database
      .prepare(
        "INSERT INTO media_objects (id, uploader_user_id, r2_key, content_type, byte_size, sha256, original_filename, kind, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)",
      )
      .bind(
        mediaId,
        input.uploaderUserId,
        r2Key,
        validation.contentType,
        input.bytes.byteLength,
        sha256,
        validation.originalFilename,
        kind,
        now,
      )
      .run();
  } catch (error) {
    await input.bucket.delete(r2Key);
    throw error;
  }

  const record: MediaObjectRecord = {
    id: mediaId,
    uploaderUserId: input.uploaderUserId,
    r2Key,
    contentType: validation.contentType,
    byteSize: input.bytes.byteLength,
    sha256,
    originalFilename: validation.originalFilename,
    kind,
    createdAt: now,
    deletedAt: null,
  };
  return { ok: true as const, media: record };
}

export async function loadMediaObject(database: D1Database, mediaId: string) {
  return database
    .prepare(
      "SELECT id, uploader_user_id AS uploaderUserId, r2_key AS r2Key, content_type AS contentType, byte_size AS byteSize, sha256, original_filename AS originalFilename, kind, created_at AS createdAt, deleted_at AS deletedAt FROM media_objects WHERE id = ? LIMIT 1",
    )
    .bind(mediaId)
    .first<MediaObjectRecord>();
}

export async function loadOwnedMediaByIds(
  database: D1Database,
  input: {
    authorUserId: string;
    attachmentIds: readonly string[];
  },
) {
  if (input.attachmentIds.length === 0) return [] as MediaObjectRecord[];
  const placeholders = input.attachmentIds.map(() => "?").join(", ");
  const rows = await database
    .prepare(
      `SELECT id, uploader_user_id AS uploaderUserId, r2_key AS r2Key, content_type AS contentType, byte_size AS byteSize, sha256, original_filename AS originalFilename, kind, created_at AS createdAt, deleted_at AS deletedAt
       FROM media_objects
       WHERE id IN (${placeholders})
         AND uploader_user_id = ?
         AND deleted_at IS NULL`,
    )
    .bind(...input.attachmentIds, input.authorUserId)
    .all<MediaObjectRecord>();
  const byId = new Map(rows.results.map((row) => [row.id, row]));
  const ordered: MediaObjectRecord[] = [];
  for (const id of input.attachmentIds) {
    const row = byId.get(id);
    if (!row || !isAllowedMediaType(row.contentType)) {
      return null;
    }
    ordered.push({
      ...row,
      contentType: row.contentType,
      kind: row.kind === "image" ? "image" : "document",
    });
  }
  return ordered;
}

export function mediaRecordsToView(
  origin: string,
  media: readonly MediaObjectRecord[],
) {
  return media.map((item) => ({
    id: item.id,
    url: mediaObjectPublicUrl(origin, item.id),
    contentType: item.contentType,
    originalFilename: item.originalFilename,
    kind: item.kind,
    byteSize: item.byteSize,
  }));
}

export function postAttachmentInsertStatements(
  database: D1Database,
  input: {
    postId: string;
    attachmentIds: readonly string[];
    createdAt: string;
  },
) {
  return input.attachmentIds.map((mediaId, index) =>
    database
      .prepare(
        "INSERT INTO post_attachments (post_id, media_id, sort_order, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind(input.postId, mediaId, index, input.createdAt),
  );
}

export async function loadPostAttachments(
  database: D1Database,
  postIds: readonly string[],
) {
  if (postIds.length === 0) return new Map<string, MediaObjectRecord[]>();
  const placeholders = postIds.map(() => "?").join(", ");
  const rows = await database
    .prepare(
      `SELECT post_attachments.post_id AS postId, media_objects.id, media_objects.uploader_user_id AS uploaderUserId, media_objects.r2_key AS r2Key, media_objects.content_type AS contentType, media_objects.byte_size AS byteSize, media_objects.sha256, media_objects.original_filename AS originalFilename, media_objects.kind, media_objects.created_at AS createdAt, media_objects.deleted_at AS deletedAt, post_attachments.sort_order AS sortOrder
       FROM post_attachments
       INNER JOIN media_objects ON media_objects.id = post_attachments.media_id
       WHERE post_attachments.post_id IN (${placeholders})
         AND media_objects.deleted_at IS NULL
       ORDER BY post_attachments.post_id ASC, post_attachments.sort_order ASC, media_objects.created_at ASC`,
    )
    .bind(...postIds)
    .all<MediaObjectRecord & { postId: string; sortOrder: number }>();

  const grouped = new Map<string, MediaObjectRecord[]>();
  for (const row of rows.results) {
    if (!isAllowedMediaType(row.contentType)) continue;
    const list = grouped.get(row.postId) ?? [];
    list.push({
      id: row.id,
      uploaderUserId: row.uploaderUserId,
      r2Key: row.r2Key,
      contentType: row.contentType,
      byteSize: row.byteSize,
      sha256: row.sha256,
      originalFilename: row.originalFilename,
      kind: row.kind,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
    });
    grouped.set(row.postId, list);
  }
  return grouped;
}

export async function replacePostAttachments(
  database: D1Database,
  input: {
    postId: string;
    authorUserId: string;
    attachmentIds: readonly string[];
  },
) {
  if (input.attachmentIds.length === 0) {
    await database
      .prepare("DELETE FROM post_attachments WHERE post_id = ?")
      .bind(input.postId)
      .run();
    return { ok: true as const };
  }

  const placeholders = input.attachmentIds.map(() => "?").join(", ");
  const owned = await database
    .prepare(
      `SELECT id FROM media_objects
       WHERE id IN (${placeholders})
         AND uploader_user_id = ?
         AND deleted_at IS NULL`,
    )
    .bind(...input.attachmentIds, input.authorUserId)
    .all<{ id: string }>();
  if (owned.results.length !== input.attachmentIds.length) {
    return {
      ok: false as const,
      message: "只能使用自己上传且未删除的附件。",
    };
  }

  const now = new Date().toISOString();
  const statements = [
    database
      .prepare("DELETE FROM post_attachments WHERE post_id = ?")
      .bind(input.postId),
    ...input.attachmentIds.map((mediaId, index) =>
      database
        .prepare(
          "INSERT INTO post_attachments (post_id, media_id, sort_order, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(input.postId, mediaId, index, now),
    ),
  ];
  await database.batch(statements);
  return { ok: true as const };
}

export async function softDeletePostMediaLinks(
  database: D1Database,
  postId: string,
) {
  await database
    .prepare("DELETE FROM post_attachments WHERE post_id = ?")
    .bind(postId)
    .run();
}

export async function purgeOrphanMedia(input: {
  database: D1Database;
  bucket: R2Bucket;
  olderThanIso: string;
  limit?: number;
}) {
  const limit = input.limit ?? 50;
  const orphans = await input.database
    .prepare(
      `SELECT id, r2_key AS r2Key
       FROM media_objects
       WHERE deleted_at IS NULL
         AND created_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM post_attachments WHERE post_attachments.media_id = media_objects.id
         )
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .bind(input.olderThanIso, limit)
    .all<{ id: string; r2Key: string }>();

  let purged = 0;
  for (const orphan of orphans.results) {
    await input.bucket.delete(orphan.r2Key);
    await input.database
      .prepare(
        "UPDATE media_objects SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
      )
      .bind(new Date().toISOString(), orphan.id)
      .run();
    purged += 1;
  }
  return purged;
}

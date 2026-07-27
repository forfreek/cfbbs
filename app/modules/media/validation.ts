import {
  allowedMediaTypes,
  maxAttachmentsPerPost,
  maxMediaBytes,
  mediaTypeExtensions,
  type AllowedMediaType,
  type MediaKind,
} from "./types";

const allowedTypeSet = new Set<string>(allowedMediaTypes);

export function isAllowedMediaType(value: string): value is AllowedMediaType {
  return allowedTypeSet.has(value);
}

export function mediaKindForType(contentType: AllowedMediaType): MediaKind {
  return contentType.startsWith("image/") ? "image" : "document";
}

export function extensionForFilename(filename: string) {
  const base = filename.split(/[/\\]/).pop() ?? "";
  const parts = base.split(".");
  if (parts.length < 2) return null;
  return parts.at(-1)?.toLowerCase() ?? null;
}

export function sanitizeOriginalFilename(filename: string) {
  const base = filename.split(/[/\\]/).pop()?.trim() || "upload";
  return base.replace(/[^\w.\-()\s\u4e00-\u9fff]/g, "_").slice(0, 180);
}

export function validateUploadFile(input: {
  contentType: string;
  byteSize: number;
  filename: string;
}) {
  if (!isAllowedMediaType(input.contentType)) {
    return {
      ok: false as const,
      message: "不支持的文件类型。仅允许 jpeg/png/webp/gif/pdf/txt/zip。",
    };
  }
  if (input.byteSize <= 0 || input.byteSize > maxMediaBytes) {
    return {
      ok: false as const,
      message: `单个文件不能超过 ${Math.floor(maxMediaBytes / (1024 * 1024))}MB。`,
    };
  }
  const extension = extensionForFilename(input.filename);
  const allowedExtensions = mediaTypeExtensions[input.contentType];
  if (!extension || !allowedExtensions.includes(extension)) {
    return {
      ok: false as const,
      message: "文件扩展名与内容类型不匹配。",
    };
  }
  return {
    ok: true as const,
    contentType: input.contentType,
    kind: mediaKindForType(input.contentType),
    originalFilename: sanitizeOriginalFilename(input.filename),
  };
}

export function validateAttachmentIds(raw: unknown) {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
  if (values.length > maxAttachmentsPerPost) {
    return {
      ok: false as const,
      message: `每个帖子最多 ${maxAttachmentsPerPost} 个附件。`,
    };
  }
  const ids: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(value)) {
      return { ok: false as const, message: "附件标识无效。" };
    }
    if (!ids.includes(value)) ids.push(value);
  }
  if (ids.length > maxAttachmentsPerPost) {
    return {
      ok: false as const,
      message: `每个帖子最多 ${maxAttachmentsPerPost} 个附件。`,
    };
  }
  return { ok: true as const, ids };
}

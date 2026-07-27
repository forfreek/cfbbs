export const maxMediaBytes = 5 * 1024 * 1024;
export const maxAttachmentsPerPost = 4;

export const allowedMediaTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "application/zip",
] as const;

export type AllowedMediaType = (typeof allowedMediaTypes)[number];

export const mediaTypeExtensions: Record<AllowedMediaType, readonly string[]> =
  {
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
    "image/webp": ["webp"],
    "image/gif": ["gif"],
    "application/pdf": ["pdf"],
    "text/plain": ["txt"],
    "application/zip": ["zip"],
  };

export type MediaKind = "image" | "document";

export type MediaObjectRecord = {
  id: string;
  uploaderUserId: string;
  r2Key: string;
  contentType: AllowedMediaType;
  byteSize: number;
  sha256: string;
  originalFilename: string;
  kind: MediaKind;
  createdAt: string;
  deletedAt: string | null;
};

export type PostAttachmentRecord = {
  postId: string;
  mediaId: string;
  sortOrder: number;
  createdAt: string;
};

export type RemoteAttachmentRecord = {
  id: string;
  objectUri: string;
  url: string;
  mediaType: string;
  name: string | null;
  sortOrder: number;
  createdAt: string;
};

export type MediaAttachmentView = {
  id: string;
  url: string;
  contentType: string;
  originalFilename: string;
  kind: MediaKind | "remote";
  byteSize?: number;
};

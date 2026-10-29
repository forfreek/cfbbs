import { getSession } from "@/modules/identity/auth.server";
import {
  consumeRateLimit,
  rateLimitResponse,
  rateLimitRules,
} from "@/modules/rate-limit.server";

import { authorizeMediaRead } from "./access";
import { createMediaStoreFromEnv } from "./s3";
import {
  loadMediaBytes,
  mediaObjectPublicPath,
  storeUploadedMedia,
} from "./storage";
import { validateUploadFile } from "./validation";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export async function handleMediaUpload(request: Request, env: Env) {
  try {
    if (request.method !== "POST") {
      return json(
        { ok: false, code: "METHOD_NOT_ALLOWED", message: "请求方法不允许。" },
        405,
      );
    }
    const session = await getSession(request, env);
    if (!session) {
      return json(
        { ok: false, code: "AUTH_REQUIRED", message: "请先登录。" },
        401,
      );
    }
    if (!session.user.emailVerified) {
      return json(
        {
          ok: false,
          code: "EMAIL_NOT_VERIFIED",
          message: "请先验证邮箱后再上传附件。",
        },
        403,
      );
    }
    const limited = await consumeRateLimit(env.FEDIFY_KV, {
      scope: "upload",
      subject: session.user.id,
      rule: rateLimitRules.upload,
    });
    if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
    const store = createMediaStoreFromEnv(env);
    if (!store) {
      return json(
        {
          ok: false,
          code: "MEDIA_STORAGE_UNAVAILABLE",
          message: "媒体存储未配置。请绑定 Cloudflare R2 存储桶 MEDIA_BUCKET。",
        },
        503,
      );
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json(
        { ok: false, code: "INVALID_MULTIPART", message: "无法解析上传内容。" },
        400,
      );
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return json(
        { ok: false, code: "FILE_REQUIRED", message: "请选择要上传的文件。" },
        400,
      );
    }
    const contentType = file.type || "application/octet-stream";
    const preliminary = validateUploadFile({
      contentType,
      byteSize: file.size,
      filename: file.name || "upload.bin",
    });
    if (!preliminary.ok) {
      return json(
        { ok: false, code: "INVALID_FILE", message: preliminary.message },
        400,
      );
    }

    const bytes = await file.arrayBuffer();
    const stored = await storeUploadedMedia({
      database: env.DB,
      store,
      uploaderUserId: session.user.id,
      filename: file.name || preliminary.originalFilename,
      contentType,
      bytes,
    });
    if (!stored.ok) {
      return json(
        { ok: false, code: "INVALID_FILE", message: stored.message },
        400,
      );
    }
    return json({
      ok: true,
      media: {
        id: stored.media.id,
        url: mediaObjectPublicPath(stored.media.id),
        contentType: stored.media.contentType,
        originalFilename: stored.media.originalFilename,
        kind: stored.media.kind,
        byteSize: stored.media.byteSize,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "上传到对象存储失败。";
    console.error("Media upload failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return json({ ok: false, code: "UPLOAD_FAILED", message }, 502);
  }
}

export async function handleMediaDownload(request: Request, env: Env) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/media\/([a-zA-Z0-9_-]{8,128})$/);
  if (!match) return null;

  const store = createMediaStoreFromEnv(env);
  if (!store) {
    return new Response("Media storage unavailable", { status: 503 });
  }

  const mediaId = match[1];
  const access = await authorizeMediaRead({
    env,
    request,
    mediaId,
  });
  if (!access.ok || !access.media) {
    return new Response("Not found", { status: access.status });
  }

  let bytes: ArrayBuffer | null;
  try {
    bytes = await loadMediaBytes(store, access.media.r2Key);
  } catch {
    return new Response("Object storage error", { status: 502 });
  }
  if (!bytes) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  headers.set("content-type", access.media.contentType);
  headers.set("content-length", String(access.media.byteSize));
  headers.set(
    "content-disposition",
    `inline; filename="${access.media.originalFilename.replaceAll('"', "")}"`,
  );
  headers.set(
    "cache-control",
    access.visibility === "public"
      ? "public, max-age=3600"
      : "private, no-store",
  );
  headers.set("x-content-type-options", "nosniff");
  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return new Response(bytes, { status: 200, headers });
}

export async function handleMediaHttp(request: Request, env: Env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/media/upload") {
    return handleMediaUpload(request, env);
  }
  if (url.pathname.startsWith("/media/")) {
    return handleMediaDownload(request, env);
  }
  return null;
}

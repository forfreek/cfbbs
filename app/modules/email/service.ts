import { consumeRateLimit, rateLimitRules } from "@/modules/rate-limit.server";

export type TransactionalEmailKind =
  "verify-email" | "password-reset" | "security-alert";

type EmailEnvironment = {
  EMAIL_MODE?: string;
  EMAIL_GATEWAY_URL?: string;
  EMAIL_GATEWAY_TOKEN?: string;
  EMAIL_FROM?: string;
  FEDIFY_KV?: KVNamespace;
  DB: D1Database;
};

type EmailInput = {
  userId?: string | null;
  to: string;
  kind: TransactionalEmailKind;
  url?: string;
  subject?: string;
  text?: string;
  html?: string;
  requestId?: string;
};

function environment(env: Env): EmailEnvironment {
  return env as unknown as EmailEnvironment;
}

function redactError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\w.+-]+@[\w.-]+/g, "[redacted-email]").slice(0, 500);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value.trim().toLowerCase()),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function defaultCopy(input: EmailInput) {
  if (input.kind === "verify-email") {
    return {
      subject: "验证你的 CFBBS 邮箱",
      text: `请打开以下链接验证邮箱：${input.url ?? ""}`,
      html: `<p>请点击以下链接验证邮箱：</p><p><a href="${input.url ?? "#"}">验证邮箱</a></p>`,
    };
  }
  if (input.kind === "password-reset") {
    return {
      subject: "重置你的 CFBBS 密码",
      text: `请打开以下链接重置密码：${input.url ?? ""}`,
      html: `<p>请点击以下链接重置密码：</p><p><a href="${input.url ?? "#"}">重置密码</a></p>`,
    };
  }
  return {
    subject: "CFBBS 账户安全提醒",
    text: input.text ?? "你的 CFBBS 账户刚刚发生了安全相关变更。",
    html:
      input.html ??
      `<p>${input.text ?? "你的 CFBBS 账户刚刚发生了安全相关变更。"}</p>`,
  };
}

export async function sendTransactionalEmail(env: Env, input: EmailInput) {
  const config = environment(env);
  const mode = config.EMAIL_MODE?.trim().toLowerCase() || "disabled";
  const requestId = input.requestId ?? crypto.randomUUID();
  const recipientHash = await sha256(input.to);
  const existing = await env.DB.prepare(
    "SELECT status FROM email_deliveries WHERE request_id = ? LIMIT 1",
  )
    .bind(requestId)
    .first<{ status: "pending" | "sent" | "failed" }>();
  if (existing?.status === "sent")
    return { ok: true as const, duplicate: true };

  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO email_deliveries (id, user_id, kind, recipient_hash, request_id, status, error, created_at, sent_at) VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, NULL) ON CONFLICT(request_id) DO UPDATE SET status = 'pending', error = NULL",
  )
    .bind(
      crypto.randomUUID(),
      input.userId ?? null,
      input.kind,
      recipientHash,
      requestId,
      now,
    )
    .run();

  if (mode === "disabled") {
    await env.DB.prepare(
      "UPDATE email_deliveries SET status = 'sent', sent_at = ? WHERE request_id = ?",
    )
      .bind(now, requestId)
      .run();
    return { ok: true as const, skipped: true };
  }

  if (mode !== "http") throw new Error("EMAIL_MODE must be disabled or http.");
  const url = config.EMAIL_GATEWAY_URL?.trim();
  const token = config.EMAIL_GATEWAY_TOKEN?.trim();
  const from = config.EMAIL_FROM?.trim();
  if (!url || !token || !from) {
    throw new Error("Email gateway is not configured.");
  }
  const limit = await consumeRateLimit(env.FEDIFY_KV, {
    scope: "email",
    subject: recipientHash,
    rule: rateLimitRules.email,
  });
  if (!limit.allowed) {
    throw new Error("Email rate limit exceeded.");
  }

  const copy = defaultCopy(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(
      new URL("v1/send", url.endsWith("/") ? url : `${url}/`),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          requestId,
          kind: input.kind,
          to: input.to,
          from,
          subject: input.subject ?? copy.subject,
          text: input.text ?? copy.text,
          html: input.html ?? copy.html,
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new Error(`Email gateway returned HTTP ${response.status}.`);
    }
    await env.DB.prepare(
      "UPDATE email_deliveries SET status = 'sent', error = NULL, sent_at = ? WHERE request_id = ?",
    )
      .bind(new Date().toISOString(), requestId)
      .run();
    return { ok: true as const };
  } catch (error) {
    await env.DB.prepare(
      "UPDATE email_deliveries SET status = 'failed', error = ? WHERE request_id = ?",
    )
      .bind(redactError(error), requestId)
      .run();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

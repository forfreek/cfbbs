export type RateLimitRule = {
  name: string;
  limit: number;
  windowSeconds: number;
};

export const rateLimitRules = {
  authIp: { name: "auth-ip", limit: 10, windowSeconds: 600 },
  authAccount: { name: "auth-account", limit: 5, windowSeconds: 600 },
  register: { name: "register", limit: 5, windowSeconds: 3600 },
  write: { name: "write", limit: 30, windowSeconds: 600 },
  upload: { name: "upload", limit: 20, windowSeconds: 600 },
  search: { name: "search", limit: 60, windowSeconds: 60 },
  preview: { name: "preview", limit: 30, windowSeconds: 60 },
  email: { name: "email", limit: 5, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>;

type RateLimitValue = { count: number; expiresAt: number };

function keyPart(value: string) {
  return value.trim().slice(0, 160) || "unknown";
}

export function requestIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0] ??
    "unknown"
  );
}

export async function consumeRateLimit(
  kv: KVNamespace | undefined,
  input: {
    scope: string;
    subject: string;
    rule: RateLimitRule;
  },
) {
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
    return { allowed: true, remaining: input.rule.limit, degraded: true };
  }
  const now = Date.now();
  const windowStart = Math.floor(now / (input.rule.windowSeconds * 1_000));
  const expiresAt = (windowStart + 1) * input.rule.windowSeconds * 1_000;
  const key = `rl:v1:${keyPart(input.scope)}:${keyPart(input.subject)}:${windowStart}`;
  try {
    const current = await kv.get<RateLimitValue>(key, "json");
    const count = current && current.expiresAt > now ? current.count + 1 : 1;
    await kv.put(key, JSON.stringify({ count, expiresAt }), {
      expirationTtl: Math.max(1, Math.ceil((expiresAt - now) / 1_000)),
    });
    return {
      allowed: count <= input.rule.limit,
      remaining: Math.max(0, input.rule.limit - count),
      retryAfter: Math.max(1, Math.ceil((expiresAt - now) / 1_000)),
      degraded: false,
    };
  } catch (error) {
    // KV is an availability aid; a transient binding failure must not turn
    // every public page into a 500. Keep the event useful without logging the
    // user-controlled subject or any request contents.
    console.warn("Rate-limit storage unavailable", {
      scope: input.scope,
      error: error instanceof Error ? error.name : "unknown",
    });
    return {
      allowed: true,
      remaining: input.rule.limit,
      retryAfter: input.rule.windowSeconds,
      degraded: true,
    };
  }
}

export function rateLimitResponse(retryAfter = 60) {
  return Response.json(
    { ok: false, code: "RATE_LIMITED", message: "请求过于频繁，请稍后再试。" },
    {
      status: 429,
      headers: {
        "retry-after": String(retryAfter),
      },
    },
  );
}

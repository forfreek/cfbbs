import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { username } from "better-auth/plugins";

import { createDatabase } from "@/db/client.server";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
} from "@/db/schema";
import { createLocalActor } from "@/modules/federation/local-actor";
import { sendTransactionalEmail } from "@/modules/email/service";
import {
  consumeRateLimit,
  rateLimitResponse,
  rateLimitRules,
  requestIp,
} from "@/modules/rate-limit.server";

import { loadAccountStatus } from "./account.server";
import { normalizeHandle, validateHandle } from "./handle";

export type AuthEnvironment = Pick<Env, "DB" | "APP_ORIGIN"> & {
  BETTER_AUTH_SECRET?: string;
  FEDERATION_KEY_ENCRYPTION_SECRET?: string;
  EMAIL_MODE?: string;
  EMAIL_GATEWAY_URL?: string;
  EMAIL_GATEWAY_TOKEN?: string;
  EMAIL_FROM?: string;
  FEDIFY_KV?: KVNamespace;
};

export function getAuthSettings(environment: AuthEnvironment) {
  const origin = new URL(environment.APP_ORIGIN).origin;
  const secret = environment.BETTER_AUTH_SECRET?.trim();

  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET must be configured.");
  }

  return {
    origin,
    secret,
    useSecureCookies: new URL(origin).protocol === "https:",
  };
}

export function createAuth(environment: AuthEnvironment) {
  const settings = getAuthSettings(environment);
  const database = createDatabase(environment.DB);
  const emailEnabled = environment.EMAIL_MODE?.trim().toLowerCase() === "http";

  return betterAuth({
    baseURL: settings.origin,
    basePath: "/api/auth",
    secret: settings.secret,
    trustedOrigins: [settings.origin],
    useSecureCookies: settings.useSecureCookies,
    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: settings.useSecureCookies,
      },
    },
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    user: {
      additionalFields: {
        status: {
          type: "string",
          required: false,
          defaultValue: "active",
          input: false,
        },
      },
    },
    emailVerification: {
      sendOnSignUp: emailEnabled,
      sendOnSignIn: emailEnabled,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url, token }) => {
        await sendTransactionalEmail(environment as Env, {
          userId: user.id,
          to: user.email,
          kind: "verify-email",
          url,
          requestId: `verify:${user.id}:${token}`,
        });
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification: emailEnabled,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url, token }) => {
        await sendTransactionalEmail(environment as Env, {
          userId: user.id,
          to: user.email,
          kind: "password-reset",
          url,
          requestId: `reset:${user.id}:${token}`,
        });
      },
      onPasswordReset: async ({ user }) => {
        await sendTransactionalEmail(environment as Env, {
          userId: user.id,
          to: user.email,
          kind: "security-alert",
          text: "你的 CFBBS 密码刚刚被修改。如果这不是你的操作，请立即联系管理员。",
          requestId: `password-reset-alert:${user.id}:${Date.now()}`,
        });
      },
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 32,
        usernameNormalization: normalizeHandle,
        usernameValidator: (value) => validateHandle(value).ok,
        validationOrder: { username: "post-normalization" },
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (context) => {
        const body = context.body;
        if (
          context.path === "/update-user" &&
          body &&
          typeof body === "object" &&
          ("username" in body || "displayUsername" in body)
        ) {
          throw APIError.from("BAD_REQUEST", {
            code: "HANDLE_IMMUTABLE",
            message: "Federation handles are immutable.",
          });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const handle = validateHandle(String(user.username ?? ""));

            if (!handle.ok) {
              throw new Error("A valid federation handle is required.");
            }

            await createLocalActor(environment.DB, {
              userId: user.id,
              handle: handle.value,
              displayName: user.name,
              origin: settings.origin,
              encryptionSecret:
                environment.FEDERATION_KEY_ENCRYPTION_SECRET ?? "",
            });
          },
        },
      },
    },
  });
}

export async function handleAuthRequest(
  request: Request,
  environment: AuthEnvironment,
) {
  const limited = await authRateLimit(request, environment);
  if (limited) return limited;
  return createAuth(environment).handler(request);
}

export function authRequest(
  request: Request,
  environment: AuthEnvironment,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
) {
  const headers = new Headers({
    origin: environment.APP_ORIGIN,
  });
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  if (body !== undefined) headers.set("content-type", "application/json");
  return handleAuthRequest(
    new Request(new URL(path, environment.APP_ORIGIN), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    environment,
  );
}

async function authRateLimit(request: Request, environment: AuthEnvironment) {
  if (request.method !== "POST") return null;
  const path = new URL(request.url).pathname;
  const isSignIn = /\/sign-in\//.test(path);
  const isRegister = path.endsWith("/sign-up/email");
  const isEmailAction =
    path.endsWith("/request-password-reset") ||
    path.endsWith("/send-verification-email");
  if (!isSignIn && !isRegister && !isEmailAction) return null;

  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.clone().json();
    if (parsed && typeof parsed === "object") {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // Better Auth will return the canonical malformed-body response.
  }
  const ip = await consumeRateLimit(environment.FEDIFY_KV, {
    scope: isRegister ? "register" : "auth-ip",
    subject: requestIp(request),
    rule: isRegister ? rateLimitRules.register : rateLimitRules.authIp,
  });
  if (!ip.allowed) return rateLimitResponse(ip.retryAfter);
  if (isSignIn || isEmailAction) {
    const identifier = String(
      body.email ?? body.username ?? body.identifier ?? "unknown",
    ).toLowerCase();
    const account = await consumeRateLimit(environment.FEDIFY_KV, {
      scope: "auth-account",
      subject: identifier,
      rule: rateLimitRules.authAccount,
    });
    if (!account.allowed) return rateLimitResponse(account.retryAfter);
  }
  return null;
}

export async function getSession(
  request: Request,
  environment: AuthEnvironment,
) {
  const session = await createAuth(environment).api.getSession({
    headers: request.headers,
  });
  if (!session) return null;
  const account = await environment.DB.prepare(
    "SELECT status, email_verified AS emailVerified FROM user WHERE id = ? LIMIT 1",
  )
    .bind(session.user.id)
    .first<{ status: string; emailVerified: number | boolean }>();
  const status =
    account?.status ??
    (await loadAccountStatus(environment.DB, session.user.id));
  if (status !== "active") return null;
  return {
    ...session,
    user: {
      ...session.user,
      emailVerified: Boolean(
        account?.emailVerified ?? session.user.emailVerified,
      ),
    },
  };
}

export async function requireVerifiedSession(
  request: Request,
  environment: AuthEnvironment,
) {
  const session = await getSession(request, environment);
  if (!session) throw new Response("请先登录。", { status: 401 });
  if (!session.user.emailVerified) {
    throw new Response("请先验证邮箱后再进行此操作。", { status: 403 });
  }
  return session;
}

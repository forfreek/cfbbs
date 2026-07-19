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

import { normalizeHandle, validateHandle } from "./handle";

export type AuthEnvironment = Pick<Env, "DB" | "APP_ORIGIN"> & {
  BETTER_AUTH_SECRET?: string;
  FEDERATION_KEY_ENCRYPTION_SECRET?: string;
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
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
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
  return createAuth(environment).handler(request);
}

export async function getSession(
  request: Request,
  environment: AuthEnvironment,
) {
  return createAuth(environment).api.getSession({ headers: request.headers });
}

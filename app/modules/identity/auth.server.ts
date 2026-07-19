import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";

import { createDatabase } from "@/db/client.server";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
  profiles,
} from "@/db/schema";

import { normalizeHandle, validateHandle } from "./handle";

export type AuthEnvironment = Pick<Env, "DB" | "APP_ORIGIN"> & {
  BETTER_AUTH_SECRET?: string;
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
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const handle = validateHandle(String(user.username ?? ""));

            if (!handle.ok) {
              throw new Error("A valid federation handle is required.");
            }

            const now = new Date().toISOString();
            await database
              .insert(profiles)
              .values({
                userId: user.id,
                handle: handle.value,
                displayName: user.name,
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoNothing();
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

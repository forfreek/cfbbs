import { describe, expect, it } from "vitest";

import { getRuntimeConfig } from "@/modules/runtime-config";

describe("getRuntimeConfig", () => {
  const requiredEnvironment = {
    APP_ORIGIN: "https://bbs.example.test",
    BETTER_AUTH_SECRET: "auth-secret",
    FEDERATION_KEY_ENCRYPTION_SECRET: "federation-secret",
  };

  it("returns the canonical origin and required secrets", () => {
    expect(getRuntimeConfig(requiredEnvironment)).toEqual({
      appOrigin: "https://bbs.example.test",
      betterAuthSecret: "auth-secret",
      federationKeyEncryptionSecret: "federation-secret",
    });
  });

  it("rejects a missing required secret", () => {
    expect(() =>
      getRuntimeConfig({
        ...requiredEnvironment,
        BETTER_AUTH_SECRET: "",
      }),
    ).toThrow("Missing required environment variable: BETTER_AUTH_SECRET");
  });
});

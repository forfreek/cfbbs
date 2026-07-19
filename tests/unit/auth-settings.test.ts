import { describe, expect, it } from "vitest";

import { getAuthSettings } from "@/modules/identity/auth.server";

describe("authentication settings", () => {
  const database = {} as D1Database;

  it("uses secure cookies for canonical HTTPS origins", () => {
    expect(
      getAuthSettings({
        DB: database,
        APP_ORIGIN: "https://bbs.example.test/",
        BETTER_AUTH_SECRET: "a-long-test-secret",
      }),
    ).toMatchObject({
      origin: "https://bbs.example.test",
      useSecureCookies: true,
    });
  });

  it("permits an insecure cookie only for the local HTTP development origin", () => {
    expect(
      getAuthSettings({
        DB: database,
        APP_ORIGIN: "http://127.0.0.1:5173",
        BETTER_AUTH_SECRET: "a-long-test-secret",
      }),
    ).toMatchObject({ useSecureCookies: false });
  });

  it("fails fast when the authentication secret is absent", () => {
    expect(() =>
      getAuthSettings({ DB: database, APP_ORIGIN: "https://bbs.example.test" }),
    ).toThrow("BETTER_AUTH_SECRET must be configured.");
  });
});

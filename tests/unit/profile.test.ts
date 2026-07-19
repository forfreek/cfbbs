import { describe, expect, it } from "vitest";

import { validateProfileInput } from "@/modules/identity/profile";

describe("profile input", () => {
  it("normalizes editable profile fields without changing an identity handle", () => {
    expect(
      validateProfileInput({
        displayName: " Alice ",
        bio: " Hello ",
        avatarUrl: "https://images.example.test/alice.png",
      }),
    ).toEqual({
      ok: true,
      value: {
        displayName: "Alice",
        bio: "Hello",
        avatarUrl: "https://images.example.test/alice.png",
      },
    });
  });

  it("rejects unsafe avatar URLs and overlong biographies", () => {
    expect(
      validateProfileInput({
        displayName: "Alice",
        bio: "",
        avatarUrl: "http://x",
      }),
    ).toEqual({ ok: false, message: "Avatar URL must use HTTPS." });
    expect(
      validateProfileInput({
        displayName: "Alice",
        bio: "x".repeat(2001),
        avatarUrl: "",
      }),
    ).toEqual({
      ok: false,
      message: "Biography must be at most 2000 characters.",
    });
  });
});

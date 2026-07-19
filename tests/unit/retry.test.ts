import { describe, expect, it } from "vitest";
import { nextRetry } from "@/modules/jobs/retry";
describe("federation retry", () => {
  it("uses capped exponential delay", () =>
    expect(
      nextRetry(2, new Date("2026-01-01T00:00:00Z")).retryAt?.toISOString(),
    ).toBe("2026-01-01T00:04:00.000Z"));
  it("stops after five attempts", () =>
    expect(nextRetry(5, new Date())).toEqual({
      terminal: true,
      retryAt: null,
    }));
});

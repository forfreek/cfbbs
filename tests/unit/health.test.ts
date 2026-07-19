import { describe, expect, it } from "vitest";

import { getHealthPayload } from "@/modules/health";

describe("getHealthPayload", () => {
  it("reports a stable public readiness payload", () => {
    expect(getHealthPayload()).toEqual({
      service: "cfbbs",
      status: "ok",
    });
  });
});

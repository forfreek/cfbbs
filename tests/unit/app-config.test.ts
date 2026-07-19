import { describe, expect, it } from "vitest";

import { appConfig } from "@/lib/app-config";

describe("appConfig", () => {
  it("defines the stable local application identity", () => {
    expect(appConfig).toEqual({
      name: "CFBBS",
      tagline: "A federated community forum",
    });
  });
});

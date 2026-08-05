import { describe, expect, it } from "vitest";

import {
  consumeRateLimit,
  rateLimitRules,
  requestIp,
} from "@/modules/rate-limit.server";

function memoryKv() {
  const values = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return (values.get(key) as T | undefined) ?? null;
    },
    async put(key: string, value: string) {
      values.set(key, JSON.parse(value));
    },
  } as unknown as KVNamespace;
}

describe("KV rate limiting", () => {
  it("uses the shared rl:v1 key and rejects after the configured limit", async () => {
    const kv = memoryKv();
    const rule = { name: "test", limit: 2, windowSeconds: 60 };
    await expect(
      consumeRateLimit(kv, { scope: "test", subject: "user-1", rule }),
    ).resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(
      consumeRateLimit(kv, { scope: "test", subject: "user-1", rule }),
    ).resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(
      consumeRateLimit(kv, { scope: "test", subject: "user-1", rule }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("extracts the client IP without trusting an arbitrary fallback", () => {
    expect(
      requestIp(
        new Request("https://example.test", {
          headers: { "cf-connecting-ip": "203.0.113.4" },
        }),
      ),
    ).toBe("203.0.113.4");
    expect(
      requestIp(
        new Request("https://example.test", {
          headers: { "x-forwarded-for": "198.51.100.3, 10.0.0.1" },
        }),
      ),
    ).toBe("198.51.100.3");
    expect(rateLimitRules.upload.limit).toBeGreaterThan(0);
  });

  it("fails open when the KV binding is temporarily unavailable", async () => {
    const kv = {
      async get() {
        throw new Error("KV unavailable");
      },
      async put() {
        throw new Error("KV unavailable");
      },
    } as unknown as KVNamespace;
    await expect(
      consumeRateLimit(kv, {
        scope: "search",
        subject: "user-1",
        rule: rateLimitRules.search,
      }),
    ).resolves.toMatchObject({ allowed: true, degraded: true });
  });
});

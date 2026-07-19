import { describe, expect, it } from "vitest";
import { isSafeRemoteUrl } from "@/modules/federation/remote-url";
describe("remote federation URLs", () => {
  it("accepts public HTTPS URLs", () =>
    expect(isSafeRemoteUrl("https://social.example.test/actor")).toBe(true));
  it("rejects unsafe protocols and private hosts", () => {
    expect(isSafeRemoteUrl("http://social.example.test")).toBe(false);
    expect(isSafeRemoteUrl("https://127.0.0.1/admin")).toBe(false);
    expect(isSafeRemoteUrl("https://192.168.1.2/")).toBe(false);
  });
});

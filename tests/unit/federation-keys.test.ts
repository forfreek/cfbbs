import { describe, expect, it } from "vitest";

import {
  decryptPrivateKey,
  encryptPrivateKey,
  generateFederationSigningKeyPair,
  importFederationPrivateKey,
} from "@/modules/federation/keys";

describe("local federation signing keys", () => {
  const secret = "a-high-entropy-federation-encryption-secret";

  it("encrypts private key bytes with a randomized authenticated envelope", async () => {
    const privateKey = new TextEncoder().encode("private key material").buffer;
    const first = await encryptPrivateKey(privateKey, secret);
    const second = await encryptPrivateKey(privateKey, secret);

    expect(first).not.toBe(second);
    expect(first).not.toContain("private key material");
    await expect(decryptPrivateKey(first, secret)).resolves.toEqual(privateKey);
  });

  it("rejects decryption with a different secret", async () => {
    const encrypted = await encryptPrivateKey(
      new TextEncoder().encode("private key material").buffer,
      secret,
    );

    await expect(
      decryptPrivateKey(encrypted, "a-different-federation-secret"),
    ).rejects.toThrow("Unable to decrypt federation private key.");
  });

  it("generates an RSA signing key with a PEM public half", async () => {
    const pair = await generateFederationSigningKeyPair(secret);

    expect(pair.publicKeyPem).toMatch(/^-----BEGIN PUBLIC KEY-----/);
    expect(pair.publicKeyPem).toMatch(/-----END PUBLIC KEY-----$/);
    expect(pair.privateKeyEncrypted).not.toContain("BEGIN PRIVATE KEY");
    await expect(
      decryptPrivateKey(pair.privateKeyEncrypted, secret),
    ).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it("imports a decrypted private key for Fedify's signing runtime", async () => {
    const pair = await generateFederationSigningKeyPair(secret);
    const privateKey = await importFederationPrivateKey(
      pair.privateKeyEncrypted,
      secret,
    );

    expect(privateKey.type).toBe("private");
    expect(privateKey.usages).toEqual(["sign"]);
    expect(privateKey.extractable).toBe(true);
  });
});

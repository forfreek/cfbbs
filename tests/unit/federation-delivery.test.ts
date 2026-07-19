import { describe, expect, it } from "vitest";

import { signedActivityDelivery } from "@/modules/federation/delivery";
import { generateFederationSigningKeyPair } from "@/modules/federation/keys";

describe("signed federation delivery", () => {
  const secret = "a-high-entropy-federation-encryption-secret";

  it("signs a public ActivityPub request with the actor key ID", async () => {
    const keyPair = await generateFederationSigningKeyPair(secret);
    const request = await signedActivityDelivery({
      actorUri: "https://bbs.example.test/users/alice",
      encryptedPrivateKey: keyPair.privateKeyEncrypted,
      encryptionSecret: secret,
      targetInboxUrl: "https://remote.example/inbox",
      activityJson: JSON.stringify({
        type: "Create",
        id: "https://bbs.example.test/a/1",
      }),
    });

    expect(request.method).toBe("POST");
    expect(request.headers.get("content-type")).toBe(
      "application/activity+json",
    );
    expect(request.headers.get("signature-input")).toContain("main-key");
    expect(request.headers.get("signature")).toBeTruthy();
  });

  it("rejects unsafe target URLs before attempting delivery", async () => {
    await expect(
      signedActivityDelivery({
        actorUri: "https://bbs.example.test/users/alice",
        encryptedPrivateKey: "unused",
        encryptionSecret: secret,
        targetInboxUrl: "http://127.0.0.1/inbox",
        activityJson: "{}",
      }),
    ).rejects.toThrow("Target inbox");
  });
});

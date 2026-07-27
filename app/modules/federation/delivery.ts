import { signRequest } from "@fedify/fedify";

import { importFederationPrivateKey } from "./keys";
import { isSafeRemoteUrl } from "./remote-url";

export type SignedActivityDelivery = {
  actorUri: string;
  encryptedPrivateKey: string;
  encryptionSecret: string;
  targetInboxUrl: string;
  activityJson: string;
};

export async function signedActivityDelivery(input: SignedActivityDelivery) {
  if (!isSafeRemoteUrl(input.targetInboxUrl)) {
    throw new Error("Target inbox must be a public HTTPS URL.");
  }
  if (!isSafeRemoteUrl(input.actorUri)) {
    throw new Error("Actor URI must be a public HTTPS URL.");
  }
  let activity: unknown;
  try {
    activity = JSON.parse(input.activityJson);
  } catch {
    throw new Error("Activity payload must be valid JSON.");
  }
  if (
    typeof activity !== "object" ||
    activity === null ||
    Array.isArray(activity)
  ) {
    throw new Error("Activity payload must be a JSON object.");
  }

  const body = JSON.stringify(activity);
  const request = new Request(input.targetInboxUrl, {
    method: "POST",
    headers: {
      accept: "application/activity+json",
      "content-type": "application/activity+json",
    },
    body,
  });
  // Misskey and the broader ActivityPub ecosystem still verify the
  // draft-cavage HTTP Signatures profile.  RFC 9421 signatures are rejected
  // as unauthorized (401), so outbound delivery uses the draft profile.
  return signRequest(
    request,
    await importFederationPrivateKey(
      input.encryptedPrivateKey,
      input.encryptionSecret,
    ),
    new URL(`${input.actorUri}#main-key`),
    { spec: "draft-cavage-http-signatures-12" },
  );
}

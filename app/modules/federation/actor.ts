import { actorId } from "./identifiers";

export type PublicProfile = {
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  publicKeyPem?: string | null;
};

export function personActor(origin: string, profile: PublicProfile) {
  const id = actorId(origin, profile.handle);
  return {
    "@context": ["https://www.w3.org/ns/activitystreams"],
    id,
    type: "Person",
    preferredUsername: profile.handle,
    name: profile.displayName,
    summary: profile.bio,
    inbox: new URL(`/users/${profile.handle}/inbox`, origin).href,
    endpoints: { sharedInbox: new URL("/inbox", origin).href },
    outbox: new URL(`/users/${profile.handle}/outbox`, origin).href,
    followers: new URL(`/users/${profile.handle}/followers`, origin).href,
    following: new URL(`/users/${profile.handle}/following`, origin).href,
    ...(profile.publicKeyPem
      ? {
          publicKey: {
            id: `${id}#main-key`,
            owner: id,
            publicKeyPem: profile.publicKeyPem,
          },
        }
      : {}),
    ...(profile.avatarUrl
      ? {
          icon: { type: "Image", mediaType: "image/*", url: profile.avatarUrl },
        }
      : {}),
  };
}

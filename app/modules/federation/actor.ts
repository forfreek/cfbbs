import { actorId } from "./identifiers";

export type PublicProfile = {
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
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
    outbox: new URL(`/users/${profile.handle}/outbox`, origin).href,
    ...(profile.avatarUrl
      ? {
          icon: { type: "Image", mediaType: "image/*", url: profile.avatarUrl },
        }
      : {}),
  };
}

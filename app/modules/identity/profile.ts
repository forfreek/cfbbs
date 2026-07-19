import { eq } from "drizzle-orm";

import { createDatabase } from "@/db/client.server";
import { profiles } from "@/db/schema";

export type ProfileInput = {
  displayName: string;
  bio: string;
  avatarUrl: string;
};

export function validateProfileInput(
  input: ProfileInput,
): { ok: true; value: ProfileInput } | { ok: false; message: string } {
  const displayName = input.displayName.trim();
  const bio = input.bio.trim();
  const avatarUrl = input.avatarUrl.trim();

  if (displayName.length < 1 || displayName.length > 80) {
    return { ok: false, message: "Display name must be 1 to 80 characters." };
  }
  if (bio.length > 2_000) {
    return { ok: false, message: "Biography must be at most 2000 characters." };
  }
  if (avatarUrl) {
    try {
      if (new URL(avatarUrl).protocol !== "https:") throw new Error();
    } catch {
      return { ok: false, message: "Avatar URL must use HTTPS." };
    }
  }
  return { ok: true, value: { displayName, bio, avatarUrl } };
}

export async function updateProfile(
  databaseBinding: D1Database,
  userId: string,
  input: ProfileInput,
) {
  const value = validateProfileInput(input);
  if (!value.ok) return value;

  await createDatabase(databaseBinding)
    .update(profiles)
    .set({
      displayName: value.value.displayName,
      bio: value.value.bio,
      avatarUrl: value.value.avatarUrl || null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(profiles.userId, userId));
  return value;
}

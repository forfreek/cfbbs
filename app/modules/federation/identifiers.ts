import { validateHandle } from "@/modules/identity/handle";

export function actorId(origin: string, handle: string) {
  const normalized = validateHandle(handle);
  if (!normalized.ok) throw new Error("Invalid actor handle.");
  return new URL(`/users/${normalized.value}`, origin).href;
}

export function noteId(origin: string, postId: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(postId))
    throw new Error("Invalid post ID.");
  return new URL(`/objects/${postId}`, origin).href;
}

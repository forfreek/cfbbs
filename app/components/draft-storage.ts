export type LocalDraft = {
  version: 1;
  title: string;
  markdown: string;
  attachments: Array<{
    id: string;
    url: string;
    contentType: string;
    originalFilename: string;
    kind: string;
    byteSize?: number;
  }>;
  savedAt: string;
  serverUpdatedAt?: string;
};

export function draftStorageKey(
  userId: string | null | undefined,
  scope: string,
) {
  return userId ? `cfbbs:draft:v1:${userId}:${scope}` : null;
}

export function loadLocalDraft(key: string | null) {
  if (!key || typeof window === "undefined") return null;
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(key) ?? "null",
    );
    if (
      !value ||
      typeof value !== "object" ||
      (value as { version?: unknown }).version !== 1
    )
      return null;
    return value as LocalDraft;
  } catch {
    return null;
  }
}

export function saveLocalDraft(
  key: string | null,
  draft: Omit<LocalDraft, "version" | "savedAt">,
) {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        ...draft,
        version: 1,
        savedAt: new Date().toISOString(),
      } satisfies LocalDraft),
    );
  } catch {
    // Continue editing when browser storage is unavailable.
  }
}

export function clearLocalDraft(key: string | null) {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Clearing is best effort; an unavailable storage should not block submit.
  }
}

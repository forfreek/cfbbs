const handlePattern = /^[a-z0-9_]{3,32}$/;

const reservedHandles = new Set([
  "admin",
  "admins",
  "api",
  "auth",
  "health",
  "inbox",
  "outbox",
  "settings",
]);

export function normalizeHandle(handle: string) {
  return handle.trim().toLowerCase();
}

export function validateHandle(
  handle: string,
): { ok: true; value: string } | { ok: false } {
  const value = normalizeHandle(handle);

  if (!handlePattern.test(value) || reservedHandles.has(value)) {
    return { ok: false };
  }

  return { ok: true, value };
}

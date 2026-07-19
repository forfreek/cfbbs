export function nextRetry(attempts: number, now: Date) {
  if (attempts >= 5) return { terminal: true as const, retryAt: null };
  const delaySeconds = Math.min(60 * 60, 2 ** attempts * 60);
  return {
    terminal: false as const,
    retryAt: new Date(now.getTime() + delaySeconds * 1000),
  };
}

const privateHost =
  /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i;

export function isSafeRemoteUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !privateHost.test(url.hostname);
  } catch {
    return false;
  }
}

const privateHost =
  /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i;
const privateIpv6 = /^(::1|fc|fd|fe[89ab])/i;

export function isSafeRemoteUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    return (
      url.protocol === "https:" &&
      !privateHost.test(host) &&
      !privateIpv6.test(host)
    );
  } catch {
    return false;
  }
}

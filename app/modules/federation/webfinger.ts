import { validateHandle } from "@/modules/identity/handle";

export function parseWebFingerResource(resource: string, origin: string) {
  const account = /^acct:([^@]+)@([^@]+)$/i.exec(resource);
  if (!account) return null;
  const handle = validateHandle(account[1]);
  if (
    !handle.ok ||
    account[2].toLowerCase() !== new URL(origin).host.toLowerCase()
  )
    return null;
  return handle.value;
}

export function webFingerDocument(origin: string, handle: string) {
  return {
    subject: `acct:${handle}@${new URL(origin).host}`,
    links: [
      {
        rel: "self",
        type: "application/activity+json",
        href: new URL(`/users/${handle}`, origin).href,
      },
    ],
  };
}

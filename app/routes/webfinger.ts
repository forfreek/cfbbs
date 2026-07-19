import { eq } from "drizzle-orm";
import type { Route } from "./+types/webfinger";
import { createDatabase } from "@/db/client.server";
import { profiles } from "@/db/schema";
import {
  parseWebFingerResource,
  webFingerDocument,
} from "@/modules/federation/webfinger";

export async function loader({ request, context }: Route.LoaderArgs) {
  const resource = new URL(request.url).searchParams.get("resource") ?? "";
  const handle = parseWebFingerResource(
    resource,
    context.cloudflare.env.APP_ORIGIN,
  );
  if (!handle) throw new Response("Not found", { status: 404 });
  const profile = await createDatabase(
    context.cloudflare.env.DB,
  ).query.profiles.findFirst({ where: eq(profiles.handle, handle) });
  if (!profile) throw new Response("Not found", { status: 404 });
  return Response.json(
    webFingerDocument(context.cloudflare.env.APP_ORIGIN, profile.handle),
    { headers: { "content-type": "application/jrd+json" } },
  );
}

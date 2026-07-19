import type { Route } from "./+types/nodeinfo";
import { nodeInfoDocument } from "@/modules/federation/nodeinfo";
export function loader({ context }: Route.LoaderArgs) {
  return Response.json(nodeInfoDocument(context.cloudflare.env.APP_ORIGIN));
}

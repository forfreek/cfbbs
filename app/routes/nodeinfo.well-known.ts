import type { Route } from "./+types/nodeinfo.well-known";
export function loader({ context }: Route.LoaderArgs) {
  return Response.json({
    links: [
      {
        rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
        href: new URL("/nodeinfo/2.1", context.cloudflare.env.APP_ORIGIN).href,
      },
    ],
  });
}

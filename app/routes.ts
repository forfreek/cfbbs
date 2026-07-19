import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/auth/*", "routes/api.auth.ts"),
  route("health", "routes/health.ts"),
] satisfies RouteConfig;

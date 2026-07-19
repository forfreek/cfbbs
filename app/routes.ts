import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("auth/register", "routes/auth.register.tsx"),
  route("auth/login", "routes/auth.login.tsx"),
  route("auth/logout", "routes/auth.logout.ts"),
  route("api/auth/*", "routes/api.auth.ts"),
  route("health", "routes/health.ts"),
] satisfies RouteConfig;

import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("auth/register", "routes/auth.register.tsx"),
  route("auth/login", "routes/auth.login.tsx"),
  route("auth/logout", "routes/auth.logout.ts"),
  route("users/:handle", "routes/users.$handle.tsx"),
  route("settings/profile", "routes/settings.profile.tsx"),
  route(".well-known/webfinger", "routes/webfinger.ts"),
  route(".well-known/nodeinfo", "routes/nodeinfo.well-known.ts"),
  route("nodeinfo/2.1", "routes/nodeinfo.ts"),
  route("api/auth/*", "routes/api.auth.ts"),
  route("health", "routes/health.ts"),
] satisfies RouteConfig;

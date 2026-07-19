import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("auth/register", "routes/auth.register.tsx"),
  route("auth/login", "routes/auth.login.tsx"),
  route("auth/logout", "routes/auth.logout.ts"),
  route("users/:handle", "routes/users.$handle.tsx"),
  route("users/:handle/outbox", "routes/users.$handle.outbox.tsx"),
  route("users/:handle/followers", "routes/users.$handle.followers.tsx"),
  route("users/:handle/following", "routes/users.$handle.following.tsx"),
  route("objects/:postId", "routes/objects.$postId.tsx"),
  route("boards/:boardId", "routes/boards.$boardId.tsx"),
  route("threads/:threadId", "routes/threads.$threadId.tsx"),
  route("posts/:postId/like", "routes/posts.$postId.like.ts"),
  route("settings/profile", "routes/settings.profile.tsx"),
  route(".well-known/webfinger", "routes/webfinger.ts"),
  route(".well-known/nodeinfo", "routes/nodeinfo.well-known.ts"),
  route("nodeinfo/2.1", "routes/nodeinfo.ts"),
  route("api/auth/*", "routes/api.auth.ts"),
  route("health", "routes/health.ts"),
] satisfies RouteConfig;

import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable(
  "profiles",
  {
    userId: text("user_id").primaryKey(),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    bio: text("bio").notNull().default(""),
    avatarUrl: text("avatar_url"),
    federationPrivateKeyEncrypted: text("federation_private_key_encrypted"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("profiles_handle_unique").on(table.handle)],
);

export const boards = sqliteTable(
  "boards",
  {
    id: text("id").primaryKey(),
    parentId: text("parent_id").references(() => boards.id),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    mode: text("mode", {
      enum: ["container", "posting", "read_only"],
    }).notNull(),
    visibility: text("visibility", { enum: ["public", "private"] })
      .notNull()
      .default("public"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("boards_parent_slug_unique").on(table.parentId, table.slug),
    index("boards_parent_sort_index").on(table.parentId, table.sortOrder),
  ],
);

export const boardClosure = sqliteTable(
  "board_closure",
  {
    ancestorId: text("ancestor_id")
      .notNull()
      .references(() => boards.id),
    descendantId: text("descendant_id")
      .notNull()
      .references(() => boards.id),
    depth: integer("depth").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ancestorId, table.descendantId] }),
    index("board_closure_descendant_index").on(table.descendantId, table.depth),
  ],
);

export const groups = sqliteTable(
  "groups",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    isSystem: integer("is_system", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("groups_name_unique").on(table.name)],
);

export const groupMembers = sqliteTable(
  "group_members",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    index("group_members_user_index").on(table.userId),
  ],
);

export const permissions = sqliteTable("permissions", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
});

export const groupPermissions = sqliteTable(
  "group_permissions",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key),
    boardId: text("board_id").references(() => boards.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.groupId, table.permissionKey, table.boardId],
    }),
    index("group_permissions_board_index").on(table.boardId),
  ],
);

export const threads = sqliteTable(
  "threads",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id),
    title: text("title").notNull(),
    firstPostId: text("first_post_id"),
    isPinned: integer("is_pinned", { mode: "boolean" })
      .notNull()
      .default(false),
    isLocked: integer("is_locked", { mode: "boolean" })
      .notNull()
      .default(false),
    postCount: integer("post_count").notNull().default(0),
    lastActivityAt: text("last_activity_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("threads_board_activity_index").on(
      table.boardId,
      table.isPinned,
      table.lastActivityAt,
    ),
  ],
);

export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id),
    parentPostId: text("parent_post_id").references(() => posts.id),
    authorUserId: text("author_user_id"),
    authorActorId: text("author_actor_id"),
    origin: text("origin", { enum: ["local", "remote"] }).notNull(),
    state: text("state", { enum: ["published", "hidden", "deleted"] })
      .notNull()
      .default("published"),
    visibility: text("visibility", { enum: ["public", "private"] })
      .notNull()
      .default("public"),
    markdown: text("markdown").notNull(),
    renderedHtml: text("rendered_html").notNull(),
    federationObjectId: text("federation_object_id"),
    publishedAt: text("published_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("posts_thread_published_index").on(table.threadId, table.publishedAt),
    index("posts_parent_index").on(table.parentPostId),
    uniqueIndex("posts_federation_object_unique").on(table.federationObjectId),
  ],
);

export const postRevisions = sqliteTable(
  "post_revisions",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    markdown: text("markdown").notNull(),
    renderedHtml: text("rendered_html").notNull(),
    editorUserId: text("editor_user_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("post_revisions_post_index").on(table.postId, table.createdAt),
  ],
);

export const postLikes = sqliteTable(
  "post_likes",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    actorId: text("actor_id").notNull(),
    activityId: text("activity_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.actorId] }),
    uniqueIndex("post_likes_activity_unique").on(table.activityId),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    recipientUserId: text("recipient_user_id").notNull(),
    actorId: text("actor_id").notNull(),
    type: text("type", { enum: ["reply", "follow", "like"] }).notNull(),
    threadId: text("thread_id").references(() => threads.id),
    postId: text("post_id").references(() => posts.id),
    readAt: text("read_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("notifications_recipient_index").on(
      table.recipientUserId,
      table.readAt,
      table.createdAt,
    ),
  ],
);

export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    reporterUserId: text("reporter_user_id"),
    reporterActorId: text("reporter_actor_id"),
    postId: text("post_id").references(() => posts.id),
    reason: text("reason").notNull(),
    state: text("state", { enum: ["open", "resolved", "dismissed"] })
      .notNull()
      .default("open"),
    resolvedByUserId: text("resolved_by_user_id"),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (table) => [index("reports_state_index").on(table.state, table.createdAt)],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("audit_logs_target_index").on(table.targetType, table.targetId),
  ],
);

export const instancePolicies = sqliteTable(
  "instance_policies",
  {
    id: text("id").primaryKey(),
    domain: text("domain").notNull(),
    state: text("state", { enum: ["allowed", "blocked", "limited"] }).notNull(),
    reason: text("reason").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("instance_policies_domain_unique").on(table.domain)],
);

export const federationActors = sqliteTable(
  "federation_actors",
  {
    id: text("id").primaryKey(),
    uri: text("uri").notNull(),
    handle: text("handle").notNull(),
    inboxUrl: text("inbox_url").notNull(),
    sharedInboxUrl: text("shared_inbox_url"),
    outboxUrl: text("outbox_url"),
    followersUrl: text("followers_url"),
    publicKeyPem: text("public_key_pem").notNull(),
    name: text("name").notNull().default(""),
    summaryHtml: text("summary_html").notNull().default(""),
    avatarUrl: text("avatar_url"),
    isLocal: integer("is_local", { mode: "boolean" }).notNull().default(false),
    blockedAt: text("blocked_at"),
    lastFetchedAt: text("last_fetched_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("federation_actors_uri_unique").on(table.uri),
    uniqueIndex("federation_actors_handle_unique").on(table.handle),
  ],
);

export const federationObjects = sqliteTable(
  "federation_objects",
  {
    id: text("id").primaryKey(),
    uri: text("uri").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => federationActors.id),
    type: text("type").notNull(),
    inReplyToUri: text("in_reply_to_uri"),
    contentHtml: text("content_html").notNull(),
    publishedAt: text("published_at").notNull(),
    updatedAt: text("updated_at"),
    deletedAt: text("deleted_at"),
    retentionExpiresAt: text("retention_expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("federation_objects_uri_unique").on(table.uri),
    index("federation_objects_retention_index").on(table.retentionExpiresAt),
  ],
);

export const federationInboxReceipts = sqliteTable(
  "federation_inbox_receipts",
  {
    activityId: text("activity_id").primaryKey(),
    actorUri: text("actor_uri").notNull(),
    receivedAt: text("received_at").notNull(),
    processedAt: text("processed_at"),
    state: text("state", {
      enum: ["received", "processed", "rejected"],
    }).notNull(),
    failureReason: text("failure_reason"),
  },
  (table) => [
    index("federation_inbox_receipts_state_index").on(
      table.state,
      table.receivedAt,
    ),
  ],
);

export const federationFollows = sqliteTable(
  "federation_follows",
  {
    id: text("id").primaryKey(),
    followerActorId: text("follower_actor_id")
      .notNull()
      .references(() => federationActors.id),
    followingActorId: text("following_actor_id")
      .notNull()
      .references(() => federationActors.id),
    followActivityId: text("follow_activity_id").notNull(),
    state: text("state", {
      enum: ["pending", "accepted", "rejected", "undone"],
    }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("federation_follows_pair_unique").on(
      table.followerActorId,
      table.followingActorId,
    ),
    uniqueIndex("federation_follows_activity_unique").on(
      table.followActivityId,
    ),
  ],
);

export const federationDeliveries = sqliteTable(
  "federation_deliveries",
  {
    id: text("id").primaryKey(),
    outboxEventId: text("outbox_event_id").notNull(),
    targetInboxUrl: text("target_inbox_url").notNull(),
    state: text("state", { enum: ["pending", "delivered", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: text("next_attempt_at").notNull(),
    lastError: text("last_error"),
    deliveredAt: text("delivered_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("federation_deliveries_retry_index").on(
      table.state,
      table.nextAttemptAt,
    ),
    index("federation_deliveries_outbox_index").on(table.outboxEventId),
  ],
);

export const federationOutboxEvents = sqliteTable(
  "federation_outbox_events",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id")
      .notNull()
      .references(() => federationActors.id),
    aggregateType: text("aggregate_type", {
      enum: ["post", "follow", "like"],
    }).notNull(),
    aggregateId: text("aggregate_id").notNull(),
    activityType: text("activity_type", {
      enum: ["Create", "Update", "Delete", "Follow", "Undo", "Like"],
    }).notNull(),
    activityJson: text("activity_json").notNull(),
    state: text("state", { enum: ["pending", "queued", "delivered", "failed"] })
      .notNull()
      .default("pending"),
    queuedAt: text("queued_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("federation_outbox_state_index").on(table.state, table.createdAt),
    uniqueIndex("federation_outbox_aggregate_unique").on(
      table.aggregateType,
      table.aggregateId,
      table.activityType,
    ),
  ],
);
